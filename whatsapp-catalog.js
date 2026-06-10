const { contactDisplayName } = require('./resolve-targets');

async function syncWhatsAppCatalog(client) {
  if (!client.pupPage) {
    throw new Error('WhatsApp page is not ready.');
  }

  await client.pupPage.evaluate(async () => {
    const safeRequire = (name) => {
      try {
        return window.require(name);
      } catch {
        return null;
      }
    };

    const tryCall = async (obj, ...names) => {
      if (!obj) return false;
      for (const name of names) {
        if (typeof obj[name] !== 'function') continue;
        try {
          await obj[name]();
          return true;
        } catch (_) {}
      }
      return false;
    };

    const loadModules = [
      'WAWebLoadChatTableStateAction',
      'WAWebChatLoadRecentStateAction',
      'WAWebRecentChatListAction'
    ];
    for (const modName of loadModules) {
      const mod = safeRequire(modName);
      await tryCall(mod, 'loadChatTable', 'loadRecentChats', 'load', 'sync');
    }

    const sendReq = safeRequire('WAWebSendNonMessageDataRequest');
    if (sendReq?.sendPeerDataOperationRequest) {
      try {
        await sendReq.sendPeerDataOperationRequest(1, {});
      } catch (_) {}
    }

    const GroupQuery = safeRequire('WAWebGroupQueryJob');
    const Chat = safeRequire('WAWebCollections')?.Chat;
    if (GroupQuery?.queryAndUpdateGroupMetadataById && Chat) {
      const groups = Chat.getModelsArray().filter((c) =>
        c.id?._serialized?.endsWith('@g.us')
      );
      for (const chat of groups.slice(0, 30)) {
        try {
          await GroupQuery.queryAndUpdateGroupMetadataById({
            id: chat.id._serialized
          });
        } catch (_) {}
      }
    }
  });
}

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

  return client.pupPage.evaluate(async (gid) => {
    const collections = window.require('WAWebCollections');
    const Contact = collections.Contact;
    const WidFactory = window.require('WAWebWidFactory');
    const chat =
      collections.Chat.get(gid) ||
      (await collections.Chat.find(WidFactory.createWid(gid)));
    if (!chat?.groupMetadata) {
      throw new Error('Group not found.');
    }

    const GroupMetadata =
      collections.GroupMetadata || collections.WAWebGroupMetadataCollection;
    try {
      await GroupMetadata.update(WidFactory.createWid(gid));
    } catch (_) {}

    let ContactMethods = null;
    let toPn = null;
    try {
      ContactMethods = window.require('WAWebContactGetters');
    } catch (_) {}
    try {
      toPn = window.require('WAWebLidMigrationUtils')?.toPn;
    } catch (_) {}

    const isPhoneOnly = (name, id) => {
      const raw = String(name || '').trim().replace(/^\+/, '');
      const user = String(id || '').split('@')[0];
      if (!raw) return true;
      if (/^\d{8,}$/.test(raw)) return true;
      return raw === user && /^\d+$/.test(user);
    };

    const nameFromContact = (contact) => {
      if (!contact) return '';
      if (ContactMethods) {
        return (
          ContactMethods.getPushname(contact) ||
          ContactMethods.getName(contact) ||
          ContactMethods.getShortName(contact) ||
          ContactMethods.getVerifiedName(contact) ||
          ''
        ).trim();
      }
      return (
        contact.pushname ||
        contact.name ||
        contact.shortName ||
        contact.verifiedName ||
        contact.formattedName ||
        ''
      ).trim();
    };

    const phoneFallback = (id) => {
      const user = String(id).split('@')[0];
      return /^\d+$/.test(user) ? `+${user}` : user;
    };

    const resolveSync = (participant) => {
      const id = participant.id?._serialized;
      if (!id) return null;

      let contact =
        participant.contact ||
        (Contact ? Contact.get(participant.id) || Contact.get(id) : null);

      let name = nameFromContact(contact);
      if (!name && participant.__x_displayName) {
        name = String(participant.__x_displayName).trim();
      }

      if (!name && toPn) {
        const phoneWid = toPn(participant.id);
        const phoneId = phoneWid?._serialized;
        if (phoneId && phoneId !== id) {
          contact = Contact?.get(phoneWid) || Contact?.get(phoneId);
          name = nameFromContact(contact);
        }
      }

      if (!name) name = phoneFallback(id);
      return { id, name, needsLookup: isPhoneOnly(name, id) };
    };

    const participants = chat.groupMetadata.participants?.getModelsArray
      ? chat.groupMetadata.participants.getModelsArray()
      : [];

    const results = [];
    const lookupQueue = [];

    for (const participant of participants) {
      const row = resolveSync(participant);
      if (!row) continue;
      if (row.needsLookup) lookupQueue.push(row);
      else results.push({ id: row.id, name: row.name });
    }

    const resolveOne = async (row) => {
      let name = row.name;
      try {
        const contact = await Contact.find(WidFactory.createWid(row.id));
        const resolved = nameFromContact(contact);
        if (resolved && !isPhoneOnly(resolved, row.id)) {
          name = resolved;
        }
      } catch (_) {}

      if (isPhoneOnly(name, row.id) && toPn) {
        try {
          const phoneWid = toPn(WidFactory.createWid(row.id));
          if (phoneWid) {
            const contact = await Contact.find(phoneWid);
            const resolved = nameFromContact(contact);
            if (resolved && !isPhoneOnly(resolved, row.id)) {
              name = resolved;
            }
          }
        } catch (_) {}
      }

      return { id: row.id, name };
    };

    const BATCH = 8;
    for (let i = 0; i < lookupQueue.length; i += BATCH) {
      const batch = lookupQueue.slice(i, i + BATCH);
      const resolved = await Promise.all(batch.map(resolveOne));
      results.push(...resolved);
    }

    return results.sort((a, b) => String(a.name).localeCompare(String(b.name)));
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

module.exports = { syncWhatsAppCatalog, listGroups, listGroupMembers };
