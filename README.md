# 🚀 Coder Browser

> The high-performance, keyboard-first, distraction-free browser designed specifically for software developers.

[![Security Policy](https://img.shields.io/badge/Security-Hardened-blue.svg)](SECURITY.md)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Platform: Windows | macOS | Linux](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg)](#)

```
       ____________________________________________________________________
      |  [Workspaces]  [DDG] MDN Web Docs | GitHub Features  [+]  [ - o x ]|
      |--------------------------------------------------------------------|
      | [<] [>] [R]  https://developer.mozilla.org/ [⭐]  [Split] [AI] [⚙️]|
      |====================================================================|
      |                                 || [Developer Toolkit]             |
      |   Web Development Reference     || > AI Assistant (Gemini)         |
      |   JavaScript / Web APIs         || > Interactive JSON Tree         |
      |   CSS Flexbox & Grid            || > Integrated REST API Tester    |
      |                                 || > Per-Workspace Markdown Notes  |
      |_________________________________||_________________________________|
```

---

## 🌟 Key Features

### 🗂️ Project-Isolated Workspaces
- Group tabs, cookies, and contexts by project (e.g. *Frontend*, *Backend*, *Research*, *DevOps*).
- Switch workspaces instantly with keyboard shortcuts (<kbd>Ctrl</kbd> + <kbd>1..9</kbd>).
- Persistent state: workspaces and tabs are restored automatically upon launch.

### 🪟 Side-by-Side Split View
- View two web pages simultaneously without juggling multiple windows.
- Resizable divider ratio with keyboard swap (<kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>S</kbd>).
- Independent scrolling, navigation, and DevTools per pane.

### 💤 Intelligent Tab Suspension (Memory Saver)
- Automatically discards background tabs idle for more than 10 minutes (user-configurable).
- Saves up to 70% of RAM on multi-tab workflows.
- Audio-aware: never suspends tabs that are actively playing music, video, or running WebRTC.
- Instant, non-blocking tab waking on click.

### 🛡️ Built-in Privacy & Fast Ad Blocking
- High-efficiency network ad blocker powered by Ghostery engine.
- Fast disk-cached filter rules for near-instant cold startup.
- Video page optimization: smooth, uninterrupted YouTube playback with hardware video decode.
- Per-site permission prompts (camera, microphone, geolocation, notifications) with local remembering.

### 🛠️ Developer Toolkit
- **Interactive JSON Viewer:** Collapsible syntax-highlighted tree, fast key/value search, copy JSON path, copy value, and minify/beautify formatting.
- **REST API Tester:** Send requests with custom headers, query params, form-data, and JSON payloads. cURL and `fetch()` export, request history, and variable replacement.
- **Markdown Scratch Notes:** Per-workspace markdown scratchpads with one-click page URL insertion and selection clipping.

### ✨ AI Sidebar Assistant
- Embedded Gemini AI assistant powered by the official Google GenAI SDK.
- Streaming responses with markdown rendering and syntax highlighting.
- **Privacy First:** All AI API communication occurs in the background main process. Your API key is encrypted using OS native cryptographic storage (`safeStorage` / DPAPI / Keychain).
- Configurable "Never-Share" domain list to protect sensitive internal hosts and tokens.

### 🌐 Privacy Proxy & VPN Routing
- Route browser traffic through encrypted HTTP, HTTPS, or SOCKS5 proxies.
- Named proxy profiles (e.g., *Work*, *Home*, *Debug*, *Staging*), assignable per workspace.
- **Leak Prevention:** WebRTC non-proxied UDP disabling to prevent real IP leaks.
- **Fail-Safe Kill Switch:** Blocks all network traffic immediately if the proxy disconnects or fails.

### 📑 Browser Essentials
- **Full History (`browser://history`):** Chronological, searchable history manager with individual deletion and complete data wipe.
- **Bookmarks Manager (`browser://bookmarks`):** Folder hierarchy, search, instant address bar starring, and full Netscape standard HTML import/export.
- **Downloads Manager (`browser://downloads`):** Download tracking, pause/resume/cancel, progress bars, and direct folder reveal.
- **Omnibox Autocomplete:** Real-time search engine suggestions and matching history/bookmarks.
- **Find in Page (<kbd>Ctrl</kbd> + <kbd>F</kbd>):** Highlighted matching with forward/backward cycling and match counts.
- **Zoom (<kbd>Ctrl</kbd> + <kbd>+/-/0</kbd>):** Smooth page zoom factor scaling with floating badge indicator.

---

## ⌨️ Keyboard Shortcuts Cheat Sheet

| Shortcut | Action |
| --- | --- |
| <kbd>Ctrl</kbd> + <kbd>T</kbd> | Open New Tab |
| <kbd>Ctrl</kbd> + <kbd>W</kbd> | Close Current Tab |
| <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>T</kbd> | Reopen Last Closed Tab |
| <kbd>Ctrl</kbd> + <kbd>L</kbd> | Focus Address Bar |
| <kbd>Ctrl</kbd> + <kbd>Tab</kbd> / <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>Tab</kbd> | Switch to Next / Previous Tab |
| <kbd>Ctrl</kbd> + <kbd>1</kbd> .. <kbd>9</kbd> | Jump to Workspace by Index |
| <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>N</kbd> | Create New Workspace |
| <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>S</kbd> | Toggle Split View |
| <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>D</kbd> | Toggle Developer Toolkit / AI Assistant |
| <kbd>Ctrl</kbd> + <kbd>F</kbd> | Find in Page |
| <kbd>Ctrl</kbd> + <kbd>P</kbd> | Print Current Web Page |
| <kbd>Ctrl</kbd> + <kbd>+</kbd> / <kbd>-</kbd> / <kbd>0</kbd> | Zoom In / Out / Reset Zoom (100%) |
| <kbd>F11</kbd> | Toggle Fullscreen |
| <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>I</kbd> or <kbd>F12</kbd> | Open DevTools for Active Web Page |
| <kbd>Ctrl</kbd> + <kbd>Alt</kbd> + <kbd>I</kbd> | Open DevTools for Browser UI Shell |
| <kbd>Esc</kbd> | Dismiss any open modal, dropdown, or search bar |

*(On macOS, use <kbd>Cmd</kbd> instead of <kbd>Ctrl</kbd>)*

---

## 🚀 Quick Start

### Prerequisites
- Node.js 18.0 or higher
- npm 9.0 or higher

### Installation & Running Locally

1. **Clone the repository:**
   ```bash
   git clone https://github.com/coderbrowser/coder-browser.git
   cd coder-browser
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Start the application:**
   ```bash
   npm start
   ```

4. **Run the Automated Test Suite:**
   ```bash
   npm test
   ```

---

## 📦 Packaging & Building

Coder Browser is configured with `electron-builder` to produce installers and portable executables.

### Windows (NSIS Installer & Portable Executable)
```bash
npm run build:win
```
- Output in `dist/`:
  - `Coder Browser Setup 1.0.0.exe` (NSIS Installer)
  - `Coder Browser 1.0.0.exe` (Standalone Portable Exe)

### macOS (DMG & Zip)
```bash
npm run build:mac
```

### Linux (AppImage & Debian Package)
```bash
npm run build:linux
```

---

## 🔧 Configuration Guide

### User Data Storage Locations
- **Windows:** `%APPDATA%\coder-browser\`
- **macOS:** `~/Library/Application Support/coder-browser/`
- **Linux:** `~/.config/coder-browser/`

### Important Configuration Files
- `browser-settings.json`: Search engine preferences, downloads path, session restore.
- `workspaces.json`: Workspace structures, assigned tabs, and layout state.
- `history.json`: Local browsing history.
- `bookmarks.json`: Hierarchical bookmarks and custom folders.
- `site-permissions.json`: Per-site camera, mic, location, and notification decisions.
- `proxy-settings.json`: Saved proxy configurations (passwords encrypted via `safeStorage`).
- `ai-settings.json`: Gemini model preference and never-share hostnames (API key encrypted via `safeStorage`).

---

## 🛠️ Troubleshooting & Diagnostics

### Internal Diagnostic Pages
- `browser://gpu`: Inspect complete GPU hardware acceleration, driver versions, and video decode feature status.
- `browser://memory`: Real-time RAM breakdown, active vs suspended tab counts, and instant background tab suspension.
- `browser://settings`: Unified control center for privacy, performance, search, and developer configurations.

### Slow YouTube Playback or Dropped Frames
1. Navigate to `browser://gpu` in the omnibox.
2. Confirm that `Video Decode` and `Compositing` show **Hardware accelerated**.
3. If hardware decode is disabled, update your GPU graphics drivers. Coder Browser enables Chromium hardware acceleration by default.
4. Coder Browser pre-caches ad blocking engines to eliminate startup filter lag on video players.

### Encryption (`safeStorage`) on Headless or Linux Environments
- Coder Browser leverages OS-level credential storage (`safeStorage`).
- On Linux, ensure `libsecret` or a freedesktop Secret Service daemon (such as GNOME Keyring or KWallet) is active.
- If encryption is unavailable, a clear status warning is presented in the AI and Proxy settings interfaces.

---

## 📄 License

Coder Browser is open-source software licensed under the [MIT License](LICENSE).
