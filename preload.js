// Preload script - Exposes safe IPC bridge to renderer using contextBridge
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('browserAPI', {
  // Tabs
  createTab: (url, activate) => ipcRenderer.invoke('tab:create', url, activate),
  closeTab: (tabId) => ipcRenderer.invoke('tab:close', tabId),
  switchTab: (tabId) => ipcRenderer.invoke('tab:switch', tabId),
  getAllTabs: () => ipcRenderer.invoke('tab:getAll'),
  navigate: (tabId, url) => ipcRenderer.invoke('tab:navigate', { tabId, url }),
  goBack: (tabId) => ipcRenderer.invoke('tab:goBack', tabId),
  goForward: (tabId) => ipcRenderer.invoke('tab:goForward', tabId),
  reload: (tabId) => ipcRenderer.invoke('tab:reload', tabId),
  stop: (tabId) => ipcRenderer.invoke('tab:stop', tabId),

  // Split View
  toggleSplitView: () => ipcRenderer.invoke('split:toggle'),
  setSplitRightTab: (tabId) => ipcRenderer.invoke('split:setRightTab', tabId),
  closeSplitView: (keepTabId) => ipcRenderer.invoke('split:close', keepTabId),
  swapSplitPanes: () => ipcRenderer.invoke('split:swap'),
  setFocusedPane: (tabId) => ipcRenderer.invoke('split:setFocused', tabId),
  getSplitState: () => ipcRenderer.invoke('split:getState'),
  updateLayoutBounds: (bounds) => ipcRenderer.invoke('layout:updateBounds', bounds),

  // Event Subscriptions
  onTabCreated: (callback) => {
    ipcRenderer.on('tab:created', (e, data) => callback(data));
  },
  onTabClosed: (callback) => {
    ipcRenderer.on('tab:closed', (e, data) => callback(data));
  },
  onTabUpdated: (callback) => {
    ipcRenderer.on('tab:updated', (e, data) => callback(data));
  },
  onTabSwitched: (callback) => {
    ipcRenderer.on('tab:switched', (e, data) => callback(data));
  },
  onSplitStateChanged: (callback) => {
    ipcRenderer.on('split:stateChanged', (e, data) => callback(data));
  },
  onPaneFocused: (callback) => {
    ipcRenderer.on('split:paneFocused', (e, data) => callback(data));
  },
  onPageCrash: (callback) => {
    ipcRenderer.on('tab:crashed', (e, data) => callback(data));
  },
});
