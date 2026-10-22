// Coder Browser - Step 3: Renderer Logic (IPC Bridge, Split View & Vertical Tabs)

// DOM Elements
const sidebar = document.getElementById('sidebar');
const btnToggleSidebar = document.getElementById('btn-toggle-sidebar');
const btnNewTab = document.getElementById('btn-new-tab');
const tabList = document.getElementById('tab-list');

const btnBack = document.getElementById('btn-back');
const btnForward = document.getElementById('btn-forward');
const btnReload = document.getElementById('btn-reload');
const urlForm = document.getElementById('url-form');
const urlInput = document.getElementById('url-input');
const securityIcon = document.getElementById('security-icon');

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

// Application State
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
  return tabs.find((t) => t.id === targetId) || tabs[0];
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

  // Edge case: Disable split view button if only one tab is open
  if (tabs.length <= 1 && !splitState.isSplit) {
    btnSplitToggle.disabled = true;
    btnSplitToggle.title = 'Open at least 2 tabs to enable Split View';
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
 * Renders the vertical tab list in the sidebar.
 */
function renderSidebarTabs() {
  tabList.innerHTML = '';
  const currentFocusedId = splitState.isSplit ? splitState.focusedTabId : activeTabId;

  tabs.forEach((tab) => {
    const tabEl = document.createElement('div');
    tabEl.className = 'tab-item';
    if (tab.id === currentFocusedId) {
      tabEl.classList.add('active');
    }

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

    // In split view, display split indicator badge
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

    // Switch tab on click
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

    // Apply split ratio (min 250px)
    const ratio = splitState.splitRatio || 0.5;
    paneLeft.style.width = `calc(${ratio * 100}% - 4px)`;
    paneRight.style.width = `calc(${(1 - ratio) * 100}% - 4px)`;

    // Focus highlight borders
    paneLeft.classList.toggle('focused', splitState.focusedTabId === splitState.leftTabId);
    paneRight.classList.toggle('focused', splitState.focusedTabId === splitState.rightTabId);

    // Populate Left Pane Header
    const leftTab = tabs.find((t) => t.id === splitState.leftTabId);
    if (leftTab) {
      titleLeft.textContent = leftTab.title || 'Left Pane';
      titleLeft.title = leftTab.title || 'Left Pane';
      faviconLeft.innerHTML = leftTab.favicon
        ? `<img src="${leftTab.favicon}" alt="" onerror="this.outerHTML='🌐'" />`
        : '🌐';
    }

    // Populate Right Pane Header & Picker
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
 * Renders list of candidate tabs in right pane picker.
 */
function renderTabPicker() {
  pickerTabList.innerHTML = '';
  const candidateTabs = tabs.filter((t) => t.id !== splitState.leftTabId);

  if (candidateTabs.length === 0) {
    const emptyMsg = document.createElement('div');
    emptyMsg.style.fontSize = '12px';
    emptyMsg.style.color = '#71717a';
    emptyMsg.style.padding = '8px 0';
    emptyMsg.textContent = 'No other tabs open. Click "+ Open New Tab" below:';
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
  if (tabs.length <= 1 && !splitState.isSplit) return;
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

  // Ctrl+Shift+S / Cmd+Shift+S: Toggle Split View
  if (isCtrlOrCmd && e.shiftKey && e.key.toLowerCase() === 's') {
    e.preventDefault();
    if (tabs.length > 1 || splitState.isSplit) {
      window.browserAPI.toggleSplitView();
    }
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
});

// Window resize handling
window.addEventListener('resize', () => {
  sendLayoutBounds();
});

// IPC Event Listeners from Main Process
window.browserAPI.onTabCreated((newTab) => {
  if (!tabs.find((t) => t.id === newTab.id)) {
    tabs.push({
      ...newTab,
      canGoBack: false,
      canGoForward: false,
      isLoading: false,
      isCrashed: false,
    });
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

window.browserAPI.onPageCrash(({ tabId, reason }) => {
  const tab = tabs.find((t) => t.id === tabId);
  if (tab) {
    tab.isCrashed = true;
    updateToolbar();
  }
});

// Initial layout calculation
setTimeout(sendLayoutBounds, 100);
