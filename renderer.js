// Coder Browser - Step 2: Vertical Tabs & Tab Management

// DOM Elements
const tabList = document.getElementById('tab-list');
const btnNewTab = document.getElementById('btn-new-tab');
const webviewContainer = document.getElementById('webview-container');
const urlForm = document.getElementById('url-form');
const urlInput = document.getElementById('url-input');
const btnBack = document.getElementById('btn-back');
const btnForward = document.getElementById('btn-forward');
const btnReload = document.getElementById('btn-reload');
const securityIcon = document.getElementById('security-icon');

// State tracking
let tabs = [];
let activeTabId = null;
let tabIdSequence = 0;

/**
 * Normalizes user input into a valid URL or search engine query.
 */
function normalizeUrl(input) {
  const trimmed = input.trim();
  if (!trimmed) return 'https://duckduckgo.com';

  // Keep explicit protocol if present
  if (/^https?:\/\//i.test(trimmed) || /^file:\/\//i.test(trimmed)) {
    return trimmed;
  }

  // Handle localhost or IP addresses
  if (/^localhost(:\d+)?/i.test(trimmed) || /^\d{1,3}(\.\d{1,3}){3}(:\d+)?/.test(trimmed)) {
    return `http://${trimmed}`;
  }

  // Handle standard domain names (e.g. github.com, news.ycombinator.com)
  if (/^[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)+/i.test(trimmed) && !trimmed.includes(' ')) {
    return `https://${trimmed}`;
  }

  // Fallback to DuckDuckGo search query
  return `https://duckduckgo.com/?q=${encodeURIComponent(trimmed)}`;
}

/**
 * Returns the currently active tab object.
 */
function getActiveTab() {
  return tabs.find((t) => t.id === activeTabId);
}

/**
 * Updates back/forward button disabled states for the active tab.
 */
function updateNavigationControls() {
  const activeTab = getActiveTab();
  if (!activeTab || !activeTab.webviewElement) {
    btnBack.disabled = true;
    btnForward.disabled = true;
    return;
  }

  try {
    btnBack.disabled = !activeTab.webviewElement.canGoBack();
    btnForward.disabled = !activeTab.webviewElement.canGoForward();
  } catch (err) {
    btnBack.disabled = true;
    btnForward.disabled = true;
  }
}

/**
 * Updates reload/stop button icon based on loading status.
 */
function updateReloadButton(isLoading) {
  if (isLoading) {
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
}

/**
 * Updates the protocol security icon (HTTPS vs HTTP).
 */
function updateSecurityIndicator(url) {
  if (!url) {
    securityIcon.textContent = '🔒';
    securityIcon.title = 'Secure';
    return;
  }

  if (url.startsWith('https://')) {
    securityIcon.textContent = '🔒';
    securityIcon.title = 'Secure connection (HTTPS)';
  } else if (url.startsWith('http://')) {
    securityIcon.textContent = '⚠️';
    securityIcon.title = 'Insecure connection (HTTP)';
  } else {
    securityIcon.textContent = '🌐';
    securityIcon.title = 'Local or internal page';
  }
}

/**
 * Switches the active tab to the specified tab ID.
 */
function switchTab(tabId) {
  const targetTab = tabs.find((t) => t.id === tabId);
  if (!targetTab) return;

  activeTabId = tabId;

  // Toggle active class on sidebar tabs and webview elements
  tabs.forEach((t) => {
    const isActive = t.id === tabId;
    t.tabElement.classList.toggle('active', isActive);
    t.webviewElement.classList.toggle('active', isActive);
  });

  // Sync navigation bar controls with the active tab's current state
  const currentUrl = targetTab.url || targetTab.webviewElement.getURL() || '';
  urlInput.value = currentUrl;
  updateSecurityIndicator(currentUrl);
  updateNavigationControls();
  updateReloadButton(targetTab.isLoading);
  document.title = `${targetTab.title || 'New Tab'} - Coder Browser`;
}

/**
 * Creates a new tab, instantiates its <webview>, and adds it to the sidebar.
 */
function createTab(url = 'https://duckduckgo.com', activate = true) {
  const tabId = `tab-${++tabIdSequence}`;

  // 1. Create sidebar tab item
  const tabItem = document.createElement('div');
  tabItem.className = 'tab-item';
  tabItem.id = `sidebar-${tabId}`;

  const faviconSpan = document.createElement('span');
  faviconSpan.className = 'tab-favicon';
  faviconSpan.textContent = '🌐';

  const titleSpan = document.createElement('span');
  titleSpan.className = 'tab-title';
  titleSpan.textContent = 'New Tab';

  const closeBtn = document.createElement('button');
  closeBtn.className = 'tab-close-btn';
  closeBtn.title = 'Close tab';
  closeBtn.innerHTML = '&times;';

  tabItem.appendChild(faviconSpan);
  tabItem.appendChild(titleSpan);
  tabItem.appendChild(closeBtn);
  tabList.appendChild(tabItem);

  // 2. Create corresponding <webview> in webview container
  const webview = document.createElement('webview');
  webview.className = 'tab-webview';
  webview.id = `webview-${tabId}`;
  webview.setAttribute('src', url);
  webview.setAttribute('allowpopups', '');
  webviewContainer.appendChild(webview);

  // 3. Tab state object
  const tab = {
    id: tabId,
    url: url,
    title: 'New Tab',
    favicon: null,
    isLoading: false,
    tabElement: tabItem,
    titleElement: titleSpan,
    faviconElement: faviconSpan,
    webviewElement: webview,
  };

  tabs.push(tab);

  // 4. Attach event listeners for webview lifecycle
  webview.addEventListener('did-start-loading', () => {
    tab.isLoading = true;
    if (tab.id === activeTabId) {
      updateReloadButton(true);
    }
  });

  webview.addEventListener('did-stop-loading', () => {
    tab.isLoading = false;
    if (tab.id === activeTabId) {
      updateReloadButton(false);
      updateNavigationControls();
    }
  });

  const onNavigate = (event) => {
    tab.url = event.url;
    if (tab.id === activeTabId) {
      urlInput.value = event.url;
      updateSecurityIndicator(event.url);
      updateNavigationControls();
    }
  };

  webview.addEventListener('did-navigate', onNavigate);
  webview.addEventListener('did-navigate-in-page', onNavigate);

  // Update tab title when web page title updates
  webview.addEventListener('page-title-updated', (event) => {
    if (event.title) {
      tab.title = event.title;
      tab.titleElement.textContent = event.title;
      tab.titleElement.title = event.title;
      if (tab.id === activeTabId) {
        document.title = `${event.title} - Coder Browser`;
      }
    }
  });

  // Update tab favicon when available
  webview.addEventListener('page-favicon-updated', (event) => {
    if (event.favicons && event.favicons.length > 0) {
      const iconUrl = event.favicons[0];
      tab.favicon = iconUrl;
      tab.faviconElement.innerHTML = `<img src="${iconUrl}" alt="" onerror="this.outerHTML='🌐'" />`;
    }
  });

  webview.addEventListener('dom-ready', () => {
    if (tab.id === activeTabId) {
      const currentUrl = webview.getURL();
      if (currentUrl) {
        tab.url = currentUrl;
        urlInput.value = currentUrl;
        updateSecurityIndicator(currentUrl);
      }
      updateNavigationControls();
    }
  });

  // 5. Attach sidebar interaction handlers
  tabItem.addEventListener('click', () => {
    switchTab(tabId);
  });

  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation(); // Avoid triggering switchTab
    closeTab(tabId);
  });

  // Activate the newly created tab if requested
  if (activate) {
    switchTab(tabId);
  }

  return tab;
}

/**
 * Closes the tab by ID. If it's the last tab, opens a new blank tab.
 */
function closeTab(tabId) {
  const index = tabs.findIndex((t) => t.id === tabId);
  if (index === -1) return;

  const [closingTab] = tabs.splice(index, 1);
  closingTab.tabElement.remove();
  closingTab.webviewElement.remove();

  // If no tabs remain, open a fresh tab instead of quitting
  if (tabs.length === 0) {
    createTab('https://duckduckgo.com', true);
    return;
  }

  // If the closed tab was the active tab, activate the closest available tab
  if (activeTabId === tabId) {
    const nextIndex = Math.min(index, tabs.length - 1);
    switchTab(tabs[nextIndex].id);
  }
}

// Top "+" button creates a new tab
btnNewTab.addEventListener('click', () => {
  createTab('https://duckduckgo.com', true);
  urlInput.focus();
  urlInput.select();
});

// Address bar form submission controls active tab
urlForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const activeTab = getActiveTab();
  if (activeTab) {
    const targetUrl = normalizeUrl(urlInput.value);
    activeTab.webviewElement.loadURL(targetUrl);
  }
});

urlInput.addEventListener('focus', () => {
  urlInput.select();
});

// Back / Forward / Reload controls for active tab
btnBack.addEventListener('click', () => {
  const activeTab = getActiveTab();
  if (activeTab && activeTab.webviewElement.canGoBack()) {
    activeTab.webviewElement.goBack();
  }
});

btnForward.addEventListener('click', () => {
  const activeTab = getActiveTab();
  if (activeTab && activeTab.webviewElement.canGoForward()) {
    activeTab.webviewElement.goForward();
  }
});

btnReload.addEventListener('click', () => {
  const activeTab = getActiveTab();
  if (!activeTab) return;

  if (activeTab.isLoading) {
    activeTab.webviewElement.stop();
  } else {
    activeTab.webviewElement.reload();
  }
});

// Keyboard shortcuts for convenience (Ctrl+T for new tab, Ctrl+W to close active tab)
window.addEventListener('keydown', (e) => {
  const isCtrlOrCmd = e.ctrlKey || e.metaKey;
  if (isCtrlOrCmd && e.key.toLowerCase() === 't') {
    e.preventDefault();
    createTab('https://duckduckgo.com', true);
    urlInput.focus();
    urlInput.select();
  } else if (isCtrlOrCmd && e.key.toLowerCase() === 'w') {
    e.preventDefault();
    if (activeTabId) {
      closeTab(activeTabId);
    }
  }
});

// Initialize with the first default tab on startup
createTab('https://duckduckgo.com', true);
