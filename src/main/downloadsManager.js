// Downloads Manager Module - Session will-download handling, tracking, progress notifications, and persistence
const electron = require('electron');
const app = electron && electron.app;
const shell = electron && electron.shell;
const dialog = electron && electron.dialog;
const fs = require('fs');
const path = require('path');
const os = require('os');

class DownloadsManager {
  constructor(mainWindow = null, settingsManager = null, targetSession = null, customUserDataPath = null) {
    this.mainWindow = mainWindow;
    this.settingsManager = settingsManager;
    this.targetSession = targetSession;
    this.userDataPath = customUserDataPath || (app && typeof app.getPath === 'function' ? app.getPath('userData') : path.join(os.homedir(), '.coder-browser'));
    this.downloadsFile = path.join(this.userDataPath, 'downloads.json');

    this.activeDownloads = new Map(); // id -> DownloadItem instance
    this.downloadHistory = []; // Array of serialized download records
    this.loadHistory();
  }

  loadHistory() {
    try {
      if (fs.existsSync(this.downloadsFile)) {
        const raw = fs.readFileSync(this.downloadsFile, 'utf8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this.downloadHistory = parsed;
        }
      }
    } catch (e) {
      this.downloadHistory = [];
    }
  }

  saveHistory() {
    try {
      fs.writeFileSync(this.downloadsFile, JSON.stringify(this.downloadHistory, null, 2), 'utf8');
    } catch (e) {
      console.error('[DownloadsManager] Failed to save downloads history:', e.message);
    }
  }

  /**
   * Attaches will-download listener to the session.
   */
  attachToSession(ses) {
    this.targetSession = ses;
    ses.on('will-download', (event, item, webContents) => {
      this.handleWillDownload(event, item, webContents);
    });
  }

  handleWillDownload(event, item, webContents) {
    const id = `dl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const filename = item.getFilename();
    const totalBytes = item.getTotalBytes();
    const url = item.getURL();
    const mimeType = item.getMimeType();
    const startTime = Date.now();

    const settings = this.settingsManager ? this.settingsManager.getSettings() : { askWhereToSave: false };
    const defaultFolder = settings.downloadPath || app.getPath('downloads');
    const defaultSavePath = path.join(defaultFolder, filename);

    if (!settings.askWhereToSave) {
      item.setSavePath(defaultSavePath);
    }

    const downloadRecord = {
      id,
      filename,
      savePath: defaultSavePath,
      url,
      mimeType,
      totalBytes,
      receivedBytes: 0,
      percent: 0,
      state: 'progressing',
      canResume: false,
      isPaused: false,
      startTime,
      endTime: null,
      error: null,
    };

    this.activeDownloads.set(id, item);
    this.downloadHistory.unshift(downloadRecord);
    this.saveHistory();
    this.notifyUpdate(downloadRecord);

    item.on('updated', (e, state) => {
      downloadRecord.receivedBytes = item.getReceivedBytes();
      downloadRecord.totalBytes = item.getTotalBytes();
      downloadRecord.savePath = item.getSavePath() || downloadRecord.savePath;
      downloadRecord.isPaused = item.isPaused();
      downloadRecord.canResume = item.canResume();

      if (downloadRecord.totalBytes > 0) {
        downloadRecord.percent = Math.round((downloadRecord.receivedBytes / downloadRecord.totalBytes) * 100);
      }

      if (state === 'interrupted') {
        downloadRecord.state = 'interrupted';
      } else if (state === 'progressing') {
        downloadRecord.state = item.isPaused() ? 'paused' : 'progressing';
      }

      this.notifyUpdate(downloadRecord);
    });

    item.once('done', (e, state) => {
      this.activeDownloads.delete(id);
      downloadRecord.endTime = Date.now();
      downloadRecord.savePath = item.getSavePath() || downloadRecord.savePath;

      if (state === 'completed') {
        downloadRecord.state = 'completed';
        downloadRecord.percent = 100;
        downloadRecord.receivedBytes = downloadRecord.totalBytes;
      } else if (state === 'cancelled') {
        downloadRecord.state = 'cancelled';
      } else {
        downloadRecord.state = 'failed';
      }

      this.saveHistory();
      this.notifyUpdate(downloadRecord);
    });
  }

  notifyUpdate(downloadRecord) {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('downloads:updated', {
        item: downloadRecord,
        all: this.getDownloads(),
      });
    }
  }

  getDownloads(searchQuery = '') {
    const q = (searchQuery || '').trim().toLowerCase();
    if (!q) return [...this.downloadHistory];
    return this.downloadHistory.filter((d) => {
      return (
        (d.filename && d.filename.toLowerCase().includes(q)) ||
        (d.url && d.url.toLowerCase().includes(q))
      );
    });
  }

  pauseDownload(id) {
    const item = this.activeDownloads.get(id);
    if (item && !item.isPaused()) {
      item.pause();
      return true;
    }
    return false;
  }

  resumeDownload(id) {
    const item = this.activeDownloads.get(id);
    if (item && item.canResume()) {
      item.resume();
      return true;
    }
    return false;
  }

  cancelDownload(id) {
    const item = this.activeDownloads.get(id);
    if (item) {
      item.cancel();
      this.activeDownloads.delete(id);
      return true;
    }
    return false;
  }

  async openFile(id) {
    const record = this.downloadHistory.find((d) => d.id === id);
    if (!record || !record.savePath) return false;
    if (fs.existsSync(record.savePath)) {
      const err = await shell.openPath(record.savePath);
      return !err;
    }
    return false;
  }

  showInFolder(id) {
    const record = this.downloadHistory.find((d) => d.id === id);
    if (!record || !record.savePath) return false;
    if (fs.existsSync(record.savePath)) {
      shell.showItemInFolder(record.savePath);
      return true;
    }
    return false;
  }

  clearCompleted() {
    this.downloadHistory = this.downloadHistory.filter((d) => d.state === 'progressing' || d.state === 'paused');
    this.saveHistory();
    return this.getDownloads();
  }
}

module.exports = DownloadsManager;
