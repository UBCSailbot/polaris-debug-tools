#ifndef UARTMOD_H
#define UARTMOD_H

#include "main.h"
#include "stm32u5xx_hal.h"

void UARTMod_Init(void);
void UARTMod_ErrorHandle(UART_HandleTypeDef *huart);
void UARTMod_RxCpltCallback(UART_HandleTypeDef *huart);

#endif
