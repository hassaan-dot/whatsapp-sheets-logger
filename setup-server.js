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
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>WhatsApp Setup</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 720px; margin: 2rem auto; padding: 0 1rem; text-align: center; }
    h1 { font-size: 1.25rem; }
    h2 { font-size: 1rem; text-align: left; margin: 0 0 0.75rem; }
    .status { color: #444; margin: 1rem 0; }
    #qr-section {
      border: 1px dashed #ccc;
      border-radius: 8px;
      padding: 1rem;
      margin: 1rem 0;
      min-height: 120px;
    }
    #qr-hint { color: #666; font-size: 0.9rem; margin: 0.5rem 0; }
    #qr { border: 1px solid #ddd; border-radius: 8px; display: none; margin: 0.5rem auto; }
    #instructions { text-align: left; line-height: 1.6; max-width: 360px; margin: 0.75rem auto 0; display: none; }
    #logout-btn {
      background: #fff;
      color: #c00;
      border: 1px solid #e0a0a0;
      margin-top: 0.5rem;
      font-size: 0.85rem;
    }
    .ready { color: #0a7; font-weight: 600; }
    .error { color: #c00; }
    .panel {
      text-align: left;
      border: 1px solid #e0e0e0;
      border-radius: 8px;
      padding: 1rem;
      margin: 1.25rem 0;
      background: #fafafa;
    }
    .field { margin-bottom: 0.75rem; }
    .field label { display: block; font-size: 0.85rem; font-weight: 600; margin-bottom: 0.25rem; }
    .field input {
      width: 100%;
      box-sizing: border-box;
      padding: 0.5rem 0.65rem;
      border: 1px solid #ccc;
      border-radius: 6px;
      font-size: 0.95rem;
    }
    button {
      background: #128c7e;
      color: #fff;
      border: none;
      border-radius: 6px;
      padding: 0.55rem 1rem;
      font-size: 0.95rem;
      cursor: pointer;
    }
    button:disabled { opacity: 0.6; cursor: not-allowed; }
    #target-feedback { font-size: 0.85rem; margin: 0.5rem 0 0; min-height: 1.2em; }
    #target-feedback.ok { color: #0a7; }
    #target-feedback.err { color: #c00; }
    #target-active { font-size: 0.85rem; color: #555; margin: 0.5rem 0 0; }
    #target-source { font-size: 0.8rem; color: #888; margin: 0 0 0.75rem; text-align: left; }
    .combo-wrap { position: relative; }
    .combo-list {
      position: absolute;
      left: 0; right: 0;
      max-height: 200px;
      overflow-y: auto;
      background: #fff;
      border: 1px solid #ccc;
      border-radius: 6px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.1);
      z-index: 10;
      margin-top: 2px;
    }
    .combo-item {
      display: block;
      width: 100%;
      text-align: left;
      background: #fff;
      color: #222;
      border: none;
      border-bottom: 1px solid #eee;
      padding: 0.5rem 0.65rem;
      font-size: 0.9rem;
      cursor: pointer;
    }
    .combo-item:hover { background: #e8f5f3; }
    .selected-pill {
      font-size: 0.85rem;
      color: #128c7e;
      margin: 0.35rem 0 0.5rem;
      font-weight: 600;
    }
    .btn-secondary {
      background: #fff;
      color: #128c7e;
      border: 1px solid #128c7e;
      margin-bottom: 0.5rem;
      font-size: 0.85rem;
    }
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
  <section id="qr-section">
    <strong>WhatsApp login</strong>
    <p id="qr-hint">Connecting… QR will appear here in a few seconds.</p>
    <img id="qr" alt="WhatsApp QR code" width="280" height="280" />
    <ol id="instructions">
    <li>Open <strong>WhatsApp</strong> on your phone</li>
    <li>Go to <strong>Settings → Linked devices → Link a device</strong></li>
    <li>Scan the QR code above</li>
    </ol>
    <button type="button" id="logout-btn" style="display:none">Log out &amp; show new QR</button>
  </section>

  <section class="panel">
    <h2>Target messages</h2>
    <p id="target-source"></p>
    <p style="font-size:0.85rem;color:#555;margin:0 0 0.75rem;">
      Select a group and member after WhatsApp is connected. Or type names manually.
    </p>
    <form id="target-form">
      <div class="field">
        <label>Group</label>
        <button type="button" class="btn-secondary" id="load-groups">Load my groups</button>
        <div class="combo-wrap">
          <input id="group-search" placeholder="Search groups…" autocomplete="off" />
          <div id="group-list" class="combo-list" hidden></div>
        </div>
        <p id="group-selected" class="selected-pill"></p>
        <input type="hidden" id="groupId" />
        <input type="hidden" id="groupName" />
      </div>
      <div class="field">
        <label>Member</label>
        <button type="button" class="btn-secondary" id="load-members" disabled>Load members</button>
        <div class="combo-wrap">
          <input id="member-search" placeholder="Search members…" autocomplete="off" disabled />
          <div id="member-list" class="combo-list" hidden></div>
        </div>
        <p id="member-selected" class="selected-pill"></p>
        <input type="hidden" id="memberName" />
        <input type="hidden" id="memberId" />
      </div>
      <button type="submit" id="save-targets">Save &amp; apply</button>
      <p id="target-feedback"></p>
      <p id="target-active"></p>
    </form>
  </section>

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

    const sourceLabels = {
      env: 'Loaded from .env (restart bot after editing .env)',
      saved: 'Loaded from saved settings (targets.json)',
      'env-ids': 'Using group/user IDs from .env — enter names here or set TARGET_GROUP_NAME in .env'
    };

    let allGroups = [];
    let allMembers = [];
    let whatsAppReady = false;

    function isFormFocused() {
      const el = document.activeElement;
      return el && (el.id === 'group-search' || el.id === 'member-search');
    }

    function setSelection(kind, item) {
      if (kind === 'group') {
        document.getElementById('groupId').value = item.id;
        document.getElementById('groupName').value = item.name;
        document.getElementById('group-selected').textContent = 'Selected: ' + item.name;
        document.getElementById('group-search').value = '';
        document.getElementById('group-list').hidden = true;
        document.getElementById('load-members').disabled = false;
        document.getElementById('member-search').disabled = false;
        allMembers = [];
        document.getElementById('memberId').value = '';
        document.getElementById('memberName').value = '';
        document.getElementById('member-selected').textContent = '';
        document.getElementById('member-list').hidden = true;
        loadMembers();
      } else {
        document.getElementById('memberId').value = item.id;
        document.getElementById('memberName').value = item.name;
        document.getElementById('member-selected').textContent = 'Selected: ' + item.name;
        document.getElementById('member-search').value = '';
        document.getElementById('member-list').hidden = true;
      }
    }

    function renderComboList(listEl, items, onPick) {
      listEl.innerHTML = '';
      if (!items.length) {
        listEl.hidden = true;
        return;
      }
      for (const item of items) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'combo-item';
        btn.textContent = item.name;
        btn.addEventListener('click', () => onPick(item));
        listEl.appendChild(btn);
      }
      listEl.hidden = false;
    }

    function filterItems(items, query) {
      const q = query.trim().toLowerCase();
      if (!q) return items;
      return items.filter((item) => item.name.toLowerCase().includes(q));
    }

    async function loadGroups() {
      const btn = document.getElementById('load-groups');
      if (btn.disabled) return;
      btn.disabled = true;
      btn.textContent = 'Loading groups…';
      document.getElementById('target-feedback').textContent = 'Loading groups (usually a few seconds)…';
      document.getElementById('target-feedback').className = '';
      try {
        const res = await fetch('/setup/groups?token=' + encodeURIComponent(token));
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to load groups');
        if (!data.ready) throw new Error('Connect WhatsApp first (scan QR above).');
        allGroups = data.groups || [];
        document.getElementById('target-feedback').textContent =
          allGroups.length
            ? 'Found ' + allGroups.length + ' group(s). Search and select one.'
            : 'No groups found.';
        document.getElementById('target-feedback').className = 'ok';
        renderComboList(
          document.getElementById('group-list'),
          filterItems(allGroups, document.getElementById('group-search').value),
          (item) => setSelection('group', item)
        );
      } catch (err) {
        document.getElementById('target-feedback').textContent = err.message;
        document.getElementById('target-feedback').className = 'err';
      } finally {
        btn.disabled = !whatsAppReady;
        btn.textContent = allGroups.length ? 'Refresh groups' : 'Load my groups';
      }
    }

    async function loadMembers() {
      const groupId = document.getElementById('groupId').value;
      if (!groupId) return;
      const btn = document.getElementById('load-members');
      if (btn.disabled) return;
      btn.disabled = true;
      btn.textContent = 'Loading members…';
      document.getElementById('target-feedback').textContent = 'Loading members (usually a few seconds)…';
      document.getElementById('target-feedback').className = '';
      try {
        const res = await fetch(
          '/setup/members?token=' + encodeURIComponent(token) + '&groupId=' + encodeURIComponent(groupId)
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to load members');
        allMembers = data.members || [];
        document.getElementById('target-feedback').textContent =
          allMembers.length
            ? 'Found ' + allMembers.length + ' member(s). Search and select one.'
            : 'No members found.';
        document.getElementById('target-feedback').className = 'ok';
        renderComboList(
          document.getElementById('member-list'),
          filterItems(allMembers, document.getElementById('member-search').value),
          (item) => setSelection('member', item)
        );
      } catch (err) {
        document.getElementById('target-feedback').textContent = err.message;
        document.getElementById('target-feedback').className = 'err';
      } finally {
        btn.disabled = false;
        btn.textContent = allMembers.length ? 'Refresh members' : 'Load members';
      }
    }

    document.getElementById('load-groups').addEventListener('click', loadGroups);
    document.getElementById('load-members').addEventListener('click', loadMembers);

    document.getElementById('group-search').addEventListener('input', (e) => {
      renderComboList(
        document.getElementById('group-list'),
        filterItems(allGroups, e.target.value),
        (item) => setSelection('group', item)
      );
    });
    document.getElementById('group-search').addEventListener('focus', () => {
      if (allGroups.length) {
        renderComboList(
          document.getElementById('group-list'),
          filterItems(allGroups, document.getElementById('group-search').value),
          (item) => setSelection('group', item)
        );
      }
    });

    document.getElementById('member-search').addEventListener('input', (e) => {
      renderComboList(
        document.getElementById('member-list'),
        filterItems(allMembers, e.target.value),
        (item) => setSelection('member', item)
      );
    });
    document.getElementById('member-search').addEventListener('focus', () => {
      if (allMembers.length) {
        renderComboList(
          document.getElementById('member-list'),
          filterItems(allMembers, document.getElementById('member-search').value),
          (item) => setSelection('member', item)
        );
      }
    });

    document.addEventListener('click', (e) => {
      if (!e.target.closest('.combo-wrap')) {
        document.getElementById('group-list').hidden = true;
        document.getElementById('member-list').hidden = true;
      }
    });

    function applyTargetData(data, { updateFields = true } = {}) {
      if (updateFields && !isFormFocused()) {
        if (data.groupName) {
          document.getElementById('groupName').value = data.groupName;
          document.getElementById('group-selected').textContent = 'Selected: ' + data.groupName;
        }
        if (data.groupId) document.getElementById('groupId').value = data.groupId;
        if (data.memberName) {
          document.getElementById('memberName').value = data.memberName;
          document.getElementById('member-selected').textContent = 'Selected: ' + data.memberName;
        }
        if (data.groupId) {
          document.getElementById('load-members').disabled = !whatsAppReady;
          document.getElementById('member-search').disabled = !whatsAppReady;
        }
      }
      const sourceEl = document.getElementById('target-source');
      if (data.source) {
        sourceEl.textContent = sourceLabels[data.source] || '';
      } else if (!data.monitoring) {
        sourceEl.textContent = 'Scan QR, then load groups and pick a member.';
      }
      if (data.monitoring) {
        document.getElementById('target-active').textContent =
          'Active: ' + data.monitoring.group + ' → ' + data.monitoring.member;
      }
    }

    async function loadTargets({ updateFields = true } = {}) {
      const res = await fetch('/setup/targets?token=' + encodeURIComponent(token));
      if (!res.ok) return;
      applyTargetData(await res.json(), { updateFields });
    }

    document.getElementById('target-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = document.getElementById('save-targets');
      const feedback = document.getElementById('target-feedback');
      const groupName = document.getElementById('groupName').value.trim()
        || document.getElementById('group-search').value.trim();
      const memberName = document.getElementById('memberName').value.trim()
        || document.getElementById('member-search').value.trim();
      const groupId = document.getElementById('groupId').value.trim();
      const memberId = document.getElementById('memberId').value.trim();
      if (!groupName || !memberName) {
        feedback.textContent = 'Select or enter both group and member.';
        feedback.className = 'err';
        return;
      }
      btn.disabled = true;
      feedback.textContent = 'Saving...';
      feedback.className = '';

      try {
        const res = await fetch('/setup/targets?token=' + encodeURIComponent(token), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ groupName, memberName, groupId, memberId })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Save failed');
        feedback.textContent = data.warning || 'Saved. Monitoring updated.';
        feedback.className = data.warning ? 'err' : 'ok';
        if (data.monitoring) {
          document.getElementById('target-active').textContent =
            'Active: ' + data.monitoring.group + ' → ' + data.monitoring.member;
        }
        await loadTargets({ updateFields: true });
      } catch (err) {
        feedback.textContent = err.message;
        feedback.className = 'err';
      } finally {
        btn.disabled = false;
      }
    });

    let tickInFlight = false;
    let initialPoll = true;
    const POLL_MS = 3000;

    function updateQrUi(status) {
      const qr = document.getElementById('qr');
      const hint = document.getElementById('qr-hint');
      const instructions = document.getElementById('instructions');
      const logoutBtn = document.getElementById('logout-btn');

      if (status === 'qr') {
        hint.textContent = 'Scan this QR code with your phone:';
        qr.style.display = 'inline-block';
        instructions.style.display = 'block';
        logoutBtn.style.display = 'none';
        qr.src = '/setup/qr.png?token=' + encodeURIComponent(token) + '&t=' + Date.now();
      } else if (status === 'starting') {
        hint.textContent = 'Connecting… QR will appear here in a few seconds.';
        qr.style.display = 'none';
        instructions.style.display = 'none';
        logoutBtn.style.display = 'none';
      } else if (status === 'authenticated') {
        hint.textContent = 'QR scanned! Finishing login…';
        qr.style.display = 'none';
        instructions.style.display = 'none';
        logoutBtn.style.display = 'none';
      } else if (status === 'ready') {
        hint.textContent = 'Already logged in — no QR needed. Use Log out below to scan again.';
        qr.style.display = 'none';
        instructions.style.display = 'none';
        logoutBtn.style.display = 'inline-block';
      } else if (status === 'error') {
        hint.textContent = 'Login error. Try Log out to get a new QR.';
        qr.style.display = 'none';
        instructions.style.display = 'none';
        logoutBtn.style.display = 'inline-block';
      }
    }

    document.getElementById('logout-btn').addEventListener('click', async () => {
      const btn = document.getElementById('logout-btn');
      btn.disabled = true;
      document.getElementById('qr-hint').textContent = 'Logging out… new QR coming soon.';
      try {
        const res = await fetch('/setup/logout?token=' + encodeURIComponent(token), { method: 'POST' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Logout failed');
      } catch (err) {
        document.getElementById('qr-hint').textContent = err.message;
      } finally {
        btn.disabled = false;
      }
    });

    async function tick() {
      if (tickInFlight) return;
      tickInFlight = true;
      try {
        const res = await fetch(
          '/setup/poll?token=' + encodeURIComponent(token) + '&since=' + logIndex
        );
        if (!res.ok) return;
        const data = await res.json();

        setStatus(data.message, data.status);
        updateQrUi(data.status);
        whatsAppReady = data.ready || data.status === 'ready';
        document.getElementById('load-groups').disabled = !whatsAppReady;

        if (data.targets) {
          applyTargetData(data.targets, { updateFields: initialPoll });
          initialPoll = false;
        }

        if (data.logs?.logs?.length) {
          const el = document.getElementById('logs');
          for (const line of data.logs.logs) {
            el.textContent += line + '\\n';
          }
          logIndex = data.logs.total;
          el.scrollTop = el.scrollHeight;
        }
      } catch (_) {}
      finally {
        tickInFlight = false;
      }
    }

    tick();
    setInterval(() => tick(), POLL_MS);
  </script>
</body>
</html>`;
}

function createSetupServer({
  port,
  token,
  serverIp,
  getTargets,
  onSaveTargets,
  onLogout,
  onListGroups,
  onListMembers,
  isWhatsAppReady
}) {
  let currentQr = null;
  let status = 'starting';
  let statusMessage = 'Starting WhatsApp client...';
  let monitoring = null;
  let server = null;
  const logs = [];

  const app = express();
  app.use(express.json());

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
    res.json({
      status,
      message: statusMessage,
      monitoring,
      ready: isWhatsAppReady ? isWhatsAppReady() : status === 'ready'
    });
  });

  app.get('/setup/groups', checkToken, async (req, res) => {
    if (!onListGroups) {
      return res.status(503).json({ error: 'Group list is not configured.' });
    }
    try {
      const result = await onListGroups();
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message, ready: isWhatsAppReady?.() || false, groups: [] });
    }
  });

  app.get('/setup/members', checkToken, async (req, res) => {
    const groupId = req.query.groupId?.trim();
    if (!groupId) {
      return res.status(400).json({ error: 'groupId is required.' });
    }
    if (!onListMembers) {
      return res.status(503).json({ error: 'Member list is not configured.' });
    }
    try {
      const members = await onListMembers(groupId);
      res.json({ members });
    } catch (err) {
      res.status(500).json({ error: err.message, members: [] });
    }
  });

  app.get('/setup/targets', checkToken, (req, res) => {
    const targets = getTargets ? getTargets() : null;
    res.json({
      groupName: targets?.groupName || '',
      memberName: targets?.memberName || '',
      groupId: targets?.groupId || '',
      source: targets?.source || null,
      monitoring
    });
  });

  app.post('/setup/targets', checkToken, async (req, res) => {
    const groupName = req.body?.groupName?.trim();
    const memberName = req.body?.memberName?.trim();
    const groupId = req.body?.groupId?.trim() || '';
    const memberId = req.body?.memberId?.trim() || '';

    if (!groupName || !memberName) {
      return res.status(400).json({ error: 'Group and member are required.' });
    }

    if (!onSaveTargets) {
      return res.status(503).json({ error: 'Target saving is not configured.' });
    }

    try {
      const result = await onSaveTargets(groupName, memberName, groupId, memberId);
      res.json({
        ok: true,
        groupName,
        memberName,
        groupId,
        memberId,
        warning: result?.warning || null,
        monitoring: result?.monitoring || monitoring
      });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.get('/setup/logs', checkToken, (req, res) => {
    const since = Math.max(0, Number(req.query.since) || 0);
    res.json({ logs: logs.slice(since), total: logs.length });
  });

  app.get('/setup/poll', checkToken, (req, res) => {
    const since = Math.max(0, Number(req.query.since) || 0);
    const targets = getTargets ? getTargets() : null;
    res.json({
      status,
      message: statusMessage,
      ready: isWhatsAppReady ? isWhatsAppReady() : status === 'ready',
      monitoring,
      targets: {
        groupName: targets?.groupName || '',
        memberName: targets?.memberName || '',
        groupId: targets?.groupId || '',
        memberId: targets?.memberId || '',
        source: targets?.source || null,
        monitoring
      },
      logs: { logs: logs.slice(since), total: logs.length }
    });
  });

  app.post('/setup/logout', checkToken, async (req, res) => {
    if (!onLogout) {
      return res.status(503).json({ error: 'Logout is not configured.' });
    }
    try {
      await onLogout();
      status = 'starting';
      statusMessage = 'Session cleared. Waiting for new QR code...';
      currentQr = null;
      monitoring = null;
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  function start() {
    return new Promise((resolve, reject) => {
      server = app.listen(port, '0.0.0.0');

      server.once('listening', () => {
        const localUrl = `http://localhost:${port}/setup?token=${encodeURIComponent(token)}`;
        const remoteHost = serverIp?.trim() || '<set SERVER_IP in .env>';
        const remoteUrl = `http://${remoteHost}:${port}/setup?token=${encodeURIComponent(token)}`;
        appendLog(`[${new Date().toISOString()}] Setup page (local):  ${localUrl}`);
        appendLog(`[${new Date().toISOString()}] Setup page (remote): ${remoteUrl}`);
        console.log(`Setup page (local):  ${localUrl}`);
        console.log(`Setup page (remote): ${remoteUrl}`);
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
    setMonitoring(info) {
      monitoring = info;
    },
    setStarting(message) {
      currentQr = null;
      status = 'starting';
      statusMessage = message || 'Starting WhatsApp client...';
    },
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
    setReady(message) {
      currentQr = null;
      status = 'ready';
      statusMessage = message || 'Connected. Set targets below if needed.';
    },
    setWaitingTargets() {
      status = 'ready';
      statusMessage = 'Connected. Enter group and member name below, then Save.';
    },
    setError(message) {
      currentQr = null;
      status = 'error';
      statusMessage = message;
    }
  };
}

module.exports = { createSetupServer };
