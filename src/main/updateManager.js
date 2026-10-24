// Update Manager Module - GitHub Releases feed checking, manual check, and notification
const electron = require('electron');
const app = electron && electron.app;
const shell = electron && electron.shell;
const net = electron && electron.net;
const path = require('path');
const fs = require('fs');

class UpdateManager {
  constructor(mainWindow, repo = 'coderbrowser/coder-browser') {
    this.mainWindow = mainWindow;
    this.repo = repo;
    this.currentVersion = app && typeof app.getVersion === 'function' ? app.getVersion() : '1.0.0';
    this.updateFeedUrl = `https://api.github.com/repos/${this.repo}/releases/latest`;
    this.isChecking = false;
  }

  async checkForUpdates(manual = false) {
    if (this.isChecking) {
      return { status: 'checking', message: 'Update check already in progress.' };
    }

    this.isChecking = true;
    try {
      const releaseInfo = await this.fetchLatestRelease();
      this.isChecking = false;

      if (!releaseInfo || !releaseInfo.tag_name) {
        return {
          status: 'error',
          currentVersion: this.currentVersion,
          message: 'Unable to reach release feed. Check internet connection.',
        };
      }

      const latestVersion = releaseInfo.tag_name.replace(/^v/, '');
      const hasUpdate = this.compareVersions(latestVersion, this.currentVersion) > 0;

      const result = {
        status: hasUpdate ? 'available' : 'up-to-date',
        hasUpdate,
        currentVersion: this.currentVersion,
        latestVersion,
        releaseName: releaseInfo.name || `Version ${latestVersion}`,
        releaseNotes: releaseInfo.body || '',
        downloadUrl: releaseInfo.html_url || `https://github.com/${this.repo}/releases`,
      };

      if (hasUpdate && this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send('app:updateAvailable', result);
      }

      return result;
    } catch (e) {
      this.isChecking = false;
      return {
        status: 'error',
        currentVersion: this.currentVersion,
        message: e.message || 'Error checking for updates',
      };
    }
  }

  fetchLatestRelease() {
    return new Promise((resolve, reject) => {
      const request = net.request({
        method: 'GET',
        url: this.updateFeedUrl,
        headers: {
          'User-Agent': `CoderBrowser/${this.currentVersion}`,
          Accept: 'application/vnd.github.v3+json',
        },
      });

      let body = '';
      request.on('response', (response) => {
        if (response.statusCode === 404) {
          // No releases published yet
          return resolve({ tag_name: this.currentVersion });
        }
        if (response.statusCode >= 400) {
          return reject(new Error(`Server returned HTTP ${response.statusCode}`));
        }

        response.on('data', (chunk) => {
          body += chunk.toString();
        });

        response.on('end', () => {
          try {
            const data = JSON.parse(body);
            resolve(data);
          } catch (err) {
            reject(err);
          }
        });
      });

      request.on('error', (err) => {
        reject(err);
      });

      request.end();
    });
  }

  compareVersions(v1, v2) {
    const parts1 = v1.split('.').map((p) => parseInt(p, 10) || 0);
    const parts2 = v2.split('.').map((p) => parseInt(p, 10) || 0);
    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
      const p1 = parts1[i] || 0;
      const p2 = parts2[i] || 0;
      if (p1 > p2) return 1;
      if (p1 < p2) return -1;
    }
    return 0;
  }

  openDownloadPage(url) {
    const targetUrl = url || `https://github.com/${this.repo}/releases`;
    shell.openExternal(targetUrl);
  }
}

module.exports = UpdateManager;
