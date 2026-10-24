// debug_youtube.js
const { app, BrowserWindow, session } = require('electron');
const privacyManager = require('../src/main/privacyManager');
const TabManager = require('../src/main/tabManager');
const ProxyManager = require('../src/main/proxyManager');
const SettingsManager = require('../src/main/settingsManager');
const PermissionsManager = require('../src/main/permissionsManager');

app.whenReady().then(async () => {
  const ses = session.defaultSession;

  const blockedRequests = [];
  const allRequests = [];
  const failedLoads = [];

  // Track webRequest onBeforeRequest
  ses.webRequest.onBeforeRequest((details, callback) => {
    allRequests.push({ url: details.url, resourceType: details.resourceType, id: details.id });
    callback({});
  });

  // Track blocker blocked requests
  await privacyManager.init(ses);
  privacyManager.blocker.on('request-blocked', (req) => {
    blockedRequests.push({
      url: req.url,
      type: req.type,
      filter: req.match ? req.match.toString() : 'unknown'
    });
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

  const tabManager = new TabManager(win);
  const tab = tabManager.createTab('https://www.youtube.com/', true);

  tab.view.webContents.on('did-fail-load', (e, code, desc, validatedURL, isMainFrame) => {
    failedLoads.push({ code, desc, validatedURL, isMainFrame });
  });

  console.log('Loading YouTube Home Page...');
  // Wait 10 seconds for initial load
  await new Promise((r) => setTimeout(r, 10000));

  // Inspect DOM state in YouTube
  const domState = await tab.view.webContents.executeJavaScript(`(() => {
    const browse = document.querySelector('ytd-browse');
    const richGrid = document.querySelector('ytd-rich-grid-renderer');
    const richItems = document.querySelectorAll('ytd-rich-item-renderer');
    const skeletons = document.querySelectorAll('#skeleton, .ytd-ghost-grid-renderer');
    const videoTitles = Array.from(document.querySelectorAll('#video-title')).map(el => el.textContent.trim()).filter(Boolean);
    const contents = document.querySelector('#contents');

    // Check display / visibility of rich grid
    let gridStyle = null;
    if (richGrid) {
      const cs = window.getComputedStyle(richGrid);
      gridStyle = { display: cs.display, visibility: cs.visibility, opacity: cs.opacity, height: cs.height };
    }

    // Check first item style
    let firstItemStyle = null;
    if (richItems.length > 0) {
      const cs = window.getComputedStyle(richItems[0]);
      firstItemStyle = { display: cs.display, visibility: cs.visibility, height: cs.height };
    }

    return {
      hasBrowse: !!browse,
      hasRichGrid: !!richGrid,
      richItemsCount: richItems.length,
      skeletonsCount: skeletons.length,
      videoTitlesCount: videoTitles.length,
      sampleTitles: videoTitles.slice(0, 5),
      gridStyle,
      firstItemStyle,
      bodyTextSnippet: (document.body.innerText || '').slice(0, 300)
    };
  })()`);

  console.log('\n--- DOM State ---');
  console.log(JSON.stringify(domState, null, 2));

  console.log('\n--- Failed Loads ---');
  console.log(JSON.stringify(failedLoads, null, 2));

  console.log('\n--- Blocked Requests Count:', blockedRequests.length, '---');
  const criticalPatterns = ['youtube.com/youtubei/', 'googlevideo.com', 'ytimg.com', 'gstatic.com'];
  criticalPatterns.forEach(pattern => {
    const matching = blockedRequests.filter(r => r.url.includes(pattern));
    console.log(`Blocked matching "${pattern}":`, matching.length);
    matching.forEach(m => console.log('  -> Blocked:', m.url, 'Rule:', m.filter));
  });

  console.log('\nSample of other blocked requests:');
  blockedRequests.slice(0, 10).forEach(r => console.log('  Blocked:', r.url, 'Rule:', r.filter));

  // Check youtubei requests that went through
  const youtubeiRequests = allRequests.filter(r => r.url.includes('/youtubei/'));
  console.log('\nTotal /youtubei/ requests attempted:', youtubeiRequests.length);
  youtubeiRequests.forEach(r => console.log('  youtubei req:', r.url));

  win.close();
  app.quit();
});
