// diagnose_youtube.js
const { app, BrowserWindow, session } = require('electron');
const path = require('path');
const fs = require('fs');

app.whenReady().then(async () => {
  const ses = session.defaultSession;
  
  // Track all requests and responses
  const requests = [];
  const blocked = [];
  const failed = [];

  ses.webRequest.onSendHeaders((details) => {
    requests.push({
      id: details.id,
      url: details.url,
      method: details.method,
      type: details.resourceType,
      ua: details.requestHeaders['User-Agent'] || details.requestHeaders['user-agent']
    });
  });

  ses.webRequest.onErrorOccurred((details) => {
    failed.push({
      id: details.id,
      url: details.url,
      error: details.error,
      type: details.resourceType
    });
  });

  const privacyManager = require('../src/main/privacyManager');
  await privacyManager.init(ses);

  privacyManager.blocker.on('request-blocked', (req) => {
    blocked.push({
      url: req.url,
      type: req.type,
      filter: req.match ? req.match.toString() : 'unknown'
    });
  });

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: true,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
    }
  });

  const TabManager = require('../src/main/tabManager');
  const tabManager = new TabManager(win);

  // Wire view to window so it renders properly
  const tab = tabManager.createTab('https://www.youtube.com/', true);
  if (tab.view) {
    win.contentView.addChildView(tab.view);
    tab.view.setBounds({ x: 0, y: 0, width: 1280, height: 800 });
  }

  tab.view.webContents.on('did-fail-load', (e, code, desc, url, isMainFrame) => {
    failed.push({ code, desc, url, isMainFrame });
  });

  tab.view.webContents.on('console-message', (e) => {
    console.log(`[Renderer Console] ${e.level}: ${e.message}`);
  });

  console.log('Waiting 12 seconds for YouTube to complete initial load...');
  await new Promise(r => setTimeout(r, 12000));

  // Inspect the page DOM and Polymer elements
  const pageEvaluation = await tab.view.webContents.executeJavaScript(`(() => {
    const videoTitles = Array.from(document.querySelectorAll('#video-title')).map(el => el.textContent.trim()).filter(Boolean);
    const richItems = document.querySelectorAll('ytd-rich-item-renderer');
    const richGrid = document.querySelector('ytd-rich-grid-renderer');
    const browse = document.querySelector('ytd-browse');
    const skeletons = document.querySelectorAll('#skeleton, .ytd-ghost-grid-renderer, ytd-continuation-item-renderer, #home-page-skeleton');
    
    // Check if feed contents exists
    const contents = document.querySelector('#contents.ytd-rich-grid-renderer') || document.querySelector('#contents');
    const contentsChildren = contents ? contents.children.length : 0;

    // Check cosmetic CSS hiding
    let hiddenRichItems = 0;
    richItems.forEach(item => {
      const style = window.getComputedStyle(item);
      if (style.display === 'none' || style.visibility === 'hidden') hiddenRichItems++;
    });

    let richGridDisplay = richGrid ? window.getComputedStyle(richGrid).display : 'none';
    let browseDisplay = browse ? window.getComputedStyle(browse).display : 'none';

    // Check ytInitialData
    const hasInitialData = !!window.ytInitialData;
    const initialDataKeys = window.ytInitialData ? Object.keys(window.ytInitialData) : [];

    return {
      title: document.title,
      videoTitlesCount: videoTitles.length,
      sampleTitles: videoTitles.slice(0, 5),
      richItemsTotal: richItems.length,
      hiddenRichItems,
      contentsChildren,
      richGridDisplay,
      browseDisplay,
      skeletonsCount: skeletons.length,
      hasInitialData,
      initialDataKeys,
      userAgent: navigator.userAgent
    };
  })()`).catch(err => ({ error: err.message }));

  console.log('\n--- DOM & Page Evaluation ---');
  console.log(JSON.stringify(pageEvaluation, null, 2));

  console.log('\n--- Failed Requests / did-fail-load ---');
  console.log(`Total failed requests: ${failed.length}`);
  failed.forEach(f => console.log('  Failed:', f.url || f.validatedURL, f.error || f.desc));

  console.log('\n--- Critical Patterns Blocked ---');
  const critical = ['youtube.com/youtubei/', 'googlevideo.com', 'ytimg.com', 'gstatic.com'];
  critical.forEach(pat => {
    const matching = blocked.filter(b => b.url.includes(pat));
    console.log(`Blocked matching "${pat}": ${matching.length}`);
    matching.forEach(m => console.log('  ->', m.url, 'Rule:', m.filter));
  });

  console.log('\n--- Total /youtubei/ requests attempted ---');
  const ytReqs = requests.filter(r => r.url.includes('/youtubei/'));
  console.log(`Attempted /youtubei/: ${ytReqs.length}`);
  ytReqs.forEach(r => console.log('  ->', r.method, r.url));

  console.log('\nUser-Agent sent in requests:', requests.length > 0 ? requests[0].ua : 'none');

  win.close();
  app.quit();
});
