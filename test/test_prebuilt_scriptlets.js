// test_prebuilt_scriptlets.js
const { app, BrowserWindow, session } = require('electron');
const { ElectronBlocker } = require('@ghostery/adblocker-electron');

app.whenReady().then(async () => {
  const ses = session.defaultSession;
  const blocker = await ElectronBlocker.fromPrebuiltFull(fetch);
  blocker.enableBlockingInSession(ses);

  const res = blocker.getCosmeticsFilters({
    url: 'https://www.youtube.com/',
    hostname: 'www.youtube.com',
    domain: 'youtube.com'
  });
  console.log('Prebuilt scripts count:', res.scripts.length);

  const win = new BrowserWindow({ width: 1280, height: 800, show: false });
  await win.loadURL('https://www.youtube.com/');

  setTimeout(async () => {
    const data = await win.webContents.executeJavaScript(`(() => {
      const items = document.querySelectorAll('ytd-rich-item-renderer');
      const first = items[0];
      return {
        richItemsCount: items.length,
        firstItemText: first ? first.innerText.trim().slice(0, 80) : null
      };
    })()`).catch(e => ({ error: e.message }));
    console.log('Prebuilt result:', JSON.stringify(data, null, 2));
    win.close();
    app.quit();
  }, 8000);
});
