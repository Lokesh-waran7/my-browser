// test_each_variation.js
const { app, BrowserWindow, session } = require('electron');
const { ElectronBlocker } = require('@ghostery/adblocker-electron');
const path = require('path');
const fs = require('fs');

async function runTest(label, setupFn) {
  const partition = `persist:test_${label}_${Date.now()}`;
  const ses = session.fromPartition(partition);

  const blocked = [];
  const blockedPatterns = {
    'youtubei': 0,
    'googlevideo': 0,
    'ytimg': 0,
    'gstatic': 0
  };

  const blocker = await setupFn(ses, blocked, blockedPatterns);

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    webPreferences: {
      partition,
      sandbox: true,
      contextIsolation: true,
    }
  });

  try {
    await win.loadURL('https://www.youtube.com/');
  } catch (_) {}

  // Wait 5 seconds for initial load and render
  await new Promise(r => setTimeout(r, 5000));

  let res = null;
  try {
    res = await Promise.race([
      win.webContents.executeJavaScript(`(() => {
        const richItems = Array.from(document.querySelectorAll('ytd-rich-item-renderer'));
        const skeletons = document.querySelectorAll('#skeleton, .ytd-ghost-grid-renderer');
        const firstItem = richItems[0];
        const firstItemText = firstItem && firstItem.innerText ? firstItem.innerText.trim() : null;
        const feedLoaded = !!firstItemText && firstItemText.length > 5;
        
        const titles = [];
        richItems.slice(0, 3).forEach(item => {
          const titleEl = item.querySelector('#video-title, h3, .yt-lockup-metadata-view-model-wiz__title');
          if (titleEl && titleEl.textContent) titles.push(titleEl.textContent.trim());
        });

        return {
          feedLoaded,
          richItemsCount: richItems.length,
          skeletonsCount: skeletons.length,
          firstItemSnippet: firstItemText ? firstItemText.slice(0, 60).replace(/\\n/g, ' ') : null,
          sampleTitles: titles
        };
      })()`),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timed out (page JS frozen)')), 4000))
    ]);
  } catch (err) {
    res = { feedLoaded: false, error: err.message };
  }

  win.close();

  return {
    label,
    feedLoaded: res && res.feedLoaded,
    richItems: res ? res.richItemsCount : 0,
    snippet: res && res.firstItemSnippet ? res.firstItemSnippet : (res && res.error ? res.error : 'none'),
    blockedTotal: blocked.length,
    blockedYoutubei: blockedPatterns.youtubei,
    blockedGooglevideo: blockedPatterns.googlevideo,
    blockedYtimg: blockedPatterns.ytimg,
    blockedGstatic: blockedPatterns.gstatic
  };
}

app.whenReady().then(async () => {
  const results = [];

  // Baseline: Current cached engine with uBlock update and all current rules
  results.push(await runTest('Baseline (current code)', async (ses, blocked, patterns) => {
    const PrivacyManager = require('../src/main/privacyManager').constructor;
    const pm = new PrivacyManager();
    await pm.init(ses);
    pm.blocker.on('request-blocked', req => {
      blocked.push(req.url);
      if (req.url.includes('youtube.com/youtubei/')) patterns.youtubei++;
      if (req.url.includes('googlevideo.com')) patterns.googlevideo++;
      if (req.url.includes('ytimg.com')) patterns.ytimg++;
      if (req.url.includes('gstatic.com')) patterns.gstatic++;
    });
    return pm.blocker;
  }));

  // (a) Ad blocker fully off
  results.push(await runTest('(a) Ad blocker fully off', async (ses) => {
    return null;
  }));

  // (b) Network blocking only (no cosmetic filtering or scriptlets)
  results.push(await runTest('(b) Network blocking only', async (ses, blocked, patterns) => {
    const PrivacyManager = require('../src/main/privacyManager').constructor;
    const pm = new PrivacyManager();
    await pm.init(ses);
    pm.blocker.onInjectCosmeticFilters = async () => {};
    pm.blocker.on('request-blocked', req => {
      blocked.push(req.url);
      if (req.url.includes('youtube.com/youtubei/')) patterns.youtubei++;
      if (req.url.includes('googlevideo.com')) patterns.googlevideo++;
      if (req.url.includes('ytimg.com')) patterns.ytimg++;
      if (req.url.includes('gstatic.com')) patterns.gstatic++;
    });
    return pm.blocker;
  }));

  // (c) YouTube auto-skip scriptlet off
  results.push(await runTest('(c) YouTube auto-skip off', async (ses, blocked, patterns) => {
    const PrivacyManager = require('../src/main/privacyManager').constructor;
    const pm = new PrivacyManager();
    await pm.init(ses);
    pm.blocker.on('request-blocked', req => {
      blocked.push(req.url);
      if (req.url.includes('youtube.com/youtubei/')) patterns.youtubei++;
      if (req.url.includes('googlevideo.com')) patterns.googlevideo++;
      if (req.url.includes('ytimg.com')) patterns.ytimg++;
      if (req.url.includes('gstatic.com')) patterns.gstatic++;
    });
    // YouTube auto-skip scriptlet in youtubeAdHandler is only active on /watch and /shorts, so on / it is already inactive
    return pm.blocker;
  }));

  // (d) uBlock quick-fixes list update off (clean Ghostery engine without custom merged uBlock rules)
  results.push(await runTest('(d) uBlock updates off (clean engine)', async (ses, blocked, patterns) => {
    const { ipcMain } = require('electron');
    try {
      ipcMain.removeHandler('@ghostery/adblocker/inject-cosmetic-filters');
      ipcMain.removeHandler('@ghostery/adblocker/is-mutation-observer-enabled');
    } catch (_) {}
    const blocker = await ElectronBlocker.fromPrebuiltFull(fetch);
    blocker.enableBlockingInSession(ses);
    blocker.on('request-blocked', req => {
      blocked.push(req.url);
      if (req.url.includes('youtube.com/youtubei/')) patterns.youtubei++;
      if (req.url.includes('googlevideo.com')) patterns.googlevideo++;
      if (req.url.includes('ytimg.com')) patterns.ytimg++;
      if (req.url.includes('gstatic.com')) patterns.gstatic++;
    });
    return blocker;
  }));

  // (e) Third-party cookie blocking off
  results.push(await runTest('(e) 3rd-party cookies blocking off', async (ses, blocked, patterns) => {
    const PrivacyManager = require('../src/main/privacyManager').constructor;
    const pm = new PrivacyManager();
    pm.thirdPartyCookieBlockingEnabled = false;
    await pm.init(ses);
    pm.blocker.on('request-blocked', req => {
      blocked.push(req.url);
      if (req.url.includes('youtube.com/youtubei/')) patterns.youtubei++;
      if (req.url.includes('googlevideo.com')) patterns.googlevideo++;
      if (req.url.includes('ytimg.com')) patterns.ytimg++;
      if (req.url.includes('gstatic.com')) patterns.gstatic++;
    });
    return pm.blocker;
  }));

  // (f) Tracking-parameter stripping and HTTPS upgrade off
  results.push(await runTest('(f) Tracking strip & HTTPS off', async (ses, blocked, patterns) => {
    const PrivacyManager = require('../src/main/privacyManager').constructor;
    const pm = new PrivacyManager();
    pm.trackingStrippingEnabled = false;
    pm.httpsUpgradeEnabled = false;
    await pm.init(ses);
    pm.blocker.on('request-blocked', req => {
      blocked.push(req.url);
      if (req.url.includes('youtube.com/youtubei/')) patterns.youtubei++;
      if (req.url.includes('googlevideo.com')) patterns.googlevideo++;
      if (req.url.includes('ytimg.com')) patterns.ytimg++;
      if (req.url.includes('gstatic.com')) patterns.gstatic++;
    });
    return pm.blocker;
  }));

  // (g) Proxy mode off
  results.push(await runTest('(g) Proxy mode off', async (ses, blocked, patterns) => {
    const PrivacyManager = require('../src/main/privacyManager').constructor;
    const pm = new PrivacyManager();
    await pm.init(ses);
    pm.blocker.on('request-blocked', req => {
      blocked.push(req.url);
      if (req.url.includes('youtube.com/youtubei/')) patterns.youtubei++;
      if (req.url.includes('googlevideo.com')) patterns.googlevideo++;
      if (req.url.includes('ytimg.com')) patterns.ytimg++;
      if (req.url.includes('gstatic.com')) patterns.gstatic++;
    });
    return pm.blocker;
  }));

  console.log('\n========================================================================================');
  console.log('RESULTS TABLE:');
  console.log('========================================================================================');
  console.table(results);

  app.quit();
});
