/*
 * stm32u5xx_hal.h  —  Host-side HAL stub for unit tests
 *
 * Self-contained replacement for the full STM32U5 HAL headers.  Provides
 * every type, constant, and inline function that dev.c and can.c reference,
 * compiled with plain gcc on a Linux/macOS/Windows host.
 *
 * Rules:
 *   - No inclusion of real STM32 or CMSIS headers.
 *   - All HAL functions are static inline stubs that return HAL_OK.
 *   - Peripheral instance types are opaque structs (uint32_t dummy).
 *   - DWT / CoreDebug are backed by real static variables so pointer
 *     arithmetic in dev.c compiles and runs without fault.
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
 * Needs to be a real struct so pointer comparisons (htim->Instance == TIM7)
 * compile.  We define named singleton instances further below.
 * -------------------------------------------------------------------------- */
typedef struct { uint32_t dummy; } USART_TypeDef;
typedef struct { uint32_t dummy; } SPI_TypeDef;
typedef struct { uint32_t dummy; } FDCAN_GlobalTypeDef;
typedef struct { uint32_t dummy; } TIM_TypeDef;
typedef struct { uint32_t dummy; } GPIO_TypeDef;

/* Singleton peripheral instances referenced by name in can.c / dev.c */
static USART_TypeDef  _stub_USART1  = {0};
static USART_TypeDef  _stub_USART2  = {0};
static SPI_TypeDef    _stub_SPI1    = {0};
static TIM_TypeDef    _stub_TIM7    = {0};
static TIM_TypeDef    _stub_TIM17   = {0};
static GPIO_TypeDef   _stub_GPIOC   = {0};
static GPIO_TypeDef   _stub_GPIOG   = {0};

#define USART1  (&_stub_USART1)
#define USART2  (&_stub_USART2)
#define SPI1    (&_stub_SPI1)
#define TIM7    (&_stub_TIM7)
#define TIM17   (&_stub_TIM17)
#define GPIOC   (&_stub_GPIOC)
#define GPIOG   (&_stub_GPIOG)

/* GPIO pin constants used as raw bit masks in can.c debug writes */
#define GPIO_PIN_2   (1U << 2)
#define GPIO_PIN_7   (1U << 7)

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
} FDCAN_HandleTypeDef;

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
    uint32_t DataLength;    /* Set to raw byte count (0-64) in test stubs;
                               see audit note on dlc_to_bytes truncation bug */
    uint32_t ErrorStateIndicator;
    uint32_t BitRateSwitch;
    uint32_t FDFormat;
    uint32_t RxTimestamp;
    uint32_t FilterIndex;
    uint32_t IsFilterMatchingFrame;
} FDCAN_RxHeaderTypeDef;

/* --------------------------------------------------------------------------
 * DWT / CoreDebug — backed by real static storage so pointer writes in
 * dwt_init() and delay_us() are harmless no-ops on host.
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
 * SPI constants  (used in dev.c SPI task)
 * -------------------------------------------------------------------------- */
#define SPI_TIMODE_DISABLE  0U

/* --------------------------------------------------------------------------
 * TIM constants
 * -------------------------------------------------------------------------- */
#define TIM_COUNTERMODE_UP              0U
#define TIM_AUTORELOAD_PRELOAD_DISABLE  0U

/* --------------------------------------------------------------------------
 * FDCAN constants
 * Values match the real STM32U5 HAL where it matters for logic tests
 * (e.g. FDCAN_IT_RX_FIFO0_NEW_MESSAGE is checked by bit-AND in the callback).
 * -------------------------------------------------------------------------- */
#define FDCAN_CLOCK_DIV4                0x00000006U
#define FDCAN_FRAME_CLASSIC             0x00000000U
#define FDCAN_FRAME_FD_BRS              0x00000002U
#define FDCAN_MODE_NORMAL               0x00000000U
#define FDCAN_TX_FIFO_OPERATION         0x00000000U
#define FDCAN_STANDARD_ID               0x00000000U
#define FDCAN_EXTENDED_ID               0x40000000U
#define FDCAN_DATA_FRAME                0x00000000U
#define FDCAN_ESI_ACTIVE                0x00000000U
#define FDCAN_BRS_ON                    0x00000001U
#define FDCAN_BRS_OFF                   0x00000000U
#define FDCAN_FD_CAN                    0x00000001U
#define FDCAN_CLASSIC_CAN               0x00000000U
#define FDCAN_STORE_TX_EVENTS           0x00000002U
#define FDCAN_FILTER_RANGE              0x00000000U
#define FDCAN_FILTER_RANGE_NO_EIDM      0x00000003U
#define FDCAN_FILTER_TO_RXFIFO0         0x00000001U
#define FDCAN_FILTER_TO_RXFIFO1         0x00000002U
#define FDCAN_ACCEPT_IN_RX_FIFO0        0x00000000U
#define FDCAN_FILTER_REMOTE             0x00000001U
#define FDCAN_RX_FIFO0                  0x00000000U
#define FDCAN_RX_FIFO1                  0x00000001U

/* Interrupt flag bits — must remain non-overlapping so bit-AND checks work */
#define FDCAN_IT_RX_FIFO0_NEW_MESSAGE   0x00000001U
#define FDCAN_IT_RX_FIFO1_NEW_MESSAGE   0x00000002U
#define FDCAN_IT_BUS_OFF                0x00000004U
#define FDCAN_IT_ERROR_WARNING          0x00000008U
#define FDCAN_IT_ERROR_PASSIVE          0x00000010U
#define FDCAN_IT_DATA_PROTOCOL_ERROR    0x00000020U
#define FDCAN_IT_ARB_PROTOCOL_ERROR     0x00000040U

/*
 * DLC byte-count constants.
 *
 * In the real STM32U5 HAL these are 0x000X0000 (the byte count lives in bits
 * [19:16]).  dlc_to_bytes() in can.c takes a uint8_t argument — when
 * RxHeader.DataLength (uint32_t) is passed to it the value is truncated to
 * the low byte, which is 0x00 for every real HAL constant.  That is the
 * truncation bug documented in the audit.
 *
 * For the test stub (HAL_FDCAN_GetRxMessage override in test_can_queue.c) we
 * set RxHeader.DataLength to the raw byte count (0-8) directly, which passes
 * through the uint8_t truncation correctly and gives dlc_to_bytes the right
 * index.  These macros are still defined here for use in CAN_Transmit calls
 * inside dev.c / can.c.
 */
#define FDCAN_DLC_BYTES_0   0x00000000U
#define FDCAN_DLC_BYTES_1   0x00010000U
#define FDCAN_DLC_BYTES_2   0x00020000U
#define FDCAN_DLC_BYTES_3   0x00030000U
#define FDCAN_DLC_BYTES_4   0x00040000U
#define FDCAN_DLC_BYTES_5   0x00050000U
#define FDCAN_DLC_BYTES_6   0x00060000U
#define FDCAN_DLC_BYTES_7   0x00070000U
#define FDCAN_DLC_BYTES_8   0x00080000U
#define FDCAN_DLC_BYTES_12  0x00090000U
#define FDCAN_DLC_BYTES_16  0x000A0000U
#define FDCAN_DLC_BYTES_20  0x000B0000U
#define FDCAN_DLC_BYTES_24  0x000C0000U
#define FDCAN_DLC_BYTES_32  0x000D0000U
#define FDCAN_DLC_BYTES_48  0x000E0000U
#define FDCAN_DLC_BYTES_64  0x000F0000U

/* --------------------------------------------------------------------------
 * HAL function stubs — all static inline, return HAL_OK, touch no hardware
 * -------------------------------------------------------------------------- */
static inline HAL_StatusTypeDef HAL_UART_Transmit(
        UART_HandleTypeDef *h, const uint8_t *p, uint16_t s, uint32_t t)
{ (void)h; (void)p; (void)s; (void)t; return HAL_OK; }

static inline HAL_StatusTypeDef HAL_UART_Receive_IT(
        UART_HandleTypeDef *h, uint8_t *p, uint16_t s)
{ (void)h; (void)p; (void)s; return HAL_OK; }

static inline HAL_StatusTypeDef HAL_SPI_TransmitReceive(
        SPI_HandleTypeDef *h, uint8_t *tx, uint8_t *rx, uint16_t s, uint32_t t)
{ (void)h; (void)tx; (void)s; (void)t; if (rx) *rx = 0; return HAL_OK; }

static inline void HAL_GPIO_WritePin(
        GPIO_TypeDef *p, uint32_t pin, GPIO_PinState s)
{ (void)p; (void)pin; (void)s; }

static inline void HAL_GPIO_TogglePin(GPIO_TypeDef *p, uint32_t pin)
{ (void)p; (void)pin; }

static inline uint32_t HAL_GetTick(void) { return 0; }

static inline uint32_t HAL_RCC_GetHCLKFreq(void) { return 4000000UL; }

static inline void HAL_NVIC_SetPriority(IRQn_Type irq, uint32_t p, uint32_t s)
{ (void)irq; (void)p; (void)s; }

static inline void HAL_NVIC_EnableIRQ(IRQn_Type irq)
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

static inline HAL_StatusTypeDef HAL_FDCAN_GetRxMessage(
        FDCAN_HandleTypeDef *h, uint32_t fifo,
        FDCAN_RxHeaderTypeDef *hdr, uint8_t *data)
{ (void)h; (void)fifo; (void)hdr; (void)data; return HAL_OK; }

static inline HAL_StatusTypeDef HAL_FDCAN_AddMessageToTxFifoQ(
        FDCAN_HandleTypeDef *h, FDCAN_TxHeaderTypeDef *hdr, uint8_t *data)
{ (void)h; (void)hdr; (void)data; return HAL_OK; }

static inline HAL_StatusTypeDef HAL_TIM_Base_Start_IT(TIM_HandleTypeDef *h)
{ (void)h; return HAL_OK; }

static inline HAL_StatusTypeDef HAL_TIM_Base_Init(TIM_HandleTypeDef *h)
{ (void)h; return HAL_OK; }

static inline void HAL_IncTick(void) {}

#endif /* STM32U5XX_HAL_H */
