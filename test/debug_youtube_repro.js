// debug_youtube_repro.js
const { app, BrowserWindow, session } = require('electron');
const privacyManager = require('../src/main/privacyManager');
const TabManager = require('../src/main/tabManager');

app.whenReady().then(async () => {
  const ses = session.defaultSession;
  await privacyManager.init(ses);

  const blocked = [];
  const requested = [];

  // Use non-blocking event to observe all sent requests
  ses.webRequest.onSendHeaders((details) => {
    requested.push({ url: details.url, type: details.resourceType });
  });

  privacyManager.blocker.on('request-blocked', (req) => {
    blocked.push({ url: req.url, type: req.type, filter: req.match ? req.match.toString() : '' });
  });

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: true,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      backgroundThrottling: false,
    }
  });

  const tabManager = new TabManager(win);
  const tab = tabManager.createTab('https://www.youtube.com/', true);
  if (tab.view) {
    win.contentView.addChildView(tab.view);
    tab.view.setBounds({ x: 0, y: 0, width: 1280, height: 800 });
  }

  console.log('Waiting 8 seconds for YouTube home feed to load...');
  await new Promise((r) => setTimeout(r, 8000));

  const dom = await tab.view.webContents.executeJavaScript(`(() => {
    const videoTitles = Array.from(document.querySelectorAll('#video-title')).map(e => e.textContent.trim()).filter(Boolean);
    const richItems = document.querySelectorAll('ytd-rich-item-renderer');
    const richGrid = document.querySelector('ytd-rich-grid-renderer');
    const skeletons = document.querySelectorAll('#skeleton, .ytd-ghost-grid-renderer, ytd-continuation-item-renderer');
    const masthead = document.querySelector('ytd-masthead');
    
    // Check if rich items are hidden by CSS
    let hiddenCount = 0;
    richItems.forEach(el => {
      const cs = window.getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') hiddenCount++;
    });

    return {
      title: document.title,
      videoTitlesCount: videoTitles.length,
      sampleTitles: videoTitles.slice(0, 5),
      richItemsTotal: richItems.length,
      richItemsHidden: hiddenCount,
      hasRichGrid: !!richGrid,
      skeletonsCount: skeletons.length,
      hasMasthead: !!masthead,
      bodyTextSnippet: (document.body.innerText || '').slice(0, 200).replace(/\\s+/g, ' ')
    };
  })()`).catch(err => ({ error: err.message }));

  console.log('\n=== REPRODUCTION RESULTS ===');
  console.log('DOM State:', JSON.stringify(dom, null, 2));

  console.log('\n=== BLOCKED REQUESTS COUNT ===', blocked.length);
  const critical = ['youtube.com/youtubei/', 'googlevideo.com', 'ytimg.com', 'gstatic.com'];
  critical.forEach(pat => {
    const matches = blocked.filter(b => b.url.includes(pat));
    console.log(`Blocked matching "${pat}": ${matches.length}`);
    matches.forEach(m => console.log('  BLOCKED:', m.url, 'RULE:', m.filter));
  });

  const youtubeiReqs = requested.filter(r => r.url.includes('/youtubei/'));
  console.log(`\nTotal /youtubei/ requests: ${youtubeiReqs.length}`);
  youtubeiReqs.forEach(r => console.log('  ->', r.url));

  win.close();
  app.quit();
});
