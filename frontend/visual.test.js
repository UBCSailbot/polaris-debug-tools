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
