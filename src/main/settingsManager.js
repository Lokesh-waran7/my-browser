// Settings Manager Module - Central configuration for search engine, history, downloads, and general browser preferences
const electron = require('electron');
const app = electron && electron.app;
const fs = require('fs');
const path = require('path');
const os = require('os');

class SettingsManager {
  constructor(customUserDataPath = null) {
    this.userDataPath = customUserDataPath || (app && typeof app.getPath === 'function' ? app.getPath('userData') : path.join(os.homedir(), '.coder-browser'));
    this.settingsFile = path.join(this.userDataPath, 'browser-settings.json');
    const defaultDownload = app && typeof app.getPath === 'function' ? app.getPath('downloads') : path.join(os.homedir(), 'Downloads');
    this.settings = {
      defaultSearchEngine: 'duckduckgo', // 'duckduckgo' | 'google' | 'bing' | 'brave' | 'ecosia'
      historyEnabled: true,
      askWhereToSave: false,
      downloadPath: defaultDownload,
      theme: 'dark',
      restoreLastSession: true,
      openNewTabPosition: 'after-current',
      adBlockEnabled: true,
      tabSuspenderEnabled: true,
      tabSuspenderIdleMinutes: 10,
    };
    this.loadSettings();
  }

  loadSettings() {
    try {
      if (fs.existsSync(this.settingsFile)) {
        const data = JSON.parse(fs.readFileSync(this.settingsFile, 'utf8'));
        this.settings = { ...this.settings, ...data };
      }
    } catch (e) {
      console.warn('[SettingsManager] Failed to read settings, using defaults:', e.message);
    }
  }

  saveSettings() {
    try {
      fs.writeFileSync(this.settingsFile, JSON.stringify(this.settings, null, 2), 'utf8');
    } catch (e) {
      console.error('[SettingsManager] Failed to save settings to disk:', e.message);
    }
  }

  getSettings() {
    return { ...this.settings };
  }

  getSetting(key) {
    return this.settings[key];
  }

  updateSettings(updates) {
    if (!updates || typeof updates !== 'object') return this.getSettings();
    const allowedKeys = [
      'defaultSearchEngine',
      'historyEnabled',
      'askWhereToSave',
      'downloadPath',
      'theme',
      'restoreLastSession',
      'openNewTabPosition',
      'adBlockEnabled',
      'tabSuspenderEnabled',
      'tabSuspenderIdleMinutes',
    ];

    for (const key of allowedKeys) {
      if (updates[key] !== undefined) {
        this.settings[key] = updates[key];
      }
    }
    this.saveSettings();
    return this.getSettings();
  }

  getSearchUrl(query) {
    const q = encodeURIComponent((query || '').trim());
    const engines = {
      duckduckgo: `https://duckduckgo.com/?q=${q}`,
      google: `https://www.google.com/search?q=${q}`,
      bing: `https://www.bing.com/search?q=${q}`,
      brave: `https://search.brave.com/search?q=${q}`,
      ecosia: `https://www.ecosia.org/search?q=${q}`,
    };
    return engines[this.settings.defaultSearchEngine] || engines.duckduckgo;
  }
}

module.exports = SettingsManager;
