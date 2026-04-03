// frontend/charts.js
// Manages Chart.js instances for UART, SPI, I2C, and CANFD visualizations.
// Chart.js must be loaded globally (window.Chart) before this module is used.

import { parseCanFrame } from './protocols.js';

const MAX_UART_SAMPLES = 30;
const MAX_SPI_BARS = 8;
const MAX_I2C_BARS = 8;
const MAX_CANFD_POINTS = 40;

const CAN_POINT_COLORS = [
  '#4a90e2', '#e2914a', '#4caf50', '#e24a90',
  '#4ae2e2', '#e2c84a', '#9c27b0', '#ef5350',
];

export function getCanfdFrameMeta(data) {
  const frame = parseCanFrame(data);

  if (frame.id == null) {
    return null;
  }

  return {
    key: `0x${frame.id.toString(16).toUpperCase()}`,
    id: frame.id,
    dlc: frame.dlc,
  };
}

export function getCanfdGridSlotCount(frameCount) {
  if (frameCount <= 0) {
    return 0;
  }
  if (frameCount === 1) {
    return 1;
  }
  if (frameCount <= 4) {
    return 4;
  }
  return frameCount;
}

function rgba(hex, alpha) {
  const normalized = String(hex || '').replace('#', '');
  const value = normalized.length === 3
    ? normalized.split('').map(char => char + char).join('')
    : normalized;

  if (!/^[0-9A-Fa-f]{6}$/.test(value)) {
    return `rgba(74, 144, 226, ${alpha})`;
  }

  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export class Charts {
  /**
   * @param {object} opts
   * @param {HTMLCanvasElement} opts.canvasEl
   * @param {HTMLElement} opts.metricsEl
   */
  constructor({ canvasEl, metricsEl }) {
    this._canvas = canvasEl;
    this._wrapper = canvasEl.parentElement;
    this._metrics = metricsEl;
    this._chart = null;
    this._proto = null;
    this._canfdCharts = new Map();
    this._canfdGrid = document.createElement('div');
    this._canfdGrid.className = 'canfd-grid';
    this._canfdGrid.hidden = true;
    this._wrapper.appendChild(this._canfdGrid);

    this._uart = {
      rtts: [],
      totalBytes: 0,
      errors: 0,
      total: 0,
    };

    this._spi = {
      txs: [],
      rxs: [],
      matchCount: 0,
      txCount: 0,
    };

    this._can = {
      frames: {},
      order: [],
      errorCount: 0,
      lastRtt: null,
      startedAt: Date.now(),
    };

    this._i2c = {
      txs: [],
      rxs: [],
      ackCount: 0,
      txCount: 0,
    };
  }

  show(proto) {
    this._destroyChart();
    this._proto = proto;
    this._setCanfdMode(proto === 'CANFD');

    if (proto === 'UART') this._buildUart();
    if (proto === 'SPI') this._buildSpi();
    if (proto === 'CANFD') this._buildCanfd();
    if (proto === 'I2C') this._buildI2c();

    this._refreshMetrics();
  }

  hide() {
    this._destroyChart();
    this._proto = null;
    this._metrics.innerHTML = '';
    this._setCanfdMode(false);
  }

  push(proto, { status, data, rtt }) {
    if (proto === 'UART') {
      const rxMatch = (data || '').match(/(?:^|;)rx=([0-9A-Fa-f]+)(?:;|$)/i);
      const bytePayload = status === 'DATA'
        ? (data || '').replace(/[^0-9A-F]/gi, '')
        : (rxMatch ? rxMatch[1] : '');

      this._uart.total++;
      if (status === 'FAIL') {
        this._uart.errors++;
      }
      if (rtt != null) {
        this._uart.rtts.push(rtt);
        if (this._uart.rtts.length > MAX_UART_SAMPLES) {
          this._uart.rtts.shift();
        }
      }
      this._uart.totalBytes += bytePayload.length / 2;
    }

    if (proto === 'SPI') {
      this._spi.txCount++;
      const txMatch = (data || '').match(/(?:^|;)tx=([0-9A-Fa-f]+)/i);
      const rxMatch = (data || '').match(/(?:^|;)rx=([0-9A-Fa-f]+)/i);
      const txHex = txMatch ? txMatch[1] : '';
      const rxHex = rxMatch ? rxMatch[1] : '';
      const tx = txHex.length >= 2 ? parseInt(txHex.slice(-2), 16) : 0;
      const rx = rxHex.length >= 2 ? parseInt(rxHex.slice(-2), 16) : 0;
      this._spi.txs.push(tx);
      this._spi.rxs.push(rx);
      if (tx === rx) {
        this._spi.matchCount++;
      }
      if (this._spi.txs.length > MAX_SPI_BARS) {
        this._spi.txs.shift();
        this._spi.rxs.shift();
      }
    }

    if (proto === 'CANFD') {
      const frameMeta = getCanfdFrameMeta(data);
      let isNewFrame = false;

      if (status === 'FAIL') {
        this._can.errorCount++;
      }
      if (rtt != null) {
        this._can.lastRtt = rtt;
      }

      if (frameMeta) {
        const nowSec = (Date.now() - this._can.startedAt) / 1000;
        let frame = this._can.frames[frameMeta.key];

        if (!frame) {
          frame = {
            key: frameMeta.key,
            count: 0,
            lastDlc: frameMeta.dlc,
            lastSeenSec: null,
            points: [],
            color: CAN_POINT_COLORS[this._can.order.length % CAN_POINT_COLORS.length],
          };
          this._can.frames[frameMeta.key] = frame;
          this._can.order.push(frameMeta.key);
          isNewFrame = true;
        }

        frame.count += 1;
        frame.lastDlc = frameMeta.dlc;
        frame.lastSeenSec = nowSec;
        frame.points.push({
          x: nowSec,
          y: frame.count,
          dlc: frameMeta.dlc,
        });

        if (frame.points.length > MAX_CANFD_POINTS) {
          frame.points.shift();
        }

        if (this._proto === 'CANFD') {
          if (isNewFrame) {
            this._buildCanfd();
          } else {
            this._updateCanfdFrameChart(frameMeta.key);
          }
        }
      } else if (this._proto === 'CANFD' && this._can.order.length === 0) {
        this._buildCanfd();
      }
    }

    if (proto === 'I2C') {
      this._i2c.txCount++;
      if (status === 'PASS') {
        this._i2c.ackCount++;
      }
      const addrMatch = (data || '').match(/(?:^|;)addr=0x([0-9A-Fa-f]{1,2})(?:;|$)/i);
      const bytesMatch = (data || '').match(/(?:^|;)bytes=([0-9A-Fa-f]+)(?:;|$)/i);
      const wroteMatch = (data || '').match(/(?:^|;)wrote=(\d+)(?:;|$)/i);
      const tx = addrMatch ? parseInt(addrMatch[1], 16) : 0;
      const rx = bytesMatch
        ? parseInt(bytesMatch[1].slice(0, 2), 16)
        : (wroteMatch ? parseInt(wroteMatch[1], 10) : 0);
      this._i2c.txs.push(tx);
      this._i2c.rxs.push(rx);
      if (this._i2c.txs.length > MAX_I2C_BARS) {
        this._i2c.txs.shift();
        this._i2c.rxs.shift();
      }
    }

    if (this._proto === proto && proto !== 'CANFD') {
      this._updateChart(proto);
    }
    if (this._proto === proto) {
      this._refreshMetrics();
    }
  }

  _setCanfdMode(active) {
    this._canvas.hidden = active;
    this._canfdGrid.hidden = !active;
    this._wrapper.classList.toggle('canfd-active', active);
    this._wrapper.classList.toggle('canfd-single', false);
    this._wrapper.classList.toggle('canfd-quad', false);
    this._wrapper.classList.toggle('canfd-many', false);
  }

  _destroyChart() {
    if (this._chart) {
      this._chart.destroy();
      this._chart = null;
    }
    this._destroyCanfdCharts();
  }

  _destroyCanfdCharts() {
    this._canfdCharts.forEach(({ chart }) => chart.destroy());
    this._canfdCharts.clear();
    this._canfdGrid.replaceChildren();
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
              callback: value => `0x${value.toString(16).toUpperCase().padStart(2, '0')}`,
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

  _buildI2c() {
    const labels = this._i2c.txs.map((_, i) => `T${i + 1}`);
    this._chart = new Chart(this._canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'TX',
            data: [...this._i2c.txs],
            backgroundColor: 'rgba(74,144,226,0.75)',
            borderColor: '#4a90e2',
            borderWidth: 1,
          },
          {
            label: 'RX',
            data: [...this._i2c.rxs],
            backgroundColor: 'rgba(76,175,80,0.75)',
            borderColor: '#4caf50',
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
              callback: value => `0x${value.toString(16).toUpperCase().padStart(2, '0')}`,
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
    const frameKeys = [...this._can.order];
    const slotCount = getCanfdGridSlotCount(frameKeys.length);
    let layoutClass = 'canfd-single';

    this._destroyCanfdCharts();

    if (frameKeys.length > 4) {
      layoutClass = 'canfd-many';
    } else if (frameKeys.length > 1) {
      layoutClass = 'canfd-quad';
    }

    this._wrapper.classList.toggle('canfd-single', layoutClass === 'canfd-single');
    this._wrapper.classList.toggle('canfd-quad', layoutClass === 'canfd-quad');
    this._wrapper.classList.toggle('canfd-many', layoutClass === 'canfd-many');
    this._canfdGrid.className = `canfd-grid ${layoutClass}`;

    if (!frameKeys.length) {
      this._canfdGrid.appendChild(this._createCanfdEmptyState());
      return;
    }

    const slots = frameKeys.slice();
    while (slots.length < slotCount) {
      slots.push(null);
    }

    slots.forEach(frameKey => {
      if (!frameKey) {
        this._canfdGrid.appendChild(this._createCanfdPlaceholder());
        return;
      }
      this._canfdGrid.appendChild(this._createCanfdCard(frameKey));
    });
  }

  _createCanfdEmptyState() {
    const empty = document.createElement('div');
    empty.className = 'canfd-chart-empty';
    empty.innerHTML = [
      '<span class="canfd-empty-title">Waiting for CANFD frames</span>',
      '<span class="canfd-empty-copy">Start CANFD monitoring or send a frame to populate the visual grid.</span>',
    ].join('');
    return empty;
  }

  _createCanfdPlaceholder() {
    const placeholder = document.createElement('div');
    placeholder.className = 'canfd-chart-placeholder';
    placeholder.innerHTML = [
      '<span class="canfd-placeholder-title">Waiting for frame</span>',
      '<span class="canfd-placeholder-copy">A new frame ID will claim this slot automatically.</span>',
    ].join('');
    return placeholder;
  }

  _createCanfdCard(frameKey) {
    const frame = this._can.frames[frameKey];
    const card = document.createElement('article');
    const header = document.createElement('div');
    const title = document.createElement('div');
    const meta = document.createElement('div');
    const body = document.createElement('div');
    const canvas = document.createElement('canvas');
    const chart = this._buildCanfdFrameChart(canvas, frame);

    card.className = 'canfd-chart-card';
    card.dataset.canfdFrame = frameKey;

    header.className = 'canfd-chart-card-header';
    title.className = 'canfd-chart-title';
    meta.className = 'canfd-chart-meta';
    body.className = 'canfd-chart-body';
    canvas.className = 'canfd-chart-canvas';

    title.textContent = frameKey;
    meta.textContent = this._formatCanfdFrameMeta(frame);

    header.appendChild(title);
    header.appendChild(meta);
    body.appendChild(canvas);
    card.appendChild(header);
    card.appendChild(body);

    this._canfdCharts.set(frameKey, { chart, card, metaEl: meta });
    return card;
  }

  _buildCanfdFrameChart(canvas, frame) {
    return new Chart(canvas, {
      type: 'line',
      data: {
        datasets: [{
          label: frame.key,
          data: frame.points.map(point => ({ x: point.x, y: point.y, dlc: point.dlc })),
          parsing: false,
          borderColor: frame.color,
          backgroundColor: rgba(frame.color, 0.18),
          pointBackgroundColor: frame.color,
          pointBorderColor: frame.color,
          pointRadius: 3,
          pointHoverRadius: 5,
          tension: 0.25,
          fill: false,
        }],
      },
      options: {
        animation: false,
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            type: 'linear',
            title: { display: true, text: 'time (s)', font: { size: 10 } },
            ticks: { font: { size: 10 } },
          },
          y: {
            beginAtZero: true,
            ticks: {
              precision: 0,
              font: { size: 10 },
            },
            title: { display: true, text: 'hits', font: { size: 10 } },
          },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: items => items[0] ? frame.key : '',
              label: ctx => {
                const point = ctx.raw || {};
                const timeText = point.x != null ? `${point.x.toFixed(1)} s` : '-';
                const hitText = point.y != null ? `hit ${point.y}` : 'hit -';
                const dlcText = point.dlc != null ? `DLC ${point.dlc}` : 'DLC -';
                return `${timeText} | ${hitText} | ${dlcText}`;
              },
            },
          },
        },
      },
    });
  }

  _updateCanfdFrameChart(frameKey) {
    const record = this._canfdCharts.get(frameKey);
    const frame = this._can.frames[frameKey];

    if (!record || !frame) {
      this._buildCanfd();
      return;
    }

    record.chart.data.datasets[0].data = frame.points.map(point => ({
      x: point.x,
      y: point.y,
      dlc: point.dlc,
    }));
    record.chart.update('none');
    record.metaEl.textContent = this._formatCanfdFrameMeta(frame);
  }

  _formatCanfdFrameMeta(frame) {
    const countText = `${frame.count} hit${frame.count === 1 ? '' : 's'}`;
    const dlcText = frame.lastDlc != null ? `DLC ${frame.lastDlc}` : 'DLC -';
    return `${countText} | ${dlcText}`;
  }

  _updateChart(proto) {
    if (!this._chart) {
      return;
    }

    if (proto === 'UART') {
      this._chart.data.labels = this._uart.rtts.map((_, i) => i + 1);
      this._chart.data.datasets[0].data = [...this._uart.rtts];
      this._chart.update('none');
    }

    if (proto === 'SPI') {
      this._chart.data.labels = this._spi.txs.map((_, i) => `T${i + 1}`);
      this._chart.data.datasets[0].data = [...this._spi.txs];
      this._chart.data.datasets[1].data = [...this._spi.rxs];
      this._chart.update('none');
    }

    if (proto === 'I2C') {
      this._chart.data.labels = this._i2c.txs.map((_, i) => `T${i + 1}`);
      this._chart.data.datasets[0].data = [...this._i2c.txs];
      this._chart.data.datasets[1].data = [...this._i2c.rxs];
      this._chart.update('none');
    }
  }

  _refreshMetrics() {
    let cards = [];

    if (!this._proto) {
      this._metrics.innerHTML = '';
      return;
    }

    if (this._proto === 'UART') {
      const lastRtt = this._uart.rtts.at(-1) ?? '-';
      const errRate = this._uart.total > 0
        ? `${((this._uart.errors / this._uart.total) * 100).toFixed(1)}%`
        : '0%';
      cards = [
        { label: 'Last RTT', value: lastRtt === '-' ? '-' : `${lastRtt} ms` },
        { label: 'Bytes rcvd', value: String(this._uart.totalBytes) },
        { label: 'Error rate', value: errRate },
      ];
    }

    if (this._proto === 'SPI') {
      const matchRate = this._spi.txCount > 0
        ? `${((this._spi.matchCount / this._spi.txCount) * 100).toFixed(1)}%`
        : '0%';
      cards = [
        { label: 'Match rate', value: matchRate },
        { label: 'TX count', value: String(this._spi.txCount) },
      ];
    }

    if (this._proto === 'CANFD') {
      const lastRtt = this._can.lastRtt != null ? `${this._can.lastRtt} ms` : '-';
      cards = [
        { label: 'Frames seen', value: String(this._can.order.length) },
        { label: 'Error frames', value: String(this._can.errorCount) },
        { label: 'Last RTT', value: lastRtt },
      ];
    }

    if (this._proto === 'I2C') {
      const ackRate = this._i2c.txCount > 0
        ? `${((this._i2c.ackCount / this._i2c.txCount) * 100).toFixed(1)}%`
        : '0%';
      const lastRx = this._i2c.rxs.at(-1) != null
        ? `0x${this._i2c.rxs.at(-1).toString(16).toUpperCase().padStart(2, '0')}`
        : '-';
      cards = [
        { label: 'ACK rate', value: ackRate },
        { label: 'TX count', value: String(this._i2c.txCount) },
        { label: 'Last RX', value: lastRx },
      ];
    }

    this._metrics.innerHTML = cards
      .map(card =>
        `<div class="metric-card">` +
        `<span class="metric-label">${card.label}</span>` +
        `<span class="metric-value">${card.value}</span>` +
        `</div>`
      )
      .join('');
  }
}
