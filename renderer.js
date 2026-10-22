// Coder Browser - Step 1: Minimal Browser Controls & Webview Handling

const webview = document.getElementById('webview');
const urlForm = document.getElementById('url-form');
const urlInput = document.getElementById('url-input');
const btnBack = document.getElementById('btn-back');
const btnForward = document.getElementById('btn-forward');
const btnReload = document.getElementById('btn-reload');
const tabTitle = document.getElementById('tab-title');
const securityIcon = document.getElementById('security-icon');

/**
 * Normalizes input text into a valid URL.
 * Supports domain detection and fallback search query.
 */
function normalizeUrl(input) {
  const trimmed = input.trim();
  if (!trimmed) return 'https://duckduckgo.com';

  // If already prefixed with protocol, keep it
  if (/^https?:\/\//i.test(trimmed) || /^file:\/\//i.test(trimmed)) {
    return trimmed;
  }

  // Check if it's localhost or an IP address
  if (/^localhost(:\d+)?/i.test(trimmed) || /^\d{1,3}(\.\d{1,3}){3}(:\d+)?/.test(trimmed)) {
    return `http://${trimmed}`;
  }

  // Check if input looks like a valid domain name (e.g., github.com, news.ycombinator.com/item)
  if (/^[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)+/i.test(trimmed) && !trimmed.includes(' ')) {
    return `https://${trimmed}`;
  }

  // Otherwise, treat as search query using privacy-friendly DuckDuckGo
  return `https://duckduckgo.com/?q=${encodeURIComponent(trimmed)}`;
}

/**
 * Updates back & forward navigation buttons based on webview history.
 */
function updateNavigationControls() {
  btnBack.disabled = !webview.canGoBack();
  btnForward.disabled = !webview.canGoForward();
}

/**
 * Updates security badge indicator depending on current protocol.
 */
function updateSecurityIndicator(url) {
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

// Handle address bar navigation
urlForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const targetUrl = normalizeUrl(urlInput.value);
  webview.loadURL(targetUrl);
});

// Auto-select text when focusing address bar for faster typing
urlInput.addEventListener('focus', () => {
  urlInput.select();
});

// Navigation button event listeners
btnBack.addEventListener('click', () => {
  if (webview.canGoBack()) {
    webview.goBack();
  }
});

btnForward.addEventListener('click', () => {
  if (webview.canGoForward()) {
    webview.goForward();
  }
});

let isLoading = false;
btnReload.addEventListener('click', () => {
  if (isLoading) {
    webview.stop();
  } else {
    webview.reload();
  }
});

// Webview lifecycle event listeners
webview.addEventListener('did-start-loading', () => {
  isLoading = true;
  btnReload.title = 'Stop';
  btnReload.innerHTML = `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <line x1="18" y1="6" x2="6" y2="18"></line>
      <line x1="6" y1="6" x2="18" y2="18"></line>
    </svg>
  `;
});

webview.addEventListener('did-stop-loading', () => {
  isLoading = false;
  btnReload.title = 'Reload';
  btnReload.innerHTML = `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="23 4 23 10 17 10"></polyline>
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
    </svg>
  `;
  updateNavigationControls();
});

// Update URL bar and navigation buttons when the page navigates
const handleNavigation = (event) => {
  urlInput.value = event.url;
  updateSecurityIndicator(event.url);
  updateNavigationControls();
};

webview.addEventListener('did-navigate', handleNavigation);
webview.addEventListener('did-navigate-in-page', handleNavigation);

// Update tab title and window title when web page title changes
webview.addEventListener('page-title-updated', (e) => {
  if (e.title) {
    tabTitle.textContent = e.title;
    document.title = `${e.title} - Coder Browser`;
  }
});

// Sync initial URL input once webview loads
webview.addEventListener('dom-ready', () => {
  const currentUrl = webview.getURL();
  if (currentUrl) {
    urlInput.value = currentUrl;
    updateSecurityIndicator(currentUrl);
  }
  updateNavigationControls();
});
