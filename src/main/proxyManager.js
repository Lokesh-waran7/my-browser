// Proxy Manager - Orchestrates Electron session proxy configuration, authentication, leak prevention, and kill switch
const { app, safeStorage, session } = require('electron');
const path = require('path');
const fs = require('fs');

/**
 * Parses and normalizes user input into valid proxy fields.
 * Handles pasted values like "host:port", "http://host:port", "socks5://host:port", or IPv6 "[::1]:8080".
 */
function parseProxyInput(input) {
  let { protocol, host, port, bypassRules, username, password } = input || {};
  protocol = (protocol || 'http').toLowerCase().trim();
  host = (host || '').trim();
  port = port !== undefined && port !== null ? String(port).trim() : '';

  // 1. If host starts with a scheme
  const schemeMatch = host.match(/^([a-zA-Z0-9]+):\/\/(.*)$/);
  if (schemeMatch) {
    const scheme = schemeMatch[1].toLowerCase();
    if (['http', 'https', 'socks5', 'socks'].includes(scheme)) {
      protocol = scheme === 'socks' ? 'socks5' : scheme;
    }
    host = schemeMatch[2];
  }

  // 2. Strip any trailing paths or slashes
  if (host.includes('/')) {
    host = host.split('/')[0];
  }

  // 3. Extract credentials if embedded (user:pass@host)
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

  // 4. Extract port from host if present
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

  // Strip IPv6 brackets if remaining
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

/**
 * Validates proxy fields strictly. Host must have no scheme or port. Port must be 1-65535.
 */
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

class ProxyManager {
  constructor(mainWindow, targetSession = null) {
    this.mainWindow = mainWindow;
    this.targetSession = targetSession || session.defaultSession;
    this.userDataPath = app.getPath('userData');
    this.settingsFilePath = path.join(this.userDataPath, 'proxy-settings.json');

    // Default settings with no hardcoded third-party providers
    this.settings = {
      mode: 'off', // 'off' | 'manual' | 'profile'
      activeProfileId: 'prof-work',
      manualProxy: {
        protocol: 'http', // 'http' | 'https' | 'socks5'
        host: '',
        port: 8080,
        bypassRules: '<local>, 127.0.0.1, localhost',
        auth: {
          hasAuth: false,
          username: '',
          encryptedPassword: '',
        },
      },
      profiles: [
        {
          id: 'prof-work',
          name: 'Work',
          protocol: 'http',
          host: '',
          port: 8080,
          bypassRules: '<local>, 127.0.0.1, localhost',
          auth: {
            hasAuth: false,
            username: '',
            encryptedPassword: '',
          },
        },
        {
          id: 'prof-home',
          name: 'Home',
          protocol: 'socks5',
          host: '',
          port: 1080,
          bypassRules: '<local>, 127.0.0.1, localhost',
          auth: {
            hasAuth: false,
            username: '',
            encryptedPassword: '',
          },
        },
        {
          id: 'prof-test',
          name: 'Test',
          protocol: 'http',
          host: '',
          port: 8888,
          bypassRules: '<local>, 127.0.0.1, localhost',
          auth: {
            hasAuth: false,
            username: '',
            encryptedPassword: '',
          },
        },
      ],
      enableKillSwitch: false,
      preventWebRTCLeaks: true,
      testEndpoint: 'https://api.ipify.org?format=json',
      perWorkspaceProfiles: false,
      workspaceProfiles: {}, // workspaceId -> profileId or 'off'
    };

    this.currentStatus = 'off'; // 'off' | 'applying' | 'connected' | 'error' | 'kill-switch'
    this.isKillSwitchEngaged = false;
    this.killSwitchError = null;
    this.lastTestResult = null;
    this.lastVerificationError = null;
    this.activeWorkspaceId = null;
    this.currentWebRTCPolicy = 'default';
    this.tabManager = null;

    app.on('web-contents-created', (event, contents) => {
      try {
        if (contents && typeof contents.setWebRTCIPHandlingPolicy === 'function') {
          contents.setWebRTCIPHandlingPolicy(this.currentWebRTCPolicy);
        }
      } catch (e) {}
    });

    this.setupKillSwitchInterceptor();
    this.loadSettings();
    this.registerAuthHandler();
  }

  /**
   * Sets up a webRequest interceptor that drops all traffic when Kill Switch is engaged.
   */
  setupKillSwitchInterceptor() {
    if (this.targetSession && this.targetSession.webRequest) {
      this.targetSession.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, callback) => {
        if (this.isKillSwitchEngaged && this.settings.enableKillSwitch) {
          if (details.url.startsWith('file:') || details.url.startsWith('devtools:')) {
            return callback({});
          }
          return callback({ cancel: true });
        }
        callback({});
      });
    }
  }

  /**
   * Initializes proxy configuration on startup.
   */
  async init() {
    await this.applyProxy();
  }

  /**
   * Loads settings from disk.
   */
  loadSettings() {
    try {
      if (fs.existsSync(this.settingsFilePath)) {
        const raw = fs.readFileSync(this.settingsFilePath, 'utf-8');
        const data = JSON.parse(raw);
        if (data.mode) this.settings.mode = data.mode;
        if (data.activeProfileId) this.settings.activeProfileId = data.activeProfileId;
        if (data.manualProxy) this.settings.manualProxy = { ...this.settings.manualProxy, ...data.manualProxy };
        if (Array.isArray(data.profiles)) this.settings.profiles = data.profiles;
        if (typeof data.enableKillSwitch === 'boolean') this.settings.enableKillSwitch = data.enableKillSwitch;
        if (typeof data.preventWebRTCLeaks === 'boolean') this.settings.preventWebRTCLeaks = data.preventWebRTCLeaks;
        if (data.testEndpoint) this.settings.testEndpoint = data.testEndpoint;
        if (typeof data.perWorkspaceProfiles === 'boolean') this.settings.perWorkspaceProfiles = data.perWorkspaceProfiles;
        if (data.workspaceProfiles && typeof data.workspaceProfiles === 'object') {
          this.settings.workspaceProfiles = data.workspaceProfiles;
        }
      }
    } catch (e) {
      console.warn('[ProxyManager] Failed to load proxy settings:', e.message);
    }
  }

  /**
   * Saves settings to disk.
   */
  saveSettings() {
    try {
      fs.writeFileSync(this.settingsFilePath, JSON.stringify(this.settings, null, 2), 'utf-8');
    } catch (e) {
      console.error('[ProxyManager] Failed to save proxy settings:', e.message);
    }
  }

  /**
   * Encrypts a sensitive credential using Electron safeStorage.
   */
  encryptCredential(plainText) {
    if (!plainText) return '';
    try {
      if (safeStorage && safeStorage.isEncryptionAvailable()) {
        return safeStorage.encryptString(plainText).toString('base64');
      } else {
        return 'RAW:' + Buffer.from(plainText).toString('base64');
      }
    } catch (err) {
      console.error('[ProxyManager] Credential encryption error:', err.message);
      return '';
    }
  }

  /**
   * Decrypts an encrypted credential.
   */
  decryptCredential(cipherText) {
    if (!cipherText) return '';
    try {
      if (cipherText.startsWith('RAW:')) {
        return Buffer.from(cipherText.slice(4), 'base64').toString('utf-8');
      }
      const buf = Buffer.from(cipherText, 'base64');
      if (safeStorage && safeStorage.isEncryptionAvailable()) {
        return safeStorage.decryptString(buf);
      }
    } catch (err) {
      console.error('[ProxyManager] Credential decryption error:', err.message);
    }
    return '';
  }

  /**
   * Registers handler for HTTP/SOCKS proxy authentication ('login' event).
   */
  registerAuthHandler() {
    app.on('login', (event, webContents, request, authInfo, callback) => {
      if (!authInfo || !authInfo.isProxy) return;

      const activeConfig = this.getActiveProxyConfig();
      if (!activeConfig || !activeConfig.auth || !activeConfig.auth.hasAuth) {
        return;
      }

      const username = activeConfig.auth.username || '';
      const password = this.decryptCredential(activeConfig.auth.encryptedPassword || '');

      if (username) {
        event.preventDefault();
        callback(username, password);
      }
    });
  }

  /**
   * Resolves the active proxy configuration object based on mode and active workspace.
   */
  getActiveProxyConfig() {
    // 1. If master mode is off, routing is off
    if (this.settings.mode === 'off') {
      return null;
    }

    // 2. Check per-workspace assignment if enabled
    if (this.settings.perWorkspaceProfiles && this.activeWorkspaceId) {
      const wsConfig = this.settings.workspaceProfiles[this.activeWorkspaceId];
      if (wsConfig === 'off') {
        return null;
      }
      if (wsConfig) {
        const found = this.settings.profiles.find((p) => p.id === wsConfig);
        if (found) return found;
      }
    }

    // 3. Global mode
    if (this.settings.mode === 'manual') {
      return this.settings.manualProxy;
    }
    if (this.settings.mode === 'profile') {
      return this.settings.profiles.find((p) => p.id === this.settings.activeProfileId) || null;
    }

    return null;
  }

  /**
   * Builds the proxyRules string for Electron session.setProxy().
   */
  buildProxyRules(config) {
    if (!config || !config.host) return '';
    const protocol = (config.protocol || 'http').toLowerCase();
    const host = config.host.trim();
    const port = config.port || (protocol === 'socks5' ? 1080 : 8080);

    if (protocol === 'socks5') {
      // In Chromium, socks5:// routes all TCP/UDP traffic and resolves DNS on proxy
      return `socks5://${host}:${port}`;
    }
    if (protocol === 'https') {
      return `https=${host}:${port};http=${host}:${port}`;
    }
    // Default HTTP
    return `http=${host}:${port};https=${host}:${port}`;
  }

  /**
   * Applies the WebRTC IP handling policy across all webContents and sets the default for future ones.
   */
  applyWebRTCPolicy(policy) {
    this.currentWebRTCPolicy = policy;
    const { webContents } = require('electron');
    if (!webContents || typeof webContents.getAllWebContents !== 'function') return;
    const allContents = webContents.getAllWebContents();
    for (const wc of allContents) {
      try {
        if (!wc.isDestroyed() && typeof wc.setWebRTCIPHandlingPolicy === 'function') {
          wc.setWebRTCIPHandlingPolicy(policy);
        }
      } catch (e) {}
    }
  }

  /**
   * Helper to extract clean IPv4 or IPv6 from raw text or JSON response.
   */
  extractIP(text) {
    if (!text || typeof text !== 'string') return '';
    try {
      const json = JSON.parse(text);
      text = json.ip || json.origin || json.query || text;
    } catch (_) {}
    const ipMatch = String(text).match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/) || String(text).match(/[0-9a-fA-F:]{7,}/);
    return ipMatch ? ipMatch[0] : String(text).trim();
  }

  /**
   * Verifies that Electron session.resolveProxy() resolves through the proxy rule and NOT direct.
   */
  async verifyProxyResolved(testUrl = 'https://example.com') {
    try {
      const resolved = await this.targetSession.resolveProxy(testUrl);
      if (!resolved || resolved.trim() === 'DIRECT') {
        return { success: false, error: `Browser engine fell back to DIRECT (resolveProxy returned "${resolved || 'DIRECT'}").` };
      }
      return { success: true, rule: resolved.trim() };
    } catch (err) {
      return { success: false, error: `resolveProxy failed: ${err.message}` };
    }
  }

  /**
   * Performs an active verification request through the proxied session.
   */
  async verifyConnectionThroughSession(timeoutMs = 6000) {
    const endpoint = this.settings.testEndpoint || 'https://api.ipify.org?format=json';
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const res = await this.targetSession.fetch(endpoint, {
        method: 'GET',
        headers: { Accept: 'application/json, text/plain, */*' },
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!res.ok) {
        return { success: false, error: `Proxy verification HTTP ${res.status}` };
      }

      const text = await res.text();
      const ip = this.extractIP(text);
      return { success: true, ip };
    } catch (err) {
      return { success: false, error: err.message || 'Proxy verification failed' };
    }
  }

  /**
   * Renders the Kill Switch block page on all active tabs.
   */
  renderKillSwitchOnAllTabs(errorMessage) {
    if (this.tabManager && this.tabManager.tabs) {
      for (const tab of this.tabManager.tabs.values()) {
        if (tab && tab.view && !tab.view.webContents.isDestroyed()) {
          this.renderKillSwitchPage(tab.view.webContents, -130, errorMessage || 'Proxy Connection Failed');
        }
      }
    }
  }

  /**
   * Applies the current proxy settings to the session.
   */
  async applyProxy() {
    const activeConfig = this.getActiveProxyConfig();

    if (!activeConfig || !activeConfig.host) {
      // Proxy Off / Direct mode
      try {
        await this.targetSession.setProxy({ mode: 'direct' });
        this.applyWebRTCPolicy('default');
        this.currentStatus = 'off';
        this.isKillSwitchEngaged = false;
        this.killSwitchError = null;
        this.lastVerificationError = null;
      } catch (err) {
        console.error('[ProxyManager] Failed to set direct mode:', err.message);
      }
      this.notifyStateChanged();
      return;
    }

    // Step 2 requirement: Status is "applying" until verification succeeds
    this.currentStatus = 'applying';
    this.notifyStateChanged();

    // Validate configuration
    try {
      validateProxyConfig(activeConfig);
    } catch (valErr) {
      console.error('[ProxyManager] Invalid proxy configuration:', valErr.message);
      this.lastVerificationError = valErr.message;
      if (this.settings.enableKillSwitch) {
        this.isKillSwitchEngaged = true;
        this.currentStatus = 'kill-switch';
        this.killSwitchError = { errorCode: -130, errorDescription: valErr.message, validatedURL: 'config' };
        await this.targetSession.setProxy({
          proxyRules: 'http=127.0.0.1:0;https=127.0.0.1:0',
          proxyBypassRules: '<none>',
        });
        this.renderKillSwitchOnAllTabs(valErr.message);
      } else {
        this.currentStatus = 'error';
      }
      this.notifyStateChanged();
      return;
    }

    const proxyRules = this.buildProxyRules(activeConfig);
    const bypassRules = this.settings.enableKillSwitch
      ? '<none>'
      : (activeConfig.bypassRules || '<local>, 127.0.0.1, localhost');

    try {
      await this.targetSession.setProxy({
        proxyRules,
        proxyBypassRules: bypassRules,
      });

      // Leak prevention: disable non-proxied UDP for WebRTC
      if (this.settings.preventWebRTCLeaks) {
        this.applyWebRTCPolicy('disable_non_proxied_udp');
      } else {
        this.applyWebRTCPolicy('default');
      }

      // Step 3 requirement: Verify proxy rule is really in effect (resolveProxy != DIRECT)
      const resolveCheck = await this.verifyProxyResolved('https://example.com');
      if (!resolveCheck.success) {
        throw new Error(resolveCheck.error);
      }

      // Step 2 requirement: Verify connection through proxied session before showing "connected"
      const verifyCheck = await this.verifyConnectionThroughSession();
      if (!verifyCheck.success) {
        throw new Error(verifyCheck.error);
      }

      // Verified and connected!
      this.currentStatus = 'connected';
      this.isKillSwitchEngaged = false;
      this.killSwitchError = null;
      this.lastVerificationError = null;
    } catch (err) {
      console.error('[ProxyManager] Proxy verification failed:', err.message);
      this.lastVerificationError = err.message;

      if (this.settings.enableKillSwitch) {
        this.isKillSwitchEngaged = true;
        this.currentStatus = 'kill-switch';
        this.killSwitchError = { errorCode: -130, errorDescription: err.message, validatedURL: 'verification' };
        // Enforce sinkhole rule so Chromium cannot bypass to direct
        await this.targetSession.setProxy({
          proxyRules: 'http=127.0.0.1:0;https=127.0.0.1:0',
          proxyBypassRules: '<none>',
        });
        this.renderKillSwitchOnAllTabs(err.message);
      } else {
        this.currentStatus = 'error';
      }
    }

    this.notifyStateChanged();
  }

  /**
   * Applies proxy for a specific active workspace.
   */
  async applyForWorkspace(workspaceId) {
    this.activeWorkspaceId = workspaceId;
    if (this.settings.perWorkspaceProfiles) {
      await this.applyProxy();
    }
  }

  async handleWorkspaceChanged(workspaceId) {
    return await this.applyForWorkspace(workspaceId);
  }

  /**
   * Handles a proxy failure reported by a tab.
   */
  handleProxyFailure(tab, errorCode, errorDescription, validatedURL) {
    if (this.currentStatus === 'off') return false;

    // Check if error corresponds to proxy failure or connection error
    const isProxyError =
      errorCode === -111 || // ERR_TUNNEL_CONNECTION_FAILED
      errorCode === -120 || // ERR_SOCKS_CONNECTION_FAILED
      errorCode === -121 || // ERR_SOCKS_CONNECTION_HOST_UNREACHABLE
      errorCode === -130 || // ERR_PROXY_CONNECTION_FAILED
      errorCode === -136 || // ERR_MANDATORY_PROXY_CONFIGURATION_FAILED
      errorCode === -151 || // ERR_PROXY_CERTIFICATE_INVALID
      errorCode === -153 || // ERR_PROXY_HTTP_1_1_REQUIRED
      errorCode === -336 || // ERR_NO_SUPPORTED_PROXIES
      errorCode === -102 || // ERR_CONNECTION_REFUSED
      errorCode === -104 || // ERR_CONNECTION_FAILED
      errorCode === -100 || // ERR_CONNECTION_CLOSED
      errorCode === -101 || // ERR_CONNECTION_RESET
      errorCode === -118 || // ERR_CONNECTION_TIMED_OUT
      errorCode === -20 ||  // ERR_BLOCKED_BY_CLIENT
      errorCode === -105 || // ERR_NAME_NOT_RESOLVED
      errorCode === -109 || // ERR_ADDRESS_UNREACHABLE
      Boolean(typeof errorDescription === 'string' && errorDescription.toUpperCase().includes('PROXY'));

    if (!isProxyError) return false;

    if (this.settings.enableKillSwitch) {
      this.isKillSwitchEngaged = true;
      this.currentStatus = 'kill-switch';
      this.killSwitchError = { errorCode, errorDescription, validatedURL };

      // Ensure browser engine sinkholes all direct traffic
      this.targetSession.setProxy({
        proxyRules: 'http=127.0.0.1:0;https=127.0.0.1:0',
        proxyBypassRules: '<none>',
      }).catch(() => {});

      this.notifyStateChanged();

      // Render Kill Switch blocked notice in the tab
      if (tab && tab.view && !tab.view.webContents.isDestroyed()) {
        this.renderKillSwitchPage(tab.view.webContents, errorCode, errorDescription);
      }
    } else {
      this.currentStatus = 'error';
      this.notifyStateChanged();
    }
    return true;
  }

  /**
   * Renders the Kill Switch block page in a tab to prevent IP leaks.
   */
  renderKillSwitchPage(webContents, errorCode, errorDescription) {
    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Proxy Kill Switch Engaged</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      background: #09090b;
      color: #f4f4f5;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      padding: 20px;
    }
    .card {
      background: #18181b;
      border: 1px solid #ef4444;
      border-radius: 12px;
      padding: 32px;
      max-width: 520px;
      text-align: center;
      box-shadow: 0 20px 40px rgba(0,0,0,0.8);
    }
    .icon { font-size: 44px; margin-bottom: 12px; }
    h1 { color: #f87171; font-size: 20px; margin: 0 0 10px 0; font-weight: 600; }
    p { color: #a1a1aa; font-size: 13.5px; line-height: 1.6; margin: 0 0 16px 0; }
    .status-pill {
      background: rgba(239, 68, 68, 0.15);
      border: 1px solid #ef4444;
      color: #fca5a5;
      padding: 8px 12px;
      border-radius: 6px;
      font-family: monospace;
      font-size: 12px;
      margin-bottom: 20px;
      word-break: break-all;
    }
    .actions { display: flex; gap: 10px; justify-content: center; }
    .btn {
      padding: 9px 16px;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      border: 1px solid transparent;
      transition: background-color 0.15s ease;
    }
    .btn-primary { background: #3b82f6; color: white; }
    .btn-primary:hover { background: #2563eb; }
    .btn-secondary { background: #27272a; color: #e4e4e7; border-color: #3f3f46; }
    .btn-secondary:hover { background: #3f3f46; }
    .disclaimer { font-size: 11px; color: #71717a; margin-top: 18px; border-top: 1px solid #27272a; padding-top: 12px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">🛡️</div>
    <h1>Kill Switch Engaged</h1>
    <p>The proxy connection failed or disconnected. Page traffic has been blocked to prevent your real IP and data from leaking directly to the destination.</p>
    <div class="status-pill">${errorDescription || 'Proxy Connection Failed'} (${errorCode})</div>
    <div class="actions">
      <button class="btn btn-primary" onclick="location.reload()">Retry Connection</button>
    </div>
    <div class="disclaimer">
      Routes browser traffic only. Not a full-device VPN. The proxy operator can see your unencrypted traffic.
    </div>
  </div>
</body>
</html>`;
    webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  }

  /**
   * Resets the kill switch and attempts reconnection.
   */
  async resetKillSwitch() {
    this.isKillSwitchEngaged = false;
    this.killSwitchError = null;
    await this.applyProxy();
  }

  /**
   * Tests connection to an IP-echo endpoint through the session proxy.
   * Compares the proxied IP against the real IP and checks for leaks.
   */
  async testConnection(customEndpoint) {
    const endpoint = customEndpoint || this.settings.testEndpoint || 'https://api.ipify.org?format=json';
    const startTime = Date.now();

    // 1. Fetch Real IP via isolated direct session
    let realIP = '';
    try {
      const directSession = session.fromPartition('direct-ip-check');
      await directSession.setProxy({ mode: 'direct' });
      const directRes = await directSession.fetch(endpoint, {
        method: 'GET',
        headers: { Accept: 'application/json, text/plain, */*' },
      });
      if (directRes.ok) {
        const text = await directRes.text();
        realIP = this.extractIP(text);
      }
    } catch (e) {
      console.warn('[ProxyManager] Direct IP check error:', e.message);
    }

    // 2. If proxy mode is not 'off', ensure the proxied session resolves through proxy
    if (this.settings.mode !== 'off') {
      const resolved = await this.targetSession.resolveProxy(endpoint);
      if (!resolved || resolved.trim() === 'DIRECT') {
        const errMsg = `Proxy bypass detected: Browser resolves "${endpoint}" to DIRECT instead of proxy!`;
        if (this.settings.enableKillSwitch) {
          this.isKillSwitchEngaged = true;
          this.currentStatus = 'kill-switch';
          await this.targetSession.setProxy({
            proxyRules: 'http=127.0.0.1:0;https=127.0.0.1:0',
            proxyBypassRules: '<none>',
          });
        } else {
          this.currentStatus = 'error';
        }
        this.notifyStateChanged();
        return {
          success: false,
          error: errMsg,
          realIP,
          proxyIP: '',
          ip: '',
          isLeaking: true,
          endpoint,
        };
      }
    }

    // 3. Test through the proxied session (exact session used by tabs)
    try {
      const response = await this.targetSession.fetch(endpoint, {
        method: 'GET',
        headers: { Accept: 'application/json, text/plain, */*' },
      });

      const latency = Date.now() - startTime;
      if (!response.ok) {
        const errMsg = `HTTP ${response.status} ${response.statusText}`;
        if (this.settings.mode !== 'off') {
          this.currentStatus = this.settings.enableKillSwitch ? 'kill-switch' : 'error';
          if (this.settings.enableKillSwitch) {
            this.isKillSwitchEngaged = true;
            await this.targetSession.setProxy({
              proxyRules: 'http=127.0.0.1:0;https=127.0.0.1:0',
              proxyBypassRules: '<none>',
            });
          }
          this.notifyStateChanged();
        }
        return {
          success: false,
          error: errMsg,
          realIP,
          proxyIP: '',
          ip: '',
          latency,
          endpoint,
        };
      }

      const text = await response.text();
      const proxyIP = this.extractIP(text);
      const isProxyActive = this.settings.mode !== 'off';
      const isLeaking = isProxyActive && !!realIP && !!proxyIP && realIP === proxyIP;

      this.lastTestResult = {
        success: true,
        realIP,
        proxyIP,
        ip: proxyIP,
        isLeaking,
        latency,
        endpoint,
        timestamp: Date.now(),
      };

      if (isProxyActive) {
        if (isLeaking && this.settings.enableKillSwitch) {
          this.currentStatus = 'error';
        } else {
          this.currentStatus = 'connected';
          this.isKillSwitchEngaged = false;
        }
      }

      this.notifyStateChanged();
      return {
        success: true,
        realIP,
        proxyIP,
        ip: proxyIP,
        isLeaking,
        latency,
        endpoint,
      };
    } catch (err) {
      const latency = Date.now() - startTime;
      const errMsg = err.message || 'Proxy connection failed';

      if (this.settings.mode !== 'off') {
        if (this.settings.enableKillSwitch) {
          this.isKillSwitchEngaged = true;
          this.currentStatus = 'kill-switch';
          await this.targetSession.setProxy({
            proxyRules: 'http=127.0.0.1:0;https=127.0.0.1:0',
            proxyBypassRules: '<none>',
          });
        } else {
          this.currentStatus = 'error';
        }
      }

      this.lastTestResult = {
        success: false,
        error: errMsg,
        realIP,
        proxyIP: '',
        ip: '',
        latency,
        endpoint,
        timestamp: Date.now(),
      };

      this.notifyStateChanged();
      return {
        success: false,
        error: errMsg,
        realIP,
        proxyIP: '',
        ip: '',
        latency,
        endpoint,
      };
    }
  }

  /**
   * Sets mode ('off', 'manual', 'profile') and optionally activeProfileId.
   */
  async setMode(mode, profileId = null) {
    if (!['off', 'manual', 'profile'].includes(mode)) {
      throw new Error('Invalid proxy mode');
    }
    this.settings.mode = mode;
    if (profileId) {
      this.settings.activeProfileId = profileId;
    }
    this.saveSettings();
    await this.applyProxy();
    return this.getPublicState();
  }

  /**
   * Updates manual proxy configuration with strict validation & auto-normalization.
   */
  async saveManualProxy(manualConfig) {
    if (!manualConfig || typeof manualConfig !== 'object') {
      throw new Error('Invalid manual proxy configuration');
    }

    const parsed = parseProxyInput(manualConfig);
    validateProxyConfig(parsed);

    this.settings.manualProxy.protocol = parsed.protocol;
    this.settings.manualProxy.host = parsed.host;
    this.settings.manualProxy.port = parsed.port;
    if (parsed.bypassRules !== undefined) {
      this.settings.manualProxy.bypassRules = parsed.bypassRules || '<local>, 127.0.0.1, localhost';
    }

    if (parsed.username !== undefined) {
      this.settings.manualProxy.auth.username = parsed.username;
    }
    if (parsed.password !== undefined && parsed.password !== '') {
      this.settings.manualProxy.auth.encryptedPassword = this.encryptCredential(parsed.password);
      this.settings.manualProxy.auth.hasAuth = true;
    } else if (parsed.password === '') {
      this.settings.manualProxy.auth.encryptedPassword = '';
      this.settings.manualProxy.auth.hasAuth = !!this.settings.manualProxy.auth.username;
    }

    this.saveSettings();
    if (this.settings.mode === 'manual') {
      await this.applyProxy();
    }
    return this.getPublicState();
  }

  /**
   * Adds or updates a profile in the saved profiles list with strict validation & auto-normalization.
   */
  async saveProfile(profileData) {
    if (!profileData || typeof profileData !== 'object') {
      throw new Error('Invalid profile data');
    }

    const id = profileData.id || `prof-${Date.now()}`;
    const name = (profileData.name || 'Unnamed Proxy').trim();

    const parsed = parseProxyInput(profileData);
    validateProxyConfig(parsed);

    let existing = this.settings.profiles.find((p) => p.id === id);
    if (!existing) {
      existing = {
        id,
        name,
        protocol: parsed.protocol,
        host: parsed.host,
        port: parsed.port,
        bypassRules: parsed.bypassRules || '<local>, 127.0.0.1, localhost',
        auth: { hasAuth: false, username: '', encryptedPassword: '' },
      };
      this.settings.profiles.push(existing);
    } else {
      existing.name = name;
      existing.protocol = parsed.protocol;
      existing.host = parsed.host;
      existing.port = parsed.port;
      if (parsed.bypassRules !== undefined) {
        existing.bypassRules = parsed.bypassRules;
      }
    }

    // Handle authentication updates securely
    if (parsed.username !== undefined) {
      existing.auth.username = parsed.username;
    }
    if (parsed.password !== undefined && parsed.password !== '') {
      existing.auth.encryptedPassword = this.encryptCredential(parsed.password);
      existing.auth.hasAuth = true;
    } else if (parsed.password === '') {
      existing.auth.encryptedPassword = '';
      existing.auth.hasAuth = !!existing.auth.username;
    }

    this.saveSettings();
    if (this.settings.mode === 'profile' && this.settings.activeProfileId === id) {
      await this.applyProxy();
    }
    return this.getPublicState();
  }

  /**
   * Deletes a profile by ID.
   */
  async deleteProfile(profileId) {
    this.settings.profiles = this.settings.profiles.filter((p) => p.id !== profileId);
    if (this.settings.activeProfileId === profileId) {
      this.settings.activeProfileId = this.settings.profiles[0] ? this.settings.profiles[0].id : '';
    }
    this.saveSettings();
    if (this.settings.mode === 'profile') {
      await this.applyProxy();
    }
    return this.getPublicState();
  }

  /**
   * Updates general proxy settings (kill switch, webrtc leaks, test endpoint, workspace binding).
   */
  async updateSettings(newSettings) {
    if (!newSettings || typeof newSettings !== 'object') {
      throw new Error('Invalid settings object');
    }

    if (typeof newSettings.enableKillSwitch === 'boolean') {
      this.settings.enableKillSwitch = newSettings.enableKillSwitch;
    }
    if (typeof newSettings.preventWebRTCLeaks === 'boolean') {
      this.settings.preventWebRTCLeaks = newSettings.preventWebRTCLeaks;
    }
    if (typeof newSettings.testEndpoint === 'string' && newSettings.testEndpoint.trim()) {
      this.settings.testEndpoint = newSettings.testEndpoint.trim();
    }
    if (typeof newSettings.perWorkspaceProfiles === 'boolean') {
      this.settings.perWorkspaceProfiles = newSettings.perWorkspaceProfiles;
    }
    if (newSettings.workspaceProfiles && typeof newSettings.workspaceProfiles === 'object') {
      this.settings.workspaceProfiles = { ...this.settings.workspaceProfiles, ...newSettings.workspaceProfiles };
    }

    this.saveSettings();
    await this.applyProxy();
    return this.getPublicState();
  }

  /**
   * Returns sanitized public state for UI (never leaks raw passwords).
   */
  getState() {
    return this.getPublicState();
  }

  getPublicState() {
    const sanitizeAuth = (auth) => ({
      hasAuth: !!(auth && (auth.hasAuth || auth.username || auth.encryptedPassword)),
      username: (auth && auth.username) || '',
      hasPassword: !!(auth && auth.encryptedPassword),
    });

    const activeConfig = this.getActiveProxyConfig();
    let activeSummary = 'Direct Connection (Proxy Off)';
    if (activeConfig && activeConfig.host) {
      activeSummary = `${activeConfig.protocol.toUpperCase()}://${activeConfig.host}:${activeConfig.port}`;
    }

    return {
      mode: this.settings.mode,
      status: this.currentStatus,
      isKillSwitchEngaged: this.isKillSwitchEngaged,
      killSwitchError: this.killSwitchError,
      lastVerificationError: this.lastVerificationError,
      activeProfileId: this.settings.activeProfileId,
      activeSummary,
      manualProxy: {
        protocol: this.settings.manualProxy.protocol,
        host: this.settings.manualProxy.host,
        port: this.settings.manualProxy.port,
        bypassRules: this.settings.manualProxy.bypassRules,
        auth: sanitizeAuth(this.settings.manualProxy.auth),
      },
      profiles: this.settings.profiles.map((p) => ({
        id: p.id,
        name: p.name,
        protocol: p.protocol,
        host: p.host,
        port: p.port,
        bypassRules: p.bypassRules,
        auth: sanitizeAuth(p.auth),
      })),
      enableKillSwitch: this.settings.enableKillSwitch,
      preventWebRTCLeaks: this.settings.preventWebRTCLeaks,
      testEndpoint: this.settings.testEndpoint,
      perWorkspaceProfiles: this.settings.perWorkspaceProfiles,
      workspaceProfiles: { ...this.settings.workspaceProfiles },
      activeWorkspaceId: this.activeWorkspaceId,
      lastTestResult: this.lastTestResult,
      honestDisclaimer: 'Routes browser traffic only. Not a full-device VPN. The proxy operator can see your traffic.',
    };
  }

  /**
   * Sends an IPC notification to the renderer when proxy state updates.
   */
  notifyStateChanged() {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('proxy:stateChanged', this.getPublicState());
    }
  }
}

module.exports = ProxyManager;
