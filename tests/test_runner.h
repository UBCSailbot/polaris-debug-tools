#ifndef TEST_RUNNER_H
#define TEST_RUNNER_H
#include <stdio.h>
static int tests_run = 0, tests_failed = 0;
#define TEST_ASSERT(cond) do { \
    tests_run++; \
    if (!(cond)) { \
        printf("  FAIL [%s:%d]: %s\n", __FILE__, __LINE__, #cond); \
        tests_failed++; \
    } \
} while(0)
#define RUN_TEST(fn) do { printf("Running " #fn "...\n"); fn(); } while(0)
#define PRINT_RESULTS() printf("\n%d/%d tests passed.\n", tests_run - tests_failed, tests_run)
#endif
