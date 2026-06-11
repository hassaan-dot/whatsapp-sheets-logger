const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CONFIG_PATH = path.join(__dirname, 'targets.json');

function normalizeMembers(members, memberName, memberId) {
  if (Array.isArray(members) && members.length) {
    return members
      .map((member) => ({
        name: String(member.name || member.memberName || '').trim(),
        id: String(member.id || member.memberId || '').trim() || null
      }))
      .filter((member) => member.name);
  }

  if (memberName?.trim()) {
    return [{ name: memberName.trim(), id: memberId?.trim() || null }];
  }

  return [];
}

function parseEnvMembers(memberName, userId) {
  if (!memberName?.trim()) return [];
  const names = memberName.split(',').map((part) => part.trim()).filter(Boolean);
  const ids = (userId || '').split(',').map((part) => part.trim());
  return names.map((name, index) => ({ name, id: ids[index] || null }));
}

function memberLabels(members) {
  return members.map((member) => member.name).join(', ');
}

function newTargetId() {
  return crypto.randomUUID();
}

function normalizeWebhookUrl(url) {
  const value = String(url || '').trim();
  return value || null;
}

function normalizeTargetEntry(entry) {
  const members = normalizeMembers(entry.members, entry.memberName, entry.memberId);
  if (!entry?.groupName?.trim() || !members.length) return null;

  return {
    id: entry.id || newTargetId(),
    groupName: entry.groupName.trim(),
    groupId: entry.groupId?.trim() || null,
    members,
    webhookUrl: normalizeWebhookUrl(entry.webhookUrl),
    updatedAt: entry.updatedAt || new Date().toISOString()
  };
}

function readConfigFile() {
  if (!fs.existsSync(CONFIG_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    return null;
  }
}

function writeConfigFile(targets) {
  const data = {
    targets,
    updatedAt: new Date().toISOString()
  };
  fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(data, null, 2)}\n`);
  return data;
}

function loadAllTargetConfigs() {
  const raw = readConfigFile();
  if (!raw) return [];

  if (Array.isArray(raw.targets)) {
    return raw.targets.map((entry) => normalizeTargetEntry(entry)).filter(Boolean);
  }

  const legacy = normalizeTargetEntry(raw);
  return legacy ? [legacy] : [];
}

function loadTargetConfig() {
  return loadAllTargetConfigs()[0] || null;
}

function clearTargetConfig() {
  if (fs.existsSync(CONFIG_PATH)) {
    fs.unlinkSync(CONFIG_PATH);
  }
}

function saveAllTargetConfigs(targets) {
  const normalized = targets.map((entry) => normalizeTargetEntry(entry)).filter(Boolean);
  if (!normalized.length) {
    clearTargetConfig();
    return [];
  }
  writeConfigFile(normalized);
  return normalized;
}

function saveTargetConfig({ id, groupName, groupId, members, webhookUrl }) {
  const normalized = normalizeTargetEntry({ id, groupName, groupId, members, webhookUrl });
  if (!normalized) {
    throw new Error('Group and at least one member are required.');
  }

  const targets = loadAllTargetConfigs();
  const index = targets.findIndex(
    (item) => item.id === normalized.id || (normalized.groupId && item.groupId === normalized.groupId)
  );

  if (index >= 0) {
    normalized.id = targets[index].id;
    targets[index] = { ...targets[index], ...normalized, updatedAt: new Date().toISOString() };
  } else {
    targets.push(normalized);
  }

  writeConfigFile(targets);
  return normalized;
}

function getEffectiveTargets({ groupName, memberName, groupId, userId }) {
  if (groupName?.trim() && memberName?.trim()) {
    return {
      targets: [
        {
          groupName: groupName.trim(),
          members: parseEnvMembers(memberName, userId),
          groupId: groupId?.trim() || null,
          webhookUrl: null,
          source: 'env'
        }
      ],
      source: 'env'
    };
  }

  const saved = loadAllTargetConfigs();
  if (saved.length) {
    return {
      targets: saved.map((item) => ({ ...item, source: 'saved' })),
      source: 'saved'
    };
  }

  if (
    groupId?.trim() &&
    userId?.trim() &&
    !groupId.includes('xxxxx') &&
    !userId.includes('xxxxx')
  ) {
    return {
      targets: [
        {
          groupName: '',
          members: [],
          groupId: groupId.trim(),
          userId: userId.trim(),
          webhookUrl: null,
          source: 'env-ids'
        }
      ],
      source: 'env-ids'
    };
  }

  return null;
}

function getAllTargetInputs(env, defaultWebhookUrl = '') {
  const effective = getEffectiveTargets(env);
  if (!effective?.targets?.length) return [];

  return effective.targets
    .map((target) => {
      if (target.members?.length) {
        return {
          id: target.id || null,
          groupName: target.groupName,
          groupId: target.groupId || env.groupId?.trim() || '',
          members: target.members,
          webhookUrl: target.webhookUrl || defaultWebhookUrl || null
        };
      }

      if (target.groupId && target.userId) {
        return {
          id: target.id || null,
          groupId: target.groupId,
          userId: target.userId,
          webhookUrl: target.webhookUrl || defaultWebhookUrl || null
        };
      }

      return null;
    })
    .filter(Boolean);
}

function getTargetInput(env) {
  return getAllTargetInputs(env)[0] || null;
}

function hasConfiguredTargets(env) {
  return Boolean(getEffectiveTargets(env));
}

function maskWebhookUrl(url) {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    const path = parsed.pathname;
    if (path.length <= 20) return parsed.origin + path;
    return `${parsed.origin}${path.slice(0, 12)}…${path.slice(-8)}`;
  } catch {
    return url.length > 32 ? `${url.slice(0, 20)}…` : url;
  }
}

module.exports = {
  loadTargetConfig,
  loadAllTargetConfigs,
  clearTargetConfig,
  saveTargetConfig,
  saveAllTargetConfigs,
  normalizeMembers,
  memberLabels,
  getEffectiveTargets,
  getAllTargetInputs,
  getTargetInput,
  hasConfiguredTargets,
  maskWebhookUrl
};
