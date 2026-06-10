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

1. Create a new Google Sheet.
2. In **Sheet1**, add headers in row 1:

   | Date | Time | Sender | Phone | Message | Type | Message ID |

3. Go to **Extensions → Apps Script**.
4. Paste the contents of `google-apps-script/Code.gs`.
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

## Environment variables

| Variable | Description |
|----------|-------------|
| `TARGET_GROUP_ID` | WhatsApp group ID (`xxxxx@g.us`) |
| `TARGET_USER_ID` | Sender to track (`xxxxx@c.us`) |
| `WEBHOOK_URL` | Google Apps Script web app URL |
| `DISCOVERY_MODE` | `true` to print IDs without filtering |

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

## Notes

- Session is saved in `.wwebjs_auth/` — you only scan the QR code once.
- WhatsApp Web automation is unofficial; use at your own risk.
- Keep the machine running (or use a free VPS) for 24/7 monitoring.
- The Apps Script also deduplicates by Message ID as a second safety net.
