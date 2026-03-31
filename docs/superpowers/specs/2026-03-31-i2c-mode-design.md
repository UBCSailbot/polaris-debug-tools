# I2C Mode Design — polaris-debug-tools

**Date:** 2026-03-31
**Status:** Approved

---

## Overview

Add `DEV_MODE_I2C` as option `'4'` in the existing `dev.c` state-machine menu, following the same pattern as the existing UART, SPI, and CAN modes. The I2C mode is a raw byte-stream master: each byte typed in PuTTY is transmitted to a fixed slave address over I2C1, and any received byte is echoed back to the terminal.

This is intentionally minimal ("Approach A"). Register-based and address-scanning modes are deferred to a future iteration.

---

## Architecture

### Data Flow

```
PuTTY (USART1) → ISR → rb_u1_rx → Dev_Poll() → dev_i2c_task()
                                                 → HAL_I2C_Master_Transmit (1 byte, slave addr)
                                                 → HAL_I2C_Master_Receive  (1 byte, slave addr)
                                                 → USART1 echo (rx byte, if non-zero)
```

No new ring buffers are needed. I2C is master-initiated and all HAL calls are blocking, so bytes are consumed directly from `rb_u1_rx` in application context — identical to how SPI processes bytes from `rb_spi_tx`.

### State Machine Change

`DevMode_t` gains one value:

```c
DEV_MODE_I2C = 4
```

The menu dispatches on `'4'`. In I2C mode, `'m'`/`'M'` returns to the menu, exactly as in every other mode.

---

## Component Changes

### `dev.h`

Add one constant:

```c
#define I2C_SLAVE_ADDR  0x50U   /* 7-bit address; HAL shifts left by 1 internally */
```

### `dev.c`

1. **`extern` declaration** at the top (alongside existing `hspi1`, `huart1`, etc.):
   ```c
   extern I2C_HandleTypeDef hi2c1;
   ```

2. **`dev_i2c_task()`** — new static function:
   - Drain `rb_u1_rx` byte by byte.
   - `'m'`/`'M'` → `g_mode = DEV_MODE_MENU`, call `print_menu()`, return.
   - For each other byte:
     - Echo byte to USART1 (local echo).
     - `HAL_I2C_Master_Transmit(&hi2c1, I2C_SLAVE_ADDR << 1, &b, 1, TX_TIMEOUT_MS)`.
     - If `HAL_OK`: attempt `HAL_I2C_Master_Receive(&hi2c1, I2C_SLAVE_ADDR << 1, &rx, 1, TX_TIMEOUT_MS)`; if `HAL_OK` and `rx != 0x00`, transmit `rx` to USART1 and toggle green LED.
     - If transmit returns anything other than `HAL_OK`: print `[I2C ERR]\r\n`, toggle red LED.

3. **`print_menu()`** — add line:
   ```
   "4) I2C test (I2C1 PB8/PB9)\r\n"
   ```

4. **`announce_mode()`** — add case for `DEV_MODE_I2C`:
   ```
   "[Mode] I2C MASTER.\r\nType bytes to send to slave 0x50. 'm' for menu.\r\n"
   ```

5. **`dev_menu_task()`** — add `'4'` case: set `g_mode = DEV_MODE_I2C`, call `announce_mode`.

6. **`Dev_Poll()`** — add `case DEV_MODE_I2C: dev_i2c_task(); break;`

7. **`Dev_Init()`** — add to the ready banner:
   ```
   "[I2C  MASTER ready]\r\n"
   ```

### `main.c`

All changes are inside USER CODE blocks.

1. **`/* USER CODE BEGIN PV */`** — declare the handle:
   ```c
   I2C_HandleTypeDef hi2c1;
   ```

2. **`/* USER CODE BEGIN 4 */`** — define init function (same pattern as `MX_TIM7_Init`):
   ```c
   static void MX_I2C1_Init(void)
   {
       __HAL_RCC_I2C1_CLK_ENABLE();

       hi2c1.Instance              = I2C1;
       hi2c1.Init.Timing           = 0x00110F12; /* 100 kHz SM at 4 MHz PCLK1 (MSI range 4, Tr=100ns) */
       hi2c1.Init.OwnAddress1      = 0;
       hi2c1.Init.AddressingMode   = I2C_ADDRESSINGMODE_7BIT;
       hi2c1.Init.DualAddressMode  = I2C_DUALADDRESS_DISABLE;
       hi2c1.Init.OwnAddress2      = 0;
       hi2c1.Init.GeneralCallMode  = I2C_GENERALCALL_DISABLE;
       hi2c1.Init.NoStretchMode    = I2C_NOSTRETCH_DISABLE;
       if (HAL_I2C_Init(&hi2c1) != HAL_OK)
       {
           Error_Handler();
       }
   }
   ```
   GPIO init for PB8/PB9 must also be done inside this function (AF4, open-drain, pull-up) since CubeMX has not generated it.

3. **`/* USER CODE BEGIN 2 */`** — call before `Dev_Init()`:
   ```c
   MX_I2C1_Init();
   ```

4. **`/* USER CODE BEGIN PFP */`** — add forward declaration:
   ```c
   static void MX_I2C1_Init(void);
   ```

### `stm32u5xx_it.c`

No changes. Blocking `HAL_I2C_Master_Transmit/Receive` does not require an ISR.

---

## Pin Assignment

| Signal   | Pin | AF  | Notes                          |
|----------|-----|-----|--------------------------------|
| I2C1_SCL | PB8 | AF4 | Open-drain, internal pull-up   |
| I2C1_SDA | PB9 | AF4 | Open-drain, internal pull-up   |

PB7 (LED_BLUE) is already in use; PB8 and PB9 are free on the NUCLEO-U575ZI-Q.

**Important:** Connect external pull-up resistors (4.7 kΩ to 3.3 V) if the slave device does not provide them. Internal pull-ups on the STM32 are weak (~40 kΩ) and unreliable at 100 kHz.

---

## Timing Note

The `Timing` register value `0x00110F12` is calculated for 100 kHz standard mode with PCLK1 = 4 MHz (MSI range 4, APB1 divider = 1, as configured in `SystemClock_Config`), assuming Tr = 100 ns and Tf = 10 ns:

- PRESC=0 → tPRESC = 250 ns
- SCLL=0x12 (18) → tSCLL = 19 × 250 = 4750 ns (≥ 4700 ns required)
- SCLH=0x0F (15) → tSCLH = 16 × 250 = 4000 ns (≥ 4000 ns required)
- SDADEL=1, SCLDEL=1 for margin

**Verify this value with STM32CubeMX I2C timing tool (AN4235) before use on real hardware.** If the system clock configuration changes, recalculate.

---

## Error Handling

| Condition               | Action                                      |
|-------------------------|---------------------------------------------|
| Transmit NACK / timeout | Print `[I2C ERR]\r\n`, toggle red LED       |
| Receive NACK / timeout  | Silent — slave has nothing to send; continue|
| `rx == 0x00`            | Not echoed (treated as no response)         |

---

## Out of Scope (future work)

- Address scanning (`'a'` command sweeps 0x08–0x77)
- Register read/write (`w <addr> <reg> <data>` / `r <addr> <reg> <len>`)
- Configuring slave address at runtime (currently compile-time `#define`)
- Interrupt-driven or DMA I2C transfers
