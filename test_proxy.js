// Automated verification test for ProxyManager & Step 9 features
const { app, session } = require('electron');
const path = require('path');
const fs = require('fs');

async function runTests() {
  console.log('--- Starting Step 9 Proxy Tests ---');
  let failures = 0;

  function assert(condition, message) {
    if (!condition) {
      console.error(`❌ FAIL: ${message}`);
      failures++;
    } else {
      console.log(`✅ PASS: ${message}`);
    }
  }

  try {
    const ProxyManager = require('./src/main/proxyManager');

    // Ensure clean state before testing
    const proxyManager = new ProxyManager(null, session.defaultSession);
    await proxyManager.setMode('off');
    await proxyManager.updateSettings({
      enableKillSwitch: false,
      preventWebRTCLeaks: true,
      perWorkspaceProfiles: false,
      workspaceProfiles: {},
    });

    // 1. Initial State & Defaults
    const state = proxyManager.getPublicState();
    assert(state.mode === 'off', 'Initial mode is off');
    assert(state.status === 'off', 'Initial status is off');
    assert(state.preventWebRTCLeaks === true, 'Default preventWebRTCLeaks is true');
    assert(typeof state.enableKillSwitch === 'boolean', 'enableKillSwitch is boolean');
    assert(typeof state.perWorkspaceProfiles === 'boolean', 'perWorkspaceProfiles is boolean');
    assert(Array.isArray(state.profiles), 'state.profiles is an array');

    // 2. Encryption test with credentials
    const testProfile = {
      name: 'Test Secure SOCKS5',
      protocol: 'socks5',
      host: '127.0.0.1',
      port: 1080,
      bypassRules: '<local>, 127.0.0.1',
      username: 'testuser',
      password: 'supersecretpassword123',
    };

    const updatedState = await proxyManager.saveProfile(testProfile);
    const savedProfile = updatedState.profiles.find((p) => p.name === 'Test Secure SOCKS5');
    assert(savedProfile && savedProfile.id, 'Saved profile returned valid ID');
    assert(savedProfile.auth.username === 'testuser', 'Profile retains username');
    assert(savedProfile.auth.hasPassword === true, 'Profile indicates password is stored');
    assert(savedProfile.auth.password === undefined, 'Plaintext password stripped from state');

    // Check on-disk persistence
    const savedConfigRaw = fs.readFileSync(proxyManager.settingsFilePath, 'utf8');
    assert(!savedConfigRaw.includes('supersecretpassword123'), 'Plaintext password is NEVER written to proxy-settings.json file');

    // Verify credential decryption in memory
    const storedProfile = proxyManager.settings.profiles.find((p) => p.id === savedProfile.id);
    const decryptedPass = proxyManager.decryptCredential(storedProfile.auth.encryptedPassword);
    assert(decryptedPass === 'supersecretpassword123', 'Password correctly decrypted via safeStorage/fallback');

    // 3. Switch to Profile Mode and verify Session Proxy Rules & WebRTC policy
    // Requirement 2: Status is NOT 'connected' if proxy is unreachable; it must be 'error' or 'kill-switch'
    await proxyManager.setMode('profile', savedProfile.id);
    const activeState = proxyManager.getPublicState();
    assert(activeState.mode === 'profile', 'Mode updated to profile');
    assert(activeState.status !== 'connected', 'Status is NOT blindly "connected" when unverified');
    assert(activeState.activeProfileId === savedProfile.id, 'Active profile ID matches');

    // Test that when verification succeeds, status becomes 'connected'
    proxyManager.verifyConnectionThroughSession = async () => ({ success: true, ip: '198.51.100.1' });
    proxyManager.verifyProxyResolved = async () => ({ success: true, rule: 'SOCKS5 127.0.0.1:1080' });
    await proxyManager.applyProxy();
    assert(proxyManager.getPublicState().status === 'connected', 'Status is "connected" after verification succeeds');

    // Verify SOCKS5 DNS resolution rule (socks5:// ensures remote DNS lookup)
    const activeRules = proxyManager.buildProxyRules(storedProfile);
    assert(activeRules === 'socks5://127.0.0.1:1080', 'Proxy rule formatted correctly for remote SOCKS5 DNS');

    // 4. Test Manual Mode with HTTP
    const manualConfig = {
      protocol: 'http',
      host: 'proxy.internal.corp',
      port: 8080,
      bypassRules: 'localhost',
      username: 'corpuser',
      password: 'corppassword',
    };
    await proxyManager.saveManualProxy(manualConfig);
    await proxyManager.setMode('manual');
    const manualState = proxyManager.getPublicState();
    assert(manualState.mode === 'manual', 'Mode switched to manual');
    const manualRules = proxyManager.buildProxyRules(proxyManager.settings.manualProxy);
    assert(manualRules === 'http=proxy.internal.corp:8080;https=proxy.internal.corp:8080', 'HTTP proxy rules correctly configured for http and https');

    // 5. Test Kill Switch mechanism
    // Enable killswitch for the test
    await proxyManager.updateSettings({ enableKillSwitch: true });
    let renderedPage = '';
    const fakeTab = {
      id: 'tab-killswitch-test',
      view: {
        webContents: {
          isDestroyed: () => false,
          loadURL: (url) => {
            renderedPage = decodeURIComponent(url);
            assert(url.startsWith('data:text/html'), 'Kill switch loads data URI error page on tab view');
            assert(renderedPage.includes('Kill Switch Engaged'), 'Kill switch page contains clear explanation');
          }
        }
      }
    };

    const handled = proxyManager.handleProxyFailure(fakeTab, -130, 'ERR_PROXY_CONNECTION_FAILED', 'https://example.com');
    assert(handled === true, 'handleProxyFailure intercepted proxy error');
    assert(renderedPage.length > 0, 'Kill switch rendered block page');
    assert(proxyManager.getPublicState().status === 'kill-switch', 'ProxyManager status is now kill-switch');
    assert(proxyManager.isKillSwitchEngaged === true, 'isKillSwitchEngaged flag is true');

    // Reset kill switch
    await proxyManager.resetKillSwitch();
    assert(proxyManager.getPublicState().status !== 'kill-switch', 'resetKillSwitch restores proxy status');
    assert(proxyManager.isKillSwitchEngaged === false, 'isKillSwitchEngaged reset to false');

    // 6. Test Per-Workspace Profile Mapping
    await proxyManager.updateSettings({
      perWorkspaceProfiles: true,
      workspaceProfiles: {
        'ws-work': savedProfile.id,
      }
    });
    assert(proxyManager.settings.workspaceProfiles['ws-work'] === savedProfile.id, 'Workspace profile assignment saved');
    await proxyManager.handleWorkspaceChanged('ws-work');
    assert(proxyManager.getActiveProxyConfig().id === savedProfile.id, 'Workspace switch automatically resolved to assigned profile');

    // 7. Test Turning Proxy Off
    await proxyManager.setMode('off');
    const offState = proxyManager.getPublicState();
    assert(offState.mode === 'off', 'Mode is off');
    assert(offState.status === 'off', 'Status is off');

    // Clean up test profile
    await proxyManager.deleteProfile(savedProfile.id);
    assert(!proxyManager.getPublicState().profiles.find((p) => p.id === savedProfile.id), 'Profile deleted successfully');

    console.log('\n----------------------------------------');
    if (failures === 0) {
      console.log('🎉 ALL 20 PROXY UNIT & INTEGRATION TESTS PASSED!');
    } else {
      console.error(`❌ ${failures} TEST(S) FAILED!`);
    }
    console.log('----------------------------------------');
  } catch (err) {
    console.error('Fatal test error:', err);
    failures++;
  } finally {
    app.quit();
    process.exit(failures > 0 ? 1 : 0);
  }
}

app.whenReady().then(runTests);
