// frontend/protocols.test.js
// Unit tests for parseLine() and parseCanFrame().
// Run with: node --experimental-vm-modules frontend/protocols.test.js
// (Uses dynamic import so ES module exports are accessible from Node)

import { parseLine, parseCanFrame } from './protocols.js';

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); failed++; }
  else        { console.log('PASS:', msg);  passed++; }
}

// ─── parseLine ───────────────────────────────────────────
assert(parseLine('UART:PASS:hello')          !== null,  'valid UART line parses');
assert(parseLine('SPI:FAIL:0xA5')            !== null,  'valid SPI line parses');
assert(parseLine('CANFD:TIMEOUT:')           !== null,  'valid CANFD empty data parses');
assert(parseLine('CANFD:INIT:some data')     !== null,  'CANFD INIT parses');
assert(parseLine('garbage')                  === null,  'garbage returns null');
assert(parseLine('')                         === null,  'empty string returns null');
assert(parseLine(null)                       === null,  'null returns null');
assert(parseLine('uart:pass:x')              === null,  'lowercase proto returns null');
assert(parseLine('UART:pass:x')              === null,  'lowercase status returns null');
assert(parseLine('NMEA:PASS:x')              === null,  'unknown proto returns null');
assert(parseLine('UART:PASS:hello').proto    === 'UART','proto field is UART');
assert(parseLine('SPI:FAIL:0xA5').status     === 'FAIL','status field is FAIL');
assert(parseLine('UART:PASS:hello').data     === 'hello','data field is hello');
assert(parseLine('CANFD:PASS:a:b:c').data    === 'a:b:c','data preserves colons');

// ─── parseCanFrame ───────────────────────────────────────
const f1 = parseCanFrame('ID=0x130 DLC=8 BYTES=DEADBEEF');
assert(f1.id  === 0x130, 'CAN frame ID parses as int (0x130)');
assert(f1.dlc === 8,     'CAN frame DLC parses as int (8)');

const f2 = parseCanFrame('ID=0x133 DLC=0');
assert(f2.id  === 0x133, 'CAN frame ID 0x133');
assert(f2.dlc === 0,     'CAN frame DLC 0');

assert(parseCanFrame('no match').id  === null, 'missing ID returns null');
assert(parseCanFrame('no match').dlc === null, 'missing DLC returns null');
assert(parseCanFrame('').id          === null, 'empty string ID returns null');
assert(parseCanFrame(null).id        === null, 'null input returns null');

// lowercase hex in ID
const f3 = parseCanFrame('ID=0x1a2 DLC=4');
assert(f3.id === 0x1a2, 'lowercase hex ID parses correctly');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
