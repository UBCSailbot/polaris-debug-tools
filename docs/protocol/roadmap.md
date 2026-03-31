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
Example: `SPI:XFER:A5` → `SPI:PASS:TX=0xA5 RX=0x5A`

**Sensor mode** — actually read a device.
Either a register-addressed read/write that returns N bytes, or a continuous
stream of unsolicited frames forwarded from the peripheral. Single-byte request/
response cannot do this.

The protocol spec must define both modes explicitly. Every transport (UART, SPI,
CANFD, I2C) needs to declare which model it uses and when.

---

## What the Previous Plan Got Right

- Spec-first, phased, legacy mode kept as a fallback.
- `SYS:CAPS` capability discovery is the right architecture.
- Separating `LOG:*` from result frames.
- Keeping `dev.c` ISR/ring-buffer plumbing and replacing only the command
  dispatch layer.
- Migrating one transport at a time.

---

## What Needs To Change

### I2C

`I2C:XFER:<addr>:<byte>` (single byte in, single byte out) cannot read any real
sensor. Virtually all I2C sensors are register-based and return multi-byte
payloads. This must be resolved in the spec before any firmware work begins.

Required commands:

```
I2C:INIT
I2C:SCAN                                 — sweep 0x08–0x77, return ACKing addresses
I2C:WRITE:<addr_hex>:<hex_bytes>         — write arbitrary bytes (e.g. reg addr + data)
I2C:READ:<addr_hex>:<reg_hex>:<len_dec>  — write reg, read len bytes back
I2C:STATUS                               — last error code, bus state
```

Example — read 6 bytes from LSM6DSO accelerometer output registers:

```
I2C:READ:6A:28:6
I2C:PASS:addr=0x6A reg=0x28 bytes=A1 02 B3 00 C5 01
```

The hardcoded `I2C_SLAVE_ADDR 0x50` in the current firmware is intentionally
minimal and must be superseded in Phase 1. The current implementation is
a scaffold, not a finished design.

### SPI

`SPI:XFER:A5` (single byte) cannot read a real SPI sensor. Most SPI devices
(IMU, ADC, display) require burst transfers: assert CS, write N bytes (address
and/or command), clock back M bytes.

Required commands:

```
SPI:INIT
SPI:XFER:<tx_hex_bytes>                  — variable-length burst, returns same-length RX
SPI:STATUS
```

Example — read WHO_AM_I register from MPU-6050 (single-byte address, one dummy
read byte):

```
SPI:XFER:75FF
SPI:PASS:TX=75FF RX=0068
```

### UART

For loopback testing, request/response is fine. For sensors that stream
continuously (GPS sending NMEA, IMU at 100 Hz), the board must forward
unsolicited received bytes without waiting for a command. A polling model will
drop data.

Required commands:

```
UART:INIT
UART:LOOP:<hex_byte>                     — echo test, request/response
UART:STREAM:START                        — forward all USART2 RX as UART:DATA frames
UART:STREAM:STOP
UART:STATUS
```

Unsolicited event (streaming mode only):

```
UART:DATA:<hex_bytes>
```

### CANFD

Passive monitoring is not optional for real CAN testing. If another node is
transmitting, you need to observe those frames without sending a request first.

Required commands:

```
CANFD:INIT
CANFD:SEND:<id_hex>:<dlc_dec>:<data_hex>
CANFD:MONITOR:START                      — stream all received frames as CANFD:FRAME events
CANFD:MONITOR:STOP
CANFD:STATUS
```

Unsolicited event (monitor mode only):

```
CANFD:FRAME:<id_hex>:<dlc_dec>:<data_hex>
```

---

## Updated Protocol Spec (to be frozen in Phase 0)

### Frame Format

All frames are newline-delimited ASCII (`\r\n`).

```
Command:   <DOMAIN>:<COMMAND>[:<arg1>[:<arg2>...]]
Response:  <DOMAIN>:<STATUS>:<payload>
Event:     <DOMAIN>:<EVENT>:<payload>      (unsolicited, streaming contexts only)
Log:       LOG:<LEVEL>:<message>
System:    SYS:<TYPE>:<payload>
```

### Status Codes

| Code      | Meaning                              |
|-----------|--------------------------------------|
| `PASS`    | Command succeeded                    |
| `FAIL`    | Command failed, reason in payload    |
| `TIMEOUT` | No response within deadline          |
| `ERR`     | Firmware-side error, detail in LOG:* |
| `INFO`    | Informational response (SYS:*)       |

### System Commands

```
SYS:HELLO
→ SYS:INFO:proto=1;fw=<semver>;board=devboard;caps=UART,SPI,CANFD,I2C;legacy=1

SYS:CAPS
→ SYS:INFO:caps=UART,SPI,CANFD,I2C

SYS:PING
→ SYS:INFO:pong

SYS:MODE:LEGACY
→ SYS:INFO:entering legacy menu mode
```

### UART Commands

```
UART:INIT
UART:LOOP:<hex_byte>
UART:STREAM:START
UART:STREAM:STOP
UART:STATUS
```

### SPI Commands

```
SPI:INIT
SPI:XFER:<tx_hex_bytes>
SPI:STATUS
```

### CANFD Commands

```
CANFD:INIT
CANFD:SEND:<id_hex>:<dlc_dec>:<data_hex>
CANFD:MONITOR:START
CANFD:MONITOR:STOP
CANFD:STATUS
```

### I2C Commands

```
I2C:INIT
I2C:SCAN
I2C:WRITE:<addr_hex>:<hex_bytes>
I2C:READ:<addr_hex>:<reg_hex>:<len_dec>
I2C:STATUS
```

### Log Events

```
LOG:INFO:<message>
LOG:WARN:<message>
LOG:ERROR:<message>
```

Logs are informational only. They do not change GUI state. They appear in the
raw/terminal view.

---

## Response Model: Synchronous vs Asynchronous

Every command is either synchronous (one command → one response) or activates
a streaming mode (command enables a flow of unsolicited events until stopped).
The spec must be explicit about which model each command uses. Mixing the two
in a single command context is forbidden.

| Transport | Sync commands               | Streaming commands            |
|-----------|-----------------------------|-------------------------------|
| UART      | INIT, LOOP, STATUS          | STREAM:START → DATA events    |
| SPI       | INIT, XFER, STATUS          | —                             |
| CANFD     | INIT, SEND, STATUS          | MONITOR:START → FRAME events  |
| I2C       | INIT, SCAN, WRITE, READ, STATUS | —                         |
| SYS       | HELLO, CAPS, PING, MODE     | —                             |

---

## Revised Phase Plan

### Phase 0: Freeze The Contract (1–3 days)

**Goal:** Every open question resolved. No ambiguity entering Phase 1.

Deliverable: `docs/protocol/serial-protocol-v1.md`

Must resolve before Phase 1 starts:

- [ ] Multi-byte I2C read/write grammar (done above — `I2C:READ` and `I2C:WRITE`)
- [ ] SPI burst format (done above — `SPI:XFER:<tx_hex_bytes>`)
- [ ] UART streaming model (done above — `UART:STREAM:START` + `UART:DATA` events)
- [ ] CANFD passive monitoring (done above — `CANFD:MONITOR:START` + `CANFD:FRAME` events)
- [ ] Payload encoding for multi-byte data (hex pairs, no spaces, e.g. `A102B30001`)
- [ ] Maximum frame length (suggest 256 bytes of payload → 512 hex chars + header)
- [ ] Error payload format (`reason=<keyword>`)
- [ ] Whether `SYS:HELLO` response includes a legacy flag

Acceptance criteria: Another engineer can implement firmware or GUI from the
spec without reading any existing code.

---

### Phase 1: Add Protocol Layer to Firmware (3–5 days)

**Goal:** Board is machine-controllable via structured commands.

**Hidden complexity to plan for:** The existing `dev.c` processes one byte at a
time from `rb_u1_rx`. The protocol layer needs a line accumulator — buffer
incoming bytes until `\r\n`, then dispatch the full command string. This is a
non-trivial change to the poll loop's contract and must be designed explicitly,
not assumed.

**New firmware files:**

```
DevBoard/Core/Inc/protocol.h        — line accumulator, frame parser, response emitter
DevBoard/Core/Src/protocol.c
DevBoard/Core/Inc/cmd_dispatch.h    — domain → handler dispatch table
DevBoard/Core/Src/cmd_dispatch.c
DevBoard/Core/Src/proto_sys.c       — SYS:* handlers
DevBoard/Core/Src/proto_uart.c      — UART:* handlers
DevBoard/Core/Src/proto_spi.c       — SPI:* handlers
DevBoard/Core/Src/proto_canfd.c     — CANFD:* handlers
DevBoard/Core/Src/proto_i2c.c       — I2C:* handlers (replaces current dev_i2c_task)
```

**What stays:**

- `dev.c` ring-buffer and ISR plumbing — unchanged.
- `can.c` low-level CAN TX/RX — reused by `proto_canfd.c`.
- Legacy menu in `dev.c` — accessible only via `SYS:MODE:LEGACY`.

**What changes:**

- Firmware boots in protocol mode by default (no menu printed at boot).
- `Dev_Poll()` passes accumulated lines to `CMD_Dispatch()` instead of
  dispatching single bytes.
- `I2C_SLAVE_ADDR` hardcode in `dev.h` is replaced by the address argument in
  `I2C:READ`/`I2C:WRITE`.

**Implement in this order:**

1. Line accumulator + `protocol.c` frame parser + response/log emitters
2. `SYS:HELLO`, `SYS:CAPS`, `SYS:PING` — no peripheral needed, verifiable
   immediately from PuTTY
3. `UART:INIT`, `UART:LOOP`, `UART:STATUS`
4. `SPI:INIT`, `SPI:XFER`, `SPI:STATUS`
5. `CANFD:INIT`, `CANFD:SEND`, `CANFD:STATUS`, `CANFD:MONITOR:START/STOP`
6. `I2C:INIT`, `I2C:SCAN`, `I2C:WRITE`, `I2C:READ`, `I2C:STATUS`
7. `UART:STREAM:START/STOP`
8. `SYS:MODE:LEGACY` entry point

**Acceptance criteria:**

- `SYS:HELLO` returns a structured `SYS:INFO:...` line from PuTTY.
- No menu interaction is required for any protocol command.
- `SPI:XFER:75FF` returns two RX bytes.
- `I2C:READ:6A:28:6` returns 6 bytes from a connected sensor.

**Timeline note:** CANFD and I2C on real hardware have a documented history of
timing and clock issues on this board (see CLAUDE.md). Budget extra time for
hardware bring-up. `UART` and `SPI` will be faster to verify.

---

### Phase 2: GUI Handshake and Adaptation (2–3 days)

**Goal:** GUI self-configures from firmware capabilities on connect.

**Changes to `main.js`:**

- On connect, send `SYS:HELLO` then `SYS:CAPS`.
- Parse response; store `proto version`, `fw version`, `caps list`,
  `legacy flag`.
- Expose board profile to renderer via IPC (`serial:board-profile` event).
- Update both regex literals (currently `UART|SPI|CANFD|I2C`) to also match
  `SYS` and `LOG`.
- Handle streaming events (`UART:DATA`, `CANFD:FRAME`) — do not treat them as
  command responses.

**Changes to `frontend/protocols.js`:**

- Add `I2C:READ` and `I2C:WRITE` custom command fields.
- Update `SPI:XFER` to accept multi-byte hex string.
- Add `CANFD:MONITOR:START` and `CANFD:MONITOR:STOP` preset commands.
- Add `UART:STREAM:START` and `UART:STREAM:STOP`.
- Normalize to `CANFD` everywhere (not `CAN`).

**Changes to `frontend/app.js`:**

- Listen for `serial:board-profile` IPC event.
- Disable sidebar protocol rows whose ID is not in `caps`.
- Show firmware version and board type in titlebar or settings panel.
- Handle unsolicited `UART:DATA` and `CANFD:FRAME` events and route them to
  the terminal and charts without affecting the result panel.

**UI behaviour:**

- Protocols not in `caps` are shown greyed out with a tooltip ("not supported
  by connected firmware").
- Legacy mode is accessible only via an Advanced section in the settings panel.
- Terminal/raw view remains fully functional for manual command entry.

**Acceptance criteria:**

- Connect a board; the GUI enables only the protocols reported in `SYS:CAPS`.
- Firmware version is visible in the UI.

---

### Phase 3: Migrate Each Protocol Command End-to-End (3–6 days)

**Goal:** Every GUI button maps to exactly one canonical wire command and
returns one structured result or a stream of events.

Implement and verify in this order (fast → slow to bring up on hardware):

1. **SYS** — handshake buttons (already done in Phase 2 automatically)
2. **UART** — loopback, streaming
3. **SPI** — multi-byte burst with a real SPI device
4. **CANFD** — send, status, passive monitor
5. **I2C** — scan, register write, register read with a real sensor

For each transport, the acceptance criterion is: connect a real peripheral,
click the corresponding GUI buttons, observe correct structured data in the
result panel and chart.

**I2C-specific:** Update `frontend/protocols.js` I2C commands to use the
multi-byte `I2C:READ`/`I2C:WRITE` grammar. Remove the single-byte `I2C:INIT`
scaffold from the current implementation.

---

### Phase 4: Dual-Board Mode (1–2 days)

**Goal:** Dual-board view compares protocol peers, not arbitrary serial
terminals.

- Handshake each board independently on connect.
- Compare `caps` and `proto` version before enabling side-by-side commands.
- Show mismatch warnings when boards report different protocol versions or
  capability sets.
- Preset commands in dual mode are the intersection of both boards' caps.

**Acceptance criteria:**

- Run the same `I2C:READ` on two boards with the same sensor wired to each and
  compare outputs side by side without operator guesswork.

---

### Phase 5: Tests (2–4 days)

**Firmware-side (host-compiled, no hardware required):**

- Line accumulator unit tests (partial frames, max-length frames, embedded nulls)
- Parser tests (valid frames, malformed frames, unknown domains)
- Dispatcher tests (each domain routes to correct handler)
- Response formatting tests
- Protocol transcript replay (send known input, assert known output)

**Desktop-side:**

- `parseLine` extended for `SYS` and `LOG` frames
- Handshake fixture tests (mock `SYS:INFO:...` response → assert board profile)
- Capability gating tests (caps=UART,SPI only → I2C row disabled)
- Streaming event tests (`CANFD:FRAME` arrives → chart updates, result panel unchanged)
- Transcript replay against recorded serial sessions

**Hardware acceptance matrix:**

| Scenario                              | Pass criteria                              |
|---------------------------------------|--------------------------------------------|
| Single-board UART loopback            | `UART:LOOP:41` → `UART:PASS:RX=41`        |
| Single-board UART streaming           | GPS NMEA forwarded as `UART:DATA` frames   |
| Single-board SPI burst                | `SPI:XFER:75FF` → correct WHO_AM_I byte   |
| Single-board CANFD send               | Frame appears on bus analyzer              |
| Single-board CANFD monitor            | External frames received and displayed     |
| Single-board I2C scan                 | Known address appears in scan result       |
| Single-board I2C register read        | Sensor output bytes match datasheet        |
| Dual-board same firmware version      | Side-by-side commands execute correctly    |
| Dual-board firmware version mismatch  | Warning shown, commands still safe to run  |
| Reconnect after disconnect            | Session log continuous, UI recovers        |
| Raw/manual fallback                   | Direct terminal entry still works          |

---

### Phase 6: Remove Legacy Menu (after soak)

Remove only after the hardware acceptance matrix passes for all transports.

Criterion: no operator workflow requires menu navigation. Raw/manual debugging
still works through the GUI terminal and direct serial command entry.

---

## What "Ship Quickly" Looks Like

**Week 1 MVP**

- `SYS:HELLO`/`SYS:CAPS` working; GUI handshakes and shows board info
- `UART:LOOP` and `SPI:XFER` (multi-byte) fully button-driven
- Legacy menu still accessible via settings panel

**Week 2**

- `I2C:SCAN`, `I2C:READ`, `I2C:WRITE` working with a real sensor
- `CANFD:SEND` and `CANFD:MONITOR:START` working
- `UART:STREAM` working with a connected streaming device
- Dual-board capability-aware

**Week 3**

- Hardware acceptance matrix complete
- Transcript tests passing
- Legacy mode hidden behind advanced/debug setting

---

## Risks

| Risk | Mitigation |
|------|------------|
| Firmware line accumulator breaks existing ISR timing | Design accumulator as a non-blocking state machine in `Dev_Poll()`; never block in ISR |
| CANFD and I2C hardware timing issues | Budget extra time; these have known failure modes documented in CLAUDE.md |
| `frontend/protocols.js` drifts from the wire spec | Phase 0 spec is the authority; `protocols.js` is derived from it, not the other way around |
| Protocol names inconsistent across layers | `CANFD` everywhere; enforce in spec and lint/grep CI check |
| Streaming events mistaken for command responses in `main.js` | Streaming events have distinct event types (`DATA`, `FRAME`); parser distinguishes them by keyword, not position |
| I2C single-byte scaffold shipped as permanent | Current `I2C:INIT` preset is explicitly a scaffold; Phase 3 replaces it with `I2C:READ`/`I2C:WRITE` |
