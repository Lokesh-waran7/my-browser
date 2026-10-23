const { app } = require('electron');
const path = require('path');
const fs = require('fs');

class AppLogger {
  constructor() {
    this.logsDir = path.join(app.getPath('userData'), 'logs');
    this.logFilePath = path.join(this.logsDir, 'app.log');
    this.ensureDir();
  }

  ensureDir() {
    try {
      if (!fs.existsSync(this.logsDir)) {
        fs.mkdirSync(this.logsDir, { recursive: true });
      }
    } catch (err) {
      console.error('[Logger] Failed to create logs directory:', err);
    }
  }

  /**
   * Masks sensitive information such as API keys from error messages and stack traces.
   */
  sanitize(text) {
    if (!text) return '';
    const str = typeof text === 'string' ? text : String(text);
    // Mask Google API keys (AIzaSy...) and generic 35+ character keys
    return str
      .replace(/AIza[0-9A-Za-z-_]{35}/g, '[MASKED_API_KEY]')
      .replace(/(?:api[_-]?key|key|secret)["':=\s]+([a-zA-Z0-9_\-]{20,})/gi, (m, key) => {
        return m.replace(key, '[MASKED_KEY]');
      });
  }

  /**
   * Logs error to console and app.log with timestamp, source, and stack trace.
   */
  log(source, error) {
    try {
      this.ensureDir();
      const timestamp = new Date().toISOString();
      const rawMessage = (error && (error.message || error.stack || String(error))) || 'Unknown error';
      const rawStack = (error && error.stack) || rawMessage;
      
      const cleanMessage = this.sanitize(rawMessage);
      const cleanStack = this.sanitize(rawStack);

      const logEntry = `[${timestamp}] [${source}] ${cleanMessage}\nStack: ${cleanStack}\n\n`;

      fs.appendFileSync(this.logFilePath, logEntry, 'utf-8');
      console.error(`[${source}]`, cleanStack);
    } catch (writeErr) {
      console.error('[Logger] Failed to write to app.log:', writeErr);
    }
  }
}

const logger = new AppLogger();

module.exports = logger;
