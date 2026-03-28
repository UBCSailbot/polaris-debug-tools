// frontend/terminal.js
// Terminal component: append lines, color-code by status, auto-scroll,
// timestamps, and session stats footer (duration, passed, failed counts).

const STATUS_CLASS = {
  PASS:    'term-pass',
  FAIL:    'term-fail',
  TIMEOUT: 'term-timeout',
  RAW:     'term-raw',
  INIT:    'term-init',
};

// Format a Date as [HH:MM:SS.mmm]
export function formatTs(d = new Date()) {
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `[${hh}:${mm}:${ss}.${ms}]`;
}

// Format elapsed milliseconds as HH:MM:SS
export function formatDuration(ms) {
  const s  = Math.floor(ms / 1000);
  const hh = String(Math.floor(s / 3600)).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

export class Terminal {
  /**
   * @param {object} opts
   * @param {HTMLElement} opts.containerEl   - The scrollable terminal div
   * @param {HTMLElement} opts.footerDuration - Span for HH:MM:SS elapsed
   * @param {HTMLElement} opts.footerPassed  - Span for passed count
   * @param {HTMLElement} opts.footerFailed  - Span for failed count
   */
  constructor({ containerEl, footerDuration, footerPassed, footerFailed }) {
    this._el        = containerEl;
    this._durEl     = footerDuration;
    this._passEl    = footerPassed;
    this._failEl    = footerFailed;
    this._passed    = 0;
    this._failed    = 0;
    this._startedAt = Date.now();
    this._userScrolled = false;
    this._timerHandle  = null;

    // Detect manual scroll-up: suppress auto-scroll while user is reading
    this._el.addEventListener('scroll', () => {
      const distFromBottom =
        this._el.scrollHeight - this._el.scrollTop - this._el.clientHeight;
      this._userScrolled = distFromBottom > 8;
    });

    this._startTimer();
  }

  /**
   * Append a line to the terminal.
   * @param {string} text   - Text to display
   * @param {string} status - 'PASS'|'FAIL'|'TIMEOUT'|'RAW'|'INIT'
   */
  append(text, status = 'INIT') {
    const cls = STATUS_CLASS[status] || 'term-init';

    const line = document.createElement('div');
    line.className = 'term-line';

    const ts = document.createElement('span');
    ts.className = 'term-ts';
    ts.textContent = formatTs();
    ts.setAttribute('aria-hidden', 'true');

    const body = document.createElement('span');
    body.className = cls;
    body.textContent = text;

    line.appendChild(ts);
    line.appendChild(body);
    this._el.appendChild(line);

    if (!this._userScrolled) {
      this._el.scrollTop = this._el.scrollHeight;
    }

    if (status === 'PASS') this._passed++;
    if (status === 'FAIL') this._failed++;
    this._updateCounters();
  }

  /** Clear all terminal lines and reset counters */
  clear() {
    this._el.innerHTML = '';
    this._passed    = 0;
    this._failed    = 0;
    this._startedAt = Date.now();
    this._userScrolled = false;
    this._updateCounters();
  }

  /** Release the duration timer (call when tearing down) */
  destroy() {
    clearInterval(this._timerHandle);
  }

  _updateCounters() {
    if (this._passEl) this._passEl.textContent = String(this._passed);
    if (this._failEl) this._failEl.textContent = String(this._failed);
  }

  _startTimer() {
    this._timerHandle = setInterval(() => {
      if (this._durEl) {
        this._durEl.textContent = formatDuration(Date.now() - this._startedAt);
      }
    }, 1000);
  }
}
