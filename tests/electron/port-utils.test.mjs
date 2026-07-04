// Tests for frontend/port-utils.cjs — serial port list normalization with
// ST-Link detection and ST-Link-first ordering (used by main.js), and for
// frontend/port-select.js — the renderer's auto-selection helper.
import { createRequire } from 'node:module';
import { choosePortSelection } from '../../frontend/port-select.js';

const require = createRequire(import.meta.url);
const { normalizeListedPorts, isStLinkPort } = require('../../frontend/port-utils.cjs');

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); failed++; }
  else { console.log('PASS:', msg); passed++; }
}

// --- isStLinkPort --------------------------------------------------------

assert(isStLinkPort({ vendorId: '0483' }) === true, 'VID 0483 lowercase-hex string → ST-Link');
assert(isStLinkPort({ vendorId: '0483', productId: '374B' }) === true, 'VID 0483 with PID → ST-Link');
assert(isStLinkPort({ vendorId: '0x0483' }) === true, 'VID with 0x prefix → ST-Link');
assert(isStLinkPort({ vendorId: '1A86' }) === false, 'other VID (CH340) → not ST-Link');
assert(isStLinkPort({ manufacturer: 'STMicroelectronics' }) === true, 'STMicroelectronics manufacturer → ST-Link');
assert(isStLinkPort({ friendlyName: 'ST-Link Virtual COM Port (COM5)' }) === true, 'ST-Link friendly name → ST-Link');
assert(isStLinkPort({ friendlyName: 'STLink Virtual COM Port' }) === true, 'STLink (no dash) → ST-Link');
assert(isStLinkPort({ manufacturer: 'FTDI' }) === false, 'FTDI → not ST-Link');
assert(isStLinkPort({}) === false, 'empty port → not ST-Link');
assert(isStLinkPort(null) === false, 'null port → not ST-Link');

// --- normalizeListedPorts -------------------------------------------------

const normalized = normalizeListedPorts([
  { path: 'COM3', manufacturer: 'FTDI', vendorId: '0403' },
  { path: 'COM12', manufacturer: 'STMicroelectronics', vendorId: '0483', productId: '374B' },
  { path: 'COM3', manufacturer: 'duplicate should be dropped' },
  { path: 'COM4', friendlyName: 'USB Serial Device (COM4)' },
  { path: '' },
  null,
]);

assert(normalized.length === 3, 'dedupes by path and drops empty entries');
assert(normalized[0].path === 'COM12', 'ST-Link port sorts first even with higher COM number');
assert(normalized[0].isStLink === true, 'ST-Link port carries isStLink flag');
assert(normalized[1].path === 'COM3' && normalized[2].path === 'COM4', 'non-ST-Link ports sorted by COM number');
assert(normalized[1].isStLink === false, 'non-ST-Link port flagged false');
assert(normalized[0].manufacturer === 'STMicroelectronics', 'manufacturer preserved');
assert(normalized[2].friendlyName === 'USB Serial Device (COM4)', 'friendlyName preserved');

// Windows WMI-shaped entries (DeviceID/Name) still normalize.
const wmi = normalizeListedPorts([{ DeviceID: 'COM7', Name: 'USB Serial (COM7)' }]);
assert(wmi.length === 1 && wmi[0].path === 'COM7', 'WMI DeviceID accepted as path');
assert(wmi[0].friendlyName === 'USB Serial (COM7)', 'WMI Name accepted as friendlyName');

// Multiple ST-Links stay COM-ordered among themselves.
const multi = normalizeListedPorts([
  { path: 'COM9', vendorId: '0483' },
  { path: 'COM2', vendorId: '0483' },
  { path: 'COM1', vendorId: '0403' },
]);
assert(multi.map(p => p.path).join(',') === 'COM2,COM9,COM1', 'ST-Links first, each group COM-ordered');

// --- choosePortSelection ---------------------------------------------------

const ports = [
  { path: 'COM12', isStLink: true },
  { path: 'COM3', isStLink: false },
];

assert(choosePortSelection(ports, 'COM3') === 'COM3', 'existing selection is preserved');
assert(choosePortSelection(ports, '') === 'COM12', 'no selection → first ST-Link auto-picked');
assert(choosePortSelection(ports, 'COM99') === 'COM12', 'vanished selection → falls back to ST-Link');
assert(choosePortSelection([{ path: 'COM3', isStLink: false }], '') === '', 'no ST-Link present → no auto-pick');
assert(choosePortSelection([], 'COM3') === '', 'no ports → empty selection');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
