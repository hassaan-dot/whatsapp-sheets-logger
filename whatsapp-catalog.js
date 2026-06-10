const { contactDisplayName } = require('./resolve-targets');

async function listGroupsFast(client) {
  if (!client.pupPage) {
    throw new Error('WhatsApp page is not ready.');
  }

  return client.pupPage.evaluate(() => {
    const chats = window.require('WAWebCollections').Chat.getModelsArray();
    const groups = [];

    for (const chat of chats) {
      const id = chat.id?._serialized;
      if (!id || !id.endsWith('@g.us')) continue;
      const name =
        chat.formattedTitle ||
        chat.name ||
        chat.formattedName ||
        chat.contact?.pushname ||
        'Unnamed group';
      groups.push({ id, name });
    }

    return groups.sort((a, b) => a.name.localeCompare(b.name));
  });
}

async function listGroupMembersFast(client, groupId) {
  if (!client.pupPage) {
    throw new Error('WhatsApp page is not ready.');
  }

  const members = await client.pupPage.evaluate((gid) => {
    const collections = window.require('WAWebCollections');
    const Contact = collections.Contact;
    const chat = collections.Chat.get(gid);
    if (!chat?.groupMetadata) {
      throw new Error('Group not found.');
    }

    const participants = chat.groupMetadata.participants?.getModelsArray
      ? chat.groupMetadata.participants.getModelsArray()
      : [];

    const results = [];
    for (const participant of participants) {
      const id = participant.id?._serialized;
      if (!id) continue;

      const contact = participant.contact || (Contact ? Contact.get(id) : null);
      const name =
        contact?.pushname ||
        contact?.name ||
        contact?.verifiedName ||
        contact?.formattedName ||
        participant.__x_displayName ||
        id.split('@')[0] ||
        id;

      results.push({ id, name });
    }

    return results.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }, groupId);

  if (members.length > 0) {
    return members;
  }

  return client.pupPage.evaluate(async (gid) => {
    const collections = window.require('WAWebCollections');
    const chat = collections.Chat.get(gid);
    if (!chat?.groupMetadata) {
      throw new Error('Group not found.');
    }

    const wid = window.require('WAWebWidFactory').createWid(gid);
    const GroupMetadata =
      collections.GroupMetadata || collections.WAWebGroupMetadataCollection;
    await GroupMetadata.update(wid);

    const participants = chat.groupMetadata.participants?.getModelsArray
      ? chat.groupMetadata.participants.getModelsArray()
      : [];

    return participants
      .map((p) => {
        const id = p.id?._serialized;
        const contact = p.contact || collections.Contact?.get(id);
        const name =
          contact?.pushname ||
          contact?.name ||
          contact?.verifiedName ||
          id?.split('@')[0] ||
          id;
        return { id, name };
      })
      .filter((p) => p.id)
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }, groupId);
}

async function listGroups(client) {
  try {
    return await listGroupsFast(client);
  } catch (err) {
    const chats = await client.getChats();
    return chats
      .filter((chat) => chat.isGroup)
      .map((chat) => ({
        id: chat.id._serialized,
        name: chat.name || 'Unnamed group'
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
}

async function listGroupMembers(client, groupId) {
  try {
    return await listGroupMembersFast(client, groupId);
  } catch (err) {
    const chat = await client.getChatById(groupId);
    if (!chat.isGroup) {
      throw new Error('Selected chat is not a group.');
    }

    const members = [];
    for (const participant of chat.participants) {
      try {
        const contact = await client.getContactById(participant.id._serialized);
        members.push({
          id: participant.id._serialized,
          name: contactDisplayName(contact) || participant.id.user || participant.id._serialized
        });
      } catch {
        members.push({
          id: participant.id._serialized,
          name: participant.id.user || participant.id._serialized
        });
      }
    }

    return members.sort((a, b) => a.name.localeCompare(b.name));
  }
}

module.exports = { listGroups, listGroupMembers };
