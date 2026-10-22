// YouTube Ad Blocker & Auto-Skip Configuration
// Keep all DOM selectors and settings in this single file for easy maintenance.

module.exports = {
  // URLs where the auto-skip scriptlet and cosmetic filters should be active
  urlPatterns: [
    /^https?:\/\/(?:www\.)?youtube\.com\/watch/i,
    /^https?:\/\/(?:www\.)?youtube\.com\/shorts/i,
  ],

  // DOM selectors indicating player state
  playerSelectors: {
    container: '#movie_player',
    adClasses: ['ad-showing', 'ad-interrupting'],
    video: 'video.html5-main-video, #movie_player video, video',
  },

  // Skip button selectors (ordered by specificity)
  skipButtonSelectors: [
    '.ytp-ad-skip-button',
    '.ytp-ad-skip-button-modern',
    '.ytp-skip-ad-button',
    '.ytp-ad-skip-button-text',
    'button.ytp-ad-skip-button-modern',
    '.ytp-ad-skip-button-container button',
    '.ytp-ad-survey-answer',
  ],

  // Sponsored and cosmetic ad containers to hide
  cosmeticAdSelectors: [
    'ytd-ad-slot-renderer',
    'ytd-display-ad-renderer',
    'ytd-banner-promo-renderer',
    '#player-ads',
    '.ytd-in-feed-ad-layout-renderer',
    'ytd-promoted-sparkles-web-renderer',
    'ytd-promoted-video-renderer',
    'ytd-companion-ad-renderer',
    'ytd-action-companion-ad-renderer',
    '#masthead-ad',
    'ytd-merch-shelf-renderer',
    '.ytp-ad-overlay-container',
    '.ytp-ad-message-container',
    'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-ads"]',
    'ytd-reel-player-header-renderer:has(.ytd-ad-slot-renderer)',
    'ytd-rich-item-renderer:has(ytd-ad-slot-renderer)',
    'ytd-rich-section-renderer:has(ytd-ad-slot-renderer)',
  ],

  // Playback settings for active ads
  adPlaybackRate: 16.0,
};
