/* USER CODE BEGIN Header */
///**
//  ******************************************************************************
//  * @file           : main.c
//  * @brief          : SPI Master (HW NSS, polling) + UART1 console
//  ******************************************************************************
//  * @attention
//  * - Target   : STM32U5 (e.g., NUCLEO-U575ZI-Q)
//  * - SPI1 pins: PA4(NSS, AF5), PA5(SCK, AF5), PA6(MISO, AF5), PA7(MOSI, AF5)
//  * - UART1   : PA9(TX, AF7),  PA10(RX, AF7) @ 115200 8N1
//  * - LED     : LED_GREEN toggles each SPI transfer
//  ******************************************************************************
//  */
/* USER CODE END Header */

/*
 * CLOCK CHANGES FROM ORIGINAL:
 *   SystemClock_Config: SYSCLK bumped from 4 MHz MSI to 48 MHz MSI.
 *
 *   Root cause of MRAF: At 4 MHz AHB and 500 kbps CAN, one CAN bit = 2 µs =
 *   only 8 AHB cycles. The FDCAN peripheral needs multiple AHB cycles to write
 *   a received frame header + data + acknowledge into message RAM. With only
 *   8 cycles any CPU AHB access during reception causes FDCAN to miss its
 *   window → MRAF fires and the frame is dropped. This is why no software fix
 *   (ISR gating, MPU, recovery debounce) fully solved the problem.
 *
 *   At 48 MHz AHB: 96 AHB cycles per CAN bit. Plenty of headroom.
 *
 *   PLL is kept running for FDCAN clock (PLL1Q):
 *     MSI=48 MHz, PLLM=8 → VCI=6 MHz, PLLN=43 → VCO=258 MHz, PLLQ=1
 *     PLL1Q = 258 MHz → DIV4 → 64.5 MHz FDCAN kernel clock (unchanged)
 *     500 kbps bitrate unchanged.
 *
 *   Voltage scaling changed VOS3 → VOS2 (VOS3 caps at ~16 MHz).
 *   Flash latency changed to FLASH_LATENCY_2 (safe for 48 MHz at VOS2).
 *
 *   MX_TIM7_Init: prescaler updated for 48 MHz PCLK1 to keep 10 s heartbeat.
 */

/* Includes ------------------------------------------------------------------*/
#include "main.h"

/* Private includes ----------------------------------------------------------*/
/* USER CODE BEGIN Includes */
#include "dev.h"
#include "can.h"
/* USER CODE END Includes */

/* Private variables ---------------------------------------------------------*/
FDCAN_HandleTypeDef hfdcan1;
SPI_HandleTypeDef hspi1;
UART_HandleTypeDef huart1;
UART_HandleTypeDef huart2;

/* USER CODE BEGIN PV */
TIM_HandleTypeDef htim7;
I2C_HandleTypeDef hi2c1;
/* USER CODE END PV */

/* Private function prototypes -----------------------------------------------*/
void SystemClock_Config(void);
static void SystemPower_Config(void);
static void MX_GPIO_Init(void);
static void MX_ICACHE_Init(void);
static void MX_USART1_UART_Init(void);
static void MX_SPI1_Init(void);
static void MX_USART2_UART_Init(void);
static void MX_FDCAN1_Init(void);
/* USER CODE BEGIN PFP */
static void MX_TIM7_Init(void);
static void MX_I2C1_Init(void);
/* USER CODE END PFP */

/**
  * @brief  The application entry point.
  * @retval int
  */
int main(void)
{
  /* USER CODE BEGIN 1 */
  /* USER CODE END 1 */

  HAL_Init();

  /* USER CODE BEGIN Init */
  /* USER CODE END Init */

  SystemPower_Config();
  SystemClock_Config();

  /* USER CODE BEGIN SysInit */
  /* USER CODE END SysInit */

  MX_GPIO_Init();
  MX_ICACHE_Init();
  MX_USART1_UART_Init();
  MX_SPI1_Init();
  MX_USART2_UART_Init();
  MX_FDCAN1_Init();

  /* USER CODE BEGIN 2 */
  MX_TIM7_Init();
  MX_I2C1_Init();
  Dev_Init();
  /* USER CODE END 2 */

  /* USER CODE BEGIN WHILE */
  while (1) {
    Dev_Poll();
    /* USER CODE END WHILE */
    /* USER CODE BEGIN 3 */
  }
  /* USER CODE END 3 */
}

/**
  * @brief System Clock Configuration
  *
  * SYSCLK = 48 MHz MSI (was 4 MHz).
  * PLL1Q  = 258 MHz for FDCAN — identical to original, 500 kbps unchanged.
  *
  * MSI=48 MHz, PLLM=8 → VCI=6 MHz (in PLLVCIRANGE_0: 4–8 MHz)
  * PLLN=43 → VCO=258 MHz, PLLQ=1 → PLL1Q=258 MHz
  * PLLR=2  → PLL1R=129 MHz (unused by SYSCLK, kept for completeness)
  */
void SystemClock_Config(void)
{
  RCC_OscInitTypeDef RCC_OscInitStruct = {0};
  RCC_ClkInitTypeDef RCC_ClkInitStruct = {0};

  /* VOS2 required for SYSCLK up to ~100 MHz. Original VOS3 only goes to ~16 MHz. */
  if (HAL_PWREx_ControlVoltageScaling(PWR_REGULATOR_VOLTAGE_SCALE2) != HAL_OK)
  {
    Error_Handler();
  }

  RCC_OscInitStruct.OscillatorType      = RCC_OSCILLATORTYPE_MSI;
  RCC_OscInitStruct.MSIState            = RCC_MSI_ON;
  RCC_OscInitStruct.MSICalibrationValue = RCC_MSICALIBRATION_DEFAULT;
  RCC_OscInitStruct.MSIClockRange       = RCC_MSIRANGE_0;   /* 48 MHz (was RCC_MSIRANGE_4 = 4 MHz) */
  RCC_OscInitStruct.PLL.PLLState        = RCC_PLL_ON;
  RCC_OscInitStruct.PLL.PLLSource       = RCC_PLLSOURCE_MSI;
  RCC_OscInitStruct.PLL.PLLMBOOST       = RCC_PLLMBOOST_DIV1;
  RCC_OscInitStruct.PLL.PLLM            = 8;    /* 48 / 8  = 6 MHz VCI input            */
  RCC_OscInitStruct.PLL.PLLN            = 43;   /* 6  * 43 = 258 MHz VCO                */
  RCC_OscInitStruct.PLL.PLLP            = 2;    /* 258 / 2 = 129 MHz (unused)           */
  RCC_OscInitStruct.PLL.PLLQ            = 1;    /* 258 / 1 = 258 MHz → FDCAN unchanged  */
  RCC_OscInitStruct.PLL.PLLR            = 2;    /* 258 / 2 = 129 MHz (unused)           */
  RCC_OscInitStruct.PLL.PLLRGE          = RCC_PLLVCIRANGE_0; /* 4–8 MHz VCI range (6 MHz fits) */
  RCC_OscInitStruct.PLL.PLLFRACN        = 0;
  if (HAL_RCC_OscConfig(&RCC_OscInitStruct) != HAL_OK)
  {
    Error_Handler();
  }

  RCC_ClkInitStruct.ClockType      = RCC_CLOCKTYPE_HCLK  | RCC_CLOCKTYPE_SYSCLK
                                   | RCC_CLOCKTYPE_PCLK1 | RCC_CLOCKTYPE_PCLK2
                                   | RCC_CLOCKTYPE_PCLK3;
  RCC_ClkInitStruct.SYSCLKSource   = RCC_SYSCLKSOURCE_MSI; /* SYSCLK = 48 MHz MSI */
  RCC_ClkInitStruct.AHBCLKDivider  = RCC_SYSCLK_DIV1;      /* AHB    = 48 MHz     */
  RCC_ClkInitStruct.APB1CLKDivider = RCC_HCLK_DIV1;        /* APB1   = 48 MHz     */
  RCC_ClkInitStruct.APB2CLKDivider = RCC_HCLK_DIV1;        /* APB2   = 48 MHz     */
  RCC_ClkInitStruct.APB3CLKDivider = RCC_HCLK_DIV1;        /* APB3   = 48 MHz     */

  /* FLASH_LATENCY_2: safe for 48 MHz at VOS2.
   * (VOS2 at 48 MHz: 1 WS is sufficient, 2 WS is conservative and safe) */
  if (HAL_RCC_ClockConfig(&RCC_ClkInitStruct, FLASH_LATENCY_2) != HAL_OK)
  {
    Error_Handler();
  }
}

/**
  * @brief Power Configuration
  */
static void SystemPower_Config(void)
{
  HAL_PWREx_EnableVddIO2();
  HAL_PWREx_DisableUCPDDeadBattery();

  if (HAL_PWREx_ConfigSupply(PWR_SMPS_SUPPLY) != HAL_OK)
  {
    Error_Handler();
  }
}

/**
  * @brief FDCAN1 Initialization — unchanged from original.
  *        FDCAN kernel clock = PLL1Q = 258 MHz (via HAL_FDCAN_MspInit).
  *        DIV4 + prescaler 3 + 43 tq = 500 kbps nominal. Unchanged.
  */
static void MX_FDCAN1_Init(void)
{
  /* USER CODE BEGIN FDCAN1_Init 0 */
  /* USER CODE END FDCAN1_Init 0 */

  /* USER CODE BEGIN FDCAN1_Init 1 */
  /* USER CODE END FDCAN1_Init 1 */
  hfdcan1.Instance = FDCAN1;
  hfdcan1.Init.ClockDivider        = FDCAN_CLOCK_DIV1;
  hfdcan1.Init.FrameFormat         = FDCAN_FRAME_CLASSIC;
  hfdcan1.Init.Mode                = FDCAN_MODE_NORMAL;
  hfdcan1.Init.AutoRetransmission  = DISABLE;
  hfdcan1.Init.TransmitPause       = DISABLE;
  hfdcan1.Init.ProtocolException   = DISABLE;
  hfdcan1.Init.NominalPrescaler    = 16;
  hfdcan1.Init.NominalSyncJumpWidth = 1;
  hfdcan1.Init.NominalTimeSeg1     = 1;
  hfdcan1.Init.NominalTimeSeg2     = 1;
  hfdcan1.Init.DataPrescaler       = 1;
  hfdcan1.Init.DataSyncJumpWidth   = 1;
  hfdcan1.Init.DataTimeSeg1        = 1;
  hfdcan1.Init.DataTimeSeg2        = 1;
  hfdcan1.Init.StdFiltersNbr       = 0;
  hfdcan1.Init.ExtFiltersNbr       = 0;
  hfdcan1.Init.TxFifoQueueMode     = FDCAN_TX_FIFO_OPERATION;
  if (HAL_FDCAN_Init(&hfdcan1) != HAL_OK)
  {
    Error_Handler();
  }
  /* USER CODE BEGIN FDCAN1_Init 2 */
  /* Override broken CubeMX defaults with correct 500 kbps settings. */
  HAL_FDCAN_DeInit(&hfdcan1);
  hfdcan1.Init.ClockDivider         = FDCAN_CLOCK_DIV4;
  hfdcan1.Init.FrameFormat          = FDCAN_FRAME_FD_NO_BRS;
  hfdcan1.Init.AutoRetransmission   = ENABLE;
  hfdcan1.Init.NominalPrescaler     = 3;
  hfdcan1.Init.NominalSyncJumpWidth = 8;
  hfdcan1.Init.NominalTimeSeg1      = 34;
  hfdcan1.Init.NominalTimeSeg2      = 8;
  hfdcan1.Init.DataPrescaler        = 1;
  hfdcan1.Init.DataSyncJumpWidth    = 16;
  hfdcan1.Init.DataTimeSeg1         = 23;
  hfdcan1.Init.DataTimeSeg2         = 16;
  hfdcan1.Init.StdFiltersNbr        = 1;
  hfdcan1.Init.ExtFiltersNbr        = 1;
  if (HAL_FDCAN_Init(&hfdcan1) != HAL_OK)
  {
    Error_Handler();
  }
  /* USER CODE END FDCAN1_Init 2 */
}

/**
  * @brief ICACHE Initialization
  */
static void MX_ICACHE_Init(void)
{
  /* USER CODE BEGIN ICACHE_Init 0 */
  /* USER CODE END ICACHE_Init 0 */
  /* USER CODE BEGIN ICACHE_Init 1 */
  /* USER CODE END ICACHE_Init 1 */
  if (HAL_ICACHE_ConfigAssociativityMode(ICACHE_1WAY) != HAL_OK)
  {
    Error_Handler();
  }
  if (HAL_ICACHE_Enable() != HAL_OK)
  {
    Error_Handler();
  }
  /* USER CODE BEGIN ICACHE_Init 2 */
  /* USER CODE END ICACHE_Init 2 */
}

/**
  * @brief SPI1 Initialization
  */
static void MX_SPI1_Init(void)
{
  /* USER CODE BEGIN SPI1_Init 0 */
  /* USER CODE END SPI1_Init 0 */

  SPI_AutonomousModeConfTypeDef HAL_SPI_AutonomousMode_Cfg_Struct = {0};

  /* USER CODE BEGIN SPI1_Init 1 */
  /* USER CODE END SPI1_Init 1 */
  hspi1.Instance                        = SPI1;
  hspi1.Init.Mode                       = SPI_MODE_MASTER;
  hspi1.Init.Direction                  = SPI_DIRECTION_2LINES;
  hspi1.Init.DataSize                   = SPI_DATASIZE_8BIT;
  hspi1.Init.CLKPolarity                = SPI_POLARITY_LOW;
  hspi1.Init.CLKPhase                   = SPI_PHASE_1EDGE;
  hspi1.Init.NSS                        = SPI_NSS_HARD_OUTPUT;
  hspi1.Init.BaudRatePrescaler          = SPI_BAUDRATEPRESCALER_2;
  hspi1.Init.FirstBit                   = SPI_FIRSTBIT_MSB;
  hspi1.Init.TIMode                     = SPI_TIMODE_DISABLE;
  hspi1.Init.CRCCalculation             = SPI_CRCCALCULATION_DISABLE;
  hspi1.Init.CRCPolynomial              = 0x7;
  hspi1.Init.NSSPMode                   = SPI_NSS_PULSE_ENABLE;
  hspi1.Init.NSSPolarity                = SPI_NSS_POLARITY_LOW;
  hspi1.Init.FifoThreshold              = SPI_FIFO_THRESHOLD_01DATA;
  hspi1.Init.MasterSSIdleness          = SPI_MASTER_SS_IDLENESS_00CYCLE;
  hspi1.Init.MasterInterDataIdleness   = SPI_MASTER_INTERDATA_IDLENESS_00CYCLE;
  hspi1.Init.MasterReceiverAutoSusp    = SPI_MASTER_RX_AUTOSUSP_DISABLE;
  hspi1.Init.MasterKeepIOState         = SPI_MASTER_KEEP_IO_STATE_DISABLE;
  hspi1.Init.IOSwap                    = SPI_IO_SWAP_DISABLE;
  hspi1.Init.ReadyMasterManagement     = SPI_RDY_MASTER_MANAGEMENT_INTERNALLY;
  hspi1.Init.ReadyPolarity             = SPI_RDY_POLARITY_HIGH;
  if (HAL_SPI_Init(&hspi1) != HAL_OK)
  {
    Error_Handler();
  }
  HAL_SPI_AutonomousMode_Cfg_Struct.TriggerState     = SPI_AUTO_MODE_DISABLE;
  HAL_SPI_AutonomousMode_Cfg_Struct.TriggerSelection = SPI_GRP1_GPDMA_CH0_TCF_TRG;
  HAL_SPI_AutonomousMode_Cfg_Struct.TriggerPolarity  = SPI_TRIG_POLARITY_RISING;
  if (HAL_SPIEx_SetConfigAutonomousMode(&hspi1, &HAL_SPI_AutonomousMode_Cfg_Struct) != HAL_OK)
  {
    Error_Handler();
  }
  /* USER CODE BEGIN SPI1_Init 2 */
  /* USER CODE END SPI1_Init 2 */
}

/**
  * @brief USART1 Initialization
  */
static void MX_USART1_UART_Init(void)
{
  /* USER CODE BEGIN USART1_Init 0 */
  /* USER CODE END USART1_Init 0 */
  /* USER CODE BEGIN USART1_Init 1 */
  /* USER CODE END USART1_Init 1 */
  huart1.Instance                    = USART1;
  huart1.Init.BaudRate               = 115200;
  huart1.Init.WordLength             = UART_WORDLENGTH_8B;
  huart1.Init.StopBits               = UART_STOPBITS_1;
  huart1.Init.Parity                 = UART_PARITY_NONE;
  huart1.Init.Mode                   = UART_MODE_TX_RX;
  huart1.Init.HwFlowCtl              = UART_HWCONTROL_NONE;
  huart1.Init.OverSampling           = UART_OVERSAMPLING_16;
  huart1.Init.OneBitSampling         = UART_ONE_BIT_SAMPLE_DISABLE;
  huart1.Init.ClockPrescaler         = UART_PRESCALER_DIV1;
  huart1.AdvancedInit.AdvFeatureInit = UART_ADVFEATURE_NO_INIT;
  if (HAL_UART_Init(&huart1) != HAL_OK)
  {
    Error_Handler();
  }
  if (HAL_UARTEx_SetTxFifoThreshold(&huart1, UART_TXFIFO_THRESHOLD_1_8) != HAL_OK)
  {
    Error_Handler();
  }
  if (HAL_UARTEx_SetRxFifoThreshold(&huart1, UART_RXFIFO_THRESHOLD_1_8) != HAL_OK)
  {
    Error_Handler();
  }
  if (HAL_UARTEx_DisableFifoMode(&huart1) != HAL_OK)
  {
    Error_Handler();
  }
  /* USER CODE BEGIN USART1_Init 2 */
  /* USER CODE END USART1_Init 2 */
}

/**
  * @brief USART2 Initialization
  */
static void MX_USART2_UART_Init(void)
{
  /* USER CODE BEGIN USART2_Init 0 */
  /* USER CODE END USART2_Init 0 */
  /* USER CODE BEGIN USART2_Init 1 */
  /* USER CODE END USART2_Init 1 */
  huart2.Instance                    = USART2;
  huart2.Init.BaudRate               = 115200;
  huart2.Init.WordLength             = UART_WORDLENGTH_8B;
  huart2.Init.StopBits               = UART_STOPBITS_1;
  huart2.Init.Parity                 = UART_PARITY_NONE;
  huart2.Init.Mode                   = UART_MODE_TX_RX;
  huart2.Init.HwFlowCtl              = UART_HWCONTROL_NONE;
  huart2.Init.OverSampling           = UART_OVERSAMPLING_16;
  huart2.Init.OneBitSampling         = UART_ONE_BIT_SAMPLE_DISABLE;
  huart2.Init.ClockPrescaler         = UART_PRESCALER_DIV1;
  huart2.AdvancedInit.AdvFeatureInit = UART_ADVFEATURE_NO_INIT;
  if (HAL_UART_Init(&huart2) != HAL_OK)
  {
    Error_Handler();
  }
  if (HAL_UARTEx_SetTxFifoThreshold(&huart2, UART_TXFIFO_THRESHOLD_1_8) != HAL_OK)
  {
    Error_Handler();
  }
  if (HAL_UARTEx_SetRxFifoThreshold(&huart2, UART_RXFIFO_THRESHOLD_1_8) != HAL_OK)
  {
    Error_Handler();
  }
  if (HAL_UARTEx_DisableFifoMode(&huart2) != HAL_OK)
  {
    Error_Handler();
  }
  /* USER CODE BEGIN USART2_Init 2 */
  /* USER CODE END USART2_Init 2 */
}

/**
  * @brief GPIO Initialization
  */
static void MX_GPIO_Init(void)
{
  GPIO_InitTypeDef GPIO_InitStruct = {0};
  /* USER CODE BEGIN MX_GPIO_Init_1 */
  /* USER CODE END MX_GPIO_Init_1 */

  __HAL_RCC_GPIOC_CLK_ENABLE();
  __HAL_RCC_GPIOA_CLK_ENABLE();
  __HAL_RCC_GPIOG_CLK_ENABLE();
  __HAL_RCC_GPIOD_CLK_ENABLE();
  __HAL_RCC_GPIOB_CLK_ENABLE();

  HAL_GPIO_WritePin(LED_RED_GPIO_Port,   LED_RED_Pin,   GPIO_PIN_RESET);
  HAL_GPIO_WritePin(LED_GREEN_GPIO_Port, LED_GREEN_Pin, GPIO_PIN_RESET);
  HAL_GPIO_WritePin(LED_BLUE_GPIO_Port,  LED_BLUE_Pin,  GPIO_PIN_RESET);

  GPIO_InitStruct.Pin  = USER_BUTTON_Pin;
  GPIO_InitStruct.Mode = GPIO_MODE_IT_RISING;
  GPIO_InitStruct.Pull = GPIO_NOPULL;
  HAL_GPIO_Init(USER_BUTTON_GPIO_Port, &GPIO_InitStruct);

  GPIO_InitStruct.Pin   = LED_RED_Pin;
  GPIO_InitStruct.Mode  = GPIO_MODE_OUTPUT_PP;
  GPIO_InitStruct.Pull  = GPIO_NOPULL;
  GPIO_InitStruct.Speed = GPIO_SPEED_FREQ_LOW;
  HAL_GPIO_Init(LED_RED_GPIO_Port, &GPIO_InitStruct);

  GPIO_InitStruct.Pin   = LED_GREEN_Pin;
  HAL_GPIO_Init(LED_GREEN_GPIO_Port, &GPIO_InitStruct);

  GPIO_InitStruct.Pin   = LED_BLUE_Pin;
  HAL_GPIO_Init(LED_BLUE_GPIO_Port, &GPIO_InitStruct);

  /* USER CODE BEGIN MX_GPIO_Init_2 */
  /* USER CODE END MX_GPIO_Init_2 */
}

/* USER CODE BEGIN 4 */

/**
  * @brief TIM7 Initialization
  *
  * PCLK1 = 48 MHz (was 4 MHz). Prescaler updated to keep 10 s heartbeat period.
  *   PSC = 47999 → tick rate = 48 MHz / 48000 = 1 kHz
  *   ARR = 9999  → interrupt rate = 1 kHz / 10000 = 0.1 Hz → 10 s period
  */
static void MX_TIM7_Init(void)
{
    htim7.Instance               = TIM7;
    htim7.Init.Prescaler         = 47999;   /* 48 MHz / 48000 = 1 kHz tick (was 3999 for 4 MHz) */
    htim7.Init.CounterMode       = TIM_COUNTERMODE_UP;
    htim7.Init.Period            = 9999;    /* 1 kHz / 10000 = 10 s period (unchanged) */
    htim7.Init.AutoReloadPreload = TIM_AUTORELOAD_PRELOAD_DISABLE;
    if (HAL_TIM_Base_Init(&htim7) != HAL_OK)
    {
        Error_Handler();
    }
}

static void MX_I2C1_Init(void)
{
    GPIO_InitTypeDef GPIO_InitStruct = {0};

    __HAL_RCC_GPIOB_CLK_ENABLE();
    __HAL_RCC_I2C1_CLK_ENABLE();

    GPIO_InitStruct.Pin       = GPIO_PIN_8 | GPIO_PIN_9;
    GPIO_InitStruct.Mode      = GPIO_MODE_AF_OD;
    GPIO_InitStruct.Pull      = GPIO_PULLUP;
    GPIO_InitStruct.Speed     = GPIO_SPEED_FREQ_LOW;
    GPIO_InitStruct.Alternate = GPIO_AF4_I2C1;
    HAL_GPIO_Init(GPIOB, &GPIO_InitStruct);

    hi2c1.Instance             = I2C1;
    hi2c1.Init.Timing          = 0x00110F12;
    hi2c1.Init.OwnAddress1     = 0;
    hi2c1.Init.AddressingMode  = I2C_ADDRESSINGMODE_7BIT;
    hi2c1.Init.DualAddressMode = I2C_DUALADDRESS_DISABLE;
    hi2c1.Init.OwnAddress2     = 0;
    hi2c1.Init.GeneralCallMode = I2C_GENERALCALL_DISABLE;
    hi2c1.Init.NoStretchMode   = I2C_NOSTRETCH_DISABLE;
    if (HAL_I2C_Init(&hi2c1) != HAL_OK)
    {
        Error_Handler();
    }
}

void HAL_UART_RxCpltCallback(UART_HandleTypeDef *huart)
{
    Dev_UART_RxCpltCallback(huart);
}

void HAL_UARTEx_RxEventCallback(UART_HandleTypeDef *huart, uint16_t Size)
{
    Dev_UART_RxEventCallback(huart, Size);
}

void HAL_UART_ErrorCallback(UART_HandleTypeDef *huart)
{
    Dev_UART_ErrorCallback(huart);
}
/* USER CODE END 4 */

/**
  * @brief  This function is executed in case of error occurrence.
  */
void Error_Handler(void)
{
  /* USER CODE BEGIN Error_Handler_Debug */
  HAL_GPIO_WritePin(LED_RED_GPIO_Port, LED_RED_Pin, GPIO_PIN_SET);
  /* USER CODE END Error_Handler_Debug */
}

#ifdef USE_FULL_ASSERT
void assert_failed(uint8_t *file, uint32_t line)
{
  /* USER CODE BEGIN 6 */
  /* USER CODE END 6 */
}
#endif /* USE_FULL_ASSERT */