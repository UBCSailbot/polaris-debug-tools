// Tests for frontend/assertions.js — per-step preset assertions.
// A preset step may declare:
//   expect: { status: 'PASS', payload: { rx: '41' } }
// and the runner evaluates the board's terminal response against it.
import { validateExpectShape, evaluateExpectation } from '../../frontend/assertions.js';

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); failed++; }
  else { console.log('PASS:', msg); passed++; }
}

// --- validateExpectShape -------------------------------------------------

assert(validateExpectShape({ status: 'PASS' }).valid, 'status-only expect is valid');
assert(validateExpectShape({ payload: { rx: '41' } }).valid, 'payload-only expect is valid');
assert(validateExpectShape({ status: 'FAIL', payload: { reason: 'no-echo' } }).valid, 'status+payload expect is valid');
assert(validateExpectShape({ status: 'HOST_TIMEOUT' }).valid, 'HOST_TIMEOUT is a valid expected status');
assert(validateExpectShape({ payload: { dlc: 4 } }).valid, 'numeric payload values allowed');

assert(!validateExpectShape(null).valid, 'null expect → invalid');
assert(!validateExpectShape('PASS').valid, 'string expect → invalid');
assert(!validateExpectShape({}).valid, 'empty expect (nothing to check) → invalid');
assert(!validateExpectShape({ status: 'MAYBE' }).valid, 'unknown status → invalid');
assert(!validateExpectShape({ payload: [] }).valid, 'array payload → invalid');
assert(!validateExpectShape({ payload: { rx: { nested: true } } }).valid, 'nested payload value → invalid');
assert(!validateExpectShape({ payload: {} }).valid, 'empty payload object → invalid');

// --- evaluateExpectation ---------------------------------------------------

// Status match
const e1 = evaluateExpectation({ status: 'PASS' }, { status: 'PASS', payload: 'rx=41', localTimeout: false });
assert(e1.pass === true && e1.failures.length === 0, 'matching status → pass');

const e2 = evaluateExpectation({ status: 'PASS' }, { status: 'FAIL', payload: 'reason=no-echo', localTimeout: false });
assert(e2.pass === false, 'status mismatch → fail');
assert(/PASS/.test(e2.failures[0]) && /FAIL/.test(e2.failures[0]), 'failure message names expected and actual status');

// Host timeout is its own status
const e3 = evaluateExpectation({ status: 'PASS' }, { status: 'TIMEOUT', payload: '', localTimeout: true });
assert(e3.pass === false && /HOST_TIMEOUT/.test(e3.failures[0]), 'host timeout reported as HOST_TIMEOUT');

const e4 = evaluateExpectation({ status: 'HOST_TIMEOUT' }, { status: 'TIMEOUT', payload: '', localTimeout: true });
assert(e4.pass === true, 'expecting HOST_TIMEOUT matches a host timeout');

// Payload key matching via key=value payload parsing
const e5 = evaluateExpectation({ payload: { rx: '41' } }, { status: 'PASS', payload: 'rx=41', localTimeout: false });
assert(e5.pass === true, 'payload key match → pass');

const e6 = evaluateExpectation({ payload: { rx: '42' } }, { status: 'PASS', payload: 'rx=41', localTimeout: false });
assert(e6.pass === false && /rx/.test(e6.failures[0]), 'payload value mismatch → fail naming the key');

const e7 = evaluateExpectation({ payload: { dlc: 4 } }, { status: 'PASS', payload: 'id=0x130;dlc=4', localTimeout: false });
assert(e7.pass === true, 'numeric expected value compared as string');

const e8 = evaluateExpectation({ payload: { missing: '1' } }, { status: 'PASS', payload: 'rx=41', localTimeout: false });
assert(e8.pass === false && /missing/.test(e8.failures[0]), 'absent payload key → fail naming the key');

// Combined: all checks must hold, all failures reported
const e9 = evaluateExpectation(
  { status: 'PASS', payload: { rx: '42', tx: '41' } },
  { status: 'FAIL', payload: 'rx=41', localTimeout: false },
);
assert(e9.pass === false && e9.failures.length === 3, 'status + two payload mismatches → three failures');

// No response at all (waiter timed out client-side)
const e10 = evaluateExpectation({ status: 'PASS' }, null);
assert(e10.pass === false && /no response/i.test(e10.failures[0]), 'missing outcome → fail with no-response message');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
