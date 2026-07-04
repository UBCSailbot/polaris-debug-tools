// Tests for frontend/soak.js — soak-mode bookkeeping: run scheduling bounds,
// per-run stat accumulation, and the error-rate summary.
import {
  validateSoakConfig,
  createSoakState,
  beginSoak,
  shouldContinueSoak,
  recordSoakRun,
  summarizeSoak,
} from '../../frontend/soak.js';

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); failed++; }
  else { console.log('PASS:', msg); passed++; }
}

// --- validateSoakConfig ----------------------------------------------------

assert(validateSoakConfig({ iterations: 10 }).valid, 'iterations-only config valid');
assert(validateSoakConfig({ durationMs: 60000 }).valid, 'duration-only config valid');
assert(validateSoakConfig({ iterations: 5, durationMs: 60000 }).valid, 'both bounds valid');
assert(!validateSoakConfig({}).valid, 'no bound at all → invalid');
assert(!validateSoakConfig({ iterations: 0, durationMs: 0 }).valid, 'zero bounds → invalid');
assert(!validateSoakConfig({ iterations: -1 }).valid, 'negative iterations → invalid');
assert(!validateSoakConfig({ iterations: 2.5 }).valid, 'fractional iterations → invalid');
assert(!validateSoakConfig({ iterations: 10, intervalMs: -5 }).valid, 'negative interval → invalid');

// --- run-count bound ---------------------------------------------------------

const byCount = createSoakState({ iterations: 2, intervalMs: 0 });
beginSoak(byCount, 1000);
assert(byCount.startedAt === 1000, 'beginSoak stamps startedAt');
assert(shouldContinueSoak(byCount, 1001) === true, 'no runs yet → continue');

recordSoakRun(byCount, { sent: 3, total: 3, assertChecked: 2, assertFailed: 0, hostTimeouts: 0, failures: [], error: null });
assert(shouldContinueSoak(byCount, 1002) === true, '1 of 2 runs → continue');

recordSoakRun(byCount, { sent: 3, total: 3, assertChecked: 2, assertFailed: 1, hostTimeouts: 0, failures: [{ label: 'x', messages: ['m'] }], error: null });
assert(shouldContinueSoak(byCount, 1003) === false, '2 of 2 runs → stop');

// --- duration bound ----------------------------------------------------------

const byTime = createSoakState({ durationMs: 5000 });
beginSoak(byTime, 10000);
assert(shouldContinueSoak(byTime, 14999) === true, 'inside duration → continue');
assert(shouldContinueSoak(byTime, 15000) === false, 'at duration → stop');

// --- cancellation --------------------------------------------------------------

const cancelled = createSoakState({ iterations: 100 });
beginSoak(cancelled, 0);
cancelled.cancelled = true;
assert(shouldContinueSoak(cancelled, 1) === false, 'cancelled → stop');

// --- stat accumulation + summary ---------------------------------------------

const stats = createSoakState({ iterations: 4 });
beginSoak(stats, 0);
recordSoakRun(stats, { sent: 3, total: 3, assertChecked: 3, assertFailed: 0, hostTimeouts: 0, failures: [], error: null });
recordSoakRun(stats, { sent: 3, total: 3, assertChecked: 3, assertFailed: 2, hostTimeouts: 0, failures: [], error: null });
recordSoakRun(stats, { sent: 1, total: 3, assertChecked: 1, assertFailed: 0, hostTimeouts: 1, failures: [], error: null });
recordSoakRun(stats, { sent: 0, total: 3, assertChecked: 0, assertFailed: 0, hostTimeouts: 0, failures: [], error: 'Port not open' });

const summary = summarizeSoak(stats, 60000);
assert(summary.runs === 4, 'summary counts runs');
assert(summary.stepsSent === 7, 'summary sums steps sent');
assert(summary.assertChecked === 7, 'summary sums assertions checked');
assert(summary.assertFailed === 2, 'summary sums assertion failures');
assert(summary.hostTimeouts === 1, 'summary sums host timeouts');
assert(summary.sendErrors === 1, 'summary counts send errors');
assert(summary.runsWithFailures === 3, 'runs with any failure counted (assert fail, host timeout, send error)');
assert(summary.errorRatePct === 75, 'error rate = failing runs / runs');
assert(summary.elapsedMs === 60000, 'elapsed measured from startedAt');

// Clean run does not count as failing
const clean = createSoakState({ iterations: 1 });
beginSoak(clean, 0);
recordSoakRun(clean, { sent: 2, total: 2, assertChecked: 0, assertFailed: 0, hostTimeouts: 0, failures: [], error: null });
assert(summarizeSoak(clean, 10).runsWithFailures === 0, 'clean run → no failures counted');
assert(summarizeSoak(clean, 10).errorRatePct === 0, 'clean run → 0% error rate');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
