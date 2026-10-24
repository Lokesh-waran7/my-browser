// NetDebug Logger - Writes sanitized network diagnostic logs to logs/netdebug.log
const fs = require('fs');
const path = require('path');

class NetDebugLogger {
  constructor() {
    this.logDir = path.join(process.cwd(), 'logs');
    this.logFile = path.join(this.logDir, 'netdebug.log');
    this.ensureDir();
  }

  ensureDir() {
    try {
      if (!fs.existsSync(this.logDir)) {
        fs.mkdirSync(this.logDir, { recursive: true });
      }
    } catch (_) {}
  }

  /**
   * Sanitizes URLs and messages to ensure no secrets/keys/passwords are logged.
   */
  sanitize(text) {
    if (!text) return '';
    let str = String(text);
    // Mask any query param containing key, token, auth, secret, password
    str = str.replace(/([?&](?:key|api_key|token|auth|password|secret)=)[^&\s]+/gi, '$1[MASKED]');
    // Mask Bearer tokens
    str = str.replace(/(Bearer\s+)[a-zA-Z0-9_\-\.]+/gi, '$1[MASKED]');
    // Mask potential API keys (AIza...)
    str = str.replace(/AIza[0-9A-Za-z-_]{35}/g, 'AIza[MASKED]');
    return str;
  }

  log(category, message, extra = null) {
    const timestamp = new Date().toISOString();
    let line = `[${timestamp}] [${category}] ${this.sanitize(message)}`;
    if (extra) {
      if (typeof extra === 'object') {
        try {
          line += ' ' + this.sanitize(JSON.stringify(extra));
        } catch (_) {
          line += ' ' + String(extra);
        }
      } else {
        line += ' ' + this.sanitize(String(extra));
      }
    }
    line += '\n';

    try {
      this.ensureDir();
      fs.appendFileSync(this.logFile, line, 'utf8');
    } catch (_) {}

    // Also output to console in development
    console.log(`[NetDebug:${category}]`, this.sanitize(message));
  }

  clear() {
    try {
      this.ensureDir();
      fs.writeFileSync(this.logFile, '', 'utf8');
    } catch (_) {}
  }
}

module.exports = new NetDebugLogger();
