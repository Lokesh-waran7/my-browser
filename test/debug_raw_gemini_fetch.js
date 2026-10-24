const { app, safeStorage } = require('electron');
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

    console.log('Sending raw POST with fetch to gemini-3.8-flash:streamGenerateContent?alt=sse...');
    const t0 = Date.now();
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:streamGenerateContent?alt=sse&key=${apiKey}`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: 'hi' }] }]
      }),
      signal: AbortSignal.timeout(10000),
    });

    console.log(`Fetch returned in ${Date.now() - t0}ms! Status:`, res.status, res.statusText);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value);
      console.log('SSE Chunk:', text.slice(0, 100));
    }
    console.log('Raw fetch stream completed!');
  } catch (err) {
    console.error('Raw fetch error:', err);
  } finally {
    app.quit();
  }
});
