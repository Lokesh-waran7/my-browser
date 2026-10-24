// test_yt_loading.js
const { app, BrowserWindow, session } = require('electron');
const privacyManager = require('../src/main/privacyManager');

app.whenReady().then(async () => {
  const ses = session.defaultSession;
  // Initialize PrivacyManager with refreshUblockFilters disabled
  const PrivacyManager = require('../src/main/privacyManager').constructor;
  const pm = new PrivacyManager();
  pm.refreshUblockFilters = async () => {}; // disabled
  await pm.init(ses);

  const pendingRequests = new Map();

  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    pendingRequests.set(details.id, { url: details.url, type: details.resourceType, startTime: Date.now() });
    callback({ requestHeaders: details.requestHeaders });
  });

  ses.webRequest.onCompleted((details) => {
    pendingRequests.delete(details.id);
  });

  ses.webRequest.onErrorOccurred((details) => {
    pendingRequests.delete(details.id);
  });

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
    }
  });

  let stopCount = 0;
  win.webContents.on('did-stop-loading', async () => {
    stopCount++;
    const currentUrl = win.webContents.getURL();
    console.log(`[did-stop-loading #${stopCount}] URL: ${currentUrl}`);

    // Wait a moment for dynamic rendering
    setTimeout(async () => {
      try {
        const res = await win.webContents.executeJavaScript(`(() => {
          const titles = Array.from(document.querySelectorAll('#video-title')).map(e => e.textContent.trim()).filter(Boolean);
          const richItems = Array.from(document.querySelectorAll('ytd-rich-item-renderer'));
          const skeletons = document.querySelectorAll('#skeleton, .ytd-ghost-grid-renderer');
          const firstItem = richItems[0];
          
          return {
            url: window.location.href,
            title: document.title,
            titlesCount: titles.length,
            richItemsCount: richItems.length,
            skeletonsCount: skeletons.length,
            firstItemTag: firstItem ? firstItem.tagName : null,
            firstItemHtml: firstItem ? firstItem.innerHTML.slice(0, 500) : null,
            firstItemText: firstItem ? firstItem.innerText : null,
            firstItemDisplay: firstItem ? window.getComputedStyle(firstItem).display : null,
            gridDisplay: document.querySelector('ytd-rich-grid-renderer') ? window.getComputedStyle(document.querySelector('ytd-rich-grid-renderer')).display : null,
            browseDisplay: document.querySelector('ytd-browse') ? window.getComputedStyle(document.querySelector('ytd-browse')).display : null
          };
        })()`);
        console.log(`[DOM Check after stop #${stopCount}]:`, JSON.stringify(res, null, 2));

        if (stopCount >= 2 || res.titlesCount > 0) {
          setTimeout(() => {
            win.close();
            app.quit();
          }, 1000);
        }
      } catch (e) {
        console.error(`executeJavaScript error on stop #${stopCount}:`, e.message);
      }
    }, 3000);
  });

  console.log('Loading YouTube...');
  win.loadURL('https://www.youtube.com/').catch(err => console.log('loadURL error:', err.message));
});
