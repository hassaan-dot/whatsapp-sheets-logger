const express = require('express');
const QRCode = require('qrcode');

const MAX_LOG_LINES = 500;

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderPage({ token }) {
  const safeToken = escapeHtml(token);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>WhatsApp Setup</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 720px; margin: 2rem auto; padding: 0 1rem; text-align: center; }
    h1 { font-size: 1.25rem; }
    .status { color: #444; margin: 1rem 0; }
    #qr-wrap { margin: 1rem 0; }
    #qr { border: 1px solid #ddd; border-radius: 8px; display: none; }
    #instructions { text-align: left; line-height: 1.6; max-width: 360px; margin: 0 auto 1rem; display: none; }
    .ready { color: #0a7; font-weight: 600; }
    .error { color: #c00; }
    .logs-title { text-align: left; font-size: 0.9rem; font-weight: 600; margin: 1.5rem 0 0.5rem; }
    #logs {
      text-align: left;
      background: #1e1e1e;
      color: #d4d4d4;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.75rem;
      line-height: 1.45;
      padding: 0.75rem 1rem;
      border-radius: 8px;
      max-height: 360px;
      overflow-y: auto;
      white-space: pre-wrap;
      word-break: break-word;
      margin: 0;
    }
  </style>
</head>
<body>
  <h1>WhatsApp Sheets Logger — Setup</h1>
  <p id="status" class="status">Loading...</p>
  <div id="qr-wrap">
    <img id="qr" alt="WhatsApp QR code" width="280" height="280" />
  </div>
  <ol id="instructions">
    <li>Open <strong>WhatsApp</strong> on your phone</li>
    <li>Go to <strong>Settings → Linked devices → Link a device</strong></li>
    <li>Scan the QR code above</li>
  </ol>
  <p class="logs-title">Logs</p>
  <pre id="logs"></pre>
  <script>
    const token = ${JSON.stringify(token)};
    let logIndex = 0;

    function setStatus(message, status) {
      const el = document.getElementById('status');
      el.textContent = message;
      el.className = 'status' + (status === 'ready' ? ' ready' : status === 'error' ? ' error' : '');
    }

    async function fetchLogs() {
      const res = await fetch('/setup/logs?token=' + encodeURIComponent(token) + '&since=' + logIndex);
      if (!res.ok) return;
      const data = await res.json();
      if (!data.logs.length) return;
      const el = document.getElementById('logs');
      for (const line of data.logs) {
        el.textContent += line + '\\n';
      }
      logIndex = data.total;
      el.scrollTop = el.scrollHeight;
    }

    async function tick() {
      try {
        const res = await fetch('/setup/status?token=' + encodeURIComponent(token));
        if (!res.ok) return;
        const { status, message } = await res.json();
        setStatus(message, status);

        const qr = document.getElementById('qr');
        const instructions = document.getElementById('instructions');
        if (status === 'qr') {
          qr.style.display = 'inline-block';
          instructions.style.display = 'block';
          qr.src = '/setup/qr.png?token=' + encodeURIComponent(token) + '&t=' + Date.now();
        } else {
          qr.style.display = 'none';
          instructions.style.display = 'none';
        }
      } catch (_) {}

      await fetchLogs();
    }

    tick();
    setInterval(tick, 2000);
  </script>
</body>
</html>`;
}

function createSetupServer({ port, token }) {
  let currentQr = null;
  let status = 'starting';
  let statusMessage = 'Starting WhatsApp client...';
  let server = null;
  const logs = [];

  const app = express();

  function checkToken(req, res, next) {
    const provided = req.query.token || req.headers['x-setup-token'];
    if (!token || provided !== token) {
      return res.status(401).type('text/plain').send('Unauthorized — invalid or missing setup token.');
    }
    next();
  }

  function appendLog(line) {
    logs.push(line);
    if (logs.length > MAX_LOG_LINES) {
      logs.splice(0, logs.length - MAX_LOG_LINES);
    }
  }

  app.get('/setup', checkToken, (req, res) => {
    res.type('html').send(renderPage({ token }));
  });

  app.get('/setup/qr.png', checkToken, async (req, res) => {
    if (!currentQr) {
      return res.status(404).type('text/plain').send('No QR code available yet.');
    }
    try {
      const png = await QRCode.toBuffer(currentQr, { width: 280, margin: 2 });
      res.type('png').send(png);
    } catch (err) {
      res.status(500).type('text/plain').send('Failed to generate QR image.');
    }
  });

  app.get('/setup/status', checkToken, (req, res) => {
    res.json({ status, message: statusMessage });
  });

  app.get('/setup/logs', checkToken, (req, res) => {
    const since = Math.max(0, Number(req.query.since) || 0);
    res.json({ logs: logs.slice(since), total: logs.length });
  });

  function start() {
    return new Promise((resolve, reject) => {
      server = app.listen(port, '0.0.0.0');

      server.once('listening', () => {
        const localUrl = `http://localhost:${port}/setup?token=${encodeURIComponent(token)}`;
        appendLog(`[${new Date().toISOString()}] Setup page (local):  ${localUrl}`);
        appendLog(`[${new Date().toISOString()}] Setup page (remote): http://<server-ip>:${port}/setup?token=${token}`);
        console.log(`Setup page (local):  ${localUrl}`);
        console.log(`Setup page (remote): http://<server-ip>:${port}/setup?token=${token}`);
        resolve();
      });

      server.once('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          reject(
            new Error(
              `Port ${port} is already in use. Stop the other app or set SETUP_PORT to a free port (e.g. 3099) in .env`
            )
          );
        } else {
          reject(err);
        }
      });
    });
  }

  function close() {
    if (server) {
      server.close();
      server = null;
      const line = `[${new Date().toISOString()}] Setup page closed.`;
      appendLog(line);
      console.log('Setup page closed.');
    }
  }

  return {
    start,
    close,
    appendLog,
    setQr(qr) {
      currentQr = qr;
      status = 'qr';
      statusMessage = 'Scan this QR code with WhatsApp on your phone.';
    },
    setAuthenticated() {
      currentQr = null;
      status = 'authenticated';
      statusMessage = 'Authenticated. Finishing connection...';
    },
    setReady() {
      currentQr = null;
      status = 'ready';
      statusMessage = 'Connected. Logs appear below.';
    },
    setError(message) {
      currentQr = null;
      status = 'error';
      statusMessage = message;
    }
  };
}

module.exports = { createSetupServer };
