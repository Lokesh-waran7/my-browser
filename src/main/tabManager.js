// Tab Manager - Manages WebContentsView instances, lifecycle, security, and view creation
const { WebContentsView, Menu, MenuItem } = require('electron');
const privacyManager = require('./privacyManager');
const youtubeAdHandler = require('./youtubeAdHandler');
const jsonPageHandler = require('./jsonPageHandler');

class TabManager {
  constructor(mainWindow) {
    this.mainWindow = mainWindow;
    this.tabs = new Map(); // tabId -> tab state object
    this.tabCounter = 0;
    this.activeTabId = null;

    // Injected reference for suspension coordination
    this.tabSuspender = null;

    // Callback hooks for main process & IPC notifications
    this.onTabCreated = null;
    this.onTabClosed = null;
    this.onTabUpdated = null;
    this.onTabCrash = null;
    this.onNewWindow = null;
    this.onViewFocus = null;
    this.onSendSelectionToNotes = null;
    this.onAskAIAboutSelection = null;
  }

  /**
   * Recreates or sets up WebContentsView for a tab with strict security settings and event hooks.
   */
  setupTabView(tab, urlToLoad = null) {
    const tabId = tab.id;

    // Security: strict isolation for all web contents
    const view = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    tab.view = view;
    tab.lastActiveTime = Date.now();
    tab.isSuspended = false;

    const wc = view.webContents;

    // Loading states
    wc.on('did-start-loading', () => {
      tab.isLoading = true;
      if (this.onTabUpdated) this.onTabUpdated(tab);
    });

    wc.on('did-stop-loading', () => {
      tab.isLoading = false;
      tab.canGoBack = wc.canGoBack();
      tab.canGoForward = wc.canGoForward();
      if (this.onTabUpdated) this.onTabUpdated(tab);
    });

    // Navigation and URL updates
    const triggerYouTubeHandler = (url) => {
      youtubeAdHandler.handleNavigation(wc, url, privacyManager);
    };

    const handleNav = (event, url) => {
      tab.url = url;
      tab.lastActiveTime = Date.now();
      const currentTitle = wc.getTitle();
      if (currentTitle) {
        tab.title = currentTitle;
      }
      tab.canGoBack = wc.canGoBack();
      tab.canGoForward = wc.canGoForward();
      if (this.onTabUpdated) this.onTabUpdated(tab);
      triggerYouTubeHandler(url);
    };

    wc.on('did-navigate', handleNav);
    wc.on('did-navigate-in-page', (event, url) => {
      handleNav(event, url);
    });
    wc.on('did-finish-load', () => {
      triggerYouTubeHandler(wc.getURL());
    });
    wc.on('dom-ready', () => {
      triggerYouTubeHandler(wc.getURL());
    });

    // Error logging
    wc.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      console.log(`[did-fail-load] Tab: ${tabId}, Code: ${errorCode}, Description: ${errorDescription}, URL: ${validatedURL}, MainFrame: ${isMainFrame}`);
    });

    // Page title
    wc.on('page-title-updated', (event, title) => {
      tab.title = title || 'Untitled';
      if (this.onTabUpdated) this.onTabUpdated(tab);
    });

    // Page favicon
    wc.on('page-favicon-updated', (event, favicons) => {
      if (favicons && favicons.length > 0) {
        tab.favicon = favicons[0];
        if (this.onTabUpdated) this.onTabUpdated(tab);
      }
    });

    // Focus synchronization
    wc.on('focus', () => {
      tab.lastActiveTime = Date.now();
      if (this.onViewFocus) this.onViewFocus(tabId);
    });

    // Target="_blank" / window.open
    wc.setWindowOpenHandler(({ url }) => {
      if (this.onNewWindow) {
        this.onNewWindow(url);
      } else {
        this.createTab(url, true);
      }
      return { action: 'deny' };
    });

    // Page crashes
    wc.on('render-process-gone', (event, details) => {
      console.log(`[render-process-gone] Tab: ${tabId}, Reason: ${details ? details.reason : 'unknown'}`);
      tab.isCrashed = true;
      tab.title = 'Page Crashed';
      if (this.onTabCrash) this.onTabCrash(tab, details);
      if (this.onTabUpdated) this.onTabUpdated(tab);
    });

    // Auto-detect JSON response pages and inject interactive viewer
    jsonPageHandler.attach(wc);

    // Right-click context menu: Ask AI or send selected text to notes
    wc.on('context-menu', (event, params) => {
      const menu = new Menu();
      if (params.selectionText && params.selectionText.trim()) {
        const text = params.selectionText.trim();
        menu.append(
          new MenuItem({
            label: '✨ Ask AI about selection',
            click: () => {
              if (this.onAskAIAboutSelection) {
                this.onAskAIAboutSelection(text);
              }
            },
          })
        );
        menu.append(
          new MenuItem({
            label: '📝 Send selection to notes',
            click: () => {
              if (this.onSendSelectionToNotes) {
                this.onSendSelectionToNotes(text);
              }
            },
          })
        );
        menu.append(new MenuItem({ type: 'separator' }));
      }
      menu.append(new MenuItem({ role: 'copy' }));
      menu.append(new MenuItem({ role: 'selectAll' }));
      menu.popup();
    });

    if (urlToLoad) {
      wc.loadURL(urlToLoad).catch(() => {});
    }

    return view;
  }

  /**
   * Creates a new tab. If isSuspended is true, the tab is initialized without a WebContentsView.
   */
  createTab(initialUrl = 'https://duckduckgo.com', activate = true, isLazy = false, isSuspended = false, options = {}) {
    let tabId = options.id;
    if (tabId) {
      if (typeof tabId === 'string' && tabId.startsWith('tab-')) {
        const num = parseInt(tabId.replace('tab-', ''), 10);
        if (!isNaN(num) && num > this.tabCounter) {
          this.tabCounter = num;
        }
      }
    } else {
      tabId = `tab-${++this.tabCounter}`;
    }

    const tab = {
      id: tabId,
      url: initialUrl,
      title: options.title || 'New Tab',
      favicon: options.favicon || null,
      isLoading: false,
      canGoBack: false,
      canGoForward: false,
      isCrashed: false,
      isLazy: !!isLazy,
      isSuspended: !!isSuspended,
      suspendedAt: isSuspended ? Date.now() : null,
      scrollPosition: options.scrollPosition || { x: 0, y: 0 },
      lastActiveTime: Date.now(),
      workspaceId: options.workspaceId || null,
      view: null,
    };

    this.tabs.set(tabId, tab);

    if (!isSuspended) {
      this.setupTabView(tab, isLazy ? null : initialUrl);
    }

    if (this.onTabCreated) {
      this.onTabCreated(tab, activate);
    }

    return tab;
  }

  /**
   * Safety net: ensures that an active tab has an alive WebContentsView instance and is not suspended.
   */
  ensureActiveTabView(tabId) {
    const tab = this.getTab(tabId);
    if (!tab) return;
    const isMissingOrDestroyed = !tab.view || !tab.view.webContents || tab.view.webContents.isDestroyed();
    if (isMissingOrDestroyed || tab.isSuspended) {
      console.log(`[SafetyNet] ensureActiveTabView: recreating missing/destroyed view for tab: ${tabId} (${tab.url})`);
      if (this.tabSuspender) {
        this.tabSuspender.unsuspendTab(tabId);
      } else {
        this.setupTabView(tab, tab.url);
        tab.isSuspended = false;
        tab.isLazy = false;
        if (this.onTabUpdated) this.onTabUpdated(tab);
      }
    }
  }

  getTab(tabId) {
    return this.tabs.get(tabId);
  }

  getAllTabs() {
    return Array.from(this.tabs.values()).map((t) => ({
      id: t.id,
      url: t.url,
      title: t.title,
      favicon: t.favicon,
      isLoading: t.isLoading,
      canGoBack: t.canGoBack,
      canGoForward: t.canGoForward,
      isCrashed: t.isCrashed,
      isSuspended: !!t.isSuspended,
      scrollPosition: t.scrollPosition || { x: 0, y: 0 },
      workspaceId: t.workspaceId,
    }));
  }

  closeTab(tabId) {
    const tab = this.tabs.get(tabId);
    if (!tab) return false;

    // Detach and clean up view if active
    if (tab.view) {
      try {
        this.mainWindow.contentView.removeChildView(tab.view);
      } catch (e) {}

      try {
        tab.view.webContents.close();
      } catch (e) {}
    }

    this.tabs.delete(tabId);

    if (this.onTabClosed) {
      this.onTabClosed(tabId);
    }

    return true;
  }

  navigate(tabId, url) {
    const tab = this.tabs.get(tabId);
    if (!tab) return;

    if (tab.isSuspended && this.tabSuspender) {
      tab.url = url;
      this.tabSuspender.unsuspendTab(tabId);
      return;
    }

    tab.isCrashed = false;
    tab.isLazy = false;
    tab.lastActiveTime = Date.now();
    if (tab.view && tab.view.webContents) {
      tab.view.webContents.loadURL(url).catch(() => {});
    }
  }

  goBack(tabId) {
    const tab = this.tabs.get(tabId);
    if (tab && tab.view && tab.view.webContents && tab.view.webContents.canGoBack()) {
      tab.lastActiveTime = Date.now();
      tab.view.webContents.goBack();
    }
  }

  goForward(tabId) {
    const tab = this.tabs.get(tabId);
    if (tab && tab.view && tab.view.webContents && tab.view.webContents.canGoForward()) {
      tab.lastActiveTime = Date.now();
      tab.view.webContents.goForward();
    }
  }

  reload(tabId) {
    const tab = this.tabs.get(tabId);
    if (!tab) return;

    if (tab.isSuspended && this.tabSuspender) {
      this.tabSuspender.unsuspendTab(tabId);
      return;
    }

    tab.isCrashed = false;
    tab.lastActiveTime = Date.now();
    if (tab.view && tab.view.webContents) {
      if (tab.isLazy) {
        tab.isLazy = false;
        tab.view.webContents.loadURL(tab.url).catch(() => {});
      } else {
        tab.view.webContents.reload();
      }
    }
  }

  stop(tabId) {
    const tab = this.tabs.get(tabId);
    if (tab && tab.view && tab.view.webContents) {
      tab.view.webContents.stop();
    }
  }

  openDevTools(tabId) {
    const tab = this.tabs.get(tabId) || this.tabs.get(this.activeTabId);
    if (tab && tab.view && tab.view.webContents) {
      tab.view.webContents.openDevTools({ mode: 'detach' });
    }
  }
}

module.exports = TabManager;
