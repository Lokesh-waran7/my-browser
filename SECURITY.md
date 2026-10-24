# Security Policy

## Supported Versions

| Version | Supported          | Pinned Electron | Status |
| ------- | ------------------ | --------------- | ------ |
| 0.1.x   | :white_check_mark: | 45.0.0          | Active |

---

## Security Architecture & Threat Model

Coder Browser is built with a defense-in-depth model that protects local developer environments, credentials, and browsing activity.

### 1. Process & Sandbox Isolation
- **All web pages run isolated in sandboxed processes** (`sandbox: true`).
- **Node.js integration is strictly disabled** (`nodeIntegration: false`) across all guest WebContentsViews.
- **Context isolation is enforced** (`contextIsolation: true`) preventing prototype pollution or privilege escalation from guest scripts.
- **Chrome APIs are never exposed** to guest web pages.

### 2. Browser Chrome Content Security Policy (CSP)
The application shell UI (`index.html`) is protected by a strict CSP:
```http
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; connect-src 'self';
```
- No remote or untrusted scripts can execute in the browser chrome context.
- No `eval()` or dynamic string execution is permitted.
- External networking is barred from the UI shell; all networking is strictly marshaled through the main process.

### 3. IPC Architecture & Input Sanitization
- `ipcRenderer` is **never** exposed to renderers.
- Communication takes place exclusively via strongly typed methods exposed on `window.browserAPI` using `contextBridge.exposeInMainWorld`.
- All IPC message arguments received in the main process are explicitly sanitized and validated:
  - String length bounds and trimming.
  - URL scheme validation (only permitted schemes are handled).
  - Numeric ranges on zoom factors, port numbers, and timeouts.

### 4. Safe Navigation & Local File Protection
- **UI Window Navigation Lock:** The primary `BrowserWindow` is prohibited from navigating away from the local `index.html` application shell.
- **Local File Scheme Guard:** Web pages are strictly blocked from linking to or opening local `file://` URLs. Only explicit user navigation in the omnibox address bar can load local files.
- **Window Open Protection:** `setWindowOpenHandler` intercepts all `window.open` requests and opens them in managed workspace tabs, preventing arbitrary detached windows.

### 5. Credential Encryption & Safe Storage
- Gemini AI API keys and proxy authentication passwords are encrypted on-disk using the operating system's native cryptographic storage through Electron `safeStorage`:
  - **Windows:** DPAPI (Data Protection API)
  - **macOS:** Keychain Services
  - **Linux:** Secret Service API / GNOME Keyring
- Passwords and secret keys are never written to plain-text logs, workspace metadata, or renderer console output.

### 6. Network Privacy & WebRTC Leak Protection
- When proxy routing is active, `webRTCIPHandlingPolicy` is set to `disable_non_proxied_udp` to prevent WebRTC ICE candidate leakage from revealing real public IPs.
- A built-in kill switch halts all navigation traffic if a configured proxy endpoint fails or drops.

---

## How to Update the Pinned Electron Version

Electron releases frequent security and Chromium updates. To update Electron safely:

1. **Review Release Notes:**
   Check the [Electron Releases](https://github.com/electron/electron/releases) for security advisories and breaking API changes.

2. **Update `package.json`:**
   Modify the pinned version in `package.json` under `devDependencies`:
   ```json
   "devDependencies": {
     "electron": "45.1.0"
   }
   ```
   *Note: Always use exact pinning (no `^` or `~`) to ensure reproducible builds.*

3. **Install and Audit:**
   ```bash
   npm install
   npm audit
   ```

4. **Run Verification Test Suite:**
   Run all automated tests across core subsystems:
   ```bash
   node test/test_step10_partA.js
   node test/test_step10_partB.js
   node test/test_step10_partC.js
   ```

5. **Verify Hardware Acceleration & GPU Status:**
   Launch the app and open `browser://gpu` to confirm video decode and GPU compositing operate without regression.

---

## Reporting a Vulnerability

If you discover a security vulnerability within Coder Browser, please do **NOT** open a public issue. Instead, report it responsibly:

- **Email:** `security@coderbrowser.local` (or file a private security advisory on GitHub).
- Please provide a detailed description of the issue, proof of concept, and reproduction steps.
- Security reports will be acknowledged within 48 hours, and patches will be deployed promptly.
