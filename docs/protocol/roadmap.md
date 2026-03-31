# Polaris Debug Tools — Protocol Roadmap

**Date:** 2026-03-31
**Status:** Active

---

## Goal

Any sensor or peripheral attached to the NUCLEO-U575ZI-Q can be read and its
communication tested from the Electron GUI without manual serial interaction.

---

## Core Insight: Two Modes, Not One

The original plan conflates two distinct use cases that require different
protocol models.

**Test mode** — verify a bus is alive.
One command → one structured result. Good for bringup and regression checks.
Example: `SPI:XFER:A5FF` → `SPI:PASS:TX=A5FF RX=0068`

**Sensor mode** — actually read a device.
Either a register-addressed read/write that returns N bytes, or a continuous
stream of unsolicited frames forwarded from the peripheral. Single-byte
request/response cannot do this.

The protocol spec must define both modes explicitly. Every transport (UART, SPI,
CANFD, I2C) needs to declare which model it uses and when.

---

## Protocol Spec (frozen before Phase 1)

### Frame Format

All frames are newline-delimited ASCII (`\r\n`). Maximum frame length is 512
characters (256 payload bytes expressed as hex pairs, plus header and
separators).

```
Command:   <DOMAIN>:<COMMAND>[:<arg1>[:<arg2>...]]
Response:  <DOMAIN>:<STATUS>:<payload>
Event:     <DOMAIN>:<EVENT>:<payload>    (unsolicited; streaming contexts only)
Log:       LOG:<LEVEL>:<message>
System:    SYS:<TYPE>:<payload>
```

### Status Codes

Four codes only. `ERR` is removed — internal error detail goes in `LOG:ERROR:*`.

| Code      | Meaning                                                       |
|-----------|---------------------------------------------------------------|
| `PASS`    | Command succeeded                                             |
| `FAIL`    | Command failed; reason in payload as `reason=<keyword>`       |
| `TIMEOUT` | Peripheral did not respond within its deadline (firmware-set) |
| `INFO`    | Informational response (`SYS:*` only)                         |

`FAIL` is for known, handleable failures (NACK, bus-off, bad argument).
`TIMEOUT` is emitted by firmware only when the peripheral itself genuinely timed
out (e.g. `HAL_I2C_Master_Transmit` returned `HAL_TIMEOUT`). The GUI synthesises
its own timeout if no terminal frame arrives within its deadline — it does not
wait for firmware to declare it.

### Payload Encoding Rules

These rules are frozen. Parsers must follow them exactly; unknown keys must be
silently ignored to allow forward compatibility.

- Data bytes are expressed as **uppercase hex pairs with no spaces or
  separators**: `A102B300C501` not `A1 02 B3`.
- Key-value payloads use **semicolons** as separators and **equals signs** for
  assignment: `proto=1;fw=0.2.0;caps=UART,SPI`.
- Capability lists use **commas**: `caps=UART,SPI,CANFD,I2C,UART_STREAM`.
- **Unknown keys in any payload must be silently ignored** by the receiver.
  This is the forward-compatibility rule that lets firmware and GUI versions
  diverge safely during development.
- `reason=` values are lowercase keywords: `reason=nack`, `reason=bus-off`,
  `reason=bad-arg`, `reason=not-init`.

### Command/Response Correlation

**One in-flight command per board at a time.**

A command is in-flight from the moment it is written to the serial port until
a terminal frame (`PASS`, `FAIL`, `TIMEOUT`, or `INFO`) is received for that
domain. Streaming events (`UART:DATA`, `CANFD:FRAME`) and `LOG:*` frames may
interleave freely and do not satisfy the terminal condition.

The GUI enforces this by disabling the send path while a command is outstanding.
`main.js` tracks `inFlight: boolean` per connection, sets it on send, clears it
on terminal frame receipt, and rejects any send attempt while set.

The GUI owns its own deadline: if no terminal frame arrives within `CMD_TIMEOUT_MS`
(suggested default 2000 ms), `main.js` clears `inFlight`, synthesises a local
timeout, and reports it to the renderer. It does **not** wait for firmware to
declare the timeout.

### Timeout Ownership

- **GUI / `main.js`** owns "no terminal frame received within `CMD_TIMEOUT_MS`".
  It synthesises a timeout, unblocks the send path, and surfaces the error to
  the renderer.
- **Firmware** emits `TIMEOUT` only when the peripheral itself genuinely timed
  out — for example, `HAL_I2C_Master_Transmit` returned `HAL_TIMEOUT`, meaning
  no ACK was received within the HAL deadline. Firmware never uses `TIMEOUT` as
  a generic catch-all.
- This means two distinct timeout paths exist. They are not the same event and
  must not be conflated in GUI state handling.

### System Commands

```
SYS:HELLO
→ SYS:INFO:proto=1;fw=<semver>;board=devboard;caps=UART,SPI,CANFD,I2C,
            UART_STREAM,CANFD_MONITOR,I2C_SCAN,I2C_READ_REG8;legacy=1

SYS:CAPS
→ SYS:INFO:caps=UART,SPI,CANFD,I2C,UART_STREAM,CANFD_MONITOR,I2C_SCAN,I2C_READ_REG8

SYS:PING
→ SYS:INFO:pong

SYS:MODE:LEGACY
→ SYS:INFO:mode=legacy
```

**Legacy mode exit:** Firmware in legacy mode must continue scanning for
`SYS:RESET\r\n` on USART1. Receiving it exits the menu and restarts the
protocol dispatcher without a hardware reset. Hardware reset also works as a
fallback. There is no timeout back to protocol mode — once legacy mode is
entered it is sticky until `SYS:RESET` or reset.

### Capability Discovery

Capabilities are reported at two levels of granularity. Domain-level caps gate
sidebar entries; feature-level caps gate individual commands within a domain.

**Domain caps** (gate sidebar row):
`UART`, `SPI`, `CANFD`, `I2C`

**Feature caps** (gate individual buttons):
`UART_STREAM` — `UART:STREAM:START/STOP`
`CANFD_MONITOR` — `CANFD:MONITOR:START/STOP`
`I2C_SCAN` — `I2C:SCAN`
`I2C_READ_REG8` — `I2C:READ` and `I2C:WRITE` (8-bit register addressing)

If a feature cap is absent, its button is shown disabled with a tooltip
explaining it is not supported by the connected firmware. This decouples
protocol version bumps from partial feature support.

### UART Commands

```
UART:INIT
→ UART:PASS:ready=1

UART:LOOP:<hex_byte>
→ UART:PASS:RX=<hex_byte>   (or UART:FAIL:reason=no-echo)

UART:STREAM:START            (requires UART_STREAM cap)
→ UART:PASS:streaming=1
  [unsolicited: UART:DATA:<hex_bytes>  ...]

UART:STREAM:STOP
→ UART:PASS:streaming=0

UART:STATUS
→ UART:PASS:rx=<count>;tx=<count>;errors=<count>
```

### SPI Commands

```
SPI:INIT
→ SPI:PASS:ready=1

SPI:XFER:<tx_hex_bytes>      (variable length; firmware returns same-length RX)
→ SPI:PASS:TX=<tx_hex_bytes> RX=<rx_hex_bytes>

SPI:STATUS
→ SPI:PASS:transfers=<count>
```

Example — read WHO_AM_I from MPU-6050 (address byte `0x75` read-bit set, one
dummy byte):

```
SPI:XFER:75FF
SPI:PASS:TX=75FF RX=0068
```

### CANFD Commands

DLC is **derived by firmware from the length of `<data_hex>`**. The caller never
specifies DLC explicitly. Firmware maps byte count to CAN FD DLC encoding (0–8
bytes map 1:1; above 8, the next valid CAN FD DLC is used and firmware pads with
zeros if needed).

```
CANFD:INIT
→ CANFD:PASS:ready=1

CANFD:SEND:<id_hex>:<data_hex>
→ CANFD:PASS:id=0x<id_hex>;dlc=<derived_dlc>
  or CANFD:FAIL:reason=bus-off
  or CANFD:FAIL:reason=fifo-full

CANFD:MONITOR:START          (requires CANFD_MONITOR cap)
→ CANFD:PASS:monitoring=1
  [unsolicited: CANFD:FRAME:<id_hex>:<dlc_dec>:<data_hex>  ...]

CANFD:MONITOR:STOP
→ CANFD:PASS:monitoring=0

CANFD:STATUS
→ CANFD:PASS:psr=0x<hex>;lec=<keyword>;bo=<0|1>;ep=<0|1>
```

### I2C Commands

`I2C:READ` and `I2C:WRITE` use 8-bit register addressing (v1). This covers the
majority of embedded sensors (IMU, barometer, magnetometer). It is explicitly
labelled as the 8-bit register model so future commands can extend it without
breaking the v1 contract.

For devices with 16-bit register addresses or non-standard write-then-read
sequences, a future `I2C:TXRX:<addr_hex>:<write_hex>:<read_len_dec>` command
will be added and advertised via a new feature cap. It is not in v1.

```
I2C:INIT
→ I2C:PASS:ready=1

I2C:SCAN                     (requires I2C_SCAN cap)
→ I2C:PASS:found=<addr1_hex>,<addr2_hex>,...
  or I2C:PASS:found=  (empty — no devices)

I2C:WRITE:<addr_hex>:<hex_bytes>       (write arbitrary bytes; reg addr is first byte)
→ I2C:PASS:addr=0x<addr_hex>;wrote=<len_dec>
  or I2C:FAIL:reason=nack
  or I2C:TIMEOUT:addr=0x<addr_hex>

I2C:READ:<addr_hex>:<reg_hex>:<len_dec>  (requires I2C_READ_REG8 cap)
→ I2C:PASS:addr=0x<addr_hex>;reg=0x<reg_hex>;bytes=<hex_bytes>
  or I2C:FAIL:reason=nack
  or I2C:TIMEOUT:addr=0x<addr_hex>

I2C:STATUS
→ I2C:PASS:last_addr=0x<hex>;errors=<count>
```

Example — read 6 bytes of accelerometer output from LSM6DSO:

```
I2C:READ:6A:28:6
I2C:PASS:addr=0x6A;reg=0x28;bytes=A102B300C501
```

### Log Events

`LOG:*` frames are informational. They never change GUI state. They appear in
the raw/terminal view only.

```
LOG:INFO:<message>
LOG:WARN:<message>
LOG:ERROR:<message>
```

Firmware-side errors that previously might have become `ERR` status codes must
now emit a `LOG:ERROR:` line and then return `FAIL` with an appropriate
`reason=` keyword.

---

## Response Model: Synchronous vs Asynchronous

Every command is one of two models. Mixing them in a single command is
forbidden.

| Transport | Sync commands                      | Streaming commands                 |
|-----------|------------------------------------|------------------------------------|
| SYS       | HELLO, CAPS, PING, MODE, RESET     | —                                  |
| UART      | INIT, LOOP, STREAM:STOP, STATUS    | STREAM:START → DATA events         |
| SPI       | INIT, XFER, STATUS                 | —                                  |
| CANFD     | INIT, SEND, MONITOR:STOP, STATUS   | MONITOR:START → FRAME events       |
| I2C       | INIT, SCAN, WRITE, READ, STATUS    | —                                  |

Streaming commands return one sync terminal frame (e.g. `UART:PASS:streaming=1`)
and then emit unsolicited events until the matching `STOP` command is received.
The `STOP` command itself returns a terminal frame and ends the stream.

---

## Revised Phase Plan

### Phase 0: Freeze The Contract (1–3 days)

**Goal:** Every open question resolved. No ambiguity entering Phase 1.

All of the following are resolved in the spec above. This checklist confirms
closure before Phase 1 begins.

- [x] Multi-byte I2C read/write grammar — `I2C:READ` and `I2C:WRITE`
- [x] I2C explicitly labelled as 8-bit register model (v1); `I2C:TXRX` deferred to v2
- [x] SPI burst format — `SPI:XFER:<tx_hex_bytes>` variable length
- [x] UART streaming model — `UART:STREAM:START` + `UART:DATA` events
- [x] CANFD passive monitoring — `CANFD:MONITOR:START` + `CANFD:FRAME` events
- [x] CANFD DLC — derived by firmware from data_hex length; not caller-specified
- [x] Command/response correlation — one in-flight per board; terminal frame clears it
- [x] Timeout ownership — GUI owns deadline; firmware emits TIMEOUT for peripheral failures only
- [x] Status code set — PASS, FAIL, TIMEOUT, INFO only; ERR removed
- [x] Payload encoding — uppercase hex, no spaces, semicolon key-value, unknown keys ignored
- [x] Maximum frame length — 512 chars
- [x] Capability granularity — domain caps + feature caps
- [x] Legacy mode exit — `SYS:RESET` command; hardware reset as fallback
- [x] Shared JS parser module — one module, used by both `main.js` and renderer

Deliverable: `docs/protocol/serial-protocol-v1.md` (the above spec extracted
into a standalone reference document, not this roadmap).

Acceptance criteria: Another engineer can implement firmware or GUI from the
spec without reading any existing code.

---

### Phase 1: Add Protocol Layer to Firmware (3–5 days)

**Goal:** Board is machine-controllable via structured commands.

**Non-trivial design task — line accumulator:** The existing `dev.c` processes
one byte at a time from `rb_u1_rx`. The protocol layer needs a line
accumulator: a non-blocking state machine that buffers incoming bytes in
`Dev_Poll()` until `\r\n` is seen, then passes the complete line to the
dispatcher. This changes the poll loop's contract and must be designed
explicitly as a state machine, not bolted on as an afterthought.

**New firmware files:**

```
DevBoard/Core/Inc/protocol.h       — line accumulator, frame parser, response/log emitters
DevBoard/Core/Src/protocol.c
DevBoard/Core/Inc/cmd_dispatch.h   — domain → handler dispatch table
DevBoard/Core/Src/cmd_dispatch.c
DevBoard/Core/Src/proto_sys.c      — SYS:* handlers
DevBoard/Core/Src/proto_uart.c     — UART:* handlers
DevBoard/Core/Src/proto_spi.c      — SPI:* handlers
DevBoard/Core/Src/proto_canfd.c    — CANFD:* handlers (reuses can.c)
DevBoard/Core/Src/proto_i2c.c      — I2C:* handlers (supersedes dev_i2c_task)
```

**What stays unchanged:**

- `dev.c` ring-buffer and ISR plumbing.
- `can.c` low-level CAN TX/RX — reused by `proto_canfd.c`.
- Legacy menu in `dev.c` — accessible only via `SYS:MODE:LEGACY`.

**What changes:**

- Firmware boots in protocol mode by default. No menu printed at boot.
- `Dev_Poll()` feeds bytes to the line accumulator; completed lines go to
  `CMD_Dispatch()`.
- `I2C_SLAVE_ADDR` hardcode removed; address comes from command arguments.

**Implement in this order:**

1. Line accumulator + response/log emitters (no dispatch yet — just echo back
   unknown commands as `LOG:WARN:unknown`)
2. `SYS:HELLO`, `SYS:CAPS`, `SYS:PING`, `SYS:RESET` — no peripheral needed;
   verify from PuTTY before touching any hardware
3. `UART:INIT`, `UART:LOOP`, `UART:STATUS`
4. `SPI:INIT`, `SPI:XFER` (variable length), `SPI:STATUS`
5. `CANFD:INIT`, `CANFD:SEND` (firmware-derived DLC), `CANFD:STATUS`,
   `CANFD:MONITOR:START/STOP`
6. `I2C:INIT`, `I2C:SCAN`, `I2C:WRITE`, `I2C:READ`, `I2C:STATUS`
7. `UART:STREAM:START/STOP`
8. `SYS:MODE:LEGACY` + `SYS:RESET` exit path

**Acceptance criteria:**

- `SYS:HELLO` returns a structured `SYS:INFO:...` line from PuTTY.
- No menu interaction is required for any command.
- `SPI:XFER:75FF` returns two RX bytes from a connected device.
- `I2C:READ:6A:28:6` returns 6 bytes from a connected sensor.

**Timeline note:** CANFD and I2C on this board have known timing and clock
failure modes documented in CLAUDE.md. Budget extra time. UART and SPI will
be faster to verify.

---

### Phase 2: GUI Handshake, Shared Parser, and Adaptation (2–3 days)

**Goal:** GUI self-configures from firmware capabilities on connect. Single
parser module used by both `main.js` and renderer.

**New file — `frontend/protocol-parser.js`:**

Extract all protocol parsing into one module used by both `main.js` (via
`require`) and the renderer (via ES module import). Eliminates the regex
duplication that currently risks drift between the two.

Exports:
- `parseLine(raw)` — returns `{ domain, status, payload }` or `null`
- `parseCapabilities(infoPayload)` — returns `{ proto, fw, board, caps: Set, legacy }`
- `isStreamingEvent(parsed)` — true for `UART:DATA`, `CANFD:FRAME`
- `isTerminalFrame(parsed)` — true if status is `PASS`, `FAIL`, `TIMEOUT`, `INFO`
- `isLog(parsed)` — true for `LOG:*`

**Changes to `main.js`:**

- Import `protocol-parser.js` for all parsing.
- On connect: send `SYS:HELLO`, wait for `SYS:INFO:...`, parse capabilities.
- Store board profile; expose to renderer via `serial:board-profile` IPC event.
- Track `inFlight` per connection; enforce one in-flight command at a time.
- Run GUI-side deadline timer (`CMD_TIMEOUT_MS = 2000`); synthesise local
  timeout if no terminal frame arrives.
- Route streaming events to `serial:stream-event` IPC channel, not
  `serial:data`, so renderer can distinguish them.

**Changes to `frontend/protocols.js`:**

- Add `I2C:READ` and `I2C:WRITE` custom command fields (multi-byte).
- Update `SPI:XFER` to accept multi-byte hex string.
- Add `CANFD:MONITOR:START/STOP` presets.
- Add `UART:STREAM:START/STOP` presets.
- Normalize all command names to `CANFD:*` (not `CAN:*`).
- Tag each command with its required feature cap (e.g.
  `requiredCap: 'CANFD_MONITOR'`) so `app.js` can gate it without hardcoding.

**Changes to `frontend/app.js`:**

- Listen for `serial:board-profile` IPC event; store locally.
- Disable sidebar rows and individual preset buttons whose required cap is not
  in the board profile cap set.
- Show firmware version and board type in the titlebar or settings panel.
- Subscribe to `serial:stream-event`; route `UART:DATA` and `CANFD:FRAME` to
  terminal and charts without touching the result panel.

**Acceptance criteria:**

- Connect a board; GUI enables only protocols and features in `SYS:CAPS`.
- Firmware version visible in UI.
- Streaming events update the terminal/chart without affecting the result panel
  or clearing `inFlight`.

---

### Phase 3: Migrate Each Protocol End-to-End (3–6 days)

**Goal:** Every GUI button maps to exactly one canonical wire command and
returns one structured result or a stream of events.

Implement and verify in order (fastest to bring up on hardware first):

1. **SYS** — handshake (done automatically on connect in Phase 2)
2. **UART** — loopback, then streaming with a connected sensor
3. **SPI** — multi-byte burst with a real SPI device
4. **CANFD** — send, status, passive monitor
5. **I2C** — scan, register write, register read with a real sensor

**I2C-specific:** Replace the current single-byte scaffold in
`frontend/protocols.js` with `I2C:READ`/`I2C:WRITE` commands gated by the
`I2C_READ_REG8` feature cap.

Acceptance criterion per transport: connect a real peripheral, click the GUI
button, observe correct structured data in the result panel and chart.

---

### Phase 4: Dual-Board Mode (1–2 days)

**Goal:** Dual-board view compares protocol peers, not arbitrary serial
terminals.

- Handshake each board independently on connect.
- Compute intersection of both boards' cap sets.
- Preset commands in dual mode are limited to the intersection.
- Show explicit warnings when caps or protocol versions differ.

**Acceptance criteria:**

- Run `I2C:READ` on two boards with the same sensor; compare outputs side by
  side without operator intervention.
- Version mismatch between boards shows a clear warning, not a silent failure.

---

### Phase 5: Tests (2–4 days)

**Firmware-side (host-compiled, no hardware required):**

- Line accumulator: partial frames, max-length frames, missing terminator,
  frame exactly at buffer limit
- Parser: valid frames, unknown domain, unknown command, truncated payload,
  bad hex
- Dispatcher: each domain routes to correct handler; unknown domain returns
  `LOG:WARN`
- Response formatter: key-value output matches spec encoding rules
- Protocol transcript replay: send known input file, assert known output file

**Desktop-side:**

- `protocol-parser.js` unit tests: all frame types, edge cases, unknown keys
  ignored
- Handshake fixture: mock `SYS:INFO:...` → assert board profile parsed correctly
- Cap gating: `caps=UART,SPI` → `I2C` row disabled, `UART_STREAM` button
  disabled
- In-flight enforcement: second send rejected while first outstanding
- GUI timeout: no terminal frame within `CMD_TIMEOUT_MS` → local timeout
  synthesised, `inFlight` cleared
- Streaming events: `CANFD:FRAME` arrives → chart updated, result panel
  unchanged, `inFlight` not cleared
- Transcript replay against recorded serial sessions

**Hardware acceptance matrix:**

| Scenario                             | Pass criteria                                |
|--------------------------------------|----------------------------------------------|
| Single-board UART loopback           | `UART:LOOP:41` → `UART:PASS:RX=41`          |
| Single-board UART streaming          | GPS NMEA forwarded as `UART:DATA` frames     |
| Single-board SPI burst               | `SPI:XFER:75FF` → correct WHO_AM_I byte     |
| Single-board CANFD send              | Frame appears on bus analyzer                |
| Single-board CANFD monitor           | External frames received and displayed       |
| Single-board I2C scan                | Known address appears in scan result         |
| Single-board I2C register read       | Sensor bytes match datasheet                 |
| GUI timeout path                     | Disconnect mid-command → local timeout shown |
| Dual-board same firmware version     | Side-by-side commands execute correctly      |
| Dual-board firmware version mismatch | Warning shown; commands still safe           |
| Legacy mode enter and exit           | `SYS:MODE:LEGACY` enters; `SYS:RESET` exits |
| Reconnect after disconnect           | Session log continuous; UI recovers          |
| Raw/manual fallback                  | Direct terminal entry still works            |

---

### Phase 6: Remove Legacy Menu (after soak)

Remove only after the hardware acceptance matrix passes for all transports.

Criterion: no operator workflow requires menu navigation. Raw/manual debugging
still works via the GUI terminal and direct command entry.

---

## What "Ship Quickly" Looks Like

**Week 1 MVP**

- `SYS:HELLO`/`SYS:CAPS` working; GUI self-configures from board profile
- `UART:LOOP` and `SPI:XFER` (multi-byte) fully button-driven
- Shared parser module in place; no regex duplication
- Legacy menu accessible via settings panel; `SYS:RESET` exits it

**Week 2**

- `I2C:SCAN`, `I2C:READ`, `I2C:WRITE` working with a real sensor
- `CANFD:SEND` and `CANFD:MONITOR:START` working
- `UART:STREAM` working with a connected streaming device
- Dual-board capability-aware

**Week 3**

- Hardware acceptance matrix complete
- All transcript tests passing
- Legacy mode hidden behind advanced/debug setting

---

## Risks

| Risk | Mitigation |
|------|------------|
| Firmware line accumulator breaks ISR timing | Accumulator is a non-blocking state machine in `Dev_Poll()`; never touches ISR context |
| CANFD and I2C hardware timing issues | Known failure modes in CLAUDE.md; budget extra time; implement SYS/UART/SPI first |
| `protocols.js` drifts from wire spec | Spec is authority; `protocols.js` derived from it; `protocol-parser.js` is the shared enforcement point |
| Protocol names inconsistent across layers | `CANFD` everywhere; grep CI check before Phase 1 merges |
| Streaming events mistaken for terminal frames | `isStreamingEvent()` and `isTerminalFrame()` in shared parser; `main.js` routes them to different IPC channels |
| GUI timeout and firmware TIMEOUT conflated | Two distinct paths, different IPC payloads; documented in spec and parser |
| I2C scaffold shipped as permanent | Current `I2C:INIT` preset is explicitly temporary; replaced in Phase 3 by `I2C:READ`/`I2C:WRITE` gated by `I2C_READ_REG8` cap |
| Legacy mode becomes a trap | `SYS:RESET` always handled, even in legacy mode; hardware reset documented as fallback |
| Feature caps missing for partial firmware builds | Feature cap absence disables button with tooltip; never a silent failure |
