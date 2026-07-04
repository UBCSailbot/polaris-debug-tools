/*
 * can.c
 *
 *  Created on: Mar 8, 2025
 *      Author: Alisha
 *
 *  @brief 	 This file implements the function prototypes in can.h to initialize and handle FDCAN on an STM32.
 *
 *  @details The implementation includes buffer management, initialization, transmission, and
 *           reception handling with callback functions for handling received messages.
 *           NEW UPDATE: Messages are enqueued in interrupt context and dequeued
 *           in application context to prevent data corruption and race conditions
 *           + library adjusted to only standard filter
 *
 *  FIXES APPLIED:
 *   - Fix 2: HAL_FDCAN_RxFifo0Callback sets g_can_rx_pending and returns.
 *            All message RAM reads happen in CAN_DrainRxFifo() from main context.
 *   - Fix 3: Critical section around canRxHead/canRxTail reset in CAN_Init.
 *   - Fix 4: CAN_Init gains a start_timer parameter. Recovery paths pass 0.
 *   - Fix 5: CAN_DrainRxFifo force-writes RXF0A after a SUCCESSFUL read when
 *            fill level doesn't drop (MRAF blocked HAL's internal ack write).
 *            CRITICAL: force-ack is NEVER written on a failed read — doing so
 *            acknowledges a slot we didn't read and permanently loses the frame.
 *            A max_iters guard prevents infinite loops if force-ack also fails.
 */

/* Includes ------------------------------------------------------------------*/
#include "can.h"
#include "main.h"
#include <stdio.h>
#include <string.h>
#include <stdbool.h>
#include "stm32u5xx_hal_fdcan.h"

/* Variables ------------------------------------------------------------------*/
#define CAN_RX_QUEUE_SIZE 100U
static CAN_Frame CAN_Rx_Queue[CAN_RX_QUEUE_SIZE];
static volatile uint8_t canRxHead = 0;
static volatile uint8_t canRxTail = 0;
HAL_StatusTypeDef CanStartStatus;
extern TIM_HandleTypeDef htim7;
extern FDCAN_HandleTypeDef hfdcan1;
static uint32_t heartbeat_id;

/* Pending flag set in ISR, consumed in main context by CAN_DrainRxFifo().
 * Keeps all message RAM access out of interrupt context to avoid CPU vs
 * FDCAN peripheral arbitration races (MRAF). */
volatile uint8_t g_can_rx_pending = 0U;

/* Static Functions -----------------------------------------------------------*/
static int CAN_DequeueFrame(CAN_Frame *frame);
static void CAN_EnqueueFrame(uint32_t id, uint8_t len, const uint8_t *data);
uint8_t dlc_to_bytes(uint8_t dlc);

/* Functions ------------------------------------------------------------------*/

/**
 * @brief   Initializes the FDCAN module.
 * @param   hfdcan1:     Pointer to the FDCAN handle structure.
 * @param   hbid:        Heartbeat CAN ID to transmit on the TIM7 period.
 * @param   start_timer: Pass 1 to start TIM7 heartbeat, 0 to leave it stopped.
 */
void CAN_Init(FDCAN_HandleTypeDef *hfdcan1, uint32_t hbid, uint8_t start_timer)
{
    FDCAN_FilterTypeDef sFilterConfig;

    /* FIX 3: Guard queue index reset — ISR firing between these two lines
     * would leave head and tail inconsistent. Also clear the pending flag
     * so a stale signal from before re-init doesn't trigger a spurious drain. */
    uint32_t primask = __get_PRIMASK();
    __disable_irq();
    canRxHead = 0U;
    canRxTail = 0U;
    g_can_rx_pending = 0U;
    __set_PRIMASK(primask);

    hfdcan1->ErrorCode = HAL_FDCAN_ERROR_NONE;

    sFilterConfig.IdType = FDCAN_STANDARD_ID;
    sFilterConfig.FilterIndex = 0;
    sFilterConfig.FilterType = FDCAN_FILTER_RANGE;
    sFilterConfig.FilterConfig = FDCAN_FILTER_TO_RXFIFO0;
    sFilterConfig.FilterID1 = 0x000;
    sFilterConfig.FilterID2 = 0x7FF;
    if (HAL_FDCAN_ConfigFilter(hfdcan1, &sFilterConfig) != HAL_OK)
    {
        Error_Handler();
    }

    /* NOTE: POLARIS never uses extended (29-bit) CAN IDs — every node on the
     * boat bus transmits standard 11-bit IDs only. This extended-ID filter
     * (and the FIFO1 interrupt below) is therefore dead configuration kept
     * for HAL completeness: nothing ever drains RX FIFO1, so if extended-ID
     * traffic did appear it would fill FIFO1 and stop. If extended IDs are
     * ever adopted, add a HAL_FDCAN_RxFifo1Callback + drain path first. */
    sFilterConfig.IdType = FDCAN_EXTENDED_ID;
    sFilterConfig.FilterIndex = 0;
    sFilterConfig.FilterType = FDCAN_FILTER_RANGE_NO_EIDM;
    sFilterConfig.FilterConfig = FDCAN_FILTER_TO_RXFIFO1;
    sFilterConfig.FilterID1 = 0x1111111;
    sFilterConfig.FilterID2 = 0x2222222;
    if (HAL_FDCAN_ConfigFilter(hfdcan1, &sFilterConfig) != HAL_OK)
    {
        Error_Handler();
    }

    if (HAL_FDCAN_ConfigGlobalFilter(hfdcan1,
                                     FDCAN_ACCEPT_IN_RX_FIFO0,
                                     FDCAN_ACCEPT_IN_RX_FIFO0,
                                     FDCAN_FILTER_REMOTE,
                                     FDCAN_FILTER_REMOTE) != HAL_OK)
    {
        Error_Handler();
    }

    CanStartStatus = HAL_FDCAN_Start(hfdcan1);
    if (CanStartStatus != HAL_OK)
    {
        Error_Handler();
    }

    uint32_t notif =
          FDCAN_IT_RX_FIFO0_NEW_MESSAGE |
          FDCAN_IT_RX_FIFO0_FULL |
          FDCAN_IT_RX_FIFO0_MESSAGE_LOST |
          FDCAN_IT_BUS_OFF |
          FDCAN_IT_ERROR_WARNING |
          FDCAN_IT_ERROR_PASSIVE |
          FDCAN_IT_DATA_PROTOCOL_ERROR |
          FDCAN_IT_ARB_PROTOCOL_ERROR;

    if (HAL_FDCAN_ActivateNotification(hfdcan1, notif, 0) != HAL_OK)
    {
        Error_Handler();
    }

    if (HAL_FDCAN_ActivateNotification(hfdcan1, FDCAN_IT_RX_FIFO1_NEW_MESSAGE, 0) != HAL_OK)
    {
        Error_Handler();
    }

    /* FIX 4: Only start the timer when the caller requests it. */
    heartbeat_id = hbid;
    if (start_timer != 0U) {
        HAL_TIM_Base_Start_IT(&htim7);
    }
}

/**
 * @brief   Transmits a FDCAN message.
 */
HAL_StatusTypeDef CAN_Transmit(uint32_t Identifier, uint32_t IdType, uint32_t DataLength,
                                uint8_t *DataBuffer, FDCAN_HandleTypeDef *hfdcan1)
{
    FDCAN_TxHeaderTypeDef TxHeader = {0};

    TxHeader.Identifier = Identifier;
    TxHeader.IdType = IdType;
    TxHeader.TxFrameType = FDCAN_DATA_FRAME;
    TxHeader.DataLength = DataLength;
    TxHeader.ErrorStateIndicator = FDCAN_ESI_ACTIVE;
    TxHeader.BitRateSwitch = FDCAN_BRS_OFF;
    TxHeader.FDFormat = FDCAN_FD_CAN;
    TxHeader.TxEventFifoControl = FDCAN_STORE_TX_EVENTS;
    TxHeader.MessageMarker = 0U;

    return HAL_FDCAN_AddMessageToTxFifoQ(hfdcan1, &TxHeader, DataBuffer);
}

/**
 * @brief   Dequeues the next received CAN frame from the software queue.
 * @param   frame: Pointer to CAN_Frame to fill.
 * @return  HAL_OK if a frame was dequeued, HAL_ERROR if the queue is empty.
 * @note    Call from application context only, not from ISR.
 */
HAL_StatusTypeDef CAN_Receive(CAN_Frame *frame)
{
    if (CAN_DequeueFrame(frame) == 0) return HAL_ERROR;
    return HAL_OK;
}

/**
 * @brief   Drains FDCAN RX FIFO0 into the software queue.
 *
 * Called exclusively from main context (Dev_CAN_ServiceProtocol).
 * Never call from ISR — see HAL_FDCAN_RxFifo0Callback for why.
 *
 * MRAF (HAL_FDCAN_ERROR_RAM_ACCESS) on STM32U5 occurs when the FDCAN
 * peripheral's internal RXF0A acknowledge write races against CPU message
 * RAM access. When this happens, HAL_FDCAN_GetRxMessage returns HAL_OK
 * (data was read successfully) but the slot is not freed (F0FL stays high,
 * F0GI doesn't advance). Without intervention this causes:
 *   - The while loop to read the same slot repeatedly (duplicates)
 *   - The 3-slot FIFO to fill up (drops)
 *
 * Fix: after each successful read, compare fill level before vs after.
 * If fill level didn't drop, HAL's RXF0A write failed — force-write it
 * directly. The frame was already enqueued so this is safe.
 *
 * CRITICAL RULE: NEVER force-write RXF0A when GetRxMessage returned error.
 * That would acknowledge a slot we didn't read, permanently losing the frame.
 * On failure just break — the frame stays in the FIFO and will be retried
 * when the next arrival fires g_can_rx_pending again.
 *
 * max_iters guards against infinite loops if the force-write itself also
 * fails (MRAF on our write too) — bounds duplicates to 10 per poll cycle.
 */
void CAN_DrainRxFifo(void)
{
    FDCAN_RxHeaderTypeDef RxHeader = {0};
    uint8_t tmp[64] = {0};
    uint32_t rxf0s;
    uint32_t fill_before;
    uint32_t fill_after;
    uint32_t get_index;
    uint8_t max_iters = 10U;

    if (g_can_rx_pending == 0U) {
        return;
    }
    g_can_rx_pending = 0U;

    while (max_iters-- > 0U) {
        /* Snapshot RXF0S before the read. We need get_index to know which
         * slot HAL will try to acknowledge, so we can force-write it if
         * HAL's internal RXF0A write fails due to MRAF. */
        rxf0s      = hfdcan1.Instance->RXF0S;
        fill_before = (rxf0s & FDCAN_RXF0S_F0FL) >> FDCAN_RXF0S_F0FL_Pos;
        get_index  = (rxf0s & FDCAN_RXF0S_F0GI) >> FDCAN_RXF0S_F0GI_Pos;

        if (HAL_FDCAN_GetRxMessage(&hfdcan1, FDCAN_RX_FIFO0, &RxHeader, tmp) != HAL_OK) {
            /* FIFO empty OR read failed due to MRAF on the data read itself.
             *
             * DO NOT write RXF0A here. If we force-ack a slot we didn't
             * successfully read, the frame is permanently lost and F0GI
             * advances past it. This was the bug in the previous attempt
             * that caused zero frames received.
             *
             * If a frame is stuck due to MRAF, it will be retried when
             * the next frame arrives and fires g_can_rx_pending again. */
            break;
        }

        /* Data read succeeded — enqueue it immediately before any
         * further register access that might fail. */
        CAN_EnqueueFrame(RxHeader.Identifier, dlc_to_bytes(RxHeader.DataLength), tmp);

        fill_after = (hfdcan1.Instance->RXF0S & FDCAN_RXF0S_F0FL) >> FDCAN_RXF0S_F0FL_Pos;

        if ((fill_before > 0U) && (fill_after >= fill_before)) {
            /* Fill level didn't drop after a successful read. This means
             * MRAF blocked HAL's internal write to RXF0A. The frame data
             * is safely enqueued above, so force-writing RXF0A now is safe:
             * we're just freeing the slot we already consumed. */
            hfdcan1.Instance->RXF0A = get_index;
        }

        memset(&RxHeader, 0, sizeof(RxHeader));
        memset(tmp, 0, sizeof(tmp));
    }
}

/**
 * @brief Callback for FIFO0 RX interrupt.
 *
 * Sets g_can_rx_pending and returns immediately.
 * Does NOT touch message RAM — no HAL_FDCAN_GetRxMessage() call here.
 * All frame reads happen in CAN_DrainRxFifo() from main context so the
 * CPU never races the FDCAN peripheral for the message RAM bus.
 */
void HAL_FDCAN_RxFifo0Callback(FDCAN_HandleTypeDef *hfdcan, uint32_t RxFifo0ITs)
{
    if ((RxFifo0ITs & FDCAN_IT_RX_FIFO0_NEW_MESSAGE) != 0U) {
        g_can_rx_pending = 1U;
    }

    /* Debug GPIO — kept from original */
    HAL_GPIO_WritePin(GPIOC, GPIO_PIN_7, GPIO_PIN_SET);
}

/* HELPER FUNCTIONS BELOW */

/**
 * @brief   Adds a received CAN frame to the circular software queue.
 * @note    Called only from CAN_DrainRxFifo() in main context.
 */
static void CAN_EnqueueFrame(uint32_t id, uint8_t len, const uint8_t *data)
{
    uint8_t next = (canRxHead + 1) % CAN_RX_QUEUE_SIZE;
    if (next == canRxTail) canRxTail = (canRxTail + 1) % CAN_RX_QUEUE_SIZE;

    CAN_Rx_Queue[canRxHead].RxData1_Identifier = id;
    CAN_Rx_Queue[canRxHead].RxData1_BufferLength = len;
    memcpy(CAN_Rx_Queue[canRxHead].RxData1, data, len);
    canRxHead = next;
}

/**
 * @brief   Removes the oldest CAN frame from the software queue.
 * @return  1 if a frame was retrieved, 0 if the queue is empty.
 */
static int CAN_DequeueFrame(CAN_Frame *frame)
{
    uint32_t primask = __get_PRIMASK();
    __disable_irq();
    if (canRxTail == canRxHead) {
        __set_PRIMASK(primask);
        return 0;
    }
    *frame = CAN_Rx_Queue[canRxTail];
    canRxTail = (canRxTail + 1) % CAN_RX_QUEUE_SIZE;
    __set_PRIMASK(primask);
    return 1;
}

//0x130 = PDB_HEARTBEAT
//0x131 = RUDR_HEARTBEAT
//0x132 = SAIL_HEARTBEAT
//0x133 = SENSE_HEARTBEAT

void HAL_TIM_PeriodElapsedCallback(TIM_HandleTypeDef *htim)
{
    if (htim->Instance == TIM7) {
        uint8_t tx_heart = 0;
        /* No printf here — this runs in TIM7 ISR context and printf is neither
         * ISR-safe nor (with the weak __io_putchar stub) safe to call at all. */
        if (CAN_Transmit(heartbeat_id, FDCAN_STANDARD_ID, FDCAN_DLC_BYTES_0,
                         &tx_heart, &hfdcan1) != HAL_OK) {
            HAL_GPIO_WritePin(GPIOG, GPIO_PIN_2, GPIO_PIN_SET);
            Error_Handler();
        }
    }
    if (htim->Instance == TIM17)
    {
        HAL_IncTick();
    }
}

/* DLC to bytes lookup */
uint8_t dlc_to_bytes(uint8_t dlc)
{
    static const uint8_t dlc_lut[16] = {
        0, 1, 2, 3, 4, 5, 6, 7, 8, 12, 16, 20, 24, 32, 48, 64
    };
    return dlc_lut[dlc & 0x0F];
}