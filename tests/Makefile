CC     = gcc
CFLAGS = -Wall -Wextra -Wno-unused-function -Wno-unused-variable \
         -g -Istubs -I../DevBoard/Core/Inc

TESTS = test_ring_buffer test_can_queue

.PHONY: all clean

all: $(TESTS)
	@echo ""
	@echo "--- Running test_ring_buffer ---"
	./test_ring_buffer
	@echo ""
	@echo "--- Running test_can_queue ---"
	./test_can_queue

test_ring_buffer: test_ring_buffer.c stubs/stm32u5xx_hal.h stubs/main.h test_runner.h
	$(CC) $(CFLAGS) -o $@ test_ring_buffer.c

test_can_queue: test_can_queue.c stubs/stm32u5xx_hal.h stubs/main.h test_runner.h
	$(CC) $(CFLAGS) -o $@ test_can_queue.c

clean:
	rm -f $(TESTS)
