// History Manager Module - Records visited web pages, search, deletion, and suggestions
const electron = require('electron');
const app = electron && electron.app;
const fs = require('fs');
const path = require('path');
const os = require('os');

class HistoryManager {
  constructor(settingsManager = null, aiManager = null, customUserDataPath = null) {
    this.settingsManager = settingsManager;
    this.aiManager = aiManager;
    this.userDataPath = customUserDataPath || (app && typeof app.getPath === 'function' ? app.getPath('userData') : path.join(os.homedir(), '.coder-browser'));
    this.historyFile = path.join(this.userDataPath, 'history.json');
    this.entries = []; // Array of { id, title, url, domain, timestamp }
    this.MAX_ENTRIES = 5000;
    this.customNeverShareDomains = [];
    this.loadHistory();
  }

  setNeverShareDomains(list) {
    this.customNeverShareDomains = Array.isArray(list) ? list : [];
  }

  loadHistory() {
    try {
      if (fs.existsSync(this.historyFile)) {
        const raw = fs.readFileSync(this.historyFile, 'utf8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this.entries = parsed;
        }
      }
    } catch (e) {
      console.warn('[HistoryManager] Failed to load history:', e.message);
      this.entries = [];
    }
  }

  saveHistory() {
    try {
      fs.writeFileSync(this.historyFile, JSON.stringify(this.entries, null, 2), 'utf8');
    } catch (e) {
      console.error('[HistoryManager] Failed to save history:', e.message);
    }
  }

  /**
   * Checks whether URL should be ignored based on scheme, settings, or AI restricted domains.
   */
  shouldRecord(url) {
    if (!url || typeof url !== 'string') return false;
    const trimmed = url.trim();

    // Check if history recording is disabled in settings
    if (this.settingsManager) {
      const settings = this.settingsManager.getSettings();
      if (settings.historyEnabled === false) return false;
    }

    // Ignore internal protocols, blanks, and data URIs
    if (
      trimmed.startsWith('browser://') ||
      trimmed.startsWith('chrome://') ||
      trimmed.startsWith('about:') ||
      trimmed.startsWith('file:') ||
      trimmed.startsWith('data:') ||
      trimmed.startsWith('devtools:')
    ) {
      return false;
    }

    // Extract hostname
    let hostname = '';
    try {
      const parsedUrl = new URL(trimmed);
      hostname = parsedUrl.hostname.toLowerCase();
    } catch (_) {
      return false;
    }

    // Filter against AI neverShareDomains list or custom never share list
    const neverList = (this.customNeverShareDomains || []).concat(
      this.aiManager && this.aiManager.settings && Array.isArray(this.aiManager.settings.neverShareDomains)
        ? this.aiManager.settings.neverShareDomains
        : []
    );
    if (neverList.length > 0) {
      const isRestricted = neverList.some((d) => {
        const domain = (d || '').trim().toLowerCase();
        if (!domain) return false;
        return hostname === domain || hostname.endsWith('.' + domain);
      });
      if (isRestricted) {
        return false;
      }
    }

    return true;
  }

  /**
   * Records a visited page.
   */
  addEntry(url, title = '') {
    if (!this.shouldRecord(url)) return null;

    let domain = '';
    try {
      domain = new URL(url).hostname;
    } catch (_) {
      domain = url;
    }

    const cleanTitle = (title || '').trim() || domain || url;
    const now = Date.now();

    // Deduplicate: If the most recent entry is the same URL within the last 5 seconds, update title & timestamp
    const recentIndex = this.entries.findIndex((e) => e.url === url && now - e.timestamp < 10000);
    if (recentIndex !== -1) {
      this.entries[recentIndex].title = cleanTitle;
      this.entries[recentIndex].timestamp = now;
      this.saveHistory();
      return this.entries[recentIndex];
    }

    const entry = {
      id: `hist-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      title: cleanTitle,
      url,
      domain,
      timestamp: now,
    };

    // Keep newest at front
    this.entries.unshift(entry);

    if (this.entries.length > this.MAX_ENTRIES) {
      this.entries.length = this.MAX_ENTRIES;
    }

    this.saveHistory();
    return entry;
  }

  /**
   * Updates title of recent history entry matching URL if title changed after DOM load.
   */
  updateTitle(url, title) {
    if (!url || !title || !this.shouldRecord(url)) return;
    const cleanTitle = title.trim();
    if (!cleanTitle || cleanTitle === 'Untitled') return;

    const entry = this.entries.find((e) => e.url === url);
    if (entry && entry.title !== cleanTitle) {
      entry.title = cleanTitle;
      this.saveHistory();
    }
  }

  /**
   * Searches and returns history entries matching query.
   */
  getHistory(searchQuery = '', limit = 500) {
    const q = (searchQuery || '').trim().toLowerCase();
    if (!q) {
      return this.entries.slice(0, limit);
    }

    return this.entries
      .filter((e) => {
        return (
          (e.title && e.title.toLowerCase().includes(q)) ||
          (e.url && e.url.toLowerCase().includes(q)) ||
          (e.domain && e.domain.toLowerCase().includes(q))
        );
      })
      .slice(0, limit);
  }

  /**
   * Returns quick suggestions for the address bar dropdown.
   */
  getSuggestions(query, limit = 5) {
    const q = (query || '').trim().toLowerCase();
    if (!q) return [];

    const seenUrls = new Set();
    const suggestions = [];

    for (const e of this.entries) {
      if (seenUrls.has(e.url)) continue;
      if (
        (e.title && e.title.toLowerCase().includes(q)) ||
        (e.url && e.url.toLowerCase().includes(q))
      ) {
        seenUrls.add(e.url);
        suggestions.push({
          type: 'history',
          title: e.title,
          url: e.url,
        });
        if (suggestions.length >= limit) break;
      }
    }
    return suggestions;
  }

  /**
   * Deletes a single history item by ID.
   */
  deleteEntry(id) {
    const initialLen = this.entries.length;
    this.entries = this.entries.filter((e) => e.id !== id);
    if (this.entries.length !== initialLen) {
      this.saveHistory();
      return true;
    }
    return false;
  }

  /**
   * Clears all history entries.
   */
  clearHistory() {
    this.entries = [];
    this.saveHistory();
    return true;
  }
}

module.exports = HistoryManager;
