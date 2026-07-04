// tests/electron/run-all.cjs
// Runs every *.test.mjs in this directory as a child process from the repo
// root (several tests resolve fixture paths relative to CWD). Exits non-zero
// if any test file fails.
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const testsDir = __dirname;
const repoRoot = path.resolve(testsDir, '..', '..');
const files = fs.readdirSync(testsDir).filter(f => f.endsWith('.test.mjs')).sort();

if (!files.length) {
  console.error('No *.test.mjs files found in tests/electron.');
  process.exit(1);
}

const failures = [];

for (const file of files) {
  console.log(`\n=== ${file} ===`);
  const result = spawnSync(process.execPath, [path.join(testsDir, file)], {
    stdio: 'inherit',
    cwd: repoRoot,
  });
  if (result.status !== 0) {
    failures.push(file);
  }
}

console.log('\n----------------------------------------');
if (failures.length) {
  console.error(`FAILED test files (${failures.length}/${files.length}): ${failures.join(', ')}`);
  process.exit(1);
}
console.log(`All ${files.length} electron test files passed.`);
