//#include "UARTMod.h"
//#include "main.h"
//
//extern UART_HandleTypeDef huart1;
//extern UART_HandleTypeDef huart2;
//
//static uint8_t rx1_data;
//static uint8_t rx2_data;
//
//
//
//void UARTMod_Init(void)
//{
//    // Start listening for both UARTs
//    HAL_UART_Receive_IT(&huart1, &rx1_data, 1);
//    HAL_UART_Receive_IT(&huart2, &rx2_data, 1);
//}
//
//void UARTMod_RxCpltCallback(UART_HandleTypeDef *huart)
//{
//    const uint32_t TX_TIMEOUT_MS = 5;
//
//    if (huart->Instance == USART1) { // 1 transfers from
//        // Byte arrived from PC/PuTTY -> forward to link
//        (void)HAL_UART_Transmit(&huart2, &rx1_data, 1, TX_TIMEOUT_MS);
//        // Re-arm reception on PC side
//        HAL_UART_Receive_IT(&huart1, &rx1_data, 1);
//    }
//    else if (huart->Instance == USART2) {
//        // Byte arrived from LINK (other STM32) -> forward to PC
//        (void)HAL_UART_Transmit(&huart1, &rx2_data, 1, TX_TIMEOUT_MS);
//        // Re-arm reception on LINK side
//        HAL_UART_Receive_IT(&huart2, &rx2_data, 1);
//    }
//}
//
//void UARTMod_ErrorHandle(UART_HandleTypeDef *huart)
//{
//	  if (huart->Instance == USART1) {
//	    HAL_UART_Receive_IT(&huart1, &rx1_data, 1);
//	  } else if (huart->Instance == USART2) {
//	    HAL_UART_Receive_IT(&huart2, &rx2_data, 1);
//	  }
//}

#include "main.h"
#include "UARTMod.h"
#include <string.h>

/* extern HAL handles provided by Cube main.c */
extern UART_HandleTypeDef huart1; // PuTTY
extern UART_HandleTypeDef huart2; // Board link (PD5 TX, PD6 RX)

/* ========== MASTER ROLE ==========
   MASTER forwards USER input (UART1) -> UART2
   MASTER does NOT forward UART2 -> UART1 back to UART2 (prevents loop)
   Both directions still print to PuTTY for visibility.
*/
#define UARTMOD_IS_MASTER 1

/* ISR -> main loop mailboxes (single-byte, non-blocking) */
static volatile uint8_t pend_u1 = 0, byte_u1 = 0;  // byte from UART1
static volatile uint8_t pend_u2 = 0, byte_u2 = 0;  // byte from UART2

/* Public: init banner (call from main after UART init) */
void UARTMod_Init(void)
{
    const char *hello =
        "\r\n[UART bridge ready - MASTER]\r\n"
        "MASTER forwards UART1 -> UART2. UART2 is printed only.\r\n";
    HAL_UART_Transmit(&huart1, (uint8_t*)hello, strlen(hello), HAL_MAX_DELAY);
}

/* Called ONLY from HAL_UART_RxCpltCallback (non-blocking) */
void UARTMod_OnUart1Byte(uint8_t b) { byte_u1 = b; pend_u1 = 1; }
void UARTMod_OnUart2Byte(uint8_t b) { byte_u2 = b; pend_u2 = 1; }

/* Called from main loop every tick (non-blocking) */
void UARTMod_Task(void)
{
    /* Handle bytes that came from PuTTY (UART1) */
    if (pend_u1) {
        uint8_t b = byte_u1; pend_u1 = 0;

        /* Local echo to PuTTY */
        HAL_UART_Transmit(&huart1, &b, 1, HAL_MAX_DELAY);

#if UARTMOD_IS_MASTER
        /* Forward to the other board over UART2 (MASTER role) */
        HAL_UART_Transmit(&huart2, &b, 1, HAL_MAX_DELAY);
#endif

        HAL_GPIO_TogglePin(LED_BLUE_GPIO_Port, LED_BLUE_Pin);
    }

    /* Handle bytes that came from the other board (UART2) */
    if (pend_u2) {
        uint8_t b = byte_u2; pend_u2 = 0;

        /* Show link traffic on PuTTY (visibility) */
        HAL_UART_Transmit(&huart1, &b, 1, HAL_MAX_DELAY);

        /* IMPORTANT: Do NOT forward UART2->UART1 back to UART2 here,
           otherwise both boards will bounce the same byte forever. */
        HAL_GPIO_TogglePin(LED_GREEN_GPIO_Port, LED_GREEN_Pin);
    }
}


