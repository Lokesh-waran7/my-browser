// Coder Browser - Step 4: Workspaces & Multi-Context Tabs
const { app, BrowserWindow, session } = require('electron');
const path = require('path');
const TabManager = require('./src/main/tabManager');
const SplitManager = require('./src/main/splitManager');
const WorkspaceManager = require('./src/main/workspaceManager');
const TabSuspender = require('./src/main/tabSuspender');
const privacyManager = require('./src/main/privacyManager');
const setupIpcHandlers = require('./src/main/ipcHandlers');

let mainWindow = null;
let tabManager = null;
let splitManager = null;
let workspaceManager = null;
let tabSuspender = null;

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

  // Initialize modular managers
  tabManager = new TabManager(mainWindow);
  splitManager = new SplitManager(mainWindow, tabManager);
  workspaceManager = new WorkspaceManager(mainWindow, tabManager, splitManager);
  tabSuspender = new TabSuspender(mainWindow, tabManager, splitManager, workspaceManager);
  tabManager.tabSuspender = tabSuspender;
  splitManager.tabSuspender = tabSuspender;
  workspaceManager.tabSuspender = tabSuspender;

  // Wire TabManager events
  tabManager.onTabCreated = (tab, activate) => {
    mainWindow.webContents.send('tab:created', {
      id: tab.id,
      url: tab.url,
      title: tab.title,
      favicon: tab.favicon,
      workspaceId: tab.workspaceId,
      isSuspended: !!tab.isSuspended,
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
    if (workspaceManager) {
      mainWindow.webContents.send('workspace:stateChanged', workspaceManager.getState());
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
      isSuspended: !!tab.isSuspended,
      workspaceId: tab.workspaceId,
    });
  };

  // Focus synchronization
  tabManager.onViewFocus = (tabId) => {
    splitManager.setFocusedTab(tabId);
    mainWindow.webContents.send('split:paneFocused', tabId);
  };

  // Crash recovery
  tabManager.onTabCrash = (tab, details) => {
    mainWindow.webContents.send('tab:crashed', {
      tabId: tab.id,
      reason: details ? details.reason : 'unknown',
    });
  };

  // New-window link handler
  tabManager.onNewWindow = (url) => {
    const tab = tabManager.createTab(url, true);
    if (workspaceManager) {
      tab.workspaceId = workspaceManager.activeWorkspaceId;
      workspaceManager.registerTab(tab.id);
    }
  };

  // Split state updates
  splitManager.onStateChanged = (state) => {
    mainWindow.webContents.send('split:stateChanged', state);
  };

  // Workspace state updates
  workspaceManager.onWorkspaceChanged = (state) => {
    mainWindow.webContents.send('workspace:stateChanged', state);
  };

  // Register all IPC handlers
  setupIpcHandlers(mainWindow, tabManager, splitManager, workspaceManager, privacyManager, tabSuspender);

  mainWindow.loadFile('index.html');

  // Relayout on window resize
  mainWindow.on('resize', () => {
    splitManager.applyLayout();
  });

  // Restore or initialize workspaces once the UI finishes loading
  mainWindow.webContents.on('did-finish-load', () => {
    workspaceManager.init();
    mainWindow.webContents.send('workspace:stateChanged', workspaceManager.getState());
    splitManager.applyLayout();
  });
}

// App lifecycle
app.whenReady().then(async () => {
  await privacyManager.init(session.defaultSession);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('before-quit', () => {
  if (workspaceManager) {
    workspaceManager.saveToDisk();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
