// main.js
// Electron main process for the Sailbot dev board protocol tester GUI.
//
// IPC channels handled here:
//   serial:list-ports  (handle) — scan available serial ports
//   serial:connect     (handle) — open port, start reading, open session log
//   serial:disconnect  (handle) — close port cleanly
//   serial:send        (handle) — write command + \r\n to port, track RTT start
//
//   serial:data              (send) — parsed incoming line + RTT to renderer
//   serial:connection-status (send) — connection state changes
//   serial:reconnect-attempt (send) — reconnect progress notifications
//   log:session-path         (send) — path of current session .log file
//
//   log:export-log (handle) — return path of current session .log file
//   log:export-csv (handle) — write CSV from session data, return path

'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');
const path       = require('path');
const fs         = require('fs');
const { SerialPort }      = require('serialport');
const { ReadlineParser }  = require('@serialport/parser-readline');

// ─── Session state ────────────────────────────────────────────────────────────
let win             = null;   // BrowserWindow — set in createWindow()
let port            = null;   // SerialPort instance
let parser          = null;   // ReadlineParser piped from port
let currentPortPath = null;   // port path used for the active connection
let currentBaud     = null;   // baud rate used for the active connection
let logStream       = null;   // fs.WriteStream for the current .log file
let logPath         = null;   // absolute path to current .log file
let sessionBase     = null;   // base filename (without extension) for this session
let sessionData     = [];     // [{ ts, raw, proto, status, data, rtt }] for CSV export
let lastSentAt      = null;   // Date.now() at last serial:send — cleared after first response
let _intentionalClose = false; // true while closePort() is in progress — suppresses reconnect

// Auto-reconnect config
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAYS_MS    = [1000, 2000, 4000, 4000, 4000]; // per attempt
let reconnectAttempt        = 0;
let reconnectTimer          = null;
let autoReconnectEnabled    = true;

// ─── Utility ──────────────────────────────────────────────────────────────────

/** Send a push event to the renderer. No-ops if the window is gone. */
function sendToRenderer(channel, payload) {
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, payload);
  }
}

/** Build a timestamp string suitable for filenames: session_YYYY-MM-DD_HHmmss */
function sessionTimestamp() {
  const d   = new Date();
  const pad = n => String(n).padStart(2, '0');
  return (
    `session_${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

/** Escape a value for CSV: wrap in quotes if it contains commas, quotes, or newlines. */
function csvEscape(val) {
  if (val == null) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// ─── Session log ─────────────────────────────────────────────────────────────

function openSessionLog() {
  const logsDir = path.join(__dirname, 'logs');
  if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

  sessionBase = sessionTimestamp();
  logPath     = path.join(logsDir, `${sessionBase}.log`);
  logStream   = fs.createWriteStream(logPath, { flags: 'a', encoding: 'utf8' });
  sessionData = [];

  logStream.on('error', err => {
    console.error('Log write error:', err.message);
  });

  // Notify renderer of the session file path
  sendToRenderer('log:session-path', { path: logPath });
}

function closeSessionLog() {
  if (logStream) {
    logStream.end();
    logStream = null;
  }
}

function appendToLog(raw, ts) {
  if (logStream && logStream.writable) {
    logStream.write(`[${ts}] ${raw}\n`);
  }
}

// ─── Serial port ──────────────────────────────────────────────────────────────

/**
 * Open the serial port and attach a readline parser.
 * Resolves on successful open, rejects on error.
 */
function openPort(portPath, baudRate) {
  // Create a fresh port + parser every time (including reconnects)
  const sp = new SerialPort({ path: portPath, baudRate, autoOpen: false });
  const lp = sp.pipe(new ReadlineParser({ delimiter: '\r\n' }));

  lp.on('data', line => {
    const ts  = Date.now();
    const rtt = lastSentAt != null ? ts - lastSentAt : null;
    lastSentAt = null; // one RTT measurement per command-response pair

    appendToLog(line, ts);

    // Parse PROTO:STATUS:DATA — match only known protos so the renderer's
    // parseLine() and the main process agree on what is structured data.
    const match  = line.trim().match(/^(UART|SPI|CANFD|I2C):([A-Z]+):(.*)$/);
    const proto  = match ? match[1] : null;
    const status = match ? match[2] : 'RAW';
    const data   = match ? match[3] : line;

    if (match) {
      sessionData.push({ ts, raw: line, proto, status, data, rtt });
    }

    sendToRenderer('serial:data', {
      raw:    line,
      proto:  proto,
      status: status,
      data:   data,
      rtt:    rtt,
    });
  });

  sp.on('error', err => {
    // Non-fatal errors (e.g. framing errors) — log, don't crash
    console.error('SerialPort error:', err.message);
  });

  sp.on('close', () => {
    if (_intentionalClose) return; // normal user-initiated close — handled by closePort()

    // Unexpected disconnect
    port   = null;
    parser = null;
    sendToRenderer('serial:connection-status', {
      connected: false,
      port: currentPortPath,
      baud: currentBaud,
    });
    scheduleReconnect();
  });

  return new Promise((resolve, reject) => {
    sp.open(err => {
      if (err) {
        reject(err);
        return;
      }
      port   = sp;
      parser = lp;
      resolve();
    });
  });
}

/**
 * Close the current port cleanly.
 * Sets _intentionalClose so the 'close' event handler skips reconnect.
 */
function closePort() {
  return new Promise(resolve => {
    if (!port || !port.isOpen) {
      port   = null;
      parser = null;
      resolve();
      return;
    }
    _intentionalClose = true;
    port.close(err => {
      _intentionalClose = false;
      if (err) console.error('Port close error:', err.message);
      port   = null;
      parser = null;
      resolve();
    });
  });
}

// ─── Auto-reconnect ───────────────────────────────────────────────────────────

function scheduleReconnect() {
  if (!autoReconnectEnabled) return;
  if (reconnectAttempt >= MAX_RECONNECT_ATTEMPTS) {
    reconnectAttempt = 0;
    reconnectTimer   = null;
    // Final failure — renderer already knows from last connection-status push
    return;
  }

  const delay = RECONNECT_DELAYS_MS[reconnectAttempt] ?? 4000;
  reconnectAttempt++;

  sendToRenderer('serial:reconnect-attempt', {
    attempt: reconnectAttempt,
    max:     MAX_RECONNECT_ATTEMPTS,
  });

  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    try {
      await openPort(currentPortPath, currentBaud);
      reconnectAttempt = 0;
      sendToRenderer('serial:connection-status', {
        connected: true,
        port:      currentPortPath,
        baud:      currentBaud,
      });
    } catch {
      scheduleReconnect(); // keep trying
    }
  }, delay);
}

function cancelReconnect() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  reconnectAttempt = 0;
}

// ─── Dual-board state ─────────────────────────────────────────────────────────

function makeBoardState() {
  return {
    port:             null,
    parser:           null,
    portPath:         null,
    baud:             null,
    lastSentAt:       null,
    intentionalClose: false,
    reconnectAttempt: 0,
    reconnectTimer:   null,
  };
}

const dualA = makeBoardState();
const dualB = makeBoardState();

function openBoardPort(board, dataChannel, statusChannel) {
  const sp = new SerialPort({ path: board.portPath, baudRate: board.baud, autoOpen: false });
  const lp = sp.pipe(new ReadlineParser({ delimiter: '\r\n' }));

  lp.on('data', line => {
    const ts  = Date.now();
    const rtt = board.lastSentAt != null ? ts - board.lastSentAt : null;
    board.lastSentAt = null;

    const match  = line.trim().match(/^(UART|SPI|CANFD|I2C):([A-Z]+):(.*)$/);
    const proto  = match ? match[1] : null;
    const status = match ? match[2] : 'RAW';
    const data   = match ? match[3] : line;

    sendToRenderer(dataChannel, { raw: line, proto, status, data, rtt });
  });

  sp.on('error', err => {
    console.error(`Board [${board.portPath}] error:`, err.message);
  });

  sp.on('close', () => {
    if (board.intentionalClose) return;
    board.port   = null;
    board.parser = null;
    sendToRenderer(statusChannel, {
      connected: false,
      port: board.portPath,
      baud: board.baud,
    });
    scheduleBoardReconnect(board, dataChannel, statusChannel);
  });

  return new Promise((resolve, reject) => {
    sp.open(err => {
      if (err) { reject(err); return; }
      board.port   = sp;
      board.parser = lp;
      resolve();
    });
  });
}

function closeBoardPort(board) {
  return new Promise(resolve => {
    if (!board.port || !board.port.isOpen) {
      board.port   = null;
      board.parser = null;
      resolve();
      return;
    }
    board.intentionalClose = true;
    board.port.close(err => {
      board.intentionalClose = false;
      if (err) console.error('Board port close error:', err.message);
      board.port   = null;
      board.parser = null;
      resolve();
    });
  });
}

function scheduleBoardReconnect(board, dataChannel, statusChannel) {
  if (board.reconnectAttempt >= MAX_RECONNECT_ATTEMPTS) {
    board.reconnectAttempt = 0;
    board.reconnectTimer   = null;
    return;
  }
  const delay = RECONNECT_DELAYS_MS[board.reconnectAttempt] ?? 4000;
  board.reconnectAttempt++;
  board.reconnectTimer = setTimeout(async () => {
    board.reconnectTimer = null;
    try {
      await openBoardPort(board, dataChannel, statusChannel);
      board.reconnectAttempt = 0;
      sendToRenderer(statusChannel, {
        connected: true,
        port: board.portPath,
        baud: board.baud,
      });
    } catch {
      scheduleBoardReconnect(board, dataChannel, statusChannel);
    }
  }, delay);
}

function cancelBoardReconnect(board) {
  if (board.reconnectTimer) {
    clearTimeout(board.reconnectTimer);
    board.reconnectTimer = null;
  }
  board.reconnectAttempt = 0;
}

// ─── IPC handlers ────────────────────────────────────────────────────────────

/** serial:list-ports → [{ path, manufacturer }] */
ipcMain.handle('serial:list-ports', async () => {
  try {
    const ports = await SerialPort.list();
    return ports.map(p => ({
      path:         p.path,
      manufacturer: p.manufacturer || '',
    }));
  } catch (err) {
    console.error('list-ports error:', err.message);
    return [];
  }
});

/** serial:connect { path, baudRate } → { success, error? } */
ipcMain.handle('serial:connect', async (_event, { path: portPath, baudRate }) => {
  try {
    // Cancel any pending reconnect and tear down existing connection
    cancelReconnect();
    await closePort();
    closeSessionLog();

    currentPortPath = portPath;
    currentBaud     = baudRate;
    lastSentAt      = null;

    await openPort(portPath, baudRate);
    openSessionLog(); // creates .log file, notifies renderer of path

    sendToRenderer('serial:connection-status', {
      connected: true,
      port:      portPath,
      baud:      baudRate,
    });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

/** serial:disconnect → { success } */
ipcMain.handle('serial:disconnect', async () => {
  try {
    cancelReconnect();
    await closePort();
    closeSessionLog();
    sendToRenderer('serial:connection-status', {
      connected: false,
      port:      currentPortPath,
      baud:      currentBaud,
    });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

/** serial:send { command } → { success, sentAt?, error? } */
ipcMain.handle('serial:send', async (_event, { command }) => {
  if (!port || !port.isOpen) {
    return { success: false, error: 'Port not open' };
  }
  try {
    const sentAt = Date.now();
    lastSentAt   = sentAt; // RTT clock starts now

    await new Promise((resolve, reject) => {
      port.write(`${command}\r\n`, err => (err ? reject(err) : resolve()));
    });

    return { success: true, sentAt };
  } catch (err) {
    lastSentAt = null; // don't attribute a stale RTT to the next response
    return { success: false, error: err.message };
  }
});

/** settings:set-auto-reconnect { enabled } → { success } */
ipcMain.handle('settings:set-auto-reconnect', (_event, { enabled }) => {
  autoReconnectEnabled = enabled;
  if (!enabled) cancelReconnect();
  return { success: true };
});

/** log:export-log → { success, path?, error? } */
ipcMain.handle('log:export-log', async () => {
  if (!logPath) {
    return { success: false, error: 'No active session log' };
  }
  return { success: true, path: logPath };
});

/** log:export-csv → { success, path?, error? } */
ipcMain.handle('log:export-csv', async () => {
  if (!sessionData.length) {
    return { success: false, error: 'No structured data recorded yet' };
  }
  try {
    const logsDir = path.join(__dirname, 'logs');
    if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

    // Use session base name so CSV is clearly associated with the .log
    const base    = sessionBase || sessionTimestamp();
    const csvPath = path.join(logsDir, `${base}.csv`);

    const header = 'timestamp_ms,proto,status,rtt_ms,data,raw\n';
    const rows   = sessionData
      .map(r =>
        [
          r.ts,
          csvEscape(r.proto),
          csvEscape(r.status),
          r.rtt != null ? r.rtt : '',
          csvEscape(r.data),
          csvEscape(r.raw),
        ].join(',')
      )
      .join('\n');

    fs.writeFileSync(csvPath, header + rows, 'utf8');
    return { success: true, path: csvPath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ─── Dual-board IPC handlers ─────────────────────────────────────────────────

/** dual:connect-a { path, baudRate } → { success, error? } */
ipcMain.handle('dual:connect-a', async (_event, { path: portPath, baudRate }) => {
  try {
    cancelBoardReconnect(dualA);
    await closeBoardPort(dualA);
    dualA.portPath   = portPath;
    dualA.baud       = baudRate;
    dualA.lastSentAt = null;
    await openBoardPort(dualA, 'dual:data-a', 'dual:connection-status-a');
    sendToRenderer('dual:connection-status-a', { connected: true, port: portPath, baud: baudRate });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

/** dual:disconnect-a → { success } */
ipcMain.handle('dual:disconnect-a', async () => {
  try {
    cancelBoardReconnect(dualA);
    await closeBoardPort(dualA);
    sendToRenderer('dual:connection-status-a', {
      connected: false, port: dualA.portPath, baud: dualA.baud,
    });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

/** dual:send-a { command } → { success, sentAt?, error? } */
ipcMain.handle('dual:send-a', async (_event, { command }) => {
  if (!dualA.port || !dualA.port.isOpen) return { success: false, error: 'Port not open' };
  try {
    const sentAt = Date.now();
    dualA.lastSentAt = sentAt;
    await new Promise((resolve, reject) => {
      dualA.port.write(`${command}\r\n`, err => (err ? reject(err) : resolve()));
    });
    return { success: true, sentAt };
  } catch (err) {
    dualA.lastSentAt = null;
    return { success: false, error: err.message };
  }
});

/** dual:connect-b { path, baudRate } → { success, error? } */
ipcMain.handle('dual:connect-b', async (_event, { path: portPath, baudRate }) => {
  try {
    cancelBoardReconnect(dualB);
    await closeBoardPort(dualB);
    dualB.portPath   = portPath;
    dualB.baud       = baudRate;
    dualB.lastSentAt = null;
    await openBoardPort(dualB, 'dual:data-b', 'dual:connection-status-b');
    sendToRenderer('dual:connection-status-b', { connected: true, port: portPath, baud: baudRate });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

/** dual:disconnect-b → { success } */
ipcMain.handle('dual:disconnect-b', async () => {
  try {
    cancelBoardReconnect(dualB);
    await closeBoardPort(dualB);
    sendToRenderer('dual:connection-status-b', {
      connected: false, port: dualB.portPath, baud: dualB.baud,
    });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

/** dual:send-b { command } → { success, sentAt?, error? } */
ipcMain.handle('dual:send-b', async (_event, { command }) => {
  if (!dualB.port || !dualB.port.isOpen) return { success: false, error: 'Port not open' };
  try {
    const sentAt = Date.now();
    dualB.lastSentAt = sentAt;
    await new Promise((resolve, reject) => {
      dualB.port.write(`${command}\r\n`, err => (err ? reject(err) : resolve()));
    });
    return { success: true, sentAt };
  } catch (err) {
    dualB.lastSentAt = null;
    return { success: false, error: err.message };
  }
});

// ─── Window lifecycle ─────────────────────────────────────────────────────────

function createWindow() {
  win = new BrowserWindow({
    width:  1280,
    height: 800,
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
    },
  });

  win.loadFile(path.join(__dirname, 'frontend', 'index.html'));

  win.on('closed', () => {
    win = null;
  });
}

app.whenReady().then(() => {
  createWindow();

  // macOS: re-create window when dock icon is clicked and no windows are open
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  // On macOS, keep the app running until Cmd+Q
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', async () => {
  // Clean up serial port and log file on exit
  cancelReconnect();
  await closePort();
  closeSessionLog();
  // Clean up dual-board ports
  cancelBoardReconnect(dualA);
  cancelBoardReconnect(dualB);
  await closeBoardPort(dualA);
  await closeBoardPort(dualB);
});
