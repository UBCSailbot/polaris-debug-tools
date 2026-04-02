# Polaris Debug Tools Protocol Glossary

This glossary freezes the vocabulary used across firmware docs, desktop docs,
tests, and implementation.

## Terms

**Attached device**  
A peripheral or sensor connected to the breakout or daughterboard and reached
through the STM32 over `UART`, `SPI`, `CANFD`, or `I2C`.

**Board profile**  
The structured identity reported by firmware during `SYS:HELLO`, including
protocol version, firmware version, board name, capabilities, and legacy-mode
support.

**Capability**  
A named support flag reported by firmware. Caps are either domain-level or
feature-level.

**Command**  
A GUI- or operator-initiated line sent to the STM32 over the serial control
port.

**Control port**  
The single serial connection between the laptop and the STM32 used for protocol
commands, responses, logs, and stream events.

**Direct terminal response**  
The first `PASS`, `FAIL`, `TIMEOUT`, or `INFO` frame that completes the active
command.

**Domain cap**  
A capability that gates an entire protocol domain, such as `UART` or `I2C`.

**Feature cap**  
A capability that gates a specific feature within a domain, such as
`CANFD_MONITOR` or `UART_STREAM`.

**Firmware timeout**  
A `TIMEOUT` frame emitted because the underlying bus operation timed out inside
firmware.

**GUI-local timeout**  
A desktop-generated timeout emitted because no direct terminal response arrived
before the GUI deadline.

**In-flight command**  
The single active command on one board connection that has been sent but not
yet completed by a direct terminal response.

**Legacy mode**  
The temporary menu-driven firmware behavior preserved for fallback debugging.
It is entered explicitly with `SYS:MODE:LEGACY` and exited with `SYS:RESET`.

**Line accumulator**  
The firmware-side non-blocking state machine that collects incoming serial
bytes until `\r\n`, then hands the completed line to the protocol dispatcher.

**Log frame**  
An informational `LOG:*` frame. Logs never complete a command and never change
GUI state directly.

**Protocol mode**  
The normal structured-command mode in which the STM32 accepts canonical wire
commands and returns structured responses.

**Raw terminal**  
The advanced GUI view that shows uninterpreted serial lines and allows direct
command entry.

**Response frame**  
A structured direct reply to a command, such as `UART:PASS:rx=41`.

**Stream event**  
An unsolicited structured frame emitted while a stream is active, such as
`UART:DATA:*` or `CANFD:FRAME:*`.

**Terminal frame**  
Any frame that may complete the currently active command:
`PASS`, `FAIL`, `TIMEOUT`, or `INFO`.

**Test stack**  
One full physical control chain: laptop, STM32 board, breakout board, and
attached peripherals.

