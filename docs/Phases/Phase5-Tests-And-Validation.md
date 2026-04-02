# Phase 5 - Tests And Validation

**Parent document:** [OfficialRoadmap.md](C:/Users/aayus/Desktop/UBC%20Sailbot/polaris-debug-tools/docs/OfficialRoadmap.md)  
**Goal:** Harden the system with automated tests, transcript replays, and a hardware acceptance matrix so it is robust enough for sustained company use.

## Purpose

The earlier phases make the system work. Phase 5 makes it dependable.

This phase ensures:

- parser behavior is stable
- protocol formatting stays compliant
- command routing does not regress silently
- GUI behavior under normal and failure conditions is verified
- real hardware workflows are documented and repeatable

## Scope

### In Scope

- firmware-side host-compiled tests
- desktop parser and behavior tests
- transcript replay fixtures
- hardware acceptance matrix execution
- pass/fail documentation for each scenario

### Out Of Scope

- removal of legacy mode
- major product feature expansion

## Test Strategy Overview

Use three layers of validation:

1. pure logic tests
2. transcript replay tests
3. hardware acceptance tests

Each layer should catch different classes of regression.

## Detailed Task Breakdown

### Task 5.1: Add Firmware Host-Compiled Tests

Extend the existing C test strategy under [tests](C:/Users/aayus/Desktop/UBC%20Sailbot/polaris-debug-tools/tests).

New target areas:

- line accumulator
- frame parser
- argument tokenizer
- hex parser
- dispatcher routing
- formatter helpers
- `SYS:*` responses

Suggested new test files:

- `tests/test_protocol_accumulator.c`
- `tests/test_protocol_parser.c`
- `tests/test_cmd_dispatch.c`
- `tests/test_protocol_formatters.c`

### Task 5.2: Add Desktop Parser Tests

Add tests for the shared parser module.

Suggested files:

- `frontend/protocol-parser.test.js`

Cases to cover:

- `SYS:INFO`
- `LOG:INFO`
- `UART:PASS`
- `UART:DATA`
- `CANFD:FRAME`
- malformed lines
- ignored unknown keys

### Task 5.3: Add Desktop Behavior Tests

Add tests around `main.js` and renderer-facing behavior where feasible.

Key scenarios:

- handshake fixture parsing
- in-flight command rejection
- GUI timeout synthesis
- stream-event routing
- result-panel preservation during streaming
- cap gating logic

### Task 5.4: Build Transcript Replay Fixtures

Create fixture files representing real serial sessions.

Suggested transcript categories:

- handshake success
- handshake failure
- UART loopback
- SPI burst success
- CANFD send plus monitor
- I2C scan and read
- GUI-local timeout
- legacy mode enter/exit

### Task 5.5: Define And Execute Hardware Acceptance Matrix

Use the matrix from the roadmap as a living checklist.

For each scenario, document:

- setup wiring
- required board firmware version
- required GUI build
- exact commands or UI actions
- expected result
- actual result
- pass/fail
- notes

### Task 5.6: Verify Failure Paths Explicitly

Do not validate only happy paths.

Required failure-path tests:

- malformed command
- unsupported command
- missing cap
- disconnect mid-command
- local timeout
- firmware timeout
- bus-off / NACK / FIFO-full as applicable
- legacy mode trap recovery via `SYS:RESET`

### Task 5.7: Add Regression Guardrails

Add simple enforcement checks where possible:

- grep/CI check for forbidden `CAN:` references if protocol uses `CANFD`
- lint/test for parser file usage instead of duplicated regex parsing
- transcript test for handshake profile format

## File-Level Plan

### Existing Test Areas To Extend

- [tests](C:/Users/aayus/Desktop/UBC%20Sailbot/polaris-debug-tools/tests)
- existing frontend tests in [frontend](C:/Users/aayus/Desktop/UBC%20Sailbot/polaris-debug-tools/frontend)

### New Suggested Files

- `tests/test_protocol_accumulator.c`
- `tests/test_protocol_parser.c`
- `tests/test_cmd_dispatch.c`
- `tests/test_protocol_formatters.c`
- `frontend/protocol-parser.test.js`
- `frontend/transcript-replay.test.js`
- `frontend/guardrails.test.js`
- `docs/protocol/hardware-acceptance-matrix.md`
- `docs/protocol/transcripts/`

## Current Outputs

The following Phase 5 assets now exist in the repo:

- [protocol-parser.test.js](C:/Users/aayus/Desktop/UBC%20Sailbot/polaris-debug-tools/frontend/protocol-parser.test.js)
- [transcript-replay.test.js](C:/Users/aayus/Desktop/UBC%20Sailbot/polaris-debug-tools/frontend/transcript-replay.test.js)
- [guardrails.test.js](C:/Users/aayus/Desktop/UBC%20Sailbot/polaris-debug-tools/frontend/guardrails.test.js)
- [hardware-acceptance-matrix.md](C:/Users/aayus/Desktop/UBC%20Sailbot/polaris-debug-tools/docs/protocol/hardware-acceptance-matrix.md)
- [transcripts](C:/Users/aayus/Desktop/UBC%20Sailbot/polaris-debug-tools/docs/protocol/transcripts)

## Remaining Manual Work

The desktop-side automated coverage is in place, but these items still require
real hardware and/or a local C toolchain:

- host-compiled firmware protocol tests under [tests](C:/Users/aayus/Desktop/UBC%20Sailbot/polaris-debug-tools/tests)
- full hardware execution of the acceptance matrix
- capture of actual pass/fail notes, logs, and screenshots from the bench

## Verification Workflow

### Automated

1. run firmware host-compiled tests
2. run desktop parser and behavior tests
3. run transcript replay suite

### Manual Hardware

1. flash board firmware
2. connect real peripherals
3. execute matrix scenarios
4. capture logs, screenshots, and notes

## Exit Criteria

Phase 5 is complete only when:

- firmware protocol logic has host-compiled coverage
- desktop parser and key behavior paths are tested
- transcript fixtures exist and pass
- hardware acceptance matrix has been run and documented
