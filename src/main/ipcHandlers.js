// IPC Handlers - Bridges UI renderer commands with main process managers
const { ipcMain } = require('electron');
const logger = require('./logger');

// Security Input Sanitization Helpers (Step 10 Part C)
function sanitizeString(val, maxLength = 2048) {
  if (typeof val !== 'string') return '';
  return val.trim().slice(0, maxLength);
}

function sanitizeUrl(url) {
  if (typeof url !== 'string') return 'https://duckduckgo.com';
  const trimmed = url.trim();
  if (trimmed.length > 4096) return 'https://duckduckgo.com';
  return trimmed;
}

function sanitizeNumber(val, min = -Infinity, max = Infinity, fallback = 0) {
  const num = Number(val);
  if (isNaN(num)) return fallback;
  return Math.max(min, Math.min(max, num));
}

function setupIpcHandlers(
  mainWindow,
  tabManager,
  splitManager,
  workspaceManager,
  privacyManager,
  tabSuspender,
  apiTester,
  notesManager,
  aiManager,
  proxyManager,
  additionalManagers = {}
) {
  const {
    settingsManager,
    historyManager,
    bookmarksManager,
    downloadsManager,
    permissionsManager,
    updateManager,
  } = additionalManagers;
  // Tab Management
  ipcMain.handle('tab:create', (event, url, activate) => {
    const safeUrl = sanitizeUrl(url);
    const tab = tabManager.createTab(safeUrl, activate !== false);
    if (workspaceManager) {
      tab.workspaceId = workspaceManager.activeWorkspaceId;
      workspaceManager.registerTab(tab.id);
    }
    return {
      id: tab.id,
      url: tab.url,
      title: tab.title,
      favicon: tab.favicon,
      workspaceId: tab.workspaceId,
    };
  });

  ipcMain.handle('tab:close', (event, tabId) => {
    if (workspaceManager) {
      workspaceManager.unregisterTab(tabId);
    }
    return tabManager.closeTab(tabId);
  });

  ipcMain.handle('tab:switch', (event, tabId) => {
    console.log(`[TabSwitch] Switching to tab: ${tabId}`);
    if (tabSuspender) {
      tabSuspender.unsuspendTab(tabId);
    }

    if (workspaceManager) {
      workspaceManager.awakenTabIfNeeded(tabId);
      const activeWs = workspaceManager.getActiveWorkspace();
      if (activeWs) activeWs.activeTabId = tabId;
      workspaceManager.scheduleSave();
    }

    // Safety net: ensure active tab has alive WebContentsView
    tabManager.ensureActiveTabView(tabId);

    if (splitManager.isSplit) {
      if (splitManager.leftTabId === tabId || splitManager.rightTabId === tabId) {
        splitManager.setFocusedTab(tabId);
      } else {
        if (splitManager.focusedTabId === splitManager.rightTabId) {
          splitManager.rightTabId = tabId;
        } else {
          splitManager.leftTabId = tabId;
        }
        splitManager.setFocusedTab(tabId);
        splitManager.applyLayout();
      }
    } else {
      tabManager.activeTabId = tabId;
      splitManager.setFocusedTab(tabId);
      splitManager.applyLayout();
      mainWindow.webContents.send('tab:switched', tabId);
    }
    return true;
  });

  ipcMain.handle('tab:getAll', () => {
    return tabManager.getAllTabs();
  });

  ipcMain.handle('tab:navigate', (event, { tabId, url }) => {
    const safeUrl = sanitizeUrl(url);
    tabManager.navigate(tabId, safeUrl);
    if (workspaceManager) workspaceManager.scheduleSave();
    return true;
  });

  ipcMain.handle('tab:goBack', (event, tabId) => {
    tabManager.goBack(tabId);
    return true;
  });

  ipcMain.handle('tab:goForward', (event, tabId) => {
    tabManager.goForward(tabId);
    return true;
  });

  ipcMain.handle('tab:reload', (event, tabId) => {
    tabManager.reload(tabId);
    return true;
  });

  ipcMain.handle('tab:stop', (event, tabId) => {
    tabManager.stop(tabId);
    return true;
  });

  ipcMain.handle('tab:openDevTools', (event, tabId) => {
    const targetId = tabId || tabManager.activeTabId || splitManager.focusedTabId;
    tabManager.openDevTools(targetId);
    return true;
  });

  // Split View Controls
  ipcMain.handle('split:toggle', () => {
    if (splitManager.isSplit) {
      splitManager.closeSplit();
    } else {
      const activeId = tabManager.activeTabId || splitManager.focusedTabId;
      splitManager.startSplit(activeId);
    }
    if (workspaceManager) workspaceManager.scheduleSave();
    return splitManager.getState();
  });

  ipcMain.handle('split:setRightTab', (event, tabId) => {
    if (workspaceManager) workspaceManager.awakenTabIfNeeded(tabId);
    splitManager.setRightTab(tabId);
    if (workspaceManager) workspaceManager.scheduleSave();
    return splitManager.getState();
  });

  ipcMain.handle('split:close', (event, keepTabId) => {
    splitManager.closeSplit(keepTabId);
    if (workspaceManager) workspaceManager.scheduleSave();
    return splitManager.getState();
  });

  ipcMain.handle('split:swap', () => {
    splitManager.swapPanes();
    if (workspaceManager) workspaceManager.scheduleSave();
    return splitManager.getState();
  });

  ipcMain.handle('split:setFocused', (event, tabId) => {
    splitManager.setFocusedTab(tabId);
    return splitManager.getState();
  });

  ipcMain.handle('split:getState', () => {
    return splitManager.getState();
  });

  // Layout synchronization
  ipcMain.handle('layout:updateBounds', (event, bounds) => {
    splitManager.updateLayoutBounds(bounds);
    return true;
  });

  // Overlay / Modal visibility control
  ipcMain.handle('views:setOverlayOpen', (event, isOpen) => {
    splitManager.setOverlayOpen(isOpen);
    return true;
  });

  // Workspace Controls
  ipcMain.handle('workspace:getState', () => {
    return workspaceManager ? workspaceManager.getState() : null;
  });

  ipcMain.handle('workspace:create', (event, options) => {
    return workspaceManager ? workspaceManager.createWorkspace(options) : null;
  });

  ipcMain.handle('workspace:switch', (event, workspaceId) => {
    if (workspaceManager) workspaceManager.switchWorkspace(workspaceId);
    return workspaceManager ? workspaceManager.getState() : null;
  });

  ipcMain.handle('workspace:update', (event, { workspaceId, name, color, icon }) => {
    return workspaceManager
      ? workspaceManager.updateWorkspace(workspaceId, { name, color, icon })
      : false;
  });

  ipcMain.handle('workspace:delete', (event, { workspaceId, moveTabsToWorkspaceId }) => {
    return workspaceManager
      ? workspaceManager.deleteWorkspace(workspaceId, { moveTabsToWorkspaceId })
      : false;
  });

  ipcMain.handle('workspace:moveTab', (event, { tabId, targetWorkspaceId }) => {
    return workspaceManager
      ? workspaceManager.moveTabToWorkspace(tabId, targetWorkspaceId)
      : false;
  });

  // Privacy & Blocker Controls
  ipcMain.handle('privacy:getStats', () => {
    return privacyManager ? privacyManager.getStats() : null;
  });

  ipcMain.handle('privacy:toggleAdBlocker', (event, enabled) => {
    if (privacyManager) privacyManager.setAdBlockerEnabled(enabled);
    return privacyManager ? privacyManager.adBlockerEnabled : false;
  });

  ipcMain.handle('privacy:addAllowlist', (event, domain) => {
    if (privacyManager) privacyManager.addAllowlist(domain);
    return true;
  });

  ipcMain.handle('privacy:removeAllowlist', (event, domain) => {
    if (privacyManager) privacyManager.removeAllowlist(domain);
    return true;
  });

  ipcMain.handle('privacy:isDomainAllowed', (event, domain) => {
    return privacyManager ? privacyManager.isDomainAllowed(domain) : false;
  });

  // Tab Suspension Controls
  ipcMain.handle('suspender:getSettings', () => {
    return tabSuspender ? tabSuspender.getSettings() : null;
  });

  ipcMain.handle('suspender:updateSettings', (event, options) => {
    return tabSuspender ? tabSuspender.updateSettings(options) : null;
  });

  ipcMain.handle('suspender:suspendTab', async (event, tabId) => {
    return tabSuspender ? await tabSuspender.suspendTab(tabId, true) : false;
  });

  ipcMain.handle('suspender:suspendOthers', async (event, keepTabId) => {
    return tabSuspender ? await tabSuspender.suspendOtherTabs(keepTabId) : 0;
  });

  ipcMain.handle('suspender:unsuspendTab', (event, tabId) => {
    if (tabSuspender) tabSuspender.unsuspendTab(tabId);
    return true;
  });

  ipcMain.handle('suspender:addWhitelist', (event, domain) => {
    if (tabSuspender) tabSuspender.addWhitelist(domain);
    return true;
  });

  ipcMain.handle('suspender:removeWhitelist', (event, domain) => {
    if (tabSuspender) tabSuspender.removeWhitelist(domain);
    return true;
  });

  // Developer Toolkit - API Tester
  ipcMain.handle('apiTester:sendRequest', async (event, options) => {
    return apiTester ? await apiTester.sendRequest(options) : null;
  });

  ipcMain.handle('apiTester:getHistory', () => {
    return apiTester ? apiTester.getHistory() : [];
  });

  ipcMain.handle('apiTester:clearHistory', () => {
    return apiTester ? apiTester.clearHistory() : true;
  });

  ipcMain.handle('apiTester:getCollections', () => {
    return apiTester ? apiTester.getCollections() : {};
  });

  ipcMain.handle('apiTester:saveToCollection', (event, { collectionName, requestData }) => {
    return apiTester ? apiTester.saveToCollection(collectionName, requestData) : null;
  });

  ipcMain.handle('apiTester:deleteFromCollection', (event, { collectionName, requestId }) => {
    return apiTester ? apiTester.deleteFromCollection(collectionName, requestId) : false;
  });

  ipcMain.handle('apiTester:createCollection', (event, name) => {
    return apiTester ? apiTester.createCollection(name) : false;
  });

  ipcMain.handle('apiTester:deleteCollection', (event, name) => {
    return apiTester ? apiTester.deleteCollection(name) : false;
  });

  ipcMain.handle('apiTester:getEnvironment', () => {
    return apiTester ? apiTester.getEnvironment() : {};
  });

  ipcMain.handle('apiTester:saveEnvironment', (event, env) => {
    return apiTester ? apiTester.saveEnvironment(env) : {};
  });

  ipcMain.handle('apiTester:getSettings', () => {
    return apiTester ? apiTester.getSettings() : {};
  });

  ipcMain.handle('apiTester:saveSettings', (event, settings) => {
    return apiTester ? apiTester.saveSettings(settings) : {};
  });

  // Developer Toolkit - Notes
  ipcMain.handle('notes:getWorkspaceNotes', (event, workspaceId) => {
    return notesManager ? notesManager.getWorkspaceNotes(workspaceId) : [];
  });

  ipcMain.handle('notes:saveNote', (event, { workspaceId, note }) => {
    return notesManager ? notesManager.saveNote(workspaceId, note) : null;
  });

  ipcMain.handle('notes:deleteNote', (event, { workspaceId, noteId }) => {
    return notesManager ? notesManager.deleteNote(workspaceId, noteId) : false;
  });

  ipcMain.handle('notes:exportNote', async (event, { title, content }) => {
    return notesManager ? await notesManager.exportNote(mainWindow, title, content) : { success: false };
  });

  ipcMain.handle('tab:getSelectedText', async () => {
    if (!tabManager) return '';
    const activeTab = tabManager.getTab(tabManager.activeTabId);
    if (!activeTab || !activeTab.view || !activeTab.view.webContents) return '';
    try {
      return await activeTab.view.webContents.executeJavaScript('window.getSelection().toString()');
    } catch (e) {
      return '';
    }
  });

  // GPU Feature & Hardware Acceleration Diagnostic (browser://gpu)
  ipcMain.handle('gpu:getInfo', async () => {
    const { app } = require('electron');
    let info = {};
    try {
      info = await app.getGPUInfo('complete');
    } catch (e) {
      info = { error: e.message };
    }
    return {
      status: app.getGPUFeatureStatus(),
      info,
    };
  });

  // AI Assistant (Step 8)
  ipcMain.handle('ai:getSettings', async (event, forceRefresh) => {
    return aiManager ? await aiManager.getPublicSettings(forceRefresh) : null;
  });

  ipcMain.handle('ai:updateSettings', (event, settings) => {
    return aiManager ? aiManager.updateSettings(settings) : null;
  });

  ipcMain.handle('ai:testConnection', async (event, options) => {
    return aiManager ? await aiManager.testConnection(options) : { success: false, message: 'AI Manager not available.' };
  });

  ipcMain.handle('ai:getHistory', (event, workspaceId) => {
    return aiManager ? aiManager.getHistory(workspaceId) : [];
  });

  ipcMain.handle('ai:clearHistory', (event, workspaceId) => {
    return aiManager ? aiManager.clearHistory(workspaceId) : [];
  });

  ipcMain.handle('ai:sendMessage', async (event, options) => {
    try {
      if (!aiManager) throw new Error('AI Manager is not initialized.');
      return await aiManager.sendMessage(options);
    } catch (err) {
      logger.log('IPC:ai:sendMessage', err);
      throw err;
    }
  });

  ipcMain.handle('ai:stopStream', (event, streamId) => {
    return aiManager ? aiManager.stopStream(streamId) : false;
  });

  ipcMain.handle('ai:extractPage', async () => {
    return aiManager ? await aiManager.extractActivePage() : { allowed: false, reason: 'AI Manager not available.' };
  });

  // Diagnostics and DevTools
  ipcMain.handle('window:openDevTools', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.openDevTools({ mode: 'detach' });
    }
  });

  ipcMain.handle('app:logRendererError', (event, errorInfo) => {
    logger.log('Renderer', errorInfo);
  });

  // Proxy / VPN Management (Step 9)
  ipcMain.handle('proxy:getState', () => {
    return proxyManager ? proxyManager.getPublicState() : null;
  });

  ipcMain.handle('proxy:setMode', async (event, { mode, profileId } = {}) => {
    if (!proxyManager) throw new Error('Proxy manager not initialized');
    if (!mode || typeof mode !== 'string') throw new Error('Invalid mode parameter');
    return await proxyManager.setMode(mode, profileId);
  });

  ipcMain.handle('proxy:saveManualProxy', async (event, config) => {
    if (!proxyManager) throw new Error('Proxy manager not initialized');
    return await proxyManager.saveManualProxy(config);
  });

  ipcMain.handle('proxy:saveProfile', async (event, profile) => {
    if (!proxyManager) throw new Error('Proxy manager not initialized');
    return await proxyManager.saveProfile(profile);
  });

  ipcMain.handle('proxy:deleteProfile', async (event, profileId) => {
    if (!proxyManager) throw new Error('Proxy manager not initialized');
    if (!profileId || typeof profileId !== 'string') throw new Error('Invalid profile ID');
    return await proxyManager.deleteProfile(profileId);
  });

  ipcMain.handle('proxy:updateSettings', async (event, settings) => {
    if (!proxyManager) throw new Error('Proxy manager not initialized');
    return await proxyManager.updateSettings(settings);
  });

  ipcMain.handle('proxy:testConnection', async (event, customEndpoint) => {
    if (!proxyManager) throw new Error('Proxy manager not initialized');
    return await proxyManager.testConnection(customEndpoint);
  });

  ipcMain.handle('proxy:resetKillSwitch', async () => {
    if (!proxyManager) throw new Error('Proxy manager not initialized');
    await proxyManager.resetKillSwitch();
    return proxyManager.getPublicState();
  });

  // Settings Management
  ipcMain.handle('settings:get', () => {
    return settingsManager ? settingsManager.getSettings() : {};
  });

  ipcMain.handle('settings:update', (event, updates) => {
    return settingsManager ? settingsManager.updateSettings(updates) : {};
  });

  // History Management
  ipcMain.handle('history:get', (event, { query, limit } = {}) => {
    return historyManager ? historyManager.getHistory(query, limit) : [];
  });

  ipcMain.handle('history:delete', (event, id) => {
    if (!id || typeof id !== 'string') return false;
    return historyManager ? historyManager.deleteEntry(id) : false;
  });

  ipcMain.handle('history:clear', () => {
    return historyManager ? historyManager.clearHistory() : false;
  });

  ipcMain.handle('history:getSuggestions', (event, query) => {
    return historyManager ? historyManager.getSuggestions(query) : [];
  });

  // Bookmarks Management
  ipcMain.handle('bookmarks:get', (event, { folderId, query } = {}) => {
    return bookmarksManager ? bookmarksManager.getBookmarks(folderId, query) : { folders: [], items: [] };
  });

  ipcMain.handle('bookmarks:isBookmarked', (event, url) => {
    return bookmarksManager ? bookmarksManager.isBookmarked(url) : false;
  });

  ipcMain.handle('bookmarks:add', (event, bookmark) => {
    if (!bookmark || !bookmark.url) throw new Error('Invalid bookmark');
    return bookmarksManager ? bookmarksManager.addBookmark(bookmark) : null;
  });

  ipcMain.handle('bookmarks:remove', (event, id) => {
    return bookmarksManager ? bookmarksManager.removeBookmark(id) : false;
  });

  ipcMain.handle('bookmarks:removeByUrl', (event, url) => {
    return bookmarksManager ? bookmarksManager.removeBookmarkByUrl(url) : false;
  });

  ipcMain.handle('bookmarks:update', (event, id, updates) => {
    return bookmarksManager ? bookmarksManager.updateBookmark(id, updates) : null;
  });

  ipcMain.handle('bookmarks:addFolder', (event, name) => {
    return bookmarksManager ? bookmarksManager.addFolder(name) : null;
  });

  ipcMain.handle('bookmarks:deleteFolder', (event, folderId) => {
    return bookmarksManager ? bookmarksManager.deleteFolder(folderId) : false;
  });

  ipcMain.handle('bookmarks:export', () => {
    return bookmarksManager ? bookmarksManager.exportToHtml() : '';
  });

  ipcMain.handle('bookmarks:import', (event, htmlContent) => {
    return bookmarksManager ? bookmarksManager.importFromHtml(htmlContent) : 0;
  });

  ipcMain.handle('bookmarks:getSuggestions', (event, query) => {
    return bookmarksManager ? bookmarksManager.getSuggestions(query) : [];
  });

  // Downloads Management
  ipcMain.handle('downloads:get', (event, query) => {
    return downloadsManager ? downloadsManager.getDownloads(query) : [];
  });

  ipcMain.handle('downloads:pause', (event, id) => {
    return downloadsManager ? downloadsManager.pauseDownload(id) : false;
  });

  ipcMain.handle('downloads:resume', (event, id) => {
    return downloadsManager ? downloadsManager.resumeDownload(id) : false;
  });

  ipcMain.handle('downloads:cancel', (event, id) => {
    return downloadsManager ? downloadsManager.cancelDownload(id) : false;
  });

  ipcMain.handle('downloads:open', async (event, id) => {
    return downloadsManager ? await downloadsManager.openFile(id) : false;
  });

  ipcMain.handle('downloads:showInFolder', (event, id) => {
    return downloadsManager ? downloadsManager.showInFolder(id) : false;
  });

  ipcMain.handle('downloads:clearCompleted', () => {
    return downloadsManager ? downloadsManager.clearCompleted() : [];
  });

  // Permissions Management
  ipcMain.handle('permissions:respond', (event, requestId, decision) => {
    return permissionsManager ? permissionsManager.respondToPrompt(requestId, decision) : false;
  });

  ipcMain.handle('permissions:getAll', () => {
    return permissionsManager ? permissionsManager.getAllPermissions() : {};
  });

  ipcMain.handle('permissions:revoke', (event, origin, permission) => {
    return permissionsManager ? permissionsManager.revokePermission(origin, permission) : false;
  });

  ipcMain.handle('permissions:clearAll', () => {
    return permissionsManager ? permissionsManager.clearAllPermissions() : false;
  });

  // Tab Controls: Reopen Closed, Find, Zoom, Print, FullScreen
  ipcMain.handle('tabs:reopenClosed', () => {
    const tab = tabManager.reopenClosedTab();
    if (!tab) return null;
    return {
      id: tab.id,
      url: tab.url,
      title: tab.title,
      workspaceId: tab.workspaceId,
    };
  });

  ipcMain.handle('tabs:findInPage', (event, tabId, text, forward = true) => {
    const safeText = sanitizeString(text, 500);
    return tabManager.findInPage(tabId, safeText, !!forward);
  });

  ipcMain.handle('tabs:stopFindInPage', (event, tabId, action = 'clearSelection') => {
    tabManager.stopFindInPage(tabId, action);
    return true;
  });

  ipcMain.handle('tabs:setZoom', (event, tabId, factor) => {
    const safeFactor = sanitizeNumber(factor, 0.25, 4.0, 1.0);
    return tabManager.setZoom(tabId, safeFactor);
  });

  ipcMain.handle('tabs:getZoom', (event, tabId) => {
    return tabManager.getZoom(tabId);
  });

  ipcMain.handle('tabs:print', (event, tabId) => {
    return tabManager.print(tabId);
  });

  ipcMain.handle('window:toggleFullScreen', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return false;
    const next = !mainWindow.isFullScreen();
    mainWindow.setFullScreen(next);
    return next;
  });

  // Auto-Updater (Step 10 Part D)
  ipcMain.handle('app:checkForUpdates', async () => {
    return updateManager ? await updateManager.checkForUpdates(true) : { status: 'disabled' };
  });

  ipcMain.handle('app:openDownloadPage', (event, url) => {
    if (updateManager) updateManager.openDownloadPage(url);
    return true;
  });
}

module.exports = setupIpcHandlers;
