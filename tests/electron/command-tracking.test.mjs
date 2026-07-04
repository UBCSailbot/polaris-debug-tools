// Tests for frontend/command-tracking.cjs — pure helpers used by main.js to
// decide whether a terminal frame completes the in-flight command, and to
// flag late responses that arrive after a host-side timeout.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  resolveCommandCompletion,
  isLateResponse,
  LATE_RESPONSE_WINDOW_MS,
} = require('../../frontend/command-tracking.cjs');

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); failed++; }
  else { console.log('PASS:', msg); passed++; }
}

// --- resolveCommandCompletion ------------------------------------------------

// Matching domain completes the command and yields an RTT.
const r1 = resolveCommandCompletion({ command: 'UART:INIT', domain: 'UART', sentAt: 1000 }, 'UART', 1250);
assert(r1.completes === true, 'matching domain → completes');
assert(r1.rtt === 250, 'matching domain → rtt computed from sentAt');
assert(r1.staleInFlight === false, 'matching domain → not stale');

// Command without a parsed domain completes on any terminal frame.
const r2 = resolveCommandCompletion({ command: 'garbage', domain: null, sentAt: 500 }, 'SPI', 600);
assert(r2.completes === true, 'null command domain → completes on any domain');
assert(r2.rtt === 100, 'null command domain → rtt still computed');

// Mismatched domain must NOT complete (stale frame from a previous command).
const r3 = resolveCommandCompletion({ command: 'UART:INIT', domain: 'UART', sentAt: 0 }, 'CANFD', 50);
assert(r3.completes === false, 'mismatched domain → does not complete');
assert(r3.rtt === null, 'mismatched domain → no rtt');

// THE BUG: a null activeCommand while inFlight must not crash and must be
// reported as stale so the caller can clear the stuck in-flight state.
let crashed = false;
let r4 = null;
try {
  r4 = resolveCommandCompletion(null, 'UART', 1234);
} catch {
  crashed = true;
}
assert(!crashed, 'null activeCommand → no TypeError');
assert(r4 && r4.completes === false, 'null activeCommand → does not complete');
assert(r4 && r4.rtt === null, 'null activeCommand → no rtt');
assert(r4 && r4.staleInFlight === true, 'null activeCommand → flagged stale so caller clears state');

// --- isLateResponse ----------------------------------------------------------

assert(LATE_RESPONSE_WINDOW_MS > 0, 'late-response window is a positive constant');

// A terminal frame in the same domain shortly after a host timeout is late.
assert(
  isLateResponse({ domain: 'I2C', at: 10000 }, 'I2C', 10000 + 500) === true,
  'same-domain frame inside window → late',
);

// Outside the window it is treated as a fresh frame.
assert(
  isLateResponse({ domain: 'I2C', at: 10000 }, 'I2C', 10000 + LATE_RESPONSE_WINDOW_MS + 1) === false,
  'same-domain frame outside window → not late',
);

// Different domain never matches the timed-out command.
assert(
  isLateResponse({ domain: 'I2C', at: 10000 }, 'UART', 10100) === false,
  'different domain → not late',
);

// No recorded host timeout → nothing is late.
assert(isLateResponse(null, 'UART', 123) === false, 'no host timeout recorded → not late');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
