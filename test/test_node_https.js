const { app, safeStorage } = require('electron');
const https = require('https');
const path = require('path');
const os = require('os');
const fs = require('fs');

const targetDir = path.join(os.homedir(), 'AppData', 'Roaming', 'Coder Browser');
app.setPath('userData', targetDir);

app.whenReady().then(async () => {
  try {
    const keyPath = path.join(targetDir, 'ai-key.bin');
    const keyBuf = fs.readFileSync(keyPath);
    const apiKey = safeStorage.decryptString(keyBuf);
    console.log('API key length:', apiKey.length);

    console.log('Sending raw POST with Node https.request...');
    const t0 = Date.now();
    const bodyData = JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: 'hi' }] }]
    });

    const req = https.request({
      hostname: 'generativelanguage.googleapis.com',
      path: `/v1beta/models/gemini-3.8-flash:generateContent?key=${apiKey}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyData),
      },
      timeout: 10000,
    }, (res) => {
      console.log(`Node https returned in ${Date.now() - t0}ms! Status: ${res.statusCode} ${res.statusMessage}`);
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        console.log('Data received length:', data.length, 'snippet:', data.slice(0, 150));
        app.quit();
      });
    });

    req.on('error', (e) => {
      console.error('Node https error:', e);
      app.quit();
    });

    req.on('timeout', () => {
      console.error('Node https timeout');
      req.destroy();
      app.quit();
    });

    req.write(bodyData);
    req.end();
  } catch (err) {
    console.error('Fatal error:', err);
    app.quit();
  }
});
