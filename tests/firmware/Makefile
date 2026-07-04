CC     = gcc
CFLAGS = -Wall -Wextra -Wno-unused-function -Wno-unused-variable \
         -g -Istubs -I../../DevBoard/Core/Inc

TESTS = test_ring_buffer test_can_queue test_line_parsing test_dispatch test_watchdog

.PHONY: all clean

all: $(TESTS)
	@fail=0; \
	for t in $(TESTS); do \
	  echo ""; \
	  echo "--- Running $$t ---"; \
	  ./$$t || fail=1; \
	done; \
	exit $$fail

test_ring_buffer: test_ring_buffer.c stubs/stm32u5xx_hal.h stubs/main.h test_runner.h
	$(CC) $(CFLAGS) -o $@ test_ring_buffer.c

test_can_queue: test_can_queue.c stubs/stm32u5xx_hal.h stubs/main.h test_runner.h
	$(CC) $(CFLAGS) -o $@ test_can_queue.c

test_line_parsing: test_line_parsing.c stubs/stm32u5xx_hal.h stubs/main.h test_runner.h
	$(CC) $(CFLAGS) -o $@ test_line_parsing.c

test_dispatch: test_dispatch.c stubs/stm32u5xx_hal.h stubs/main.h test_runner.h
	$(CC) $(CFLAGS) -o $@ test_dispatch.c

test_watchdog: test_watchdog.c stubs/stm32u5xx_hal.h stubs/main.h test_runner.h
	$(CC) $(CFLAGS) -o $@ test_watchdog.c

clean:
	rm -f $(TESTS) *.exe
