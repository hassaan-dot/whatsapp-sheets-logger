const fs = require('fs');
const path = require('path');

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

function loadTargetConfig() {
  if (!fs.existsSync(CONFIG_PATH)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    const members = normalizeMembers(data.members, data.memberName, data.memberId);
    if (!data?.groupName?.trim() || !members.length) return null;
    return {
      groupName: data.groupName.trim(),
      groupId: data.groupId?.trim() || null,
      members,
      updatedAt: data.updatedAt || null
    };
  } catch {
    return null;
  }
}

function clearTargetConfig() {
  if (fs.existsSync(CONFIG_PATH)) {
    fs.unlinkSync(CONFIG_PATH);
  }
}

function saveTargetConfig({ groupName, groupId, members }) {
  const normalized = normalizeMembers(members);
  const data = {
    groupName: groupName.trim(),
    groupId: groupId?.trim() || null,
    members: normalized,
    updatedAt: new Date().toISOString()
  };
  fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(data, null, 2)}\n`);
  return data;
}

function getEffectiveTargets({ groupName, memberName, groupId, userId }) {
  if (groupName?.trim() && memberName?.trim()) {
    return {
      groupName: groupName.trim(),
      members: parseEnvMembers(memberName, userId),
      source: 'env'
    };
  }

  const saved = loadTargetConfig();
  if (saved) {
    return {
      groupName: saved.groupName,
      groupId: saved.groupId,
      members: saved.members,
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
      groupName: '',
      members: [],
      groupId: groupId.trim(),
      userId: userId.trim(),
      source: 'env-ids'
    };
  }

  return null;
}

function getTargetInput(env) {
  const targets = getEffectiveTargets(env);
  if (!targets) return null;

  if (targets.members?.length) {
    return {
      groupName: targets.groupName,
      groupId: targets.groupId || env.groupId?.trim() || '',
      members: targets.members
    };
  }

  return { groupId: targets.groupId, userId: targets.userId };
}

function hasConfiguredTargets(env) {
  return Boolean(getEffectiveTargets(env));
}

module.exports = {
  loadTargetConfig,
  clearTargetConfig,
  saveTargetConfig,
  normalizeMembers,
  memberLabels,
  getEffectiveTargets,
  getTargetInput,
  hasConfiguredTargets
};
