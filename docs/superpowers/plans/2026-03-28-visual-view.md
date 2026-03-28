# Visual View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Terminal / Visual" segmented toggle to the titlebar that switches between the existing raw terminal view and a new Visual view with protocol tabs, big command cards, a live chart, and a status footer — designed for non-technical users.

**Architecture:** A segmented toggle in the titlebar sets `body.view-terminal` / `body.view-visual` CSS classes; CSS rules show/hide the existing `#sidebar + #centre + #right-col` columns versus a new `#visual-panel` that spans the full width. `VisualView` (new `visual.js`) manages the visual panel: builds protocol tabs from `PROTOCOLS`, renders command cards, owns a dedicated `Charts` instance (`#visual-canvas`), and updates a status footer. `app.js` forwards incoming data and connection state to both the existing terminal path and the new `VisualView`.

**Tech Stack:** Vanilla JS ES6 modules, Chart.js 4.4.1 (CDN, already loaded), CSS custom properties.

---

## File Map

| File | Change | Responsibility |
|---|---|---|
| `frontend/protocols.js` | Modify | Add `desc` field to every command — human-readable description for Visual view cards |
| `frontend/visual.js` | **Create** | `VisualView` class + exported `buildCustomCommand()` pure helper |
| `frontend/visual.test.js` | **Create** | Unit tests for `buildCustomCommand()` |
| `frontend/index.html` | Modify | Add `#view-toggle` to titlebar; add `#visual-panel` HTML scaffold to `#main` |
| `frontend/styles.css` | Modify | View toggle pill, body class show/hide rules, visual panel layout, command cards, tabs, status bar |
| `frontend/app.js` | Modify | Import `VisualView`, add view state, `setView()`, toggle click wiring, forward data + connection events |

---

## Task 1: Add `desc` to protocol commands

**Files:**
- Modify: `frontend/protocols.js`

- [ ] **Step 1: Replace the `PROTOCOLS` export with the version below** (adds `desc` to every command; all other fields are identical)

```js
export const PROTOCOLS = {
  UART: {
    id: 'UART',
    label: 'UART',
    chartType: 'line',
    commands: [
      { label: 'Init',      command: 'UART:INIT', custom: false, desc: 'Initialise UART bridge — run once before testing' },
      { label: 'Loopback',  command: 'UART:LOOP', custom: false, desc: 'Send a byte and verify it echoes back correctly' },
      { label: 'Baud test', command: 'UART:BAUD', custom: false, desc: 'Confirm baud rate matches expected configuration' },
      {
        label: 'Custom…', command: null, custom: true,
        desc: 'Send a custom payload in hex',
        fields: [
          { name: 'payload', placeholder: 'Payload bytes (hex)', required: true },
        ],
      },
    ],
  },
  SPI: {
    id: 'SPI',
    label: 'SPI',
    chartType: 'bar',
    commands: [
      { label: 'Init',          command: 'SPI:INIT',    custom: false, desc: 'Initialise SPI master interface' },
      { label: 'Transfer 0xA5', command: 'SPI:XFER:A5', custom: false, desc: 'Send 0xA5 and read the response byte' },
      { label: 'Transfer 0xFF', command: 'SPI:XFER:FF', custom: false, desc: 'Send 0xFF (all ones) and read the response byte' },
      {
        label: 'Custom…', command: null, custom: true,
        desc: 'Send a custom hex byte and read the response',
        fields: [
          { name: 'byte', placeholder: 'Byte to send (hex, e.g. B3)', required: true },
        ],
      },
    ],
  },
  CANFD: {
    id: 'CANFD',
    label: 'CANFD',
    chartType: 'scatter',
    commands: [
      { label: 'Init',       command: 'CAN:INIT',   custom: false, desc: 'Initialise FDCAN controller and filters' },
      { label: 'Send frame', command: 'CAN:SEND',   custom: false, desc: 'Transmit a standard CAN frame on the bus' },
      { label: 'Bus status', command: 'CAN:STATUS', custom: false, desc: 'Read bus error counters and controller state' },
      {
        label: 'Custom…', command: null, custom: true,
        desc: 'Transmit a frame with custom ID, DLC, and data bytes',
        fields: [
          { name: 'id',    placeholder: 'Frame ID (hex, e.g. 130)',  required: true  },
          { name: 'dlc',   placeholder: 'DLC (0–8)',                  required: true  },
          { name: 'bytes', placeholder: 'Data bytes (hex pairs)',     required: false },
        ],
      },
    ],
  },
};
```

- [ ] **Step 2: Verify existing protocol tests still pass** (`desc` is additive — no breakage expected)

```
node --experimental-vm-modules frontend/protocols.test.js
```
Expected output: `23 passed, 0 failed`

- [ ] **Step 3: Commit**

```bash
git add frontend/protocols.js
git commit -m "feat: add desc field to protocol commands for Visual view cards"
```

---

## Task 2: Add HTML scaffold

**Files:**
- Modify: `frontend/index.html`

- [ ] **Step 1: Add `#view-toggle` to the titlebar** — insert between `#titlebar-label` and `#btn-connect`

```html
    <span id="titlebar-label">Sailbot Debug</span>

    <div id="view-toggle" role="group" aria-label="View mode">
      <button class="view-btn active" data-view="terminal" type="button">Terminal</button>
      <button class="view-btn"        data-view="visual"   type="button">Visual</button>
    </div>

    <button id="btn-connect" type="button">Connect</button>
```

- [ ] **Step 2: Add `#visual-panel` to `#main`** — insert as the last child of `<div id="main">`, directly after the closing `</aside>` tag

```html
    <!-- Visual Panel — shown when view-toggle is set to "Visual" -->
    <div id="visual-panel" aria-label="Visual view">

      <!-- Protocol tab bar -->
      <div id="visual-proto-tabs" role="tablist" aria-label="Protocol">
        <!-- .visual-tab buttons injected by visual.js -->
      </div>

      <!-- Command card grid -->
      <div id="visual-commands" role="group" aria-label="Protocol commands">
        <!-- .visual-cmd-card elements injected by visual.js -->
      </div>

      <!-- Inline custom command form (shown on Custom card click) -->
      <div id="visual-custom-form" class="hidden" aria-label="Custom command form">
        <!-- .custom-field inputs prepended by visual.js -->
        <div id="visual-custom-actions">
          <button id="btn-visual-custom-send"   type="button">Send</button>
          <button id="btn-visual-custom-cancel" type="button">Cancel</button>
        </div>
      </div>

      <!-- Live chart + metrics -->
      <div id="visual-chart-row">
        <div id="visual-chart-wrapper">
          <canvas id="visual-canvas" aria-label="Live protocol chart"></canvas>
        </div>
        <div id="visual-metrics-panel" aria-label="Protocol metrics">
          <!-- metric-card elements injected by Charts -->
        </div>
      </div>

      <!-- Status footer -->
      <div id="visual-status-bar" aria-label="Last result">
        <span id="vstat-proto"  class="vstat-chip">—</span>
        <span id="vstat-badge"  class="status-badge default">—</span>
        <span class="vstat-label">RTT</span>
        <span id="vstat-rtt"   class="vstat-value">—</span>
        <span class="vstat-label">Data</span>
        <span id="vstat-data"  class="vstat-value">—</span>
      </div>

    </div>
```

- [ ] **Step 3: Commit**

```bash
git add frontend/index.html
git commit -m "feat: add view toggle and visual panel HTML scaffold"
```

---

## Task 3: Add CSS

**Files:**
- Modify: `frontend/styles.css`

- [ ] **Step 1: Add the view toggle pill** — insert in the `/* ─── Titlebar */` section, after the `#btn-settings` block and before the `/* ─── Disconnected Banner */` comment

```css
/* ─── View Toggle ────────────────────────────────────────────────────────── */
#view-toggle {
  display: flex;
  background: #222;
  border: 1px solid #555;
  border-radius: var(--radius);
  overflow: hidden;
  flex-shrink: 0;
}
.view-btn {
  padding: 4px 13px;
  background: transparent;
  color: #aaa;
  border: none;
  cursor: pointer;
  font-size: 11px;
  font-family: var(--font-ui);
  font-weight: 500;
  letter-spacing: 0.02em;
  transition: background 0.15s, color 0.15s;
}
.view-btn:hover         { color: #fff; }
.view-btn.active        { background: #4a90e2; color: #fff; }
.view-btn:focus-visible { outline: 2px solid var(--border-focus); outline-offset: -2px; }
```

- [ ] **Step 2: Add view show/hide rules** — insert right after the `#main` block in `/* ─── Main 3-column layout */`

```css
/* Default: visual panel hidden; terminal columns visible */
#visual-panel { display: none; }

/* Visual view active: swap which panels are visible */
body.view-visual #sidebar,
body.view-visual #centre,
body.view-visual #right-col { display: none; }

body.view-visual #visual-panel { display: flex; }
```

- [ ] **Step 3: Add visual panel layout styles** — insert after the `/* ─── Right Column */` section and before `/* ─── Result Panel */`

```css
/* ─── Visual Panel ───────────────────────────────────────────────────────── */
#visual-panel {
  flex: 1;
  flex-direction: column;
  overflow: hidden;
  min-height: 0;
  background: var(--bg-surface);
}

/* Protocol tabs */
#visual-proto-tabs {
  display: flex;
  gap: 0;
  padding: 0 14px;
  border-bottom: 2px solid var(--border);
  flex-shrink: 0;
  background: var(--bg-panel);
}
.visual-tab {
  padding: 10px 22px;
  border: none;
  border-bottom: 3px solid transparent;
  margin-bottom: -2px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 600;
  font-family: var(--font-ui);
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s;
}
.visual-tab:hover           { color: var(--text-primary); }
.visual-tab.active          { color: var(--border-focus); border-bottom-color: var(--border-focus); }
.visual-tab:disabled        { opacity: 0.4; cursor: not-allowed; }
.visual-tab:focus-visible   { outline: 2px solid var(--border-focus); outline-offset: 2px; }

/* Command card grid */
#visual-commands {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(172px, 1fr));
  gap: 10px;
  padding: 14px;
  flex-shrink: 0;
}
.visual-cmd-card {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 14px 16px;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 6px;
  cursor: pointer;
  text-align: left;
  font-family: var(--font-ui);
  transition: border-color 0.15s, box-shadow 0.15s;
}
.visual-cmd-card:hover:not(:disabled) {
  border-color: var(--border-focus);
  box-shadow: 0 2px 8px rgba(74,144,226,0.15);
}
.visual-cmd-card:focus-visible { outline: 2px solid var(--border-focus); outline-offset: 2px; }
.visual-cmd-card:disabled      { opacity: 0.45; cursor: not-allowed; }
.vcmd-label { font-size: 13px; font-weight: 600; color: var(--text-primary); }
.vcmd-desc  { font-size: 11px; color: var(--text-secondary); line-height: 1.4; }
.visual-cmd-card.custom-card .vcmd-label { color: var(--border-focus); }

/* Custom command form (inline, below command grid) */
#visual-custom-form {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 0 14px 12px;
  flex-shrink: 0;
}
#visual-custom-form.hidden { display: none; }
#visual-custom-form .custom-field { flex: 1; min-width: 140px; }
#visual-custom-actions { display: flex; gap: 6px; }

#btn-visual-custom-send {
  padding: 5px 14px;
  background: #4a90e2;
  color: #fff;
  border: none;
  border-radius: var(--radius);
  cursor: pointer;
  font-size: 12px;
  font-family: var(--font-ui);
}
#btn-visual-custom-send:hover         { background: #357abd; }
#btn-visual-custom-send:focus-visible { outline: 2px solid var(--border-focus); outline-offset: 2px; }

#btn-visual-custom-cancel {
  padding: 5px 12px;
  background: transparent;
  color: var(--text-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  cursor: pointer;
  font-size: 12px;
  font-family: var(--font-ui);
}
#btn-visual-custom-cancel:hover         { background: var(--border); }
#btn-visual-custom-cancel:focus-visible { outline: 2px solid var(--border-focus); outline-offset: 2px; }

/* Chart + metrics row */
#visual-chart-row {
  flex: 1;
  display: flex;
  border-top: 1px solid var(--border);
  background: var(--bg-panel);
  min-height: 0;
  overflow: hidden;
}
#visual-chart-wrapper {
  flex: 1;
  position: relative;
  padding: 10px 12px;
  min-width: 0;
}
#visual-metrics-panel {
  width: 160px;
  padding: 14px 12px;
  border-left: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 12px;
  flex-shrink: 0;
  overflow-y: auto;
}

/* Status footer */
#visual-status-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 14px;
  background: var(--bg-command-bar);
  border-top: 1px solid var(--border);
  font-size: 12px;
  flex-shrink: 0;
}
.vstat-chip {
  font-weight: 700;
  font-size: 11px;
  padding: 2px 7px;
  border-radius: 3px;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  color: var(--text-secondary);
  font-family: var(--font-mono);
}
.vstat-label { color: var(--text-muted); font-size: 11px; }
.vstat-value { font-family: var(--font-mono); color: var(--text-primary); }
```

- [ ] **Step 4: Commit**

```bash
git add frontend/styles.css
git commit -m "feat: add view toggle and visual panel CSS"
```

---

## Task 4: Create `frontend/visual.js`

**Files:**
- Create: `frontend/visual.js`
- Create: `frontend/visual.test.js`

- [ ] **Step 1: Create `frontend/visual.js`**

```js
// frontend/visual.js
// VisualView — manages #visual-panel for non-technical users.
// Shows protocol tabs, command cards (with descriptions), a live chart, and a status footer.
// Requires Chart.js loaded globally as window.Chart.

import { PROTOCOLS, PROTOCOL_ORDER } from './protocols.js';
import { Charts } from './charts.js';

/**
 * Build the command string for a custom command.
 * Pure function — exported for testing.
 * @param {string}   protoId - 'UART' | 'SPI' | 'CANFD'
 * @param {string[]} parts   - user-supplied field values in order
 * @returns {string}
 */
export function buildCustomCommand(protoId, parts) {
  return `${protoId}:CUSTOM:${parts.join(':')}`;
}

export class VisualView {
  /**
   * @param {object}          opts
   * @param {HTMLElement}       opts.panelEl        - #visual-panel
   * @param {HTMLCanvasElement} opts.canvasEl        - #visual-canvas
   * @param {HTMLElement}       opts.metricsEl       - #visual-metrics-panel
   * @param {HTMLElement}       opts.tabsEl          - #visual-proto-tabs
   * @param {HTMLElement}       opts.commandsEl      - #visual-commands
   * @param {HTMLElement}       opts.customFormEl    - #visual-custom-form
   * @param {HTMLElement}       opts.statusBarEl     - #visual-status-bar
   * @param {Function}          opts.onCommand       - cb(commandString) when user fires a command
   */
  constructor({ panelEl, canvasEl, metricsEl, tabsEl, commandsEl,
                customFormEl, statusBarEl, onCommand }) {
    this._panel       = panelEl;
    this._tabs        = tabsEl;
    this._commands    = commandsEl;
    this._customForm  = customFormEl;
    this._statusBar   = statusBarEl;
    this._onCommand   = onCommand;
    this._connected   = false;
    this._activeProto = null;
    this._pendingCustomProto = null;

    this._charts = new Charts({ canvasEl, metricsEl });

    // Custom form buttons
    customFormEl.querySelector('#btn-visual-custom-send')
      .addEventListener('click', () => this._submitCustom());
    customFormEl.querySelector('#btn-visual-custom-cancel')
      .addEventListener('click', () => this._hideCustomForm());

    this._buildTabs();
  }

  /**
   * Switch to a protocol: update active tab, rebuild command cards, redraw chart.
   * @param {'UART'|'SPI'|'CANFD'} proto
   */
  show(proto) {
    this._activeProto = proto;
    this._updateTabActive();
    this._buildCommandCards(proto);
    this._hideCustomForm();
    this._charts.show(proto);
  }

  /**
   * Feed a new data point — updates chart and status footer if proto is active.
   * @param {'UART'|'SPI'|'CANFD'} proto
   * @param {{ status: string, data: string, rtt: number|null }} payload
   */
  push(proto, payload) {
    this._charts.push(proto, payload);
    if (proto === this._activeProto) {
      this._updateStatus(proto, payload);
    }
  }

  /** Enable or disable all interactive controls based on connection state. */
  setConnected(connected) {
    this._connected = connected;
    this._panel.querySelectorAll('.visual-tab, .visual-cmd-card').forEach(el => {
      el.disabled = !connected;
    });
    if (!connected) this._hideCustomForm();
  }

  // ─── Private ─────────────────────────────────────────────────

  _buildTabs() {
    this._tabs.innerHTML = '';
    for (const id of PROTOCOL_ORDER) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'visual-tab';
      btn.textContent = PROTOCOLS[id].label;
      btn.dataset.proto = id;
      btn.disabled = !this._connected;
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-selected', 'false');
      btn.addEventListener('click', () => {
        if (!this._connected) return;
        this.show(id);
      });
      this._tabs.appendChild(btn);
    }
  }

  _updateTabActive() {
    this._tabs.querySelectorAll('.visual-tab').forEach(btn => {
      const active = btn.dataset.proto === this._activeProto;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', String(active));
    });
  }

  _buildCommandCards(protoId) {
    const proto = PROTOCOLS[protoId];
    this._commands.innerHTML = '';
    for (const cmd of proto.commands) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'visual-cmd-card' + (cmd.custom ? ' custom-card' : '');
      card.disabled = !this._connected;

      const label = document.createElement('span');
      label.className = 'vcmd-label';
      label.textContent = cmd.label;

      const desc = document.createElement('span');
      desc.className = 'vcmd-desc';
      desc.textContent = cmd.desc || '';

      card.appendChild(label);
      card.appendChild(desc);
      this._commands.appendChild(card);

      if (cmd.custom) {
        card.addEventListener('click', () => this._openCustomForm(cmd.fields, protoId));
      } else {
        card.addEventListener('click', () => this._onCommand(cmd.command));
      }
    }
  }

  _openCustomForm(fields, protoId) {
    this._pendingCustomProto = protoId;
    // Remove old inputs (keep #visual-custom-actions div)
    const actions = this._customForm.querySelector('#visual-custom-actions');
    Array.from(this._customForm.children).forEach(c => {
      if (c !== actions) c.remove();
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
      this._customForm.insertBefore(input, actions);
    }
    this._customForm.classList.remove('hidden');
    this._customForm.querySelector('.custom-field')?.focus();
  }

  _submitCustom() {
    if (!this._pendingCustomProto) return;
    const inputs = this._customForm.querySelectorAll('.custom-field');
    const parts  = [];
    for (const input of inputs) {
      if (input.required && !input.value.trim()) {
        input.focus();
        return;
      }
      parts.push(input.value.trim());
    }
    this._onCommand(buildCustomCommand(this._pendingCustomProto, parts));
    this._hideCustomForm();
  }

  _hideCustomForm() {
    this._customForm.classList.add('hidden');
    this._pendingCustomProto = null;
  }

  _updateStatus(proto, { status, data, rtt }) {
    this._statusBar.querySelector('#vstat-proto').textContent = proto;

    const badge = this._statusBar.querySelector('#vstat-badge');
    badge.className   = `status-badge ${(status || 'default').toLowerCase()}`;
    badge.textContent = status || '—';

    this._statusBar.querySelector('#vstat-rtt').textContent  = rtt != null ? `${rtt} ms` : '—';
    this._statusBar.querySelector('#vstat-data').textContent = data || '—';
  }
}
```

- [ ] **Step 2: Create `frontend/visual.test.js`**

```js
// frontend/visual.test.js
// Unit tests for the exported pure helper from visual.js.
// The VisualView class requires a DOM so it is not tested here.
// Run with: node --experimental-vm-modules frontend/visual.test.js

import { buildCustomCommand } from './visual.js';

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); failed++; }
  else        { console.log('PASS:', msg);  passed++; }
}

// ─── buildCustomCommand ───────────────────────────────────

assert(
  buildCustomCommand('UART', ['A5B3']) === 'UART:CUSTOM:A5B3',
  'UART single-field custom command'
);

assert(
  buildCustomCommand('SPI', ['FF']) === 'SPI:CUSTOM:FF',
  'SPI single-field custom command'
);

assert(
  buildCustomCommand('CANFD', ['130', '4', 'DEADBEEF']) === 'CANFD:CUSTOM:130:4:DEADBEEF',
  'CANFD three-field custom command'
);

assert(
  buildCustomCommand('CANFD', ['130', '0', '']) === 'CANFD:CUSTOM:130:0:',
  'CANFD optional empty last field preserved'
);

assert(
  buildCustomCommand('UART', []) === 'UART:CUSTOM:',
  'empty parts array produces trailing colon'
);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
```

- [ ] **Step 3: Run tests**

```
node --experimental-vm-modules frontend/visual.test.js
```
Expected: `5 passed, 0 failed`

- [ ] **Step 4: Commit**

```bash
git add frontend/visual.js frontend/visual.test.js
git commit -m "feat: add VisualView class and buildCustomCommand helper with tests"
```

---

## Task 5: Wire view switching in `app.js`

**Files:**
- Modify: `frontend/app.js`

- [ ] **Step 1: Add import at the top** (after the existing three imports)

```js
import { VisualView } from './visual.js';
```

- [ ] **Step 2: Add DOM refs** — after the `const terminalEl` line add:

```js
const viewBtns    = document.querySelectorAll('.view-btn');
```

- [ ] **Step 3: Add `view` to state** — change the state object to:

```js
const state = {
  connected:   false,
  activeProto: null,
  lastCommand: null,
  unsubs:      [],
  view:        'terminal',
};
```

- [ ] **Step 4: Instantiate VisualView** — add after the `const charts = new Charts(...)` block:

```js
const visualView = new VisualView({
  panelEl:      $('visual-panel'),
  canvasEl:     $('visual-canvas'),
  metricsEl:    $('visual-metrics-panel'),
  tabsEl:       $('visual-proto-tabs'),
  commandsEl:   $('visual-commands'),
  customFormEl: $('visual-custom-form'),
  statusBarEl:  $('visual-status-bar'),
  onCommand:    cmd => sendCommand(cmd),
});
```

- [ ] **Step 5: Add `setView()` function** — add after the `applySettings()` function

```js
function setView(name) {
  state.view = name;
  document.body.classList.toggle('view-visual',   name === 'visual');
  document.body.classList.toggle('view-terminal', name === 'terminal');
  viewBtns.forEach(btn =>
    btn.classList.toggle('active', btn.dataset.view === name)
  );
  // Auto-select first protocol when switching to Visual with no prior selection
  if (name === 'visual' && state.connected && !visualView._activeProto) {
    visualView.show(state.activeProto || 'UART');
  }
}
```

- [ ] **Step 6: Wire toggle clicks** — add after the `btnRefreshPorts.addEventListener` line:

```js
viewBtns.forEach(btn => {
  btn.addEventListener('click', () => setView(btn.dataset.view));
});
```

- [ ] **Step 7: Forward data to VisualView in `handleData()`** — add after the `charts.push(...)` line:

```js
  if (parsed) visualView.push(parsed.proto, { status: parsed.status, data: parsed.data, rtt });
```

- [ ] **Step 8: Forward connection state to VisualView in `setConnected()`** — add at the end of the `setConnected(connected)` function body:

```js
  visualView.setConnected(connected);
  if (connected && state.view === 'visual' && !visualView._activeProto) {
    visualView.show(state.activeProto || 'UART');
  }
```

- [ ] **Step 9: Apply initial view in `init()`** — add as the first line of `init()` (before `applySettings()`):

```js
  setView('terminal');
```

- [ ] **Step 10: Commit**

```bash
git add frontend/app.js
git commit -m "feat: wire VisualView into app — view toggle, data forwarding, connection state"
```

---

## Task 6: Manual verification

- [ ] **Step 1: Start the app**

```
npm start
```

- [ ] **Step 2: Terminal view checks**
  - "Terminal" button is highlighted blue in the toggle; "Visual" is grey
  - Sidebar, terminal, right panel all visible — identical to before
  - Connect, send commands, see output — all working

- [ ] **Step 3: Click "Visual"**
  - Toggle switches: "Visual" highlighted blue, "Terminal" grey
  - Sidebar, terminal, and right panel disappear
  - Visual panel fills the full `#main` area
  - Three tabs at top: UART, SPI, CANFD — greyed out if disconnected
  - Command cards are greyed out if disconnected

- [ ] **Step 4: Connect, then interact in Visual view**
  - Tabs and command cards become enabled
  - Click UART tab → 4 cards appear: Init / Loopback / Baud test / Custom…
  - Each card shows a label (bold) and a description below it
  - Click "Loopback" → command fires (switch to Terminal to confirm it appeared)
  - Click "Custom…" → inline form appears below the grid with a text field and Send / Cancel
  - Fill in a value, click Send → command fires; form hides
  - Click Cancel → form hides without sending
  - Click SPI / CANFD tabs → correct cards appear

- [ ] **Step 5: Chart and status bar**
  - After sending commands and receiving responses, the chart area shows live data
  - Status bar at the bottom updates: protocol chip, PASS/FAIL badge, RTT, data payload

- [ ] **Step 6: Switch back to Terminal**
  - Click "Terminal" toggle → Terminal view restored exactly as before
  - Chart in Terminal view also has the accumulated data (both Charts instances accumulate independently)

- [ ] **Step 7: Dark mode**
  - Open Settings, enable dark mode → Visual panel uses dark colours correctly
