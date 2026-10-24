// test_step10_partD.js - Tests for Step 10 Part D: Branding, packaging, updater, documentation
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const UpdateManager = require('../src/main/updateManager');

async function runPackagingTests() {
  console.log('--- Testing Step 10 Part D: Branding & Packaging ---');

  // 1. package.json branding & electron-builder config
  console.log('\n[1] Verifying package.json branding & packaging configuration...');
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
  assert.strictEqual(pkg.productName, 'Coder Browser');
  assert.strictEqual(pkg.version, '1.0.0');
  assert(pkg.build, 'package.json must contain build configuration');
  assert(pkg.build.win, 'build config must have Windows target');
  assert(pkg.build.win.target.some((t) => t.target === 'nsis'), 'Windows build must target nsis installer');
  assert(pkg.build.win.target.some((t) => t.target === 'portable'), 'Windows build must target portable');
  assert(pkg.build.mac, 'build config must have macOS target');
  assert(pkg.build.linux, 'build config must have Linux target');
  assert(Array.isArray(pkg.build.fileAssociations), 'Must configure fileAssociations');
  assert(Array.isArray(pkg.build.protocols), 'Must configure URL protocols');
  console.log('✓ Packaging configuration verified');

  // 2. Icon files in assets/
  console.log('\n[2] Verifying application icons...');
  const pngPath = path.join(__dirname, '../assets/icon.png');
  const icoPath = path.join(__dirname, '../assets/icon.ico');
  assert(fs.existsSync(pngPath), 'assets/icon.png must exist');
  assert(fs.existsSync(icoPath), 'assets/icon.ico must exist');
  const pngStats = fs.statSync(pngPath);
  assert(pngStats.size > 1000, 'PNG icon must be a non-trivial graphic');
  console.log('✓ App icons verified');

  // 3. UpdateManager Version Comparisons
  console.log('\n[3] Verifying UpdateManager version comparison logic...');
  const updater = new UpdateManager(null);
  assert.strictEqual(updater.compareVersions('1.0.1', '1.0.0'), 1, '1.0.1 is newer than 1.0.0');
  assert.strictEqual(updater.compareVersions('1.0.0', '1.0.0'), 0, 'Same versions match');
  assert.strictEqual(updater.compareVersions('0.9.9', '1.0.0'), -1, '0.9.9 is older than 1.0.0');
  assert.strictEqual(updater.compareVersions('1.1.0', '1.0.9'), 1, 'Minor bump takes precedence');
  console.log('✓ UpdateManager comparison logic verified');

  // 4. README.md Documentation
  console.log('\n[4] Verifying comprehensive README.md...');
  const readme = fs.readFileSync(path.join(__dirname, '../README.md'), 'utf8');
  assert(readme.includes('# 🚀 Coder Browser'), 'README must have hero title');
  assert(readme.includes('Keyboard Shortcuts Cheat Sheet'), 'README must have shortcuts sheet');
  assert(readme.includes('Troubleshooting & Diagnostics'), 'README must have troubleshooting');
  assert(readme.includes('browser://gpu'), 'README must mention browser://gpu');
  assert(readme.includes('browser://memory'), 'README must mention browser://memory');
  assert(readme.includes('safeStorage'), 'README must explain credential security');
  console.log('✓ README.md documentation verified');

  console.log('\nAll Step 10 Part D tests PASSED successfully!');
}

runPackagingTests().catch((err) => {
  console.error('Packaging test failed:', err);
  process.exit(1);
});
