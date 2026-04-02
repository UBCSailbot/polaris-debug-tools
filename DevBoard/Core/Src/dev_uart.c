/**
 * @file  dev_uart.c
 * @brief UART protocol and legacy-mode handlers for the dev layer.
 */

#include "dev_internal.h"

#include <stdio.h>
#include <string.h>

void Dev_UART_HandleCommand(const ParsedCommand_t *cmd)
{
    uint8_t byte_value;
    uint8_t rx_byte;
    char payload[96];

    if (strcmp(cmd->command, "INIT") == 0) {
        if (cmd->argc != 0U) {
            emit_fail("UART", "bad-arg");
            return;
        }
        memset(&g_uart_state, 0, sizeof(g_uart_state));
        g_uart_state.ready = 1U;
        uart2_flush_rx();
        emit_frame("UART", "PASS", "ready=1");
        return;
    }

    if (!g_uart_state.ready) {
        emit_fail("UART", "not-init");
        return;
    }

    if (strcmp(cmd->command, "LOOP") == 0) {
        if ((cmd->argc != 1U) || !parse_hex_byte(cmd->argv[0], &byte_value)) {
            emit_fail("UART", "bad-arg");
            return;
        }
        if (g_uart_state.streaming != 0U) {
            emit_fail("UART", "streaming-active");
            return;
        }

        uart2_flush_rx();
        if (HAL_UART_Transmit(&huart2, &byte_value, 1U, TX_TIMEOUT_MS) != HAL_OK) {
            g_uart_state.error_count++;
            emit_fail("UART", "tx-failed");
            return;
        }

        g_uart_state.tx_count++;

        if (uart2_wait_for_byte(&rx_byte, UART_LOOP_TIMEOUT_MS) != HAL_OK) {
            g_uart_state.error_count++;
            emit_fail("UART", "no-echo");
            return;
        }

        g_uart_state.rx_count++;
        (void)snprintf(payload, sizeof(payload), "rx=%02X", rx_byte);
        emit_frame("UART", "PASS", payload);
        return;
    }

    if (strcmp(cmd->command, "STREAM") == 0) {
        if (cmd->argc != 1U) {
            emit_fail("UART", "bad-arg");
            return;
        }

        if (strcmp(cmd->argv[0], "START") == 0) {
            uart2_flush_rx();
            g_uart_state.streaming = 1U;
            emit_frame("UART", "PASS", "streaming=1");
            return;
        }
        if (strcmp(cmd->argv[0], "STOP") == 0) {
            g_uart_state.streaming = 0U;
            emit_frame("UART", "PASS", "streaming=0");
            return;
        }

        emit_fail("UART", "bad-arg");
        return;
    }

    if (strcmp(cmd->command, "STATUS") == 0) {
        if (cmd->argc != 0U) {
            emit_fail("UART", "bad-arg");
            return;
        }
        (void)snprintf(payload, sizeof(payload), "rx=%lu;tx=%lu;errors=%lu",
                       (unsigned long)g_uart_state.rx_count,
                       (unsigned long)g_uart_state.tx_count,
                       (unsigned long)g_uart_state.error_count);
        emit_frame("UART", "PASS", payload);
        return;
    }

    emit_fail("UART", "unknown-command");
}

void Dev_UART_ServiceProtocol(void)
{
    uint8_t buf[32];
    uint16_t count;
    char hex[sizeof(buf) * 2U + 1U];

    if ((g_uart_state.ready == 0U) || (g_uart_state.streaming == 0U)) {
        return;
    }

    do {
        count = 0U;
        while ((count < (uint16_t)sizeof(buf)) && (ring_pop(&rb_u2_rx, &buf[count]) == 0)) {
            count++;
            g_uart_state.rx_count++;
        }

        if ((count != 0U) && bytes_to_hex(buf, count, hex, sizeof(hex))) {
            emit_frame("UART", "DATA", hex);
        }
    } while (count == (uint16_t)sizeof(buf));
}

void Dev_UART_ServiceLegacy(void)
{
    uint8_t byte;

    while (ring_pop(&rb_u2_rx, &byte) == 0) {
        uart1_write_bytes(&byte, 1U);
        HAL_GPIO_TogglePin(LED_GREEN_GPIO_Port, LED_GREEN_Pin);
    }
}

void Dev_UART_HandleLegacyByte(uint8_t byte)
{
    uart1_write_bytes(&byte, 1U);
    (void)HAL_UART_Transmit(&huart2, &byte, 1U, TX_TIMEOUT_MS);
    HAL_GPIO_TogglePin(LED_BLUE_GPIO_Port, LED_BLUE_Pin);
}
