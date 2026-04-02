import fs from 'node:fs';
import path from 'node:path';

const runtimeFiles = [
  'main.js',
  'preload.js',
  'frontend/app.js',
  'frontend/charts.js',
  'frontend/dual-board.js',
  'frontend/protocol-parser.cjs',
  'frontend/protocol-parser.js',
  'frontend/protocols.js',
  'frontend/visual.js',
];

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

for (const relPath of runtimeFiles) {
  const absPath = path.resolve(relPath);
  const source = fs.readFileSync(absPath, 'utf8');

  assert(!source.includes('CAN:'), `${relPath}: runtime code does not use deprecated CAN: command prefix`);
}

const mainSource = fs.readFileSync(path.resolve('main.js'), 'utf8');
const preloadSource = fs.readFileSync(path.resolve('preload.js'), 'utf8');
const appSource = fs.readFileSync(path.resolve('frontend', 'app.js'), 'utf8');

assert(mainSource.includes("require('./frontend/protocol-parser.cjs')"), 'main.js uses shared protocol parser module');
assert(!preloadSource.includes("require('./frontend/protocol-parser.cjs')"), 'preload.js does not depend on renderer parser implementation');
assert(appSource.includes("import { parseLine, parseKeyValuePayload, isLog, isStreamingEvent } from './protocol-parser.js';"), 'app.js uses renderer parser bridge');
assert(!/UART\|SPI\|CANFD\|I2C/.test(mainSource), 'main.js no longer duplicates protocol domain regexes');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
