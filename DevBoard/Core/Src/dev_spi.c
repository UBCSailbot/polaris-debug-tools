/**
 * @file  dev_spi.c
 * @brief SPI protocol and legacy-mode handlers for the dev layer.
 */

#include "dev_internal.h"

#include <stdio.h>
#include <string.h>

void Dev_SPI_HandleCommand(const ParsedCommand_t *cmd)
{
    uint8_t tx_buf[SPI_MAX_XFER_BYTES];
    uint8_t rx_buf[SPI_MAX_XFER_BYTES];
    uint16_t len;
    char tx_hex[SPI_MAX_XFER_BYTES * 2U + 1U];
    char rx_hex[SPI_MAX_XFER_BYTES * 2U + 1U];
    char payload[MAX_EMIT_CHARS];
    HAL_StatusTypeDef st;

    if (strcmp(cmd->command, "INIT") == 0) {
        if (cmd->argc != 0U) {
            emit_fail("SPI", "bad-arg");
            return;
        }
        g_spi_state.ready = 1U;
        g_spi_state.transfers = 0U;
        cs_high();
        emit_frame("SPI", "PASS", "ready=1");
        return;
    }

    if (!g_spi_state.ready) {
        emit_fail("SPI", "not-init");
        return;
    }

    if (strcmp(cmd->command, "XFER") == 0) {
        if ((cmd->argc != 1U) ||
            !parse_hex_buffer(cmd->argv[0], tx_buf, &len, SPI_MAX_XFER_BYTES) ||
            (len == 0U)) {
            emit_fail("SPI", "bad-arg");
            return;
        }

        memset(rx_buf, 0, len);
        cs_low();
        st = HAL_SPI_TransmitReceive(&hspi1, tx_buf, rx_buf, len, SPI_TIMEOUT_MS);
        cs_high();

        if (st == HAL_TIMEOUT) {
            emit_frame("SPI", "TIMEOUT", "reason=transfer-timeout");
            return;
        }
        if (st != HAL_OK) {
            emit_fail("SPI", "transfer-failed");
            return;
        }

        if (!bytes_to_hex(tx_buf, len, tx_hex, sizeof(tx_hex)) ||
            !bytes_to_hex(rx_buf, len, rx_hex, sizeof(rx_hex))) {
            emit_fail("SPI", "internal");
            return;
        }

        g_spi_state.transfers++;
        HAL_GPIO_TogglePin(LED_GREEN_GPIO_Port, LED_GREEN_Pin);

        (void)snprintf(payload, sizeof(payload), "tx=%s;rx=%s", tx_hex, rx_hex);
        emit_frame("SPI", "PASS", payload);
        return;
    }

    if (strcmp(cmd->command, "STATUS") == 0) {
        if (cmd->argc != 0U) {
            emit_fail("SPI", "bad-arg");
            return;
        }
        (void)snprintf(payload, sizeof(payload), "transfers=%lu",
                       (unsigned long)g_spi_state.transfers);
        emit_frame("SPI", "PASS", payload);
        return;
    }

    emit_fail("SPI", "unknown-command");
}

void Dev_SPI_ServiceLegacy(void)
{
    uint8_t tx;
    uint8_t rx;
    HAL_StatusTypeDef st;
    uint32_t now;

    while (ring_pop(&rb_spi_tx, &tx) == 0) {
        rx = 0U;
        cs_low();
        st = HAL_SPI_TransmitReceive(&hspi1, &tx, &rx, 1U, 20U);
        cs_high();

        if ((st == HAL_OK) && (rx != SPI_IDLE_BYTE)) {
            uart1_write_bytes(&rx, 1U);
            HAL_GPIO_TogglePin(LED_GREEN_GPIO_Port, LED_GREEN_Pin);
        }
    }

    now = HAL_GetTick();
    if ((now - spi_last_poll) >= SPI_POLL_MS) {
        spi_last_poll = now;
        tx = SPI_IDLE_BYTE;
        rx = 0U;
        cs_low();
        st = HAL_SPI_TransmitReceive(&hspi1, &tx, &rx, 1U, 10U);
        cs_high();

        if ((st == HAL_OK) && (rx != SPI_IDLE_BYTE)) {
            uart1_write_bytes(&rx, 1U);
            HAL_GPIO_TogglePin(LED_GREEN_GPIO_Port, LED_GREEN_Pin);
        }
    }
}

void Dev_SPI_HandleLegacyByte(uint8_t byte)
{
    uart1_write_bytes(&byte, 1U);
    (void)ring_push(&rb_spi_tx, byte);
    HAL_GPIO_TogglePin(LED_RED_GPIO_Port, LED_RED_Pin);
}
