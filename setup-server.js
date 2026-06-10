const express = require('express');
const QRCode = require('qrcode');
const { normalizeMembers, memberLabels } = require('./target-config');

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

  <section class="panel session-off" id="target-panel">
    <h2>Target messages</h2>
    <p class="session-hint" id="target-session-hint">Log in with WhatsApp above to configure targets.</p>
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
    const emptyTargets = {
      groupName: '',
      groupId: '',
      members: [],
      source: null,
      monitoring: null
    };

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
      whatsAppReady = false;
      clearTargetForm();
      updateQrUi('starting');
      document.getElementById('qr-hint').textContent = 'Clearing session… new QR coming soon.';
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
  onClearTargets,
  onLogout,
  onListGroups,
  onListMembers,
  onSyncCatalog,
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
    status = 'starting';
    statusMessage = message || 'Session cleared. Waiting for new QR code...';
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
      status,
      message: statusMessage,
      ready,
      monitoring: ready ? monitoring : null,
      targets: buildTargetsResponse(),
      logs: { logs: logs.slice(since), total: logs.length }
    });
  });

  app.post('/setup/logout', checkToken, async (req, res) => {
    if (!onLogout) {
      return res.status(503).json({ error: 'Logout is not configured.' });
    }
    try {
      clearSessionState('Clearing session…');
      await onLogout();
      res.json({ ok: true, targetsCleared: true });
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
