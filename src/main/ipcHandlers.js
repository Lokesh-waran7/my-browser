// IPC Handlers - Bridges UI renderer commands with main process managers
const { ipcMain } = require('electron');

function setupIpcHandlers(
  mainWindow,
  tabManager,
  splitManager,
  workspaceManager,
  privacyManager,
  tabSuspender,
  apiTester,
  notesManager
) {
  // Tab Management
  ipcMain.handle('tab:create', (event, url, activate) => {
    const tab = tabManager.createTab(url, activate !== false);
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
    tabManager.navigate(tabId, url);
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
}

module.exports = setupIpcHandlers;
