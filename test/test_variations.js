// test_variations.js
const { app, BrowserWindow, session } = require('electron');
const path = require('path');
const fs = require('fs');

// We will test each condition (a) through (g) and baseline.
// Conditions:
// 'baseline': all current features on
// 'a': ad blocker fully off
// 'b': network blocking only (no cosmetic filtering or scriptlets)
// 'c': YouTube auto-skip scriptlet off
// 'd': uBlock quick-fixes update off
// 'e': third-party cookie blocking off
// 'f': tracking-parameter stripping & HTTPS upgrade off
// 'g': proxy mode off (proxy is already off by default, but test explicitly)

async function testCondition(name, config) {
  console.log(`\n========================================`);
  console.log(`Testing Condition [${name}]: ${config.description}`);
  console.log(`========================================`);

  const partition = `persist:test_${name}_${Date.now()}`;
  const ses = session.fromPartition(partition);

  const blockedRequests = [];
  const rendererErrors = [];
  let appliedRulesCount = 0;

  // We require PrivacyManager fresh or reconfigure it
  const PrivacyManager = require('../src/main/privacyManager').constructor;
  const pm = new PrivacyManager();

  // Apply test config toggles
  if (config.adBlockerEnabled !== undefined) pm.adBlockerEnabled = config.adBlockerEnabled;
  if (config.thirdPartyCookieBlockingEnabled !== undefined) pm.thirdPartyCookieBlockingEnabled = config.thirdPartyCookieBlockingEnabled;
  if (config.trackingStrippingEnabled !== undefined) pm.trackingStrippingEnabled = config.trackingStrippingEnabled;
  if (config.httpsUpgradeEnabled !== undefined) pm.httpsUpgradeEnabled = config.httpsUpgradeEnabled;
  if (config.disableUblockUpdate) {
    pm.refreshUblockFilters = async () => {}; // no-op
  }

  await pm.init(ses);

  if (pm.blocker) {
    if (config.networkOnly) {
      pm.blocker.onInjectCosmeticFilters = async () => {};
    } else if (config.cosmeticCssOnly) {
      const orig = pm.blocker.onInjectCosmeticFilters;
      pm.blocker.onInjectCosmeticFilters = async (event, url, filterData) => {
        // Only inject styles, no scripts
        const tld = require('tldts-experimental');
        const parsedDomain = tld.parse(url);
        const { active, styles } = pm.blocker.getCosmeticsFilters({
          domain: parsedDomain.domain || '',
          hostname: parsedDomain.hostname || '',
          url,
          classes: filterData?.classes,
          hrefs: filterData?.hrefs,
          ids: filterData?.ids,
          getBaseRules: filterData === undefined,
          getInjectionRules: filterData === undefined,
          getExtendedRules: false,
          getRulesFromHostname: filterData === undefined,
          getRulesFromDOM: filterData !== undefined,
          callerContext: { frameId: event.frameId, processId: event.processId, lifecycle: filterData?.lifecycle }
        });
        if (active !== false && styles && styles.length > 0 && !event.sender.isDestroyed()) {
          event.sender.insertCSS(styles, { cssOrigin: 'user' }).catch(() => {});
        }
      };
    } else if (config.scriptletsOnly) {
      const orig = pm.blocker.onInjectCosmeticFilters;
      pm.blocker.onInjectCosmeticFilters = async (event, url, filterData) => {
        // Only inject scripts, no styles
        const tld = require('tldts-experimental');
        const parsedDomain = tld.parse(url);
        const { active, scripts } = pm.blocker.getCosmeticsFilters({
          domain: parsedDomain.domain || '',
          hostname: parsedDomain.hostname || '',
          url,
          classes: filterData?.classes,
          hrefs: filterData?.hrefs,
          ids: filterData?.ids,
          getBaseRules: filterData === undefined,
          getInjectionRules: filterData === undefined,
          getExtendedRules: false,
          getRulesFromHostname: filterData === undefined,
          getRulesFromDOM: filterData !== undefined,
          callerContext: { frameId: event.frameId, processId: event.processId, lifecycle: filterData?.lifecycle }
        });
        if (active !== false && scripts && scripts.length > 0 && !event.sender.isDestroyed()) {
          const bundledScript = scripts.map((s) => `(() => { try { ${s} } catch(e) {} })();`).join('\n');
          event.sender.executeJavaScript(bundledScript, true).catch(() => {});
        }
      };
    }
  }

  pm.blocker.on('request-blocked', (req) => {
    blockedRequests.push({ url: req.url, type: req.type, filter: req.match ? req.match.toString() : '' });
  });

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    webPreferences: {
      partition,
      sandbox: true,
      contextIsolation: true,
      backgroundThrottling: false,
    }
  });

  win.webContents.on('console-message', (event) => {
    // In Electron 45, event has message, level
    const msg = event.message || '';
    if (msg.includes('Error') || msg.includes('RangeError') || msg.includes('Uncaught') || event.level >= 2) {
      rendererErrors.push(msg);
    }
  });

  const url = 'https://www.youtube.com/';
  console.log(`Navigating to ${url}...`);
  try {
    await win.loadURL(url);
  } catch (err) {
    console.error(`Navigation failed: ${err.message}`);
  }

  // Wait 10 seconds for initial render and data hydration
  await new Promise(r => setTimeout(r, 10000));

  const result = await win.webContents.executeJavaScript(`(() => {
    const videoTitles = Array.from(document.querySelectorAll('#video-title')).map(el => el.textContent.trim()).filter(Boolean);
    const richItems = document.querySelectorAll('ytd-rich-item-renderer');
    const richGrid = document.querySelector('ytd-rich-grid-renderer');
    const skeletons = document.querySelectorAll('#skeleton, .ytd-ghost-grid-renderer, ytd-continuation-item-renderer');
    const contents = document.querySelector('#contents');
    const feedLoaded = videoTitles.length > 0;

    return {
      feedLoaded,
      videoTitlesCount: videoTitles.length,
      sampleTitles: videoTitles.slice(0, 3),
      richItemsCount: richItems.length,
      skeletonsCount: skeletons.length,
      hasRichGrid: !!richGrid,
      documentTitle: document.title
    };
  })()`).catch(err => ({ feedLoaded: false, error: err.message }));

  console.log('Result:', JSON.stringify(result, null, 2));
  console.log(`Renderer errors count: ${rendererErrors.length}`);
  if (rendererErrors.length > 0) {
    console.log('Sample renderer errors:', rendererErrors.slice(0, 5));
  }
  console.log(`Blocked requests count: ${blockedRequests.length}`);

  const critical = ['youtube.com/youtubei/', 'googlevideo.com', 'ytimg.com', 'gstatic.com'];
  critical.forEach(pat => {
    const m = blockedRequests.filter(b => b.url.includes(pat));
    if (m.length > 0) {
      console.log(`  Blocked ${pat}: ${m.length} requests (e.g. ${m[0].url})`);
    }
  });

  win.close();
  return { name, feedLoaded: result.feedLoaded, titlesCount: result.videoTitlesCount || 0, errors: rendererErrors.length };
}

app.whenReady().then(async () => {
  const tests = [
    { name: 'baseline', description: 'Baseline (current code with all features active)', config: {} },
    { name: 'a', description: 'Ad blocker fully off', config: { adBlockerEnabled: false } },
    { name: 'b', description: 'Network blocking only (no cosmetic filtering or scriptlets)', config: { networkOnly: true } },
    { name: 'b_cosmetics_only', description: 'Cosmetic CSS only (no scriptlets)', config: { cosmeticCssOnly: true } },
    { name: 'b_scriptlets_only', description: 'Scriptlets only (no cosmetic CSS)', config: { scriptletsOnly: true } },
  ];

  const summary = [];
  for (const t of tests) {
    try {
      const res = await testCondition(t.name, { ...t.config, description: t.description });
      summary.push(res);
    } catch (e) {
      console.error(`Condition ${t.name} errored:`, e);
      summary.push({ name: t.name, feedLoaded: false, error: e.message });
    }
  }

  console.log('\n========================================');
  console.log('SUMMARY TABLE:');
  console.log('========================================');
  console.table(summary);

  app.quit();
});
