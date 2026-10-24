const { app } = require('electron');
const path = require('path');
const AIManager = require('../src/main/ai/aiManager');

app.whenReady().then(async () => {
  try {
    const mgr = new AIManager();
    await mgr.loadApiKey();
    console.log('cachedApiKey loaded:', !!mgr.cachedApiKey, 'length:', mgr.cachedApiKey ? mgr.cachedApiKey.length : 0);
  } catch (err) {
    console.error('loadApiKey error:', err);
  } finally {
    app.quit();
  }
});
