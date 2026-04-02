# Phase 0 - Freeze The Contract

**Parent document:** [OfficialRoadmap.md](C:/Users/aayus/Desktop/UBC%20Sailbot/polaris-debug-tools/docs/OfficialRoadmap.md)  
**Goal:** Freeze the serial protocol, parser contract, capability model, timeout ownership, and implementation boundaries before any major firmware or GUI refactor begins.

## Purpose

Phase 0 exists to stop protocol drift before code changes start. The current
codebase has a split brain:

- the Electron app assumes structured line-based command/response frames
- the STM32 firmware still largely behaves like a menu-driven byte bridge

This phase creates the authoritative specification that both sides will follow.
Nothing in later phases should invent protocol behavior ad hoc in code.

## Required Outputs

Produce all of the following before Phase 1 starts:

1. `docs/protocol/serial-protocol-v1.md`
2. a parser contract section describing parsed frame shapes
3. a canonical command catalog for `SYS`, `UART`, `SPI`, `CANFD`, and `I2C`
4. payload encoding rules with examples
5. a capability list with domain-level and feature-level meanings
6. a timeout ownership section that distinguishes GUI-local timeout from
   firmware-emitted `TIMEOUT`
7. a legacy mode contract including entry and exit behavior
8. a transport-agnostic glossary so team members use the same words

Generated artifacts:

- [serial-protocol-v1.md](/C:/Users/aayus/Desktop/UBC%20Sailbot/polaris-debug-tools/docs/protocol/serial-protocol-v1.md)
- [glossary.md](/C:/Users/aayus/Desktop/UBC%20Sailbot/polaris-debug-tools/docs/protocol/glossary.md)
- [phase0-gap-analysis.md](/C:/Users/aayus/Desktop/UBC%20Sailbot/polaris-debug-tools/docs/protocol/phase0-gap-analysis.md)
- [README.md](/C:/Users/aayus/Desktop/UBC%20Sailbot/polaris-debug-tools/docs/protocol/README.md)

## Scope

### In Scope

- wire protocol grammar
- frame size limits
- command-response model
- streaming-event model
- payload encoding rules
- error and timeout semantics
- capability discovery format
- board profile handshake format
- parser API shape for desktop code
- firmware line-accumulator requirements
- legacy mode constraints

### Out Of Scope

- low-level firmware implementation
- Electron IPC refactor
- sensor-specific UI design
- hardware debugging of CANFD or I2C timing
- removal of the legacy menu

## Definitions To Freeze

### Physical Topology

The architecture being specified is:

```text
laptop GUI
-> USB serial
-> STM32 board running DevBoard firmware
-> breakout / daughterboard
-> attached peripherals on UART / SPI / CANFD / I2C
```

The laptop does not talk to sensors directly. The STM32 owns all bus traffic.

### Frame Types

Freeze these five frame classes:

- command frames
- response frames
- event frames
- log frames
- system frames

Each class must have:

- exact grammar
- examples
- parser expectations
- failure behavior if malformed

### Limits

Freeze:

- `MAX_BINARY_PAYLOAD_BYTES`
- `MAX_LINE_CHARS`
- maximum number of parsed arguments per command
- maximum length of individual argument tokens
- behavior on overlong lines

### Case Rules

Freeze:

- uppercase domains and commands
- uppercase events and statuses
- lowercase payload keys
- uppercase hex payload values

### Forward Compatibility Rule

The spec must explicitly say:

- unknown payload keys are ignored
- unknown feature caps disable UI functionality but do not crash parsing
- unknown commands must return a defined failure path

## Detailed Task Breakdown

### Task 0.1: Extract Protocol Rules From Existing Code

Review the current implementation to document what already exists and what must
change.

Files to inspect:

- [main.js](C:/Users/aayus/Desktop/UBC%20Sailbot/polaris-debug-tools/main.js)
- [preload.js](C:/Users/aayus/Desktop/UBC%20Sailbot/polaris-debug-tools/preload.js)
- [frontend/protocols.js](C:/Users/aayus/Desktop/UBC%20Sailbot/polaris-debug-tools/frontend/protocols.js)
- [frontend/app.js](C:/Users/aayus/Desktop/UBC%20Sailbot/polaris-debug-tools/frontend/app.js)
- [DevBoard/Core/Src/dev.c](C:/Users/aayus/Desktop/UBC%20Sailbot/polaris-debug-tools/DevBoard/Core/Src/dev.c)
- [DevBoard/Core/Src/can.c](C:/Users/aayus/Desktop/UBC%20Sailbot/polaris-debug-tools/DevBoard/Core/Src/can.c)

Document:

- current command names
- current response naming mismatches
- existing structured frame assumptions
- existing legacy-mode assumptions
- any code paths that assume request-response only

### Task 0.2: Write The Canonical Protocol v1 Specification

Create `docs/protocol/serial-protocol-v1.md` with these sections:

1. purpose
2. physical system model
3. grammar
4. limits
5. payload rules
6. frame classes
7. command catalog
8. capability model
9. timeout ownership
10. direct-response versus streaming model
11. legacy mode
12. examples
13. compatibility expectations

Each command section must include:

- command syntax
- required caps
- success response
- failure response
- timeout response if applicable
- whether it is sync or streaming
- at least one realistic example

### Task 0.3: Freeze The Command Correlation Model

Write down the direct-response contract in exact terms:

- one in-flight command per board
- `main.js` owns in-flight tracking
- logs do not clear in-flight
- stream events do not clear in-flight
- first direct terminal response clears in-flight

Also define:

- how `INFO` is treated for `SYS:*`
- what happens if a malformed frame arrives while a command is in-flight
- what the GUI should display if a board disconnects mid-command

### Task 0.4: Freeze Timeout Semantics

Document the difference between:

- GUI-local timeout
- firmware-reported peripheral timeout

Specify:

- how both are labeled in IPC payloads
- how both are rendered in the GUI
- which one counts toward per-transport error metrics
- which one is included in logs

### Task 0.5: Freeze The Capability Model

Define:

- domain caps
- feature caps
- naming convention for future caps
- UI gating behavior when a cap is missing
- behavior when a domain cap exists but a feature cap does not

Create a table with:

- cap name
- scope
- affected commands
- affected UI surfaces

### Task 0.6: Freeze The Shared Parser Contract

This is a code-facing output, not just protocol prose.

Define the parser API that both desktop layers will rely on.

Recommended exported functions:

- `parseLine(raw)`
- `parseCapabilities(payload)`
- `isTerminalFrame(parsed)`
- `isStreamingEvent(parsed)`
- `isLog(parsed)`

Also lock the module plan:

- one CommonJS core implementation
- one thin ES module wrapper

### Task 0.7: Freeze Legacy Mode Behavior

Define exactly:

- how legacy mode is entered
- what protocol behavior is suspended while in legacy mode
- how `SYS:RESET` is detected even while legacy mode is active
- whether raw terminal commands remain allowed in GUI while legacy mode is active
- how the GUI should visually indicate legacy mode

### Task 0.8: Produce Example Transcripts

The spec should include several end-to-end transcripts:

1. board connect handshake
2. UART loopback
3. SPI burst read
4. I2C register read
5. CANFD monitor start and streamed frame
6. GUI-local timeout
7. firmware `TIMEOUT`
8. enter legacy mode, then exit with `SYS:RESET`

These transcripts will later become tests.

## Review Checklist

Before Phase 0 is marked complete, verify:

- every command in the roadmap appears in the v1 spec
- every example uses the frozen payload format
- no examples use spaces between key-value fields
- `CANFD` naming is consistent everywhere
- line-length limits are internally consistent
- timeout ownership is explained without ambiguity
- legacy-mode exit behavior is explicit
- another engineer can read the spec without reading existing code

## Exit Criteria

Phase 0 is complete only when all of the following are true:

- the v1 protocol spec exists
- the parser contract exists
- the capability table exists
- the command catalog is frozen
- example transcripts exist
- there are no unresolved protocol questions blocking implementation

Current status:

- all required artifacts have been created in `docs/protocol`
- the remaining Phase 0 work is document review and explicit sign-off, not new
  protocol invention
