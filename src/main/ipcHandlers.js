// IPC Handlers - Bridges UI renderer commands with main process managers
const { ipcMain } = require('electron');

function setupIpcHandlers(mainWindow, tabManager, splitManager) {
  // Tab Management
  ipcMain.handle('tab:create', (event, url, activate) => {
    const tab = tabManager.createTab(url, activate !== false);
    return {
      id: tab.id,
      url: tab.url,
      title: tab.title,
      favicon: tab.favicon,
    };
  });

  ipcMain.handle('tab:close', (event, tabId) => {
    return tabManager.closeTab(tabId);
  });

  ipcMain.handle('tab:switch', (event, tabId) => {
    if (splitManager.isSplit) {
      // If clicking a tab already in split, focus its pane
      if (splitManager.leftTabId === tabId || splitManager.rightTabId === tabId) {
        splitManager.setFocusedTab(tabId);
      } else {
        // Replace current focused pane's tab with this tab
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

  // Split View Controls
  ipcMain.handle('split:toggle', () => {
    if (splitManager.isSplit) {
      splitManager.closeSplit();
    } else {
      const activeId = tabManager.activeTabId || splitManager.focusedTabId;
      splitManager.startSplit(activeId);
    }
    return splitManager.getState();
  });

  ipcMain.handle('split:setRightTab', (event, tabId) => {
    splitManager.setRightTab(tabId);
    return splitManager.getState();
  });

  ipcMain.handle('split:close', (event, keepTabId) => {
    splitManager.closeSplit(keepTabId);
    return splitManager.getState();
  });

  ipcMain.handle('split:swap', () => {
    splitManager.swapPanes();
    return splitManager.getState();
  });

  ipcMain.handle('split:setFocused', (event, tabId) => {
    splitManager.setFocusedTab(tabId);
    return splitManager.getState();
  });

  ipcMain.handle('split:getState', () => {
    return splitManager.getState();
  });

  // Layout bounds synchronization
  ipcMain.handle('layout:updateBounds', (event, bounds) => {
    splitManager.updateLayoutBounds(bounds);
    return true;
  });
}

module.exports = setupIpcHandlers;
