// Tab Manager - Manages WebContentsView instances, lifecycle, and security
const { WebContentsView } = require('electron');

class TabManager {
  constructor(mainWindow) {
    this.mainWindow = mainWindow;
    this.tabs = new Map(); // tabId -> tab state object
    this.tabCounter = 0;
    this.activeTabId = null;

    // Callback hooks for main process & IPC notifications
    this.onTabCreated = null;
    this.onTabClosed = null;
    this.onTabUpdated = null;
    this.onTabCrash = null;
    this.onNewWindow = null;
    this.onViewFocus = null;
  }

  /**
   * Creates a new tab backed by a WebContentsView.
   * If isLazy is true, URL navigation is postponed until the tab is first viewed.
   */
  createTab(initialUrl = 'https://duckduckgo.com', activate = true, isLazy = false) {
    const tabId = `tab-${++this.tabCounter}`;

    // Security: strict isolation for all web contents
    const view = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    const tab = {
      id: tabId,
      url: initialUrl,
      title: 'New Tab',
      favicon: null,
      isLoading: false,
      canGoBack: false,
      canGoForward: false,
      isCrashed: false,
      isLazy: !!isLazy,
      workspaceId: null,
      view: view,
    };

    this.tabs.set(tabId, tab);

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
    const handleNav = (event, url) => {
      tab.url = url;
      tab.canGoBack = wc.canGoBack();
      tab.canGoForward = wc.canGoForward();
      if (this.onTabUpdated) this.onTabUpdated(tab);
    };
    wc.on('did-navigate', handleNav);
    wc.on('did-navigate-in-page', handleNav);

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

    // Detect click/focus inside the WebContentsView to highlight focused pane
    wc.on('focus', () => {
      if (this.onViewFocus) this.onViewFocus(tabId);
    });

    // Edge case: handle window.open / target="_blank" links (open as a new tab)
    wc.setWindowOpenHandler(({ url }) => {
      if (this.onNewWindow) {
        this.onNewWindow(url);
      } else {
        this.createTab(url, true);
      }
      return { action: 'deny' };
    });

    // Edge case: handle web page render crashes gracefully
    wc.on('render-process-gone', (event, details) => {
      tab.isCrashed = true;
      tab.title = 'Page Crashed';
      if (this.onTabCrash) this.onTabCrash(tab, details);
      if (this.onTabUpdated) this.onTabUpdated(tab);
    });

    // Load target URL immediately if not lazy
    if (!isLazy) {
      wc.loadURL(initialUrl).catch(() => {});
    }

    if (this.onTabCreated) {
      this.onTabCreated(tab, activate);
    }

    return tab;
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
      workspaceId: t.workspaceId,
    }));
  }

  closeTab(tabId) {
    const tab = this.tabs.get(tabId);
    if (!tab) return false;

    // Detach view from main window if attached
    try {
      this.mainWindow.contentView.removeChildView(tab.view);
    } catch (e) {}

    // Clean up web contents
    try {
      tab.view.webContents.close();
    } catch (e) {}

    this.tabs.delete(tabId);

    if (this.onTabClosed) {
      this.onTabClosed(tabId);
    }

    return true;
  }

  navigate(tabId, url) {
    const tab = this.tabs.get(tabId);
    if (tab) {
      tab.isCrashed = false;
      tab.isLazy = false;
      tab.view.webContents.loadURL(url).catch(() => {});
    }
  }

  goBack(tabId) {
    const tab = this.tabs.get(tabId);
    if (tab && tab.view.webContents.canGoBack()) {
      tab.view.webContents.goBack();
    }
  }

  goForward(tabId) {
    const tab = this.tabs.get(tabId);
    if (tab && tab.view.webContents.canGoForward()) {
      tab.view.webContents.goForward();
    }
  }

  reload(tabId) {
    const tab = this.tabs.get(tabId);
    if (tab) {
      tab.isCrashed = false;
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
    if (tab) {
      tab.view.webContents.stop();
    }
  }
}

module.exports = TabManager;
