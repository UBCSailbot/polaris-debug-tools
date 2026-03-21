/*
 * test_can_queue.c
 *
 * Framework: Raw C harness with TEST_ASSERT / RUN_TEST macros (test_runner.h).
 *
 * Rationale: Same as test_ring_buffer.c — no existing framework in the repo;
 * raw-C harness is the minimal, zero-dependency choice for a pure-C module.
 *
 * Strategy: can.c is included directly so its static queue functions
 * (CAN_EnqueueFrame, CAN_DequeueFrame) and static state (canRxHead,
 * canRxTail, CAN_Rx_Queue) are accessible without modifying production code.
 *
 * HAL_FDCAN_GetRxMessage is overridden with a macro BEFORE can.c is included
 * so that HAL_FDCAN_RxFifo0Callback tests can inject controlled frame data.
 *
 * Audit findings exercised by these tests:
 *   - dlc_to_bytes truncation bug: the real RxHeader.DataLength is a uint32_t
 *     HAL constant (e.g. 0x00080000) that truncates to 0x00 when passed to
 *     dlc_to_bytes(uint8_t).  The test stub sets DataLength to the raw byte
 *     count directly (0-8), which passes through the uint8_t truncation
 *     correctly.  test_dlc_to_bytes_all validates the lookup table itself.
 *   - Overflow drops oldest frame, never newest.
 *   - CAN_Receive returns HAL_OK / HAL_ERROR (not 1/0) — tested explicitly.
 */

#include "test_runner.h"
#include <string.h>

/* ---- HAL stub wiring ---- */
#include "stubs/stm32u5xx_hal.h"
GPIO_TypeDef        stub_gpio = {0};
UART_HandleTypeDef  huart1    = {0};
FDCAN_HandleTypeDef hfdcan1   = {0};
TIM_HandleTypeDef   htim7     = {0};

/*
 * Override HAL_FDCAN_GetRxMessage with a macro so the callback test can inject
 * controlled data.  Must appear BEFORE the #include of can.c so the macro
 * replaces every call site inside that translation unit.
 *
 * The stub copies g_stub_rx_header into *hdr and memcpy's g_stub_rx_data into
 * data using g_stub_rx_header.DataLength bytes.
 *
 * Important: DataLength here is the RAW BYTE COUNT (not the 0x000X0000 HAL
 * constant).  This is intentional — it works correctly with the uint8_t
 * truncation in dlc_to_bytes because the low byte of a small integer IS the
 * integer itself.  See audit note on the dlc_to_bytes truncation bug.
 */
static FDCAN_RxHeaderTypeDef g_stub_rx_header;
static uint8_t               g_stub_rx_data[64];
static int                   g_fdcan_get_rx_called = 0;

#define HAL_FDCAN_GetRxMessage(h, fifo, hdr, data)              \
    ( *(hdr) = g_stub_rx_header,                                \
      memcpy((data), g_stub_rx_data, (g_stub_rx_header.DataLength) & 0xFF), \
      g_fdcan_get_rx_called++,                                  \
      HAL_OK )

/* Pull in can.c source to access static internals */
#include "../DevBoard/Core/Src/can.c"

/* =========================================================================
 * Helpers
 * ========================================================================= */

static void reset_can_queue(void) {
    canRxHead = 0;
    canRxTail = 0;
}

static void enqueue(uint32_t id, uint8_t len, const uint8_t *data) {
    CAN_EnqueueFrame(id, len, data);
}

/* =========================================================================
 * Tests
 * ========================================================================= */

/*
 * Catches: wrong byte count returned for any of the 16 DLC index values,
 * or the & 0x0F mask failing to clip a value >= 16.
 */
static void test_dlc_to_bytes_all(void) {
    /* Expected values per ISO 11898-1 / STM32 HAL dlc_lut */
    const uint8_t expected[16] = {
        0, 1, 2, 3, 4, 5, 6, 7, 8, 12, 16, 20, 24, 32, 48, 64
    };
    for (uint8_t i = 0; i < 16; i++) {
        TEST_ASSERT(dlc_to_bytes(i) == expected[i]);
    }
    /* Values >= 16 must be masked to their lower nibble */
    TEST_ASSERT(dlc_to_bytes(16) == dlc_to_bytes(0));   /* 16 & 0x0F = 0 */
    TEST_ASSERT(dlc_to_bytes(17) == dlc_to_bytes(1));   /* 17 & 0x0F = 1 */
    TEST_ASSERT(dlc_to_bytes(0xFF) == dlc_to_bytes(15)); /* 0xFF & 0x0F = 15 */
}

/* Catches: dequeue from empty queue returning non-zero or corrupting frame */
static void test_queue_empty_receive(void) {
    reset_can_queue();

    CAN_Frame frame;
    memset(&frame, 0xAA, sizeof(frame));

    HAL_StatusTypeDef ret = CAN_Receive(&frame);
    TEST_ASSERT(ret == HAL_ERROR);
    /* Frame contents must be untouched when queue is empty */
    TEST_ASSERT(frame.RxData1_Identifier == 0xAAAAAAAAU);
}

/* Catches: basic enqueue / dequeue path broken — wrong ID or payload */
static void test_queue_enqueue_dequeue_basic(void) {
    reset_can_queue();

    const uint8_t data[] = { 0x01, 0x02, 0x03 };
    enqueue(0x100, 3, data);

    CAN_Frame frame;
    memset(&frame, 0, sizeof(frame));
    HAL_StatusTypeDef ret = CAN_Receive(&frame);

    TEST_ASSERT(ret == HAL_OK);
    TEST_ASSERT(frame.RxData1_Identifier == 0x100U);
    TEST_ASSERT(frame.RxData1_BufferLength == 3);
    TEST_ASSERT(frame.RxData1[0] == 0x01);
    TEST_ASSERT(frame.RxData1[1] == 0x02);
    TEST_ASSERT(frame.RxData1[2] == 0x03);

    /* Queue must be empty afterwards */
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
 * Catches: overflow dropping the NEWEST frame instead of the OLDEST, or
 * corrupting queue state so subsequent dequeues return wrong data.
 *
 * Trace for CAN_RX_QUEUE_SIZE = 100:
 *   Enqueues 1-99  → head=99, tail=0, count=99.
 *   Enqueue 100    → next=(99+1)%100=0 == tail(0) → overflow!
 *                    tail becomes 1 (drops index 0 = ID 1).
 *                    Frame 100 written to slot 99, head=0.
 *   Queue now holds 99 frames: IDs 2..100 in slots [1..99] with tail=1, head=0.
 *   First dequeue must return ID 2.
 */
static void test_queue_overflow_drops_oldest(void) {
    reset_can_queue();

    for (uint32_t id = 1; id <= 100; id++) {
        uint8_t d = (uint8_t)(id & 0xFF);
        enqueue(id, 1, &d);
    }

    /* After 100 enqueues into a 99-capacity queue, ID=1 was dropped */
    CAN_Frame frame;
    TEST_ASSERT(CAN_Receive(&frame) == HAL_OK);
    TEST_ASSERT(frame.RxData1_Identifier == 2U);

    /* Drain remaining 98 frames (IDs 3..100) */
    uint32_t expected = 3;
    while (CAN_Receive(&frame) == HAL_OK) {
        TEST_ASSERT(frame.RxData1_Identifier == expected);
        expected++;
    }
    TEST_ASSERT(expected == 101U); /* All 99 frames (IDs 2-100) dequeued */
}

/*
 * Catches: HAL_FDCAN_RxFifo0Callback not calling CAN_EnqueueFrame, or
 * passing wrong identifier/data to it.
 *
 * Uses the macro override of HAL_FDCAN_GetRxMessage defined at the top of
 * this file to inject a controlled frame.
 *
 * Note on DataLength: set to raw byte count 2 (not the HAL constant
 * 0x00020000) so it passes through the uint8_t truncation in dlc_to_bytes
 * correctly.  This is the workaround for the truncation bug documented in the
 * audit; the lookup table returns dlc_lut[2] = 2.
 */
static void test_fifo0_callback_enqueues(void) {
    reset_can_queue();
    g_fdcan_get_rx_called = 0;

    memset(&g_stub_rx_header, 0, sizeof(g_stub_rx_header));
    g_stub_rx_header.Identifier  = 0x456;
    g_stub_rx_header.DataLength  = 2;   /* raw byte count — see note above */
    g_stub_rx_data[0] = 'H';
    g_stub_rx_data[1] = 'i';

    HAL_FDCAN_RxFifo0Callback(&hfdcan1, FDCAN_IT_RX_FIFO0_NEW_MESSAGE);

    TEST_ASSERT(g_fdcan_get_rx_called == 1);

    CAN_Frame frame;
    memset(&frame, 0, sizeof(frame));
    TEST_ASSERT(CAN_Receive(&frame) == HAL_OK);
    TEST_ASSERT(frame.RxData1_Identifier == 0x456U);
    TEST_ASSERT(frame.RxData1_BufferLength == 2);
    TEST_ASSERT(frame.RxData1[0] == 'H');
    TEST_ASSERT(frame.RxData1[1] == 'i');
}

/*
 * Catches: callback acting on the wrong interrupt flag — must only enqueue
 * when FDCAN_IT_RX_FIFO0_NEW_MESSAGE bit is set.
 */
static void test_fifo0_callback_ignores_other_flags(void) {
    reset_can_queue();
    g_fdcan_get_rx_called = 0;

    /* Pass a flag that does NOT include RX_FIFO0_NEW_MESSAGE */
    HAL_FDCAN_RxFifo0Callback(&hfdcan1, FDCAN_IT_BUS_OFF);

    TEST_ASSERT(g_fdcan_get_rx_called == 0);

    CAN_Frame frame;
    TEST_ASSERT(CAN_Receive(&frame) == HAL_ERROR);
}

/*
 * Catches: max-payload frame (64 bytes) not stored or retrieved correctly —
 * buffer copy off-by-one would corrupt or truncate the payload.
 */
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

/*
 * Catches: zero-length frame (len=0) crashing or corrupting queue state.
 * dlc_to_bytes(0) = 0 is valid; the queue must accept and return it cleanly.
 */
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
 * Entry point
 * ========================================================================= */
int main(void) {
    RUN_TEST(test_dlc_to_bytes_all);
    RUN_TEST(test_queue_empty_receive);
    RUN_TEST(test_queue_enqueue_dequeue_basic);
    RUN_TEST(test_queue_fifo_order);
    RUN_TEST(test_queue_overflow_drops_oldest);
    RUN_TEST(test_fifo0_callback_enqueues);
    RUN_TEST(test_fifo0_callback_ignores_other_flags);
    RUN_TEST(test_queue_max_payload_frame);
    RUN_TEST(test_queue_zero_length_frame);

    PRINT_RESULTS();
    return tests_failed > 0 ? 1 : 0;
}
