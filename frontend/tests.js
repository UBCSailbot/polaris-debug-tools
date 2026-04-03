// frontend/tests.js
// Premade protocol test catalog plus the Tests view renderer.

import { PROTOCOLS, PROTOCOL_ORDER } from './protocols.js';

export const TEST_CATALOG = {
  UART: [
    {
      id: 'uart-bring-up',
      protoId: 'UART',
      category: 'Smoke',
      title: 'Bridge Bring-Up',
      summary: 'Initialise the UART bridge and capture a clean baseline before target-board testing.',
      expected: 'The board reports ready state and UART counters/status are readable afterward.',
      steps: [
        { label: 'Init', command: 'UART:INIT', delayMs: 160 },
        { label: 'Status', command: 'UART:STATUS' },
      ],
    },
    {
      id: 'uart-loopback-check',
      protoId: 'UART',
      category: 'Path Check',
      title: 'Loopback Echo Check',
      summary: 'Exercise the end-to-end UART path with a known byte and verify the bridge can echo it cleanly.',
      expected: 'The loopback byte returns without timeout or no-echo errors, then counters still read normally.',
      steps: [
        { label: 'Init', command: 'UART:INIT', delayMs: 160 },
        { label: 'Loop 0x41', command: 'UART:LOOP:41', delayMs: 160 },
        { label: 'Status', command: 'UART:STATUS' },
      ],
    },
    {
      id: 'uart-stream-cycle',
      protoId: 'UART',
      category: 'Streaming',
      title: 'Stream Toggle Cycle',
      summary: 'Enable UART streaming, leave it active briefly, and return the interface to idle.',
      expected: 'Streaming starts and stops cleanly without leaving the bridge stuck in stream mode.',
      requiredCaps: ['UART_STREAM'],
      steps: [
        { label: 'Init', command: 'UART:INIT', delayMs: 160 },
        { label: 'Start stream', command: 'UART:STREAM:START', delayMs: 240 },
        { label: 'Stop stream', command: 'UART:STREAM:STOP', delayMs: 160 },
        { label: 'Status', command: 'UART:STATUS' },
      ],
    },
  ],
  SPI: [
    {
      id: 'spi-bring-up',
      protoId: 'SPI',
      category: 'Smoke',
      title: 'Controller Bring-Up',
      summary: 'Initialise the SPI master and capture a baseline status read before bus-level debugging.',
      expected: 'The SPI controller becomes ready and transfer counters can be read immediately.',
      steps: [
        { label: 'Init', command: 'SPI:INIT', delayMs: 160 },
        { label: 'Status', command: 'SPI:STATUS' },
      ],
    },
    {
      id: 'spi-whoami-smoke',
      protoId: 'SPI',
      category: 'Device Probe',
      title: 'WHO_AM_I Smoke Test',
      summary: 'Run the common two-byte WHO_AM_I transaction used during basic device bring-up.',
      expected: 'The transfer completes and returns a stable response path for quick peripheral verification.',
      steps: [
        { label: 'Init', command: 'SPI:INIT', delayMs: 160 },
        { label: 'WHO_AM_I', command: 'SPI:XFER:75FF', delayMs: 160 },
        { label: 'Status', command: 'SPI:STATUS' },
      ],
    },
    {
      id: 'spi-burst-sample',
      protoId: 'SPI',
      category: 'Traffic',
      title: 'Burst Transfer Sample',
      summary: 'Send a short patterned burst to catch basic wiring, byte-order, and shift issues.',
      expected: 'The transaction completes without transfer timeout or transfer-failed responses.',
      steps: [
        { label: 'Init', command: 'SPI:INIT', delayMs: 160 },
        { label: 'Burst', command: 'SPI:XFER:A55A00FF', delayMs: 160 },
        { label: 'Status', command: 'SPI:STATUS' },
      ],
    },
  ],
  CANFD: [
    {
      id: 'canfd-bring-up',
      protoId: 'CANFD',
      category: 'Smoke',
      title: 'Controller Bring-Up',
      summary: 'Initialise CANFD and capture the controller state before injecting or monitoring live traffic.',
      expected: 'The controller reports ready and status reads do not immediately show bus-off or major error states.',
      steps: [
        { label: 'Init', command: 'CANFD:INIT', delayMs: 180 },
        { label: 'Status', command: 'CANFD:STATUS' },
      ],
    },
    {
      id: 'canfd-tx-smoke',
      protoId: 'CANFD',
      category: 'Injection',
      title: 'Single-Frame TX Smoke',
      summary: 'Inject one known CANFD frame to validate transmit wiring and basic target-node response behavior.',
      expected: 'The frame is accepted for transmit and controller status remains healthy afterward.',
      steps: [
        { label: 'Init', command: 'CANFD:INIT', delayMs: 180 },
        { label: 'Send 0x130', command: 'CANFD:SEND:130:11223344', delayMs: 180 },
        { label: 'Status', command: 'CANFD:STATUS' },
      ],
    },
    {
      id: 'canfd-monitor-cycle',
      protoId: 'CANFD',
      category: 'Monitoring',
      title: 'Monitor Arm / Disarm',
      summary: 'Enable passive monitoring briefly, then return the controller to a quiet state.',
      expected: 'Monitoring starts and stops cleanly without leaving the board stuck in monitor mode.',
      requiredCaps: ['CANFD_MONITOR'],
      steps: [
        { label: 'Init', command: 'CANFD:INIT', delayMs: 180 },
        { label: 'Monitor start', command: 'CANFD:MONITOR:START', delayMs: 260 },
        { label: 'Monitor stop', command: 'CANFD:MONITOR:STOP', delayMs: 160 },
        { label: 'Status', command: 'CANFD:STATUS' },
      ],
    },
    {
      id: 'canfd-multi-id-injector',
      protoId: 'CANFD',
      category: 'Traffic',
      title: 'Multi-ID Injector',
      summary: 'Push several distinct frame IDs in sequence to exercise subscribers, filters, and bus observers.',
      expected: 'Each frame transmits cleanly and downstream nodes can be checked against a controlled mixed-ID burst.',
      steps: [
        { label: 'Init', command: 'CANFD:INIT', delayMs: 180 },
        { label: 'Send 0x130', command: 'CANFD:SEND:130:DEADBEEF', delayMs: 180 },
        { label: 'Send 0x131', command: 'CANFD:SEND:131:01020304', delayMs: 180 },
        { label: 'Send 0x132', command: 'CANFD:SEND:132:AA55', delayMs: 180 },
        { label: 'Status', command: 'CANFD:STATUS' },
      ],
    },
  ],
  I2C: [
    {
      id: 'i2c-bring-up',
      protoId: 'I2C',
      category: 'Smoke',
      title: 'Controller Bring-Up',
      summary: 'Initialise the I2C bridge and capture a baseline status read before device-specific debugging.',
      expected: 'The controller becomes ready and a baseline status frame can be collected cleanly.',
      steps: [
        { label: 'Init', command: 'I2C:INIT', delayMs: 160 },
        { label: 'Status', command: 'I2C:STATUS' },
      ],
    },
    {
      id: 'i2c-bus-scan',
      protoId: 'I2C',
      category: 'Discovery',
      title: 'Bus Scan',
      summary: 'Probe the bus for responding 7-bit devices to confirm pull-ups, wiring, and address presence.',
      expected: 'The scan completes and any responding device addresses are reported without bus-level faults.',
      requiredCaps: ['I2C_SCAN'],
      steps: [
        { label: 'Init', command: 'I2C:INIT', delayMs: 160 },
        { label: 'Scan', command: 'I2C:SCAN', delayMs: 200 },
        { label: 'Status', command: 'I2C:STATUS' },
      ],
    },
    {
      id: 'i2c-repeat-scan',
      protoId: 'I2C',
      category: 'Stability',
      title: 'Repeat Scan Stability',
      summary: 'Run the scan twice in one sequence to catch intermittent wiring or marginal pull-up issues.',
      expected: 'Back-to-back scans produce stable behavior and the controller remains healthy afterward.',
      requiredCaps: ['I2C_SCAN'],
      steps: [
        { label: 'Init', command: 'I2C:INIT', delayMs: 160 },
        { label: 'Scan 1', command: 'I2C:SCAN', delayMs: 200 },
        { label: 'Scan 2', command: 'I2C:SCAN', delayMs: 200 },
        { label: 'Status', command: 'I2C:STATUS' },
      ],
    },
  ],
};

function createDefaultRunState() {
  return {
    tone: 'idle',
    label: 'Ready',
    detail: 'Not run yet.',
    lastRunAt: null,
  };
}

export class TestsView {
  constructor({
    tabsEl,
    cardsEl,
    summaryProtoEl,
    summaryCountEl,
    summaryLastRunEl,
    summaryHintEl,
    runAllBtnEl,
    onRunTest,
    onRunAll,
  }) {
    this._tabs = tabsEl;
    this._cards = cardsEl;
    this._summaryProtoEl = summaryProtoEl;
    this._summaryCountEl = summaryCountEl;
    this._summaryLastRunEl = summaryLastRunEl;
    this._summaryHintEl = summaryHintEl;
    this._runAllBtn = runAllBtnEl;
    this._onRunTest = onRunTest;
    this._onRunAll = onRunAll;
    this._connected = false;
    this._caps = null;
    this._activeProto = PROTOCOL_ORDER[0];
    this._runStates = new Map();
    this._activeRunId = null;
    this._lastRun = null;

    this._buildTabs();
    this._runAllBtn.addEventListener('click', () => {
      if (this._activeProto) {
        this._onRunAll(this._activeProto);
      }
    });
    this.show(this._activeProto);
  }

  show(protoId) {
    const fallbackProto = this._firstSupportedProtocol() || PROTOCOL_ORDER[0];
    const nextProto = this._protocolExists(protoId) ? protoId : fallbackProto;

    this._activeProto = nextProto;
    this._updateTabActive();
    this._renderCards();
    this._renderSummary();
  }

  setConnected(connected) {
    this._connected = connected;
    this._buildTabs();
    this._renderCards();
    this._renderSummary();
  }

  setCapabilities(caps = null) {
    this._caps = Array.isArray(caps) ? new Set(caps) : null;
    this._buildTabs();
    if (!this._isProtocolEnabled(this._activeProto)) {
      this._activeProto = this._firstSupportedProtocol() || PROTOCOL_ORDER[0];
    }
    this._updateTabActive();
    this._renderCards();
    this._renderSummary();
  }

  setRunState(testId, state) {
    const previous = this._runStates.get(testId) || createDefaultRunState();
    const nextState = { ...previous, ...state };
    this._runStates.set(testId, nextState);

    if (nextState.lastRunAt) {
      const test = this.getTestById(testId);
      this._lastRun = {
        testId,
        title: test?.title || 'Test',
        lastRunAt: nextState.lastRunAt,
        label: nextState.label,
      };
    }

    this._renderCards();
    this._renderSummary();
  }

  setActiveRun(testId) {
    this._activeRunId = testId || null;
    this._renderCards();
    this._renderSummary();
  }

  getActiveTests(protoId = this._activeProto) {
    return [...(TEST_CATALOG[protoId] || [])];
  }

  getTestById(testId) {
    return PROTOCOL_ORDER
      .flatMap(protoId => TEST_CATALOG[protoId] || [])
      .find(test => test.id === testId) || null;
  }

  _buildTabs() {
    this._tabs.innerHTML = '';
    for (const protoId of PROTOCOL_ORDER) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tests-proto-btn';
      btn.textContent = PROTOCOLS[protoId].label;
      btn.dataset.proto = protoId;
      btn.disabled = !this._connected || !this._isProtocolEnabled(protoId);
      btn.title = this._isProtocolEnabled(protoId) ? '' : this._protocolDisabledReason(protoId);
      btn.addEventListener('click', () => this.show(protoId));
      this._tabs.appendChild(btn);
    }
    this._updateTabActive();
  }

  _updateTabActive() {
    this._tabs.querySelectorAll('.tests-proto-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.proto === this._activeProto);
    });
  }

  _renderCards() {
    const tests = this.getActiveTests();

    this._cards.innerHTML = '';

    if (!tests.length) {
      this._cards.innerHTML = '<div class="tests-empty">No premade tests are registered for this protocol yet.</div>';
      return;
    }

    tests.forEach(test => {
      const runState = this._runStates.get(test.id) || createDefaultRunState();
      const enabled = this._connected && this._isTestEnabled(test);
      const busy = !!this._activeRunId;
      const card = document.createElement('article');
      const header = document.createElement('div');
      const category = document.createElement('span');
      const title = document.createElement('h3');
      const status = document.createElement('span');
      const summary = document.createElement('p');
      const sequence = document.createElement('div');
      const sequenceLabel = document.createElement('span');
      const steps = document.createElement('div');
      const expected = document.createElement('div');
      const expectedLabel = document.createElement('span');
      const expectedCopy = document.createElement('p');
      const footer = document.createElement('div');
      const detail = document.createElement('span');
      const button = document.createElement('button');

      card.className = 'test-card';
      header.className = 'test-card-header';
      category.className = 'test-card-category';
      title.className = 'test-card-title';
      status.className = `test-card-status ${runState.tone || 'idle'}`;
      summary.className = 'test-card-summary';
      sequence.className = 'test-card-section';
      sequenceLabel.className = 'test-card-section-label';
      steps.className = 'test-step-list';
      expected.className = 'test-card-section';
      expectedLabel.className = 'test-card-section-label';
      expectedCopy.className = 'test-card-expected';
      footer.className = 'test-card-footer';
      detail.className = 'test-card-detail';
      button.className = 'test-run-btn';
      button.type = 'button';

      category.textContent = test.category;
      title.textContent = test.title;
      status.textContent = runState.label;
      summary.textContent = test.summary;
      sequenceLabel.textContent = 'Sequence';
      expectedLabel.textContent = 'Expected';
      expectedCopy.textContent = test.expected;
      detail.textContent = enabled ? runState.detail : this._testDisabledReason(test);
      button.textContent = this._activeRunId === test.id ? 'Running...' : 'Run Test';
      button.disabled = !enabled || busy;
      button.addEventListener('click', () => this._onRunTest(test));

      test.steps.forEach(step => {
        const chip = document.createElement('span');
        chip.className = 'test-step-chip';
        chip.textContent = step.label;
        steps.appendChild(chip);
      });

      header.appendChild(category);
      header.appendChild(status);
      card.appendChild(header);
      card.appendChild(title);
      card.appendChild(summary);
      sequence.appendChild(sequenceLabel);
      sequence.appendChild(steps);
      expected.appendChild(expectedLabel);
      expected.appendChild(expectedCopy);
      footer.appendChild(detail);
      footer.appendChild(button);
      card.appendChild(sequence);
      card.appendChild(expected);
      card.appendChild(footer);

      this._cards.appendChild(card);
    });
  }

  _renderSummary() {
    const tests = this.getActiveTests();
    const runnableCount = tests.filter(test => this._isTestEnabled(test)).length;
    const statusText = this._connected ? 'Connected' : 'Disconnected';
    const activeProtoLabel = PROTOCOLS[this._activeProto]?.label || '-';
    const lastRunText = this._lastRun
      ? `${this._lastRun.title} at ${this._formatRunTime(this._lastRun.lastRunAt)}`
      : 'No test sequence has been run yet.';

    this._summaryProtoEl.textContent = `${activeProtoLabel} | ${statusText}`;
    this._summaryCountEl.textContent = `${runnableCount} of ${tests.length} ready`;
    this._summaryLastRunEl.textContent = lastRunText;

    if (!this._connected) {
      this._summaryHintEl.textContent = 'Connect to a board first, then use these sequences to drive known-good protocol checks.';
    } else if (!this._isProtocolEnabled(this._activeProto)) {
      this._summaryHintEl.textContent = this._protocolDisabledReason(this._activeProto);
    } else if (this._activeRunId) {
      const active = this.getTestById(this._activeRunId);
      this._summaryHintEl.textContent = active ? `Running ${active.title}. Commands are being sent in sequence.` : 'A premade test is currently running.';
    } else {
      this._summaryHintEl.textContent = 'Each card queues a safe, known-good command sequence into the dev firmware so operators can focus on the target hardware behavior.';
    }

    this._runAllBtn.disabled = !this._connected || !runnableCount || !!this._activeRunId;
  }

  _protocolExists(protoId) {
    return !!PROTOCOLS[protoId];
  }

  _firstSupportedProtocol() {
    return PROTOCOL_ORDER.find(protoId => this._isProtocolEnabled(protoId)) || null;
  }

  _isProtocolEnabled(protoId) {
    const proto = PROTOCOLS[protoId];

    if (!proto || this._caps === null) {
      return false;
    }

    return this._caps.has(proto.domainCap);
  }

  _isTestEnabled(test) {
    if (!this._isProtocolEnabled(test.protoId)) {
      return false;
    }
    if (!Array.isArray(test.requiredCaps) || !test.requiredCaps.length) {
      return true;
    }
    return test.requiredCaps.every(cap => this._caps?.has(cap));
  }

  _protocolDisabledReason(protoId) {
    if (!this._connected) {
      return 'Connect to the board first.';
    }
    if (this._caps === null) {
      return 'Waiting for board profile handshake.';
    }
    return 'This protocol is not supported by the connected firmware.';
  }

  _testDisabledReason(test) {
    if (!this._connected) {
      return 'Connect to the board before running premade tests.';
    }
    if (!this._isProtocolEnabled(test.protoId)) {
      return this._protocolDisabledReason(test.protoId);
    }
    if (Array.isArray(test.requiredCaps) && test.requiredCaps.length) {
      return 'This sequence needs firmware capabilities that are not available on the connected board.';
    }
    return 'This sequence is not available right now.';
  }

  _formatRunTime(value) {
    try {
      return new Date(value).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    } catch {
      return '-';
    }
  }
}
