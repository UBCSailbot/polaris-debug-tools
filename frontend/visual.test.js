// frontend/visual.test.js
// Unit tests for the exported pure helper from visual.js.

import { buildCustomCommand } from './visual.js';

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    failed++;
  } else {
    console.log('PASS:', msg);
    passed++;
  }
}

const uartCommand = {
  buildCommand(values) {
    return `UART:LOOP:${values.byte}`;
  },
};

const canCommand = {
  buildCommand(values) {
    return `CANFD:SEND:${values.id}:${values.bytes}`;
  },
};

assert(
  buildCustomCommand(uartCommand, { byte: 'A5' }) === 'UART:LOOP:A5',
  'custom command delegates to builder'
);

assert(
  buildCustomCommand(canCommand, { id: '130', bytes: 'DEADBEEF' }) === 'CANFD:SEND:130:DEADBEEF',
  'multi-field custom command delegates to builder'
);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
