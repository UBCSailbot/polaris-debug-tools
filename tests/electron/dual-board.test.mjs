import {
  computeSharedCaps,
  computeSharedProtocols,
  computeDualWarnings,
  getDualCommandDisabledReason,
  describeBoardProfile,
} from '../../frontend/dual-board.js';
import { PROTOCOLS } from '../../frontend/protocols.js';

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    failed++;
  } else {
    console.log('PASS:', msg);
    passed++;
  }
}

const profileA = {
  available: true,
  board: 'devboard',
  fw: '0.2.0',
  proto: 1,
  caps: ['UART', 'SPI', 'CANFD', 'UART_STREAM', 'CANFD_MONITOR'],
  legacy: true,
};

const profileB = {
  available: true,
  board: 'devboard',
  fw: '0.2.1',
  proto: 2,
  caps: ['UART', 'SPI', 'I2C', 'UART_STREAM'],
  legacy: false,
};

const sharedCaps = computeSharedCaps(profileA, profileB);
assert(sharedCaps.has('UART'), 'shared caps keeps UART');
assert(sharedCaps.has('SPI'), 'shared caps keeps SPI');
assert(!sharedCaps.has('CANFD'), 'shared caps removes protocol missing on one board');

const sharedProtocols = computeSharedProtocols(profileA, profileB);
assert(sharedProtocols.includes('UART'), 'shared protocols includes UART');
assert(sharedProtocols.includes('SPI'), 'shared protocols includes SPI');
assert(!sharedProtocols.includes('CANFD'), 'shared protocols excludes CANFD');

const warnings = computeDualWarnings(
  { connected: true, profile: profileA, mode: 'protocol', streaming: new Set(['UART']) },
  { connected: true, profile: profileB, mode: 'legacy', streaming: new Set() },
  'UART'
);
assert(warnings.some(w => w.includes('Protocol mismatch')), 'warnings include protocol mismatch');
assert(warnings.some(w => w.includes('Firmware mismatch')), 'warnings include firmware mismatch');
assert(warnings.some(w => w.includes('Capability mismatch')), 'warnings include capability mismatch');
assert(warnings.some(w => w.includes('legacy mode')), 'warnings include legacy mode warning');
assert(warnings.some(w => w.includes('Only board A is actively streaming UART data.')), 'warnings include stream mismatch');

const dualReason = getDualCommandDisabledReason(
  'CANFD',
  PROTOCOLS.CANFD.commands[1],
  { connected: true, profile: profileA, mode: 'protocol' },
  { connected: true, profile: profileB, mode: 'protocol' }
);
assert(dualReason.includes('Protocol is not supported by both connected boards.'), 'shared command reason blocks unsupported protocol');

const describeUnavailable = describeBoardProfile({ available: false, reason: 'handshake-timeout' }, true);
assert(describeUnavailable.summary === 'Handshake unavailable', 'unavailable profile summary is descriptive');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
