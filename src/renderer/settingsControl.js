// Settings Controller - Step 10 Part B: Unified browser://settings and first-run onboarding
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

  class SettingsControl {
    constructor(deps) {
      this.deps = deps || {};
      this.initDOMElements();
      this.bindEvents();
    }

    initDOMElements() {
      // Toolbar Settings button
      this.btnOpenSettings = document.getElementById('btn-open-settings');

      // Unified Settings Modal
      this.modal = document.getElementById('unified-settings-modal');
      this.btnClose = document.getElementById('btn-close-unified-settings');
      this.btnDone = document.getElementById('btn-done-unified-settings');
      this.tabButtons = document.querySelectorAll('.settings-tab-btn');
      this.panes = document.querySelectorAll('.settings-pane');

      // General settings fields
      this.searchEngineSelect = document.getElementById('setting-search-engine');
      this.downloadPathInput = document.getElementById('setting-download-path');
      this.btnChangeDownloadPath = document.getElementById('btn-change-download-path');
      this.askSaveCheckbox = document.getElementById('setting-ask-save');
      this.restoreSessionCheckbox = document.getElementById('setting-restore-session');
      this.newTabPosSelect = document.getElementById('setting-new-tab-pos');

      // Privacy settings fields
      this.adblockToggle = document.getElementById('setting-adblock-toggle');
      this.btnOpenProxy = document.getElementById('btn-settings-open-proxy');
      this.btnResetAllPerms = document.getElementById('btn-reset-all-perms');
      this.permissionsList = document.getElementById('settings-permissions-list');
      this.btnClearData = document.getElementById('btn-settings-clear-data');

      // Performance fields
      this.suspenderToggle = document.getElementById('setting-suspender-toggle');
      this.suspenderMinutes = document.getElementById('setting-suspender-minutes');
      this.btnSuspendNow = document.getElementById('btn-settings-suspend-now');
      this.btnOpenMemory = document.getElementById('btn-settings-open-memory');
      this.btnOpenGpu = document.getElementById('btn-settings-open-gpu');

      // Workspaces fields
      this.btnNewWorkspace = document.getElementById('btn-settings-new-workspace');
      this.workspacesList = document.getElementById('settings-workspaces-list');

      // AI fields
      this.btnOpenAi = document.getElementById('btn-settings-open-ai');

      // Developer fields
      this.customUaInput = document.getElementById('setting-custom-ua');
      this.disableCacheCheckbox = document.getElementById('setting-disable-cache');

      // Update check
      this.btnCheckUpdates = document.getElementById('btn-check-updates');
      this.updateStatusLabel = document.getElementById('update-status-label');

      // Welcome Modal (First Run)
      this.welcomeModal = document.getElementById('welcome-modal');
      this.welcomeSearchSelect = document.getElementById('welcome-search-engine');
      this.btnWelcomeImport = document.getElementById('btn-welcome-import');
      this.welcomeFileInput = document.getElementById('welcome-file-input');
      this.welcomeImportStatus = document.getElementById('welcome-import-status');
      this.btnWelcomeGetStarted = document.getElementById('btn-welcome-get-started');
    }

    bindEvents() {
      // Toolbar open settings button
      if (this.btnOpenSettings) {
        this.btnOpenSettings.addEventListener('click', () => this.openSettingsModal('general'));
      }

      // Close buttons
      if (this.btnClose) this.btnClose.addEventListener('click', () => this.closeSettingsModal());
      if (this.btnDone) this.btnDone.addEventListener('click', () => this.closeSettingsModal());

      // Tab switching in Settings Modal
      this.tabButtons.forEach((btn) => {
        btn.addEventListener('click', () => {
          const tabName = btn.getAttribute('data-tab');
          this.switchTab(tabName);
        });
      });

      // General setting field changes
      if (this.searchEngineSelect) {
        this.searchEngineSelect.addEventListener('change', async (e) => {
          await window.browserAPI.updateSettings({ defaultSearchEngine: e.target.value });
        });
      }
      if (this.askSaveCheckbox) {
        this.askSaveCheckbox.addEventListener('change', async (e) => {
          await window.browserAPI.updateSettings({ askWhereToSave: e.target.checked });
        });
      }
      if (this.restoreSessionCheckbox) {
        this.restoreSessionCheckbox.addEventListener('change', async (e) => {
          await window.browserAPI.updateSettings({ restoreLastSession: e.target.checked });
        });
      }
      if (this.newTabPosSelect) {
        this.newTabPosSelect.addEventListener('change', async (e) => {
          await window.browserAPI.updateSettings({ openNewTabPosition: e.target.value });
        });
      }
      if (this.btnChangeDownloadPath) {
        this.btnChangeDownloadPath.addEventListener('click', async () => {
          const p = prompt('Enter default downloads directory path:', this.downloadPathInput.value);
          if (p && p.trim()) {
            await window.browserAPI.updateSettings({ downloadPath: p.trim() });
            this.downloadPathInput.value = p.trim();
          }
        });
      }

      // Check for updates
      if (this.btnCheckUpdates) {
        this.btnCheckUpdates.addEventListener('click', async () => {
          if (this.updateStatusLabel) this.updateStatusLabel.textContent = 'Checking for updates...';
          const res = await window.browserAPI.checkForUpdates();
          if (res && res.hasUpdate) {
            if (this.updateStatusLabel) this.updateStatusLabel.textContent = `Update available: v${res.latestVersion}`;
            if (confirm(`An update is available (v${res.latestVersion}). Download now?`)) {
              window.browserAPI.openDownloadPage(res.downloadUrl);
            }
          } else if (res && res.status === 'up-to-date') {
            if (this.updateStatusLabel) this.updateStatusLabel.textContent = `You're on the latest version (v${res.currentVersion}).`;
          } else {
            if (this.updateStatusLabel) this.updateStatusLabel.textContent = (res && res.message) || 'Update check complete.';
          }
        });
      }

      if (window.browserAPI && window.browserAPI.onUpdateAvailable) {
        window.browserAPI.onUpdateAvailable((info) => {
          if (confirm(`An update is available (${info.releaseName || 'v' + info.latestVersion}). Download now?`)) {
            window.browserAPI.openDownloadPage(info.downloadUrl);
          }
        });
      }

      // Privacy fields
      if (this.adblockToggle) {
        this.adblockToggle.addEventListener('change', async (e) => {
          await window.browserAPI.updateSettings({ adBlockEnabled: e.target.checked });
        });
      }
      if (this.btnOpenProxy) {
        this.btnOpenProxy.addEventListener('click', () => {
          this.closeSettingsModal();
          if (window.proxyControl) window.proxyControl.openSettingsModal();
        });
      }
      if (this.btnResetAllPerms) {
        this.btnResetAllPerms.addEventListener('click', async () => {
          if (confirm('Are you sure you want to reset all site permissions? Sites will need to ask again.')) {
            const perms = await window.browserAPI.getAllPermissions();
            for (const origin of Object.keys(perms || {})) {
              for (const perm of Object.keys(perms[origin] || {})) {
                await window.browserAPI.revokePermission(origin, perm);
              }
            }
            this.renderPermissionsList();
          }
        });
      }
      if (this.btnClearData) {
        this.btnClearData.addEventListener('click', async () => {
          if (confirm('Clear all browsing history, cached downloads history, and session data?')) {
            await window.browserAPI.clearHistory();
            await window.browserAPI.clearCompletedDownloads();
            alert('Browsing data cleared.');
          }
        });
      }

      // Performance fields
      if (this.suspenderToggle) {
        this.suspenderToggle.addEventListener('change', async (e) => {
          await window.browserAPI.updateSuspenderSettings({ enabled: e.target.checked });
          await window.browserAPI.updateSettings({ tabSuspenderEnabled: e.target.checked });
        });
      }
      if (this.suspenderMinutes) {
        this.suspenderMinutes.addEventListener('change', async (e) => {
          const mins = Math.max(1, parseInt(e.target.value, 10) || 10);
          await window.browserAPI.updateSuspenderSettings({ idleMinutes: mins });
          await window.browserAPI.updateSettings({ tabSuspenderIdleMinutes: mins });
        });
      }
      if (this.btnSuspendNow) {
        this.btnSuspendNow.addEventListener('click', async () => {
          const targetTab = this.deps.getTargetTab ? this.deps.getTargetTab() : null;
          await window.browserAPI.suspendOtherTabs(targetTab ? targetTab.id : null);
          alert('Background tabs suspended to save RAM.');
        });
      }
      if (this.btnOpenMemory) {
        this.btnOpenMemory.addEventListener('click', () => {
          this.closeSettingsModal();
          if (typeof global.openMemoryDashboard === 'function') global.openMemoryDashboard();
        });
      }
      if (this.btnOpenGpu) {
        this.btnOpenGpu.addEventListener('click', () => {
          this.closeSettingsModal();
          if (window.toolkitPanel) window.toolkitPanel.openGpuDiagnostics();
        });
      }

      // Workspaces fields
      if (this.btnNewWorkspace) {
        this.btnNewWorkspace.addEventListener('click', () => {
          this.closeSettingsModal();
          if (typeof global.openWorkspaceModal === 'function') global.openWorkspaceModal(null);
        });
      }

      // AI fields
      if (this.btnOpenAi) {
        this.btnOpenAi.addEventListener('click', () => {
          this.closeSettingsModal();
          if (window.aiPanel) window.aiPanel.openSettingsModal();
        });
      }

      // Developer fields
      if (this.customUaInput) {
        this.customUaInput.addEventListener('change', async (e) => {
          await window.browserAPI.updateSettings({ customUserAgent: e.target.value.trim() });
        });
      }
      if (this.disableCacheCheckbox) {
        this.disableCacheCheckbox.addEventListener('change', async (e) => {
          await window.browserAPI.updateSettings({ disableCache: e.target.checked });
        });
      }

      // Welcome Modal Events (First Run)
      if (this.btnWelcomeImport) {
        this.btnWelcomeImport.addEventListener('click', () => {
          if (this.welcomeFileInput) this.welcomeFileInput.click();
        });
      }
      if (this.welcomeFileInput) {
        this.welcomeFileInput.addEventListener('change', (e) => {
          const file = e.target.files && e.target.files[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = async (evt) => {
            const html = evt.target.result;
            const res = await window.browserAPI.importBookmarks(html);
            if (this.welcomeImportStatus) {
              this.welcomeImportStatus.textContent = `✓ Imported ${res.imported || 0} bookmarks`;
            }
          };
          reader.readAsText(file);
        });
      }
      if (this.btnWelcomeGetStarted) {
        this.btnWelcomeGetStarted.addEventListener('click', async () => {
          const engine = this.welcomeSearchSelect ? this.welcomeSearchSelect.value : 'duckduckgo';
          const privacyRadio = document.querySelector('input[name="welcome-privacy"]:checked');
          const isStrict = privacyRadio && privacyRadio.value === 'strict';

          await window.browserAPI.updateSettings({
            defaultSearchEngine: engine,
            firstRunDone: true,
            adBlockEnabled: true,
          });

          this.closeWelcomeModal();

          // Navigate active tab to chosen search engine
          const targetTab = this.deps.getTargetTab ? this.deps.getTargetTab() : null;
          if (targetTab && this.deps.navigate) {
            let startUrl = 'https://duckduckgo.com';
            if (engine === 'google') startUrl = 'https://www.google.com';
            else if (engine === 'bing') startUrl = 'https://www.bing.com';
            else if (engine === 'brave') startUrl = 'https://search.brave.com';
            else if (engine === 'ecosia') startUrl = 'https://www.ecosia.org';
            this.deps.navigate(startUrl);
          }
        });
      }
    }

    switchTab(tabName) {
      this.tabButtons.forEach((b) => {
        b.classList.toggle('active', b.getAttribute('data-tab') === tabName);
      });
      this.panes.forEach((p) => {
        p.classList.toggle('hidden', p.id !== `settings-pane-${tabName}`);
      });

      if (tabName === 'privacy') {
        this.renderPermissionsList();
      } else if (tabName === 'workspaces') {
        this.renderWorkspacesList();
      }
    }

    async openSettingsModal(initialTab = 'general') {
      if (!this.modal) return;
      if (this.deps.showOverlay) {
        this.deps.showOverlay(this.modal);
      } else {
        this.modal.classList.remove('hidden');
      }

      await this.loadAllSettings();
      this.switchTab(initialTab);
    }

    closeSettingsModal() {
      if (!this.modal) return;
      if (this.deps.hideOverlay) {
        this.deps.hideOverlay(this.modal);
      } else {
        this.modal.classList.add('hidden');
      }
    }

    async loadAllSettings() {
      const settings = await window.browserAPI.getSettings();
      if (!settings) return;

      if (this.searchEngineSelect) this.searchEngineSelect.value = settings.defaultSearchEngine || 'duckduckgo';
      if (this.downloadPathInput) this.downloadPathInput.value = settings.downloadPath || '';
      if (this.askSaveCheckbox) this.askSaveCheckbox.checked = !!settings.askWhereToSave;
      if (this.restoreSessionCheckbox) this.restoreSessionCheckbox.checked = settings.restoreLastSession !== false;
      if (this.newTabPosSelect) this.newTabPosSelect.value = settings.openNewTabPosition || 'after-current';

      if (this.adblockToggle) this.adblockToggle.checked = settings.adBlockEnabled !== false;
      if (this.suspenderToggle) this.suspenderToggle.checked = settings.tabSuspenderEnabled !== false;
      if (this.suspenderMinutes) this.suspenderMinutes.value = String(settings.tabSuspenderIdleMinutes || 10);

      if (this.customUaInput) this.customUaInput.value = settings.customUserAgent || '';
      if (this.disableCacheCheckbox) this.disableCacheCheckbox.checked = !!settings.disableCache;
    }

    async renderPermissionsList() {
      if (!this.permissionsList) return;
      const perms = await window.browserAPI.getAllPermissions();
      const origins = Object.keys(perms || {});

      if (origins.length === 0) {
        this.permissionsList.innerHTML = '<span class="text-xs text-muted" style="text-align: center; padding: 12px;">No site permissions saved yet.</span>';
        return;
      }

      let html = '';
      origins.forEach((origin) => {
        const sitePerms = perms[origin] || {};
        Object.keys(sitePerms).forEach((pName) => {
          const decision = sitePerms[pName];
          html += `
            <div class="perm-item-row">
              <div>
                <strong>${escapeHtml(origin)}</strong>
                <span class="text-xs text-muted"> • ${escapeHtml(pName)}: </span>
                <span style="color: ${decision === 'allow' ? '#4ade80' : '#f87171'}; font-weight: 600;">${decision.toUpperCase()}</span>
              </div>
              <button type="button" class="toolkit-btn secondary small perm-revoke-btn" data-origin="${escapeHtml(origin)}" data-perm="${escapeHtml(pName)}">Revoke</button>
            </div>
          `;
        });
      });

      this.permissionsList.innerHTML = html;
      this.permissionsList.querySelectorAll('.perm-revoke-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const origin = btn.getAttribute('data-origin');
          const perm = btn.getAttribute('data-perm');
          await window.browserAPI.revokePermission(origin, perm);
          this.renderPermissionsList();
        });
      });
    }

    renderWorkspacesList() {
      if (!this.workspacesList) return;
      const workspaces = this.deps.getWorkspaces ? this.deps.getWorkspaces() : [];
      if (!workspaces || workspaces.length === 0) {
        this.workspacesList.innerHTML = '<span class="text-xs text-muted">No workspaces found.</span>';
        return;
      }

      this.workspacesList.innerHTML = workspaces.map((ws) => `
        <div class="ws-setting-item">
          <div>
            <span class="ws-setting-color" style="background-color: ${ws.color || '#3b82f6'};"></span>
            <strong>${escapeHtml(ws.name)}</strong>
          </div>
          <span class="text-xs text-muted">${ws.tabs ? ws.tabs.length : 0} tabs</span>
        </div>
      `).join('');
    }

    // ==========================================
    // First Run Check & Modal
    // ==========================================
    async checkFirstRun() {
      const settings = await window.browserAPI.getSettings();
      if (settings && settings.firstRunDone === false) {
        this.openWelcomeModal();
      }
    }

    openWelcomeModal() {
      if (!this.welcomeModal) return;
      if (this.deps.showOverlay) {
        this.deps.showOverlay(this.welcomeModal);
      } else {
        this.welcomeModal.classList.remove('hidden');
      }
    }

    closeWelcomeModal() {
      if (!this.welcomeModal) return;
      if (this.deps.hideOverlay) {
        this.deps.hideOverlay(this.welcomeModal);
      } else {
        this.welcomeModal.classList.add('hidden');
      }
    }
  }

  global.SettingsControl = SettingsControl;
})(window);
