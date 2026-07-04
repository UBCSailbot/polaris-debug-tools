import { validatePreset } from '../../frontend/preset-validator.js';

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); failed++; }
  else { console.log('PASS:', msg); passed++; }
}

// 1. null input â†’ invalid
const r1 = validatePreset(null);
assert(r1.valid === false, 'null â†’ invalid');
assert(typeof r1.error === 'string', 'null â†’ error string');

// 2. missing name â†’ invalid
const r2 = validatePreset({ steps: [{ label: 'Init', command: 'I2C:INIT' }] });
assert(r2.valid === false, 'missing name â†’ invalid');

// 3. empty name â†’ invalid
const r3 = validatePreset({ name: '   ', steps: [{ label: 'Init', command: 'I2C:INIT' }] });
assert(r3.valid === false, 'empty name â†’ invalid');

// 4. missing steps â†’ invalid
const r4 = validatePreset({ name: 'My Test' });
assert(r4.valid === false, 'missing steps â†’ invalid');

// 5. empty steps array â†’ invalid
const r5 = validatePreset({ name: 'My Test', steps: [] });
assert(r5.valid === false, 'empty steps â†’ invalid');

// 6. step missing label â†’ invalid
const r6 = validatePreset({ name: 'My Test', steps: [{ command: 'I2C:INIT' }] });
assert(r6.valid === false, 'step missing label â†’ invalid');

// 7. step missing command â†’ invalid
const r7 = validatePreset({ name: 'My Test', steps: [{ label: 'Init' }] });
assert(r7.valid === false, 'step missing command â†’ invalid');

// 8. command with wrong format (no colon) â†’ invalid
const r8 = validatePreset({ name: 'My Test', steps: [{ label: 'Init', command: 'I2CINIT' }] });
assert(r8.valid === false, 'command no colon â†’ invalid');

// 9. valid minimal preset â†’ valid, preset returned
const r9 = validatePreset({ name: 'Test A', steps: [{ label: 'Init', command: 'I2C:INIT' }] });
assert(r9.valid === true, 'valid minimal â†’ valid');
assert(r9.preset !== null, 'valid minimal â†’ preset returned');
assert(r9.preset.name === 'Test A', 'valid minimal â†’ name preserved');
assert(r9.preset.steps.length === 1, 'valid minimal â†’ 1 step');
assert(r9.error === null, 'valid minimal â†’ no error');

// 10. valid preset with delayMs â†’ valid, delayMs preserved
const r10 = validatePreset({
  name: 'Full Test',
  steps: [
    { label: 'Init', command: 'SPI:INIT', delayMs: 160 },
    { label: 'Transfer', command: 'SPI:XFER:75FF', delayMs: 100 },
    { label: 'Status', command: 'SPI:STATUS' },
  ],
});
assert(r10.valid === true, 'multi-step with delayMs â†’ valid');
assert(r10.preset.steps[0].delayMs === 160, 'delayMs preserved');
assert(r10.preset.steps[2].delayMs === undefined, 'missing delayMs stays undefined');

// 11. negative delayMs â†’ invalid
const r11 = validatePreset({ name: 'Bad', steps: [{ label: 'Init', command: 'I2C:INIT', delayMs: -1 }] });
assert(r11.valid === false, 'negative delayMs â†’ invalid');

// 12. name trimmed in output
const r12 = validatePreset({ name: '  My Preset  ', steps: [{ label: 'Init', command: 'I2C:INIT' }] });
assert(r12.valid === true, 'name with whitespace â†’ valid');
assert(r12.preset.name === 'My Preset', 'name trimmed in output');

// 13. extra fields on preset ignored
const r13 = validatePreset({ name: 'Test', version: '99', unknownField: true, steps: [{ label: 'Init', command: 'UART:INIT' }] });
assert(r13.valid === true, 'extra fields ignored â†’ valid');

// --- Domain restrictions -----------------------------------------------------
// Presets may only drive the transport domains plus safe SYS commands.
// SYS:MODE would drop the board into legacy mode mid-run and wedge every
// following step into a host timeout.

const domainOk = validatePreset({
  name: 'domains',
  steps: [
    { label: 'uart', command: 'UART:INIT' },
    { label: 'spi', command: 'SPI:XFER:75FF' },
    { label: 'can', command: 'CANFD:SEND:130:DEADBEEF' },
    { label: 'i2c', command: 'I2C:SCAN' },
    { label: 'ping', command: 'SYS:PING' },
  ],
});
assert(domainOk.valid, 'all transport domains plus SYS:PING → valid');

const unknownDomain = validatePreset({
  name: 'bad',
  steps: [{ label: 'x', command: 'FOO:BAR' }],
});
assert(!unknownDomain.valid, 'unknown domain FOO → invalid');
assert(/domain/i.test(unknownDomain.error || ''), 'unknown domain error mentions domain');

const modeSwitch = validatePreset({
  name: 'bad',
  steps: [{ label: 'x', command: 'SYS:MODE:LEGACY' }],
});
assert(!modeSwitch.valid, 'SYS:MODE:LEGACY → invalid (mode switch mid-preset)');

const logDomain = validatePreset({
  name: 'bad',
  steps: [{ label: 'x', command: 'LOG:INFO:hello' }],
});
assert(!logDomain.valid, 'LOG is not a command domain → invalid');

// --- Step assertions (expect) --------------------------------------------

const expectOk = validatePreset({
  name: 'asserted',
  steps: [
    { label: 'Loop', command: 'UART:LOOP:41', expect: { status: 'PASS', payload: { rx: '41' } } },
    { label: 'Status', command: 'UART:STATUS', expect: { status: 'PASS' } },
    { label: 'Plain', command: 'UART:INIT' },
  ],
});
assert(expectOk.valid, 'steps with valid expect → valid');
assert(expectOk.preset.steps[0].expect.status === 'PASS', 'expect.status preserved');
assert(expectOk.preset.steps[0].expect.payload.rx === '41', 'expect.payload preserved');
assert(expectOk.preset.steps[2].expect === undefined, 'steps without expect stay bare');

const expectBadStatus = validatePreset({
  name: 'bad',
  steps: [{ label: 'x', command: 'UART:INIT', expect: { status: 'MAYBE' } }],
});
assert(!expectBadStatus.valid, 'unknown expect.status → invalid');
assert(/expect/i.test(expectBadStatus.error || ''), 'expect error message mentions expect');

const expectEmpty = validatePreset({
  name: 'bad',
  steps: [{ label: 'x', command: 'UART:INIT', expect: {} }],
});
assert(!expectEmpty.valid, 'empty expect object → invalid');

const expectWrongType = validatePreset({
  name: 'bad',
  steps: [{ label: 'x', command: 'UART:INIT', expect: 'PASS' }],
});
assert(!expectWrongType.valid, 'string expect → invalid');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
