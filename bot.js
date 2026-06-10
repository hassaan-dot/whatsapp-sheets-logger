require('dotenv').config();

const fs = require('fs');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const axios = require('axios');
const { MessageDedup } = require('./dedup');
const { createSetupServer } = require('./setup-server');
const { isAnyTargetMember, resolveTargets } = require('./resolve-targets');
const { syncWhatsAppCatalog, listGroups, listGroupMembers } = require('./whatsapp-catalog');
const {
  saveTargetConfig,
  clearTargetConfig,
  memberLabels,
  getEffectiveTargets,
  getTargetInput,
  hasConfiguredTargets
} = require('./target-config');

const TARGET_GROUP_ID = process.env.TARGET_GROUP_ID;
const TARGET_USER_ID = process.env.TARGET_USER_ID;
const TARGET_GROUP_NAME = process.env.TARGET_GROUP_NAME;
const TARGET_MEMBER_NAME = process.env.TARGET_MEMBER_NAME;
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const DISCOVERY_MODE = process.env.DISCOVERY_MODE === 'true';
const SETUP_TOKEN = process.env.SETUP_TOKEN;
const SETUP_PORT = Number(process.env.SETUP_PORT) || 3099;
const SERVER_IP = process.env.SERVER_IP?.trim() || '';

function getSetupPageUrl() {
  const host = SERVER_IP || 'localhost';
  return `http://${host}:${SETUP_PORT}/setup?token=${encodeURIComponent(SETUP_TOKEN || '')}`;
}

const seenMessages = new MessageDedup();

let setupServer = null;
let activeGroupId = null;
let activeMembers = [];
let clientReady = false;
let targetsResolved = false;
let isResettingSession = false;
let applyTargetsInProgress = false;
let authenticatedLogged = false;
let applyTargetsRef = null;
let groupsCache = null;
let groupsCacheAt = 0;
let groupsLoadPromise = null;
let syncCatalogPromise = null;
const membersLoadPromises = new Map();
const membersCache = new Map();

const PUPPETEER_TIMEOUT_MS = Number(process.env.PUPPETEER_TIMEOUT_MS) || 600000;
const GROUPS_CACHE_MS = 5 * 60 * 1000;
const LOGOUT_DESTROY_TIMEOUT_MS = 5000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry(fn, { attempts = 3, delayMs = 5000, label = 'operation' } = {}) {
  let lastError;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (!isRecoverableInitError(err) || i === attempts) throw err;
      log(`${label} failed (attempt ${i}/${attempts}): ${err.message}. Retrying...`);
      await sleep(delayMs);
    }
  }
  throw lastError;
}

function log(...args) {
  const ts = new Date().toISOString();
  const text = args
    .map((arg) => {
      if (typeof arg === 'string') return arg;
      if (arg instanceof Error) return arg.message;
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    })
    .join(' ');
  const line = `[${ts}] ${text}`;
  console.log(`[${ts}]`, ...args);
  setupServer?.appendLog(line);
}

const envTargets = () => ({
  groupName: TARGET_GROUP_NAME,
  memberName: TARGET_MEMBER_NAME,
  groupId: TARGET_GROUP_ID,
  userId: TARGET_USER_ID
});

function hasNameTargets() {
  return Boolean(TARGET_GROUP_NAME?.trim() && TARGET_MEMBER_NAME?.trim());
}

function hasIdTargets() {
  return Boolean(
    TARGET_GROUP_ID?.trim() &&
      !TARGET_GROUP_ID.includes('xxxxx') &&
      TARGET_USER_ID?.trim() &&
      !TARGET_USER_ID.includes('xxxxx')
  );
}

setupServer = SETUP_TOKEN
  ? createSetupServer({
      port: SETUP_PORT,
      token: SETUP_TOKEN,
      serverIp: SERVER_IP,
      getTargets: () => getEffectiveTargets(envTargets()),
      isWhatsAppReady: () => clientReady,
      onSyncCatalog: async () => {
        if (!clientReady) throw new Error('WhatsApp is not connected yet.');

        if (syncCatalogPromise) {
          log('Sync already in progress — please wait...');
          return syncCatalogPromise;
        }

        syncCatalogPromise = (async () => {
          try {
            log('Syncing groups from WhatsApp (this may take ~10 seconds)...');
            groupsCache = null;
            groupsCacheAt = 0;
            groupsLoadPromise = null;
            membersLoadPromises.clear();
            membersCache.clear();

            await syncWhatsAppCatalog(client);
            await sleep(6000);
            log('Sync complete. Reload groups to see new ones.');
            return { ok: true };
          } finally {
            syncCatalogPromise = null;
          }
        })();

        return syncCatalogPromise;
      },
      onListGroups: async ({ refresh = false } = {}) => {
        if (!clientReady) return { ready: false, groups: [] };

        const now = Date.now();
        if (!refresh && groupsCache && now - groupsCacheAt < GROUPS_CACHE_MS) {
          return { ready: true, groups: groupsCache };
        }

        if (groupsLoadPromise) {
          log('Group list already loading — please wait...');
          return groupsLoadPromise;
        }

        groupsLoadPromise = (async () => {
          try {
            log('Loading WhatsApp groups (fast scan)...');
            const groups = await withRetry(() => listGroups(client), {
              label: 'Load groups',
              attempts: 2,
              delayMs: 5000
            });
            groupsCache = groups;
            groupsCacheAt = Date.now();
            log(`Loaded ${groups.length} group(s).`);
            return { ready: true, groups };
          } finally {
            groupsLoadPromise = null;
          }
        })();

        return groupsLoadPromise;
      },
      onListMembers: async (groupId, { refresh = false } = {}) => {
        if (!clientReady) throw new Error('WhatsApp is not connected yet.');

        const cached = membersCache.get(groupId);
        if (!refresh && cached && Date.now() - cached.at < GROUPS_CACHE_MS) {
          return cached.members;
        }

        if (membersLoadPromises.has(groupId)) {
          log('Member list already loading — please wait...');
          return membersLoadPromises.get(groupId);
        }

        const loadPromise = (async () => {
          try {
            log('Loading members (fast scan)...');
            const members = await listGroupMembers(client, groupId);
            membersCache.set(groupId, { members, at: Date.now() });
            log(`Loaded ${members.length} member(s).`);
            return members;
          } finally {
            membersLoadPromises.delete(groupId);
          }
        })();

        membersLoadPromises.set(groupId, loadPromise);
        return loadPromise;
      },
      onSaveTargets: async (groupName, groupId, members) => {
        saveTargetConfig({ groupName, groupId, members });
        const labels = memberLabels(members);
        log(`Targets saved: group="${groupName}", members="${labels}"`);

        let warning = null;
        if (hasNameTargets()) {
          warning =
            'Saved, but .env names take priority. Update TARGET_GROUP_NAME / TARGET_MEMBER_NAME in .env and restart.';
          log(`Note: ${warning}`);
        }

        if (clientReady && applyTargetsRef) {
          targetsResolved = false;
          const result = await applyTargetsRef();
          targetsResolved = true;
          return { ...result, warning };
        }

        log('Targets will apply when WhatsApp is connected.');
        return { monitoring: null, warning };
      },
      onClearTargets: async () => {
        clearTargetConfig();
        activeGroupId = null;
        activeMembers = [];
        targetsResolved = false;
        log('Targets cleared. Monitoring stopped.');
        setupServer?.setWaitingTargets();
        return { monitoring: null };
      },
      onLogout: async () => {
        if (isResettingSession) return;
        isResettingSession = true;

        clientReady = false;
        targetsResolved = false;
        activeGroupId = null;
        activeMembers = [];
        groupsCache = null;
        groupsCacheAt = 0;
        groupsLoadPromise = null;
        syncCatalogPromise = null;
        membersLoadPromises.clear();
        membersCache.clear();

        clearTargetConfig();
        setupServer?.clearSessionState('Clearing session…');
        log('Clearing local session (skipping slow remote logout)…');

        const destroyPromise = client.destroy().catch((err) => {
          log('Destroy note:', err.message);
        });
        await Promise.race([destroyPromise, sleep(LOGOUT_DESTROY_TIMEOUT_MS)]);

        clearAuthSession();
        authenticatedLogged = false;

        log('Session cleared. Generating new QR code...');
        setupServer?.setStarting('Starting fresh — QR coming soon…');

        try {
          await initializeClient();
        } finally {
          isResettingSession = false;
        }
      }
    })
  : null;

function getChromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    process.platform === 'darwin'
      ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
      : null,
    process.platform === 'linux' ? '/usr/bin/google-chrome' : null,
    process.platform === 'linux' ? '/usr/bin/chromium-browser' : null
  ].filter(Boolean);

  return candidates.find((path) => fs.existsSync(path));
}

function validateConfig() {
  if (!DISCOVERY_MODE) {
    if (!hasConfiguredTargets(envTargets()) && !SETUP_TOKEN) {
      log('ERROR: Set TARGET_GROUP_NAME + TARGET_MEMBER_NAME, or TARGET_GROUP_ID + TARGET_USER_ID in .env');
      log('       (or set SETUP_TOKEN and configure targets on the setup page)');
      process.exit(1);
    }
    if (!WEBHOOK_URL || WEBHOOK_URL.includes('xxxxx')) {
      log('ERROR: Set WEBHOOK_URL in .env');
      process.exit(1);
    }
  }
}

async function sendToSheets(payload) {
  const response = await axios.post(WEBHOOK_URL, payload, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 30000,
    maxRedirects: 5,
    validateStatus: () => true
  });

  if (response.status >= 400) {
    throw new Error(`Webhook HTTP ${response.status}: ${String(response.data).slice(0, 200)}`);
  }

  if (typeof response.data === 'string' && response.data.includes('<!DOCTYPE html>')) {
    throw new Error('Webhook returned HTML instead of JSON — redeploy Apps Script as Web app with doPost');
  }

  return typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
}

const MESSAGE_TYPE_LABELS = {
  ptt: 'voice message',
  audio: 'voice message',
  image: 'image',
  video: 'video',
  sticker: 'sticker',
  document: 'document',
  location: 'location',
  vcard: 'contact'
};

function formatMessageType(type) {
  return MESSAGE_TYPE_LABELS[type] || type || '';
}

function formatMessageText(message) {
  const body = message.body?.trim();
  if (body) return body;
  return formatMessageType(message.type) || `[${message.type}]`;
}

function buildPayload(message, contact) {
  const now = new Date();
  const senderId = message.author || message.from;

  return {
    date: now.toISOString().split('T')[0],
    time: now.toLocaleTimeString('en-US', { hour12: false }),
    sender: contact?.pushname || contact?.name || message._data?.notifyName || 'Unknown',
    phone: senderId,
    message: formatMessageText(message),
    type: formatMessageType(message.type),
    id: message.id.id
  };
}

const chromePath = getChromePath();
if (chromePath) {
  log(`Using Chrome at: ${chromePath}`);
}

function clearAuthSession() {
  for (const dir of ['.wwebjs_auth', '.wwebjs_cache']) {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
}

function isRecoverableInitError(err) {
  const msg = String(err?.message || err);
  return (
    msg.includes('timed out') ||
    msg.includes('Timeout') ||
    msg.includes('Execution context was destroyed') ||
    msg.includes('Protocol error')
  );
}

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: '.wwebjs_auth' }),
  puppeteer: {
    headless: true,
    timeout: PUPPETEER_TIMEOUT_MS,
    protocolTimeout: PUPPETEER_TIMEOUT_MS,
    ...(chromePath ? { executablePath: chromePath } : {}),
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--disable-extensions',
      ...(process.platform === 'linux' ? ['--no-zygote'] : []),
      '--disable-gpu'
    ]
  }
});

client.on('loading_screen', (percent, message) => {
  log(`Loading WhatsApp: ${percent}% — ${message}`);
  setupServer?.setStarting(`Loading WhatsApp ${percent}%…`);
});

client.on('qr', (qr) => {
  if (setupServer) {
    setupServer.setQr(qr);
    log(`QR code ready — open: ${getSetupPageUrl()}`);
  } else {
    log('Scan this QR code with WhatsApp on your phone:');
    qrcode.generate(qr, { small: true });
  }
});

client.on('authenticated', () => {
  if (!authenticatedLogged) {
    log('Authenticated successfully. Session saved locally.');
    authenticatedLogged = true;
  }
  setupServer?.setAuthenticated();
});

client.on('auth_failure', (msg) => {
  log('Authentication failed:', msg);
  setupServer?.setError(`Authentication failed: ${msg}`);
});

async function applyTargets() {
  if (DISCOVERY_MODE) return { monitoring: null };
  if (applyTargetsInProgress) return { monitoring: null };

  applyTargetsInProgress = true;
  try {
    const input = getTargetInput(envTargets());
    const members = input?.members || [];
    const hasNames = Boolean(input?.groupName && members.length);

    if (!input || (!hasNames && !input.groupId)) {
      activeGroupId = null;
      activeMembers = [];
      log('No targets configured. Set group and member on the setup page.');
      setupServer?.setWaitingTargets();
      return { monitoring: null };
    }

    const hasSavedIds = Boolean(
      input.groupId && members.some((member) => member.id)
    );
    if (!hasSavedIds) {
      log('Applying targets (waiting for WhatsApp to finish syncing)...');
      await sleep(5000);
    } else {
      log('Applying targets...');
    }

    const resolveInput = {
      ...input,
      memberName: members.map((member) => member.name).join(', ')
    };
    const resolved = await withRetry(() => resolveTargets(client, resolveInput), {
      label: 'Resolve targets'
    });

    activeGroupId = resolved.groupId;
    if (members.length) {
      activeMembers = members.map((member) => ({
        id: member.id || null,
        name: member.name || ''
      }));
    } else if (resolved.userId) {
      activeMembers = [{ id: resolved.userId, name: '' }];
    } else {
      activeMembers = [];
    }

    const memberLabel = memberLabels(activeMembers);

    log(`Monitoring group:   ${resolved.groupLabel}`);
    log(`Filtering members: ${memberLabel}`);
    log(`Webhook:           ${WEBHOOK_URL}`);

    const monitoring = {
      group: resolved.groupLabel,
      member: memberLabel
    };
    setupServer?.setMonitoring(monitoring);
    setupServer?.setReady(`Connected. Monitoring ${memberLabel}.`);
    return { monitoring };
  } finally {
    applyTargetsInProgress = false;
  }
}

applyTargetsRef = applyTargets;

client.on('ready', async () => {
  if (isResettingSession) return;

  log('WhatsApp client is ready.');
  clientReady = true;

  if (DISCOVERY_MODE) {
    log('DISCOVERY MODE: Listening for messages to print group/user IDs...');
    log('Send a message in your target group, then copy the IDs from the console.');
    setupServer?.setReady('Discovery mode — send a message in a group to see IDs.');
    return;
  }

  if (targetsResolved) return;

  try {
    await applyTargets();
    targetsResolved = true;
  } catch (err) {
    log('ERROR resolving targets:', err.message);
    setupServer?.setReady(`Connected, but target setup failed: ${err.message}. Fix names and click Save.`);
  }
});

client.on('disconnected', (reason) => {
  log('Client disconnected:', reason);
  clientReady = false;
  targetsResolved = false;
  activeGroupId = null;
  activeMembers = [];
  setupServer?.clearSessionState('Disconnected. Scan QR to reconnect.');
});

client.on('message', async (message) => {
  try {
    if (DISCOVERY_MODE) {
      if (message.from?.endsWith('@g.us')) {
        const senderId = message.author || message.from;
        log('--- DISCOVERY ---');
        log(`Group ID:   ${message.from}`);
        log(`Sender:     ${message._data?.notifyName || 'Unknown'}`);
        log(`User ID:    ${senderId}`);
        log('-----------------');
      }
      return;
    }

    if (!activeGroupId) return;

    // 1. Group filter (no getChat — faster, fewer timeouts)
    if (message.from !== activeGroupId) return;

    // 2. Member filter (by WhatsApp ID and/or display name)
    const senderId = message.author || message.from;
    const displayName = message._data?.notifyName || message._data?.notify_name || '';

    if (!isAnyTargetMember(senderId, displayName, activeMembers)) {
      log(`Skipped in ${activeGroupId}: "${displayName || 'Unknown'}" (${senderId})`);
      return;
    }

    // 3. Deduplication
    const msgId = message.id.id;
    if (seenMessages.has(msgId)) return;
    seenMessages.add(msgId);

    // 4. Build payload
    let contact = null;
    try {
      contact = await message.getContact();
    } catch {
      log('Contact lookup skipped (using message name instead).');
    }
    const payload = buildPayload(message, contact);

    // 5. Send to Google Sheets
    log(`Logging message from ${payload.sender}: ${payload.message.substring(0, 50)}...`);
    const result = await sendToSheets(payload);
    seenMessages.flush();

    if (result?.status === 'duplicate') {
      log('Sheet reported duplicate, skipped.');
    } else {
      log('Message logged to Google Sheets.');
    }
  } catch (err) {
    log('Error processing message:', err.message);
  }
});

validateConfig();

async function initializeClient() {
  try {
    await client.initialize();
  } catch (err) {
    if (!isRecoverableInitError(err)) throw err;

    log('WhatsApp startup failed — clearing saved session and retrying...');
    log(`Reason: ${err.message}`);
    setupServer?.setStarting('Clearing old session… QR will appear shortly.');

    try {
      await client.destroy();
    } catch (_) {}

    clearAuthSession();
    await client.initialize();
  }
}

async function main() {
  if (setupServer) {
    await setupServer.start();
  }

  log('Starting WhatsApp Sheets Logger...');
  setupServer?.setStarting('Starting WhatsApp client…');
  await initializeClient();
}

main().catch((err) => {
  log('Failed to start:', err.message);
  setupServer?.setError(
    `Failed to start: ${err.message}. Click "Log out & show new QR" or run: rm -rf .wwebjs_auth .wwebjs_cache`
  );
});

async function shutdown() {
  seenMessages.flush();
  setupServer?.close();
  await client.destroy();
  process.exit(0);
}

process.on('SIGINT', async () => {
  log('Shutting down...');
  await shutdown();
});

process.on('SIGTERM', async () => {
  await shutdown();
});
