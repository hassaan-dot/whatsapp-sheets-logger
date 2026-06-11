# Connect a Google Sheet (new user guide)

Each WhatsApp group configuration needs its **own Google Sheet** and **webhook URL**. Repeat these steps for every new group you add on the setup page.

---

## Step 1 — Create a Google Sheet

1. Open [Google Sheets](https://sheets.google.com).
2. Click **Blank spreadsheet**.
3. Name the file something clear, e.g. `WhatsApp – Family group`.

You can use one sheet per group so logs stay separate.

---

## Step 2 — Open Apps Script

1. In that spreadsheet, menu: **Extensions → Apps Script**.
2. A new tab opens with a code editor (you may see default `function myFunction()` code).

---

## Step 3 — Paste our script

**From the setup website (recommended)**

1. Open your bot setup page (`/setup?token=...`).
2. Expand **First time? How to connect a Google Sheet**.
3. Click **Copy script**.
4. In Apps Script, select all existing code, delete it, **paste** the copied script.
5. Click **Save** (disk icon). Name the project if asked (e.g. `WhatsApp Logger`).

**From this repository**

1. Open `google-apps-script/Code.gs` in the project folder.
2. Copy the entire file.
3. Paste into Apps Script and **Save**.

---

## Step 4 — Run once (column headers)

1. At the top of Apps Script, open the function dropdown.
2. Choose **`setupSheetHeaders`**.
3. Click **Run** (▶).
4. Click **Review permissions** → choose your Google account → **Allow**.
5. When it finishes, your sheet’s **Sheet1** row 1 has green column headers.

You only need to run this once per spreadsheet.

---

## Step 5 — Deploy and copy the URL

1. In Apps Script, click **Deploy → New deployment**.
2. Click the gear icon → select **Web app**.
3. Set:
   - **Description:** e.g. `WhatsApp webhook`
   - **Execute as:** **Me**
   - **Who has access:** **Anyone** ← important
4. Click **Deploy**.
5. Copy the **Web app URL** (must end with `/exec`).

**Quick test:** open that URL in a browser. You should see:

`WhatsApp Sheets Logger webhook is running.`

If you see a **Google Sign in** page, the deployment is wrong — use **Anyone**, not “Anyone with Google account”, then deploy again.

After you change `Code.gs`, use **Deploy → Manage deployments → Edit → New version → Deploy** so the URL keeps working with the latest code.

---

## Step 6 — Paste URL in the setup form (new group)

1. On the setup page, scan WhatsApp QR if you are not connected yet.
2. Click **+ Add** to create a configuration.
3. **Load my groups** → select the WhatsApp **group**.
4. **Load members** → select the **person** to monitor.
5. Paste the **Web app URL** into **Google Sheets webhook URL**.
6. Click **Save all & apply**.

Messages from that person in that group will append rows to that sheet.

---

## Multiple groups

| Group | Sheet | Webhook URL in form |
|-------|--------|---------------------|
| Group A | Sheet A (steps 1–5) | URL from Sheet A |
| Group B | Sheet B (repeat all steps) | URL from Sheet B |

Each configuration on the setup page can use a different webhook URL.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Sheet stays empty | Confirm **Who has access: Anyone** on the web app deployment |
| `Webhook HTTP 401` in bot logs | Redeploy with **Anyone**; paste the new `/exec` URL |
| Wrong person logged | Check group + member selection; only that member’s messages are saved |
| Headers missing | Run **`setupSheetHeaders`** again in Apps Script |
