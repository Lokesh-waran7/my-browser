// test_step10_partC.js - Tests for Step 10 Part C: Security Hardening
const assert = require('assert');
const fs = require('fs');
const path = require('path');

async function runSecurityTests() {
  console.log('--- Testing Step 10 Part C: Security Hardening ---');

  // 1. CSP in index.html
  console.log('\n[1] Verifying Content Security Policy in index.html...');
  const indexHtml = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  assert(indexHtml.includes('http-equiv="Content-Security-Policy"'), 'CSP meta tag must be present in index.html');
  assert(indexHtml.includes("script-src 'self'"), 'CSP must restrict scripts to self');
  assert(indexHtml.includes("default-src 'self'"), 'CSP must restrict default-src to self');
  console.log('✓ CSP verification passed');

  // 2. WebPreferences in TabManager
  console.log('\n[2] Verifying WebContentsView Isolation & Sandbox...');
  const tabManagerSrc = fs.readFileSync(path.join(__dirname, '../src/main/tabManager.js'), 'utf8');
  assert(tabManagerSrc.includes('contextIsolation: true'), 'Tab views must enforce contextIsolation: true');
  assert(tabManagerSrc.includes('nodeIntegration: false'), 'Tab views must enforce nodeIntegration: false');
  assert(tabManagerSrc.includes('sandbox: true'), 'Tab views must enforce sandbox: true');
  console.log('✓ Tab isolation verification passed');

  // 3. Safe Navigation Checks
  console.log('\n[3] Verifying Safe Navigation & Local File Scheme Protection...');
  const mainSrc = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
  assert(mainSrc.includes("will-navigate"), 'Main window must guard will-navigate');
  assert(mainSrc.includes("setWindowOpenHandler"), 'Main window must guard setWindowOpenHandler');

  assert(tabManagerSrc.includes("navigationUrl.startsWith('file://')"), 'TabManager must guard against unauthorized file:// navigation');
  assert(tabManagerSrc.includes("url.startsWith('file://')"), 'TabManager must block file:// in window.open');
  console.log('✓ Safe navigation verification passed');

  // 4. Preload Exposure Audit
  console.log('\n[4] Auditing Preload Script Exposer...');
  const preloadSrc = fs.readFileSync(path.join(__dirname, '../preload.js'), 'utf8');
  assert(preloadSrc.includes("contextBridge.exposeInMainWorld('browserAPI'"), 'Preload must use contextBridge for browserAPI');
  // Confirm ipcRenderer is not exposed as a property on browserAPI or window
  assert(!preloadSrc.includes("ipcRenderer: ipcRenderer"), 'ipcRenderer must never be directly exposed');
  assert(!preloadSrc.includes("browserAPI.ipcRenderer"), 'ipcRenderer must not be attached to API');
  console.log('✓ Preload audit passed');

  // 5. Pinned Electron Version & SECURITY.md
  console.log('\n[5] Verifying Pinned Electron Version and SECURITY.md...');
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
  const electronVer = pkg.devDependencies && pkg.devDependencies.electron;
  assert(electronVer, 'Electron must be listed in devDependencies');
  assert(!electronVer.startsWith('^') && !electronVer.startsWith('~'), 'Electron version must be exact/pinned without ^ or ~');

  assert(fs.existsSync(path.join(__dirname, '../SECURITY.md')), 'SECURITY.md must exist in project root');
  const secDoc = fs.readFileSync(path.join(__dirname, '../SECURITY.md'), 'utf8');
  assert(secDoc.includes('How to Update the Pinned Electron Version'), 'SECURITY.md must document update steps');
  assert(secDoc.includes('safeStorage'), 'SECURITY.md must document credential encryption');
  console.log('✓ Version pinning & documentation verified');

  console.log('\nAll Step 10 Part C security hardening tests PASSED successfully!');
}

runSecurityTests().catch((err) => {
  console.error('Security test failed:', err);
  process.exit(1);
});
