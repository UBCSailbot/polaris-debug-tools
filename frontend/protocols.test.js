// frontend/protocols.test.js
// Run with: node frontend/protocols.test.js

import { createRequire } from 'node:module';
import { PROTOCOLS, parseCanFrame } from './protocols.js';

const require = createRequire(import.meta.url);
const {
  parseLine,
  parseCapabilities,
  isTerminalFrame,
  isStreamingEvent,
  isLog,
} = require('./protocol-parser.cjs');

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

const uartPass = parseLine('UART:PASS:rx=41');
assert(uartPass !== null, 'valid UART response parses');
assert(uartPass.domain === 'UART', 'response domain is UART');
assert(uartPass.status === 'PASS', 'response status is PASS');
assert(isTerminalFrame(uartPass) === true, 'PASS frame is terminal');

const sysInfo = parseLine('SYS:INFO:proto=1;fw=0.2.0;board=devboard;caps=UART,SPI;legacy=1');
assert(sysInfo !== null, 'SYS INFO parses');
assert(isTerminalFrame(sysInfo) === true, 'SYS INFO is terminal');

const uartEvent = parseLine('UART:DATA:A102');
assert(uartEvent !== null, 'UART stream event parses');
assert(isStreamingEvent(uartEvent) === true, 'UART:DATA is a streaming event');

const canEvent = parseLine('CANFD:FRAME:130:8:DEADBEEF');
assert(canEvent !== null, 'CANFD stream event parses');
assert(isStreamingEvent(canEvent) === true, 'CANFD:FRAME is a streaming event');

const logFrame = parseLine('LOG:WARN:reason=bad-frame');
assert(logFrame !== null, 'LOG frame parses');
assert(isLog(logFrame) === true, 'LOG frame classified as log');

assert(parseLine('garbage') === null, 'garbage returns null');
assert(parseLine('uart:pass:x') === null, 'lowercase proto returns null');
assert(parseLine('NMEA:PASS:x') === null, 'unknown domain returns null');

const profile = parseCapabilities('proto=1;fw=0.2.0;board=devboard;caps=UART,SPI,CANFD;legacy=1;unknown=keep');
assert(profile.proto === 1, 'profile proto parses');
assert(profile.fw === '0.2.0', 'profile fw parses');
assert(profile.board === 'devboard', 'profile board parses');
assert(profile.caps.length === 3, 'profile caps parse as array');
assert(profile.legacy === true, 'legacy flag parses');

const spiCmd = PROTOCOLS.SPI.commands.find(cmd => cmd.custom === true);
assert(spiCmd.buildCommand({ tx: '75ff' }) === 'SPI:XFER:75FF', 'SPI custom builder normalizes uppercase hex');
try {
  spiCmd.buildCommand({ tx: '75F' });
  assert(false, 'SPI custom builder rejects odd-length hex');
} catch {
  assert(true, 'SPI custom builder rejects odd-length hex');
}

const i2cRead = PROTOCOLS.I2C.commands.find(cmd => cmd.label === 'Read register...');
assert(
  i2cRead.buildCommand({ addr: '6a', reg: '28', len: '6' }) === 'I2C:READ:6A:28:6',
  'I2C read builder matches v1 grammar'
);
try {
  i2cRead.buildCommand({ addr: '1FF', reg: '28', len: '6' });
  assert(false, 'I2C read builder rejects oversized address');
} catch {
  assert(true, 'I2C read builder rejects oversized address');
}

const canCmd = PROTOCOLS.CANFD.commands.find(cmd => cmd.custom === true);
const canStatusIndex = PROTOCOLS.CANFD.commands.findIndex(cmd => cmd.command === 'CANFD:STATUS');
const canSendIndex = PROTOCOLS.CANFD.commands.findIndex(cmd => cmd.custom === true);
assert(canCmd.label === 'Send', 'CAN custom action uses Send label');
assert(canSendIndex === canStatusIndex + 1, 'CAN custom action follows status in command order');
try {
  canCmd.buildCommand({ id: '1800', bytes: 'DEADBEEF' });
  assert(false, 'CAN custom builder rejects non-standard ID');
} catch {
  assert(true, 'CAN custom builder rejects non-standard ID');
}

const canFrame = parseCanFrame('id=0x130;dlc=8');
assert(canFrame.id === 0x130, 'CAN key/value ID parses');
assert(canFrame.dlc === 8, 'CAN key/value DLC parses');

const canEventFrame = parseCanFrame('130:8:DEADBEEF');
assert(canEventFrame.id === 0x130, 'CAN event ID parses');
assert(canEventFrame.dlc === 8, 'CAN event DLC parses');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
