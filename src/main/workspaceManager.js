// Workspace Manager - Manages workspaces, tab assignments, split states, and persistence
const path = require('path');
const fs = require('fs');
const { app } = require('electron');

class WorkspaceManager {
  constructor(mainWindow, tabManager, splitManager) {
    this.mainWindow = mainWindow;
    this.tabManager = tabManager;
    this.splitManager = splitManager;

    this.saveFilePath = path.join(app.getPath('userData'), 'workspaces.json');
    this.saveTimeout = null;

    this.workspaces = [];
    this.activeWorkspaceId = null;

    this.onWorkspaceChanged = null;
  }

  /**
   * Initializes workspace state from disk or sets up default "Main" workspace.
   */
  init() {
    this.loadFromDisk();

    // If no workspaces loaded, create default "Main" workspace
    if (!this.workspaces || this.workspaces.length === 0) {
      const defaultWs = {
        id: 'ws-main',
        name: 'Main',
        color: '#3b82f6',
        icon: '💼',
        tabIds: [],
        activeTabId: null,
        splitState: {
          isSplit: false,
          isPickingRight: false,
          leftTabId: null,
          rightTabId: null,
          focusedTabId: null,
          splitRatio: 0.5,
        },
      };
      this.workspaces = [defaultWs];
      this.activeWorkspaceId = defaultWs.id;

      // Spawn initial tab for default workspace
      const tab = this.tabManager.createTab('https://duckduckgo.com', true);
      tab.workspaceId = defaultWs.id;
      defaultWs.tabIds.push(tab.id);
      defaultWs.activeTabId = tab.id;
      this.tabManager.activeTabId = tab.id;
      this.splitManager.setFocusedTab(tab.id);

      this.saveToDisk();
    } else {
      // Restore tabs into tabManager
      this.restoreTabsFromWorkspaces();
    }
  }

  /**
   * Restores tabs across all workspaces, lazily loading non-active tabs.
   */
  restoreTabsFromWorkspaces() {
    const activeWs = this.getActiveWorkspace();
    if (!activeWs) return;

    console.log(`[WorkspaceRestore] Starting restore across ${this.workspaces.length} workspaces. Active workspace: ${activeWs.id} (${activeWs.name})`);

    // Set split manager state to active workspace's state
    if (activeWs.splitState) {
      this.splitManager.isSplit = !!activeWs.splitState.isSplit;
      this.splitManager.leftTabId = activeWs.splitState.leftTabId;
      this.splitManager.rightTabId = activeWs.splitState.rightTabId;
      this.splitManager.focusedTabId = activeWs.splitState.focusedTabId || activeWs.activeTabId;
      this.splitManager.splitRatio = activeWs.splitState.splitRatio || 0.5;
    }

    this.workspaces.forEach((ws) => {
      const isCurrentWs = ws.id === this.activeWorkspaceId;
      const validTabIds = [];

      // Clean up already saved empty New Tab entries & duplicate IDs
      const rawSavedTabs = ws._savedTabs || [];
      const seenIds = new Set();
      const cleanedSavedTabs = [];

      for (const st of rawSavedTabs) {
        if (!st || !st.id) continue;
        if (seenIds.has(st.id)) {
          console.log(`[WorkspaceRestore] Removing duplicate tab ID ${st.id} in workspace "${ws.name}"`);
          continue;
        }

        const rawUrl = (st.url || '').trim();
        const isEmpty = !rawUrl || rawUrl === 'about:blank';
        // Clean up empty New Tab entries if workspace has more than 1 tab
        if (isEmpty && rawSavedTabs.length > 1) {
          console.log(`[WorkspaceRestore] Cleaning up saved empty New Tab placeholder: ${st.id} in "${ws.name}"`);
          continue;
        }

        seenIds.add(st.id);
        cleanedSavedTabs.push({
          ...st,
          url: isEmpty ? 'https://duckduckgo.com' : rawUrl,
        });
      }

      // Ensure ws.activeTabId is valid among cleaned tabs
      if (cleanedSavedTabs.length > 0 && !cleanedSavedTabs.some((t) => t.id === ws.activeTabId)) {
        ws.activeTabId = cleanedSavedTabs[0].id;
      }

      cleanedSavedTabs.forEach((savedTab) => {
        // Only load web page immediately if it is active in the current workspace
        const shouldLoadNow = isCurrentWs && (
          savedTab.id === ws.activeTabId ||
          (ws.splitState && ws.splitState.isSplit && (savedTab.id === ws.splitState.leftTabId || savedTab.id === ws.splitState.rightTabId))
        );

        // Check 1: Active tab must NEVER be restored in suspended state
        const isSuspended = shouldLoadNow ? false : !!savedTab.isSuspended;

        const tab = this.tabManager.createTab(
          savedTab.url || 'https://duckduckgo.com',
          shouldLoadNow,
          !shouldLoadNow,
          isSuspended,
          {
            id: savedTab.id,
            workspaceId: ws.id,
            title: savedTab.title || 'DuckDuckGo',
            favicon: savedTab.favicon || null,
            scrollPosition: savedTab.scrollPosition || { x: 0, y: 0 },
          }
        );

        validTabIds.push(tab.id);
        console.log(`[WorkspaceRestore] Restored tab: ${tab.id} (url: ${tab.url}, ws: "${ws.name}", shouldLoadNow: ${shouldLoadNow}, isSuspended: ${tab.isSuspended})`);
      });

      // If workspace had no valid tabs, create one clean tab
      if (validTabIds.length === 0) {
        const tab = this.tabManager.createTab('https://duckduckgo.com', isCurrentWs, !isCurrentWs, false, {
          workspaceId: ws.id,
          title: 'DuckDuckGo',
        });
        validTabIds.push(tab.id);
        ws.activeTabId = tab.id;
        console.log(`[WorkspaceRestore] Created fresh tab for empty workspace "${ws.name}": ${tab.id}`);
      }

      ws.tabIds = validTabIds;
      delete ws._savedTabs;
    });

    // Ensure active workspace has a valid activeTabId
    if (!activeWs.tabIds.includes(activeWs.activeTabId)) {
      activeWs.activeTabId = activeWs.tabIds[0];
    }
    this.tabManager.activeTabId = activeWs.activeTabId;
    this.splitManager.setFocusedTab(activeWs.activeTabId);

    // Safety net: ensure active tab has a healthy WebContentsView
    this.tabManager.ensureActiveTabView(activeWs.activeTabId);

    // Initial layout application
    this.splitManager.applyLayout();
    console.log(`[WorkspaceRestore] Workspace restore complete. Active tab: ${this.tabManager.activeTabId}`);
  }

  /**
   * Returns current active workspace object.
   */
  getActiveWorkspace() {
    return this.workspaces.find((w) => w.id === this.activeWorkspaceId) || this.workspaces[0];
  }

  /**
   * Switches to another workspace, restoring its active tab and split layout.
   */
  switchWorkspace(workspaceId) {
    if (this.activeWorkspaceId === workspaceId) return;
    const targetWs = this.workspaces.find((w) => w.id === workspaceId);
    if (!targetWs) return;

    console.log(`[WorkspaceSwitch] Switching from workspace "${this.activeWorkspaceId}" to "${workspaceId}" (${targetWs.name})`);

    // 1. Save current workspace's state
    const currentWs = this.getActiveWorkspace();
    if (currentWs) {
      currentWs.splitState = this.splitManager.getState();
      currentWs.activeTabId = this.splitManager.focusedTabId || this.tabManager.activeTabId;
    }

    // 2. Set new active workspace
    this.activeWorkspaceId = workspaceId;

    // 3. Restore split state
    if (targetWs.splitState) {
      this.splitManager.isSplit = !!targetWs.splitState.isSplit;
      this.splitManager.isPickingRight = !!targetWs.splitState.isPickingRight;
      this.splitManager.leftTabId = targetWs.splitState.leftTabId;
      this.splitManager.rightTabId = targetWs.splitState.rightTabId;
      this.splitManager.focusedTabId = targetWs.splitState.focusedTabId || targetWs.activeTabId;
      this.splitManager.splitRatio = targetWs.splitState.splitRatio || 0.5;
    } else {
      this.splitManager.isSplit = false;
      this.splitManager.isPickingRight = false;
    }

    // 4. Activate target tab and awaken if lazy or suspended
    const targetTabId = targetWs.activeTabId || targetWs.tabIds[0];
    this.tabManager.activeTabId = targetTabId;
    this.splitManager.setFocusedTab(targetTabId);

    // Awaken target tab(s)
    this.awakenTabIfNeeded(targetTabId);
    if (this.splitManager.isSplit) {
      if (this.splitManager.leftTabId) this.awakenTabIfNeeded(this.splitManager.leftTabId);
      if (this.splitManager.rightTabId) this.awakenTabIfNeeded(this.splitManager.rightTabId);
    }

    // Safety net: ensure active tab view is created, attached, and sized
    this.tabManager.ensureActiveTabView(targetTabId);

    // 5. Update layout and broadcast
    this.splitManager.applyLayout();
    this.notifyState();
    this.scheduleSave();
  }

  /**
   * Awakens a lazily created or suspended tab by restoring its view and loading its URL.
   */
  awakenTabIfNeeded(tabId) {
    const tab = this.tabManager.getTab(tabId);
    if (!tab) return;
    const isMissingOrDestroyed = !tab.view || !tab.view.webContents || tab.view.webContents.isDestroyed();
    console.log(`[TabWake] Awaken tab if needed: ${tab.id} (url: ${tab.url}, isSuspended: ${tab.isSuspended}, missingView: ${isMissingOrDestroyed})`);

    if (tab.isSuspended || isMissingOrDestroyed) {
      if (this.tabSuspender) {
        this.tabSuspender.unsuspendTab(tabId);
      } else {
        this.tabManager.setupTabView(tab, tab.url);
        tab.isSuspended = false;
        tab.isLazy = false;
        if (this.tabManager.onTabUpdated) this.tabManager.onTabUpdated(tab);
      }
    } else if (tab.isLazy) {
      tab.isLazy = false;
      if (tab.view && tab.view.webContents) {
        tab.view.webContents.loadURL(tab.url).catch(() => {});
      }
    }
  }

  /**
   * Creates a new workspace and switches to it.
   */
  createWorkspace({ name, color, icon }) {
    const wsId = `ws-${Date.now()}`;
    const newWs = {
      id: wsId,
      name: name || `Workspace ${this.workspaces.length + 1}`,
      color: color || '#3b82f6',
      icon: icon || '💼',
      tabIds: [],
      activeTabId: null,
      splitState: {
        isSplit: false,
        isPickingRight: false,
        leftTabId: null,
        rightTabId: null,
        focusedTabId: null,
        splitRatio: 0.5,
      },
    };

    // Create a fresh tab for the new workspace
    const tab = this.tabManager.createTab('https://duckduckgo.com', false);
    tab.workspaceId = wsId;
    newWs.tabIds.push(tab.id);
    newWs.activeTabId = tab.id;

    this.workspaces.push(newWs);
    this.switchWorkspace(wsId);
    return newWs;
  }

  /**
   * Updates properties (name, color, icon) of an existing workspace.
   */
  updateWorkspace(workspaceId, { name, color, icon }) {
    const ws = this.workspaces.find((w) => w.id === workspaceId);
    if (!ws) return false;

    if (name) ws.name = name;
    if (color) ws.color = color;
    if (icon) ws.icon = icon;

    this.notifyState();
    this.scheduleSave();
    return true;
  }

  /**
   * Deletes a workspace with choice to move tabs or close them. Cannot delete last workspace.
   */
  deleteWorkspace(workspaceId, { moveTabsToWorkspaceId } = {}) {
    if (this.workspaces.length <= 1) return false; // Prevent deleting the last workspace

    const wsIndex = this.workspaces.findIndex((w) => w.id === workspaceId);
    if (wsIndex === -1) return false;

    const [deletedWs] = this.workspaces.splice(wsIndex, 1);

    // Handle open tabs in deleted workspace
    if (moveTabsToWorkspaceId) {
      const targetWs = this.workspaces.find((w) => w.id === moveTabsToWorkspaceId);
      if (targetWs) {
        deletedWs.tabIds.forEach((tabId) => {
          const tab = this.tabManager.getTab(tabId);
          if (tab) {
            tab.workspaceId = targetWs.id;
            targetWs.tabIds.push(tabId);
          }
        });
      }
    } else {
      // Close tabs in deleted workspace
      deletedWs.tabIds.forEach((tabId) => {
        this.tabManager.closeTab(tabId);
      });
    }

    // If the active workspace was deleted, switch to another
    if (this.activeWorkspaceId === workspaceId) {
      const fallbackWs = this.workspaces[Math.min(wsIndex, this.workspaces.length - 1)];
      this.switchWorkspace(fallbackWs.id);
    } else {
      this.notifyState();
      this.scheduleSave();
    }

    return true;
  }

  /**
   * Moves a tab from its current workspace to a target workspace.
   */
  moveTabToWorkspace(tabId, targetWorkspaceId) {
    const targetWs = this.workspaces.find((w) => w.id === targetWorkspaceId);
    const sourceWs = this.workspaces.find((w) => w.tabIds.includes(tabId));

    if (!targetWs || !sourceWs || sourceWs.id === targetWorkspaceId) return false;

    // Remove from source workspace
    sourceWs.tabIds = sourceWs.tabIds.filter((id) => id !== tabId);

    // If tab was involved in source workspace's split view, exit split view
    if (sourceWs.splitState && (sourceWs.splitState.leftTabId === tabId || sourceWs.splitState.rightTabId === tabId)) {
      sourceWs.splitState.isSplit = false;
      sourceWs.splitState.leftTabId = null;
      sourceWs.splitState.rightTabId = null;
    }

    // If source workspace has no tabs left, automatically open a fresh tab
    if (sourceWs.tabIds.length === 0) {
      const freshTab = this.tabManager.createTab('https://duckduckgo.com', false);
      freshTab.workspaceId = sourceWs.id;
      sourceWs.tabIds.push(freshTab.id);
      sourceWs.activeTabId = freshTab.id;
    } else if (sourceWs.activeTabId === tabId) {
      sourceWs.activeTabId = sourceWs.tabIds[0];
    }

    // Add to target workspace
    const tab = this.tabManager.getTab(tabId);
    if (tab) {
      tab.workspaceId = targetWorkspaceId;
      targetWs.tabIds.push(tabId);
    }

    // If we moved the active tab of current workspace, switch active tab
    if (sourceWs.id === this.activeWorkspaceId) {
      this.tabManager.activeTabId = sourceWs.activeTabId;
      this.splitManager.setFocusedTab(sourceWs.activeTabId);
      this.splitManager.applyLayout();
    }

    this.notifyState();
    this.scheduleSave();
    return true;
  }

  /**
   * Associates a new tab with the currently active workspace.
   */
  registerTab(tabId) {
    const activeWs = this.getActiveWorkspace();
    if (activeWs && !activeWs.tabIds.includes(tabId)) {
      activeWs.tabIds.push(tabId);
      activeWs.activeTabId = tabId;
      this.scheduleSave();
    }
  }

  /**
   * Removes a tab from its workspace upon closure.
   */
  unregisterTab(tabId) {
    this.workspaces.forEach((ws) => {
      ws.tabIds = ws.tabIds.filter((id) => id !== tabId);
      if (ws.tabIds.length === 0 && ws.id === this.activeWorkspaceId) {
        // Automatically create a new tab if current workspace becomes empty
        const freshTab = this.tabManager.createTab('https://duckduckgo.com', true);
        freshTab.workspaceId = ws.id;
        ws.tabIds.push(freshTab.id);
        ws.activeTabId = freshTab.id;
      } else if (ws.activeTabId === tabId && ws.tabIds.length > 0) {
        ws.activeTabId = ws.tabIds[ws.tabIds.length - 1];
      }
    });
    this.scheduleSave();
  }

  /**
   * Serializes state to JSON for IPC sync with UI.
   */
  getState() {
    return {
      activeWorkspaceId: this.activeWorkspaceId,
      workspaces: this.workspaces.map((ws) => ({
        id: ws.id,
        name: ws.name,
        color: ws.color,
        icon: ws.icon,
        activeTabId: ws.activeTabId,
        tabIds: [...ws.tabIds],
        tabCount: ws.tabIds.length,
      })),
    };
  }

  notifyState() {
    if (this.onWorkspaceChanged) {
      this.onWorkspaceChanged(this.getState());
    }
  }

  /**
   * Debounced save to disk.
   */
  scheduleSave() {
    clearTimeout(this.saveTimeout);
    this.saveTimeout = setTimeout(() => {
      this.saveToDisk();
    }, 1000);
  }

  /**
   * Saves workspaces and tabs to disk.
   */
  saveToDisk() {
    try {
      const data = {
        activeWorkspaceId: this.activeWorkspaceId,
        workspaces: this.workspaces.map((ws) => {
          // If this is active workspace, sync live split state
          const splitState = ws.id === this.activeWorkspaceId
            ? this.splitManager.getState()
            : ws.splitState;

          const currentActiveTabId = ws.id === this.activeWorkspaceId
            ? (this.splitManager.focusedTabId || this.tabManager.activeTabId)
            : ws.activeTabId;

          const seenIds = new Set();
          const validTabs = [];

          for (const id of ws.tabIds) {
            if (seenIds.has(id)) continue;
            const t = this.tabManager.getTab(id);
            if (!t) continue;

            const url = (t.url || '').trim();
            const isEmpty = !url || url === 'about:blank';
            // Do not persist empty New Tab entries if the workspace has other tabs
            if (isEmpty && ws.tabIds.length > 1) {
              continue;
            }

            seenIds.add(id);

            // Active tab of active workspace should never be saved as suspended
            const isSuspended = (ws.id === this.activeWorkspaceId && id === currentActiveTabId)
              ? false
              : !!t.isSuspended;

            validTabs.push({
              id: t.id,
              url: isEmpty ? 'https://duckduckgo.com' : t.url,
              title: t.title || 'New Tab',
              favicon: t.favicon,
              isSuspended,
              scrollPosition: t.scrollPosition || { x: 0, y: 0 },
            });
          }

          // Ensure activeTabId references an existing tab
          let resolvedActiveTabId = currentActiveTabId;
          if (!validTabs.some((t) => t.id === resolvedActiveTabId)) {
            resolvedActiveTabId = validTabs[0] ? validTabs[0].id : null;
          }

          return {
            id: ws.id,
            name: ws.name,
            color: ws.color,
            icon: ws.icon,
            activeTabId: resolvedActiveTabId,
            splitState: splitState,
            tabs: validTabs,
          };
        }),
      };

      fs.writeFileSync(this.saveFilePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (err) {
      console.error('Failed to save workspaces to disk:', err);
    }
  }

  /**
   * Loads workspaces and tabs from disk with fallback handling.
   */
  loadFromDisk() {
    try {
      if (fs.existsSync(this.saveFilePath)) {
        const content = fs.readFileSync(this.saveFilePath, 'utf-8');
        const parsed = JSON.parse(content);

        if (parsed && Array.isArray(parsed.workspaces) && parsed.workspaces.length > 0) {
          this.activeWorkspaceId = parsed.activeWorkspaceId || parsed.workspaces[0].id;
          this.workspaces = parsed.workspaces.map((ws) => ({
            id: ws.id,
            name: ws.name || 'Workspace',
            color: ws.color || '#3b82f6',
            icon: ws.icon || '💼',
            tabIds: [],
            activeTabId: ws.activeTabId || null,
            splitState: ws.splitState || { isSplit: false, splitRatio: 0.5 },
            _savedTabs: ws.tabs || [],
          }));
          return;
        }
      }
    } catch (err) {
      console.warn('Could not read workspaces.json or file corrupt, starting fresh:', err);
    }

    this.workspaces = [];
    this.activeWorkspaceId = null;
  }
}

module.exports = WorkspaceManager;
