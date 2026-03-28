// frontend/visual.js
// VisualView — manages #visual-panel for non-technical users.
// Shows protocol tabs, command cards (with descriptions), a live chart, and a status footer.
// Requires Chart.js loaded globally as window.Chart.

import { PROTOCOLS, PROTOCOL_ORDER } from './protocols.js';
import { Charts } from './charts.js';

/**
 * Build the command string for a custom command.
 * Pure function — exported for testing.
 * @param {string}   protoId - 'UART' | 'SPI' | 'CANFD'
 * @param {string[]} parts   - user-supplied field values in order
 * @returns {string}
 */
export function buildCustomCommand(protoId, parts) {
  return `${protoId}:CUSTOM:${parts.join(':')}`;
}

export class VisualView {
  /**
   * @param {object}          opts
   * @param {HTMLElement}       opts.panelEl        - #visual-panel
   * @param {HTMLCanvasElement} opts.canvasEl        - #visual-canvas
   * @param {HTMLElement}       opts.metricsEl       - #visual-metrics-panel
   * @param {HTMLElement}       opts.tabsEl          - #visual-proto-tabs
   * @param {HTMLElement}       opts.commandsEl      - #visual-commands
   * @param {HTMLElement}       opts.customFormEl    - #visual-custom-form
   * @param {HTMLElement}       opts.statusBarEl     - #visual-status-bar
   * @param {Function}          opts.onCommand       - cb(commandString) when user fires a command
   */
  constructor({ panelEl, canvasEl, metricsEl, tabsEl, commandsEl,
                customFormEl, statusBarEl, onCommand }) {
    this._panel       = panelEl;
    this._tabs        = tabsEl;
    this._commands    = commandsEl;
    this._customForm  = customFormEl;
    this._statusBar   = statusBarEl;
    this._onCommand   = onCommand;
    this._connected   = false;
    this._activeProto = null;
    this._pendingCustomProto = null;

    this._charts = new Charts({ canvasEl, metricsEl });

    // Custom form buttons
    customFormEl.querySelector('#btn-visual-custom-send')
      .addEventListener('click', () => this._submitCustom());
    customFormEl.querySelector('#btn-visual-custom-cancel')
      .addEventListener('click', () => this._hideCustomForm());

    this._buildTabs();
  }

  /**
   * Switch to a protocol: update active tab, rebuild command cards, redraw chart.
   * @param {'UART'|'SPI'|'CANFD'} proto
   */
  show(proto) {
    this._activeProto = proto;
    this._updateTabActive();
    this._buildCommandCards(proto);
    this._hideCustomForm();
    this._charts.show(proto);
  }

  /**
   * Feed a new data point — updates chart and status footer if proto is active.
   * @param {'UART'|'SPI'|'CANFD'} proto
   * @param {{ status: string, data: string, rtt: number|null }} payload
   */
  push(proto, payload) {
    this._charts.push(proto, payload);
    if (proto === this._activeProto) {
      this._updateStatus(proto, payload);
    }
  }

  /** Enable or disable all interactive controls based on connection state. */
  setConnected(connected) {
    this._connected = connected;
    this._panel.querySelectorAll('.visual-tab, .visual-cmd-card').forEach(el => {
      el.disabled = !connected;
    });
    if (!connected) this._hideCustomForm();
  }

  // ─── Private ─────────────────────────────────────────────────

  _buildTabs() {
    this._tabs.innerHTML = '';
    for (const id of PROTOCOL_ORDER) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'visual-tab';
      btn.textContent = PROTOCOLS[id].label;
      btn.dataset.proto = id;
      btn.disabled = !this._connected;
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-selected', 'false');
      btn.addEventListener('click', () => {
        if (!this._connected) return;
        this.show(id);
      });
      this._tabs.appendChild(btn);
    }
  }

  _updateTabActive() {
    this._tabs.querySelectorAll('.visual-tab').forEach(btn => {
      const active = btn.dataset.proto === this._activeProto;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', String(active));
    });
  }

  _buildCommandCards(protoId) {
    const proto = PROTOCOLS[protoId];
    this._commands.innerHTML = '';
    for (const cmd of proto.commands) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'visual-cmd-card' + (cmd.custom ? ' custom-card' : '');
      card.disabled = !this._connected;

      const label = document.createElement('span');
      label.className = 'vcmd-label';
      label.textContent = cmd.label;

      const desc = document.createElement('span');
      desc.className = 'vcmd-desc';
      desc.textContent = cmd.desc || '';

      card.appendChild(label);
      card.appendChild(desc);
      this._commands.appendChild(card);

      if (cmd.custom) {
        card.addEventListener('click', () => this._openCustomForm(cmd.fields, protoId));
      } else {
        card.addEventListener('click', () => this._onCommand(cmd.command));
      }
    }
  }

  _openCustomForm(fields, protoId) {
    this._pendingCustomProto = protoId;
    // Remove old inputs (keep #visual-custom-actions div)
    const actions = this._customForm.querySelector('#visual-custom-actions');
    Array.from(this._customForm.children).forEach(c => {
      if (c !== actions) c.remove();
    });
    for (const f of fields) {
      const input = document.createElement('input');
      input.className = 'custom-field';
      input.type = 'text';
      input.placeholder = f.placeholder;
      input.dataset.fieldName = f.name;
      input.required = f.required ? 'required' : '';
      input.autocomplete = 'off';
      input.spellcheck = false;
      this._customForm.insertBefore(input, actions);
    }
    this._customForm.classList.remove('hidden');
    this._customForm.querySelector('.custom-field')?.focus();
  }

  _submitCustom() {
    if (!this._pendingCustomProto) return;
    const inputs = this._customForm.querySelectorAll('.custom-field');
    const parts  = [];
    for (const input of inputs) {
      if (input.required && !input.value.trim()) {
        input.focus();
        return;
      }
      parts.push(input.value.trim());
    }
    this._onCommand(buildCustomCommand(this._pendingCustomProto, parts));
    this._hideCustomForm();
  }

  _hideCustomForm() {
    this._customForm.classList.add('hidden');
    this._pendingCustomProto = null;
  }

  _updateStatus(proto, { status, data, rtt }) {
    this._statusBar.querySelector('#vstat-proto').textContent = proto;

    const badge = this._statusBar.querySelector('#vstat-badge');
    badge.className   = `status-badge ${(status || 'default').toLowerCase()}`;
    badge.textContent = status || '—';

    this._statusBar.querySelector('#vstat-rtt').textContent  = rtt != null ? `${rtt} ms` : '—';
    this._statusBar.querySelector('#vstat-data').textContent = data || '—';
  }
}
