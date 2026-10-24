// Central Network Pipeline - Single source of truth for all session.webRequest hooks
// Prevents listener collisions, ensures guaranteed callback execution, preserves POST bodies and CORS headers.
const { fromElectronDetails } = require('@ghostery/adblocker-electron');
const tld = require('tldts-experimental');
const netdebugLogger = require('./netdebugLogger');

class NetworkPipeline {
  constructor() {
    this.targetSession = null;
    this.privacyManager = null;
    this.proxyManager = null;
    this.isSafeMode = false;
    this.initialized = false;
  }

  init({ session, privacyManager, proxyManager, isSafeMode = false }) {
    this.targetSession = session;
    this.privacyManager = privacyManager;
    this.proxyManager = proxyManager;
    this.isSafeMode = isSafeMode;

    if (!this.targetSession || !this.targetSession.webRequest) {
      netdebugLogger.log('NetworkPipeline', 'No webRequest available on target session.');
      return;
    }

    if (this.isSafeMode) {
      netdebugLogger.log('NetworkPipeline', 'Safe Mode ACTIVE: Skipping all webRequest handler registrations.');
      return;
    }

    this.registerHandlers();
    this.initialized = true;
  }

  registerHandlers() {
    const sw = this.targetSession.webRequest;

    // 1. onBeforeRequest
    sw.onBeforeRequest({ urls: ['*://*/*'] }, (details, callback) => {
      let callbackInvoked = false;
      const safeCallback = (result) => {
        if (!callbackInvoked) {
          callbackInvoked = true;
          try {
            callback(result || {});
          } catch (_) {}
        }
      };

      try {
        const urlStr = details.url;
        let urlObj;
        try {
          urlObj = new URL(urlStr);
        } catch (_) {
          return safeCallback({});
        }

        const protocol = urlObj.protocol;
        const hostname = urlObj.hostname.toLowerCase();

        // Allow internal, file, and devtools protocols unconditionally
        if (protocol === 'file:' || protocol === 'devtools:' || protocol === 'chrome-extension:' || protocol === 'blob:' || protocol === 'data:') {
          return safeCallback({});
        }

        // A. Proxy Kill-Switch Check
        if (this.proxyManager && this.proxyManager.isKillSwitchEngaged && this.proxyManager.settings?.enableKillSwitch) {
          netdebugLogger.log('KillSwitch', `BLOCKED request due to active Kill Switch: ${hostname}${urlObj.pathname}`);
          return safeCallback({ cancel: true });
        }

        // B. Domain Exemption / Allowlist Check
        if (this.privacyManager) {
          const isExempt = Array.from(this.privacyManager.exemptDomains || []).some(
            (d) => hostname === d || hostname.endsWith('.' + d)
          );
          const isAllowlisted = Array.from(this.privacyManager.allowlist || []).some(
            (d) => hostname === d || hostname.endsWith('.' + d)
          );
          if (isExempt || isAllowlisted) {
            return safeCallback({});
          }
        }

        // C. HTTPS Upgrade (only for safe GET/HEAD requests to prevent dropping POST bodies)
        if (this.privacyManager && this.privacyManager.httpsUpgradeEnabled && protocol === 'http:') {
          if (!hostname.includes('localhost') && hostname !== '127.0.0.1') {
            if (details.method === 'GET' || details.method === 'HEAD') {
              urlObj.protocol = 'https:';
              netdebugLogger.log('Privacy', `HTTPS Upgrade: ${hostname}${urlObj.pathname}`);
              return safeCallback({ redirectURL: urlObj.toString() });
            }
          }
        }

        // D. Tracking Query Parameter Stripping (GET requests ONLY, never POST/PUT)
        if (this.privacyManager && this.privacyManager.trackingStrippingEnabled && urlObj.search && (details.method === 'GET' || details.method === 'HEAD')) {
          let modified = false;
          const searchParams = urlObj.searchParams;
          for (const param of (this.privacyManager.trackingParameters || [])) {
            if (searchParams.has(param)) {
              searchParams.delete(param);
              modified = true;
            }
          }
          if (modified) {
            return safeCallback({ redirectURL: urlObj.toString() });
          }
        }

        // E. Ghostery Network Ad Blocker Matching
        if (this.privacyManager && this.privacyManager.adBlockerEnabled && this.privacyManager.blocker) {
          try {
            const req = fromElectronDetails(details);
            if (!req.isMainFrame()) {
              const { redirect, match } = this.privacyManager.blocker.match(req);
              if (redirect && redirect.dataUrl) {
                netdebugLogger.log('AdBlocker', `Redirected ad request: ${hostname}${urlObj.pathname}`);
                return safeCallback({ redirectURL: redirect.dataUrl });
              }
              if (match) {
                this.privacyManager.totalBlockedCount++;
                if (hostname.includes('youtube.com') || hostname.includes('googlevideo.com')) {
                  this.privacyManager.youtubeBlockedCount++;
                }
                netdebugLogger.log('AdBlocker', `BLOCKED: [${details.method} ${details.resourceType}] ${hostname}${urlObj.pathname}`);
                return safeCallback({ cancel: true });
              }
            }
          } catch (matchErr) {
            netdebugLogger.log('AdBlockerError', `Match error for ${hostname}: ${matchErr.message}`);
          }
        }

        return safeCallback({});
      } catch (err) {
        netdebugLogger.log('PipelineError', `onBeforeRequest exception: ${err.message}`);
        return safeCallback({});
      }
    });
    netdebugLogger.log('NetworkPipeline', 'Registered webRequest handler: onBeforeRequest');

    // 2. onBeforeSendHeaders (Privacy headers, GPC, DNT)
    sw.onBeforeSendHeaders({ urls: ['*://*/*'] }, (details, callback) => {
      let callbackInvoked = false;
      const safeCallback = (result) => {
        if (!callbackInvoked) {
          callbackInvoked = true;
          try {
            callback(result || {});
          } catch (_) {}
        }
      };

      try {
        let modified = false;
        const requestHeaders = details.requestHeaders || {};

        // Privacy headers
        if (this.privacyManager && this.privacyManager.adBlockerEnabled) {
          if (!requestHeaders['Sec-GPC']) {
            requestHeaders['Sec-GPC'] = '1';
            modified = true;
          }
          if (!requestHeaders['DNT']) {
            requestHeaders['DNT'] = '1';
            modified = true;
          }
        }

        if (modified) {
          return safeCallback({ requestHeaders });
        }
        return safeCallback({});
      } catch (err) {
        return safeCallback({});
      }
    });
    netdebugLogger.log('NetworkPipeline', 'Registered webRequest handler: onBeforeSendHeaders');

    // 3. onHeadersReceived (Ghostery CSP and 3rd-party cookie blocking)
    sw.onHeadersReceived({ urls: ['*://*/*'] }, (details, callback) => {
      let callbackInvoked = false;
      const safeCallback = (result) => {
        if (!callbackInvoked) {
          callbackInvoked = true;
          try {
            callback(result || {});
          } catch (_) {}
        }
      };

      try {
        let modified = false;
        let responseHeaders = details.responseHeaders;

        // A. Ghostery CSP directives (only for mainFrame and subFrame)
        if (this.privacyManager && this.privacyManager.blocker && (details.resourceType === 'mainFrame' || details.resourceType === 'subFrame')) {
          try {
            const rawCSP = this.privacyManager.blocker.getCSPDirectives(fromElectronDetails(details));
            if (rawCSP !== undefined) {
              const CSP_HEADER = 'content-security-policy';
              responseHeaders = { ...responseHeaders };
              const policies = rawCSP.split(';').map((c) => c.trim()).filter(Boolean);
              for (const [name, values] of Object.entries(responseHeaders)) {
                if (name.toLowerCase() === CSP_HEADER) {
                  policies.push(...values);
                  delete responseHeaders[name];
                }
              }
              responseHeaders[CSP_HEADER] = [policies.join(';')];
              modified = true;
            }
          } catch (_) {}
        }

        // B. Third-party cookie blocking
        if (this.privacyManager && this.privacyManager.thirdPartyCookieBlockingEnabled && details.initiator && responseHeaders) {
          try {
            const reqOrigin = new URL(details.url).origin;
            const initOrigin = new URL(details.initiator).origin;
            if (reqOrigin !== initOrigin) {
              for (const key of Object.keys(responseHeaders)) {
                if (key.toLowerCase() === 'set-cookie') {
                  if (!modified) responseHeaders = { ...responseHeaders };
                  delete responseHeaders[key];
                  modified = true;
                }
              }
            }
          } catch (_) {}
        }

        // CRITICAL: Only return responseHeaders if actually modified to preserve CORS and POST response parsing!
        if (modified && responseHeaders) {
          return safeCallback({ responseHeaders });
        }
        return safeCallback({});
      } catch (err) {
        return safeCallback({});
      }
    });
    netdebugLogger.log('NetworkPipeline', 'Registered webRequest handler: onHeadersReceived');

    // 4. onCompleted (Diagnostics)
    sw.onCompleted({ urls: ['*://*/*'] }, (details) => {
      try {
        const u = new URL(details.url);
        if (u.hostname.includes('youtube.com') || u.hostname.includes('googleapis.com')) {
          netdebugLogger.log('HTTP:Completed', `[${details.method} ${details.statusCode}] ${u.hostname}${u.pathname}`);
        }
      } catch (_) {}
    });
    netdebugLogger.log('NetworkPipeline', 'Registered webRequest handler: onCompleted');

    // 5. onErrorOccurred (Diagnostics)
    sw.onErrorOccurred({ urls: ['*://*/*'] }, (details) => {
      try {
        const u = new URL(details.url);
        netdebugLogger.log('HTTP:Error', `[${details.method}] ${u.hostname}${u.pathname} -> ${details.error}`);
      } catch (_) {}
    });
    netdebugLogger.log('NetworkPipeline', 'Registered webRequest handler: onErrorOccurred');
  }
}

module.exports = new NetworkPipeline();
