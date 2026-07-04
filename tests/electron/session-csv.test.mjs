// Tests for frontend/session-csv.cjs — CSV escaping and session export
// building used by main.js (log:export-csv IPC handler).
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { csvEscape, buildSessionCsv, CSV_HEADER } = require('../../frontend/session-csv.cjs');

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); failed++; }
  else { console.log('PASS:', msg); passed++; }
}

// --- csvEscape ---------------------------------------------------------------

assert(csvEscape('plain') === 'plain', 'plain value unescaped');
assert(csvEscape(null) === '', 'null → empty string');
assert(csvEscape(undefined) === '', 'undefined → empty string');
assert(csvEscape('a,b') === '"a,b"', 'comma → quoted');
assert(csvEscape('say "hi"') === '"say ""hi"""', 'quotes doubled and quoted');
assert(csvEscape('line1\nline2') === '"line1\nline2"', 'newline → quoted');
assert(csvEscape('key=1;other=2') === 'key=1;other=2', 'semicolon payload needs no quoting');

// --- buildSessionCsv ---------------------------------------------------------

assert(CSV_HEADER.trim() === 'timestamp_ms,proto,status,rtt_ms,late,data,raw', 'header includes late column');

const rows = [
  { ts: 100, proto: 'UART', status: 'PASS', rtt: 12, late: false, data: 'rx=41', raw: 'UART:PASS:rx=41' },
  { ts: 200, proto: 'I2C', status: 'HOST_TIMEOUT', rtt: null, late: false, data: 'reason=host-timeout', raw: 'I2C:TIMEOUT:reason=host-timeout' },
  { ts: 300, proto: 'I2C', status: 'PASS', rtt: null, late: true, data: 'addr=0x6A', raw: 'I2C:PASS:addr=0x6A' },
];

const csv = buildSessionCsv(rows);
const lines = csv.split('\n');

assert(lines[0] === CSV_HEADER.trim(), 'first line is the header');
assert(lines.length === 4, 'one line per row plus header');
assert(lines[1] === '100,UART,PASS,12,,rx=41,UART:PASS:rx=41', 'normal row: empty late column');
assert(lines[2] === '200,I2C,HOST_TIMEOUT,,,reason=host-timeout,I2C:TIMEOUT:reason=host-timeout', 'host-timeout row: empty rtt and late');
assert(lines[3] === '300,I2C,PASS,,1,addr=0x6A,I2C:PASS:addr=0x6A', 'late row: late column is 1');

// Values containing commas stay a single logical column.
const tricky = buildSessionCsv([
  { ts: 1, proto: 'SYS', status: 'INFO', rtt: 2, late: false, data: 'caps=UART,SPI', raw: 'SYS:INFO:caps=UART,SPI' },
]);
assert(tricky.split('\n')[1] === '1,SYS,INFO,2,,"caps=UART,SPI","SYS:INFO:caps=UART,SPI"', 'comma-bearing payloads are quoted');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
