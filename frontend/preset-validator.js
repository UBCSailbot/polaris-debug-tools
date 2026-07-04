// frontend/preset-validator.js
// Validates a preset JSON object loaded from disk.
// Returns { valid, error, preset } — preset is null on failure.

import { validateExpectShape } from './assertions.js';

const COMMAND_RE = /^[A-Z][A-Z0-9]*:[A-Z][A-Z0-9_]*(:[^\s]+)*$/;

// Presets may only drive the transport domains plus SYS. LOG is emit-only.
const ALLOWED_DOMAINS = new Set(['UART', 'SPI', 'CANFD', 'I2C', 'SYS']);

// SYS:MODE drops the board into legacy mode mid-run, which wedges every
// subsequent step into a host timeout — never valid inside a preset.
const BLOCKED_COMMANDS = new Set(['SYS:MODE']);

export function validatePreset(data) {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    return { valid: false, error: 'Preset must be a JSON object.', preset: null };
  }

  const name = typeof data.name === 'string' ? data.name.trim() : null;
  if (!name) {
    return { valid: false, error: 'Preset must have a non-empty "name" field.', preset: null };
  }

  if (!Array.isArray(data.steps) || data.steps.length === 0) {
    return { valid: false, error: 'Preset must have a non-empty "steps" array.', preset: null };
  }

  const steps = [];
  for (let i = 0; i < data.steps.length; i++) {
    const s = data.steps[i];

    if (typeof s.label !== 'string' || !s.label.trim()) {
      return { valid: false, error: `Step ${i + 1}: "label" must be a non-empty string.`, preset: null };
    }

    if (typeof s.command !== 'string' || !COMMAND_RE.test(s.command.trim())) {
      return { valid: false, error: `Step ${i + 1}: "command" must match DOMAIN:COMMAND[:args] format.`, preset: null };
    }

    const command = s.command.trim();
    const [domain, verb] = command.split(':');
    if (!ALLOWED_DOMAINS.has(domain)) {
      return { valid: false, error: `Step ${i + 1}: domain "${domain}" is not allowed in presets (use UART, SPI, CANFD, I2C, or SYS).`, preset: null };
    }
    if (BLOCKED_COMMANDS.has(`${domain}:${verb}`)) {
      return { valid: false, error: `Step ${i + 1}: "${domain}:${verb}" is not allowed in presets — it switches the board mode mid-run.`, preset: null };
    }

    if (s.delayMs !== undefined) {
      if (typeof s.delayMs !== 'number' || s.delayMs < 0) {
        return { valid: false, error: `Step ${i + 1}: "delayMs" must be a non-negative number.`, preset: null };
      }
    }

    if (s.expect !== undefined) {
      const expectCheck = validateExpectShape(s.expect);
      if (!expectCheck.valid) {
        return { valid: false, error: `Step ${i + 1}: ${expectCheck.error}`, preset: null };
      }
    }

    const step = { label: s.label.trim(), command: s.command.trim() };
    if (s.delayMs !== undefined) {
      step.delayMs = s.delayMs;
    }
    if (s.expect !== undefined) {
      step.expect = s.expect;
    }
    steps.push(step);
  }

  return {
    valid: true,
    error: null,
    preset: { name, steps },
  };
}
