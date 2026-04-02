/**
 * @file  dev_internal.h
 * @brief Internal shared definitions for the dev-layer protocol modules.
 */

#ifndef DEV_INTERNAL_H
#define DEV_INTERNAL_H

#include "dev.h"
#include "main.h"
#include "can.h"

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define RING_SIZE                 256U
#define RING_MASK                 (RING_SIZE - 1U)

#define MAX_LINE_CHARS            640U
#define MAX_EMIT_CHARS            704U
#define MAX_BINARY_PAYLOAD_BYTES  256U
#define MAX_COMMAND_ARGS          4U
#define UART1_RX_CHUNK_BYTES      64U

#define TX_TIMEOUT_MS             100U
#define UART_LOOP_TIMEOUT_MS      100U
#define SPI_TIMEOUT_MS            100U
#define I2C_TIMEOUT_MS            100U
#define SPI_POLL_MS               5U
#define SPI_IDLE_BYTE             0x00U
#define SPI_MAX_XFER_BYTES        156U
#define CAN_HEARTBEAT_ID          0x130U
#define CAN_HEARTBEAT_ENABLED     0U
#define CAN_HEARTBEAT_PERIOD_MS   10000U
#define CANFD_TX_CONFIRM_TIMEOUT_MS 25U
#define CAN_HEARTBEAT_RETRY_MS    10U
#define CAN_TX_ALL_BUFFERS_MASK   (FDCAN_TX_BUFFER0 | FDCAN_TX_BUFFER1 | FDCAN_TX_BUFFER2)
#define LEGACY_I2C_SLAVE_ADDR     0x50U

typedef struct {
    volatile uint16_t head;
    volatile uint16_t tail;
    uint8_t buf[RING_SIZE];
} RingBuf_t;

typedef struct {
    char buf[MAX_LINE_CHARS + 1U];
    uint16_t len;
    uint8_t overflow;
    uint8_t invalid;
} LineAccumulator_t;

typedef struct {
    char pending[sizeof("SYS:RESET\r\n") - 1U];
    uint8_t len;
} LegacyResetMatcher_t;

typedef enum {
    DEV_MODE_PROTOCOL = 0,
    DEV_MODE_LEGACY_MENU,
    DEV_MODE_LEGACY_UART,
    DEV_MODE_LEGACY_SPI,
    DEV_MODE_LEGACY_CAN,
    DEV_MODE_LEGACY_I2C
} DevMode_t;

typedef struct {
    uint8_t ready;
    uint8_t streaming;
    uint32_t rx_count;
    uint32_t tx_count;
    uint32_t error_count;
} UartProtoState_t;

typedef struct {
    uint8_t ready;
    uint32_t transfers;
} SpiProtoState_t;

typedef struct {
    uint8_t ready;
    uint8_t monitoring;
} CanProtoState_t;

typedef struct {
    uint8_t ready;
    uint8_t last_addr;
    uint32_t error_count;
} I2cProtoState_t;

typedef struct {
    char *domain;
    char *command;
    uint8_t argc;
    char *argv[MAX_COMMAND_ARGS];
} ParsedCommand_t;

extern SPI_HandleTypeDef hspi1;
extern UART_HandleTypeDef huart1;
extern UART_HandleTypeDef huart2;
extern FDCAN_HandleTypeDef hfdcan1;
extern I2C_HandleTypeDef hi2c1;
extern TIM_HandleTypeDef htim7;
extern HAL_StatusTypeDef CanStartStatus;

extern RingBuf_t rb_u1_rx;
extern RingBuf_t rb_u2_rx;
extern RingBuf_t rb_spi_tx;

extern uint8_t isr_u1_buf[UART1_RX_CHUNK_BYTES];
extern uint8_t isr_u2_byte;

extern volatile uint8_t u1_overflow_pending;
extern volatile uint8_t u2_overflow_pending;

extern LineAccumulator_t g_line_acc;
extern LegacyResetMatcher_t g_legacy_reset_matcher;
extern volatile DevMode_t g_mode;

extern UartProtoState_t g_uart_state;
extern SpiProtoState_t g_spi_state;
extern CanProtoState_t g_can_state;
extern I2cProtoState_t g_i2c_state;

extern uint32_t spi_last_poll;

void ring_init(RingBuf_t *r);
int ring_push(RingBuf_t *r, uint8_t byte);
int ring_pop(RingBuf_t *r, uint8_t *out);

void dwt_init(void);
void delay_us(uint32_t us);
void cs_low(void);
void cs_high(void);

void uart1_write_bytes(const uint8_t *data, uint16_t len);
void emit_line(const char *line);
void emit_frame(const char *domain, const char *token, const char *payload);
void emit_log(const char *level, const char *message);
void emit_fail(const char *domain, const char *reason);

void line_acc_reset(LineAccumulator_t *acc);
int line_acc_consume(LineAccumulator_t *acc, uint8_t byte, char *out_line);

void legacy_reset_matcher_reset(void);

bool parse_hex_byte(const char *text, uint8_t *out);
bool parse_hex_u32(const char *text, uint32_t *out);
bool parse_dec_u32(const char *text, uint32_t *out);
bool parse_hex_buffer(const char *text, uint8_t *out, uint16_t *out_len, uint16_t max_len);
bool bytes_to_hex(const uint8_t *src, uint16_t len, char *dst, size_t dst_size);

void uart2_flush_rx(void);
HAL_StatusTypeDef uart2_wait_for_byte(uint8_t *out, uint32_t timeout_ms);
void arm_uart1_receive(void);

void Dev_UART_HandleCommand(const ParsedCommand_t *cmd);
void Dev_UART_ServiceProtocol(void);
void Dev_UART_ServiceLegacy(void);
void Dev_UART_HandleLegacyByte(uint8_t byte);

void Dev_SPI_HandleCommand(const ParsedCommand_t *cmd);
void Dev_SPI_ServiceLegacy(void);
void Dev_SPI_HandleLegacyByte(uint8_t byte);

HAL_StatusTypeDef Dev_CAN_EnsureReady(void);
void Dev_CAN_ServiceBackground(void);
void Dev_CAN_HandleCommand(const ParsedCommand_t *cmd);
void Dev_CAN_ServiceProtocol(void);
void Dev_CAN_ServiceLegacy(void);
void Dev_CAN_HandleLegacyByte(uint8_t byte);

void Dev_I2C_HandleCommand(const ParsedCommand_t *cmd);
void Dev_I2C_HandleLegacyByte(uint8_t byte);

#endif /* DEV_INTERNAL_H */
