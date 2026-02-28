//
//
//
//#include "SPIMod.h"
//#include "main.h"
//#include <string.h>
//
//extern SPI_HandleTypeDef  hspi1;
//extern UART_HandleTypeDef huart1;
//
//static uint8_t spiTx = 0x00;
//static uint8_t spiRx = 0x00;
//static uint8_t uartRx = 0x00;
//static uint8_t txPending = 0;
//
#define SPI_CS_PORT GPIOA
#define SPI_CS_PIN  GPIO_PIN_4
#define CS_LOW()   HAL_GPIO_WritePin(SPI_CS_PORT, SPI_CS_PIN, GPIO_PIN_RESET)
#define CS_HIGH()  HAL_GPIO_WritePin(SPI_CS_PORT, SPI_CS_PIN, GPIO_PIN_SET)
//
//void SPIMod_Init(void)
//{
//    const char *msg = "\r\n[MASTER] SPI ready (HW NSS). Type to send.\r\n";
//    HAL_UART_Transmit(&huart1, (uint8_t*)msg, strlen(msg), 100);
//}
//
//void SPIMod_ReadWrite(void)
//{
//	CS_LOW();
//    // 1) Check for user input on PuTTY (polling)
//    if (HAL_UART_Receive(&huart1, &uartRx, 1, 0) == HAL_OK)
//    {
//        // Echo back to own terminal
//        //HAL_UART_Transmit(&huart1, &uartRx, 1, 50);
//        spiTx = uartRx;
//        txPending = 1;
//    }
//
//    // 2) Choose outgoing SPI byte: either staged byte or idle 0x00
//    uint8_t out = txPending ? spiTx : 0x00;
//    uint8_t in  = 0x00;
//
//    // 3) Perform one SPI frame (full duplex)
//    if (HAL_SPI_TransmitReceive(&hspi1, &out, &in, 1, 1) == HAL_OK)
//    {
//
//
//        // If we just sent a staged byte, clear it
//        if (txPending) txPending = 0;
//
//        // Only print the byte if it's not the idle char (0x00)
//        if (in != 0x00)
//        {
//        	HAL_UART_Transmit(&huart1, &in, 1, 1);
//        }
//
//    } else
//    {
//        // --- THIS IS THE NEW PART ---
//        // The SPI call FAILED! (e.g., HAL_TIMEOUT)
//        // This will tell us if the slave is unresponsive
//        const char *err = "[SPI_ERR!]";
//        HAL_UART_Transmit(&huart1, (uint8_t*)err, strlen(err), 100);
//    }
//
//    CS_HIGH();
//
//    // 4) Prevent CPU saturation
//    HAL_Delay(5);
//
//}

#include "main.h"
#include "SPIMod.h"
#include <string.h>

/* externs */
extern SPI_HandleTypeDef  hspi1;
extern UART_HandleTypeDef huart1;

/* CS helpers – ensure PA4 is GPIO output and wired to slave NSS */
#ifndef SPI1_CS_GPIO_Port
#define SPI1_CS_GPIO_Port   GPIOA
#endif
#ifndef SPI1_CS_Pin
#define SPI1_CS_Pin         GPIO_PIN_4
#endif
#define CS_LOW()   HAL_GPIO_WritePin(SPI1_CS_GPIO_Port, SPI1_CS_Pin, GPIO_PIN_RESET)
#define CS_HIGH()  HAL_GPIO_WritePin(SPI1_CS_GPIO_Port, SPI1_CS_Pin, GPIO_PIN_SET)

static volatile uint8_t tx_pending = 0;
static volatile uint8_t tx_byte    = 0;

#define SPI_POLL_PERIOD_MS 5
static uint32_t last_poll = 0;

static inline void cs_pulse_begin(void){ CS_LOW();  for (volatile int i=0;i<30;i++) __NOP(); }
static inline void cs_pulse_end(void)  { for (volatile int i=0;i<30;i++) __NOP(); CS_HIGH(); }

void SPIMod_Init(void)
{
  const char *hello = "\r\n[SPI MASTER ready]\r\n";
  HAL_UART_Transmit(&huart1, (uint8_t*)hello, strlen(hello), HAL_MAX_DELAY);
  CS_HIGH();
}

/* From UART1 ISR: queue the byte AND echo locally */
void SPIMod_OnUartByte(uint8_t b)
{
  tx_byte    = b;
  tx_pending = 1;

  HAL_UART_Transmit(&huart1, &b, 1, HAL_MAX_DELAY);   // local echo
  HAL_GPIO_TogglePin(LED_RED_GPIO_Port, LED_RED_Pin);
}

/* Call in main loop while in SPI mode */
void SPIMod_ReadWrite(void)
{
  uint8_t tx, rx;
  HAL_StatusTypeDef st;

  /* 1) If user typed on master, do that transfer now */
  if (tx_pending)
  {
    tx = tx_byte; rx = 0;

    cs_pulse_begin();
    st = HAL_SPI_TransmitReceive(&hspi1, &tx, &rx, 1, 20);
    cs_pulse_end();

    if (st == HAL_OK) {
      HAL_UART_Transmit(&huart1, &rx, 1, HAL_MAX_DELAY);  // show slave's byte
      HAL_GPIO_TogglePin(LED_GREEN_GPIO_Port, LED_GREEN_Pin);
    }
    tx_pending = 0;
    return;
  }

  /* 2) Otherwise, poll slave periodically with a dummy */
  uint32_t now = HAL_GetTick();
  if ((now - last_poll) >= SPI_POLL_PERIOD_MS)
  {
    last_poll = now;
    tx = 0x00; rx = 0;

    cs_pulse_begin();
    st = HAL_SPI_TransmitReceive(&hspi1, &tx, &rx, 1, 10);
    cs_pulse_end();

    if (st == HAL_OK) {
      /* Always print so you can SEE what the slave is offering */
      HAL_UART_Transmit(&huart1, &rx, 1, HAL_MAX_DELAY);
      HAL_GPIO_TogglePin(LED_GREEN_GPIO_Port, LED_GREEN_Pin);
    }
  }
}



