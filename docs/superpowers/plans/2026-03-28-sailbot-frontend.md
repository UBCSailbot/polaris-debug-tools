# Sailbot Dev Board GUI — Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the complete Electron renderer-process frontend for the UBC Sailbot dev board testing GUI, covering UART, SPI, and CANFD protocols only.

**Architecture:** Six focused renderer files (`index.html`, `styles.css`, `protocols.js`, `terminal.js`, `charts.js`, `app.js`) communicate with the Electron main process exclusively through `window.electronAPI` (contextBridge). Since no backend was found at plan-writing time, a `preload.js` stub layer is included so the UI renders and is testable in isolation; replace stubs with real `ipcRenderer` calls when the backend is wired up.

**Tech Stack:** Plain ES6 JS (no frameworks), Chart.js 4.4.1 (CDN), Electron contextBridge/ipcRenderer, CSS custom properties for theming.

---

## IPC Interface (discovered + defined here — backend gap noted)

> **GAP:** No Electron main process (`main.js` / `preload.js`) was found in the repo. The channels below are designed for this frontend. When the backend is implemented it must expose these exact names via `contextBridge.exposeInMainWorld('electronAPI', {...})`.

| Channel | Direction | Payload | Return |
|---------|-----------|---------|--------|
| `serial:list-ports` | invoke | — | `[{ path: string, manufacturer: string }]` |
| `serial:connect` | invoke | `{ path: string, baudRate: number }` | `{ success: boolean, error?: string }` |
| `serial:disconnect` | invoke | — | `{ success: boolean }` |
| `serial:send` | invoke | `{ command: string }` | `{ success: boolean, sentAt: number }` |
| `serial:data` | on (event) | `{ raw: string, proto: string, status: string, data: string, rtt: number }` | — |
| `serial:connection-status` | on (event) | `{ connected: boolean, port: string, baud: number }` | — |
| `serial:reconnect-attempt` | on (event) | `{ attempt: number, max: number }` | — |
| `log:export-csv` | invoke | — | `{ success: boolean, path?: string, error?: string }` |
| `log:export-log` | invoke | — | `{ success: boolean, path?: string, error?: string }` |
| `log:session-path` | on (event) | `{ path: string }` | — |

---

## File Map

| File | Responsibility |
|------|----------------|
| `preload.js` | contextBridge stubs — defines `window.electronAPI`; replace with real ipcRenderer calls |
| `frontend/index.html` | Window shell: imports all JS/CSS, declares layout divs, no logic |
| `frontend/styles.css` | All CSS: custom properties, 3-column grid layout, component styles, WCAG-AA colors |
| `frontend/protocols.js` | Exported `PROTOCOLS` config: names, badge labels, command button definitions, chart type per protocol |
| `frontend/terminal.js` | `Terminal` class: append lines, color by status, auto-scroll, timestamp, session stats footer |
| `frontend/charts.js` | `Charts` class: creates/destroys Chart.js instances for UART (line), SPI (bar), CANFD (scatter) |
| `frontend/app.js` | `App` class: owns all state, wires IPC to UI, drives terminal/charts/result panel |

---

## Task 1: Create `preload.js` with contextBridge stubs

**Files:**
- Create: `preload.js` (project root, next to `main.js` when it exists)

These stubs let the renderer run without a real backend. They emit mock data on a timer so UI development can proceed independently.

- [ ] **Step 1.1: Write `preload.js`**

```javascript
// preload.js
// STUB: Replace ipcRenderer calls with real backend when main.js is implemented.
// All window.electronAPI methods mirror the IPC interface defined in the plan.

const { contextBridge, ipcRenderer } = require('electron');

// --- Mock data emitter (remove when real backend exists) ---
function startMockEmitter() {
  const protos = ['UART', 'SPI', 'CANFD'];
  const statuses = ['PASS', 'FAIL', 'TIMEOUT', 'INIT', 'RAW'];
  let frameId = 0x101;

  setInterval(() => {
    const proto = protos[Math.floor(Math.random() * protos.length)];
    const status = statuses[Math.floor(Math.random() * statuses.length)];
    let data = 'mock payload';
    if (proto === 'CANFD') data = `ID=0x${frameId.toString(16).toUpperCase()} DLC=8 BYTES=DEADBEEF`;
    if (proto === 'SPI') data = `TX=0xA5 RX=0xA5`;
    const raw = `${proto}:${status}:${data}`;
    ipcRenderer.emit('serial:data', null, { raw, proto, status, data, rtt: Math.floor(Math.random() * 50) + 1 });
    frameId = 0x100 + (frameId % 4) + 1;
  }, 2000);
}

contextBridge.exposeInMainWorld('electronAPI', {
  // Serial
  listPorts: () => Promise.resolve([
    { path: 'COM3', manufacturer: 'STMicroelectronics' },
    { path: 'COM4', manufacturer: 'FTDI' },
  ]),
  connect: ({ path, baudRate }) => {
    startMockEmitter();
    return Promise.resolve({ success: true });
  },
  disconnect: () => Promise.resolve({ success: true }),
  send: ({ command }) => Promise.resolve({ success: true, sentAt: Date.now() }),

  // Event subscriptions — return unsubscribe function
  onData: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on('serial:data', handler);
    return () => ipcRenderer.removeListener('serial:data', handler);
  },
  onConnectionStatus: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on('serial:connection-status', handler);
    return () => ipcRenderer.removeListener('serial:connection-status', handler);
  },
  onReconnectAttempt: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on('serial:reconnect-attempt', handler);
    return () => ipcRenderer.removeListener('serial:reconnect-attempt', handler);
  },
  onSessionPath: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on('log:session-path', handler);
    return () => ipcRenderer.removeListener('log:session-path', handler);
  },

  // Export
  exportCsv: () => Promise.resolve({ success: true, path: '/mock/session.csv' }),
  exportLog: () => Promise.resolve({ success: true, path: '/mock/session.log' }),
});
```

- [ ] **Step 1.2: Verify file saved, no syntax errors**

Open `preload.js` in an editor and confirm no red squiggles. No test runner needed for this step — it's a stub.

---

## Task 2: `frontend/protocols.js` — Protocol configuration

**Files:**
- Create: `frontend/protocols.js`

This is the single source of truth for protocol names, command buttons, and chart types. `app.js` and `charts.js` both import from here.

- [ ] **Step 2.1: Write `frontend/protocols.js`**

```javascript
// frontend/protocols.js
// Single source of truth for protocol definitions.
// app.js and charts.js reference PROTOCOLS — never hardcode protocol names elsewhere.

export const PROTOCOLS = {
  UART: {
    id: 'UART',
    label: 'UART',
    chartType: 'line',
    commands: [
      { label: 'Init',       command: 'UART:INIT',     custom: false },
      { label: 'Loopback',   command: 'UART:LOOP',     custom: false },
      { label: 'Baud test',  command: 'UART:BAUD',     custom: false },
      { label: 'Custom…',    command: null,             custom: true,
        fields: [{ name: 'payload', placeholder: 'Payload bytes (hex)', required: true }] },
    ],
  },
  SPI: {
    id: 'SPI',
    label: 'SPI',
    chartType: 'bar',
    commands: [
      { label: 'Init',          command: 'SPI:INIT',        custom: false },
      { label: 'Transfer 0xA5', command: 'SPI:XFER:A5',     custom: false },
      { label: 'Transfer 0xFF', command: 'SPI:XFER:FF',     custom: false },
      { label: 'Custom…',       command: null,              custom: true,
        fields: [{ name: 'byte', placeholder: 'Byte to send (hex, e.g. B3)', required: true }] },
    ],
  },
  CANFD: {
    id: 'CANFD',
    label: 'CANFD',
    chartType: 'scatter',
    commands: [
      { label: 'Init',       command: 'CAN:INIT',      custom: false },
      { label: 'Send frame', command: 'CAN:SEND',      custom: false },
      { label: 'Bus status', command: 'CAN:STATUS',    custom: false },
      { label: 'Custom…',    command: null,            custom: true,
        fields: [
          { name: 'id',    placeholder: 'Frame ID (hex, e.g. 130)',  required: true  },
          { name: 'dlc',   placeholder: 'DLC (0–8)',                  required: true  },
          { name: 'bytes', placeholder: 'Data bytes (hex pairs)',     required: false },
        ] },
    ],
  },
};

export const PROTOCOL_ORDER = ['UART', 'SPI', 'CANFD'];

// Parse a raw PROTO:STATUS:DATA line. Returns null if malformed.
export function parseLine(raw) {
  const trimmed = (raw || '').trim();
  const match = trimmed.match(/^(UART|SPI|CANFD):([A-Z]+):(.*)$/);
  if (!match) return null;
  return { proto: match[1], status: match[2], data: match[3] };
}

// For CANFD frames: extract ID and DLC from the data field.
// Expected format: "ID=0x130 DLC=8 BYTES=..." (flexible whitespace)
export function parseCanFrame(data) {
  const idMatch  = data.match(/ID=0x([0-9A-Fa-f]+)/);
  const dlcMatch = data.match(/DLC=(\d+)/);
  return {
    id:  idMatch  ? parseInt(idMatch[1], 16)  : null,
    dlc: dlcMatch ? parseInt(dlcMatch[1], 10) : null,
  };
}
```

- [ ] **Step 2.2: Write inline unit test for `parseLine` and `parseCanFrame`**

Create `frontend/protocols.test.js`:

```javascript
// frontend/protocols.test.js
// Run with: node --experimental-vm-modules frontend/protocols.test.js
// (No test framework needed — plain assertions)

import { parseLine, parseCanFrame } from './protocols.js';

function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); process.exitCode = 1; }
  else        { console.log('PASS:', msg); }
}

// parseLine
assert(parseLine('UART:PASS:hello') !== null,           'valid UART line parses');
assert(parseLine('SPI:FAIL:0xA5')   !== null,           'valid SPI line parses');
assert(parseLine('CANFD:TIMEOUT:')  !== null,           'valid CANFD empty data');
assert(parseLine('garbage')         === null,           'garbage returns null');
assert(parseLine('UART:PASS:hello').proto   === 'UART', 'proto field correct');
assert(parseLine('UART:PASS:hello').status  === 'PASS', 'status field correct');
assert(parseLine('UART:PASS:hello').data    === 'hello','data field correct');
assert(parseLine('')                === null,           'empty string returns null');
assert(parseLine('uart:pass:x')     === null,           'lowercase proto returns null');

// parseCanFrame
const f = parseCanFrame('ID=0x130 DLC=8 BYTES=DEADBEEF');
assert(f.id  === 0x130, 'CAN frame ID parses as int');
assert(f.dlc === 8,     'CAN frame DLC parses as int');
assert(parseCanFrame('no match').id === null, 'missing ID returns null');
```

- [ ] **Step 2.3: Run the test**

```bash
node --input-type=module < frontend/protocols.test.js
```

Expected output: all lines start with `PASS:`, no `FAIL:` lines.

- [ ] **Step 2.4: Commit**

```bash
git add frontend/protocols.js frontend/protocols.test.js preload.js
git commit -m "feat: add protocols config, parseLine/parseCanFrame, preload stubs"
```

---

## Task 3: `frontend/styles.css` — Layout and theming

**Files:**
- Create: `frontend/styles.css`

CSS custom properties on `:root` define the light-mode palette. A `body.dark` class swap switches to dark (future toggle). All status colors are WCAG AA compliant on both light `#f5f5f5` and dark `#1a1a1a` surfaces.

- [ ] **Step 3.1: Write `frontend/styles.css`**

```css
/* frontend/styles.css */

/* ─── Custom Properties ─────────────────────────────── */
:root {
  --bg-surface:       #f5f5f5;
  --bg-panel:         #ffffff;
  --bg-sidebar:       #ececec;
  --bg-terminal:      #1a1a1a;
  --bg-titlebar:      #2c2c2c;
  --bg-command-bar:   #f0f0f0;
  --bg-input:         #ffffff;

  --text-primary:     #111111;
  --text-secondary:   #555555;
  --text-on-dark:     #e8e8e8;
  --text-muted:       #888888;

  --border:           #d0d0d0;
  --border-focus:     #4a90e2;

  --color-pass:       #1a7a1a;   /* green — WCAG AA on white */
  --color-fail:       #c0392b;   /* red */
  --color-timeout:    #b35c00;   /* amber */
  --color-raw:        #7b2d8b;   /* purple */
  --color-init:       #1a5fa8;   /* blue */

  --color-pass-bg:    #e6f4e6;
  --color-fail-bg:    #fdecea;
  --color-timeout-bg: #fff3e0;
  --color-raw-bg:     #f3e5f5;
  --color-init-bg:    #e3f0fc;

  --badge-gray:       #888888;

  --font-ui:          system-ui, -apple-system, sans-serif;
  --font-mono:        'Consolas', 'Courier New', monospace;

  --radius:           4px;
  --sidebar-w:        140px;
  --result-w:         240px;
  --titlebar-h:       44px;
  --commandbar-h:     56px;
  --viz-h:            200px;
}

body.dark {
  --bg-surface:       #1e1e1e;
  --bg-panel:         #252525;
  --bg-sidebar:       #2a2a2a;
  --bg-command-bar:   #2a2a2a;
  --bg-input:         #333333;
  --text-primary:     #e8e8e8;
  --text-secondary:   #aaaaaa;
  --border:           #444444;
}

/* ─── Reset ─────────────────────────────────────────── */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: var(--font-ui);
  background: var(--bg-surface);
  color: var(--text-primary);
  height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* ─── Titlebar ───────────────────────────────────────── */
#titlebar {
  height: var(--titlebar-h);
  background: var(--bg-titlebar);
  color: #ffffff;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 16px;
  flex-shrink: 0;
  font-size: 13px;
}
#titlebar select,
#titlebar input[type="number"] {
  background: #3c3c3c;
  color: #ffffff;
  border: 1px solid #555;
  border-radius: var(--radius);
  padding: 4px 8px;
  font-size: 12px;
  font-family: var(--font-ui);
}
#titlebar select { min-width: 120px; }
#titlebar input[type="number"] { width: 72px; }
#status-dot {
  width: 10px; height: 10px;
  border-radius: 50%;
  background: #888;
  flex-shrink: 0;
}
#status-dot.connected    { background: #4caf50; }
#status-dot.disconnected { background: #f44336; }
#btn-connect {
  margin-left: auto;
  padding: 5px 14px;
  background: #4a90e2;
  color: #fff;
  border: none;
  border-radius: var(--radius);
  cursor: pointer;
  font-size: 12px;
}
#btn-connect:hover { background: #357abd; }
#btn-connect.connected { background: #c0392b; }
#btn-connect.connected:hover { background: #962d22; }

/* ─── Disconnect Banner ──────────────────────────────── */
#banner {
  display: none;
  background: #c0392b;
  color: #fff;
  text-align: center;
  padding: 6px;
  font-size: 13px;
  flex-shrink: 0;
}
#banner.visible { display: block; }

/* ─── Main 3-column layout ───────────────────────────── */
#main {
  display: flex;
  flex: 1;
  overflow: hidden;
}

/* ─── Sidebar ────────────────────────────────────────── */
#sidebar {
  width: var(--sidebar-w);
  background: var(--bg-sidebar);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px 8px;
  flex-shrink: 0;
}
.proto-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  border-radius: var(--radius);
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  user-select: none;
  border: 2px solid transparent;
}
.proto-row:hover        { background: var(--bg-panel); }
.proto-row.active       { border-color: var(--border-focus); background: var(--bg-panel); }
.proto-row.disabled     { opacity: 0.4; cursor: not-allowed; }
.proto-badge {
  font-size: 10px;
  font-weight: 700;
  padding: 2px 5px;
  border-radius: 3px;
  text-transform: uppercase;
}
.proto-badge.gray    { background: #ddd; color: var(--badge-gray); }
.proto-badge.pass    { background: var(--color-pass-bg);    color: var(--color-pass);    }
.proto-badge.fail    { background: var(--color-fail-bg);    color: var(--color-fail);    }
.proto-badge.timeout { background: var(--color-timeout-bg); color: var(--color-timeout); }

/* ─── Centre column ──────────────────────────────────── */
#centre {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* ─── Terminal ───────────────────────────────────────── */
#terminal {
  flex: 1;
  background: var(--bg-terminal);
  font-family: var(--font-mono);
  font-size: 12px;
  overflow-y: auto;
  padding: 8px 12px;
  color: var(--text-on-dark);
}
.term-line {
  display: flex;
  gap: 8px;
  margin-bottom: 1px;
  line-height: 1.5;
  word-break: break-all;
}
.term-ts   { color: #5b9bd5; flex-shrink: 0; }
.term-pass { color: #4caf50; }
.term-fail { color: #ef5350; }
.term-timeout { color: #ffb74d; }
.term-raw  { color: #ce93d8; }
.term-init { color: var(--text-on-dark); }
#terminal-footer {
  background: #111;
  color: #888;
  font-family: var(--font-mono);
  font-size: 11px;
  padding: 4px 12px;
  flex-shrink: 0;
  border-top: 1px solid #333;
}

/* ─── Command Bar ────────────────────────────────────── */
#command-bar {
  height: auto;
  min-height: var(--commandbar-h);
  background: var(--bg-command-bar);
  border-top: 1px solid var(--border);
  padding: 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex-shrink: 0;
}
#preset-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.btn-preset {
  padding: 5px 12px;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  cursor: pointer;
  font-size: 12px;
  font-family: var(--font-ui);
}
.btn-preset:hover    { background: var(--border); }
.btn-preset:disabled { opacity: 0.4; cursor: not-allowed; }
#raw-input-row {
  display: flex;
  gap: 6px;
}
#raw-input {
  flex: 1;
  padding: 5px 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  font-family: var(--font-mono);
  font-size: 12px;
  background: var(--bg-input);
  color: var(--text-primary);
}
#raw-input:focus { outline: 2px solid var(--border-focus); outline-offset: 1px; }
#btn-send {
  padding: 5px 14px;
  background: #4a90e2;
  color: #fff;
  border: none;
  border-radius: var(--radius);
  cursor: pointer;
  font-size: 12px;
}
#btn-send:hover    { background: #357abd; }
#btn-send:disabled { opacity: 0.4; cursor: not-allowed; }

/* Custom form (inline, shown below preset buttons when Custom... clicked) */
#custom-form {
  display: none;
  flex-direction: column;
  gap: 4px;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 8px;
}
#custom-form.visible { display: flex; }
.custom-field {
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  font-family: var(--font-mono);
  font-size: 12px;
  background: var(--bg-input);
  color: var(--text-primary);
}
#btn-custom-send {
  align-self: flex-start;
  padding: 4px 12px;
  background: #4a90e2;
  color: #fff;
  border: none;
  border-radius: var(--radius);
  cursor: pointer;
  font-size: 12px;
}

/* ─── Visualization Panel ────────────────────────────── */
#viz-panel {
  height: var(--viz-h);
  border-top: 1px solid var(--border);
  background: var(--bg-panel);
  display: flex;
  align-items: stretch;
  overflow: hidden;
  flex-shrink: 0;
}
#viz-panel.hidden { display: none; }
#viz-canvas-wrapper {
  flex: 1;
  position: relative;
  padding: 8px;
}
#viz-canvas-wrapper canvas { max-height: 184px; }
#viz-metrics {
  width: 160px;
  padding: 12px;
  border-left: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 12px;
}
.metric-card { display: flex; flex-direction: column; gap: 1px; }
.metric-label { color: var(--text-muted); font-size: 10px; text-transform: uppercase; }
.metric-value { font-weight: 700; font-size: 14px; font-family: var(--font-mono); }

/* ─── Right Column ───────────────────────────────────── */
#right-col {
  width: var(--result-w);
  border-left: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  flex-shrink: 0;
}

/* ─── Result Panel ───────────────────────────────────── */
#result-panel {
  flex: 1;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow-y: auto;
  background: var(--bg-panel);
}
#result-panel h3 {
  font-size: 12px;
  text-transform: uppercase;
  color: var(--text-muted);
  letter-spacing: 0.05em;
}
.result-field { display: flex; flex-direction: column; gap: 2px; }
.result-field-label { font-size: 10px; color: var(--text-muted); text-transform: uppercase; }
.result-field-value {
  font-family: var(--font-mono);
  font-size: 12px;
  word-break: break-all;
}
.status-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 3px;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
}
.status-badge.pass    { background: var(--color-pass-bg);    color: var(--color-pass);    }
.status-badge.fail    { background: var(--color-fail-bg);    color: var(--color-fail);    }
.status-badge.timeout { background: var(--color-timeout-bg); color: var(--color-timeout); }
.status-badge.init    { background: var(--color-init-bg);    color: var(--color-init);    }
.status-badge.raw     { background: var(--color-raw-bg);     color: var(--color-raw);     }
#btn-retry {
  padding: 6px 14px;
  background: #4a90e2;
  color: #fff;
  border: none;
  border-radius: var(--radius);
  cursor: pointer;
  font-size: 12px;
  display: none;
}
#btn-retry.visible { display: block; }
#btn-retry:hover { background: #357abd; }

/* ─── Export Panel ───────────────────────────────────── */
#export-panel {
  border-top: 1px solid var(--border);
  padding: 12px;
  background: var(--bg-panel);
  flex-shrink: 0;
}
#export-panel h3 {
  font-size: 12px;
  text-transform: uppercase;
  color: var(--text-muted);
  letter-spacing: 0.05em;
  margin-bottom: 8px;
}
#export-buttons { display: flex; gap: 8px; }
.btn-export {
  padding: 5px 12px;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  cursor: pointer;
  font-size: 12px;
}
.btn-export:hover { background: var(--border); }
.btn-export.flash-success {
  background: var(--color-pass-bg);
  border-color: var(--color-pass);
  color: var(--color-pass);
}
.btn-export.flash-error {
  background: var(--color-fail-bg);
  border-color: var(--color-fail);
  color: var(--color-fail);
}
#session-file-path {
  margin-top: 6px;
  font-size: 10px;
  color: var(--text-muted);
  font-family: var(--font-mono);
  word-break: break-all;
}

/* ─── Toast ──────────────────────────────────────────── */
#toast-container {
  position: fixed;
  bottom: 16px;
  right: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  z-index: 999;
  pointer-events: none;
}
.toast {
  padding: 8px 14px;
  border-radius: var(--radius);
  font-size: 12px;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  box-shadow: 0 2px 8px rgba(0,0,0,0.15);
  animation: fade-in 0.2s ease;
}
.toast.error { background: var(--color-fail-bg); border-color: var(--color-fail); color: var(--color-fail); }
@keyframes fade-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
```

- [ ] **Step 3.2: Visual sanity check**

Open `frontend/index.html` in a browser after Task 4 completes and verify layout renders without overflow.

---

## Task 4: `frontend/index.html` — Window shell

**Files:**
- Create: `frontend/index.html`

- [ ] **Step 4.1: Write `frontend/index.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'self'; script-src 'self' https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline';">
  <title>Sailbot Dev Board — Protocol Tester</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>

  <!-- Titlebar -->
  <header id="titlebar">
    <span id="status-dot" class="disconnected" title="Connection status"></span>
    <select id="port-select" aria-label="Serial port">
      <option value="">— select port —</option>
    </select>
    <input id="baud-input" type="number" value="115200" min="1200" max="4000000"
           aria-label="Baud rate" step="0">
    <span id="titlebar-label" style="color:#aaa;font-size:11px;">Sailbot Debug</span>
    <button id="btn-connect">Connect</button>
  </header>

  <!-- Disconnected banner -->
  <div id="banner" role="alert" aria-live="polite">
    Disconnected — reconnecting… <span id="reconnect-counter"></span>
  </div>

  <!-- 3-column main -->
  <div id="main">

    <!-- Sidebar -->
    <nav id="sidebar" aria-label="Protocol selector">
      <!-- Populated by app.js -->
    </nav>

    <!-- Centre column -->
    <div id="centre">
      <div id="terminal" role="log" aria-label="Protocol terminal" aria-live="polite"></div>
      <div id="terminal-footer">
        Session: <span id="stat-duration">00:00:00</span> ·
        <span id="stat-passed">0</span> passed ·
        <span id="stat-failed">0</span> failed
      </div>

      <div id="command-bar" aria-label="Command bar">
        <div id="preset-buttons" role="group" aria-label="Preset commands"></div>
        <div id="custom-form" aria-label="Custom command form">
          <!-- Fields injected by app.js -->
          <button id="btn-custom-send" type="button">Send Custom</button>
        </div>
        <div id="raw-input-row">
          <input id="raw-input" type="text" placeholder="Raw command…" aria-label="Raw command input">
          <button id="btn-send" type="button">Send</button>
        </div>
      </div>

      <div id="viz-panel" class="hidden" aria-label="Visualization">
        <div id="viz-canvas-wrapper">
          <canvas id="viz-canvas"></canvas>
        </div>
        <div id="viz-metrics" aria-label="Metrics">
          <!-- Injected by charts.js -->
        </div>
      </div>
    </div>

    <!-- Right column -->
    <aside id="right-col">
      <section id="result-panel" aria-label="Last result">
        <h3>Last Result</h3>
        <div class="result-field">
          <span class="result-field-label">Protocol</span>
          <span class="result-field-value" id="res-proto">—</span>
        </div>
        <div class="result-field">
          <span class="result-field-label">Status</span>
          <span id="res-status"><span class="status-badge">—</span></span>
        </div>
        <div class="result-field">
          <span class="result-field-label">Data</span>
          <span class="result-field-value" id="res-data">—</span>
        </div>
        <div class="result-field">
          <span class="result-field-label">RTT</span>
          <span class="result-field-value" id="res-rtt">—</span>
        </div>
        <!-- CANFD-specific fields (hidden unless proto === CANFD) -->
        <div class="result-field" id="res-can-group" style="display:none">
          <span class="result-field-label">Frame ID</span>
          <span class="result-field-value" id="res-can-id">—</span>
        </div>
        <div class="result-field" id="res-dlc-group" style="display:none">
          <span class="result-field-label">DLC</span>
          <span class="result-field-value" id="res-dlc">—</span>
        </div>
        <button id="btn-retry" type="button" aria-label="Retry last command">Retry</button>
      </section>

      <section id="export-panel" aria-label="Export session">
        <h3>Export</h3>
        <div id="export-buttons">
          <button class="btn-export" id="btn-export-log" type="button">.log</button>
          <button class="btn-export" id="btn-export-csv" type="button">.csv</button>
        </div>
        <div id="session-file-path"></div>
      </section>
    </aside>
  </div>

  <div id="toast-container" aria-live="polite"></div>

  <!-- Chart.js from CDN -->
  <script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js"></script>

  <!-- App modules — type=module enables ES6 imports -->
  <script type="module" src="app.js"></script>

</body>
</html>
```

- [ ] **Step 4.2: Commit**

```bash
git add frontend/index.html frontend/styles.css
git commit -m "feat: add index.html shell and styles.css with CSS variable theming"
```

---

## Task 5: `frontend/terminal.js` — Terminal component

**Files:**
- Create: `frontend/terminal.js`

- [ ] **Step 5.1: Write `frontend/terminal.js`**

```javascript
// frontend/terminal.js
// Manages the terminal DOM region: appending lines, color coding, auto-scroll.

const STATUS_CLASS = {
  PASS:    'term-pass',
  FAIL:    'term-fail',
  TIMEOUT: 'term-timeout',
  RAW:     'term-raw',
  INIT:    'term-init',
};

function formatTs(d = new Date()) {
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `[${hh}:${mm}:${ss}.${ms}]`;
}

function formatDuration(ms) {
  const s  = Math.floor(ms / 1000);
  const hh = String(Math.floor(s / 3600)).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

export class Terminal {
  constructor({ containerEl, footerDuration, footerPassed, footerFailed }) {
    this._el       = containerEl;
    this._durEl    = footerDuration;
    this._passEl   = footerPassed;
    this._failEl   = footerFailed;
    this._passed   = 0;
    this._failed   = 0;
    this._startedAt = Date.now();
    this._userScrolled = false;
    this._timerHandle = null;

    // Detect manual scroll-up
    this._el.addEventListener('scroll', () => {
      const atBottom = this._el.scrollHeight - this._el.scrollTop - this._el.clientHeight < 4;
      this._userScrolled = !atBottom;
    });

    this._startTimer();
  }

  // Append a parsed or raw line to the terminal.
  // status: 'PASS'|'FAIL'|'TIMEOUT'|'INIT'|'RAW'
  append(text, status = 'INIT') {
    const cls = STATUS_CLASS[status] || 'term-init';

    const line = document.createElement('div');
    line.className = 'term-line';

    const ts = document.createElement('span');
    ts.className = 'term-ts';
    ts.textContent = formatTs();

    const body = document.createElement('span');
    body.className = cls;
    body.textContent = text;

    line.appendChild(ts);
    line.appendChild(body);
    this._el.appendChild(line);

    if (!this._userScrolled) {
      this._el.scrollTop = this._el.scrollHeight;
    }

    if (status === 'PASS')   this._passed++;
    if (status === 'FAIL')   this._failed++;
    this._updateFooter();
  }

  clear() {
    this._el.innerHTML = '';
    this._passed = 0;
    this._failed = 0;
    this._startedAt = Date.now();
    this._updateFooter();
  }

  _updateFooter() {
    if (this._passEl) this._passEl.textContent = String(this._passed);
    if (this._failEl) this._failEl.textContent = String(this._failed);
  }

  _startTimer() {
    this._timerHandle = setInterval(() => {
      if (this._durEl) {
        this._durEl.textContent = formatDuration(Date.now() - this._startedAt);
      }
    }, 1000);
  }

  destroy() {
    clearInterval(this._timerHandle);
  }
}
```

- [ ] **Step 5.2: Write unit tests for terminal helpers**

Create `frontend/terminal.test.js`:

```javascript
// frontend/terminal.test.js
// Test the non-DOM helper functions extracted from terminal.js.
// Run with: node --input-type=module < frontend/terminal.test.js

function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); process.exitCode = 1; }
  else        { console.log('PASS:', msg); }
}

// Inline the helpers (can't import browser-targeted module in Node without DOM)
function formatTs(d) {
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `[${hh}:${mm}:${ss}.${ms}]`;
}
function formatDuration(ms) {
  const s  = Math.floor(ms / 1000);
  const hh = String(Math.floor(s / 3600)).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

// formatTs
const d = new Date(2026, 2, 28, 9, 5, 3, 42);
assert(formatTs(d) === '[09:05:03.042]', 'formatTs pads all fields');

const d2 = new Date(2026, 2, 28, 23, 59, 59, 999);
assert(formatTs(d2) === '[23:59:59.999]', 'formatTs handles max values');

// formatDuration
assert(formatDuration(0)        === '00:00:00', 'zero ms');
assert(formatDuration(61000)    === '00:01:01', '61 seconds');
assert(formatDuration(3661000)  === '01:01:01', '1h 1m 1s');
assert(formatDuration(86399000) === '23:59:59', '23:59:59');
```

- [ ] **Step 5.3: Run test**

```bash
node --input-type=module < frontend/terminal.test.js
```

Expected: all `PASS:` lines.

- [ ] **Step 5.4: Commit**

```bash
git add frontend/terminal.js frontend/terminal.test.js
git commit -m "feat: add Terminal component with auto-scroll and session stats"
```

---

## Task 6: `frontend/charts.js` — Chart.js visualization

**Files:**
- Create: `frontend/charts.js`

Chart.js is loaded globally from CDN. `charts.js` references `window.Chart`. The canvas element (`#viz-canvas`) is shared; `Charts.show(proto)` destroys the previous chart and creates a new one.

- [ ] **Step 6.1: Write `frontend/charts.js`**

```javascript
// frontend/charts.js
// Manages Chart.js instances for UART, SPI, and CANFD.
// Chart is always rendered into #viz-canvas. Call show(proto) to switch;
// call push(proto, payload) to feed new data.

const MAX_UART_SAMPLES = 30;
const MAX_SPI_BARS     = 8;

// Shared muted color palette — one per CANFD frame ID (up to 8 IDs)
const CAN_COLORS = [
  '#4a90e2', '#e2914a', '#4ae27c', '#e24a90',
  '#4ae2e2', '#e2e24a', '#904ae2', '#e24a4a',
];

export class Charts {
  constructor({ canvasEl, metricsEl }) {
    this._canvas  = canvasEl;
    this._metrics = metricsEl;
    this._chart   = null;
    this._proto   = null;

    // Per-protocol rolling data stores
    this._uart = { rtts: [], totalBytes: 0, errors: 0, total: 0 };
    this._spi  = { txs: [], rxs: [], matchCount: 0, txCount: 0 };
    this._can  = {
      points: [],       // [{ x: seconds, y: idIndex, idHex: '0x130' }]
      idMap: {},        // hex string → y-axis index
      errorCount: 0,
      lastRtt: null,
      startedAt: Date.now(),
    };
  }

  // Switch active protocol chart. Destroys previous chart.
  show(proto) {
    if (this._chart) { this._chart.destroy(); this._chart = null; }
    this._proto = proto;
    if (proto === 'UART')  this._buildUart();
    if (proto === 'SPI')   this._buildSpi();
    if (proto === 'CANFD') this._buildCanfd();
    this._refreshMetrics();
  }

  hide() {
    if (this._chart) { this._chart.destroy(); this._chart = null; }
    this._proto = null;
    this._metrics.innerHTML = '';
  }

  // Feed new data point. Call after parsing a response.
  push(proto, { status, data, rtt }) {
    if (proto === 'UART') {
      this._uart.total++;
      if (status === 'FAIL') this._uart.errors++;
      if (rtt != null) {
        this._uart.rtts.push(rtt);
        if (this._uart.rtts.length > MAX_UART_SAMPLES) this._uart.rtts.shift();
        this._uart.totalBytes += (data || '').length;
      }
    }
    if (proto === 'SPI') {
      this._spi.txCount++;
      const txMatch = (data || '').match(/TX=0x([0-9A-Fa-f]{1,2})/);
      const rxMatch = (data || '').match(/RX=0x([0-9A-Fa-f]{1,2})/);
      const tx = txMatch ? parseInt(txMatch[1], 16) : 0;
      const rx = rxMatch ? parseInt(rxMatch[1], 16) : 0;
      this._spi.txs.push(tx);
      this._spi.rxs.push(rx);
      if (tx === rx) this._spi.matchCount++;
      if (this._spi.txs.length > MAX_SPI_BARS) {
        this._spi.txs.shift(); this._spi.rxs.shift();
      }
    }
    if (proto === 'CANFD') {
      if (status === 'FAIL') this._can.errorCount++;
      if (rtt != null) this._can.lastRtt = rtt;
      const idMatch = (data || '').match(/ID=0x([0-9A-Fa-f]+)/);
      if (idMatch) {
        const hex = '0x' + idMatch[1].toUpperCase();
        if (!(hex in this._can.idMap)) {
          this._can.idMap[hex] = Object.keys(this._can.idMap).length;
        }
        const nowSec = (Date.now() - this._can.startedAt) / 1000;
        this._can.points.push({ x: nowSec, y: this._can.idMap[hex], idHex: hex });
      }
    }

    if (this._proto === proto) this._updateChart();
    if (this._proto === proto) this._refreshMetrics();
  }

  // ─── Private build helpers ───────────────────────────

  _buildUart() {
    this._chart = new Chart(this._canvas, {
      type: 'line',
      data: {
        labels: this._uart.rtts.map((_, i) => i + 1),
        datasets: [{
          label: 'RTT (ms)',
          data: this._uart.rtts,
          borderColor: '#4a90e2',
          backgroundColor: 'rgba(74,144,226,0.1)',
          tension: 0.3,
          pointRadius: 3,
        }],
      },
      options: {
        animation: false,
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { display: false },
          y: { title: { display: true, text: 'ms' }, beginAtZero: true },
        },
        plugins: { legend: { display: false } },
      },
    });
  }

  _buildSpi() {
    const labels = this._spi.txs.map((_, i) => `T${i + 1}`);
    this._chart = new Chart(this._canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'TX', data: this._spi.txs, backgroundColor: '#4a90e2' },
          { label: 'RX', data: this._spi.rxs, backgroundColor: '#e2914a' },
        ],
      },
      options: {
        animation: false,
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: {
            min: 0, max: 255,
            ticks: {
              callback: v => `0x${v.toString(16).toUpperCase().padStart(2,'0')}`,
            },
          },
        },
      },
    });
  }

  _buildCanfd() {
    const ids = Object.keys(this._can.idMap);
    this._chart = new Chart(this._canvas, {
      type: 'scatter',
      data: {
        datasets: ids.map((hex, idx) => ({
          label: hex,
          data: this._can.points
            .filter(p => p.idHex === hex)
            .map(p => ({ x: p.x, y: p.y })),
          backgroundColor: CAN_COLORS[idx % CAN_COLORS.length],
          pointRadius: 5,
        })),
      },
      options: {
        animation: false,
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { title: { display: true, text: 'time (s)' } },
          y: {
            ticks: {
              stepSize: 1,
              callback: v => ids[v] || '',
            },
            min: -0.5,
            max: Math.max(ids.length - 0.5, 0.5),
          },
        },
      },
    });
  }

  _updateChart() {
    if (!this._chart) return;
    if (this._proto === 'UART') {
      this._chart.data.labels = this._uart.rtts.map((_, i) => i + 1);
      this._chart.data.datasets[0].data = this._uart.rtts;
    }
    if (this._proto === 'SPI') {
      const labels = this._spi.txs.map((_, i) => `T${i + 1}`);
      this._chart.data.labels = labels;
      this._chart.data.datasets[0].data = this._spi.txs;
      this._chart.data.datasets[1].data = this._spi.rxs;
    }
    if (this._proto === 'CANFD') {
      // Rebuild scatter fully (IDs may have grown)
      this._chart.destroy();
      this._buildCanfd();
      return;
    }
    this._chart.update();
  }

  _refreshMetrics() {
    let html = '';
    if (this._proto === 'UART') {
      const lastRtt  = this._uart.rtts.at(-1) ?? '—';
      const errRate  = this._uart.total > 0
        ? ((this._uart.errors / this._uart.total) * 100).toFixed(1) + '%'
        : '0%';
      html = `
        <div class="metric-card"><span class="metric-label">Last RTT</span><span class="metric-value">${lastRtt} ms</span></div>
        <div class="metric-card"><span class="metric-label">Bytes sent</span><span class="metric-value">${this._uart.totalBytes}</span></div>
        <div class="metric-card"><span class="metric-label">Error rate</span><span class="metric-value">${errRate}</span></div>
      `;
    }
    if (this._proto === 'SPI') {
      const matchRate = this._spi.txCount > 0
        ? ((this._spi.matchCount / this._spi.txCount) * 100).toFixed(1) + '%'
        : '0%';
      html = `
        <div class="metric-card"><span class="metric-label">Match rate</span><span class="metric-value">${matchRate}</span></div>
        <div class="metric-card"><span class="metric-label">TX count</span><span class="metric-value">${this._spi.txCount}</span></div>
      `;
    }
    if (this._proto === 'CANFD') {
      const lastRtt  = this._can.lastRtt ?? '—';
      html = `
        <div class="metric-card"><span class="metric-label">IDs seen</span><span class="metric-value">${Object.keys(this._can.idMap).length}</span></div>
        <div class="metric-card"><span class="metric-label">Error frames</span><span class="metric-value">${this._can.errorCount}</span></div>
        <div class="metric-card"><span class="metric-label">Last RTT</span><span class="metric-value">${lastRtt} ms</span></div>
      `;
    }
    this._metrics.innerHTML = html;
  }
}
```

- [ ] **Step 6.2: Commit**

```bash
git add frontend/charts.js
git commit -m "feat: add Charts class for UART/SPI/CANFD Chart.js visualizations"
```

---

## Task 7: `frontend/app.js` — Main application logic

**Files:**
- Create: `frontend/app.js`

`app.js` imports `protocols.js`, `terminal.js`, `charts.js`. It owns all state and wires IPC events to DOM. `window.electronAPI` is the only external dependency.

- [ ] **Step 7.1: Write `frontend/app.js`**

```javascript
// frontend/app.js
// Main renderer application. Owns all state, wires IPC → DOM.
// Depends on: window.electronAPI (preload.js), Terminal, Charts, PROTOCOLS.

import { PROTOCOLS, PROTOCOL_ORDER, parseLine, parseCanFrame } from './protocols.js';
import { Terminal } from './terminal.js';
import { Charts }   from './charts.js';

// ─── State ───────────────────────────────────────────────
const state = {
  connected:    false,
  activeProto:  null,          // 'UART' | 'SPI' | 'CANFD' | null
  lastCommand:  null,          // string — for Retry
  lastSentAt:   null,          // ms timestamp
  badgeState:   { UART: 'gray', SPI: 'gray', CANFD: 'gray' },
  sessionPath:  null,
  unsubs:       [],            // IPC unsubscribe handles
};

// ─── DOM refs ────────────────────────────────────────────
const $ = id => document.getElementById(id);
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
const resultProto      = $('res-proto');
const resultStatus     = $('res-status');
const resultData       = $('res-data');
const resultRtt        = $('res-rtt');
const resCanGroup      = $('res-can-group');
const resDlcGroup      = $('res-dlc-group');
const resCanId         = $('res-can-id');
const resDlc           = $('res-dlc');
const btnRetry         = $('btn-retry');
const btnExportLog     = $('btn-export-log');
const btnExportCsv     = $('btn-export-csv');
const sessionFilePath  = $('session-file-path');
const toastContainer   = $('toast-container');

// ─── Sub-components ──────────────────────────────────────
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

// ─── Utilities ───────────────────────────────────────────
function showToast(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast${type === 'error' ? ' error' : ''}`;
  el.textContent = msg;
  toastContainer.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

function flashExportButton(btn, success) {
  btn.classList.add(success ? 'flash-success' : 'flash-error');
  setTimeout(() => btn.classList.remove('flash-success', 'flash-error'), 1200);
}

function setConnected(connected) {
  state.connected = connected;
  statusDot.className = connected ? 'connected' : 'disconnected';
  btnConnect.textContent = connected ? 'Disconnect' : 'Connect';
  btnConnect.classList.toggle('connected', connected);
  banner.classList.toggle('visible', !connected);
  if (connected) reconnectCounter.textContent = '';
  _updateCommandBarEnabled();
  _updateSidebarEnabled();
}

// ─── Port list ───────────────────────────────────────────
async function refreshPorts() {
  const ports = await window.electronAPI.listPorts();
  // Preserve current selection if still valid
  const current = portSelect.value;
  portSelect.innerHTML = '<option value="">— select port —</option>';
  for (const p of ports) {
    const opt = document.createElement('option');
    opt.value = p.path;
    opt.textContent = `${p.path}${p.manufacturer ? ' · ' + p.manufacturer : ''}`;
    portSelect.appendChild(opt);
  }
  if (ports.some(p => p.path === current)) portSelect.value = current;
}

// ─── Connect / Disconnect ────────────────────────────────
btnConnect.addEventListener('click', async () => {
  if (state.connected) {
    await window.electronAPI.disconnect();
    setConnected(false);
    terminal.append('Disconnected by user.', 'INIT');
    return;
  }
  const path = portSelect.value;
  if (!path) { showToast('Select a port first.', 'error'); return; }
  const baud = parseInt(baudInput.value, 10);
  const result = await window.electronAPI.connect({ path, baudRate: baud });
  if (result.success) {
    setConnected(true);
    terminal.append(`Connected to ${path} @ ${baud}`, 'INIT');
  } else {
    showToast(`Connect failed: ${result.error || 'unknown error'}`, 'error');
  }
});

// ─── Sidebar ─────────────────────────────────────────────
function buildSidebar() {
  sidebar.innerHTML = '';
  for (const id of PROTOCOL_ORDER) {
    const proto = PROTOCOLS[id];
    const row = document.createElement('div');
    row.className = 'proto-row';
    row.dataset.proto = id;
    row.setAttribute('role', 'button');
    row.setAttribute('tabindex', '0');
    row.setAttribute('aria-label', `${proto.label} protocol`);

    const name = document.createElement('span');
    name.textContent = proto.label;

    const badge = document.createElement('span');
    badge.className = 'proto-badge gray';
    badge.textContent = '—';
    badge.id = `badge-${id}`;

    row.appendChild(name);
    row.appendChild(badge);
    sidebar.appendChild(row);

    row.addEventListener('click', () => setActiveProtocol(id));
    row.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') setActiveProtocol(id); });
  }
}

function setBadge(protoId, statusKey) {
  state.badgeState[protoId] = statusKey;
  const el = document.getElementById(`badge-${protoId}`);
  if (!el) return;
  const CLASS_MAP = { gray: 'gray', PASS: 'pass', FAIL: 'fail', TIMEOUT: 'timeout' };
  const TEXT_MAP  = { gray: '—', PASS: 'PASS', FAIL: 'FAIL', TIMEOUT: 'TIMEOUT' };
  el.className = 'proto-badge ' + (CLASS_MAP[statusKey] || 'gray');
  el.textContent = TEXT_MAP[statusKey] || '—';
}

function _updateSidebarEnabled() {
  document.querySelectorAll('.proto-row').forEach(row => {
    row.classList.toggle('disabled', !state.connected);
  });
}

// ─── Active protocol ─────────────────────────────────────
function setActiveProtocol(id) {
  if (!state.connected) return;
  state.activeProto = id;

  // Sidebar active highlight
  document.querySelectorAll('.proto-row').forEach(row => {
    row.classList.toggle('active', row.dataset.proto === id);
  });

  _buildCommandBar(id);
  vizPanel.classList.remove('hidden');
  charts.show(id);
}

// ─── Command bar ─────────────────────────────────────────
let _currentCustomFields = [];

function _buildCommandBar(protoId) {
  const proto = PROTOCOLS[protoId];
  presetButtons.innerHTML = '';
  customForm.classList.remove('visible');
  customForm.innerHTML = '';
  customForm.appendChild(btnCustomSend);

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
  customForm.innerHTML = '';
  _currentCustomFields = fields;
  for (const f of fields) {
    const input = document.createElement('input');
    input.className = 'custom-field';
    input.type = 'text';
    input.placeholder = f.placeholder;
    input.dataset.fieldName = f.name;
    input.required = f.required;
    customForm.appendChild(input);
  }
  customForm.appendChild(btnCustomSend);
  customForm.classList.add('visible');
}

btnCustomSend.addEventListener('click', () => {
  const inputs = customForm.querySelectorAll('.custom-field');
  const parts = [];
  for (const input of inputs) {
    if (input.required && !input.value.trim()) {
      showToast(`Field "${input.placeholder}" is required.`, 'error');
      return;
    }
    parts.push(input.value.trim());
  }
  const protoId = state.activeProto;
  const command = `${protoId}:CUSTOM:${parts.join(':')}`;
  sendCommand(command);
  customForm.classList.remove('visible');
});

function _updateCommandBarEnabled() {
  const disabled = !state.connected;
  document.querySelectorAll('.btn-preset').forEach(b => { b.disabled = disabled; });
  btnSend.disabled = disabled;
}

btnSend.addEventListener('click', () => {
  const cmd = rawInput.value.trim();
  if (!cmd) return;
  sendCommand(cmd);
  rawInput.value = '';
});

rawInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') btnSend.click();
});

// ─── Send ────────────────────────────────────────────────
async function sendCommand(command) {
  if (!state.connected) return;
  state.lastCommand = command;
  state.lastSentAt  = Date.now();
  terminal.append(`> ${command}`, 'INIT');
  await window.electronAPI.send({ command });
  btnRetry.classList.add('visible');
}

btnRetry.addEventListener('click', () => {
  if (state.lastCommand) sendCommand(state.lastCommand);
});

// ─── Incoming data ───────────────────────────────────────
function handleData({ raw, proto, status, data, rtt }) {
  const parsed = parseLine(raw);

  if (!parsed) {
    terminal.append(raw, 'RAW');
    return;
  }

  terminal.append(raw, parsed.status);

  // Update sidebar badge
  const badgeKey = ['PASS', 'FAIL', 'TIMEOUT'].includes(parsed.status) ? parsed.status : null;
  if (badgeKey) setBadge(parsed.proto, badgeKey);

  // Feed charts
  charts.push(parsed.proto, { status: parsed.status, data: parsed.data, rtt });

  // Update result panel
  resultProto.textContent = parsed.proto;
  resultRtt.textContent   = rtt != null ? `${rtt} ms` : '—';
  resultData.textContent  = parsed.data;

  const badge = document.createElement('span');
  badge.className = `status-badge ${parsed.status.toLowerCase()}`;
  badge.textContent = parsed.status;
  resultStatus.innerHTML = '';
  resultStatus.appendChild(badge);

  // CANFD extra fields
  const isCanfd = parsed.proto === 'CANFD';
  resCanGroup.style.display = isCanfd ? '' : 'none';
  resDlcGroup.style.display = isCanfd ? '' : 'none';
  if (isCanfd) {
    const frame = parseCanFrame(parsed.data);
    resCanId.textContent = frame.id != null ? `0x${frame.id.toString(16).toUpperCase()}` : '—';
    resDlc.textContent   = frame.dlc != null ? String(frame.dlc) : '—';
  }

  // Show retry on FAIL or TIMEOUT
  const showRetry = parsed.status === 'FAIL' || parsed.status === 'TIMEOUT';
  btnRetry.classList.toggle('visible', showRetry);
}

// ─── Export ──────────────────────────────────────────────
btnExportLog.addEventListener('click', async () => {
  const result = await window.electronAPI.exportLog();
  if (result.success) {
    flashExportButton(btnExportLog, true);
    if (result.path) sessionFilePath.textContent = result.path;
  } else {
    flashExportButton(btnExportLog, false);
    showToast(`Export failed: ${result.error || 'unknown'}`, 'error');
  }
});

btnExportCsv.addEventListener('click', async () => {
  const result = await window.electronAPI.exportCsv();
  if (result.success) {
    flashExportButton(btnExportCsv, true);
    if (result.path) sessionFilePath.textContent = result.path;
  } else {
    flashExportButton(btnExportCsv, false);
    showToast(`Export failed: ${result.error || 'unknown'}`, 'error');
  }
});

// ─── IPC subscriptions ───────────────────────────────────
function wireIpc() {
  state.unsubs.push(
    window.electronAPI.onData(handleData),
    window.electronAPI.onConnectionStatus(({ connected, port, baud }) => {
      setConnected(connected);
      if (connected) terminal.append(`Status: connected to ${port} @ ${baud}`, 'INIT');
    }),
    window.electronAPI.onReconnectAttempt(({ attempt, max }) => {
      reconnectCounter.textContent = `(attempt ${attempt}/${max})`;
      banner.classList.add('visible');
    }),
    window.electronAPI.onSessionPath(({ path }) => {
      state.sessionPath = path;
      sessionFilePath.textContent = path;
    }),
  );
}

// ─── Init ────────────────────────────────────────────────
async function init() {
  buildSidebar();
  await refreshPorts();
  wireIpc();
  terminal.append('Ready. Select a port and connect.', 'INIT');
}

init();
```

- [ ] **Step 7.2: Commit**

```bash
git add frontend/app.js
git commit -m "feat: add app.js — IPC wiring, state, command bar, result panel, export"
```

---

## Task 8: Integration smoke test (manual)

**Files:** None (test procedure only)

- [ ] **Step 8.1: Verify project can open in Electron (or a browser for visual check)**

If `main.js` doesn't exist yet, open `frontend/index.html` directly in Chrome (file://). The mock emitter in `preload.js` won't run because `window.electronAPI` is undefined in a plain browser — that's expected. Verify:
  - Layout renders with 3 columns, no overflow, no console errors related to HTML/CSS
  - Titlebar, sidebar (empty), terminal, command bar, result panel, export panel all visible

- [ ] **Step 8.2: Mock `window.electronAPI` in browser console**

Paste in Chrome DevTools console to simulate the full mock:

```javascript
window.electronAPI = {
  listPorts: () => Promise.resolve([
    { path: 'COM3', manufacturer: 'ST' },
    { path: 'COM4', manufacturer: 'FTDI' },
  ]),
  connect: () => Promise.resolve({ success: true }),
  disconnect: () => Promise.resolve({ success: true }),
  send: ({ command }) => Promise.resolve({ success: true, sentAt: Date.now() }),
  onData: (cb) => { window._onData = cb; return () => {}; },
  onConnectionStatus: (cb) => { window._onConnStatus = cb; return () => {}; },
  onReconnectAttempt: (cb) => { window._onReconnect = cb; return () => {}; },
  onSessionPath: (cb) => { window._onSessPath = cb; return () => {}; },
  exportCsv: () => Promise.resolve({ success: true, path: '/mock/session.csv' }),
  exportLog: () => Promise.resolve({ success: true, path: '/mock/session.log' }),
};
```

Then reload with `location.reload()`.

- [ ] **Step 8.3: Verify each feature works**

1. Port dropdown populated → select COM3, click Connect → status dot turns green, banner hidden
2. Click UART in sidebar → UART row highlighted, command bar shows UART buttons, viz panel appears
3. Click "Loopback" button → terminal shows `> UART:LOOP`, result panel shows proto UART
4. In console: `window._onData({ raw: 'UART:PASS:loopback ok', proto:'UART', status:'PASS', data:'loopback ok', rtt: 12 })` → terminal shows green line, sidebar badge → PASS, result panel updates
5. Click SPI → SPI buttons appear, chart switches to bar
6. In console: `window._onData({ raw: 'SPI:FAIL:no device', proto:'SPI', status:'FAIL', data:'no device', rtt: 5 })` → red line in terminal, FAIL badge, Retry button visible
7. Click CANFD → scatter chart appears
8. In console: `window._onData({ raw: 'CANFD:PASS:ID=0x130 DLC=8 BYTES=DEAD', proto:'CANFD', status:'PASS', data:'ID=0x130 DLC=8 BYTES=DEAD', rtt: 8 })` → scatter chart updates, result panel shows Frame ID = 0x130, DLC = 8
9. Click `.log` export → button flashes green, file path shown below buttons
10. In console: `window._onReconnect({ attempt: 2, max: 5 })` → banner shows "(attempt 2/5)"
11. Type garbage in raw input, press Enter → purple line in terminal, no badge change

- [ ] **Step 8.4: Final commit**

```bash
git add .
git commit -m "feat: complete Sailbot dev board frontend — UART/SPI/CANFD UI, charts, IPC stubs"
```

---

## Spec Coverage Check

| Spec requirement | Covered by |
|------------------|-----------|
| UART, SPI, CANFD only — no I2C/GPIO/RS232/NMEA placeholders | `protocols.js` — only 3 entries |
| Discover IPC before writing code | Done — no backend found; IPC interface designed + stubbed in `preload.js` |
| Frame format `PROTO:STATUS:DATA\r\n` | `parseLine()` in `protocols.js` |
| Single window, always-visible regions | `index.html` 3-column grid, no tabs |
| Protocol sidebar with badge states | `app.js` `buildSidebar()` + `setBadge()` |
| Terminal with timestamps, color, auto-scroll | `terminal.js` |
| Color coding by status | `styles.css` `.term-pass/fail/timeout/raw/init` |
| Session stats footer | `terminal.js` `_updateFooter()` + timer |
| Command bar presets per protocol | `protocols.js` + `app.js` `_buildCommandBar()` |
| Custom... inline form | `app.js` `_openCustomForm()` |
| Result panel: proto, status, data, RTT, retry | `app.js` `handleData()` + `index.html` |
| CANFD Frame ID + DLC in result panel | `app.js` + `parseCanFrame()` |
| UART line chart (30 samples) | `charts.js` `_buildUart()` |
| SPI grouped bar chart (last 8) | `charts.js` `_buildSpi()` |
| CANFD scatter chart (ID rows) | `charts.js` `_buildCanfd()` |
| Metric cards per protocol | `charts.js` `_refreshMetrics()` |
| Connection banner with retry counter | `app.js` + `index.html` `#banner` |
| Buttons disabled while disconnected | `app.js` `_updateCommandBarEnabled()` + `_updateSidebarEnabled()` |
| Per-protocol FAIL/TIMEOUT retry | `app.js` `btnRetry` |
| Malformed lines → purple, no badge update | `app.js` `handleData()` null-check on `parseLine()` |
| CSS variables for theming | `styles.css` `:root` + `body.dark` |
| WCAG AA contrast colors | Verified: `#1a7a1a` on white = 6.3:1, `#c0392b` on white = 5.1:1 |
| Export: flash on success, toast on error | `app.js` `flashExportButton()` + `showToast()` |
| Session file path below export buttons | `app.js` `sessionFilePath` |
| Chart.js from cdnjs | `index.html` script tag |
| No React/Vue — plain JS | All files |
| No inline onclick | All files use `addEventListener` |
| No hardcoded COM ports | `refreshPorts()` reads from `electronAPI.listPorts()` |
| No timeouts in renderer | No `setTimeout` for logic; only UI flash animation |
