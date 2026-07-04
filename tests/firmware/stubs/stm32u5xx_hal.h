/*
 * stm32u5xx_hal.h  —  Host-side HAL stub for unit tests
 *
 * Self-contained replacement for the full STM32U5 HAL headers.  Provides
 * every type, constant, and inline function that dev.c and can.c reference,
 * compiled with plain gcc on a Linux/macOS/Windows host.
 *
 * Rules:
 *   - No inclusion of real STM32 or CMSIS headers.
 *   - HAL functions are static inline stubs that return HAL_OK.
 *   - Register-bearing peripherals (FDCAN, IWDG) are backed by real static
 *     structs so production register reads/writes can be asserted in tests.
 *   - HAL_UART_Transmit captures all bytes into stub_uart_tx_capture so tests
 *     can assert on emitted protocol frames.
 *   - HAL_GetTick advances by 1 ms per call so timeout loops terminate.
 *   - Values that production code round-trips (FDCAN_RXF0S_* fields, DLC
 *     codes) match the real STM32U575 CMSIS/HAL definitions.
 */

#ifndef STM32U5XX_HAL_H
#define STM32U5XX_HAL_H

#include <stdint.h>
#include <stddef.h>
#include <string.h>

/* --------------------------------------------------------------------------
 * Basic platform types
 * -------------------------------------------------------------------------- */
typedef uint32_t IRQn_Type;

/* IRQ numbers live in the CMSIS device header on target; production code may
 * pull in the real main.h (which has no IRQn defines), so they belong here. */
#define TIM7_IRQn    ((IRQn_Type)59U)
#define USART1_IRQn  ((IRQn_Type)61U)
#define USART2_IRQn  ((IRQn_Type)62U)

#define ENABLE   1U
#define DISABLE  0U
#define RESET    0
#define SET      1

/* --------------------------------------------------------------------------
 * HAL status
 * -------------------------------------------------------------------------- */
typedef enum {
    HAL_OK      = 0,
    HAL_ERROR   = 1,
    HAL_BUSY    = 2,
    HAL_TIMEOUT = 3
} HAL_StatusTypeDef;

#define HAL_MAX_DELAY 0xFFFFFFFFU

/* --------------------------------------------------------------------------
 * Peripheral instance stubs
 * -------------------------------------------------------------------------- */
typedef struct { uint32_t dummy; } USART_TypeDef;
typedef struct { uint32_t dummy; } SPI_TypeDef;
typedef struct { uint32_t dummy; } I2C_TypeDef;
typedef struct { uint32_t dummy; } TIM_TypeDef;
typedef struct { uint32_t dummy; } GPIO_TypeDef;

/* FDCAN instance carries real (host-backed) registers so CAN_DrainRxFifo's
 * RXF0S reads and RXF0A force-ack writes can be driven and asserted. */
typedef struct {
    volatile uint32_t RXF0S;
    volatile uint32_t RXF0A;
    volatile uint32_t RXF1S;
    volatile uint32_t PSR;
    volatile uint32_t IR;
    volatile uint32_t ECR;
    volatile uint32_t TXFQS;
    volatile uint32_t TXBRP;
    volatile uint32_t TXBTO;
    volatile uint32_t TXBCF;
} FDCAN_GlobalTypeDef;

/* Singleton peripheral instances referenced by name in can.c / dev.c */
static USART_TypeDef  _stub_USART1  = {0};
static USART_TypeDef  _stub_USART2  = {0};
static SPI_TypeDef    _stub_SPI1    = {0};
static I2C_TypeDef    _stub_I2C1    = {0};
static TIM_TypeDef    _stub_TIM7    = {0};
static TIM_TypeDef    _stub_TIM17   = {0};
static GPIO_TypeDef   _stub_GPIOA   = {0};
static GPIO_TypeDef   _stub_GPIOB   = {0};
static GPIO_TypeDef   _stub_GPIOC   = {0};
static GPIO_TypeDef   _stub_GPIOG   = {0};
static FDCAN_GlobalTypeDef _stub_FDCAN1 = {0};

#define USART1  (&_stub_USART1)
#define USART2  (&_stub_USART2)
#define SPI1    (&_stub_SPI1)
#define I2C1    (&_stub_I2C1)
#define TIM7    (&_stub_TIM7)
#define TIM17   (&_stub_TIM17)
#define GPIOA   (&_stub_GPIOA)
#define GPIOB   (&_stub_GPIOB)
#define GPIOC   (&_stub_GPIOC)
#define GPIOG   (&_stub_GPIOG)
#define FDCAN1  (&_stub_FDCAN1)

/* GPIO pin constants */
#define GPIO_PIN_0   (1U << 0)
#define GPIO_PIN_1   (1U << 1)
#define GPIO_PIN_2   (1U << 2)
#define GPIO_PIN_3   (1U << 3)
#define GPIO_PIN_4   (1U << 4)
#define GPIO_PIN_5   (1U << 5)
#define GPIO_PIN_6   (1U << 6)
#define GPIO_PIN_7   (1U << 7)
#define GPIO_PIN_8   (1U << 8)
#define GPIO_PIN_13  (1U << 13)

/* --------------------------------------------------------------------------
 * IWDG — backed by real static storage so SYS:WATCHDOG tests can assert the
 * prescaler / reload / key writes the production code performs.
 * -------------------------------------------------------------------------- */
typedef struct {
    volatile uint32_t KR;
    volatile uint32_t PR;
    volatile uint32_t RLR;
    volatile uint32_t SR;
    volatile uint32_t WINR;
    volatile uint32_t EWCR;
} IWDG_TypeDef;

static IWDG_TypeDef _stub_IWDG = {0};
#define IWDG (&_stub_IWDG)

/* --------------------------------------------------------------------------
 * Handle structs
 * -------------------------------------------------------------------------- */
typedef struct {
    USART_TypeDef *Instance;
} UART_HandleTypeDef;

typedef struct {
    SPI_TypeDef *Instance;
} SPI_HandleTypeDef;

typedef struct {
    I2C_TypeDef *Instance;
} I2C_HandleTypeDef;

typedef enum {
    HAL_FDCAN_STATE_RESET = 0,
    HAL_FDCAN_STATE_READY,
    HAL_FDCAN_STATE_BUSY,
    HAL_FDCAN_STATE_ERROR
} HAL_FDCAN_StateTypeDef;

typedef struct {
    FDCAN_GlobalTypeDef *Instance;
    struct {
        uint32_t ClockDivider;
        uint32_t FrameFormat;
        uint32_t Mode;
        uint32_t AutoRetransmission;
        uint32_t TransmitPause;
        uint32_t ProtocolException;
        uint32_t NominalPrescaler;
        uint32_t NominalSyncJumpWidth;
        uint32_t NominalTimeSeg1;
        uint32_t NominalTimeSeg2;
        uint32_t DataPrescaler;
        uint32_t DataSyncJumpWidth;
        uint32_t DataTimeSeg1;
        uint32_t DataTimeSeg2;
        uint32_t StdFiltersNbr;
        uint32_t ExtFiltersNbr;
        uint32_t TxFifoQueueMode;
    } Init;
    HAL_FDCAN_StateTypeDef State;
    uint32_t ErrorCode;
} FDCAN_HandleTypeDef;

#define HAL_FDCAN_ERROR_NONE        0x00000000U
#define HAL_FDCAN_ERROR_RAM_ACCESS  0x00080000U

typedef struct {
    TIM_TypeDef *Instance;
    struct {
        uint32_t Prescaler;
        uint32_t CounterMode;
        uint32_t Period;
        uint32_t ClockDivision;
        uint32_t AutoReloadPreload;
    } Init;
} TIM_HandleTypeDef;

/* --------------------------------------------------------------------------
 * FDCAN filter / header structs
 * -------------------------------------------------------------------------- */
typedef struct {
    uint32_t IdType;
    uint32_t FilterIndex;
    uint32_t FilterType;
    uint32_t FilterConfig;
    uint32_t FilterID1;
    uint32_t FilterID2;
} FDCAN_FilterTypeDef;

typedef struct {
    uint32_t Identifier;
    uint32_t IdType;
    uint32_t TxFrameType;
    uint32_t DataLength;
    uint32_t ErrorStateIndicator;
    uint32_t BitRateSwitch;
    uint32_t FDFormat;
    uint32_t TxEventFifoControl;
    uint32_t MessageMarker;
} FDCAN_TxHeaderTypeDef;

typedef struct {
    uint32_t Identifier;
    uint32_t IdType;
    uint32_t RxFrameType;
    uint32_t DataLength;    /* DLC code 0-15, same as the real U5 HAL */
    uint32_t ErrorStateIndicator;
    uint32_t BitRateSwitch;
    uint32_t FDFormat;
    uint32_t RxTimestamp;
    uint32_t FilterIndex;
    uint32_t IsFilterMatchingFrame;
} FDCAN_RxHeaderTypeDef;

/* --------------------------------------------------------------------------
 * DWT / CoreDebug — backed by real static storage so pointer writes in
 * dwt_init() are harmless no-ops on host.
 * -------------------------------------------------------------------------- */
typedef struct {
    volatile uint32_t CYCCNT;
    volatile uint32_t CTRL;
} DWT_Type;

typedef struct {
    volatile uint32_t DEMCR;
} CoreDebug_Type;

static DWT_Type       _dwt_stub       = {0};
static CoreDebug_Type _coredebug_stub = {0};

#define DWT        (&_dwt_stub)
#define CoreDebug  (&_coredebug_stub)

#define DWT_CTRL_CYCCNTENA_Msk       (1UL)
#define CoreDebug_DEMCR_TRCENA_Msk   (1UL << 24)

/* --------------------------------------------------------------------------
 * MPU — types and no-op config functions used by Dev_Init's FDCAN message
 * RAM region setup.
 * -------------------------------------------------------------------------- */
typedef struct {
    uint8_t  Number;
    uint8_t  Attributes;
} MPU_Attributes_InitTypeDef;

typedef struct {
    uint8_t  Enable;
    uint8_t  Number;
    uint32_t BaseAddress;
    uint32_t LimitAddress;
    uint8_t  AttributesIndex;
    uint8_t  AccessPermission;
    uint8_t  DisableExec;
    uint8_t  IsShareable;
} MPU_Region_InitTypeDef;

#define MPU_ATTRIBUTES_NUMBER0           0U
#define MPU_DEVICE_NGNRNE                0U
#define MPU_REGION_ENABLE                1U
#define MPU_REGION_NUMBER0               0U
#define MPU_REGION_ALL_RW                3U
#define MPU_INSTRUCTION_ACCESS_DISABLE   1U
#define MPU_ACCESS_NOT_SHAREABLE         0U
#define MPU_PRIVILEGED_DEFAULT           4U

static inline void HAL_MPU_Disable(void) {}
static inline void HAL_MPU_Enable(uint32_t control) { (void)control; }
static inline void HAL_MPU_ConfigMemoryAttributes(MPU_Attributes_InitTypeDef *attr) { (void)attr; }
static inline void HAL_MPU_ConfigRegion(MPU_Region_InitTypeDef *region) { (void)region; }

/* --------------------------------------------------------------------------
 * Core intrinsics — no-ops on host (single-threaded tests).
 * -------------------------------------------------------------------------- */
static inline uint32_t __get_PRIMASK(void) { return 0U; }
static inline void __set_PRIMASK(uint32_t m) { (void)m; }
static inline void __disable_irq(void) {}

/* --------------------------------------------------------------------------
 * GPIO
 * -------------------------------------------------------------------------- */
typedef enum {
    GPIO_PIN_RESET = 0,
    GPIO_PIN_SET
} GPIO_PinState;

/* --------------------------------------------------------------------------
 * UART flags / macros  (used in Dev_UART_ErrorCallback)
 * -------------------------------------------------------------------------- */
#define UART_CLEAR_OREF  0x08U
#define UART_CLEAR_NEF   0x04U
#define UART_CLEAR_FEF   0x02U
#define UART_CLEAR_PEF   0x01U
#define __HAL_UART_CLEAR_FLAG(h, f)  do { (void)(h); (void)(f); } while(0)

/* --------------------------------------------------------------------------
 * SPI constants
 * -------------------------------------------------------------------------- */
#define SPI_TIMODE_DISABLE  0U

/* --------------------------------------------------------------------------
 * TIM constants / macros
 * -------------------------------------------------------------------------- */
#define TIM_COUNTERMODE_UP              0U
#define TIM_AUTORELOAD_PRELOAD_DISABLE  0U
#define TIM_FLAG_UPDATE                 0x00000001U
#define __HAL_TIM_CLEAR_FLAG(h, f)  do { (void)(h); (void)(f); } while(0)

/* --------------------------------------------------------------------------
 * I2C constants
 * -------------------------------------------------------------------------- */
#define I2C_MEMADD_SIZE_8BIT   0x00000001U
#define HAL_I2C_ERROR_NONE     0x00000000U
#define HAL_I2C_ERROR_BERR     0x00000001U
#define HAL_I2C_ERROR_ARLO     0x00000002U
#define HAL_I2C_ERROR_AF       0x00000004U
#define HAL_I2C_ERROR_OVR      0x00000008U
#define HAL_I2C_ERROR_TIMEOUT  0x00000020U

/* --------------------------------------------------------------------------
 * FDCAN constants — values match the real STM32U5 HAL where production code
 * round-trips them (DLC codes, RXF0S fields, interrupt bits used in tests).
 * -------------------------------------------------------------------------- */
#define FDCAN_CLOCK_DIV1                0x00000000U
#define FDCAN_CLOCK_DIV4                0x00000002U
#define FDCAN_FRAME_CLASSIC             0x00000000U
#define FDCAN_FRAME_FD_NO_BRS           0x00000001U
#define FDCAN_FRAME_FD_BRS              0x00000003U
#define FDCAN_MODE_NORMAL               0x00000000U
#define FDCAN_TX_FIFO_OPERATION         0x00000000U
#define FDCAN_STANDARD_ID               0x00000000U
#define FDCAN_EXTENDED_ID               0x40000000U
#define FDCAN_DATA_FRAME                0x00000000U
#define FDCAN_ESI_ACTIVE                0x00000000U
#define FDCAN_BRS_ON                    0x00100000U
#define FDCAN_BRS_OFF                   0x00000000U
#define FDCAN_FD_CAN                    0x00200000U
#define FDCAN_CLASSIC_CAN               0x00000000U
#define FDCAN_STORE_TX_EVENTS           0x00800000U
#define FDCAN_FILTER_RANGE              0x00000000U
#define FDCAN_FILTER_RANGE_NO_EIDM      0x00000003U
#define FDCAN_FILTER_TO_RXFIFO0         0x00000001U
#define FDCAN_FILTER_TO_RXFIFO1         0x00000002U
#define FDCAN_ACCEPT_IN_RX_FIFO0        0x00000000U
#define FDCAN_FILTER_REMOTE             0x00000002U
#define FDCAN_RX_FIFO0                  0x00000040U
#define FDCAN_RX_FIFO1                  0x00000041U

#define FDCAN_TX_BUFFER0                0x00000001U
#define FDCAN_TX_BUFFER1                0x00000002U
#define FDCAN_TX_BUFFER2                0x00000004U

/* Interrupt flag bits — non-overlapping so bit-AND checks work */
#define FDCAN_IT_RX_FIFO0_NEW_MESSAGE   0x00000001U
#define FDCAN_IT_RX_FIFO0_FULL          0x00000002U
#define FDCAN_IT_RX_FIFO0_MESSAGE_LOST  0x00000004U
#define FDCAN_IT_RX_FIFO1_NEW_MESSAGE   0x00000008U
#define FDCAN_IT_BUS_OFF                0x00000010U
#define FDCAN_IT_ERROR_WARNING          0x00000020U
#define FDCAN_IT_ERROR_PASSIVE          0x00000040U
#define FDCAN_IT_DATA_PROTOCOL_ERROR    0x00000080U
#define FDCAN_IT_ARB_PROTOCOL_ERROR     0x00000100U

/* RXF0S bit fields — real STM32U575 CMSIS values */
#define FDCAN_RXF0S_F0FL_Pos   (0U)
#define FDCAN_RXF0S_F0FL       (0xFU << FDCAN_RXF0S_F0FL_Pos)
#define FDCAN_RXF0S_F0GI_Pos   (8U)
#define FDCAN_RXF0S_F0GI       (0x3U << FDCAN_RXF0S_F0GI_Pos)
#define FDCAN_RXF0S_F0PI_Pos   (16U)
#define FDCAN_RXF0S_F0PI       (0x3U << FDCAN_RXF0S_F0PI_Pos)
#define FDCAN_RXF0S_F0F_Pos    (24U)
#define FDCAN_RXF0S_F0F        (0x1U << FDCAN_RXF0S_F0F_Pos)
#define FDCAN_RXF0S_RF0L_Pos   (25U)
#define FDCAN_RXF0S_RF0L       (0x1U << FDCAN_RXF0S_RF0L_Pos)

/* DLC codes — plain 0-15 code values, same as the real STM32U5 HAL. */
#define FDCAN_DLC_BYTES_0   0x00000000U
#define FDCAN_DLC_BYTES_1   0x00000001U
#define FDCAN_DLC_BYTES_2   0x00000002U
#define FDCAN_DLC_BYTES_3   0x00000003U
#define FDCAN_DLC_BYTES_4   0x00000004U
#define FDCAN_DLC_BYTES_5   0x00000005U
#define FDCAN_DLC_BYTES_6   0x00000006U
#define FDCAN_DLC_BYTES_7   0x00000007U
#define FDCAN_DLC_BYTES_8   0x00000008U
#define FDCAN_DLC_BYTES_12  0x00000009U
#define FDCAN_DLC_BYTES_16  0x0000000AU
#define FDCAN_DLC_BYTES_20  0x0000000BU
#define FDCAN_DLC_BYTES_24  0x0000000CU
#define FDCAN_DLC_BYTES_32  0x0000000DU
#define FDCAN_DLC_BYTES_48  0x0000000EU
#define FDCAN_DLC_BYTES_64  0x0000000FU

/* --------------------------------------------------------------------------
 * UART TX capture — every HAL_UART_Transmit lands here so tests can assert
 * on protocol frames the firmware emits (emit_line / emit_frame paths).
 * -------------------------------------------------------------------------- */
#define STUB_UART_CAPTURE_SIZE 16384

static char   stub_uart_tx_capture[STUB_UART_CAPTURE_SIZE];
static size_t stub_uart_tx_len = 0;

static inline void stub_uart_capture_reset(void) {
    stub_uart_tx_len = 0;
    stub_uart_tx_capture[0] = '\0';
}

/* --------------------------------------------------------------------------
 * Host tick — advances 1 ms per call so HAL_GetTick timeout loops terminate.
 * -------------------------------------------------------------------------- */
static uint32_t stub_tick = 0;

static inline void stub_tick_reset(void) { stub_tick = 0; }

static inline uint32_t HAL_GetTick(void) { return stub_tick++; }

static inline void HAL_Delay(uint32_t ms) { stub_tick += ms; }

/* --------------------------------------------------------------------------
 * HAL function stubs
 * -------------------------------------------------------------------------- */
static inline HAL_StatusTypeDef HAL_UART_Transmit(
        UART_HandleTypeDef *h, const uint8_t *p, uint16_t s, uint32_t t)
{
    (void)h; (void)t;
    if ((p != NULL) && ((stub_uart_tx_len + s) < (STUB_UART_CAPTURE_SIZE - 1U))) {
        memcpy(&stub_uart_tx_capture[stub_uart_tx_len], p, s);
        stub_uart_tx_len += s;
        stub_uart_tx_capture[stub_uart_tx_len] = '\0';
    }
    return HAL_OK;
}

static inline HAL_StatusTypeDef HAL_UART_Receive_IT(
        UART_HandleTypeDef *h, uint8_t *p, uint16_t s)
{ (void)h; (void)p; (void)s; return HAL_OK; }

static inline HAL_StatusTypeDef HAL_UARTEx_ReceiveToIdle_IT(
        UART_HandleTypeDef *h, uint8_t *p, uint16_t s)
{ (void)h; (void)p; (void)s; return HAL_OK; }

static inline HAL_StatusTypeDef HAL_SPI_TransmitReceive(
        SPI_HandleTypeDef *h, uint8_t *tx, uint8_t *rx, uint16_t s, uint32_t t)
{ (void)h; (void)tx; (void)t; if (rx) memset(rx, 0, s); return HAL_OK; }

static inline HAL_StatusTypeDef HAL_I2C_IsDeviceReady(
        I2C_HandleTypeDef *h, uint16_t addr, uint32_t trials, uint32_t t)
{ (void)h; (void)addr; (void)trials; (void)t; return HAL_ERROR; }

static inline HAL_StatusTypeDef HAL_I2C_Master_Transmit(
        I2C_HandleTypeDef *h, uint16_t addr, uint8_t *p, uint16_t s, uint32_t t)
{ (void)h; (void)addr; (void)p; (void)s; (void)t; return HAL_OK; }

static inline HAL_StatusTypeDef HAL_I2C_Master_Receive(
        I2C_HandleTypeDef *h, uint16_t addr, uint8_t *p, uint16_t s, uint32_t t)
{ (void)h; (void)addr; (void)p; (void)s; (void)t; return HAL_OK; }

static inline HAL_StatusTypeDef HAL_I2C_Mem_Read(
        I2C_HandleTypeDef *h, uint16_t addr, uint16_t reg, uint16_t regSize,
        uint8_t *p, uint16_t s, uint32_t t)
{ (void)h; (void)addr; (void)reg; (void)regSize; (void)t; if (p) memset(p, 0, s); return HAL_OK; }

static inline uint32_t HAL_I2C_GetError(I2C_HandleTypeDef *h)
{ (void)h; return HAL_I2C_ERROR_NONE; }

static inline void HAL_GPIO_WritePin(
        GPIO_TypeDef *p, uint32_t pin, GPIO_PinState s)
{ (void)p; (void)pin; (void)s; }

static inline void HAL_GPIO_TogglePin(GPIO_TypeDef *p, uint32_t pin)
{ (void)p; (void)pin; }

/* Returns 0 so delay_us() computes zero busy-wait ticks on host (the DWT
 * cycle counter never advances here — a non-zero clock would spin forever). */
static inline uint32_t HAL_RCC_GetHCLKFreq(void) { return 0UL; }

static inline void HAL_NVIC_SetPriority(IRQn_Type irq, uint32_t p, uint32_t s)
{ (void)irq; (void)p; (void)s; }

static inline void HAL_NVIC_EnableIRQ(IRQn_Type irq)
{ (void)irq; }

static inline void HAL_NVIC_ClearPendingIRQ(IRQn_Type irq)
{ (void)irq; }

static inline HAL_StatusTypeDef HAL_FDCAN_ConfigFilter(
        FDCAN_HandleTypeDef *h, FDCAN_FilterTypeDef *f)
{ (void)h; (void)f; return HAL_OK; }

static inline HAL_StatusTypeDef HAL_FDCAN_ConfigGlobalFilter(
        FDCAN_HandleTypeDef *h, uint32_t a, uint32_t b, uint32_t c, uint32_t d)
{ (void)h; (void)a; (void)b; (void)c; (void)d; return HAL_OK; }

static inline HAL_StatusTypeDef HAL_FDCAN_Start(FDCAN_HandleTypeDef *h)
{ (void)h; return HAL_OK; }

static inline HAL_StatusTypeDef HAL_FDCAN_ActivateNotification(
        FDCAN_HandleTypeDef *h, uint32_t n, uint32_t b)
{ (void)h; (void)n; (void)b; return HAL_OK; }

#ifndef HAL_FDCAN_GetRxMessage
static inline HAL_StatusTypeDef HAL_FDCAN_GetRxMessage(
        FDCAN_HandleTypeDef *h, uint32_t fifo,
        FDCAN_RxHeaderTypeDef *hdr, uint8_t *data)
{ (void)h; (void)fifo; (void)hdr; (void)data; return HAL_ERROR; }
#endif

static inline HAL_StatusTypeDef HAL_FDCAN_AddMessageToTxFifoQ(
        FDCAN_HandleTypeDef *h, FDCAN_TxHeaderTypeDef *hdr, uint8_t *data)
{ (void)h; (void)hdr; (void)data; return HAL_OK; }

static inline HAL_StatusTypeDef HAL_TIM_Base_Start_IT(TIM_HandleTypeDef *h)
{ (void)h; return HAL_OK; }

static inline HAL_StatusTypeDef HAL_TIM_Base_Stop_IT(TIM_HandleTypeDef *h)
{ (void)h; return HAL_OK; }

static inline HAL_StatusTypeDef HAL_TIM_Base_Init(TIM_HandleTypeDef *h)
{ (void)h; return HAL_OK; }

static inline void HAL_IncTick(void) {}

#endif /* STM32U5XX_HAL_H */
