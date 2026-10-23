// Page Extractor - Extracts sanitized readable text and selection from active WebContentsView
/**
 * Safely extracts human-readable text and selection from a WebContentsView.
 * Respects domain exclusion allowlists, local/file URL restrictions, and size bounds.
 */
async function extractPageContent(view, restrictedDomains = []) {
  if (!view || !view.webContents || view.webContents.isDestroyed()) {
    return {
      allowed: false,
      reason: 'No active web page found to read.',
    };
  }

  const wc = view.webContents;
  const currentUrl = wc.getURL() || '';

  // 1. Restriction: Local files and internal browser URLs
  if (
    currentUrl.startsWith('file:') ||
    currentUrl.startsWith('browser:') ||
    currentUrl.startsWith('chrome:') ||
    currentUrl.startsWith('devtools:') ||
    currentUrl === 'about:blank' ||
    !currentUrl
  ) {
    return {
      allowed: false,
      reason: 'Local and internal browser pages cannot be shared with AI for security and privacy.',
    };
  }

  // 2. Restriction: User's "never share with AI" allowlist
  try {
    const urlObj = new URL(currentUrl);
    const hostname = urlObj.hostname.toLowerCase();

    const isExcluded = restrictedDomains.some((d) => {
      const domain = (d || '').trim().toLowerCase();
      if (!domain) return false;
      return hostname === domain || hostname.endsWith('.' + domain);
    });

    if (isExcluded) {
      return {
        allowed: false,
        reason: `Page content cannot be shared: "${hostname}" is on your "Never share with AI" exclusion list.`,
      };
    }
  } catch (e) {
    return {
      allowed: false,
      reason: 'Invalid URL for page extraction.',
    };
  }

  // 3. Extract readable text & selected text via in-page DOM script
  try {
    const pageData = await wc.executeJavaScript(`(() => {
      // 1. Get current user selection
      const selection = window.getSelection() ? window.getSelection().toString().trim() : '';

      // 2. Clone body to safely remove non-content elements without affecting live page
      const clone = document.body ? document.body.cloneNode(true) : null;
      if (!clone) {
        return {
          title: document.title || '',
          url: window.location.href,
          selectedText: selection,
          readableText: '',
        };
      }

      // Remove unwanted noisy tags
      const noisyTags = [
        'script', 'style', 'noscript', 'iframe', 'svg', 'canvas',
        'nav', 'footer', 'header', 'aside', 'form', 'button', 'select'
      ];
      noisyTags.forEach(tag => {
        const elements = clone.getElementsByTagName(tag);
        for (let i = elements.length - 1; i >= 0; i--) {
          elements[i].parentNode && elements[i].parentNode.removeChild(elements[i]);
        }
      });

      // Prefer article or main container if available
      const mainEl = clone.querySelector('article, main, [role="main"], #content, .content');
      const textSource = mainEl || clone;

      const rawText = textSource.innerText || textSource.textContent || '';
      // Clean excessive whitespace and blank lines
      const cleaned = rawText
        .replace(/[\t ]+/g, ' ')
        .replace(/(\r?\n\s*){3,}/g, '\n\n')
        .trim();

      return {
        title: document.title || 'Untitled Page',
        url: window.location.href,
        selectedText: selection,
        readableText: cleaned,
      };
    })()`);

    // 4. Truncate extracted text to safe token-bound sizes
    const MAX_PAGE_CHARS = 16000; // ~4000 tokens
    const MAX_SELECTION_CHARS = 8000;

    let readableText = pageData.readableText || '';
    if (readableText.length > MAX_PAGE_CHARS) {
      readableText = readableText.slice(0, MAX_PAGE_CHARS) + '\n\n[... Page content truncated for context limit ...]';
    }

    let selectedText = pageData.selectedText || '';
    if (selectedText.length > MAX_SELECTION_CHARS) {
      selectedText = selectedText.slice(0, MAX_SELECTION_CHARS) + '\n\n[... Selection truncated ...]';
    }

    return {
      allowed: true,
      title: pageData.title,
      url: pageData.url,
      selectedText,
      readableText,
    };
  } catch (err) {
    return {
      allowed: false,
      reason: `Could not extract page content: ${err.message}`,
    };
  }
}

module.exports = {
  extractPageContent,
};
