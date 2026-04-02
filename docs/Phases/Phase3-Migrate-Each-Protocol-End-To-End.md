# Phase 3 - Migrate Each Protocol End-To-End

**Parent document:** [OfficialRoadmap.md](C:/Users/aayus/Desktop/UBC%20Sailbot/polaris-debug-tools/docs/OfficialRoadmap.md)  
**Goal:** Make every GUI command map to a real canonical wire command and a real peripheral interaction on the STM32-controlled hardware stack.

**Execution checklist:** [Phase3-ExecutionChecklist.md](C:/Users/aayus/Desktop/UBC%20Sailbot/polaris-debug-tools/docs/Phases/Phase3-ExecutionChecklist.md)

## Purpose

Phase 3 is where the system stops being a protocol shell and becomes a useful
tool. The board is already machine-controllable after Phase 2, but Phase 3 is
the phase where each transport is brought up with real hardware and the GUI
becomes meaningfully functional for the target use cases.

## Scope

### In Scope

- end-to-end implementation and hardware validation per transport
- GUI control wiring per transport
- structured results and stream events displayed correctly
- sensor/peripheral-specific validation scenarios

### Out Of Scope

- dual-board comparison logic
- long-term cleanup of legacy mode
- broad non-protocol UI redesign

## Execution Strategy

Implement transports in this order:

1. `SYS`
2. `UART`
3. `SPI`
4. `CANFD`
5. `I2C`

Why this order:

- `SYS` is already handshake-critical and low risk
- `UART` is simplest to validate
- `SPI` is deterministic and burst-based
- `CANFD` and `I2C` have more board/hardware sensitivity

## Detailed Work By Transport

### 3.1: `SYS`

Tasks:

- confirm board handshake is stable in GUI
- surface board profile in UI
- verify `SYS:MODE:LEGACY` path
- verify `SYS:RESET` exit path

Acceptance checks:

- connect -> GUI shows board identity and caps
- enter legacy mode from advanced UI
- exit legacy mode without power cycling

### 3.2: `UART`

Implementation tasks:

- wire `UART:LOOP` presets and raw form to renderer controls
- ensure result panel updates only on terminal response
- implement stream toggles in GUI
- stream unsolicited data to terminal and charts

Hardware verification tasks:

- loopback or bridged test byte path
- connect a streaming device like GPS or another UART source
- verify sustained `UART:DATA:*` flow

Validation cases:

- `UART:LOOP:41` -> `UART:PASS:rx=41`
- `UART:STREAM:START` -> `UART:PASS:streaming=1`
- multiple `UART:DATA:*` frames appear without result-panel churn
- `UART:STREAM:STOP` halts event flow

### 3.3: `SPI`

Implementation tasks:

- ensure GUI custom form accepts multi-byte hex strings
- validate even-length hex and max transfer size
- pass burst payload unchanged to firmware
- show TX and RX in structured result panel

Hardware verification tasks:

- connect a real SPI device
- test known register reads
- validate CS timing and same-length RX behavior

Validation cases:

- `SPI:XFER:75FF` -> expected `SPI:PASS:tx=75FF;rx=0068`
- malformed hex input rejected before send
- oversize input rejected cleanly

### 3.4: `CANFD`

Implementation tasks:

- wire `CANFD:SEND` controls in GUI
- add monitor start/stop controls
- render `CANFD:FRAME:*` events without interfering with command flow
- display status information from `CANFD:STATUS`

Hardware verification tasks:

- connect to real CANFD network or analyzer
- confirm sent frames appear externally
- confirm external traffic appears in monitor mode
- validate bus-off and FIFO-full error handling

Validation cases:

- `CANFD:SEND:<id>:<data>` returns derived DLC
- `CANFD:MONITOR:START` emits frame events
- `CANFD:STATUS` surfaces current error state

### 3.5: `I2C`

Implementation tasks:

- replace any remaining single-byte interaction UI
- add custom forms for scan, write, and read
- gate read/write controls by `I2C_READ_REG8`
- gate scan by `I2C_SCAN`

Hardware verification tasks:

- connect real sensor on breakout board
- validate `SCAN` finds the device
- validate `READ` returns expected register bytes
- validate `WRITE` can configure the device where applicable

Validation cases:

- `I2C:SCAN` includes known address
- `I2C:READ:<addr>:<reg>:<len>` returns expected bytes
- `I2C:WRITE:<addr>:<hex_bytes>` returns correct wrote length

## Cross-Transport Tasks

### Task 3.A: Remove Protocol Drift In Frontend Config

Ensure `frontend/protocols.js` reflects the actual wire commands and nothing
else. No placeholder commands should remain once a transport is migrated.

### Task 3.B: Keep Raw Manual Path Working

Even after structured controls work:

- raw command input must still exist
- terminal must still show logs and raw frames

### Task 3.C: Update UI Copy For Real Hardware Use

Descriptions should reflect actual hardware behavior, not scaffolding language.

## File-Level Plan

Likely files touched heavily during this phase:

- [frontend/protocols.js](C:/Users/aayus/Desktop/UBC%20Sailbot/polaris-debug-tools/frontend/protocols.js)
- [frontend/app.js](C:/Users/aayus/Desktop/UBC%20Sailbot/polaris-debug-tools/frontend/app.js)
- [frontend/visual.js](C:/Users/aayus/Desktop/UBC%20Sailbot/polaris-debug-tools/frontend/visual.js)
- [frontend/charts.js](C:/Users/aayus/Desktop/UBC%20Sailbot/polaris-debug-tools/frontend/charts.js)
- firmware transport handlers added in Phase 1

## Exit Criteria

Phase 3 is complete only when:

- each transport has at least one real hardware validation scenario
- every GUI control sends exactly one canonical command
- direct results and stream events behave correctly in the UI
- the old single-byte I2C interaction model is no longer part of the protocol UI
