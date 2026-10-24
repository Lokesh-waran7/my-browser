// test_step10_partB.js - Tests for Step 10 Part B: Unified settings, first-run onboarding, error pages
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

const testUserDataDir = path.join(os.tmpdir(), 'coder_browser_test_step10_partB_' + Date.now());
fs.mkdirSync(testUserDataDir, { recursive: true });

const SettingsManager = require('../src/main/settingsManager');

async function runTests() {
  console.log('--- Testing Step 10 Part B Components ---');

  // 1. SettingsManager First-run and Developer Settings
  console.log('\n[1] Testing First-run & Developer Settings...');
  const settingsMgr = new SettingsManager(testUserDataDir);
  assert.strictEqual(settingsMgr.getSetting('firstRunDone'), false, 'firstRunDone should initially be false');
  assert.strictEqual(settingsMgr.getSetting('customUserAgent'), '', 'customUserAgent should initially be empty');
  assert.strictEqual(settingsMgr.getSetting('disableCache'), false, 'disableCache should initially be false');

  // Update first-run and developer settings
  settingsMgr.updateSettings({
    firstRunDone: true,
    customUserAgent: 'Mozilla/5.0 (Custom Mobile Test)',
    disableCache: true,
    defaultSearchEngine: 'brave',
  });

  assert.strictEqual(settingsMgr.getSetting('firstRunDone'), true, 'firstRunDone should update');
  assert.strictEqual(settingsMgr.getSetting('customUserAgent'), 'Mozilla/5.0 (Custom Mobile Test)');
  assert.strictEqual(settingsMgr.getSetting('disableCache'), true);
  assert.strictEqual(settingsMgr.getSetting('defaultSearchEngine'), 'brave');
  console.log('✓ SettingsManager Part B tests passed');

  // 2. Custom Error Page Generation
  console.log('\n[2] Testing Error Page Generation...');
  // Inspect TabManager file to verify generateErrorPageHtml exists and covers critical network codes
  const tabManagerContent = fs.readFileSync(path.join(__dirname, '../src/main/tabManager.js'), 'utf8');
  assert(tabManagerContent.includes('generateErrorPageHtml'), 'TabManager must define generateErrorPageHtml');
  assert(tabManagerContent.includes('INTERNET_DISCONNECTED'), 'Error page must handle INTERNET_DISCONNECTED');
  assert(tabManagerContent.includes('NAME_NOT_RESOLVED'), 'Error page must handle NAME_NOT_RESOLVED');
  assert(tabManagerContent.includes('CONNECTION_REFUSED'), 'Error page must handle CONNECTION_REFUSED');
  assert(tabManagerContent.includes('TIMED_OUT'), 'Error page must handle TIMED_OUT');
  assert(tabManagerContent.includes('Security Certificate Error'), 'Error page must handle SSL certificate errors');
  assert(tabManagerContent.includes('offline-badge'), 'Error page must include offline indicator');
  console.log('✓ Error Page Generation verification passed');

  // Clean up
  fs.rmSync(testUserDataDir, { recursive: true, force: true });
  console.log('\nAll Step 10 Part B unit tests PASSED successfully!');
}

runTests().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
