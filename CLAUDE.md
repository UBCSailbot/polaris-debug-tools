# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Debug and testing firmware for UBC Sailbot's POLARIS autonomous sailboat. Runs on a **NUCLEO-U575ZI-Q** (STM32U575ZI, Cortex-M33) and provides an interactive UART terminal for testing three communication protocols: UART bridge, SPI master, and FDCAN.

## Build & Flash

This is an **STM32CubeIDE** (Eclipse-based) project — there is no Makefile or CMake. Build and flash via STM32CubeIDE using the `DevBoard/DevBoard.ioc` CubeMX project file.

- Open `DevBoard/` as an STM32CubeIDE workspace project
- Build: **Project → Build Project** (or Ctrl+B)
- Flash/Debug: **Run → Debug** using `DevBoard Debug.launch`
- Terminal: Connect to the NUCLEO's virtual COM port at **115200 8N1** (e.g., PuTTY)

**CubeMX regeneration**: Peripheral HAL init is auto-generated from `DevBoard.ioc`. Regenerating from CubeMX will overwrite HAL init functions but will preserve application code inside `/* USER CODE BEGIN/END */` blocks — always keep custom code inside those guards.

## Architecture

### Data Flow

```
PuTTY (UART1) → ISR → ring buffer (rb_u1_rx) → Dev_Poll() → protocol action
                                                             → UART2 / SPI1 / FDCAN1
UART2/FDCAN1  → ISR → ring buffer / CAN queue              → Dev_Poll() → UART1 echo
```

### Core Modules

**`dev.c` / `dev.h`** — the single active application module. Owns:
- Three 256-byte ISR-safe ring buffers (`rb_u1_rx`, `rb_u2_rx`, `rb_spi_tx`)
- `DevMode_t` state machine (`MENU → UART | SPI | CAN`)
- `Dev_Init()`: call after all `MX_xxx_Init()` functions — arms UART RX interrupts, enables DWT, prints menu
- `Dev_Poll()`: call once per `while(1)` iteration — dispatches to the active mode task
- `Dev_UART_RxCpltCallback()` / `Dev_UART_ErrorCallback()`: must be forwarded from `HAL_UART_RxCpltCallback` and `HAL_UART_ErrorCallback` weak overrides

**`can.c` / `can.h`** — FDCAN library:
- `CAN_Init(hfdcan1, hbid)`: configures filters, starts FDCAN, activates notifications, starts TIM7 heartbeat. Heartbeat IDs: `0x130`=PDB, `0x131`=RUDR, `0x132`=SAIL, `0x133`=SENSE
- `CAN_Transmit(...)`: adds message to TX FIFO queue
- `CAN_Receive(frame)`: dequeues from the ISR-filled circular buffer (100-frame capacity; oldest dropped on overflow)
- `HAL_FDCAN_RxFifo0Callback`: ISR entry point — reads from FIFO0 and enqueues to `CAN_Rx_Queue`
- `HAL_TIM_PeriodElapsedCallback`: handles both TIM7 (CAN heartbeat) and TIM17 (HAL timebase `HAL_IncTick`)

**`UARTMod.c`**, **`SPIMod.c`** — legacy modules, superseded by `dev.c`. Not called from `main.c`.

**`stm32u5xx_it.c`** — ISR routing. `USART1_IRQHandler` and `USART2_IRQHandler` forward to `HAL_UART_IRQHandler`. TIM17 IRQ is here for the HAL tick. FDCAN IRQ is handled automatically by HAL (not manually wired here).

### Interrupt → Application Decoupling Pattern

All ISRs are kept minimal: byte received → push to ring buffer → re-arm `HAL_UART_Receive_IT`. CAN frames received in `HAL_FDCAN_RxFifo0Callback` → `CAN_EnqueueFrame`. Application context drains queues in `Dev_Poll()` / `CAN_Receive()`. Never call blocking HAL functions from ISR context.

### Current State of `main.c`

The `while(1)` loop in `main.c` is currently **commented out** — this is an in-progress development state. To activate the firmware, add inside the `/* USER CODE BEGIN 2 */` and `/* USER CODE BEGIN WHILE */` guards:
```c
// USER CODE BEGIN 2
Dev_Init();
CAN_Init(&hfdcan1, 0x130);  // choose appropriate heartbeat ID
// USER CODE END 2

// USER CODE BEGIN WHILE
while (1) {
    Dev_Poll();
}
```

### Timer Assignments

| Timer | Purpose |
|-------|---------|
| TIM17 | HAL timebase (`HAL_IncTick`) — do not repurpose |
| TIM7  | CAN heartbeat — fires every 10 s, transmits empty frame with `heartbeat_id` |

### Pin Map

| Peripheral | Pins |
|-----------|------|
| USART1 (terminal) | PA9 TX, PA10 RX |
| USART2 (board link) | PD5 TX, PD6 RX |
| SPI1 | PA4 NSS, PA5 SCK, PA6 MISO, PA7 MOSI |
| LEDs | PC2 Red, PC7 Green, PB7 Blue |
| User button | PC13 |

## Code Conventions

- All custom code lives inside `/* USER CODE BEGIN/END */` guards — never outside them
- Ring buffer operations must be ISR-safe: disable/re-enable IRQ around multi-byte access if needed
- HAL error return codes are never silently discarded — always check `HAL_StatusTypeDef`
- `volatile` is required on any variable written in ISR context and read in application context
- No blocking HAL calls (`HAL_Delay`, polling `HAL_UART_Transmit`) from any ISR or callback
- Magic numbers for IDs, buffer sizes, and timing values go in `dev.h` / `can.h` as `#define` constants

---

## Peripheral Configuration (Do Not Change Without Reading This)

### FDCAN1 — Bit Timing
- **Nominal:** 500 kbit/s — verify against `DevBoard.ioc` before touching `CAN_Init`
- **Data phase (FDCAN):** if BRS is enabled, data rate is separate — confirm in `.ioc`
- **Critical:** FDCAN clock source is PLLQ on U5 family — if PLL config changes, recalculate bit timing prescaler. This is a common silent failure.

### USART1 / USART2
- Both at 115200 8N1, interrupt-driven RX (`HAL_UART_Receive_IT` re-armed in callback)
- USART2 is the board-link side — do not enable hardware flow control unless board wiring supports it

### SPI1
- Confirm CPOL/CPHA mode matches the target device before any SPI test
- NSS is software-controlled (PA4) — never configure as hardware NSS unless `.ioc` is updated

---

## Debugging & Common Failure Modes

### GDB / SWD
- Debug launch config: `DevBoard Debug.launch` via STM32CubeIDE
- SWD pins: PA13 (SWDIO), PA14 (SWDCLK) — **do not reassign these in CubeMX**
- If GDB fails to connect: check that no other process holds the ST-Link (close PuTTY first if it's on the same USB hub)

### Known Gotchas on This Board

| Symptom | Likely Cause |
|---------|-------------|
| FDCAN init hangs or returns `HAL_ERROR` | FDCAN clock not enabled before `MX_FDCAN1_Init()` — check `SystemClock_Config` order |
| UART RX stops receiving after first byte | `HAL_UART_Receive_IT` not re-armed in `RxCpltCallback` |
| CAN heartbeat fires immediately at boot | TIM7 ARR/PSC gives shorter period than expected — verify 10 s period against 160 MHz PCLK |
| Ring buffer data corruption | `rb_u1_rx` written in ISR and read in `Dev_Poll()` without IRQ guard on multi-byte reads |
| `HAL_FDCAN_RxFifo0Callback` never fires | FDCAN IT line not activated — `HAL_FDCAN_ActivateNotification` must be called after `HAL_FDCAN_Start` |
| Debugger loses connection mid-session | IWDG enabled in `.ioc` and not fed in `while(1)` — disable IWDG during debug builds |

---

## What Claude Should and Should Not Do

### Always do
- Read `dev.c`, `can.c`, and `DevBoard.ioc` before making any peripheral or architecture change
- Keep all edits inside `/* USER CODE BEGIN/END */` guards
- Re-read `stm32u5xx_it.c` before adding or modifying any IRQ handler
- Verify timer assignments in the Timer Assignments table before using any TIM peripheral

### Never do
- Modify any `MX_xxx_Init()` function body — these are CubeMX-owned and will be overwritten on regeneration
- Add `HAL_Delay()` or any blocking call inside a callback or ISR
- Change `TIM17` — it is the HAL timebase; reassigning it breaks `HAL_GetTick()` and all HAL timeouts
- Move application logic outside `/* USER CODE */` blocks
- Call `CAN_Init` before `MX_FDCAN1_Init` has completed
