// Privacy Manager - Ghostery AdBlocker Engine with cosmetic filtering, scriptlet injection,
// disk cache persistence, uBlock Origin filter list refreshing, tracking parameter stripping, HTTPS upgrade, and cookie controls.
const fs = require('fs');
const path = require('path');
const { app, session } = require('electron');
const { ElectronBlocker } = require('@ghostery/adblocker-electron');
const tld = require('tldts-experimental');
const logger = require('./logger');
const netdebugLogger = require('./netdebugLogger');

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

    // Tracking query parameters to strip from URLs (GET requests only)
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
   * Initializes Ghostery full engine and session cosmetic filters.
   * Network filtering is handled centrally by NetworkPipeline.
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
          netdebugLogger.log('PrivacyManager', 'Blocker engine loaded from disk cache (~20ms).');
        } catch (cacheErr) {
          netdebugLogger.log('PrivacyManager', `Cache read failed, fetching fresh engine: ${cacheErr.message}`);
          this.blocker = await ElectronBlocker.fromPrebuiltFull(fetch);
          fs.writeFile(this.cachePath, Buffer.from(this.blocker.serialize()), () => {});
        }
      } else {
        netdebugLogger.log('PrivacyManager', 'Initializing fresh Ghostery full prebuilt engine...');
        this.blocker = await ElectronBlocker.fromPrebuiltFull(fetch);
        fs.writeFile(this.cachePath, Buffer.from(this.blocker.serialize()), () => {});
        netdebugLogger.log('PrivacyManager', 'Ghostery engine loaded and cached to disk.');
      }

      // 2. Set up lightweight in-memory telemetry
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

      // 3. Refresh & merge uBlock Origin network filter rules (excluding harmful scriptlet directives)
      this.refreshUblockFilters().catch((err) => {
        netdebugLogger.log('PrivacyManager', `Non-fatal error refreshing uBlock filters: ${err.message}`);
      });

      // 4. Hook cosmetic filters and scriptlet injection:
      // - Ensure webContents is alive and not destroyed
      // - Skip non-http/https URLs
      // - For YouTube, inject CSS only to hide ad slots, but skip custom scriptlets that conflict with Polymer
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
          const isYouTube = domain === 'youtube.com' || hostname.endsWith('youtube.com');

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

          // For YouTube, native youtubeAdHandler cleanly skips ads without prototype corruption
          if (!isYouTube && scripts && scripts.length > 0 && !event.sender.isDestroyed()) {
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

      // 5. Enable cosmetic filtering in target session without touching session.webRequest
      // By setting loadNetworkFilters = false on the blocker config, enableBlockingInSession
      // will ONLY register the preload script and cosmetic IPC handlers.
      // Central NetworkPipeline handles all session.webRequest interceptors exclusively.
      this.blocker.config.loadNetworkFilters = false;

      const { ipcMain } = require('electron');
      try {
        ipcMain.removeHandler('@ghostery/adblocker/inject-cosmetic-filters');
        ipcMain.removeHandler('@ghostery/adblocker/is-mutation-observer-enabled');
      } catch (_) {}

      this.blocker.enableBlockingInSession(targetSession);
      netdebugLogger.log('PrivacyManager', 'Ghostery cosmetic filtering & preload script registered.');
    } catch (err) {
      netdebugLogger.log('PrivacyManager', `Failed to initialize Ghostery engine: ${err.message}`);
    }
  }

  /**
   * Refreshes uBlock Origin YouTube ad filters and quick-fixes from upstream.
   * Excludes all scriptlet (+js) and procedural (:style) directives to avoid prototype crashes.
   */
  async refreshUblockFilters() {
    if (!this.blocker) return;
    netdebugLogger.log('PrivacyManager', 'Fetching latest uBlock Origin network filter rules...');

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
      const qfLines = quickFixes
        .split('\n')
        .filter((l) => l.trim() && !l.startsWith('!') && !l.includes('+js(') && !l.includes(':style('));
      addedRules.push(...qfLines);
    }
    if (filtersTxt) {
      const ytLines = filtersTxt
        .split('\n')
        .filter((l) => l.includes('youtube') && !l.startsWith('!') && !l.includes('+js(') && !l.includes(':style('));
      addedRules.push(...ytLines);
    }

    if (addedRules.length > 0) {
      this.blocker.updateFromDiff({ added: addedRules });
      netdebugLogger.log('PrivacyManager', `Applied ${addedRules.length} updated uBlock Origin network filter rules.`);
      fs.writeFile(this.cachePath, Buffer.from(this.blocker.serialize()), () => {});
    }
  }

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
    netdebugLogger.log('PrivacyManager', `Ad Blocker: ${this.adBlockerEnabled ? 'ENABLED' : 'DISABLED'}`);
  }

  setTrackingStrippingEnabled(enabled) {
    this.trackingStrippingEnabled = !!enabled;
    netdebugLogger.log('PrivacyManager', `Tracking Parameter Stripping: ${this.trackingStrippingEnabled ? 'ENABLED' : 'DISABLED'}`);
  }

  setHttpsUpgradeEnabled(enabled) {
    this.httpsUpgradeEnabled = !!enabled;
    netdebugLogger.log('PrivacyManager', `HTTPS Upgrade: ${this.httpsUpgradeEnabled ? 'ENABLED' : 'DISABLED'}`);
  }

  setThirdPartyCookieBlockingEnabled(enabled) {
    this.thirdPartyCookieBlockingEnabled = !!enabled;
    netdebugLogger.log('PrivacyManager', `Third-Party Cookie Blocking: ${this.thirdPartyCookieBlockingEnabled ? 'ENABLED' : 'DISABLED'}`);
  }

  addExemption(domain) {
    this.exemptDomains.add(domain.toLowerCase());
  }

  removeExemption(domain) {
    this.exemptDomains.delete(domain.toLowerCase());
  }

  addAllowlist(domain) {
    if (domain) {
      this.allowlist.add(domain.toLowerCase());
      netdebugLogger.log('PrivacyManager', `Added to allowlist: ${domain}`);
    }
  }

  removeAllowlist(domain) {
    if (domain) {
      this.allowlist.delete(domain.toLowerCase());
      netdebugLogger.log('PrivacyManager', `Removed from allowlist: ${domain}`);
    }
  }

  isDomainAllowed(domain) {
    if (!domain) return false;
    const lower = domain.toLowerCase();
    return Array.from(this.allowlist).some((d) => lower === d || lower.endsWith('.' + d));
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
