// API Tester Module - Executes HTTP requests from main process (avoiding CORS), manages history, collections, and variables
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

class ApiTester {
  constructor() {
    this.userDataPath = app.getPath('userData');
    this.historyFile = path.join(this.userDataPath, 'api-history.json');
    this.collectionsFile = path.join(this.userDataPath, 'api-collections.json');
    this.environmentFile = path.join(this.userDataPath, 'api-environment.json');
    this.settingsFile = path.join(this.userDataPath, 'api-settings.json');

    this.history = [];
    this.collections = {};
    this.environment = { baseUrl: 'https://jsonplaceholder.typicode.com', token: '' };
    this.settings = { allowPrivateNetwork: true, defaultTimeoutSeconds: 30 };

    this.loadState();
  }

  loadState() {
    try {
      if (fs.existsSync(this.historyFile)) {
        this.history = JSON.parse(fs.readFileSync(this.historyFile, 'utf8'));
      }
    } catch (e) {
      this.history = [];
    }

    try {
      if (fs.existsSync(this.collectionsFile)) {
        this.collections = JSON.parse(fs.readFileSync(this.collectionsFile, 'utf8'));
      } else {
        // Default example collection for developers
        this.collections = {
          'Sample APIs': [
            {
              id: 'req-sample-1',
              name: 'Get Posts',
              method: 'GET',
              url: 'https://jsonplaceholder.typicode.com/posts/1',
              headers: [{ key: 'Accept', value: 'application/json', enabled: true }],
              params: [],
              bodyType: 'none',
              body: '',
            },
            {
              id: 'req-sample-2',
              name: 'Create Post',
              method: 'POST',
              url: 'https://jsonplaceholder.typicode.com/posts',
              headers: [{ key: 'Content-Type', value: 'application/json', enabled: true }],
              params: [],
              bodyType: 'json',
              body: JSON.stringify({ title: 'Hello World', body: 'This is a test post', userId: 1 }, null, 2),
            },
          ],
        };
        this.saveCollections();
      }
    } catch (e) {
      this.collections = {};
    }

    try {
      if (fs.existsSync(this.environmentFile)) {
        this.environment = JSON.parse(fs.readFileSync(this.environmentFile, 'utf8'));
      }
    } catch (e) {
      this.environment = { baseUrl: 'https://jsonplaceholder.typicode.com', token: '' };
    }

    try {
      if (fs.existsSync(this.settingsFile)) {
        this.settings = Object.assign(this.settings, JSON.parse(fs.readFileSync(this.settingsFile, 'utf8')));
      }
    } catch (e) {}
  }

  saveHistory() {
    try {
      fs.writeFileSync(this.historyFile, JSON.stringify(this.history.slice(0, 50), null, 2), 'utf8');
    } catch (e) {}
  }

  saveCollections() {
    try {
      fs.writeFileSync(this.collectionsFile, JSON.stringify(this.collections, null, 2), 'utf8');
    } catch (e) {}
  }

  saveEnvironment(env) {
    this.environment = env || {};
    try {
      fs.writeFileSync(this.environmentFile, JSON.stringify(this.environment, null, 2), 'utf8');
    } catch (e) {}
    return this.environment;
  }

  saveSettings(settings) {
    this.settings = Object.assign(this.settings, settings || {});
    try {
      fs.writeFileSync(this.settingsFile, JSON.stringify(this.settings, null, 2), 'utf8');
    } catch (e) {}
    return this.settings;
  }

  getEnvironment() {
    return this.environment;
  }

  getSettings() {
    return this.settings;
  }

  getHistory() {
    return this.history;
  }

  getCollections() {
    return this.collections;
  }

  /**
   * Substitutes {{variable}} placeholders with values from environment.
   */
  interpolate(str, variables = {}) {
    if (typeof str !== 'string') return str;
    const merged = Object.assign({}, this.environment, variables);
    return str.replace(/\{\{([\w.-]+)\}\}/g, (match, key) => {
      return merged[key] !== undefined ? merged[key] : match;
    });
  }

  /**
   * Checks if an address is localhost or in private IP ranges.
   */
  isPrivateAddress(hostname) {
    if (!hostname) return false;
    const h = hostname.toLowerCase();
    if (h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '0.0.0.0') return true;
    if (h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.localhost')) return true;

    // Check standard IPv4 private CIDRs
    const ipMatch = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (ipMatch) {
      const b1 = parseInt(ipMatch[1], 10);
      const b2 = parseInt(ipMatch[2], 10);
      if (b1 === 10) return true; // 10.0.0.0/8
      if (b1 === 127) return true; // 127.0.0.0/8
      if (b1 === 172 && b2 >= 16 && b2 <= 31) return true; // 172.16.0.0/12
      if (b1 === 192 && b2 === 168) return true; // 192.168.0.0/16
      if (b1 === 169 && b2 === 254) return true; // Link-local
    }
    return false;
  }

  /**
   * Sends HTTP request using Node's global fetch.
   */
  async sendRequest(options) {
    const {
      method = 'GET',
      url = '',
      headers = [],
      params = [],
      bodyType = 'none',
      body = '',
      timeoutSeconds = this.settings.defaultTimeoutSeconds || 30,
      allowPrivateNetwork = this.settings.allowPrivateNetwork,
      variables = {},
    } = options;

    if (!url || typeof url !== 'string') {
      throw new Error('A valid URL is required.');
    }

    // Variable interpolation
    let targetUrlStr = this.interpolate(url.trim(), variables);
    if (!/^https?:\/\//i.test(targetUrlStr)) {
      targetUrlStr = 'http://' + targetUrlStr;
    }

    let parsedUrl;
    try {
      parsedUrl = new URL(targetUrlStr);
    } catch (e) {
      throw new Error(`Invalid URL: ${targetUrlStr}`);
    }

    // Safety check for localhost / private IPs
    if (!allowPrivateNetwork && this.isPrivateAddress(parsedUrl.hostname)) {
      throw new Error(
        `Blocked: Request to private host "${parsedUrl.hostname}" was stopped by safety settings. Enable "Allow localhost & private network" in API Tester settings to permit local testing.`
      );
    }

    // Append query params
    if (Array.isArray(params)) {
      params.forEach((p) => {
        if (p && p.enabled !== false && p.key) {
          const k = this.interpolate(p.key, variables);
          const v = this.interpolate(p.value || '', variables);
          parsedUrl.searchParams.append(k, v);
        }
      });
    }

    // Assemble headers
    const reqHeaders = {};
    if (Array.isArray(headers)) {
      headers.forEach((h) => {
        if (h && h.enabled !== false && h.key) {
          const k = this.interpolate(h.key, variables);
          const v = this.interpolate(h.value || '', variables);
          reqHeaders[k] = v;
        }
      });
    }

    // Format request body
    let reqBody = undefined;
    const upperMethod = method.toUpperCase();
    if (upperMethod !== 'GET' && upperMethod !== 'HEAD') {
      if (bodyType === 'json') {
        const rawJson = this.interpolate(body, variables);
        reqBody = rawJson;
        if (!reqHeaders['content-type'] && !reqHeaders['Content-Type']) {
          reqHeaders['Content-Type'] = 'application/json';
        }
      } else if (bodyType === 'form') {
        let formPairs = [];
        if (Array.isArray(body)) {
          formPairs = body;
        } else if (typeof body === 'string') {
          try {
            formPairs = JSON.parse(body);
          } catch (e) {}
        }
        const searchParams = new URLSearchParams();
        if (Array.isArray(formPairs)) {
          formPairs.forEach((item) => {
            if (item && item.enabled !== false && item.key) {
              searchParams.append(this.interpolate(item.key, variables), this.interpolate(item.value || '', variables));
            }
          });
        }
        reqBody = searchParams.toString();
        if (!reqHeaders['content-type'] && !reqHeaders['Content-Type']) {
          reqHeaders['Content-Type'] = 'application/x-www-form-urlencoded';
        }
      } else if (bodyType === 'raw') {
        reqBody = this.interpolate(body || '', variables);
      }
    }

    const controller = new AbortController();
    const timeoutMs = Math.max(1, timeoutSeconds) * 1000;
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

    const startTime = performance.now();
    let res;
    let timeMs = 0;

    try {
      res = await fetch(parsedUrl.toString(), {
        method: upperMethod,
        headers: reqHeaders,
        body: reqBody,
        signal: controller.signal,
      });
      timeMs = Math.round(performance.now() - startTime);
    } catch (err) {
      clearTimeout(timeoutHandle);
      timeMs = Math.round(performance.now() - startTime);
      const isTimeout = err.name === 'AbortError';
      const errMsg = isTimeout ? `Request timed out after ${timeoutSeconds}s` : err.message;

      // Add failed attempt to history
      this.recordHistory({
        id: `hist-${Date.now()}`,
        method: upperMethod,
        url: parsedUrl.toString(),
        timestamp: Date.now(),
        status: 0,
        statusText: isTimeout ? 'Timed Out' : 'Failed',
        timeMs,
        error: errMsg,
      });

      throw new Error(errMsg);
    } finally {
      clearTimeout(timeoutHandle);
    }

    // Process response headers
    const resHeaders = {};
    res.headers.forEach((value, key) => {
      resHeaders[key.toLowerCase()] = value;
    });

    const contentType = resHeaders['content-type'] || '';
    const resText = await res.text();
    const sizeBytes = Buffer.byteLength(resText, 'utf8');

    let parsedJson = null;
    let isJson = false;
    if (contentType.includes('json') || (resText.trim().startsWith('{') || resText.trim().startsWith('['))) {
      try {
        parsedJson = JSON.parse(resText);
        isJson = true;
      } catch (e) {}
    }

    const result = {
      status: res.status,
      statusText: res.statusText || (res.ok ? 'OK' : 'Error'),
      timeMs,
      sizeBytes,
      headers: resHeaders,
      body: resText,
      json: parsedJson,
      isJson,
    };

    // Save to history (last 50)
    this.recordHistory({
      id: `hist-${Date.now()}`,
      method: upperMethod,
      url: parsedUrl.toString(),
      timestamp: Date.now(),
      status: res.status,
      statusText: res.statusText,
      timeMs,
      sizeBytes,
    });

    return result;
  }

  recordHistory(item) {
    this.history.unshift(item);
    if (this.history.length > 50) {
      this.history = this.history.slice(0, 50);
    }
    this.saveHistory();
  }

  clearHistory() {
    this.history = [];
    this.saveHistory();
    return true;
  }

  // Collections CRUD
  saveToCollection(collectionName, requestData) {
    const colName = (collectionName || 'Default').trim();
    if (!this.collections[colName]) {
      this.collections[colName] = [];
    }
    const id = requestData.id || `req-${Date.now()}`;
    const entry = {
      id,
      name: requestData.name || 'Untitled Request',
      method: requestData.method || 'GET',
      url: requestData.url || '',
      headers: requestData.headers || [],
      params: requestData.params || [],
      bodyType: requestData.bodyType || 'none',
      body: requestData.body || '',
      updatedAt: Date.now(),
    };

    const existingIdx = this.collections[colName].findIndex((r) => r.id === id);
    if (existingIdx !== -1) {
      this.collections[colName][existingIdx] = entry;
    } else {
      this.collections[colName].push(entry);
    }

    this.saveCollections();
    return entry;
  }

  deleteFromCollection(collectionName, requestId) {
    if (!this.collections[collectionName]) return false;
    this.collections[collectionName] = this.collections[collectionName].filter((r) => r.id !== requestId);
    this.saveCollections();
    return true;
  }

  createCollection(name) {
    const colName = (name || '').trim();
    if (!colName) return false;
    if (!this.collections[colName]) {
      this.collections[colName] = [];
      this.saveCollections();
    }
    return true;
  }

  deleteCollection(name) {
    if (this.collections[name]) {
      delete this.collections[name];
      this.saveCollections();
      return true;
    }
    return false;
  }
}

module.exports = ApiTester;
