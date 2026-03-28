// frontend/charts.js
// Manages Chart.js instances for UART, SPI, and CANFD.
// Chart.js must be loaded globally (window.Chart) before this module is used.
//
// Usage:
//   const charts = new Charts({ canvasEl, metricsEl });
//   charts.show('UART');          // switch active protocol
//   charts.push('UART', payload); // feed new data point
//   charts.hide();                // destroy chart, clear metrics

const MAX_UART_SAMPLES = 30;
const MAX_SPI_BARS     = 8;

// Distinct colors for CANFD frame ID scatter rows (up to 8 unique IDs)
const CAN_POINT_COLORS = [
  '#4a90e2', '#e2914a', '#4caf50', '#e24a90',
  '#4ae2e2', '#e2c84a', '#9c27b0', '#ef5350',
];

export class Charts {
  /**
   * @param {object} opts
   * @param {HTMLCanvasElement} opts.canvasEl   - Shared canvas element
   * @param {HTMLElement}       opts.metricsEl  - Container for metric cards
   */
  constructor({ canvasEl, metricsEl }) {
    this._canvas  = canvasEl;
    this._metrics = metricsEl;
    this._chart   = null;
    this._proto   = null;

    // Per-protocol rolling data stores — reset on clear() only
    this._uart = {
      rtts:       [],   // rolling window of RTT values (ms)
      totalBytes: 0,    // total data payload chars received
      errors:     0,    // FAIL response count
      total:      0,    // all responses count
    };
    this._spi = {
      txs:        [],   // sent byte values
      rxs:        [],   // received byte values
      matchCount: 0,    // tx === rx count
      txCount:    0,    // total transfers
    };
    this._can = {
      points:     [],   // [{ x: seconds, y: idIndex, idHex: string }]
      idMap:      {},   // '0x130' → y-axis index
      errorCount: 0,
      lastRtt:    null,
      startedAt:  Date.now(),
    };
  }

  /**
   * Switch to the given protocol's chart.
   * Destroys the previous chart instance first.
   * @param {'UART'|'SPI'|'CANFD'} proto
   */
  show(proto) {
    this._destroyChart();
    this._proto = proto;
    if (proto === 'UART')  this._buildUart();
    if (proto === 'SPI')   this._buildSpi();
    if (proto === 'CANFD') this._buildCanfd();
    this._refreshMetrics();
  }

  /** Destroy the chart and clear the metrics panel */
  hide() {
    this._destroyChart();
    this._proto = null;
    this._metrics.innerHTML = '';
  }

  /**
   * Feed a new data point from a parsed firmware response.
   * @param {'UART'|'SPI'|'CANFD'} proto
   * @param {{ status: string, data: string, rtt: number|null }} payload
   */
  push(proto, { status, data, rtt }) {
    if (proto === 'UART') {
      this._uart.total++;
      if (status === 'FAIL') this._uart.errors++;
      if (rtt != null) {
        this._uart.rtts.push(rtt);
        if (this._uart.rtts.length > MAX_UART_SAMPLES) this._uart.rtts.shift();
      }
      this._uart.totalBytes += (data || '').length;
    }

    if (proto === 'SPI') {
      this._spi.txCount++;
      const txMatch = (data || '').match(/TX=0x([0-9A-Fa-f]{1,2})/);
      const rxMatch = (data || '').match(/RX=0x([0-9A-Fa-f]{1,2})/);
      const tx = txMatch ? parseInt(txMatch[1], 16) : 0;
      const rx = rxMatch ? parseInt(rxMatch[1], 16) : 0;
      this._spi.txs.push(tx);
      this._spi.rxs.push(rx);
      if (tx === rx) this._spi.matchCount++;
      if (this._spi.txs.length > MAX_SPI_BARS) {
        this._spi.txs.shift();
        this._spi.rxs.shift();
      }
    }

    if (proto === 'CANFD') {
      if (status === 'FAIL') this._can.errorCount++;
      if (rtt != null) this._can.lastRtt = rtt;
      const idMatch = (data || '').match(/ID=0x([0-9A-Fa-f]+)/i);
      if (idMatch) {
        const hex = '0x' + idMatch[1].toUpperCase();
        if (!(hex in this._can.idMap)) {
          this._can.idMap[hex] = Object.keys(this._can.idMap).length;
        }
        const nowSec = (Date.now() - this._can.startedAt) / 1000;
        this._can.points.push({ x: nowSec, y: this._can.idMap[hex], idHex: hex });
      }
    }

    if (this._proto === proto) this._updateChart(proto);
    if (this._proto === proto) this._refreshMetrics();
  }

  // ─── Private helpers ─────────────────────────────────────

  _destroyChart() {
    if (this._chart) {
      this._chart.destroy();
      this._chart = null;
    }
  }

  _buildUart() {
    this._chart = new Chart(this._canvas, {
      type: 'line',
      data: {
        labels: this._uart.rtts.map((_, i) => i + 1),
        datasets: [{
          label: 'RTT (ms)',
          data: [...this._uart.rtts],
          borderColor: '#4a90e2',
          backgroundColor: 'rgba(74,144,226,0.08)',
          tension: 0.3,
          pointRadius: 3,
          pointHoverRadius: 5,
          fill: true,
        }],
      },
      options: {
        animation: false,
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { display: false },
          y: {
            title: { display: true, text: 'ms', font: { size: 10 } },
            beginAtZero: true,
            ticks: { font: { size: 10 } },
          },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: { label: ctx => `${ctx.raw} ms` },
          },
        },
      },
    });
  }

  _buildSpi() {
    const labels = this._spi.txs.map((_, i) => `T${i + 1}`);
    this._chart = new Chart(this._canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'TX',
            data: [...this._spi.txs],
            backgroundColor: 'rgba(74,144,226,0.75)',
            borderColor: '#4a90e2',
            borderWidth: 1,
          },
          {
            label: 'RX',
            data: [...this._spi.rxs],
            backgroundColor: 'rgba(226,145,74,0.75)',
            borderColor: '#e2914a',
            borderWidth: 1,
          },
        ],
      },
      options: {
        animation: false,
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: {
            min: 0,
            max: 255,
            ticks: {
              font: { size: 10, family: 'Consolas, monospace' },
              callback: v => `0x${v.toString(16).toUpperCase().padStart(2, '0')}`,
              stepSize: 64,
            },
          },
          x: { ticks: { font: { size: 10 } } },
        },
        plugins: {
          legend: { position: 'top', labels: { font: { size: 10 }, boxWidth: 10 } },
          tooltip: {
            callbacks: {
              label: ctx =>
                `${ctx.dataset.label}: 0x${ctx.raw.toString(16).toUpperCase().padStart(2, '0')}`,
            },
          },
        },
      },
    });
  }

  _buildCanfd() {
    const ids = Object.keys(this._can.idMap);
    const datasets = ids.map((hex, idx) => ({
      label: hex,
      data: this._can.points
        .filter(p => p.idHex === hex)
        .map(p => ({ x: p.x, y: p.y })),
      backgroundColor: CAN_POINT_COLORS[idx % CAN_POINT_COLORS.length],
      pointRadius: 5,
      pointHoverRadius: 7,
    }));

    this._chart = new Chart(this._canvas, {
      type: 'scatter',
      data: { datasets },
      options: {
        animation: false,
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            title: { display: true, text: 'time (s)', font: { size: 10 } },
            ticks: { font: { size: 10 } },
          },
          y: {
            ticks: {
              stepSize: 1,
              font: { size: 10, family: 'Consolas, monospace' },
              callback: v => ids[v] || '',
            },
            min: -0.5,
            max: Math.max(ids.length - 0.5, 0.5),
          },
        },
        plugins: {
          legend: {
            position: 'top',
            labels: { font: { size: 10 }, boxWidth: 8, usePointStyle: true },
          },
        },
      },
    });
  }

  _updateChart(proto) {
    if (!this._chart) return;

    if (proto === 'UART') {
      const labels = this._uart.rtts.map((_, i) => i + 1);
      this._chart.data.labels = labels;
      this._chart.data.datasets[0].data = [...this._uart.rtts];
      this._chart.update('none');
    }

    if (proto === 'SPI') {
      const labels = this._spi.txs.map((_, i) => `T${i + 1}`);
      this._chart.data.labels = labels;
      this._chart.data.datasets[0].data = [...this._spi.txs];
      this._chart.data.datasets[1].data = [...this._spi.rxs];
      this._chart.update('none');
    }

    if (proto === 'CANFD') {
      // Rebuild fully when new IDs appear (y-axis bounds change)
      this._destroyChart();
      this._buildCanfd();
    }
  }

  _refreshMetrics() {
    if (!this._proto) { this._metrics.innerHTML = ''; return; }

    let cards = [];

    if (this._proto === 'UART') {
      const lastRtt = this._uart.rtts.at(-1) ?? '—';
      const errRate = this._uart.total > 0
        ? ((this._uart.errors / this._uart.total) * 100).toFixed(1) + '%'
        : '0%';
      cards = [
        { label: 'Last RTT',   value: lastRtt === '—' ? '—' : `${lastRtt} ms` },
        { label: 'Bytes rcvd', value: String(this._uart.totalBytes) },
        { label: 'Error rate', value: errRate },
      ];
    }

    if (this._proto === 'SPI') {
      const matchRate = this._spi.txCount > 0
        ? ((this._spi.matchCount / this._spi.txCount) * 100).toFixed(1) + '%'
        : '0%';
      cards = [
        { label: 'Match rate', value: matchRate },
        { label: 'TX count',   value: String(this._spi.txCount) },
      ];
    }

    if (this._proto === 'CANFD') {
      const lastRtt = this._can.lastRtt != null ? `${this._can.lastRtt} ms` : '—';
      cards = [
        { label: 'IDs seen',     value: String(Object.keys(this._can.idMap).length) },
        { label: 'Error frames', value: String(this._can.errorCount) },
        { label: 'Last RTT',     value: lastRtt },
      ];
    }

    this._metrics.innerHTML = cards
      .map(c =>
        `<div class="metric-card">` +
        `<span class="metric-label">${c.label}</span>` +
        `<span class="metric-value">${c.value}</span>` +
        `</div>`
      )
      .join('');
  }
}
