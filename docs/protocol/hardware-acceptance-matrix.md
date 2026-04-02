# Hardware Acceptance Matrix

This document is the Phase 5 bench checklist for validating the STM32 bridge
board, the Electron GUI, and attached peripherals.

## Test Record Header

Fill this out before each test pass:

- Date:
- Tester:
- Firmware commit / tag:
- GUI commit / tag:
- Board A serial number:
- Board B serial number:
- Breakout board revision:
- Host OS:
- Notes:

## Execution Order

Run the matrix in this order:

1. single-board control plane
2. dual-board bridge-to-bridge communication
3. single-board sensor/peripheral validation
4. failure-path validation

This keeps the bringup sequence disciplined. Do not move to attached sensors
until the two-board protocol path is already stable.

## Scenarios

| ID | Scenario | Wiring / Setup | UI action or command | Expected result | Actual result | Pass/Fail | Notes |
|----|----------|----------------|----------------------|-----------------|---------------|-----------|-------|
| H1 | Single-board handshake | One STM32 bridge board over USB | Connect board | `SYS:HELLO` succeeds; board profile visible |  |  |  |
| H2 | Single-board reconnect | One STM32 bridge board over USB | Disconnect/reconnect cable | GUI recovers; no stale in-flight state |  |  |  |
| D1 | Dual-board handshake | Two STM32 bridge boards over USB | Connect both in Dual view | Both profiles visible independently |  |  |  |
| D2 | Dual-board UART loopback bridge | Board A UART wired to Board B UART | Run `UART:INIT` then `UART:LOOP` on both boards | Both sides return structured `PASS` frames |  |  |  |
| D3 | Dual-board UART streaming | Board A TX -> Board B RX, active source attached or scripted sender | Start stream on receiver side | `UART:DATA:*` frames appear only on receiving side |  |  |  |
| D4 | Dual-board SPI bridge test | Shared SPI wiring between boards or one board acting as SPI peer shim | Run `SPI:INIT` and agreed test burst | Valid `SPI:PASS:tx=...;rx=...` on both sides as expected |  |  |  |
| D5 | Dual-board CANFD send / monitor | Both boards on same CANFD bus with proper termination | Board A send, Board B monitor | Board B receives `CANFD:FRAME:*`; A reports `PASS` |  |  |  |
| D6 | Dual-board I2C peer/proxy test | One board acting as I2C target setup if available | Run `I2C:SCAN` / `I2C:READ` as designed | Deterministic structured result or documented unsupported path |  |  |  |
| D7 | Dual-board capability mismatch | Flash mismatched firmware builds intentionally | Connect both boards | Warning shown; shared controls limited safely |  |  |  |
| D8 | Dual-board legacy trap recovery | Put one board in legacy mode | Use shared controls, then `SYS:RESET` | Warning appears; recovery works cleanly |  |  |  |
| S1 | Single-board UART loopback | One board, UART loopback jumper | `UART:LOOP:41` | `UART:PASS:rx=41` |  |  |  |
| S2 | Single-board UART streaming | One board + streaming UART device | `UART:STREAM:START` | `UART:DATA:*` frames stream until stop |  |  |  |
| S3 | Single-board SPI burst | One board + SPI device | `SPI:XFER:75FF` or device-specific burst | Returned bytes match datasheet |  |  |  |
| S4 | Single-board CANFD send | One board + analyzer or peer | `CANFD:SEND` | Frame visible on analyzer or peer |  |  |  |
| S5 | Single-board CANFD monitor | One board + active CANFD bus | `CANFD:MONITOR:START` | External frames appear in GUI |  |  |  |
| S6 | Single-board I2C scan | One board + known I2C device | `I2C:SCAN` | Known address listed |  |  |  |
| S7 | Single-board I2C register read | One board + known I2C sensor | `I2C:READ` | Returned bytes match datasheet |  |  |  |
| F1 | Local GUI timeout | Disconnect or suppress terminal response mid-command | Send command, force no reply | GUI shows local timeout and clears in-flight state |  |  |  |
| F2 | Firmware timeout | Force real peripheral timeout | Trigger known timeout case | `LOG:ERROR:*` then firmware `TIMEOUT` frame |  |  |  |
| F3 | CAN bus-off / FIFO full | Force bus error or queue pressure | Send CANFD command in fault state | Structured `FAIL:reason=...` returned |  |  |  |
| F4 | I2C NACK | Address a missing target | `I2C:READ` to absent device | Structured `FAIL:reason=nack` |  |  |  |
| F5 | Raw/manual fallback | Use raw terminal entry | Send direct protocol command manually | Raw mode still works during protocol operation |  |  |  |

## Evidence To Capture

For each scenario, capture:

- exact command or clicked preset
- terminal output
- screenshot if the UI warning/state matters
- analyzer output for CANFD when applicable
- wiring photo if the setup is unusual

## Exit Criteria

Phase 5 hardware validation is complete only when:

- all required dual-board bridge tests pass first
- all single-board sensor tests pass afterward
- failure paths have been exercised and documented
- unresolved failures are written down with reproduction steps
