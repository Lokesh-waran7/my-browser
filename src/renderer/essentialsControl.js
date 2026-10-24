// Essentials Controller - Step 10 Part A: History, Bookmarks, Downloads, Find in page, Zoom, Suggestions, Permissions
(function (global) {
  'use strict';

  function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, (m) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[m]));
  }

  function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  function formatDate(ts) {
    if (!ts) return '';
    const date = new Date(ts);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (isToday) return `Today, ${timeStr}`;
    return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${timeStr}`;
  }

  class EssentialsControl {
    constructor(deps) {
      this.deps = deps || {};
      this.currentZoomFactors = new Map(); // tabId -> factor (1.0 default)
      this.activePermissionReq = null;
      this.selectedSuggestionIndex = -1;
      this.currentSuggestions = [];
      this.zoomTimeout = null;

      this.initDOMElements();
      this.bindEvents();
      this.bindIpcListeners();
    }

    initDOMElements() {
      // Toolbar buttons
      this.btnOpenBookmarks = document.getElementById('btn-open-bookmarks');
      this.btnOpenHistory = document.getElementById('btn-open-history');
      this.btnOpenDownloads = document.getElementById('btn-open-downloads');
      this.downloadsBadge = document.getElementById('downloads-badge');

      // Star & Suggestions
      this.btnBookmarkStar = document.getElementById('btn-bookmark-star');
      this.urlInput = document.getElementById('url-input');
      this.urlSuggestions = document.getElementById('url-suggestions');

      // Find in page
      this.findBar = document.getElementById('find-in-page-bar');
      this.findInput = document.getElementById('find-input');
      this.findMatchCount = document.getElementById('find-match-count');
      this.btnFindPrev = document.getElementById('btn-find-prev');
      this.btnFindNext = document.getElementById('btn-find-next');
      this.btnFindClose = document.getElementById('btn-find-close');

      // Zoom pill
      this.zoomPill = document.getElementById('zoom-pill');

      // Permission Prompt Banner
      this.permissionBanner = document.getElementById('permission-prompt-banner');
      this.permissionText = document.getElementById('permission-prompt-text');
      this.btnPermAllow = document.getElementById('btn-perm-allow');
      this.btnPermBlock = document.getElementById('btn-perm-block');

      // History Modal
      this.historyModal = document.getElementById('history-modal');
      this.btnCloseHistory = document.getElementById('btn-close-history');
      this.btnDoneHistory = document.getElementById('btn-done-history');
      this.historySearchInput = document.getElementById('history-search-input');
      this.btnClearAllHistory = document.getElementById('btn-clear-all-history');
      this.historyListItems = document.getElementById('history-list-items');

      // Bookmarks Modal
      this.bookmarksModal = document.getElementById('bookmarks-modal');
      this.btnCloseBookmarks = document.getElementById('btn-close-bookmarks');
      this.btnDoneBookmarks = document.getElementById('btn-done-bookmarks');
      this.bookmarksFolderSelect = document.getElementById('bookmarks-folder-select');
      this.btnNewBookmarkFolder = document.getElementById('btn-new-bookmark-folder');
      this.bookmarksSearchInput = document.getElementById('bookmarks-search-input');
      this.btnAddBookmarkManual = document.getElementById('btn-add-bookmark-manual');
      this.btnImportBookmarksHtml = document.getElementById('btn-import-bookmarks-html');
      this.btnExportBookmarksHtml = document.getElementById('btn-export-bookmarks-html');
      this.bookmarksFileInput = document.getElementById('bookmarks-file-input');
      this.bookmarksListItems = document.getElementById('bookmarks-list-items');

      // Downloads Modal
      this.downloadsModal = document.getElementById('downloads-modal');
      this.btnCloseDownloads = document.getElementById('btn-close-downloads');
      this.btnDoneDownloads = document.getElementById('btn-done-downloads');
      this.downloadsStatusSummary = document.getElementById('downloads-status-summary');
      this.btnOpenDownloadsFolder = document.getElementById('btn-open-downloads-folder');
      this.btnClearCompletedDownloads = document.getElementById('btn-clear-completed-downloads');
      this.downloadsListItems = document.getElementById('downloads-list-items');
    }

    bindEvents() {
      // Navigation Toolbar Buttons
      if (this.btnOpenHistory) {
        this.btnOpenHistory.addEventListener('click', () => this.openHistoryModal());
      }
      if (this.btnOpenBookmarks) {
        this.btnOpenBookmarks.addEventListener('click', () => this.openBookmarksModal());
      }
      if (this.btnOpenDownloads) {
        this.btnOpenDownloads.addEventListener('click', () => this.openDownloadsModal());
      }

      // Star Button Toggle
      if (this.btnBookmarkStar) {
        this.btnBookmarkStar.addEventListener('click', async () => {
          const tab = this.deps.getTargetTab ? this.deps.getTargetTab() : null;
          if (!tab || !tab.url || tab.url.startsWith('browser://')) return;

          const isBookmarked = await window.browserAPI.isBookmarked(tab.url);
          if (isBookmarked) {
            await window.browserAPI.removeBookmark(tab.url);
            this.updateBookmarkStar(false);
          } else {
            await window.browserAPI.addBookmark({
              title: tab.title || tab.url,
              url: tab.url,
              folder: 'Bookmarks Bar',
            });
            this.updateBookmarkStar(true);
          }
        });
      }

      // History Modal Controls
      if (this.btnCloseHistory) this.btnCloseHistory.addEventListener('click', () => this.closeHistoryModal());
      if (this.btnDoneHistory) this.btnDoneHistory.addEventListener('click', () => this.closeHistoryModal());
      if (this.historySearchInput) {
        this.historySearchInput.addEventListener('input', () => this.renderHistoryList());
      }
      if (this.btnClearAllHistory) {
        this.btnClearAllHistory.addEventListener('click', async () => {
          if (confirm('Are you sure you want to clear all browsing history?')) {
            await window.browserAPI.clearHistory();
            this.renderHistoryList();
          }
        });
      }

      // Bookmarks Modal Controls
      if (this.btnCloseBookmarks) this.btnCloseBookmarks.addEventListener('click', () => this.closeBookmarksModal());
      if (this.btnDoneBookmarks) this.btnDoneBookmarks.addEventListener('click', () => this.closeBookmarksModal());
      if (this.bookmarksFolderSelect) {
        this.bookmarksFolderSelect.addEventListener('change', () => this.renderBookmarksList());
      }
      if (this.bookmarksSearchInput) {
        this.bookmarksSearchInput.addEventListener('input', () => this.renderBookmarksList());
      }
      if (this.btnNewBookmarkFolder) {
        this.btnNewBookmarkFolder.addEventListener('click', async () => {
          const folderName = prompt('Enter new bookmark folder name:');
          if (folderName && folderName.trim()) {
            await window.browserAPI.addBookmarkFolder(folderName.trim());
            await this.refreshBookmarkFolders();
            this.bookmarksFolderSelect.value = folderName.trim();
            this.renderBookmarksList();
          }
        });
      }
      if (this.btnAddBookmarkManual) {
        this.btnAddBookmarkManual.addEventListener('click', async () => {
          const url = prompt('Enter bookmark URL:', 'https://');
          if (!url || !url.trim()) return;
          const title = prompt('Enter bookmark title:', url) || url;
          const folder = this.bookmarksFolderSelect.value || 'Bookmarks Bar';
          await window.browserAPI.addBookmark({ title, url: url.trim(), folder });
          this.renderBookmarksList();
          this.checkCurrentTabBookmarked();
        });
      }
      if (this.btnExportBookmarksHtml) {
        this.btnExportBookmarksHtml.addEventListener('click', async () => {
          const html = await window.browserAPI.exportBookmarks();
          const blob = new Blob([html], { type: 'text/html' });
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = `bookmarks_${new Date().toISOString().slice(0, 10)}.html`;
          a.click();
          URL.revokeObjectURL(a.href);
        });
      }
      if (this.btnImportBookmarksHtml) {
        this.btnImportBookmarksHtml.addEventListener('click', () => {
          if (this.bookmarksFileInput) this.bookmarksFileInput.click();
        });
      }
      if (this.bookmarksFileInput) {
        this.bookmarksFileInput.addEventListener('change', (e) => {
          const file = e.target.files && e.target.files[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = async (evt) => {
            const html = evt.target.result;
            const res = await window.browserAPI.importBookmarks(html);
            alert(`Imported ${res.imported} bookmark(s) successfully.`);
            await this.refreshBookmarkFolders();
            this.renderBookmarksList();
            this.bookmarksFileInput.value = '';
          };
          reader.readAsText(file);
        });
      }

      // Downloads Modal Controls
      if (this.btnCloseDownloads) this.btnCloseDownloads.addEventListener('click', () => this.closeDownloadsModal());
      if (this.btnDoneDownloads) this.btnDoneDownloads.addEventListener('click', () => this.closeDownloadsModal());
      if (this.btnOpenDownloadsFolder) {
        this.btnOpenDownloadsFolder.addEventListener('click', async () => {
          const settings = await window.browserAPI.getSettings();
          const p = settings && settings.downloadPath ? settings.downloadPath : '';
          await window.browserAPI.showDownloadInFolder({ savePath: p });
        });
      }
      if (this.btnClearCompletedDownloads) {
        this.btnClearCompletedDownloads.addEventListener('click', async () => {
          await window.browserAPI.clearCompletedDownloads();
          this.renderDownloadsList();
        });
      }

      // Find in Page Controls
      if (this.findInput) {
        this.findInput.addEventListener('input', () => {
          const text = this.findInput.value;
          const tab = this.deps.getTargetTab ? this.deps.getTargetTab() : null;
          if (tab && text) {
            window.browserAPI.findInPage(tab.id, text, { findNext: false, forward: true });
          } else if (tab) {
            window.browserAPI.stopFindInPage(tab.id, 'clearSelection');
            if (this.findMatchCount) this.findMatchCount.textContent = '0 / 0';
          }
        });
        this.findInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            const text = this.findInput.value;
            const tab = this.deps.getTargetTab ? this.deps.getTargetTab() : null;
            if (tab && text) {
              window.browserAPI.findInPage(tab.id, text, { findNext: true, forward: !e.shiftKey });
            }
          } else if (e.key === 'Escape') {
            this.closeFindBar();
          }
        });
      }
      if (this.btnFindNext) {
        this.btnFindNext.addEventListener('click', () => {
          const tab = this.deps.getTargetTab ? this.deps.getTargetTab() : null;
          if (tab && this.findInput.value) {
            window.browserAPI.findInPage(tab.id, this.findInput.value, { findNext: true, forward: true });
          }
        });
      }
      if (this.btnFindPrev) {
        this.btnFindPrev.addEventListener('click', () => {
          const tab = this.deps.getTargetTab ? this.deps.getTargetTab() : null;
          if (tab && this.findInput.value) {
            window.browserAPI.findInPage(tab.id, this.findInput.value, { findNext: true, forward: false });
          }
        });
      }
      if (this.btnFindClose) {
        this.btnFindClose.addEventListener('click', () => this.closeFindBar());
      }

      // Permissions Banner Controls
      if (this.btnPermAllow) {
        this.btnPermAllow.addEventListener('click', () => {
          if (this.activePermissionReq) {
            window.browserAPI.respondPermission(this.activePermissionReq.id, true);
            this.hidePermissionBanner();
          }
        });
      }
      if (this.btnPermBlock) {
        this.btnPermBlock.addEventListener('click', () => {
          if (this.activePermissionReq) {
            window.browserAPI.respondPermission(this.activePermissionReq.id, false);
            this.hidePermissionBanner();
          }
        });
      }

      // Address Bar Suggestions Autocomplete
      if (this.urlInput) {
        this.urlInput.addEventListener('input', () => this.handleUrlInput());
        this.urlInput.addEventListener('keydown', (e) => this.handleUrlKeyDown(e));
      }

      // Click outside suggestions closes suggestions
      document.addEventListener('click', (e) => {
        if (!e.target.closest('#url-form')) {
          this.hideSuggestions();
        }
      });
    }

    bindIpcListeners() {
      // Found in page listener
      window.browserAPI.onFoundInPage((result) => {
        if (!this.findMatchCount) return;
        if (result.matches !== undefined) {
          const active = result.activeMatchOrdinal || 0;
          const total = result.matches || 0;
          this.findMatchCount.textContent = `${active} / ${total}`;
        }
      });

      // Downloads updated listener
      window.browserAPI.onDownloadsUpdated((downloads) => {
        const activeCount = downloads.filter((d) => d.state === 'progressing').length;
        if (this.downloadsBadge) {
          this.downloadsBadge.classList.toggle('hidden', activeCount === 0);
        }
        if (this.downloadsStatusSummary) {
          this.downloadsStatusSummary.textContent = `${activeCount} active download${activeCount === 1 ? '' : 's'}`;
        }
        if (this.downloadsModal && !this.downloadsModal.classList.contains('hidden')) {
          this.renderDownloadsList(downloads);
        }
      });

      // Permission prompt listener
      window.browserAPI.onPermissionPrompt((req) => {
        this.activePermissionReq = req;
        if (this.permissionText) {
          this.permissionText.textContent = `${req.origin} wants to use your ${req.permission}`;
        }
        if (this.permissionBanner) {
          this.permissionBanner.classList.remove('hidden');
        }
      });
    }

    hidePermissionBanner() {
      this.activePermissionReq = null;
      if (this.permissionBanner) {
        this.permissionBanner.classList.add('hidden');
      }
    }

    // ==========================================
    // Find In Page
    // ==========================================
    openFindBar() {
      if (!this.findBar) return;
      this.findBar.classList.remove('hidden');
      if (this.findInput) {
        this.findInput.focus();
        this.findInput.select();
      }
    }

    closeFindBar() {
      if (!this.findBar) return;
      this.findBar.classList.add('hidden');
      const tab = this.deps.getTargetTab ? this.deps.getTargetTab() : null;
      if (tab) {
        window.browserAPI.stopFindInPage(tab.id, 'clearSelection');
      }
      if (this.findMatchCount) this.findMatchCount.textContent = '0 / 0';
    }

    // ==========================================
    // Zoom Controls
    // ==========================================
    async zoomIn() {
      const tab = this.deps.getTargetTab ? this.deps.getTargetTab() : null;
      if (!tab) return;
      let factor = this.currentZoomFactors.get(tab.id) || 1.0;
      factor = Math.min(3.0, Math.round((factor + 0.1) * 10) / 10);
      this.currentZoomFactors.set(tab.id, factor);
      await window.browserAPI.setZoom(tab.id, factor);
      this.showZoomPill(factor);
    }

    async zoomOut() {
      const tab = this.deps.getTargetTab ? this.deps.getTargetTab() : null;
      if (!tab) return;
      let factor = this.currentZoomFactors.get(tab.id) || 1.0;
      factor = Math.max(0.3, Math.round((factor - 0.1) * 10) / 10);
      this.currentZoomFactors.set(tab.id, factor);
      await window.browserAPI.setZoom(tab.id, factor);
      this.showZoomPill(factor);
    }

    async resetZoom() {
      const tab = this.deps.getTargetTab ? this.deps.getTargetTab() : null;
      if (!tab) return;
      const factor = 1.0;
      this.currentZoomFactors.set(tab.id, factor);
      await window.browserAPI.setZoom(tab.id, factor);
      this.showZoomPill(factor);
    }

    showZoomPill(factor) {
      if (!this.zoomPill) return;
      this.zoomPill.textContent = `${Math.round(factor * 100)}%`;
      this.zoomPill.classList.remove('hidden');
      this.zoomPill.style.opacity = '1';
      if (this.zoomTimeout) clearTimeout(this.zoomTimeout);
      this.zoomTimeout = setTimeout(() => {
        this.zoomPill.style.opacity = '0';
        setTimeout(() => this.zoomPill.classList.add('hidden'), 300);
      }, 1500);
    }

    // ==========================================
    // Bookmark Star State
    // ==========================================
    async checkCurrentTabBookmarked() {
      const tab = this.deps.getTargetTab ? this.deps.getTargetTab() : null;
      if (!tab || !tab.url || tab.url.startsWith('browser://')) {
        this.updateBookmarkStar(false);
        return;
      }
      const isBookmarked = await window.browserAPI.isBookmarked(tab.url);
      this.updateBookmarkStar(isBookmarked);
    }

    updateBookmarkStar(isBookmarked) {
      if (!this.btnBookmarkStar) return;
      this.btnBookmarkStar.classList.toggle('bookmarked', !!isBookmarked);
      this.btnBookmarkStar.title = isBookmarked ? 'Edit or remove bookmark' : 'Bookmark this tab';
    }

    // ==========================================
    // History Modal
    // ==========================================
    async openHistoryModal() {
      if (!this.historyModal) return;
      if (this.deps.showOverlay) {
        this.deps.showOverlay(this.historyModal);
      } else {
        this.historyModal.classList.remove('hidden');
      }
      if (this.historySearchInput) {
        this.historySearchInput.value = '';
        this.historySearchInput.focus();
      }
      await this.renderHistoryList();
    }

    closeHistoryModal() {
      if (!this.historyModal) return;
      if (this.deps.hideOverlay) {
        this.deps.hideOverlay(this.historyModal);
      } else {
        this.historyModal.classList.add('hidden');
      }
    }

    async renderHistoryList() {
      if (!this.historyListItems) return;
      const query = this.historySearchInput ? this.historySearchInput.value.trim() : '';
      const items = await window.browserAPI.getHistory(query);

      if (!items || items.length === 0) {
        this.historyListItems.innerHTML = `
          <div style="text-align: center; color: #71717a; padding: 40px 0;">
            ${query ? 'No history matching your search.' : 'No browsing history recorded yet.'}
          </div>
        `;
        return;
      }

      this.historyListItems.innerHTML = items.map((item) => `
        <div class="history-item">
          <div class="history-item-left">
            <span class="history-time">${formatDate(item.visitedAt)}</span>
            <div class="history-details">
              <a href="#" class="history-title" data-url="${escapeHtml(item.url)}" title="${escapeHtml(item.title || item.url)}">
                ${escapeHtml(item.title || item.url)}
              </a>
              <span class="history-url">${escapeHtml(item.url)}</span>
            </div>
          </div>
          <button type="button" class="history-delete-btn" data-id="${item.id}" title="Delete from history">&times;</button>
        </div>
      `).join('');

      // Wire clicks
      this.historyListItems.querySelectorAll('.history-title').forEach((link) => {
        link.addEventListener('click', (e) => {
          e.preventDefault();
          const url = link.getAttribute('data-url');
          this.closeHistoryModal();
          if (this.deps.navigate) this.deps.navigate(url);
        });
      });

      this.historyListItems.querySelectorAll('.history-delete-btn').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const id = btn.getAttribute('data-id');
          await window.browserAPI.deleteHistoryEntry(id);
          this.renderHistoryList();
        });
      });
    }

    // ==========================================
    // Bookmarks Modal
    // ==========================================
    async openBookmarksModal() {
      if (!this.bookmarksModal) return;
      if (this.deps.showOverlay) {
        this.deps.showOverlay(this.bookmarksModal);
      } else {
        this.bookmarksModal.classList.remove('hidden');
      }
      await this.refreshBookmarkFolders();
      await this.renderBookmarksList();
    }

    closeBookmarksModal() {
      if (!this.bookmarksModal) return;
      if (this.deps.hideOverlay) {
        this.deps.hideOverlay(this.bookmarksModal);
      } else {
        this.bookmarksModal.classList.add('hidden');
      }
    }

    async refreshBookmarkFolders() {
      if (!this.bookmarksFolderSelect) return;
      const folders = await window.browserAPI.getBookmarkFolders();
      const currentVal = this.bookmarksFolderSelect.value;
      this.bookmarksFolderSelect.innerHTML = (folders || ['Bookmarks Bar', 'Other Bookmarks', 'Developer Resources'])
        .map((f) => `<option value="${escapeHtml(f)}">${escapeHtml(f)}</option>`)
        .join('');
      if (currentVal && folders.includes(currentVal)) {
        this.bookmarksFolderSelect.value = currentVal;
      }
    }

    async renderBookmarksList() {
      if (!this.bookmarksListItems) return;
      const folder = this.bookmarksFolderSelect ? this.bookmarksFolderSelect.value : null;
      const query = this.bookmarksSearchInput ? this.bookmarksSearchInput.value.trim() : '';

      let items = [];
      if (query) {
        items = await window.browserAPI.searchBookmarks(query);
      } else {
        items = await window.browserAPI.getBookmarks(folder);
      }

      if (!items || items.length === 0) {
        this.bookmarksListItems.innerHTML = `
          <div style="text-align: center; color: #71717a; padding: 40px 0;">
            ${query ? 'No bookmarks found matching your search.' : 'No bookmarks in this folder yet.'}
          </div>
        `;
        return;
      }

      this.bookmarksListItems.innerHTML = items.map((b) => `
        <div class="bookmark-item">
          <div class="bookmark-item-left">
            <span>⭐</span>
            <div class="history-details">
              <a href="#" class="bookmark-title" data-url="${escapeHtml(b.url)}">${escapeHtml(b.title || b.url)}</a>
              <span class="history-url">${escapeHtml(b.url)}</span>
            </div>
            ${b.folder ? `<span class="bookmark-folder-badge">${escapeHtml(b.folder)}</span>` : ''}
          </div>
          <div class="bookmark-actions">
            <button type="button" class="toolkit-btn secondary small bookmark-del-btn" data-url="${escapeHtml(b.url)}">Delete</button>
          </div>
        </div>
      `).join('');

      this.bookmarksListItems.querySelectorAll('.bookmark-title').forEach((link) => {
        link.addEventListener('click', (e) => {
          e.preventDefault();
          const url = link.getAttribute('data-url');
          this.closeBookmarksModal();
          if (this.deps.navigate) this.deps.navigate(url);
        });
      });

      this.bookmarksListItems.querySelectorAll('.bookmark-del-btn').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const url = btn.getAttribute('data-url');
          await window.browserAPI.removeBookmark(url);
          this.renderBookmarksList();
          this.checkCurrentTabBookmarked();
        });
      });
    }

    // ==========================================
    // Downloads Modal
    // ==========================================
    async openDownloadsModal() {
      if (!this.downloadsModal) return;
      if (this.deps.showOverlay) {
        this.deps.showOverlay(this.downloadsModal);
      } else {
        this.downloadsModal.classList.remove('hidden');
      }
      await this.renderDownloadsList();
    }

    closeDownloadsModal() {
      if (!this.downloadsModal) return;
      if (this.deps.hideOverlay) {
        this.deps.hideOverlay(this.downloadsModal);
      } else {
        this.downloadsModal.classList.add('hidden');
      }
    }

    async renderDownloadsList(downloadItems) {
      if (!this.downloadsListItems) return;
      const items = downloadItems || (await window.browserAPI.getDownloads());

      if (!items || items.length === 0) {
        this.downloadsListItems.innerHTML = `
          <div style="text-align: center; color: #71717a; padding: 40px 0;">
            No downloads recorded yet.
          </div>
        `;
        return;
      }

      this.downloadsListItems.innerHTML = items.map((d) => {
        const percent = d.totalBytes > 0 ? Math.round((d.receivedBytes / d.totalBytes) * 100) : (d.state === 'completed' ? 100 : 0);
        const sizeInfo = d.totalBytes > 0
          ? `${formatBytes(d.receivedBytes)} / ${formatBytes(d.totalBytes)}`
          : formatBytes(d.receivedBytes);

        return `
          <div class="download-card">
            <div class="download-card-header">
              <span class="download-filename" title="${escapeHtml(d.filename)}">${escapeHtml(d.filename)}</span>
              <span class="download-state-badge ${d.state}">${d.state.toUpperCase()}</span>
            </div>
            <div class="download-progress-container">
              <div class="download-progress-bar" style="width: ${percent}%;"></div>
            </div>
            <div class="download-card-footer">
              <span>${sizeInfo} • ${percent}%</span>
              <div class="download-card-btns">
                ${d.state === 'progressing' ? `
                  <button type="button" class="toolkit-btn secondary small download-pause-btn" data-id="${d.id}">Pause</button>
                  <button type="button" class="toolkit-btn secondary small download-cancel-btn" data-id="${d.id}">Cancel</button>
                ` : ''}
                ${d.state === 'paused' ? `
                  <button type="button" class="toolkit-btn secondary small download-resume-btn" data-id="${d.id}">Resume</button>
                  <button type="button" class="toolkit-btn secondary small download-cancel-btn" data-id="${d.id}">Cancel</button>
                ` : ''}
                ${d.state === 'completed' ? `
                  <button type="button" class="toolkit-btn secondary small download-open-btn" data-id="${d.id}">Open</button>
                  <button type="button" class="toolkit-btn secondary small download-show-btn" data-id="${d.id}">Show in Folder</button>
                ` : ''}
              </div>
            </div>
          </div>
        `;
      }).join('');

      // Wire download action buttons
      this.downloadsListItems.querySelectorAll('.download-pause-btn').forEach((btn) => {
        btn.addEventListener('click', () => window.browserAPI.pauseDownload(btn.getAttribute('data-id')));
      });
      this.downloadsListItems.querySelectorAll('.download-resume-btn').forEach((btn) => {
        btn.addEventListener('click', () => window.browserAPI.resumeDownload(btn.getAttribute('data-id')));
      });
      this.downloadsListItems.querySelectorAll('.download-cancel-btn').forEach((btn) => {
        btn.addEventListener('click', () => window.browserAPI.cancelDownload(btn.getAttribute('data-id')));
      });
      this.downloadsListItems.querySelectorAll('.download-open-btn').forEach((btn) => {
        btn.addEventListener('click', () => window.browserAPI.openDownload(btn.getAttribute('data-id')));
      });
      this.downloadsListItems.querySelectorAll('.download-show-btn').forEach((btn) => {
        btn.addEventListener('click', () => window.browserAPI.showDownloadInFolder(btn.getAttribute('data-id')));
      });
    }

    // ==========================================
    // Address Bar Autocomplete Suggestions
    // ==========================================
    async handleUrlInput() {
      const text = this.urlInput ? this.urlInput.value.trim() : '';
      if (!text || text.length < 1 || text.startsWith('browser://')) {
        this.hideSuggestions();
        return;
      }

      const [histSuggs, bookSuggs, settings] = await Promise.all([
        window.browserAPI.getHistorySuggestions(text),
        window.browserAPI.getBookmarksSuggestions(text),
        window.browserAPI.getSettings(),
      ]);

      const engine = settings && settings.defaultSearchEngine ? settings.defaultSearchEngine : 'DuckDuckGo';

      const list = [
        { type: 'search', title: `Search for "${text}"`, url: text, engine },
      ];

      // Add unique bookmarks
      (bookSuggs || []).forEach((b) => {
        list.push({ type: 'bookmark', title: b.title, url: b.url });
      });

      // Add unique history
      (histSuggs || []).forEach((h) => {
        if (!list.some((existing) => existing.url === h.url)) {
          list.push({ type: 'history', title: h.title, url: h.url });
        }
      });

      this.currentSuggestions = list.slice(0, 7);
      this.selectedSuggestionIndex = -1;
      this.renderSuggestions();
    }

    renderSuggestions() {
      if (!this.urlSuggestions || this.currentSuggestions.length === 0) {
        this.hideSuggestions();
        return;
      }

      this.urlSuggestions.innerHTML = this.currentSuggestions.map((s, idx) => `
        <div class="url-suggestion-item ${idx === this.selectedSuggestionIndex ? 'selected' : ''}" data-idx="${idx}">
          <span class="url-suggestion-icon">${s.type === 'search' ? '🔍' : s.type === 'bookmark' ? '⭐' : '🕒'}</span>
          <div class="url-suggestion-info">
            <span class="url-suggestion-title">${escapeHtml(s.title || s.url)}</span>
            <span class="url-suggestion-url">${s.type === 'search' ? `Search with ${s.engine}` : escapeHtml(s.url)}</span>
          </div>
        </div>
      `).join('');

      this.urlSuggestions.querySelectorAll('.url-suggestion-item').forEach((item) => {
        item.addEventListener('mousedown', (e) => {
          e.preventDefault();
          const idx = parseInt(item.getAttribute('data-idx'), 10);
          this.executeSuggestion(idx);
        });
      });

      this.urlSuggestions.classList.remove('hidden');
    }

    handleUrlKeyDown(e) {
      if (!this.urlSuggestions || this.urlSuggestions.classList.contains('hidden')) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.selectedSuggestionIndex = (this.selectedSuggestionIndex + 1) % this.currentSuggestions.length;
        this.renderSuggestions();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        this.selectedSuggestionIndex = (this.selectedSuggestionIndex - 1 + this.currentSuggestions.length) % this.currentSuggestions.length;
        this.renderSuggestions();
      } else if (e.key === 'Enter') {
        if (this.selectedSuggestionIndex >= 0) {
          e.preventDefault();
          this.executeSuggestion(this.selectedSuggestionIndex);
        }
      } else if (e.key === 'Escape') {
        this.hideSuggestions();
      }
    }

    executeSuggestion(idx) {
      const item = this.currentSuggestions[idx];
      if (!item) return;
      this.hideSuggestions();
      if (this.deps.navigate) {
        this.deps.navigate(item.url);
      }
    }

    hideSuggestions() {
      if (this.urlSuggestions) {
        this.urlSuggestions.classList.add('hidden');
      }
      this.selectedSuggestionIndex = -1;
      this.currentSuggestions = [];
    }
  }

  global.EssentialsControl = EssentialsControl;
})(window);
