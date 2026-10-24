// Proxy / Privacy Routing Controller - UI for toolbar indicator, dropdown, and settings modal
(function (global) {
  'use strict';

  function parseProxyInput(input) {
    let { protocol, host, port, bypassRules, username, password } = input || {};
    protocol = (protocol || 'http').toLowerCase().trim();
    host = (host || '').trim();
    port = port !== undefined && port !== null ? String(port).trim() : '';

    const schemeMatch = host.match(/^([a-zA-Z0-9]+):\/\/(.*)$/);
    if (schemeMatch) {
      const scheme = schemeMatch[1].toLowerCase();
      if (['http', 'https', 'socks5', 'socks'].includes(scheme)) {
        protocol = scheme === 'socks' ? 'socks5' : scheme;
      }
      host = schemeMatch[2];
    }

    if (host.includes('/')) {
      host = host.split('/')[0];
    }

    if (host.includes('@')) {
      const parts = host.split('@');
      const authPart = parts[0];
      host = parts[1];
      if (authPart.includes(':')) {
        const [u, p] = authPart.split(':');
        if (!username) username = decodeURIComponent(u);
        if (!password) password = decodeURIComponent(p);
      } else if (!username) {
        username = decodeURIComponent(authPart);
      }
    }

    if (host.startsWith('[') && host.includes(']:')) {
      const match = host.match(/^\[([a-fA-F0-9:]+)\]:(\d+)$/);
      if (match) {
        host = match[1];
        port = match[2];
      }
    } else if (!host.startsWith('[') && host.includes(':')) {
      const colonCount = (host.match(/:/g) || []).length;
      if (colonCount === 1) {
        const [h, p] = host.split(':');
        host = h;
        port = p;
      }
    }

    if (host.startsWith('[') && host.endsWith(']')) {
      host = host.slice(1, -1);
    }

    return {
      protocol,
      host: host.trim(),
      port: port ? parseInt(port, 10) : undefined,
      bypassRules: bypassRules !== undefined ? String(bypassRules).trim() : undefined,
      username: username !== undefined ? String(username).trim() : undefined,
      password: password !== undefined ? String(password) : undefined,
    };
  }

  function validateProxyConfig(config) {
    if (!config) {
      throw new Error('Proxy configuration is required.');
    }

    const { protocol, host, port } = config;

    if (!['http', 'https', 'socks5'].includes(protocol)) {
      throw new Error(`Invalid protocol "${protocol}". Supported protocols are HTTP, HTTPS, and SOCKS5.`);
    }

    if (!host || typeof host !== 'string' || host.trim() === '') {
      throw new Error('Host cannot be empty.');
    }

    const trimmedHost = host.trim();

    if (trimmedHost.includes('://')) {
      throw new Error('Host must not contain a protocol scheme (e.g. "http://"). Please enter only the hostname or IP address.');
    }

    if (trimmedHost.includes(':')) {
      const ipv6Regex = /^([0-9a-fA-F]{1,4}:){1,7}:?([0-9a-fA-F]{1,4})?$/;
      if (!ipv6Regex.test(trimmedHost) && trimmedHost !== '::1') {
        throw new Error(`Invalid host "${trimmedHost}". Host must not contain a port number or extra colons.`);
      }
    }

    const ipv4Regex = /^((25[0-5]|(2[0-4]|1\d|[1-9]|)\d)\.?\b){4}$/;
    const hostnameRegex = /^([a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?\.)*[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?$/;
    const ipv6Regex = /^([0-9a-fA-F]{1,4}:){1,7}:?([0-9a-fA-F]{1,4})?$/;

    const isIPv4 = ipv4Regex.test(trimmedHost);
    const isHostname = hostnameRegex.test(trimmedHost);
    const isIPv6 = ipv6Regex.test(trimmedHost) || trimmedHost === '::1';

    if (!isIPv4 && !isHostname && !isIPv6 && trimmedHost !== 'localhost') {
      throw new Error(`Invalid host "${trimmedHost}". Host must be a valid domain name or IP address.`);
    }

    const parsedPort = Number(port);
    if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
      throw new Error(`Invalid port "${port}". Port must be an integer between 1 and 65535.`);
    }

    return true;
  }

  class ProxyControl {
    constructor(deps = {}) {
      this.deps = deps; // { showOverlay, hideOverlay, getActiveWorkspaceId, getWorkspaces }
      this.state = null;
      this.editingProfileId = null; // null = adding new, string = editing existing

      this.initDOMElements();
      this.bindEvents();
      this.loadState();
    }

    initDOMElements() {
      // Toolbar Button & Indicator
      this.btnProxy = document.getElementById('btn-proxy');
      this.proxyStatusDot = document.getElementById('proxy-status-dot');

      // Dropdown Elements
      this.dropdown = document.getElementById('proxy-dropdown');
      this.proxyStatusBadge = document.getElementById('proxy-status-badge');
      this.btnTogglePower = document.getElementById('btn-toggle-proxy-power');
      this.quickSelect = document.getElementById('proxy-quick-select');
      this.activeTarget = document.getElementById('proxy-active-target');
      this.killswitchWarning = document.getElementById('proxy-killswitch-warning');
      this.btnResetKillswitch = document.getElementById('btn-reset-killswitch');
      this.btnTestProxy = document.getElementById('btn-test-proxy');
      this.testResults = document.getElementById('proxy-test-results');
      this.testIp = document.getElementById('proxy-test-ip');
      this.testLatency = document.getElementById('proxy-test-latency');
      this.btnOpenSettings = document.getElementById('btn-open-proxy-settings');

      // Settings Modal Elements
      this.modal = document.getElementById('proxy-settings-modal');
      this.btnCloseSettings = document.getElementById('btn-close-proxy-settings');
      this.btnDoneSettings = document.getElementById('btn-done-proxy-settings');
      this.modeTabs = document.querySelectorAll('.proxy-mode-tab');
      this.sectionManual = document.getElementById('proxy-section-manual');
      this.sectionProfile = document.getElementById('proxy-section-profile');

      // Manual Proxy Inputs
      this.manualProtocol = document.getElementById('proxy-manual-protocol');
      this.manualPort = document.getElementById('proxy-manual-port');
      this.manualHost = document.getElementById('proxy-manual-host');
      this.manualBypass = document.getElementById('proxy-manual-bypass');
      this.manualUser = document.getElementById('proxy-manual-user');
      this.manualPass = document.getElementById('proxy-manual-pass');
      this.btnSaveManual = document.getElementById('btn-save-manual-proxy');

      // Profiles Section
      this.profilesList = document.getElementById('proxy-profiles-list');
      this.btnAddProfile = document.getElementById('btn-add-profile');
      this.profileEditor = document.getElementById('proxy-profile-editor');
      this.editorTitle = document.getElementById('proxy-editor-title');
      this.editName = document.getElementById('proxy-edit-name');
      this.editProtocol = document.getElementById('proxy-edit-protocol');
      this.editPort = document.getElementById('proxy-edit-port');
      this.editHost = document.getElementById('proxy-edit-host');
      this.editBypass = document.getElementById('proxy-edit-bypass');
      this.editUser = document.getElementById('proxy-edit-user');
      this.editPass = document.getElementById('proxy-edit-pass');
      this.btnSaveProfileEdit = document.getElementById('btn-save-profile-edit');
      this.btnCancelProfileEdit = document.getElementById('btn-cancel-profile-edit');

      // Options
      this.optKillswitch = document.getElementById('proxy-opt-killswitch');
      this.optWebrtc = document.getElementById('proxy-opt-webrtc');
      this.optEndpoint = document.getElementById('proxy-opt-endpoint');
      this.optPerWorkspace = document.getElementById('proxy-opt-per-workspace');
      this.wsSelectRow = document.getElementById('proxy-workspace-select-row');
      this.currentWsName = document.getElementById('proxy-current-ws-name');
      this.wsProfileSelect = document.getElementById('proxy-workspace-profile-select');
    }

    bindEvents() {
      // Auto-normalize pasted URLs or host:port combinations
      const setupAutoNormalize = (hostEl, protoEl, portEl) => {
        if (!hostEl) return;
        const handler = () => {
          const raw = hostEl.value.trim();
          if (raw.includes('://') || (raw.includes(':') && !raw.startsWith('[') && raw.indexOf(':') === raw.lastIndexOf(':'))) {
            const parsed = parseProxyInput({ host: raw });
            if (parsed.host && parsed.host !== raw) {
              hostEl.value = parsed.host;
              if (parsed.protocol && protoEl) protoEl.value = parsed.protocol;
              if (parsed.port && portEl) portEl.value = parsed.port;
            }
          }
        };
        hostEl.addEventListener('input', handler);
        hostEl.addEventListener('paste', () => setTimeout(handler, 10));
      };
      setupAutoNormalize(this.manualHost, this.manualProtocol, this.manualPort);
      setupAutoNormalize(this.editHost, this.editProtocol, this.editPort);

      // Toggle dropdown menu
      if (this.btnProxy) {
        this.btnProxy.addEventListener('click', (e) => {
          e.stopPropagation();
          this.toggleDropdown();
        });
      }

      // Close dropdown on outside click
      document.addEventListener('click', (e) => {
        if (this.dropdown && !this.dropdown.classList.contains('hidden')) {
          if (!this.dropdown.contains(e.target) && e.target !== this.btnProxy && !this.btnProxy.contains(e.target)) {
            this.closeDropdown();
          }
        }
      });

      // Quick Power Toggle (On/Off)
      if (this.btnTogglePower) {
        this.btnTogglePower.addEventListener('click', async () => {
          if (!this.state) return;
          const newMode = this.state.mode === 'off' ? (this.state.activeProfileId ? 'profile' : 'manual') : 'off';
          await window.browserAPI.setProxyMode(newMode);
        });
      }

      // Quick Profile / Configuration Selector
      if (this.quickSelect) {
        this.quickSelect.addEventListener('change', async () => {
          const val = this.quickSelect.value;
          if (val === 'off') {
            await window.browserAPI.setProxyMode('off');
          } else if (val === 'manual') {
            await window.browserAPI.setProxyMode('manual');
          } else {
            await window.browserAPI.setProxyMode('profile', val);
          }
        });
      }

      // Reset Kill switch button
      if (this.btnResetKillswitch) {
        this.btnResetKillswitch.addEventListener('click', async () => {
          await window.browserAPI.resetProxyKillSwitch();
        });
      }

      // Test Connection Button in dropdown
      if (this.btnTestProxy) {
        this.btnTestProxy.addEventListener('click', () => {
          this.runTestConnection();
        });
      }

      // Open Settings Modal from dropdown
      if (this.btnOpenSettings) {
        this.btnOpenSettings.addEventListener('click', () => {
          this.closeDropdown();
          this.openSettingsModal();
        });
      }

      // Close Settings Modal
      if (this.btnCloseSettings) {
        this.btnCloseSettings.addEventListener('click', () => this.closeSettingsModal());
      }
      if (this.btnDoneSettings) {
        this.btnDoneSettings.addEventListener('click', () => this.closeSettingsModal());
      }

      // Mode tabs in settings modal
      this.modeTabs.forEach((tab) => {
        tab.addEventListener('click', async () => {
          const targetMode = tab.dataset.mode;
          this.switchSettingsMode(targetMode);
          await window.browserAPI.setProxyMode(targetMode);
        });
      });

      // Save Manual Proxy
      if (this.btnSaveManual) {
        this.btnSaveManual.addEventListener('click', async () => {
          await this.saveManualFromForm();
        });
      }

      // Add Profile Button
      if (this.btnAddProfile) {
        this.btnAddProfile.addEventListener('click', () => {
          this.openProfileEditor(null);
        });
      }

      // Cancel Profile Edit
      if (this.btnCancelProfileEdit) {
        this.btnCancelProfileEdit.addEventListener('click', () => {
          this.closeProfileEditor();
        });
      }

      // Save Profile Edit
      if (this.btnSaveProfileEdit) {
        this.btnSaveProfileEdit.addEventListener('click', async () => {
          await this.saveProfileFromEditor();
        });
      }

      // Options changes (Kill Switch, WebRTC, Endpoint)
      if (this.optKillswitch) {
        this.optKillswitch.addEventListener('change', async () => {
          await window.browserAPI.updateProxySettings({ enableKillSwitch: this.optKillswitch.checked });
        });
      }
      if (this.optWebrtc) {
        this.optWebrtc.addEventListener('change', async () => {
          await window.browserAPI.updateProxySettings({ preventWebRTCLeaks: this.optWebrtc.checked });
        });
      }
      if (this.optEndpoint) {
        this.optEndpoint.addEventListener('change', async () => {
          const val = this.optEndpoint.value.trim();
          if (val) {
            await window.browserAPI.updateProxySettings({ testEndpoint: val });
          }
        });
      }

      // Per-workspace toggle
      if (this.optPerWorkspace) {
        this.optPerWorkspace.addEventListener('change', async () => {
          const checked = this.optPerWorkspace.checked;
          if (this.wsSelectRow) this.wsSelectRow.classList.toggle('hidden', !checked);
          await window.browserAPI.updateProxySettings({ perWorkspaceProfiles: checked });
        });
      }

      // Workspace profile assignment select
      if (this.wsProfileSelect) {
        this.wsProfileSelect.addEventListener('change', async () => {
          const activeWsId = this.deps.getActiveWorkspaceId ? this.deps.getActiveWorkspaceId() : null;
          if (!activeWsId) return;
          const assignedProfileId = this.wsProfileSelect.value;
          const update = {
            workspaceProfiles: {
              [activeWsId]: assignedProfileId,
            },
          };
          await window.browserAPI.updateProxySettings(update);
        });
      }

      // Listen for proxy state changes from main process
      if (window.browserAPI && window.browserAPI.onProxyStateChanged) {
        window.browserAPI.onProxyStateChanged((newState) => {
          this.updateState(newState);
        });
      }
    }

    async loadState() {
      try {
        if (window.browserAPI && window.browserAPI.getProxyState) {
          const state = await window.browserAPI.getProxyState();
          if (state) {
            this.updateState(state);
          }
        }
      } catch (err) {
        console.error('[ProxyControl] Failed to load proxy state:', err);
      }
    }

    updateState(state) {
      if (!state) return;
      this.state = state;

      // 1. Update toolbar button dot
      if (this.proxyStatusDot) {
        this.proxyStatusDot.className = `proxy-status-dot ${state.status}`;
      }

      // 2. Update dropdown status badge & text
      if (this.proxyStatusBadge) {
        this.proxyStatusBadge.className = `proxy-status-badge ${state.status}`;
        let label = 'Off';
        if (state.status === 'applying') label = 'Applying...';
        else if (state.status === 'connected') label = 'Connected';
        else if (state.status === 'kill-switch') label = 'Kill Switch';
        else if (state.status === 'error') label = 'Error';
        this.proxyStatusBadge.textContent = label;
      }

      // 3. Update Power toggle button
      if (this.btnTogglePower) {
        if (state.mode === 'off') {
          this.btnTogglePower.textContent = 'Turn ON';
          this.btnTogglePower.className = 'toolkit-btn primary small';
        } else {
          this.btnTogglePower.textContent = 'Turn OFF';
          this.btnTogglePower.className = 'toolkit-btn secondary small';
        }
      }

      // 4. Update Quick Select options
      if (this.quickSelect) {
        this.quickSelect.innerHTML = '';

        const optOff = document.createElement('option');
        optOff.value = 'off';
        optOff.textContent = 'Off (Direct Connection)';
        if (state.mode === 'off') optOff.selected = true;
        this.quickSelect.appendChild(optOff);

        const optManual = document.createElement('option');
        optManual.value = 'manual';
        const m = state.manualProxy;
        optManual.textContent = m && m.host ? `Manual: ${m.protocol.toUpperCase()}://${m.host}:${m.port}` : 'Manual Proxy';
        if (state.mode === 'manual') optManual.selected = true;
        this.quickSelect.appendChild(optManual);

        if (state.profiles && state.profiles.length > 0) {
          const group = document.createElement('optgroup');
          group.label = 'Saved Profiles';
          state.profiles.forEach((p) => {
            const opt = document.createElement('option');
            opt.value = p.id;
            opt.textContent = `${p.name} (${p.protocol.toUpperCase()}://${p.host || 'unset'})`;
            if (state.mode === 'profile' && state.activeProfileId === p.id) {
              opt.selected = true;
            }
            group.appendChild(opt);
          });
          this.quickSelect.appendChild(group);
        }
      }

      // 5. Update Target details string
      if (this.activeTarget) {
        this.activeTarget.textContent = state.activeSummary || 'Direct Connection';
      }

      // 6. Kill Switch warning display
      if (this.killswitchWarning) {
        this.killswitchWarning.classList.toggle('hidden', !state.isKillSwitchEngaged);
      }

      // 7. Update Settings modal fields
      this.populateSettingsModal();
    }

    populateSettingsModal() {
      if (!this.state) return;

      // Mode tabs
      this.modeTabs.forEach((tab) => {
        tab.classList.toggle('active', tab.dataset.mode === this.state.mode);
      });
      this.switchSettingsMode(this.state.mode);

      // Manual Proxy fields
      const m = this.state.manualProxy;
      if (m) {
        if (this.manualProtocol) this.manualProtocol.value = m.protocol || 'http';
        if (this.manualPort) this.manualPort.value = m.port || 8080;
        if (this.manualHost) this.manualHost.value = m.host || '';
        if (this.manualBypass) this.manualBypass.value = m.bypassRules || '<local>, 127.0.0.1, localhost';
        if (this.manualUser) this.manualUser.value = m.auth ? m.auth.username : '';
        if (this.manualPass) {
          this.manualPass.value = '';
          this.manualPass.placeholder = m.auth && m.auth.hasPassword ? '••••••••' : '';
        }
      }

      // Profiles list
      this.renderProfilesList();

      // Checkboxes & Inputs
      if (this.optKillswitch) this.optKillswitch.checked = !!this.state.enableKillSwitch;
      if (this.optWebrtc) this.optWebrtc.checked = !!this.state.preventWebRTCLeaks;
      if (this.optEndpoint) this.optEndpoint.value = this.state.testEndpoint || 'https://api.ipify.org?format=json';

      // Workspace profile settings
      if (this.optPerWorkspace) this.optPerWorkspace.checked = !!this.state.perWorkspaceProfiles;
      if (this.wsSelectRow) this.wsSelectRow.classList.toggle('hidden', !this.state.perWorkspaceProfiles);
      this.updateWorkspaceSelect();
    }

    switchSettingsMode(mode) {
      if (this.sectionManual) this.sectionManual.classList.toggle('hidden', mode !== 'manual');
      if (this.sectionProfile) this.sectionProfile.classList.toggle('hidden', mode !== 'profile');
    }

    renderProfilesList() {
      if (!this.profilesList || !this.state) return;
      this.profilesList.innerHTML = '';

      const profiles = this.state.profiles || [];
      if (profiles.length === 0) {
        this.profilesList.innerHTML = '<div class="text-xs text-muted">No saved profiles. Click "+ Add Profile" above.</div>';
        return;
      }

      profiles.forEach((p) => {
        const item = document.createElement('div');
        const isActive = this.state.mode === 'profile' && this.state.activeProfileId === p.id;
        item.className = `proxy-profile-item ${isActive ? 'active' : ''}`;

        const info = document.createElement('div');
        info.className = 'profile-info';
        info.innerHTML = `
          <div class="profile-name-row">
            <strong>${escapeHtml(p.name)}</strong>
            <span class="profile-proto-badge">${escapeHtml(p.protocol.toUpperCase())}</span>
            ${isActive ? '<span class="profile-active-tag">Active</span>' : ''}
          </div>
          <div class="profile-host-row">
            <code>${escapeHtml(p.host || 'unset')}:${p.port}</code>
            ${p.auth && p.auth.hasAuth ? '<span class="auth-icon" title="Authenticated">🔒</span>' : ''}
          </div>
        `;

        const actions = document.createElement('div');
        actions.className = 'profile-actions';

        const btnUse = document.createElement('button');
        btnUse.type = 'button';
        btnUse.className = `toolkit-btn ${isActive ? 'secondary' : 'primary'} small`;
        btnUse.textContent = isActive ? 'In Use' : 'Use';
        btnUse.disabled = isActive;
        btnUse.addEventListener('click', async () => {
          await window.browserAPI.setProxyMode('profile', p.id);
        });

        const btnEdit = document.createElement('button');
        btnEdit.type = 'button';
        btnEdit.className = 'toolkit-btn secondary small';
        btnEdit.textContent = 'Edit';
        btnEdit.addEventListener('click', () => {
          this.openProfileEditor(p);
        });

        const btnDel = document.createElement('button');
        btnDel.type = 'button';
        btnDel.className = 'toolkit-btn secondary small text-danger';
        btnDel.textContent = '✕';
        btnDel.title = 'Delete Profile';
        btnDel.addEventListener('click', async () => {
          if (confirm(`Delete proxy profile "${p.name}"?`)) {
            await window.browserAPI.deleteProxyProfile(p.id);
          }
        });

        actions.appendChild(btnUse);
        actions.appendChild(btnEdit);
        actions.appendChild(btnDel);

        item.appendChild(info);
        item.appendChild(actions);
        this.profilesList.appendChild(item);
      });
    }

    openProfileEditor(profile = null) {
      if (!this.profileEditor) return;
      this.editingProfileId = profile ? profile.id : null;

      if (this.editorTitle) {
        this.editorTitle.textContent = profile ? `Edit Profile: ${profile.name}` : 'Add New Proxy Profile';
      }

      if (this.editName) this.editName.value = profile ? profile.name : '';
      if (this.editProtocol) this.editProtocol.value = profile ? profile.protocol : 'http';
      if (this.editPort) this.editPort.value = profile ? profile.port : 8080;
      if (this.editHost) this.editHost.value = profile ? profile.host : '';
      if (this.editBypass) this.editBypass.value = profile ? (profile.bypassRules || '<local>, 127.0.0.1, localhost') : '<local>, 127.0.0.1, localhost';
      if (this.editUser) this.editUser.value = profile && profile.auth ? profile.auth.username : '';
      if (this.editPass) {
        this.editPass.value = '';
        this.editPass.placeholder = profile && profile.auth && profile.auth.hasPassword ? '(Unchanged)' : '';
      }

      this.profileEditor.classList.remove('hidden');
      if (this.editName) this.editName.focus();
    }

    closeProfileEditor() {
      this.editingProfileId = null;
      if (this.profileEditor) this.profileEditor.classList.add('hidden');
    }

    async saveProfileFromEditor() {
      const name = (this.editName.value || '').trim();
      const rawHost = (this.editHost.value || '').trim();
      if (!name) {
        alert('Please enter a profile name.');
        return;
      }
      if (!rawHost) {
        alert('Please enter a proxy host or IP.');
        return;
      }

      const parsed = parseProxyInput({
        id: this.editingProfileId || undefined,
        name,
        protocol: this.editProtocol.value || 'http',
        port: this.editPort.value,
        host: rawHost,
        bypassRules: (this.editBypass.value || '').trim(),
        username: (this.editUser.value || '').trim(),
        password: this.editPass.value || undefined,
      });

      try {
        validateProxyConfig(parsed);
      } catch (e) {
        alert(`Validation Error: ${e.message}`);
        return;
      }

      try {
        await window.browserAPI.saveProxyProfile(parsed);
        this.closeProfileEditor();
      } catch (err) {
        alert(`Failed to save profile: ${err.message}`);
      }
    }

    async saveManualFromForm() {
      const rawHost = (this.manualHost.value || '').trim();
      if (!rawHost) {
        alert('Please enter a proxy host.');
        return;
      }

      const parsed = parseProxyInput({
        protocol: this.manualProtocol.value || 'http',
        port: this.manualPort.value,
        host: rawHost,
        bypassRules: (this.manualBypass.value || '').trim(),
        username: (this.manualUser.value || '').trim(),
        password: this.manualPass.value || undefined,
      });

      try {
        validateProxyConfig(parsed);
      } catch (e) {
        alert(`Validation Error: ${e.message}`);
        return;
      }

      // Update fields with normalized values
      this.manualHost.value = parsed.host;
      this.manualProtocol.value = parsed.protocol;
      this.manualPort.value = parsed.port;

      try {
        await window.browserAPI.saveManualProxy(parsed);
        await window.browserAPI.setProxyMode('manual');
      } catch (err) {
        alert(`Failed to apply proxy: ${err.message}`);
      }
    }

    updateWorkspaceSelect() {
      if (!this.wsProfileSelect || !this.state) return;
      this.wsProfileSelect.innerHTML = '';

      const activeWsId = this.deps.getActiveWorkspaceId ? this.deps.getActiveWorkspaceId() : 'ws-main';
      const assigned = this.state.workspaceProfiles ? this.state.workspaceProfiles[activeWsId] : '';

      const optDefault = document.createElement('option');
      optDefault.value = '';
      optDefault.textContent = 'Use Global Proxy Setting';
      if (!assigned) optDefault.selected = true;
      this.wsProfileSelect.appendChild(optDefault);

      const optOff = document.createElement('option');
      optOff.value = 'off';
      optOff.textContent = 'Always Direct (Proxy Off for this workspace)';
      if (assigned === 'off') optOff.selected = true;
      this.wsProfileSelect.appendChild(optOff);

      if (this.state.profiles && this.state.profiles.length > 0) {
        const group = document.createElement('optgroup');
        group.label = 'Profiles';
        this.state.profiles.forEach((p) => {
          const opt = document.createElement('option');
          opt.value = p.id;
          opt.textContent = p.name;
          if (assigned === p.id) opt.selected = true;
          group.appendChild(opt);
        });
        this.wsProfileSelect.appendChild(group);
      }
    }

    async runTestConnection() {
      if (!this.btnTestProxy) return;
      this.btnTestProxy.disabled = true;
      this.btnTestProxy.textContent = 'Testing connection...';

      if (this.testResults) this.testResults.classList.remove('hidden');
      const testProxyIp = document.getElementById('proxy-test-proxy-ip');
      const testRealIp = document.getElementById('proxy-test-real-ip');
      const warningBanner = document.getElementById('proxy-test-warning-banner');

      if (testProxyIp) testProxyIp.textContent = 'Testing...';
      if (testRealIp) testRealIp.textContent = 'Checking...';
      if (this.testIp) this.testIp.textContent = 'Testing...';
      if (this.testLatency) this.testLatency.textContent = '...';
      if (warningBanner) {
        warningBanner.className = 'proxy-test-warning-banner hidden';
        warningBanner.textContent = '';
      }

      try {
        const res = await window.browserAPI.testProxyConnection();
        if (res && res.success) {
          const proxyIpStr = res.proxyIP || res.ip || 'Unknown';
          const realIpStr = res.realIP || 'Unknown';

          if (testProxyIp) testProxyIp.textContent = proxyIpStr;
          if (testRealIp) testRealIp.textContent = realIpStr;
          if (this.testIp) this.testIp.textContent = proxyIpStr;
          if (this.testLatency) this.testLatency.textContent = `${res.latency} ms`;

          if (warningBanner) {
            warningBanner.classList.remove('hidden');
            if (res.isLeaking) {
              warningBanner.className = 'proxy-test-warning-banner leak';
              warningBanner.textContent = `⚠️ LEAK WARNING: Proxy IP matches your Real IP (${realIpStr})! Traffic is bypassing the proxy or direct connection is being used.`;
            } else if (res.proxyIP && res.realIP && res.proxyIP !== res.realIP) {
              warningBanner.className = 'proxy-test-warning-banner protected';
              warningBanner.textContent = `✅ Protected: Proxy IP (${res.proxyIP}) is masking your Real IP (${res.realIP}).`;
            } else {
              warningBanner.className = 'proxy-test-warning-banner protected';
              warningBanner.textContent = `Direct connection: Public IP is ${res.realIP || res.ip}.`;
            }
          }
        } else {
          const errMsg = (res && res.error) ? res.error : 'Proxy unreachable';
          if (testProxyIp) testProxyIp.textContent = 'Failed';
          if (testRealIp) testRealIp.textContent = (res && res.realIP) ? res.realIP : 'Unknown';
          if (this.testIp) this.testIp.textContent = 'Failed';
          if (this.testLatency) this.testLatency.textContent = (res && res.latency) ? `${res.latency} ms` : '-';
          if (warningBanner) {
            warningBanner.classList.remove('hidden');
            warningBanner.className = 'proxy-test-warning-banner error';
            warningBanner.textContent = `❌ Test Failed: ${errMsg}`;
          }
        }
      } catch (err) {
        if (testProxyIp) testProxyIp.textContent = 'Error';
        if (this.testLatency) this.testLatency.textContent = '-';
        if (warningBanner) {
          warningBanner.classList.remove('hidden');
          warningBanner.className = 'proxy-test-warning-banner error';
          warningBanner.textContent = `❌ Error: ${err.message}`;
        }
      } finally {
        this.btnTestProxy.disabled = false;
        this.btnTestProxy.textContent = 'Test Connection & Echo IP';
      }
    }

    toggleDropdown() {
      if (!this.dropdown) return;
      const isHidden = this.dropdown.classList.contains('hidden');
      if (isHidden) {
        this.openDropdown();
      } else {
        this.closeDropdown();
      }
    }

    openDropdown() {
      if (!this.dropdown) return;
      if (this.deps.showOverlay) {
        this.deps.showOverlay(this.dropdown);
      } else {
        this.dropdown.classList.remove('hidden');
      }
    }

    closeDropdown() {
      if (!this.dropdown) return;
      if (this.deps.hideOverlay) {
        this.deps.hideOverlay(this.dropdown);
      } else {
        this.dropdown.classList.add('hidden');
      }
    }

    openSettingsModal() {
      if (!this.modal) return;
      this.populateSettingsModal();
      if (this.deps.showOverlay) {
        this.deps.showOverlay(this.modal);
      } else {
        this.modal.classList.remove('hidden');
      }
    }

    closeSettingsModal() {
      if (!this.modal) return;
      this.closeProfileEditor();
      if (this.deps.hideOverlay) {
        this.deps.hideOverlay(this.modal);
      } else {
        this.modal.classList.add('hidden');
      }
    }

    onWorkspaceSwitched(workspaceId, workspaceName) {
      if (this.currentWsName && workspaceName) {
        this.currentWsName.textContent = workspaceName;
      }
      this.updateWorkspaceSelect();
    }
  }

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

  global.ProxyControl = ProxyControl;
})(window);
