// YouTube Ad Handler - Injects MutationObserver auto-skipper and cosmetic styles
const config = require('../config/youtubeAdConfig');

class YouTubeAdHandler {
  constructor() {
    this.config = config;
    this.scriptlet = this.buildScriptlet();
  }

  /**
   * Constructs the client-side scriptlet from configuration.
   */
  buildScriptlet() {
    return `(() => {
      if (window.__coder_yt_autoskip_active) return;
      window.__coder_yt_autoskip_active = true;

      const config = ${JSON.stringify(this.config)};
      let player = null;
      let video = null;
      let inAd = false;
      let savedMuted = false;
      let savedPlaybackRate = 1.0;
      let adStartTime = 0;

      function isWatchOrShorts() {
        const href = window.location.href;
        return href.includes('/watch') || href.includes('/shorts');
      }

      // 1. Cosmetic CSS injection to hide banners/sponsored cards
      function injectCosmeticStyle() {
        if (document.getElementById('__coder_yt_ad_style')) return;
        const style = document.createElement('style');
        style.id = '__coder_yt_ad_style';
        style.textContent = config.cosmeticAdSelectors.join(',\\n') + ' { display: none !important; }';
        (document.head || document.documentElement).appendChild(style);
      }

      function removeCosmeticStyle() {
        const style = document.getElementById('__coder_yt_ad_style');
        if (style) style.remove();
      }

      // 2. Detection of active ad state on the player
      function isAdActive() {
        if (!player) player = document.querySelector(config.playerSelectors.container);
        if (!player) return false;
        for (const cls of config.playerSelectors.adClasses) {
          if (player.classList.contains(cls)) return true;
        }
        return false;
      }

      // 3. Ad suppression, fast-forwarding, and user state restoration
      function checkAndHandleAd(triggerSource) {
        if (!isWatchOrShorts()) return;

        const adActive = isAdActive();
        video = document.querySelector(config.playerSelectors.video);

        if (adActive) {
          if (!inAd) {
            inAd = true;
            adStartTime = performance.now();
            if (video) {
              savedMuted = video.muted;
              if (video.playbackRate > 0 && video.playbackRate <= 4) {
                savedPlaybackRate = video.playbackRate;
              }
              video.muted = true;
              video.playbackRate = config.adPlaybackRate;
              if (isFinite(video.duration) && video.duration > 0) {
                video.currentTime = video.duration - 0.05;
                if (video.paused) video.play().catch(() => {});
              }
            }
          } else {
            // Continual enforcement while ad class persists
            if (video) {
              if (!video.muted) video.muted = true;
              if (video.playbackRate !== config.adPlaybackRate) {
                video.playbackRate = config.adPlaybackRate;
              }
              if (isFinite(video.duration) && video.duration > 0 && video.currentTime < video.duration - 0.2) {
                video.currentTime = video.duration - 0.05;
                if (video.paused) video.play().catch(() => {});
              }
            }
          }

          // Click skip button immediately when rendered
          for (const sel of config.skipButtonSelectors) {
            const btn = document.querySelector(sel);
            if (btn && typeof btn.click === 'function') {
              btn.click();
              break;
            }
          }
        } else {
          if (inAd) {
            inAd = false;
            const durationSec = ((performance.now() - adStartTime) / 1000).toFixed(2);
            console.log('[CoderBrowser] YouTube ad suppressed in ' + durationSec + 's. Restoring: muted=' + savedMuted + ', playbackRate=' + savedPlaybackRate);
            if (video) {
              video.muted = savedMuted;
              video.playbackRate = savedPlaybackRate;
            }
          } else {
            // Track normal user changes during non-ad playback
            if (video) {
              savedMuted = video.muted;
              if (video.playbackRate > 0 && video.playbackRate <= 4) {
                savedPlaybackRate = video.playbackRate;
              }
            }
          }
        }
      }

      // 4. MutationObserver for responsive, low-overhead detection
      const observer = new MutationObserver(() => {
        checkAndHandleAd('mutation');
      });

      function attachObserver() {
        injectCosmeticStyle();
        player = document.querySelector(config.playerSelectors.container);
        if (player) {
          observer.disconnect();
          observer.observe(player, {
            attributes: true,
            attributeFilter: ['class'],
          });
          checkAndHandleAd('player-attached');
        } else {
          // Observe document until #movie_player mounts
          observer.disconnect();
          observer.observe(document.documentElement, {
            childList: true,
            subtree: true,
          });
        }
      }

      // 5. YouTube SPA navigation support (yt-navigate-finish and popstate)
      window.addEventListener('yt-navigate-finish', () => {
        if (isWatchOrShorts()) {
          attachObserver();
          checkAndHandleAd('yt-navigate-finish');
        } else {
          if (inAd && video) {
            video.muted = savedMuted;
            video.playbackRate = savedPlaybackRate;
            inAd = false;
          }
          observer.disconnect();
        }
      });

      window.addEventListener('popstate', () => {
        if (isWatchOrShorts()) {
          attachObserver();
          checkAndHandleAd('popstate');
        }
      });

      // Initial execution
      if (isWatchOrShorts()) {
        attachObserver();
      }
    })();`;
  }

  /**
   * Injects the auto-skipper and cosmetic rules if applicable for the given webContents and URL.
   */
  async handleNavigation(webContents, url, privacyManager) {
    if (!webContents || !url) return;

    try {
      const parsedUrl = new URL(url);
      const isYouTubeDomain = parsedUrl.hostname === 'youtube.com' || parsedUrl.hostname.endsWith('.youtube.com');
      if (!isYouTubeDomain) return;

      // Check global blocker toggle and per-site allowlist
      if (privacyManager && typeof privacyManager.isAdBlockingActiveForUrl === 'function') {
        const isAllowed = privacyManager.isAdBlockingActiveForUrl(url);
        if (!isAllowed) {
          // If disabled or allowlisted, remove cosmetic styles and exit
          try {
            await webContents.executeJavaScript(`(() => {
              const style = document.getElementById('__coder_yt_ad_style');
              if (style) style.remove();
            })()`);
          } catch (e) {}
          return;
        }
      }

      // Check if URL matches watch or shorts
      const matchesPattern = this.config.urlPatterns.some((pattern) => pattern.test(url));
      if (!matchesPattern) return;

      // Inject the scriptlet into the frame
      await webContents.executeJavaScript(this.scriptlet);
    } catch (err) {
      // Ignore navigation or context destroyed errors
    }
  }
}

module.exports = new YouTubeAdHandler();
