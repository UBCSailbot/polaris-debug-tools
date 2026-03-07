/**
 * @file  dev.h
 * @brief Drop-in replacement library for UARTMod + SPIMod.
 *
 */

#ifndef DEV_H
#define DEV_H

#include "stm32u5xx_hal.h"

#ifdef __cplusplus
extern "C" {
#endif

/**
 * @brief  Initialise the dev library.
 *         Sets up ring buffers, arms UART RX interrupts, enables DWT
 *         cycle counter, drives SPI CS high, and prints a welcome banner.
 *         Call AFTER all MX_xxx_Init() functions.
 */
void Dev_Init(void);

/**
 * @brief  Main-loop poll function.  Call once per iteration of while(1).
 *         Handles the menu state-machine, UART bridge task, and SPI
 *         master task, all in thread context (never blocks for long).
 */
void Dev_Poll(void);

/**
 * @brief  ISR-safe UART RX complete callback.
 *         Pushes the received byte into the correct ring buffer and
 *         re-arms HAL_UART_Receive_IT.  No blocking calls.
 * @param  huart  HAL UART handle that triggered the callback.
 */
void Dev_UART_RxCpltCallback(UART_HandleTypeDef *huart);

/**
 * @brief  ISR-safe UART error callback.
 *         Clears ORE/FE/NE/PE flags and re-arms HAL_UART_Receive_IT.
 * @param  huart  HAL UART handle that triggered the error.
 */
void Dev_UART_ErrorCallback(UART_HandleTypeDef *huart);

#ifdef __cplusplus
}
#endif

#endif /* DEV_H */
