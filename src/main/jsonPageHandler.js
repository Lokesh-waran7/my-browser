// JSON Page Handler - Injects pretty JSON viewer into tabs that load application/json
const fs = require('fs');
const path = require('path');
const logger = require('./logger');

class JsonPageHandler {
  constructor() {
    this.viewerScript = null;
    this.viewerStyles = null;
    this.loadAssets();
  }

  loadAssets() {
    try {
      const scriptPath = path.join(__dirname, '../renderer/jsonViewer.js');
      if (fs.existsSync(scriptPath)) {
        this.viewerScript = fs.readFileSync(scriptPath, 'utf8');
      }
    } catch (e) {
      console.error('[JsonPageHandler] Failed to load viewer script:', e);
    }
  }

  /**
   * Attaches JSON auto-detection to a WebContents instance.
   */
  attach(webContents) {
    if (!webContents || webContents.isDestroyed()) return;
    if (webContents.__jsonPageHandlerAttached) return;
    webContents.__jsonPageHandlerAttached = true;

    webContents.on('did-finish-load', async () => {
      if (!webContents || webContents.isDestroyed()) return;

      const url = webContents.getURL();
      if (!url) return;

      let parsedUrl;
      try {
        parsedUrl = new URL(url);
      } catch (_) {
        return;
      }

      if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
        return;
      }

      try {
        const isJson = await webContents.executeJavaScript(`(() => {
          if (window.__jsonViewerInjected) return false;
          const isHeaderJson = document.contentType && document.contentType.toLowerCase().includes('json');
          const isSinglePre = document.body && document.body.children.length === 1 && document.body.children[0].tagName === 'PRE';
          
          if (isHeaderJson || isSinglePre) {
            const rawText = (document.body.innerText || '').trim();
            if ((rawText.startsWith('{') && rawText.endsWith('}')) || (rawText.startsWith('[') && rawText.endsWith(']'))) {
              try {
                JSON.parse(rawText);
                return true;
              } catch (e) {
                return false;
              }
            }
          }
          return false;
        })()`);

        if (isJson) {
          if (!this.viewerScript) this.loadAssets();

          // 1. Inject JSON viewer CSS
          await webContents.insertCSS(`
            body { margin: 0; padding: 0; background-color: #121214 !important; color: #f4f4f5 !important; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important; }
            .json-viewer-container { padding: 16px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 13px; line-height: 1.5; }
            .json-viewer-toolbar { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; margin-bottom: 12px; background: #18181b; border: 1px solid #27272a; border-radius: 6px; }
            .json-search-input { background: #09090b; border: 1px solid #3f3f46; color: #f4f4f5; border-radius: 4px; padding: 4px 8px; font-size: 12px; width: 220px; outline: none; }
            .json-search-input:focus { border-color: #3b82f6; }
            .json-btn-group { display: flex; gap: 6px; }
            .json-tool-btn { background: #27272a; border: 1px solid #3f3f46; color: #d4d4d8; border-radius: 4px; padding: 4px 8px; font-size: 11px; cursor: pointer; transition: all 0.15s ease; }
            .json-tool-btn:hover { background: #3f3f46; color: #ffffff; }
            .json-tree-root { background: #18181b; border: 1px solid #27272a; border-radius: 6px; padding: 12px; overflow-x: auto; }
            .json-node { margin: 2px 0; }
            .json-line { display: flex; align-items: baseline; position: relative; padding: 1px 4px; border-radius: 3px; cursor: default; }
            .json-line:hover { background: rgba(255, 255, 255, 0.04); }
            .json-toggle { display: inline-block; width: 14px; font-size: 10px; color: #71717a; cursor: pointer; user-select: none; margin-right: 4px; text-align: center; }
            .json-toggle:hover { color: #f4f4f5; }
            .json-key { color: #38bdf8; font-weight: 500; margin-right: 4px; }
            .json-bracket { color: #a1a1aa; font-weight: bold; }
            .json-summary { color: #71717a; font-style: italic; font-size: 12px; margin: 0 4px; }
            .json-children { margin-left: 20px; border-left: 1px solid #27272a; padding-left: 6px; }
            .json-value.json-string { color: #34d399; word-break: break-all; }
            .json-value.json-number { color: #fbbf24; }
            .json-value.json-boolean { color: #c084fc; font-weight: 600; }
            .json-value.json-null { color: #94a3b8; font-style: italic; font-weight: 600; }
            .json-node-actions { display: none; margin-left: 12px; gap: 4px; }
            .json-line:hover .json-node-actions { display: inline-flex; }
            .json-action-btn { background: #27272a; border: none; color: #a1a1aa; border-radius: 3px; font-size: 10px; padding: 1px 5px; cursor: pointer; }
            .json-action-btn:hover { background: #3f3f46; color: #f4f4f5; }
            .json-show-more-btn { background: transparent; border: 1px dashed #3f3f46; color: #38bdf8; border-radius: 4px; padding: 4px 8px; font-size: 11px; cursor: pointer; margin: 6px 0; display: block; }
            .json-show-more-btn:hover { background: #27272a; }
            .json-raw-view { background: #18181b; border: 1px solid #27272a; border-radius: 6px; padding: 12px; color: #f4f4f5; overflow: auto; white-space: pre-wrap; font-size: 13px; }
            .json-highlight { background: rgba(59, 130, 246, 0.15); border-radius: 3px; }
            .json-hidden { display: none !important; }
            .hidden { display: none !important; }
          `);

          // 2. Inject Viewer logic & mount onto document.body
          if (!webContents.isDestroyed()) {
            await webContents.executeJavaScript(`(() => {
              if (window.__jsonViewerInjected) return;
              window.__jsonViewerInjected = true;

              const rawText = (document.body.innerText || '').trim();
              document.body.innerHTML = '';
              
              ${this.viewerScript}

              const container = document.createElement('div');
              document.body.appendChild(container);
              const viewer = new window.JsonViewer(container, { initialExpandDepth: 3 });
              viewer.render(rawText);
            })()`);
          }
        }
      } catch (err) {
        if (!webContents.isDestroyed()) {
          logger.log('JsonPageHandler', new Error(`Failed to handle JSON viewer for ${url}: ${err.message}`));
        }
      }
    });
  }
}

module.exports = new JsonPageHandler();
