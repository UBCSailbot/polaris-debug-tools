// preload.js
// Electron contextBridge — exposes window.electronAPI to the renderer.
// contextIsolation: true, nodeIntegration: false — all Node access is here only.
//
// IPC channels (must match ipcMain.handle names in main.js):
//   Invokable (renderer → main → renderer):
//     serial:list-ports  → [{ path, manufacturer }]
//     serial:connect     → { success, error? }
//     serial:disconnect  → { success, error? }
//     serial:send        → { success, sentAt?, error? }
//     log:export-log     → { success, path?, error? }
//     log:export-csv     → { success, path?, error? }
//
//   Push events (main → renderer, subscribe via on* methods):
//     serial:data              → { raw, proto, status, data, rtt }
//     serial:connection-status → { connected, port, baud }
//     serial:reconnect-attempt → { attempt, max }
//     log:session-path         → { path }

'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// ─── Helper: subscribe to a push channel, return unsubscribe fn ──────────────
function subscribe(channel, cb) {
  const handler = (_event, payload) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

// ─── Exposed API ─────────────────────────────────────────────────────────────
contextBridge.exposeInMainWorld('electronAPI', {
  // Shared app / firmware version
  getAppVersion: () =>
    ipcRenderer.invoke('app:get-version'),

  // List available serial ports
  listPorts: () =>
    ipcRenderer.invoke('serial:list-ports'),

  // Open a serial port
  connect: ({ path, baudRate }) =>
    ipcRenderer.invoke('serial:connect', { path, baudRate }),

  // Close the active serial port
  disconnect: () =>
    ipcRenderer.invoke('serial:disconnect'),

  // Write a command string to the open port
  send: ({ command }) =>
    ipcRenderer.invoke('serial:send', { command }),

  // Subscribe to direct command results
  // cb receives: { raw, parsed, rtt, localTimeout? }
  onData: cb => subscribe('serial:data', cb),

  // Subscribe to unsolicited stream events such as UART:DATA or CANFD:FRAME
  onStreamEvent: cb => subscribe('serial:stream-event', cb),

  // Subscribe to firmware log frames
  onLog: cb => subscribe('serial:log', cb),

  // Subscribe to connection state changes
  // cb receives: { connected, port, baud }
  onConnectionStatus: cb => subscribe('serial:connection-status', cb),

  // Subscribe to board profile / capability updates after handshake
  onBoardProfile: cb => subscribe('serial:board-profile', cb),

  // Subscribe to auto-reconnect progress notifications
  // cb receives: { attempt, max }
  onReconnectAttempt: cb => subscribe('serial:reconnect-attempt', cb),

  // Subscribe to session log file path updates (emitted on connect)
  // cb receives: { path }
  onSessionPath: cb => subscribe('log:session-path', cb),

  // Export the current session as a .log file — returns existing path
  exportLog: () =>
    ipcRenderer.invoke('log:export-log'),

  // Write session data to a .csv file in logs/
  exportCsv: () =>
    ipcRenderer.invoke('log:export-csv'),

  // Enable or disable auto-reconnect in the main process
  setAutoReconnect: (enabled) =>
    ipcRenderer.invoke('settings:set-auto-reconnect', { enabled }),

  // ── Dual-board: Board A ────────────────────────────────────────────────────
  connectBoardA: ({ path, baudRate }) =>
    ipcRenderer.invoke('dual:connect-a', { path, baudRate }),

  disconnectBoardA: () =>
    ipcRenderer.invoke('dual:disconnect-a'),

  sendBoardA: ({ command }) =>
    ipcRenderer.invoke('dual:send-a', { command }),

  onDataBoardA: cb => subscribe('dual:data-a', cb),

  onConnectionStatusBoardA: cb => subscribe('dual:connection-status-a', cb),

  onBoardProfileBoardA: cb => subscribe('dual:board-profile-a', cb),

  // ── Dual-board: Board B ────────────────────────────────────────────────────
  connectBoardB: ({ path, baudRate }) =>
    ipcRenderer.invoke('dual:connect-b', { path, baudRate }),

  disconnectBoardB: () =>
    ipcRenderer.invoke('dual:disconnect-b'),

  sendBoardB: ({ command }) =>
    ipcRenderer.invoke('dual:send-b', { command }),

  onDataBoardB: cb => subscribe('dual:data-b', cb),

  onConnectionStatusBoardB: cb => subscribe('dual:connection-status-b', cb),

  onBoardProfileBoardB: cb => subscribe('dual:board-profile-b', cb),
});
