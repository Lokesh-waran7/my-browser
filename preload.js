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

  // AI Assistant (Step 8)
  getAiSettings: (forceRefresh) => ipcRenderer.invoke('ai:getSettings', forceRefresh),
  updateAiSettings: (settings) => ipcRenderer.invoke('ai:updateSettings', settings),
  testAiConnection: (options) => ipcRenderer.invoke('ai:testConnection', options),
  getAiHistory: (workspaceId) => ipcRenderer.invoke('ai:getHistory', workspaceId),
  clearAiHistory: (workspaceId) => ipcRenderer.invoke('ai:clearHistory', workspaceId),
  sendAiMessage: (options) => ipcRenderer.invoke('ai:sendMessage', options),
  stopAiStream: (streamId) => ipcRenderer.invoke('ai:stopStream', streamId),
  extractAiPageContent: () => ipcRenderer.invoke('ai:extractPage'),
  openWindowDevTools: () => ipcRenderer.invoke('window:openDevTools'),
  logError: (errorInfo) => ipcRenderer.invoke('app:logRendererError', errorInfo),

  // Proxy / VPN Management (Step 9)
  getProxyState: () => ipcRenderer.invoke('proxy:getState'),
  setProxyMode: (mode, profileId) => ipcRenderer.invoke('proxy:setMode', { mode, profileId }),
  saveManualProxy: (config) => ipcRenderer.invoke('proxy:saveManualProxy', config),
  saveProxyProfile: (profile) => ipcRenderer.invoke('proxy:saveProfile', profile),
  deleteProxyProfile: (profileId) => ipcRenderer.invoke('proxy:deleteProfile', profileId),
  updateProxySettings: (settings) => ipcRenderer.invoke('proxy:updateSettings', settings),
  testProxyConnection: (customEndpoint) => ipcRenderer.invoke('proxy:testConnection', customEndpoint),
  resetProxyKillSwitch: () => ipcRenderer.invoke('proxy:resetKillSwitch'),

  // Settings
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (updates) => ipcRenderer.invoke('settings:update', updates),

  // History
  getHistory: (filter) => ipcRenderer.invoke('history:get', filter),
  deleteHistoryItem: (id) => ipcRenderer.invoke('history:delete', id),
  clearHistory: () => ipcRenderer.invoke('history:clear'),
  getHistorySuggestions: (query) => ipcRenderer.invoke('history:getSuggestions', query),

  // Bookmarks
  getBookmarks: (filter) => ipcRenderer.invoke('bookmarks:get', filter),
  isBookmarked: (url) => ipcRenderer.invoke('bookmarks:isBookmarked', url),
  addBookmark: (bookmark) => ipcRenderer.invoke('bookmarks:add', bookmark),
  removeBookmark: (id) => ipcRenderer.invoke('bookmarks:remove', id),
  removeBookmarkByUrl: (url) => ipcRenderer.invoke('bookmarks:removeByUrl', url),
  updateBookmark: (id, updates) => ipcRenderer.invoke('bookmarks:update', id, updates),
  addBookmarkFolder: (name) => ipcRenderer.invoke('bookmarks:addFolder', name),
  deleteBookmarkFolder: (id) => ipcRenderer.invoke('bookmarks:deleteFolder', id),
  exportBookmarks: () => ipcRenderer.invoke('bookmarks:export'),
  importBookmarks: (html) => ipcRenderer.invoke('bookmarks:import', html),
  getBookmarkSuggestions: (query) => ipcRenderer.invoke('bookmarks:getSuggestions', query),

  // Downloads
  getDownloads: (query) => ipcRenderer.invoke('downloads:get', query),
  pauseDownload: (id) => ipcRenderer.invoke('downloads:pause', id),
  resumeDownload: (id) => ipcRenderer.invoke('downloads:resume', id),
  cancelDownload: (id) => ipcRenderer.invoke('downloads:cancel', id),
  openDownloadFile: (id) => ipcRenderer.invoke('downloads:open', id),
  showDownloadInFolder: (id) => ipcRenderer.invoke('downloads:showInFolder', id),
  clearCompletedDownloads: () => ipcRenderer.invoke('downloads:clearCompleted'),

  // Permissions
  respondToPermission: (requestId, decision) => ipcRenderer.invoke('permissions:respond', requestId, decision),
  getAllPermissions: () => ipcRenderer.invoke('permissions:getAll'),
  revokePermission: (origin, permission) => ipcRenderer.invoke('permissions:revoke', origin, permission),
  clearAllPermissions: () => ipcRenderer.invoke('permissions:clearAll'),

  // Tab Extra Controls
  reopenClosedTab: () => ipcRenderer.invoke('tabs:reopenClosed'),
  findInPage: (tabId, text, forward) => ipcRenderer.invoke('tabs:findInPage', tabId, text, forward),
  stopFindInPage: (tabId, action) => ipcRenderer.invoke('tabs:stopFindInPage', tabId, action),
  setZoom: (tabId, factor) => ipcRenderer.invoke('tabs:setZoom', tabId, factor),
  getZoom: (tabId) => ipcRenderer.invoke('tabs:getZoom', tabId),
  printTab: (tabId) => ipcRenderer.invoke('tabs:print', tabId),
  toggleFullScreen: () => ipcRenderer.invoke('window:toggleFullScreen'),

  // Auto-Updater (Step 10 Part D)
  checkForUpdates: () => ipcRenderer.invoke('app:checkForUpdates'),
  openDownloadPage: (url) => ipcRenderer.invoke('app:openDownloadPage', url),

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
  onAiStreamChunk: (callback) => {
    ipcRenderer.on('ai:streamChunk', (e, data) => callback(data));
  },
  onAiStreamEnd: (callback) => {
    ipcRenderer.on('ai:streamEnd', (e, data) => callback(data));
  },
  onAiStreamError: (callback) => {
    ipcRenderer.on('ai:streamError', (e, data) => callback(data));
  },
  onAiAskSelection: (callback) => {
    ipcRenderer.on('ai:askSelection', (e, data) => callback(data));
  },
  onAiModelNotice: (callback) => {
    ipcRenderer.on('ai:modelNotice', (e, data) => callback(data));
  },
  onProxyStateChanged: (callback) => {
    ipcRenderer.on('proxy:stateChanged', (e, data) => callback(data));
  },
  onDownloadsUpdated: (callback) => {
    ipcRenderer.on('downloads:updated', (e, data) => callback(data));
  },
  onPermissionPrompt: (callback) => {
    ipcRenderer.on('permissions:prompt', (e, data) => callback(data));
  },
  onFoundInPage: (callback) => {
    ipcRenderer.on('tab:foundInPage', (e, data) => callback(data));
  },
  onUpdateAvailable: (callback) => {
    ipcRenderer.on('app:updateAvailable', (e, data) => callback(data));
  },
});

// Markdown Renderer with DOMPurify sanitization
const { marked } = require('marked');
const createDOMPurify = require('dompurify');
const DOMPurify = createDOMPurify(window);

contextBridge.exposeInMainWorld('markdownAPI', {
  render: (markdownText) => {
    if (!markdownText) return '';
    try {
      const rawHtml = marked.parse(markdownText, { gfm: true, breaks: true });
      return DOMPurify.sanitize(rawHtml);
    } catch (err) {
      return DOMPurify.sanitize(String(markdownText));
    }
  },
});
