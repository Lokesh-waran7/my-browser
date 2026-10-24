// Permissions Manager Module - Per-site camera, mic, geolocation, notification permissions
const electron = require('electron');
const app = electron && electron.app;
const fs = require('fs');
const path = require('path');
const os = require('os');
const netdebugLogger = require('./netdebugLogger');

class PermissionsManager {
  constructor(mainWindow = null, targetSession = null, customUserDataPath = null) {
    this.mainWindow = mainWindow;
    this.targetSession = targetSession;
    this.userDataPath = customUserDataPath || (app && typeof app.getPath === 'function' ? app.getPath('userData') : path.join(os.homedir(), '.coder-browser'));
    this.permissionsFile = path.join(this.userDataPath, 'site-permissions.json');

    // origin -> { permissionName -> 'allow' | 'deny' }
    this.permissions = {};
    this.pendingRequests = new Map(); // requestId -> callback
    this.loadPermissions();
  }

  loadPermissions() {
    try {
      if (fs.existsSync(this.permissionsFile)) {
        const raw = fs.readFileSync(this.permissionsFile, 'utf8');
        this.permissions = JSON.parse(raw);
      }
    } catch (e) {
      this.permissions = {};
    }
  }

  savePermissions() {
    try {
      fs.writeFileSync(this.permissionsFile, JSON.stringify(this.permissions, null, 2), 'utf8');
    } catch (e) {
      console.error('[PermissionsManager] Failed to save site permissions:', e.message);
    }
  }

  attachToSession(ses) {
    this.targetSession = ses;

    ses.setPermissionRequestHandler((webContents, permission, callback, details) => {
      this.handlePermissionRequest(webContents, permission, callback, details);
    });

    ses.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
      return this.handlePermissionCheck(webContents, permission, requestingOrigin, details);
    });
  }

  getOrigin(url) {
    try {
      return new URL(url).origin;
    } catch (_) {
      return url || 'unknown';
    }
  }

  handlePermissionCheck(webContents, permission, requestingOrigin, details) {
    const origin = this.getOrigin(requestingOrigin);
    if (this.permissions[origin] && this.permissions[origin][permission] !== undefined) {
      return this.permissions[origin][permission] === 'allow';
    }

    // Auto-allow standard playback, interaction, and fullscreen permissions without prompting for web pages
    const autoAllowed = [
      'fullscreen',
      'pointerLock',
      'media',
      'mediaKeySystemAccess',
      'clipboard-sanitized-write',
      'idle-detection',
      'speaker-selection',
    ];
    if (autoAllowed.includes(permission)) {
      if (origin.startsWith('http://') || origin.startsWith('https://') || origin.startsWith('browser://')) {
        return true;
      }
    }

    // Log denied permissions (permission name and host only, no secrets)
    try {
      const host = new URL(requestingOrigin).host;
      netdebugLogger.log('Permissions:Denied', `Permission check denied: [${permission}] for host: ${host}`);
    } catch (_) {}

    return false; // default deny
  }

  handlePermissionRequest(webContents, permission, callback, details) {
    const url = details.requestingUrl || (webContents && !webContents.isDestroyed() ? webContents.getURL() : '');
    const origin = this.getOrigin(url);

    // If already remembered
    if (this.permissions[origin] && this.permissions[origin][permission] !== undefined) {
      const isAllowed = this.permissions[origin][permission] === 'allow';
      return callback(isAllowed);
    }

    // Auto-allow standard playback, interaction, and fullscreen permissions without prompt
    const autoAllowed = [
      'fullscreen',
      'pointerLock',
      'media',
      'mediaKeySystemAccess',
      'clipboard-sanitized-write',
      'idle-detection',
      'speaker-selection',
    ];
    if (autoAllowed.includes(permission)) {
      if (origin.startsWith('http://') || origin.startsWith('https://') || origin.startsWith('browser://')) {
        return callback(true);
      }
    }

    // Sensitive permissions that require user prompt (camera/mic, geolocation, notifications, etc.)
    const promptable = ['geolocation', 'notifications', 'midi'];
    if (!promptable.includes(permission)) {
      try {
        const host = new URL(url).host;
        netdebugLogger.log('Permissions:Denied', `Permission request denied: [${permission}] for host: ${host}`);
      } catch (_) {}
      return callback(false);
    }

    // Ask user via UI
    const requestId = `perm-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    this.pendingRequests.set(requestId, { callback, origin, permission });

    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('permissions:prompt', {
        requestId,
        origin,
        permission,
      });
    } else {
      callback(false);
    }
  }

  respondToPrompt(requestId, decision) {
    const req = this.pendingRequests.get(requestId);
    if (!req) return false;

    this.pendingRequests.delete(requestId);
    const isAllow = decision === 'allow';

    // Remember decision per site
    if (!this.permissions[req.origin]) {
      this.permissions[req.origin] = {};
    }
    this.permissions[req.origin][req.permission] = isAllow ? 'allow' : 'deny';
    this.savePermissions();

    req.callback(isAllow);
    return true;
  }

  checkPermission(url, permission) {
    const origin = this.getOrigin(url);
    if (this.permissions[origin] && this.permissions[origin][permission] !== undefined) {
      return this.permissions[origin][permission] === 'allow';
    }
    return null;
  }

  savePermissionDecision(url, permission, isAllowed) {
    const origin = this.getOrigin(url);
    if (!this.permissions[origin]) {
      this.permissions[origin] = {};
    }
    this.permissions[origin][permission] = isAllowed ? 'allow' : 'deny';
    this.savePermissions();
  }

  getAllPermissions() {
    return { ...this.permissions };
  }

  revokePermission(origin, permission) {
    if (this.permissions[origin]) {
      delete this.permissions[origin][permission];
      if (Object.keys(this.permissions[origin]).length === 0) {
        delete this.permissions[origin];
      }
      this.savePermissions();
      return true;
    }
    return false;
  }

  clearAllPermissions() {
    this.permissions = {};
    this.savePermissions();
    return true;
  }
}

module.exports = PermissionsManager;
