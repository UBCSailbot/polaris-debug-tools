const { app } = require('electron');
const { SerialPort } = require('serialport');
app.whenReady().then(async () => {
  try {
    const ports = await SerialPort.list();
    console.log(JSON.stringify(ports, null, 2));
  } catch (err) {
    console.error('LIST_ERR', err && err.stack ? err.stack : err);
    process.exitCode = 1;
  } finally {
    app.quit();
  }
});
