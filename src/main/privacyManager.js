// Privacy Manager - Ghostery AdBlocker Engine with cosmetic filtering, scriptlet injection,
// disk cache persistence, uBlock Origin filter list refreshing, tracking parameter stripping, HTTPS upgrade, and cookie controls.
const fs = require('fs');
const path = require('path');
const { app, session } = require('electron');
const { ElectronBlocker } = require('@ghostery/adblocker-electron');
const tld = require('tldts-experimental');
const logger = require('./logger');

class PrivacyManager {
  constructor() {
    this.blocker = null;
    this.targetSession = null;

    // Feature toggles
    this.adBlockerEnabled = true;
    this.trackingStrippingEnabled = true;
    this.httpsUpgradeEnabled = true;
    this.thirdPartyCookieBlockingEnabled = true;

    // Stats
    this.totalBlockedCount = 0;
    this.youtubeBlockedCount = 0;
    this.scriptsInjectedCount = 0;
    this.stylesInjectedCount = 0;

    // Tracking query parameters to strip from URLs
    this.trackingParameters = [
      'utm_source',
      'utm_medium',
      'utm_campaign',
      'utm_term',
      'utm_content',
      'fbclid',
      'gclid',
      'msclkid',
      'mc_eid',
      '_ga',
      '_gl',
    ];

    // Domains exempted from aggressive blocking to prevent breaking core search functionality
    // DuckDuckGo uses improving.duckduckgo.com for essential client-side state/search resolution
    this.exemptDomains = new Set([
      'duckduckgo.com',
      'improving.duckduckgo.com',
    ]);

    // Per-site allowlist (user-configured sites where ad blocking is disabled)
    this.allowlist = new Set();

    // Disk cache location for instant startup
    this.cachePath = path.join(app.getPath('userData'), 'adblocker-engine.bin');
  }

  /**
   * Initializes Ghostery full engine and session interceptors.
   */
  async init(targetSession = session.defaultSession) {
    this.targetSession = targetSession;
    if (!targetSession) return;

    try {
      // 1. Initialize blocker engine from disk cache if present, otherwise fetch prebuilt
      if (fs.existsSync(this.cachePath)) {
        try {
          const buffer = fs.readFileSync(this.cachePath);
          this.blocker = ElectronBlocker.deserialize(buffer);
          console.log('[PrivacyManager] Blocker engine loaded from disk cache (~20ms).');
        } catch (cacheErr) {
          console.warn('[PrivacyManager] Cache read failed, fetching fresh engine:', cacheErr.message);
          this.blocker = await ElectronBlocker.fromPrebuiltFull(fetch);
          fs.writeFile(this.cachePath, Buffer.from(this.blocker.serialize()), () => {});
        }
      } else {
        console.log('[PrivacyManager] Initializing fresh Ghostery full prebuilt engine...');
        this.blocker = await ElectronBlocker.fromPrebuiltFull(fetch);
        fs.writeFile(this.cachePath, Buffer.from(this.blocker.serialize()), () => {});
        console.log('[PrivacyManager] Ghostery engine loaded and cached to disk.');
      }

      // 2. Set up lightweight in-memory telemetry (avoid heavy per-request console.log)
      this.blocker.on('request-blocked', (req) => {
        this.totalBlockedCount++;
        const isYouTube = req.url.includes('youtube.com') ||
                          req.url.includes('googlevideo.com') ||
                          req.url.includes('doubleclick.net') ||
                          req.url.includes('googleads');
        if (isYouTube) {
          this.youtubeBlockedCount++;
        }
      });

      this.blocker.on('request-redirected', () => {});
      this.blocker.on('script-injected', () => { this.scriptsInjectedCount++; });
      this.blocker.on('style-injected', () => { this.stylesInjectedCount++; });

      // 3. Refresh & merge uBlock Origin YouTube filters and quick-fixes
      this.refreshUblockFilters().catch((err) => {
        console.warn('[PrivacyManager] Non-fatal error refreshing uBlock filters:', err.message);
      });

      // 4. Hook Ghostery's onBeforeRequest to coordinate HTTPS upgrades, tracking stripping, and domain exemptions
      const origOnBeforeRequest = this.blocker.onBeforeRequest.bind(this.blocker);
      this.blocker.onBeforeRequest = (details, callback) => {
        try {
          const urlObj = new URL(details.url);
          const hostname = urlObj.hostname.toLowerCase();

          // Exemption check (e.g. duckduckgo.com)
          const isExempt = Array.from(this.exemptDomains).some(
            (d) => hostname === d || hostname.endsWith('.' + d)
          );
          if (isExempt) {
            return callback({});
          }

          // Per-site allowlist check
          const isAllowlisted = Array.from(this.allowlist).some(
            (d) => hostname === d || hostname.endsWith('.' + d)
          );
          if (isAllowlisted) {
            return callback({});
          }

          // HTTP -> HTTPS Upgrade
          if (this.httpsUpgradeEnabled && urlObj.protocol === 'http:' && !hostname.includes('localhost') && hostname !== '127.0.0.1') {
            urlObj.protocol = 'https:';
            return callback({ redirectURL: urlObj.toString() });
          }

          // Tracking query parameter stripping
          if (this.trackingStrippingEnabled && urlObj.search) {
            let modified = false;
            const searchParams = urlObj.searchParams;
            for (const param of this.trackingParameters) {
              if (searchParams.has(param)) {
                searchParams.delete(param);
                modified = true;
              }
            }
            if (modified) {
              return callback({ redirectURL: urlObj.toString() });
            }
          }
        } catch (err) {
          // Fall through on invalid URLs
        }

        // Delegate to Ghostery blocker if enabled
        if (!this.adBlockerEnabled) {
          return callback({});
        }

        return origOnBeforeRequest(details, callback);
      };

      // 5. Hook Ghostery's onHeadersReceived to support third-party cookie blocking
      const origOnHeadersReceived = this.blocker.onHeadersReceived.bind(this.blocker);
      this.blocker.onHeadersReceived = (details, callback) => {
        origOnHeadersReceived(details, (res) => {
          let responseHeaders = res && res.responseHeaders ? res.responseHeaders : details.responseHeaders;
          if (this.thirdPartyCookieBlockingEnabled && responseHeaders && details.initiator) {
            try {
              const reqOrigin = new URL(details.url).origin;
              const initOrigin = new URL(details.initiator).origin;
              if (reqOrigin !== initOrigin) {
                responseHeaders = { ...responseHeaders };
                for (const key of Object.keys(responseHeaders)) {
                  if (key.toLowerCase() === 'set-cookie') {
                    delete responseHeaders[key];
                  }
                }
              }
            } catch (err) {}
          }
          callback(responseHeaders ? { responseHeaders } : {});
        });
      };

      // 6. Hook cosmetic filters and scriptlet injection:
      // a) Ensure webContents is alive and not destroyed
      // b) Skip non-http/https URLs (about:blank, data:, internal browser://, file://)
      // c) Fix root cause in scriptlets: wrap each in isolated IIFE to prevent
      //    "SyntaxError: Identifier 'JSONPath' has already been declared" when multiple scriptlets declare the same identifier
      // d) Catch any async executeJavaScript and insertCSS rejections so they never trigger unhandledRejection
      this.blocker.onInjectCosmeticFilters = async (event, url, filterData) => {
        if (!event || !event.sender || event.sender.isDestroyed()) return;
        if (!url || typeof url !== 'string') return;

        let parsedUrl;
        try {
          parsedUrl = new URL(url);
        } catch (_) {
          return;
        }

        if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
          return;
        }

        try {
          const parsedDomain = tld.parse(url);
          const hostname = parsedDomain.hostname || '';
          const domain = parsedDomain.domain || '';
          const isBase = filterData === undefined;

          const { active, styles, scripts } = this.blocker.getCosmeticsFilters({
            domain,
            hostname,
            url,
            classes: filterData?.classes,
            hrefs: filterData?.hrefs,
            ids: filterData?.ids,
            getBaseRules: isBase,
            getInjectionRules: isBase,
            getExtendedRules: false,
            getRulesFromHostname: isBase,
            getRulesFromDOM: !isBase,
            callerContext: {
              frameId: event.frameId,
              processId: event.processId,
              lifecycle: filterData?.lifecycle,
            },
          });

          if (active === false) return;

          if (styles && styles.length > 0 && !event.sender.isDestroyed()) {
            event.sender.insertCSS(styles, { cssOrigin: 'user' }).catch((err) => {
              logger.log('PrivacyManager:CosmeticCSS', new Error(`insertCSS failed on ${url}: ${err.message}`));
            });
          }

          if (scripts && scripts.length > 0 && !event.sender.isDestroyed()) {
            // Bundle all scriptlets into a single script with individual IIFE try/catch blocks.
            // This prevents:
            // 1) Electron's internal waitTillCanExecuteJavaScript from adding 500+ did-stop-loading listeners
            // 2) Top-level variable identifier collisions (e.g. JSONPath) across multiple scriptlets
            // 3) Massive IPC round-trip overhead on heavy pages like YouTube
            const bundledScript = scripts
              .map((script) => `(() => {\n  try {\n${script}\n  } catch (e) {}\n})();`)
              .join('\n');

            event.sender.executeJavaScript(bundledScript, true).catch((err) => {
              logger.log('PrivacyManager:CosmeticScriptlet', new Error(`Scriptlet execution failed on ${url}: ${err.message}`));
            });
          }
        } catch (err) {
          logger.log('PrivacyManager:onInjectCosmeticFilters', new Error(`Failed to inject cosmetic filters for ${url}: ${err.message}`));
        }
      };

      // 7. Enable blocking in the target session (registers preload script & webRequest hooks)
      this.blocker.enableBlockingInSession(targetSession);
      console.log('[PrivacyManager] Blocker enabled in session with cosmetic filtering and scriptlets active.');
    } catch (err) {
      console.error('[PrivacyManager] Failed to initialize Ghostery engine:', err);
    }
  }

  /**
   * Refreshes uBlock Origin YouTube ad filters and quick-fixes from upstream.
   */
  async refreshUblockFilters() {
    if (!this.blocker) return;
    console.log('[PrivacyManager] Fetching latest uBlock Origin filters and quick-fixes...');

    const fetchWithTimeout = async (url, timeoutMs = 4000) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(url, { signal: controller.signal });
        return await res.text();
      } finally {
        clearTimeout(timer);
      }
    };

    const [quickFixes, filtersTxt] = await Promise.all([
      fetchWithTimeout('https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/quick-fixes.txt').catch(() => ''),
      fetchWithTimeout('https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/filters.txt').catch(() => ''),
    ]);

    const addedRules = [];
    if (quickFixes) {
      const qfLines = quickFixes.split('\n').filter(l => l.trim() && !l.startsWith('!'));
      addedRules.push(...qfLines);
    }
    if (filtersTxt) {
      const ytLines = filtersTxt.split('\n').filter(l => l.includes('youtube') && !l.startsWith('!'));
      addedRules.push(...ytLines);
    }

    if (addedRules.length > 0) {
      this.blocker.updateFromDiff({ added: addedRules });
      console.log(`[PrivacyManager] Applied ${addedRules.length} updated uBlock Origin filter rules.`);
      fs.writeFile(this.cachePath, Buffer.from(this.blocker.serialize()), () => {});
    }
  }

  /**
   * Returns current privacy statistics.
   */
  getStats() {
    return {
      totalBlocked: this.totalBlockedCount,
      youtubeBlocked: this.youtubeBlockedCount,
      scriptsInjected: this.scriptsInjectedCount,
      stylesInjected: this.stylesInjectedCount,
    };
  }

  setAdBlockerEnabled(enabled) {
    this.adBlockerEnabled = !!enabled;
    console.log(`[PrivacyManager] Ad Blocker: ${this.adBlockerEnabled ? 'ENABLED' : 'DISABLED'}`);
  }

  setTrackingStrippingEnabled(enabled) {
    this.trackingStrippingEnabled = !!enabled;
    console.log(`[PrivacyManager] Tracking Parameter Stripping: ${this.trackingStrippingEnabled ? 'ENABLED' : 'DISABLED'}`);
  }

  setHttpsUpgradeEnabled(enabled) {
    this.httpsUpgradeEnabled = !!enabled;
    console.log(`[PrivacyManager] HTTPS Upgrade: ${this.httpsUpgradeEnabled ? 'ENABLED' : 'DISABLED'}`);
  }

  setThirdPartyCookieBlockingEnabled(enabled) {
    this.thirdPartyCookieBlockingEnabled = !!enabled;
    console.log(`[PrivacyManager] Third-Party Cookie Blocking: ${this.thirdPartyCookieBlockingEnabled ? 'ENABLED' : 'DISABLED'}`);
  }

  addExemption(domain) {
    this.exemptDomains.add(domain.toLowerCase());
  }

  removeExemption(domain) {
    this.exemptDomains.delete(domain.toLowerCase());
  }

  // Per-site allowlist controls
  addAllowlist(domain) {
    if (domain) {
      this.allowlist.add(domain.toLowerCase());
      console.log(`[PrivacyManager] Added to allowlist: ${domain}`);
    }
  }

  removeAllowlist(domain) {
    if (domain) {
      this.allowlist.delete(domain.toLowerCase());
      console.log(`[PrivacyManager] Removed from allowlist: ${domain}`);
    }
  }

  isDomainAllowed(domain) {
    if (!domain) return false;
    const lower = domain.toLowerCase();
    return Array.from(this.allowlist).some(d => lower === d || lower.endsWith('.' + d));
  }

  isAdBlockingActiveForUrl(url) {
    if (!this.adBlockerEnabled) return false;
    try {
      const hostname = new URL(url).hostname.toLowerCase();
      if (this.isDomainAllowed(hostname)) return false;
    } catch (e) {}
    return true;
  }
}

module.exports = new PrivacyManager();
