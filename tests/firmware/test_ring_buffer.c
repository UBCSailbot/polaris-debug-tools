/*
 * test_ring_buffer.c
 *
 * Framework: raw C harness (test_runner.h) — see dev_test_support.h for the
 * stub wiring. dev.c is included directly so static internals are reachable.
 *
 * Covers:
 *   - ring buffer push/pop/ordering/wrap-around/full-sentinel behavior
 *   - the current RX callback layout:
 *       USART2 → Dev_UART_RxCpltCallback single-byte path into rb_u2_rx
 *       USART1 → Dev_UART_RxEventCallback burst path (isr_u1_buf) into rb_u1_rx
 *   - overflow pending flags set when a ring rejects a byte
 */

#include "test_runner.h"
#include "dev_test_support.h"

/* Local occupancy helper — production code intentionally has no ring_count. */
static uint16_t ring_count(const RingBuf_t *r)
{
    return (uint16_t)((r->head - r->tail) & RING_MASK);
}

/* =========================================================================
 * Ring buffer primitives
 * ========================================================================= */

/* Catches: pop from an empty ring buffer returning success or clobbering out */
static void test_ring_empty_pop(void) {
    RingBuf_t r;
    ring_init(&r);

    uint8_t out = 0xAA;
    TEST_ASSERT(ring_pop(&r, &out) == -1);
    TEST_ASSERT(out == 0xAA);
    TEST_ASSERT(ring_count(&r) == 0);
}

/* Catches: basic push/pop path broken — wrong byte stored or wrong return code */
static void test_ring_push_pop_basic(void) {
    RingBuf_t r;
    ring_init(&r);

    TEST_ASSERT(ring_push(&r, 0x42) == 0);
    TEST_ASSERT(ring_count(&r) == 1);

    uint8_t out = 0;
    TEST_ASSERT(ring_pop(&r, &out) == 0);
    TEST_ASSERT(out == 0x42);
    TEST_ASSERT(ring_count(&r) == 0);

    out = 0xBB;
    TEST_ASSERT(ring_pop(&r, &out) == -1);
    TEST_ASSERT(out == 0xBB);
}

/* Catches: FIFO ordering violated */
static void test_ring_fifo_order(void) {
    RingBuf_t r;
    ring_init(&r);

    const uint8_t bytes[] = { 'A', 'B', 'C', 'D', 'E' };
    for (int i = 0; i < 5; i++) {
        TEST_ASSERT(ring_push(&r, bytes[i]) == 0);
    }
    for (int i = 0; i < 5; i++) {
        uint8_t out = 0;
        TEST_ASSERT(ring_pop(&r, &out) == 0);
        TEST_ASSERT(out == bytes[i]);
    }
    TEST_ASSERT(ring_count(&r) == 0);
}

/*
 * Catches: buffer accepting a 256th byte instead of rejecting it.
 * One slot is reserved as full-sentinel: capacity is RING_SIZE - 1 = 255.
 */
static void test_ring_full_push_fails(void) {
    RingBuf_t r;
    ring_init(&r);

    for (int i = 0; i < 255; i++) {
        TEST_ASSERT(ring_push(&r, (uint8_t)(i & 0xFF)) == 0);
    }
    TEST_ASSERT(ring_count(&r) == 255);

    TEST_ASSERT(ring_push(&r, 0xFF) == -1);
    TEST_ASSERT(ring_count(&r) == 255);

    for (int i = 0; i < 255; i++) {
        uint8_t out = 0;
        TEST_ASSERT(ring_pop(&r, &out) == 0);
        TEST_ASSERT(out == (uint8_t)(i & 0xFF));
    }
    TEST_ASSERT(ring_count(&r) == 0);
}

/* Catches: off-by-one or missed mask in head/tail wrap-around arithmetic */
static void test_ring_wrap_around(void) {
    RingBuf_t r;
    ring_init(&r);

    int errors = 0;
    for (int i = 0; i < 700; i++) {
        uint8_t pushed = (uint8_t)(i % 251);
        if (ring_push(&r, pushed) != 0) { errors++; continue; }

        uint8_t popped = 0;
        if (ring_pop(&r, &popped) != 0) { errors++; continue; }
        if (popped != pushed) errors++;
    }

    TEST_ASSERT(errors == 0);
    TEST_ASSERT(ring_count(&r) == 0);
}

/* =========================================================================
 * RX callback routing (current architecture)
 * ========================================================================= */

/*
 * Catches: USART2 single-byte RX callback not pushing isr_u2_byte into
 * rb_u2_rx, or routing it to the wrong buffer.
 */
static void test_u2_callback_pushes_to_u2_ring(void) {
    reset_dev_state();

    isr_u2_byte = 'Y';
    Dev_UART_RxCpltCallback(&huart2);

    TEST_ASSERT(ring_count(&rb_u2_rx) == 1);
    TEST_ASSERT(ring_count(&rb_u1_rx) == 0);

    uint8_t out = 0;
    TEST_ASSERT(ring_pop(&rb_u2_rx, &out) == 0);
    TEST_ASSERT(out == 'Y');
}

/*
 * Catches: the huart1 branch of RxCpltCallback re-appearing. USART1 uses the
 * ReceiveToIdle event path — the complete-callback must not touch rb_u1_rx.
 */
static void test_u1_cplt_callback_is_noop(void) {
    reset_dev_state();

    Dev_UART_RxCpltCallback(&huart1);

    TEST_ASSERT(ring_count(&rb_u1_rx) == 0);
    TEST_ASSERT(ring_count(&rb_u2_rx) == 0);
}

/*
 * Catches: Dev_UART_RxEventCallback dropping bytes from a burst or writing
 * them out of order into rb_u1_rx.
 */
static void test_u1_event_callback_burst(void) {
    reset_dev_state();

    const char *burst = "SYS:PING";
    uint16_t n = (uint16_t)strlen(burst);
    memcpy(isr_u1_buf, burst, n);

    Dev_UART_RxEventCallback(&huart1, n);

    TEST_ASSERT(ring_count(&rb_u1_rx) == n);
    for (uint16_t i = 0; i < n; i++) {
        uint8_t out = 0;
        TEST_ASSERT(ring_pop(&rb_u1_rx, &out) == 0);
        TEST_ASSERT(out == (uint8_t)burst[i]);
    }
}

/* Catches: event callback for a non-USART1 handle polluting rb_u1_rx */
static void test_u1_event_callback_ignores_other_uart(void) {
    reset_dev_state();

    memcpy(isr_u1_buf, "XX", 2);
    Dev_UART_RxEventCallback(&huart2, 2);

    TEST_ASSERT(ring_count(&rb_u1_rx) == 0);
}

/*
 * Catches: overflow silently dropping bytes without latching the pending
 * flag that Dev_Poll turns into a LOG:WARN frame.
 */
static void test_u1_overflow_sets_pending_flag(void) {
    reset_dev_state();

    /* Fill rb_u1_rx to capacity */
    for (int i = 0; i < 255; i++) {
        TEST_ASSERT(ring_push(&rb_u1_rx, 0x55) == 0);
    }
    TEST_ASSERT(u1_overflow_pending == 0);

    isr_u1_buf[0] = 0x56;
    Dev_UART_RxEventCallback(&huart1, 1);

    TEST_ASSERT(u1_overflow_pending == 1);
    TEST_ASSERT(ring_count(&rb_u1_rx) == 255);
}

static void test_u2_overflow_sets_pending_flag(void) {
    reset_dev_state();

    for (int i = 0; i < 255; i++) {
        TEST_ASSERT(ring_push(&rb_u2_rx, 0x55) == 0);
    }
    TEST_ASSERT(u2_overflow_pending == 0);

    isr_u2_byte = 0x56;
    Dev_UART_RxCpltCallback(&huart2);

    TEST_ASSERT(u2_overflow_pending == 1);
    TEST_ASSERT(ring_count(&rb_u2_rx) == 255);
}

/* =========================================================================
 * Entry point
 * ========================================================================= */
int main(void) {
    RUN_TEST(test_ring_empty_pop);
    RUN_TEST(test_ring_push_pop_basic);
    RUN_TEST(test_ring_fifo_order);
    RUN_TEST(test_ring_full_push_fails);
    RUN_TEST(test_ring_wrap_around);
    RUN_TEST(test_u2_callback_pushes_to_u2_ring);
    RUN_TEST(test_u1_cplt_callback_is_noop);
    RUN_TEST(test_u1_event_callback_burst);
    RUN_TEST(test_u1_event_callback_ignores_other_uart);
    RUN_TEST(test_u1_overflow_sets_pending_flag);
    RUN_TEST(test_u2_overflow_sets_pending_flag);

    PRINT_RESULTS();
    return tests_failed > 0 ? 1 : 0;
}
