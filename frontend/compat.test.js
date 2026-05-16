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

// 7. fw field null → firmwareVersion null, compat still based on proto
const r7 = checkVersionCompat({ available: true, proto: REQUIRED_PROTO_VERSION, fw: null, caps: [], board: 'devboard', legacy: null });
assert(r7.compatible === true, 'no fw field → still compatible if proto ok');
assert(r7.firmwareVersion === null, 'no fw field → firmwareVersion null');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
