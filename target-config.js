const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, 'targets.json');

function loadTargetConfig() {
  if (!fs.existsSync(CONFIG_PATH)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    if (!data?.groupName?.trim() || !data?.memberName?.trim()) return null;
    return {
      groupName: data.groupName.trim(),
      memberName: data.memberName.trim(),
      groupId: data.groupId?.trim() || null,
      memberId: data.memberId?.trim() || null,
      updatedAt: data.updatedAt || null
    };
  } catch {
    return null;
  }
}

function saveTargetConfig({ groupName, memberName, groupId, memberId }) {
  const data = {
    groupName: groupName.trim(),
    memberName: memberName.trim(),
    groupId: groupId?.trim() || null,
    memberId: memberId?.trim() || null,
    updatedAt: new Date().toISOString()
  };
  fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(data, null, 2)}\n`);
  return data;
}

function getEffectiveTargets({ groupName, memberName, groupId, userId }) {
  if (groupName?.trim() && memberName?.trim()) {
    return {
      groupName: groupName.trim(),
      memberName: memberName.trim(),
      source: 'env'
    };
  }

  const saved = loadTargetConfig();
  if (saved) {
    return {
      groupName: saved.groupName,
      memberName: saved.memberName,
      groupId: saved.groupId,
      memberId: saved.memberId,
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
      memberName: '',
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

  if (targets.groupName && targets.memberName) {
    return {
      groupName: targets.groupName,
      memberName: targets.memberName,
      groupId: targets.groupId || env.groupId?.trim() || '',
      memberId: targets.memberId || env.userId?.trim() || '',
      userId: env.userId?.trim() || ''
    };
  }

  return { groupId: targets.groupId, userId: targets.userId };
}

function hasConfiguredTargets(env) {
  return Boolean(getEffectiveTargets(env));
}

module.exports = {
  loadTargetConfig,
  saveTargetConfig,
  getEffectiveTargets,
  getTargetInput,
  hasConfiguredTargets
};
