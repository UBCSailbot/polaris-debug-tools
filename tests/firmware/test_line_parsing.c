/*
 * test_line_parsing.c
 *
 * Framework: raw C harness (test_runner.h) with dev_test_support.h wiring.
 *
 * Covers the pure parsing/encoding helpers in dev.c:
 *   - line_acc_consume: accumulation, CR/LF termination, empty lines,
 *     overflow recovery, non-printable filtering
 *   - parse_hex_byte / parse_hex_u32 / parse_dec_u32 / parse_hex_buffer
 *   - bytes_to_hex round-trips
 */

#include "test_runner.h"
#include "dev_test_support.h"

/* =========================================================================
 * Line accumulator
 * ========================================================================= */

/* Catches: complete line not returned, terminator included, or state not reset */
static void test_line_acc_basic_line(void) {
    LineAccumulator_t acc;
    char out[MAX_LINE_CHARS + 1];
    line_acc_reset(&acc);

    const char *input = "SYS:PING";
    int result = 0;
    for (const char *p = input; *p; p++) {
        result = line_acc_consume(&acc, (uint8_t)*p, out);
        TEST_ASSERT(result == 0);
    }

    result = line_acc_consume(&acc, '\r', out);
    TEST_ASSERT(result == 1);
    TEST_ASSERT(strcmp(out, "SYS:PING") == 0);

    /* The trailing \n of CRLF arrives next and must read as an empty line */
    result = line_acc_consume(&acc, '\n', out);
    TEST_ASSERT(result == 0);
}

/* Catches: LF-only termination not working */
static void test_line_acc_lf_terminates(void) {
    LineAccumulator_t acc;
    char out[MAX_LINE_CHARS + 1];
    line_acc_reset(&acc);

    line_acc_consume(&acc, 'A', out);
    int result = line_acc_consume(&acc, '\n', out);
    TEST_ASSERT(result == 1);
    TEST_ASSERT(strcmp(out, "A") == 0);
}

/* Catches: empty line reported as a real line instead of being ignored */
static void test_line_acc_empty_line_ignored(void) {
    LineAccumulator_t acc;
    char out[MAX_LINE_CHARS + 1];
    line_acc_reset(&acc);

    TEST_ASSERT(line_acc_consume(&acc, '\r', out) == 0);
    TEST_ASSERT(line_acc_consume(&acc, '\n', out) == 0);
}

/* Catches: non-printable bytes leaking into the accumulated line */
static void test_line_acc_drops_nonprintable(void) {
    LineAccumulator_t acc;
    char out[MAX_LINE_CHARS + 1];
    line_acc_reset(&acc);

    line_acc_consume(&acc, 'A', out);
    line_acc_consume(&acc, 0x01, out);   /* control byte — dropped */
    line_acc_consume(&acc, 0x80, out);   /* high-bit byte — dropped */
    line_acc_consume(&acc, 'B', out);
    int result = line_acc_consume(&acc, '\r', out);

    TEST_ASSERT(result == 1);
    TEST_ASSERT(strcmp(out, "AB") == 0);
}

/*
 * Catches: overflow not flagged (-2) or accumulator not recovering to a
 * clean state for the next line.
 */
static void test_line_acc_overflow_recovery(void) {
    LineAccumulator_t acc;
    char out[MAX_LINE_CHARS + 1];
    line_acc_reset(&acc);

    for (uint32_t i = 0; i < MAX_LINE_CHARS + 10U; i++) {
        TEST_ASSERT(line_acc_consume(&acc, 'X', out) == 0);
    }

    /* Terminator after overflow → -2 (line-too-long) */
    TEST_ASSERT(line_acc_consume(&acc, '\r', out) == -2);

    /* Next line must accumulate cleanly */
    line_acc_consume(&acc, 'O', out);
    line_acc_consume(&acc, 'K', out);
    TEST_ASSERT(line_acc_consume(&acc, '\n', out) == 1);
    TEST_ASSERT(strcmp(out, "OK") == 0);
}

/* Catches: a line of exactly MAX_LINE_CHARS being rejected as overflow */
static void test_line_acc_max_length_accepted(void) {
    LineAccumulator_t acc;
    char out[MAX_LINE_CHARS + 1];
    line_acc_reset(&acc);

    for (uint32_t i = 0; i < MAX_LINE_CHARS; i++) {
        TEST_ASSERT(line_acc_consume(&acc, 'M', out) == 0);
    }
    TEST_ASSERT(line_acc_consume(&acc, '\r', out) == 1);
    TEST_ASSERT(strlen(out) == MAX_LINE_CHARS);
}

/* =========================================================================
 * Hex / decimal parsers
 * ========================================================================= */

static void test_parse_hex_byte(void) {
    uint8_t out = 0;

    TEST_ASSERT(parse_hex_byte("41", &out) && out == 0x41);
    TEST_ASSERT(parse_hex_byte("FF", &out) && out == 0xFF);
    TEST_ASSERT(parse_hex_byte("00", &out) && out == 0x00);

    TEST_ASSERT(!parse_hex_byte("4", &out));      /* too short */
    TEST_ASSERT(!parse_hex_byte("444", &out));    /* too long */
    TEST_ASSERT(!parse_hex_byte("4G", &out));     /* bad digit */
    TEST_ASSERT(!parse_hex_byte("ff", &out));     /* lowercase rejected (spec: uppercase hex) */
    TEST_ASSERT(!parse_hex_byte(NULL, &out));
}

static void test_parse_hex_u32(void) {
    uint32_t out = 0;

    TEST_ASSERT(parse_hex_u32("0", &out) && out == 0U);
    TEST_ASSERT(parse_hex_u32("130", &out) && out == 0x130U);
    TEST_ASSERT(parse_hex_u32("7FF", &out) && out == 0x7FFU);
    TEST_ASSERT(parse_hex_u32("FFFFFFFF", &out) && out == 0xFFFFFFFFU);

    TEST_ASSERT(!parse_hex_u32("", &out));
    TEST_ASSERT(!parse_hex_u32("123456789", &out));  /* > 8 digits */
    TEST_ASSERT(!parse_hex_u32("12G4", &out));
    TEST_ASSERT(!parse_hex_u32(NULL, &out));
}

static void test_parse_dec_u32(void) {
    uint32_t out = 0;

    TEST_ASSERT(parse_dec_u32("0", &out) && out == 0U);
    TEST_ASSERT(parse_dec_u32("8000", &out) && out == 8000U);
    TEST_ASSERT(parse_dec_u32("32000", &out) && out == 32000U);

    TEST_ASSERT(!parse_dec_u32("", &out));
    TEST_ASSERT(!parse_dec_u32("12a", &out));
    TEST_ASSERT(!parse_dec_u32("-5", &out));
    TEST_ASSERT(!parse_dec_u32(NULL, &out));
}

static void test_parse_hex_buffer(void) {
    uint8_t buf[8];
    uint16_t len = 0;

    TEST_ASSERT(parse_hex_buffer("DEADBEEF", buf, &len, sizeof(buf)));
    TEST_ASSERT(len == 4);
    TEST_ASSERT(buf[0] == 0xDE && buf[1] == 0xAD && buf[2] == 0xBE && buf[3] == 0xEF);

    /* Empty string is a valid zero-length buffer */
    TEST_ASSERT(parse_hex_buffer("", buf, &len, sizeof(buf)));
    TEST_ASSERT(len == 0);

    TEST_ASSERT(!parse_hex_buffer("ABC", buf, &len, sizeof(buf)));        /* odd length */
    TEST_ASSERT(!parse_hex_buffer("GG", buf, &len, sizeof(buf)));         /* bad digits */
    TEST_ASSERT(!parse_hex_buffer("001122334455667788", buf, &len, 8));   /* 9 bytes > max 8 */
    TEST_ASSERT(!parse_hex_buffer(NULL, buf, &len, sizeof(buf)));
}

static void test_bytes_to_hex_roundtrip(void) {
    const uint8_t src[] = { 0x00, 0x7F, 0xA5, 0xFF };
    char hex[sizeof(src) * 2 + 1];

    TEST_ASSERT(bytes_to_hex(src, sizeof(src), hex, sizeof(hex)));
    TEST_ASSERT(strcmp(hex, "007FA5FF") == 0);

    /* Destination too small must be rejected, not overflowed */
    char tiny[4];
    TEST_ASSERT(!bytes_to_hex(src, sizeof(src), tiny, sizeof(tiny)));

    /* Round-trip through parse_hex_buffer */
    uint8_t back[4];
    uint16_t len = 0;
    TEST_ASSERT(parse_hex_buffer(hex, back, &len, sizeof(back)));
    TEST_ASSERT(len == 4);
    TEST_ASSERT(memcmp(back, src, 4) == 0);
}

/* =========================================================================
 * Entry point
 * ========================================================================= */
int main(void) {
    RUN_TEST(test_line_acc_basic_line);
    RUN_TEST(test_line_acc_lf_terminates);
    RUN_TEST(test_line_acc_empty_line_ignored);
    RUN_TEST(test_line_acc_drops_nonprintable);
    RUN_TEST(test_line_acc_overflow_recovery);
    RUN_TEST(test_line_acc_max_length_accepted);
    RUN_TEST(test_parse_hex_byte);
    RUN_TEST(test_parse_hex_u32);
    RUN_TEST(test_parse_dec_u32);
    RUN_TEST(test_parse_hex_buffer);
    RUN_TEST(test_bytes_to_hex_roundtrip);

    PRINT_RESULTS();
    return tests_failed > 0 ? 1 : 0;
}
