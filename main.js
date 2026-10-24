// Coder Browser - Step 7: Developer Toolkit & GPU Acceleration
const { app, BrowserWindow, session } = require('electron');
const path = require('path');

// Hardware acceleration & GPU switches to unlock full GPU rasterization and video decode
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('enable-accelerated-video-decode');

const TabManager = require('./src/main/tabManager');
const SplitManager = require('./src/main/splitManager');
const WorkspaceManager = require('./src/main/workspaceManager');
const TabSuspender = require('./src/main/tabSuspender');
const privacyManager = require('./src/main/privacyManager');
const ApiTester = require('./src/main/apiTester');
const NotesManager = require('./src/main/notesManager');
const AIManager = require('./src/main/ai/aiManager');
const ProxyManager = require('./src/main/proxyManager');
const setupIpcHandlers = require('./src/main/ipcHandlers');
const logger = require('./src/main/logger');

// Global handlers in the main process for uncaught exceptions and unhandled rejections
process.on('uncaughtException', (err) => {
  logger.log('Main:uncaughtException', err);
});
process.on('unhandledRejection', (reason) => {
  logger.log('Main:unhandledRejection', reason);
});

let mainWindow = null;
let tabManager = null;
let splitManager = null;
let workspaceManager = null;
let tabSuspender = null;
let apiTester = null;
let notesManager = null;
let aiManager = null;
let proxyManager = null;

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
      sandbox: false,
    },
    title: 'Coder Browser',
  });

  // Initialize modular managers
  tabManager = new TabManager(mainWindow);
  splitManager = new SplitManager(mainWindow, tabManager);
  workspaceManager = new WorkspaceManager(mainWindow, tabManager, splitManager);
  tabSuspender = new TabSuspender(mainWindow, tabManager, splitManager, workspaceManager);
  apiTester = new ApiTester();
  notesManager = new NotesManager();
  aiManager = new AIManager(mainWindow, tabManager, workspaceManager);
  aiManager.init();
  proxyManager = new ProxyManager(mainWindow);
  proxyManager.init();

  tabManager.tabSuspender = tabSuspender;
  tabManager.proxyManager = proxyManager;
  proxyManager.tabManager = tabManager;
  splitManager.tabSuspender = tabSuspender;
  workspaceManager.tabSuspender = tabSuspender;

  // Context-menu hook: send selected page text to active note
  tabManager.onSendSelectionToNotes = (text) => {
    mainWindow.webContents.send('notes:insertText', text);
  };

  // Context-menu hook: Ask AI about selected text
  tabManager.onAskAIAboutSelection = (text) => {
    mainWindow.webContents.send('ai:askSelection', { text });
  };

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
    if (proxyManager && state) {
      proxyManager.applyForWorkspace(state.activeWorkspaceId);
    }
  };

  // Register all IPC handlers
  setupIpcHandlers(
    mainWindow,
    tabManager,
    splitManager,
    workspaceManager,
    privacyManager,
    tabSuspender,
    apiTester,
    notesManager,
    aiManager,
    proxyManager
  );

  mainWindow.loadFile('index.html');

  // Window crash / render-process-gone logging
  mainWindow.webContents.on('render-process-gone', (event, details) => {
    logger.log('MainWindow:render-process-gone', new Error(`Render process gone: ${JSON.stringify(details)}`));
  });

  // Shortcut (Ctrl+Alt+I): Open DevTools for browser UI window's own renderer
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.control && input.alt && (input.key === 'i' || input.key === 'I')) {
      mainWindow.webContents.openDevTools({ mode: 'detach' });
    }
  });

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
