/**
 * @file  dev.c
 * @brief Protocol-first control layer glue for the dev board.
 *
 * CHANGES FROM ORIGINAL:
 *   - Dev_Init: MPU region added to mark the FDCAN1 message RAM as
 *     non-bufferable, non-cacheable, shareable memory before any FDCAN
 *     access occurs. This prevents CPU writes to RXF0A from being buffered
 *     by the Cortex-M33 write buffer, which was causing AHB bus arbitration
 *     collisions with the FDCAN peripheral and triggering MRAF on every frame.
 */

#include "dev_internal.h"

#include <stdio.h>
#include <string.h>

#define BOARD_NAME            "devboard"
#define CAPS_STRING           "UART,SPI,CANFD,I2C,UART_STREAM,CANFD_MONITOR,I2C_SCAN,I2C_READ_REG8"
#define LEGACY_RESET_SEQUENCE "SYS:RESET\r\n"

RingBuf_t rb_u1_rx;
RingBuf_t rb_u2_rx;
RingBuf_t rb_spi_tx;

uint8_t isr_u1_buf[UART1_RX_CHUNK_BYTES];
uint8_t isr_u2_byte;

volatile uint8_t u1_overflow_pending = 0U;
volatile uint8_t u2_overflow_pending = 0U;

LineAccumulator_t g_line_acc;
LegacyResetMatcher_t g_legacy_reset_matcher;
volatile DevMode_t g_mode = DEV_MODE_PROTOCOL;

UartProtoState_t g_uart_state;
SpiProtoState_t g_spi_state;
CanProtoState_t g_can_state;
I2cProtoState_t g_i2c_state;

uint32_t spi_last_poll = 0U;

static void handle_sys_command(const ParsedCommand_t *cmd);
static int split_preserve_empty(char *line, char *tokens[], size_t max_tokens);
static bool parse_command_line(char *line, ParsedCommand_t *cmd);
static void dispatch_command_line(const char *line);
static bool parse_hex_nibble(char c, uint8_t *out);
static bool legacy_reset_matcher_consume(uint8_t byte);
static void legacy_dispatch_byte(uint8_t byte);
static void legacy_print_menu(void);
static void legacy_announce_mode(DevMode_t mode);
static void enter_legacy_mode(void);
static void exit_legacy_mode(bool emit_protocol_info);
static char *trim_ascii_whitespace(char *text);
static void uppercase_ascii_inplace(char *text);
static void service_protocol_mode(void);
static void service_protocol_overflow_logs(void);
static void service_legacy_mode(void);

void ring_init(RingBuf_t *r)
{
    r->head = 0U;
    r->tail = 0U;
}

int ring_push(RingBuf_t *r, uint8_t byte)
{
    uint16_t next = (uint16_t)((r->head + 1U) & RING_MASK);
    if (next == r->tail) {
        return -1;
    }
    r->buf[r->head] = byte;
    r->head = next;
    return 0;
}

int ring_pop(RingBuf_t *r, uint8_t *out)
{
    if (r->head == r->tail) {
        return -1;
    }
    *out = r->buf[r->tail];
    r->tail = (uint16_t)((r->tail + 1U) & RING_MASK);
    return 0;
}

void dwt_init(void)
{
    CoreDebug->DEMCR |= CoreDebug_DEMCR_TRCENA_Msk;
    DWT->CYCCNT = 0U;
    DWT->CTRL |= DWT_CTRL_CYCCNTENA_Msk;
}

void delay_us(uint32_t us)
{
    const uint32_t clk_mhz = HAL_RCC_GetHCLKFreq() / 1000000U;
    const uint32_t ticks = us * clk_mhz;
    const uint32_t start = DWT->CYCCNT;
    while ((DWT->CYCCNT - start) < ticks) {
    }
}

void cs_low(void)
{
    HAL_GPIO_WritePin(GPIOA, GPIO_PIN_4, GPIO_PIN_RESET);
    delay_us(1U);
}

void cs_high(void)
{
    delay_us(1U);
    HAL_GPIO_WritePin(GPIOA, GPIO_PIN_4, GPIO_PIN_SET);
}

void uart1_write_bytes(const uint8_t *data, uint16_t len)
{
    if (len == 0U) {
        return;
    }
    (void)HAL_UART_Transmit(&huart1, (uint8_t *)data, len, TX_TIMEOUT_MS);
}

void emit_line(const char *line)
{
    static const uint8_t crlf[] = "\r\n";
    uart1_write_bytes((const uint8_t *)line, (uint16_t)strlen(line));
    uart1_write_bytes(crlf, (uint16_t)(sizeof(crlf) - 1U));
}

void emit_frame(const char *domain, const char *token, const char *payload)
{
    char line[MAX_EMIT_CHARS];

    if ((payload == NULL) || (payload[0] == '\0')) {
        (void)snprintf(line, sizeof(line), "%s:%s:", domain, token);
    } else {
        (void)snprintf(line, sizeof(line), "%s:%s:%s", domain, token, payload);
    }
    emit_line(line);
}

void emit_log(const char *level, const char *message)
{
    emit_frame("LOG", level, message);
}

void emit_fail(const char *domain, const char *reason)
{
    char payload[64];

    (void)snprintf(payload, sizeof(payload), "reason=%s", reason);
    emit_frame(domain, "FAIL", payload);
}

void line_acc_reset(LineAccumulator_t *acc)
{
    acc->len = 0U;
    acc->overflow = 0U;
    acc->invalid = 0U;
    acc->buf[0] = '\0';
}

int line_acc_consume(LineAccumulator_t *acc, uint8_t byte, char *out_line)
{
    if ((byte == '\r') || (byte == '\n')) {
        if (acc->overflow != 0U) {
            line_acc_reset(acc);
            return -2;
        }
        if (acc->invalid != 0U) {
            line_acc_reset(acc);
            return -3;
        }
        if (acc->len == 0U) {
            line_acc_reset(acc);
            return 0;
        }

        acc->buf[acc->len] = '\0';
        (void)strncpy(out_line, acc->buf, MAX_LINE_CHARS + 1U);
        line_acc_reset(acc);
        return 1;
    }

    if ((byte < 0x20U) || (byte > 0x7EU)) {
        return 0;
    }

    if (acc->len >= MAX_LINE_CHARS) {
        acc->overflow = 1U;
        return 0;
    }

    acc->buf[acc->len++] = (char)byte;
    acc->buf[acc->len] = '\0';
    return 0;
}

void legacy_reset_matcher_reset(void)
{
    g_legacy_reset_matcher.len = 0U;
}

static int split_preserve_empty(char *line, char *tokens[], size_t max_tokens)
{
    size_t token_count = 0U;
    char *start = line;
    char *cursor = line;

    for (;;) {
        if ((*cursor == ':') || (*cursor == '\0')) {
            if (token_count >= max_tokens) {
                return -1;
            }
            tokens[token_count++] = start;
            if (*cursor == '\0') {
                break;
            }
            *cursor = '\0';
            start = cursor + 1;
        }
        cursor++;
    }

    return (int)token_count;
}

static char *trim_ascii_whitespace(char *text)
{
    char *start = text;
    char *end;

    if (text == NULL) {
        return NULL;
    }

    while ((*start == ' ') || (*start == '\t')) {
        start++;
    }

    end = start + strlen(start);
    while ((end > start) && ((end[-1] == ' ') || (end[-1] == '\t'))) {
        end--;
    }
    *end = '\0';

    return start;
}

static void uppercase_ascii_inplace(char *text)
{
    if (text == NULL) {
        return;
    }

    while (*text != '\0') {
        if ((*text >= 'a') && (*text <= 'z')) {
            *text = (char)(*text - ('a' - 'A'));
        }
        text++;
    }
}

static bool parse_command_line(char *line, ParsedCommand_t *cmd)
{
    char *tokens[2U + MAX_COMMAND_ARGS];
    int count;
    uint8_t i;
    char *trimmed;

    trimmed = trim_ascii_whitespace(line);
    if ((trimmed == NULL) || (trimmed[0] == '\0')) {
        return false;
    }

    count = split_preserve_empty(trimmed, tokens, 2U + MAX_COMMAND_ARGS);
    if ((count < 2) || (count > (int)(2U + MAX_COMMAND_ARGS))) {
        return false;
    }
    if ((tokens[0][0] == '\0') || (tokens[1][0] == '\0')) {
        return false;
    }

    uppercase_ascii_inplace(tokens[0]);
    uppercase_ascii_inplace(tokens[1]);
    cmd->domain = tokens[0];
    cmd->command = tokens[1];
    cmd->argc = (uint8_t)(count - 2);
    for (i = 0U; i < cmd->argc; i++) {
        cmd->argv[i] = tokens[i + 2U];
    }
    return true;
}

static bool parse_hex_nibble(char c, uint8_t *out)
{
    if ((c >= '0') && (c <= '9')) {
        *out = (uint8_t)(c - '0');
        return true;
    }
    if ((c >= 'A') && (c <= 'F')) {
        *out = (uint8_t)(c - 'A' + 10);
        return true;
    }
    return false;
}

bool parse_hex_byte(const char *text, uint8_t *out)
{
    uint8_t high;
    uint8_t low;

    if ((text == NULL) || (strlen(text) != 2U)) {
        return false;
    }

    if (!parse_hex_nibble(text[0], &high) || !parse_hex_nibble(text[1], &low)) {
        return false;
    }

    *out = (uint8_t)((high << 4) | low);
    return true;
}

bool parse_hex_u32(const char *text, uint32_t *out)
{
    uint32_t value = 0U;
    size_t i;
    size_t len;
    char c;

    if (text == NULL) {
        return false;
    }

    len = strlen(text);
    if ((len == 0U) || (len > 8U)) {
        return false;
    }

    for (i = 0U; i < len; i++) {
        c = text[i];
        value <<= 4;
        if ((c >= '0') && (c <= '9')) {
            value |= (uint32_t)(c - '0');
        } else if ((c >= 'A') && (c <= 'F')) {
            value |= (uint32_t)(c - 'A' + 10);
        } else {
            return false;
        }
    }

    *out = value;
    return true;
}

bool parse_dec_u32(const char *text, uint32_t *out)
{
    uint32_t value = 0U;
    size_t i;
    size_t len;

    if (text == NULL) {
        return false;
    }

    len = strlen(text);
    if (len == 0U) {
        return false;
    }

    for (i = 0U; i < len; i++) {
        if ((text[i] < '0') || (text[i] > '9')) {
            return false;
        }
        value = (value * 10U) + (uint32_t)(text[i] - '0');
    }

    *out = value;
    return true;
}

bool parse_hex_buffer(const char *text, uint8_t *out, uint16_t *out_len, uint16_t max_len)
{
    size_t len;
    uint16_t i;
    uint8_t high;
    uint8_t low;

    if ((text == NULL) || (out == NULL) || (out_len == NULL)) {
        return false;
    }

    len = strlen(text);
    if ((len & 1U) != 0U) {
        return false;
    }

    if ((len / 2U) > max_len) {
        return false;
    }

    *out_len = (uint16_t)(len / 2U);
    for (i = 0U; i < *out_len; i++) {
        if (!parse_hex_nibble(text[i * 2U], &high) ||
            !parse_hex_nibble(text[i * 2U + 1U], &low)) {
            return false;
        }
        out[i] = (uint8_t)((high << 4) | low);
    }

    return true;
}

bool bytes_to_hex(const uint8_t *src, uint16_t len, char *dst, size_t dst_size)
{
    static const char hex[] = "0123456789ABCDEF";
    uint16_t i;

    if (dst_size < ((size_t)len * 2U + 1U)) {
        return false;
    }

    for (i = 0U; i < len; i++) {
        dst[i * 2U] = hex[(src[i] >> 4) & 0x0FU];
        dst[i * 2U + 1U] = hex[src[i] & 0x0FU];
    }
    dst[len * 2U] = '\0';
    return true;
}

static void dispatch_command_line(const char *line)
{
    char mutable_line[MAX_LINE_CHARS + 1U];
    char payload[MAX_LINE_CHARS + 32U];
    ParsedCommand_t cmd;

    (void)strncpy(mutable_line, line, sizeof(mutable_line));
    mutable_line[sizeof(mutable_line) - 1U] = '\0';

    if (!parse_command_line(mutable_line, &cmd)) {
        (void)snprintf(payload, sizeof(payload), "reason=bad-frame;line=%s", mutable_line);
        emit_log("WARN", payload);
        return;
    }

    if (strcmp(cmd.domain, "SYS") == 0) {
        handle_sys_command(&cmd);
    } else if (strcmp(cmd.domain, "UART") == 0) {
        Dev_UART_HandleCommand(&cmd);
    } else if (strcmp(cmd.domain, "SPI") == 0) {
        Dev_SPI_HandleCommand(&cmd);
    } else if (strcmp(cmd.domain, "CANFD") == 0) {
        Dev_CAN_HandleCommand(&cmd);
    } else if (strcmp(cmd.domain, "I2C") == 0) {
        Dev_I2C_HandleCommand(&cmd);
    } else {
        emit_log("WARN", "reason=unknown-domain");
    }
}

static void handle_sys_command(const ParsedCommand_t *cmd)
{
    char payload[MAX_EMIT_CHARS];

    if (strcmp(cmd->command, "HELLO") == 0) {
        if (cmd->argc != 0U) {
            emit_fail("SYS", "bad-arg");
            return;
        }
        (void)snprintf(payload, sizeof(payload),
                       "proto=%s;fw=%s;board=%s;caps=%s;legacy=1",
                       PROTOCOL_VERSION, FW_VERSION, BOARD_NAME, CAPS_STRING);
        emit_frame("SYS", "INFO", payload);
        return;
    }

    if (strcmp(cmd->command, "CAPS") == 0) {
        if (cmd->argc != 0U) {
            emit_fail("SYS", "bad-arg");
            return;
        }
        (void)snprintf(payload, sizeof(payload), "caps=%s", CAPS_STRING);
        emit_frame("SYS", "INFO", payload);
        return;
    }

    if (strcmp(cmd->command, "PING") == 0) {
        if (cmd->argc != 0U) {
            emit_fail("SYS", "bad-arg");
            return;
        }
        emit_frame("SYS", "INFO", "pong=1");
        return;
    }

    if (strcmp(cmd->command, "MODE") == 0) {
        if ((cmd->argc != 1U) || (strcmp(cmd->argv[0], "LEGACY") != 0)) {
            emit_fail("SYS", "bad-arg");
            return;
        }
        emit_frame("SYS", "INFO", "mode=legacy");
        enter_legacy_mode();
        return;
    }

    if (strcmp(cmd->command, "RESET") == 0) {
        if (cmd->argc != 0U) {
            emit_fail("SYS", "bad-arg");
            return;
        }
        exit_legacy_mode(true);
        return;
    }

    emit_fail("SYS", "unknown-command");
}

static bool legacy_reset_matcher_consume(uint8_t byte)
{
    static const char target[] = LEGACY_RESET_SEQUENCE;
    uint8_t flush_index;

    if (byte == (uint8_t)target[g_legacy_reset_matcher.len]) {
        g_legacy_reset_matcher.pending[g_legacy_reset_matcher.len++] = (char)byte;
        if (g_legacy_reset_matcher.len == (sizeof(target) - 1U)) {
            legacy_reset_matcher_reset();
            return true;
        }
        return false;
    }

    for (flush_index = 0U; flush_index < g_legacy_reset_matcher.len; flush_index++) {
        legacy_dispatch_byte((uint8_t)g_legacy_reset_matcher.pending[flush_index]);
    }
    legacy_reset_matcher_reset();

    if (byte == (uint8_t)target[0]) {
        g_legacy_reset_matcher.pending[0] = (char)byte;
        g_legacy_reset_matcher.len = 1U;
        return false;
    }

    legacy_dispatch_byte(byte);
    return false;
}

static void legacy_print_menu(void)
{
    emit_line("");
    emit_line("=== Comm Test Menu (LEGACY) ===");
    emit_line("1) UART bridge (USART1 <-> USART2 PD5/PD6)");
    emit_line("2) SPI test (UART1 -> SPI1 MASTER)");
    emit_line("3) CAN test (UART1 <-> FDCAN1)");
    emit_line("4) I2C test (I2C1 PB8/PB9, fixed slave 0x50)");
    emit_line("m) Show this menu");
    uart1_write_bytes((const uint8_t *)"Select: ", 8U);
}

static void legacy_announce_mode(DevMode_t mode)
{
    switch (mode) {
        case DEV_MODE_LEGACY_UART:
            emit_line("");
            emit_line("[Legacy Mode] UART bridge.");
            emit_line("Type on the terminal to forward bytes across USART2. 'm' for menu.");
            break;
        case DEV_MODE_LEGACY_SPI:
            emit_line("");
            emit_line("[Legacy Mode] SPI master.");
            emit_line("Type on the terminal; each byte clocks one SPI transfer. 'm' for menu.");
            break;
        case DEV_MODE_LEGACY_CAN:
            emit_line("");
            emit_line("[Legacy Mode] CAN bridge.");
            emit_line("Type on the terminal to transmit via FDCAN1. 'm' for menu.");
            break;
        case DEV_MODE_LEGACY_I2C:
            emit_line("");
            emit_line("[Legacy Mode] I2C master.");
            emit_line("Type bytes to send to the fixed legacy slave 0x50. 'm' for menu.");
            break;
        default:
            break;
    }
}

static void enter_legacy_mode(void)
{
    g_uart_state.streaming = 0U;
    g_can_state.monitoring = 0U;
    ring_init(&rb_spi_tx);
    uart2_flush_rx();
    g_mode = DEV_MODE_LEGACY_MENU;
    line_acc_reset(&g_line_acc);
    legacy_reset_matcher_reset();
    legacy_print_menu();
}

static void exit_legacy_mode(bool emit_protocol_info)
{
    g_mode = DEV_MODE_PROTOCOL;
    line_acc_reset(&g_line_acc);
    legacy_reset_matcher_reset();
    ring_init(&rb_spi_tx);
    uart2_flush_rx();
    if (emit_protocol_info) {
        emit_frame("SYS", "INFO", "mode=protocol");
    }
}

static void service_protocol_mode(void)
{
    uint8_t byte;
    char line[MAX_LINE_CHARS + 1U];
    int line_result;

    while (ring_pop(&rb_u1_rx, &byte) == 0) {
        line_result = line_acc_consume(&g_line_acc, byte, line);
        if (line_result == 1) {
            dispatch_command_line(line);
        } else if (line_result == -2) {
            emit_log("WARN", "reason=line-too-long");
        } else if (line_result == -3) {
            emit_log("WARN", "reason=bad-frame");
        }
    }

    service_protocol_overflow_logs();
    Dev_UART_ServiceProtocol();
    Dev_CAN_ServiceProtocol();
}

static void service_protocol_overflow_logs(void)
{
    if (u1_overflow_pending != 0U) {
        u1_overflow_pending = 0U;
        emit_log("WARN", "reason=uart1-rx-overflow");
    }

    if (u2_overflow_pending != 0U) {
        u2_overflow_pending = 0U;
        g_uart_state.error_count++;
        emit_log("WARN", "reason=uart2-rx-overflow");
    }
}

static void service_legacy_mode(void)
{
    uint8_t byte;

    while (ring_pop(&rb_u1_rx, &byte) == 0) {
        if (legacy_reset_matcher_consume(byte)) {
            exit_legacy_mode(true);
            return;
        }
    }

    switch (g_mode) {
        case DEV_MODE_LEGACY_UART:
            Dev_UART_ServiceLegacy();
            break;
        case DEV_MODE_LEGACY_SPI:
            Dev_SPI_ServiceLegacy();
            break;
        case DEV_MODE_LEGACY_CAN:
            Dev_CAN_ServiceLegacy();
            break;
        case DEV_MODE_LEGACY_I2C:
        case DEV_MODE_LEGACY_MENU:
        default:
            break;
    }
}

static void legacy_dispatch_byte(uint8_t byte)
{
    switch (g_mode) {
        case DEV_MODE_LEGACY_MENU:
            if (byte == '1') {
                g_mode = DEV_MODE_LEGACY_UART;
                legacy_announce_mode(g_mode);
            } else if (byte == '2') {
                g_mode = DEV_MODE_LEGACY_SPI;
                legacy_announce_mode(g_mode);
            } else if (byte == '3') {
                if (Dev_CAN_EnsureReady() != HAL_OK) {
                    emit_line("[Legacy] CAN init failed.");
                    break;
                }
                g_mode = DEV_MODE_LEGACY_CAN;
                legacy_announce_mode(g_mode);
            } else if (byte == '4') {
                g_mode = DEV_MODE_LEGACY_I2C;
                legacy_announce_mode(g_mode);
            } else if ((byte == 'm') || (byte == 'M')) {
                legacy_print_menu();
            } else if ((byte != '\r') && (byte != '\n')) {
                emit_line("");
                emit_line("Invalid.");
                legacy_print_menu();
            }
            break;

        case DEV_MODE_LEGACY_UART:
            if ((byte == 'm') || (byte == 'M')) {
                g_mode = DEV_MODE_LEGACY_MENU;
                legacy_print_menu();
                return;
            }
            Dev_UART_HandleLegacyByte(byte);
            break;

        case DEV_MODE_LEGACY_SPI:
            if ((byte == 'm') || (byte == 'M')) {
                g_mode = DEV_MODE_LEGACY_MENU;
                legacy_print_menu();
                return;
            }
            Dev_SPI_HandleLegacyByte(byte);
            break;

        case DEV_MODE_LEGACY_CAN:
            if ((byte == 'm') || (byte == 'M')) {
                g_mode = DEV_MODE_LEGACY_MENU;
                legacy_print_menu();
                return;
            }
            Dev_CAN_HandleLegacyByte(byte);
            break;

        case DEV_MODE_LEGACY_I2C:
            if ((byte == 'm') || (byte == 'M')) {
                g_mode = DEV_MODE_LEGACY_MENU;
                legacy_print_menu();
                return;
            }
            Dev_I2C_HandleLegacyByte(byte);
            break;

        default:
            break;
    }
}

void uart2_flush_rx(void)
{
    uint8_t byte;

    while (ring_pop(&rb_u2_rx, &byte) == 0) {
    }
}

HAL_StatusTypeDef uart2_wait_for_byte(uint8_t *out, uint32_t timeout_ms)
{
    uint32_t start = HAL_GetTick();

    while ((HAL_GetTick() - start) < timeout_ms) {
        if (ring_pop(&rb_u2_rx, out) == 0) {
            return HAL_OK;
        }
    }

    return HAL_TIMEOUT;
}

void arm_uart1_receive(void)
{
    (void)HAL_UARTEx_ReceiveToIdle_IT(&huart1, isr_u1_buf, sizeof(isr_u1_buf));
}

void Dev_Init(void)
{
    /* Configure MPU region for FDCAN1 message RAM as non-bufferable,
     * non-cacheable, shareable memory BEFORE any FDCAN peripheral access.
     *
     * WHY: The STM32U5 FDCAN message RAM is shared between the CPU (AHB bus)
     * and the FDCAN peripheral. When the CPU writes to RXF0A to acknowledge
     * a received frame, the Cortex-M33 write buffer can hold that write
     * pending while the FDCAN peripheral simultaneously tries to write a new
     * incoming frame to an adjacent RAM slot. The AHB arbiter has to choose
     * one, and if the FDCAN peripheral loses too many arbitration rounds it
     * fires MRAF (Message RAM Access Failure) and drops the frame.
     *
     * Marking the region as non-bufferable (Device memory type) forces CPU
     * writes to complete and release the bus before execution continues,
     * eliminating the arbitration collision window entirely.
     *
     * FDCAN1 message RAM base on STM32U575: 0x4002A400
     * Size: 4KB region covers the full message RAM allocation.
     * Region number 0 is used — adjust if your MPU already uses it. */
/* Configure MPU for FDCAN1 message RAM — ARMv8-M API (Cortex-M33 / STM32U5).
 * Marks the region as Device nGnRnE: non-bufferable, non-cacheable, non-reorderable.
 * Forces CPU writes to RXF0A to complete before the bus is released, eliminating
 * the AHB arbitration collision with FDCAN peripheral RAM writes that caused MRAF. */
    /* Configure MPU for FDCAN1 message RAM.
 * STM32U575 SRAMCAN base: 0x4000AC00, size 5120 bytes (0x1400).
 * Device nGnRnE: non-bufferable, forces CPU writes to complete before
 * bus is released, eliminating arbitration collisions with FDCAN peripheral. */
    MPU_Attributes_InitTypeDef mpu_attr   = {0};
    MPU_Region_InitTypeDef     mpu_region = {0};

    HAL_MPU_Disable();

    mpu_attr.Number     = MPU_ATTRIBUTES_NUMBER0;
    mpu_attr.Attributes = MPU_DEVICE_NGNRNE;
    HAL_MPU_ConfigMemoryAttributes(&mpu_attr);

    mpu_region.Enable           = MPU_REGION_ENABLE;
    mpu_region.Number           = MPU_REGION_NUMBER0;
    mpu_region.BaseAddress      = 0x4000AC00U;   /* SRAMCAN_BASE on STM32U575 */
    mpu_region.LimitAddress     = 0x4000BFFFU;  /* base + 5120 bytes - 1     */
    mpu_region.AttributesIndex  = MPU_ATTRIBUTES_NUMBER0;
    mpu_region.AccessPermission = MPU_REGION_ALL_RW;
    mpu_region.DisableExec      = MPU_INSTRUCTION_ACCESS_DISABLE;
    mpu_region.IsShareable      = MPU_ACCESS_NOT_SHAREABLE;
    HAL_MPU_ConfigRegion(&mpu_region);

    HAL_MPU_Enable(MPU_PRIVILEGED_DEFAULT);

    ring_init(&rb_u1_rx);
    ring_init(&rb_u2_rx);
    ring_init(&rb_spi_tx);

    line_acc_reset(&g_line_acc);
    legacy_reset_matcher_reset();

    memset(&g_uart_state, 0, sizeof(g_uart_state));
    memset(&g_spi_state, 0, sizeof(g_spi_state));
    memset(&g_can_state, 0, sizeof(g_can_state));
    memset(&g_i2c_state, 0, sizeof(g_i2c_state));

    dwt_init();
    cs_high();

    HAL_NVIC_SetPriority(USART1_IRQn, 1U, 0U);
    HAL_NVIC_EnableIRQ(USART1_IRQn);
    HAL_NVIC_SetPriority(USART2_IRQn, 1U, 0U);
    HAL_NVIC_EnableIRQ(USART2_IRQn);

    arm_uart1_receive();
    (void)HAL_UART_Receive_IT(&huart2, &isr_u2_byte, 1U);

    g_mode = DEV_MODE_PROTOCOL;
}

void Dev_Poll(void)
{
    if (g_mode == DEV_MODE_PROTOCOL) {
        service_protocol_mode();
    } else {
        service_legacy_mode();
    }
    Dev_CAN_ServiceBackground();
}

void Dev_UART_RxCpltCallback(UART_HandleTypeDef *huart)
{
    if (huart == &huart2) {
        if (ring_push(&rb_u2_rx, isr_u2_byte) != 0) {
            u2_overflow_pending = 1U;
        }
        (void)HAL_UART_Receive_IT(&huart2, &isr_u2_byte, 1U);
    }
}

void Dev_UART_RxEventCallback(UART_HandleTypeDef *huart, uint16_t size)
{
    uint16_t i;

    if (huart != &huart1) {
        return;
    }

    for (i = 0U; i < size; i++) {
        if (ring_push(&rb_u1_rx, isr_u1_buf[i]) != 0) {
            u1_overflow_pending = 1U;
        }
    }

    arm_uart1_receive();
}

void Dev_UART_ErrorCallback(UART_HandleTypeDef *huart)
{
    __HAL_UART_CLEAR_FLAG(huart, UART_CLEAR_OREF);
    __HAL_UART_CLEAR_FLAG(huart, UART_CLEAR_NEF);
    __HAL_UART_CLEAR_FLAG(huart, UART_CLEAR_FEF);
    __HAL_UART_CLEAR_FLAG(huart, UART_CLEAR_PEF);

    if (huart == &huart1) {
        arm_uart1_receive();
    } else if (huart == &huart2) {
        g_uart_state.error_count++;
        (void)HAL_UART_Receive_IT(&huart2, &isr_u2_byte, 1U);
    }
}