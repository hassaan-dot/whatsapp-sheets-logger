const express = require('express');
const QRCode = require('qrcode');
const { normalizeMembers, memberLabels } = require('./target-config');

const MAX_LOG_LINES = 500;
const QR_EXPIRY_MS = 50000;

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
    *, *::before, *::after { box-sizing: border-box; }
    html, body { height: 100%; margin: 0; }
    body {
      font-family: system-ui, sans-serif;
      display: flex;
      flex-direction: column;
      min-height: 100vh;
      background: #f5f5f5;
      color: #222;
    }
    .app-navbar {
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      padding: 0.65rem 1.25rem;
      background: #128c7e;
      color: #fff;
      border-bottom: 1px solid #0e6b60;
    }
    .navbar-brand {
      font-size: 1rem;
      font-weight: 700;
      line-height: 1.2;
      white-space: nowrap;
    }
    .navbar-brand small {
      display: block;
      font-size: 0.72rem;
      font-weight: 400;
      opacity: 0.85;
      margin-top: 0.15rem;
    }
    .navbar-center {
      flex: 1;
      min-width: 0;
      text-align: center;
      font-size: 0.85rem;
      opacity: 0.95;
    }
    .navbar-center[hidden] { display: none !important; }
    .navbar-right {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      flex-shrink: 0;
    }
    .navbar-right[hidden] { display: none !important; }
    .user-pill {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      background: rgba(255, 255, 255, 0.15);
      border: 1px solid rgba(255, 255, 255, 0.25);
      border-radius: 999px;
      padding: 0.3rem 0.65rem 0.3rem 0.45rem;
      font-size: 0.82rem;
      font-weight: 600;
      max-width: 220px;
    }
    .user-avatar {
      width: 1.5rem;
      height: 1.5rem;
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.25);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 0.75rem;
      flex-shrink: 0;
    }
    .user-name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .btn-navbar-logout {
      background: #fff;
      color: #c00;
      border: none;
      border-radius: 6px;
      padding: 0.4rem 0.7rem;
      font-size: 0.78rem;
      font-weight: 600;
      cursor: pointer;
      white-space: nowrap;
    }
    .btn-navbar-logout:disabled { opacity: 0.65; cursor: not-allowed; }
    h2 { font-size: 1rem; text-align: left; margin: 0 0 0.75rem; }
    .status { color: inherit; margin: 0; font-size: 0.85rem; }
    .status.ready { color: #dffef8; font-weight: 600; }
    .status.error { color: #ffd4d4; font-weight: 600; }
    .app-main {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 1rem;
      min-height: 0;
      padding: 1rem 1.25rem;
    }
    .app-columns {
      display: flex;
      gap: 1rem;
      align-items: stretch;
      flex-shrink: 0;
    }
    .app-columns.logged-in #qr-section { display: none !important; }
    .app-columns.logged-in #target-panel {
      max-height: none;
      flex: 1;
      width: 100%;
    }
    #qr-section {
      flex: 0 0 300px;
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      border: 1px dashed #ccc;
      border-radius: 8px;
      padding: 1rem;
      background: #fff;
      min-height: 320px;
    }
    #qr-hint { color: #666; font-size: 0.9rem; margin: 0.5rem 0; }
    .qr-frame {
      width: 256px;
      height: 256px;
      margin: 0.5rem auto;
      position: relative;
      flex-shrink: 0;
    }
    .qr-skeleton {
      display: none;
      position: absolute;
      inset: 0;
      border-radius: 8px;
      border: 1px solid #e0e0e0;
      background: #f3f3f3;
      overflow: hidden;
    }
    .qr-skeleton.visible { display: block; }
    .qr-skeleton::before {
      content: '';
      position: absolute;
      inset: 20px;
      border: 2px dashed #d5d5d5;
      border-radius: 6px;
    }
    .qr-skeleton::after {
      content: '';
      position: absolute;
      inset: 0;
      background: linear-gradient(
        90deg,
        transparent 0%,
        rgba(255, 255, 255, 0.75) 45%,
        rgba(255, 255, 255, 0.75) 55%,
        transparent 100%
      );
      animation: qr-shimmer 1.5s ease-in-out infinite;
      transform: translateX(-100%);
    }
    @keyframes qr-shimmer {
      100% { transform: translateX(100%); }
    }
    #qr {
      width: 256px;
      height: 256px;
      border: 1px solid #ddd;
      border-radius: 8px;
      display: none;
      position: relative;
      z-index: 1;
      background: #fff;
    }
    #instructions { text-align: left; line-height: 1.6; width: 100%; margin: 0.75rem 0 0; padding-left: 1.1rem; font-size: 0.85rem; }
    .ready { color: #0a7; font-weight: 600; }
    .error { color: #c00; }
    .session-steps {
      display: flex;
      gap: 0.35rem;
      width: 100%;
      margin: 0.65rem 0 0.5rem;
      font-size: 0.7rem;
    }
    .session-step {
      flex: 1;
      text-align: center;
      padding: 0.35rem 0.2rem;
      border-radius: 6px;
      background: #f0f0f0;
      color: #888;
      line-height: 1.2;
    }
    .session-step.active {
      background: #e8f5f3;
      color: #128c7e;
      font-weight: 600;
    }
    .session-step.done {
      background: #e8f5f3;
      color: #0a7;
    }
    .progress-wrap {
      width: 100%;
      margin: 0.35rem 0 0.5rem;
    }
    .progress-wrap[hidden] { display: none !important; }
    .progress-meta {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 0.5rem;
      font-size: 0.78rem;
      color: #666;
      margin-bottom: 0.35rem;
    }
    #progress-percent {
      font-weight: 600;
      color: #128c7e;
      font-variant-numeric: tabular-nums;
      min-width: 2.5rem;
      text-align: right;
    }
    .progress-track {
      height: 6px;
      background: #e8e8e8;
      border-radius: 999px;
      overflow: hidden;
    }
    .progress-bar {
      height: 100%;
      width: 0%;
      background: #128c7e;
      border-radius: 999px;
      transition: width 0.35s ease;
    }
    .progress-bar.indeterminate {
      width: 40% !important;
      animation: progress-indeterminate 1.2s ease-in-out infinite;
    }
    @keyframes progress-indeterminate {
      0% { transform: translateX(-100%); }
      100% { transform: translateX(350%); }
    }
    #qr.expired {
      opacity: 0.35;
      filter: grayscale(1);
    }
    .qr-expiry {
      font-size: 0.82rem;
      color: #666;
      margin: 0.35rem 0 0;
      font-variant-numeric: tabular-nums;
    }
    .qr-expiry.expired { color: #c00; font-weight: 600; }
    .qr-expiry.soon { color: #b8860b; font-weight: 600; }
    .qr-connected-badge {
      display: none;
      align-items: center;
      justify-content: center;
      gap: 0.35rem;
      color: #0a7;
      font-weight: 600;
      font-size: 0.95rem;
      margin: 0.75rem 0 0.25rem;
    }
    .qr-connected-badge.visible { display: flex; }
    .panel {
      text-align: left;
      border: 1px solid #e0e0e0;
      border-radius: 8px;
      padding: 1rem;
      background: #fff;
    }
    #target-panel {
      flex: 1;
      min-width: 0;
      overflow-y: auto;
      max-height: 520px;
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
    .btn-row {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      margin-bottom: 0.5rem;
    }
    .btn-row .btn-secondary { margin-bottom: 0; }
    .panel.session-off {
      opacity: 0.55;
      pointer-events: none;
    }
    .panel.session-off .session-hint {
      display: block;
      color: #888;
      font-size: 0.85rem;
      margin: 0 0 0.75rem;
    }
    .session-hint { display: none; }
    .pick-row {
      display: none;
      align-items: center;
      gap: 0.35rem;
      margin: 0.35rem 0 0.5rem;
    }
    .pick-row.visible { display: flex; }
    .pick-row .selected-pill { margin: 0; flex: 1; min-width: 0; }
    .btn-clear {
      flex-shrink: 0;
      width: 1.6rem;
      height: 1.6rem;
      padding: 0;
      background: #fff;
      color: #c00;
      border: 1px solid #e0a0a0;
      border-radius: 50%;
      font-size: 1rem;
      line-height: 1;
      cursor: pointer;
    }
    .member-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 0.4rem;
      margin: 0.5rem 0 0.25rem;
      min-height: 0;
    }
    .member-chip {
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
      background: #e8f5f3;
      color: #128c7e;
      border: 1px solid #b8e0db;
      border-radius: 999px;
      padding: 0.2rem 0.2rem 0.2rem 0.65rem;
      font-size: 0.85rem;
      font-weight: 600;
      max-width: 100%;
    }
    .member-chip-label {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .member-chip .btn-clear {
      width: 1.35rem;
      height: 1.35rem;
      font-size: 0.9rem;
    }
    .member-hint {
      font-size: 0.8rem;
      color: #666;
      margin: 0.25rem 0 0;
    }
    .logs-section {
      flex: 1;
      display: flex;
      flex-direction: column;
      min-height: 0;
    }
    .logs-title {
      flex-shrink: 0;
      text-align: left;
      font-size: 0.9rem;
      font-weight: 600;
      margin: 0 0 0.5rem;
    }
    #logs {
      flex: 1;
      min-height: 0;
      text-align: left;
      background: #1e1e1e;
      color: #d4d4d4;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.75rem;
      line-height: 1.45;
      padding: 0.75rem 1rem;
      border-radius: 8px;
      overflow-y: auto;
      white-space: pre-wrap;
      word-break: break-word;
      margin: 0;
      border: 1px solid #333;
    }
    @media (max-width: 768px) {
      .app-columns { flex-direction: column; }
      #qr-section { flex: none; width: 100%; min-height: auto; }
      #target-panel { max-height: none; }
    }
  </style>
</head>
<body>
  <header class="app-navbar">
    <div class="navbar-brand">
      WhatsApp Sheets Logger
      <small>Setup &amp; monitoring</small>
    </div>
    <p id="status" class="navbar-center status">Loading…</p>
    <div class="navbar-right" id="navbar-user" hidden>
      <span class="user-pill" title="Logged-in WhatsApp account">
        <span class="user-avatar" id="user-avatar">?</span>
        <span class="user-name" id="user-name">—</span>
      </span>
      <button type="button" class="btn-navbar-logout" id="navbar-logout" title="Unlink this device and show a new QR code">
        Log out everywhere
      </button>
    </div>
  </header>

  <main class="app-main">
    <div class="app-columns">
      <section id="qr-section">
        <strong>WhatsApp login</strong>
        <div class="session-steps" id="session-steps">
          <div class="session-step" data-step="boot">Launch</div>
          <div class="session-step" data-step="qr">Scan QR</div>
          <div class="session-step" data-step="sync">Connect</div>
          <div class="session-step" data-step="ready">Ready</div>
        </div>
        <div class="progress-wrap" id="progress-wrap">
          <div class="progress-meta">
            <span id="progress-label">Starting WhatsApp session…</span>
            <span id="progress-percent">0%</span>
          </div>
          <div class="progress-track">
            <div id="progress-bar" class="progress-bar"></div>
          </div>
        </div>
        <p id="qr-hint">Connecting… QR will appear here in a few seconds.</p>
        <div class="qr-frame" id="qr-frame">
          <div class="qr-skeleton visible" id="qr-skeleton" aria-hidden="true"></div>
          <img id="qr" alt="WhatsApp QR code" width="256" height="256" />
        </div>
        <p id="qr-expiry" class="qr-expiry" hidden></p>
        <p id="qr-connected-badge" class="qr-connected-badge">✓ WhatsApp connected</p>
        <ol id="instructions">
          <li>Open <strong>WhatsApp</strong> on your phone</li>
          <li>Go to <strong>Settings → Linked devices → Link a device</strong></li>
          <li>Scan the QR code above</li>
        </ol>
      </section>

      <section class="panel session-off" id="target-panel">
    <h2>Target messages</h2>
    <p class="session-hint" id="target-session-hint">Scan the QR code to log in, then configure targets here.</p>
    <p id="target-source"></p>
    <p style="font-size:0.85rem;color:#555;margin:0 0 0.75rem;">
      Select a group, then add one or more members to monitor. Or type names manually.
    </p>
    <form id="target-form">
      <div class="field">
        <label>Group</label>
        <div class="btn-row">
          <button type="button" class="btn-secondary" id="load-groups">Load my groups</button>
          <button type="button" class="btn-secondary" id="sync-groups">Sync from phone</button>
        </div>
        <div class="combo-wrap">
          <input id="group-search" placeholder="Search groups…" autocomplete="off" />
          <div id="group-list" class="combo-list" hidden></div>
        </div>
        <div class="pick-row" id="group-pick-row">
          <p id="group-selected" class="selected-pill"></p>
          <button type="button" class="btn-clear" id="clear-group" title="Remove group" aria-label="Remove group">×</button>
        </div>
        <input type="hidden" id="groupId" />
        <input type="hidden" id="groupName" />
      </div>
      <div class="field">
        <label>Members</label>
        <button type="button" class="btn-secondary" id="load-members" disabled>Load members</button>
        <div class="combo-wrap">
          <input id="member-search" placeholder="Search members…" autocomplete="off" disabled />
          <div id="member-list" class="combo-list" hidden></div>
        </div>
        <p class="member-hint">Click a name to add it. You can select more than one.</p>
        <div id="member-chips" class="member-chips"></div>
        <button type="button" class="btn-secondary" id="clear-member" style="margin-top:0.35rem;font-size:0.8rem;">Clear all members</button>
      </div>
      <button type="submit" id="save-targets">Save &amp; apply</button>
      <p id="target-feedback"></p>
      <p id="target-active"></p>
    </form>
      </section>
    </div>

    <section class="logs-section">
      <p class="logs-title">Logs</p>
      <pre id="logs"></pre>
    </section>
  </main>
  <script>
    const token = ${JSON.stringify(token)};
    let logIndex = 0;

    function setStatus(message, status) {
      const el = document.getElementById('status');
      el.textContent = message;
      let cls = 'navbar-center status';
      if (status === 'ready') cls += ' ready';
      else if (status === 'error') cls += ' error';
      el.className = cls;
    }

    function updateNavbar(data) {
      const ready = !!(data.ready || data.status === 'ready');
      const isError = data.status === 'error';
      const user = data.whatsAppUser;
      const statusEl = document.getElementById('status');
      const userBar = document.getElementById('navbar-user');
      const userPill = userBar.querySelector('.user-pill');

      const showBar = ready || isError;
      userBar.hidden = !showBar;
      statusEl.hidden = ready && !!user;

      if (ready && user) {
        userPill.hidden = false;
        document.getElementById('user-name').textContent = user.name;
        document.getElementById('user-avatar').textContent = (user.name || '?').charAt(0).toUpperCase();
        userPill.title = user.userId || user.name;
      } else if (isError) {
        userPill.hidden = true;
      }

      document.querySelector('.app-columns').classList.toggle('logged-in', ready);
    }

    const sourceLabels = {
      env: 'Loaded from .env (restart bot after editing .env)',
      saved: 'Loaded from saved settings (targets.json)',
      'env-ids': 'Using group/user IDs from .env — enter names here or set TARGET_GROUP_NAME in .env'
    };

    let allGroups = [];
    let allMembers = [];
    let selectedMembers = [];
    let whatsAppReady = false;

    function memberKey(item) {
      return String(item.id || item.name || '').trim().toLowerCase();
    }

    function renderMemberChips() {
      const el = document.getElementById('member-chips');
      el.innerHTML = '';
      for (const member of selectedMembers) {
        const chip = document.createElement('span');
        chip.className = 'member-chip';

        const label = document.createElement('span');
        label.className = 'member-chip-label';
        label.textContent = member.name;

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'btn-clear';
        removeBtn.title = 'Remove ' + member.name;
        removeBtn.setAttribute('aria-label', 'Remove ' + member.name);
        removeBtn.textContent = '×';
        removeBtn.addEventListener('click', () => {
          selectedMembers = selectedMembers.filter((item) => memberKey(item) !== memberKey(member));
          renderMemberChips();
        });

        chip.appendChild(label);
        chip.appendChild(removeBtn);
        el.appendChild(chip);
      }
    }

    function addSelectedMember(item) {
      if (selectedMembers.some((member) => memberKey(member) === memberKey(item))) {
        document.getElementById('target-feedback').textContent = item.name + ' is already selected.';
        document.getElementById('target-feedback').className = 'ok';
        return;
      }
      selectedMembers.push({ name: item.name, id: item.id || '' });
      renderMemberChips();
      document.getElementById('member-search').value = '';
      document.getElementById('member-list').hidden = true;
      document.getElementById('target-feedback').textContent = 'Added ' + item.name + '. Add more or click Save.';
      document.getElementById('target-feedback').className = 'ok';
    }

    function isFormFocused() {
      const el = document.activeElement;
      return el && (el.id === 'group-search' || el.id === 'member-search');
    }

    function setChip(el, text) {
      const row = el.closest('.pick-row');
      if (!text) {
        el.textContent = '';
        if (row) row.classList.remove('visible');
        return;
      }
      el.textContent = text;
      if (row) row.classList.add('visible');
    }

    function hasActiveMonitoring() {
      return !!document.getElementById('target-active').textContent.trim();
    }

    async function stopMonitoringOnServer() {
      const res = await fetch('/setup/targets?token=' + encodeURIComponent(token), { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to stop monitoring');
      document.getElementById('target-active').textContent = '';
      return data;
    }

    function clearMemberSelection() {
      selectedMembers = [];
      renderMemberChips();
      document.getElementById('member-search').value = '';
      document.getElementById('member-list').hidden = true;
    }

    async function clearGroupSelection({ stopMonitoring = true } = {}) {
      const hadMonitoring = stopMonitoring && hasActiveMonitoring();
      document.getElementById('groupId').value = '';
      document.getElementById('groupName').value = '';
      setChip(document.getElementById('group-selected'), '');
      document.getElementById('group-search').value = '';
      document.getElementById('group-list').hidden = true;
      allMembers = [];
      clearMemberSelection();
      document.getElementById('load-members').disabled = true;
      document.getElementById('member-search').disabled = true;
      const feedback = document.getElementById('target-feedback');
      if (hadMonitoring) {
        try {
          await stopMonitoringOnServer();
          feedback.textContent = 'Group removed — monitoring stopped.';
          feedback.className = 'ok';
        } catch (err) {
          feedback.textContent = err.message;
          feedback.className = 'err';
        }
      } else {
        feedback.textContent = 'Group removed.';
        feedback.className = 'ok';
      }
    }

    async function clearMemberOnly({ stopMonitoring = true } = {}) {
      const hadMonitoring = stopMonitoring && hasActiveMonitoring();
      clearMemberSelection();
      const feedback = document.getElementById('target-feedback');
      if (hadMonitoring) {
        try {
          await stopMonitoringOnServer();
          feedback.textContent = 'Member removed — monitoring stopped.';
          feedback.className = 'ok';
        } catch (err) {
          feedback.textContent = err.message;
          feedback.className = 'err';
        }
      } else {
        feedback.textContent = 'Member removed.';
        feedback.className = 'ok';
      }
    }

    function setSelection(kind, item) {
      if (kind === 'group') {
        document.getElementById('groupId').value = item.id;
        document.getElementById('groupName').value = item.name;
        setChip(document.getElementById('group-selected'), 'Selected: ' + item.name);
        document.getElementById('group-search').value = '';
        document.getElementById('group-list').hidden = true;
        document.getElementById('load-members').disabled = false;
        document.getElementById('member-search').disabled = false;
        allMembers = [];
        clearMemberSelection();
        loadMembers();
      } else {
        addSelectedMember(item);
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

    async function loadGroups({ refresh = false } = {}) {
      const btn = document.getElementById('load-groups');
      if (btn.disabled) return;
      btn.disabled = true;
      document.getElementById('sync-groups').disabled = true;
      btn.textContent = 'Loading groups…';
      document.getElementById('target-feedback').textContent = 'Loading groups (usually a few seconds)…';
      document.getElementById('target-feedback').className = '';
      try {
        const refreshParam = refresh ? '&refresh=1' : '';
        const res = await fetch('/setup/groups?token=' + encodeURIComponent(token) + refreshParam);
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
        document.getElementById('sync-groups').disabled = !whatsAppReady;
        btn.textContent = allGroups.length ? 'Refresh groups' : 'Load my groups';
      }
    }

    async function syncGroups() {
      const btn = document.getElementById('sync-groups');
      if (btn.disabled) return;
      btn.disabled = true;
      document.getElementById('load-groups').disabled = true;
      btn.textContent = 'Syncing…';
      document.getElementById('target-feedback').textContent =
        'Syncing from WhatsApp on your phone (~10 seconds). New groups appear after this.';
      document.getElementById('target-feedback').className = '';
      try {
        const res = await fetch('/setup/sync?token=' + encodeURIComponent(token), { method: 'POST' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Sync failed');
        document.getElementById('target-feedback').textContent = 'Sync done. Loading groups…';
        document.getElementById('target-feedback').className = 'ok';
        await loadGroups({ refresh: true });
      } catch (err) {
        document.getElementById('target-feedback').textContent = err.message;
        document.getElementById('target-feedback').className = 'err';
      } finally {
        btn.disabled = !whatsAppReady;
        document.getElementById('load-groups').disabled = !whatsAppReady;
        btn.textContent = 'Sync from phone';
      }
    }

    async function loadMembers({ refresh = false } = {}) {
      const groupId = document.getElementById('groupId').value;
      if (!groupId) return;
      const btn = document.getElementById('load-members');
      if (btn.disabled) return;
      btn.disabled = true;
      btn.textContent = 'Loading members…';
      document.getElementById('target-feedback').textContent = 'Loading members (usually a few seconds)…';
      document.getElementById('target-feedback').className = '';
      try {
        const refreshParam = refresh ? '&refresh=1' : '';
        const res = await fetch(
          '/setup/members?token=' + encodeURIComponent(token) + '&groupId=' + encodeURIComponent(groupId) + refreshParam
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to load members');
        allMembers = data.members || [];
        document.getElementById('target-feedback').textContent =
          allMembers.length
            ? 'Found ' + allMembers.length + ' member(s). Search and click to add.'
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
        btn.disabled = !whatsAppReady || !groupId;
        btn.textContent = allMembers.length ? 'Refresh members' : 'Load members';
      }
    }

    document.getElementById('load-groups').addEventListener('click', () => loadGroups());
    document.getElementById('sync-groups').addEventListener('click', syncGroups);
    document.getElementById('load-members').addEventListener('click', () => loadMembers());
    document.getElementById('clear-group').addEventListener('click', () => clearGroupSelection());
    document.getElementById('clear-member').addEventListener('click', () => clearMemberOnly());

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

    function clearTargetForm() {
      document.getElementById('groupName').value = '';
      document.getElementById('groupId').value = '';
      setChip(document.getElementById('group-selected'), '');
      clearMemberSelection();
      document.getElementById('target-active').textContent = '';
      document.getElementById('target-feedback').textContent = '';
      document.getElementById('target-feedback').className = '';
      document.getElementById('group-search').value = '';
      document.getElementById('member-search').value = '';
      document.getElementById('group-list').hidden = true;
      document.getElementById('member-list').hidden = true;
      document.getElementById('load-groups').textContent = 'Load my groups';
      document.getElementById('load-members').textContent = 'Load members';
      document.getElementById('load-members').disabled = true;
      document.getElementById('member-search').disabled = true;
      document.getElementById('load-groups').disabled = true;
      document.getElementById('sync-groups').disabled = true;
      document.getElementById('target-source').textContent =
        'Scan QR, then load groups and pick a member.';
      allGroups = [];
      allMembers = [];
      initialPoll = true;
    }

    function applyTargetData(data, { updateFields = true } = {}) {
      if (updateFields && !isFormFocused()) {
        if (data.groupName) {
          document.getElementById('groupName').value = data.groupName;
          setChip(document.getElementById('group-selected'), 'Selected: ' + data.groupName);
        } else {
          document.getElementById('groupName').value = '';
          setChip(document.getElementById('group-selected'), '');
        }
        if (data.groupId) {
          document.getElementById('groupId').value = data.groupId;
          document.getElementById('load-members').disabled = !whatsAppReady;
          document.getElementById('member-search').disabled = !whatsAppReady;
        } else {
          document.getElementById('groupId').value = '';
          document.getElementById('load-members').disabled = true;
          document.getElementById('member-search').disabled = true;
        }
        if (Array.isArray(data.members) && data.members.length) {
          selectedMembers = data.members.map((member) => ({
            name: member.name,
            id: member.id || ''
          }));
        } else if (data.memberName) {
          selectedMembers = [{ name: data.memberName, id: data.memberId || '' }];
        } else {
          selectedMembers = [];
        }
        renderMemberChips();
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
      } else {
        document.getElementById('target-active').textContent = '';
      }
    }

    async function loadTargets({ updateFields = true } = {}) {
      const res = await fetch('/setup/targets?token=' + encodeURIComponent(token));
      if (!res.ok) return;
      applyTargetData(await res.json(), { updateFields });
    }

    document.getElementById('target-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!whatsAppReady) {
        document.getElementById('target-feedback').textContent = 'Connect WhatsApp first (scan QR above).';
        document.getElementById('target-feedback').className = 'err';
        return;
      }
      const btn = document.getElementById('save-targets');
      const feedback = document.getElementById('target-feedback');
      const groupName = document.getElementById('groupName').value.trim()
        || document.getElementById('group-search').value.trim();
      const groupId = document.getElementById('groupId').value.trim();
      const members = selectedMembers.map((member) => ({
        name: member.name,
        id: member.id || ''
      }));
      const typedMember = document.getElementById('member-search').value.trim();
      if (
        typedMember &&
        !members.some((member) => member.name.toLowerCase() === typedMember.toLowerCase())
      ) {
        members.push({ name: typedMember, id: '' });
      }
      if (!groupName || !members.length) {
        feedback.textContent = 'Select a group and at least one member.';
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
          body: JSON.stringify({ groupName, groupId, members })
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
    let wasReady = false;
    const POLL_MS = 3000;
    const POLL_MS_QR = 1500;
    let pollTimer = null;

    function schedulePoll(status) {
      const ms = status === 'qr' ? POLL_MS_QR : POLL_MS;
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = setInterval(() => tick(), ms);
    }
    const emptyTargets = {
      groupName: '',
      groupId: '',
      members: [],
      source: null,
      monitoring: null
    };

    function setQrSkeleton(visible) {
      document.getElementById('qr-skeleton').classList.toggle('visible', visible);
    }

    function setQrFrameVisible(visible) {
      document.getElementById('qr-frame').style.display = visible ? 'block' : 'none';
    }

    function hideQrImage() {
      const qr = document.getElementById('qr');
      qr.style.display = 'none';
      qr.onload = null;
      qr.onerror = null;
    }

    function loadQrImage() {
      const qr = document.getElementById('qr');
      setQrSkeleton(true);
      hideQrImage();
      qr.onload = () => {
        setQrSkeleton(false);
        qr.style.display = 'block';
      };
      qr.onerror = () => {
        setQrSkeleton(true);
        hideQrImage();
      };
      qr.src = '/setup/qr.png?token=' + encodeURIComponent(token) + '&t=' + (lastQrUpdatedAt || Date.now());
    }

    let lastQrUiStatus = null;
    let lastQrUpdatedAt = null;
    let qrExpiryTimer = null;
    const QR_EXPIRY_MS = ${QR_EXPIRY_MS};

    function clearQrExpiryTimer() {
      if (qrExpiryTimer) {
        clearInterval(qrExpiryTimer);
        qrExpiryTimer = null;
      }
    }

    function formatExpiry(secondsLeft) {
      if (secondsLeft <= 0) return 'QR expired — new code loading…';
      return 'QR expires in ' + secondsLeft + 's';
    }

    function updateQrExpiryUi(qrMeta) {
      const el = document.getElementById('qr-expiry');
      if (!qrMeta || qrMeta.status !== 'qr' || !qrMeta.qrUpdatedAt) {
        el.hidden = true;
        el.textContent = '';
        el.classList.remove('expired', 'soon');
        return;
      }

      el.hidden = false;
      const secondsLeft = Math.max(0, Math.ceil((qrMeta.qrExpiresIn ?? 0) / 1000));
      el.textContent = formatExpiry(secondsLeft);
      el.classList.toggle('expired', !!qrMeta.qrExpired);
      el.classList.toggle('soon', !qrMeta.qrExpired && secondsLeft > 0 && secondsLeft <= 10);

      const qr = document.getElementById('qr');
      qr.classList.toggle('expired', !!qrMeta.qrExpired);
    }

    function startQrExpiryTimer(qrMeta) {
      clearQrExpiryTimer();
      if (!qrMeta || qrMeta.status !== 'qr' || !qrMeta.qrUpdatedAt) return;

      updateQrExpiryUi(qrMeta);
      qrExpiryTimer = setInterval(() => {
        const elapsed = Date.now() - qrMeta.qrUpdatedAt;
        const expiresIn = Math.max(0, QR_EXPIRY_MS - elapsed);
        const expired = expiresIn <= 0;
        updateQrExpiryUi({
          status: 'qr',
          qrUpdatedAt: qrMeta.qrUpdatedAt,
          qrExpiresIn: expiresIn,
          qrExpired: expired
        });
        if (expired) tick();
      }, 1000);
    }

    function updateStepsUi(status, progress) {
      const order = ['boot', 'qr', 'sync', 'ready'];
      let activeIndex = {
        starting: 0,
        loading: 0,
        qr: 1,
        authenticated: 2,
        ready: 3,
        error: -1
      }[status] ?? -1;

      if (status === 'loading' && typeof progress === 'number' && progress >= 100) {
        activeIndex = 2;
      }

      for (const el of document.querySelectorAll('.session-step')) {
        const idx = order.indexOf(el.dataset.step);
        el.classList.remove('active', 'done');
        if (activeIndex < 0) continue;
        if (idx < activeIndex) el.classList.add('done');
        else if (idx === activeIndex) el.classList.add('active');
      }
    }

    function updateProgressUi(status, progress, message) {
      const wrap = document.getElementById('progress-wrap');
      const bar = document.getElementById('progress-bar');
      const label = document.getElementById('progress-label');
      const pctEl = document.getElementById('progress-percent');

      if (status === 'ready' || status === 'error') {
        wrap.hidden = true;
        bar.classList.remove('indeterminate');
        return;
      }

      wrap.hidden = false;
      let percent = null;
      let indeterminate = false;
      let labelText = message || '';

      if (status === 'starting') {
        percent = typeof progress === 'number' ? progress : 0;
        labelText = message || 'Starting WhatsApp session…';
      } else if (status === 'loading') {
        percent = typeof progress === 'number' ? progress : 0;
        if (percent >= 100) {
          indeterminate = true;
          labelText = message || 'QR scanned — syncing account…';
        } else {
          labelText = message || 'Loading WhatsApp…';
        }
      } else if (status === 'qr') {
        bar.classList.remove('indeterminate');
        bar.style.width = '100%';
        pctEl.textContent = 'Scan';
        label.textContent = message || 'QR ready — scan with your phone';
        return;
      } else if (status === 'authenticated') {
        percent = 100;
        indeterminate = true;
        labelText = message || 'QR scanned — syncing account…';
      }

      bar.classList.toggle('indeterminate', indeterminate);
      if (indeterminate) {
        pctEl.textContent = '…';
      } else if (percent != null) {
        bar.style.width = Math.max(0, Math.min(100, percent)) + '%';
        pctEl.textContent = Math.round(percent) + '%';
      } else {
        bar.style.width = '0%';
        pctEl.textContent = '';
      }
      label.textContent = labelText;
    }

    function updateQrUi(status, message, qrMeta) {
      const statusChanged = status !== lastQrUiStatus;
      lastQrUiStatus = status;
      const section = document.getElementById('qr-section');
      const hint = document.getElementById('qr-hint');
      const instructions = document.getElementById('instructions');
      const connectedBadge = document.getElementById('qr-connected-badge');
      const showScanSteps = status === 'starting' || status === 'loading' || status === 'authenticated' || status === 'qr';
      const booting = status === 'starting' || (status === 'loading' && (qrMeta?.progress ?? 0) < 100);

      section.classList.toggle('is-connected', status === 'ready');
      connectedBadge.classList.toggle('visible', false);

      if (status === 'qr') {
        hint.textContent = qrMeta?.qrExpired
          ? 'QR expired — a fresh code will appear shortly.'
          : (message || 'Scan this QR code with your phone:');
        setQrFrameVisible(true);
        connectedBadge.classList.remove('visible');

        const qrUpdatedAt = qrMeta?.qrUpdatedAt || null;
        if (qrUpdatedAt && qrUpdatedAt !== lastQrUpdatedAt) {
          lastQrUpdatedAt = qrUpdatedAt;
          loadQrImage();
        } else if (statusChanged && qrUpdatedAt) {
          loadQrImage();
        }

        startQrExpiryTimer(qrMeta || { status: 'qr', qrUpdatedAt, qrExpiresIn: QR_EXPIRY_MS, qrExpired: false });
      } else {
        clearQrExpiryTimer();
        document.getElementById('qr-expiry').hidden = true;
        document.getElementById('qr').classList.remove('expired');

        if (booting) {
          hint.textContent = message || 'Connecting… QR will appear here in a few seconds.';
          setQrFrameVisible(true);
          setQrSkeleton(true);
          hideQrImage();
          connectedBadge.classList.remove('visible');
        } else if (status === 'loading' && typeof qrMeta?.progress === 'number' && qrMeta.progress >= 100) {
          hint.textContent = message || 'QR scanned! Syncing account…';
          setQrFrameVisible(false);
          setQrSkeleton(false);
          hideQrImage();
          connectedBadge.classList.remove('visible');
        } else if (status === 'authenticated') {
          hint.textContent = message || 'QR scanned! Finishing login…';
          setQrFrameVisible(false);
          setQrSkeleton(false);
          hideQrImage();
          connectedBadge.classList.remove('visible');
        } else if (status === 'ready') {
          hint.textContent = message || 'Connected.';
          setQrFrameVisible(false);
          setQrSkeleton(false);
          hideQrImage();
        } else if (status === 'error') {
          hint.textContent = message || 'Login error. Use Log out everywhere in the navbar.';
          setQrFrameVisible(true);
          setQrSkeleton(true);
          hideQrImage();
          connectedBadge.classList.remove('visible');
        }
      }

      instructions.style.display = showScanSteps ? 'block' : 'none';
    }

    function buildQrMeta(data) {
      return {
        status: data.status,
        progress: data.progress,
        qrUpdatedAt: data.qrUpdatedAt || null,
        qrExpiresIn: data.qrExpiresIn ?? null,
        qrExpired: !!data.qrExpired
      };
    }

    function updateSessionState(data) {
      const status = data.status || 'starting';
      const message = data.message || '';
      const qrMeta = buildQrMeta(data);
      setStatus(message, status);
      updateNavbar(data);
      updateStepsUi(status, data.progress);
      updateProgressUi(status, data.progress, message);
      updateQrUi(status, message, qrMeta);
      schedulePoll(status);
    }

    async function doLogout({ fast = true } = {}) {
      const btn = document.getElementById('navbar-logout');
      btn.disabled = true;
      whatsAppReady = false;
      clearTargetForm();
      lastQrUiStatus = null;
      lastQrUpdatedAt = null;
      clearQrExpiryTimer();
      updateSessionState({
        status: 'starting',
        message: fast
          ? 'Logging out everywhere (fast)…'
          : 'Logging out from WhatsApp… this may take up to 25 seconds.',
        progress: 0,
        ready: false,
        whatsAppUser: null
      });
      try {
        const fastParam = fast ? '&fast=1' : '';
        const res = await fetch(
          '/setup/logout?token=' + encodeURIComponent(token) + fastParam,
          { method: 'POST' }
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Logout failed');
      } catch (err) {
        setStatus(err.message, 'error');
        document.getElementById('status').hidden = false;
      } finally {
        btn.disabled = false;
      }
    }

    document.getElementById('navbar-logout').addEventListener('click', () => doLogout({ fast: true }));

    async function tick() {
      if (tickInFlight) return;
      tickInFlight = true;
      try {
        const res = await fetch(
          '/setup/poll?token=' + encodeURIComponent(token) + '&since=' + logIndex
        );
        if (!res.ok) return;
        const data = await res.json();

        updateSessionState(data);
        const ready = data.ready || data.status === 'ready';
        whatsAppReady = ready;
        document.getElementById('target-panel').classList.toggle('session-off', !ready);
        document.getElementById('load-groups').disabled = !ready;
        document.getElementById('sync-groups').disabled = !ready;

        if (!ready) {
          applyTargetData(emptyTargets, { updateFields: !isFormFocused() });
          initialPoll = true;
          wasReady = false;
        } else if (data.targets) {
          applyTargetData(data.targets, { updateFields: initialPoll || !wasReady });
          initialPoll = false;
          wasReady = true;
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

    updateSessionState({
      status: 'starting',
      message: 'Starting WhatsApp session…',
      progress: 0
    });
    tick();
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
  onClearTargets,
  onLogout,
  onListGroups,
  onListMembers,
  onSyncCatalog,
  isWhatsAppReady,
  getWhatsAppUser
}) {
  let currentQr = null;
  let qrUpdatedAt = null;
  let status = 'starting';
  let statusMessage = 'Starting WhatsApp client...';
  let loadPercent = 0;
  let monitoring = null;
  let server = null;
  const logs = [];

  function buildQrPollMeta() {
    if (!currentQr || !qrUpdatedAt) {
      return { qrUpdatedAt: null, qrExpiresIn: null, qrExpired: false };
    }
    const elapsed = Date.now() - qrUpdatedAt;
    const qrExpiresIn = Math.max(0, QR_EXPIRY_MS - elapsed);
    return {
      qrUpdatedAt,
      qrExpiresIn,
      qrExpired: elapsed >= QR_EXPIRY_MS
    };
  }

  function buildStatusPayload(extra = {}) {
    return {
      status,
      message: statusMessage,
      progress: loadPercent,
      ...buildQrPollMeta(),
      ...extra
    };
  }

  const app = express();
  app.use(express.json());

  function checkToken(req, res, next) {
    const provided = req.query.token || req.headers['x-setup-token'];
    if (!token || provided !== token) {
      return res.status(401).type('text/plain').send('Unauthorized — invalid or missing setup token.');
    }
    next();
  }

  function isWhatsAppConnected() {
    return isWhatsAppReady ? isWhatsAppReady() : status === 'ready';
  }

  function buildTargetsResponse() {
    if (!isWhatsAppConnected()) {
      return {
        groupName: '',
        groupId: '',
        members: [],
        source: null,
        monitoring: null
      };
    }

    const targets = getTargets ? getTargets() : null;
    const members = targets?.members || [];
    return {
      groupName: targets?.groupName || '',
      groupId: targets?.groupId || '',
      members,
      memberName: memberLabels(members),
      source: targets?.source || null,
      monitoring
    };
  }

  function clearSessionState(message) {
    monitoring = null;
    currentQr = null;
    qrUpdatedAt = null;
    status = 'starting';
    statusMessage = message || 'Session cleared. Waiting for new QR code...';
    loadPercent = 0;
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
    const ready = isWhatsAppReady ? isWhatsAppReady() : status === 'ready';
    res.json({
      ...buildStatusPayload(),
      monitoring,
      ready,
      whatsAppUser: ready && getWhatsAppUser ? getWhatsAppUser() : null
    });
  });

  app.get('/setup/groups', checkToken, async (req, res) => {
    if (!onListGroups) {
      return res.status(503).json({ error: 'Group list is not configured.' });
    }
    try {
      const refresh = req.query.refresh === '1' || req.query.refresh === 'true';
      const result = await onListGroups({ refresh });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message, ready: isWhatsAppReady?.() || false, groups: [] });
    }
  });

  app.post('/setup/sync', checkToken, async (req, res) => {
    if (!onSyncCatalog) {
      return res.status(503).json({ error: 'Sync is not configured.' });
    }
    try {
      const result = await onSyncCatalog();
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
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
      const refresh = req.query.refresh === '1' || req.query.refresh === 'true';
      const members = await onListMembers(groupId, { refresh });
      res.json({ members });
    } catch (err) {
      res.status(500).json({ error: err.message, members: [] });
    }
  });

  app.get('/setup/targets', checkToken, (req, res) => {
    res.json(buildTargetsResponse());
  });

  app.delete('/setup/targets', checkToken, async (req, res) => {
    if (!onClearTargets) {
      return res.status(503).json({ error: 'Clear targets is not configured.' });
    }
    try {
      const result = await onClearTargets();
      monitoring = null;
      res.json({ ok: true, monitoring: result?.monitoring || null });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/setup/targets', checkToken, async (req, res) => {
    if (!isWhatsAppConnected()) {
      return res.status(503).json({ error: 'Connect WhatsApp first (scan QR above).' });
    }

    const groupName = req.body?.groupName?.trim();
    const groupId = req.body?.groupId?.trim() || '';
    const members = normalizeMembers(
      req.body?.members,
      req.body?.memberName,
      req.body?.memberId
    );

    if (!groupName || !members.length) {
      return res.status(400).json({ error: 'Group and at least one member are required.' });
    }

    if (!onSaveTargets) {
      return res.status(503).json({ error: 'Target saving is not configured.' });
    }

    try {
      const result = await onSaveTargets(groupName, groupId, members);
      res.json({
        ok: true,
        groupName,
        groupId,
        members,
        memberName: memberLabels(members),
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
    const ready = isWhatsAppConnected();
    res.json({
      ...buildStatusPayload(),
      ready,
      whatsAppUser: ready && getWhatsAppUser ? getWhatsAppUser() : null,
      monitoring: ready ? monitoring : null,
      targets: buildTargetsResponse(),
      logs: { logs: logs.slice(since), total: logs.length }
    });
  });

  app.post('/setup/logout', checkToken, async (req, res) => {
    if (!onLogout) {
      return res.status(503).json({ error: 'Logout is not configured.' });
    }
    const fast = req.query.fast === '1' || req.query.fast === 'true' || req.body?.fast === true;
    try {
      clearSessionState(fast ? 'Fast logout — clearing session…' : 'Clearing session…');
      await onLogout({ fast });
      res.json({ ok: true, targetsCleared: true, fast });
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
    clearSessionState,
    setMonitoring(info) {
      monitoring = info;
    },
    setStarting(message) {
      currentQr = null;
      qrUpdatedAt = null;
      status = 'starting';
      statusMessage = message || 'Starting WhatsApp client...';
      loadPercent = 0;
    },
    setLoading(percent, message) {
      if (status === 'authenticated' || status === 'ready') return;
      loadPercent = Math.max(0, Math.min(100, Number(percent) || 0));
      statusMessage = message || `Loading WhatsApp ${loadPercent}%…`;
      if (loadPercent >= 100) {
        currentQr = null;
        qrUpdatedAt = null;
        status = 'authenticated';
        if (!statusMessage.includes('sync')) {
          statusMessage = 'QR scanned — syncing account…';
        }
        return;
      }
      status = 'loading';
    },
    setQr(qr) {
      if (currentQr !== qr) {
        currentQr = qr;
        qrUpdatedAt = Date.now();
      }
      status = 'qr';
      statusMessage = 'Scan this QR code with WhatsApp on your phone.';
      loadPercent = 100;
    },
    setAuthenticated(message) {
      currentQr = null;
      qrUpdatedAt = null;
      status = 'authenticated';
      statusMessage = message || 'Authenticated. Finishing connection...';
      loadPercent = 100;
    },
    setReady(message) {
      currentQr = null;
      qrUpdatedAt = null;
      status = 'ready';
      statusMessage = message || 'Connected. Set targets below if needed.';
      loadPercent = null;
    },
    setWaitingTargets() {
      currentQr = null;
      qrUpdatedAt = null;
      status = 'ready';
      statusMessage = 'Connected. Enter group and member name below, then Save.';
      loadPercent = null;
    },
    setError(message) {
      currentQr = null;
      qrUpdatedAt = null;
      status = 'error';
      statusMessage = message;
      loadPercent = null;
    }
  };
}

module.exports = { createSetupServer };
