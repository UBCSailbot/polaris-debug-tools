// frontend/visual.js
// VisualView — manages #visual-panel for non-technical users.
// Shows protocol tabs, command cards (with descriptions), a live chart, and a status footer.
// Requires Chart.js loaded globally as window.Chart.

import { PROTOCOLS, PROTOCOL_ORDER } from './protocols.js';
import { Charts } from './charts.js';

/**
 * Build the command string for a custom command definition.
 * Pure function — exported for testing.
 * @param {object} commandDef - protocol command metadata
 * @param {object} values     - user-supplied field values by field name
 * @returns {string}
 */
export function buildCustomCommand(commandDef, values) {
  if (!commandDef || typeof commandDef.buildCommand !== 'function') {
    throw new Error('Custom command definition is missing a buildCommand(values) handler.');
  }
  return commandDef.buildCommand(values);
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
    this._pendingCustomCommand = null;
    this._caps = null;

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
    this._syncInteractiveState();
    if (!connected) this._hideCustomForm();
  }

  setCapabilities(caps = null) {
    this._caps = Array.isArray(caps) ? new Set(caps) : null;
    this._buildTabs();
    if (this._activeProto && !this._isProtocolEnabled(this._activeProto)) {
      this._activeProto = null;
      this._commands.innerHTML = '';
      this._charts.hide();
      this._hideCustomForm();
      return;
    }
    if (this._activeProto) {
      this.show(this._activeProto);
    } else {
      this._syncInteractiveState();
    }
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
      btn.disabled = !this._connected || !this._isProtocolEnabled(id);
      btn.title = this._isProtocolEnabled(id) ? '' : 'Not supported by connected firmware.';
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
      card.disabled = !this._connected || !this._isCommandEnabled(protoId, cmd);
      card.classList.toggle('locked', !this._isCommandEnabled(protoId, cmd));
      card.title = this._commandDisabledReason(protoId, cmd);

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
        card.addEventListener('click', () => this._openCustomForm(cmd, protoId));
      } else {
        card.addEventListener('click', () => this._onCommand(cmd.command));
      }
    }
  }

  _openCustomForm(commandDef, protoId) {
    this._pendingCustomProto = protoId;
    this._pendingCustomCommand = commandDef;
    // Remove old inputs (keep #visual-custom-actions div)
    const actions = this._customForm.querySelector('#visual-custom-actions');
    Array.from(this._customForm.children).forEach(c => {
      if (c !== actions) c.remove();
    });
    for (const f of commandDef.fields) {
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
    let values;

    if (!this._pendingCustomProto || !this._pendingCustomCommand) return;
    const inputs = this._customForm.querySelectorAll('.custom-field');
    values = {};
    for (const input of inputs) {
      if (input.required && !input.value.trim()) {
        input.focus();
        return;
      }
      values[input.dataset.fieldName] = input.value.trim();
    }
    this._onCommand(buildCustomCommand(this._pendingCustomCommand, values));
    this._hideCustomForm();
  }

  _hideCustomForm() {
    this._customForm.classList.add('hidden');
    this._pendingCustomProto = null;
    this._pendingCustomCommand = null;
  }

  _updateStatus(proto, { status, data, rtt }) {
    this._statusBar.querySelector('#vstat-proto').textContent = proto;

    const badge = this._statusBar.querySelector('#vstat-badge');
    badge.className   = `status-badge ${(status || 'default').toLowerCase()}`;
    badge.textContent = status || '-';

    this._statusBar.querySelector('#vstat-rtt').textContent  = rtt != null ? `${rtt} ms` : '-';
    this._statusBar.querySelector('#vstat-data').textContent = data || '-';
  }

  _syncInteractiveState() {
    this._tabs.querySelectorAll('.visual-tab').forEach(btn => {
      btn.disabled = !this._connected || !this._isProtocolEnabled(btn.dataset.proto);
      btn.title = this._isProtocolEnabled(btn.dataset.proto) ? '' : 'Not supported by connected firmware.';
    });

    this._commands.querySelectorAll('.visual-cmd-card').forEach(card => {
      const protoId = this._activeProto;
      const command = protoId
        ? PROTOCOLS[protoId].commands[Array.from(this._commands.children).indexOf(card)]
        : null;
      const enabled = !!command && this._connected && this._isCommandEnabled(protoId, command);
      card.disabled = !enabled;
      card.classList.toggle('locked', !enabled);
      card.title = command ? this._commandDisabledReason(protoId, command) : '';
    });
  }

  _isProtocolEnabled(protoId) {
    const proto = PROTOCOLS[protoId];
    if (!proto) {
      return false;
    }
    if (this._caps === null) {
      return false;
    }
    return this._caps.has(proto.domainCap);
  }

  _isCommandEnabled(protoId, command) {
    if (!this._isProtocolEnabled(protoId)) {
      return false;
    }
    if (!command.requiredCap) {
      return true;
    }
    return this._caps.has(command.requiredCap);
  }

  _commandDisabledReason(protoId, command) {
    if (this._isCommandEnabled(protoId, command)) {
      return '';
    }
    if (!this._isProtocolEnabled(protoId)) {
      return 'Protocol is not supported by the connected firmware.';
    }
    return 'Feature is not supported by the connected firmware.';
  }
}
