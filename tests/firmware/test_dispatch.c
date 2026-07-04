/*
 * test_dispatch.c
 *
 * Framework: raw C harness (test_runner.h) with dev_test_support.h wiring.
 *
 * End-to-end protocol-loop tests: bytes pushed into rb_u1_rx are consumed by
 * Dev_Poll(), dispatched to SYS handling or the protocol modules, and the
 * emitted UART1 frames are asserted via the stub TX capture buffer.
 *
 * Also covers:
 *   - legacy mode entry/exit including the SYS:RESET escape matcher with
 *     overlapping partial matches (regression for the rescan-after-flush fix)
 *   - SYS:WATCHDOG wire behavior
 *   - CAN RX drain servicing during the blocking uart2_wait_for_byte loop
 */

#include "test_runner.h"
#include "dev_test_support.h"

/* =========================================================================
 * SYS commands
 * ========================================================================= */

static void test_sys_ping(void) {
    reset_dev_state();
    feed_line_and_poll("SYS:PING");
    TEST_ASSERT(capture_contains("SYS:INFO:pong=1"));
}

static void test_sys_ping_rejects_args(void) {
    reset_dev_state();
    feed_line_and_poll("SYS:PING:EXTRA");
    TEST_ASSERT(capture_contains("SYS:FAIL:reason=bad-arg"));
}

static void test_sys_hello_reports_identity(void) {
    reset_dev_state();
    feed_line_and_poll("SYS:HELLO");
    TEST_ASSERT(capture_contains("SYS:INFO:"));
    TEST_ASSERT(capture_contains("proto=1"));
    TEST_ASSERT(capture_contains("board=devboard"));
    TEST_ASSERT(capture_contains("legacy=1"));
    TEST_ASSERT(capture_contains("caps="));
    /* WATCHDOG feature cap must be advertised so the GUI can gate controls */
    TEST_ASSERT(capture_contains("WATCHDOG"));
}

static void test_sys_caps(void) {
    reset_dev_state();
    feed_line_and_poll("SYS:CAPS");
    TEST_ASSERT(capture_contains("SYS:INFO:caps=UART,SPI,CANFD,I2C"));
}

static void test_sys_unknown_command(void) {
    reset_dev_state();
    feed_line_and_poll("SYS:NOPE");
    TEST_ASSERT(capture_contains("SYS:FAIL:reason=unknown-command"));
}

static void test_lowercase_input_uppercased(void) {
    reset_dev_state();
    feed_line_and_poll("sys:ping");
    TEST_ASSERT(capture_contains("SYS:INFO:pong=1"));
}

/* =========================================================================
 * Frame validation
 * ========================================================================= */

static void test_bad_frame_warns(void) {
    reset_dev_state();
    feed_line_and_poll("JUSTONETOKEN");
    TEST_ASSERT(capture_contains("LOG:WARN:reason=bad-frame"));
}

static void test_unknown_domain_warns(void) {
    reset_dev_state();
    feed_line_and_poll("BOGUS:CMD");
    TEST_ASSERT(capture_contains("LOG:WARN:reason=unknown-domain"));
}

static void test_overlong_line_warns(void) {
    reset_dev_state();

    /* Feed > MAX_LINE_CHARS printable bytes, then terminate. The 256-byte
     * ring is smaller than MAX_LINE_CHARS, so drain it through Dev_Poll in
     * chunks like real ISR-fed traffic. */
    uint32_t sent = 0;
    while (sent < MAX_LINE_CHARS + 8U) {
        uint32_t chunk = 0;
        while ((chunk < 200U) && (sent < MAX_LINE_CHARS + 8U)) {
            (void)ring_push(&rb_u1_rx, 'Z');
            chunk++;
            sent++;
        }
        Dev_Poll();
    }
    feed_line_and_poll("");
    TEST_ASSERT(capture_contains("LOG:WARN:reason=line-too-long"));
}

/* =========================================================================
 * Module dispatch
 * ========================================================================= */

static void test_dispatch_uart_command(void) {
    reset_dev_state();
    feed_line_and_poll("UART:INIT");
    TEST_ASSERT(rec_uart_cmd.calls == 1);
    TEST_ASSERT(strcmp(rec_uart_cmd.command, "INIT") == 0);
    TEST_ASSERT(rec_uart_cmd.argc == 0);
}

static void test_dispatch_canfd_command_with_args(void) {
    reset_dev_state();
    feed_line_and_poll("CANFD:SEND:130:DEADBEEF");
    TEST_ASSERT(rec_can_cmd.calls == 1);
    TEST_ASSERT(strcmp(rec_can_cmd.command, "SEND") == 0);
    TEST_ASSERT(rec_can_cmd.argc == 2);
    TEST_ASSERT(strcmp(rec_can_cmd.argv0, "130") == 0);
    TEST_ASSERT(strcmp(rec_can_cmd.argv1, "DEADBEEF") == 0);
}

static void test_dispatch_spi_and_i2c(void) {
    reset_dev_state();
    feed_line_and_poll("SPI:XFER:75FF");
    feed_line_and_poll("I2C:SCAN");
    TEST_ASSERT(rec_spi_cmd.calls == 1);
    TEST_ASSERT(strcmp(rec_spi_cmd.command, "XFER") == 0);
    TEST_ASSERT(rec_i2c_cmd.calls == 1);
    TEST_ASSERT(strcmp(rec_i2c_cmd.command, "SCAN") == 0);
}

/* Hex payload args must not be case-normalized... they are: the whole line
 * tokens 0 and 1 are uppercased, args are left as received. */
static void test_dispatch_preserves_arg_case(void) {
    reset_dev_state();
    feed_line_and_poll("canfd:send:130:deadbeef");
    TEST_ASSERT(rec_can_cmd.calls == 1);
    TEST_ASSERT(strcmp(rec_can_cmd.command, "SEND") == 0);
    /* args are NOT uppercased by the dispatcher */
    TEST_ASSERT(strcmp(rec_can_cmd.argv1, "deadbeef") == 0);
}

/* =========================================================================
 * Legacy mode contract
 * ========================================================================= */

static void test_legacy_enter_and_reset_exit(void) {
    reset_dev_state();

    feed_line_and_poll("SYS:MODE:LEGACY");
    TEST_ASSERT(capture_contains("SYS:INFO:mode=legacy"));
    TEST_ASSERT(g_mode == DEV_MODE_LEGACY_MENU);
    TEST_ASSERT(capture_contains("Comm Test Menu"));

    /* Menu selection '1' → legacy UART bridge */
    feed_bytes("1");
    Dev_Poll();
    TEST_ASSERT(g_mode == DEV_MODE_LEGACY_UART);

    /* Exact escape sequence returns to protocol mode */
    feed_bytes("SYS:RESET\r\n");
    Dev_Poll();
    TEST_ASSERT(g_mode == DEV_MODE_PROTOCOL);
    TEST_ASSERT(capture_contains("SYS:INFO:mode=protocol"));
}

/*
 * Regression for the escape-matcher rescan fix: a partial match that fails
 * midway can overlap the start of the real sequence. The matcher must
 * re-scan retained bytes instead of flushing them blindly.
 *
 * Input: "SYS:RESYS:RESET\r\n" — the real "SYS:RESET\r\n" begins inside the
 * failed partial match ("SYS:RES" + "YS:RESET\r\n").
 */
static void test_legacy_reset_matcher_overlap(void) {
    reset_dev_state();

    feed_line_and_poll("SYS:MODE:LEGACY");
    TEST_ASSERT(g_mode == DEV_MODE_LEGACY_MENU);

    feed_bytes("SYS:RESYS:RESET\r\n");
    Dev_Poll();

    TEST_ASSERT(g_mode == DEV_MODE_PROTOCOL);
    TEST_ASSERT(capture_contains("SYS:INFO:mode=protocol"));
}

/* Bytes that fail the escape match must still reach the legacy handler. */
static void test_legacy_flush_reaches_mode_handler(void) {
    reset_dev_state();

    feed_line_and_poll("SYS:MODE:LEGACY");
    feed_bytes("1");
    Dev_Poll();
    TEST_ASSERT(g_mode == DEV_MODE_LEGACY_UART);

    /* "SYX" — 'S','Y' are retained as a partial match, then 'X' flushes all
     * three into the legacy UART byte handler. */
    feed_bytes("SYX");
    Dev_Poll();
    TEST_ASSERT(rec_uart_legacy_bytes == 3);
    TEST_ASSERT(rec_uart_last_legacy_byte == 'X');
}

/* =========================================================================
 * SYS:WATCHDOG wire behavior
 * ========================================================================= */

static void test_watchdog_status_initially_disabled(void) {
    reset_dev_state();
    feed_line_and_poll("SYS:WATCHDOG:STATUS");
    TEST_ASSERT(capture_contains("SYS:INFO:watchdog=0;timeout_ms=0"));
}

static void test_watchdog_disable_rejected(void) {
    reset_dev_state();
    feed_line_and_poll("SYS:WATCHDOG:DISABLE");
    TEST_ASSERT(capture_contains("SYS:FAIL:reason=wdg-no-disable"));
}

static void test_watchdog_enable_bad_args(void) {
    reset_dev_state();

    feed_line_and_poll("SYS:WATCHDOG:ENABLE:99");       /* below minimum */
    TEST_ASSERT(capture_contains("SYS:FAIL:reason=bad-arg"));

    stub_uart_capture_reset();
    feed_line_and_poll("SYS:WATCHDOG:ENABLE:99999");    /* above maximum */
    TEST_ASSERT(capture_contains("SYS:FAIL:reason=bad-arg"));

    stub_uart_capture_reset();
    feed_line_and_poll("SYS:WATCHDOG:ENABLE:abc");      /* not decimal */
    TEST_ASSERT(capture_contains("SYS:FAIL:reason=bad-arg"));

    stub_uart_capture_reset();
    feed_line_and_poll("SYS:WATCHDOG");                  /* missing subcommand */
    TEST_ASSERT(capture_contains("SYS:FAIL:reason=bad-arg"));
}

static void test_watchdog_enable_and_status(void) {
    reset_dev_state();

    feed_line_and_poll("SYS:WATCHDOG:ENABLE:5000");
    TEST_ASSERT(capture_contains("SYS:INFO:watchdog=1;timeout_ms=5000"));

    stub_uart_capture_reset();
    feed_line_and_poll("SYS:WATCHDOG:STATUS");
    TEST_ASSERT(capture_contains("SYS:INFO:watchdog=1;timeout_ms=5000"));
}

static void test_watchdog_enable_default_timeout(void) {
    reset_dev_state();
    feed_line_and_poll("SYS:WATCHDOG:ENABLE");
    TEST_ASSERT(capture_contains("SYS:INFO:watchdog=1;timeout_ms=8000"));
}

/* =========================================================================
 * Blocking-wait CAN servicing
 * ========================================================================= */

/*
 * Regression for the drain-during-wait fix: while uart2_wait_for_byte spins
 * on its timeout, incoming CAN frames must still be drained from the 3-deep
 * hardware FIFO (otherwise a busy bus overflows it during UART:LOOP).
 */
static void test_uart2_wait_services_can_drain(void) {
    reset_dev_state();

    uint8_t out = 0;
    HAL_StatusTypeDef st = uart2_wait_for_byte(&out, 10U);

    TEST_ASSERT(st == HAL_TIMEOUT);
    TEST_ASSERT(rec_can_drain_calls > 0);
}

/* =========================================================================
 * Entry point
 * ========================================================================= */
int main(void) {
    RUN_TEST(test_sys_ping);
    RUN_TEST(test_sys_ping_rejects_args);
    RUN_TEST(test_sys_hello_reports_identity);
    RUN_TEST(test_sys_caps);
    RUN_TEST(test_sys_unknown_command);
    RUN_TEST(test_lowercase_input_uppercased);
    RUN_TEST(test_bad_frame_warns);
    RUN_TEST(test_unknown_domain_warns);
    RUN_TEST(test_overlong_line_warns);
    RUN_TEST(test_dispatch_uart_command);
    RUN_TEST(test_dispatch_canfd_command_with_args);
    RUN_TEST(test_dispatch_spi_and_i2c);
    RUN_TEST(test_dispatch_preserves_arg_case);
    RUN_TEST(test_legacy_enter_and_reset_exit);
    RUN_TEST(test_legacy_reset_matcher_overlap);
    RUN_TEST(test_legacy_flush_reaches_mode_handler);
    RUN_TEST(test_watchdog_status_initially_disabled);
    RUN_TEST(test_watchdog_disable_rejected);
    RUN_TEST(test_watchdog_enable_bad_args);
    RUN_TEST(test_watchdog_enable_and_status);
    RUN_TEST(test_watchdog_enable_default_timeout);
    RUN_TEST(test_uart2_wait_services_can_drain);

    PRINT_RESULTS();
    return tests_failed > 0 ? 1 : 0;
}
