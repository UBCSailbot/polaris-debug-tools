// frontend/terminal.test.js
// Unit tests for the exported helper functions from terminal.js.
// The Terminal class itself requires a DOM so it is not tested here.
// Run with: node --experimental-vm-modules frontend/terminal.test.js

import { formatTs, formatDuration } from './terminal.js';

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); failed++; }
  else        { console.log('PASS:', msg);  passed++; }
}

// ─── formatTs ────────────────────────────────────────────
const d1 = new Date(2026, 2, 28, 9, 5, 3, 42);
assert(formatTs(d1) === '[09:05:03.042]', 'formatTs pads all fields');

const d2 = new Date(2026, 2, 28, 23, 59, 59, 999);
assert(formatTs(d2) === '[23:59:59.999]', 'formatTs max values');

const d3 = new Date(2026, 2, 28, 0, 0, 0, 0);
assert(formatTs(d3) === '[00:00:00.000]', 'formatTs midnight zeros');

const d4 = new Date(2026, 2, 28, 12, 34, 56, 789);
assert(formatTs(d4) === '[12:34:56.789]', 'formatTs normal time');

// Confirm format is [HH:MM:SS.mmm]
assert(/^\[\d{2}:\d{2}:\d{2}\.\d{3}\]$/.test(formatTs(d1)), 'formatTs matches expected pattern');

// ─── formatDuration ──────────────────────────────────────
assert(formatDuration(0)        === '00:00:00', 'zero ms');
assert(formatDuration(999)      === '00:00:00', 'sub-second rounds to 0');
assert(formatDuration(1000)     === '00:00:01', 'exactly 1 second');
assert(formatDuration(60000)    === '00:01:00', '1 minute');
assert(formatDuration(61000)    === '00:01:01', '61 seconds');
assert(formatDuration(3600000)  === '01:00:00', '1 hour');
assert(formatDuration(3661000)  === '01:01:01', '1h 1m 1s');
assert(formatDuration(86399000) === '23:59:59', '23:59:59');
assert(formatDuration(86400000) === '24:00:00', '24 hours (no rollover)');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
