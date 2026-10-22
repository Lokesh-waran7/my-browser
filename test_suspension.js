// Automated verification script for Step 6 (Tab Suspension & Memory Dashboard)
const { app, BrowserWindow, session } = require('electron');
const path = require('path');
const TabManager = require('./src/main/tabManager');
const SplitManager = require('./src/main/splitManager');
const WorkspaceManager = require('./src/main/workspaceManager');
const TabSuspender = require('./src/main/tabSuspender');
const privacyManager = require('./src/main/privacyManager');

async function runTests() {
  console.log('--- Starting Step 6 Automated Tests ---');

  await app.whenReady();
  await privacyManager.init(session.defaultSession);

  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const tabManager = new TabManager(win);
  const splitManager = new SplitManager(win, tabManager);
  const workspaceManager = new WorkspaceManager(win, tabManager, splitManager);
  const tabSuspender = new TabSuspender(win, tabManager, splitManager, workspaceManager);

  tabManager.tabSuspender = tabSuspender;
  splitManager.tabSuspender = tabSuspender;
  workspaceManager.tabSuspender = tabSuspender;

  // Initialize workspace manager
  workspaceManager.init();
  console.log('✓ Managers initialized successfully.');

  // Test 1: Create multiple tabs
  const tab1 = tabManager.createTab('https://example.com', true);
  tab1.title = 'Example Active';
  tabManager.activeTabId = tab1.id;

  const tab2 = tabManager.createTab('https://duckduckgo.com', false);
  tab2.title = 'DuckDuckGo Background';

  const tab3 = tabManager.createTab('https://wikipedia.org', false);
  tab3.title = 'Wikipedia Background';

  console.log(`✓ Created 3 tabs: active=${tab1.id}, bg=${tab2.id}, bg=${tab3.id}`);

  // Test 2: Active tab cannot be suspended
  const canSuspendActive = await tabSuspender.canSuspend(tab1.id);
  if (canSuspendActive === false) {
    console.log('✓ PASS: Active tab cannot be suspended.');
  } else {
    throw new Error('FAIL: Active tab was marked suspendable!');
  }

  // Test 3: Background tab can be suspended
  const canSuspendBg = await tabSuspender.canSuspend(tab2.id);
  if (canSuspendBg === true) {
    console.log('✓ PASS: Background tab can be suspended.');
  } else {
    throw new Error('FAIL: Background tab was not marked suspendable!');
  }

  // Test 4: Suspend background tab
  const suspended = await tabSuspender.suspendTab(tab2.id);
  if (suspended && tab2.isSuspended && tab2.view === null) {
    console.log(`✓ PASS: Tab ${tab2.id} successfully suspended, WebContents destroyed, URL/title preserved (${tab2.url}, ${tab2.title}).`);
  } else {
    throw new Error(`FAIL: Tab ${tab2.id} suspension failed or view was not destroyed!`);
  }

  // Test 5: Whitelist site protection
  tabSuspender.addWhitelist('wikipedia.org');
  const canSuspendWhitelisted = await tabSuspender.canSuspend(tab3.id);
  if (canSuspendWhitelisted === false) {
    console.log('✓ PASS: Whitelisted domain (wikipedia.org) is protected from suspension.');
  } else {
    throw new Error('FAIL: Whitelisted site was allowed to be suspended!');
  }

  // Test 6: Memory stats
  const stats = tabSuspender.getMemoryStats();
  console.log(`✓ Memory stats: Total App RAM = ${stats.totalAppMemoryMB} MB, Suspended tabs = ${stats.suspendedTabsCount}, Estimated Saved = ${stats.estimatedRamSavedMB} MB`);
  if (stats.suspendedTabsCount === 1 && stats.estimatedRamSavedMB > 0) {
    console.log('✓ PASS: Memory dashboard stats calculation verified.');
  } else {
    throw new Error('FAIL: Memory stats did not report suspended tabs correctly!');
  }

  // Test 7: Unsuspend on switch/access
  tabSuspender.unsuspendTab(tab2.id);
  if (!tab2.isSuspended && tab2.view && tab2.view.webContents) {
    console.log(`✓ PASS: Tab ${tab2.id} unsuspended, WebContentsView recreated, load initiated.`);
  } else {
    throw new Error('FAIL: Unsuspension did not recreate WebContentsView!');
  }

  console.log('--- ALL AUTOMATED VERIFICATION CHECKS PASSED ---');
  win.close();
  app.quit();
}

runTests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
