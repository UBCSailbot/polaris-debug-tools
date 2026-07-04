// frontend/command-tracking.cjs
// Pure helpers for main.js command correlation. Kept renderer-free and
// side-effect-free so they can be unit tested from tests/electron.
'use strict';

// A terminal frame arriving in the same domain within this window after a
// host-side timeout is flagged as the late reply to that timed-out command,
// so CSV exports can distinguish it from a fresh response.
const LATE_RESPONSE_WINDOW_MS = 10000;

/**
 * Decide whether a terminal frame completes the in-flight command.
 *
 * @param {object|null} activeCommand  { command, domain, sentAt } or null
 * @param {string} parsedDomain        domain of the arriving terminal frame
 * @param {number} now                 Date.now() at frame arrival
 * @returns {{ completes: boolean, rtt: number|null, staleInFlight: boolean }}
 *   staleInFlight=true means the connection claims a command is in flight but
 *   has no record of it — the caller should clear the stuck state instead of
 *   dereferencing a null activeCommand.
 */
function resolveCommandCompletion(activeCommand, parsedDomain, now) {
  if (!activeCommand) {
    return { completes: false, rtt: null, staleInFlight: true };
  }
  if (activeCommand.domain && activeCommand.domain !== parsedDomain) {
    return { completes: false, rtt: null, staleInFlight: false };
  }
  return { completes: true, rtt: now - activeCommand.sentAt, staleInFlight: false };
}

/**
 * True when a terminal frame is the late reply to a command that already
 * host-timed out (same domain, within LATE_RESPONSE_WINDOW_MS).
 *
 * @param {object|null} lastHostTimeout  { domain, at } recorded when the
 *                                       synthetic timeout frame was emitted
 * @param {string} parsedDomain
 * @param {number} now
 * @param {number} [windowMs]
 */
function isLateResponse(lastHostTimeout, parsedDomain, now, windowMs = LATE_RESPONSE_WINDOW_MS) {
  if (!lastHostTimeout) {
    return false;
  }
  if (lastHostTimeout.domain && lastHostTimeout.domain !== parsedDomain) {
    return false;
  }
  return (now - lastHostTimeout.at) <= windowMs;
}

module.exports = {
  resolveCommandCompletion,
  isLateResponse,
  LATE_RESPONSE_WINDOW_MS,
};
