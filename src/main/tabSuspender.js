// Tab Suspender - Manages background tab idle suspension, memory relief, and reactivation
const os = require('os');
const path = require('path');
const fs = require('fs');
const { app } = require('electron');

class TabSuspender {
  constructor(mainWindow, tabManager, splitManager, workspaceManager) {
    this.mainWindow = mainWindow;
    this.tabManager = tabManager;
    this.splitManager = splitManager;
    this.workspaceManager = workspaceManager;

    this.settingsPath = path.join(app.getPath('userData'), 'suspender-settings.json');

    // Default configuration
    this.enabled = true;
    this.idleTimeoutMinutes = 10;
    this.lowMemoryThresholdMB = 600; // Free memory threshold in MB to trigger emergency suspension
    this.whitelist = new Set(); // Domain whitelist (e.g. ['youtube.com', 'github.com'])

    this.loadSettings();

    // Periodic watch for idle tabs and low memory (every 15 seconds)
    this.checkInterval = setInterval(() => {
      this.checkIdleTabs().catch(() => {});
      this.checkLowMemory().catch(() => {});
    }, 15000);
  }

  /**
   * Loads suspender settings and whitelist from disk.
   */
  loadSettings() {
    try {
      if (fs.existsSync(this.settingsPath)) {
        const raw = fs.readFileSync(this.settingsPath, 'utf-8');
        const data = JSON.parse(raw);
        if (typeof data.enabled === 'boolean') this.enabled = data.enabled;
        if (typeof data.idleTimeoutMinutes === 'number') this.idleTimeoutMinutes = data.idleTimeoutMinutes;
        if (typeof data.lowMemoryThresholdMB === 'number') this.lowMemoryThresholdMB = data.lowMemoryThresholdMB;
        if (Array.isArray(data.whitelist)) this.whitelist = new Set(data.whitelist.map(d => d.toLowerCase()));
      }
    } catch (err) {
      console.warn('[TabSuspender] Could not read suspender settings, using defaults:', err.message);
    }
  }

  /**
   * Saves suspender settings and whitelist to disk.
   */
  saveSettings() {
    try {
      const data = {
        enabled: this.enabled,
        idleTimeoutMinutes: this.idleTimeoutMinutes,
        lowMemoryThresholdMB: this.lowMemoryThresholdMB,
        whitelist: Array.from(this.whitelist),
      };
      fs.writeFileSync(this.settingsPath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (err) {
      console.error('[TabSuspender] Failed to save suspender settings:', err);
    }
  }

  getSettings() {
    return {
      enabled: this.enabled,
      idleTimeoutMinutes: this.idleTimeoutMinutes,
      lowMemoryThresholdMB: this.lowMemoryThresholdMB,
      whitelist: Array.from(this.whitelist),
    };
  }

  updateSettings(options = {}) {
    if (typeof options.enabled === 'boolean') this.enabled = options.enabled;
    if (typeof options.idleTimeoutMinutes === 'number' && options.idleTimeoutMinutes > 0) {
      this.idleTimeoutMinutes = options.idleTimeoutMinutes;
    }
    if (typeof options.lowMemoryThresholdMB === 'number' && options.lowMemoryThresholdMB > 0) {
      this.lowMemoryThresholdMB = options.lowMemoryThresholdMB;
    }
    this.saveSettings();
    return this.getSettings();
  }

  addWhitelist(domain) {
    if (!domain) return;
    this.whitelist.add(domain.toLowerCase().trim());
    this.saveSettings();
  }

  removeWhitelist(domain) {
    if (!domain) return;
    this.whitelist.delete(domain.toLowerCase().trim());
    this.saveSettings();
  }

  isWhitelisted(url) {
    if (!url) return false;
    try {
      const hostname = new URL(url).hostname.toLowerCase();
      return Array.from(this.whitelist).some(d => hostname === d || hostname.endsWith('.' + d));
    } catch (e) {
      return false;
    }
  }

  /**
   * Evaluates whether a tab is eligible for suspension under all safety rules.
   */
  async canSuspend(tabId) {
    const tab = this.tabManager.getTab(tabId);
    if (!tab) return false;

    // 1. Already suspended
    if (tab.isSuspended) return false;

    // 2. Never suspend the active tab of the current focused workspace
    if (tab.id === this.tabManager.activeTabId) return false;

    // 2b. Never suspend the active tab of ANY workspace
    if (this.workspaceManager && Array.isArray(this.workspaceManager.workspaces)) {
      const isAnyWorkspaceActiveTab = this.workspaceManager.workspaces.some(
        (ws) => ws.activeTabId === tabId
      );
      if (isAnyWorkspaceActiveTab) return false;
    }

    // 3. Never suspend tabs visible in split view
    if (this.splitManager && this.splitManager.isSplit) {
      if (tab.id === this.splitManager.leftTabId || tab.id === this.splitManager.rightTabId) {
        return false;
      }
    }

    // 4. Never suspend pinned tabs
    if (tab.isPinned) return false;

    // 5. Never suspend whitelisted sites
    if (this.isWhitelisted(tab.url)) return false;

    // If view does not exist yet (lazy tab), it's already unloaded
    if (!tab.view || !tab.view.webContents) return false;

    const wc = tab.view.webContents;

    // 6. Never suspend tabs playing audio or media
    if (wc.isCurrentlyAudible && wc.isCurrentlyAudible()) return false;

    // Check HTML5 video/audio playing state
    try {
      const isMediaPlaying = await wc.executeJavaScript(`(() => {
        const media = Array.from(document.querySelectorAll('video, audio'));
        return media.some(m => !m.paused && !m.ended && m.currentTime > 0);
      })()`);
      if (isMediaPlaying) return false;
    } catch (e) {}

    // 7. Never suspend tabs with unsaved form input
    try {
      const hasFormInput = await wc.executeJavaScript(`(() => {
        const textInputs = document.querySelectorAll(
          'input[type="text"], input[type="search"], input[type="email"], input[type="password"], input[type="tel"], input[type="url"], input[type="number"], input:not([type]), textarea'
        );
        for (const el of textInputs) {
          if (el.value && el.value.trim() !== '' && el.value !== el.defaultValue) return true;
        }
        const checkInputs = document.querySelectorAll('input[type="checkbox"], input[type="radio"]');
        for (const el of checkInputs) {
          if (el.checked !== el.defaultChecked) return true;
        }
        return false;
      })()`);
      if (hasFormInput) {
        return false;
      }
    } catch (e) {}

    return true;
  }

  /**
   * Suspends a background tab: preserves metadata & scroll position, destroys WebContentsView.
   */
  async suspendTab(tabId, force = false) {
    const tab = this.tabManager.getTab(tabId);
    if (!tab || tab.isSuspended) return false;

    if (!force) {
      const eligible = await this.canSuspend(tabId);
      if (!eligible) return false;
    }

    // 1. Capture scroll position
    if (tab.view && tab.view.webContents) {
      try {
        tab.scrollPosition = await tab.view.webContents.executeJavaScript(`({
          x: window.scrollX || window.pageXOffset || 0,
          y: window.scrollY || window.pageYOffset || 0
        })`);
      } catch (e) {
        tab.scrollPosition = tab.scrollPosition || { x: 0, y: 0 };
      }

      // Detach from main window
      if (this.mainWindow && this.mainWindow.contentView) {
        try {
          this.mainWindow.contentView.removeChildView(tab.view);
        } catch (e) {}
      }

      // Destroy WebContentsView to free RAM
      try {
        tab.view.webContents.close();
      } catch (e) {}
    }

    tab.view = null;
    tab.isSuspended = true;
    tab.suspendedAt = Date.now();

    // Broadcast tab state change
    if (this.tabManager.onTabUpdated) {
      this.tabManager.onTabUpdated(tab);
    }

    // Persist suspended state across restarts
    if (this.workspaceManager) {
      this.workspaceManager.scheduleSave();
    }

    console.log(`[TabSuspender] Suspended tab: ${tab.id} ("${tab.title}")`);
    return true;
  }

  /**
   * Unsuspends a tab: recreates its WebContentsView, navigates to its URL, restores scroll position.
   */
  unsuspendTab(tabId) {
    const tab = this.tabManager.getTab(tabId);
    if (!tab) return;
    const isMissingOrDestroyed = !tab.view || !tab.view.webContents || tab.view.webContents.isDestroyed();
    if (!tab.isSuspended && !isMissingOrDestroyed) return;

    console.log(`[TabSuspender] Unsuspending tab: ${tab.id} ("${tab.title}", url: ${tab.url})`);

    // Recreate WebContentsView and rebind handlers
    this.tabManager.setupTabView(tab, tab.url);

    tab.isSuspended = false;
    tab.isLazy = false;
    tab.suspendedAt = null;
    tab.lastActiveTime = Date.now();

    // Once page loads, restore scroll position
    if (tab.view && tab.view.webContents) {
      tab.view.webContents.once('did-finish-load', () => {
        if (tab.scrollPosition && (tab.scrollPosition.x > 0 || tab.scrollPosition.y > 0)) {
          tab.view.webContents.executeJavaScript(
            `window.scrollTo(${tab.scrollPosition.x}, ${tab.scrollPosition.y})`
          ).catch(() => {});
        }
      });
    }

    if (this.tabManager.onTabUpdated) {
      this.tabManager.onTabUpdated(tab);
    }

    if (this.splitManager) {
      this.splitManager.applyLayout();
    }

    if (this.workspaceManager) {
      this.workspaceManager.scheduleSave();
    }
  }

  /**
   * Suspends all eligible background tabs except the specified keepTabId.
   */
  async suspendOtherTabs(keepTabId) {
    const targetKeepId = keepTabId || this.tabManager.activeTabId;
    const tabs = Array.from(this.tabManager.tabs.values());

    let count = 0;
    for (const tab of tabs) {
      if (tab.id !== targetKeepId && !tab.isSuspended) {
        const suspended = await this.suspendTab(tab.id);
        if (suspended) count++;
      }
    }
    return count;
  }

  /**
   * Periodic check: suspends tabs that have exceeded the idle threshold.
   */
  async checkIdleTabs() {
    if (!this.enabled) return;

    const timeoutMs = this.idleTimeoutMinutes * 60 * 1000;
    const now = Date.now();
    const tabs = Array.from(this.tabManager.tabs.values());

    for (const tab of tabs) {
      if (!tab.isSuspended && tab.id !== this.tabManager.activeTabId) {
        // Double check not active tab in any workspace
        if (this.workspaceManager && Array.isArray(this.workspaceManager.workspaces)) {
          const isAnyActive = this.workspaceManager.workspaces.some((ws) => ws.activeTabId === tab.id);
          if (isAnyActive) continue;
        }

        const lastActive = tab.lastActiveTime || now;
        if (now - lastActive >= timeoutMs) {
          await this.suspendTab(tab.id);
        }
      }
    }
  }

  /**
   * Emergency check: suspends oldest idle tabs when system free memory falls below threshold.
   */
  async checkLowMemory() {
    if (!this.enabled) return;

    const freeMemMB = os.freemem() / (1024 * 1024);
    if (freeMemMB < this.lowMemoryThresholdMB) {
      console.warn(`[TabSuspender] Low system memory detected: ${Math.round(freeMemMB)} MB free. Suspending background tabs...`);

      // Find all suspendable tabs sorted by oldest idle time first
      const candidateTabs = Array.from(this.tabManager.tabs.values())
        .filter(t => !t.isSuspended && t.id !== this.tabManager.activeTabId)
        .sort((a, b) => (a.lastActiveTime || 0) - (b.lastActiveTime || 0));

      for (const tab of candidateTabs) {
        const suspended = await this.suspendTab(tab.id);
        if (suspended) {
          const currentFree = os.freemem() / (1024 * 1024);
          if (currentFree >= this.lowMemoryThresholdMB) break;
        }
      }
    }
  }

  /**
   * Gathers memory metrics for the dashboard (Part B).
   */
  getMemoryStats() {
    const metrics = app.getAppMetrics();
    const totalWorkingSetKB = metrics.reduce((acc, p) => acc + (p.memory ? p.memory.workingSetSize : 0), 0);
    const totalAppMemoryMB = Math.round(totalWorkingSetKB / 1024);

    const allTabs = Array.from(this.tabManager.tabs.values());
    const suspendedTabsCount = allTabs.filter(t => t.isSuspended).length;
    const activeTabsCount = allTabs.length - suspendedTabsCount;

    // Typical Chromium tab process uses ~180-260 MB
    const estimatedRamSavedMB = Math.round(suspendedTabsCount * 220);

    const systemFreeMemoryMB = Math.round(os.freemem() / (1024 * 1024));
    const systemTotalMemoryMB = Math.round(os.totalmem() / (1024 * 1024));

    // Per-tab overview
    const tabsOverview = allTabs.map(t => {
      const idleMinutes = t.lastActiveTime ? Math.round((Date.now() - t.lastActiveTime) / 60000) : 0;
      return {
        id: t.id,
        title: t.title,
        url: t.url,
        favicon: t.favicon,
        workspaceId: t.workspaceId,
        isSuspended: !!t.isSuspended,
        idleMinutes,
        isAudible: t.view && t.view.webContents && t.view.webContents.isCurrentlyAudible ? t.view.webContents.isCurrentlyAudible() : false,
      };
    });

    return {
      totalAppMemoryMB,
      systemFreeMemoryMB,
      systemTotalMemoryMB,
      totalTabsCount: allTabs.length,
      activeTabsCount,
      suspendedTabsCount,
      estimatedRamSavedMB,
      suspenderSettings: this.getSettings(),
      tabs: tabsOverview,
    };
  }
}

module.exports = TabSuspender;
