/**
 * @file  dev_can.c
 * @brief CAN protocol and legacy-mode handlers for the dev layer.
 *
 * CHANGES FROM ORIGINAL:
 *   - HAL_FDCAN_ErrorCallback: MRAF no longer triggers recovery. MRAF on
 *     STM32U5 is a hardware-level message RAM bus arbitration issue. The
 *     recovery path (Stop/DeInit/Init) took ~60ms and dropped every frame
 *     that arrived during that window, causing more harm than the MRAF itself.
 *     MRAF is now counted for diagnostics only.
 *   - can_service_ram_recovery: removed entirely — nothing can set the
 *     pending flag anymore so it was pure dead weight on every poll cycle.
 *   - Dev_CAN_ServiceBackground: no longer calls can_service_ram_recovery.
 *   - Dev_CAN_ServiceProtocol: FDCAN register reads and CAN_DrainRxFifo are
 *     gated on g_can_rx_pending. Reading RXF0S thousands of times per second
 *     in a tight poll loop causes AHB bus contention with the FDCAN peripheral
 *     writing incoming frames into message RAM, which itself triggers MRAF and
 *     drops frames before they reach the FIFO.
 *   - g_can_last_recovery_at_count and MRAF_RECOVERY_THRESHOLD: removed.
 */

#include "dev_internal.h"

#include <stdio.h>
#include <string.h>

typedef enum {
    CAN_TX_RESULT_OK = 0,
    CAN_TX_RESULT_CANCELLED,
    CAN_TX_RESULT_ABORTED,
    CAN_TX_RESULT_TIMEOUT,
    CAN_TX_RESULT_REJECTED
} CanTxResult_t;

static uint8_t g_can_diag_verbose = 0U;
static uint32_t g_can_diag_send_seq = 0U;

#if CAN_HEARTBEAT_ENABLED
static uint32_t g_can_next_heartbeat_ms = 0U;
static uint32_t g_can_next_heartbeat_retry_ms = 0U;
static uint8_t g_can_heartbeat_pending = 0U;
#endif

static volatile uint32_t g_can_tx_complete_mask = 0U;
static volatile uint32_t g_can_tx_abort_mask = 0U;
static volatile uint32_t g_can_last_tx_complete_mask = 0U;
static volatile uint32_t g_can_last_tx_abort_mask = 0U;
static volatile uint32_t g_can_last_error_status_its = 0U;
static volatile uint32_t g_can_last_error_code = 0U;
static volatile uint32_t g_can_error_status_count = 0U;
static volatile uint32_t g_can_ram_access_fail_count = 0U;
static volatile uint32_t g_can_tx_evt_fifo_full_count = 0U;
static volatile uint32_t g_can_tx_evt_fifo_lost_count = 0U;

static uint32_t g_can_cmd_tx_attempted = 0U;
static uint32_t g_can_cmd_tx_completed = 0U;
static uint32_t g_can_cmd_tx_cancelled = 0U;
static uint32_t g_can_cmd_tx_aborted = 0U;
static uint32_t g_can_cmd_tx_timed_out = 0U;
static uint32_t g_can_heartbeat_attempted = 0U;
static uint32_t g_can_heartbeat_completed = 0U;
static uint32_t g_can_heartbeat_skipped = 0U;
static uint32_t g_can_rx_dequeue_count = 0U;
static uint32_t g_can_rx_hw_poll_count = 0U;

static uint32_t g_can_last_reported_ram_access_fail_count = 0U;

static void can_diag_emit(const char *tag, const char *payload);
static void can_diag_status(const char *tag, uint32_t seq);
static void can_diag_rx_dequeue(const CAN_Frame *frame);
static void can_diag_rx_fifo0_state(const char *tag, uint32_t deq_count, uint32_t dup_count,
                                    uint32_t rxf0s_before, uint32_t rxf0s_after);
static void can_diag_tx_state(const char *tag, const char *kind, uint32_t seq,
                              uint32_t id, uint8_t bytes, uint32_t req_mask);
static void can_diag_async_events(void);
static HAL_StatusTypeDef can_configure_notifications(void);
static void can_runtime_reset(void);
static void can_stop_library_heartbeat(void);
static uint32_t can_enter_critical(void);
static void can_exit_critical(uint32_t primask);
static uint32_t can_capture_tx_request_mask(void);
static CanTxResult_t can_submit_frame(uint32_t id, uint32_t dlc_code, uint8_t payload_len,
                                      const uint8_t *data, const char *submit_tag,
                                      const char *kind, uint32_t seq,
                                      uint32_t *req_mask_out);
static CanTxResult_t can_wait_for_tx_request(uint32_t req_mask, uint32_t timeout_ms);
#if CAN_HEARTBEAT_ENABLED
static void can_schedule_heartbeat(uint32_t now);
static void can_service_heartbeat(void);
#endif
static const char *fdcan_tx_req_state_str(uint32_t req_mask, uint32_t txbrp,
                                          uint32_t txbto, uint32_t txbcf);
static const char *fdcan_lec_str(uint32_t psr);
static const char *fdcan_protocol_error_str(uint32_t lec);
static const char *fdcan_activity_str(uint32_t activity);
static const char *fdcan_hal_state_str(HAL_FDCAN_StateTypeDef state);
static uint8_t fdcan_payload_bytes_for_len(uint16_t len);
static uint32_t fdcan_dlc_code_for_len(uint8_t len);

HAL_StatusTypeDef Dev_CAN_EnsureReady(void)
{
    if (g_can_state.ready != 0U) {
        return HAL_OK;
    }

    /* start_timer = 0: the TIM7 library heartbeat is unused here (the software
     * heartbeat is gated by CAN_HEARTBEAT_ENABLED). Starting it only to stop it
     * a few lines later left a window where the TIM7 ISR could fire. */
    CAN_Init(&hfdcan1, CAN_HEARTBEAT_ID, 0U);
    if (CanStartStatus != HAL_OK) {
        return HAL_ERROR;
    }

    can_stop_library_heartbeat();
    if (can_configure_notifications() != HAL_OK) {
        return HAL_ERROR;
    }

    /* Give the FDCAN state machine time to fully synchronise to the bus
     * before accepting frames. Without this, the first received frame can
     * arrive before the message RAM interface is stable. */
    HAL_Delay(5U);

    can_runtime_reset();
    g_can_state.ready = 1U;
    g_can_state.monitoring = 0U;
    return HAL_OK;
}

void Dev_CAN_ServiceBackground(void)
{
    if (g_can_state.ready == 0U) {
        return;
    }

    /* can_service_ram_recovery removed — MRAF recovery is disabled.
     * See HAL_FDCAN_ErrorCallback for rationale. */
    can_diag_async_events();
#if CAN_HEARTBEAT_ENABLED
    can_service_heartbeat();
#endif
}

void Dev_CAN_HandleCommand(const ParsedCommand_t *cmd)
{
    uint32_t id;
    uint32_t req_mask;
    uint8_t raw_buf[64];
    uint8_t tx_buf[64];
    uint16_t raw_len;
    uint8_t padded_len;
    uint32_t dlc_code;
    uint32_t diag_seq;
    CanTxResult_t tx_result;
    FDCAN_ProtocolStatusTypeDef proto_status;
    FDCAN_ErrorCountersTypeDef error_counters;
    uint32_t psr;
    char payload[MAX_EMIT_CHARS];

    if (strcmp(cmd->command, "INIT") == 0) {
        if (cmd->argc != 0U) {
            emit_fail("CANFD", "bad-arg");
            return;
        }
        if (Dev_CAN_EnsureReady() != HAL_OK) {
            emit_fail("CANFD", "init-failed");
            return;
        }
        can_stop_library_heartbeat();
        (void)can_configure_notifications();
        can_runtime_reset();
        g_can_state.monitoring = 0U;
        can_diag_status("init", 0U);
        emit_frame("CANFD", "PASS", "ready=1");
        return;
    }

    if (g_can_state.ready == 0U) {
        emit_fail("CANFD", "not-init");
        return;
    }

    if (strcmp(cmd->command, "SEND") == 0) {
        if ((cmd->argc != 2U) ||
            !parse_hex_u32(cmd->argv[0], &id) ||
            !parse_hex_buffer(cmd->argv[1], raw_buf, &raw_len, 64U) ||
            (id > 0x7FFU)) {
            emit_fail("CANFD", "bad-arg");
            return;
        }

        padded_len = fdcan_payload_bytes_for_len(raw_len);
        dlc_code = fdcan_dlc_code_for_len(padded_len);
        memset(tx_buf, 0, sizeof(tx_buf));
        if (raw_len > 0U) {
            memcpy(tx_buf, raw_buf, raw_len);
        }

        diag_seq = ++g_can_diag_send_seq;
        g_can_cmd_tx_attempted++;

        req_mask = 0U;
        tx_result = can_submit_frame(id, dlc_code, padded_len, tx_buf, "tx-submit",
                                     "cmd", diag_seq, &req_mask);
        if (tx_result == CAN_TX_RESULT_REJECTED) {
            psr = hfdcan1.Instance->PSR;
            if ((psr & FDCAN_PSR_BO) != 0U) {
                emit_fail("CANFD", "bus-off");
            } else if (HAL_FDCAN_GetTxFifoFreeLevel(&hfdcan1) == 0U) {
                emit_fail("CANFD", "fifo-full");
            } else {
                emit_fail("CANFD", "tx-reject");
            }
            return;
        }

        if (tx_result == CAN_TX_RESULT_OK) {
            g_can_cmd_tx_completed++;
            can_diag_tx_state("tx-complete", "cmd", diag_seq, id, padded_len, req_mask);
            (void)snprintf(payload, sizeof(payload), "id=0x%lX;dlc=%u",
                           (unsigned long)id, (unsigned int)padded_len);
            emit_frame("CANFD", "PASS", payload);
            return;
        }

        if (tx_result == CAN_TX_RESULT_CANCELLED) {
            g_can_cmd_tx_cancelled++;
            can_diag_tx_state("tx-cancel", "cmd", diag_seq, id, padded_len, req_mask);
            can_diag_status("tx-cancel", diag_seq);
            (void)HAL_FDCAN_GetProtocolStatus(&hfdcan1, &proto_status);
            if (proto_status.BusOff != 0U) {
                emit_fail("CANFD", "bus-off");
            } else {
                emit_fail("CANFD", "tx-cancel");
            }
            return;
        }

        if (tx_result == CAN_TX_RESULT_ABORTED) {
            g_can_cmd_tx_aborted++;
            can_diag_tx_state("tx-abort-cb", "cmd", diag_seq, id, padded_len, req_mask);
            can_diag_status("tx-abort-cb", diag_seq);
            (void)HAL_FDCAN_GetProtocolStatus(&hfdcan1, &proto_status);
            if (proto_status.BusOff != 0U) {
                emit_fail("CANFD", "bus-off");
            } else {
                emit_fail("CANFD", "tx-abort");
            }
            return;
        }

        g_can_cmd_tx_timed_out++;
        can_diag_tx_state("tx-timeout", "cmd", diag_seq, id, padded_len, req_mask);
        (void)HAL_FDCAN_AbortTxRequest(&hfdcan1, req_mask);
        can_diag_tx_state("tx-timeout-abort-issued", "cmd", diag_seq, id, padded_len, req_mask);
        can_diag_status("tx-timeout", diag_seq);
        emit_fail("CANFD", "tx-timeout");
        return;
    }

    if (strcmp(cmd->command, "MONITOR") == 0) {
        if (cmd->argc != 1U) {
            emit_fail("CANFD", "bad-arg");
            return;
        }

        if (strcmp(cmd->argv[0], "START") == 0) {
            g_can_state.monitoring = 1U;
            can_diag_emit("monitor-start", "enabled=1");
            emit_frame("CANFD", "PASS", "monitoring=1");
            return;
        }
        if (strcmp(cmd->argv[0], "STOP") == 0) {
            g_can_state.monitoring = 0U;
            can_diag_emit("monitor-stop", "enabled=0");
            emit_frame("CANFD", "PASS", "monitoring=0");
            return;
        }

        emit_fail("CANFD", "bad-arg");
        return;
    }

    if (strcmp(cmd->command, "STATUS") == 0) {
        if (cmd->argc != 0U) {
            emit_fail("CANFD", "bad-arg");
            return;
        }

        can_diag_status("status", 0U);
        psr = hfdcan1.Instance->PSR;
        memset(&proto_status, 0, sizeof(proto_status));
        memset(&error_counters, 0, sizeof(error_counters));
        (void)HAL_FDCAN_GetProtocolStatus(&hfdcan1, &proto_status);
        (void)HAL_FDCAN_GetErrorCounters(&hfdcan1, &error_counters);
        (void)snprintf(payload, sizeof(payload),
                       "psr=0x%08lX;lec=%s;dlec=%s;bo=%lu;ep=%lu;act=%s;tec=%lu;rec=%lu;rp=%lu;"
                       "cmd_try=%lu;cmd_ok=%lu;cmd_cancel=%lu;cmd_abort=%lu;cmd_to=%lu;"
                       "hb_try=%lu;hb_ok=%lu;hb_skip=%lu;ram=%lu;teff=%lu;tefl=%lu;rx=%lu",
                       (unsigned long)psr,
                       fdcan_protocol_error_str(proto_status.LastErrorCode),
                       fdcan_protocol_error_str(proto_status.DataLastErrorCode),
                       (unsigned long)proto_status.BusOff,
                       (unsigned long)proto_status.ErrorPassive,
                       fdcan_activity_str(proto_status.Activity),
                       (unsigned long)error_counters.TxErrorCnt,
                       (unsigned long)error_counters.RxErrorCnt,
                       (unsigned long)error_counters.RxErrorPassive,
                       (unsigned long)g_can_cmd_tx_attempted,
                       (unsigned long)g_can_cmd_tx_completed,
                       (unsigned long)g_can_cmd_tx_cancelled,
                       (unsigned long)g_can_cmd_tx_aborted,
                       (unsigned long)g_can_cmd_tx_timed_out,
                       (unsigned long)g_can_heartbeat_attempted,
                       (unsigned long)g_can_heartbeat_completed,
                       (unsigned long)g_can_heartbeat_skipped,
                       (unsigned long)g_can_ram_access_fail_count,
                       (unsigned long)g_can_tx_evt_fifo_full_count,
                       (unsigned long)g_can_tx_evt_fifo_lost_count,
                       (unsigned long)g_can_rx_dequeue_count);
        emit_frame("CANFD", "PASS", payload);
        return;
    }

    emit_fail("CANFD", "unknown-command");
}

void Dev_CAN_ServiceProtocol(void)
{
    CAN_Frame frame;
    char bytes_hex[129];
    char payload[176];
    uint32_t rxf0s_before = 0U;
    uint32_t rxf0s_after = 0U;
    uint32_t dequeued_count = 0U;
    uint32_t duplicate_hint_count = 0U;
    uint32_t last_id = 0U;
    uint8_t last_len = 0U;
    uint8_t last_preview[8];
    uint8_t last_preview_len = 0U;
    uint8_t have_last = 0U;
    uint8_t preview_len;

    if (g_can_state.ready == 0U) {
        return;
    }

    if (g_can_state.monitoring == 0U) {
        return;
    }

    /* Gate all FDCAN register access on g_can_rx_pending.
     * Reading RXF0S thousands of times per second in the poll loop causes
     * AHB bus contention with the FDCAN peripheral writing incoming frames
     * into message RAM, which triggers MRAF at the hardware level and drops
     * frames before they ever reach the FIFO. Only touch the bus when the
     * ISR has signalled that a frame actually arrived. */
    if (g_can_rx_pending != 0U) {
        rxf0s_before = hfdcan1.Instance->RXF0S;
        CAN_DrainRxFifo();
        rxf0s_after = hfdcan1.Instance->RXF0S;
    }

    while (CAN_Receive(&frame) == HAL_OK) {
        preview_len = frame.RxData1_BufferLength;
        if (preview_len > sizeof(last_preview)) {
            preview_len = (uint8_t)sizeof(last_preview);
        }
        if ((have_last != 0U) &&
            (frame.RxData1_Identifier == last_id) &&
            (frame.RxData1_BufferLength == last_len) &&
            (preview_len == last_preview_len) &&
            ((preview_len == 0U) || (memcmp(frame.RxData1, last_preview, preview_len) == 0))) {
            duplicate_hint_count++;
        }
        last_id = frame.RxData1_Identifier;
        last_len = frame.RxData1_BufferLength;
        last_preview_len = preview_len;
        if (preview_len > 0U) {
            memcpy(last_preview, frame.RxData1, preview_len);
        }
        have_last = 1U;
        dequeued_count++;
        can_diag_rx_dequeue(&frame);
        if (!bytes_to_hex(frame.RxData1, frame.RxData1_BufferLength, bytes_hex, sizeof(bytes_hex))) {
            continue;
        }
        (void)snprintf(payload, sizeof(payload), "%lX:%u:%s",
                       (unsigned long)frame.RxData1_Identifier,
                       (unsigned int)frame.RxData1_BufferLength,
                       bytes_hex);
        emit_frame("CANFD", "FRAME", payload);
    }

    /* Only emit rx-hw diagnostics when something actually happened. */
    if ((dequeued_count != 0U) ||
        ((rxf0s_before & (FDCAN_RXF0S_F0FL | FDCAN_RXF0S_F0F | FDCAN_RXF0S_RF0L)) != 0U) ||
        ((rxf0s_after  & (FDCAN_RXF0S_F0FL | FDCAN_RXF0S_F0F | FDCAN_RXF0S_RF0L)) != 0U) ||
        (rxf0s_before != rxf0s_after)) {
        can_diag_rx_fifo0_state("rx-hw", dequeued_count, duplicate_hint_count,
                                rxf0s_before, rxf0s_after);
    }
    if ((dequeued_count == 0U) &&
        (((rxf0s_before & FDCAN_RXF0S_F0FL) != 0U) ||
         ((rxf0s_after  & FDCAN_RXF0S_F0FL) != 0U))) {
        can_diag_rx_fifo0_state("rx-hw-no-sw", dequeued_count, duplicate_hint_count,
                                rxf0s_before, rxf0s_after);
    }
}

void Dev_CAN_ServiceLegacy(void)
{
    CAN_Frame frame;

    if (g_can_state.ready == 0U) {
        return;
    }

    while (CAN_Receive(&frame) == HAL_OK) {
        can_diag_rx_dequeue(&frame);
        if (frame.RxData1_BufferLength != 0U) {
            uart1_write_bytes(frame.RxData1, frame.RxData1_BufferLength);
        }
        HAL_GPIO_TogglePin(LED_GREEN_GPIO_Port, LED_GREEN_Pin);
    }
}

void Dev_CAN_HandleLegacyByte(uint8_t byte)
{
    uint32_t psr;
    char dbg[96];

    uart1_write_bytes(&byte, 1U);
    if (HAL_FDCAN_GetTxFifoFreeLevel(&hfdcan1) == 0U) {
        psr = hfdcan1.Instance->PSR;
        (void)snprintf(dbg, sizeof(dbg), "[CAN FIFO FULL] PSR=0x%08lX LEC=%s",
                       (unsigned long)psr, fdcan_lec_str(psr));
        emit_line(dbg);
        return;
    }
    if (CAN_Transmit(0x123U, FDCAN_STANDARD_ID, FDCAN_DLC_BYTES_1, &byte, &hfdcan1) == HAL_OK) {
        HAL_GPIO_TogglePin(LED_RED_GPIO_Port, LED_RED_Pin);
    } else {
        psr = hfdcan1.Instance->PSR;
        (void)snprintf(dbg, sizeof(dbg), "[CAN TX ERR] PSR=0x%08lX LEC=%s",
                       (unsigned long)psr, fdcan_lec_str(psr));
        emit_line(dbg);
    }
}

void HAL_FDCAN_TxBufferCompleteCallback(FDCAN_HandleTypeDef *hfdcan, uint32_t BufferIndexes)
{
    if (hfdcan != &hfdcan1) {
        return;
    }
    g_can_tx_complete_mask |= BufferIndexes;
    g_can_last_tx_complete_mask = BufferIndexes;
}

void HAL_FDCAN_TxBufferAbortCallback(FDCAN_HandleTypeDef *hfdcan, uint32_t BufferIndexes)
{
    if (hfdcan != &hfdcan1) {
        return;
    }
    g_can_tx_abort_mask |= BufferIndexes;
    g_can_last_tx_abort_mask = BufferIndexes;
}

void HAL_FDCAN_TxEventFifoCallback(FDCAN_HandleTypeDef *hfdcan, uint32_t TxEventFifoITs)
{
    if (hfdcan != &hfdcan1) {
        return;
    }
    if ((TxEventFifoITs & FDCAN_IT_TX_EVT_FIFO_FULL) != 0U) {
        g_can_tx_evt_fifo_full_count++;
    }
    if ((TxEventFifoITs & FDCAN_IT_TX_EVT_FIFO_ELT_LOST) != 0U) {
        g_can_tx_evt_fifo_lost_count++;
    }
}

void HAL_FDCAN_ErrorStatusCallback(FDCAN_HandleTypeDef *hfdcan, uint32_t ErrorStatusITs)
{
    if (hfdcan != &hfdcan1) {
        return;
    }
    g_can_last_error_status_its = ErrorStatusITs;
    g_can_error_status_count++;
}

/**
 * @brief FDCAN error callback.
 *
 * MRAF (HAL_FDCAN_ERROR_RAM_ACCESS) is counted for diagnostics but does NOT
 * trigger peripheral recovery. The recovery path (Stop/DeInit/Init, ~60ms)
 * dropped every frame that arrived during the window and created a feedback
 * loop — recovery generates bus activity, which generates more MRAF, which
 * triggers more recovery. MRAF is a hardware-level STM32U5 message RAM bus
 * arbitration issue; the correct fix is MPU configuration (see Dev_Init in
 * dev.c), not a software reset of the peripheral.
 */
void HAL_FDCAN_ErrorCallback(FDCAN_HandleTypeDef *hfdcan)
{
    uint32_t error_code;

    if (hfdcan != &hfdcan1) {
        return;
    }

    error_code = hfdcan->ErrorCode;
    g_can_last_error_code = error_code;

    if ((error_code & HAL_FDCAN_ERROR_RAM_ACCESS) != 0U) {
        g_can_ram_access_fail_count++;
        /* No recovery triggered — counted for diagnostics only. */
    }

    hfdcan->ErrorCode = HAL_FDCAN_ERROR_NONE;
}

static void can_diag_emit(const char *tag, const char *payload)
{
    char line[MAX_EMIT_CHARS];

    if (g_can_diag_verbose == 0U) {
        return;
    }

    if ((payload == NULL) || (payload[0] == '\0')) {
        (void)snprintf(line, sizeof(line), "%s", tag);
    } else {
        (void)snprintf(line, sizeof(line), "%s;%s", tag, payload);
    }
    emit_frame("CANFD", "DIAG", line);
}

static void can_diag_status(const char *tag, uint32_t seq)
{
    FDCAN_ProtocolStatusTypeDef proto_status;
    FDCAN_ErrorCountersTypeDef error_counters;
    uint32_t psr;
    uint32_t ir;
    uint32_t ecr;
    uint32_t txfqs;
    uint32_t txbrp;
    uint32_t txbto;
    uint32_t txbcf;
    uint32_t rxf0s;
    char payload[MAX_EMIT_CHARS];

    if (g_can_diag_verbose == 0U) {
        return;
    }

    psr   = hfdcan1.Instance->PSR;
    ir    = hfdcan1.Instance->IR;
    ecr   = hfdcan1.Instance->ECR;
    txfqs = hfdcan1.Instance->TXFQS;
    txbrp = hfdcan1.Instance->TXBRP;
    txbto = hfdcan1.Instance->TXBTO;
    txbcf = hfdcan1.Instance->TXBCF;
    rxf0s = hfdcan1.Instance->RXF0S;
    memset(&proto_status, 0, sizeof(proto_status));
    memset(&error_counters, 0, sizeof(error_counters));
    (void)HAL_FDCAN_GetProtocolStatus(&hfdcan1, &proto_status);
    (void)HAL_FDCAN_GetErrorCounters(&hfdcan1, &error_counters);
    (void)snprintf(payload, sizeof(payload),
                   "seq=%lu;psr=0x%08lX;ir=0x%08lX;ecr=0x%08lX;txfqs=0x%08lX;txbrp=0x%08lX;"
                   "txbto=0x%08lX;txbcf=0x%08lX;rxf0s=0x%08lX;lec=%s;dlec=%s;bo=%lu;ep=%lu;"
                   "ew=%lu;act=%s;tec=%lu;rec=%lu;rp=%lu;cel=%lu;resi=%lu;rbrs=%lu;rfdf=%lu;"
                   "pxe=%lu;hstate=%s;herr=0x%08lX;errits=0x%08lX;errcnt=%lu;txc=0x%08lX;"
                   "txa=0x%08lX;lastc=0x%08lX;lasta=0x%08lX;cmd_try=%lu;cmd_ok=%lu;cmd_cancel=%lu;"
                   "cmd_abort=%lu;cmd_to=%lu;hb_try=%lu;hb_ok=%lu;hb_skip=%lu;ram=%lu;teff=%lu;tefl=%lu;rx=%lu",
                   (unsigned long)seq,
                   (unsigned long)psr,
                   (unsigned long)ir,
                   (unsigned long)ecr,
                   (unsigned long)txfqs,
                   (unsigned long)txbrp,
                   (unsigned long)txbto,
                   (unsigned long)txbcf,
                   (unsigned long)rxf0s,
                   fdcan_protocol_error_str(proto_status.LastErrorCode),
                   fdcan_protocol_error_str(proto_status.DataLastErrorCode),
                   (unsigned long)proto_status.BusOff,
                   (unsigned long)proto_status.ErrorPassive,
                   (unsigned long)proto_status.Warning,
                   fdcan_activity_str(proto_status.Activity),
                   (unsigned long)error_counters.TxErrorCnt,
                   (unsigned long)error_counters.RxErrorCnt,
                   (unsigned long)error_counters.RxErrorPassive,
                   (unsigned long)((ecr & FDCAN_ECR_CEL) >> FDCAN_ECR_CEL_Pos),
                   (unsigned long)proto_status.RxESIflag,
                   (unsigned long)proto_status.RxBRSflag,
                   (unsigned long)proto_status.RxFDFflag,
                   (unsigned long)proto_status.ProtocolException,
                   fdcan_hal_state_str(hfdcan1.State),
                   (unsigned long)hfdcan1.ErrorCode,
                   (unsigned long)g_can_last_error_status_its,
                   (unsigned long)g_can_error_status_count,
                   (unsigned long)g_can_tx_complete_mask,
                   (unsigned long)g_can_tx_abort_mask,
                   (unsigned long)g_can_last_tx_complete_mask,
                   (unsigned long)g_can_last_tx_abort_mask,
                   (unsigned long)g_can_cmd_tx_attempted,
                   (unsigned long)g_can_cmd_tx_completed,
                   (unsigned long)g_can_cmd_tx_cancelled,
                   (unsigned long)g_can_cmd_tx_aborted,
                   (unsigned long)g_can_cmd_tx_timed_out,
                   (unsigned long)g_can_heartbeat_attempted,
                   (unsigned long)g_can_heartbeat_completed,
                   (unsigned long)g_can_heartbeat_skipped,
                   (unsigned long)g_can_ram_access_fail_count,
                   (unsigned long)g_can_tx_evt_fifo_full_count,
                   (unsigned long)g_can_tx_evt_fifo_lost_count,
                   (unsigned long)g_can_rx_dequeue_count);
    can_diag_emit(tag, payload);
}

static void can_diag_rx_dequeue(const CAN_Frame *frame)
{
    char payload[MAX_EMIT_CHARS];
    char preview_hex[17];
    uint8_t preview_len;
    const char *kind;

    if ((g_can_diag_verbose == 0U) || (frame == NULL)) {
        return;
    }

    g_can_rx_dequeue_count++;
    kind = ((frame->RxData1_Identifier == CAN_HEARTBEAT_ID) &&
            (frame->RxData1_BufferLength == 0U)) ? "heartbeat" : "data";

    preview_len = frame->RxData1_BufferLength;
    if (preview_len > 8U) {
        preview_len = 8U;
    }

    if ((preview_len > 0U) &&
        bytes_to_hex(frame->RxData1, preview_len, preview_hex, sizeof(preview_hex))) {
        (void)snprintf(payload, sizeof(payload),
                       "count=%lu;kind=%s;id=0x%lX;len=%u;preview_len=%u;preview=%s",
                       (unsigned long)g_can_rx_dequeue_count,
                       kind,
                       (unsigned long)frame->RxData1_Identifier,
                       (unsigned int)frame->RxData1_BufferLength,
                       (unsigned int)preview_len,
                       preview_hex);
    } else {
        (void)snprintf(payload, sizeof(payload),
                       "count=%lu;kind=%s;id=0x%lX;len=%u;preview_len=0",
                       (unsigned long)g_can_rx_dequeue_count,
                       kind,
                       (unsigned long)frame->RxData1_Identifier,
                       (unsigned int)frame->RxData1_BufferLength);
    }

    can_diag_emit("rx-dequeue", payload);
}

static void can_diag_rx_fifo0_state(const char *tag, uint32_t deq_count, uint32_t dup_count,
                                    uint32_t rxf0s_before, uint32_t rxf0s_after)
{
    char payload[MAX_EMIT_CHARS];
    uint32_t f0fl_before = (rxf0s_before & FDCAN_RXF0S_F0FL) >> FDCAN_RXF0S_F0FL_Pos;
    uint32_t f0gi_before = (rxf0s_before & FDCAN_RXF0S_F0GI) >> FDCAN_RXF0S_F0GI_Pos;
    uint32_t f0pi_before = (rxf0s_before & FDCAN_RXF0S_F0PI) >> FDCAN_RXF0S_F0PI_Pos;
    uint32_t f0f_before  = (rxf0s_before & FDCAN_RXF0S_F0F)  >> FDCAN_RXF0S_F0F_Pos;
    uint32_t rf0l_before = (rxf0s_before & FDCAN_RXF0S_RF0L) >> FDCAN_RXF0S_RF0L_Pos;
    uint32_t f0fl_after  = (rxf0s_after  & FDCAN_RXF0S_F0FL) >> FDCAN_RXF0S_F0FL_Pos;
    uint32_t f0gi_after  = (rxf0s_after  & FDCAN_RXF0S_F0GI) >> FDCAN_RXF0S_F0GI_Pos;
    uint32_t f0pi_after  = (rxf0s_after  & FDCAN_RXF0S_F0PI) >> FDCAN_RXF0S_F0PI_Pos;
    uint32_t f0f_after   = (rxf0s_after  & FDCAN_RXF0S_F0F)  >> FDCAN_RXF0S_F0F_Pos;
    uint32_t rf0l_after  = (rxf0s_after  & FDCAN_RXF0S_RF0L) >> FDCAN_RXF0S_RF0L_Pos;

    if (g_can_diag_verbose == 0U) {
        return;
    }

    g_can_rx_hw_poll_count++;
    (void)snprintf(payload, sizeof(payload),
                   "poll=%lu;deq=%lu;dup_hint=%lu;before=0x%08lX;after=0x%08lX;"
                   "f0fl_b=%lu;f0gi_b=%lu;f0pi_b=%lu;f0f_b=%lu;rf0l_b=%lu;"
                   "f0fl_a=%lu;f0gi_a=%lu;f0pi_a=%lu;f0f_a=%lu;rf0l_a=%lu;ir=0x%08lX;ram=%lu",
                   (unsigned long)g_can_rx_hw_poll_count,
                   (unsigned long)deq_count,
                   (unsigned long)dup_count,
                   (unsigned long)rxf0s_before,
                   (unsigned long)rxf0s_after,
                   (unsigned long)f0fl_before,
                   (unsigned long)f0gi_before,
                   (unsigned long)f0pi_before,
                   (unsigned long)f0f_before,
                   (unsigned long)rf0l_before,
                   (unsigned long)f0fl_after,
                   (unsigned long)f0gi_after,
                   (unsigned long)f0pi_after,
                   (unsigned long)f0f_after,
                   (unsigned long)rf0l_after,
                   (unsigned long)hfdcan1.Instance->IR,
                   (unsigned long)g_can_ram_access_fail_count);
    can_diag_emit(tag, payload);
}

static void can_diag_tx_state(const char *tag, const char *kind, uint32_t seq,
                              uint32_t id, uint8_t bytes, uint32_t req_mask)
{
    char payload[MAX_EMIT_CHARS];
    uint32_t txbrp = hfdcan1.Instance->TXBRP;
    uint32_t txbto = hfdcan1.Instance->TXBTO;
    uint32_t txbcf = hfdcan1.Instance->TXBCF;
    uint32_t cb_complete   = ((g_can_tx_complete_mask    & req_mask) != 0U) ? 1U : 0U;
    uint32_t cb_abort      = ((g_can_tx_abort_mask       & req_mask) != 0U) ? 1U : 0U;
    uint32_t last_complete = ((g_can_last_tx_complete_mask & req_mask) != 0U) ? 1U : 0U;
    uint32_t last_abort    = ((g_can_last_tx_abort_mask    & req_mask) != 0U) ? 1U : 0U;

    if (g_can_diag_verbose == 0U) {
        return;
    }

    (void)snprintf(payload, sizeof(payload),
                   "kind=%s;seq=%lu;id=0x%lX;bytes=%u;req=0x%lX;req_state=%s;"
                   "cb_complete=%lu;cb_abort=%lu;last_complete=%lu;last_abort=%lu;"
                   "psr=0x%08lX;ir=0x%08lX;txfqs=0x%08lX;txbrp=0x%08lX;txbto=0x%08lX;txbcf=0x%08lX",
                   kind,
                   (unsigned long)seq,
                   (unsigned long)id,
                   (unsigned int)bytes,
                   (unsigned long)req_mask,
                   fdcan_tx_req_state_str(req_mask, txbrp, txbto, txbcf),
                   (unsigned long)cb_complete,
                   (unsigned long)cb_abort,
                   (unsigned long)last_complete,
                   (unsigned long)last_abort,
                   (unsigned long)hfdcan1.Instance->PSR,
                   (unsigned long)hfdcan1.Instance->IR,
                   (unsigned long)hfdcan1.Instance->TXFQS,
                   (unsigned long)txbrp,
                   (unsigned long)txbto,
                   (unsigned long)txbcf);
    can_diag_emit(tag, payload);
}

static void can_diag_async_events(void)
{
    char payload[160];

    if (g_can_diag_verbose == 0U) {
        return;
    }

    if (g_can_ram_access_fail_count != g_can_last_reported_ram_access_fail_count) {
        (void)snprintf(payload, sizeof(payload),
                       "count=%lu;last_err=0x%08lX;errits=0x%08lX;psr=0x%08lX;ir=0x%08lX",
                       (unsigned long)g_can_ram_access_fail_count,
                       (unsigned long)g_can_last_error_code,
                       (unsigned long)g_can_last_error_status_its,
                       (unsigned long)hfdcan1.Instance->PSR,
                       (unsigned long)hfdcan1.Instance->IR);
        can_diag_emit("ram-access-fail", payload);
        g_can_last_reported_ram_access_fail_count = g_can_ram_access_fail_count;
    }
}

static HAL_StatusTypeDef can_configure_notifications(void)
{
    uint32_t groups = FDCAN_IT_GROUP_RX_FIFO0 |
                      FDCAN_IT_GROUP_RX_FIFO1 |
                      FDCAN_IT_GROUP_SMSG |
                      FDCAN_IT_GROUP_TX_FIFO_ERROR |
                      FDCAN_IT_GROUP_MISC |
                      FDCAN_IT_GROUP_BIT_LINE_ERROR |
                      FDCAN_IT_GROUP_PROTOCOL_ERROR;
    uint32_t notifications = FDCAN_IT_TX_COMPLETE |
                             FDCAN_IT_TX_ABORT_COMPLETE |
                             FDCAN_IT_RAM_ACCESS_FAILURE |
                             FDCAN_IT_TX_EVT_FIFO_FULL |
                             FDCAN_IT_TX_EVT_FIFO_ELT_LOST;

    if (HAL_FDCAN_ConfigInterruptLines(&hfdcan1, groups, FDCAN_INTERRUPT_LINE0) != HAL_OK) {
        return HAL_ERROR;
    }

    return HAL_FDCAN_ActivateNotification(&hfdcan1, notifications, CAN_TX_ALL_BUFFERS_MASK);
}

static void can_runtime_reset(void)
{
    uint32_t primask = can_enter_critical();

    g_can_diag_send_seq = 0U;
#if CAN_HEARTBEAT_ENABLED
    g_can_next_heartbeat_ms = HAL_GetTick() + CAN_HEARTBEAT_PERIOD_MS;
    g_can_next_heartbeat_retry_ms = 0U;
    g_can_heartbeat_pending = 0U;
#endif
    g_can_tx_complete_mask = 0U;
    g_can_tx_abort_mask = 0U;
    g_can_last_tx_complete_mask = 0U;
    g_can_last_tx_abort_mask = 0U;
    g_can_last_error_status_its = 0U;
    g_can_last_error_code = 0U;
    g_can_error_status_count = 0U;
    g_can_ram_access_fail_count = 0U;
    g_can_tx_evt_fifo_full_count = 0U;
    g_can_tx_evt_fifo_lost_count = 0U;

    can_exit_critical(primask);

    g_can_cmd_tx_attempted = 0U;
    g_can_cmd_tx_completed = 0U;
    g_can_cmd_tx_cancelled = 0U;
    g_can_cmd_tx_aborted = 0U;
    g_can_cmd_tx_timed_out = 0U;
    g_can_heartbeat_attempted = 0U;
    g_can_heartbeat_completed = 0U;
    g_can_heartbeat_skipped = 0U;
    g_can_rx_dequeue_count = 0U;
    g_can_rx_hw_poll_count = 0U;
    g_can_last_reported_ram_access_fail_count = 0U;
}

static void can_stop_library_heartbeat(void)
{
    (void)HAL_TIM_Base_Stop_IT(&htim7);
    __HAL_TIM_CLEAR_FLAG(&htim7, TIM_FLAG_UPDATE);
    HAL_NVIC_ClearPendingIRQ(TIM7_IRQn);
}

static uint32_t can_enter_critical(void)
{
    uint32_t primask = __get_PRIMASK();
    __disable_irq();
    return primask;
}

static void can_exit_critical(uint32_t primask)
{
    __set_PRIMASK(primask);
}

static uint32_t can_capture_tx_request_mask(void)
{
    uint32_t txfqs = hfdcan1.Instance->TXFQS;
    uint32_t put_index = (txfqs & FDCAN_TXFQS_TFQPI) >> FDCAN_TXFQS_TFQPI_Pos;

    if (put_index > 2U) {
        return 0U;
    }
    return (uint32_t)1U << put_index;
}

static CanTxResult_t can_submit_frame(uint32_t id, uint32_t dlc_code, uint8_t payload_len,
                                      const uint8_t *data, const char *submit_tag,
                                      const char *kind, uint32_t seq,
                                      uint32_t *req_mask_out)
{
    HAL_StatusTypeDef st;
    uint32_t primask;
    uint32_t predicted_req_mask;
    uint32_t req_mask = 0U;

    primask = can_enter_critical();
    predicted_req_mask = can_capture_tx_request_mask();
    if (predicted_req_mask != 0U) {
        g_can_tx_complete_mask &= ~predicted_req_mask;
        g_can_tx_abort_mask &= ~predicted_req_mask;
    }

    st = CAN_Transmit(id, FDCAN_STANDARD_ID, dlc_code, (uint8_t *)data, &hfdcan1);
    if (st == HAL_OK) {
        req_mask = HAL_FDCAN_GetLatestTxFifoQRequestBuffer(&hfdcan1);
        if (req_mask != 0U) {
            g_can_tx_complete_mask &= ~req_mask;
            g_can_tx_abort_mask &= ~req_mask;
        }
    }
    can_exit_critical(primask);

    if (req_mask_out != NULL) {
        *req_mask_out = req_mask;
    }

    if ((st != HAL_OK) || (req_mask == 0U)) {
        can_diag_tx_state("tx-submit-reject", kind, seq, id, payload_len, req_mask);
        return CAN_TX_RESULT_REJECTED;
    }

    can_diag_tx_state(submit_tag, kind, seq, id, payload_len, req_mask);
    return can_wait_for_tx_request(req_mask, CANFD_TX_CONFIRM_TIMEOUT_MS);
}

static CanTxResult_t can_wait_for_tx_request(uint32_t req_mask, uint32_t timeout_ms)
{
    uint32_t start = HAL_GetTick();

    for (;;) {
        uint32_t txbto = hfdcan1.Instance->TXBTO;
        uint32_t txbcf = hfdcan1.Instance->TXBCF;
        uint32_t primask = can_enter_critical();

        if ((txbto & req_mask) != 0U) {
            g_can_tx_complete_mask &= ~req_mask;
            g_can_tx_abort_mask &= ~req_mask;
            can_exit_critical(primask);
            return CAN_TX_RESULT_OK;
        }
        if ((txbcf & req_mask) != 0U) {
            g_can_tx_complete_mask &= ~req_mask;
            g_can_tx_abort_mask &= ~req_mask;
            can_exit_critical(primask);
            return CAN_TX_RESULT_CANCELLED;
        }
        if ((g_can_tx_complete_mask & req_mask) != 0U) {
            g_can_tx_complete_mask &= ~req_mask;
            can_exit_critical(primask);
            return CAN_TX_RESULT_OK;
        }
        if ((g_can_tx_abort_mask & req_mask) != 0U) {
            g_can_tx_abort_mask &= ~req_mask;
            can_exit_critical(primask);
            return CAN_TX_RESULT_ABORTED;
        }
        can_exit_critical(primask);

        if ((HAL_GetTick() - start) >= timeout_ms) {
            break;
        }
    }

    return CAN_TX_RESULT_TIMEOUT;
}

#if CAN_HEARTBEAT_ENABLED
static void can_schedule_heartbeat(uint32_t now)
{
    if ((int32_t)(now - g_can_next_heartbeat_ms) < 0) {
        return;
    }
    g_can_heartbeat_pending = 1U;
    do {
        g_can_next_heartbeat_ms += CAN_HEARTBEAT_PERIOD_MS;
    } while ((int32_t)(now - g_can_next_heartbeat_ms) >= 0);
}

static void can_service_heartbeat(void)
{
    uint8_t heartbeat_payload = 0U;
    uint32_t now = HAL_GetTick();
    uint32_t req_mask = 0U;
    CanTxResult_t tx_result;

    can_schedule_heartbeat(now);
    if (g_can_heartbeat_pending == 0U) {
        return;
    }
    if ((g_can_next_heartbeat_retry_ms != 0U) &&
        ((int32_t)(now - g_can_next_heartbeat_retry_ms) < 0)) {
        return;
    }

    if (HAL_FDCAN_GetTxFifoFreeLevel(&hfdcan1) == 0U) {
        g_can_heartbeat_skipped++;
        g_can_next_heartbeat_retry_ms = now + CAN_HEARTBEAT_RETRY_MS;
        can_diag_emit("heartbeat-skip-send-busy", "reason=fifo-full");
        return;
    }

    g_can_heartbeat_attempted++;
    tx_result = can_submit_frame(CAN_HEARTBEAT_ID, FDCAN_DLC_BYTES_0, 0U,
                                 &heartbeat_payload, "heartbeat-submit",
                                 "heartbeat", 0U, &req_mask);

    if (tx_result == CAN_TX_RESULT_OK) {
        g_can_heartbeat_completed++;
        g_can_heartbeat_pending = 0U;
        g_can_next_heartbeat_retry_ms = 0U;
        can_diag_tx_state("tx-complete", "heartbeat", 0U, CAN_HEARTBEAT_ID, 0U, req_mask);
        return;
    }

    if (tx_result == CAN_TX_RESULT_ABORTED) {
        can_diag_tx_state("tx-abort-cb", "heartbeat", 0U, CAN_HEARTBEAT_ID, 0U, req_mask);
    } else if (tx_result == CAN_TX_RESULT_TIMEOUT) {
        can_diag_tx_state("tx-timeout", "heartbeat", 0U, CAN_HEARTBEAT_ID, 0U, req_mask);
        (void)HAL_FDCAN_AbortTxRequest(&hfdcan1, req_mask);
        can_diag_tx_state("tx-timeout-abort-issued", "heartbeat", 0U,
                          CAN_HEARTBEAT_ID, 0U, req_mask);
    } else {
        g_can_heartbeat_skipped++;
        can_diag_emit("heartbeat-skip-send-busy", "reason=tx-reject");
    }

    g_can_next_heartbeat_retry_ms = now + CAN_HEARTBEAT_RETRY_MS;
}
#endif

static const char *fdcan_tx_req_state_str(uint32_t req_mask, uint32_t txbrp,
                                          uint32_t txbto, uint32_t txbcf)
{
    if ((req_mask & txbrp) != 0U) return "pending";
    if (((req_mask & txbto) != 0U) && ((req_mask & txbcf) != 0U)) return "tx+cancel";
    if ((req_mask & txbto) != 0U) return "tx";
    if ((req_mask & txbcf) != 0U) return "cancel";
    return "unresolved";
}

static const char *fdcan_lec_str(uint32_t psr)
{
    switch (psr & FDCAN_PSR_LEC) {
        case 0U: return "none";
        case 1U: return "stuff";
        case 2U: return "form";
        case 3U: return "ack";
        case 4U: return "bit1";
        case 5U: return "bit0";
        case 6U: return "crc";
        case 7U: return "nochange";
        default: return "unknown";
    }
}

static const char *fdcan_protocol_error_str(uint32_t lec)
{
    switch (lec) {
        case FDCAN_PROTOCOL_ERROR_NONE:      return "none";
        case FDCAN_PROTOCOL_ERROR_STUFF:     return "stuff";
        case FDCAN_PROTOCOL_ERROR_FORM:      return "form";
        case FDCAN_PROTOCOL_ERROR_ACK:       return "ack";
        case FDCAN_PROTOCOL_ERROR_BIT1:      return "bit1";
        case FDCAN_PROTOCOL_ERROR_BIT0:      return "bit0";
        case FDCAN_PROTOCOL_ERROR_CRC:       return "crc";
        case FDCAN_PROTOCOL_ERROR_NO_CHANGE: return "nochange";
        default:                             return "unknown";
    }
}

static const char *fdcan_activity_str(uint32_t activity)
{
    switch (activity) {
        case FDCAN_COM_STATE_SYNC: return "sync";
        case FDCAN_COM_STATE_IDLE: return "idle";
        case FDCAN_COM_STATE_RX:   return "rx";
        case FDCAN_COM_STATE_TX:   return "tx";
        default:                   return "unknown";
    }
}

static const char *fdcan_hal_state_str(HAL_FDCAN_StateTypeDef state)
{
    switch (state) {
        case HAL_FDCAN_STATE_RESET: return "reset";
        case HAL_FDCAN_STATE_READY: return "ready";
        case HAL_FDCAN_STATE_BUSY:  return "busy";
        case HAL_FDCAN_STATE_ERROR: return "error";
        default:                    return "unknown";
    }
}

static uint8_t fdcan_payload_bytes_for_len(uint16_t len)
{
    if (len <= 8U)  return (uint8_t)len;
    if (len <= 12U) return 12U;
    if (len <= 16U) return 16U;
    if (len <= 20U) return 20U;
    if (len <= 24U) return 24U;
    if (len <= 32U) return 32U;
    if (len <= 48U) return 48U;
    return 64U;
}

static uint32_t fdcan_dlc_code_for_len(uint8_t len)
{
    switch (len) {
        case 0U:  return FDCAN_DLC_BYTES_0;
        case 1U:  return FDCAN_DLC_BYTES_1;
        case 2U:  return FDCAN_DLC_BYTES_2;
        case 3U:  return FDCAN_DLC_BYTES_3;
        case 4U:  return FDCAN_DLC_BYTES_4;
        case 5U:  return FDCAN_DLC_BYTES_5;
        case 6U:  return FDCAN_DLC_BYTES_6;
        case 7U:  return FDCAN_DLC_BYTES_7;
        case 8U:  return FDCAN_DLC_BYTES_8;
        case 12U: return FDCAN_DLC_BYTES_12;
        case 16U: return FDCAN_DLC_BYTES_16;
        case 20U: return FDCAN_DLC_BYTES_20;
        case 24U: return FDCAN_DLC_BYTES_24;
        case 32U: return FDCAN_DLC_BYTES_32;
        case 48U: return FDCAN_DLC_BYTES_48;
        default:  return FDCAN_DLC_BYTES_64;
    }
}