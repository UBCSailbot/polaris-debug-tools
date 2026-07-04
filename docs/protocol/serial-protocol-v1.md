# Polaris Debug Tools Serial Protocol v1

**Version:** `1`  
**Status:** Frozen for Phase 1 implementation  
**Authority:** This document is the canonical wire-protocol reference for the STM32 `DevBoard` firmware and the Electron desktop app. If implementation code, roadmap prose, or test fixtures disagree with this document, this document wins.

---

## 1. Purpose

This protocol defines how the Electron GUI on a laptop controls an STM32 board
running `DevBoard` firmware over a single serial control channel.

The protocol exists to support two distinct workflows:

- `test mode`: verify a bus is alive and behaving as expected
- `sensor mode`: read or monitor real attached devices through the STM32 bridge

The protocol is line-oriented, ASCII, human-readable in a terminal, and simple
enough to implement on the STM32 without adding a heavy transport layer.

---

## 2. Physical System Model

This protocol assumes the following physical topology:

```text
laptop running Electron GUI
-> USB serial control link
-> STM32 NUCLEO-U575ZI-Q running DevBoard firmware
-> breakout board or daughterboard
-> attached UART / SPI / CANFD / I2C peripherals
```

Ownership boundaries:

- The GUI never talks to sensors directly.
- The GUI talks only to the STM32 over one control serial port.
- The STM32 owns all low-level bus transactions.
- Structured responses and stream events are emitted by firmware back to the
  GUI over that same serial link.

Single-board mode means one laptop controls one STM32-plus-breakout stack.

Dual-board mode means one laptop controls two independent STM32-plus-breakout
stacks over two separate serial ports. Each board still independently owns its
own hardware.

---

## 3. Scope

In scope:

- serial frame grammar
- command and response catalog
- capability discovery
- command correlation rules
- timeout ownership
- streaming event behavior
- legacy menu entry and exit contract
- desktop parser contract

Out of scope:

- low-level HAL implementation details
- GUI layout and visual design
- board pin mapping documentation
- sensor-specific presets beyond wire-level examples

---

## 4. Framing and Limits

All protocol frames are newline-delimited ASCII using `\r\n`.

Two limits are frozen separately:

- `MAX_BINARY_PAYLOAD_BYTES = 256`
- `MAX_LINE_CHARS = 640`

Definitions:

- `MAX_BINARY_PAYLOAD_BYTES` is the maximum raw binary payload carried in one
  frame before hex encoding.
- `MAX_LINE_CHARS` is the maximum total line length including domain, command,
  separators, keys, values, and encoded payload.

Additional parser limits:

- `MAX_COMMAND_ARGS = 4`
- `MAX_ARG_CHARS = 512`

Overlong line behavior:

- firmware must reject any line longer than `MAX_LINE_CHARS`
- firmware should discard input until the next `\r\n` boundary
- firmware should emit `LOG:WARN:reason=line-too-long` after recovery
- overlong input must not block ISR or poll-loop progress

Malformed line behavior:

- malformed frames are ignored as command completions
- malformed incoming commands on firmware return `LOG:WARN` and, when possible,
  `SYS:FAIL:reason=bad-frame` or `<DOMAIN>:FAIL:reason=bad-arg`

---

## 5. Case and Encoding Rules

Frozen case rules:

- domains: uppercase
- commands: uppercase
- statuses: uppercase
- event names: uppercase
- payload keys: lowercase
- binary payload hex: uppercase

Payload rules:

- binary data uses uppercase hex pairs with no spaces: `A102B300C501`
- key-value payload fields use semicolons: `fw=0.2.0;board=devboard`
- assignment uses equals signs: `reason=nack`
- list fields use commas: `caps=UART,SPI,CANFD`
- unknown payload keys must be silently ignored by receivers
- `reason=` values are lowercase stable keywords, not sentence fragments

Example valid payloads:

- `proto=1;fw=0.2.0;board=devboard`
- `tx=75FF;rx=0068`
- `caps=UART,SPI,CANFD,I2C,UART_STREAM`
- `addr=0x6A;reg=0x28;bytes=A102B300C501`

Example invalid payloads:

- `TX=75FF RX=0068`
- `bytes=A1 02 B3 00`
- `Reason=BadArg`

---

## 6. Frame Classes and Grammar

Canonical frame forms:

```text
Command:   <DOMAIN>:<COMMAND>[:<arg1>[:<arg2>...]]
Response:  <DOMAIN>:<STATUS>:<payload>
Event:     <DOMAIN>:<EVENT>:<payload>
Log:       LOG:<LEVEL>:<message>
System:    SYS:<TYPE>:<payload>
```

Recognized domains in v1:

- `SYS`
- `UART`
- `SPI`
- `CANFD`
- `I2C`
- `LOG`

Recognized status codes in v1:

- `PASS`
- `FAIL`
- `TIMEOUT`
- `INFO`

Recognized log levels in v1:

- `INFO`
- `WARN`
- `ERROR`

### 6.1 Command Frames

Commands are initiated by the GUI or an operator typing into a raw terminal.

Examples:

- `SYS:HELLO`
- `UART:LOOP:41`
- `SPI:XFER:75FF`
- `CANFD:SEND:130:DEADBEEF`
- `I2C:READ:6A:28:6`

### 6.2 Response Frames

Responses are direct terminal replies to a command.

Examples:

- `SYS:INFO:proto=1;fw=0.2.0;board=devboard;caps=UART,SPI;legacy=1`
- `UART:PASS:rx=41`
- `SPI:FAIL:reason=not-init`
- `I2C:TIMEOUT:addr=0x6A`

### 6.3 Event Frames

Events are unsolicited stream frames emitted only while a streaming mode is
active.

Examples:

- `UART:DATA:2447504747412C...`
- `CANFD:FRAME:130:8:DEADBEEF01020304`

### 6.4 Log Frames

Logs are informational only and never count as command completion.

Examples:

- `LOG:INFO:canfd-monitor-started`
- `LOG:WARN:reason=line-too-long`
- `LOG:ERROR:hal-i2c-timeout`

### 6.5 System Frames

`SYS` frames are normal response frames whose status is `INFO` or `FAIL`.

Examples:

- `SYS:INFO:pong=1`
- `SYS:INFO:mode=legacy`
- `SYS:FAIL:reason=bad-arg`

---

## 7. Status Semantics

| Status | Meaning |
|---|---|
| `PASS` | Command completed successfully |
| `FAIL` | Command failed in a known, handleable way |
| `TIMEOUT` | Peripheral operation timed out inside firmware |
| `INFO` | Informational response, valid for `SYS:*` only |

`FAIL` is used for cases like:

- `reason=bad-arg`
- `reason=not-init`
- `reason=nack`
- `reason=bus-off`
- `reason=fifo-full`
- `reason=no-echo`

`TIMEOUT` is firmware-owned and is used only when the actual underlying
peripheral operation timed out.

`ERR` is not part of v1. Internal details that would previously have become
`ERR` must be emitted as `LOG:ERROR:*` plus an accompanying `FAIL` if the
command failed.

---

## 8. Command Correlation and In-Flight Rules

There may be only **one in-flight command per board connection**.

Lifecycle:

1. `main.js` writes one command to the serial port.
2. `main.js` sets `inFlight = true` for that connection.
3. Logs and stream events may arrive while `inFlight` is true.
4. The first direct terminal response to the active command clears
   `inFlight`.

Frames that clear `inFlight`:

- `PASS`
- `FAIL`
- `TIMEOUT`
- `INFO`

Frames that never clear `inFlight`:

- `LOG:*`
- `UART:DATA:*`
- `CANFD:FRAME:*`
- malformed lines
- raw text that does not parse as a direct terminal response

Desktop enforcement:

- the GUI must reject a second send while `inFlight` is true
- stream events continue to flow even while no command is active
- a disconnect while a command is in flight becomes a GUI-local timeout path

Malformed-frame rule:

- if a malformed line arrives while a command is active, the desktop parser
  ignores it for completion purposes and continues waiting for a valid terminal
  response until the GUI deadline expires or the port closes

---

## 9. Timeout Ownership

Two timeout paths exist in v1 and they are not the same thing.

### 9.1 GUI-Local Timeout

Owned by `main.js`.

Definition:

- no direct terminal response frame arrived within `CMD_TIMEOUT_MS`

Default:

- `CMD_TIMEOUT_MS = 2000`

Desktop behavior:

- clear `inFlight`
- stop the timer
- surface a local timeout to the renderer

Recommended IPC shape:

```js
{
  source: 'gui',
  kind: 'timeout',
  reason: 'no-terminal-frame',
  command: 'I2C:READ:6A:28:6'
}
```

### 9.2 Firmware Peripheral Timeout

Owned by firmware.

Definition:

- the underlying bus operation timed out, for example `HAL_TIMEOUT`

Wire example:

```text
I2C:TIMEOUT:addr=0x6A
```

Recommended renderer labeling:

- GUI-local timeout: "No response from board"
- firmware timeout: "Peripheral timed out"

Metrics guidance:

- firmware `TIMEOUT` counts toward protocol or transport-level error metrics
- GUI-local timeout counts toward connection-health metrics

---

## 10. Capability Discovery

Capabilities are reported through `SYS:HELLO` and `SYS:CAPS`.

Two levels are frozen:

- domain caps
- feature caps

### 10.1 Domain Caps

| Cap | Scope | Meaning |
|---|---|---|
| `UART` | domain | UART domain is available |
| `SPI` | domain | SPI domain is available |
| `CANFD` | domain | CANFD domain is available |
| `I2C` | domain | I2C domain is available |

### 10.2 Feature Caps

| Cap | Scope | Enables | UI Effect |
|---|---|---|---|
| `UART_STREAM` | feature | `UART:STREAM:START/STOP` | enables UART streaming controls |
| `CANFD_MONITOR` | feature | `CANFD:MONITOR:START/STOP` | enables CANFD monitor controls |
| `I2C_SCAN` | feature | `I2C:SCAN` | enables I2C scan control |
| `I2C_READ_REG8` | feature | `I2C:READ`, register-style `I2C:WRITE` | enables register read/write controls |
| `WATCHDOG` | feature | `SYS:WATCHDOG:*` | enables watchdog controls (additive, fw >= 0.3.0) |

Future-cap naming rule:

- use uppercase snake case
- prefer verb or mode specificity over vague names
- example future caps: `I2C_TXRX`, `SPI_STREAM`, `UART_BRIDGE`

Capability handling rules:

- if a domain cap is missing, hide or disable the entire domain in the UI
- if a domain cap exists but a feature cap is missing, show the domain but
  disable unsupported controls with an explanation
- unknown caps must be preserved by parsers where practical and ignored if
  unsupported by the current UI

---

## 11. System and Board Profile Commands

### 11.1 `SYS:HELLO`

Purpose:

- identify protocol version, firmware version, board type, caps, and legacy
  availability

Command:

```text
SYS:HELLO
```

Success:

```text
SYS:INFO:proto=1;fw=0.2.0;board=devboard;caps=UART,SPI,CANFD,I2C,UART_STREAM,CANFD_MONITOR,I2C_SCAN,I2C_READ_REG8;legacy=1
```

Failure:

```text
SYS:FAIL:reason=internal
```

### 11.2 `SYS:CAPS`

Purpose:

- report capability set only

Command:

```text
SYS:CAPS
```

Success:

```text
SYS:INFO:caps=UART,SPI,CANFD,I2C,UART_STREAM,CANFD_MONITOR,I2C_SCAN,I2C_READ_REG8
```

### 11.3 `SYS:PING`

Purpose:

- confirm the protocol loop is alive

Command:

```text
SYS:PING
```

Success:

```text
SYS:INFO:pong=1
```

### 11.4 `SYS:MODE:LEGACY`

Purpose:

- enter the temporary legacy menu path

Command:

```text
SYS:MODE:LEGACY
```

Success:

```text
SYS:INFO:mode=legacy
```

### 11.5 `SYS:RESET`

Purpose:

- exit legacy mode and return to protocol mode without requiring hardware reset

Command:

```text
SYS:RESET
```

Success:

```text
SYS:INFO:mode=protocol
```

### 11.6 `SYS:WATCHDOG` (additive, guarded by `WATCHDOG` cap)

Added in firmware 0.3.0 as a v1-compatible extension: firmware that lacks the
`WATCHDOG` cap answers these commands with `SYS:FAIL:reason=unknown-command`,
and GUIs must gate watchdog controls on the cap.

Purpose:

- arm the independent hardware watchdog (IWDG) so a wedged firmware loop
  self-resets instead of hanging the bench

Rules:

- `SYS:WATCHDOG:ENABLE[:<timeout_ms_dec>]` arms the watchdog; the poll loop
  feeds it every iteration (and inside long blocking operations)
- `timeout_ms` is decimal, clamp-checked to `1000..32000`; omitted → `8000`
- re-issuing `ENABLE` retimes the running watchdog
- **the IWDG cannot be stopped once started** (hardware limitation) —
  `SYS:WATCHDOG:DISABLE` always fails with `reason=wdg-no-disable`; a power
  cycle or reset clears it
- while an SWD debug session halts the core the watchdog is frozen
  (`DBG_IWDG_STOP`), so breakpoints do not reset the board

Commands and responses:

```text
SYS:WATCHDOG:ENABLE:5000
SYS:INFO:watchdog=1;timeout_ms=5000

SYS:WATCHDOG:ENABLE
SYS:INFO:watchdog=1;timeout_ms=8000

SYS:WATCHDOG:STATUS
SYS:INFO:watchdog=0;timeout_ms=0

SYS:WATCHDOG:DISABLE
SYS:FAIL:reason=wdg-no-disable
```

Possible failures:

```text
SYS:FAIL:reason=bad-arg      (timeout not decimal or outside 1000..32000)
SYS:FAIL:reason=wdg-hw       (IWDG register sync failed)
```

---

## 12. Domain Command Catalog

Each command entry below is frozen for v1.

### 12.1 UART

#### `UART:INIT`

- required caps: `UART`
- model: sync

```text
UART:INIT
UART:PASS:ready=1
```

#### `UART:LOOP:<hex_byte>`

- required caps: `UART`
- model: sync

```text
UART:LOOP:41
UART:PASS:rx=41
```

Possible failure:

```text
UART:FAIL:reason=no-echo
```

#### `UART:STREAM:START`

- required caps: `UART`, `UART_STREAM`
- model: start-stream

```text
UART:STREAM:START
UART:PASS:streaming=1
UART:DATA:2447504747412C...
UART:DATA:2447505252432C...
```

#### `UART:STREAM:STOP`

- required caps: `UART`, `UART_STREAM`
- model: sync stop

```text
UART:STREAM:STOP
UART:PASS:streaming=0
```

#### `UART:STATUS`

- required caps: `UART`
- model: sync

```text
UART:STATUS
UART:PASS:rx=128;tx=12;errors=0
```

### 12.2 SPI

#### `SPI:INIT`

- required caps: `SPI`
- model: sync

```text
SPI:INIT
SPI:PASS:ready=1
```

#### `SPI:XFER:<tx_hex_bytes>`

- required caps: `SPI`
- model: sync

Rules:

- `<tx_hex_bytes>` must have even length
- firmware returns an `rx` string of the same byte length

Example:

```text
SPI:XFER:75FF
SPI:PASS:tx=75FF;rx=0068
```

#### `SPI:STATUS`

- required caps: `SPI`
- model: sync

```text
SPI:STATUS
SPI:PASS:transfers=12
```

### 12.3 CANFD

#### `CANFD:INIT`

- required caps: `CANFD`
- model: sync

```text
CANFD:INIT
CANFD:PASS:ready=1
```

#### `CANFD:SEND:<id_hex>:<data_hex>`

- required caps: `CANFD`
- model: sync

Rules:

- firmware derives DLC from `data_hex`
- caller does not supply DLC
- if the payload byte count requires CAN FD padding, firmware pads with zeroes
  internally and reports the derived DLC

Example:

```text
CANFD:SEND:130:DEADBEEF
CANFD:PASS:id=0x130;dlc=4
```

Possible failures:

```text
CANFD:FAIL:reason=bus-off
CANFD:FAIL:reason=fifo-full
```

#### `CANFD:MONITOR:START`

- required caps: `CANFD`, `CANFD_MONITOR`
- model: start-stream

```text
CANFD:MONITOR:START
CANFD:PASS:monitoring=1
CANFD:FRAME:130:8:DEADBEEF01020304
```

#### `CANFD:MONITOR:STOP`

- required caps: `CANFD`, `CANFD_MONITOR`
- model: sync stop

```text
CANFD:MONITOR:STOP
CANFD:PASS:monitoring=0
```

#### `CANFD:STATUS`

- required caps: `CANFD`
- model: sync

```text
CANFD:STATUS
CANFD:PASS:psr=0x00000000;lec=none;bo=0;ep=0
```

### 12.4 I2C

`I2C:READ` and `I2C:WRITE` in v1 assume an 8-bit register model.

Future wide-register or custom transfer support is out of scope for v1 and may
be introduced later via a separate capability such as `I2C_TXRX`.

#### `I2C:INIT`

- required caps: `I2C`
- model: sync

```text
I2C:INIT
I2C:PASS:ready=1
```

#### `I2C:SCAN`

- required caps: `I2C`, `I2C_SCAN`
- model: sync

```text
I2C:SCAN
I2C:PASS:found=6A,68
```

If nothing is found:

```text
I2C:PASS:found=
```

#### `I2C:WRITE:<addr_hex>:<hex_bytes>`

- required caps: `I2C`, `I2C_READ_REG8`
- model: sync

Meaning:

- writes arbitrary bytes to the device
- for register-style sensors, the first byte is typically the register address

Example:

```text
I2C:WRITE:6A:1020
I2C:PASS:addr=0x6A;wrote=2
```

Possible failures:

```text
I2C:FAIL:reason=nack
I2C:TIMEOUT:addr=0x6A
```

#### `I2C:READ:<addr_hex>:<reg_hex>:<len_dec>`

- required caps: `I2C`, `I2C_READ_REG8`
- model: sync

Example:

```text
I2C:READ:6A:28:6
I2C:PASS:addr=0x6A;reg=0x28;bytes=A102B300C501
```

Possible failures:

```text
I2C:FAIL:reason=nack
I2C:TIMEOUT:addr=0x6A
```

#### `I2C:STATUS`

- required caps: `I2C`
- model: sync

```text
I2C:STATUS
I2C:PASS:last_addr=0x6A;errors=0
```

---

## 13. Sync Versus Streaming Model

Every command in v1 uses exactly one of two models:

- synchronous request -> direct terminal response
- streaming start/stop with unsolicited events in between

| Domain | Sync commands | Streaming commands |
|---|---|---|
| `SYS` | `HELLO`, `CAPS`, `PING`, `MODE`, `RESET` | none |
| `UART` | `INIT`, `LOOP`, `STREAM:STOP`, `STATUS` | `STREAM:START` -> `DATA` |
| `SPI` | `INIT`, `XFER`, `STATUS` | none |
| `CANFD` | `INIT`, `SEND`, `MONITOR:STOP`, `STATUS` | `MONITOR:START` -> `FRAME` |
| `I2C` | `INIT`, `SCAN`, `WRITE`, `READ`, `STATUS` | none |

Rules:

- a streaming start command still returns one direct terminal response
- unsolicited events continue until a matching stop command succeeds
- stream events never count as command completion

---

## 14. Legacy Mode Contract

Legacy mode exists only as a temporary compatibility path while the old
menu-driven firmware behavior is being retired.

Entry:

```text
SYS:MODE:LEGACY
SYS:INFO:mode=legacy
```

Behavior while active:

- normal protocol command handling is suspended for legacy menu interaction
- the GUI may still expose a raw terminal view for advanced debugging
- structured protocol commands other than `SYS:RESET` must not be relied on

Exit:

```text
SYS:RESET
SYS:INFO:mode=protocol
```

Special rule:

- firmware in legacy mode must continue scanning incoming USART1 bytes for the
  exact `SYS:RESET\r\n` escape sequence

Visual guidance for the GUI:

- clearly label the connection as being in legacy mode
- disable protocol-driven controls while legacy mode is active
- keep raw terminal access available

---

## 15. Desktop Parser Contract

Phase 0 freezes the parser contract that both Electron layers will use.

Module plan:

- CommonJS implementation: `frontend/protocol-parser.cjs`
- ES module wrapper: `frontend/protocol-parser.js`

### 15.1 `parseLine(raw)`

Input:

- one raw line without trailing `\r\n`

Output:

```js
null
```

or:

```js
{
  kind: 'response' | 'event' | 'log',
  domain: 'SYS' | 'UART' | 'SPI' | 'CANFD' | 'I2C' | 'LOG',
  commandOrType: string | null,
  statusOrEvent: string,
  payload: string,
  raw: string
}
```

Behavior:

- recognizes `SYS`, protocol domains, and `LOG`
- preserves the raw payload string
- does not crash on unknown keys
- returns `null` for malformed or unsupported lines

### 15.2 `parseCapabilities(payload)`

Input example:

```text
proto=1;fw=0.2.0;board=devboard;caps=UART,SPI,CANFD,I2C;legacy=1
```

Output shape:

```js
{
  proto: 1,
  fw: '0.2.0',
  board: 'devboard',
  caps: new Set(['UART', 'SPI', 'CANFD', 'I2C']),
  legacy: true
}
```

### 15.3 `isTerminalFrame(parsed)`

Returns `true` only for direct terminal response frames:

- `PASS`
- `FAIL`
- `TIMEOUT`
- `INFO`

Returns `false` for:

- logs
- events
- malformed parses

### 15.4 `isStreamingEvent(parsed)`

Returns `true` for:

- `UART:DATA:*`
- `CANFD:FRAME:*`

### 15.5 `isLog(parsed)`

Returns `true` for:

- `LOG:INFO:*`
- `LOG:WARN:*`
- `LOG:ERROR:*`

---

## 16. Example Transcripts

### 16.1 Connect Handshake

```text
> SYS:HELLO
< SYS:INFO:proto=1;fw=0.2.0;board=devboard;caps=UART,SPI,CANFD,I2C,UART_STREAM,CANFD_MONITOR,I2C_SCAN,I2C_READ_REG8;legacy=1
> SYS:CAPS
< SYS:INFO:caps=UART,SPI,CANFD,I2C,UART_STREAM,CANFD_MONITOR,I2C_SCAN,I2C_READ_REG8
```

### 16.2 UART Loopback

```text
> UART:INIT
< UART:PASS:ready=1
> UART:LOOP:41
< UART:PASS:rx=41
```

### 16.3 SPI Burst Read

```text
> SPI:INIT
< SPI:PASS:ready=1
> SPI:XFER:75FF
< SPI:PASS:tx=75FF;rx=0068
```

### 16.4 I2C Register Read

```text
> I2C:INIT
< I2C:PASS:ready=1
> I2C:READ:6A:28:6
< I2C:PASS:addr=0x6A;reg=0x28;bytes=A102B300C501
```

### 16.5 CANFD Monitor Start

```text
> CANFD:MONITOR:START
< CANFD:PASS:monitoring=1
< CANFD:FRAME:130:8:DEADBEEF01020304
< CANFD:FRAME:220:2:0AFF
```

### 16.6 GUI-Local Timeout

```text
> I2C:READ:6A:28:6
< [no terminal frame received before CMD_TIMEOUT_MS]
```

Renderer-facing interpretation:

```js
{
  source: 'gui',
  kind: 'timeout',
  reason: 'no-terminal-frame',
  command: 'I2C:READ:6A:28:6'
}
```

### 16.7 Firmware Peripheral Timeout

```text
> I2C:READ:6A:28:6
< LOG:ERROR:hal-i2c-timeout
< I2C:TIMEOUT:addr=0x6A
```

### 16.8 Legacy Mode Entry and Exit

```text
> SYS:MODE:LEGACY
< SYS:INFO:mode=legacy
> SYS:RESET
< SYS:INFO:mode=protocol
```

---

## 17. Compatibility Expectations

Phase 1 and later implementation work must satisfy these expectations:

- firmware defaults to protocol mode, not the menu
- the desktop app handshakes using `SYS:HELLO`
- the desktop parser recognizes `SYS` and `LOG` in addition to transport
  domains
- `CANFD` naming is used consistently across all layers
- the UI derives feature availability from reported caps rather than assuming
  support
- legacy mode remains temporary and explicit

Any future protocol addition that changes wire compatibility must either:

- be backwards-compatible with v1 parsers
- be guarded by a new feature cap
- or bump the protocol version

