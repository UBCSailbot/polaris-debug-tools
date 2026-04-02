import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  parseLine,
  parseCapabilities,
  parseKeyValuePayload,
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

const sysMode = parseLine('SYS:INFO:mode=legacy');
assert(sysMode !== null, 'SYS INFO mode line parses');
assert(sysMode.kind === 'system', 'SYS INFO is classified as system');
assert(isTerminalFrame(sysMode) === true, 'SYS INFO remains terminal');

const canPass = parseLine('CANFD:PASS:id=0x130;dlc=8');
assert(canPass !== null, 'CANFD PASS parses');
assert(canPass.payload === 'id=0x130;dlc=8', 'CANFD PASS payload preserved');

const logError = parseLine('LOG:ERROR:hal-i2c-timeout');
assert(logError !== null, 'LOG ERROR parses');
assert(logError.level === 'ERROR', 'LOG level is ERROR');
assert(isLog(logError) === true, 'LOG ERROR is recognized as log');

const i2cTimeout = parseLine('I2C:TIMEOUT:addr=0x6A');
assert(i2cTimeout !== null, 'I2C TIMEOUT parses');
assert(i2cTimeout.status === 'TIMEOUT', 'I2C TIMEOUT status preserved');

const uartData = parseLine('UART:DATA:2447504747412C');
assert(uartData !== null, 'UART DATA parses');
assert(isStreamingEvent(uartData) === true, 'UART DATA is a stream event');

const canFrame = parseLine('CANFD:FRAME:130:8:DEADBEEF01020304');
assert(canFrame !== null, 'CANFD FRAME parses');
assert(isStreamingEvent(canFrame) === true, 'CANFD FRAME is a stream event');

const malformedLog = parseLine('LOG:DEBUG:not-supported');
assert(malformedLog === null, 'unsupported LOG level is rejected');

const malformedDomain = parseLine('GPS:DATA:1234');
assert(malformedDomain === null, 'unknown domain is rejected');

const kv = parseKeyValuePayload('proto=1;fw=0.2.0;caps=UART,SPI;badpart;legacy=1');
assert(kv.proto === '1', 'key-value parser reads proto');
assert(kv.fw === '0.2.0', 'key-value parser reads fw');
assert(kv.caps === 'UART,SPI', 'key-value parser reads caps');
assert(kv.legacy === '1', 'key-value parser reads legacy');
assert(!Object.prototype.hasOwnProperty.call(kv, 'badpart'), 'key-value parser ignores malformed fragments');

const profile = parseCapabilities('proto=1;fw=0.2.0;board=devboard;caps=UART,SPI,UART_STREAM;legacy=0;future=keep');
assert(profile.proto === 1, 'parseCapabilities converts proto to number');
assert(profile.legacy === false, 'parseCapabilities converts legacy flag to boolean false');
assert(profile.caps.includes('UART_STREAM'), 'parseCapabilities preserves feature caps');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
