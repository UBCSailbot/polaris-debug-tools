# Version Gating + Saved Test Presets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add firmware protocol-version gating (badge + warning banner, disabled commands) and a Custom test-preset system (load/save JSON preset files, run them in the Tests view).

**Architecture:** Two independent features sharing one plan. Version gating lives entirely in the GUI — `compat.js` computes compatibility from `boardProfile.proto`, `app.js` wires it to the UI. Saved presets adds a JSON file I/O layer in Electron main, a validator module, a Custom tab in `TestsView`, and `runCustomPreset` in `app.js`. No firmware changes except moving two `#define` lines to `dev.h`.

**Tech Stack:** Vanilla ES modules (renderer), Electron IPC (main/preload), Node.js `fs` + `dialog` (file I/O), plain `node` test runner (no framework).

---

## File Map

### Part A — Version Gating
| Action | Path |
|--------|------|
| Create | `frontend/compat.js` |
| Create | `frontend/compat.test.js` |
| Modify | `frontend/app.js` |
| Modify | `frontend/index.html` |
| Modify | `frontend/styles.css` |
| Modify | `DevBoard/Core/Src/dev.c` |
| Modify | `DevBoard/Core/Inc/dev.h` |
| Modify | `package.json` |

### Part B — Saved Test Presets
| Action | Path |
|--------|------|
| Create | `frontend/preset-validator.js` |
| Create | `frontend/preset-validator.test.js` |
| Modify | `main.js` |
| Modify | `preload.js` |
| Modify | `frontend/tests.js` |
| Modify | `frontend/app.js` |
| Modify | `frontend/index.html` |
| Modify | `frontend/styles.css` |
| Modify | `package.json` |

---

## PART A — Firmware Version Gating

---

### Task 1: Write compat.test.js (failing)

**Files:**
- Create: `frontend/compat.test.js`

- [ ] **Step 1: Create the test file**

```js
// frontend/compat.test.js
import { checkVersionCompat, REQUIRED_PROTO_VERSION } from './compat.js';

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); failed++; }
  else { console.log('PASS:', msg); passed++; }
}

// 1. null profile → all nulls, no warning
const r1 = checkVersionCompat(null);
assert(r1.compatible === null, 'null profile → compatible null');
assert(r1.firmwareVersion === null, 'null profile → firmwareVersion null');
assert(r1.protoVersion === null, 'null profile → protoVersion null');
assert(r1.warnMsg === null, 'null profile → warnMsg null');

// 2. unavailable profile → all nulls
const r2 = checkVersionCompat({ available: false, proto: 1, fw: '0.2.0', caps: [] });
assert(r2.compatible === null, 'unavailable profile → compatible null');
assert(r2.firmwareVersion === null, 'unavailable profile → firmwareVersion null');

// 3. available but proto not reported (null) → compatible false, warnMsg set
const r3 = checkVersionCompat({ available: true, proto: null, fw: '0.1.0', caps: [], board: 'devboard', legacy: null });
assert(r3.compatible === false, 'null proto → compatible false');
assert(typeof r3.warnMsg === 'string' && r3.warnMsg.length > 0, 'null proto → warnMsg is non-empty string');
assert(r3.firmwareVersion === '0.1.0', 'null proto → fw still extracted');

// 4. proto below minimum → compatible false
const r4 = checkVersionCompat({ available: true, proto: 0, fw: '0.0.1', caps: [], board: 'devboard', legacy: null });
assert(r4.compatible === false, 'proto=0 → compatible false');
assert(r4.protoVersion === 0, 'proto=0 → protoVersion is 0');
assert(r4.firmwareVersion === '0.0.1', 'proto=0 → fw extracted');
assert(typeof r4.warnMsg === 'string' && r4.warnMsg.length > 0, 'proto=0 → warnMsg set');

// 5. proto exactly at minimum → compatible true, no warning
const r5 = checkVersionCompat({ available: true, proto: REQUIRED_PROTO_VERSION, fw: '0.2.0', caps: ['UART'], board: 'devboard', legacy: true });
assert(r5.compatible === true, 'proto at minimum → compatible true');
assert(r5.warnMsg === null, 'proto at minimum → no warning');
assert(r5.firmwareVersion === '0.2.0', 'proto at minimum → fw extracted');
assert(r5.protoVersion === REQUIRED_PROTO_VERSION, 'proto at minimum → protoVersion correct');

// 6. proto above minimum → compatible true, no warning
const r6 = checkVersionCompat({ available: true, proto: REQUIRED_PROTO_VERSION + 5, fw: '1.0.0', caps: [], board: 'devboard', legacy: false });
assert(r6.compatible === true, 'proto above minimum → compatible true');
assert(r6.warnMsg === null, 'proto above minimum → no warning');

// 7. fw field missing → firmwareVersion null, but compat still based on proto
const r7 = checkVersionCompat({ available: true, proto: REQUIRED_PROTO_VERSION, fw: null, caps: [], board: 'devboard', legacy: null });
assert(r7.compatible === true, 'no fw field → still compatible if proto ok');
assert(r7.firmwareVersion === null, 'no fw field → firmwareVersion null');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
```

- [ ] **Step 2: Run to confirm it fails (module not found)**

```
node frontend/compat.test.js
```
Expected: `Error: Cannot find module './compat.js'`

---

### Task 2: Create compat.js and pass tests

**Files:**
- Create: `frontend/compat.js`

- [ ] **Step 1: Create the module**

```js
// frontend/compat.js
// Firmware protocol-version compatibility checks.

export const REQUIRED_PROTO_VERSION = 1;

export function checkVersionCompat(profile) {
  if (!profile?.available) {
    return { compatible: null, firmwareVersion: null, protoVersion: null, warnMsg: null };
  }

  const protoVersion = typeof profile.proto === 'number' ? profile.proto : null;
  const firmwareVersion = profile.fw ?? null;

  if (protoVersion === null) {
    return {
      compatible: false,
      firmwareVersion,
      protoVersion: null,
      warnMsg: 'Firmware did not report a protocol version. Some features may not work correctly.',
    };
  }

  if (protoVersion < REQUIRED_PROTO_VERSION) {
    return {
      compatible: false,
      firmwareVersion,
      protoVersion,
      warnMsg: `Firmware protocol v${protoVersion} detected — v${REQUIRED_PROTO_VERSION} required. Update your firmware.`,
    };
  }

  return { compatible: true, firmwareVersion, protoVersion, warnMsg: null };
}
```

- [ ] **Step 2: Run tests and confirm all pass**

```
node frontend/compat.test.js
```
Expected: `7 passed, 0 failed`

---

### Task 3: Add version badge and warning banner to index.html

**Files:**
- Modify: `frontend/index.html`

- [ ] **Step 1: Add firmware version badge inside `#titlebar-brand-copy` (after `#titlebar-version`)**

Find this block in `index.html` (line ~16–19):
```html
      <div id="titlebar-brand-copy">
        <span id="titlebar-label">Sailbot Protocol Tester</span>
        <span id="titlebar-version">Version 0.3.13</span>
      </div>
```

Replace with:
```html
      <div id="titlebar-brand-copy">
        <span id="titlebar-label">Sailbot Protocol Tester</span>
        <span id="titlebar-version">Version 0.3.13</span>
        <span id="firmware-version-badge"></span>
      </div>
```

- [ ] **Step 2: Add version warning banner after `#banner` (line ~179)**

Find this block:
```html
  <!-- Disconnected Banner -->
  <div id="banner" role="alert" aria-live="assertive">
    Disconnected - reconnecting...&nbsp;<span id="reconnect-counter"></span>
  </div>
```

Insert immediately after it:
```html
  <!-- Firmware Version Warning Banner -->
  <div id="version-warning-banner" role="alert" aria-live="polite"></div>
```

---

### Task 4: Add CSS for the new version elements

**Files:**
- Modify: `frontend/styles.css`

- [ ] **Step 1: Append the following CSS block at the very end of `styles.css`**

```css
/* ─── Firmware Version Badge (titlebar) ─────────────────────────────────── */
#firmware-version-badge {
  display: none;
  color: var(--text-dim, #9e9e9e);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
}
#firmware-version-badge.visible { display: inline; }

/* ─── Firmware Version Warning Banner ───────────────────────────────────── */
#version-warning-banner {
  display: none;
  background: #7d5a00;
  color: #ffe082;
  padding: 6px 16px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.02em;
  flex-shrink: 0;
}
#version-warning-banner.visible { display: block; }
```

---

### Task 5: Wire compat.js into app.js

**Files:**
- Modify: `frontend/app.js`

- [ ] **Step 1: Add the import at the top of `app.js` (after the existing imports, around line 17)**

After the existing import block ending with `dual-board.js`, add:
```js
import { checkVersionCompat } from './compat.js';
```

- [ ] **Step 2: Add element references for the two new DOM nodes (around line 78, after `const titlebarVersion = $('titlebar-version');`)**

```js
const firmwareBadge = $('firmware-version-badge');
const versionWarningBanner = $('version-warning-banner');
```

- [ ] **Step 3: Add the `renderVersionInfo` function — insert it immediately after the `capsFromProfile` import usage area, just before `function setBoardProfile` (around line 1849)**

```js
function renderVersionInfo(profile) {
  const result = checkVersionCompat(profile);

  if (firmwareBadge) {
    if (result.firmwareVersion) {
      firmwareBadge.textContent = `fw ${result.firmwareVersion}`;
      firmwareBadge.classList.add('visible');
    } else {
      firmwareBadge.textContent = '';
      firmwareBadge.classList.remove('visible');
    }
  }

  if (versionWarningBanner) {
    if (result.warnMsg) {
      versionWarningBanner.textContent = result.warnMsg;
      versionWarningBanner.classList.add('visible');
    } else {
      versionWarningBanner.textContent = '';
      versionWarningBanner.classList.remove('visible');
    }
  }
}
```

- [ ] **Step 4: Call `renderVersionInfo` inside `setBoardProfile` (around line 1849–1870)**

Find:
```js
function setBoardProfile(profile) {
  state.boardProfile = profile;
  state.caps = capsFromProfile(profile);
  visualView.setCapabilities(profile?.available ? [...state.caps] : null);
  testsView.setCapabilities(profile?.available ? [...state.caps] : null);
```

Replace with:
```js
function setBoardProfile(profile) {
  state.boardProfile = profile;
  state.caps = capsFromProfile(profile);
  visualView.setCapabilities(profile?.available ? [...state.caps] : null);
  testsView.setCapabilities(profile?.available ? [...state.caps] : null);
  renderVersionInfo(profile);
```

- [ ] **Step 5: Verify visually — launch the app, connect a board, confirm `fw 0.2.0` badge appears in the titlebar. Disconnect and confirm it disappears.**

```
npm start
```

---

### Task 6: Move version defines to dev.h

**Files:**
- Modify: `DevBoard/Core/Src/dev.c`
- Modify: `DevBoard/Core/Inc/dev.h`

- [ ] **Step 1: Add version defines to `dev.h` — insert before `#ifdef __cplusplus` (around line 11)**

Find in `dev.h`:
```c
#include "stm32u5xx_hal.h"

#ifdef __cplusplus
```

Replace with:
```c
#include "stm32u5xx_hal.h"

#define FW_VERSION       "0.2.0"
#define PROTOCOL_VERSION "1"

#ifdef __cplusplus
```

- [ ] **Step 2: Remove the defines from `dev.c` (lines 18–19)**

Find in `dev.c`:
```c
#define FW_VERSION            "0.2.0"
#define PROTOCOL_VERSION      "1"
#define BOARD_NAME            "devboard"
```

Replace with:
```c
#define BOARD_NAME            "devboard"
```

- [ ] **Step 3: Verify the firmware still builds in STM32CubeIDE (Project → Build Project). Confirm zero errors.**

---

### Task 7: Register compat.test.js in package.json and commit Part A

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add compat.test.js to the test:frontend script**

Find in `package.json`:
```json
    "test:frontend": "node frontend/protocols.test.js && node frontend/protocol-parser.test.js && node frontend/charts.test.js && node frontend/visual.test.js && node frontend/terminal.test.js && node frontend/dual-board.test.js && node frontend/transcript-replay.test.js && node frontend/guardrails.test.js",
```

Replace with:
```json
    "test:frontend": "node frontend/protocols.test.js && node frontend/protocol-parser.test.js && node frontend/charts.test.js && node frontend/visual.test.js && node frontend/terminal.test.js && node frontend/dual-board.test.js && node frontend/transcript-replay.test.js && node frontend/guardrails.test.js && node frontend/compat.test.js",
```

- [ ] **Step 2: Run all tests to confirm nothing is broken**

```
npm test
```
Expected: all tests pass, last line shows compat tests passing.

- [ ] **Step 3: Commit Part A**

```bash
git add frontend/compat.js frontend/compat.test.js frontend/app.js frontend/index.html frontend/styles.css DevBoard/Core/Src/dev.c DevBoard/Core/Inc/dev.h package.json
git commit -m "feat: firmware version gating — badge, warning banner, proto compat check"
```

---

## PART B — Saved Test Presets

---

### Task 8: Write preset-validator.test.js (failing)

**Files:**
- Create: `frontend/preset-validator.test.js`

- [ ] **Step 1: Create the test file**

```js
// frontend/preset-validator.test.js
import { validatePreset } from './preset-validator.js';

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); failed++; }
  else { console.log('PASS:', msg); passed++; }
}

// 1. null input → invalid
const r1 = validatePreset(null);
assert(r1.valid === false, 'null → invalid');
assert(typeof r1.error === 'string', 'null → error string');

// 2. missing name → invalid
const r2 = validatePreset({ steps: [{ label: 'Init', command: 'I2C:INIT' }] });
assert(r2.valid === false, 'missing name → invalid');

// 3. empty name → invalid
const r3 = validatePreset({ name: '   ', steps: [{ label: 'Init', command: 'I2C:INIT' }] });
assert(r3.valid === false, 'empty name → invalid');

// 4. missing steps → invalid
const r4 = validatePreset({ name: 'My Test' });
assert(r4.valid === false, 'missing steps → invalid');

// 5. empty steps array → invalid
const r5 = validatePreset({ name: 'My Test', steps: [] });
assert(r5.valid === false, 'empty steps → invalid');

// 6. step missing label → invalid
const r6 = validatePreset({ name: 'My Test', steps: [{ command: 'I2C:INIT' }] });
assert(r6.valid === false, 'step missing label → invalid');

// 7. step missing command → invalid
const r7 = validatePreset({ name: 'My Test', steps: [{ label: 'Init' }] });
assert(r7.valid === false, 'step missing command → invalid');

// 8. command with wrong format (no colon) → invalid
const r8 = validatePreset({ name: 'My Test', steps: [{ label: 'Init', command: 'I2CINIT' }] });
assert(r8.valid === false, 'command no colon → invalid');

// 9. valid minimal preset → valid, preset returned
const r9 = validatePreset({ name: 'Test A', steps: [{ label: 'Init', command: 'I2C:INIT' }] });
assert(r9.valid === true, 'valid minimal → valid');
assert(r9.preset !== null, 'valid minimal → preset returned');
assert(r9.preset.name === 'Test A', 'valid minimal → name preserved');
assert(r9.preset.steps.length === 1, 'valid minimal → 1 step');
assert(r9.error === null, 'valid minimal → no error');

// 10. valid preset with delayMs → valid, delayMs preserved
const r10 = validatePreset({
  name: 'Full Test',
  steps: [
    { label: 'Init', command: 'SPI:INIT', delayMs: 160 },
    { label: 'Transfer', command: 'SPI:XFER:75FF', delayMs: 100 },
    { label: 'Status', command: 'SPI:STATUS' },
  ],
});
assert(r10.valid === true, 'multi-step with delayMs → valid');
assert(r10.preset.steps[0].delayMs === 160, 'delayMs preserved');
assert(r10.preset.steps[2].delayMs === undefined, 'missing delayMs stays undefined');

// 11. negative delayMs → invalid
const r11 = validatePreset({ name: 'Bad', steps: [{ label: 'Init', command: 'I2C:INIT', delayMs: -1 }] });
assert(r11.valid === false, 'negative delayMs → invalid');

// 12. name trimmed in output
const r12 = validatePreset({ name: '  My Preset  ', steps: [{ label: 'Init', command: 'I2C:INIT' }] });
assert(r12.valid === true, 'name with whitespace → valid');
assert(r12.preset.name === 'My Preset', 'name trimmed in output');

// 13. extra fields on preset ignored
const r13 = validatePreset({ name: 'Test', version: '99', unknownField: true, steps: [{ label: 'Init', command: 'UART:INIT' }] });
assert(r13.valid === true, 'extra fields ignored → valid');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
```

- [ ] **Step 2: Run to confirm failure (module not found)**

```
node frontend/preset-validator.test.js
```
Expected: `Error: Cannot find module './preset-validator.js'`

---

### Task 9: Create preset-validator.js and pass tests

**Files:**
- Create: `frontend/preset-validator.js`

- [ ] **Step 1: Create the module**

```js
// frontend/preset-validator.js
// Validates a preset JSON object loaded from disk.
// Returns { valid, error, preset } — preset is null on failure.

const COMMAND_RE = /^[A-Z][A-Z0-9]*:[A-Z][A-Z0-9_]*(:[^\s]+)*$/;

export function validatePreset(data) {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    return { valid: false, error: 'Preset must be a JSON object.', preset: null };
  }

  const name = typeof data.name === 'string' ? data.name.trim() : null;
  if (!name) {
    return { valid: false, error: 'Preset must have a non-empty "name" field.', preset: null };
  }

  if (!Array.isArray(data.steps) || data.steps.length === 0) {
    return { valid: false, error: 'Preset must have a non-empty "steps" array.', preset: null };
  }

  const steps = [];
  for (let i = 0; i < data.steps.length; i++) {
    const s = data.steps[i];

    if (typeof s.label !== 'string' || !s.label.trim()) {
      return { valid: false, error: `Step ${i + 1}: "label" must be a non-empty string.`, preset: null };
    }

    if (typeof s.command !== 'string' || !COMMAND_RE.test(s.command.trim())) {
      return { valid: false, error: `Step ${i + 1}: "command" must match DOMAIN:COMMAND[:args] format.`, preset: null };
    }

    if (s.delayMs !== undefined) {
      if (typeof s.delayMs !== 'number' || s.delayMs < 0) {
        return { valid: false, error: `Step ${i + 1}: "delayMs" must be a non-negative number.`, preset: null };
      }
    }

    const step = { label: s.label.trim(), command: s.command.trim() };
    if (s.delayMs !== undefined) {
      step.delayMs = s.delayMs;
    }
    steps.push(step);
  }

  return {
    valid: true,
    error: null,
    preset: { name, steps },
  };
}
```

- [ ] **Step 2: Run tests and confirm all pass**

```
node frontend/preset-validator.test.js
```
Expected: `13 passed, 0 failed`

---

### Task 10: Add preset IPC handlers to main.js and preload.js

**Files:**
- Modify: `main.js`
- Modify: `preload.js`

- [ ] **Step 1: Add `dialog` to the existing electron require in main.js (line 3)**

Find:
```js
const { app, BrowserWindow, ipcMain } = require('electron');
```

Replace with:
```js
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
```

- [ ] **Step 2: Add the two IPC handlers in main.js — append them just before the final `app.whenReady()` block or after the last `ipcMain.handle` call. Look for the `ipcMain.handle('log:export-csv', ...)` block, and add after it:**

```js
ipcMain.handle('preset:load', async () => {
  const result = await dialog.showOpenDialog(win, {
    title: 'Load Test Preset',
    filters: [{ name: 'JSON Preset', extensions: ['json'] }],
    properties: ['openFile'],
  });
  if (result.canceled || !result.filePaths.length) {
    return { success: false, canceled: true };
  }
  try {
    const raw = fs.readFileSync(result.filePaths[0], 'utf8');
    return { success: true, data: JSON.parse(raw) };
  } catch (err) {
    return { success: false, canceled: false, error: err.message };
  }
});

ipcMain.handle('preset:save', async (_event, { data }) => {
  const defaultName = (typeof data?.name === 'string' && data.name.trim())
    ? data.name.trim().replace(/[^a-z0-9_\-]/gi, '_')
    : 'preset';
  const result = await dialog.showSaveDialog(win, {
    title: 'Save Test Preset',
    defaultPath: `${defaultName}.json`,
    filters: [{ name: 'JSON Preset', extensions: ['json'] }],
  });
  if (result.canceled || !result.filePath) {
    return { success: false, canceled: true };
  }
  try {
    fs.writeFileSync(result.filePath, JSON.stringify(data, null, 2), 'utf8');
    return { success: true, path: result.filePath };
  } catch (err) {
    return { success: false, canceled: false, error: err.message };
  }
});
```

- [ ] **Step 3: Expose the new channels in preload.js — append to the `contextBridge.exposeInMainWorld` object (before the closing `});`)**

```js
  // Load a preset JSON file via native file dialog
  loadPreset: () =>
    ipcRenderer.invoke('preset:load'),

  // Save preset data to a JSON file via native save dialog
  savePreset: (data) =>
    ipcRenderer.invoke('preset:save', { data }),
```

---

### Task 11: Add Custom tab + custom preset support to tests.js

**Files:**
- Modify: `frontend/tests.js`

- [ ] **Step 1: Add the `CUSTOM_TAB` constant and `_customPresets` state — at the top of the file, after the imports:**

```js
const CUSTOM_TAB = 'CUSTOM';
```

- [ ] **Step 2: Add `_customPresets = []` to the `TestsView` constructor — inside the constructor body, after the existing `this._lastRun = null;` line:**

```js
    this._customPresets = [];
```

- [ ] **Step 3: Add `onRunCustomTest` to the constructor destructured params — change the constructor signature from:**

```js
  constructor({
    tabsEl,
    cardsEl,
    summaryProtoEl,
    summaryCountEl,
    summaryLastRunEl,
    summaryHintEl,
    runAllBtnEl,
    onRunTest,
    onRunAll,
  }) {
```

to:

```js
  constructor({
    tabsEl,
    cardsEl,
    summaryProtoEl,
    summaryCountEl,
    summaryLastRunEl,
    summaryHintEl,
    runAllBtnEl,
    onRunTest,
    onRunAll,
    onRunCustomTest,
  }) {
```

- [ ] **Step 4: Store `onRunCustomTest` on `this` — in the constructor body just after `this._onRunAll = onRunAll;`:**

```js
    this._onRunCustomTest = onRunCustomTest || onRunTest;
```

- [ ] **Step 5: Update `_protocolExists` to accept CUSTOM_TAB:**

Find:
```js
  _protocolExists(protoId) {
    return !!PROTOCOLS[protoId];
  }
```

Replace with:
```js
  _protocolExists(protoId) {
    return protoId === CUSTOM_TAB || !!PROTOCOLS[protoId];
  }
```

- [ ] **Step 6: Update `_isProtocolEnabled` to treat CUSTOM_TAB as always enabled:**

Find:
```js
  _isProtocolEnabled(protoId) {
    const proto = PROTOCOLS[protoId];

    if (!proto || this._caps === null) {
      return false;
    }

    return this._caps.has(proto.domainCap);
  }
```

Replace with:
```js
  _isProtocolEnabled(protoId) {
    if (protoId === CUSTOM_TAB) {
      return true;
    }
    const proto = PROTOCOLS[protoId];
    if (!proto || this._caps === null) {
      return false;
    }
    return this._caps.has(proto.domainCap);
  }
```

- [ ] **Step 7: Update `_buildTabs` to append the Custom tab at the end:**

Find:
```js
  _buildTabs() {
    this._tabs.innerHTML = '';
    for (const protoId of PROTOCOL_ORDER) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tests-proto-btn';
      btn.textContent = PROTOCOLS[protoId].label;
      btn.dataset.proto = protoId;
      btn.disabled = !this._connected || !this._isProtocolEnabled(protoId);
      btn.title = this._isProtocolEnabled(protoId) ? '' : this._protocolDisabledReason(protoId);
      btn.addEventListener('click', () => this.show(protoId));
      this._tabs.appendChild(btn);
    }
    this._updateTabActive();
  }
```

Replace with:
```js
  _buildTabs() {
    this._tabs.innerHTML = '';
    for (const protoId of PROTOCOL_ORDER) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tests-proto-btn';
      btn.textContent = PROTOCOLS[protoId].label;
      btn.dataset.proto = protoId;
      btn.disabled = !this._connected || !this._isProtocolEnabled(protoId);
      btn.title = this._isProtocolEnabled(protoId) ? '' : this._protocolDisabledReason(protoId);
      btn.addEventListener('click', () => this.show(protoId));
      this._tabs.appendChild(btn);
    }

    const customBtn = document.createElement('button');
    customBtn.type = 'button';
    customBtn.className = 'tests-proto-btn';
    customBtn.textContent = `Custom${this._customPresets.length ? ` (${this._customPresets.length})` : ''}`;
    customBtn.dataset.proto = CUSTOM_TAB;
    customBtn.disabled = false;
    customBtn.addEventListener('click', () => this.show(CUSTOM_TAB));
    this._tabs.appendChild(customBtn);

    this._updateTabActive();
  }
```

- [ ] **Step 8: Update `getActiveTests` to serve custom presets:**

Find:
```js
  getActiveTests(protoId = this._activeProto) {
    return [...(TEST_CATALOG[protoId] || [])];
  }
```

Replace with:
```js
  getActiveTests(protoId = this._activeProto) {
    if (protoId === CUSTOM_TAB) {
      return [...this._customPresets];
    }
    return [...(TEST_CATALOG[protoId] || [])];
  }
```

- [ ] **Step 9: Update `getTestById` to also search custom presets:**

Find:
```js
  getTestById(testId) {
    return PROTOCOL_ORDER
      .flatMap(protoId => TEST_CATALOG[protoId] || [])
      .find(test => test.id === testId) || null;
  }
```

Replace with:
```js
  getTestById(testId) {
    const custom = this._customPresets.find(p => p.id === testId);
    if (custom) return custom;
    return PROTOCOL_ORDER
      .flatMap(protoId => TEST_CATALOG[protoId] || [])
      .find(test => test.id === testId) || null;
  }
```

- [ ] **Step 10: Update `_renderCards` to route to custom rendering when on CUSTOM_TAB:**

Find the start of `_renderCards`:
```js
  _renderCards() {
    const tests = this.getActiveTests();

    this._cards.innerHTML = '';

    if (!tests.length) {
      this._cards.innerHTML = '<div class="tests-empty">No premade tests are registered for this protocol yet.</div>';
      return;
    }
```

Replace with:
```js
  _renderCards() {
    if (this._activeProto === CUSTOM_TAB) {
      this._renderCustomCards();
      return;
    }

    const tests = this.getActiveTests();

    this._cards.innerHTML = '';

    if (!tests.length) {
      this._cards.innerHTML = '<div class="tests-empty">No premade tests are registered for this protocol yet.</div>';
      return;
    }
```

- [ ] **Step 11: Update `_renderSummary` to handle the Custom tab label and count — find:**

```js
    const activeProtoLabel = PROTOCOLS[this._activeProto]?.label || '-';
```

Replace with:
```js
    const activeProtoLabel = this._activeProto === CUSTOM_TAB
      ? 'Custom'
      : PROTOCOLS[this._activeProto]?.label || '-';
```

Then find:
```js
    const runnableCount = tests.filter(test => this._isTestEnabled(test)).length;
```

Replace with:
```js
    const runnableCount = this._activeProto === CUSTOM_TAB
      ? (this._connected ? this._customPresets.length : 0)
      : tests.filter(test => this._isTestEnabled(test)).length;
```

Then find the hint block:
```js
    } else {
      this._summaryHintEl.textContent = 'Each card queues a safe, known-good command sequence into the dev firmware so operators can focus on the target hardware behavior.';
    }
```

Replace with:
```js
    } else if (this._activeProto === CUSTOM_TAB && !this._customPresets.length) {
      this._summaryHintEl.textContent = 'Load a preset file using the Load Preset button to add custom test sequences here.';
    } else {
      this._summaryHintEl.textContent = 'Each card queues a safe, known-good command sequence into the dev firmware so operators can focus on the target hardware behavior.';
    }
```

- [ ] **Step 12: Add the `_renderCustomCards` method — add this new method to the `TestsView` class, just before `_renderSummary`:**

```js
  _renderCustomCards() {
    this._cards.innerHTML = '';

    if (!this._customPresets.length) {
      this._cards.innerHTML = '<div class="tests-empty">No custom presets loaded. Use the Load Preset button to import a .json file.</div>';
      return;
    }

    this._customPresets.forEach(preset => {
      const runState = this._runStates.get(preset.id) || { tone: 'idle', label: 'Ready', detail: 'Not run yet.' };
      const enabled = this._connected;
      const busy = !!this._activeRunId;

      const card = document.createElement('article');
      const header = document.createElement('div');
      const category = document.createElement('span');
      const title = document.createElement('h3');
      const status = document.createElement('span');
      const summary = document.createElement('p');
      const sequence = document.createElement('div');
      const sequenceLabel = document.createElement('span');
      const steps = document.createElement('div');
      const footer = document.createElement('div');
      const detail = document.createElement('span');
      const button = document.createElement('button');

      card.className = 'test-card';
      header.className = 'test-card-header';
      category.className = 'test-card-category';
      title.className = 'test-card-title';
      status.className = `test-card-status ${runState.tone || 'idle'}`;
      summary.className = 'test-card-summary';
      sequence.className = 'test-card-section';
      sequenceLabel.className = 'test-card-section-label';
      steps.className = 'test-step-list';
      footer.className = 'test-card-footer';
      detail.className = 'test-card-detail';
      button.className = 'test-run-btn';
      button.type = 'button';

      category.textContent = 'Custom';
      title.textContent = preset.name;
      status.textContent = runState.label;
      summary.textContent = `${preset.steps.length} step${preset.steps.length === 1 ? '' : 's'}.`;
      sequenceLabel.textContent = 'Sequence';
      detail.textContent = enabled ? runState.detail : 'Connect to the board before running custom presets.';
      button.textContent = this._activeRunId === preset.id ? 'Running...' : 'Run Preset';
      button.disabled = !enabled || busy;
      button.addEventListener('click', () => this._onRunCustomTest(preset));

      preset.steps.forEach(step => {
        const chip = document.createElement('span');
        chip.className = 'test-step-chip';
        chip.textContent = step.label;
        steps.appendChild(chip);
      });

      header.appendChild(category);
      header.appendChild(status);
      card.appendChild(header);
      card.appendChild(title);
      card.appendChild(summary);
      sequence.appendChild(sequenceLabel);
      sequence.appendChild(steps);
      footer.appendChild(detail);
      footer.appendChild(button);
      card.appendChild(sequence);
      card.appendChild(footer);

      this._cards.appendChild(card);
    });
  }
```

- [ ] **Step 13: Add `loadCustomPresets`, `clearCustomPresets`, and `getCustomPresets` public methods — add before `_buildTabs`:**

```js
  loadCustomPresets(presets) {
    this._customPresets = [...this._customPresets, ...presets];
    this._buildTabs();
    if (this._activeProto === CUSTOM_TAB) {
      this._renderCards();
    }
    this._renderSummary();
  }

  clearCustomPresets() {
    this._customPresets = [];
    if (this._activeProto === CUSTOM_TAB) {
      this._activeProto = this._firstSupportedProtocol() || PROTOCOL_ORDER[0];
    }
    this._buildTabs();
    this._renderCards();
    this._renderSummary();
  }

  getCustomPresets() {
    return [...this._customPresets];
  }
```

---

### Task 12: Add Load/Save buttons to index.html and CSS

**Files:**
- Modify: `frontend/index.html`
- Modify: `frontend/styles.css`

- [ ] **Step 1: Add the buttons to `#tests-header` in `index.html` — find:**

```html
      <div id="tests-header">
        <div id="tests-proto-tabs" role="tablist" aria-label="Test protocol">
          <!-- .tests-proto-btn buttons injected by tests.js -->
        </div>
        <button id="btn-tests-run-all" type="button">Run All Visible</button>
      </div>
```

Replace with:
```html
      <div id="tests-header">
        <div id="tests-proto-tabs" role="tablist" aria-label="Test protocol">
          <!-- .tests-proto-btn buttons injected by tests.js -->
        </div>
        <div id="tests-preset-actions">
          <button id="btn-tests-load-preset" type="button">Load Preset</button>
          <button id="btn-tests-save-preset" type="button" disabled>Save Presets</button>
          <button id="btn-tests-run-all" type="button">Run All Visible</button>
        </div>
      </div>
```

- [ ] **Step 2: Add CSS for `#tests-preset-actions` at the end of `styles.css`:**

```css
/* ─── Test Preset Actions ────────────────────────────────────────────────── */
#tests-preset-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

#btn-tests-load-preset,
#btn-tests-save-preset {
  padding: 7px 14px;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: var(--bg-panel);
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}

#btn-tests-load-preset:hover,
#btn-tests-save-preset:hover:not(:disabled) {
  color: var(--text-primary);
  border-color: var(--border-focus);
}

#btn-tests-load-preset:disabled,
#btn-tests-save-preset:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
```

---

### Task 13: Wire Load/Save + runCustomPreset in app.js — final wiring

**Files:**
- Modify: `frontend/app.js`

- [ ] **Step 1: Add import for `validatePreset` (add after the `compat.js` import added in Task 5):**

```js
import { validatePreset } from './preset-validator.js';
```

- [ ] **Step 2: Add button element references near the other tests-panel refs — find `const testsPanel = $('tests-panel');` and add below it:**

```js
const btnTestsLoadPreset = $('btn-tests-load-preset');
const btnTestsSavePreset = $('btn-tests-save-preset');
```

- [ ] **Step 3: Wire up `onRunCustomTest` in the `testsView` constructor call — find:**

```js
const testsView = new TestsView({
  tabsEl: $('tests-proto-tabs'),
  cardsEl: $('tests-cards'),
  summaryProtoEl: $('tests-summary-proto'),
  summaryCountEl: $('tests-summary-count'),
  summaryLastRunEl: $('tests-summary-last-run'),
  summaryHintEl: $('tests-summary-hint'),
  runAllBtnEl: $('btn-tests-run-all'),
  onRunTest: test => runPremadeTest(test),
  onRunAll: protoId => runPremadeTests(protoId),
});
```

Replace with:
```js
const testsView = new TestsView({
  tabsEl: $('tests-proto-tabs'),
  cardsEl: $('tests-cards'),
  summaryProtoEl: $('tests-summary-proto'),
  summaryCountEl: $('tests-summary-count'),
  summaryLastRunEl: $('tests-summary-last-run'),
  summaryHintEl: $('tests-summary-hint'),
  runAllBtnEl: $('btn-tests-run-all'),
  onRunTest: test => runPremadeTest(test),
  onRunAll: protoId => runPremadeTests(protoId),
  onRunCustomTest: preset => runCustomPreset(preset),
});
```

- [ ] **Step 4: Add the `runCustomPreset` function — add immediately after `runPremadeTests` (around line 2273):**

```js
async function runCustomPreset(preset) {
  let completedSteps = 0;
  let finishedAt = null;

  if (activePremadeTestId) {
    showToast('Wait for the active sequence to finish first.', 'error');
    return false;
  }

  if (!state.connected) {
    showToast('Connect to the board before running presets.', 'error');
    return false;
  }

  activePremadeTestId = preset.id;
  testsView.setActiveRun(preset.id);
  testsView.setRunState(preset.id, {
    tone: 'running',
    label: 'Running',
    detail: `Queueing ${preset.steps.length} command${preset.steps.length === 1 ? '' : 's'}...`,
  });

  try {
    for (const step of preset.steps) {
      const result = await sendCommand(step.command);
      if (!result?.success) {
        throw new Error(result?.error || 'Send rejected');
      }
      completedSteps += 1;
      testsView.setRunState(preset.id, {
        tone: 'running',
        label: 'Running',
        detail: `Sent ${completedSteps} of ${preset.steps.length}. Last: ${step.label}.`,
      });
      if (step.delayMs) {
        await delay(step.delayMs);
      }
    }
    finishedAt = Date.now();
    testsView.setRunState(preset.id, {
      tone: 'success',
      label: 'Sent',
      detail: `Sequence completed at ${formatRunClock(finishedAt)}. Watch terminal output to verify hardware behavior.`,
      lastRunAt: finishedAt,
    });
    showToast(`${preset.name} sequence sent.`);
    return true;
  } catch (err) {
    finishedAt = Date.now();
    testsView.setRunState(preset.id, {
      tone: 'fail',
      label: 'Blocked',
      detail: `Stopped after ${completedSteps} step${completedSteps === 1 ? '' : 's'}: ${err.message || 'unknown error'}.`,
      lastRunAt: finishedAt,
    });
    showToast(`${preset.name} could not finish: ${err.message || 'unknown error'}`, 'error');
    return false;
  } finally {
    activePremadeTestId = null;
    testsView.setActiveRun(null);
  }
}
```

- [ ] **Step 5: Add Load Preset click handler — add after the `btnBoardResetMode.addEventListener` block (around line 2294):**

```js
btnTestsLoadPreset.addEventListener('click', async () => {
  let result;
  try {
    result = await window.electronAPI.loadPreset();
  } catch {
    showToast('Failed to open file dialog.', 'error');
    return;
  }

  if (!result.success) {
    if (!result.canceled) {
      showToast(result.error || 'Failed to load preset file.', 'error');
    }
    return;
  }

  const validation = validatePreset(result.data);
  if (!validation.valid) {
    showToast(`Invalid preset: ${validation.error}`, 'error');
    return;
  }

  const preset = { ...validation.preset, id: `custom-${Date.now()}` };
  testsView.loadCustomPresets([preset]);
  btnTestsSavePreset.disabled = false;
  showToast(`Loaded preset: ${preset.name}`);
});
```

- [ ] **Step 6: Add Save Preset click handler — add immediately after the Load handler:**

```js
btnTestsSavePreset.addEventListener('click', async () => {
  const presets = testsView.getCustomPresets();
  if (!presets.length) {
    showToast('No custom presets to save.', 'error');
    return;
  }

  const data = presets.length === 1
    ? { name: presets[0].name, version: '1', steps: presets[0].steps }
    : presets.map(p => ({ name: p.name, version: '1', steps: p.steps }));

  let result;
  try {
    result = await window.electronAPI.savePreset(data);
  } catch {
    showToast('Failed to open save dialog.', 'error');
    return;
  }

  if (!result.success) {
    if (!result.canceled) {
      showToast(result.error || 'Failed to save preset file.', 'error');
    }
    return;
  }

  showToast(`Saved to ${result.path}`);
});
```

---

### Task 14: Register preset-validator.test.js in package.json and final commit

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add preset-validator.test.js to the test:frontend script**

Find (the line updated in Task 7):
```json
    "test:frontend": "... && node frontend/compat.test.js",
```

Replace ending with:
```json
    "test:frontend": "... && node frontend/compat.test.js && node frontend/preset-validator.test.js",
```

- [ ] **Step 2: Run all tests**

```
npm test
```
Expected: all tests pass.

- [ ] **Step 3: Launch the app and verify the full feature**

```
npm start
```

Manual verification checklist:
- [ ] Connect to board → `fw 0.2.0` badge appears in titlebar next to app version
- [ ] Disconnect → badge disappears
- [ ] Switch to Tests view → "Custom" tab is visible alongside UART/SPI/CANFD/I2C
- [ ] Click "Custom" tab → shows "No custom presets loaded" empty state
- [ ] Click "Load Preset" → file dialog opens
- [ ] Select a valid preset JSON → preset card appears in Custom tab
- [ ] "Save Presets" button becomes enabled after loading
- [ ] Click "Run Preset" while connected → commands fire, card shows Running → Sent
- [ ] Click "Save Presets" → save dialog opens, file is written
- [ ] Load the saved file again → second preset card appears
- [ ] Version warning banner appears on next connect if proto < 1 (currently firmware sends proto=1 so banner stays hidden — this is correct)

- [ ] **Step 4: Commit Part B**

```bash
git add frontend/preset-validator.js frontend/preset-validator.test.js frontend/tests.js frontend/app.js frontend/index.html frontend/styles.css preload.js main.js package.json
git commit -m "feat: saved test presets — load/save JSON preset files, Custom tab in Tests view"
```

---

## Self-Review

**Spec coverage check:**

| Requirement | Task |
|-------------|------|
| Version badge showing fw version | Task 3, 4, 5 |
| Warning banner on version mismatch | Task 1, 2, 5 |
| Firmware defines moved to dev.h | Task 6 |
| Load preset from JSON file | Task 10, 12, 13 |
| Save preset to JSON file | Task 10, 12, 13 |
| Custom tab in Tests view | Task 11 |
| Run custom preset sequences | Task 13 |
| Preset JSON validation | Task 8, 9 |
| Tests registered in npm test | Task 7, 14 |

**Placeholder scan:** None found — all code blocks are complete.

**Type consistency check:**
- `checkVersionCompat(profile)` → `{compatible, firmwareVersion, protoVersion, warnMsg}` — used consistently in Task 2 and Task 5
- `validatePreset(data)` → `{valid, error, preset}` — used consistently in Task 9 and Task 13
- `preset.id` assigned as `custom-${Date.now()}` in app.js Task 13 — matched by `getTestById` in tests.js Task 11
- `loadCustomPresets(presets)` takes an array — called with `[preset]` (single item wrapped) in app.js Task 13 ✓
- `onRunCustomTest(preset)` — defined in TestsView constructor Task 11, wired in app.js Task 13 ✓
