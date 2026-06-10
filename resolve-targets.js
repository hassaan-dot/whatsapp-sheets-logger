function normalizeName(value) {
  return String(value || '').trim().toLowerCase();
}

function contactDisplayName(contact) {
  return contact?.pushname || contact?.name || contact?.number || '';
}

async function resolveGroupByName(client, groupName) {
  const chats = await client.getChats();
  const groups = chats.filter(
    (chat) => chat.isGroup && normalizeName(chat.name) === normalizeName(groupName)
  );

  if (groups.length === 0) {
    const available = chats
      .filter((chat) => chat.isGroup)
      .map((chat) => chat.name)
      .filter(Boolean)
      .slice(0, 25);
    throw new Error(
      `Group not found: "${groupName}".` +
        (available.length
          ? ` Available groups: ${available.join(', ')}`
          : ' No groups found on this account.')
    );
  }

  if (groups.length > 1) {
    throw new Error(
      `Multiple groups named "${groupName}". Set TARGET_GROUP_ID in .env to pick one.`
    );
  }

  return {
    groupId: groups[0].id._serialized,
    groupName: groups[0].name
  };
}

async function findMemberInGroup(client, groupId, memberName) {
  const chat = await client.getChatById(groupId);
  if (!chat.isGroup) {
    throw new Error(`Chat ${groupId} is not a group.`);
  }

  const matches = [];
  for (const participant of chat.participants) {
    const contact = await client.getContactById(participant.id._serialized);
    const displayName = contactDisplayName(contact);
    if (normalizeName(displayName) === normalizeName(memberName)) {
      matches.push({
        userId: participant.id._serialized,
        memberName: displayName
      });
    }
  }

  return matches;
}

async function resolveTargets(client, { groupId, userId, groupName, memberName }) {
  const useNames = Boolean(groupName?.trim() && memberName?.trim());

  if (useNames) {
    const name = groupName.trim();
    const member = memberName.trim();

    // Fast path: use group ID from .env — avoids slow getChats() scan
    if (groupId?.trim() && !groupId.includes('xxxxx')) {
      return {
        groupId: groupId.trim(),
        userId: userId?.trim() || null,
        groupLabel: `${name} (${groupId.trim()})`,
        memberLabel: member,
        filterByMemberName: true
      };
    }

    const group = await resolveGroupByName(client, name);

    return {
      groupId: group.groupId,
      userId: null,
      groupLabel: `${group.groupName} (${group.groupId})`,
      memberLabel: member,
      filterByMemberName: true
    };
  }

  if (!groupId?.trim() || groupId.includes('xxxxx')) {
    throw new Error('Set TARGET_GROUP_NAME + TARGET_MEMBER_NAME, or TARGET_GROUP_ID in .env');
  }
  if (!userId?.trim() || userId.includes('xxxxx')) {
    throw new Error('Set TARGET_GROUP_NAME + TARGET_MEMBER_NAME, or TARGET_USER_ID in .env');
  }

  return {
    groupId: groupId.trim(),
    userId: userId.trim(),
    groupLabel: groupId.trim(),
    memberLabel: userId.trim(),
    filterByMemberName: false
  };
}

module.exports = {
  normalizeName,
  contactDisplayName,
  resolveTargets,
  findMemberInGroup
};
