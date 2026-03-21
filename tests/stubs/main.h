/*
 * main.h  —  Host-side stub
 *
 * Provides all GPIO port/pin macros and IRQn constants that dev.c and can.c
 * pull in from the real CubeIDE-generated main.h.
 */
#ifndef MAIN_H
#define MAIN_H

#include "stm32u5xx_hal.h"

/* Defined in the test translation unit */
extern GPIO_TypeDef stub_gpio;

#define LED_RED_GPIO_Port    (&stub_gpio)
#define LED_RED_Pin          (1U)
#define LED_GREEN_GPIO_Port  (&stub_gpio)
#define LED_GREEN_Pin        (2U)
#define LED_BLUE_GPIO_Port   (&stub_gpio)
#define LED_BLUE_Pin         (4U)
#define SPI1_CS_GPIO_Port    (&stub_gpio)
#define SPI1_CS_Pin          (8U)

#define USART1_IRQn  ((IRQn_Type)0)
#define USART2_IRQn  ((IRQn_Type)1)
#define TIM7_IRQn    ((IRQn_Type)2)

static inline void Error_Handler(void) {}

#endif /* MAIN_H */
