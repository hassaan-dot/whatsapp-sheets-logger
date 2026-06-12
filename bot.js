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
  saveAllTargetConfigs,
  clearTargetConfig,
  memberLabels,
  getEffectiveTargets,
  getAllTargetInputs,
  hasConfiguredTargets,
  maskWebhookUrl
} = require('./target-config');
const userConfig = require('./user-config');

const TARGET_GROUP_ID = process.env.TARGET_GROUP_ID;
const TARGET_USER_ID = process.env.TARGET_USER_ID;
const TARGET_GROUP_NAME = process.env.TARGET_GROUP_NAME;
const TARGET_MEMBER_NAME = process.env.TARGET_MEMBER_NAME;
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const DISCOVERY_MODE = process.env.DISCOVERY_MODE === 'true';
const SETUP_TOKEN = process.env.SETUP_TOKEN;
const SETUP_PORT = Number(process.env.SETUP_PORT) || 3099;
const SERVER_IP = process.env.SERVER_IP?.trim() || '';
const TIMEZONE = userConfig.TIMEZONE || 'Asia/Karachi';

function getSetupPageUrl() {
  const host = SERVER_IP || 'localhost';
  return `http://${host}:${SETUP_PORT}/setup?token=${encodeURIComponent(SETUP_TOKEN || '')}`;
}

const seenMessages = new MessageDedup();

let setupServer = null;
let activeTargets = [];
let clientReady = false;
let targetsResolved = false;
let isResettingSession = false;
let applyTargetsInProgress = false;
let authenticatedLogged = false;
let hasAuthenticated = false;
let lastQrPayload = null;
let syncTimeout = null;
let applyTargetsRef = null;
let groupsCache = null;
let groupsCacheAt = 0;
let groupsLoadPromise = null;
let syncCatalogPromise = null;
const membersLoadPromises = new Map();
const membersCache = new Map();

const PUPPETEER_TIMEOUT_MS = Number(process.env.PUPPETEER_TIMEOUT_MS) || 600000;
const GROUPS_CACHE_MS = 5 * 60 * 1000;
const LOGOUT_REMOTE_TIMEOUT_MS = 25000;
const LOGOUT_FAST_TIMEOUT_MS = Number(process.env.LOGOUT_FAST_TIMEOUT_MS) || 4000;
const LOGOUT_DESTROY_TIMEOUT_MS = 5000;
const SYNC_TIMEOUT_MS = Number(process.env.SYNC_TIMEOUT_MS) || 180000;
const QUOTED_LOOKUP_TIMEOUT_MS = Number(process.env.QUOTED_LOOKUP_TIMEOUT_MS) || 8000;
const QUOTED_TEXT_MAX_LEN = 500;

function clearSyncTimeout() {
  if (syncTimeout) {
    clearTimeout(syncTimeout);
    syncTimeout = null;
  }
}

function startSyncTimeout() {
  clearSyncTimeout();
  syncTimeout = setTimeout(() => {
    if (clientReady || isResettingSession) return;
    log('Connection timed out after QR scan. Try logging out and scanning again.');
    setupServer?.setError(
      'Sync timed out after scanning. Click "Log out & show new QR" and scan again.'
    );
  }, SYNC_TIMEOUT_MS);
}

function resetAuthState() {
  authenticatedLogged = false;
  hasAuthenticated = false;
  lastQrPayload = null;
  clearSyncTimeout();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isBrowserClosedError(err) {
  const msg = String(err?.message || err);
  return (
    msg.includes('Target closed') ||
    msg.includes('Session closed') ||
    msg.includes('Protocol error') ||
    msg.includes('Execution context was destroyed') ||
    msg.includes('browser has disconnected')
  );
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
      getWhatsAppUser: () => getWhatsAppUser(),
      onPollSync: () => recoverConnectionStateIfNeeded(),
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
      onSaveAllTargets: async (targets) => {
        const saved = saveAllTargetConfigs(targets);
        log(`Saved ${saved.length} configuration(s).`);
        for (const item of saved) {
          log(
            `  • ${item.groupName} → ${memberLabels(item.members)} → ${maskWebhookUrl(item.webhookUrl || WEBHOOK_URL)}`
          );
        }

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
          return { ...result, warning, targets: saved };
        }

        log('Configurations will apply when WhatsApp is connected.');
        return { monitoring: null, warning, targets: saved };
      },
      onClearTargets: async () => {
        clearTargetConfig();
        activeTargets = [];
        targetsResolved = false;
        log('All configurations cleared. Monitoring stopped.');
        setupServer?.setWaitingTargets();
        return { monitoring: null };
      },
      getDefaultWebhookUrl: () => WEBHOOK_URL || '',
      onLogout: async ({ fast = false } = {}) => performSessionReset({ fast })
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

async function sendToSheets(payload, webhookUrl = WEBHOOK_URL) {
  const url = webhookUrl || WEBHOOK_URL;
  if (!url || url.includes('xxxxx')) {
    throw new Error('No Google Sheet webhook URL configured for this group.');
  }

  const response = await axios.post(url, payload, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 30000,
    maxRedirects: 5,
    validateStatus: () => true
  });

  if (response.status >= 400) {
    const hint =
      response.status === 401
        ? ' Redeploy Apps Script: Deploy → New deployment → Web app → Execute as Me → Who has access: Anyone.'
        : '';
    throw new Error(`Webhook HTTP ${response.status}: ${String(response.data).slice(0, 200)}.${hint}`);
  }

  if (typeof response.data === 'string' && response.data.includes('<!DOCTYPE html>')) {
    throw new Error(
      'Webhook returned HTML instead of JSON — redeploy Apps Script as Web app (Execute as Me, Anyone) and paste the new /exec URL.'
    );
  }

  return typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
}

function resolveMessageSenderId(message) {
  if (message.author) return message.author;
  const from = message.from || '';
  return from.endsWith('@g.us') ? '' : from;
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

function truncateText(text, max = QUOTED_TEXT_MAX_LEN) {
  const value = String(text || '');
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

function formatInTimezone(value, timeZone = TIMEZONE) {
  const date = value instanceof Date ? value : new Date(value);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(date);

  const get = (type) => parts.find((part) => part.type === type)?.value || '00';
  const dateStr = `${get('year')}-${get('month')}-${get('day')}`;
  const timeStr = `${get('hour')}:${get('minute')}:${get('second')}`;
  return { date: dateStr, time: timeStr, loggedAt: `${dateStr} ${timeStr}` };
}

function formatMessageTimestamp(message) {
  const seconds = Number(message.timestamp);
  const date = Number.isFinite(seconds) ? new Date(seconds * 1000) : new Date();
  return formatInTimezone(date);
}

function extractGroupName(groupLabel, fallback = '') {
  if (!groupLabel) return fallback;
  const match = String(groupLabel).match(/^(.+?)\s*\([^)]+\)$/);
  return match ? match[1].trim() : String(groupLabel).trim();
}

function joinList(value) {
  if (!value) return '';
  if (Array.isArray(value)) return value.filter(Boolean).join(', ');
  return String(value);
}

function yesNo(value) {
  return value ? 'yes' : 'no';
}

async function resolveQuotedInfo(message) {
  if (!message.hasQuotedMsg) {
    return { isReply: false, replyToMsgId: '', replyToSender: '', replyToText: '' };
  }

  try {
    const quoted = await Promise.race([
      message.getQuotedMessage(),
      sleep(QUOTED_LOOKUP_TIMEOUT_MS).then(() => {
        throw new Error('quoted message lookup timed out');
      })
    ]);

    if (!quoted) {
      return { isReply: true, replyToMsgId: '', replyToSender: '', replyToText: '' };
    }

    let quotedContact = null;
    try {
      quotedContact = await quoted.getContact();
    } catch {
      // use notify name fallback
    }

    const quotedAuthor = quoted.author || quoted.from;
    return {
      isReply: true,
      replyToMsgId: quoted.id?.id || '',
      replyToSender:
        quotedContact?.pushname ||
        quotedContact?.name ||
        quoted._data?.notifyName ||
        quoted._data?.notify_name ||
        quotedAuthor ||
        'Unknown',
      replyToText: truncateText(formatMessageText(quoted))
    };
  } catch (err) {
    log('Quoted message lookup skipped:', err.message);
    return { isReply: true, replyToMsgId: '', replyToSender: '', replyToText: '' };
  }
}

async function buildPayload(message, contact, quotedInfo, target) {
  const senderId = message.author || message.from;
  const { date, time } = formatMessageTimestamp(message);
  const hasMedia = Boolean(message.hasMedia);
  const caption = hasMedia ? message.body?.trim() || '' : '';

  return {
    date,
    time,
    group: target?.groupName || target?.groupId || message.from || '',
    groupId: target?.groupId || message.from || '',
    sender: contact?.pushname || contact?.name || message._data?.notifyName || 'Unknown',
    senderId,
    phone: senderId,
    message: formatMessageText(message),
    type: formatMessageType(message.type),
    id: message.id.id,
    isReply: yesNo(quotedInfo.isReply),
    replyToSender: quotedInfo.replyToSender || '',
    replyToText: quotedInfo.replyToText || '',
    replyToMsgId: quotedInfo.replyToMsgId || '',
    hasMedia: yesNo(hasMedia),
    caption,
    forwarded: yesNo(message.isForwarded),
    links: joinList(message.links),
    mentions: joinList(message.mentionedIds),
    loggedAt: formatInTimezone(new Date()).loggedAt
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

async function unlinkWhatsAppSession(timeoutMs = LOGOUT_REMOTE_TIMEOUT_MS) {
  try {
    const logoutPromise = client.logout().catch((err) => {
      if (isBrowserClosedError(err)) return;
      throw err;
    });
    await Promise.race([
      logoutPromise,
      sleep(timeoutMs).then(() => {
        throw new Error(`Remote logout timed out after ${timeoutMs / 1000}s`);
      })
    ]);
    log('Removed from WhatsApp Linked devices on your phone.');
    return true;
  } catch (err) {
    if (isBrowserClosedError(err)) {
      log('Session already closed (e.g. logged out from your phone).');
      return false;
    }
    log('Remote logout failed:', err.message);
    log('Local session will still be cleared. If the device stays in Linked devices, remove it manually on your phone.');
    return false;
  }
}

async function safeDestroyClient() {
  try {
    await Promise.race([
      client.destroy().catch((err) => {
        if (!isBrowserClosedError(err)) throw err;
      }),
      sleep(LOGOUT_DESTROY_TIMEOUT_MS)
    ]);
  } catch (err) {
    if (!isBrowserClosedError(err)) {
      log('Destroy note:', err.message);
    }
  }
}

function buildMonitoringSummary(targets = activeTargets) {
  return targets.map((target) => ({
    group: target.groupLabel || target.groupName || target.groupId,
    member: memberLabels(target.members),
    sheet: maskWebhookUrl(target.webhookUrl)
  }));
}

function refreshSetupUiState() {
  if (!clientReady || !setupServer) return;

  if (activeTargets.length) {
    const monitoring = buildMonitoringSummary();
    setupServer.setMonitoring(monitoring);
    const label =
      activeTargets.length === 1
        ? memberLabels(activeTargets[0].members)
        : `${activeTargets.length} groups`;
    setupServer.setReady(`Connected. Monitoring ${label}.`);
    return;
  }

  if (monitoringFromConfig()) return;
  setupServer.setWaitingTargets();
}

function monitoringFromConfig() {
  const inputs = getAllTargetInputs(envTargets(), WEBHOOK_URL).filter(
    (input) => input.groupName && input.members?.length
  );
  if (!inputs.length) return false;

  setupServer?.setMonitoring(
    inputs.map((input) => ({
      group: input.groupName,
      member: memberLabels(input.members),
      sheet: maskWebhookUrl(input.webhookUrl || WEBHOOK_URL)
    }))
  );
  const label =
    inputs.length === 1 ? memberLabels(inputs[0].members) : `${inputs.length} groups`;
  setupServer?.setReady(`Connected. Monitoring ${label}.`);
  return true;
}

async function recoverConnectionStateIfNeeded() {
  if (clientReady || isResettingSession) return;

  try {
    const state = await client.getState();
    if (state !== 'CONNECTED') return;

    if (!client.info) return;

    log('Session already connected — restoring setup UI state.');
    clearSyncTimeout();
    clientReady = true;

    if (!targetsResolved) {
      try {
        await applyTargets();
        targetsResolved = true;
      } catch (err) {
        log('ERROR restoring targets after reconnect:', err.message);
        refreshSetupUiState();
      }
    } else {
      refreshSetupUiState();
    }
  } catch {
    // client not initialized yet
  }
}

function getWhatsAppUser() {
  if (!clientReady || !client.info) return null;
  const wid = client.info.wid;
  const userId =
    typeof wid === 'object' ? wid._serialized || wid.user || '' : String(wid || '');
  const name =
    client.info.pushname ||
    (userId ? userId.replace(/@.*/, '') : '') ||
    'WhatsApp user';
  return { name, userId };
}

async function restartWhatsAppClient({ message = 'Starting fresh — QR coming soon…' } = {}) {
  clearAuthSession();
  resetAuthState();
  setupServer?.setStarting(message);
  log('Session cleared. Generating new QR code...');
  await initializeClient();
}

async function restartAfterDisconnect(reason) {
  if (isResettingSession) return;
  isResettingSession = true;

  clientReady = false;
  targetsResolved = false;
  activeTargets = [];
  groupsCache = null;
  groupsCacheAt = 0;
  groupsLoadPromise = null;
  syncCatalogPromise = null;
  membersLoadPromises.clear();
  membersCache.clear();
  resetAuthState();

  const uiMessage =
    reason === 'LOGOUT'
      ? 'Logged out from phone. Generating new QR code…'
      : 'Disconnected. Generating new QR code…';
  setupServer?.clearSessionState(uiMessage);

  try {
    log(`WhatsApp disconnected (${reason}). Restarting with a new QR code…`);
    await safeDestroyClient();
    await restartWhatsAppClient({ message: 'Scan QR to log in again…' });
  } catch (err) {
    log('Failed to restart after disconnect:', err.message);
    setupServer?.setError(
      'Disconnected. Click "Log out everywhere" or restart the bot, then scan QR again.'
    );
  } finally {
    isResettingSession = false;
  }
}

async function performSessionReset({ fast = false, clearTargets = true, skipRemoteLogout = false } = {}) {
  if (isResettingSession) return;
  isResettingSession = true;

  clientReady = false;
  targetsResolved = false;
  activeTargets = [];
  groupsCache = null;
  groupsCacheAt = 0;
  groupsLoadPromise = null;
  syncCatalogPromise = null;
  membersLoadPromises.clear();
  membersCache.clear();

  if (clearTargets) {
    clearTargetConfig();
  }

  setupServer?.clearSessionState(
    fast ? 'Fast logout — clearing session…' : 'Logging out from WhatsApp…'
  );

  if (!skipRemoteLogout) {
    if (fast) {
      log('Fast logout — unlinking device (short wait), then clearing local session…');
      await unlinkWhatsAppSession(LOGOUT_FAST_TIMEOUT_MS);
    } else {
      log('Logging out from WhatsApp (unlinking linked device)…');
      await unlinkWhatsAppSession();
    }
  } else {
    log('Skipping remote logout (session already ended).');
  }

  await safeDestroyClient();

  try {
    await restartWhatsAppClient();
  } finally {
    isResettingSession = false;
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
  if (clientReady) {
    refreshSetupUiState();
    return;
  }
  if (hasAuthenticated) return;

  const pct = Math.max(0, Math.min(100, Number(percent) || 0));
  if (pct >= 100) {
    hasAuthenticated = true;
    setupServer?.setAuthenticated('QR scanned — syncing account…');
    startSyncTimeout();
    return;
  }

  setupServer?.setLoading(pct, `Syncing after scan ${pct}% — ${message || 'WhatsApp'}`);
});

client.on('qr', (qr) => {
  if (clientReady) return;
  if (setupServer) {
    setupServer.setQr(qr);
    if (qr !== lastQrPayload) {
      lastQrPayload = qr;
      log(`QR code ready — open: ${getSetupPageUrl()}`);
    }
  } else {
    log('Scan this QR code with WhatsApp on your phone:');
    qrcode.generate(qr, { small: true });
  }
});

client.on('authenticated', () => {
  if (clientReady) {
    refreshSetupUiState();
    return;
  }
  hasAuthenticated = true;
  if (!authenticatedLogged) {
    log('Authenticated successfully. Session saved locally.');
    authenticatedLogged = true;
  }
  setupServer?.setAuthenticated('Authenticated — finishing connection…');
  startSyncTimeout();
});

client.on('auth_failure', (msg) => {
  resetAuthState();
  log('Authentication failed:', msg);
  setupServer?.setError(`Authentication failed: ${msg}`);
});

async function applyTargets() {
  if (DISCOVERY_MODE) return { monitoring: null };
  if (applyTargetsInProgress) return { monitoring: buildMonitoringSummary() };

  applyTargetsInProgress = true;
  try {
    const inputs = getAllTargetInputs(envTargets(), WEBHOOK_URL);
    if (!inputs.length) {
      activeTargets = [];
      log('No configurations saved. Add a group on the setup page.');
      setupServer?.setWaitingTargets();
      return { monitoring: null };
    }

    const needsSyncWait = inputs.some(
      (input) =>
        input.members?.length &&
        !(input.groupId && input.members.some((member) => member.id))
    );
    if (needsSyncWait) {
      log('Applying configurations (waiting for WhatsApp to finish syncing)...');
      await sleep(5000);
    } else {
      log(`Applying ${inputs.length} configuration(s)...`);
    }

    const resolvedTargets = [];
    for (const input of inputs) {
      const members = input.members || [];
      const hasNames = Boolean(input.groupName && members.length);
      if (!hasNames && !input.groupId) continue;

      try {
        const resolveInput = hasNames
          ? { ...input, memberName: members.map((member) => member.name).join(', ') }
          : input;
        const resolved = await withRetry(() => resolveTargets(client, resolveInput), {
          label: `Resolve targets (${input.groupName || input.groupId})`
        });

        const activeMembers = members.length
          ? members.map((member) => ({ id: member.id || null, name: member.name || '' }))
          : resolved.userId
            ? [{ id: resolved.userId, name: '' }]
            : [];

        const groupName =
          extractGroupName(resolved.groupLabel, input.groupName) ||
          input.groupName ||
          resolved.groupId;
        const webhookUrl = input.webhookUrl || WEBHOOK_URL;

        resolvedTargets.push({
          id: input.id || null,
          groupId: resolved.groupId,
          groupName,
          groupLabel: resolved.groupLabel,
          members: activeMembers,
          webhookUrl
        });

        log(`Monitoring group:   ${resolved.groupLabel}`);
        log(`Filtering members: ${memberLabels(activeMembers)}`);
        log(`Google Sheet:      ${maskWebhookUrl(webhookUrl)}`);
      } catch (err) {
        log(`ERROR resolving "${input.groupName || input.groupId}":`, err.message);
      }
    }

    activeTargets = resolvedTargets;
    if (!activeTargets.length) {
      setupServer?.setReady('Connected, but no configurations could be resolved. Check groups and sheet URLs.');
      return { monitoring: null };
    }

    const monitoring = buildMonitoringSummary();
    setupServer?.setMonitoring(monitoring);
    const label =
      activeTargets.length === 1
        ? memberLabels(activeTargets[0].members)
        : `${activeTargets.length} groups`;
    setupServer?.setReady(`Connected. Monitoring ${label}.`);
    return { monitoring };
  } finally {
    applyTargetsInProgress = false;
  }
}

applyTargetsRef = applyTargets;

client.on('ready', async () => {
  if (isResettingSession) return;

  clearSyncTimeout();
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
  restartAfterDisconnect(reason).catch((err) => {
    log('Disconnect recovery error:', err.message);
  });
});

async function handleIncomingMessage(message) {
  if (DISCOVERY_MODE) {
    if (message.from?.endsWith('@g.us')) {
      const senderId = resolveMessageSenderId(message);
      log('--- DISCOVERY ---');
      log(`Group ID:   ${message.from}`);
      log(`Sender:     ${message._data?.notifyName || 'Unknown'}`);
      log(`User ID:    ${senderId || '(unknown)'}`);
      log('-----------------');
    }
    return;
  }

  if (!activeTargets.length) return;

  const target = activeTargets.find((item) => item.groupId === message.from);
  if (!target) return;

  const msgId = message.id?.id;
  if (msgId) {
    if (seenMessages.has(msgId)) return;
    seenMessages.add(msgId);
  }

  const senderId = resolveMessageSenderId(message);
  const displayName = message._data?.notifyName || message._data?.notify_name || '';

  let contact = null;
  try {
    contact = await message.getContact();
  } catch {
    // use notifyName only
  }

  const senderLabel = contact?.pushname || contact?.name || displayName || senderId || 'Unknown';
  const watching = memberLabels(target.members);
  log(`Message in ${target.groupName} from "${senderLabel}" (watching: ${watching})`);

  if (!isAnyTargetMember(senderId, displayName, target.members, contact)) {
    log(`Skipped — sender is not a configured target person for ${target.groupName}.`);
    seenMessages.flush();
    return;
  }

  const quotedInfo = await resolveQuotedInfo(message);
  const payload = await buildPayload(message, contact, quotedInfo, target);

  const replyNote = payload.isReply === 'yes' ? ` (reply to ${payload.replyToSender || 'unknown'})` : '';
  log(
    `Logging message from ${payload.sender}${replyNote} → ${target.groupName}: ${payload.message.substring(0, 50)}...`
  );
  const result = await sendToSheets(payload, target.webhookUrl);
  seenMessages.flush();

  if (result?.status === 'duplicate') {
    log('Sheet reported duplicate, skipped.');
  } else {
    log(`Message logged to Google Sheet (${maskWebhookUrl(target.webhookUrl)}).`);
  }
}

async function onClientMessage(message) {
  try {
    await handleIncomingMessage(message);
  } catch (err) {
    log('Error processing message:', err.message);
  }
}

client.on('message', onClientMessage);
client.on('message_create', onClientMessage);

validateConfig();

async function initializeClient() {
  try {
    await client.initialize();
  } catch (err) {
    if (!isRecoverableInitError(err)) throw err;

    log('WhatsApp startup failed — clearing saved session and retrying...');
    log(`Reason: ${err.message}`);
    setupServer?.setStarting('Clearing old session… QR will appear shortly.');

    await safeDestroyClient();
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
  await safeDestroyClient();
  process.exit(0);
}

process.on('unhandledRejection', (reason) => {
  if (isBrowserClosedError(reason)) {
    log('Ignored browser close during logout/disconnect.');
    return;
  }
  log('Unhandled error:', reason?.message || reason);
});

process.on('SIGINT', async () => {
  log('Shutting down...');
  await shutdown();
});

process.on('SIGTERM', async () => {
  await shutdown();
});
