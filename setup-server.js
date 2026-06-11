const fs = require('fs');
const path = require('path');
const express = require('express');
const QRCode = require('qrcode');
const { normalizeMembers, memberLabels } = require('./target-config');

const APPS_SCRIPT_PATH = path.join(__dirname, 'google-apps-script', 'Code.gs');

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
    .portions-toolbar {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      margin-bottom: 0.75rem;
    }
    .portions-toolbar .btn-secondary { margin-bottom: 0; }
    #add-portion {
      margin-left: auto;
      background: #128c7e;
      color: #fff;
      border: none;
    }
    #add-portion:hover { background: #0d6b60; }
    .portions-list {
      display: flex;
      flex-direction: column;
      gap: 1rem;
      margin-bottom: 1rem;
    }
    .portion-card {
      border: 1px solid #d8e0de;
      border-radius: 10px;
      padding: 1rem;
      background: #f8fbfa;
    }
    .portion-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
      margin-bottom: 0.75rem;
    }
    .portion-title {
      margin: 0;
      font-size: 0.95rem;
      font-weight: 600;
      color: #128c7e;
    }
    .btn-remove-portion {
      flex-shrink: 0;
      padding: 0.3rem 0.65rem;
      font-size: 0.8rem;
      background: #fff;
      color: #c00;
      border: 1px solid #e0a0a0;
      border-radius: 6px;
      cursor: pointer;
    }
    .btn-remove-portion:hover { background: #fff5f5; }
    .webhook-input {
      width: 100%;
      padding: 0.5rem 0.6rem;
      border: 1px solid #ccc;
      border-radius: 6px;
      font-size: 0.9rem;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    }
    .webhook-hint {
      font-size: 0.75rem;
      color: #777;
      margin: 0.35rem 0 0;
    }
    .portions-empty {
      font-size: 0.85rem;
      color: #888;
      margin: 0 0 0.75rem;
      padding: 0.75rem;
      border: 1px dashed #ccc;
      border-radius: 8px;
      text-align: center;
    }
    #target-active {
      font-size: 0.85rem;
      color: #2a7;
      margin-top: 0.5rem;
    }
    #target-active .active-line {
      margin: 0.2rem 0;
    }
    .sheet-setup-guide {
      margin: 0 0 1rem;
      border: 1px solid #b8e0db;
      border-radius: 10px;
      background: #f3faf8;
      overflow: hidden;
    }
    .sheet-setup-guide summary {
      cursor: pointer;
      padding: 0.65rem 0.85rem;
      font-weight: 600;
      font-size: 0.9rem;
      color: #0d6b60;
      list-style: none;
    }
    .sheet-setup-guide summary::-webkit-details-marker { display: none; }
    .sheet-setup-body {
      padding: 0 0.85rem 0.85rem;
      font-size: 0.82rem;
      color: #444;
      line-height: 1.5;
    }
    .sheet-setup-body ol {
      margin: 0.5rem 0 0.75rem 1.1rem;
      padding: 0;
    }
    .sheet-setup-body li { margin-bottom: 0.45rem; }
    .sheet-setup-body strong { color: #1a4d45; }
    .sheet-setup-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      margin-top: 0.5rem;
    }
    .logs-section {
      flex: 1;
      display: flex;
      flex-direction: column;
      min-height: 12rem;
    }
    .logs-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
      flex-shrink: 0;
      margin-bottom: 0.5rem;
    }
    .logs-title {
      text-align: left;
      font-size: 0.9rem;
      font-weight: 600;
      margin: 0;
    }
    .btn-logs-expand {
      display: none;
      background: #fff;
      color: #128c7e;
      border: 1px solid #128c7e;
      border-radius: 6px;
      padding: 0.3rem 0.55rem;
      font-size: 0.72rem;
      font-weight: 600;
      cursor: pointer;
      white-space: nowrap;
    }
    #logs {
      flex: 1;
      min-height: 10rem;
      text-align: left;
      background: #1e1e1e;
      color: #d4d4d4;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.75rem;
      line-height: 1.45;
      padding: 0.75rem 1rem;
      border-radius: 8px;
      overflow-y: auto;
      overflow-x: auto;
      -webkit-overflow-scrolling: touch;
      white-space: pre-wrap;
      word-break: break-word;
      margin: 0;
      border: 1px solid #333;
    }
    .logs-section.expanded #logs {
      position: fixed;
      inset: 0;
      z-index: 200;
      max-height: none;
      min-height: 0;
      border-radius: 0;
      padding: 3rem 0.75rem 1rem;
      font-size: 0.8rem;
    }
    .logs-section.expanded .btn-logs-expand::after { content: 'Close'; }
    .logs-section.expanded .btn-logs-expand { display: inline-block; position: fixed; top: 0.65rem; right: 0.75rem; z-index: 201; }
    .logs-section.expanded .logs-header .logs-title { position: fixed; top: 0.7rem; left: 0.75rem; z-index: 201; color: #fff; }
    @media (max-width: 768px) {
      html, body {
        height: auto;
        min-height: 100%;
        overflow-x: hidden;
        overflow-y: auto;
        max-width: 100%;
        -webkit-overflow-scrolling: touch;
      }
      body {
        display: block;
        min-height: 100vh;
        min-height: 100dvh;
      }
      .app-navbar {
        position: sticky;
        top: 0;
        z-index: 50;
      }
      .app-main {
        display: block;
        min-height: auto;
        padding-bottom: calc(1.25rem + env(safe-area-inset-bottom, 0px));
      }
      .app-columns {
        flex-shrink: 1;
      }
      .app-navbar {
        flex-wrap: wrap;
        align-items: flex-start;
        padding: 0.55rem 0.75rem;
        gap: 0.45rem;
      }
      .navbar-brand {
        white-space: normal;
        font-size: 0.88rem;
        flex: 1 1 auto;
        min-width: 0;
        max-width: calc(100% - 8rem);
      }
      .navbar-brand small { font-size: 0.68rem; }
      .navbar-center {
        order: 4;
        flex: 1 1 100%;
        text-align: left;
        font-size: 0.78rem;
      }
      .navbar-right {
        flex: 1 1 100%;
        flex-basis: 100%;
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 0.4rem;
        max-width: 100%;
      }
      .user-pill {
        flex: 1 1 auto;
        min-width: 0;
        max-width: calc(100% - 7.5rem);
        font-size: 0.76rem;
      }
      .btn-navbar-logout {
        flex: 0 1 auto;
        max-width: 7.25rem;
        white-space: normal;
        text-align: center;
        padding: 0.4rem 0.5rem;
        font-size: 0.7rem;
        line-height: 1.2;
      }
      .app-main {
        padding: 0.65rem 0.75rem calc(1.5rem + env(safe-area-inset-bottom, 0px));
        gap: 0.75rem;
        width: 100%;
        max-width: 100vw;
      }
      .app-columns {
        flex-direction: column;
        width: 100%;
        max-width: 100%;
      }
      #qr-section {
        flex: none;
        width: 100%;
        min-height: auto;
        max-width: 100%;
      }
      .qr-frame {
        width: min(256px, calc(100vw - 3rem));
        height: min(256px, calc(100vw - 3rem));
        max-width: 100%;
      }
      #qr {
        width: 100%;
        height: 100%;
        max-width: 256px;
        max-height: 256px;
      }
      #target-panel {
        max-height: none;
        width: 100%;
        max-width: 100%;
        padding: 0.85rem;
      }
      .panel { max-width: 100%; }
      .portions-toolbar {
        flex-direction: column;
        align-items: stretch;
      }
      .portions-toolbar .btn-secondary,
      #add-portion,
      #save-targets {
        width: 100%;
        margin-left: 0;
      }
      .portion-card { padding: 0.75rem; }
      .portion-header {
        flex-wrap: wrap;
        gap: 0.4rem;
      }
      .btn-remove-portion { width: 100%; text-align: center; }
      .webhook-input {
        font-size: 0.8rem;
        word-break: break-all;
      }
      .sheet-setup-guide summary {
        font-size: 0.8rem;
        line-height: 1.35;
        padding: 0.6rem 0.7rem;
      }
      .sheet-setup-body { font-size: 0.78rem; }
      .combo-list { max-height: 160px; }
      .logs-section {
        min-height: auto;
        margin-top: 0.75rem;
        padding-bottom: env(safe-area-inset-bottom, 0px);
      }
      .logs-header { margin-bottom: 0.4rem; }
      .btn-logs-expand { display: inline-block; }
      .btn-logs-expand::after { content: 'Expand'; }
      #logs {
        font-size: 0.72rem;
        min-height: 16rem;
        max-height: min(55vh, 22rem);
        flex: none;
      }
    }
    @media (max-width: 420px) {
      .navbar-right {
        flex-direction: column;
        align-items: stretch;
      }
      .user-pill,
      .btn-navbar-logout {
        max-width: 100%;
        width: 100%;
        justify-content: center;
      }
      .btn-navbar-logout { max-width: 100%; }
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
        <h2>Configurations</h2>
        <p class="session-hint" id="target-session-hint">Scan the QR code to log in, then add configurations here.</p>
        <p id="target-source"></p>
        <p style="font-size:0.85rem;color:#555;margin:0 0 0.75rem;">
          Each configuration logs one group + member(s) to its own Google Sheet. One sheet per group is recommended.
        </p>
        <details class="sheet-setup-guide" id="sheet-setup-guide">
          <summary>First time? How to connect a Google Sheet (6 steps)</summary>
          <div class="sheet-setup-body">
            <ol>
              <li><strong>Create a Google Sheet</strong> — go to <a href="https://sheets.google.com" target="_blank" rel="noopener">sheets.google.com</a> → Blank spreadsheet. Name it (e.g. “WhatsApp – Test group”).</li>
              <li><strong>Open Apps Script</strong> — in that sheet: <strong>Extensions → Apps Script</strong>.</li>
              <li><strong>Paste our script</strong> — delete any code in the editor, click <strong>Copy script</strong> below, paste, then <strong>Save</strong> (disk icon).</li>
              <li><strong>Run once</strong> — in the function dropdown choose <strong>setupSheetHeaders</strong> → click <strong>Run</strong> (▶) → allow permissions. Row 1 gets column headers.</li>
              <li><strong>Deploy</strong> — <strong>Deploy → New deployment</strong> → type <strong>Web app</strong> → Execute as: <strong>Me</strong> → Who has access: <strong>Anyone</strong> → Deploy → copy the <strong>Web app URL</strong> (ends in <code>/exec</code>).</li>
              <li><strong>Paste in this page</strong> — click <strong>+ Add</strong>, pick group and member, paste the URL into <strong>Google Sheets webhook URL</strong>, then <strong>Save all &amp; apply</strong>.</li>
            </ol>
            <p style="margin:0.35rem 0 0;font-size:0.78rem;color:#666;">
              Test the URL in a browser: you should see “WhatsApp Sheets Logger webhook is running.” If you see a Google sign-in page, redeploy with <strong>Anyone</strong> (not “Anyone with Google account”).
            </p>
            <div class="sheet-setup-actions">
              <button type="button" class="btn-secondary" id="copy-apps-script">Copy script</button>
              <span id="copy-script-feedback" style="font-size:0.8rem;color:#128c7e;"></span>
            </div>
          </div>
        </details>
        <div class="portions-toolbar">
          <button type="button" class="btn-secondary" id="load-groups">Load my groups</button>
          <button type="button" class="btn-secondary" id="sync-groups">Sync from phone</button>
          <button type="button" id="add-portion">+ Add</button>
        </div>
        <div id="portions-list" class="portions-list"></div>
        <p id="portions-empty" class="portions-empty">No configurations yet. Click <strong>+ Add</strong> to create one.</p>
        <button type="button" id="save-targets">Save all &amp; apply</button>
        <p id="target-feedback"></p>
        <div id="target-active"></div>
      </section>
    </div>

    <section class="logs-section" id="logs-section">
      <div class="logs-header">
        <p class="logs-title">Logs</p>
        <button type="button" class="btn-logs-expand" id="logs-expand" aria-label="Expand logs fullscreen"></button>
      </div>
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
    let portions = [];
    let defaultWebhookUrl = '';
    let whatsAppReady = false;
    let suppressPortionRender = false;

    function newPortionId() {
      return 'p-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9);
    }

    function memberKey(item) {
      return String(item.id || item.name || '').trim().toLowerCase();
    }

    function getPortion(id) {
      return portions.find((portion) => portion.id === id);
    }

    function createPortion(partial = {}) {
      return {
        id: partial.id || newPortionId(),
        groupId: partial.groupId || '',
        groupName: partial.groupName || '',
        members: Array.isArray(partial.members)
          ? partial.members.map((member) => ({ name: member.name, id: member.id || '' }))
          : [],
        webhookUrl: partial.webhookUrl || '',
        allMembers: []
      };
    }

    function syncPortionFromCard(portion, card) {
      portion.groupId = card.querySelector('.group-id').value.trim();
      portion.groupName = card.querySelector('.group-name').value.trim()
        || card.querySelector('.group-search').value.trim();
      portion.webhookUrl = card.querySelector('.webhook-url').value.trim();
      const typedMember = card.querySelector('.member-search').value.trim();
      if (
        typedMember &&
        !portion.members.some((member) => member.name.toLowerCase() === typedMember.toLowerCase())
      ) {
        portion.members.push({ name: typedMember, id: '' });
        card.querySelector('.member-search').value = '';
      }
    }

    function syncAllPortionsFromDom() {
      for (const portion of portions) {
        const card = document.querySelector('.portion-card[data-portion-id="' + portion.id + '"]');
        if (card) syncPortionFromCard(portion, card);
      }
    }

    function isFormFocused() {
      const el = document.activeElement;
      return el && (el.classList.contains('group-search') || el.classList.contains('member-search') || el.classList.contains('webhook-url'));
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

    function renderMemberChips(portion, card) {
      const el = card.querySelector('.member-chips');
      el.innerHTML = '';
      for (const member of portion.members) {
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
          portion.members = portion.members.filter((item) => memberKey(item) !== memberKey(member));
          renderMemberChips(portion, card);
        });

        chip.appendChild(label);
        chip.appendChild(removeBtn);
        el.appendChild(chip);
      }
    }

    function addMemberToPortion(portion, card, item) {
      if (portion.members.some((member) => memberKey(member) === memberKey(item))) {
        setFeedback(item.name + ' is already selected in this configuration.', 'ok');
        return;
      }
      portion.members.push({ name: item.name, id: item.id || '' });
      renderMemberChips(portion, card);
      card.querySelector('.member-search').value = '';
      card.querySelector('.member-list').hidden = true;
    }

    function selectGroupForPortion(portion, card, item) {
      portion.groupId = item.id;
      portion.groupName = item.name;
      portion.allMembers = [];
      portion.members = [];
      card.querySelector('.group-id').value = item.id;
      card.querySelector('.group-name').value = item.name;
      setChip(card.querySelector('.group-selected'), 'Selected: ' + item.name);
      card.querySelector('.group-search').value = '';
      card.querySelector('.group-list').hidden = true;
      card.querySelector('.load-members').disabled = !whatsAppReady;
      card.querySelector('.member-search').disabled = !whatsAppReady;
      renderMemberChips(portion, card);
      loadMembersForPortion(portion, card);
    }

    function clearGroupForPortion(portion, card) {
      portion.groupId = '';
      portion.groupName = '';
      portion.allMembers = [];
      portion.members = [];
      card.querySelector('.group-id').value = '';
      card.querySelector('.group-name').value = '';
      setChip(card.querySelector('.group-selected'), '');
      card.querySelector('.group-search').value = '';
      card.querySelector('.group-list').hidden = true;
      card.querySelector('.load-members').disabled = true;
      card.querySelector('.member-search').disabled = true;
      card.querySelector('.member-search').value = '';
      card.querySelector('.member-list').hidden = true;
      renderMemberChips(portion, card);
    }

    function buildPortionCard(portion, index) {
      const card = document.createElement('div');
      card.className = 'portion-card';
      card.dataset.portionId = portion.id;

      const header = document.createElement('div');
      header.className = 'portion-header';
      const title = document.createElement('h3');
      title.className = 'portion-title';
      title.textContent = 'Configuration ' + (index + 1);
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'btn-remove-portion';
      removeBtn.textContent = 'Remove';
      removeBtn.addEventListener('click', () => removePortion(portion.id));
      header.appendChild(title);
      header.appendChild(removeBtn);
      card.appendChild(header);

      const groupField = document.createElement('div');
      groupField.className = 'field';
      groupField.innerHTML =
        '<label>WhatsApp group</label>' +
        '<div class="combo-wrap">' +
        '<input class="group-search" placeholder="Search groups…" autocomplete="off" />' +
        '<div class="combo-list group-list" hidden></div></div>' +
        '<div class="pick-row">' +
        '<p class="selected-pill group-selected"></p>' +
        '<button type="button" class="btn-clear clear-group" title="Remove group" aria-label="Remove group">×</button>' +
        '</div>' +
        '<input type="hidden" class="group-id" />' +
        '<input type="hidden" class="group-name" />';
      card.appendChild(groupField);

      const memberField = document.createElement('div');
      memberField.className = 'field';
      memberField.innerHTML =
        '<label>Target person(s)</label>' +
        '<button type="button" class="btn-secondary load-members" disabled>Load members</button>' +
        '<div class="combo-wrap">' +
        '<input class="member-search" placeholder="Search members…" autocomplete="off" disabled />' +
        '<div class="combo-list member-list" hidden></div></div>' +
        '<p class="member-hint">Click a name to add it. You can select more than one.</p>' +
        '<div class="member-chips"></div>' +
        '<button type="button" class="btn-secondary clear-members" style="margin-top:0.35rem;font-size:0.8rem;">Clear all members</button>';
      card.appendChild(memberField);

      const webhookField = document.createElement('div');
      webhookField.className = 'field';
      const webhookLabel = document.createElement('label');
      webhookLabel.textContent = 'Google Sheets webhook URL';
      const webhookInput = document.createElement('input');
      webhookInput.type = 'url';
      webhookInput.className = 'webhook-url webhook-input';
      webhookInput.placeholder = defaultWebhookUrl || 'https://script.google.com/macros/s/.../exec';
      webhookInput.value = portion.webhookUrl || '';
      webhookInput.addEventListener('input', () => {
        portion.webhookUrl = webhookInput.value.trim();
      });
      const webhookHint = document.createElement('p');
      webhookHint.className = 'webhook-hint';
      webhookHint.textContent = defaultWebhookUrl
        ? 'Leave blank to use the default from .env (WEBHOOK_URL).'
        : 'Paste your Apps Script web app URL for this sheet.';
      webhookField.appendChild(webhookLabel);
      webhookField.appendChild(webhookInput);
      webhookField.appendChild(webhookHint);
      card.appendChild(webhookField);

      if (portion.groupId) card.querySelector('.group-id').value = portion.groupId;
      if (portion.groupName) {
        card.querySelector('.group-name').value = portion.groupName;
        setChip(card.querySelector('.group-selected'), 'Selected: ' + portion.groupName);
        card.querySelector('.load-members').disabled = !whatsAppReady;
        card.querySelector('.member-search').disabled = !whatsAppReady;
      }
      renderMemberChips(portion, card);

      const groupSearch = card.querySelector('.group-search');
      const groupList = card.querySelector('.group-list');
      groupSearch.addEventListener('input', (e) => {
        renderComboList(groupList, filterItems(allGroups, e.target.value), (item) =>
          selectGroupForPortion(portion, card, item)
        );
      });
      groupSearch.addEventListener('focus', () => {
        if (allGroups.length) {
          renderComboList(groupList, filterItems(allGroups, groupSearch.value), (item) =>
            selectGroupForPortion(portion, card, item)
          );
        }
      });

      const memberSearch = card.querySelector('.member-search');
      const memberList = card.querySelector('.member-list');
      memberSearch.addEventListener('input', (e) => {
        renderComboList(memberList, filterItems(portion.allMembers, e.target.value), (item) =>
          addMemberToPortion(portion, card, item)
        );
      });
      memberSearch.addEventListener('focus', () => {
        if (portion.allMembers.length) {
          renderComboList(memberList, filterItems(portion.allMembers, memberSearch.value), (item) =>
            addMemberToPortion(portion, card, item)
          );
        }
      });

      card.querySelector('.load-members').addEventListener('click', () => loadMembersForPortion(portion, card));
      card.querySelector('.clear-group').addEventListener('click', () => clearGroupForPortion(portion, card));
      card.querySelector('.clear-members').addEventListener('click', () => {
        portion.members = [];
        renderMemberChips(portion, card);
      });

      return card;
    }

    function renderPortions() {
      if (suppressPortionRender) return;
      const list = document.getElementById('portions-list');
      list.innerHTML = '';
      portions.forEach((portion, index) => {
        list.appendChild(buildPortionCard(portion, index));
      });
      document.getElementById('portions-empty').hidden = portions.length > 0;
    }

    function addPortion(partial = {}) {
      syncAllPortionsFromDom();
      portions.push(createPortion(partial));
      renderPortions();
    }

    function removePortion(id) {
      syncAllPortionsFromDom();
      portions = portions.filter((portion) => portion.id !== id);
      renderPortions();
      if (!portions.length) {
        document.getElementById('target-active').innerHTML = '';
      }
    }

    function setFeedback(text, cls) {
      const feedback = document.getElementById('target-feedback');
      feedback.textContent = text;
      feedback.className = cls || '';
    }

    function renderMonitoring(monitoring) {
      const el = document.getElementById('target-active');
      if (!monitoring || !monitoring.length) {
        el.innerHTML = '';
        return;
      }
      const lines = monitoring.map((item, index) => {
        const sheet = item.sheet ? ' → ' + item.sheet : '';
        return '<p class="active-line">' + (index + 1) + '. ' + item.group + ' → ' + item.member + sheet + '</p>';
      });
      el.innerHTML = '<p style="font-weight:600;margin:0 0 0.25rem;">Active:</p>' + lines.join('');
    }

    async function loadGroups({ refresh = false } = {}) {
      const btn = document.getElementById('load-groups');
      if (btn.disabled) return;
      btn.disabled = true;
      document.getElementById('sync-groups').disabled = true;
      btn.textContent = 'Loading groups…';
      setFeedback('Loading groups (usually a few seconds)…', '');
      try {
        const refreshParam = refresh ? '&refresh=1' : '';
        const res = await fetch('/setup/groups?token=' + encodeURIComponent(token) + refreshParam);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to load groups');
        if (!data.ready) throw new Error('Connect WhatsApp first (scan QR above).');
        allGroups = data.groups || [];
        setFeedback(
          allGroups.length
            ? 'Found ' + allGroups.length + ' group(s). Pick a group in each configuration.'
            : 'No groups found.',
          'ok'
        );
      } catch (err) {
        setFeedback(err.message, 'err');
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
      setFeedback('Syncing from WhatsApp on your phone (~10 seconds). New groups appear after this.', '');
      try {
        const res = await fetch('/setup/sync?token=' + encodeURIComponent(token), { method: 'POST' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Sync failed');
        setFeedback('Sync done. Loading groups…', 'ok');
        await loadGroups({ refresh: true });
      } catch (err) {
        setFeedback(err.message, 'err');
      } finally {
        btn.disabled = !whatsAppReady;
        document.getElementById('load-groups').disabled = !whatsAppReady;
        btn.textContent = 'Sync from phone';
      }
    }

    async function loadMembersForPortion(portion, card, { refresh = false } = {}) {
      const groupId = portion.groupId || card.querySelector('.group-id').value;
      if (!groupId) return;
      const btn = card.querySelector('.load-members');
      if (btn.disabled && !refresh) return;
      btn.disabled = true;
      btn.textContent = 'Loading members…';
      setFeedback('Loading members (usually a few seconds)…', '');
      try {
        const refreshParam = refresh ? '&refresh=1' : '';
        const res = await fetch(
          '/setup/members?token=' + encodeURIComponent(token) + '&groupId=' + encodeURIComponent(groupId) + refreshParam
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to load members');
        portion.allMembers = data.members || [];
        setFeedback(
          portion.allMembers.length
            ? 'Found ' + portion.allMembers.length + ' member(s). Search and click to add.'
            : 'No members found.',
          'ok'
        );
        renderComboList(
          card.querySelector('.member-list'),
          filterItems(portion.allMembers, card.querySelector('.member-search').value),
          (item) => addMemberToPortion(portion, card, item)
        );
      } catch (err) {
        setFeedback(err.message, 'err');
      } finally {
        btn.disabled = !whatsAppReady || !groupId;
        btn.textContent = portion.allMembers.length ? 'Refresh members' : 'Load members';
      }
    }

    document.getElementById('load-groups').addEventListener('click', () => loadGroups());
    document.getElementById('sync-groups').addEventListener('click', syncGroups);
    document.getElementById('add-portion').addEventListener('click', () => addPortion());

    document.getElementById('copy-apps-script').addEventListener('click', async () => {
      const feedback = document.getElementById('copy-script-feedback');
      feedback.textContent = 'Loading…';
      feedback.className = '';
      try {
        const res = await fetch('/setup/script?token=' + encodeURIComponent(token));
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Could not load script');
        await navigator.clipboard.writeText(data.script);
        feedback.textContent = 'Script copied — paste it in Apps Script (step 3).';
        feedback.className = 'ok';
      } catch (err) {
        feedback.textContent = err.message;
        feedback.className = 'err';
      }
    });

    document.addEventListener('click', (e) => {
      if (!e.target.closest('.combo-wrap')) {
        document.querySelectorAll('.combo-list').forEach((list) => {
          list.hidden = true;
        });
      }
    });

    function clearTargetForm() {
      portions = [];
      renderPortions();
      document.getElementById('target-active').innerHTML = '';
      setFeedback('', '');
      document.getElementById('load-groups').textContent = 'Load my groups';
      document.getElementById('load-groups').disabled = true;
      document.getElementById('sync-groups').disabled = true;
      document.getElementById('target-source').textContent =
        'Scan QR, then load groups and add configurations.';
      allGroups = [];
      initialPoll = true;
    }

    function applyTargetData(data, { updateFields = true } = {}) {
      if (data.defaultWebhookUrl) defaultWebhookUrl = data.defaultWebhookUrl;
      if (updateFields && !isFormFocused()) {
        suppressPortionRender = true;
        const incoming = Array.isArray(data.targets) ? data.targets : [];
        portions = incoming.map((target) => createPortion(target));
        suppressPortionRender = false;
        renderPortions();
      }
      const sourceEl = document.getElementById('target-source');
      if (data.source) {
        sourceEl.textContent = sourceLabels[data.source] || '';
      } else if (!data.monitoring?.length) {
        sourceEl.textContent = 'Scan QR, then load groups and add configurations.';
      }
      renderMonitoring(data.monitoring);
    }

    async function loadTargets({ updateFields = true } = {}) {
      const res = await fetch('/setup/targets?token=' + encodeURIComponent(token));
      if (!res.ok) return;
      applyTargetData(await res.json(), { updateFields });
    }

    document.getElementById('save-targets').addEventListener('click', async () => {
      if (!whatsAppReady) {
        setFeedback('Connect WhatsApp first (scan QR above).', 'err');
        return;
      }
      syncAllPortionsFromDom();
      const btn = document.getElementById('save-targets');
      if (!portions.length) {
        setFeedback('Add at least one configuration.', 'err');
        return;
      }
      const payload = portions.map((portion) => ({
        id: portion.id,
        groupName: portion.groupName,
        groupId: portion.groupId,
        members: portion.members.map((member) => ({ name: member.name, id: member.id || '' })),
        webhookUrl: portion.webhookUrl || ''
      }));
      for (let i = 0; i < payload.length; i++) {
        if (!payload[i].groupName || !payload[i].members.length) {
          setFeedback('Configuration ' + (i + 1) + ' needs a group and at least one member.', 'err');
          return;
        }
      }
      btn.disabled = true;
      setFeedback('Saving...', '');
      try {
        const res = await fetch('/setup/targets?token=' + encodeURIComponent(token), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ targets: payload })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Save failed');
        setFeedback(data.warning || 'Saved. Monitoring updated.', data.warning ? 'err' : 'ok');
        renderMonitoring(data.monitoring);
        await loadTargets({ updateFields: true });
      } catch (err) {
        setFeedback(err.message, 'err');
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
      targets: [],
      source: null,
      monitoring: null,
      defaultWebhookUrl: ''
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

    function normalizePoll(data) {
      const ready = !!(data.ready || data.status === 'ready');
      let status = data.status || 'starting';
      let message = data.message || '';
      if (ready) {
        status = 'ready';
        if (!message || /finishing|syncing|authenticated/i.test(message)) {
          if (Array.isArray(data.monitoring) && data.monitoring.length) {
            message =
              data.monitoring.length === 1
                ? 'Connected. Monitoring ' + data.monitoring[0].member + '.'
                : 'Connected. Monitoring ' + data.monitoring.length + ' groups.';
          } else {
            message = 'Connected. Add configurations below if needed.';
          }
        }
      }
      return Object.assign({}, data, { ready, status, message });
    }

    function updateSessionState(data) {
      const session = normalizePoll(data);
      const qrMeta = buildQrMeta(session);
      setStatus(session.message, session.status);
      updateNavbar(session);
      updateStepsUi(session.status, session.progress);
      updateProgressUi(session.status, session.progress, session.message);
      updateQrUi(session.status, session.message, qrMeta);
      schedulePoll(session.status);
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

    document.getElementById('logs-expand').addEventListener('click', () => {
      const section = document.getElementById('logs-section');
      const expanded = section.classList.toggle('expanded');
      document.body.style.overflow = expanded ? 'hidden' : '';
      if (expanded) {
        const logs = document.getElementById('logs');
        logs.scrollTop = logs.scrollHeight;
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

        const session = normalizePoll(data);
        updateSessionState(session);
        const ready = session.ready;
        whatsAppReady = ready;
        document.getElementById('target-panel').classList.toggle('session-off', !ready);
        document.getElementById('load-groups').disabled = !ready;
        document.getElementById('sync-groups').disabled = !ready;

        if (!ready) {
          applyTargetData(emptyTargets, { updateFields: !isFormFocused() });
          initialPoll = true;
          wasReady = false;
        } else if (session.targets) {
          applyTargetData(session.targets, { updateFields: initialPoll || !wasReady });
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
  onSaveAllTargets,
  onClearTargets,
  onLogout,
  onListGroups,
  onListMembers,
  onSyncCatalog,
  isWhatsAppReady,
  getWhatsAppUser,
  getDefaultWebhookUrl,
  onPollSync
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

  function syncStatusFromReady() {
    if (!isWhatsAppReady?.()) return;

    if (status === 'ready') return;

    currentQr = null;
    qrUpdatedAt = null;
    loadPercent = null;
    status = 'ready';

    if (
      !statusMessage ||
      /finishing|syncing|authenticated|scan/i.test(statusMessage)
    ) {
      if (Array.isArray(monitoring) && monitoring.length) {
        statusMessage =
          monitoring.length === 1
            ? `Connected. Monitoring ${monitoring[0].member}.`
            : `Connected. Monitoring ${monitoring.length} groups.`;
      } else {
        statusMessage = 'Connected. Add configurations below if needed.';
      }
    }
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
    const defaultWebhookUrl = getDefaultWebhookUrl ? getDefaultWebhookUrl() : '';
    if (!isWhatsAppConnected()) {
      return {
        targets: [],
        source: null,
        monitoring: null,
        defaultWebhookUrl
      };
    }

    const effective = getTargets ? getTargets() : null;
    const targets = effective?.targets || [];
    return {
      targets: targets.map((target) => ({
        id: target.id || '',
        groupName: target.groupName || '',
        groupId: target.groupId || '',
        members: target.members || [],
        webhookUrl: target.webhookUrl || ''
      })),
      source: effective?.source || null,
      monitoring,
      defaultWebhookUrl
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

  app.get('/setup/status', checkToken, async (req, res) => {
    if (onPollSync) await onPollSync();
    syncStatusFromReady();
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

  app.get('/setup/script', checkToken, (req, res) => {
    try {
      if (!fs.existsSync(APPS_SCRIPT_PATH)) {
        return res.status(404).json({ error: 'Apps Script file not found on server.' });
      }
      const script = fs.readFileSync(APPS_SCRIPT_PATH, 'utf8');
      res.json({ script });
    } catch (err) {
      res.status(500).json({ error: err.message });
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

    const rawTargets = req.body?.targets;
    if (!Array.isArray(rawTargets) || !rawTargets.length) {
      return res.status(400).json({ error: 'Add at least one configuration with a group and member(s).' });
    }

    const targets = rawTargets
      .map((entry) => {
        const groupName = entry?.groupName?.trim();
        const groupId = entry?.groupId?.trim() || '';
        const members = normalizeMembers(entry?.members, entry?.memberName, entry?.memberId);
        const webhookUrl = entry?.webhookUrl?.trim() || '';
        const id = entry?.id?.trim() || '';
        if (!groupName || !members.length) return null;
        return {
          id: id || undefined,
          groupName,
          groupId,
          members,
          webhookUrl: webhookUrl || null
        };
      })
      .filter(Boolean);

    if (!targets.length) {
      return res.status(400).json({ error: 'Each configuration needs a group and at least one member.' });
    }

    if (!onSaveAllTargets) {
      return res.status(503).json({ error: 'Target saving is not configured.' });
    }

    try {
      const result = await onSaveAllTargets(targets);
      if (result?.monitoring) {
        monitoring = result.monitoring;
      }
      res.json({
        ok: true,
        targets: result?.targets || targets,
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

  app.get('/setup/poll', checkToken, async (req, res) => {
    const since = Math.max(0, Number(req.query.since) || 0);
    if (onPollSync) await onPollSync();
    syncStatusFromReady();
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
      if (status === 'ready') return;
      if (currentQr !== qr) {
        currentQr = qr;
        qrUpdatedAt = Date.now();
      }
      status = 'qr';
      statusMessage = 'Scan this QR code with WhatsApp on your phone.';
      loadPercent = 100;
    },
    setAuthenticated(message) {
      if (status === 'ready') return;
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
      statusMessage = 'Connected. Add a configuration below, then Save all & apply.';
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
