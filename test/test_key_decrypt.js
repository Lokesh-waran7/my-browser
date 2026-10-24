const { app } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');

const targetDir = path.join(os.homedir(), 'AppData', 'Roaming', 'Coder Browser');
app.setPath('userData', targetDir);

app.whenReady().then(async () => {
  const uPath = app.getPath('userData');
  const keyPath = path.join(uPath, 'ai-key.bin');
  console.log(`Checking path="${uPath}", exists=${fs.existsSync(keyPath)}`);
  if (fs.existsSync(keyPath)) {
    const { safeStorage } = require('electron');
    const buf = fs.readFileSync(keyPath);
    try {
      const decrypted = safeStorage.decryptString(buf);
      console.log(`  -> SUCCESS decrypting! length=${decrypted.length}`);
    } catch (e) {
      console.log(`  -> FAIL decrypting: ${e.message}`);
    }
  }
  app.quit();
});
