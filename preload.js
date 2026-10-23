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
  openDevTools: (tabId) => ipcRenderer.invoke('tab:openDevTools', tabId),

  // Split View
  toggleSplitView: () => ipcRenderer.invoke('split:toggle'),
  setSplitRightTab: (tabId) => ipcRenderer.invoke('split:setRightTab', tabId),
  closeSplitView: (keepTabId) => ipcRenderer.invoke('split:close', keepTabId),
  swapSplitPanes: () => ipcRenderer.invoke('split:swap'),
  setFocusedPane: (tabId) => ipcRenderer.invoke('split:setFocused', tabId),
  getSplitState: () => ipcRenderer.invoke('split:getState'),
  updateLayoutBounds: (bounds) => ipcRenderer.invoke('layout:updateBounds', bounds),
  setOverlayOpen: (isOpen) => ipcRenderer.invoke('views:setOverlayOpen', isOpen),

  // Workspaces
  getWorkspaceState: () => ipcRenderer.invoke('workspace:getState'),
  createWorkspace: (options) => ipcRenderer.invoke('workspace:create', options),
  switchWorkspace: (workspaceId) => ipcRenderer.invoke('workspace:switch', workspaceId),
  updateWorkspace: (options) => ipcRenderer.invoke('workspace:update', options),
  deleteWorkspace: (options) => ipcRenderer.invoke('workspace:delete', options),
  moveTabToWorkspace: (options) => ipcRenderer.invoke('workspace:moveTab', options),

  // Privacy
  getPrivacyStats: () => ipcRenderer.invoke('privacy:getStats'),
  toggleAdBlocker: (enabled) => ipcRenderer.invoke('privacy:toggleAdBlocker', enabled),
  addAllowlist: (domain) => ipcRenderer.invoke('privacy:addAllowlist', domain),
  removeAllowlist: (domain) => ipcRenderer.invoke('privacy:removeAllowlist', domain),
  isDomainAllowed: (domain) => ipcRenderer.invoke('privacy:isDomainAllowed', domain),

  // Tab Suspension & Memory Dashboard
  getSuspenderSettings: () => ipcRenderer.invoke('suspender:getSettings'),
  updateSuspenderSettings: (options) => ipcRenderer.invoke('suspender:updateSettings', options),
  suspendTab: (tabId) => ipcRenderer.invoke('suspender:suspendTab', tabId),
  suspendOtherTabs: (keepTabId) => ipcRenderer.invoke('suspender:suspendOthers', keepTabId),
  unsuspendTab: (tabId) => ipcRenderer.invoke('suspender:unsuspendTab', tabId),
  addSuspenderWhitelist: (domain) => ipcRenderer.invoke('suspender:addWhitelist', domain),
  removeSuspenderWhitelist: (domain) => ipcRenderer.invoke('suspender:removeWhitelist', domain),
  getMemoryStats: () => ipcRenderer.invoke('memory:getStats'),

  // Developer Toolkit - API Tester
  sendApiRequest: (options) => ipcRenderer.invoke('apiTester:sendRequest', options),
  getApiHistory: () => ipcRenderer.invoke('apiTester:getHistory'),
  clearApiHistory: () => ipcRenderer.invoke('apiTester:clearHistory'),
  getApiCollections: () => ipcRenderer.invoke('apiTester:getCollections'),
  saveApiToCollection: (options) => ipcRenderer.invoke('apiTester:saveToCollection', options),
  deleteApiFromCollection: (options) => ipcRenderer.invoke('apiTester:deleteFromCollection', options),
  createApiCollection: (name) => ipcRenderer.invoke('apiTester:createCollection', name),
  deleteApiCollection: (name) => ipcRenderer.invoke('apiTester:deleteCollection', name),
  getApiEnvironment: () => ipcRenderer.invoke('apiTester:getEnvironment'),
  saveApiEnvironment: (env) => ipcRenderer.invoke('apiTester:saveEnvironment', env),
  getApiSettings: () => ipcRenderer.invoke('apiTester:getSettings'),
  saveApiSettings: (settings) => ipcRenderer.invoke('apiTester:saveSettings', settings),

  // Developer Toolkit - Notes
  getWorkspaceNotes: (workspaceId) => ipcRenderer.invoke('notes:getWorkspaceNotes', workspaceId),
  saveNote: (options) => ipcRenderer.invoke('notes:saveNote', options),
  deleteNote: (options) => ipcRenderer.invoke('notes:deleteNote', options),
  exportNote: (options) => ipcRenderer.invoke('notes:exportNote', options),
  getSelectedText: () => ipcRenderer.invoke('tab:getSelectedText'),

  // GPU Diagnostics
  getGpuInfo: () => ipcRenderer.invoke('gpu:getInfo'),

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
  onWorkspaceStateChanged: (callback) => {
    ipcRenderer.on('workspace:stateChanged', (e, data) => callback(data));
  },
  onNotesInsertText: (callback) => {
    ipcRenderer.on('notes:insertText', (e, text) => callback(text));
  },
});
