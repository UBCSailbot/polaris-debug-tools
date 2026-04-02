# Phase 2 - GUI Handshake, Shared Parser, and Adaptation

**Parent document:** [OfficialRoadmap.md](C:/Users/aayus/Desktop/UBC%20Sailbot/polaris-debug-tools/docs/OfficialRoadmap.md)  
**Goal:** Make the Electron app connect to the STM32 as a protocol-controlled bridge board, parse frames through one shared parser, and adapt the UI to firmware-reported capabilities.

## Purpose

Phase 2 makes the desktop side protocol-aware. After this phase, the GUI should
stop acting like a generic serial terminal with assumptions and start behaving
like a structured client for the STM32 board.

At the end of this phase:

- the main process handshakes on connect
- one parser implementation is used across desktop layers
- the GUI understands board profile and capabilities
- unsupported protocols/features are visibly gated
- stream events are handled separately from direct command results

## Scope

### In Scope

- shared parser implementation
- board-profile handshake
- in-flight command enforcement in `main.js`
- GUI-local timeout synthesis
- IPC events for board profile and stream events
- capability-gated UI behavior

### Out Of Scope

- full transport hardware verification
- major frontend visual redesign
- legacy menu removal

## Desktop Architecture To Implement

### Main Process Responsibilities

[main.js](C:/Users/aayus/Desktop/UBC%20Sailbot/polaris-debug-tools/main.js) should become responsible for:

- serial connection management
- handshake on connect
- line parsing through shared parser
- in-flight command tracking
- timeout timer ownership
- routing parsed frames to the renderer

### Renderer Responsibilities

[frontend/app.js](C:/Users/aayus/Desktop/UBC%20Sailbot/polaris-debug-tools/frontend/app.js) should become responsible for:

- rendering board profile information
- gating protocols and commands by capabilities
- displaying direct command results
- rendering stream events in terminal/charts

### Shared Parser Responsibilities

The parser module should own:

- raw frame classification
- token extraction
- payload parsing helpers
- stream-event recognition
- direct terminal-frame recognition
- capability-string parsing

## Detailed Task Breakdown

### Task 2.1: Create The Shared Parser Core

Add:

- `frontend/protocol-parser.cjs`
- `frontend/protocol-parser.js`

Design:

- `protocol-parser.cjs` contains the actual implementation
- `protocol-parser.js` re-exports it for the renderer

Required exports:

- `parseLine(raw)`
- `parseCapabilities(payload)`
- `isTerminalFrame(parsed)`
- `isStreamingEvent(parsed)`
- `isLog(parsed)`

### Task 2.2: Migrate Main-Process Parsing To The Shared Parser

Refactor [main.js](C:/Users/aayus/Desktop/UBC%20Sailbot/polaris-debug-tools/main.js):

- remove duplicated protocol regex assumptions
- require the shared parser
- parse every incoming line once in the main process

For each parsed frame:

- if log -> forward to renderer terminal/log channel
- if streaming event -> forward to dedicated stream-event channel
- if direct terminal frame -> clear `inFlight` if it matches active command
- if handshake info -> store board profile and notify renderer

### Task 2.3: Add Board-Profile Handshake On Connect

On serial connect:

1. open serial port
2. send `SYS:HELLO`
3. wait for `SYS:INFO:*`
4. parse `proto`, `fw`, `board`, `caps`, `legacy`
5. store board profile in connection state
6. emit `serial:board-profile` to renderer

Connection state in `main.js` should now include:

- `connected`
- `portPath`
- `baudRate`
- `boardProfile`
- `inFlight`
- `activeCommand`
- `commandTimeoutHandle`
- `streamingState` if needed later

### Task 2.4: Enforce One In-Flight Command Per Connection

When the renderer asks to send a command:

- reject if `inFlight` is already true
- set `inFlight = true`
- record active command metadata
- start timeout timer
- write command to serial

When a direct terminal response arrives:

- clear timeout timer
- clear `inFlight`
- clear active command metadata
- forward parsed response to renderer

When timeout timer fires:

- clear `inFlight`
- synthesize local timeout payload
- emit distinct IPC event or a tagged response object

### Task 2.5: Distinguish Direct Results From Streaming Events

Add a dedicated IPC channel for stream events, for example:

- `serial:stream-event`

Keep direct command results on the main result path, for example:

- `serial:data`

Keep logs separate if helpful, for example:

- `serial:log`

### Task 2.6: Update Preload API Surface

Modify [preload.js](C:/Users/aayus/Desktop/UBC%20Sailbot/polaris-debug-tools/preload.js) to expose:

- board-profile subscription
- stream-event subscription
- any timeout distinction the renderer needs

Suggested additions:

- `onBoardProfile(cb)`
- `onStreamEvent(cb)`
- `onLog(cb)` if splitting log traffic

### Task 2.7: Update Renderer Protocol Config

Refactor [frontend/protocols.js](C:/Users/aayus/Desktop/UBC%20Sailbot/polaris-debug-tools/frontend/protocols.js):

- update all commands to canonical names
- normalize `CANFD`
- add required feature-cap tags to commands
- change I2C commands to the v1 grammar
- change SPI transfer commands to accept multi-byte payloads
- add stream controls for UART and monitor controls for CANFD

Recommended command metadata fields:

- `label`
- `command`
- `custom`
- `fields`
- `desc`
- `requiredCap`
- `mode`

### Task 2.8: Adapt The Renderer To Board Profile

Modify [frontend/app.js](C:/Users/aayus/Desktop/UBC%20Sailbot/polaris-debug-tools/frontend/app.js):

- listen for board profile updates
- store profile in state
- enable only supported protocol rows
- disable individual buttons lacking required feature caps
- surface board firmware version and board type in UI

### Task 2.9: Route Stream Events To The Right UI Surfaces

Renderer behavior should be:

- `UART:DATA` -> terminal, stream-specific metrics, optional charts
- `CANFD:FRAME` -> terminal, CAN chart, monitor views
- do not overwrite result panel on stream events
- do not change retry button state on stream events

### Task 2.10: Label GUI Timeout Separately From Firmware Timeout

In renderer code:

- firmware `TIMEOUT` should look like a normal protocol result
- GUI-local timeout should be labeled as local transport/control timeout

Suggested display distinction:

- firmware timeout badge: `TIMEOUT`
- local timeout label: `LOCAL TIMEOUT` or `HOST TIMEOUT`

## File-Level Plan

### Add New Files

- `frontend/protocol-parser.cjs`
- `frontend/protocol-parser.js`

### Update Existing Files

- [main.js](C:/Users/aayus/Desktop/UBC%20Sailbot/polaris-debug-tools/main.js)
- [preload.js](C:/Users/aayus/Desktop/UBC%20Sailbot/polaris-debug-tools/preload.js)
- [frontend/protocols.js](C:/Users/aayus/Desktop/UBC%20Sailbot/polaris-debug-tools/frontend/protocols.js)
- [frontend/app.js](C:/Users/aayus/Desktop/UBC%20Sailbot/polaris-debug-tools/frontend/app.js)
- possibly [frontend/visual.js](C:/Users/aayus/Desktop/UBC%20Sailbot/polaris-debug-tools/frontend/visual.js)
- possibly [frontend/charts.js](C:/Users/aayus/Desktop/UBC%20Sailbot/polaris-debug-tools/frontend/charts.js)

## Verification Plan

### Handshake Verification

Use a board or mocked serial transcript:

1. connect
2. observe `SYS:HELLO` sent
3. observe `SYS:INFO:*` parsed
4. observe board profile available in renderer

### In-Flight Enforcement Verification

1. send one command
2. attempt second send immediately
3. confirm second send is rejected locally
4. confirm first response clears `inFlight`

### Stream Routing Verification

Inject:

- `UART:DATA:*`
- `CANFD:FRAME:*`

Confirm:

- terminal updates
- charts update
- result panel remains unchanged
- `inFlight` remains untouched

## Exit Criteria

Phase 2 is complete only when:

- one parser implementation is used across desktop layers
- board profile is available after connect
- protocol and feature caps visibly gate UI controls
- one in-flight command rule is enforced by `main.js`
- stream events are separated from direct command results
