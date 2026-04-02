// frontend/app.js
// Main renderer application.

import { PROTOCOLS, PROTOCOL_ORDER, parseCanFrame } from './protocols.js';
import { parseLine, parseKeyValuePayload, isLog, isStreamingEvent } from './protocol-parser.js';
import { Terminal } from './terminal.js';
import { Charts } from './charts.js';
import { VisualView } from './visual.js';
import {
  capsFromProfile,
  computeSharedCaps,
  computeSharedProtocols,
  describeBoardProfile,
  computeDualWarnings,
  getDualCommandDisabledReason,
} from './dual-board.js';

const state = {
  connected: false,
  activeProto: null,
  lastCommand: null,
  unsubs: [],
  view: 'terminal',
  boardProfile: null,
  caps: new Set(),
  lastHeartbeatAt: null,
  pendingCustomCommand: null,
};

const $ = id => document.getElementById(id);
const portSelect = $('port-select');
const btnRefreshPorts = $('btn-refresh-ports');
const btnConnect = $('btn-connect');
const btnSettings = $('btn-settings');
const btnBoardPing = $('btn-board-ping');
const btnBoardRefreshProfile = $('btn-board-refresh-profile');
const btnBoardLegacy = $('btn-board-legacy');
const btnBoardResetMode = $('btn-board-reset-mode');
const settingsPanel = $('settings-panel');
const btnSettingsClose = $('btn-settings-close');
const settingsTabs = Array.from(document.querySelectorAll('.settings-tab'));
const settingsTabPanels = Array.from(document.querySelectorAll('.settings-tab-panel'));
const accentPresetButtons = Array.from(document.querySelectorAll('.theme-swatch-btn'));
const terminalThemeButtons = Array.from(document.querySelectorAll('.theme-toggle-btn'));
const toggleDarkMode = $('toggle-dark-mode');
const toggleTimestamps = $('toggle-timestamps');
const toggleTerminalStatus = $('toggle-terminal-status');
const toggleAutoRecon = $('toggle-auto-reconnect');
const toggleAutoPortRefresh = $('toggle-auto-port-refresh');
const selMaxLines = $('sel-max-lines');
const terminalEl = $('terminal');
const viewBtns = document.querySelectorAll('.view-btn');
const statusDot = $('status-dot');
const banner = $('banner');
const reconnectCounter = $('reconnect-counter');
const sidebar = $('sidebar');
const presetButtons = $('preset-buttons');
const customForm = $('custom-form');
const btnCustomSend = $('btn-custom-send');
const rawInput = $('raw-input');
const btnSend = $('btn-send');
const vizPanel = $('viz-panel');
const resProto = $('res-proto');
const resStatus = $('res-status');
const resData = $('res-data');
const resRtt = $('res-rtt');
const resCanGroup = $('res-can-group');
const resDlcGroup = $('res-dlc-group');
const resCanId = $('res-can-id');
const resDlc = $('res-dlc');
const btnRetry = $('btn-retry');
const btnExportLog = $('btn-export-log');
const btnExportCsv = $('btn-export-csv');
const sessionFilePath = $('session-file-path');
const toastContainer = $('toast-container');
const titlebarVersion = $('titlebar-version');

const boardAPortSelect = $('board-a-port');
const boardBPortSelect = $('board-b-port');
const dualProtoBtns = $('dual-proto-btns');
const dualWarningStrip = $('dual-warning-strip');
const dualWarningItems = $('dual-warning-items');
const dualSharedPresets = $('dual-shared-presets');
const dualState = {
  activeProto: null,
  sharedCaps: new Set(),
};

const terminal = new Terminal({
  containerEl: $('terminal'),
  footerDuration: $('stat-duration'),
  footerPassed: $('stat-passed'),
  footerFailed: $('stat-failed'),
});

const charts = new Charts({
  canvasEl: $('viz-canvas'),
  metricsEl: $('viz-metrics'),
});

const visualView = new VisualView({
  panelEl: $('visual-panel'),
  canvasEl: $('visual-canvas'),
  metricsEl: $('visual-metrics-panel'),
  tabsEl: $('visual-proto-tabs'),
  commandsEl: $('visual-commands'),
  customFormEl: $('visual-custom-form'),
  statusBarEl: $('visual-status-bar'),
  onCommand: command => sendCommand(command),
});

function syncPortExclusions() {
  const portA = boardAPortSelect.value;
  const portB = boardBPortSelect.value;

  Array.from(boardBPortSelect.options).forEach(opt => {
    opt.disabled = !!(portA && opt.value === portA && opt.value !== '');
  });
  Array.from(boardAPortSelect.options).forEach(opt => {
    opt.disabled = !!(portB && opt.value === portB && opt.value !== '');
  });
}

boardAPortSelect.addEventListener('change', syncPortExclusions);
boardBPortSelect.addEventListener('change', syncPortExclusions);

function syncReconnectBanner(visible = !state.connected) {
  banner.classList.toggle('visible', visible && state.view !== 'dual');
}

function getFrameTone(parsed, localTimeout) {
  if (localTimeout) {
    return 'TIMEOUT';
  }
  return parsed?.status || parsed?.event || parsed?.level || 'RAW';
}

function isHeartbeatFrame(parsed) {
  const canFrame = parsed?.domain === 'CANFD' && parsed?.event === 'FRAME'
    ? parseCanFrame(parsed.payload)
    : null;

  return !!canFrame && canFrame.id === 0x130 && canFrame.dlc === 0;
}

function describeHeartbeat(ts) {
  if (!ts) {
    return 'No heartbeat detected.';
  }

  const ageMs = Date.now() - ts;
  if (ageMs < 2000) {
    return 'Heartbeat detected just now.';
  }
  if (ageMs < 60000) {
    return `Heartbeat detected ${Math.round(ageMs / 1000)}s ago.`;
  }
  return `Heartbeat detected ${Math.round(ageMs / 60000)}m ago.`;
}

function formatTerminalFrameText(raw, parsed) {
  const fallbackText = raw || parsed?.raw || '(empty)';

  if (settings.showTerminalStatus !== false || !parsed || parsed.kind === 'log') {
    return fallbackText;
  }

  if (parsed.payload) {
    return parsed.payload;
  }

  return parsed.status || parsed.event || parsed.type || fallbackText;
}

function pluralize(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function formatHexPreview(value, maxBytes = 8) {
  const normalized = String(value ?? '').replace(/[^0-9A-Fa-f]/g, '').toUpperCase();
  const pairs = normalized.match(/.{1,2}/g) || [];
  const preview = pairs.slice(0, maxBytes).join(' ');
  return pairs.length > maxBytes ? `${preview} ...` : (preview || 'none');
}

function formatFoundAddresses(found) {
  const values = String(found ?? '')
    .split(',')
    .map(part => part.trim())
    .filter(Boolean);

  if (!values.length) {
    return 'none';
  }

  return values
    .map(value => (value.startsWith('0x') || value.startsWith('0X')) ? value.toUpperCase() : `0x${value.toUpperCase()}`)
    .join(', ');
}

function formatFailureReason(domain, reason) {
  const generic = {
    'bad-arg': 'The command arguments were invalid.',
    'not-init': 'Initialize this protocol before sending commands.',
    'init-failed': 'Hardware initialization failed on the board.',
    'internal': 'Firmware reported an internal error.',
    'unknown-command': 'Firmware did not recognize the command.',
    'nack': 'The target device did not acknowledge the request.',
    'bus-off': 'The controller entered bus-off state.',
    'fifo-full': 'The transmit queue is full.',
    'no-echo': 'No loopback byte was received back from the bridge.',
    'timeout': 'The operation hit the firmware timeout.',
    'transfer-timeout': 'The transfer hit the firmware timeout.',
    'transfer-failed': 'The transfer failed on the board.',
    'tx-failed': 'The transmit step failed on the board.',
    'tx-reject': 'The CAN controller rejected the transmit request.',
    'tx-cancel': 'The CAN controller cancelled the transmit request.',
    'tx-abort': 'The CAN controller aborted the transmit request.',
    'tx-timeout': 'The CAN transmit confirmation timed out.',
    'bus': 'The I2C bus reported an error.',
    'arbitration': 'The I2C controller lost bus arbitration.',
    'overrun': 'The I2C controller reported an overrun.',
    'i2c': 'The I2C controller reported an error.',
  };

  const domainSpecific = {
    UART: {
      'not-init': 'Initialize UART before loopback, streaming, or status checks.',
      'tx-failed': 'UART could not write the loopback byte out.',
      'no-echo': 'UART never received the echoed byte back from the bridge.',
    },
    SPI: {
      'not-init': 'Initialize SPI before running transfers or reading counters.',
      'transfer-timeout': 'SPI timed out waiting for the transfer to finish.',
      'transfer-failed': 'SPI reported a transfer failure.',
    },
    CANFD: {
      'not-init': 'Initialize CANFD before sending frames or monitoring the bus.',
      'bus-off': 'CANFD is bus-off and cannot transmit right now.',
      'fifo-full': 'CANFD transmit FIFO is full.',
      'tx-reject': 'CANFD rejected the frame before it reached the bus.',
      'tx-cancel': 'CANFD cancelled the frame before completion.',
      'tx-abort': 'CANFD aborted the frame while transmitting.',
      'tx-timeout': 'CANFD never confirmed the frame transmit.',
    },
    I2C: {
      'not-init': 'Initialize I2C before scanning or accessing devices.',
      'nack': 'The device did not acknowledge the I2C transaction.',
      'bus': 'The I2C bus reported a bus error.',
      'arbitration': 'The I2C controller lost arbitration on the bus.',
      'overrun': 'The I2C controller reported an overrun.',
      'timeout': 'The I2C transaction hit the firmware timeout.',
    },
  };

  return domainSpecific[domain]?.[reason] || generic[reason] || `Firmware reported "${reason}".`;
}

function describeProtocolIdle(protoId, streaming) {
  switch (protoId) {
    case 'UART':
      return {
        primary: { tone: streaming.has('UART') ? 'info' : 'default', text: streaming.has('UART') ? 'UART streaming is enabled.' : 'UART is available and idle.' },
        detail: { tone: 'default', text: streaming.has('UART') ? 'Waiting for live UART bytes from the bridge.' : 'Run Init, Loopback, Stream, or Status to inspect UART.' },
      };
    case 'SPI':
      return {
        primary: { tone: 'default', text: 'SPI is available and idle.' },
        detail: { tone: 'default', text: 'Run Init, transfer bytes, or request SPI counters.' },
      };
    case 'CANFD':
      return {
        primary: { tone: streaming.has('CANFD') ? 'info' : 'default', text: streaming.has('CANFD') ? 'CANFD monitoring is enabled.' : 'CANFD is available and idle.' },
        detail: { tone: 'default', text: streaming.has('CANFD') ? 'Waiting for live CANFD frames from the bus.' : 'Run Init, Send, Monitor, or Status to inspect CANFD.' },
      };
    case 'I2C':
      return {
        primary: { tone: 'default', text: 'I2C is available and idle.' },
        detail: { tone: 'default', text: 'Run Init, Scan, Read, Write, or Status to inspect I2C.' },
      };
    default:
      return {
        primary: { tone: 'default', text: 'No shared protocol is selected yet.' },
        detail: { tone: 'default', text: 'Connect both boards with a matching protocol to unlock shared controls.' },
      };
  }
}

function describeProtocolResult(protoId, result, lastEvent, streaming, lastHeartbeatAt) {
  const fields = parseKeyValuePayload(result?.payload);
  const heartbeatText = lastHeartbeatAt ? ` ${describeHeartbeat(lastHeartbeatAt)}` : '';

  if (!result) {
    return describeProtocolIdle(protoId, streaming);
  }

  if (result.localTimeout) {
    return {
      primary: { tone: 'timeout', text: `${protoId} command timed out in the desktop app.` },
      detail: { tone: 'timeout', text: 'The command left the GUI, but no terminal response came back in time.' },
    };
  }

  if (result.status === 'FAIL') {
    return {
      primary: { tone: 'fail', text: `${protoId} command failed.` },
      detail: { tone: 'fail', text: formatFailureReason(protoId, fields.reason || 'internal') },
    };
  }

  if (result.status === 'TIMEOUT') {
    if (protoId === 'I2C' && fields.addr) {
      return {
        primary: { tone: 'timeout', text: 'I2C transaction timed out.' },
        detail: { tone: 'timeout', text: `The device at ${fields.addr.toUpperCase()} did not respond before the firmware timeout.` },
      };
    }
    return {
      primary: { tone: 'timeout', text: `${protoId} operation timed out on the board.` },
      detail: { tone: 'timeout', text: 'The board hit its firmware timeout while completing the request.' },
    };
  }

  if (lastEvent && lastEvent.domain === protoId) {
    if (protoId === 'UART' && lastEvent.event === 'DATA') {
      const byteCount = Math.floor(String(lastEvent.payload ?? '').length / 2);
      return {
        primary: { tone: 'info', text: 'UART streaming is active.' },
        detail: { tone: 'info', text: `Last stream chunk carried ${pluralize(byteCount, 'byte')}: ${formatHexPreview(lastEvent.payload)}.` },
      };
    }

    if (protoId === 'CANFD' && lastEvent.event === 'FRAME') {
      const frame = parseCanFrame(lastEvent.payload);
      return {
        primary: { tone: 'info', text: 'CANFD monitor is active.' },
        detail: {
          tone: 'info',
          text: frame.id != null
            ? `Last frame 0x${frame.id.toString(16).toUpperCase()} arrived with DLC ${frame.dlc ?? 'unknown'}.${heartbeatText}`.trim()
            : `A CANFD frame arrived on the monitor.${heartbeatText}`.trim(),
        },
      };
    }
  }

  if (protoId === 'UART') {
    if (fields.ready === '1') {
      return {
        primary: { tone: 'success', text: 'UART bridge initialized successfully.' },
        detail: { tone: 'info', text: 'Loopback, streaming, and counter commands are ready.' },
      };
    }
    if (fields.streaming === '1') {
      return {
        primary: { tone: 'info', text: 'UART streaming is active.' },
        detail: { tone: 'info', text: 'Live UART bytes will appear in the board terminal as they arrive.' },
      };
    }
    if (fields.streaming === '0') {
      return {
        primary: { tone: 'default', text: 'UART streaming is stopped.' },
        detail: { tone: 'default', text: 'Start stream again to forward unsolicited UART bytes.' },
      };
    }
    if (fields.rx && fields.tx !== undefined && fields.errors !== undefined) {
      return {
        primary: { tone: 'success', text: 'UART counters refreshed.' },
        detail: { tone: 'info', text: `Received ${fields.rx} bytes, transmitted ${fields.tx} bytes, errors ${fields.errors}.` },
      };
    }
    if (fields.rx) {
      return {
        primary: { tone: 'success', text: 'UART loopback completed successfully.' },
        detail: { tone: 'success', text: `The bridge echoed byte 0x${String(fields.rx).toUpperCase()}.` },
      };
    }
  }

  if (protoId === 'SPI') {
    if (fields.ready === '1') {
      return {
        primary: { tone: 'success', text: 'SPI master initialized successfully.' },
        detail: { tone: 'info', text: 'Transfers and status polling are ready.' },
      };
    }
    if (fields.transfers !== undefined) {
      return {
        primary: { tone: 'success', text: 'SPI counters refreshed.' },
        detail: { tone: 'info', text: `${pluralize(parseInt(fields.transfers, 10) || 0, 'transfer')} completed on this board.` },
      };
    }
    if (fields.tx && fields.rx) {
      return {
        primary: { tone: 'success', text: 'SPI transfer completed successfully.' },
        detail: { tone: 'success', text: `TX ${formatHexPreview(fields.tx)} -> RX ${formatHexPreview(fields.rx)}.` },
      };
    }
  }

  if (protoId === 'CANFD') {
    if (fields.ready === '1') {
      return {
        primary: { tone: 'success', text: 'CANFD controller initialized successfully.' },
        detail: { tone: 'info', text: 'Frame send, monitor, and controller status commands are ready.' },
      };
    }
    if (fields.monitoring === '1') {
      return {
        primary: { tone: 'info', text: 'CANFD monitor is active.' },
        detail: { tone: 'info', text: `Forwarding live bus frames to the terminal.${heartbeatText}`.trim() },
      };
    }
    if (fields.monitoring === '0') {
      return {
        primary: { tone: 'default', text: 'CANFD monitor is stopped.' },
        detail: { tone: 'default', text: 'Start monitor again to forward live frames from the bus.' },
      };
    }
    if (fields.id && fields.dlc !== undefined) {
      return {
        primary: { tone: 'success', text: 'CANFD frame sent successfully.' },
        detail: { tone: 'success', text: `Frame ${fields.id.toUpperCase()} reported DLC ${fields.dlc}.` },
      };
    }
    if (fields.psr && fields.lec !== undefined && fields.bo !== undefined && fields.ep !== undefined) {
      return {
        primary: { tone: 'success', text: 'CANFD controller status refreshed.' },
        detail: { tone: 'info', text: `PSR ${fields.psr}, last error ${fields.lec}, bus-off ${fields.bo === '1' ? 'yes' : 'no'}, error-passive ${fields.ep === '1' ? 'yes' : 'no'}.${heartbeatText}`.trim() },
      };
    }
  }

  if (protoId === 'I2C') {
    if (fields.ready === '1') {
      return {
        primary: { tone: 'success', text: 'I2C bridge initialized successfully.' },
        detail: { tone: 'info', text: 'Scan, register read/write, and status commands are ready.' },
      };
    }
    if (fields.found !== undefined) {
      return {
        primary: { tone: 'success', text: 'I2C scan completed successfully.' },
        detail: { tone: 'info', text: fields.found ? `Found devices at ${formatFoundAddresses(fields.found)}.` : 'No I2C devices responded during the scan.' },
      };
    }
    if (fields.addr && fields.wrote !== undefined) {
      return {
        primary: { tone: 'success', text: 'I2C write completed successfully.' },
        detail: { tone: 'success', text: `Wrote ${pluralize(parseInt(fields.wrote, 10) || 0, 'byte')} to ${fields.addr.toUpperCase()}.` },
      };
    }
    if (fields.addr && fields.reg && fields.bytes) {
      return {
        primary: { tone: 'success', text: 'I2C read completed successfully.' },
        detail: { tone: 'success', text: `Read ${pluralize((String(fields.bytes).length / 2) || 0, 'byte')} from ${fields.addr.toUpperCase()} register ${fields.reg.toUpperCase()}: ${formatHexPreview(fields.bytes)}.` },
      };
    }
    if (fields.last_addr && fields.errors !== undefined) {
      return {
        primary: { tone: 'success', text: 'I2C status refreshed.' },
        detail: { tone: 'info', text: `Last addressed device ${fields.last_addr.toUpperCase()}, accumulated errors ${fields.errors}.` },
      };
    }
  }

  return {
    primary: { tone: 'info', text: `${protoId} reported ${result.status || 'an update'}.` },
    detail: { tone: 'info', text: result.payload ? `Payload: ${result.payload}` : 'The board responded without additional details.' },
  };
}

function describeBoardStatus({
  connected,
  profile,
  mode,
  caps,
  activeProto,
  lastResult,
  lastEvent,
  streaming,
  lastHeartbeatAt,
}) {
  if (!connected) {
    return {
      primary: { tone: 'default', text: 'Disconnected. Connect this board to start the handshake.' },
      detail: { tone: 'default', text: 'No protocol activity yet.' },
    };
  }

  if (!profile?.available) {
    switch (profile?.reason) {
      case 'handshake-pending':
        return {
          primary: { tone: 'info', text: 'Connected. Waiting for the firmware handshake.' },
          detail: { tone: 'info', text: 'The GUI is probing this board for protocol support and firmware details.' },
        };
      case 'handshake-timeout':
        return {
          primary: { tone: 'warn', text: 'Connected without a protocol handshake.' },
          detail: { tone: 'warn', text: 'Raw terminal use is still available, but preset controls stay limited until SYS:INFO arrives.' },
        };
      case 'handshake-write-failed':
        return {
          primary: { tone: 'fail', text: 'Connected, but the handshake write failed.' },
          detail: { tone: 'fail', text: 'Check the serial link, board firmware state, and selected port.' },
        };
      default:
        return {
          primary: { tone: 'warn', text: 'Connected, but the board profile is unavailable.' },
          detail: { tone: 'warn', text: 'Shared protocol controls stay locked until the firmware handshake completes.' },
        };
    }
  }

  if (mode === 'legacy') {
    return {
      primary: { tone: 'warn', text: 'Legacy mode is active on this board.' },
      detail: { tone: 'warn', text: 'Exit legacy mode to unlock protocol presets, streaming controls, and structured status responses.' },
    };
  }

  if (!activeProto) {
    return {
      primary: { tone: 'info', text: 'Connected and handshaken. Waiting for a shared protocol selection.' },
      detail: { tone: 'default', text: 'Once both boards share a protocol, dual-board controls will appear here.' },
    };
  }

  if (!caps.has(PROTOCOLS[activeProto].domainCap)) {
    return {
      primary: { tone: 'warn', text: `${activeProto} is not available on this board.` },
      detail: { tone: 'warn', text: 'Select a protocol supported by both boards or inspect this board with raw commands.' },
    };
  }

  return describeProtocolResult(
    activeProto,
    lastResult?.domain === activeProto ? lastResult : null,
    lastEvent?.domain === activeProto ? lastEvent : null,
    streaming,
    lastHeartbeatAt
  );
}

function makeBoardController({
  id,
    termEl, dotEl, portEl, connectBtnEl,
    presetsEl, customFormEl, customSendBtnEl, customCancelBtnEl, rawEl, sendBtnEl,
    statusPrimaryEl, statusDetailEl,
  apiConnect, apiDisconnect, apiSend,
  onData, onConnectionStatus, onBoardProfile,
  onStateChange,
}) {
  const term = new Terminal({ containerEl: termEl });
  let connected = false;
  let unsubs = [];
  let boardProfile = null;
  let caps = new Set();
  let mode = 'protocol';
  let streaming = new Set();
  let lastResult = null;
  let lastEvent = null;
  let lastHeartbeatAt = null;
  let pendingCustomCommand = null;

  function closeCustomForm() {
    const actions = customFormEl.querySelector('.board-custom-actions');

    pendingCustomCommand = null;
    Array.from(customFormEl.children).forEach(child => {
      if (child !== actions) {
        child.remove();
      }
    });
    customFormEl.classList.remove('visible');
  }

  function openCustomForm(commandDef) {
    const actions = customFormEl.querySelector('.board-custom-actions');

    pendingCustomCommand = commandDef;
    Array.from(customFormEl.children).forEach(child => {
      if (child !== actions) {
        child.remove();
      }
    });

    for (const field of commandDef.fields) {
      const input = document.createElement('input');
      input.className = 'custom-field';
      input.type = 'text';
      input.placeholder = field.placeholder;
      input.dataset.fieldName = field.name;
      input.required = !!field.required;
      input.autocomplete = 'off';
      input.spellcheck = false;
      customFormEl.insertBefore(input, actions);
    }

    customFormEl.classList.add('visible');
    customFormEl.querySelector('.custom-field')?.focus();
  }

  async function submitCustomForm() {
    const values = {};
    let command;
    let result;

    if (!pendingCustomCommand) {
      return;
    }

    for (const input of customFormEl.querySelectorAll('.custom-field')) {
      if (input.required && !input.value.trim()) {
        showToast(`"${input.placeholder}" is required.`, 'error');
        input.focus();
        return;
      }
      values[input.dataset.fieldName] = input.value.trim();
    }

    try {
      command = pendingCustomCommand.buildCommand(values);
    } catch (err) {
      showToast(err.message || 'Invalid custom command.', 'error');
      return;
    }

    result = await sendCmd(command);
    if (result !== undefined) {
      closeCustomForm();
    }
  }

  function setConn(value) {
    connected = value;
    dotEl.className = 'board-status-dot ' + (value ? 'connected' : 'disconnected');
    connectBtnEl.textContent = value ? 'Disconnect' : 'Connect';
    connectBtnEl.classList.toggle('connected', value);
    sendBtnEl.disabled = !value;
    if (!value) {
      boardProfile = null;
      caps = new Set();
      mode = 'protocol';
      streaming = new Set();
      lastResult = null;
      lastEvent = null;
      lastHeartbeatAt = null;
      closeCustomForm();
    }
    renderMeta();
    syncPresetButtons();
    onStateChange();
  }

  function isProtocolSupported(protoId) {
    return connected && boardProfile?.available && caps.has(PROTOCOLS[protoId].domainCap);
  }

  function isCommandSupported(protoId, command) {
    if (!isProtocolSupported(protoId)) {
      return false;
    }
    if (!command.requiredCap) {
      return true;
    }
    return caps.has(command.requiredCap);
  }

  function getCommandDisabledReason(protoId, command) {
    if (!connected) {
      return 'Connect this board first.';
    }
    if (mode === 'legacy') {
      return 'Exit legacy mode before using protocol presets.';
    }
    if (!boardProfile?.available) {
      return 'Waiting for this board profile handshake.';
    }
    if (!isProtocolSupported(protoId)) {
      return 'Not supported by this board.';
    }
    if (command.requiredCap && !caps.has(command.requiredCap)) {
      return 'Feature not supported by this board.';
    }
    return '';
  }

  function syncPresetButtons() {
    presetsEl.querySelectorAll('.board-preset').forEach(btn => {
      const protoId = dualState.activeProto;
      const command = protoId ? PROTOCOLS[protoId].commands[parseInt(btn.dataset.commandIndex, 10)] : null;

      if (!command) {
        btn.disabled = true;
        btn.title = '';
        return;
      }

      btn.disabled = !(connected && mode !== 'legacy' && isCommandSupported(protoId, command));
      btn.title = getCommandDisabledReason(protoId, command);
    });

    if (
      pendingCustomCommand
      && (!dualState.activeProto || getCommandDisabledReason(dualState.activeProto, pendingCustomCommand))
    ) {
      closeCustomForm();
    }
  }

  function renderMeta() {
      const status = describeBoardStatus({
        connected,
        profile: boardProfile,
        mode,
      caps,
      activeProto: dualState.activeProto,
      lastResult,
      lastEvent,
      streaming,
      lastHeartbeatAt,
    });

      statusPrimaryEl.textContent = status.primary.text;
      statusPrimaryEl.className = `board-status-text ${status.primary.tone}`;
      statusDetailEl.textContent = status.detail.text;
    statusDetailEl.className = `board-status-text ${status.detail.tone}`;
  }

  function setBoardProfile(profile) {
    boardProfile = profile;
    caps = capsFromProfile(profile);
    if (profile?.available) {
      mode = 'protocol';
    }
    renderMeta();
    syncPresetButtons();
    onStateChange();
  }

  function updateModeFromFrame(parsed) {
    if (parsed.domain !== 'SYS' || parsed.type !== 'INFO') {
      return;
    }
    if (parsed.payload.includes('mode=legacy')) {
      mode = 'legacy';
      return;
    }
    if (parsed.payload.includes('mode=protocol') || parsed.payload.includes('proto=')) {
      mode = 'protocol';
    }
  }

  function updateStreamState(parsed) {
    const fields = parseKeyValuePayload(parsed.payload);

    if (parsed.domain === 'UART') {
      if (parsed.event === 'DATA') {
        streaming.add('UART');
      } else if (fields.streaming === '1') {
        streaming.add('UART');
      } else if (fields.streaming === '0') {
        streaming.delete('UART');
      }
    }

    if (parsed.domain === 'CANFD') {
      if (parsed.event === 'FRAME') {
        streaming.add('CANFD');
        if (isHeartbeatFrame(parsed)) {
          lastHeartbeatAt = Date.now();
        }
      } else if (fields.monitoring === '1') {
        streaming.add('CANFD');
      } else if (fields.monitoring === '0') {
        streaming.delete('CANFD');
      }
    }
  }

  function handleBoardFrame({ raw, parsed, localTimeout = false, handshake = false }) {
    const frame = parsed ?? parseLine(raw);
    const tone = getFrameTone(frame, localTimeout);

    if (!frame) {
      term.append(raw || '(empty)', 'RAW');
      term.trim(settings.maxLines);
      return;
    }

    if (isHeartbeatFrame(frame)) {
      updateStreamState(frame);
      renderMeta();
      onStateChange();
      return;
    }

    term.append(formatTerminalFrameText(raw, frame), tone);
    term.trim(settings.maxLines);

    if (isLog(frame)) {
      return;
    }

    updateModeFromFrame(frame);
    updateStreamState(frame);

    if (frame.kind === 'event') {
      lastEvent = {
        domain: frame.domain,
        event: frame.event,
        payload: frame.payload,
      };
    }

    if ((frame.status || (frame.domain === 'SYS' && frame.type === 'INFO')) && !handshake) {
      lastResult = {
        label: frame.status || frame.event || frame.type,
        status: frame.status || null,
        tone: (frame.status || frame.event || frame.type || 'default').toLowerCase(),
        localTimeout,
        domain: frame.domain,
        payload: frame.payload,
      };
    }

    renderMeta();
    onStateChange();
  }

  function buildPresets(protoId) {
    const proto = protoId ? PROTOCOLS[protoId] : null;

    presetsEl.innerHTML = '';
    closeCustomForm();
    if (!proto) {
      return;
    }

    proto.commands.forEach((cmd, index) => {
      const btn = document.createElement('button');

      btn.className = 'board-preset';
      btn.type = 'button';
      btn.textContent = cmd.label;
      btn.dataset.commandIndex = String(index);
      btn.disabled = !(connected && mode !== 'legacy' && isCommandSupported(protoId, cmd));
      btn.title = getCommandDisabledReason(protoId, cmd);
      if (cmd.custom) {
        btn.addEventListener('click', () => openCustomForm(cmd));
      } else {
        btn.addEventListener('click', () => sendCmd(cmd.command));
      }
      presetsEl.appendChild(btn);
    });
  }

  async function sendCmd(command) {
    let result;

    if (!connected) {
      return;
    }

    term.append(`> ${command}`, 'INIT');
    term.trim(settings.maxLines);

    try {
      result = await apiSend({ command });
    } catch {
      result = { success: false, error: 'IPC error' };
    }

    if (!result.success) {
      term.append(`Send rejected: ${result.error || 'unknown error'}`, 'FAIL');
      term.trim(settings.maxLines);
    }

    return result;
  }

  connectBtnEl.addEventListener('click', async () => {
    let portPath;
    let result;

    if (connected) {
      try {
        await apiDisconnect();
      } catch {
        // no-op
      }
      setConn(false);
      setBoardProfile(null);
      term.append('Disconnected by user.', 'INIT');
      syncPortExclusions();
      return;
    }

    portPath = portEl.value;
    if (!portPath) {
      showToast('Select a port first.', 'error');
      return;
    }

    try {
      result = await apiConnect({ path: portPath, baudRate: settings.baud });
    } catch {
      result = { success: false, error: 'IPC error' };
    }

    if (!result.success) {
      showToast(`Connect failed: ${result.error || 'unknown error'}`, 'error');
    }
    syncPortExclusions();
  });

  sendBtnEl.addEventListener('click', () => {
    const cmd = rawEl.value.trim();
    if (!cmd || !connected) {
      return;
    }
    sendCmd(cmd);
    rawEl.value = '';
  });

  rawEl.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      sendBtnEl.click();
    }
  });

  customSendBtnEl.addEventListener('click', () => {
    submitCustomForm();
  });

  customCancelBtnEl.addEventListener('click', () => {
    closeCustomForm();
  });

  customFormEl.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      submitCustomForm();
    }
  });

  function wireIpc() {
    unsubs.forEach(fn => fn());
    unsubs = [];

    unsubs.push(
      onData(payload => handleBoardFrame(payload)),
      onConnectionStatus(({ connected: value, port, baud }) => {
        setConn(value);
        term.append(value ? `Connected to ${port} @ ${baud}` : 'Connection lost.', 'INIT');
        term.trim(settings.maxLines);
        if (!value) {
          setBoardProfile(null);
        }
        syncPortExclusions();
      }),
      onBoardProfile(profile => {
        setBoardProfile(profile);
      }),
    );
  }

  return {
    id,
    wireIpc,
    buildPresets,
    sendCommand: sendCmd,
    getSnapshot() {
      return {
        connected,
        profile: boardProfile,
        caps,
        mode,
        streaming,
        lastResult,
      };
    },
  };
}

const boardCtrlA = makeBoardController({
  id: 'A',
  termEl: $('board-a-terminal'),
  dotEl: document.querySelector('#board-a .board-status-dot'),
  portEl: boardAPortSelect,
  connectBtnEl: $('btn-board-a-connect'),
  presetsEl: $('board-a-presets'),
  customFormEl: $('board-a-custom-form'),
  customSendBtnEl: $('btn-board-a-custom-send'),
  customCancelBtnEl: $('btn-board-a-custom-cancel'),
  rawEl: $('board-a-raw'),
  sendBtnEl: $('btn-board-a-send'),
  statusPrimaryEl: $('board-a-status-primary'),
  statusDetailEl: $('board-a-status-detail'),
  apiConnect: payload => window.electronAPI.connectBoardA(payload),
  apiDisconnect: () => window.electronAPI.disconnectBoardA(),
  apiSend: payload => window.electronAPI.sendBoardA(payload),
  onData: cb => window.electronAPI.onDataBoardA(cb),
  onConnectionStatus: cb => window.electronAPI.onConnectionStatusBoardA(cb),
  onBoardProfile: cb => window.electronAPI.onBoardProfileBoardA(cb),
  onStateChange: () => updateDualState(),
});

const boardCtrlB = makeBoardController({
  id: 'B',
  termEl: $('board-b-terminal'),
  dotEl: document.querySelector('#board-b .board-status-dot'),
  portEl: boardBPortSelect,
  connectBtnEl: $('btn-board-b-connect'),
  presetsEl: $('board-b-presets'),
  customFormEl: $('board-b-custom-form'),
  customSendBtnEl: $('btn-board-b-custom-send'),
  customCancelBtnEl: $('btn-board-b-custom-cancel'),
  rawEl: $('board-b-raw'),
  sendBtnEl: $('btn-board-b-send'),
  statusPrimaryEl: $('board-b-status-primary'),
  statusDetailEl: $('board-b-status-detail'),
  apiConnect: payload => window.electronAPI.connectBoardB(payload),
  apiDisconnect: () => window.electronAPI.disconnectBoardB(),
  apiSend: payload => window.electronAPI.sendBoardB(payload),
  onData: cb => window.electronAPI.onDataBoardB(cb),
  onConnectionStatus: cb => window.electronAPI.onConnectionStatusBoardB(cb),
  onBoardProfile: cb => window.electronAPI.onBoardProfileBoardB(cb),
  onStateChange: () => updateDualState(),
});

function buildDualProtoBar() {
  const sharedProtocols = computeSharedProtocols(
    boardCtrlA.getSnapshot().profile,
    boardCtrlB.getSnapshot().profile
  );

  dualProtoBtns.innerHTML = '';
  for (const id of PROTOCOL_ORDER) {
    const btn = document.createElement('button');
    const enabled = sharedProtocols.includes(id);
    const title = enabled
      ? ''
      : 'Shared controls unlock only when both boards report support for this protocol.';

    btn.className = 'dual-proto-btn';
    btn.type = 'button';
    btn.textContent = PROTOCOLS[id].label;
    btn.dataset.proto = id;
    btn.disabled = !enabled;
    btn.title = title;
    btn.classList.toggle('active', id === dualState.activeProto);
    btn.addEventListener('click', () => setDualProtocol(id));
    dualProtoBtns.appendChild(btn);
  }
}

function setDualProtocol(id) {
  if (!computeSharedProtocols(boardCtrlA.getSnapshot().profile, boardCtrlB.getSnapshot().profile).includes(id)) {
    return;
  }
  dualState.activeProto = id;
  dualProtoBtns.querySelectorAll('.dual-proto-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.proto === id);
  });
  boardCtrlA.buildPresets(id);
  boardCtrlB.buildPresets(id);
  buildDualSharedPresets();
  renderDualWarnings();
}

function buildDualSharedPresets() {
  const boardA = boardCtrlA.getSnapshot();
  const boardB = boardCtrlB.getSnapshot();
  const protoId = dualState.activeProto;
  const proto = protoId ? PROTOCOLS[protoId] : null;

  dualSharedPresets.innerHTML = '';
  if (!proto) {
    return;
  }

  for (const command of proto.commands.filter(entry => !entry.custom)) {
    const reason = getDualCommandDisabledReason(protoId, command, boardA, boardB);
    const btn = document.createElement('button');

    btn.className = 'dual-shared-preset';
    btn.type = 'button';
    btn.textContent = command.label;
    btn.disabled = !!reason;
    btn.title = reason;
    btn.addEventListener('click', () => sendSharedCommand(command.command));
    dualSharedPresets.appendChild(btn);
  }
}

function renderDualWarnings() {
  const warnings = computeDualWarnings(
    boardCtrlA.getSnapshot(),
    boardCtrlB.getSnapshot(),
    dualState.activeProto
  );

  if (!warnings.length) {
    const ok = document.createElement('span');
    ok.className = 'dual-warning ok';
    ok.textContent = 'Both boards are aligned for the selected protocol.';
    dualWarningItems.innerHTML = '';
    dualWarningItems.appendChild(ok);
    return;
  }

  dualWarningItems.innerHTML = '';
  for (const warning of warnings) {
    const badge = document.createElement('span');
    badge.className = 'dual-warning';
    badge.textContent = warning;
    dualWarningItems.appendChild(badge);
  }
}

function updateDualState() {
  const boardA = boardCtrlA.getSnapshot();
  const boardB = boardCtrlB.getSnapshot();
  const sharedProtocols = computeSharedProtocols(boardA.profile, boardB.profile);

  dualState.sharedCaps = computeSharedCaps(boardA.profile, boardB.profile);
  if (!sharedProtocols.includes(dualState.activeProto)) {
    dualState.activeProto = sharedProtocols[0] || null;
  }

  buildDualProtoBar();
  boardCtrlA.buildPresets(dualState.activeProto);
  boardCtrlB.buildPresets(dualState.activeProto);
  buildDualSharedPresets();
  renderDualWarnings();
}

async function sendSharedCommand(command) {
  const boardA = boardCtrlA.getSnapshot();
  const boardB = boardCtrlB.getSnapshot();

  if (!boardA.connected || !boardB.connected) {
    showToast('Connect both boards before sending a shared command.', 'error');
    return false;
  }

  await Promise.allSettled([
    boardCtrlA.sendCommand(command),
    boardCtrlB.sendCommand(command),
  ]);
  return true;
}

const SETTINGS_KEY = 'sailbot-devboard-settings';
const ACCENT_THEMES = {
  blue: { color: '#4a90e2', hover: '#357abd', soft: 'rgba(74, 144, 226, 0.08)' },
  cyan: { color: '#2aa7b8', hover: '#1f8694', soft: 'rgba(42, 167, 184, 0.10)' },
  green: { color: '#2f9e6f', hover: '#257f59', soft: 'rgba(47, 158, 111, 0.10)' },
  orange: { color: '#d97a28', hover: '#b7641e', soft: 'rgba(217, 122, 40, 0.12)' },
  rose: { color: '#c65b7c', hover: '#a64967', soft: 'rgba(198, 91, 124, 0.12)' },
};
const settings = Object.assign({
  dark: false,
  accent: 'blue',
  terminalTheme: 'dark',
  timestamps: true,
  showTerminalStatus: true,
  maxLines: 200,
  autoReconnect: true,
  autoReloadPorts: false,
  baud: 115200,
  settingsTab: 'general',
}, (() => {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
  } catch {
    return {};
  }
})());

function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function applyAccentTheme(name) {
  const accentName = ACCENT_THEMES[name] ? name : 'blue';
  const accent = ACCENT_THEMES[accentName];
  document.documentElement.style.setProperty('--accent-color', accent.color);
  document.documentElement.style.setProperty('--accent-hover', accent.hover);
  document.documentElement.style.setProperty('--accent-soft', accent.soft);
  accentPresetButtons.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.accent === accentName);
  });
}

function applyTerminalTheme(name) {
  const mode = name === 'light' ? 'light' : 'dark';
  document.body.classList.toggle('terminal-light', mode === 'light');
  terminalThemeButtons.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.terminalTheme === mode);
  });
}

const AUTO_PORT_REFRESH_MS = 3000;
let autoPortRefreshHandle = null;

function syncAutoPortRefresh() {
  if (autoPortRefreshHandle) {
    clearInterval(autoPortRefreshHandle);
    autoPortRefreshHandle = null;
  }

  if (!settings.autoReloadPorts) {
    return;
  }

  autoPortRefreshHandle = setInterval(() => {
    refreshAvailablePorts({ silent: true });
  }, AUTO_PORT_REFRESH_MS);
}

function setSettingsTab(name) {
  const activeName = settingsTabs.some(tab => tab.dataset.settingsTab === name) ? name : 'general';

  settings.settingsTab = activeName;
  settingsTabs.forEach(tab => {
    const active = tab.dataset.settingsTab === activeName;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
  });

  settingsTabPanels.forEach(panel => {
    const active = panel.dataset.settingsPanel === activeName;
    panel.classList.toggle('active', active);
    panel.hidden = !active;
  });
}

function applySettings() {
  document.body.classList.toggle('dark', settings.dark);
  toggleDarkMode.checked = settings.dark;
  applyAccentTheme(settings.accent || 'blue');
  applyTerminalTheme(settings.terminalTheme || 'dark');

  terminalEl.classList.toggle('no-timestamps', !settings.timestamps);
  toggleTimestamps.checked = settings.timestamps;
  toggleTerminalStatus.checked = settings.showTerminalStatus !== false;

  selMaxLines.value = String(settings.maxLines);
  terminal.trim(settings.maxLines);

  toggleAutoRecon.checked = settings.autoReconnect;
  toggleAutoPortRefresh.checked = !!settings.autoReloadPorts;
  document.querySelectorAll('.btn-baud-preset').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.dataset.baud, 10) === settings.baud);
  });
  setSettingsTab(settings.settingsTab || 'general');
  syncAutoPortRefresh();
}

function setView(name) {
  state.view = name;
  document.body.classList.toggle('view-visual', name === 'visual');
  document.body.classList.toggle('view-terminal', name === 'terminal');
  document.body.classList.toggle('view-dual', name === 'dual');
  syncReconnectBanner();
  viewBtns.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === name);
  });

  if (name === 'visual' && state.connected && !visualView._activeProto) {
    visualView.show(state.activeProto || getFirstSupportedProtocol() || 'UART');
  }
  if (name === 'dual') {
    updateDualState();
  }
}

function closeSettingsPanel() {
  settingsPanel.classList.remove('visible');
  btnSettings.classList.remove('active');
  btnSettings.setAttribute('aria-expanded', 'false');
}

viewBtns.forEach(btn => {
  btn.addEventListener('click', () => setView(btn.dataset.view));
});

btnSettings.addEventListener('click', e => {
  e.stopPropagation();
  const open = !settingsPanel.classList.contains('visible');
  if (open) {
    settingsPanel.classList.add('visible');
  } else {
    closeSettingsPanel();
  }
  btnSettings.classList.toggle('active', open);
  btnSettings.setAttribute('aria-expanded', String(open));
  if (open) {
    setSettingsTab(settings.settingsTab || 'general');
  }
});

btnSettingsClose.addEventListener('click', e => {
  e.stopPropagation();
  closeSettingsPanel();
});

document.addEventListener('click', e => {
  if (!settingsPanel.contains(e.target) && e.target !== btnSettings) {
    closeSettingsPanel();
  }
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && settingsPanel.classList.contains('visible')) {
    closeSettingsPanel();
  }
});

toggleDarkMode.addEventListener('change', () => {
  settings.dark = toggleDarkMode.checked;
  document.body.classList.toggle('dark', settings.dark);
  saveSettings();
});

accentPresetButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    settings.accent = btn.dataset.accent || 'blue';
    applyAccentTheme(settings.accent);
    saveSettings();
  });
});

terminalThemeButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    settings.terminalTheme = btn.dataset.terminalTheme === 'light' ? 'light' : 'dark';
    applyTerminalTheme(settings.terminalTheme);
    saveSettings();
  });
});

toggleTimestamps.addEventListener('change', () => {
  settings.timestamps = toggleTimestamps.checked;
  terminalEl.classList.toggle('no-timestamps', !settings.timestamps);
  saveSettings();
});

toggleTerminalStatus.addEventListener('change', () => {
  settings.showTerminalStatus = toggleTerminalStatus.checked;
  saveSettings();
});

selMaxLines.addEventListener('change', () => {
  settings.maxLines = parseInt(selMaxLines.value, 10);
  terminal.trim(settings.maxLines);
  saveSettings();
});

toggleAutoRecon.addEventListener('change', async () => {
  settings.autoReconnect = toggleAutoRecon.checked;
  saveSettings();
  try {
    await window.electronAPI.setAutoReconnect(settings.autoReconnect);
  } catch {
    // no-op
  }
});

toggleAutoPortRefresh.addEventListener('change', () => {
  settings.autoReloadPorts = toggleAutoPortRefresh.checked;
  saveSettings();
  syncAutoPortRefresh();
  if (settings.autoReloadPorts) {
    refreshAvailablePorts({ silent: true });
  }
});

document.querySelectorAll('.btn-baud-preset').forEach(btn => {
  btn.addEventListener('click', () => {
    settings.baud = parseInt(btn.dataset.baud, 10);
    saveSettings();
    document.querySelectorAll('.btn-baud-preset').forEach(other => {
      other.classList.toggle('active', other === btn);
    });
  });
});

settingsTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    setSettingsTab(tab.dataset.settingsTab);
    saveSettings();
  });

  tab.addEventListener('keydown', event => {
    const currentIndex = settingsTabs.indexOf(tab);
    if (currentIndex === -1) {
      return;
    }

    let nextIndex = null;
    if (event.key === 'ArrowRight') {
      nextIndex = (currentIndex + 1) % settingsTabs.length;
    } else if (event.key === 'ArrowLeft') {
      nextIndex = (currentIndex - 1 + settingsTabs.length) % settingsTabs.length;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = settingsTabs.length - 1;
    }

    if (nextIndex == null) {
      return;
    }

    event.preventDefault();
    const nextTab = settingsTabs[nextIndex];
    setSettingsTab(nextTab.dataset.settingsTab);
    saveSettings();
    nextTab.focus();
  });
});

function showToast(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast${type === 'error' ? ' error' : ''}`;
  el.textContent = msg;
  toastContainer.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

function flashExportBtn(btn, success) {
  const cls = success ? 'flash-success' : 'flash-error';
  btn.classList.add(cls);
  setTimeout(() => btn.classList.remove(cls), 1300);
}

function resetProtocolBadges() {
  for (const id of PROTOCOL_ORDER) {
    setBadge(id, null);
  }
}

function resetResultPanel() {
  resProto.textContent = '-';
  resData.textContent = '-';
  resRtt.textContent = '-';
  resCanId.textContent = '-';
  resDlc.textContent = '-';
  resCanGroup.classList.add('hidden');
  resDlcGroup.classList.add('hidden');
  resStatus.innerHTML = '<span class="status-badge default">-</span>';
  btnRetry.classList.remove('visible');
}

function setConnected(connected) {
  state.connected = connected;
  statusDot.className = connected ? 'connected' : 'disconnected';
  btnConnect.textContent = connected ? 'Disconnect' : 'Connect';
  btnConnect.classList.toggle('connected', connected);
  syncReconnectBanner(!connected);
  if (connected) {
    reconnectCounter.textContent = '';
  } else {
    state.pendingCustomCommand = null;
    resetResultPanel();
    resetProtocolBadges();
  }
  [btnBoardPing, btnBoardRefreshProfile, btnBoardLegacy, btnBoardResetMode].forEach(btn => {
    btn.disabled = !connected;
  });
  syncAllControls();
}

function setBoardProfile(profile) {
  state.boardProfile = profile;
  state.caps = capsFromProfile(profile);
  visualView.setCapabilities(profile?.available ? [...state.caps] : null);

  if (state.activeProto && !isProtocolSupported(state.activeProto)) {
    state.activeProto = null;
    presetButtons.innerHTML = '';
    customForm.classList.remove('visible');
    vizPanel.classList.add('hidden');
  }

  if (state.connected && !state.activeProto) {
    const first = getFirstSupportedProtocol();
    if (first) {
      setActiveProtocol(first);
    }
  }

  syncAllControls();
}

function isProtocolSupported(protoId) {
  const proto = PROTOCOLS[protoId];
  if (!proto || !state.connected || !state.boardProfile?.available) {
    return false;
  }
  return state.caps.has(proto.domainCap);
}

function isCommandSupported(protoId, command) {
  if (!isProtocolSupported(protoId)) {
    return false;
  }
  if (!command.requiredCap) {
    return true;
  }
  return state.caps.has(command.requiredCap);
}

function getCommandDisabledReason(protoId, command) {
  if (!state.connected) {
    return 'Connect to the board first.';
  }
  if (!state.boardProfile?.available) {
    return 'Waiting for board profile handshake.';
  }
  if (!isProtocolSupported(protoId)) {
    return 'Not supported by connected firmware.';
  }
  if (command.requiredCap && !state.caps.has(command.requiredCap)) {
    return 'Feature not supported by connected firmware.';
  }
  return '';
}

function getFirstSupportedProtocol() {
  return PROTOCOL_ORDER.find(isProtocolSupported) || null;
}

function buildSidebar() {
  const title = $('sidebar-title');

  sidebar.innerHTML = '';
  sidebar.appendChild(title);

  for (const id of PROTOCOL_ORDER) {
    const row = document.createElement('div');
    const name = document.createElement('span');
    const badge = document.createElement('span');

    row.className = 'proto-row disabled';
    row.dataset.proto = id;
    row.setAttribute('role', 'button');
    row.setAttribute('tabindex', '0');
    row.setAttribute('aria-label', `${PROTOCOLS[id].label} protocol`);

    name.textContent = PROTOCOLS[id].label;
    badge.className = 'proto-badge gray';
    badge.id = `badge-${id}`;
    badge.textContent = '-';

    row.appendChild(name);
    row.appendChild(badge);
    sidebar.appendChild(row);

    row.addEventListener('click', () => {
      if (isProtocolSupported(id)) {
        setActiveProtocol(id);
      }
    });
    row.addEventListener('keydown', e => {
      if ((e.key === 'Enter' || e.key === ' ') && isProtocolSupported(id)) {
        e.preventDefault();
        setActiveProtocol(id);
      }
    });
  }
}

function setBadge(protoId, statusKey) {
  const el = document.getElementById(`badge-${protoId}`);
  const classMap = { PASS: 'pass', FAIL: 'fail', TIMEOUT: 'timeout' };
  const textMap = { PASS: 'PASS', FAIL: 'FAIL', TIMEOUT: 'TMOUT' };

  if (!el) {
    return;
  }

  el.className = 'proto-badge ' + (classMap[statusKey] || 'gray');
  el.textContent = textMap[statusKey] || '-';
}

function syncSidebarEnabled() {
  document.querySelectorAll('.proto-row').forEach(row => {
    const supported = isProtocolSupported(row.dataset.proto);
    let title = '';

    if (!supported) {
      if (!state.connected) {
        title = 'Connect to the board first.';
      } else if (!state.boardProfile?.available) {
        title = 'Waiting for board profile handshake.';
      } else {
        title = 'Not supported by connected firmware.';
      }
    }

    row.classList.toggle('disabled', !supported);
    row.classList.toggle('unsupported', state.connected && state.boardProfile?.available && !supported);
    row.title = title;
  });
}

function setActiveProtocol(id) {
  if (!isProtocolSupported(id)) {
    return;
  }

  state.activeProto = id;
  document.querySelectorAll('.proto-row').forEach(row => {
    row.classList.toggle('active', row.dataset.proto === id);
  });

  buildCommandBar(id);
  vizPanel.classList.remove('hidden');
  charts.show(id);

  if (state.view === 'visual') {
    visualView.show(id);
  }
}

function buildCommandBar(protoId) {
  const proto = PROTOCOLS[protoId];

  presetButtons.innerHTML = '';
  customForm.classList.remove('visible');
  state.pendingCustomCommand = null;

  Array.from(customForm.children).forEach(child => {
    if (child.id !== 'btn-custom-send') {
      child.remove();
    }
  });

  for (const cmd of proto.commands) {
    const enabled = state.connected && isCommandSupported(protoId, cmd);
    const btn = document.createElement('button');

    btn.className = 'btn-preset' + (enabled ? '' : ' locked');
    btn.type = 'button';
    btn.textContent = cmd.label;
    btn.disabled = !enabled;
    btn.title = getCommandDisabledReason(protoId, cmd);

    if (cmd.custom) {
      btn.addEventListener('click', () => openCustomForm(cmd));
    } else {
      btn.addEventListener('click', () => sendCommand(cmd.command));
    }
    presetButtons.appendChild(btn);
  }
}

function openCustomForm(commandDef) {
  state.pendingCustomCommand = commandDef;

  Array.from(customForm.children).forEach(child => {
    if (child.id !== 'btn-custom-send') {
      child.remove();
    }
  });

  for (const field of commandDef.fields) {
    const input = document.createElement('input');
    input.className = 'custom-field';
    input.type = 'text';
    input.placeholder = field.placeholder;
    input.dataset.fieldName = field.name;
    input.required = !!field.required;
    input.autocomplete = 'off';
    input.spellcheck = false;
    customForm.insertBefore(input, btnCustomSend);
  }

  customForm.classList.add('visible');
  customForm.querySelector('.custom-field')?.focus();
}

btnCustomSend.addEventListener('click', () => {
  const values = {};
  let command;

  if (!state.pendingCustomCommand) {
    return;
  }

  for (const input of customForm.querySelectorAll('.custom-field')) {
    if (input.required && !input.value.trim()) {
      showToast(`"${input.placeholder}" is required.`, 'error');
      input.focus();
      return;
    }
    values[input.dataset.fieldName] = input.value.trim();
  }

  try {
    command = state.pendingCustomCommand.buildCommand(values);
  } catch (err) {
    showToast(err.message || 'Invalid custom command.', 'error');
    return;
  }

  sendCommand(command);
  customForm.classList.remove('visible');
  state.pendingCustomCommand = null;
});

function syncCommandBarEnabled() {
  btnSend.disabled = !state.connected;

  document.querySelectorAll('.btn-preset').forEach((btn, index) => {
    const command = state.activeProto ? PROTOCOLS[state.activeProto].commands[index] : null;
    const enabled = !!command && state.connected && isCommandSupported(state.activeProto, command);
    btn.disabled = !enabled;
    btn.classList.toggle('locked', !enabled);
    btn.title = command ? getCommandDisabledReason(state.activeProto, command) : '';
  });
}

function syncAllControls() {
  syncSidebarEnabled();
  syncCommandBarEnabled();
  visualView.setConnected(state.connected);
}

btnSend.addEventListener('click', () => {
  const cmd = rawInput.value.trim();
  if (!cmd || !state.connected) {
    return;
  }
  sendCommand(cmd);
  rawInput.value = '';
});

rawInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    btnSend.click();
  }
});

async function sendCommand(command) {
  let result;

  if (!state.connected) {
    return;
  }

  state.lastCommand = command;
  terminal.append(`> ${command}`, 'INIT');
  terminal.trim(settings.maxLines);

  try {
    result = await window.electronAPI.send({ command });
  } catch {
    result = { success: false, error: 'IPC error' };
  }

  if (!result.success) {
    terminal.append(`Send rejected: ${result.error || 'unknown error'}`, 'FAIL');
    terminal.trim(settings.maxLines);
    showToast(result.error || 'Send failed.', 'error');
  }

  if (result.success) {
    btnRetry.classList.add('visible');
  }
  return result;
}

async function sendSystemCommand(command, successMessage) {
  let result;

  if (!state.connected) {
    showToast('Connect to the board first.', 'error');
    return;
  }

  result = await sendCommand(command);
  if (result?.success && successMessage) {
    showToast(successMessage);
  }
}

btnRetry.addEventListener('click', () => {
  if (state.lastCommand) {
    sendCommand(state.lastCommand);
  }
});

btnBoardPing.addEventListener('click', () => {
  sendSystemCommand('SYS:PING', 'Sent SYS:PING');
});

btnBoardRefreshProfile.addEventListener('click', () => {
  sendSystemCommand('SYS:HELLO', 'Refreshing board profile');
});

btnBoardLegacy.addEventListener('click', () => {
  sendSystemCommand('SYS:MODE:LEGACY', 'Requested legacy mode');
});

btnBoardResetMode.addEventListener('click', () => {
  sendSystemCommand('SYS:RESET', 'Requested protocol mode');
});

function updateResultPanel(parsed, rtt, localTimeout) {
  const canFrame = parsed.domain === 'CANFD' ? parseCanFrame(parsed.payload) : { id: null, dlc: null };
  const badge = document.createElement('span');

  resProto.textContent = parsed.domain;
  resRtt.textContent = rtt != null ? `${rtt} ms` : '-';
  resData.textContent = parsed.payload || '(empty)';

  badge.className = `status-badge ${localTimeout ? 'host-timeout' : parsed.status.toLowerCase()}`;
  badge.textContent = localTimeout ? 'HOST TIMEOUT' : parsed.status;
  resStatus.innerHTML = '';
  resStatus.appendChild(badge);

  resCanGroup.classList.toggle('hidden', parsed.domain !== 'CANFD');
  resDlcGroup.classList.toggle('hidden', parsed.domain !== 'CANFD');
  if (parsed.domain === 'CANFD') {
    resCanId.textContent = canFrame.id != null ? `0x${canFrame.id.toString(16).toUpperCase()}` : '-';
    resDlc.textContent = canFrame.dlc != null ? String(canFrame.dlc) : '-';
  }

  btnRetry.classList.toggle('visible', localTimeout || parsed.status === 'FAIL' || parsed.status === 'TIMEOUT');
}

function handleDirectData({ raw, parsed, rtt, localTimeout, handshake }) {
  if (!parsed) {
    terminal.append(raw || '(empty)', 'RAW');
    terminal.trim(settings.maxLines);
    return;
  }

  terminal.append(formatTerminalFrameText(raw, parsed), localTimeout ? 'TIMEOUT' : (parsed.status || 'INIT'));
  terminal.trim(settings.maxLines);

  if (parsed.domain === 'SYS' && parsed.type === 'INFO') {
    if (!handshake) {
      updateResultPanel(parsed, rtt, !!localTimeout);
    }
    return;
  }

  if (parsed.status === 'PASS' || parsed.status === 'FAIL' || parsed.status === 'TIMEOUT') {
    setBadge(parsed.domain, parsed.status);
    charts.push(parsed.domain, { status: parsed.status, data: parsed.payload, rtt });
    visualView.push(parsed.domain, { status: parsed.status, data: parsed.payload, rtt });
    updateResultPanel(parsed, rtt, !!localTimeout);
  }
}

function handleStreamEvent({ raw, parsed, rtt }) {
  if (!parsed) {
    return;
  }

  if (isHeartbeatFrame(parsed)) {
    state.lastHeartbeatAt = Date.now();
    return;
  }

  terminal.append(formatTerminalFrameText(raw, parsed), 'INIT');
  terminal.trim(settings.maxLines);
  charts.push(parsed.domain, { status: parsed.event, data: parsed.payload, rtt });
  visualView.push(parsed.domain, { status: parsed.event, data: parsed.payload, rtt });
}

function handleLogFrame({ raw }) {
  terminal.append(raw || '(log)', 'RAW');
  terminal.trim(settings.maxLines);
}

btnExportLog.addEventListener('click', async () => {
  let result;

  try {
    result = await window.electronAPI.exportLog();
  } catch {
    result = { success: false, error: 'IPC error' };
  }

  if (result.success) {
    flashExportBtn(btnExportLog, true);
    if (result.path) {
      sessionFilePath.textContent = result.path;
    }
    return;
  }

  flashExportBtn(btnExportLog, false);
  showToast(`Export failed: ${result.error || 'unknown'}`, 'error');
});

btnExportCsv.addEventListener('click', async () => {
  let result;

  try {
    result = await window.electronAPI.exportCsv();
  } catch {
    result = { success: false, error: 'IPC error' };
  }

  if (result.success) {
    flashExportBtn(btnExportCsv, true);
    if (result.path) {
      sessionFilePath.textContent = result.path;
    }
    return;
  }

  flashExportBtn(btnExportCsv, false);
  showToast(`Export failed: ${result.error || 'unknown'}`, 'error');
});

async function refreshPorts() {
  let ports;

  try {
    ports = await window.electronAPI.listPorts();
  } catch {
    ports = [];
  }

  function populate(select) {
    const current = select.value;
    select.innerHTML = '<option value="">- select port -</option>';
    for (const port of ports) {
      const opt = document.createElement('option');
      opt.value = port.path;
      opt.textContent = port.manufacturer ? `${port.path} | ${port.manufacturer}` : port.path;
      select.appendChild(opt);
    }
    if (ports.some(port => port.path === current)) {
      select.value = current;
    }
  }

  populate(portSelect);
  populate(boardAPortSelect);
  populate(boardBPortSelect);
  syncPortExclusions();
}

async function refreshAvailablePorts({ silent = false } = {}) {
  let ports;
  let loadError = null;

  try {
    ports = await window.electronAPI.listPorts();
  } catch (err) {
    ports = [];
    loadError = err;
  }

  function labelForPort(port) {
    if (port.friendlyName) {
      return `${port.path} | ${port.friendlyName}`;
    }
    if (port.manufacturer) {
      return `${port.path} | ${port.manufacturer}`;
    }
    return port.path;
  }

  function populate(select) {
    const current = select.value;
    const placeholder = document.createElement('option');

    placeholder.value = '';
    placeholder.textContent = ports.length ? '- select port -' : '- no ports detected -';
    select.replaceChildren(placeholder);

    for (const port of ports) {
      const opt = document.createElement('option');
      opt.value = port.path;
      opt.textContent = labelForPort(port);
      select.appendChild(opt);
    }

    if (ports.some(port => port.path === current)) {
      select.value = current;
    }
  }

  populate(portSelect);
  populate(boardAPortSelect);
  populate(boardBPortSelect);
  syncPortExclusions();

  if (loadError && !silent) {
    showToast(`Port enumeration failed: ${loadError.message || 'unknown error'}`, 'error');
    terminal.append(`Port enumeration failed: ${loadError.message || 'unknown error'}`, 'ERR');
    terminal.trim(settings.maxLines);
  }
}

btnRefreshPorts.addEventListener('click', () => refreshAvailablePorts());

btnConnect.addEventListener('click', async () => {
  let result;

  if (state.connected) {
    try {
      await window.electronAPI.disconnect();
    } catch {
      // no-op
    }
    return;
  }

  if (!portSelect.value) {
    showToast('Select a port first.', 'error');
    return;
  }

  try {
    result = await window.electronAPI.connect({ path: portSelect.value, baudRate: settings.baud });
  } catch {
    result = { success: false, error: 'IPC error' };
  }

  if (!result.success) {
    showToast(`Connect failed: ${result.error || 'unknown error'}`, 'error');
  }
});

function wireIpc() {
  state.unsubs.forEach(fn => fn());
  state.unsubs = [];

  state.unsubs.push(
    window.electronAPI.onData(handleDirectData),
    window.electronAPI.onStreamEvent(handleStreamEvent),
    window.electronAPI.onLog(handleLogFrame),
    window.electronAPI.onConnectionStatus(({ connected, port, baud }) => {
      setConnected(connected);
      terminal.append(connected ? `Connected to ${port} @ ${baud}` : 'Connection lost.', 'INIT');
      terminal.trim(settings.maxLines);
      if (!connected) {
        state.lastHeartbeatAt = null;
        setBoardProfile(null);
      }
    }),
    window.electronAPI.onBoardProfile(profile => {
      setBoardProfile(profile);
    }),
    window.electronAPI.onReconnectAttempt(({ attempt, max }) => {
      reconnectCounter.textContent = `(attempt ${attempt}/${max})`;
      syncReconnectBanner(true);
    }),
    window.electronAPI.onSessionPath(({ path }) => {
      sessionFilePath.textContent = path;
    }),
  );

  boardCtrlA.wireIpc();
  boardCtrlB.wireIpc();
}

async function syncAppVersion() {
  if (!titlebarVersion || !window.electronAPI?.getAppVersion) {
    return;
  }

  try {
    const version = await window.electronAPI.getAppVersion();
    if (version) {
      titlebarVersion.textContent = `Version ${version}`;
    }
  } catch {
    // Leave the existing titlebar text in place if the version bridge is unavailable.
  }
}

async function init() {
  setView('terminal');
  applySettings();
  setConnected(false);
  resetResultPanel();
  buildSidebar();
  setBoardProfile(null);
  updateDualState();
  await syncAppVersion();
  await refreshAvailablePorts();
  wireIpc();
  terminal.append('Ready. Select a port and connect.', 'INIT');
}

init();
