// frontend/protocols.js
// Canonical protocol metadata for renderer controls.
// Parsing lives in protocol-parser.cjs / protocol-parser.js.

function normalizeUpperHex(value) {
  return String(value ?? '').trim().replace(/\s+/g, '').toUpperCase();
}

const SPI_MAX_XFER_BYTES = 156;
const MAX_BINARY_PAYLOAD_BYTES = 256;
const MAX_CANFD_PAYLOAD_BYTES = 64;

function requireHex(value, fieldName) {
  const normalized = normalizeUpperHex(value);
  if (!/^[0-9A-F]+$/.test(normalized)) {
    throw new Error(`${fieldName} must be uppercase hex with no separators.`);
  }
  return normalized;
}

function requireBytePairs(value, fieldName, maxBytes) {
  const normalized = requireHex(value, fieldName);
  if (normalized.length % 2 !== 0) {
    throw new Error(`${fieldName} must contain whole bytes.`);
  }
  if ((normalized.length / 2) > maxBytes) {
    throw new Error(`${fieldName} exceeds the firmware byte limit.`);
  }
  return normalized;
}

function requireHexByte(value, fieldName) {
  const normalized = requireHex(value, fieldName);
  if (normalized.length !== 2) {
    throw new Error(`${fieldName} must be exactly one byte.`);
  }
  return normalized;
}

function requireHexU8(value, fieldName) {
  const normalized = requireHex(value, fieldName);
  const parsed = parseInt(normalized, 16);
  if (normalized.length > 2 || parsed > 0xFF) {
    throw new Error(`${fieldName} must fit in one byte.`);
  }
  return normalized;
}

function requireCanId(value, fieldName) {
  const normalized = requireHex(value, fieldName);
  const parsed = parseInt(normalized, 16);
  if (normalized.length > 3 || parsed > 0x7FF) {
    throw new Error(`${fieldName} must be a standard 11-bit CAN ID.`);
  }
  return normalized;
}

function requireDec(value, fieldName) {
  const normalized = String(value ?? '').trim();
  if (!/^\d+$/.test(normalized)) {
    throw new Error(`${fieldName} must be a decimal number.`);
  }
  return normalized;
}

export const PROTOCOLS = {
  UART: {
    id: 'UART',
    label: 'UART',
    chartType: 'line',
    domainCap: 'UART',
    commands: [
      {
        label: 'Init',
        command: 'UART:INIT',
        custom: false,
        desc: 'Initialise the UART bridge on the STM32 board.',
      },
      {
        label: 'Loop 0x41',
        command: 'UART:LOOP:41',
        custom: false,
        desc: 'Send one byte and verify the echo path is alive.',
      },
      {
        label: 'Start stream',
        command: 'UART:STREAM:START',
        custom: false,
        requiredCap: 'UART_STREAM',
        mode: 'stream',
        desc: 'Forward unsolicited UART RX bytes as UART:DATA frames.',
      },
      {
        label: 'Stop stream',
        command: 'UART:STREAM:STOP',
        custom: false,
        requiredCap: 'UART_STREAM',
        mode: 'stream',
        desc: 'Stop forwarding UART stream data.',
      },
      {
        label: 'Status',
        command: 'UART:STATUS',
        custom: false,
        desc: 'Read UART counters and error totals from firmware.',
      },
      {
        label: 'Loopback...',
        custom: true,
        desc: 'Send a custom loopback byte in hex.',
        fields: [
          { name: 'byte', placeholder: 'Byte (hex, e.g. A5)', required: true },
        ],
        buildCommand(values) {
          return `UART:LOOP:${requireHexByte(values.byte, 'Byte')}`;
        },
      },
    ],
  },
  SPI: {
    id: 'SPI',
    label: 'SPI',
    chartType: 'bar',
    domainCap: 'SPI',
    commands: [
      {
        label: 'Init',
        command: 'SPI:INIT',
        custom: false,
        desc: 'Initialise the SPI master interface.',
      },
      {
        label: 'WHO_AM_I',
        command: 'SPI:XFER:75FF',
        custom: false,
        desc: 'Issue a two-byte burst read commonly used for device ID checks.',
      },
      {
        label: 'Status',
        command: 'SPI:STATUS',
        custom: false,
        desc: 'Read SPI transfer counters from firmware.',
      },
      {
        label: 'Transfer...',
        custom: true,
        desc: 'Send a variable-length SPI burst as uppercase hex.',
        fields: [
          { name: 'tx', placeholder: 'TX bytes (hex, e.g. 75FF)', required: true },
        ],
        buildCommand(values) {
          return `SPI:XFER:${requireBytePairs(values.tx, 'TX bytes', SPI_MAX_XFER_BYTES)}`;
        },
      },
    ],
  },
  CANFD: {
    id: 'CANFD',
    label: 'CANFD',
    chartType: 'scatter',
    domainCap: 'CANFD',
    commands: [
      {
        label: 'Init',
        command: 'CANFD:INIT',
        custom: false,
        desc: 'Initialise the FDCAN controller and enable the bus interface.',
      },
      {
        label: 'Monitor start',
        command: 'CANFD:MONITOR:START',
        custom: false,
        requiredCap: 'CANFD_MONITOR',
        mode: 'stream',
        desc: 'Begin forwarding all received CAN FD frames to the GUI.',
      },
      {
        label: 'Monitor stop',
        command: 'CANFD:MONITOR:STOP',
        custom: false,
        requiredCap: 'CANFD_MONITOR',
        mode: 'stream',
        desc: 'Stop forwarding CAN FD monitor frames.',
      },
      {
        label: 'Status',
        command: 'CANFD:STATUS',
        custom: false,
        desc: 'Read controller error state and protocol status registers.',
      },
      {
        label: 'Send',
        custom: true,
        desc: 'Transmit a CAN FD frame with a custom standard ID and payload.',
        fields: [
          { name: 'id', placeholder: 'Frame ID (hex, e.g. 130)', required: true },
          { name: 'bytes', placeholder: 'Payload bytes (hex)', required: true },
        ],
        buildCommand(values) {
          return `CANFD:SEND:${requireCanId(values.id, 'Frame ID')}:${requireBytePairs(values.bytes, 'Payload bytes', MAX_CANFD_PAYLOAD_BYTES)}`;
        },
      },
    ],
  },
  I2C: {
    id: 'I2C',
    label: 'I2C',
    chartType: 'bar',
    domainCap: 'I2C',
    commands: [
      {
        label: 'Init',
        command: 'I2C:INIT',
        custom: false,
        desc: 'Initialise the I2C bridge on the STM32 board.',
      },
      {
        label: 'Scan',
        command: 'I2C:SCAN',
        custom: false,
        requiredCap: 'I2C_SCAN',
        desc: 'Probe 7-bit addresses from 0x08 to 0x77.',
      },
      {
        label: 'Status',
        command: 'I2C:STATUS',
        custom: false,
        desc: 'Read the last-address and error counters from firmware.',
      },
      {
        label: 'Read register...',
        custom: true,
        requiredCap: 'I2C_READ_REG8',
        desc: 'Read bytes from an 8-bit register-addressed I2C device.',
        fields: [
          { name: 'addr', placeholder: 'Addr (hex, e.g. 6A)', required: true },
          { name: 'reg', placeholder: 'Reg (hex, e.g. 28)', required: true },
          { name: 'len', placeholder: 'Length (dec, e.g. 6)', required: true },
        ],
        buildCommand(values) {
          return `I2C:READ:${requireHexU8(values.addr, 'Address')}:${requireHexU8(values.reg, 'Register')}:${requireDec(values.len, 'Length')}`;
        },
      },
      {
        label: 'Write bytes...',
        custom: true,
        requiredCap: 'I2C_READ_REG8',
        desc: 'Write arbitrary bytes to a 7-bit I2C device.',
        fields: [
          { name: 'addr', placeholder: 'Addr (hex, e.g. 6A)', required: true },
          { name: 'bytes', placeholder: 'Bytes (hex, e.g. 1020A5)', required: true },
        ],
        buildCommand(values) {
          return `I2C:WRITE:${requireHexU8(values.addr, 'Address')}:${requireBytePairs(values.bytes, 'Bytes', MAX_BINARY_PAYLOAD_BYTES)}`;
        },
      },
    ],
  },
};

export const PROTOCOL_ORDER = ['UART', 'SPI', 'CANFD', 'I2C'];

export function parseCanFrame(data) {
  const payload = String(data ?? '').trim();
  let match;

  match = payload.match(/(?:^|;)id=0x([0-9A-Fa-f]+)(?:;|$)/);
  if (match) {
    const dlcMatch = payload.match(/(?:^|;)dlc=(\d+)(?:;|$)/);
    return {
      id: parseInt(match[1], 16),
      dlc: dlcMatch ? parseInt(dlcMatch[1], 10) : null,
    };
  }

  match = payload.match(/^([0-9A-Fa-f]+):(\d+):([0-9A-Fa-f]*)$/);
  if (match) {
    return {
      id: parseInt(match[1], 16),
      dlc: parseInt(match[2], 10),
    };
  }

  return { id: null, dlc: null };
}
