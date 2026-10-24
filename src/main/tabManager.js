// Tab Manager - Manages WebContentsView instances, lifecycle, security, and view creation
const { WebContentsView, Menu, MenuItem } = require('electron');
const path = require('path');
const privacyManager = require('./privacyManager');
const youtubeAdHandler = require('./youtubeAdHandler');
const jsonPageHandler = require('./jsonPageHandler');
const netdebugLogger = require('./netdebugLogger');

class TabManager {
  constructor(mainWindow) {
    this.mainWindow = mainWindow;
    this.tabs = new Map(); // tabId -> tab state object
    this.tabCounter = 0;
    this.activeTabId = null;

    // Injected reference for suspension coordination
    this.tabSuspender = null;
    this.proxyManager = null;

    // Callback hooks for main process & IPC notifications
    this.onTabCreated = null;
    this.onTabClosed = null;
    this.onTabUpdated = null;
    this.onTabCrash = null;
    this.onNewWindow = null;
    this.onViewFocus = null;
    this.onSendSelectionToNotes = null;
    this.onAskAIAboutSelection = null;
    this.historyManager = null;
    this.closedTabsStack = [];
  }

  /**
   * Recreates or sets up WebContentsView for a tab with strict security settings and event hooks.
   */
  setupTabView(tab, urlToLoad = null) {
    const tabId = tab.id;

    // Clean up any existing view and listeners before creating a new one
    if (tab.view) {
      if (this.mainWindow && this.mainWindow.contentView) {
        try {
          this.mainWindow.contentView.removeChildView(tab.view);
        } catch (e) {}
      }
      if (tab.view.webContents && !tab.view.webContents.isDestroyed()) {
        try {
          tab.view.webContents.removeAllListeners();
          tab.view.webContents.close();
        } catch (e) {}
      }
      tab.view = null;
    }

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
      tab.canGoBack = wc.navigationHistory ? wc.navigationHistory.canGoBack() : wc.canGoBack();
      tab.canGoForward = wc.navigationHistory ? wc.navigationHistory.canGoForward() : wc.canGoForward();
      if (this.onTabUpdated) this.onTabUpdated(tab);
    });

    // Navigation and URL updates
    const triggerYouTubeHandler = (url) => {
      if (this.isSafeMode) return;
      youtubeAdHandler.handleNavigation(wc, url, privacyManager);
    };

    wc.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
      netdebugLogger.log('PageLoad:Fail', `[${errorCode}] ${errorDescription} on ${validatedURL}`);
    });

    const handleNav = (event, url) => {
      tab.url = url;
      tab.lastActiveTime = Date.now();
      const currentTitle = wc.getTitle();
      if (currentTitle) {
        tab.title = currentTitle;
      }
      tab.canGoBack = wc.navigationHistory ? wc.navigationHistory.canGoBack() : wc.canGoBack();
      tab.canGoForward = wc.navigationHistory ? wc.navigationHistory.canGoForward() : wc.canGoForward();
      if (this.onTabUpdated) this.onTabUpdated(tab);
      if (this.historyManager) {
        this.historyManager.addEntry(url, tab.title);
      }
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

    // Find in page event synchronization
    wc.on('found-in-page', (event, result) => {
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send('tab:foundInPage', {
          tabId,
          activeMatchOrdinal: result.activeMatchOrdinal,
          numberOfMatches: result.matches,
          finalUpdate: result.finalUpdate,
        });
      }
    });

    // Error logging, custom error pages, and proxy kill switch handling
    wc.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      console.log(`[did-fail-load] Tab: ${tabId}, Code: ${errorCode}, Description: ${errorDescription}, URL: ${validatedURL}, MainFrame: ${isMainFrame}`);
      if (this.proxyManager && isMainFrame) {
        this.proxyManager.handleProxyFailure(tab, errorCode, errorDescription, validatedURL);
      }
      if (isMainFrame && errorCode !== -3 && validatedURL && !validatedURL.startsWith('data:text/html')) {
        const errorHtml = generateErrorPageHtml(errorCode, errorDescription, validatedURL);
        wc.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(errorHtml)).catch(() => {});
      }
    });

    // Page title
    wc.on('page-title-updated', (event, title) => {
      tab.title = title || 'Untitled';
      if (this.historyManager) {
        this.historyManager.updateTitle(tab.url, title);
      }
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

    // HTML Fullscreen synchronization (YouTube, HTML5 video, Canvas)
    wc.on('enter-html-full-screen', () => {
      netdebugLogger.log('TabManager', `Tab ${tabId} entered HTML full screen`);
      if (this.onEnterHtmlFullScreen) {
        this.onEnterHtmlFullScreen(tabId);
      }
    });

    wc.on('leave-html-full-screen', () => {
      netdebugLogger.log('TabManager', `Tab ${tabId} left HTML full screen`);
      if (this.onLeaveHtmlFullScreen) {
        this.onLeaveHtmlFullScreen(tabId);
      }
    });

    // Target="_blank" / window.open
    // Security: Block web pages from opening file:// URLs
    wc.setWindowOpenHandler(({ url }) => {
      if (url && url.startsWith('file://')) {
        console.warn('[Security] Blocked page window.open to file:// URL:', url);
        return { action: 'deny' };
      }
      if (this.onNewWindow) {
        this.onNewWindow(url);
      } else {
        this.createTab(url, true);
      }
      return { action: 'deny' };
    });

    // Security: Prevent remote web pages from navigating to local file:// scheme
    wc.on('will-navigate', (event, navigationUrl) => {
      const currentUrl = tab.url || '';
      if (
        navigationUrl &&
        navigationUrl.startsWith('file://') &&
        (currentUrl.startsWith('http://') || currentUrl.startsWith('https://'))
      ) {
        console.warn('[Security] Blocked remote web page from navigating to local file:// URL:', navigationUrl);
        event.preventDefault();
      }
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
      if (this.proxyManager && this.proxyManager.isKillSwitchEngaged && this.proxyManager.settings && this.proxyManager.settings.enableKillSwitch) {
        this.proxyManager.renderKillSwitchPage(wc, -130, 'Proxy Kill Switch Engaged');
      } else {
        wc.loadURL(urlToLoad).catch(() => {});
      }
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

    // Exit HTML Fullscreen if the tab being closed is currently fullscreen
    if (this.splitManager && this.splitManager.htmlFullScreenTabId === tabId) {
      this.splitManager.leaveHtmlFullScreen(tabId);
    }

    // Save for Ctrl+Shift+T reopen
    if (tab.url && !tab.url.startsWith('browser://') && !tab.url.startsWith('about:')) {
      this.closedTabsStack.push({
        url: tab.url,
        title: tab.title,
        workspaceId: tab.workspaceId,
      });
      if (this.closedTabsStack.length > 25) {
        this.closedTabsStack.shift();
      }
    }

    // Detach and clean up view if active
    if (tab.view) {
      try {
        this.mainWindow.contentView.removeChildView(tab.view);
      } catch (e) {}

      if (tab.view.webContents && !tab.view.webContents.isDestroyed()) {
        try {
          tab.view.webContents.removeAllListeners();
          tab.view.webContents.close();
        } catch (e) {}
      }
      tab.view = null;
    }

    this.tabs.delete(tabId);

    if (this.onTabClosed) {
      this.onTabClosed(tabId);
    }

    return true;
  }

  /**
   * Reopens the most recently closed tab (Ctrl+Shift+T).
   */
  reopenClosedTab() {
    if (!this.closedTabsStack || this.closedTabsStack.length === 0) return null;
    const closed = this.closedTabsStack.pop();
    const tab = this.createTab(closed.url, true, false, false, { workspaceId: closed.workspaceId });
    return tab;
  }

  /**
   * Find in page for active tab.
   */
  findInPage(tabId, text, forward = true) {
    const tab = this.tabs.get(tabId);
    if (!tab || !tab.view || !tab.view.webContents || tab.view.webContents.isDestroyed()) return null;
    if (!text) {
      tab.view.webContents.stopFindInPage('clearSelection');
      return 0;
    }
    return tab.view.webContents.findInPage(text, { forward, findNext: true });
  }

  stopFindInPage(tabId, action = 'clearSelection') {
    const tab = this.tabs.get(tabId);
    if (!tab || !tab.view || !tab.view.webContents || tab.view.webContents.isDestroyed()) return;
    tab.view.webContents.stopFindInPage(action);
  }

  /**
   * Zoom controls for active tab.
   */
  setZoom(tabId, factor) {
    const tab = this.tabs.get(tabId);
    if (!tab || !tab.view || !tab.view.webContents || tab.view.webContents.isDestroyed()) return 1.0;
    const clamped = Math.min(Math.max(factor, 0.3), 3.0);
    tab.view.webContents.setZoomFactor(clamped);
    return clamped;
  }

  getZoom(tabId) {
    const tab = this.tabs.get(tabId);
    if (!tab || !tab.view || !tab.view.webContents || tab.view.webContents.isDestroyed()) return 1.0;
    return tab.view.webContents.getZoomFactor();
  }

  /**
   * Prints the active tab.
   */
  print(tabId) {
    const tab = this.tabs.get(tabId);
    if (!tab || !tab.view || !tab.view.webContents || tab.view.webContents.isDestroyed()) return false;
    tab.view.webContents.print({ silent: false, printBackground: true });
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
    if (this.proxyManager && this.proxyManager.isKillSwitchEngaged && this.proxyManager.settings && this.proxyManager.settings.enableKillSwitch) {
      if (tab.view && tab.view.webContents && !tab.view.webContents.isDestroyed()) {
        this.proxyManager.renderKillSwitchPage(tab.view.webContents, -130, 'Proxy Kill Switch Engaged');
        return;
      }
    }

    if (url && url.toLowerCase() === 'browser://net-test') {
      tab.url = 'browser://net-test';
      tab.title = 'Network Self-Test (browser://net-test)';
      if (this.onTabUpdated) this.onTabUpdated(tab);
      if (tab.view && tab.view.webContents) {
        tab.view.webContents.loadFile(path.join(__dirname, '../renderer/net-test.html')).catch(() => {});
      }
      return;
    }
    if (tab.view && tab.view.webContents) {
      tab.view.webContents.loadURL(url).catch(() => {});
    }
  }

  goBack(tabId) {
    const tab = this.tabs.get(tabId);
    if (tab && tab.view && tab.view.webContents && !tab.view.webContents.isDestroyed()) {
      const wc = tab.view.webContents;
      const canBack = wc.navigationHistory ? wc.navigationHistory.canGoBack() : wc.canGoBack();
      if (canBack) {
        tab.lastActiveTime = Date.now();
        if (wc.navigationHistory && typeof wc.navigationHistory.goBack === 'function') {
          wc.navigationHistory.goBack();
        } else {
          wc.goBack();
        }
      }
    }
  }

  goForward(tabId) {
    const tab = this.tabs.get(tabId);
    if (tab && tab.view && tab.view.webContents && !tab.view.webContents.isDestroyed()) {
      const wc = tab.view.webContents;
      const canFwd = wc.navigationHistory ? wc.navigationHistory.canGoForward() : wc.canGoForward();
      if (canFwd) {
        tab.lastActiveTime = Date.now();
        if (wc.navigationHistory && typeof wc.navigationHistory.goForward === 'function') {
          wc.navigationHistory.goForward();
        } else {
          wc.goForward();
        }
      }
    }
  }

  /**
   * Diagnostic debug check: inspects event listener counts on a tab's WebContents.
   */
  logTabListenerCounts(tabId) {
    const tab = this.tabs.get(tabId);
    if (!tab || !tab.view || !tab.view.webContents || tab.view.webContents.isDestroyed()) {
      return null;
    }
    const wc = tab.view.webContents;
    const events = [
      'did-start-loading',
      'did-stop-loading',
      'did-navigate',
      'did-navigate-in-page',
      'did-finish-load',
      'dom-ready',
      'did-fail-load',
      'page-title-updated',
      'page-favicon-updated',
      'focus',
      'will-navigate',
      'render-process-gone',
      'context-menu',
    ];
    const counts = {};
    for (const ev of events) {
      counts[ev] = wc.listenerCount(ev);
    }
    return counts;
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

function generateErrorPageHtml(errorCode, errorDescription, validatedURL) {
  let title = 'Unable to Load Page';
  let message = 'This page could not be loaded.';
  let icon = '⚠️';

  if (errorCode === -106 || (errorDescription && errorDescription.includes('INTERNET_DISCONNECTED'))) {
    title = 'No Internet Connection';
    message = 'Your computer appears to be offline. Please check your network connection, Wi-Fi, or proxy settings.';
    icon = '📡';
  } else if (errorCode === -105 || (errorDescription && errorDescription.includes('NAME_NOT_RESOLVED'))) {
    title = 'Server Not Found';
    message = 'The server address could not be resolved. Please check the spelling of the web address or your DNS settings.';
    icon = '🔍';
  } else if (errorCode === -102 || (errorDescription && errorDescription.includes('CONNECTION_REFUSED'))) {
    title = 'Connection Refused';
    message = 'The target server refused the connection. The service might be temporarily unavailable or blocked by a firewall.';
    icon = '🚫';
  } else if (errorCode === -118 || (errorDescription && errorDescription.includes('TIMED_OUT'))) {
    title = 'Connection Timed Out';
    message = 'The server took too long to respond. The website might be overloaded or undergoing maintenance.';
    icon = '⏱️';
  } else if (errorCode <= -200 && errorCode >= -299) {
    title = 'Security Certificate Error';
    message = 'The site presented an invalid or untrusted security certificate. Attackers may be attempting to intercept your traffic.';
    icon = '🔒';
  }

  const safeUrl = (validatedURL || '').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const safeDesc = (errorDescription || 'Load Failed').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${title} - Coder Browser</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: #09090b;
      color: #f4f4f5;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 24px;
    }
    .card {
      background-color: #18181b;
      border: 1px solid #27272a;
      border-radius: 12px;
      padding: 36px;
      max-width: 540px;
      width: 100%;
      text-align: center;
      box-shadow: 0 10px 25px rgba(0, 0, 0, 0.4);
    }
    .icon { font-size: 48px; margin-bottom: 16px; }
    h1 { font-size: 22px; font-weight: 600; margin-bottom: 12px; color: #ffffff; }
    p { font-size: 14px; line-height: 1.6; color: #a1a1aa; margin-bottom: 20px; }
    .url-box {
      background-color: #09090b;
      border: 1px solid #27272a;
      padding: 8px 12px;
      border-radius: 6px;
      font-family: monospace;
      font-size: 12px;
      color: #93c5fd;
      word-break: break-all;
      margin-bottom: 20px;
    }
    .badge-row {
      display: flex;
      justify-content: center;
      gap: 8px;
      margin-bottom: 24px;
    }
    .badge {
      background-color: #27272a;
      color: #71717a;
      font-size: 11px;
      font-family: monospace;
      padding: 3px 8px;
      border-radius: 4px;
    }
    .badge.offline {
      background-color: rgba(239, 68, 68, 0.15);
      color: #f87171;
    }
    .btn-retry {
      background-color: #3b82f6;
      color: #ffffff;
      border: none;
      padding: 10px 24px;
      font-size: 14px;
      font-weight: 500;
      border-radius: 6px;
      cursor: pointer;
      transition: background-color 0.15s;
    }
    .btn-retry:hover { background-color: #2563eb; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">${icon}</div>
    <h1>${title}</h1>
    <p>${message}</p>
    <div class="url-box">${safeUrl}</div>
    <div class="badge-row">
      <span class="badge">Error ${errorCode}: ${safeDesc}</span>
      <span id="offline-badge" class="badge offline" style="display: none;">OFFLINE</span>
    </div>
    <button class="btn-retry" onclick="location.href='${safeUrl}'">Try Again</button>
  </div>
  <script>
    if (!navigator.onLine) {
      document.getElementById('offline-badge').style.display = 'inline-block';
    }
    window.addEventListener('online', () => {
      document.getElementById('offline-badge').style.display = 'none';
    });
    window.addEventListener('offline', () => {
      document.getElementById('offline-badge').style.display = 'inline-block';
    });
  </script>
</body>
</html>`;
}

module.exports = TabManager;
