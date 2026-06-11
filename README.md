# WhatsApp Group → Google Sheets Logger

Free automation that monitors a WhatsApp group, logs messages from one specific user, and appends rows to Google Sheets in real time.

## Stack (100% free)

| Component | Tool |
|-----------|------|
| WhatsApp | `whatsapp-web.js` (WhatsApp Web) |
| Runtime | Node.js LTS |
| HTTP | axios |
| Process manager | pm2 |
| Deduplication | In-memory Map + local JSON file |
| Sheets | Google Apps Script Web App |

## Quick start

### 1. Google Sheet setup

1. Create a new Google Sheet (empty **Sheet1** is fine).
2. Go to **Extensions → Apps Script**.
3. Paste the contents of `google-apps-script/Code.gs` and **Save**.
4. **Auto-write column headers:** in the function dropdown at the top, choose **`setupSheetHeaders`**, then click **Run** (▶). Approve permissions when asked — row 1 is filled with all 19 columns automatically (green header row).
5. **Deploy → New deployment → Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
6. Copy the deployment URL.

### 2. Install & configure

```bash
cd ~/Desktop/whatsapp-sheets-logger
npm install
cp .env.example .env
```

Edit `.env` with your values (or use discovery mode first — see below).

### 3. Find group & user IDs (discovery mode)

```bash
# In .env set: DISCOVERY_MODE=true
npm start
```

Scan the QR code, then send a message in your target group. The console prints:

```
Group ID:   120363xxxxxx@g.us
User ID:    923xxxxxxxx@c.us
```

Copy these into `.env`, set `DISCOVERY_MODE=false`, and add your `WEBHOOK_URL`.

**Or use names instead of IDs** — set the exact WhatsApp group title and member display name:

```bash
TARGET_GROUP_NAME=My Family Group
TARGET_MEMBER_NAME=Ahmed
```

Names must match exactly (case-insensitive). On startup the bot lists group members if the name is not found.

**Or use the setup web page** (when `SETUP_TOKEN` is set): open `/setup?token=...`, enter group and member name, click **Save & apply**.

**Priority:** `.env` names → saved `targets.json` → `.env` IDs. If both `.env` and a saved file exist, `.env` wins — restart the bot after editing `.env`.

### 4. Run

```bash
npm start
```

### 5. Production (pm2)

```bash
npm install -g pm2
mkdir -p logs
npm run pm2:start
pm2 save
pm2 startup   # follow the printed command to enable on boot
```

### 6. DigitalOcean / VPS (remote QR scan)

On a remote server there is no local terminal to scan from. Two options:

**Option A — Web setup page (recommended on VPS)**

1. In `.env`, set a secret token and port:

   ```bash
   SETUP_TOKEN=$(openssl rand -hex 32)
   SETUP_PORT=3099
   ```

2. Open the port in your firewall (DigitalOcean → Networking → Firewalls, or `ufw allow 3099`).

3. Start the bot and open in your phone browser:

   ```
   http://YOUR_DROPLET_IP:3099/setup?token=YOUR_SETUP_TOKEN
   ```

4. Scan the QR (WhatsApp → Settings → Linked devices → Link a device).

5. After connection, the setup page closes automatically. Session is saved in `.wwebjs_auth/` for future restarts.

**Option B — Scan locally, copy session**

1. Run and scan QR on your Mac.
2. Copy the session folder to the server:

   ```bash
   scp -r .wwebjs_auth/ user@YOUR_DROPLET_IP:/path/to/whatsapp-sheets-logger/
   ```

If `SETUP_TOKEN` is not set, the bot falls back to printing the QR in the terminal (SSH + `pm2 logs`).

## Environment variables

| Variable | Description |
|----------|-------------|
| `TARGET_GROUP_NAME` | Exact WhatsApp group title (use with `TARGET_MEMBER_NAME`) |
| `TARGET_MEMBER_NAME` | Exact member display name as shown in WhatsApp |
| `TARGET_GROUP_ID` | Alternative: group ID (`xxxxx@g.us`) |
| `TARGET_USER_ID` | Alternative: sender ID (`xxxxx@c.us` or `@lid`) |
| `WEBHOOK_URL` | Google Apps Script web app URL |
| `DISCOVERY_MODE` | `true` to print IDs without filtering |
| `SETUP_TOKEN` | Secret token for `/setup` web page (enables remote QR scan) |
| `SETUP_PORT` | Port for setup page (default `3099`; avoid `3000` — often used by other dev apps) |
| `SERVER_IP` | Your server public IP — printed in logs as the full setup URL |

## How it works

```
WhatsApp Group Message
        ↓
whatsapp-web.js (Node.js bot)
        ↓
Filter: Group ID + Sender ID
        ↓
Extract message data
        ↓
Deduplication (local JSON + in-memory)
        ↓
POST JSON → Google Apps Script
        ↓
Google Sheets row appended
```

## Sheet columns (reply tracking)

When your target member **replies** to someone in the group, one row shows both sides of the interaction:

| Column | Example |
|--------|---------|
| **Is Reply** | `yes` |
| **Reply To Sender** | `Ahmed` |
| **Reply To Text** | `Can we meet Friday?` |
| **Reply To Msg ID** | links to the original message id |

Filter **Is Reply = yes** to see only responses. **Date** / **Time** are when WhatsApp says the message was sent (not when the bot logged it). **Logged At** is when the row was written.

**Upgrading an existing sheet:** open Apps Script → run **`setupSheetHeaders`** once (overwrites row 1 with the correct headers). Then redeploy `Code.gs` if you changed it, and restart the bot. Old data rows are kept; only row 1 headers change.

## Notes

- Session is saved in `.wwebjs_auth/` — you only scan the QR code once.
- WhatsApp Web automation is unofficial; use at your own risk.
- Keep the machine running (or use a free VPS) for 24/7 monitoring.
- The Apps Script also deduplicates by Message ID as a second safety net.
