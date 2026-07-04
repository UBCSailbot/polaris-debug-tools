// frontend/soak.js
// Pure bookkeeping for soak mode: run a test sequence in a loop bounded by a
// run count and/or wall-clock duration, and accumulate error-rate stats.
// The actual sending lives in app.js (executeSequenceSteps); everything here
// is side-effect-free so it can be unit tested.

function isNonNegativeInt(value) {
  return Number.isInteger(value) && value >= 0;
}

/**
 * A soak needs at least one positive bound (iterations or durationMs) so it
 * always terminates without operator action.
 */
export function validateSoakConfig({ iterations = 0, durationMs = 0, intervalMs = 0 } = {}) {
  if (!isNonNegativeInt(iterations) || !isNonNegativeInt(durationMs) || !isNonNegativeInt(intervalMs)) {
    return { valid: false, error: 'Soak bounds must be non-negative whole numbers.' };
  }
  if (iterations === 0 && durationMs === 0) {
    return { valid: false, error: 'Set a run count and/or a duration so the soak terminates.' };
  }
  return { valid: true, error: null };
}

export function createSoakState({ iterations = 0, durationMs = 0, intervalMs = 0 } = {}) {
  return {
    config: { iterations, durationMs, intervalMs },
    startedAt: null,
    endedAt: null,
    cancelled: false,
    runs: 0,
    runsWithFailures: 0,
    stepsSent: 0,
    assertChecked: 0,
    assertFailed: 0,
    hostTimeouts: 0,
    sendErrors: 0,
  };
}

export function beginSoak(state, now = Date.now()) {
  state.startedAt = now;
  return state;
}

export function shouldContinueSoak(state, now = Date.now()) {
  if (state.cancelled) {
    return false;
  }
  if (state.config.iterations > 0 && state.runs >= state.config.iterations) {
    return false;
  }
  if (state.config.durationMs > 0 && state.startedAt != null &&
      (now - state.startedAt) >= state.config.durationMs) {
    return false;
  }
  return true;
}

/**
 * Fold one executeSequenceSteps report into the soak stats.
 * A run "fails" if any step could not be sent, any assertion failed, or any
 * awaited step host-timed out.
 */
export function recordSoakRun(state, report) {
  state.runs += 1;
  state.stepsSent += report.sent;
  state.assertChecked += report.assertChecked;
  state.assertFailed += report.assertFailed;
  state.hostTimeouts += report.hostTimeouts;
  if (report.error) {
    state.sendErrors += 1;
  }
  if (report.error || report.assertFailed > 0 || report.hostTimeouts > 0) {
    state.runsWithFailures += 1;
  }
  return state;
}

export function summarizeSoak(state, now = Date.now()) {
  const elapsedMs = state.startedAt != null
    ? (state.endedAt != null ? state.endedAt : now) - state.startedAt
    : 0;
  const errorRatePct = state.runs > 0
    ? Math.round((state.runsWithFailures / state.runs) * 1000) / 10
    : 0;

  return {
    runs: state.runs,
    runsWithFailures: state.runsWithFailures,
    errorRatePct,
    stepsSent: state.stepsSent,
    assertChecked: state.assertChecked,
    assertFailed: state.assertFailed,
    hostTimeouts: state.hostTimeouts,
    sendErrors: state.sendErrors,
    elapsedMs,
  };
}
