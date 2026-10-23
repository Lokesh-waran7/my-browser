// Coder Browser - Step 4: Workspaces, Split View & Tabs Management

// DOM Elements: Sidebar & Workspaces
const sidebar = document.getElementById('sidebar');
const btnToggleSidebar = document.getElementById('btn-toggle-sidebar');
const currentWorkspaceName = document.getElementById('current-workspace-name');
const workspaceList = document.getElementById('workspace-list');
const btnNewWorkspace = document.getElementById('btn-new-workspace');
const btnNewTab = document.getElementById('btn-new-tab');
const tabList = document.getElementById('tab-list');

// Toolbar Elements
const btnBack = document.getElementById('btn-back');
const btnForward = document.getElementById('btn-forward');
const btnReload = document.getElementById('btn-reload');
const urlForm = document.getElementById('url-form');
const urlInput = document.getElementById('url-input');
const securityIcon = document.getElementById('security-icon');

// Split View Elements
const btnSplitToggle = document.getElementById('btn-split-toggle');
const btnSwapPanes = document.getElementById('btn-swap-panes');
const btnCloseSplit = document.getElementById('btn-close-split');

const viewArea = document.getElementById('view-area');
const viewMountSingle = document.getElementById('view-mount-single');
const splitContainer = document.getElementById('split-container');
const paneLeft = document.getElementById('pane-left');
const paneRight = document.getElementById('pane-right');
const viewMountLeft = document.getElementById('view-mount-left');
const viewMountRight = document.getElementById('view-mount-right');
const splitDivider = document.getElementById('split-divider');

const headerLeft = document.getElementById('header-left');
const headerRight = document.getElementById('header-right');
const faviconLeft = document.getElementById('favicon-left');
const faviconRight = document.getElementById('favicon-right');
const titleLeft = document.getElementById('title-left');
const titleRight = document.getElementById('title-right');

const tabPicker = document.getElementById('tab-picker');
const pickerTabList = document.getElementById('picker-tab-list');
const btnPickerNewTab = document.getElementById('btn-picker-new-tab');
const btnPickerCancel = document.getElementById('btn-picker-cancel');

const crashBanner = document.getElementById('crash-banner');
const btnReloadCrash = document.getElementById('btn-reload-crash');

// Workspace Modals & Context Menus
const workspaceModal = document.getElementById('workspace-modal');
const wsModalTitle = document.getElementById('ws-modal-title');
const wsNameInput = document.getElementById('ws-name-input');
const wsIconInput = document.getElementById('ws-icon-input');
const wsColorPalette = document.getElementById('ws-color-palette');
const btnWsCancel = document.getElementById('btn-ws-cancel');
const btnWsSave = document.getElementById('btn-ws-save');

const deleteWorkspaceModal = document.getElementById('delete-workspace-modal');
const deleteWsMessage = document.getElementById('delete-ws-message');
const deleteWsTargetSelect = document.getElementById('delete-ws-target-select');
const btnDeleteWsCancel = document.getElementById('btn-delete-ws-cancel');
const btnDeleteWsConfirm = document.getElementById('btn-delete-ws-confirm');

const workspaceContextMenu = document.getElementById('workspace-context-menu');
const ctxWsEdit = document.getElementById('ctx-ws-edit');
const ctxWsDelete = document.getElementById('ctx-ws-delete');

const tabContextMenu = document.getElementById('tab-context-menu');
const tabCtxWsList = document.getElementById('tab-ctx-ws-list');
const tabCtxSuspendNow = document.getElementById('tab-ctx-suspend-now');
const tabCtxSuspendOthers = document.getElementById('tab-ctx-suspend-others');
const tabCtxToggleWhitelist = document.getElementById('tab-ctx-toggle-whitelist');
const tabCtxWhitelistText = document.getElementById('tab-ctx-whitelist-text');
const tabCtxClose = document.getElementById('tab-ctx-close');

// Memory Dashboard Elements
const btnMemoryDashboard = document.getElementById('btn-memory-dashboard');
const memoryModal = document.getElementById('memory-modal');
const btnCloseMemory = document.getElementById('btn-close-memory');
const btnDoneMemory = document.getElementById('btn-done-memory');
const memAppTotal = document.getElementById('mem-app-total');
const memRamSaved = document.getElementById('mem-ram-saved');
const memTabCounts = document.getElementById('mem-tab-counts');
const memSystemFree = document.getElementById('mem-system-free');
const suspenderEnabledToggle = document.getElementById('suspender-enabled-toggle');
const suspenderIdleInput = document.getElementById('suspender-idle-input');
const btnSuspendAllBackground = document.getElementById('btn-suspend-all-background');
const memoryTabTbody = document.getElementById('memory-tab-tbody');
let memoryRefreshInterval = null;

// Developer Toolkit Panel Instance
let toolkitPanel = null;
if (window.ToolkitPanel) {
  toolkitPanel = new window.ToolkitPanel({
    onBoundsChange: () => sendLayoutBounds(),
    getTargetTab: () => getTargetTab(),
    getActiveWorkspaceId: () => activeWorkspaceId,
    showOverlay: (el) => showOverlay(el),
    hideOverlay: (el) => hideOverlay(el),
  });
}

// Application State
let workspaces = [];
let activeWorkspaceId = null;
let tabs = [];
let activeTabId = null;
let splitState = {
  isSplit: false,
  isPickingRight: false,
  leftTabId: null,
  rightTabId: null,
  focusedTabId: null,
  splitRatio: 0.5,
};
let crashedTabId = null;

// Modal & Context State
let editingWorkspaceId = null;
let targetContextWorkspaceId = null;
let targetContextTabId = null;
let selectedColor = '#3b82f6';

const COLOR_PRESETS = [
  '#3b82f6', '#8b5cf6', '#10b981', '#f59e0b',
  '#f43f5e', '#06b6d4', '#ec4899', '#84cc16'
];

/**
 * Returns active workspace data object.
 */
function getActiveWorkspace() {
  return workspaces.find((w) => w.id === activeWorkspaceId) || workspaces[0];
}

/**
 * Returns tabs that belong to the active workspace.
 */
function getActiveWorkspaceTabs() {
  const activeWs = getActiveWorkspace();
  if (!activeWs) return [];
  return tabs.filter((t) => t.workspaceId === activeWs.id || (activeWs.tabIds && activeWs.tabIds.includes(t.id)));
}

/**
 * Normalizes input text into a valid URL or search engine query.
 */
function normalizeUrl(input) {
  const trimmed = input.trim();
  if (!trimmed) return 'https://duckduckgo.com';

  if (/^https?:\/\//i.test(trimmed) || /^file:\/\//i.test(trimmed)) {
    return trimmed;
  }
  if (/^localhost(:\d+)?/i.test(trimmed) || /^\d{1,3}(\.\d{1,3}){3}(:\d+)?/.test(trimmed)) {
    return `http://${trimmed}`;
  }
  if (/^[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)+/i.test(trimmed) && !trimmed.includes(' ')) {
    return `https://${trimmed}`;
  }
  return `https://duckduckgo.com/?q=${encodeURIComponent(trimmed)}`;
}

/**
 * Returns the currently active/focused tab object.
 */
function getTargetTab() {
  const targetId = splitState.isSplit ? splitState.focusedTabId : activeTabId;
  return tabs.find((t) => t.id === targetId) || getActiveWorkspaceTabs()[0] || tabs[0];
}

/**
 * Sends DOM bounding rectangles to main process to align WebContentsViews.
 */
function sendLayoutBounds() {
  const singleRect = viewMountSingle.getBoundingClientRect();
  const leftRect = viewMountLeft.getBoundingClientRect();
  const rightRect = viewMountRight.getBoundingClientRect();

  window.browserAPI.updateLayoutBounds({
    viewArea: {
      x: singleRect.left,
      y: singleRect.top,
      width: singleRect.width,
      height: singleRect.height,
    },
    leftPane: {
      x: leftRect.left,
      y: leftRect.top,
      width: leftRect.width,
      height: leftRect.height,
    },
    rightPane: {
      x: rightRect.left,
      y: rightRect.top,
      width: rightRect.width,
      height: rightRect.height,
    },
    splitRatio: splitState.splitRatio,
  });
}

/**
 * Updates UI controls (address bar, security icon, navigation buttons).
 */
function updateToolbar() {
  const targetTab = getTargetTab();
  if (!targetTab) return;

  urlInput.value = targetTab.url || '';

  // Protocol security badge
  if (targetTab.url && targetTab.url.startsWith('https://')) {
    securityIcon.textContent = '🔒';
    securityIcon.title = 'Secure connection (HTTPS)';
  } else if (targetTab.url && targetTab.url.startsWith('http://')) {
    securityIcon.textContent = '⚠️';
    securityIcon.title = 'Insecure connection (HTTP)';
  } else {
    securityIcon.textContent = '🌐';
    securityIcon.title = 'Local or internal page';
  }

  // Navigation button states
  btnBack.disabled = !targetTab.canGoBack;
  btnForward.disabled = !targetTab.canGoForward;

  // Reload / Stop button
  if (targetTab.isLoading) {
    btnReload.title = 'Stop';
    btnReload.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <line x1="18" y1="6" x2="6" y2="18"></line>
        <line x1="6" y1="6" x2="18" y2="18"></line>
      </svg>
    `;
  } else {
    btnReload.title = 'Reload';
    btnReload.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="23 4 23 10 17 10"></polyline>
        <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
      </svg>
    `;
  }

  // Split view button state
  const wsTabs = getActiveWorkspaceTabs();
  if (wsTabs.length <= 1 && !splitState.isSplit) {
    btnSplitToggle.disabled = true;
    btnSplitToggle.title = 'Open at least 2 tabs in this workspace to enable Split View';
  } else {
    btnSplitToggle.disabled = false;
    btnSplitToggle.title = splitState.isSplit
      ? 'Exit Split View (Ctrl+Shift+S)'
      : 'Split View (Ctrl+Shift+S)';
  }

  // Crash banner visibility
  if (targetTab.isCrashed) {
    crashedTabId = targetTab.id;
    crashBanner.classList.remove('hidden');
  } else {
    crashBanner.classList.add('hidden');
  }
}

/**
 * Renders workspace switcher icons at the top of the sidebar.
 */
function renderWorkspaceSwitcher() {
  workspaceList.innerHTML = '';

  workspaces.forEach((ws, index) => {
    const item = document.createElement('div');
    item.className = 'workspace-item';
    item.id = `ws-btn-${ws.id}`;
    item.style.setProperty('--ws-color', ws.color || '#3b82f6');
    item.title = `${ws.name} (Ctrl+${index + 1})`;
    item.textContent = ws.icon || '💼';

    if (ws.id === activeWorkspaceId) {
      item.classList.add('active');
    }

    // Color indicator dot
    const dot = document.createElement('div');
    dot.className = 'workspace-dot';
    item.appendChild(dot);

    // Switch workspace on click
    item.addEventListener('click', () => {
      window.browserAPI.switchWorkspace(ws.id);
    });

    // Right-click context menu
    item.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showWorkspaceContextMenu(ws.id, e.clientX, e.clientY);
    });

    // Drag-and-drop: Tab drop target
    item.addEventListener('dragover', (e) => {
      e.preventDefault();
      item.classList.add('drag-over');
    });

    item.addEventListener('dragleave', () => {
      item.classList.remove('drag-over');
    });

    item.addEventListener('drop', (e) => {
      e.preventDefault();
      item.classList.remove('drag-over');
      const tabId = e.dataTransfer.getData('text/plain');
      if (tabId) {
        window.browserAPI.moveTabToWorkspace({ tabId, targetWorkspaceId: ws.id });
      }
    });

    workspaceList.appendChild(item);
  });

  const activeWs = getActiveWorkspace();
  if (activeWs) {
    currentWorkspaceName.textContent = activeWs.name || 'Tabs';
  }
}

/**
 * Renders vertical tabs belonging strictly to the active workspace.
 */
function renderSidebarTabs() {
  tabList.innerHTML = '';
  const currentFocusedId = splitState.isSplit ? splitState.focusedTabId : activeTabId;
  const currentTabs = getActiveWorkspaceTabs();

  currentTabs.forEach((tab) => {
    const tabEl = document.createElement('div');
    tabEl.className = 'tab-item';
    tabEl.draggable = true;
    if (tab.id === currentFocusedId) {
      tabEl.classList.add('active');
    }

    // Drag start / end
    tabEl.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', tab.id);
      tabEl.classList.add('dragging');
    });

    tabEl.addEventListener('dragend', () => {
      tabEl.classList.remove('dragging');
    });

    // Right-click context menu for tab
    tabEl.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showTabContextMenu(tab.id, e.clientX, e.clientY);
    });

    // Favicon
    const faviconSpan = document.createElement('span');
    faviconSpan.className = 'tab-favicon';
    if (tab.favicon) {
      faviconSpan.innerHTML = `<img src="${tab.favicon}" alt="" onerror="this.outerHTML='🌐'" />`;
    } else {
      faviconSpan.textContent = '🌐';
    }

    // Title
    const titleSpan = document.createElement('span');
    titleSpan.className = 'tab-title';
    titleSpan.textContent = tab.title || 'New Tab';
    titleSpan.title = tab.title || 'New Tab';

    tabEl.appendChild(faviconSpan);
    tabEl.appendChild(titleSpan);

    // Sleep indicator badge if tab is suspended
    if (tab.isSuspended) {
      tabEl.classList.add('suspended');
      const sleepBadge = document.createElement('span');
      sleepBadge.className = 'tab-sleep-badge';
      sleepBadge.textContent = '💤';
      sleepBadge.title = 'Suspended to save RAM. Click to reload.';
      tabEl.appendChild(sleepBadge);
    }

    // Split indicator badge
    if (splitState.isSplit) {
      if (tab.id === splitState.leftTabId) {
        const badge = document.createElement('span');
        badge.className = 'tab-split-badge';
        badge.textContent = '◫ Left';
        badge.title = 'Currently in left split pane';
        tabEl.appendChild(badge);
      } else if (tab.id === splitState.rightTabId) {
        const badge = document.createElement('span');
        badge.className = 'tab-split-badge';
        badge.textContent = '◫ Right';
        badge.title = 'Currently in right split pane';
        tabEl.appendChild(badge);
      }
    }

    // Close button
    const closeBtn = document.createElement('button');
    closeBtn.className = 'tab-close-btn';
    closeBtn.title = 'Close tab';
    closeBtn.innerHTML = '&times;';
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      window.browserAPI.closeTab(tab.id);
    });

    tabEl.appendChild(closeBtn);

    // Click to switch
    tabEl.addEventListener('click', () => {
      window.browserAPI.switchTab(tab.id);
    });

    tabList.appendChild(tabEl);
  });
}

/**
 * Updates split view panes, headers, divider ratio, and tab picker.
 */
function renderSplitLayout() {
  if (splitState.isSplit) {
    document.body.classList.add('in-split-mode');
    btnSplitToggle.classList.add('active');
    viewMountSingle.classList.add('hidden');
    splitContainer.classList.remove('hidden');

    const ratio = splitState.splitRatio || 0.5;
    paneLeft.style.width = `calc(${ratio * 100}% - 4px)`;
    paneRight.style.width = `calc(${(1 - ratio) * 100}% - 4px)`;

    paneLeft.classList.toggle('focused', splitState.focusedTabId === splitState.leftTabId);
    paneRight.classList.toggle('focused', splitState.focusedTabId === splitState.rightTabId);

    const leftTab = tabs.find((t) => t.id === splitState.leftTabId);
    if (leftTab) {
      titleLeft.textContent = leftTab.title || 'Left Pane';
      titleLeft.title = leftTab.title || 'Left Pane';
      faviconLeft.innerHTML = leftTab.favicon
        ? `<img src="${leftTab.favicon}" alt="" onerror="this.outerHTML='🌐'" />`
        : '🌐';
    }

    const rightTab = tabs.find((t) => t.id === splitState.rightTabId);
    if (splitState.isPickingRight) {
      titleRight.textContent = 'Select Tab...';
      faviconRight.textContent = '◫';
      tabPicker.classList.remove('hidden');
      renderTabPicker();
    } else {
      tabPicker.classList.add('hidden');
      if (rightTab) {
        titleRight.textContent = rightTab.title || 'Right Pane';
        titleRight.title = rightTab.title || 'Right Pane';
        faviconRight.innerHTML = rightTab.favicon
          ? `<img src="${rightTab.favicon}" alt="" onerror="this.outerHTML='🌐'" />`
          : '🌐';
      }
    }
  } else {
    document.body.classList.remove('in-split-mode');
    btnSplitToggle.classList.remove('active');
    viewMountSingle.classList.remove('hidden');
    splitContainer.classList.add('hidden');
    tabPicker.classList.add('hidden');
  }

  sendLayoutBounds();
}

/**
 * Renders tab candidates for the right pane in split mode.
 */
function renderTabPicker() {
  pickerTabList.innerHTML = '';
  const currentWsTabs = getActiveWorkspaceTabs();
  const candidateTabs = currentWsTabs.filter((t) => t.id !== splitState.leftTabId);

  if (candidateTabs.length === 0) {
    const emptyMsg = document.createElement('div');
    emptyMsg.style.fontSize = '12px';
    emptyMsg.style.color = '#71717a';
    emptyMsg.style.padding = '8px 0';
    emptyMsg.textContent = 'No other tabs open in this workspace. Click "+ Open New Tab" below:';
    pickerTabList.appendChild(emptyMsg);
  } else {
    candidateTabs.forEach((tab) => {
      const item = document.createElement('div');
      item.className = 'picker-tab-item';

      const icon = document.createElement('span');
      icon.className = 'tab-favicon';
      icon.innerHTML = tab.favicon
        ? `<img src="${tab.favicon}" alt="" onerror="this.outerHTML='🌐'" />`
        : '🌐';

      const title = document.createElement('span');
      title.className = 'tab-title';
      title.textContent = tab.title || 'New Tab';

      item.appendChild(icon);
      item.appendChild(title);

      item.addEventListener('click', () => {
        window.browserAPI.setSplitRightTab(tab.id);
      });

      pickerTabList.appendChild(item);
    });
  }
}

// Reusable Overlay Helpers: Hide/Restore WebContentsViews for all current & future modals/menus
function updateOverlayVisibility() {
  const hasOpenOverlay = !!document.querySelector(
    '.modal-backdrop:not(.hidden), .context-menu:not(.hidden), .popup:not(.hidden), .dropdown-menu:not(.hidden)'
  );
  window.browserAPI.setOverlayOpen(hasOpenOverlay);
}

function showOverlay(element) {
  if (!element) return;
  element.classList.remove('hidden');
  updateOverlayVisibility();
}

function hideOverlay(element) {
  if (!element) return;
  element.classList.add('hidden');
  updateOverlayVisibility();
}

// Workspace Modal Initialization
function initColorPalette() {
  wsColorPalette.innerHTML = '';
  COLOR_PRESETS.forEach((color) => {
    const swatch = document.createElement('div');
    swatch.className = 'color-swatch';
    swatch.style.backgroundColor = color;
    if (color === selectedColor) swatch.classList.add('active');

    swatch.addEventListener('click', () => {
      selectedColor = color;
      document.querySelectorAll('.color-swatch').forEach((s) => s.classList.remove('active'));
      swatch.classList.add('active');
    });

    wsColorPalette.appendChild(swatch);
  });
}

function openWorkspaceModal(wsToEdit = null) {
  hideContextMenus();
  editingWorkspaceId = wsToEdit ? wsToEdit.id : null;
  wsModalTitle.textContent = wsToEdit ? 'Edit Workspace' : 'New Workspace';
  wsNameInput.value = wsToEdit ? wsToEdit.name : '';
  wsIconInput.value = wsToEdit ? wsToEdit.icon : '💼';
  selectedColor = wsToEdit ? wsToEdit.color : '#3b82f6';
  initColorPalette();

  showOverlay(workspaceModal);
  wsNameInput.focus();
}

function closeWorkspaceModal() {
  hideOverlay(workspaceModal);
  editingWorkspaceId = null;
}

// Dismiss modal when clicking backdrop outside card
workspaceModal.addEventListener('click', (e) => {
  if (e.target === workspaceModal) closeWorkspaceModal();
});

// Emoji presets in modal
document.querySelectorAll('.emoji-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    wsIconInput.value = btn.textContent;
  });
});

btnWsCancel.addEventListener('click', closeWorkspaceModal);

btnWsSave.addEventListener('click', async () => {
  const name = wsNameInput.value.trim() || 'Workspace';
  const icon = wsIconInput.value.trim() || '💼';
  const color = selectedColor;

  if (editingWorkspaceId) {
    await window.browserAPI.updateWorkspace({ workspaceId: editingWorkspaceId, name, color, icon });
  } else {
    await window.browserAPI.createWorkspace({ name, color, icon });
  }
  closeWorkspaceModal();
});

btnNewWorkspace.addEventListener('click', () => {
  openWorkspaceModal(null);
});

// Delete Workspace Modal
function openDeleteWorkspaceModal(wsId) {
  hideContextMenus();
  if (workspaces.length <= 1) {
    alert('Cannot delete the last remaining workspace.');
    return;
  }

  const targetWs = workspaces.find((w) => w.id === wsId);
  if (!targetWs) return;

  targetContextWorkspaceId = wsId;
  deleteWsMessage.textContent = `Are you sure you want to delete workspace "${targetWs.name}"?`;

  // Populate other workspaces into target dropdown
  deleteWsTargetSelect.innerHTML = '';
  workspaces
    .filter((w) => w.id !== wsId)
    .forEach((w) => {
      const opt = document.createElement('option');
      opt.value = w.id;
      opt.textContent = `${w.icon} ${w.name}`;
      deleteWsTargetSelect.appendChild(opt);
    });

  showOverlay(deleteWorkspaceModal);
}

function closeDeleteWorkspaceModal() {
  hideOverlay(deleteWorkspaceModal);
  targetContextWorkspaceId = null;
}

deleteWorkspaceModal.addEventListener('click', (e) => {
  if (e.target === deleteWorkspaceModal) closeDeleteWorkspaceModal();
});

btnDeleteWsCancel.addEventListener('click', closeDeleteWorkspaceModal);

btnDeleteWsConfirm.addEventListener('click', async () => {
  if (!targetContextWorkspaceId) return;

  const action = document.querySelector('input[name="delete-action"]:checked').value;
  const moveTabsToWorkspaceId = action === 'move' ? deleteWsTargetSelect.value : null;

  await window.browserAPI.deleteWorkspace({
    workspaceId: targetContextWorkspaceId,
    moveTabsToWorkspaceId,
  });

  closeDeleteWorkspaceModal();
});

// Context Menus
function hideContextMenus() {
  hideOverlay(workspaceContextMenu);
  hideOverlay(tabContextMenu);
}

document.addEventListener('click', hideContextMenus);

function showWorkspaceContextMenu(wsId, x, y) {
  hideContextMenus();
  targetContextWorkspaceId = wsId;

  // Disable delete option if last workspace
  if (workspaces.length <= 1) {
    ctxWsDelete.style.opacity = '0.4';
    ctxWsDelete.style.pointerEvents = 'none';
  } else {
    ctxWsDelete.style.opacity = '1';
    ctxWsDelete.style.pointerEvents = 'auto';
  }

  workspaceContextMenu.style.left = `${Math.min(x, window.innerWidth - 180)}px`;
  workspaceContextMenu.style.top = `${Math.min(y, window.innerHeight - 100)}px`;
  showOverlay(workspaceContextMenu);
}

ctxWsEdit.addEventListener('click', (e) => {
  e.stopPropagation();
  const ws = workspaces.find((w) => w.id === targetContextWorkspaceId);
  if (ws) openWorkspaceModal(ws);
});

ctxWsDelete.addEventListener('click', (e) => {
  e.stopPropagation();
  if (targetContextWorkspaceId) {
    openDeleteWorkspaceModal(targetContextWorkspaceId);
  }
});

function showTabContextMenu(tabId, x, y) {
  hideContextMenus();
  targetContextTabId = tabId;

  const tab = tabs.find((t) => t.id === tabId);
  if (!tab) return;

  tabCtxWsList.innerHTML = '';
  const otherWorkspaces = workspaces.filter((w) => w.id !== tab.workspaceId);

  if (otherWorkspaces.length === 0) {
    const noWs = document.createElement('div');
    noWs.style.padding = '4px 12px';
    noWs.style.fontSize = '11px';
    noWs.style.color = '#71717a';
    noWs.textContent = 'No other workspaces';
    tabCtxWsList.appendChild(noWs);
  } else {
    otherWorkspaces.forEach((w) => {
      const item = document.createElement('div');
      item.className = 'context-menu-item';
      item.innerHTML = `<span>${w.icon}</span> <span>${w.name}</span>`;
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        hideContextMenus();
        window.browserAPI.moveTabToWorkspace({ tabId, targetWorkspaceId: w.id });
      });
      tabCtxWsList.appendChild(item);
    });
  }

  // Update whitelist label for tab's domain
  try {
    const domain = new URL(tab.url).hostname;
    window.browserAPI.getSuspenderSettings().then((settings) => {
      const isWhitelisted = settings && settings.whitelist && settings.whitelist.includes(domain);
      if (tabCtxWhitelistText) {
        tabCtxWhitelistText.textContent = isWhitelisted
          ? `✓ Never suspend (${domain})`
          : `⭐ Never suspend this site`;
      }
    });
  } catch (err) {}

  tabContextMenu.style.left = `${Math.min(x, window.innerWidth - 200)}px`;
  tabContextMenu.style.top = `${Math.min(y, window.innerHeight - 200)}px`;
  showOverlay(tabContextMenu);
}

tabCtxSuspendNow.addEventListener('click', async (e) => {
  e.stopPropagation();
  hideContextMenus();
  if (targetContextTabId) {
    await window.browserAPI.suspendTab(targetContextTabId);
  }
});

tabCtxSuspendOthers.addEventListener('click', async (e) => {
  e.stopPropagation();
  hideContextMenus();
  if (targetContextTabId) {
    await window.browserAPI.suspendOtherTabs(targetContextTabId);
  }
});

tabCtxToggleWhitelist.addEventListener('click', async (e) => {
  e.stopPropagation();
  hideContextMenus();
  const tab = tabs.find((t) => t.id === targetContextTabId);
  if (tab && tab.url) {
    try {
      const domain = new URL(tab.url).hostname;
      const settings = await window.browserAPI.getSuspenderSettings();
      if (settings && settings.whitelist && settings.whitelist.includes(domain)) {
        await window.browserAPI.removeSuspenderWhitelist(domain);
      } else {
        await window.browserAPI.addSuspenderWhitelist(domain);
      }
    } catch (err) {}
  }
});

tabCtxClose.addEventListener('click', (e) => {
  e.stopPropagation();
  hideContextMenus();
  if (targetContextTabId) {
    window.browserAPI.closeTab(targetContextTabId);
  }
});

// Memory Dashboard Logic
async function refreshMemoryDashboard() {
  try {
    const stats = await window.browserAPI.getMemoryStats();
    if (!stats) return;

    if (memAppTotal) memAppTotal.textContent = `${stats.totalAppMemoryMB} MB`;
    if (memRamSaved) memRamSaved.textContent = `~${stats.estimatedRamSavedMB} MB`;
    if (memTabCounts) memTabCounts.textContent = `${stats.activeTabsCount} / ${stats.suspendedTabsCount}`;
    if (memSystemFree) memSystemFree.textContent = `${(stats.systemFreeMemoryMB / 1024).toFixed(1)} GB`;

    if (stats.suspenderSettings) {
      if (suspenderEnabledToggle) suspenderEnabledToggle.checked = !!stats.suspenderSettings.enabled;
      if (suspenderIdleInput) suspenderIdleInput.value = String(stats.suspenderSettings.idleMinutes || 10);
    }

    if (memoryTabTbody) {
      memoryTabTbody.innerHTML = '';
      if (!stats.tabs || stats.tabs.length === 0) {
        const tr = document.createElement('tr');
        tr.innerHTML = '<td colspan="4" style="text-align: center; color: #71717a; padding: 12px;">No open tabs</td>';
        memoryTabTbody.appendChild(tr);
      } else {
        stats.tabs.forEach((tab) => {
          const tr = document.createElement('tr');
          const isCurrent = tab.id === activeTabId;
          const statusText = tab.isSuspended
            ? '<span class="status-badge suspended">💤 Suspended</span>'
            : isCurrent
            ? '<span class="status-badge active">Active</span>'
            : tab.isAudible
            ? '<span class="status-badge playing">🔊 Playing</span>'
            : '<span class="status-badge normal">Running</span>';

          const idleText = tab.isSuspended
            ? 'Suspended'
            : tab.idleMinutes > 0
            ? `${tab.idleMinutes}m ago`
            : 'Just now';

          const actionHtml = tab.isSuspended
            ? `<button class="table-btn wake-btn" data-id="${tab.id}">Wake Up</button>`
            : isCurrent
            ? '<span class="text-muted">Current</span>'
            : `<button class="table-btn sleep-btn" data-id="${tab.id}">Suspend</button>`;

          const tabIcon = tab.favicon
            ? `<img src="${tab.favicon}" class="tab-table-favicon" onerror="this.outerHTML='🌐'" />`
            : '🌐';

          tr.innerHTML = `
            <td>
              <div class="tab-table-cell">
                <span class="tab-table-icon">${tabIcon}</span>
                <span class="tab-table-title" title="${tab.title || tab.url}">${tab.title || tab.url}</span>
              </div>
            </td>
            <td>${statusText}</td>
            <td><span class="text-muted">${idleText}</span></td>
            <td>${actionHtml}</td>
          `;

          const wakeBtn = tr.querySelector('.wake-btn');
          if (wakeBtn) {
            wakeBtn.addEventListener('click', async () => {
              await window.browserAPI.unsuspendTab(tab.id);
              await refreshMemoryDashboard();
            });
          }

          const sleepBtn = tr.querySelector('.sleep-btn');
          if (sleepBtn) {
            sleepBtn.addEventListener('click', async () => {
              await window.browserAPI.suspendTab(tab.id);
              await refreshMemoryDashboard();
            });
          }

          memoryTabTbody.appendChild(tr);
        });
      }
    }
  } catch (err) {
    console.error('Error refreshing memory dashboard:', err);
  }
}

function openMemoryDashboard() {
  hideContextMenus();
  refreshMemoryDashboard();
  showOverlay(memoryModal);
  if (memoryRefreshInterval) clearInterval(memoryRefreshInterval);
  memoryRefreshInterval = setInterval(refreshMemoryDashboard, 3000);
}

function closeMemoryDashboard() {
  if (memoryRefreshInterval) {
    clearInterval(memoryRefreshInterval);
    memoryRefreshInterval = null;
  }
  hideOverlay(memoryModal);
}

if (btnMemoryDashboard) {
  btnMemoryDashboard.addEventListener('click', openMemoryDashboard);
}
if (btnCloseMemory) {
  btnCloseMemory.addEventListener('click', closeMemoryDashboard);
}
if (btnDoneMemory) {
  btnDoneMemory.addEventListener('click', closeMemoryDashboard);
}
if (memoryModal) {
  memoryModal.addEventListener('click', (e) => {
    if (e.target === memoryModal) closeMemoryDashboard();
  });
}
if (btnSuspendAllBackground) {
  btnSuspendAllBackground.addEventListener('click', async () => {
    await window.browserAPI.suspendOtherTabs(activeTabId);
    await refreshMemoryDashboard();
  });
}
if (suspenderEnabledToggle) {
  suspenderEnabledToggle.addEventListener('change', async (e) => {
    await window.browserAPI.updateSuspenderSettings({ enabled: e.target.checked });
  });
}
if (suspenderIdleInput) {
  suspenderIdleInput.addEventListener('change', async (e) => {
    const mins = Math.max(1, parseInt(e.target.value, 10) || 10);
    await window.browserAPI.updateSuspenderSettings({ idleMinutes: mins });
  });
}

// Draggable divider implementation
let isDraggingDivider = false;

splitDivider.addEventListener('pointerdown', (e) => {
  if (!splitState.isSplit) return;
  isDraggingDivider = true;
  splitDivider.setPointerCapture(e.pointerId);
  document.body.classList.add('resizing');
});

splitDivider.addEventListener('pointermove', (e) => {
  if (!isDraggingDivider) return;
  const viewRect = viewArea.getBoundingClientRect();
  const dividerWidth = 8;
  const minWidth = 250;

  let leftWidth = e.clientX - viewRect.left;
  if (leftWidth < minWidth) leftWidth = minWidth;
  if (viewRect.width - leftWidth - dividerWidth < minWidth) {
    leftWidth = viewRect.width - minWidth - dividerWidth;
  }

  const ratio = leftWidth / viewRect.width;
  splitState.splitRatio = ratio;
  paneLeft.style.width = `calc(${ratio * 100}% - 4px)`;
  paneRight.style.width = `calc(${(1 - ratio) * 100}% - 4px)`;
  sendLayoutBounds();
});

splitDivider.addEventListener('pointerup', (e) => {
  if (isDraggingDivider) {
    isDraggingDivider = false;
    try {
      splitDivider.releasePointerCapture(e.pointerId);
    } catch (err) {}
    document.body.classList.remove('resizing');
    sendLayoutBounds();
  }
});

// Click pane headers to focus pane
headerLeft.addEventListener('click', () => {
  if (splitState.leftTabId) {
    window.browserAPI.setFocusedPane(splitState.leftTabId);
  }
});

headerRight.addEventListener('click', () => {
  if (splitState.rightTabId) {
    window.browserAPI.setFocusedPane(splitState.rightTabId);
  }
});

// Split view toolbar buttons
btnSplitToggle.addEventListener('click', () => {
  const wsTabs = getActiveWorkspaceTabs();
  if (wsTabs.length <= 1 && !splitState.isSplit) return;
  window.browserAPI.toggleSplitView();
});

btnSwapPanes.addEventListener('click', () => {
  window.browserAPI.swapSplitPanes();
});

btnCloseSplit.addEventListener('click', () => {
  window.browserAPI.closeSplitView();
});

// Tab picker actions
btnPickerNewTab.addEventListener('click', async () => {
  const newTab = await window.browserAPI.createTab('https://duckduckgo.com', false);
  window.browserAPI.setSplitRightTab(newTab.id);
});

btnPickerCancel.addEventListener('click', () => {
  window.browserAPI.closeSplitView();
});

// Crash reload button
btnReloadCrash.addEventListener('click', () => {
  if (crashedTabId) {
    window.browserAPI.reload(crashedTabId);
  }
});

// Toggle Sidebar collapse
btnToggleSidebar.addEventListener('click', () => {
  sidebar.classList.toggle('collapsed');
  setTimeout(sendLayoutBounds, 250);
});

// New Tab button
btnNewTab.addEventListener('click', () => {
  window.browserAPI.createTab('https://duckduckgo.com', true);
  urlInput.focus();
  urlInput.select();
});

// Address Bar navigation
urlForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const inputVal = urlInput.value.trim().toLowerCase();
  if (inputVal === 'browser://memory' || inputVal === 'chrome://memory' || inputVal === 'about:memory') {
    openMemoryDashboard();
    return;
  }
  if (inputVal === 'browser://gpu' || inputVal === 'chrome://gpu' || inputVal === 'about:gpu') {
    if (toolkitPanel) toolkitPanel.openGpuDiagnostics();
    return;
  }
  const targetTab = getTargetTab();
  if (targetTab) {
    const url = normalizeUrl(urlInput.value);
    window.browserAPI.navigate(targetTab.id, url);
  }
});

urlInput.addEventListener('focus', () => {
  urlInput.select();
});

// Back / Forward / Reload controls
btnBack.addEventListener('click', () => {
  const targetTab = getTargetTab();
  if (targetTab) window.browserAPI.goBack(targetTab.id);
});

btnForward.addEventListener('click', () => {
  const targetTab = getTargetTab();
  if (targetTab) window.browserAPI.goForward(targetTab.id);
});

btnReload.addEventListener('click', () => {
  const targetTab = getTargetTab();
  if (!targetTab) return;
  if (targetTab.isLoading) {
    window.browserAPI.stop(targetTab.id);
  } else {
    window.browserAPI.reload(targetTab.id);
  }
});

// Keyboard Shortcuts
window.addEventListener('keydown', (e) => {
  const isCtrlOrCmd = e.ctrlKey || e.metaKey;

  // Ctrl+1..9: Jump to workspace by position
  if (isCtrlOrCmd && !e.shiftKey && e.key >= '1' && e.key <= '9') {
    const idx = parseInt(e.key, 10) - 1;
    if (workspaces[idx]) {
      e.preventDefault();
      window.browserAPI.switchWorkspace(workspaces[idx].id);
    }
  }
  // Ctrl+Shift+N: New Workspace
  else if (isCtrlOrCmd && e.shiftKey && e.key.toLowerCase() === 'n') {
    e.preventDefault();
    openWorkspaceModal(null);
  }
  // Ctrl+Shift+S: Toggle Split View
  else if (isCtrlOrCmd && e.shiftKey && e.key.toLowerCase() === 's') {
    e.preventDefault();
    const wsTabs = getActiveWorkspaceTabs();
    if (wsTabs.length > 1 || splitState.isSplit) {
      window.browserAPI.toggleSplitView();
    }
  }
  // Ctrl+Shift+D: Toggle Developer Toolkit
  else if (isCtrlOrCmd && e.shiftKey && e.key.toLowerCase() === 'd') {
    e.preventDefault();
    if (toolkitPanel) toolkitPanel.togglePanel();
  }
  // Ctrl+T: New Tab
  else if (isCtrlOrCmd && !e.shiftKey && e.key.toLowerCase() === 't') {
    e.preventDefault();
    window.browserAPI.createTab('https://duckduckgo.com', true);
    urlInput.focus();
    urlInput.select();
  }
  // Ctrl+W: Close Active Tab
  else if (isCtrlOrCmd && !e.shiftKey && e.key.toLowerCase() === 'w') {
    e.preventDefault();
    const targetTab = getTargetTab();
    if (targetTab) {
      window.browserAPI.closeTab(targetTab.id);
    }
  }
  // Escape: Close any open modal or context menu
  else if (e.key === 'Escape') {
    closeWorkspaceModal();
    closeDeleteWorkspaceModal();
    closeMemoryDashboard();
    if (toolkitPanel) toolkitPanel.closeGpuModal();
    hideContextMenus();
  }
  // Ctrl+Shift+I or F12: Open DevTools for active tab's WebContentsView
  else if ((isCtrlOrCmd && e.shiftKey && e.key.toLowerCase() === 'i') || e.key === 'F12') {
    e.preventDefault();
    const targetTab = getTargetTab();
    if (targetTab) {
      window.browserAPI.openDevTools(targetTab.id);
    }
  }
});

// Window resize handling
window.addEventListener('resize', () => {
  sendLayoutBounds();
});

// IPC Event Listeners from Main Process
window.browserAPI.onWorkspaceStateChanged(async (state) => {
  workspaces = state.workspaces || [];
  activeWorkspaceId = state.activeWorkspaceId || (workspaces[0] ? workspaces[0].id : null);
  try {
    const allTabs = await window.browserAPI.getAllTabs();
    if (Array.isArray(allTabs) && allTabs.length > 0) {
      tabs = allTabs;
    }
  } catch (e) {}
  renderWorkspaceSwitcher();
  renderSidebarTabs();
  updateToolbar();
  renderSplitLayout();
  if (toolkitPanel) {
    toolkitPanel.loadWorkspaceNotes();
  }
});

if (window.browserAPI.onNotesInsertText) {
  window.browserAPI.onNotesInsertText((text) => {
    if (toolkitPanel) {
      toolkitPanel.appendSnippetToActiveNote(`\n\n> ${text}\n`);
    }
  });
}

window.browserAPI.onTabCreated((newTab) => {
  const existing = tabs.find((t) => t.id === newTab.id);
  if (!existing) {
    tabs.push({
      ...newTab,
      canGoBack: false,
      canGoForward: false,
      isLoading: false,
      isCrashed: false,
    });
  } else {
    Object.assign(existing, newTab);
  }

  if (newTab.activate && !splitState.isSplit) {
    activeTabId = newTab.id;
  }
  renderSidebarTabs();
  updateToolbar();
  renderSplitLayout();
});

window.browserAPI.onTabClosed((tabId) => {
  tabs = tabs.filter((t) => t.id !== tabId);
  renderSidebarTabs();
  updateToolbar();
  renderSplitLayout();
});

window.browserAPI.onTabUpdated((updatedTab) => {
  const index = tabs.findIndex((t) => t.id === updatedTab.id);
  if (index !== -1) {
    tabs[index] = { ...tabs[index], ...updatedTab };
  }
  renderSidebarTabs();
  updateToolbar();
  renderSplitLayout();
});

window.browserAPI.onTabSwitched((tabId) => {
  activeTabId = tabId;
  splitState.focusedTabId = tabId;
  renderSidebarTabs();
  updateToolbar();
  renderSplitLayout();
});

window.browserAPI.onSplitStateChanged((state) => {
  splitState = state;
  renderSidebarTabs();
  updateToolbar();
  renderSplitLayout();
});

window.browserAPI.onPaneFocused((tabId) => {
  splitState.focusedTabId = tabId;
  renderSidebarTabs();
  updateToolbar();
  renderSplitLayout();
});

window.browserAPI.onPageCrash(({ tabId }) => {
  const tab = tabs.find((t) => t.id === tabId);
  if (tab) {
    tab.isCrashed = true;
    updateToolbar();
  }
});

// Initial layout calculation
setTimeout(sendLayoutBounds, 100);
