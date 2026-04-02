const { app } = require('electron');
const { SerialPort } = require('serialport');
const { execFile } = require('child_process');

function listWindowsPortsFallback() {
  return new Promise(resolve => {
    const command = [
      '$ports = Get-CimInstance Win32_SerialPort | Select-Object DeviceID, Manufacturer, Name;',
      '$ports | ConvertTo-Json -Compress'
    ].join(' ');

    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true }, (err, stdout, stderr) => {
      if (err) {
        console.error('FALLBACK_ERR', err.message);
        console.error('FALLBACK_STDERR', stderr || '');
        resolve([]);
        return;
      }
      console.log('FALLBACK_STDOUT', stdout || '');
      try {
        const parsed = stdout && stdout.trim() ? JSON.parse(stdout) : [];
        console.log('FALLBACK_COUNT', Array.isArray(parsed) ? parsed.length : 1);
      } catch (parseErr) {
        console.error('FALLBACK_PARSE_ERR', parseErr.message);
      }
      resolve([]);
    });
  });
}

app.whenReady().then(async () => {
  try {
    const ports = await SerialPort.list();
    console.log('SERIALPORT_LIST', JSON.stringify(ports, null, 2));
  } catch (err) {
    console.error('SERIALPORT_ERR', err && err.stack ? err.stack : err);
  }

  await listWindowsPortsFallback();
  app.exit(0);
});
