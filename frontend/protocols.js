// frontend/protocols.js
// Single source of truth for protocol definitions.
// app.js and charts.js reference PROTOCOLS — never hardcode protocol names elsewhere.

export const PROTOCOLS = {
  UART: {
    id: 'UART',
    label: 'UART',
    chartType: 'line',
    commands: [
      { label: 'Init',      command: 'UART:INIT', custom: false, desc: 'Initialise UART bridge — run once before testing' },
      { label: 'Loopback',  command: 'UART:LOOP', custom: false, desc: 'Send a byte and verify it echoes back correctly' },
      { label: 'Baud test', command: 'UART:BAUD', custom: false, desc: 'Confirm baud rate matches expected configuration' },
      {
        label: 'Custom…', command: null, custom: true,
        desc: 'Send a custom payload in hex',
        fields: [
          { name: 'payload', placeholder: 'Payload bytes (hex)', required: true },
        ],
      },
    ],
  },
  SPI: {
    id: 'SPI',
    label: 'SPI',
    chartType: 'bar',
    commands: [
      { label: 'Init',          command: 'SPI:INIT',    custom: false, desc: 'Initialise SPI master interface' },
      { label: 'Transfer 0xA5', command: 'SPI:XFER:A5', custom: false, desc: 'Send 0xA5 and read the response byte' },
      { label: 'Transfer 0xFF', command: 'SPI:XFER:FF', custom: false, desc: 'Send 0xFF (all ones) and read the response byte' },
      {
        label: 'Custom…', command: null, custom: true,
        desc: 'Send a custom hex byte and read the response',
        fields: [
          { name: 'byte', placeholder: 'Byte to send (hex, e.g. B3)', required: true },
        ],
      },
    ],
  },
  CANFD: {
    id: 'CANFD',
    label: 'CANFD',
    chartType: 'scatter',
    commands: [
      { label: 'Init',       command: 'CAN:INIT',   custom: false, desc: 'Initialise FDCAN controller and filters' },
      { label: 'Send frame', command: 'CAN:SEND',   custom: false, desc: 'Transmit a standard CAN frame on the bus' },
      { label: 'Bus status', command: 'CAN:STATUS', custom: false, desc: 'Read bus error counters and controller state' },
      {
        label: 'Custom…', command: null, custom: true,
        desc: 'Transmit a frame with custom ID, DLC, and data bytes',
        fields: [
          { name: 'id',    placeholder: 'Frame ID (hex, e.g. 130)',  required: true  },
          { name: 'dlc',   placeholder: 'DLC (0–8)',                  required: true  },
          { name: 'bytes', placeholder: 'Data bytes (hex pairs)',     required: false },
        ],
      },
    ],
  },
  I2C: {
    id: 'I2C',
    label: 'I2C',
    chartType: 'bar',
    commands: [
      { label: 'Enter Mode', command: 'I2C:INIT', custom: false, desc: 'Enter I2C raw byte-stream master mode (I2C1 PB8/PB9)' },
      {
        label: 'Custom…', command: null, custom: true,
        desc: 'Send a custom hex byte to the I2C slave and read the response',
        fields: [
          { name: 'byte', placeholder: 'Byte to send (hex, e.g. A5)', required: true },
        ],
      },
    ],
  },
};

export const PROTOCOL_ORDER = ['UART', 'SPI', 'CANFD', 'I2C'];

/**
 * Parse a raw "PROTO:STATUS:DATA" line.
 * Returns { proto, status, data } or null if the line is malformed.
 * Proto must be uppercase; status must be uppercase letters only.
 */
export function parseLine(raw) {
  const trimmed = (raw || '').trim();
  // Match only known protos so lowercase variants correctly return null
  const match = trimmed.match(/^(UART|SPI|CANFD|I2C):([A-Z]+):(.*)$/);
  if (!match) return null;
  return { proto: match[1], status: match[2], data: match[3] };
}

/**
 * For CANFD frames: extract integer ID and DLC from a data field string.
 * Expected format: "ID=0x130 DLC=8 BYTES=..." (flexible whitespace/ordering).
 * Returns { id: number|null, dlc: number|null }.
 */
export function parseCanFrame(data) {
  const idMatch  = (data || '').match(/ID=0x([0-9A-Fa-f]+)/);
  const dlcMatch = (data || '').match(/DLC=(\d+)/);
  return {
    id:  idMatch  ? parseInt(idMatch[1],  16) : null,
    dlc: dlcMatch ? parseInt(dlcMatch[1], 10) : null,
  };
}
