# Phase 1 - Add The Protocol Layer To Firmware

**Parent document:** [OfficialRoadmap.md](C:/Users/aayus/Desktop/UBC%20Sailbot/polaris-debug-tools/docs/OfficialRoadmap.md)  
**Goal:** Replace the current menu-first control path with a structured serial protocol layer that boots by default on the STM32 board.

## Purpose

Phase 1 converts the STM32 firmware from a human-operated menu bridge into a
machine-controllable protocol endpoint while preserving the existing low-level
ISR and ring-buffer plumbing.

At the end of this phase:

- the board boots into protocol mode
- protocol lines are accepted over the serial control port
- structured `SYS:*` commands work from a terminal
- legacy mode still exists, but only as a temporary fallback

## Scope

### In Scope

- line accumulator
- serial line parser
- command dispatcher
- response and log emitters
- `SYS:*` handlers
- per-domain protocol handlers for `UART`, `SPI`, `CANFD`, `I2C`
- default boot into protocol mode
- legacy mode entry and exit hooks

### Out Of Scope

- Electron-side handshake logic
- GUI feature gating
- transcript replay tests on desktop
- removal of legacy code

## Current-State Constraints

The current firmware path in [DevBoard/Core/Src/dev.c](C:/Users/aayus/Desktop/UBC%20Sailbot/polaris-debug-tools/DevBoard/Core/Src/dev.c):

- receives bytes into ring buffers via ISR callbacks
- drains bytes in `Dev_Poll()`
- routes bytes by a manual mode state machine
- treats the console as a human terminal, not a command protocol

This means the biggest design change is not just "parse strings." It is
changing `Dev_Poll()` from a byte-oriented menu driver into a line-oriented
protocol dispatcher without touching ISR timing behavior.

## Firmware Architecture To Implement

### Keep

- UART ISR callbacks
- ring buffers
- low-level peripheral init in [main.c](C:/Users/aayus/Desktop/UBC%20Sailbot/polaris-debug-tools/DevBoard/Core/Src/main.c)
- low-level CAN helpers in [can.c](C:/Users/aayus/Desktop/UBC%20Sailbot/polaris-debug-tools/DevBoard/Core/Src/can.c)

### Add

Suggested new files:

- `DevBoard/Core/Inc/protocol.h`
- `DevBoard/Core/Src/protocol.c`
- `DevBoard/Core/Inc/cmd_dispatch.h`
- `DevBoard/Core/Src/cmd_dispatch.c`
- `DevBoard/Core/Src/proto_sys.c`
- `DevBoard/Core/Src/proto_uart.c`
- `DevBoard/Core/Src/proto_spi.c`
- `DevBoard/Core/Src/proto_canfd.c`
- `DevBoard/Core/Src/proto_i2c.c`

### Temporary Compatibility Layer

Keep legacy menu code in `dev.c`, but:

- do not print it at boot
- do not make it the default mode
- expose it only through `SYS:MODE:LEGACY`
- guarantee `SYS:RESET` can escape from it

## Detailed Task Breakdown

### Task 1.1: Introduce Protocol State In Firmware

Add a protocol-mode state distinct from the legacy menu state.

Recommended high-level runtime states:

- `PROTOCOL_MODE_ACTIVE`
- `LEGACY_MODE_ACTIVE`

State requirements:

- protocol mode is default at boot
- protocol mode accepts newline-delimited frames
- legacy mode accepts menu input and byte-oriented interactions
- `SYS:RESET` is honored in both states

### Task 1.2: Implement The Line Accumulator

Create a non-blocking line accumulator in `protocol.c`.

Responsibilities:

- accept bytes one at a time from the USART1 receive ring buffer
- accumulate until `\r\n`
- ignore bare `\r` or `\n` edge cases according to spec
- detect overlong lines and reset cleanly
- emit `LOG:WARN:*` on malformed or truncated frames when useful

Design constraints:

- no dynamic allocation
- no blocking calls in the accumulator logic
- no ISR modifications beyond existing byte capture
- bounded memory usage

Suggested API:

- `Protocol_Init()`
- `Protocol_FeedByte(uint8_t b)`
- `Protocol_HasLine()`
- `Protocol_GetLine(char *dst, size_t dst_len)`

### Task 1.3: Implement Response And Log Emitters

In `protocol.c`, add helpers that centralize all outgoing structured lines.

Suggested functions:

- `Protocol_SendPass(domain, payload)`
- `Protocol_SendFail(domain, reason, extra_payload)`
- `Protocol_SendTimeout(domain, payload)`
- `Protocol_SendInfo(type, payload)`
- `Protocol_LogInfo(message)`
- `Protocol_LogWarn(message)`
- `Protocol_LogError(message)`

Rules:

- all structured output must go through these helpers
- payload formatting must match Phase 0 spec
- avoid hand-building frame strings all over handlers

### Task 1.4: Implement The Dispatcher

In `cmd_dispatch.c`, parse the first two tokens:

- domain
- command

Then route to handler modules.

Responsibilities:

- reject unknown domains cleanly
- reject unsupported commands cleanly
- validate argument count before calling handlers
- normalize failure handling

### Task 1.5: Implement `SYS:*` First

Do `SYS` before any bus code.

Required commands:

- `SYS:HELLO`
- `SYS:CAPS`
- `SYS:PING`
- `SYS:MODE:LEGACY`
- `SYS:RESET`

Acceptance checks:

- board powers on silently into protocol mode
- `SYS:HELLO` returns firmware/profile info
- `SYS:CAPS` returns all supported caps
- `SYS:MODE:LEGACY` enters menu behavior
- `SYS:RESET` exits legacy mode without hardware reset

### Task 1.6: Implement `UART:*`

Create `proto_uart.c`.

Required commands:

- `UART:INIT`
- `UART:LOOP:<hex_byte>`
- `UART:STREAM:START`
- `UART:STREAM:STOP`
- `UART:STATUS`

Implementation detail:

- keep loopback logic distinct from stream-forwarding logic
- if stream mode is enabled, unsolicited `UART:DATA:*` frames must be emitted
  from bytes received on the target UART path
- stream events must not interfere with command dispatch

### Task 1.7: Implement `SPI:*`

Create `proto_spi.c`.

Required commands:

- `SPI:INIT`
- `SPI:XFER:<tx_hex_bytes>`
- `SPI:STATUS`

Implementation tasks:

- parse variable-length hex payload into TX bytes
- assert CS, perform burst transfer, collect RX bytes
- return same-length RX payload
- validate even-length hex input
- reject oversize transfers

### Task 1.8: Implement `CANFD:*`

Create `proto_canfd.c`, reusing [can.c](C:/Users/aayus/Desktop/UBC%20Sailbot/polaris-debug-tools/DevBoard/Core/Src/can.c).

Required commands:

- `CANFD:INIT`
- `CANFD:SEND:<id_hex>:<data_hex>`
- `CANFD:MONITOR:START`
- `CANFD:MONITOR:STOP`
- `CANFD:STATUS`

Implementation tasks:

- parse and validate CAN ID
- derive DLC from data length
- handle padding if needed
- surface bus-off or FIFO errors as structured failures
- emit `CANFD:FRAME:*` while monitor mode is active

### Task 1.9: Implement `I2C:*`

Create `proto_i2c.c`.

Required commands:

- `I2C:INIT`
- `I2C:SCAN`
- `I2C:WRITE:<addr_hex>:<hex_bytes>`
- `I2C:READ:<addr_hex>:<reg_hex>:<len_dec>`
- `I2C:STATUS`

Implementation tasks:

- remove any protocol-path dependency on `I2C_SLAVE_ADDR`
- parse variable address arguments
- implement scan over `0x08` to `0x77`
- implement register-style read using 8-bit register address
- track last address and error count for `STATUS`

### Task 1.10: Integrate Protocol Mode Into `Dev_Poll()`

Update `Dev_Poll()` so protocol mode is the main poll path.

Suggested structure:

1. drain bytes from `rb_u1_rx`
2. feed line accumulator
3. dispatch completed lines
4. service streaming-event emission for active transports
5. if in legacy mode, run legacy handlers instead

### Task 1.11: Keep Legacy Mode As A Contained Escape Hatch

Legacy mode should become an isolated compatibility path.

Requirements:

- no boot banner menu
- no protocol commands routed through legacy handlers
- `SYS:RESET` remains recognized
- GUI can still reach it later through an advanced setting

## File-Level Plan

### Update Existing Files

- [DevBoard/Core/Src/dev.c](C:/Users/aayus/Desktop/UBC%20Sailbot/polaris-debug-tools/DevBoard/Core/Src/dev.c)
- [DevBoard/Core/Inc/dev.h](C:/Users/aayus/Desktop/UBC%20Sailbot/polaris-debug-tools/DevBoard/Core/Inc/dev.h)
- [DevBoard/Core/Src/main.c](C:/Users/aayus/Desktop/UBC%20Sailbot/polaris-debug-tools/DevBoard/Core/Src/main.c)

### Reuse As-Is or With Minimal Changes

- [DevBoard/Core/Src/can.c](C:/Users/aayus/Desktop/UBC%20Sailbot/polaris-debug-tools/DevBoard/Core/Src/can.c)

### Add New Files

- `protocol.h/.c`
- `cmd_dispatch.h/.c`
- `proto_sys.c`
- `proto_uart.c`
- `proto_spi.c`
- `proto_canfd.c`
- `proto_i2c.c`

## Verification Plan

Before GUI integration, verify from PuTTY:

1. `SYS:HELLO`
2. `SYS:CAPS`
3. `SYS:PING`
4. `SYS:MODE:LEGACY`
5. `SYS:RESET`

Then verify transports one at a time:

1. `UART:LOOP:41`
2. `SPI:XFER:75FF`
3. `CANFD:STATUS`
4. `I2C:SCAN`
5. `I2C:READ:<addr>:<reg>:<len>`

## Exit Criteria

Phase 1 is complete only when:

- firmware boots in protocol mode
- `SYS:HELLO` and `SYS:CAPS` work reliably from a terminal
- all v1 commands exist in firmware entry points
- stream events can be emitted without corrupting command handling
- legacy mode is no longer the default control path
