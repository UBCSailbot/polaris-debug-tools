import { validatePreset } from './preset-validator.js';

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); failed++; }
  else { console.log('PASS:', msg); passed++; }
}

// 1. null input → invalid
const r1 = validatePreset(null);
assert(r1.valid === false, 'null → invalid');
assert(typeof r1.error === 'string', 'null → error string');

// 2. missing name → invalid
const r2 = validatePreset({ steps: [{ label: 'Init', command: 'I2C:INIT' }] });
assert(r2.valid === false, 'missing name → invalid');

// 3. empty name → invalid
const r3 = validatePreset({ name: '   ', steps: [{ label: 'Init', command: 'I2C:INIT' }] });
assert(r3.valid === false, 'empty name → invalid');

// 4. missing steps → invalid
const r4 = validatePreset({ name: 'My Test' });
assert(r4.valid === false, 'missing steps → invalid');

// 5. empty steps array → invalid
const r5 = validatePreset({ name: 'My Test', steps: [] });
assert(r5.valid === false, 'empty steps → invalid');

// 6. step missing label → invalid
const r6 = validatePreset({ name: 'My Test', steps: [{ command: 'I2C:INIT' }] });
assert(r6.valid === false, 'step missing label → invalid');

// 7. step missing command → invalid
const r7 = validatePreset({ name: 'My Test', steps: [{ label: 'Init' }] });
assert(r7.valid === false, 'step missing command → invalid');

// 8. command with wrong format (no colon) → invalid
const r8 = validatePreset({ name: 'My Test', steps: [{ label: 'Init', command: 'I2CINIT' }] });
assert(r8.valid === false, 'command no colon → invalid');

// 9. valid minimal preset → valid, preset returned
const r9 = validatePreset({ name: 'Test A', steps: [{ label: 'Init', command: 'I2C:INIT' }] });
assert(r9.valid === true, 'valid minimal → valid');
assert(r9.preset !== null, 'valid minimal → preset returned');
assert(r9.preset.name === 'Test A', 'valid minimal → name preserved');
assert(r9.preset.steps.length === 1, 'valid minimal → 1 step');
assert(r9.error === null, 'valid minimal → no error');

// 10. valid preset with delayMs → valid, delayMs preserved
const r10 = validatePreset({
  name: 'Full Test',
  steps: [
    { label: 'Init', command: 'SPI:INIT', delayMs: 160 },
    { label: 'Transfer', command: 'SPI:XFER:75FF', delayMs: 100 },
    { label: 'Status', command: 'SPI:STATUS' },
  ],
});
assert(r10.valid === true, 'multi-step with delayMs → valid');
assert(r10.preset.steps[0].delayMs === 160, 'delayMs preserved');
assert(r10.preset.steps[2].delayMs === undefined, 'missing delayMs stays undefined');

// 11. negative delayMs → invalid
const r11 = validatePreset({ name: 'Bad', steps: [{ label: 'Init', command: 'I2C:INIT', delayMs: -1 }] });
assert(r11.valid === false, 'negative delayMs → invalid');

// 12. name trimmed in output
const r12 = validatePreset({ name: '  My Preset  ', steps: [{ label: 'Init', command: 'I2C:INIT' }] });
assert(r12.valid === true, 'name with whitespace → valid');
assert(r12.preset.name === 'My Preset', 'name trimmed in output');

// 13. extra fields on preset ignored
const r13 = validatePreset({ name: 'Test', version: '99', unknownField: true, steps: [{ label: 'Init', command: 'UART:INIT' }] });
assert(r13.valid === true, 'extra fields ignored → valid');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
