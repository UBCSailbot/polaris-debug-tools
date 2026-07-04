// frontend/assertions.js
// Per-step preset assertions. A preset step may declare:
//   expect: { status: 'PASS', payload: { rx: '41' } }
// The runner captures the step's terminal response and evaluates it here,
// turning a preset run into a real pass/fail test instead of fire-and-forget.

import { parseKeyValuePayload } from './protocol-parser.js';

// Terminal statuses per serial-protocol-v1 section 7, plus HOST_TIMEOUT for
// the GUI-local timeout path (section 9.1).
export const EXPECTABLE_STATUSES = new Set(['PASS', 'FAIL', 'TIMEOUT', 'INFO', 'HOST_TIMEOUT']);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Validate the shape of a step's `expect` block.
 * @returns {{ valid: boolean, error: string|null }}
 */
export function validateExpectShape(expect) {
  if (!isPlainObject(expect)) {
    return { valid: false, error: '"expect" must be an object.' };
  }

  const hasStatus = expect.status !== undefined;
  const hasPayload = expect.payload !== undefined;

  if (hasStatus && (typeof expect.status !== 'string' || !EXPECTABLE_STATUSES.has(expect.status))) {
    return {
      valid: false,
      error: `"expect.status" must be one of ${[...EXPECTABLE_STATUSES].join(', ')}.`,
    };
  }

  if (hasPayload) {
    if (!isPlainObject(expect.payload)) {
      return { valid: false, error: '"expect.payload" must be an object of key/value pairs.' };
    }
    const keys = Object.keys(expect.payload);
    if (!keys.length) {
      return { valid: false, error: '"expect.payload" must contain at least one key.' };
    }
    for (const key of keys) {
      const value = expect.payload[key];
      if (value === null || (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean')) {
        return { valid: false, error: `"expect.payload.${key}" must be a string, number, or boolean.` };
      }
    }
  }

  if (!hasStatus && !hasPayload) {
    return { valid: false, error: '"expect" must declare a status and/or payload to check.' };
  }

  return { valid: true, error: null };
}

/**
 * Evaluate a step's expectation against the observed terminal response.
 *
 * @param {object} expect   validated expect block ({ status?, payload? })
 * @param {object|null} outcome  { status, payload, localTimeout } from the
 *                               terminal frame, or null if none arrived
 * @returns {{ pass: boolean, failures: string[] }}
 */
export function evaluateExpectation(expect, outcome) {
  const failures = [];

  if (!outcome) {
    return { pass: false, failures: ['no response captured for this step'] };
  }

  const effectiveStatus = outcome.localTimeout ? 'HOST_TIMEOUT' : outcome.status;

  if (expect.status !== undefined && expect.status !== effectiveStatus) {
    failures.push(`expected status ${expect.status}, got ${effectiveStatus}`);
  }

  if (expect.payload !== undefined) {
    const fields = parseKeyValuePayload(outcome.payload);
    for (const key of Object.keys(expect.payload)) {
      const expected = String(expect.payload[key]);
      if (!(key in fields)) {
        failures.push(`payload key "${key}" missing (expected "${expected}")`);
      } else if (fields[key] !== expected) {
        failures.push(`payload "${key}": expected "${expected}", got "${fields[key]}"`);
      }
    }
  }

  return { pass: failures.length === 0, failures };
}
