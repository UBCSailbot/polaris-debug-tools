// preload.js
// STUB: Replace ipcRenderer calls with real backend when main.js is implemented.
// All window.electronAPI methods mirror the IPC interface defined in the plan.
//
// IPC channels defined here:
//   serial:list-ports  (invoke)  → [{ path, manufacturer }]
//   serial:connect     (invoke)  → { success, error? }
//   serial:disconnect  (invoke)  → { success }
//   serial:send        (invoke)  → { success, sentAt }
//   serial:data        (on)      → { raw, proto, status, data, rtt }
//   serial:connection-status (on)→ { connected, port, baud }
//   serial:reconnect-attempt (on)→ { attempt, max }
//   log:export-csv     (invoke)  → { success, path?, error? }
//   log:export-log     (invoke)  → { success, path?, error? }
//   log:session-path   (on)      → { path }

const { contextBridge, ipcRenderer } = require('electron');

// --- Mock data emitter (remove when real backend exists) ---
let _mockInterval = null;
function startMockEmitter() {
  if (_mockInterval) return; // only one emitter at a time
  const protos = ['UART', 'SPI', 'CANFD'];
  const statuses = ['PASS', 'FAIL', 'TIMEOUT', 'INIT', 'RAW'];
  const canIds = [0x130, 0x131, 0x132, 0x133];
  let tick = 0;

  _mockInterval = setInterval(() => {
    const proto  = protos[tick % protos.length];
    const status = statuses[tick % statuses.length];
    let data = 'mock payload';
    if (proto === 'CANFD') {
      const id = canIds[tick % canIds.length];
      data = `ID=0x${id.toString(16).toUpperCase()} DLC=8 BYTES=DEADBEEF01020304`;
    }
    if (proto === 'SPI') {
      const byte = (0xA0 + (tick % 16)).toString(16).toUpperCase().padStart(2, '0');
      data = `TX=0x${byte} RX=0x${byte}`;
    }
    const raw = `${proto}:${status}:${data}`;
    ipcRenderer.emit('serial:data', null, {
      raw,
      proto,
      status,
      data,
      rtt: 5 + (tick % 40),
    });
    tick++;
  }, 1800);
}

contextBridge.exposeInMainWorld('electronAPI', {
  // --- Serial ---
  listPorts: () =>
    ipcRenderer.invoke('serial:list-ports').catch(() => [
      { path: 'COM3', manufacturer: 'STMicroelectronics' },
      { path: 'COM4', manufacturer: 'FTDI' },
    ]),

  connect: ({ path, baudRate }) =>
    ipcRenderer.invoke('serial:connect', { path, baudRate }).catch(() => {
      startMockEmitter();
      // Also emit a connected status event for the mock
      setTimeout(() => {
        ipcRenderer.emit('serial:connection-status', null, {
          connected: true, port: path, baud: baudRate,
        });
        ipcRenderer.emit('log:session-path', null, {
          path: `C:/sailbot-sessions/session-${Date.now()}.log`,
        });
      }, 100);
      return { success: true };
    }),

  disconnect: () =>
    ipcRenderer.invoke('serial:disconnect').catch(() => {
      clearInterval(_mockInterval);
      _mockInterval = null;
      return { success: true };
    }),

  send: ({ command }) =>
    ipcRenderer.invoke('serial:send', { command }).catch(() => ({
      success: true,
      sentAt: Date.now(),
    })),

  // --- Event subscriptions — each returns an unsubscribe function ---
  onData: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on('serial:data', handler);
    return () => ipcRenderer.removeListener('serial:data', handler);
  },

  onConnectionStatus: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on('serial:connection-status', handler);
    return () => ipcRenderer.removeListener('serial:connection-status', handler);
  },

  onReconnectAttempt: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on('serial:reconnect-attempt', handler);
    return () => ipcRenderer.removeListener('serial:reconnect-attempt', handler);
  },

  onSessionPath: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on('log:session-path', handler);
    return () => ipcRenderer.removeListener('log:session-path', handler);
  },

  // --- Export ---
  exportCsv: () =>
    ipcRenderer.invoke('log:export-csv').catch(() => ({
      success: true,
      path: `C:/sailbot-sessions/session-${Date.now()}.csv`,
    })),

  exportLog: () =>
    ipcRenderer.invoke('log:export-log').catch(() => ({
      success: true,
      path: `C:/sailbot-sessions/session-${Date.now()}.log`,
    })),
});
