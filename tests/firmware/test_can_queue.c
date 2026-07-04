/*
 * test_can_queue.c
 *
 * Framework: raw C harness (test_runner.h). can.c is included directly so
 * static queue internals (CAN_EnqueueFrame, CAN_DequeueFrame, canRxHead/Tail)
 * are reachable without modifying production code.
 *
 * Architecture under test (post-MRAF redesign):
 *   - HAL_FDCAN_RxFifo0Callback only sets g_can_rx_pending — it must NOT
 *     touch message RAM from ISR context.
 *   - CAN_DrainRxFifo (main context) reads frames, and force-writes RXF0A
 *     only when a SUCCESSFUL read did not advance the hardware fill level
 *     (MRAF blocked HAL's internal ack). It must never ack a failed read.
 *
 * HAL_FDCAN_GetRxMessage is replaced by a controllable stub (macro defined
 * before can.c is included) that simulates the hardware FIFO fill level in
 * the stub FDCAN1 RXF0S register, including an "MRAF mode" where HAL's
 * internal RXF0A ack fails and the fill level does not drop.
 */

#include "test_runner.h"
#include <string.h>

/* ---- HAL stub wiring ---- */
#include "stubs/stm32u5xx_hal.h"
GPIO_TypeDef        stub_gpio = {0};
UART_HandleTypeDef  huart1    = {0};
FDCAN_HandleTypeDef hfdcan1;
TIM_HandleTypeDef   htim7     = {0};

/* ---- Controllable HAL_FDCAN_GetRxMessage stub -------------------------- */

static FDCAN_RxHeaderTypeDef g_stub_rx_header;
static uint8_t               g_stub_rx_data[64];
static int                   g_stub_frames_available = 0;
static int                   g_stub_mraf_mode = 0;   /* 1: HAL's internal RXF0A ack fails */
static int                   g_fdcan_get_rx_called = 0;
static uint32_t              g_stub_get_index = 0;

#define STUB_RXF0A_SENTINEL 0xDEADBEEFU

static void stub_fifo_sync_rxf0s(void)
{
    _stub_FDCAN1.RXF0S =
        (((uint32_t)g_stub_frames_available << FDCAN_RXF0S_F0FL_Pos) & FDCAN_RXF0S_F0FL) |
        ((g_stub_get_index << FDCAN_RXF0S_F0GI_Pos) & FDCAN_RXF0S_F0GI);
}

static void stub_fifo_reset(int frames, int mraf_mode)
{
    g_stub_frames_available = frames;
    g_stub_mraf_mode = mraf_mode;
    g_fdcan_get_rx_called = 0;
    g_stub_get_index = 0;
    _stub_FDCAN1.RXF0A = STUB_RXF0A_SENTINEL;
    stub_fifo_sync_rxf0s();
}

/* Consume a force-ack the production code issued by writing RXF0A. */
static void stub_apply_pending_force_ack(void)
{
    if (_stub_FDCAN1.RXF0A != STUB_RXF0A_SENTINEL) {
        _stub_FDCAN1.RXF0A = STUB_RXF0A_SENTINEL;
        if (g_stub_frames_available > 0) {
            g_stub_frames_available--;
            g_stub_get_index = (g_stub_get_index + 1U) % 3U;
        }
        stub_fifo_sync_rxf0s();
    }
}

static HAL_StatusTypeDef stub_get_rx_message(
        FDCAN_HandleTypeDef *h, uint32_t fifo,
        FDCAN_RxHeaderTypeDef *hdr, uint8_t *data)
{
    (void)h; (void)fifo;

    stub_apply_pending_force_ack();

    if (g_stub_frames_available <= 0) {
        return HAL_ERROR;
    }

    *hdr = g_stub_rx_header;
    memcpy(data, g_stub_rx_data, 64);
    g_fdcan_get_rx_called++;

    if (!g_stub_mraf_mode) {
        /* HAL's internal RXF0A ack worked — fill level drops. */
        g_stub_frames_available--;
        g_stub_get_index = (g_stub_get_index + 1U) % 3U;
    }
    stub_fifo_sync_rxf0s();
    return HAL_OK;
}

#define HAL_FDCAN_GetRxMessage stub_get_rx_message

/* Pull in can.c source to access static internals */
#include "../../DevBoard/Core/Src/can.c"

/* =========================================================================
 * Helpers
 * ========================================================================= */

static void reset_can_queue(void) {
    canRxHead = 0;
    canRxTail = 0;
    g_can_rx_pending = 0;
    hfdcan1.Instance = FDCAN1;
    stub_fifo_reset(0, 0);
}

static void enqueue(uint32_t id, uint8_t len, const uint8_t *data) {
    CAN_EnqueueFrame(id, len, data);
}

/* =========================================================================
 * dlc_to_bytes
 * ========================================================================= */

/* Catches: wrong byte count for any DLC code, or the & 0x0F mask failing */
static void test_dlc_to_bytes_all(void) {
    const uint8_t expected[16] = {
        0, 1, 2, 3, 4, 5, 6, 7, 8, 12, 16, 20, 24, 32, 48, 64
    };
    for (uint8_t i = 0; i < 16; i++) {
        TEST_ASSERT(dlc_to_bytes(i) == expected[i]);
    }
    TEST_ASSERT(dlc_to_bytes(16) == dlc_to_bytes(0));
    TEST_ASSERT(dlc_to_bytes(17) == dlc_to_bytes(1));
    TEST_ASSERT(dlc_to_bytes(0xFF) == dlc_to_bytes(15));
}

/* =========================================================================
 * Software queue
 * ========================================================================= */

/* Catches: dequeue from empty queue returning success or corrupting frame */
static void test_queue_empty_receive(void) {
    reset_can_queue();

    CAN_Frame frame;
    memset(&frame, 0xAA, sizeof(frame));

    TEST_ASSERT(CAN_Receive(&frame) == HAL_ERROR);
    TEST_ASSERT(frame.RxData1_Identifier == 0xAAAAAAAAU);
}

/* Catches: basic enqueue / dequeue path broken — wrong ID or payload */
static void test_queue_enqueue_dequeue_basic(void) {
    reset_can_queue();

    const uint8_t data[] = { 0x01, 0x02, 0x03 };
    enqueue(0x100, 3, data);

    CAN_Frame frame;
    memset(&frame, 0, sizeof(frame));
    TEST_ASSERT(CAN_Receive(&frame) == HAL_OK);
    TEST_ASSERT(frame.RxData1_Identifier == 0x100U);
    TEST_ASSERT(frame.RxData1_BufferLength == 3);
    TEST_ASSERT(frame.RxData1[0] == 0x01);
    TEST_ASSERT(frame.RxData1[1] == 0x02);
    TEST_ASSERT(frame.RxData1[2] == 0x03);

    TEST_ASSERT(CAN_Receive(&frame) == HAL_ERROR);
}

/* Catches: FIFO ordering violated — frames dequeued in wrong order */
static void test_queue_fifo_order(void) {
    reset_can_queue();

    for (uint32_t id = 1; id <= 5; id++) {
        uint8_t d = (uint8_t)id;
        enqueue(id, 1, &d);
    }

    for (uint32_t expected_id = 1; expected_id <= 5; expected_id++) {
        CAN_Frame frame;
        TEST_ASSERT(CAN_Receive(&frame) == HAL_OK);
        TEST_ASSERT(frame.RxData1_Identifier == expected_id);
        TEST_ASSERT(frame.RxData1[0] == (uint8_t)expected_id);
    }

    CAN_Frame dummy;
    TEST_ASSERT(CAN_Receive(&dummy) == HAL_ERROR);
}

/*
 * Catches: overflow dropping the NEWEST frame instead of the OLDEST.
 * Capacity is CAN_RX_QUEUE_SIZE - 1 = 99; the 100th enqueue drops ID 1.
 */
static void test_queue_overflow_drops_oldest(void) {
    reset_can_queue();

    for (uint32_t id = 1; id <= 100; id++) {
        uint8_t d = (uint8_t)(id & 0xFF);
        enqueue(id, 1, &d);
    }

    CAN_Frame frame;
    TEST_ASSERT(CAN_Receive(&frame) == HAL_OK);
    TEST_ASSERT(frame.RxData1_Identifier == 2U);

    uint32_t expected = 3;
    while (CAN_Receive(&frame) == HAL_OK) {
        TEST_ASSERT(frame.RxData1_Identifier == expected);
        expected++;
    }
    TEST_ASSERT(expected == 101U);
}

/* Catches: max-payload frame (64 bytes) truncated or corrupted */
static void test_queue_max_payload_frame(void) {
    reset_can_queue();

    uint8_t payload[64];
    for (int i = 0; i < 64; i++) payload[i] = (uint8_t)i;

    enqueue(0x7FF, 64, payload);

    CAN_Frame frame;
    memset(&frame, 0, sizeof(frame));
    TEST_ASSERT(CAN_Receive(&frame) == HAL_OK);
    TEST_ASSERT(frame.RxData1_Identifier  == 0x7FFU);
    TEST_ASSERT(frame.RxData1_BufferLength == 64);
    for (int i = 0; i < 64; i++) {
        TEST_ASSERT(frame.RxData1[i] == (uint8_t)i);
    }
}

/* Catches: zero-length frame corrupting queue state */
static void test_queue_zero_length_frame(void) {
    reset_can_queue();

    const uint8_t empty[1] = {0};
    enqueue(0x001, 0, empty);

    CAN_Frame frame;
    memset(&frame, 0xFF, sizeof(frame));
    TEST_ASSERT(CAN_Receive(&frame) == HAL_OK);
    TEST_ASSERT(frame.RxData1_Identifier  == 0x001U);
    TEST_ASSERT(frame.RxData1_BufferLength == 0);

    TEST_ASSERT(CAN_Receive(&frame) == HAL_ERROR);
}

/* =========================================================================
 * ISR callback + drain (post-MRAF architecture)
 * ========================================================================= */

/*
 * Catches: the callback reading message RAM from ISR context again.
 * It must only set g_can_rx_pending.
 */
static void test_fifo0_callback_sets_pending_only(void) {
    reset_can_queue();
    stub_fifo_reset(1, 0);

    HAL_FDCAN_RxFifo0Callback(&hfdcan1, FDCAN_IT_RX_FIFO0_NEW_MESSAGE);

    TEST_ASSERT(g_can_rx_pending == 1);
    TEST_ASSERT(g_fdcan_get_rx_called == 0);

    CAN_Frame frame;
    TEST_ASSERT(CAN_Receive(&frame) == HAL_ERROR);
}

/* Catches: callback acting on the wrong interrupt flag */
static void test_fifo0_callback_ignores_other_flags(void) {
    reset_can_queue();

    HAL_FDCAN_RxFifo0Callback(&hfdcan1, FDCAN_IT_BUS_OFF);

    TEST_ASSERT(g_can_rx_pending == 0);
    TEST_ASSERT(g_fdcan_get_rx_called == 0);
}

/* Catches: CAN_DrainRxFifo touching FDCAN registers when nothing is pending */
static void test_drain_is_gated_on_pending(void) {
    reset_can_queue();
    stub_fifo_reset(1, 0);
    g_can_rx_pending = 0;

    CAN_DrainRxFifo();

    TEST_ASSERT(g_fdcan_get_rx_called == 0);
    CAN_Frame frame;
    TEST_ASSERT(CAN_Receive(&frame) == HAL_ERROR);
}

/* Catches: pending set but frames not moved into the software queue */
static void test_drain_moves_frames_to_queue(void) {
    reset_can_queue();

    memset(&g_stub_rx_header, 0, sizeof(g_stub_rx_header));
    g_stub_rx_header.Identifier = 0x456;
    g_stub_rx_header.DataLength = FDCAN_DLC_BYTES_2;   /* DLC code 2 → 2 bytes */
    g_stub_rx_data[0] = 'H';
    g_stub_rx_data[1] = 'i';
    stub_fifo_reset(2, 0);

    g_can_rx_pending = 1;
    CAN_DrainRxFifo();

    TEST_ASSERT(g_can_rx_pending == 0);
    TEST_ASSERT(g_fdcan_get_rx_called == 2);

    CAN_Frame frame;
    memset(&frame, 0, sizeof(frame));
    TEST_ASSERT(CAN_Receive(&frame) == HAL_OK);
    TEST_ASSERT(frame.RxData1_Identifier == 0x456U);
    TEST_ASSERT(frame.RxData1_BufferLength == 2);
    TEST_ASSERT(frame.RxData1[0] == 'H');
    TEST_ASSERT(frame.RxData1[1] == 'i');

    TEST_ASSERT(CAN_Receive(&frame) == HAL_OK);
    TEST_ASSERT(CAN_Receive(&frame) == HAL_ERROR);

    /* HAL acks worked, so no force-write of RXF0A happened */
    TEST_ASSERT(_stub_FDCAN1.RXF0A == STUB_RXF0A_SENTINEL);
}

/*
 * Catches: the MRAF force-ack path regressing.
 * A successful read whose fill level does NOT drop means HAL's internal
 * RXF0A write failed — production code must force-write RXF0A itself, and
 * must enqueue the frame exactly once (no duplicates).
 */
static void test_drain_force_acks_when_fill_stuck(void) {
    reset_can_queue();

    memset(&g_stub_rx_header, 0, sizeof(g_stub_rx_header));
    g_stub_rx_header.Identifier = 0x130;
    g_stub_rx_header.DataLength = FDCAN_DLC_BYTES_1;
    g_stub_rx_data[0] = 0x77;
    stub_fifo_reset(1, 1);   /* one frame, MRAF mode: HAL ack fails */

    g_can_rx_pending = 1;
    CAN_DrainRxFifo();

    /* Frame enqueued exactly once */
    CAN_Frame frame;
    memset(&frame, 0, sizeof(frame));
    TEST_ASSERT(CAN_Receive(&frame) == HAL_OK);
    TEST_ASSERT(frame.RxData1_Identifier == 0x130U);
    TEST_ASSERT(frame.RxData1[0] == 0x77);
    TEST_ASSERT(CAN_Receive(&frame) == HAL_ERROR);

    /* The force-ack consumed the stuck slot (fill level now 0) */
    TEST_ASSERT(g_stub_frames_available == 0);
}

/*
 * Catches: THE bug from a previous attempt — force-acking a slot after a
 * FAILED read, which permanently loses the frame. On read failure the drain
 * must break and leave RXF0A untouched.
 */
static void test_drain_never_acks_failed_read(void) {
    reset_can_queue();

    /* Hardware claims a frame is present, but the read itself fails
     * (MRAF on the data read): simulate by advertising fill level 1 while
     * the stub has no frames to hand out. */
    stub_fifo_reset(0, 0);
    _stub_FDCAN1.RXF0S = (1U << FDCAN_RXF0S_F0FL_Pos);

    g_can_rx_pending = 1;
    CAN_DrainRxFifo();

    TEST_ASSERT(_stub_FDCAN1.RXF0A == STUB_RXF0A_SENTINEL);

    CAN_Frame frame;
    TEST_ASSERT(CAN_Receive(&frame) == HAL_ERROR);
}

/* =========================================================================
 * Entry point
 * ========================================================================= */
int main(void) {
    hfdcan1.Instance = FDCAN1;

    RUN_TEST(test_dlc_to_bytes_all);
    RUN_TEST(test_queue_empty_receive);
    RUN_TEST(test_queue_enqueue_dequeue_basic);
    RUN_TEST(test_queue_fifo_order);
    RUN_TEST(test_queue_overflow_drops_oldest);
    RUN_TEST(test_queue_max_payload_frame);
    RUN_TEST(test_queue_zero_length_frame);
    RUN_TEST(test_fifo0_callback_sets_pending_only);
    RUN_TEST(test_fifo0_callback_ignores_other_flags);
    RUN_TEST(test_drain_is_gated_on_pending);
    RUN_TEST(test_drain_moves_frames_to_queue);
    RUN_TEST(test_drain_force_acks_when_fill_stuck);
    RUN_TEST(test_drain_never_acks_failed_read);

    PRINT_RESULTS();
    return tests_failed > 0 ? 1 : 0;
}
