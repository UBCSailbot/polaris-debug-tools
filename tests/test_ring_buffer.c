/*
 * test_ring_buffer.c
 *
 * Framework: Raw C harness with TEST_ASSERT / RUN_TEST macros (test_runner.h).
 *
 * Rationale: No existing test framework is present in this repository.  Both
 * modules under test are pure C.  A dependency-free raw-C harness compiles
 * with a plain gcc invocation and has no external requirements, which is the
 * correct fit for a single-developer embedded project at this stage.
 *
 * Strategy: dev.c is included directly so its static ring-buffer functions
 * (ring_init, ring_push, ring_pop, ring_count) and static state variables
 * (rb_u1_rx, isr_u1_byte) are accessible in this translation unit without
 * changing any production code.
 *
 * Audit findings exercised by these tests:
 *   - Capacity is 255 bytes, not 256 (one slot reserved as full-sentinel).
 *   - isr_u1_byte is written in ISR context; test_ring_callback_push verifies
 *     the push path works correctly end-to-end.
 *   - ring_push silently returns -1 on overflow; test_ring_full_push_fails
 *     verifies that return value and that no corruption occurs.
 */

#include "test_runner.h"

/* ---- HAL stub wiring ---- */
#include "stubs/stm32u5xx_hal.h"
GPIO_TypeDef       stub_gpio = {0};
SPI_HandleTypeDef  hspi1     = {0};
UART_HandleTypeDef huart1    = {0};
UART_HandleTypeDef huart2    = {0};
FDCAN_HandleTypeDef hfdcan1  = {0};

/* Pull in dev.c to access static internals */
#include "../DevBoard/Core/Src/dev.c"

/* =========================================================================
 * Helpers
 * ========================================================================= */

/* Re-initialise a named ring buffer to a clean state between tests. */
static void reset_rb(RingBuf_t *r) {
    ring_init(r);
}

/* =========================================================================
 * Tests
 * ========================================================================= */

/* Catches: pop from an empty ring buffer returning -1 instead of 0 or garbage */
static void test_ring_empty_pop(void) {
    RingBuf_t r;
    reset_rb(&r);

    uint8_t out = 0xAA;
    int ret = ring_pop(&r, &out);

    TEST_ASSERT(ret == -1);
    /* Output byte must not have been modified */
    TEST_ASSERT(out == 0xAA);
    TEST_ASSERT(ring_count(&r) == 0);
}

/* Catches: basic push/pop path broken — wrong byte stored or wrong return code */
static void test_ring_push_pop_basic(void) {
    RingBuf_t r;
    reset_rb(&r);

    int push_ret = ring_push(&r, 0x42);
    TEST_ASSERT(push_ret == 0);
    TEST_ASSERT(ring_count(&r) == 1);

    uint8_t out = 0;
    int pop_ret = ring_pop(&r, &out);
    TEST_ASSERT(pop_ret == 0);
    TEST_ASSERT(out == 0x42);
    TEST_ASSERT(ring_count(&r) == 0);

    /* After draining, next pop must return -1 */
    out = 0xBB;
    TEST_ASSERT(ring_pop(&r, &out) == -1);
    TEST_ASSERT(out == 0xBB);
}

/* Catches: FIFO ordering violated — bytes coming out in wrong order */
static void test_ring_fifo_order(void) {
    RingBuf_t r;
    reset_rb(&r);

    const uint8_t bytes[] = { 'A', 'B', 'C', 'D', 'E' };
    for (int i = 0; i < 5; i++) {
        TEST_ASSERT(ring_push(&r, bytes[i]) == 0);
    }
    TEST_ASSERT(ring_count(&r) == 5);

    for (int i = 0; i < 5; i++) {
        uint8_t out = 0;
        TEST_ASSERT(ring_pop(&r, &out) == 0);
        TEST_ASSERT(out == bytes[i]);
    }
    TEST_ASSERT(ring_count(&r) == 0);
}

/* Catches: ring_count returning wrong value after mixed push/pop operations */
static void test_ring_count(void) {
    RingBuf_t r;
    reset_rb(&r);

    TEST_ASSERT(ring_count(&r) == 0);

    ring_push(&r, 1);
    ring_push(&r, 2);
    ring_push(&r, 3);
    TEST_ASSERT(ring_count(&r) == 3);

    uint8_t tmp;
    ring_pop(&r, &tmp);
    TEST_ASSERT(ring_count(&r) == 2);

    ring_pop(&r, &tmp);
    ring_pop(&r, &tmp);
    TEST_ASSERT(ring_count(&r) == 0);
}

/*
 * Catches: buffer accepting a 256th byte instead of rejecting it.
 *
 * The ring buffer uses a one-slot full-sentinel: maximum capacity is
 * RING_SIZE - 1 = 255 bytes.  The 256th push must return -1 and must not
 * corrupt any previously stored byte.
 */
static void test_ring_full_push_fails(void) {
    RingBuf_t r;
    reset_rb(&r);

    /* Fill to capacity (255 bytes) */
    int i;
    for (i = 0; i < 255; i++) {
        int ret = ring_push(&r, (uint8_t)(i & 0xFF));
        TEST_ASSERT(ret == 0);
    }
    TEST_ASSERT(ring_count(&r) == 255);

    /* 256th push must be rejected */
    int overflow_ret = ring_push(&r, 0xFF);
    TEST_ASSERT(overflow_ret == -1);

    /* Count must not have changed */
    TEST_ASSERT(ring_count(&r) == 255);

    /* Previously stored bytes must be intact — pop all 255 and verify */
    for (i = 0; i < 255; i++) {
        uint8_t out = 0;
        TEST_ASSERT(ring_pop(&r, &out) == 0);
        TEST_ASSERT(out == (uint8_t)(i & 0xFF));
    }
    TEST_ASSERT(ring_count(&r) == 0);
}

/*
 * Catches: off-by-one or missed mask in head/tail wrap-around arithmetic.
 *
 * Pushes and pops 300 times through the buffer.  The head and tail indices
 * both wrap through 0 multiple times, exercising the & RING_MASK path.
 * Each popped byte is verified against the value that was pushed.
 */
static void test_ring_wrap_around(void) {
    RingBuf_t r;
    reset_rb(&r);

    int errors = 0;
    for (int i = 0; i < 300; i++) {
        uint8_t pushed = (uint8_t)(i % 251);   /* prime modulus keeps values varied */
        if (ring_push(&r, pushed) != 0) { errors++; continue; }

        uint8_t popped = 0;
        if (ring_pop(&r, &popped) != 0) { errors++; continue; }

        if (popped != pushed) errors++;
    }

    TEST_ASSERT(errors == 0);
    TEST_ASSERT(ring_count(&r) == 0);
}

/*
 * Catches: Dev_UART_RxCpltCallback not pushing isr_u1_byte into rb_u1_rx,
 * or pushing the wrong byte, or re-arming HAL_UART_Receive_IT with a wrong
 * pointer such that the byte variable gets clobbered before the push.
 */
static void test_ring_callback_push(void) {
    /* Reset the real static buffer that dev.c owns */
    reset_rb(&rb_u1_rx);

    isr_u1_byte = 'X';
    Dev_UART_RxCpltCallback(&huart1);

    TEST_ASSERT(ring_count(&rb_u1_rx) == 1);

    uint8_t out = 0;
    TEST_ASSERT(ring_pop(&rb_u1_rx, &out) == 0);
    TEST_ASSERT(out == 'X');
    TEST_ASSERT(ring_count(&rb_u1_rx) == 0);
}

/*
 * Catches: Dev_UART_RxCpltCallback dispatching to the wrong ring buffer when
 * called with huart2 — byte should land in rb_u2_rx, not rb_u1_rx.
 */
static void test_ring_callback_huart2_dispatch(void) {
    reset_rb(&rb_u1_rx);
    reset_rb(&rb_u2_rx);

    isr_u2_byte = 'Y';
    Dev_UART_RxCpltCallback(&huart2);

    /* huart2 byte must go to rb_u2_rx */
    TEST_ASSERT(ring_count(&rb_u2_rx) == 1);
    /* rb_u1_rx must be untouched */
    TEST_ASSERT(ring_count(&rb_u1_rx) == 0);

    uint8_t out = 0;
    TEST_ASSERT(ring_pop(&rb_u2_rx, &out) == 0);
    TEST_ASSERT(out == 'Y');
}

/* =========================================================================
 * Entry point
 * ========================================================================= */
int main(void) {
    RUN_TEST(test_ring_empty_pop);
    RUN_TEST(test_ring_push_pop_basic);
    RUN_TEST(test_ring_fifo_order);
    RUN_TEST(test_ring_count);
    RUN_TEST(test_ring_full_push_fails);
    RUN_TEST(test_ring_wrap_around);
    RUN_TEST(test_ring_callback_push);
    RUN_TEST(test_ring_callback_huart2_dispatch);

    PRINT_RESULTS();
    return tests_failed > 0 ? 1 : 0;
}
