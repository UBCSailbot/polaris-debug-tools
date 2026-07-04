/*
 * test_watchdog.c
 *
 * Framework: raw C harness (test_runner.h) with dev_test_support.h wiring.
 *
 * Covers the SYS:WATCHDOG implementation at the register level using the
 * host-backed IWDG stub:
 *   - reload computation (LSI 32 kHz / prescaler 256 → 8 ms per tick)
 *   - enable sequence writes (PR, RLR, final refresh key)
 *   - feed behavior (refresh key only while enabled)
 *   - Dev_Poll feeding the watchdog once enabled
 *   - re-enable updating the timeout
 */

#include "test_runner.h"
#include "dev_test_support.h"

#define WDG_KR_REFRESH_KEY 0x0000AAAAU
#define WDG_PR_DIV256_VAL  0x00000006U

static void reset_watchdog_state(void) {
    reset_dev_state();
    g_wdg_state.enabled = 0U;
    g_wdg_state.timeout_ms = 0U;
    memset((void *)&_stub_IWDG, 0, sizeof(_stub_IWDG));
}

/* Catches: wrong ms→reload conversion (125 Hz tick = 8 ms per count) */
static void test_reload_computation(void) {
    TEST_ASSERT(wdg_reload_from_ms(1000U) == 125U);
    TEST_ASSERT(wdg_reload_from_ms(5000U) == 625U);
    TEST_ASSERT(wdg_reload_from_ms(8000U) == 1000U);
    TEST_ASSERT(wdg_reload_from_ms(32000U) == 4000U);   /* max fits RLR (4095) */
}

/* Catches: enable not programming prescaler/reload or not refreshing */
static void test_enable_programs_registers(void) {
    reset_watchdog_state();

    TEST_ASSERT(Dev_WDG_Enable(5000U));

    TEST_ASSERT(IWDG->PR == WDG_PR_DIV256_VAL);
    TEST_ASSERT(IWDG->RLR == 625U);
    /* Last key written must be the refresh, so the counter starts full */
    TEST_ASSERT(IWDG->KR == WDG_KR_REFRESH_KEY);

    TEST_ASSERT(g_wdg_state.enabled == 1U);
    TEST_ASSERT(g_wdg_state.timeout_ms == 5000U);
}

/* Catches: feed writing the refresh key while the watchdog is disabled */
static void test_feed_noop_when_disabled(void) {
    reset_watchdog_state();

    IWDG->KR = 0U;
    Dev_WDG_Feed();
    TEST_ASSERT(IWDG->KR == 0U);
}

/* Catches: feed not refreshing while enabled */
static void test_feed_refreshes_when_enabled(void) {
    reset_watchdog_state();

    TEST_ASSERT(Dev_WDG_Enable(2000U));
    IWDG->KR = 0U;

    Dev_WDG_Feed();
    TEST_ASSERT(IWDG->KR == WDG_KR_REFRESH_KEY);
}

/* Catches: Dev_Poll not feeding the watchdog — the whole point of the
 * feature is that a wedged poll loop stops feeding and the board resets. */
static void test_dev_poll_feeds_watchdog(void) {
    reset_watchdog_state();

    TEST_ASSERT(Dev_WDG_Enable(2000U));
    IWDG->KR = 0U;

    Dev_Poll();
    TEST_ASSERT(IWDG->KR == WDG_KR_REFRESH_KEY);
}

/* Catches: re-enable not updating the reload for the new timeout */
static void test_reenable_updates_timeout(void) {
    reset_watchdog_state();

    TEST_ASSERT(Dev_WDG_Enable(2000U));
    TEST_ASSERT(IWDG->RLR == 250U);

    TEST_ASSERT(Dev_WDG_Enable(16000U));
    TEST_ASSERT(IWDG->RLR == 2000U);
    TEST_ASSERT(g_wdg_state.timeout_ms == 16000U);
}

int main(void) {
    RUN_TEST(test_reload_computation);
    RUN_TEST(test_enable_programs_registers);
    RUN_TEST(test_feed_noop_when_disabled);
    RUN_TEST(test_feed_refreshes_when_enabled);
    RUN_TEST(test_dev_poll_feeds_watchdog);
    RUN_TEST(test_reenable_updates_timeout);

    PRINT_RESULTS();
    return tests_failed > 0 ? 1 : 0;
}
