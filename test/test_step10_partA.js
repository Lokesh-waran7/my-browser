// test_step10_partA.js - Comprehensive test for Step 10 Part A
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Setup a temp test dir for userData
const testUserDataDir = path.join(os.tmpdir(), 'coder_browser_test_step10_' + Date.now());
fs.mkdirSync(testUserDataDir, { recursive: true });

const SettingsManager = require('../src/main/settingsManager');
const HistoryManager = require('../src/main/historyManager');
const BookmarksManager = require('../src/main/bookmarksManager');
const DownloadsManager = require('../src/main/downloadsManager');
const PermissionsManager = require('../src/main/permissionsManager');

async function runTests() {
  console.log('--- Testing Step 10 Part A Components ---');

  // 1. SettingsManager Tests
  console.log('\n[1] Testing SettingsManager...');
  const settingsMgr = new SettingsManager(testUserDataDir);
  const initialSettings = settingsMgr.getSettings();
  assert.strictEqual(initialSettings.defaultSearchEngine, 'duckduckgo', 'Default search engine should be duckduckgo');
  assert.strictEqual(initialSettings.historyEnabled, true, 'History should default to enabled');
  assert.strictEqual(initialSettings.askWhereToSave, false, 'askWhereToSave should default to false');

  settingsMgr.updateSettings({ defaultSearchEngine: 'google', askWhereToSave: true });
  assert.strictEqual(settingsMgr.getSetting('defaultSearchEngine'), 'google', 'Updated setting must reflect');
  assert.strictEqual(settingsMgr.getSetting('askWhereToSave'), true, 'Updated setting must reflect');
  console.log('✓ SettingsManager tests passed');

  // 2. HistoryManager Tests
  console.log('\n[2] Testing HistoryManager...');
  const historyMgr = new HistoryManager(settingsMgr, null, testUserDataDir);
  historyMgr.setNeverShareDomains(['secret.internal', 'vault.local']);

  // Add entries
  historyMgr.addEntry('https://duckduckgo.com', 'DuckDuckGo Search');
  historyMgr.addEntry('https://github.com/features', 'GitHub Features');
  // Internal or never-share domain entries should be rejected
  historyMgr.addEntry('browser://history', 'Browser History');
  historyMgr.addEntry('https://secret.internal/dashboard', 'Secret Dashboard');

  let history = historyMgr.getHistory();
  assert.strictEqual(history.length, 2, 'Should only record valid, non-blocked URLs');
  assert.strictEqual(history[0].url, 'https://github.com/features', 'Newest entry should be first');

  // Search
  let searchRes = historyMgr.getHistory('duck');
  assert.strictEqual(searchRes.length, 1, 'Search query should filter correctly');
  assert.strictEqual(searchRes[0].url, 'https://duckduckgo.com');

  // Suggestions
  let suggs = historyMgr.getSuggestions('git');
  assert.strictEqual(suggs.length, 1, 'Suggestions should return matching URLs');

  // Delete entry
  historyMgr.deleteEntry(history[0].id);
  assert.strictEqual(historyMgr.getHistory().length, 1, 'Deleting entry should reduce count');

  // Clear history
  historyMgr.clearHistory();
  assert.strictEqual(historyMgr.getHistory().length, 0, 'Clear history should empty entries');
  console.log('✓ HistoryManager tests passed');

  // 3. BookmarksManager Tests
  console.log('\n[3] Testing BookmarksManager...');
  const bookmarksMgr = new BookmarksManager(testUserDataDir);

  // Add bookmark
  const b1 = bookmarksMgr.addBookmark({
    title: 'MDN Web Docs',
    url: 'https://developer.mozilla.org',
    folder: 'Developer Resources',
  });
  assert(b1.id, 'Bookmark should have ID');
  assert.strictEqual(bookmarksMgr.isBookmarked('https://developer.mozilla.org'), true, 'Should be marked as bookmarked');

  // Add custom folder
  bookmarksMgr.addFolder('Tech Blogs');
  assert(bookmarksMgr.getFolders().includes('Tech Blogs'), 'New folder should exist');

  // Suggestions
  const bmSuggs = bookmarksMgr.getSuggestions('mozilla');
  assert.strictEqual(bmSuggs.length, 1, 'Bookmark suggestions should match');

  // Export HTML
  const exportedHtml = bookmarksMgr.exportToHtml();
  assert(exportedHtml.includes('<!DOCTYPE NETSCAPE-Bookmark-file-1>'), 'Export should produce Netscape format HTML');
  assert(exportedHtml.includes('https://developer.mozilla.org'), 'Export HTML should contain bookmark URL');

  // Import HTML
  const testHtml = `
    <!DOCTYPE NETSCAPE-Bookmark-file-1>
    <TITLE>Bookmarks</TITLE>
    <H1>Bookmarks</H1>
    <DL><p>
      <DT><H3>Imported Folder</H3>
      <DL><p>
        <DT><A HREF="https://nodejs.org">Node.js</A>
      </DL><p>
    </DL><p>
  `;
  const importResult = bookmarksMgr.importFromHtml(testHtml);
  assert.strictEqual(importResult.imported, 1, 'Should import 1 bookmark');
  assert.strictEqual(bookmarksMgr.isBookmarked('https://nodejs.org'), true, 'Imported bookmark should exist');

  // Remove bookmark
  bookmarksMgr.removeBookmark('https://developer.mozilla.org');
  assert.strictEqual(bookmarksMgr.isBookmarked('https://developer.mozilla.org'), false, 'Bookmark should be removed');
  console.log('✓ BookmarksManager tests passed');

  // 4. PermissionsManager Tests
  console.log('\n[4] Testing PermissionsManager...');
  const permissionsMgr = new PermissionsManager(null, null, testUserDataDir);

  // Initial check should be null (not set)
  let check = permissionsMgr.checkPermission('https://example.com/app', 'media');
  assert.strictEqual(check, null, 'Unsaved permission should return null');

  // Save permission
  permissionsMgr.savePermissionDecision('https://example.com/app', 'media', true);
  check = permissionsMgr.checkPermission('https://example.com/app', 'media');
  assert.strictEqual(check, true, 'Allowed permission should return true');

  // Denial
  permissionsMgr.savePermissionDecision('https://badsite.com', 'geolocation', false);
  check = permissionsMgr.checkPermission('https://badsite.com/track', 'geolocation');
  assert.strictEqual(check, false, 'Denied permission should return false');
  console.log('✓ PermissionsManager tests passed');

  // 5. DownloadsManager Tests
  console.log('\n[5] Testing DownloadsManager...');
  const downloadsMgr = new DownloadsManager(null, settingsMgr, null, testUserDataDir);
  assert(Array.isArray(downloadsMgr.getDownloads()), 'Downloads list should be an array');
  console.log('✓ DownloadsManager tests passed');

  // Clean up test temp dir
  fs.rmSync(testUserDataDir, { recursive: true, force: true });
  console.log('\nAll Step 10 Part A unit tests PASSED successfully!');
}

runTests().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
