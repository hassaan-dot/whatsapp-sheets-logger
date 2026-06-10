require('dotenv').config();

const fs = require('fs');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const axios = require('axios');
const { MessageDedup } = require('./dedup');

const TARGET_GROUP_ID = process.env.TARGET_GROUP_ID;
const TARGET_USER_ID = process.env.TARGET_USER_ID;
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const DISCOVERY_MODE = process.env.DISCOVERY_MODE === 'true';

const seenMessages = new MessageDedup();

function log(...args) {
  console.log(`[${new Date().toISOString()}]`, ...args);
}

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
    if (!TARGET_GROUP_ID || TARGET_GROUP_ID.includes('xxxxx')) {
      log('ERROR: Set TARGET_GROUP_ID in .env (or run with DISCOVERY_MODE=true first)');
      process.exit(1);
    }
    if (!TARGET_USER_ID || TARGET_USER_ID.includes('xxxxx')) {
      log('ERROR: Set TARGET_USER_ID in .env (or run with DISCOVERY_MODE=true first)');
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

function buildPayload(message, contact) {
  const now = new Date();
  const senderId = message.author || message.from;

  return {
    date: now.toISOString().split('T')[0],
    time: now.toLocaleTimeString('en-US', { hour12: false }),
    sender: contact?.pushname || contact?.name || message._data?.notifyName || 'Unknown',
    phone: senderId,
    message: message.body || `[${message.type}]`,
    type: message.type,
    id: message.id.id
  };
}

const chromePath = getChromePath();
if (chromePath) {
  log(`Using Chrome at: ${chromePath}`);
}

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: '.wwebjs_auth' }),
  puppeteer: {
    headless: true,
    timeout: 90000,
    ...(chromePath ? { executablePath: chromePath } : {}),
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      ...(process.platform === 'linux' ? ['--no-zygote'] : []),
      '--disable-gpu'
    ]
  }
});

client.on('qr', (qr) => {
  log('Scan this QR code with WhatsApp on your phone:');
  qrcode.generate(qr, { small: true });
});

client.on('authenticated', () => {
  log('Authenticated successfully. Session saved locally.');
});

client.on('auth_failure', (msg) => {
  log('Authentication failed:', msg);
});

client.on('ready', () => {
  log('WhatsApp client is ready.');
  if (DISCOVERY_MODE) {
    log('DISCOVERY MODE: Listening for messages to print group/user IDs...');
    log('Send a message in your target group, then copy the IDs from the console.');
  } else {
    log(`Monitoring group: ${TARGET_GROUP_ID}`);
    log(`Filtering user:  ${TARGET_USER_ID}`);
    log(`Webhook:         ${WEBHOOK_URL}`);
  }
});

client.on('disconnected', (reason) => {
  log('Client disconnected:', reason);
});

client.on('message', async (message) => {
  try {
    const chat = await message.getChat();

    if (DISCOVERY_MODE) {
      if (chat.isGroup) {
        const senderId = message.author || message.from;
        const contact = await message.getContact();
        log('--- DISCOVERY ---');
        log(`Group Name: ${chat.name}`);
        log(`Group ID:   ${chat.id._serialized}`);
        log(`Sender:     ${contact.pushname || contact.name || 'Unknown'}`);
        log(`User ID:    ${senderId}`);
        log('-----------------');
      }
      return;
    }

    // 1. Group filter
    if (chat.id._serialized !== TARGET_GROUP_ID) return;

    // 2. User filter (in groups, author is the actual sender)
    const senderId = message.author || message.from;
    if (senderId !== TARGET_USER_ID) return;

    // 3. Deduplication
    const msgId = message.id.id;
    if (seenMessages.has(msgId)) return;
    seenMessages.add(msgId);

    // 4. Build payload
    const contact = await message.getContact();
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

log('Starting WhatsApp Sheets Logger...');
client.initialize();

process.on('SIGINT', async () => {
  log('Shutting down...');
  seenMessages.flush();
  await client.destroy();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  seenMessages.flush();
  await client.destroy();
  process.exit(0);
});
