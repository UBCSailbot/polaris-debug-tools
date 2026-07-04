/*
 * dev_test_support.h — shared harness for host tests that compile dev.c.
 *
 * Include order inside a test file:
 *     #include "test_runner.h"
 *     #include "dev_test_support.h"
 *
 * This header:
 *   - defines the peripheral handles dev.c declares extern
 *   - includes dev.c itself (so static internals are reachable)
 *   - provides recording stub implementations of the Dev_UART/SPI/CAN/I2C
 *     module entry points that dev.c dispatches into
 *   - provides a stub CAN_DrainRxFifo with a call counter (can.c is not
 *     compiled into dev.c-based tests)
 *   - provides feed/reset helpers for driving the protocol loop
 */

#ifndef DEV_TEST_SUPPORT_H
#define DEV_TEST_SUPPORT_H

#include "stubs/stm32u5xx_hal.h"

/* ---- Handles the production code declares extern ---- */
GPIO_TypeDef        stub_gpio = {0};
SPI_HandleTypeDef   hspi1     = {0};
UART_HandleTypeDef  huart1    = {0};
UART_HandleTypeDef  huart2    = {0};
I2C_HandleTypeDef   hi2c1     = {0};
TIM_HandleTypeDef   htim7     = {0};
FDCAN_HandleTypeDef hfdcan1   = {0};
HAL_StatusTypeDef   CanStartStatus = HAL_OK;

/* can.h externs normally defined by can.c (not compiled here) */
volatile uint8_t g_can_rx_pending = 0U;

/* ---- Production code under test ---- */
#include "../../DevBoard/Core/Src/dev.c"

/* ---- Recording stubs for the protocol modules dev.c dispatches into ---- */
typedef struct {
    int calls;
    char command[32];
    uint8_t argc;
    char argv0[64];
    char argv1[64];
} ModuleCallRecord_t;

static ModuleCallRecord_t rec_uart_cmd;
static ModuleCallRecord_t rec_spi_cmd;
static ModuleCallRecord_t rec_can_cmd;
static ModuleCallRecord_t rec_i2c_cmd;

static int rec_uart_legacy_bytes = 0;
static uint8_t rec_uart_last_legacy_byte = 0;
static int rec_can_drain_calls = 0;

static void record_cmd(ModuleCallRecord_t *rec, const ParsedCommand_t *cmd)
{
    rec->calls++;
    strncpy(rec->command, cmd->command, sizeof(rec->command) - 1U);
    rec->command[sizeof(rec->command) - 1U] = '\0';
    rec->argc = cmd->argc;
    rec->argv0[0] = '\0';
    rec->argv1[0] = '\0';
    if (cmd->argc > 0U) {
        strncpy(rec->argv0, cmd->argv[0], sizeof(rec->argv0) - 1U);
        rec->argv0[sizeof(rec->argv0) - 1U] = '\0';
    }
    if (cmd->argc > 1U) {
        strncpy(rec->argv1, cmd->argv[1], sizeof(rec->argv1) - 1U);
        rec->argv1[sizeof(rec->argv1) - 1U] = '\0';
    }
}

void Dev_UART_HandleCommand(const ParsedCommand_t *cmd) { record_cmd(&rec_uart_cmd, cmd); }
void Dev_UART_ServiceProtocol(void) {}
void Dev_UART_ServiceLegacy(void) {}
void Dev_UART_HandleLegacyByte(uint8_t byte)
{
    rec_uart_legacy_bytes++;
    rec_uart_last_legacy_byte = byte;
}

void Dev_SPI_HandleCommand(const ParsedCommand_t *cmd) { record_cmd(&rec_spi_cmd, cmd); }
void Dev_SPI_ServiceLegacy(void) {}
void Dev_SPI_HandleLegacyByte(uint8_t byte) { (void)byte; }

HAL_StatusTypeDef Dev_CAN_EnsureReady(void) { return HAL_OK; }
void Dev_CAN_ServiceBackground(void) {}
void Dev_CAN_HandleCommand(const ParsedCommand_t *cmd) { record_cmd(&rec_can_cmd, cmd); }
void Dev_CAN_ServiceProtocol(void) {}
void Dev_CAN_ServiceLegacy(void) {}
void Dev_CAN_HandleLegacyByte(uint8_t byte) { (void)byte; }

void Dev_I2C_HandleCommand(const ParsedCommand_t *cmd) { record_cmd(&rec_i2c_cmd, cmd); }
void Dev_I2C_HandleLegacyByte(uint8_t byte) { (void)byte; }

/* can.c is not part of dev.c-based test binaries — count drain requests so
 * tests can assert that blocking waits keep servicing the CAN RX path. */
void CAN_DrainRxFifo(void) { rec_can_drain_calls++; }

/* ---- Helpers ---- */

static void feed_bytes(const char *bytes)
{
    const char *p;
    for (p = bytes; *p != '\0'; p++) {
        (void)ring_push(&rb_u1_rx, (uint8_t)*p);
    }
}

/* Feed one command line (appends CRLF) and run one poll cycle. */
static void feed_line_and_poll(const char *line)
{
    feed_bytes(line);
    feed_bytes("\r\n");
    Dev_Poll();
}

static int capture_contains(const char *needle)
{
    return strstr(stub_uart_tx_capture, needle) != NULL;
}

static void reset_module_records(void)
{
    memset(&rec_uart_cmd, 0, sizeof(rec_uart_cmd));
    memset(&rec_spi_cmd, 0, sizeof(rec_spi_cmd));
    memset(&rec_can_cmd, 0, sizeof(rec_can_cmd));
    memset(&rec_i2c_cmd, 0, sizeof(rec_i2c_cmd));
    rec_uart_legacy_bytes = 0;
    rec_uart_last_legacy_byte = 0;
    rec_can_drain_calls = 0;
}

/* Full reset of dev.c state between tests (avoids calling Dev_Init, which
 * touches MPU/NVIC paths that individual tests don't care about). */
static void reset_dev_state(void)
{
    ring_init(&rb_u1_rx);
    ring_init(&rb_u2_rx);
    ring_init(&rb_spi_tx);
    line_acc_reset(&g_line_acc);
    legacy_reset_matcher_reset();
    g_mode = DEV_MODE_PROTOCOL;
    u1_overflow_pending = 0U;
    u2_overflow_pending = 0U;
    memset(&g_uart_state, 0, sizeof(g_uart_state));
    memset(&g_spi_state, 0, sizeof(g_spi_state));
    memset(&g_can_state, 0, sizeof(g_can_state));
    memset(&g_i2c_state, 0, sizeof(g_i2c_state));
    memset(&g_wdg_state, 0, sizeof(g_wdg_state));
    IWDG->KR = 0U;
    IWDG->PR = 0U;
    IWDG->RLR = 0U;
    IWDG->SR = 0U;
    stub_uart_capture_reset();
    stub_tick_reset();
    reset_module_records();
}

#endif /* DEV_TEST_SUPPORT_H */
