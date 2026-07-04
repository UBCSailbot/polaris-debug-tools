/**
 * @file  dev_i2c.c
 * @brief I2C protocol and legacy-mode handlers for the dev layer.
 */

#include "dev_internal.h"

#include <stdio.h>
#include <string.h>

static const char *i2c_reason_from_error(uint32_t err);

void Dev_I2C_HandleCommand(const ParsedCommand_t *cmd)
{
    uint32_t addr_u32;
    uint32_t reg_u32;
    uint32_t len_u32;
    uint8_t tx_buf[MAX_BINARY_PAYLOAD_BYTES];
    uint8_t rx_buf[MAX_BINARY_PAYLOAD_BYTES];
    uint16_t tx_len;
    uint8_t reg_byte;
    HAL_StatusTypeDef st;
    char bytes_hex[MAX_BINARY_PAYLOAD_BYTES * 2U + 1U];
    char payload[MAX_EMIT_CHARS];
    char found[MAX_EMIT_CHARS - 6U];
    size_t used;
    uint8_t addr;
    uint32_t error_bits;

    if (strcmp(cmd->command, "INIT") == 0) {
        if (cmd->argc != 0U) {
            emit_fail("I2C", "bad-arg");
            return;
        }
        g_i2c_state.ready = 1U;
        g_i2c_state.last_addr = 0U;
        g_i2c_state.error_count = 0U;
        emit_frame("I2C", "PASS", "ready=1");
        return;
    }

    if (!g_i2c_state.ready) {
        emit_fail("I2C", "not-init");
        return;
    }

    if (strcmp(cmd->command, "SCAN") == 0) {
        if (cmd->argc != 0U) {
            emit_fail("I2C", "bad-arg");
            return;
        }

        found[0] = '\0';
        used = 0U;
        for (addr = 0x08U; addr <= 0x77U; addr++) {
            if (HAL_I2C_IsDeviceReady(&hi2c1, (uint16_t)(addr << 1), 2U, 2U) == HAL_OK) {
                if (used != 0U) {
                    found[used++] = ',';
                    found[used] = '\0';
                }
                (void)snprintf(&found[used], sizeof(found) - used, "%02X", addr);
                used = strlen(found);
            }
            /* The full scan blocks the poll loop for hundreds of ms — keep
             * the 3-deep FDCAN RX FIFO drained and the watchdog fed so a
             * busy CAN bus doesn't drop frames while we probe addresses. */
            CAN_DrainRxFifo();
            Dev_WDG_Feed();
        }

        (void)snprintf(payload, sizeof(payload), "found=%s", found);
        emit_frame("I2C", "PASS", payload);
        return;
    }

    if (strcmp(cmd->command, "WRITE") == 0) {
        if ((cmd->argc != 2U) ||
            !parse_hex_u32(cmd->argv[0], &addr_u32) ||
            !parse_hex_buffer(cmd->argv[1], tx_buf, &tx_len, MAX_BINARY_PAYLOAD_BYTES) ||
            (addr_u32 > 0x7FU) ||
            (tx_len == 0U)) {
            emit_fail("I2C", "bad-arg");
            return;
        }

        g_i2c_state.last_addr = (uint8_t)addr_u32;
        st = HAL_I2C_Master_Transmit(&hi2c1, (uint16_t)(g_i2c_state.last_addr << 1), tx_buf, tx_len, I2C_TIMEOUT_MS);
        if (st == HAL_TIMEOUT) {
            (void)snprintf(payload, sizeof(payload), "addr=0x%02X", g_i2c_state.last_addr);
            emit_frame("I2C", "TIMEOUT", payload);
            g_i2c_state.error_count++;
            return;
        }
        if (st != HAL_OK) {
            error_bits = HAL_I2C_GetError(&hi2c1);
            g_i2c_state.error_count++;
            emit_fail("I2C", i2c_reason_from_error(error_bits));
            return;
        }

        (void)snprintf(payload, sizeof(payload), "addr=0x%02X;wrote=%u",
                       g_i2c_state.last_addr, (unsigned int)tx_len);
        emit_frame("I2C", "PASS", payload);
        return;
    }

    if (strcmp(cmd->command, "READ") == 0) {
        if ((cmd->argc != 3U) ||
            !parse_hex_u32(cmd->argv[0], &addr_u32) ||
            !parse_hex_u32(cmd->argv[1], &reg_u32) ||
            !parse_dec_u32(cmd->argv[2], &len_u32) ||
            (addr_u32 > 0x7FU) ||
            (reg_u32 > 0xFFU) ||
            (len_u32 == 0U) ||
            (len_u32 > MAX_BINARY_PAYLOAD_BYTES)) {
            emit_fail("I2C", "bad-arg");
            return;
        }

        g_i2c_state.last_addr = (uint8_t)addr_u32;
        reg_byte = (uint8_t)reg_u32;

        st = HAL_I2C_Mem_Read(&hi2c1,
                              (uint16_t)(g_i2c_state.last_addr << 1),
                              reg_byte,
                              I2C_MEMADD_SIZE_8BIT,
                              rx_buf,
                              (uint16_t)len_u32,
                              I2C_TIMEOUT_MS);
        if (st == HAL_TIMEOUT) {
            (void)snprintf(payload, sizeof(payload), "addr=0x%02X", g_i2c_state.last_addr);
            emit_frame("I2C", "TIMEOUT", payload);
            g_i2c_state.error_count++;
            return;
        }
        if (st != HAL_OK) {
            error_bits = HAL_I2C_GetError(&hi2c1);
            g_i2c_state.error_count++;
            emit_fail("I2C", i2c_reason_from_error(error_bits));
            return;
        }

        if (!bytes_to_hex(rx_buf, (uint16_t)len_u32, bytes_hex, sizeof(bytes_hex))) {
            emit_fail("I2C", "internal");
            return;
        }

        (void)snprintf(payload, sizeof(payload), "addr=0x%02X;reg=0x%02X;bytes=%s",
                       g_i2c_state.last_addr, (unsigned int)reg_u32, bytes_hex);
        emit_frame("I2C", "PASS", payload);
        return;
    }

    if (strcmp(cmd->command, "STATUS") == 0) {
        if (cmd->argc != 0U) {
            emit_fail("I2C", "bad-arg");
            return;
        }
        (void)snprintf(payload, sizeof(payload), "last_addr=0x%02X;errors=%lu",
                       g_i2c_state.last_addr, (unsigned long)g_i2c_state.error_count);
        emit_frame("I2C", "PASS", payload);
        return;
    }

    emit_fail("I2C", "unknown-command");
}

void Dev_I2C_HandleLegacyByte(uint8_t byte)
{
    HAL_StatusTypeDef st;
    uint8_t rx = 0U;

    uart1_write_bytes(&byte, 1U);
    st = HAL_I2C_Master_Transmit(&hi2c1, (uint16_t)(LEGACY_I2C_SLAVE_ADDR << 1), &byte, 1U, I2C_TIMEOUT_MS);
    if (st != HAL_OK) {
        emit_line("[I2C ERR]");
        HAL_GPIO_TogglePin(LED_RED_GPIO_Port, LED_RED_Pin);
        return;
    }

    st = HAL_I2C_Master_Receive(&hi2c1, (uint16_t)(LEGACY_I2C_SLAVE_ADDR << 1), &rx, 1U, I2C_TIMEOUT_MS);
    if ((st == HAL_OK) && (rx != 0U)) {
        uart1_write_bytes(&rx, 1U);
        HAL_GPIO_TogglePin(LED_GREEN_GPIO_Port, LED_GREEN_Pin);
    }
}

static const char *i2c_reason_from_error(uint32_t err)
{
    if ((err & HAL_I2C_ERROR_AF) != 0U) {
        return "nack";
    }
    if ((err & HAL_I2C_ERROR_BERR) != 0U) {
        return "bus";
    }
    if ((err & HAL_I2C_ERROR_ARLO) != 0U) {
        return "arbitration";
    }
    if ((err & HAL_I2C_ERROR_OVR) != 0U) {
        return "overrun";
    }
    if ((err & HAL_I2C_ERROR_TIMEOUT) != 0U) {
        return "timeout";
    }
    return "i2c";
}
