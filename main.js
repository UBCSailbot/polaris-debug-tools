'use strict';

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');

const protocolParser = require('./frontend/protocol-parser.cjs');
const { resolveCommandCompletion, isLateResponse } = require('./frontend/command-tracking.cjs');
const { buildSessionCsv } = require('./frontend/session-csv.cjs');
const { normalizeListedPorts } = require('./frontend/port-utils.cjs');

const CMD_TIMEOUT_MS = 2000;
const HANDSHAKE_TIMEOUT_MS = 1500;
const HANDSHAKE_SETTLE_MS = 500;
const HANDSHAKE_RETRY_DELAY_MS = 250;
const MAX_HANDSHAKE_ATTEMPTS = 3;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAYS_MS = [1000, 2000, 4000, 4000, 4000];
// Cap recorded structured frames so a long-running session cannot grow memory
// without bound. Generous enough that realistic bench sessions are never
// truncated; CSV export keeps the most recent MAX_SESSION_RECORDS responses.
const MAX_SESSION_RECORDS = 50000;

let win = null;
let logStream = null;
let logPath = null;
let sessionBase = null;
let sessionData = [];
let autoReconnectEnabled = true;

// Rotate the runtime debug log once it exceeds this size so a chatty renderer
// cannot grow it without bound; one previous generation is kept as .old.log.
const RUNTIME_DEBUG_MAX_BYTES = 5 * 1024 * 1024;

function appendRuntimeDebug(message) {
  const logsDir = path.join(__dirname, 'logs');
  const debugPath = path.join(logsDir, 'runtime-debug.log');
  const line = `[${new Date().toISOString()}] ${message}\n`;

  try {
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }
    try {
      if (fs.statSync(debugPath).size > RUNTIME_DEBUG_MAX_BYTES) {
        fs.renameSync(debugPath, path.join(logsDir, 'runtime-debug.old.log'));
      }
    } catch {
      // Missing file is fine; rotation is best-effort.
    }
    fs.appendFileSync(debugPath, line, 'utf8');
  } catch {
    // Debug logging must never break app flow.
  }
}

appendRuntimeDebug('main.js loaded');

function listWindowsPortsFallback() {
  return new Promise(resolve => {
    const command = [
      '$ports = [System.IO.Ports.SerialPort]::GetPortNames() | Sort-Object;',
      '$ports = $ports | ForEach-Object { [pscustomobject]@{ path = $_; manufacturer = \"\"; friendlyName = \"\" } };',
      '$ports | ConvertTo-Json -Compress',
    ].join(' ');

    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', command],
      { windowsHide: true },
      (err, stdout, stderr) => {
        let parsed;

        if (err) {
          console.error('windows port fallback error:', err.message);
          if (stderr) {
            console.error('windows port fallback stderr:', stderr);
          }
          appendRuntimeDebug(`Windows fallback failed: ${err.message}${stderr ? ` | stderr=${String(stderr).trim()}` : ''}`);
          resolve([]);
          return;
        }

        try {
          parsed = stdout && stdout.trim() ? JSON.parse(stdout) : [];
        } catch (parseErr) {
          console.error('windows port fallback parse error:', parseErr.message);
          appendRuntimeDebug(`Windows fallback parse failed: ${parseErr.message} | stdout=${String(stdout).trim()}`);
          resolve([]);
          return;
        }

        resolve(normalizeListedPorts(Array.isArray(parsed) ? parsed : [parsed]));
      },
    );
  });
}

async function listAvailablePorts() {
  let listed = [];

  try {
    listed = normalizeListedPorts(await SerialPort.list());
    appendRuntimeDebug(`SerialPort.list returned ${listed.length} port(s): ${listed.map(port => port.path).join(', ') || '<none>'}`);
  } catch (err) {
    console.error('list-ports error:', err.message);
    appendRuntimeDebug(`SerialPort.list failed: ${err.message}`);
  }

  if (listed.length > 0 || process.platform !== 'win32') {
    return listed;
  }

  appendRuntimeDebug('SerialPort.list returned no ports; using Windows fallback.');
  listed = await listWindowsPortsFallback();
  appendRuntimeDebug(`Windows fallback returned ${listed.length} port(s): ${listed.map(port => port.path).join(', ') || '<none>'}`);
  return listed;
}

function createConnectionState() {
  return {
    port: null,
    parser: null,
    portPath: null,
    baud: null,
    intentionalClose: false,
    reconnectAttempt: 0,
    reconnectTimer: null,
    inFlight: false,
    activeCommand: null,
    commandTimeoutHandle: null,
    boardProfile: null,
    handshake: null,
    lastHostTimeout: null,
  };
}

const primary = createConnectionState();
const dualA = createConnectionState();
const dualB = createConnectionState();

const CONNECTION_CONFIG = new Map([
  [primary, {
    dataChannel: 'serial:data',
    streamChannel: 'serial:stream-event',
    logChannel: 'serial:log',
    statusChannel: 'serial:connection-status',
    profileChannel: 'serial:board-profile',
    reconnectChannel: 'serial:reconnect-attempt',
    reconnectWithProgress: true,
    recordSession: true,
  }],
  [dualA, {
    dataChannel: 'dual:data-a',
    streamChannel: null,
    logChannel: null,
    statusChannel: 'dual:connection-status-a',
    profileChannel: 'dual:board-profile-a',
    reconnectChannel: null,
    reconnectWithProgress: false,
    recordSession: false,
  }],
  [dualB, {
    dataChannel: 'dual:data-b',
    streamChannel: null,
    logChannel: null,
    statusChannel: 'dual:connection-status-b',
    profileChannel: 'dual:board-profile-b',
    reconnectChannel: null,
    reconnectWithProgress: false,
    recordSession: false,
  }],
]);

function getConnectionConfig(connection) {
  return CONNECTION_CONFIG.get(connection);
}

function sendToRenderer(channel, payload) {
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, payload);
  }
}

function sessionTimestamp() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return (
    `session_${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function openSessionLog() {
  const logsDir = path.join(__dirname, 'logs');
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }

  sessionBase = sessionTimestamp();
  logPath = path.join(logsDir, `${sessionBase}.log`);
  logStream = fs.createWriteStream(logPath, { flags: 'a', encoding: 'utf8' });
  sessionData = [];

  logStream.on('error', err => {
    console.error('Log write error:', err.message);
  });

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

function parseCommandDomain(command) {
  const match = String(command ?? '').trim().match(/^([A-Z0-9_]+):/);
  return match ? match[1] : null;
}

function clearCommandState(connection) {
  if (connection.commandTimeoutHandle) {
    clearTimeout(connection.commandTimeoutHandle);
    connection.commandTimeoutHandle = null;
  }
  connection.inFlight = false;
  connection.activeCommand = null;
}

function clearHandshake(connection) {
  if (!connection.handshake) {
    return;
  }
  clearTimeout(connection.handshake.timeoutHandle);
  connection.handshake = null;
}

function clearReconnect(connection) {
  if (connection.reconnectTimer) {
    clearTimeout(connection.reconnectTimer);
    connection.reconnectTimer = null;
  }
  connection.reconnectAttempt = 0;
}

function emitBoardProfile(connection, profile) {
  sendToRenderer(getConnectionConfig(connection).profileChannel, profile);
}

function setUnavailableBoardProfile(connection, reason) {
  connection.boardProfile = null;
  emitBoardProfile(connection, {
    available: false,
    board: null,
    fw: null,
    proto: null,
    caps: [],
    legacy: null,
    reason,
  });
}

function normalizeBoardProfile(parsed) {
  const profile = protocolParser.parseCapabilities(parsed.payload);
  const hasIdentity =
    profile.proto != null ||
    profile.fw != null ||
    profile.board != null ||
    profile.caps.length > 0 ||
    profile.legacy != null;

  if (!hasIdentity) {
    return null;
  }

  return {
    available: true,
    board: profile.board,
    fw: profile.fw,
    proto: profile.proto,
    caps: profile.caps,
    legacy: profile.legacy,
    reason: null,
  };
}

function maybeResolveHandshake(connection, parsed) {
  let profile;

  if (!connection.handshake || parsed.domain !== 'SYS' || parsed.type !== 'INFO') {
    return false;
  }

  profile = normalizeBoardProfile(parsed);
  if (!profile) {
    return false;
  }

  connection.boardProfile = profile;
  emitBoardProfile(connection, profile);
  clearTimeout(connection.handshake.timeoutHandle);
  connection.handshake.resolve(profile);
  connection.handshake = null;
  return true;
}

function maybeUpdateBoardProfileFromInfo(connection, parsed) {
  const profile = normalizeBoardProfile(parsed);

  if (!profile) {
    return false;
  }

  connection.boardProfile = profile;
  emitBoardProfile(connection, profile);
  return true;
}

function recordStructuredFrame(connection, raw, parsed, rtt, localTimeout, late = false) {
  if (!protocolParser.isTerminalFrame(parsed)) {
    return;
  }
  if (!getConnectionConfig(connection).recordSession) {
    return;
  }

  sessionData.push({
    ts: Date.now(),
    raw,
    proto: parsed.domain,
    status: localTimeout ? 'HOST_TIMEOUT' : parsed.status,
    data: parsed.payload,
    rtt,
    late: !!late,
  });

  if (sessionData.length > MAX_SESSION_RECORDS) {
    sessionData.splice(0, sessionData.length - MAX_SESSION_RECORDS);
  }
}

function routePrimaryFrame(raw, parsed) {
  let handshake = false;
  let rtt = null;

  if (parsed && maybeResolveHandshake(primary, parsed)) {
    handshake = true;
  }

  if (!parsed) {
    sendToRenderer('serial:data', { raw, parsed: null, rtt: null, localTimeout: false });
    return;
  }

  if (protocolParser.isLog(parsed)) {
    sendToRenderer('serial:log', { raw, parsed });
    return;
  }

  if (!handshake && parsed.domain === 'SYS' && parsed.type === 'INFO') {
    maybeUpdateBoardProfileFromInfo(primary, parsed);
  }

  if (protocolParser.isStreamingEvent(parsed)) {
    sendToRenderer('serial:stream-event', { raw, parsed, rtt: null });
    return;
  }

  let late = false;
  if (protocolParser.isTerminalFrame(parsed)) {
    if (primary.inFlight) {
      const completion = resolveCommandCompletion(primary.activeCommand, parsed.domain, Date.now());
      if (completion.completes || completion.staleInFlight) {
        rtt = completion.rtt;
        clearCommandState(primary);
      }
    } else if (isLateResponse(primary.lastHostTimeout, parsed.domain, Date.now())) {
      // Delayed reply to a command that already produced a HOST_TIMEOUT row —
      // tag it so the CSV export doesn't look like two results for one command.
      late = true;
      primary.lastHostTimeout = null;
    }
  }

  recordStructuredFrame(primary, raw, parsed, rtt, false, late);
  sendToRenderer('serial:data', { raw, parsed, rtt, localTimeout: false, handshake });
}

function routeDualFrame(connection, raw, parsed) {
  let handshake = false;
  let rtt = null;

  if (parsed && maybeResolveHandshake(connection, parsed)) {
    handshake = true;
  }

  if (!parsed) {
    sendToRenderer(getConnectionConfig(connection).dataChannel, {
      raw,
      parsed: null,
      rtt: null,
      localTimeout: false,
      handshake: false,
    });
    return;
  }

  if (!handshake && parsed.domain === 'SYS' && parsed.type === 'INFO') {
    maybeUpdateBoardProfileFromInfo(connection, parsed);
  }

  if (protocolParser.isTerminalFrame(parsed) && connection.inFlight) {
    const completion = resolveCommandCompletion(connection.activeCommand, parsed.domain, Date.now());
    if (completion.completes || completion.staleInFlight) {
      rtt = completion.rtt;
      clearCommandState(connection);
    }
  }

  sendToRenderer(getConnectionConfig(connection).dataChannel, {
    raw,
    parsed,
    rtt,
    localTimeout: false,
    handshake,
  });
}

function attachPortListeners(connection, parser) {
  const config = getConnectionConfig(connection);

  parser.on('data', line => {
    const raw = String(line ?? '');
    if (connection === primary) {
      appendToLog(raw, Date.now());
      routePrimaryFrame(raw, protocolParser.parseLine(raw));
      return;
    }

    routeDualFrame(connection, raw, protocolParser.parseLine(raw));
  });

  connection.port.on('error', err => {
    console.error(`SerialPort error [${connection.portPath || 'unknown'}]:`, err.message);
  });

  connection.port.on('close', () => {
    if (connection.intentionalClose) {
      return;
    }

    clearCommandState(connection);
    clearHandshake(connection);
    connection.port = null;
    connection.parser = null;

    sendToRenderer(config.statusChannel, {
      connected: false,
      port: connection.portPath,
      baud: connection.baud,
    });
    setUnavailableBoardProfile(connection, 'disconnected');

    if (connection === primary) {
      scheduleReconnect(primary);
    } else {
      scheduleBoardReconnect(connection);
    }
  });
}

function openPort(connection) {
  return new Promise((resolve, reject) => {
    const sp = new SerialPort({
      path: connection.portPath,
      baudRate: connection.baud,
      autoOpen: false,
    });
    const parser = sp.pipe(new ReadlineParser({ delimiter: '\r\n' }));

    sp.open(err => {
      if (err) {
        reject(err);
        return;
      }

      connection.port = sp;
      connection.parser = parser;
      attachPortListeners(connection, parser);
      sp.set({ dtr: false, rts: false }, setErr => {
        if (setErr) {
          appendRuntimeDebug(`serial control-line set failed for ${connection.portPath}: ${setErr.message}`);
        }
        resolve();
      });
    });
  });
}

function closePort(connection) {
  return new Promise(resolve => {
    clearCommandState(connection);
    clearHandshake(connection);

    if (!connection.port || !connection.port.isOpen) {
      connection.port = null;
      connection.parser = null;
      resolve();
      return;
    }

    connection.intentionalClose = true;
    connection.port.close(err => {
      connection.intentionalClose = false;
      if (err) {
        console.error('Port close error:', err.message);
      }
      connection.port = null;
      connection.parser = null;
      resolve();
    });
  });
}

function writeCommand(connection, command) {
  return new Promise((resolve, reject) => {
    if (!connection.port || !connection.port.isOpen) {
      reject(new Error('Port not open'));
      return;
    }

    connection.port.write(`${command}\r\n`, err => {
      if (err) {
        reject(err);
        return;
      }
      connection.port.drain(drainErr => {
        if (drainErr) {
          reject(drainErr);
          return;
        }
        resolve();
      });
    });
  });
}

async function sendTrackedCommand(connection, command) {
  const sentAt = Date.now();
  const config = getConnectionConfig(connection);

  if (connection.inFlight) {
    return { success: false, error: 'Another command is already in flight' };
  }

  connection.inFlight = true;
  connection.activeCommand = {
    command,
    domain: parseCommandDomain(command),
    sentAt,
  };
  connection.commandTimeoutHandle = setTimeout(() => {
    let parsed;
    let raw;

    if (!connection.inFlight || !connection.activeCommand) {
      return;
    }

    parsed = {
      raw: '',
      domain: connection.activeCommand.domain || 'SYS',
      proto: connection.activeCommand.domain || 'SYS',
      kind: 'response',
      type: 'TIMEOUT',
      status: 'TIMEOUT',
      payload: 'reason=host-timeout',
      data: 'reason=host-timeout',
    };
    raw = `${parsed.domain}:TIMEOUT:${parsed.payload}`;

    clearCommandState(connection);
    connection.lastHostTimeout = { domain: parsed.domain, at: Date.now() };
    recordStructuredFrame(connection, raw, parsed, null, true);
    sendToRenderer(config.dataChannel, {
      raw,
      parsed,
      rtt: null,
      localTimeout: true,
      handshake: false,
    });
  }, CMD_TIMEOUT_MS);

  try {
    await writeCommand(connection, command);
    return { success: true, sentAt };
  } catch (err) {
    clearCommandState(connection);
    return { success: false, error: err.message };
  }
}

async function performHandshake(connection) {
  clearHandshake(connection);
  setUnavailableBoardProfile(connection, 'handshake-pending');
  await delay(HANDSHAKE_SETTLE_MS);

  for (let attempt = 1; attempt <= MAX_HANDSHAKE_ATTEMPTS; attempt += 1) {
    let resolved = false;
    let result;

    appendRuntimeDebug(`Handshake attempt ${attempt}/${MAX_HANDSHAKE_ATTEMPTS} on ${connection.portPath || 'unknown-port'}`);

    result = await new Promise(async resolve => {
      connection.handshake = {
        resolve(profile) {
          resolved = true;
          resolve(profile);
        },
        timeoutHandle: setTimeout(() => {
          connection.handshake = null;
          resolve(null);
        }, HANDSHAKE_TIMEOUT_MS),
      };

      try {
        await writeCommand(connection, 'SYS:HELLO');
      } catch (err) {
        clearHandshake(connection);
        setUnavailableBoardProfile(connection, 'handshake-write-failed');
        appendRuntimeDebug(`Handshake write failed on ${connection.portPath || 'unknown-port'}: ${err.message}`);
        resolve(null);
      }
    }).finally(() => {
      if (!resolved && connection.handshake) {
        clearHandshake(connection);
      }
    });

    if (result) {
      appendRuntimeDebug(`Handshake succeeded on attempt ${attempt} for ${connection.portPath || 'unknown-port'}`);
      return result;
    }

    if (attempt < MAX_HANDSHAKE_ATTEMPTS) {
      await delay(HANDSHAKE_RETRY_DELAY_MS);
    }
  }

  appendRuntimeDebug(`Handshake timed out after ${MAX_HANDSHAKE_ATTEMPTS} attempts for ${connection.portPath || 'unknown-port'}`);
  setUnavailableBoardProfile(connection, 'handshake-timeout');
  return null;
}

function scheduleReconnect(connection) {
  const delay = RECONNECT_DELAYS_MS[connection.reconnectAttempt] ?? 4000;

  if (!autoReconnectEnabled) {
    return;
  }
  if (connection.reconnectAttempt >= MAX_RECONNECT_ATTEMPTS) {
    clearReconnect(connection);
    return;
  }

  connection.reconnectAttempt += 1;
  sendToRenderer(getConnectionConfig(connection).reconnectChannel, {
    attempt: connection.reconnectAttempt,
    max: MAX_RECONNECT_ATTEMPTS,
  });

  connection.reconnectTimer = setTimeout(async () => {
    connection.reconnectTimer = null;
    try {
      await openPort(connection);
      clearReconnect(connection);
      sendToRenderer(getConnectionConfig(connection).statusChannel, {
        connected: true,
        port: connection.portPath,
        baud: connection.baud,
      });
      await performHandshake(connection);
    } catch {
      scheduleReconnect(connection);
    }
  }, delay);
}

function scheduleBoardReconnect(connection) {
  const delay = RECONNECT_DELAYS_MS[connection.reconnectAttempt] ?? 4000;
  const config = getConnectionConfig(connection);

  if (!autoReconnectEnabled) {
    return;
  }
  if (connection.reconnectAttempt >= MAX_RECONNECT_ATTEMPTS) {
    clearReconnect(connection);
    return;
  }

  connection.reconnectAttempt += 1;
  connection.reconnectTimer = setTimeout(async () => {
    connection.reconnectTimer = null;
    try {
      await openPort(connection);
      clearReconnect(connection);
      sendToRenderer(config.statusChannel, {
        connected: true,
        port: connection.portPath,
        baud: connection.baud,
      });
      await performHandshake(connection);
    } catch {
      scheduleBoardReconnect(connection);
    }
  }, delay);
}

ipcMain.handle('serial:list-ports', async () => {
  appendRuntimeDebug('IPC serial:list-ports invoked.');
  return listAvailablePorts();
});

ipcMain.handle('app:get-version', () => app.getVersion());

ipcMain.handle('serial:connect', async (_event, { path: portPath, baudRate }) => {
  try {
    clearReconnect(primary);
    await closePort(primary);
    closeSessionLog();

    primary.portPath = portPath;
    primary.baud = baudRate;
    primary.boardProfile = null;

    await openPort(primary);
    openSessionLog();

    sendToRenderer('serial:connection-status', {
      connected: true,
      port: portPath,
      baud: baudRate,
    });

    await performHandshake(primary);
    return { success: true, boardProfile: primary.boardProfile };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('serial:disconnect', async () => {
  try {
    clearReconnect(primary);
    await closePort(primary);
    closeSessionLog();
    sendToRenderer('serial:connection-status', {
      connected: false,
      port: primary.portPath,
      baud: primary.baud,
    });
    setUnavailableBoardProfile(primary, 'disconnected');
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('serial:send', async (_event, { command }) => {
  if (!primary.port || !primary.port.isOpen) {
    return { success: false, error: 'Port not open' };
  }
  return sendTrackedCommand(primary, command);
});

ipcMain.handle('settings:set-auto-reconnect', (_event, { enabled }) => {
  autoReconnectEnabled = enabled;
  if (!enabled) {
    clearReconnect(primary);
  }
  return { success: true };
});

ipcMain.handle('log:export-log', async () => {
  if (!logPath) {
    return { success: false, error: 'No active session log' };
  }
  return { success: true, path: logPath };
});

ipcMain.handle('log:export-csv', async () => {
  let base;
  let csvPath;

  if (!sessionData.length) {
    return { success: false, error: 'No structured data recorded yet' };
  }

  try {
    const logsDir = path.join(__dirname, 'logs');
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }

    base = sessionBase || sessionTimestamp();
    csvPath = path.join(logsDir, `${base}.csv`);
    fs.writeFileSync(csvPath, buildSessionCsv(sessionData), 'utf8');
    return { success: true, path: csvPath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('preset:load', async () => {
  const result = await dialog.showOpenDialog(win, {
    title: 'Load Test Preset',
    filters: [{ name: 'JSON Preset', extensions: ['json'] }],
    properties: ['openFile'],
  });
  if (result.canceled || !result.filePaths.length) {
    return { success: false, canceled: true };
  }
  try {
    const raw = fs.readFileSync(result.filePaths[0], 'utf8');
    return { success: true, data: JSON.parse(raw) };
  } catch (err) {
    return { success: false, canceled: false, error: err.message };
  }
});

ipcMain.handle('preset:save', async (_event, { data }) => {
  const defaultName = (typeof data?.name === 'string' && data.name.trim())
    ? data.name.trim().replace(/[^a-z0-9_\-]/gi, '_')
    : 'preset';
  const result = await dialog.showSaveDialog(win, {
    title: 'Save Test Preset',
    defaultPath: `${defaultName}.json`,
    filters: [{ name: 'JSON Preset', extensions: ['json'] }],
  });
  if (result.canceled || !result.filePath) {
    return { success: false, canceled: true };
  }
  try {
    fs.writeFileSync(result.filePath, JSON.stringify(data, null, 2), 'utf8');
    return { success: true, path: result.filePath };
  } catch (err) {
    return { success: false, canceled: false, error: err.message };
  }
});

ipcMain.handle('dual:connect-a', async (_event, { path: portPath, baudRate }) => {
  try {
    clearReconnect(dualA);
    await closePort(dualA);
    dualA.portPath = portPath;
    dualA.baud = baudRate;
    dualA.boardProfile = null;
    await openPort(dualA);
    sendToRenderer('dual:connection-status-a', {
      connected: true,
      port: portPath,
      baud: baudRate,
    });
    await performHandshake(dualA);
    return { success: true, boardProfile: dualA.boardProfile };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('dual:disconnect-a', async () => {
  try {
    clearReconnect(dualA);
    await closePort(dualA);
    sendToRenderer('dual:connection-status-a', {
      connected: false,
      port: dualA.portPath,
      baud: dualA.baud,
    });
    setUnavailableBoardProfile(dualA, 'disconnected');
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('dual:send-a', async (_event, { command }) => {
  if (!dualA.port || !dualA.port.isOpen) {
    return { success: false, error: 'Port not open' };
  }
  return sendTrackedCommand(dualA, command);
});

ipcMain.handle('dual:connect-b', async (_event, { path: portPath, baudRate }) => {
  try {
    clearReconnect(dualB);
    await closePort(dualB);
    dualB.portPath = portPath;
    dualB.baud = baudRate;
    dualB.boardProfile = null;
    await openPort(dualB);
    sendToRenderer('dual:connection-status-b', {
      connected: true,
      port: portPath,
      baud: baudRate,
    });
    await performHandshake(dualB);
    return { success: true, boardProfile: dualB.boardProfile };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('dual:disconnect-b', async () => {
  try {
    clearReconnect(dualB);
    await closePort(dualB);
    sendToRenderer('dual:connection-status-b', {
      connected: false,
      port: dualB.portPath,
      baud: dualB.baud,
    });
    setUnavailableBoardProfile(dualB, 'disconnected');
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('dual:send-b', async (_event, { command }) => {
  if (!dualB.port || !dualB.port.isOpen) {
    return { success: false, error: 'Port not open' };
  }
  return sendTrackedCommand(dualB, command);
});

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    appendRuntimeDebug(`renderer console [${level}] ${sourceId}:${line} ${message}`);
  });
  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    appendRuntimeDebug(`did-fail-load code=${errorCode} desc=${errorDescription} url=${validatedURL}`);
  });
  win.webContents.on('preload-error', (_event, preloadPath, error) => {
    appendRuntimeDebug(`preload-error path=${preloadPath} error=${error && error.message ? error.message : String(error)}`);
  });
  win.webContents.on('did-finish-load', () => {
    appendRuntimeDebug('renderer did-finish-load');
  });

  win.loadFile(path.join(__dirname, 'frontend', 'index.html'));
  win.on('closed', () => {
    win = null;
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Electron does not await async before-quit listeners, so hold the quit with
// preventDefault, finish cleanup, then quit for real exactly once.
let quitCleanupDone = false;

app.on('before-quit', event => {
  if (quitCleanupDone) {
    return;
  }
  event.preventDefault();

  (async () => {
    clearReconnect(primary);
    clearReconnect(dualA);
    clearReconnect(dualB);
    await closePort(primary);
    await closePort(dualA);
    await closePort(dualB);
    closeSessionLog();
  })().finally(() => {
    quitCleanupDone = true;
    app.quit();
  });
});
