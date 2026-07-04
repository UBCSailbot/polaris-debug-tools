import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  parseLine,
  parseCapabilities,
  isTerminalFrame,
  isStreamingEvent,
  isLog,
} = require('../../frontend/protocol-parser.cjs');

const fixturesDir = path.resolve('docs', 'protocol', 'transcripts');
const fixtureFiles = fs.readdirSync(fixturesDir).filter(name => name.endsWith('.json')).sort();

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

function replayFixture(fixture) {
  const summary = {
    terminalFrames: 0,
    streamEvents: 0,
    logFrames: 0,
    localTimeouts: 0,
    profile: null,
    mode: 'protocol',
  };

  for (const step of fixture.steps) {
    if (step.dir === 'local-timeout') {
      summary.localTimeouts += 1;
      continue;
    }

    if (step.dir !== 'rx') {
      continue;
    }

    const parsed = parseLine(step.raw);
    if (!parsed) {
      throw new Error(`Fixture ${fixture.name} contains an unparsable rx line: ${step.raw}`);
    }

    if (isLog(parsed)) {
      summary.logFrames += 1;
      continue;
    }

    if (parsed.domain === 'SYS' && parsed.type === 'INFO') {
      const profile = parseCapabilities(parsed.payload);
      if (
        profile.proto != null ||
        profile.fw != null ||
        profile.board != null ||
        profile.caps.length > 0 ||
        profile.legacy != null
      ) {
        summary.profile = {
          available: true,
          ...profile,
        };
      }
      if (parsed.payload.includes('mode=legacy')) {
        summary.mode = 'legacy';
      } else if (parsed.payload.includes('mode=protocol') || parsed.payload.includes('proto=')) {
        summary.mode = 'protocol';
      }
    }

    if (isStreamingEvent(parsed)) {
      summary.streamEvents += 1;
      continue;
    }

    if (isTerminalFrame(parsed)) {
      summary.terminalFrames += 1;
    }
  }

  return summary;
}

for (const file of fixtureFiles) {
  const fixture = JSON.parse(fs.readFileSync(path.join(fixturesDir, file), 'utf8'));
  const summary = replayFixture(fixture);
  const expect = fixture.expect;

  assert(summary.terminalFrames === expect.terminalFrames, `${fixture.name}: terminal frame count matches`);
  assert(summary.streamEvents === expect.streamEvents, `${fixture.name}: stream event count matches`);
  assert(summary.logFrames === expect.logFrames, `${fixture.name}: log frame count matches`);
  assert(summary.localTimeouts === expect.localTimeouts, `${fixture.name}: local timeout count matches`);
  assert(summary.mode === expect.mode, `${fixture.name}: final mode matches`);

  if (expect.profile === null) {
    assert(summary.profile === null, `${fixture.name}: profile remains unavailable`);
    continue;
  }

  assert(summary.profile !== null, `${fixture.name}: profile becomes available`);
  if (summary.profile !== null) {
    assert(summary.profile.proto === expect.profile.proto, `${fixture.name}: profile proto matches`);
    assert(summary.profile.fw === expect.profile.fw, `${fixture.name}: profile fw matches`);
    assert(summary.profile.board === expect.profile.board, `${fixture.name}: profile board matches`);
    assert(summary.profile.legacy === expect.profile.legacy, `${fixture.name}: profile legacy matches`);
    for (const cap of expect.profile.capsIncludes) {
      assert(summary.profile.caps.includes(cap), `${fixture.name}: profile includes cap ${cap}`);
    }
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
