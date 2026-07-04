// frontend/charts.test.js
// Unit tests for CANFD chart layout helpers.

import { getCanfdFrameMeta, getCanfdGridSlotCount } from '../../frontend/charts.js';

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

const kvMeta = getCanfdFrameMeta('id=0x130;dlc=8');
const eventMeta = getCanfdFrameMeta('131:4:DEADBEEF');

assert(kvMeta && kvMeta.key === '0x130', 'key/value CANFD frame key parses');
assert(kvMeta && kvMeta.dlc === 8, 'key/value CANFD DLC parses');
assert(eventMeta && eventMeta.key === '0x131', 'event CANFD frame key parses');
assert(eventMeta && eventMeta.dlc === 4, 'event CANFD DLC parses');
assert(getCanfdFrameMeta('ready=1') === null, 'non-frame CANFD payload returns null');

assert(getCanfdGridSlotCount(0) === 0, 'zero CANFD frames yields zero grid slots');
assert(getCanfdGridSlotCount(1) === 1, 'single CANFD frame keeps one chart');
assert(getCanfdGridSlotCount(2) === 4, 'two CANFD frames reserve a 2x2 grid');
assert(getCanfdGridSlotCount(4) === 4, 'four CANFD frames fill the 2x2 grid');
assert(getCanfdGridSlotCount(5) === 5, 'five CANFD frames expand beyond the fixed grid');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
