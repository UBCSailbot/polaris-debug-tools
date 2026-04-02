# Polaris Debug Tools - Official Protocol Roadmap

**Date:** 2026-03-31  
**Status:** Active

---

## Goal

Any sensor or peripheral attached to the NUCLEO-U575ZI-Q can be read and its
communication tested from the Electron GUI without manual serial interaction.

---

## Physical System Model

This roadmap assumes a specific hardware and control topology. The protocol and
software architecture are designed around this topology and not around direct
laptop-to-sensor access.

### Hardware Stack

One test stack consists of:

1. a laptop running the Electron GUI
2. a NUCLEO-U575ZI-Q flashed with the `DevBoard` firmware
3. a breakout board or daughterboard mounted on or wired to that STM32 board
4. one or more peripherals or sensors attached to that breakout board

### Control Path

The control path is:

```text
Electron GUI on laptop
-> serial link over USB
-> STM32 running DevBoard firmware
-> peripheral bus transaction on UART / SPI / CANFD / I2C
-> attached device on breakout board
-> structured response or streamed event back up the same serial link
-> GUI
```

### Authority Boundaries

The roadmap assumes the following ownership model:

- the laptop GUI does not talk to sensors directly
- the GUI talks only to the STM32 firmware over a serial connection
- the STM32 firmware owns all low-level bus transactions
- the STM32 acts as the bridge/controller between the laptop and the attached
  peripherals
- any sensor reads, bus scans, register writes, passive monitoring, or stream
  forwarding originate on the STM32 and are surfaced to the GUI as protocol
  frames

### Serial Link Assumption

The USB connection between laptop and board exposes exactly one control-plane
serial channel to the GUI, whether that is provided by ST-LINK VCP, USB CDC, or
an equivalent serial device. The roadmap assumes the GUI controls the system
through this single serial protocol channel.

### Single-Board and Dual-Board Meaning

In single-board mode, one laptop controls one STM32-plus-breakout stack.

In dual-board mode, one laptop controls two independent STM32-plus-breakout
stacks at the same time through two separate serial ports. The GUI compares
their reported protocol versions, capabilities, and device responses, but each
STM32 still independently owns its own attached hardware.

### Scope Clarification

This roadmap is for a "board as smart bridge" architecture.

It is not assuming:

- sensors plugged directly into the laptop
- the GUI bit-banging buses itself
- a passive USB-to-I2C or USB-to-SPI dongle model
- a breakout board that is controlled without STM32 firmware involvement

If the hardware architecture changes later, for example to a custom USB bridge
board or a multi-drop backplane, the protocol may still be reusable, but this
roadmap is written for the STM32-controlled topology above.

---

## Core Insight: Two Modes, Not One

The original plan conflated two distinct use cases that require different
protocol models.

**Test mode** - verify a bus is alive.  
One command -> one structured result. Good for bringup and regression checks.  
Example: `SPI:XFER:A5FF` -> `SPI:PASS:tx=A5FF;rx=0068`

**Sensor mode** - actually read a device.  
Either a register-addressed read/write that returns N bytes, or a continuous
stream of unsolicited frames forwarded from the peripheral. Single-byte
request/response cannot do this.

The protocol spec must define both modes explicitly. Every transport (`UART`,
`SPI`, `CANFD`, `I2C`) needs to declare which model it uses and when.

---

## Protocol Spec

This spec is frozen before Phase 1 implementation begins.

### Frame Format

All frames are newline-delimited ASCII (`\r\n`).

Two limits are defined separately and must not be conflated:

- `MAX_BINARY_PAYLOAD_BYTES = 256`
- `MAX_LINE_CHARS = 640`

`MAX_BINARY_PAYLOAD_BYTES` is the maximum raw binary payload represented in a
single frame. `MAX_LINE_CHARS` is the total maximum line length including
domain, command/status/event tokens, separators, keys, and encoded payload.

```
Command:   <DOMAIN>:<COMMAND>[:<arg1>[:<arg2>...]]
Response:  <DOMAIN>:<STATUS>:<payload>
Event:     <DOMAIN>:<EVENT>:<payload>    (unsolicited; streaming contexts only)
Log:       LOG:<LEVEL>:<message>
System:    SYS:<TYPE>:<payload>
```

### Status Codes

Four codes only. `ERR` is removed; internal error detail goes in `LOG:ERROR:*`.

| Code      | Meaning                                                       |
|-----------|---------------------------------------------------------------|
| `PASS`    | Command succeeded                                             |
| `FAIL`    | Command failed; reason in payload as `reason=<keyword>`       |
| `TIMEOUT` | Peripheral did not respond within its deadline (firmware-set) |
| `INFO`    | Informational response (`SYS:*` only)                         |

`FAIL` is for known, handleable failures like NACK, bus-off, bad argument, or
not initialized.

`TIMEOUT` is emitted by firmware only when the peripheral itself genuinely
timed out, for example when a HAL operation returns `HAL_TIMEOUT`.

The GUI synthesizes its own timeout if no terminal frame arrives within its own
deadline. That is a separate timeout path and must not be conflated with
firmware-emitted `TIMEOUT`.

### Payload Encoding Rules

These rules are frozen. Parsers must follow them exactly. Unknown keys must be
silently ignored to allow forward compatibility.

- Data bytes are expressed as uppercase hex pairs with no spaces or separators:
  `A102B300C501`
- Key-value payloads use semicolons as separators and equals signs for
  assignment: `proto=1;fw=0.2.0;caps=UART,SPI`
- Capability lists use commas:
  `caps=UART,SPI,CANFD,I2C,UART_STREAM`
- Unknown keys in any payload must be silently ignored by the receiver
- `reason=` values are lowercase keywords:
  `reason=nack`, `reason=bus-off`, `reason=bad-arg`, `reason=not-init`

Key casing is frozen as:

- Domains, commands, statuses, and events: uppercase
- Payload keys: lowercase

### Command/Response Correlation

**One in-flight command per board at a time.**

A command is in-flight from the moment it is written to the serial port until
the first direct terminal response frame is received for that command.

Direct terminal response frames are:

- `PASS`
- `FAIL`
- `TIMEOUT`
- `INFO`

Streaming events like `UART:DATA:*` and `CANFD:FRAME:*` may interleave at any
time. `LOG:*` frames may also interleave. Neither streaming events nor logs
clear `inFlight`.

The GUI enforces this by disabling the send path while a command is
outstanding. `main.js` tracks `inFlight: boolean` per connection, sets it on
send, clears it only on receipt of the first direct terminal frame for the
active command, and rejects any send attempt while `inFlight` is set.

### Timeout Ownership

- `main.js` owns "no terminal frame received within `CMD_TIMEOUT_MS`"
- Firmware owns genuine peripheral-level timeout reporting

GUI timeout behavior:

- `main.js` starts a deadline timer for each command
- Suggested default: `CMD_TIMEOUT_MS = 2000`
- If no direct terminal frame arrives in time, `main.js` clears `inFlight`,
  synthesizes a **local timeout**, and surfaces it to the renderer

Firmware timeout behavior:

- Firmware emits `TIMEOUT` only when a peripheral operation itself times out
- Firmware does not use `TIMEOUT` as a generic catch-all

UI contract:

- GUI-synthesized timeout must be labeled distinctly, for example
  `source=gui;reason=no-terminal-frame`
- Firmware-emitted timeout must remain a normal protocol frame

### System Commands

```
SYS:HELLO
-> SYS:INFO:proto=1;fw=<semver>;board=devboard;caps=UART,SPI,CANFD,I2C,UART_STREAM,CANFD_MONITOR,I2C_SCAN,I2C_READ_REG8;legacy=1

SYS:CAPS
-> SYS:INFO:caps=UART,SPI,CANFD,I2C,UART_STREAM,CANFD_MONITOR,I2C_SCAN,I2C_READ_REG8

SYS:PING
-> SYS:INFO:pong=1

SYS:MODE:LEGACY
-> SYS:INFO:mode=legacy

SYS:RESET
-> SYS:INFO:mode=protocol
```

Legacy mode exit rules:

- Firmware in legacy mode must continue scanning for `SYS:RESET\r\n` on USART1
- Receiving `SYS:RESET` exits the menu and restarts the protocol dispatcher
  without requiring a hardware reset
- Hardware reset remains a fallback
- There is no automatic timeout back to protocol mode

### Capability Discovery

Capabilities are reported at two levels:

- domain-level caps gate sidebar entries
- feature-level caps gate individual commands within a domain

Domain caps:

- `UART`
- `SPI`
- `CANFD`
- `I2C`

Feature caps:

- `UART_STREAM` -> `UART:STREAM:START/STOP`
- `CANFD_MONITOR` -> `CANFD:MONITOR:START/STOP`
- `I2C_SCAN` -> `I2C:SCAN`
- `I2C_READ_REG8` -> `I2C:READ` and register-style `I2C:WRITE`

If a feature cap is absent, its control is shown disabled with an explanatory
tooltip. This decouples feature support from protocol version bumps.

### UART Commands

```
UART:INIT
-> UART:PASS:ready=1

UART:LOOP:<hex_byte>
-> UART:PASS:rx=<hex_byte>
or UART:FAIL:reason=no-echo

UART:STREAM:START
-> UART:PASS:streaming=1
   [unsolicited: UART:DATA:<hex_bytes> ...]

UART:STREAM:STOP
-> UART:PASS:streaming=0

UART:STATUS
-> UART:PASS:rx=<count>;tx=<count>;errors=<count>
```

### SPI Commands

```
SPI:INIT
-> SPI:PASS:ready=1

SPI:XFER:<tx_hex_bytes>
-> SPI:PASS:tx=<tx_hex_bytes>;rx=<rx_hex_bytes>

SPI:STATUS
-> SPI:PASS:transfers=<count>
```

Example:

```
SPI:XFER:75FF
SPI:PASS:tx=75FF;rx=0068
```

### CANFD Commands

DLC is derived by firmware from the length of `<data_hex>`. The caller never
specifies DLC explicitly.

Firmware maps payload byte count to valid CAN FD DLC encoding. If padding is
required for a larger DLC bucket, firmware pads with zero bytes and reports the
derived DLC in the response.

```
CANFD:INIT
-> CANFD:PASS:ready=1

CANFD:SEND:<id_hex>:<data_hex>
-> CANFD:PASS:id=0x<id_hex>;dlc=<derived_dlc>
or CANFD:FAIL:reason=bus-off
or CANFD:FAIL:reason=fifo-full

CANFD:MONITOR:START
-> CANFD:PASS:monitoring=1
   [unsolicited: CANFD:FRAME:<id_hex>:<dlc_dec>:<data_hex> ...]

CANFD:MONITOR:STOP
-> CANFD:PASS:monitoring=0

CANFD:STATUS
-> CANFD:PASS:psr=0x<hex>;lec=<keyword>;bo=<0|1>;ep=<0|1>
```

### I2C Commands

`I2C:READ` and `I2C:WRITE` use 8-bit register addressing in v1. This covers the
majority of embedded sensors and keeps the v1 contract narrow and implementable.

For devices with 16-bit register addresses or custom write-then-read sequences,
future protocol versions may add:

```
I2C:TXRX:<addr_hex>:<write_hex>:<read_len_dec>
```

That command is explicitly out of scope for v1.

```
I2C:INIT
-> I2C:PASS:ready=1

I2C:SCAN
-> I2C:PASS:found=<addr1_hex>,<addr2_hex>,...
or I2C:PASS:found=

I2C:WRITE:<addr_hex>:<hex_bytes>
-> I2C:PASS:addr=0x<addr_hex>;wrote=<len_dec>
or I2C:FAIL:reason=nack
or I2C:TIMEOUT:addr=0x<addr_hex>

I2C:READ:<addr_hex>:<reg_hex>:<len_dec>
-> I2C:PASS:addr=0x<addr_hex>;reg=0x<reg_hex>;bytes=<hex_bytes>
or I2C:FAIL:reason=nack
or I2C:TIMEOUT:addr=0x<addr_hex>

I2C:STATUS
-> I2C:PASS:last_addr=0x<hex>;errors=<count>
```

Example:

```
I2C:READ:6A:28:6
I2C:PASS:addr=0x6A;reg=0x28;bytes=A102B300C501
```

### Log Events

`LOG:*` frames are informational only. They never change GUI state.

```
LOG:INFO:<message>
LOG:WARN:<message>
LOG:ERROR:<message>
```

Firmware-side failures that previously might have become `ERR` status codes now
emit a `LOG:ERROR:` line and then return `FAIL` with an appropriate
`reason=<keyword>`.

---

## Response Model: Synchronous vs Asynchronous

Every command uses exactly one of two models. Mixing models inside a single
command is forbidden.

| Transport | Sync commands                      | Streaming commands                 |
|-----------|------------------------------------|------------------------------------|
| SYS       | HELLO, CAPS, PING, MODE, RESET     | -                                  |
| UART      | INIT, LOOP, STREAM:STOP, STATUS    | STREAM:START -> DATA events        |
| SPI       | INIT, XFER, STATUS                 | -                                  |
| CANFD     | INIT, SEND, MONITOR:STOP, STATUS   | MONITOR:START -> FRAME events      |
| I2C       | INIT, SCAN, WRITE, READ, STATUS    | -                                  |

Streaming commands return one sync terminal frame and then emit unsolicited
events until the matching `STOP` command is received.

---

## Revised Phase Plan

### Phase 0: Freeze the Contract (1-3 days)

**Goal:** No ambiguity remains before implementation starts.

Deliverables:

- `docs/protocol/serial-protocol-v1.md`
- parser API contract
- command list frozen for v1

Phase 0 closure checklist:

- [x] Multi-byte I2C read/write grammar frozen
- [x] I2C explicitly labeled as 8-bit register model in v1
- [x] SPI burst format frozen
- [x] UART streaming model frozen
- [x] CANFD passive monitoring frozen
- [x] CANFD DLC derivation frozen
- [x] One in-flight command model frozen
- [x] Timeout ownership frozen
- [x] Status code set frozen
- [x] Payload encoding frozen
- [x] Separate binary-payload and line-length limits frozen
- [x] Capability granularity frozen
- [x] Legacy mode exit frozen
- [x] Shared parser strategy frozen

**Shared parser module decision**

The Electron main process is currently CommonJS while the renderer uses ES
modules. To avoid drift without forcing an unnecessary repo-wide module
migration, Phase 0 adopts this parser-sharing approach:

- Core parser implementation lives in a CommonJS module:
  `frontend/protocol-parser.cjs`
- Renderer imports a thin ES module wrapper:
  `frontend/protocol-parser.js`
- `main.js` requires the CommonJS module directly

This keeps one parser implementation while avoiding module-system churn during
the protocol migration.

Acceptance criteria:

- Another engineer can implement firmware or GUI from the spec alone

### Phase 1: Add Protocol Layer to Firmware (3-5 days)

**Goal:** Board is machine-controllable via structured commands.

**Non-trivial design task: line accumulator**

The existing `dev.c` processes one byte at a time from `rb_u1_rx`. The protocol
layer needs a non-blocking line accumulator state machine in `Dev_Poll()` that:

- buffers bytes until `\r\n`
- rejects overlong lines safely
- ignores malformed partial input without blocking
- never touches ISR context

**New firmware files**

```
DevBoard/Core/Inc/protocol.h
DevBoard/Core/Src/protocol.c
DevBoard/Core/Inc/cmd_dispatch.h
DevBoard/Core/Src/cmd_dispatch.c
DevBoard/Core/Src/proto_sys.c
DevBoard/Core/Src/proto_uart.c
DevBoard/Core/Src/proto_spi.c
DevBoard/Core/Src/proto_canfd.c
DevBoard/Core/Src/proto_i2c.c
```

**What stays unchanged**

- `dev.c` ring-buffer and ISR plumbing
- `can.c` low-level CAN TX/RX
- legacy menu internals, temporarily

**What changes**

- firmware boots in protocol mode by default
- no menu printed at boot
- `Dev_Poll()` feeds the line accumulator and dispatches completed lines
- hardcoded I2C address assumptions are removed from the protocol path
- all bus activity visible in the GUI now originates from commands or streaming
  behavior implemented on the STM32 side, not from any direct host-side bus
  control

**Implementation order**

1. line accumulator + response/log emitters
2. `SYS:HELLO`, `SYS:CAPS`, `SYS:PING`, `SYS:RESET`
3. `UART:INIT`, `UART:LOOP`, `UART:STATUS`
4. `SPI:INIT`, `SPI:XFER`, `SPI:STATUS`
5. `CANFD:INIT`, `CANFD:SEND`, `CANFD:STATUS`, `CANFD:MONITOR:START/STOP`
6. `I2C:INIT`, `I2C:SCAN`, `I2C:WRITE`, `I2C:READ`, `I2C:STATUS`
7. `UART:STREAM:START/STOP`
8. `SYS:MODE:LEGACY`

Acceptance criteria:

- `SYS:HELLO` returns structured `SYS:INFO:*`
- no menu interaction is required for any protocol command
- `SPI:XFER:75FF` returns two RX bytes from hardware
- `I2C:READ:6A:28:6` returns 6 bytes from a connected sensor

### Phase 2: GUI Handshake, Shared Parser, and Adaptation (2-3 days)

**Goal:** GUI self-configures from firmware capabilities on connect and both
desktop layers use one parser implementation.

This phase assumes the GUI is connecting to the STM32 board's control serial
port, not to the peripheral directly. The board profile shown in the GUI is the
firmware-reported identity of the flashed STM32 bridge board.

**New parser files**

```
frontend/protocol-parser.cjs
frontend/protocol-parser.js
```

Exports:

- `parseLine(raw)`
- `parseCapabilities(infoPayload)`
- `isStreamingEvent(parsed)`
- `isTerminalFrame(parsed)`
- `isLog(parsed)`

**Changes to `main.js`**

- require the shared parser
- on connect, send `SYS:HELLO`
- parse board profile from `SYS:INFO:*`
- expose board profile to renderer via `serial:board-profile`
- track `inFlight` per connection
- enforce one command at a time
- own GUI-side timeout timer
- route streaming events through a dedicated IPC channel

**Changes to `frontend/protocols.js`**

- update commands to canonical v1 wire grammar
- normalize to `CANFD:*` everywhere
- add feature-cap requirements per command

**Changes to `frontend/app.js`**

- listen for `serial:board-profile`
- gate protocols and buttons by capability set
- show board type and firmware version in UI
- route stream events to terminal/charts only
- keep result panel bound only to direct terminal command responses

Acceptance criteria:

- connect a board and the GUI enables only supported protocols/features
- firmware version is visible
- stream events never clear `inFlight`

### Phase 3: Migrate Each Protocol End-to-End (3-6 days)

**Goal:** Every GUI action maps to exactly one canonical command.

Implementation order:

1. `SYS`
2. `UART`
3. `SPI`
4. `CANFD`
5. `I2C`

Acceptance criterion per transport:

- connect a real peripheral
- click the corresponding GUI control
- observe correct structured output in terminal, result panel, and charting

Important note:

- `I2C:INIT` remains a valid command
- only the earlier single-byte I2C interaction model is being removed

### Phase 4: Dual-Board Mode (1-2 days)

**Goal:** Dual-board view compares protocol peers, not arbitrary serial
terminals.

Tasks:

- handshake each board independently
- compute capability intersection
- limit dual-board commands to safe shared subset
- surface protocol-version and capability mismatches explicitly
- preserve independent per-board ownership of attached breakout hardware and
  never assume one board can observe or control the other's buses

Acceptance criteria:

- same command runs safely on both boards
- mismatches are shown as warnings rather than causing silent failure

### Phase 5: Tests (2-4 days)

**Firmware-side tests**

- line accumulator edge cases
- parser validity cases
- unknown domain/command handling
- formatter compliance
- transcript replay tests

**Desktop-side tests**

- parser tests for all frame types
- handshake fixture tests
- capability gating tests
- in-flight enforcement tests
- GUI-timeout synthesis tests
- streaming-event routing tests
- transcript replay tests

**Hardware acceptance matrix**

| Scenario                             | Pass criteria                                |
|--------------------------------------|----------------------------------------------|
| Single-board UART loopback           | `UART:LOOP:41` -> `UART:PASS:rx=41`          |
| Single-board UART streaming          | GPS NMEA forwarded as `UART:DATA` frames     |
| Single-board SPI burst               | `SPI:XFER:75FF` -> correct WHO_AM_I byte     |
| Single-board CANFD send              | frame appears on bus analyzer                |
| Single-board CANFD monitor           | external frames received and displayed       |
| Single-board I2C scan                | known address appears in scan result         |
| Single-board I2C register read       | sensor bytes match datasheet                 |
| GUI timeout path                     | disconnect mid-command -> local timeout shown|
| Dual-board same firmware version     | side-by-side commands execute correctly      |
| Dual-board firmware version mismatch | warning shown; commands still safe           |
| Legacy mode enter and exit           | enter via mode command; exit via `SYS:RESET` |
| Reconnect after disconnect           | session log continuous; UI recovers          |
| Raw/manual fallback                  | direct terminal entry still works            |

### Phase 6: Remove Legacy Menu (after soak)

Remove only after the hardware acceptance matrix passes for all transports.

Criterion:

- no operator workflow requires menu navigation
- raw/manual debugging still works through the GUI terminal and direct command
  entry

---

## What "Ship Quickly" Looks Like

### Week 1 MVP

- `SYS:HELLO` / `SYS:CAPS` working
- GUI self-configures from board profile
- `UART:LOOP` and `SPI:XFER` fully button-driven
- shared parser module in place
- legacy mode accessible from settings
- `SYS:RESET` exits legacy mode

### Week 2

- `I2C:SCAN`, `I2C:READ`, `I2C:WRITE` working with a real sensor
- `CANFD:SEND` and `CANFD:MONITOR:START` working
- `UART:STREAM` working with a streaming device
- dual-board mode capability-aware

### Week 3

- hardware acceptance matrix complete
- transcript tests passing
- legacy mode hidden behind advanced/debug setting

---

## Risks

| Risk | Mitigation |
|------|------------|
| Firmware line accumulator breaks ISR timing | Accumulator stays entirely in `Dev_Poll()` and never touches ISR context |
| CANFD and I2C hardware timing issues | Implement `SYS`, `UART`, and `SPI` first; budget extra bringup time |
| `frontend/protocols.js` drifts from spec | Spec is authoritative; parser is shared; UI config is derived |
| Protocol names inconsistent across layers | Use `CANFD` everywhere; add grep/CI check |
| Streaming events mistaken for terminal frames | Shared parser distinguishes them and `main.js` routes them separately |
| GUI timeout and firmware `TIMEOUT` conflated | Two distinct paths with distinct UI labeling |
| Temporary I2C interaction model shipped permanently | Replace the old single-byte interaction model during protocol migration |
| Legacy mode becomes a trap | `SYS:RESET` remains active even in legacy mode; hardware reset documented |
| Feature caps missing in partial builds | Absent feature caps disable controls with visible explanation |
