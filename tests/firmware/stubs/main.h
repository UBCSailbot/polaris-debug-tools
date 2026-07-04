/*
 * main.h  —  Host-side stub
 *
 * Used by translation units that include "main.h" from a directory without
 * the real CubeIDE-generated header (e.g. can.c). Note: dev_internal.h lives
 * next to the REAL main.h, so dev.c-based tests resolve that one instead —
 * it is stub-compatible (it only pulls in stm32u5xx_hal.h, which -Istubs
 * redirects here anyway, and declares Error_Handler + LED pin macros).
 *
 * IRQn constants live in stubs/stm32u5xx_hal.h (the fake CMSIS layer).
 */
#ifndef MAIN_H
#define MAIN_H

#include "stm32u5xx_hal.h"

/* Defined in the test translation unit */
extern GPIO_TypeDef stub_gpio;

#define USER_BUTTON_Pin        GPIO_PIN_13
#define USER_BUTTON_GPIO_Port  GPIOC
#define LED_RED_Pin            GPIO_PIN_2
#define LED_RED_GPIO_Port      GPIOG
#define LED_GREEN_Pin          GPIO_PIN_7
#define LED_GREEN_GPIO_Port    GPIOC
#define LED_BLUE_Pin           GPIO_PIN_7
#define LED_BLUE_GPIO_Port     GPIOB

static inline void Error_Handler(void) {}

#endif /* MAIN_H */
