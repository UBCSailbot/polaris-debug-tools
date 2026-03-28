// frontend/app.js
// Main renderer application.
// Owns all state, wires window.electronAPI (preload.js) to DOM.
// Depends on: Terminal (terminal.js), Charts (charts.js), PROTOCOLS (protocols.js)

import { PROTOCOLS, PROTOCOL_ORDER, parseLine, parseCanFrame } from './protocols.js';
import { Terminal } from './terminal.js';
import { Charts }   from './charts.js';

// ─── State ──────────────────────────────────────────────────────────────────
const state = {
  connected:   false,
  activeProto: null,   // 'UART' | 'SPI' | 'CANFD' | null
  lastCommand: null,   // string — stored for Retry button
  unsubs:      [],     // IPC unsubscribe handles (call each to remove listener)
};

// ─── DOM refs ───────────────────────────────────────────────────────────────
const $  = id => document.getElementById(id);
const portSelect       = $('port-select');
const baudInput        = $('baud-input');
const btnConnect       = $('btn-connect');
const statusDot        = $('status-dot');
const banner           = $('banner');
const reconnectCounter = $('reconnect-counter');
const sidebar          = $('sidebar');
const presetButtons    = $('preset-buttons');
const customForm       = $('custom-form');
const btnCustomSend    = $('btn-custom-send');
const rawInput         = $('raw-input');
const btnSend          = $('btn-send');
const vizPanel         = $('viz-panel');
const resProto         = $('res-proto');
const resStatus        = $('res-status');
const resData          = $('res-data');
const resRtt           = $('res-rtt');
const resCanGroup      = $('res-can-group');
const resDlcGroup      = $('res-dlc-group');
const resCanId         = $('res-can-id');
const resDlc           = $('res-dlc');
const btnRetry         = $('btn-retry');
const btnExportLog     = $('btn-export-log');
const btnExportCsv     = $('btn-export-csv');
const sessionFilePath  = $('session-file-path');
const toastContainer   = $('toast-container');

// ─── Sub-components ─────────────────────────────────────────────────────────
const terminal = new Terminal({
  containerEl:    $('terminal'),
  footerDuration: $('stat-duration'),
  footerPassed:   $('stat-passed'),
  footerFailed:   $('stat-failed'),
});

const charts = new Charts({
  canvasEl:  $('viz-canvas'),
  metricsEl: $('viz-metrics'),
});

// ─── Toast ───────────────────────────────────────────────────────────────────
function showToast(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast${type === 'error' ? ' error' : ''}`;
  el.textContent = msg;
  toastContainer.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

// ─── Export button flash ─────────────────────────────────────────────────────
function flashExportBtn(btn, success) {
  const cls = success ? 'flash-success' : 'flash-error';
  btn.classList.add(cls);
  setTimeout(() => btn.classList.remove(cls), 1300);
}

// ─── Connection state ────────────────────────────────────────────────────────
function setConnected(connected) {
  state.connected = connected;
  statusDot.className       = connected ? 'connected' : 'disconnected';
  btnConnect.textContent    = connected ? 'Disconnect' : 'Connect';
  btnConnect.classList.toggle('connected', connected);
  banner.classList.toggle('visible', !connected);
  if (connected) reconnectCounter.textContent = '';
  _syncCommandBarEnabled();
  _syncSidebarEnabled();
}

// ─── Port list ───────────────────────────────────────────────────────────────
async function refreshPorts() {
  let ports;
  try {
    ports = await window.electronAPI.listPorts();
  } catch {
    ports = [];
  }
  const current = portSelect.value;
  portSelect.innerHTML = '<option value="">— select port —</option>';
  for (const p of ports) {
    const opt = document.createElement('option');
    opt.value = p.path;
    opt.textContent = p.manufacturer ? `${p.path} · ${p.manufacturer}` : p.path;
    portSelect.appendChild(opt);
  }
  if (ports.some(p => p.path === current)) portSelect.value = current;
}

// ─── Connect / Disconnect ────────────────────────────────────────────────────
btnConnect.addEventListener('click', async () => {
  if (state.connected) {
    try { await window.electronAPI.disconnect(); } catch { /* stub fallback OK */ }
    setConnected(false);
    terminal.append('Disconnected by user.', 'INIT');
    return;
  }
  const path = portSelect.value;
  if (!path) { showToast('Select a port first.', 'error'); return; }
  const baud = parseInt(baudInput.value, 10);
  let result;
  try {
    result = await window.electronAPI.connect({ path, baudRate: baud });
  } catch {
    result = { success: false, error: 'IPC error' };
  }
  if (result.success) {
    setConnected(true);
    terminal.append(`Connected to ${path} @ ${baud}`, 'INIT');
  } else {
    showToast(`Connect failed: ${result.error || 'unknown error'}`, 'error');
  }
});

// ─── Sidebar ─────────────────────────────────────────────────────────────────
function buildSidebar() {
  // Keep the title element, rebuild rows only
  const title = $('sidebar-title');
  sidebar.innerHTML = '';
  sidebar.appendChild(title);

  for (const id of PROTOCOL_ORDER) {
    const proto = PROTOCOLS[id];

    const row = document.createElement('div');
    row.className = 'proto-row disabled'; // disabled until connected
    row.dataset.proto = id;
    row.setAttribute('role', 'button');
    row.setAttribute('tabindex', '0');
    row.setAttribute('aria-label', `${proto.label} protocol`);

    const name = document.createElement('span');
    name.textContent = proto.label;

    const badge = document.createElement('span');
    badge.className = 'proto-badge gray';
    badge.id = `badge-${id}`;
    badge.textContent = '—';

    row.appendChild(name);
    row.appendChild(badge);
    sidebar.appendChild(row);

    row.addEventListener('click', () => {
      if (!state.connected) return;
      setActiveProtocol(id);
    });
    row.addEventListener('keydown', e => {
      if ((e.key === 'Enter' || e.key === ' ') && state.connected) {
        e.preventDefault();
        setActiveProtocol(id);
      }
    });
  }
}

function setBadge(protoId, statusKey) {
  const el = document.getElementById(`badge-${protoId}`);
  if (!el) return;
  const classMap = { PASS: 'pass', FAIL: 'fail', TIMEOUT: 'timeout' };
  const textMap  = { PASS: 'PASS', FAIL: 'FAIL', TIMEOUT: 'TMOUT' };
  el.className   = 'proto-badge ' + (classMap[statusKey] || 'gray');
  el.textContent = textMap[statusKey] || '—';
}

function _syncSidebarEnabled() {
  document.querySelectorAll('.proto-row').forEach(row => {
    row.classList.toggle('disabled', !state.connected);
  });
}

// ─── Active protocol ──────────────────────────────────────────────────────────
function setActiveProtocol(id) {
  state.activeProto = id;

  document.querySelectorAll('.proto-row').forEach(row => {
    row.classList.toggle('active', row.dataset.proto === id);
  });

  _buildCommandBar(id);
  vizPanel.classList.remove('hidden');
  charts.show(id);
}

// ─── Command bar ─────────────────────────────────────────────────────────────
function _buildCommandBar(protoId) {
  const proto = PROTOCOLS[protoId];
  presetButtons.innerHTML = '';
  customForm.classList.remove('visible');

  // Remove any previously injected custom fields (keep btn-custom-send)
  Array.from(customForm.children).forEach(child => {
    if (child.id !== 'btn-custom-send') child.remove();
  });

  for (const cmd of proto.commands) {
    const btn = document.createElement('button');
    btn.className = 'btn-preset';
    btn.type = 'button';
    btn.textContent = cmd.label;
    btn.disabled = !state.connected;

    if (cmd.custom) {
      btn.addEventListener('click', () => _openCustomForm(cmd.fields));
    } else {
      btn.addEventListener('click', () => sendCommand(cmd.command));
    }
    presetButtons.appendChild(btn);
  }
}

function _openCustomForm(fields) {
  // Remove old fields
  Array.from(customForm.children).forEach(child => {
    if (child.id !== 'btn-custom-send') child.remove();
  });

  for (const f of fields) {
    const input = document.createElement('input');
    input.className = 'custom-field';
    input.type = 'text';
    input.placeholder = f.placeholder;
    input.dataset.fieldName = f.name;
    input.required = f.required ? 'required' : '';
    input.autocomplete = 'off';
    input.spellcheck = false;
    customForm.insertBefore(input, btnCustomSend);
  }
  customForm.classList.add('visible');
  customForm.querySelector('.custom-field')?.focus();
}

btnCustomSend.addEventListener('click', () => {
  const inputs = customForm.querySelectorAll('.custom-field');
  const parts = [];
  for (const input of inputs) {
    if (input.required && !input.value.trim()) {
      showToast(`"${input.placeholder}" is required.`, 'error');
      input.focus();
      return;
    }
    parts.push(input.value.trim());
  }
  if (!state.activeProto) return;
  const command = `${state.activeProto}:CUSTOM:${parts.join(':')}`;
  sendCommand(command);
  customForm.classList.remove('visible');
});

function _syncCommandBarEnabled() {
  const disabled = !state.connected;
  document.querySelectorAll('.btn-preset').forEach(b => { b.disabled = disabled; });
  btnSend.disabled = disabled;
}

// Raw input send
btnSend.addEventListener('click', () => {
  const cmd = rawInput.value.trim();
  if (!cmd || !state.connected) return;
  sendCommand(cmd);
  rawInput.value = '';
});

rawInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') btnSend.click();
});

// ─── Send command ─────────────────────────────────────────────────────────────
async function sendCommand(command) {
  if (!state.connected) return;
  state.lastCommand = command;
  terminal.append(`> ${command}`, 'INIT');
  try {
    await window.electronAPI.send({ command });
  } catch {
    showToast('Send failed — IPC error', 'error');
  }
  btnRetry.classList.add('visible');
}

btnRetry.addEventListener('click', () => {
  if (state.lastCommand) sendCommand(state.lastCommand);
});

// ─── Incoming data ────────────────────────────────────────────────────────────
function handleData({ raw, proto, status, data, rtt }) {
  const parsed = parseLine(raw);

  // Malformed — purple, no badge/result update
  if (!parsed) {
    terminal.append(raw || '(empty)', 'RAW');
    return;
  }

  terminal.append(raw, parsed.status);

  // Sidebar badge — only for PASS/FAIL/TIMEOUT
  if (['PASS', 'FAIL', 'TIMEOUT'].includes(parsed.status)) {
    setBadge(parsed.proto, parsed.status);
  }

  // Feed chart data
  charts.push(parsed.proto, { status: parsed.status, data: parsed.data, rtt });

  // Result panel
  resProto.textContent = parsed.proto;
  resRtt.textContent   = rtt != null ? `${rtt} ms` : '—';
  resData.textContent  = parsed.data || '(empty)';

  const badge = document.createElement('span');
  badge.className = `status-badge ${parsed.status.toLowerCase()}`;
  badge.textContent = parsed.status;
  resStatus.innerHTML = '';
  resStatus.appendChild(badge);

  // CANFD-specific fields
  const isCanfd = parsed.proto === 'CANFD';
  resCanGroup.style.display = isCanfd ? '' : 'none';
  resDlcGroup.style.display = isCanfd ? '' : 'none';
  if (isCanfd) {
    const frame = parseCanFrame(parsed.data);
    resCanId.textContent = frame.id  != null ? `0x${frame.id.toString(16).toUpperCase()}`  : '—';
    resDlc.textContent   = frame.dlc != null ? String(frame.dlc) : '—';
  }

  // Show Retry only on FAIL or TIMEOUT
  btnRetry.classList.toggle('visible', parsed.status === 'FAIL' || parsed.status === 'TIMEOUT');
}

// ─── Export ───────────────────────────────────────────────────────────────────
btnExportLog.addEventListener('click', async () => {
  let result;
  try {
    result = await window.electronAPI.exportLog();
  } catch {
    result = { success: false, error: 'IPC error' };
  }
  if (result.success) {
    flashExportBtn(btnExportLog, true);
    if (result.path) sessionFilePath.textContent = result.path;
  } else {
    flashExportBtn(btnExportLog, false);
    showToast(`Export failed: ${result.error || 'unknown'}`, 'error');
  }
});

btnExportCsv.addEventListener('click', async () => {
  let result;
  try {
    result = await window.electronAPI.exportCsv();
  } catch {
    result = { success: false, error: 'IPC error' };
  }
  if (result.success) {
    flashExportBtn(btnExportCsv, true);
    if (result.path) sessionFilePath.textContent = result.path;
  } else {
    flashExportBtn(btnExportCsv, false);
    showToast(`Export failed: ${result.error || 'unknown'}`, 'error');
  }
});

// ─── IPC subscriptions ────────────────────────────────────────────────────────
function wireIpc() {
  // Clean up any previous subscriptions
  state.unsubs.forEach(fn => fn());
  state.unsubs = [];

  state.unsubs.push(
    window.electronAPI.onData(handleData),

    window.electronAPI.onConnectionStatus(({ connected, port, baud }) => {
      setConnected(connected);
      if (connected) {
        terminal.append(`Connected to ${port} @ ${baud}`, 'INIT');
      } else {
        terminal.append('Connection lost.', 'INIT');
      }
    }),

    window.electronAPI.onReconnectAttempt(({ attempt, max }) => {
      reconnectCounter.textContent = `(attempt ${attempt}/${max})`;
      banner.classList.add('visible');
    }),

    window.electronAPI.onSessionPath(({ path }) => {
      sessionFilePath.textContent = path;
    }),
  );
}

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  buildSidebar();
  await refreshPorts();
  wireIpc();
  terminal.append('Ready. Select a port and connect.', 'INIT');
}

init();
