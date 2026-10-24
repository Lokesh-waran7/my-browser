const assert = require('assert');
const PermissionsManager = require('../src/main/permissionsManager');
const SplitManager = require('../src/main/splitManager');
const TabSuspender = require('../src/main/tabSuspender');

console.log('--- Testing HTML Fullscreen & Permissions ---');

// 1. PermissionsManager tests
console.log('[1] Testing PermissionsManager auto-allow for fullscreen...');
const pm = new PermissionsManager(null, null, require('os').tmpdir());

assert.strictEqual(
  pm.handlePermissionCheck(null, 'fullscreen', 'https://www.youtube.com'),
  true,
  'Fullscreen should be auto-allowed for https'
);
assert.strictEqual(
  pm.handlePermissionCheck(null, 'pointerLock', 'https://www.youtube.com'),
  true,
  'PointerLock should be auto-allowed for https'
);
assert.strictEqual(
  pm.handlePermissionCheck(null, 'media', 'https://www.youtube.com'),
  true,
  'Media should be auto-allowed for https'
);
assert.strictEqual(
  pm.handlePermissionCheck(null, 'camera', 'https://www.youtube.com'),
  false,
  'Camera should not be auto-allowed'
);
console.log('✓ PermissionsManager checks passed');

// 2. SplitManager HTML Fullscreen lifecycle tests
console.log('[2] Testing SplitManager HTML fullscreen lifecycle...');

let windowFullScreen = false;
const sentIpcMessages = [];
const mockChildren = [];

const mockMainWindow = {
  isDestroyed: () => false,
  isFullScreen: () => windowFullScreen,
  setFullScreen: (val) => { windowFullScreen = val; },
  getContentSize: () => [1920, 1080],
  contentView: {
    children: mockChildren,
    addChildView: (v) => { if (!mockChildren.includes(v)) mockChildren.push(v); },
    removeChildView: (v) => {
      const idx = mockChildren.indexOf(v);
      if (idx !== -1) mockChildren.splice(idx, 1);
    },
  },
  webContents: {
    send: (channel, data) => sentIpcMessages.push({ channel, data }),
  },
};

const mockTab1View = {
  bounds: null,
  visible: true,
  setVisible: function(v) { this.visible = v; },
  setBounds: function(b) { this.bounds = b; },
};
const mockTab2View = {
  bounds: null,
  visible: true,
  setVisible: function(v) { this.visible = v; },
  setBounds: function(b) { this.bounds = b; },
};

const mockTabs = new Map([
  ['tab-1', { id: 'tab-1', view: mockTab1View }],
  ['tab-2', { id: 'tab-2', view: mockTab2View }],
]);

const mockTabManager = {
  tabs: mockTabs,
  getTab: (id) => mockTabs.get(id),
  activeTabId: 'tab-1',
};

const sm = new SplitManager(mockMainWindow, mockTabManager);

// Initial state: not fullscreen
assert.strictEqual(sm.isHtmlFullScreen(), false);

// Enter fullscreen on tab-1
sm.enterHtmlFullScreen('tab-1');
assert.strictEqual(sm.isHtmlFullScreen(), true);
assert.strictEqual(sm.getHtmlFullScreenTabId(), 'tab-1');
assert.strictEqual(windowFullScreen, true, 'Window should be set to fullscreen');
assert.deepStrictEqual(
  mockTab1View.bounds,
  { x: 0, y: 0, width: 1920, height: 1080 },
  'Tab 1 view should be sized to full content area'
);
assert.strictEqual(mockTab2View.visible, false, 'Other tabs should be hidden');

// Verify IPC notification sent to renderer
const enterEvent = sentIpcMessages.find((m) => m.channel === 'fullscreen:htmlStateChange' && m.data.isFullscreen === true);
assert(enterEvent, 'Should send fullscreen:htmlStateChange true');
assert.strictEqual(enterEvent.data.tabId, 'tab-1');

// Leave fullscreen
sm.leaveHtmlFullScreen('tab-1');
assert.strictEqual(sm.isHtmlFullScreen(), false);
assert.strictEqual(sm.getHtmlFullScreenTabId(), null);
assert.strictEqual(windowFullScreen, false, 'Window should restore non-fullscreen');

const leaveEvent = sentIpcMessages.find((m) => m.channel === 'fullscreen:htmlStateChange' && m.data.isFullscreen === false);
assert(leaveEvent, 'Should send fullscreen:htmlStateChange false');

console.log('✓ SplitManager HTML Fullscreen lifecycle passed');

// 3. TabSuspender protection during HTML fullscreen
console.log('[3] Testing TabSuspender protection for fullscreen tab...');
const suspender = new TabSuspender(mockMainWindow, mockTabManager, sm, null);

// When sm is in fullscreen for tab-2
sm.enterHtmlFullScreen('tab-2');
suspender.canSuspend('tab-2').then((canSuspend) => {
  assert.strictEqual(canSuspend, false, 'Tab in HTML fullscreen must NOT be suspended');
  console.log('✓ TabSuspender protection passed');
  console.log('--- ALL FULLSCREEN TESTS PASSED ---');
});
