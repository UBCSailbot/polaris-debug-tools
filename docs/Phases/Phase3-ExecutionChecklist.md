# Phase 3 Execution Checklist

**Parent phase:** [Phase3-Migrate-Each-Protocol-End-To-End.md](C:/Users/aayus/Desktop/UBC%20Sailbot/polaris-debug-tools/docs/Phases/Phase3-Migrate-Each-Protocol-End-To-End.md)  
**Roadmap:** [OfficialRoadmap.md](C:/Users/aayus/Desktop/UBC%20Sailbot/polaris-debug-tools/docs/OfficialRoadmap.md)  
**Goal:** Bring each protocol to real hardware readiness so every supported GUI action maps to one real firmware command and one real peripheral interaction on the STM32-plus-breakout stack.

## Working Model

This checklist assumes the real deployment chain is:

1. `DevBoard` firmware is flashed onto the STM32 board.
2. A breakout or daughterboard is attached to the STM32 board.
3. Real sensors or peripherals are attached to the breakout board.
4. The STM32 board is connected to the laptop over USB serial.
5. The Electron GUI connects to the STM32 board over that serial link.
6. The GUI sends canonical protocol commands.
7. The STM32 firmware executes the low-level bus transactions and returns structured frames or streaming events.

The laptop never talks directly to the sensor. The STM32 board is the active bridge/controller.

## Phase 3 Completion Standard

Phase 3 is not complete when the command merely parses. It is complete when all of these are true for a transport:

- the GUI exposes a working control for the transport
- the control sends one canonical wire command
- the STM32 executes a real hardware transaction
- the GUI renders the returned result or stream correctly
- malformed inputs fail cleanly
- reconnect does not corrupt the transport state
- the raw/manual path still works as a fallback

## Global Preconditions

Complete these before touching transport-specific work:

- [ ] Flash the latest Phase 1 firmware build to the STM32 board.
- [ ] Confirm the laptop can enumerate the STM32 serial port.
- [ ] Confirm the board physically boots and remains stable when attached to the breakout board.
- [ ] Confirm [main.js](C:/Users/aayus/Desktop/UBC%20Sailbot/polaris-debug-tools/main.js) still handshakes with `SYS:HELLO`.
- [ ] Confirm [frontend/app.js](C:/Users/aayus/Desktop/UBC%20Sailbot/polaris-debug-tools/frontend/app.js) receives a board profile and renders firmware info.
- [ ] Confirm raw terminal input still works after the handshake.
- [ ] Confirm [DevBoard/Core/Src/can.c](C:/Users/aayus/Desktop/UBC%20Sailbot/polaris-debug-tools/DevBoard/Core/Src/can.c) and [DevBoard/Core/Inc/can.h](C:/Users/aayus/Desktop/UBC%20Sailbot/polaris-debug-tools/DevBoard/Core/Inc/can.h) remain untouched during this phase unless the user explicitly changes that constraint later.

## Global Cross-Cutting Tasks

These tasks apply throughout the whole phase:

- [ ] Keep [frontend/protocols.js](C:/Users/aayus/Desktop/UBC%20Sailbot/polaris-debug-tools/frontend/protocols.js) aligned with the real wire commands. No placeholder commands should remain after a transport is stabilized.
- [ ] Keep [frontend/app.js](C:/Users/aayus/Desktop/UBC%20Sailbot/polaris-debug-tools/frontend/app.js) result handling split correctly:
  - terminal/direct results update the result panel
  - stream events do not overwrite the result panel
  - logs do not affect result state
- [ ] Keep [frontend/visual.js](C:/Users/aayus/Desktop/UBC%20Sailbot/polaris-debug-tools/frontend/visual.js) capability-aware and non-technical-user-safe.
- [ ] Keep [frontend/charts.js](C:/Users/aayus/Desktop/UBC%20Sailbot/polaris-debug-tools/frontend/charts.js) consistent with the actual payload formats returned by firmware.
- [ ] Keep raw command entry working in both terminal and visual workflows.
- [ ] Keep host timeout handling distinct from firmware `TIMEOUT`.
- [ ] Re-test reconnect behavior after each transport is changed.

## Transport Order

Implement and freeze transports in this order:

1. `SYS`
2. `UART`
3. `SPI`
4. `CANFD`
5. `I2C`

Do not skip ahead if the earlier transport still has unstable behavior.

## Step 1: SYS Stabilization

### Purpose

Prove the board-control path is reliable before debugging a bus-specific failure.

### Primary Files

- [main.js](C:/Users/aayus/Desktop/UBC%20Sailbot/polaris-debug-tools/main.js)
- [preload.js](C:/Users/aayus/Desktop/UBC%20Sailbot/polaris-debug-tools/preload.js)
- [frontend/app.js](C:/Users/aayus/Desktop/UBC%20Sailbot/polaris-debug-tools/frontend/app.js)
- [frontend/protocol-parser.cjs](C:/Users/aayus/Desktop/UBC%20Sailbot/polaris-debug-tools/frontend/protocol-parser.cjs)
- [DevBoard/Core/Src/dev.c](C:/Users/aayus/Desktop/UBC%20Sailbot/polaris-debug-tools/DevBoard/Core/Src/dev.c)

### Implementation Tasks

- [ ] Verify connect triggers `SYS:HELLO` automatically from [main.js](C:/Users/aayus/Desktop/UBC%20Sailbot/polaris-debug-tools/main.js).
- [ ] Verify `SYS:INFO` is parsed correctly by [frontend/protocol-parser.cjs](C:/Users/aayus/Desktop/UBC%20Sailbot/polaris-debug-tools/frontend/protocol-parser.cjs).
- [ ] Verify board profile is pushed over `serial:board-profile`.
- [ ] Verify [frontend/app.js](C:/Users/aayus/Desktop/UBC%20Sailbot/polaris-debug-tools/frontend/app.js) shows:
  - board name
  - firmware version
  - protocol version
  - cap list
- [ ] Verify unsupported protocols are disabled when caps are absent.
- [ ] Verify handshake timeout leaves raw terminal usable.
- [ ] Verify `SYS:MODE:LEGACY` can still be sent manually.
- [ ] Verify `SYS:RESET` exits legacy mode without power cycling.

### Verification Tasks

- [ ] Connect once from a cold boot and confirm handshake success.
- [ ] Disconnect and reconnect at least 5 times.
- [ ] Unplug USB while connected and confirm state resets cleanly.
- [ ] Reconnect after unexpected disconnect and confirm board profile refreshes.
- [ ] Confirm stale board metadata does not persist after disconnect.

### Exit Criteria

- [ ] GUI consistently shows current board profile after connect.
- [ ] Disconnect/reconnect does not leave stale `inFlight` or stale caps.
- [ ] Legacy entry/exit remains possible through raw/manual control.

## Step 2: UART End-To-End

### Purpose

Validate both command/response and continuous streaming on real UART hardware.

### Primary Files

- [DevBoard/Core/Src/dev.c](C:/Users/aayus/Desktop/UBC%20Sailbot/polaris-debug-tools/DevBoard/Core/Src/dev.c)
- [frontend/protocols.js](C:/Users/aayus/Desktop/UBC%20Sailbot/polaris-debug-tools/frontend/protocols.js)
- [frontend/app.js](C:/Users/aayus/Desktop/UBC%20Sailbot/polaris-debug-tools/frontend/app.js)
- [frontend/charts.js](C:/Users/aayus/Desktop/UBC%20Sailbot/polaris-debug-tools/frontend/charts.js)
- [frontend/visual.js](C:/Users/aayus/Desktop/UBC%20Sailbot/polaris-debug-tools/frontend/visual.js)

### Firmware Tasks

- [ ] Verify `UART:INIT` resets UART counters and stream state.
- [ ] Verify `UART:LOOP:<hex_byte>` flushes RX before transmit.
- [ ] Verify `UART:LOOP` increments `tx`, `rx`, and `errors` correctly.
- [ ] Verify `UART:STREAM:START` enables forwarding only after success.
- [ ] Verify `UART:STREAM:STOP` halts forwarding immediately.
- [ ] Verify `UART:DATA:<hex_bytes>` is emitted only while stream mode is active.
- [ ] Verify `UART:STATUS` payload is stable and accurate.

### Desktop Tasks

- [ ] Confirm [frontend/protocols.js](C:/Users/aayus/Desktop/UBC%20Sailbot/polaris-debug-tools/frontend/protocols.js) exposes `INIT`, `LOOP`, `STREAM START`, `STREAM STOP`, and `STATUS`.
- [ ] Confirm the custom UART form produces `UART:LOOP:<hex_byte>` and not a placeholder command.
- [ ] Confirm stream events are handled through `serial:stream-event`.
- [ ] Confirm stream events update terminal and charts without rewriting the last-result panel.
- [ ] Confirm the visual view exposes stream start/stop clearly for non-technical operators.

### Hardware Tasks

- [ ] Wire a loopback on UART2 TX/RX or attach a second known-good UART device.
- [ ] Send `UART:INIT`.
- [ ] Send `UART:LOOP:41`.
- [ ] Confirm `UART:PASS:rx=41`.
- [ ] Start stream mode.
- [ ] Attach a streaming UART source such as GPS or another microcontroller.
- [ ] Confirm sustained `UART:DATA` frames arrive.
- [ ] Stop stream mode.
- [ ] Confirm stream events stop immediately.

### Negative Tests

- [ ] Send malformed byte values and confirm clean rejection.
- [ ] Start stream twice and confirm the behavior is explicit and stable.
- [ ] Disconnect the board mid-stream and confirm renderer recovery.

### Exit Criteria

- [ ] Loopback works reliably from GUI.
- [ ] Streaming works reliably from GUI.
- [ ] No stale UART stream events leak after stop or reconnect.

## Step 3: SPI End-To-End

### Purpose

Validate real multi-byte SPI bursts against a real peripheral.

### Primary Files

- [DevBoard/Core/Src/dev.c](C:/Users/aayus/Desktop/UBC%20Sailbot/polaris-debug-tools/DevBoard/Core/Src/dev.c)
- [DevBoard/Core/Src/SPIMod.c](C:/Users/aayus/Desktop/UBC%20Sailbot/polaris-debug-tools/DevBoard/Core/Src/SPIMod.c) if low-level changes are needed
- [DevBoard/Core/Inc/SPIMod.h](C:/Users/aayus/Desktop/UBC%20Sailbot/polaris-debug-tools/DevBoard/Core/Inc/SPIMod.h) if low-level declarations are needed
- [frontend/protocols.js](C:/Users/aayus/Desktop/UBC%20Sailbot/polaris-debug-tools/frontend/protocols.js)
- [frontend/charts.js](C:/Users/aayus/Desktop/UBC%20Sailbot/polaris-debug-tools/frontend/charts.js)

### Firmware Tasks

- [ ] Verify `SPI:INIT` resets transfer state and leaves CS idle-high.
- [ ] Verify `SPI:XFER:<tx_hex_bytes>` accepts variable-length even-length hex strings.
- [ ] Verify the whole transfer is wrapped in one CS assertion.
- [ ] Verify returned payload format is exactly `tx=<hex>;rx=<hex>`.
- [ ] Verify `SPI:STATUS` transfer count increments correctly.
- [ ] Verify timeout path emits `SPI:TIMEOUT:reason=transfer-timeout`.
- [ ] Verify malformed or oversize transfers fail cleanly.

### Desktop Tasks

- [ ] Confirm the preset and custom SPI commands in [frontend/protocols.js](C:/Users/aayus/Desktop/UBC%20Sailbot/polaris-debug-tools/frontend/protocols.js) reflect real burst use.
- [ ] Confirm the custom SPI form accepts long uppercase hex strings.
- [ ] Confirm [frontend/charts.js](C:/Users/aayus/Desktop/UBC%20Sailbot/polaris-debug-tools/frontend/charts.js) parses `tx=` and `rx=` correctly for burst responses.
- [ ] Confirm the visual view description matches real hardware behavior and not single-byte scaffolding.

### Hardware Tasks

- [ ] Attach a known SPI peripheral with a documented identity/register read.
- [ ] Run `SPI:INIT`.
- [ ] Run `SPI:XFER:75FF` or the equivalent burst for that device.
- [ ] Compare returned `rx` bytes against the datasheet.
- [ ] Test several burst lengths, including more than 2 bytes.

### Negative Tests

- [ ] Reject odd-length hex input before send.
- [ ] Reject oversize burst input before send or fail cleanly at firmware boundary.
- [ ] Test repeated transfers to ensure CS and transfer state remain stable.

### Exit Criteria

- [ ] A real SPI register read works from the GUI.
- [ ] Result formatting is stable for burst transfers.
- [ ] Charts and result panel reflect real burst behavior correctly.

## Step 4: CANFD End-To-End

### Purpose

Validate active transmit and passive monitoring on a real CAN FD bus.

### Primary Files

- [DevBoard/Core/Src/dev.c](C:/Users/aayus/Desktop/UBC%20Sailbot/polaris-debug-tools/DevBoard/Core/Src/dev.c)
- [frontend/protocols.js](C:/Users/aayus/Desktop/UBC%20Sailbot/polaris-debug-tools/frontend/protocols.js)
- [frontend/app.js](C:/Users/aayus/Desktop/UBC%20Sailbot/polaris-debug-tools/frontend/app.js)
- [frontend/charts.js](C:/Users/aayus/Desktop/UBC%20Sailbot/polaris-debug-tools/frontend/charts.js)

### Hard Constraint

- [ ] Do not modify [DevBoard/Core/Src/can.c](C:/Users/aayus/Desktop/UBC%20Sailbot/polaris-debug-tools/DevBoard/Core/Src/can.c).
- [ ] Do not modify [DevBoard/Core/Inc/can.h](C:/Users/aayus/Desktop/UBC%20Sailbot/polaris-debug-tools/DevBoard/Core/Inc/can.h).

### Firmware Tasks

- [ ] Verify `CANFD:INIT` only reports success when CAN is actually ready.
- [ ] Verify `CANFD:SEND:<id_hex>:<data_hex>` derives DLC correctly from payload length.
- [ ] Verify padding behavior for payload lengths above 8 bytes.
- [ ] Verify `CANFD:FAIL:reason=bus-off` and `fifo-full` paths are distinguishable and correct.
- [ ] Verify `CANFD:MONITOR:START` enables passive frame forwarding.
- [ ] Verify `CANFD:MONITOR:STOP` disables frame forwarding.
- [ ] Verify `CANFD:FRAME:<id>:<dlc>:<data>` format remains stable under real bus traffic.
- [ ] Verify `CANFD:STATUS` reports sane controller state.

### Desktop Tasks

- [ ] Confirm [frontend/protocols.js](C:/Users/aayus/Desktop/UBC%20Sailbot/polaris-debug-tools/frontend/protocols.js) exposes `INIT`, `STATUS`, `MONITOR START`, `MONITOR STOP`, and custom send.
- [ ] Confirm the custom send form takes ID and payload only, not DLC.
- [ ] Confirm monitor frames are handled as stream events only.
- [ ] Confirm [frontend/charts.js](C:/Users/aayus/Desktop/UBC%20Sailbot/polaris-debug-tools/frontend/charts.js) parses both:
  - `id=0x...;dlc=...`
  - `FRAME:<id>:<dlc>:<data>` event payloads
- [ ] Confirm CAN monitor traffic does not overwrite the last-result panel.

### Hardware Tasks

- [ ] Connect the board to a CAN FD analyzer or another node.
- [ ] Run `CANFD:INIT`.
- [ ] Send a known frame from GUI and verify it appears on the analyzer.
- [ ] Start monitor mode.
- [ ] Generate external traffic from another node.
- [ ] Verify `CANFD:FRAME` events appear in terminal and chart.
- [ ] Stop monitor mode and verify events stop.

### Negative Tests

- [ ] Try malformed CAN IDs and confirm rejection.
- [ ] Try empty payloads and confirm defined behavior.
- [ ] Force or simulate bus-off if safely possible and confirm error surfacing.
- [ ] Confirm reconnect resets monitor state cleanly.

### Exit Criteria

- [ ] Sending CAN FD frames works from GUI.
- [ ] Passive monitoring works from GUI.
- [ ] Monitor traffic stays isolated from direct command result handling.

## Step 5: I2C End-To-End

### Purpose

Validate real register-based device access through the STM32 bridge.

### Primary Files

- [DevBoard/Core/Src/dev.c](C:/Users/aayus/Desktop/UBC%20Sailbot/polaris-debug-tools/DevBoard/Core/Src/dev.c)
- [DevBoard/Core/Src/main.c](C:/Users/aayus/Desktop/UBC%20Sailbot/polaris-debug-tools/DevBoard/Core/Src/main.c) only if bus timing/init requires adjustment
- [DevBoard/Core/Inc/stm32u5xx_hal_conf.h](C:/Users/aayus/Desktop/UBC%20Sailbot/polaris-debug-tools/DevBoard/Core/Inc/stm32u5xx_hal_conf.h) only if HAL config requires adjustment
- [frontend/protocols.js](C:/Users/aayus/Desktop/UBC%20Sailbot/polaris-debug-tools/frontend/protocols.js)
- [frontend/app.js](C:/Users/aayus/Desktop/UBC%20Sailbot/polaris-debug-tools/frontend/app.js)
- [frontend/charts.js](C:/Users/aayus/Desktop/UBC%20Sailbot/polaris-debug-tools/frontend/charts.js)

### Firmware Tasks

- [ ] Verify `I2C:INIT` resets I2C state.
- [ ] Verify `I2C:SCAN` reports uppercase comma-separated addresses.
- [ ] Verify `I2C:WRITE:<addr_hex>:<hex_bytes>` handles arbitrary write payloads.
- [ ] Verify `I2C:READ:<addr_hex>:<reg_hex>:<len_dec>` works for 8-bit register-addressed devices.
- [ ] Verify timeout vs nack vs other errors are mapped consistently.
- [ ] Verify `I2C:STATUS` returns sane error counters and last address.
- [ ] Verify malformed reads and writes fail cleanly.
- [ ] Verify overlong read requests are rejected.

### Desktop Tasks

- [ ] Confirm scan, read, write, and status are all represented in [frontend/protocols.js](C:/Users/aayus/Desktop/UBC%20Sailbot/polaris-debug-tools/frontend/protocols.js).
- [ ] Confirm scan is gated by `I2C_SCAN`.
- [ ] Confirm read/write are gated by `I2C_READ_REG8`.
- [ ] Confirm [frontend/charts.js](C:/Users/aayus/Desktop/UBC%20Sailbot/polaris-debug-tools/frontend/charts.js) no longer assumes old `tx/rx` single-byte I2C behavior.
- [ ] Confirm visual descriptions match actual register-based sensor access.

### Hardware Tasks

- [ ] Attach a known I2C sensor to the breakout board.
- [ ] Run `I2C:INIT`.
- [ ] Run `I2C:SCAN` and confirm the sensor address appears.
- [ ] Read a known register with `I2C:READ:<addr>:<reg>:<len>`.
- [ ] Compare returned bytes to the datasheet or expected register content.
- [ ] If safe, run a known write with `I2C:WRITE`.

### Negative Tests

- [ ] Test wrong address and confirm `nack` or equivalent failure.
- [ ] Test zero-length read and confirm clean rejection.
- [ ] Test malformed hex and confirm GUI-side or firmware-side rejection.
- [ ] Confirm reconnect resets I2C UI state correctly.

### Exit Criteria

- [ ] Scan works from GUI.
- [ ] Read works from GUI against a real sensor.
- [ ] Write works where supported by the attached device.
- [ ] The old single-byte I2C interaction model is gone from the UI.

## GUI Cleanup Pass

After all transports work individually, do a short cleanup pass:

- [ ] Remove any preset button that is only useful for scaffolding and not for real workflows.
- [ ] Rewrite operator-facing descriptions in [frontend/protocols.js](C:/Users/aayus/Desktop/UBC%20Sailbot/polaris-debug-tools/frontend/protocols.js) so they describe real hardware outcomes.
- [ ] Confirm the visual view remains intuitive for non-technical users.
- [ ] Confirm the raw terminal remains available for engineering/debug workflows.
- [ ] Confirm error messages distinguish:
  - firmware-reported peripheral failures
  - host control/timeout failures

## Final Acceptance Matrix

Do not exit Phase 3 until all of these are checked:

- [ ] Single-board `SYS` handshake is stable.
- [ ] Single-board `UART` loopback works.
- [ ] Single-board `UART` streaming works.
- [ ] Single-board `SPI` burst transfer works with a real device.
- [ ] Single-board `CANFD` send works with an analyzer or another node.
- [ ] Single-board `CANFD` monitor works.
- [ ] Single-board `I2C` scan works.
- [ ] Single-board `I2C` register read works with a real sensor.
- [ ] Raw/manual fallback works for every connected board session.
- [ ] Disconnect/reconnect does not leave stale transport state.

## Evidence To Capture

When Phase 3 is implemented, capture evidence for each transport:

- [ ] sample command issued from GUI
- [ ] sample response or event transcript
- [ ] photo or note describing hardware wiring
- [ ] any transport-specific caveat discovered during bring-up

Store that evidence in docs or a validation log so Phase 4 starts from a known-good baseline.
