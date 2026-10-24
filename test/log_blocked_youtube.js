// log_blocked_youtube.js
const { app, BrowserWindow, session } = require('electron');
const { ElectronBlocker } = require('@ghostery/adblocker-electron');
const fs = require('fs');
const path = require('path');

app.whenReady().then(async () => {
  const cachePath = path.join(process.env.APPDATA, 'my-browser', 'adblocker-engine.bin');
  const b = ElectronBlocker.deserialize(fs.readFileSync(cachePath));
  const ses = session.defaultSession;
  b.enableBlockingInSession(ses);

  const blockedList = [];

  b.on('request-blocked', req => {
    const item = { type: req.type, url: req.url, filter: req.match ? req.match.toString() : '' };
    blockedList.push(item);
    console.log('[BLOCKED]', item.type, item.url);
    if (item.filter) console.log('   RULE:', item.filter);
  });

  const win = new BrowserWindow({ show: false });
  await win.loadURL('https://www.youtube.com/');

  setTimeout(() => {
    console.log('\n--- TOTAL BLOCKED:', blockedList.length, '---');
    win.close();
    app.quit();
  }, 8000);
});
