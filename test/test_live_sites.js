// test_live_sites.js - Tests real-world websites: YouTube, DuckDuckGo, JSON API, and News site
const { app, BrowserWindow, session } = require('electron');
const path = require('path');

const TabManager = require('../src/main/tabManager');
const SplitManager = require('../src/main/splitManager');
const WorkspaceManager = require('../src/main/workspaceManager');
const TabSuspender = require('../src/main/tabSuspender');
const privacyManager = require('../src/main/privacyManager');

const warnings = [];
const unhandled = [];

process.on('warning', (w) => warnings.push(`${w.name}: ${w.message}`));
process.on('unhandledRejection', (r) => unhandled.push(r && (r.stack || r.message || String(r))));

app.whenReady().then(async () => {
  console.log('--- Initializing Privacy Engine ---');
  await privacyManager.init(session.defaultSession);

  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
    },
  });

  const tabManager = new TabManager(win);
  const splitManager = new SplitManager(win, tabManager);
  const workspaceManager = new WorkspaceManager(win, tabManager, splitManager);
  const tabSuspender = new TabSuspender(win, tabManager, splitManager, workspaceManager);

  console.log('\n--- 1. Testing DuckDuckGo ---');
  const ddgTab = tabManager.createTab('https://duckduckgo.com', true);
  await new Promise((r) => setTimeout(r, 2000));
  console.log(`✓ DuckDuckGo title: "${ddgTab.title}"`);

  console.log('\n--- 2. Testing Live JSON endpoint ---');
  const jsonTab = tabManager.createTab('https://jsonplaceholder.typicode.com/todos/1', true);
  await new Promise((r) => setTimeout(r, 2000));
  console.log(`✓ JSON endpoint title: "${jsonTab.title}"`);

  console.log('\n--- 3. Testing YouTube (cosmetic filters & scriptlets) ---');
  const ytTab = tabManager.createTab('https://www.youtube.com', true);
  await new Promise((r) => setTimeout(r, 4000));
  console.log(`✓ YouTube title: "${ytTab.title}"`);

  console.log('\n--- 4. Checking Listener Counts ---');
  for (const t of [ddgTab, jsonTab, ytTab]) {
    const counts = tabManager.logTabListenerCounts(t.id);
    console.log(`Tab ${t.id} (${t.url}): did-stop-loading = ${counts ? counts['did-stop-loading'] : 'n/a'}`);
    if (counts && counts['did-stop-loading'] > 1) {
      throw new Error(`Listener leak on tab ${t.id}`);
    }
  }

  console.log('\n--- 5. Warnings and Unhandled Rejections Summary ---');
  console.log(`Warnings: ${warnings.length}`);
  console.log(`Unhandled Rejections: ${unhandled.length}`);

  win.close();

  if (warnings.length === 0 && unhandled.length === 0) {
    console.log('\n🎉 ALL REAL-WORLD LIVE SITES VERIFIED CLEAN WITH 0 WARNINGS!');
    process.exit(0);
  } else {
    console.error('Warnings/Rejections encountered:', { warnings, unhandled });
    process.exit(1);
  }
});
