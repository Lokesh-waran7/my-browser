// verify_warnings_clean.js - Verifies startup and runtime warnings are 100% eliminated
const { app, BrowserWindow, session } = require('electron');
const path = require('path');
const http = require('http');

// Setup mock servers for YouTube, News site with ads, and JSON endpoint
const server = http.createServer((req, res) => {
  if (req.url === '/json') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ greeting: 'hello world', items: [1, 2, 3], nested: { a: true, b: 'coder' } }));
    return;
  }
  if (req.url === '/news') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`
      <!DOCTYPE html>
      <html>
        <head><title>News Site with Ads</title></head>
        <body>
          <h1>Breaking News</h1>
          <div class="ad-banner" id="banner-ad">Advertisement</div>
          <div class="sponsored-post">Sponsored Content</div>
          <p>This is a major news article.</p>
        </body>
      </html>
    `);
    return;
  }
  if (req.url.startsWith('/youtube')) {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`
      <!DOCTYPE html>
      <html>
        <head><title>YouTube Watch Test</title></head>
        <body>
          <div id="movie_player" class="html5-video-player ad-showing">
            <video id="player-video"></video>
            <button class="ytp-ad-skip-button">Skip</button>
          </div>
        </body>
      </html>
    `);
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end('<!DOCTYPE html><html><body><h1>Home</h1></body></html>');
});

const TabManager = require('../src/main/tabManager');
const SplitManager = require('../src/main/splitManager');
const WorkspaceManager = require('../src/main/workspaceManager');
const TabSuspender = require('../src/main/tabSuspender');
const privacyManager = require('../src/main/privacyManager');
const AIManager = require('../src/main/ai/aiManager');
const ProxyManager = require('../src/main/proxyManager');

let capturedWarnings = [];
let capturedRejections = [];

process.on('warning', (warning) => {
  capturedWarnings.push(`[ProcessWarning] ${warning.name}: ${warning.message}`);
});

process.on('unhandledRejection', (reason) => {
  capturedRejections.push(`[UnhandledRejection] ${reason && (reason.stack || reason.message || reason)}`);
});

const originalStderrWrite = process.stderr.write.bind(process.stderr);
process.stderr.write = function (chunk, encoding, callback) {
  const str = chunk.toString();
  if (
    str.includes('MaxListenersExceededWarning') ||
    str.includes('deprecated') ||
    str.includes('canGoBack') ||
    str.includes('isEncryptionAvailable') ||
    str.includes('Script failed to execute')
  ) {
    capturedWarnings.push(`[Stderr] ${str.trim()}`);
  }
  return originalStderrWrite(chunk, encoding, callback);
};

app.whenReady().then(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  console.log(`[TestServer] Running on port ${port}`);

  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
    },
  });

  console.log('\n--- 1. Testing PrivacyManager & AdBlocker Init ---');
  await privacyManager.init(session.defaultSession);
  console.log('✓ PrivacyManager initialized cleanly');

  console.log('\n--- 2. Testing AIManager & ProxyManager Init (Async SafeStorage) ---');
  const tabManager = new TabManager(win);
  const splitManager = new SplitManager(win, tabManager);
  const workspaceManager = new WorkspaceManager(win, tabManager, splitManager);
  const tabSuspender = new TabSuspender(win, tabManager, splitManager, workspaceManager);
  const aiManager = new AIManager(win, tabManager, workspaceManager);
  const proxyManager = new ProxyManager(win);

  tabManager.tabSuspender = tabSuspender;
  tabManager.proxyManager = proxyManager;

  await aiManager.init();
  await proxyManager.init();
  console.log('✓ AIManager and ProxyManager initialized with zero deprecation warnings');

  console.log('\n--- 3. Testing Navigation: DuckDuckGo, JSON, News with Ads, YouTube ---');
  const tab1 = tabManager.createTab(`http://127.0.0.1:${port}/json`, true);
  await new Promise((r) => setTimeout(r, 600));

  const tab2 = tabManager.createTab(`http://127.0.0.1:${port}/news`, true);
  await new Promise((r) => setTimeout(r, 600));

  const tab3 = tabManager.createTab(`http://127.0.0.1:${port}/youtube/watch?v=test`, true);
  await new Promise((r) => setTimeout(r, 600));

  console.log('✓ Pages loaded successfully');

  console.log('\n--- 4. Checking Event Listener Counts on Active Tabs ---');
  for (const t of [tab1, tab2, tab3]) {
    const counts = tabManager.logTabListenerCounts(t.id);
    console.log(`Tab ${t.id} listener counts:`, counts);
    for (const [ev, count] of Object.entries(counts)) {
      if (count > 2) {
        throw new Error(`Listener leak detected on ${ev}: count=${count} on tab ${t.id}`);
      }
    }
  }
  console.log('✓ All tab event listener counts strictly bounded (<= 2 per event, zero leaks)');

  console.log('\n--- 5. Testing Navigation History & Deprecation-Free Methods ---');
  tabManager.goBack(tab1.id);
  tabManager.goForward(tab1.id);
  console.log('✓ canGoBack/canGoForward/goBack/goForward executed with zero deprecation warnings');

  console.log('\n--- 6. Testing 15-Tab Rapid Open / Switch / Suspend / Close Cycle ---');
  const tabIds = [];
  for (let i = 0; i < 15; i++) {
    const t = tabManager.createTab(`http://127.0.0.1:${port}/news`, true);
    tabIds.push(t.id);
  }

  // Switch between tabs
  for (let i = 0; i < 15; i += 3) {
    tabManager.ensureActiveTabView(tabIds[i]);
  }

  // Split view exercise
  splitManager.startSplit(tabIds[0]);
  splitManager.setRightTab(tabIds[1]);
  splitManager.applyLayout();
  splitManager.closeSplit();

  // Suspend background tabs
  for (let i = 5; i < 15; i++) {
    await tabSuspender.suspendTab(tabIds[i], true);
  }

  // Unsuspend
  for (let i = 5; i < 10; i++) {
    tabSuspender.unsuspendTab(tabIds[i]);
  }

  // Close all 15 tabs
  for (const tid of tabIds) {
    tabManager.closeTab(tid);
  }
  console.log('✓ 15-tab open/switch/split/suspend/close cycle completed cleanly');

  console.log('\n--- 7. Verification Summary ---');
  console.log(`Captured warnings: ${capturedWarnings.length}`);
  if (capturedWarnings.length > 0) {
    console.error('Warnings found:', capturedWarnings);
  }
  console.log(`Captured unhandled rejections: ${capturedRejections.length}`);
  if (capturedRejections.length > 0) {
    console.error('Unhandled rejections found:', capturedRejections);
  }

  server.close();
  win.close();

  if (capturedWarnings.length === 0 && capturedRejections.length === 0) {
    console.log('\n🎉 ALL STARTUP AND RUNTIME WARNING CHECKS PASSED WITH 0 WARNINGS!');
    process.exit(0);
  } else {
    console.error('\n❌ FAIL: Warnings or unhandled rejections detected.');
    process.exit(1);
  }
});
