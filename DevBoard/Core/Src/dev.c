/**
 * @file  dev.c
 * @brief Drop-in replacement for UARTMod + SPIMod — ISR-safe, ring-buffered,
 *        with proper error handling and filtered SPI output.
 *
 * See dev.h for the public API and usage instructions.
 */

#include "dev.h"
#include "main.h"
#include "can.h"
#include <string.h>

#define RING_SIZE  256U
#define RING_MASK  (RING_SIZE - 1U)

typedef struct {
    volatile uint16_t head; 
    volatile uint16_t tail;  
    uint8_t  buf[RING_SIZE];
} RingBuf_t;

static inline void ring_init(RingBuf_t *r)
{
    r->head = 0;
    r->tail = 0;
}

static inline int ring_push(RingBuf_t *r, uint8_t byte)
{
    uint16_t next = (r->head + 1U) & RING_MASK;
    if (next == r->tail) return -1; 
    r->buf[r->head] = byte;
    r->head = next;
    return 0;
}

static inline int ring_pop(RingBuf_t *r, uint8_t *out)
{
    if (r->head == r->tail) return -1;
    *out = r->buf[r->tail];
    r->tail = (r->tail + 1U) & RING_MASK;
    return 0;
}

static inline uint16_t ring_count(const RingBuf_t *r)
{
    return (r->head - r->tail) & RING_MASK;
}

extern SPI_HandleTypeDef  hspi1;
extern UART_HandleTypeDef huart1; 
extern UART_HandleTypeDef huart2; 
extern FDCAN_HandleTypeDef hfdcan1;

static RingBuf_t rb_u1_rx;
static RingBuf_t rb_u2_rx;
static RingBuf_t rb_spi_tx;


static uint8_t isr_u1_byte;
static uint8_t isr_u2_byte;

typedef enum {
    DEV_MODE_MENU = 0,
    DEV_MODE_UART = 1,
    DEV_MODE_SPI  = 2,
    DEV_MODE_CAN  = 3
} DevMode_t;

static volatile DevMode_t g_mode = DEV_MODE_MENU;


#ifndef SPI1_CS_GPIO_Port
#define SPI1_CS_GPIO_Port   GPIOA
#endif
#ifndef SPI1_CS_Pin
#define SPI1_CS_Pin         GPIO_PIN_4
#endif

#define SPI_POLL_MS   5U
static uint32_t spi_last_poll = 0;

#define SPI_IDLE_BYTE  0x00

#define TX_TIMEOUT_MS  50U

static void dwt_init(void)
{
    CoreDebug->DEMCR |= CoreDebug_DEMCR_TRCENA_Msk;
    DWT->CYCCNT = 0;
    DWT->CTRL  |= DWT_CTRL_CYCCNTENA_Msk;
}

/**
 * @brief  Busy-wait for exactly @p us microseconds using DWT->CYCCNT.
 *         Accurate regardless of compiler optimisations.
 */
static void delay_us(uint32_t us)
{
    uint32_t clk_mhz = HAL_RCC_GetHCLKFreq() / 1000000U;
    uint32_t ticks    = us * clk_mhz;
    uint32_t start    = DWT->CYCCNT;
    while ((DWT->CYCCNT - start) < ticks) { /* nothing*/ }
}

static inline void cs_low(void)
{
    HAL_GPIO_WritePin(SPI1_CS_GPIO_Port, SPI1_CS_Pin, GPIO_PIN_RESET);
    delay_us(1);
}

static inline void cs_high(void)
{
    delay_us(1);
    HAL_GPIO_WritePin(SPI1_CS_GPIO_Port, SPI1_CS_Pin, GPIO_PIN_SET);
}

static void print(const char *s)
{
    HAL_UART_Transmit(&huart1, (const uint8_t *)s, (uint16_t)strlen(s), TX_TIMEOUT_MS);
}

static void print_menu(void)
{
    print(
        "\r\n=== Comm Test Menu (MASTER) ===\r\n"
        "1) UART bridge (USART1 <-> USART2 PD5/PD6)\r\n"
        "2) SPI test (UART1 -> SPI1 MASTER)\r\n"
        "3) CAN test (UART1 <-> FDCAN1)\r\n"
        "m) Show this menu\r\n"
        "Select: "
    );
}

static void announce_mode(DevMode_t m)
{
    if (m == DEV_MODE_UART)
        print("\r\n[Mode] UART bridge.\r\n"
              "Type on PuTTY to send across USART2 (PD5/PD6). 'm' for menu.\r\n");
    else if (m == DEV_MODE_SPI)
        print("\r\n[Mode] SPI MASTER.\r\n"
              "Type on PuTTY; each byte clocks one SPI transfer. 'm' for menu.\r\n");
    else if (m == DEV_MODE_CAN)
        print("\r\n[Mode] CAN bridge.\r\n"
              "Type on PuTTY to transmit via FDCAN1. 'm' for menu.\r\n");
}

static void dev_uart_task(void)
{
    uint8_t b;

   
    while (ring_pop(&rb_u1_rx, &b) == 0)
    {
     
        if (b == 'm' || b == 'M') {
            g_mode = DEV_MODE_MENU;
            print_menu();
            return;
        }

        HAL_UART_Transmit(&huart1, &b, 1, TX_TIMEOUT_MS);
        HAL_UART_Transmit(&huart2, &b, 1, TX_TIMEOUT_MS);

        HAL_GPIO_TogglePin(LED_BLUE_GPIO_Port, LED_BLUE_Pin);
    }

    
    while (ring_pop(&rb_u2_rx, &b) == 0)
    {
        
        HAL_UART_Transmit(&huart1, &b, 1, TX_TIMEOUT_MS);

        HAL_GPIO_TogglePin(LED_GREEN_GPIO_Port, LED_GREEN_Pin);
    }
}
static void dev_spi_task(void)
{
    uint8_t tx, rx;
    HAL_StatusTypeDef st;

    while (ring_pop(&rb_spi_tx, &tx) == 0)
    {
        rx = 0;

        cs_low();
        st = HAL_SPI_TransmitReceive(&hspi1, &tx, &rx, 1, 20);
        cs_high();

        if (st == HAL_OK && rx != SPI_IDLE_BYTE) {
            HAL_UART_Transmit(&huart1, &rx, 1, TX_TIMEOUT_MS);
            HAL_GPIO_TogglePin(LED_GREEN_GPIO_Port, LED_GREEN_Pin);
        }
    }

    uint32_t now = HAL_GetTick();
    if ((now - spi_last_poll) >= SPI_POLL_MS)
    {
        spi_last_poll = now;
        tx = SPI_IDLE_BYTE;
        rx = 0;

        cs_low();
        st = HAL_SPI_TransmitReceive(&hspi1, &tx, &rx, 1, 10);
        cs_high();

        if (st == HAL_OK && rx != SPI_IDLE_BYTE) {
            HAL_UART_Transmit(&huart1, &rx, 1, TX_TIMEOUT_MS);
            HAL_GPIO_TogglePin(LED_GREEN_GPIO_Port, LED_GREEN_Pin);
        }
    }
}

static void dev_can_task(void)
{
    uint8_t b;
    CAN_Frame frame;

    while (ring_pop(&rb_u1_rx, &b) == 0)
    {
        if (b == 'm' || b == 'M') {
            g_mode = DEV_MODE_MENU;
            print_menu();
            return;
        }

        HAL_UART_Transmit(&huart1, &b, 1, TX_TIMEOUT_MS);
        CAN_Transmit(0x123, FDCAN_STANDARD_ID, FDCAN_DLC_BYTES_1, &b, &hfdcan1);
        HAL_GPIO_TogglePin(LED_RED_GPIO_Port, LED_RED_Pin);
    }

    while (CAN_Receive(&frame) == HAL_OK)
    {
        for (uint8_t i = 0; i < frame.RxData1_BufferLength; i++) {
            HAL_UART_Transmit(&huart1, &frame.RxData1[i], 1, TX_TIMEOUT_MS);
        }
        HAL_GPIO_TogglePin(LED_GREEN_GPIO_Port, LED_GREEN_Pin);
    }
}

static void dev_menu_task(void)
{
    uint8_t b;
    while (ring_pop(&rb_u1_rx, &b) == 0)
    {
        if (b == '1') {
            g_mode = DEV_MODE_UART;
            announce_mode(g_mode);
            return;
        }
        else if (b == '2') {
            g_mode = DEV_MODE_SPI;
            announce_mode(g_mode);
            return;
        }
        else if (b == '3') {
            g_mode = DEV_MODE_CAN;
            announce_mode(g_mode);
            return;
        }
        else if (b == 'm' || b == 'M') {
            print_menu();
        }
        else {
            print("\r\nInvalid.\r\n");
            print_menu();
        }
    }
}

void Dev_Init(void)
{
    ring_init(&rb_u1_rx);
    ring_init(&rb_u2_rx);
    ring_init(&rb_spi_tx);

    dwt_init();

    HAL_GPIO_WritePin(SPI1_CS_GPIO_Port, SPI1_CS_Pin, GPIO_PIN_SET);

    HAL_NVIC_SetPriority(USART1_IRQn, 1, 0);
    HAL_NVIC_EnableIRQ(USART1_IRQn);
    HAL_NVIC_SetPriority(USART2_IRQn, 1, 0);
    HAL_NVIC_EnableIRQ(USART2_IRQn);

    HAL_UART_Receive_IT(&huart1, &isr_u1_byte, 1);
    HAL_UART_Receive_IT(&huart2, &isr_u2_byte, 1);

    print("\r\n=== Dev Library Initialised ===\r\n");
    print("[UART bridge ready - MASTER]\r\n");
    print("[SPI  MASTER ready]\r\n");
    print("[CAN  bridge ready]\r\n");
    print_menu();
}

void Dev_Poll(void)
{
    switch (g_mode)
    {
        case DEV_MODE_MENU:
            dev_menu_task();
            break;

        case DEV_MODE_UART:
            dev_uart_task();
            break;

        case DEV_MODE_SPI:
        {
            uint8_t b;
            while (ring_pop(&rb_u1_rx, &b) == 0)
            {
                if (b == 'm' || b == 'M') {
                    g_mode = DEV_MODE_MENU;
                    print_menu();
                    return;
                }
                HAL_UART_Transmit(&huart1, &b, 1, TX_TIMEOUT_MS);
                ring_push(&rb_spi_tx, b);
                HAL_GPIO_TogglePin(LED_RED_GPIO_Port, LED_RED_Pin);
            }
            dev_spi_task();
            break;
        }

        case DEV_MODE_CAN:
            dev_can_task();
            break;
    }
}

void Dev_UART_RxCpltCallback(UART_HandleTypeDef *huart)
{
    if (huart == &huart1)
    {
        ring_push(&rb_u1_rx, isr_u1_byte);
        HAL_UART_Receive_IT(&huart1, &isr_u1_byte, 1); 
    }
    else if (huart == &huart2)
    {
        ring_push(&rb_u2_rx, isr_u2_byte);
        HAL_UART_Receive_IT(&huart2, &isr_u2_byte, 1); 
    }
}

void Dev_UART_ErrorCallback(UART_HandleTypeDef *huart)
{
    __HAL_UART_CLEAR_FLAG(huart, UART_CLEAR_OREF);
    __HAL_UART_CLEAR_FLAG(huart, UART_CLEAR_NEF);  
    __HAL_UART_CLEAR_FLAG(huart, UART_CLEAR_FEF);    
    __HAL_UART_CLEAR_FLAG(huart, UART_CLEAR_PEF);   

    if (huart == &huart1)
        HAL_UART_Receive_IT(&huart1, &isr_u1_byte, 1);
    else if (huart == &huart2)
        HAL_UART_Receive_IT(&huart2, &isr_u2_byte, 1);
}
