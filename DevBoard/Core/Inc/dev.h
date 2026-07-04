/**
 * @file  dev.h
 * @brief Protocol-first dev-board control surface with temporary legacy mode.
 */

#ifndef DEV_H
#define DEV_H

#include "stm32u5xx_hal.h"

#define FW_VERSION       "0.3.0"
#define PROTOCOL_VERSION "1"

#ifdef __cplusplus
extern "C" {
#endif

/**
 * @brief  Initialize the dev-board control layer.
 *         Arms UART RX interrupts, initializes internal protocol state, and
 *         puts the board into protocol mode by default.
 *         Call after all MX_xxx_Init() functions complete.
 */
void Dev_Init(void);

/**
 * @brief  Main-loop poll function.
 *         Services protocol command parsing, streaming/event forwarding, and
 *         the temporary legacy menu path in thread context.
 */
void Dev_Poll(void);

/**
 * @brief  ISR-safe UART RX complete callback.
 *         Pushes the received byte into the correct ring buffer and re-arms
 *         HAL_UART_Receive_IT. No blocking calls.
 * @param  huart  HAL UART handle that triggered the callback.
 */
void Dev_UART_RxCpltCallback(UART_HandleTypeDef *huart);

/**
 * @brief  ISR-safe UART receive event callback for buffered IDLE reception.
 *         Used for the command UART so full bursts can be collected without
 *         dropping bytes between single-byte re-arm operations.
 * @param  huart  HAL UART handle that triggered the callback.
 * @param  size   Number of bytes written into the active RX buffer.
 */
void Dev_UART_RxEventCallback(UART_HandleTypeDef *huart, uint16_t size);

/**
 * @brief  ISR-safe UART error callback.
 *         Clears UART error flags and re-arms HAL_UART_Receive_IT.
 * @param  huart  HAL UART handle that triggered the error.
 */
void Dev_UART_ErrorCallback(UART_HandleTypeDef *huart);

#ifdef __cplusplus
}
#endif

#endif /* DEV_H */
