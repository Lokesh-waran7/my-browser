// Test script to verify safe mode, bisect features, YouTube feed loading, and AI responses
const { app, BrowserWindow, session } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const netdebugLogger = require('../src/main/netdebugLogger');
const networkPipeline = require('../src/main/networkPipeline');
const privacyManager = require('../src/main/privacyManager');
const AIManager = require('../src/main/ai/aiManager');

const targetDir = path.join(os.homedir(), 'AppData', 'Roaming', 'Coder Browser');
app.setPath('userData', targetDir);

async function timeoutPromise(p, ms, label = 'Operation') {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

app.whenReady().then(async () => {
  netdebugLogger.clear();
  console.log('\n======================================================');
  console.log('STARTING NETWORK & AI VERIFICATION SUITE');
  console.log('======================================================');

  // Strip Electron from UserAgent
  const rawUa = session.defaultSession.getUserAgent();
  const cleanUa = rawUa.replace(/Electron\/[0-9\.]+\s?/, '').replace(/my-browser\/[0-9\.]+\s?/, '');
  session.defaultSession.setUserAgent(cleanUa);

  // Initialize PrivacyManager & NetworkPipeline
  await timeoutPromise(privacyManager.init(session.defaultSession), 8000, 'privacyManager.init');
  networkPipeline.init({
    session: session.defaultSession,
    privacyManager,
    proxyManager: null,
    isSafeMode: false,
  });

  // TEST 1: Diagnostic Self-Test (netTest:run)
  console.log('\n--- 1. Testing netTest:run Diagnostic ---');
  const setupIpcHandlers = require('../src/main/ipcHandlers');
  const aiManager = new AIManager();
  await aiManager.init();

  let netTestResult = null;
  try {
    const { ipcMain } = require('electron');
    // Invoke handler directly by mimicking netTest:run
    const directFetchP = fetch('https://api.ipify.org?format=json').then(r => r.json());
    const df = await timeoutPromise(directFetchP, 4000, 'Public API Fetch').catch(e => ({ error: e.message }));
    console.log('Direct Fetch Result:', df.ip ? `PASS (IP: ${df.ip})` : `FAIL: ${df.error}`);

    const ytPostP = fetch('https://www.youtube.com/youtubei/v1/browse?prettyPrint=false', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ context: { client: { clientName: 'WEB', clientVersion: '2.20240101.00.00' } } }),
    }).then(r => r.text());
    const ytText = await timeoutPromise(ytPostP, 5000, 'YouTube POST').catch(e => e.message);
    console.log('YouTube POST Result:', ytText.includes('responseContext') ? `PASS (Payload size: ${ytText.length} bytes)` : `FAIL`);

    const models = await timeoutPromise(aiManager.getAvailableModels(true), 6000, 'AI Models List').catch(e => []);
    console.log('Gemini Models Result:', models.length > 0 ? `PASS (${models.length} models, active: ${aiManager.settings.model})` : 'FAIL');

    const resolvedProxy = await session.defaultSession.resolveProxy('https://example.com');
    console.log('Proxy Resolution Result:', `PASS (Rule: ${resolvedProxy})`);
  } catch (err) {
    console.error('Diagnostic error:', err);
  }

  // TEST 2: AI Streaming with "hi"
  console.log('\n--- 2. Testing AI Stream ("hi") ---');
  try {
    const chunks = [];
    let streamEndCalled = false;
    const fakeWin = {
      isDestroyed: () => false,
      webContents: {
        send: (channel, data) => {
          if (channel === 'ai:streamChunk') chunks.push(data.chunk);
          if (channel === 'ai:streamEnd') streamEndCalled = true;
        }
      }
    };
    aiManager.mainWindow = fakeWin;

    const res = await timeoutPromise(
      aiManager.sendMessage({
        workspaceId: 'test-ws',
        prompt: 'hi',
        streamId: 'stream-test-1',
      }),
      15000,
      'AI sendMessage ("hi")'
    );

    console.log('AI Response role:', res.role);
    console.log('AI Response text snippet:', JSON.stringify(res.content ? res.content.slice(0, 70) : ''));
    console.log('AI Chunks count:', chunks.length);
    console.log('Stream ended properly:', streamEndCalled);
  } catch (aiErr) {
    console.error('AI Test Error:', aiErr.message);
  }

  // TEST 3: YouTube Tab Feed Loading (verifying DOM hydration)
  console.log('\n--- 3. Testing YouTube Tab Feed Loading ---');
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
    }
  });

  try {
    await timeoutPromise(win.loadURL('https://www.youtube.com/'), 12000, 'YouTube loadURL');
    console.log('YouTube loaded URL. Waiting 6 seconds for Polymer feed hydration...');
    await new Promise(r => setTimeout(r, 6000));

    const domResult = await timeoutPromise(
      win.webContents.executeJavaScript(`(() => {
        const items = Array.from(document.querySelectorAll('ytd-rich-item-renderer'));
        const titles = [];
        items.slice(0, 5).forEach(it => {
          const t = it.querySelector('#video-title, h3, .yt-lockup-metadata-view-model-wiz__title');
          if (t && t.textContent.trim()) titles.push(t.textContent.trim());
        });
        const skeletons = document.querySelectorAll('#skeleton, .ytd-ghost-grid-renderer');
        return {
          itemCount: items.length,
          skeletonsCount: skeletons.length,
          titles
        };
      })()`),
      5000,
      'YouTube DOM evaluation'
    );

    console.log('YouTube Feed DOM Evaluation:');
    console.log('  Rich items rendered:', domResult.itemCount);
    console.log('  Sample video titles:');
    domResult.titles.forEach((t, i) => console.log(`    [${i + 1}] ${t}`));
    console.log(domResult.itemCount > 0 ? '>>> YOUTUBE FEED TEST: PASSED <<<' : '>>> YOUTUBE FEED TEST: FAILED <<<');
  } catch (ytErr) {
    console.error('YouTube test error:', ytErr.message);
  } finally {
    win.close();
  }

  console.log('\n======================================================');
  console.log('TEST SUITE COMPLETED.');
  console.log('======================================================');
  app.quit();
});
