// Coder Browser - Step 3: WebContentsView Migration & Split View
const { app, BrowserWindow } = require('electron');
const path = require('path');
const TabManager = require('./src/main/tabManager');
const SplitManager = require('./src/main/splitManager');
const setupIpcHandlers = require('./src/main/ipcHandlers');

let mainWindow = null;
let tabManager = null;
let splitManager = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    title: 'Coder Browser',
  });

  // Initialize managers
  tabManager = new TabManager(mainWindow);
  splitManager = new SplitManager(mainWindow, tabManager);

  // Wire TabManager events to send IPC notifications to UI
  tabManager.onTabCreated = (tab, activate) => {
    mainWindow.webContents.send('tab:created', {
      id: tab.id,
      url: tab.url,
      title: tab.title,
      favicon: tab.favicon,
      activate,
    });

    if (activate && !splitManager.isSplit) {
      tabManager.activeTabId = tab.id;
      splitManager.focusedTabId = tab.id;
      splitManager.applyLayout();
      mainWindow.webContents.send('tab:switched', tab.id);
    }
  };

  tabManager.onTabClosed = (tabId) => {
    mainWindow.webContents.send('tab:closed', tabId);
    splitManager.handleTabClosed(tabId);

    // If all tabs closed, automatically spawn a fresh blank tab
    if (tabManager.tabs.size === 0) {
      tabManager.createTab('https://duckduckgo.com', true);
    } else if (!splitManager.isSplit) {
      // Switch to closest available tab if active tab was closed
      if (tabManager.activeTabId === tabId) {
        const remainingTabs = Array.from(tabManager.tabs.keys());
        const nextTabId = remainingTabs[remainingTabs.length - 1];
        tabManager.activeTabId = nextTabId;
        splitManager.focusedTabId = nextTabId;
        splitManager.applyLayout();
        mainWindow.webContents.send('tab:switched', nextTabId);
      }
    }
  };

  tabManager.onTabUpdated = (tab) => {
    mainWindow.webContents.send('tab:updated', {
      id: tab.id,
      url: tab.url,
      title: tab.title,
      favicon: tab.favicon,
      isLoading: tab.isLoading,
      canGoBack: tab.canGoBack,
      canGoForward: tab.canGoForward,
      isCrashed: tab.isCrashed,
    });
  };

  // Clicking inside a WebContentsView notifies the UI to highlight that pane
  tabManager.onViewFocus = (tabId) => {
    splitManager.setFocusedTab(tabId);
    mainWindow.webContents.send('split:paneFocused', tabId);
  };

  // Gracefully handle render crashes without crashing the browser app
  tabManager.onTabCrash = (tab, details) => {
    mainWindow.webContents.send('tab:crashed', {
      tabId: tab.id,
      reason: details ? details.reason : 'unknown',
    });
  };

  // Handle window.open links by opening as new tab
  tabManager.onNewWindow = (url) => {
    tabManager.createTab(url, true);
  };

  // Split state changes forwarded to renderer
  splitManager.onStateChanged = (state) => {
    mainWindow.webContents.send('split:stateChanged', state);
  };

  // Register IPC handlers
  setupIpcHandlers(mainWindow, tabManager, splitManager);

  mainWindow.loadFile('index.html');

  // Relayout on window resize
  mainWindow.on('resize', () => {
    splitManager.applyLayout();
  });

  // Create initial tab once UI has loaded
  mainWindow.webContents.on('did-finish-load', () => {
    if (tabManager.tabs.size === 0) {
      tabManager.createTab('https://duckduckgo.com', true);
    }
  });
}

// App lifecycle
app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
