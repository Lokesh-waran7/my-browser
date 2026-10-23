// Toolkit Panel UI Module - Manages panel docking, resizing, JSON tab, API tester, and workspace notes
(function (global) {
  'use strict';

  /**
   * Simple markdown parser that converts markdown syntax into safe HTML.
   */
  function parseMarkdownSafe(md) {
    if (!md) return '';

    // Escape HTML first to prevent any XSS injection
    const escapeHtml = (str) =>
      str.replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

    const lines = md.split('\n');
    const out = [];
    let inList = false;
    let inCodeBlock = false;
    let codeBuffer = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Code blocks ```
      if (line.trim().startsWith('```')) {
        if (inCodeBlock) {
          out.push(`<pre><code>${codeBuffer.join('\n')}</code></pre>`);
          codeBuffer = [];
          inCodeBlock = false;
        } else {
          if (inList) {
            out.push('</ul>');
            inList = false;
          }
          inCodeBlock = true;
        }
        continue;
      }

      if (inCodeBlock) {
        codeBuffer.push(escapeHtml(line));
        continue;
      }

      const trimmed = line.trim();

      // Headings
      if (trimmed.startsWith('# ')) {
        if (inList) { out.push('</ul>'); inList = false; }
        out.push(`<h1>${escapeHtml(trimmed.slice(2))}</h1>`);
        continue;
      }
      if (trimmed.startsWith('## ')) {
        if (inList) { out.push('</ul>'); inList = false; }
        out.push(`<h2>${escapeHtml(trimmed.slice(3))}</h2>`);
        continue;
      }
      if (trimmed.startsWith('### ')) {
        if (inList) { out.push('</ul>'); inList = false; }
        out.push(`<h3>${escapeHtml(trimmed.slice(4))}</h3>`);
        continue;
      }

      // Blockquote
      if (trimmed.startsWith('> ')) {
        if (inList) { out.push('</ul>'); inList = false; }
        out.push(`<blockquote>${escapeHtml(trimmed.slice(2))}</blockquote>`);
        continue;
      }

      // Bullet lists
      if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
        if (!inList) {
          out.push('<ul>');
          inList = true;
        }
        let itemContent = escapeHtml(trimmed.slice(2));
        // Inline code, bold, links
        itemContent = itemContent.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        itemContent = itemContent.replace(/`([^`]+)`/g, '<code>$1</code>');
        itemContent = itemContent.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
        out.push(`<li>${itemContent}</li>`);
        continue;
      }

      if (inList && trimmed === '') {
        out.push('</ul>');
        inList = false;
      }

      if (trimmed === '') {
        out.push('<br>');
        continue;
      }

      // Regular paragraph
      let pContent = escapeHtml(line);
      pContent = pContent.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
      pContent = pContent.replace(/\*(.*?)\*/g, '<em>$1</em>');
      pContent = pContent.replace(/`([^`]+)`/g, '<code>$1</code>');
      pContent = pContent.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
      out.push(`<p>${pContent}</p>`);
    }

    if (inList) out.push('</ul>');
    if (inCodeBlock) out.push(`<pre><code>${codeBuffer.join('\n')}</code></pre>`);

    return out.join('');
  }

  class ToolkitPanel {
    constructor(deps = {}) {
      this.deps = deps;
      this.isPanelOpen = false;
      this.activeTab = 'json'; // 'json', 'api', 'notes'
      this.activeSubtab = 'params'; // 'params', 'headers', 'body', 'vars', 'history', 'collections'
      this.notes = [];
      this.activeNoteId = null;
      this.noteSaveTimeout = null;
      this.noteMode = 'edit'; // 'edit' or 'preview'

      this.apiParams = [{ key: '', value: '', enabled: true }];
      this.apiHeaders = [{ key: '', value: '', enabled: true }];
      this.apiFormFields = [{ key: '', value: '', enabled: true }];
      this.apiVariables = {};
      this.lastApiResponse = null;

      this.initDOMElements();
      this.bindEvents();
    }

    initDOMElements() {
      // Panel & Resizer
      this.panel = document.getElementById('dev-toolkit-panel');
      this.resizer = document.getElementById('toolkit-resizer');
      this.btnDevToolkit = document.getElementById('btn-dev-toolkit');
      this.btnCloseToolkit = document.getElementById('btn-close-toolkit');

      // Toolkit Tabs
      this.tabBtnJson = document.getElementById('toolkit-tab-btn-json');
      this.tabBtnApi = document.getElementById('toolkit-tab-btn-api');
      this.tabBtnNotes = document.getElementById('toolkit-tab-btn-notes');

      this.paneJson = document.getElementById('toolkit-tab-json');
      this.paneApi = document.getElementById('toolkit-tab-api');
      this.paneNotes = document.getElementById('toolkit-tab-notes');

      // JSON Tab Elements
      this.jsonInput = document.getElementById('json-input-text');
      this.btnJsonFormat = document.getElementById('btn-json-format');
      this.btnJsonMinify = document.getElementById('btn-json-minify');
      this.btnJsonClear = document.getElementById('btn-json-clear');
      this.jsonValidationStatus = document.getElementById('json-validation-status');
      this.jsonOutputViewer = document.getElementById('json-output-viewer');
      this.jsonViewer = new window.JsonViewer(this.jsonOutputViewer, { initialExpandDepth: 3 });

      // API Tester Elements
      this.apiMethodSelect = document.getElementById('api-method-select');
      this.apiUrlInput = document.getElementById('api-url-input');
      this.btnApiSend = document.getElementById('btn-api-send');

      this.apiSubtabBtns = document.querySelectorAll('.api-subtab-btn');
      this.apiSubtabPanes = {
        params: document.getElementById('api-subtab-params'),
        headers: document.getElementById('api-subtab-headers'),
        body: document.getElementById('api-subtab-body'),
        vars: document.getElementById('api-subtab-vars'),
        history: document.getElementById('api-subtab-history'),
        collections: document.getElementById('api-subtab-collections'),
      };

      this.apiParamsList = document.getElementById('api-params-list');
      this.btnAddParam = document.getElementById('btn-add-param');

      this.apiHeadersList = document.getElementById('api-headers-list');
      this.btnAddHeader = document.getElementById('btn-add-header');

      this.apiBodyRadios = document.querySelectorAll('input[name="api-body-type"]');
      this.apiBodyJson = document.getElementById('api-body-json');
      this.apiBodyFormList = document.getElementById('api-form-list');
      this.btnAddFormField = document.getElementById('btn-add-form-pair');
      this.apiBodyRaw = document.getElementById('api-body-raw');

      this.apiVarsList = document.getElementById('api-vars-list');
      this.btnAddVar = document.getElementById('btn-add-var');
      this.btnSaveVars = document.getElementById('btn-save-vars');
      this.apiAllowPrivateToggle = document.getElementById('api-allow-private-toggle');

      this.apiHistoryList = document.getElementById('api-history-list');
      this.btnClearHistory = document.getElementById('btn-clear-api-history');

      this.apiCollectionsList = document.getElementById('api-collections-list');
      this.btnNewCollection = document.getElementById('btn-new-collection');

      this.btnCopyCurl = document.getElementById('btn-api-copy-curl');
      this.btnCopyFetch = document.getElementById('btn-api-copy-fetch');
      this.btnSaveCollection = document.getElementById('btn-api-save-collection');

      // Response Elements
      this.apiResStatus = document.getElementById('api-res-status');
      this.apiResTime = document.getElementById('api-res-time');
      this.apiResSize = document.getElementById('api-res-size');
      this.btnResTabBody = document.getElementById('btn-res-tab-body');
      this.btnResTabHeaders = document.getElementById('btn-res-tab-headers');
      this.btnCopyResponse = document.getElementById('btn-copy-response');
      this.apiResBodyWrapper = document.getElementById('api-response-body-wrapper');
      this.apiResHeadersWrapper = document.getElementById('api-response-headers-wrapper');
      this.apiResJsonViewer = document.getElementById('api-response-json-viewer');
      this.apiResRawText = document.getElementById('api-response-raw-text');
      this.apiResHeadersTbody = document.getElementById('api-response-headers-tbody');
      this.apiResponseViewer = new window.JsonViewer(this.apiResJsonViewer, { initialExpandDepth: 2 });

      // Notes Elements
      this.notesListSelect = document.getElementById('notes-list-select');
      this.btnNewNote = document.getElementById('btn-new-note');
      this.btnDeleteNote = document.getElementById('btn-delete-note');
      this.notesSearchInput = document.getElementById('notes-search-input');
      this.btnNoteAddPage = document.getElementById('btn-note-add-page');
      this.btnNoteAddSelection = document.getElementById('btn-note-add-selection');
      this.btnNoteExportMd = document.getElementById('btn-note-export-md');
      this.btnNoteModeEdit = document.getElementById('btn-note-mode-edit');
      this.btnNoteModePreview = document.getElementById('btn-note-mode-preview');
      this.noteTitleInput = document.getElementById('note-title-input');
      this.noteSaveStatus = document.getElementById('note-save-status');
      this.noteEditorTextarea = document.getElementById('note-editor-textarea');
      this.notePreviewContainer = document.getElementById('note-preview-container');

      // GPU Modal Elements
      this.gpuModal = document.getElementById('gpu-modal');
      this.btnCloseGpu = document.getElementById('btn-close-gpu');
      this.btnDoneGpu = document.getElementById('btn-done-gpu');
      this.gpuVideoDecodeBadge = document.getElementById('gpu-video-decode-badge');
      this.gpuCompositingBadge = document.getElementById('gpu-compositing-badge');
      this.gpuRendererLabel = document.getElementById('gpu-renderer-label');
      this.gpuFeaturesTbody = document.getElementById('gpu-features-tbody');
      this.gpuCompleteViewerBox = document.getElementById('gpu-complete-viewer');
      this.gpuViewer = new window.JsonViewer(this.gpuCompleteViewerBox, { initialExpandDepth: 2 });
    }

    bindEvents() {
      // Toggle button & keyboard shortcut
      if (this.btnDevToolkit) {
        this.btnDevToolkit.addEventListener('click', () => this.togglePanel());
      }
      if (this.btnCloseToolkit) {
        this.btnCloseToolkit.addEventListener('click', () => this.closePanel());
      }

      // Panel Resizer Drag
      let isResizing = false;
      this.resizer.addEventListener('pointerdown', (e) => {
        isResizing = true;
        this.resizer.setPointerCapture(e.pointerId);
        document.body.classList.add('toolkit-resizing');
      });

      this.resizer.addEventListener('pointermove', (e) => {
        if (!isResizing) return;
        const newWidth = Math.max(280, Math.min(800, window.innerWidth - e.clientX));
        this.panel.style.width = `${newWidth}px`;
        if (this.deps.onBoundsChange) this.deps.onBoundsChange();
      });

      const stopResizing = (e) => {
        if (isResizing) {
          isResizing = false;
          try { this.resizer.releasePointerCapture(e.pointerId); } catch (err) {}
          document.body.classList.remove('toolkit-resizing');
          if (this.deps.onBoundsChange) this.deps.onBoundsChange();
        }
      };
      this.resizer.addEventListener('pointerup', stopResizing);
      this.resizer.addEventListener('pointercancel', stopResizing);

      // Main Toolkit Tabs switching
      [this.tabBtnJson, this.tabBtnApi, this.tabBtnNotes].forEach((btn) => {
        btn.addEventListener('click', () => {
          this.switchTab(btn.dataset.tab);
        });
      });

      // JSON Tab Events
      this.btnJsonFormat.addEventListener('click', () => this.formatJson());
      this.btnJsonMinify.addEventListener('click', () => this.minifyJson());
      this.btnJsonClear.addEventListener('click', () => {
        this.jsonInput.value = '';
        this.jsonValidationStatus.className = 'json-validation-status hidden';
        this.jsonOutputViewer.innerHTML = '';
      });

      // API Tester Subtabs
      this.apiSubtabBtns.forEach((btn) => {
        btn.addEventListener('click', () => {
          this.switchApiSubtab(btn.dataset.subtab);
        });
      });

      // Body Radio change
      this.apiBodyRadios.forEach((r) => {
        r.addEventListener('change', () => this.updateBodyView(r.value));
      });

      // KV Add Buttons
      this.btnAddParam.addEventListener('click', () => this.addParamRow('', '', true));
      this.btnAddHeader.addEventListener('click', () => this.addHeaderRow('', '', true));
      this.btnAddFormField.addEventListener('click', () => this.addFormRow('', '', true));
      this.btnAddVar.addEventListener('click', () => this.addVarRow('', ''));

      // Save variables
      this.btnSaveVars.addEventListener('click', async () => {
        const vars = this.collectVars();
        await window.browserAPI.saveApiEnvironment(vars);
        this.btnSaveVars.textContent = 'Saved!';
        setTimeout(() => (this.btnSaveVars.textContent = 'Save Variables'), 1200);
      });

      if (this.apiAllowPrivateToggle) {
        this.apiAllowPrivateToggle.addEventListener('change', async (e) => {
          await window.browserAPI.saveApiSettings({ allowPrivateNetwork: e.target.checked });
        });
      }

      // Send Request
      this.btnApiSend.addEventListener('click', () => this.executeApiRequest());

      // cURL & Fetch
      this.btnCopyCurl.addEventListener('click', () => this.copyAsCurl());
      this.btnCopyFetch.addEventListener('click', () => this.copyAsFetch());
      this.btnSaveCollection.addEventListener('click', () => this.promptSaveToCollection());

      // History clear
      this.btnClearHistory.addEventListener('click', async () => {
        await window.browserAPI.clearApiHistory();
        this.loadApiHistory();
      });

      // New collection
      this.btnNewCollection.addEventListener('click', async () => {
        const name = prompt('Enter new collection name:');
        if (name && name.trim()) {
          await window.browserAPI.createApiCollection(name.trim());
          this.loadApiCollections();
        }
      });

      // Response Body/Headers Tabs
      this.btnResTabBody.addEventListener('click', () => {
        this.btnResTabBody.classList.add('active');
        this.btnResTabHeaders.classList.remove('active');
        this.apiResBodyWrapper.classList.remove('hidden');
        this.apiResHeadersWrapper.classList.add('hidden');
      });

      this.btnResTabHeaders.addEventListener('click', () => {
        this.btnResTabHeaders.classList.add('active');
        this.btnResTabBody.classList.remove('active');
        this.apiResHeadersWrapper.classList.remove('hidden');
        this.apiResBodyWrapper.classList.add('hidden');
      });

      this.btnCopyResponse.addEventListener('click', () => {
        if (this.lastApiResponse && this.lastApiResponse.body) {
          navigator.clipboard.writeText(this.lastApiResponse.body);
          this.btnCopyResponse.textContent = 'Copied!';
          setTimeout(() => (this.btnCopyResponse.textContent = 'Copy'), 1200);
        }
      });

      // Notes Events
      this.notesListSelect.addEventListener('change', (e) => this.selectNote(e.target.value));
      this.btnNewNote.addEventListener('click', () => this.createNewNote());
      this.btnDeleteNote.addEventListener('click', () => this.deleteActiveNote());
      this.notesSearchInput.addEventListener('input', (e) => this.filterNotes(e.target.value.trim().toLowerCase()));

      this.noteTitleInput.addEventListener('input', () => this.triggerNoteAutoSave());
      this.noteEditorTextarea.addEventListener('input', () => this.triggerNoteAutoSave());

      this.btnNoteModeEdit.addEventListener('click', () => this.setNoteMode('edit'));
      this.btnNoteModePreview.addEventListener('click', () => this.setNoteMode('preview'));

      this.btnNoteAddPage.addEventListener('click', () => this.addCurrentPageToNote());
      this.btnNoteAddSelection.addEventListener('click', () => this.addSelectedTextToNote());
      this.btnNoteExportMd.addEventListener('click', () => this.exportCurrentNote());

      // GPU Modal Events
      if (this.btnCloseGpu) this.btnCloseGpu.addEventListener('click', () => this.closeGpuModal());
      if (this.btnDoneGpu) this.btnDoneGpu.addEventListener('click', () => this.closeGpuModal());
      if (this.gpuModal) {
        this.gpuModal.addEventListener('click', (e) => {
          if (e.target === this.gpuModal) this.closeGpuModal();
        });
      }

      // Initial defaults for API tester
      this.addParamRow('', '', true);
      this.addHeaderRow('Accept', 'application/json', true);
      this.addFormRow('', '', true);
      this.loadApiEnvironment();
      this.loadApiHistory();
      this.loadApiCollections();
    }

    togglePanel(forceState) {
      this.isPanelOpen = typeof forceState === 'boolean' ? forceState : !this.isPanelOpen;
      if (this.isPanelOpen) {
        this.panel.classList.remove('hidden');
        this.btnDevToolkit.classList.add('active');
        if (this.activeTab === 'notes') {
          this.loadWorkspaceNotes();
        }
      } else {
        this.panel.classList.add('hidden');
        this.btnDevToolkit.classList.remove('active');
      }
      if (this.deps.onBoundsChange) this.deps.onBoundsChange();
    }

    openPanel() {
      if (!this.isPanelOpen) this.togglePanel(true);
    }

    closePanel() {
      if (this.isPanelOpen) this.togglePanel(false);
    }

    switchTab(tabId) {
      this.activeTab = tabId;
      [this.tabBtnJson, this.tabBtnApi, this.tabBtnNotes].forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.tab === tabId);
      });
      this.paneJson.classList.toggle('hidden', tabId !== 'json');
      this.paneApi.classList.toggle('hidden', tabId !== 'api');
      this.paneNotes.classList.toggle('hidden', tabId !== 'notes');

      if (tabId === 'notes') {
        this.loadWorkspaceNotes();
      }
    }

    // =========================================================================
    // JSON Formatter & Validator
    // =========================================================================
    formatJson() {
      const text = this.jsonInput.value.trim();
      if (!text) {
        this.jsonValidationStatus.className = 'json-validation-status hidden';
        this.jsonOutputViewer.innerHTML = '';
        return;
      }

      try {
        const parsed = JSON.parse(text);
        const formatted = JSON.stringify(parsed, null, 2);
        this.jsonInput.value = formatted;
        this.jsonValidationStatus.className = 'json-validation-status valid';
        this.jsonValidationStatus.textContent = '✓ Valid JSON (Formatted)';
        this.jsonValidationStatus.classList.remove('hidden');
        this.jsonViewer.render(parsed);
      } catch (err) {
        this.jsonValidationStatus.className = 'json-validation-status invalid';
        const match = err.message.match(/position\s+(\d+)/i);
        let locText = '';
        if (match) {
          const pos = parseInt(match[1], 10);
          const lines = text.slice(0, pos).split('\n');
          locText = ` (Line ${lines.length}, Col ${lines[lines.length - 1].length + 1})`;
        }
        this.jsonValidationStatus.textContent = `✕ Syntax Error${locText}: ${err.message}`;
        this.jsonValidationStatus.classList.remove('hidden');
        this.jsonViewer.render(text); // JsonViewer handles error banner internally
      }
    }

    minifyJson() {
      const text = this.jsonInput.value.trim();
      if (!text) return;
      try {
        const parsed = JSON.parse(text);
        this.jsonInput.value = JSON.stringify(parsed);
        this.jsonValidationStatus.className = 'json-validation-status valid';
        this.jsonValidationStatus.textContent = '✓ Valid JSON (Minified)';
        this.jsonValidationStatus.classList.remove('hidden');
      } catch (err) {
        this.formatJson(); // will show error
      }
    }

    // =========================================================================
    // API Tester
    // =========================================================================
    switchApiSubtab(subtabId) {
      this.activeSubtab = subtabId;
      this.apiSubtabBtns.forEach((b) => b.classList.toggle('active', b.dataset.subtab === subtabId));
      Object.keys(this.apiSubtabPanes).forEach((key) => {
        this.apiSubtabPanes[key].classList.toggle('hidden', key !== subtabId);
      });
      if (subtabId === 'history') this.loadApiHistory();
      if (subtabId === 'collections') this.loadApiCollections();
    }

    updateBodyView(type) {
      document.getElementById('api-body-json-wrapper').classList.toggle('hidden', type !== 'json');
      document.getElementById('api-body-form-wrapper').classList.toggle('hidden', type !== 'form');
      document.getElementById('api-body-raw-wrapper').classList.toggle('hidden', type !== 'raw');
    }

    createKvRow(key = '', val = '', onRemove) {
      const row = document.createElement('div');
      row.className = 'kv-row';

      const keyInput = document.createElement('input');
      keyInput.className = 'kv-input';
      keyInput.placeholder = 'Key';
      keyInput.value = key;

      const valInput = document.createElement('input');
      valInput.className = 'kv-input';
      valInput.placeholder = 'Value';
      valInput.value = val;

      const delBtn = document.createElement('button');
      delBtn.className = 'kv-del-btn';
      delBtn.innerHTML = '&times;';
      delBtn.title = 'Remove row';
      delBtn.addEventListener('click', () => {
        row.remove();
        if (onRemove) onRemove();
      });

      row.appendChild(keyInput);
      row.appendChild(valInput);
      row.appendChild(delBtn);
      return { row, keyInput, valInput };
    }

    addParamRow(key = '', val = '') {
      const { row } = this.createKvRow(key, val);
      this.apiParamsList.appendChild(row);
    }

    addHeaderRow(key = '', val = '') {
      const { row } = this.createKvRow(key, val);
      this.apiHeadersList.appendChild(row);
    }

    addFormRow(key = '', val = '') {
      const { row } = this.createKvRow(key, val);
      this.apiBodyFormList.appendChild(row);
    }

    addVarRow(key = '', val = '') {
      const { row } = this.createKvRow(key, val);
      this.apiVarsList.appendChild(row);
    }

    collectKv(container) {
      const rows = container.querySelectorAll('.kv-row');
      const pairs = [];
      rows.forEach((r) => {
        const inputs = r.querySelectorAll('.kv-input');
        const k = inputs[0] ? inputs[0].value.trim() : '';
        const v = inputs[1] ? inputs[1].value : '';
        if (k) pairs.push({ key: k, value: v, enabled: true });
      });
      return pairs;
    }

    collectVars() {
      const rows = this.apiVarsList.querySelectorAll('.kv-row');
      const vars = {};
      rows.forEach((r) => {
        const inputs = r.querySelectorAll('.kv-input');
        const k = inputs[0] ? inputs[0].value.trim() : '';
        const v = inputs[1] ? inputs[1].value : '';
        if (k) vars[k] = v;
      });
      return vars;
    }

    async loadApiEnvironment() {
      try {
        const env = await window.browserAPI.getApiEnvironment();
        this.apiVarsList.innerHTML = '';
        if (env && Object.keys(env).length > 0) {
          Object.keys(env).forEach((k) => this.addVarRow(k, env[k]));
        } else {
          this.addVarRow('baseUrl', 'https://jsonplaceholder.typicode.com');
          this.addVarRow('token', '');
        }

        const settings = await window.browserAPI.getApiSettings();
        if (settings && this.apiAllowPrivateToggle) {
          this.apiAllowPrivateToggle.checked = settings.allowPrivateNetwork !== false;
        }
      } catch (e) {}
    }

    async loadApiHistory() {
      try {
        const list = await window.browserAPI.getApiHistory();
        this.apiHistoryList.innerHTML = '';
        if (!list || list.length === 0) {
          this.apiHistoryList.innerHTML = '<div style="color:#71717a;padding:8px 0;font-size:11px;">No requests sent yet</div>';
          return;
        }
        list.forEach((item) => {
          const el = document.createElement('div');
          el.className = 'api-history-item';
          el.innerHTML = `
            <div style="display:flex;align-items:center;overflow:hidden;gap:6px;">
              <span class="api-item-method ${item.method}">${item.method}</span>
              <span class="api-item-url" title="${item.url}">${item.url}</span>
            </div>
            <span style="font-size:10px;color:#a1a1aa;white-space:nowrap;">${item.status || 'Err'}</span>
          `;
          el.addEventListener('click', () => this.loadRequestIntoEditor(item));
          this.apiHistoryList.appendChild(el);
        });
      } catch (e) {}
    }

    async loadApiCollections() {
      try {
        const cols = await window.browserAPI.getApiCollections();
        this.apiCollectionsList.innerHTML = '';
        const names = Object.keys(cols || {});
        if (names.length === 0) {
          this.apiCollectionsList.innerHTML = '<div style="color:#71717a;padding:8px 0;font-size:11px;">No collections saved</div>';
          return;
        }
        names.forEach((name) => {
          const colWrapper = document.createElement('div');
          colWrapper.style.marginBottom = '8px';

          const colHeader = document.createElement('div');
          colHeader.style.display = 'flex';
          colHeader.style.justifyContent = 'space-between';
          colHeader.style.alignItems = 'center';
          colHeader.style.padding = '4px 0';
          colHeader.style.fontSize = '12px';
          colHeader.style.fontWeight = '600';
          colHeader.style.color = '#38bdf8';
          colHeader.innerHTML = `<span>📁 ${name}</span>`;

          colWrapper.appendChild(colHeader);

          const items = cols[name] || [];
          items.forEach((req) => {
            const itemEl = document.createElement('div');
            itemEl.className = 'api-collection-item';
            itemEl.innerHTML = `
              <div style="display:flex;align-items:center;gap:6px;overflow:hidden;">
                <span class="api-item-method ${req.method}">${req.method}</span>
                <span style="font-weight:500;color:#f4f4f5;">${req.name}</span>
                <span class="api-item-url" style="color:#71717a;" title="${req.url}">(${req.url})</span>
              </div>
            `;
            itemEl.addEventListener('click', () => this.loadRequestIntoEditor(req));
            colWrapper.appendChild(itemEl);
          });

          this.apiCollectionsList.appendChild(colWrapper);
        });
      } catch (e) {}
    }

    loadRequestIntoEditor(req) {
      if (!req) return;
      this.apiMethodSelect.value = req.method || 'GET';
      this.apiUrlInput.value = req.url || '';

      if (req.params && Array.isArray(req.params)) {
        this.apiParamsList.innerHTML = '';
        req.params.forEach((p) => this.addParamRow(p.key, p.value));
      }
      if (req.headers && Array.isArray(req.headers)) {
        this.apiHeadersList.innerHTML = '';
        req.headers.forEach((h) => this.addHeaderRow(h.key, h.value));
      }
      if (req.bodyType) {
        const radio = document.querySelector(`input[name="api-body-type"][value="${req.bodyType}"]`);
        if (radio) {
          radio.checked = true;
          this.updateBodyView(req.bodyType);
        }
        if (req.bodyType === 'json') this.apiBodyJson.value = req.body || '';
        if (req.bodyType === 'raw') this.apiBodyRaw.value = req.body || '';
        if (req.bodyType === 'form' && Array.isArray(req.body)) {
          this.apiBodyFormList.innerHTML = '';
          req.body.forEach((f) => this.addFormRow(f.key, f.value));
        }
      }
      this.switchApiSubtab('params');
    }

    async executeApiRequest() {
      const url = this.apiUrlInput.value.trim();
      if (!url) {
        alert('Please enter a target URL.');
        return;
      }

      const method = this.apiMethodSelect.value;
      const headers = this.collectKv(this.apiHeadersList);
      const params = this.collectKv(this.apiParamsList);
      const selectedBodyRadio = document.querySelector('input[name="api-body-type"]:checked');
      const bodyType = selectedBodyRadio ? selectedBodyRadio.value : 'none';

      let body = '';
      if (bodyType === 'json') body = this.apiBodyJson.value;
      else if (bodyType === 'raw') body = this.apiBodyRaw.value;
      else if (bodyType === 'form') body = this.collectKv(this.apiBodyFormList);

      this.apiResStatus.className = 'api-status-badge';
      this.apiResStatus.textContent = 'Sending...';
      this.btnApiSend.disabled = true;

      try {
        const result = await window.browserAPI.sendApiRequest({
          method,
          url,
          headers,
          params,
          bodyType,
          body,
          allowPrivateNetwork: this.apiAllowPrivateToggle ? this.apiAllowPrivateToggle.checked : true,
        });

        this.lastApiResponse = result;

        // Render Status Badge
        const statusClass = result.status >= 200 && result.status < 300
          ? 'status-2xx'
          : result.status >= 300 && result.status < 400
          ? 'status-3xx'
          : result.status >= 400 && result.status < 500
          ? 'status-4xx'
          : 'status-5xx';

        this.apiResStatus.className = `api-status-badge ${statusClass}`;
        this.apiResStatus.textContent = `${result.status} ${result.statusText}`;
        this.apiResTime.textContent = `${result.timeMs} ms`;
        this.apiResSize.textContent = `${(result.sizeBytes / 1024).toFixed(1)} KB`;

        // Render Body
        if (result.isJson && result.json) {
          this.apiResJsonViewer.classList.remove('hidden');
          this.apiResRawText.classList.add('hidden');
          this.apiResponseViewer.render(result.json);
        } else {
          this.apiResJsonViewer.classList.add('hidden');
          this.apiResRawText.classList.remove('hidden');
          this.apiResRawText.textContent = result.body || '<Empty Response>';
        }

        // Render Headers Table
        this.apiResHeadersTbody.innerHTML = '';
        if (result.headers) {
          Object.keys(result.headers).forEach((k) => {
            const tr = document.createElement('tr');
            tr.innerHTML = `<td><strong>${k}</strong></td><td>${result.headers[k]}</td>`;
            this.apiResHeadersTbody.appendChild(tr);
          });
        }
      } catch (err) {
        this.apiResStatus.className = 'api-status-badge status-5xx';
        this.apiResStatus.textContent = 'Error';
        this.apiResTime.textContent = '-- ms';
        this.apiResSize.textContent = '0 KB';
        this.apiResJsonViewer.classList.add('hidden');
        this.apiResRawText.classList.remove('hidden');
        this.apiResRawText.textContent = `❌ ${err.message}`;
      } finally {
        this.btnApiSend.disabled = false;
        this.loadApiHistory();
      }
    }

    copyAsCurl() {
      const method = this.apiMethodSelect.value;
      const url = this.apiUrlInput.value.trim() || 'https://api.example.com';
      const headers = this.collectKv(this.apiHeadersList);
      const selectedBodyRadio = document.querySelector('input[name="api-body-type"]:checked');
      const bodyType = selectedBodyRadio ? selectedBodyRadio.value : 'none';

      let parts = [`curl -X ${method} "${url}"`];
      headers.forEach((h) => {
        parts.push(`-H "${h.key}: ${h.value}"`);
      });

      if (bodyType === 'json' && this.apiBodyJson.value.trim()) {
        parts.push(`-d '${this.apiBodyJson.value.trim()}'`);
      } else if (bodyType === 'raw' && this.apiBodyRaw.value.trim()) {
        parts.push(`-d '${this.apiBodyRaw.value.trim()}'`);
      }

      navigator.clipboard.writeText(parts.join(' \\\n  '));
      this.btnCopyCurl.textContent = 'Copied!';
      setTimeout(() => (this.btnCopyCurl.textContent = 'cURL'), 1200);
    }

    copyAsFetch() {
      const method = this.apiMethodSelect.value;
      const url = this.apiUrlInput.value.trim() || 'https://api.example.com';
      const headersObj = {};
      this.collectKv(this.apiHeadersList).forEach((h) => { headersObj[h.key] = h.value; });

      const selectedBodyRadio = document.querySelector('input[name="api-body-type"]:checked');
      const bodyType = selectedBodyRadio ? selectedBodyRadio.value : 'none';

      let bodyStr = '';
      if (bodyType === 'json' && this.apiBodyJson.value.trim()) {
        bodyStr = `,\n  body: JSON.stringify(${this.apiBodyJson.value.trim()})`;
      } else if (bodyType === 'raw' && this.apiBodyRaw.value.trim()) {
        bodyStr = `,\n  body: ${JSON.stringify(this.apiBodyRaw.value.trim())}`;
      }

      const code = `fetch("${url}", {\n  method: "${method}",\n  headers: ${JSON.stringify(headersObj, null, 2)}${bodyStr}\n})\n  .then(res => res.json())\n  .then(data => console.log(data));`;

      navigator.clipboard.writeText(code);
      this.btnCopyFetch.textContent = 'Copied!';
      setTimeout(() => (this.btnCopyFetch.textContent = 'fetch'), 1200);
    }

    async promptSaveToCollection() {
      const reqName = prompt('Enter a name for this request:', 'My API Request');
      if (!reqName) return;
      const colName = prompt('Save into which collection?', 'Default') || 'Default';

      const method = this.apiMethodSelect.value;
      const url = this.apiUrlInput.value.trim();
      const headers = this.collectKv(this.apiHeadersList);
      const params = this.collectKv(this.apiParamsList);
      const selectedBodyRadio = document.querySelector('input[name="api-body-type"]:checked');
      const bodyType = selectedBodyRadio ? selectedBodyRadio.value : 'none';

      let body = '';
      if (bodyType === 'json') body = this.apiBodyJson.value;
      else if (bodyType === 'raw') body = this.apiBodyRaw.value;
      else if (bodyType === 'form') body = this.collectKv(this.apiBodyFormList);

      await window.browserAPI.saveApiToCollection({
        collectionName: colName,
        requestData: {
          name: reqName,
          method,
          url,
          headers,
          params,
          bodyType,
          body,
        },
      });

      this.btnSaveCollection.textContent = '✓';
      setTimeout(() => (this.btnSaveCollection.textContent = '💾'), 1200);
      this.loadApiCollections();
    }

    // =========================================================================
    // Workspace Notes
    // =========================================================================
    async loadWorkspaceNotes() {
      const wsId = this.deps.getActiveWorkspaceId ? this.deps.getActiveWorkspaceId() : 'ws-default';
      try {
        this.notes = await window.browserAPI.getWorkspaceNotes(wsId);
        this.renderNotesSelector();
        if (this.notes.length > 0 && (!this.activeNoteId || !this.notes.find((n) => n.id === this.activeNoteId))) {
          this.selectNote(this.notes[0].id);
        }
      } catch (e) {}
    }

    renderNotesSelector(filteredList) {
      const list = filteredList || this.notes;
      this.notesListSelect.innerHTML = '';
      list.forEach((n) => {
        const opt = document.createElement('option');
        opt.value = n.id;
        opt.textContent = n.title || 'Untitled Note';
        if (n.id === this.activeNoteId) opt.selected = true;
        this.notesListSelect.appendChild(opt);
      });
    }

    selectNote(noteId) {
      this.activeNoteId = noteId;
      const note = this.notes.find((n) => n.id === noteId);
      if (!note) return;
      this.noteTitleInput.value = note.title || '';
      this.noteEditorTextarea.value = note.content || '';
      this.noteSaveStatus.textContent = 'Saved';
      this.updateNotePreview();
    }

    async createNewNote() {
      const wsId = this.deps.getActiveWorkspaceId ? this.deps.getActiveWorkspaceId() : 'ws-default';
      const newNote = {
        id: `note-${Date.now()}`,
        title: 'New Note',
        content: '# New Note\n\nStart typing...',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      await window.browserAPI.saveNote({ workspaceId: wsId, note: newNote });
      await this.loadWorkspaceNotes();
      this.selectNote(newNote.id);
      this.noteTitleInput.focus();
      this.noteTitleInput.select();
    }

    async deleteActiveNote() {
      if (!this.activeNoteId) return;
      if (!confirm('Are you sure you want to delete this note?')) return;
      const wsId = this.deps.getActiveWorkspaceId ? this.deps.getActiveWorkspaceId() : 'ws-default';
      await window.browserAPI.deleteNote({ workspaceId: wsId, noteId: this.activeNoteId });
      this.activeNoteId = null;
      await this.loadWorkspaceNotes();
    }

    triggerNoteAutoSave() {
      this.noteSaveStatus.textContent = 'Saving...';
      this.updateNotePreview();

      if (this.noteSaveTimeout) clearTimeout(this.noteSaveTimeout);
      this.noteSaveTimeout = setTimeout(async () => {
        const wsId = this.deps.getActiveWorkspaceId ? this.deps.getActiveWorkspaceId() : 'ws-default';
        const note = {
          id: this.activeNoteId,
          title: this.noteTitleInput.value.trim() || 'Untitled Note',
          content: this.noteEditorTextarea.value,
        };
        await window.browserAPI.saveNote({ workspaceId: wsId, note });
        this.noteSaveStatus.textContent = 'Saved';

        const opt = this.notesListSelect.querySelector(`option[value="${this.activeNoteId}"]`);
        if (opt) opt.textContent = note.title;
      }, 400);
    }

    setNoteMode(mode) {
      this.noteMode = mode;
      this.btnNoteModeEdit.classList.toggle('active', mode === 'edit');
      this.btnNoteModePreview.classList.toggle('active', mode === 'preview');
      this.noteEditorTextarea.classList.toggle('hidden', mode === 'preview');
      this.notePreviewContainer.classList.toggle('hidden', mode === 'edit');
      if (mode === 'preview') {
        this.updateNotePreview();
      }
    }

    updateNotePreview() {
      const md = this.noteEditorTextarea.value;
      this.notePreviewContainer.innerHTML = parseMarkdownSafe(md);
    }

    addCurrentPageToNote() {
      const tab = this.deps.getTargetTab ? this.deps.getTargetTab() : null;
      if (!tab) return;
      const snippet = `\n\n[${tab.title || 'Page'}](${tab.url})\n`;
      this.appendSnippetToActiveNote(snippet);
    }

    async addSelectedTextToNote() {
      try {
        const selected = await window.browserAPI.getSelectedText();
        if (selected && selected.trim()) {
          const snippet = `\n\n> ${selected.trim()}\n`;
          this.appendSnippetToActiveNote(snippet);
        } else {
          alert('No text currently selected on the active page.');
        }
      } catch (e) {}
    }

    appendSnippetToActiveNote(snippet) {
      this.openPanel();
      this.switchTab('notes');
      this.noteEditorTextarea.value += snippet;
      this.triggerNoteAutoSave();
    }

    async exportCurrentNote() {
      const title = this.noteTitleInput.value.trim() || 'Note';
      const content = this.noteEditorTextarea.value;
      const res = await window.browserAPI.exportNote({ title, content });
      if (res && res.success) {
        alert('Note successfully exported to ' + res.filePath);
      }
    }

    filterNotes(query) {
      if (!query) {
        this.renderNotesSelector();
        return;
      }
      const filtered = this.notes.filter((n) =>
        (n.title && n.title.toLowerCase().includes(query)) ||
        (n.content && n.content.toLowerCase().includes(query))
      );
      this.renderNotesSelector(filtered);
    }

    // =========================================================================
    // GPU Diagnostics Modal
    // =========================================================================
    async openGpuDiagnostics() {
      try {
        const res = await window.browserAPI.getGpuInfo();
        if (!res) return;

        const { status, info } = res;

        // Video decode badge
        const isVideoHw = status.video_decode === 'enabled' || status.video_decode === 'enabled_readback';
        this.gpuVideoDecodeBadge.className = `badge-status ${isVideoHw ? 'enabled' : 'disabled'}`;
        this.gpuVideoDecodeBadge.textContent = isVideoHw ? 'Hardware Accelerated (Enabled)' : 'Software Fallback (Disabled)';

        // GPU compositing badge
        const isCompHw = status.gpu_compositing === 'enabled';
        this.gpuCompositingBadge.className = `badge-status ${isCompHw ? 'enabled' : 'disabled'}`;
        this.gpuCompositingBadge.textContent = isCompHw ? 'Hardware Accelerated (Enabled)' : 'Software Fallback (Disabled)';

        // Device string
        let deviceName = 'GPU Device';
        if (info && info.gpuDevice && info.gpuDevice[0] && info.gpuDevice[0].deviceString) {
          deviceName = info.gpuDevice[0].deviceString;
        } else if (info && info.auxAttributes && info.auxAttributes.glRenderer) {
          deviceName = info.auxAttributes.glRenderer;
        }
        this.gpuRendererLabel.textContent = deviceName;

        // Populate feature table
        this.gpuFeaturesTbody.innerHTML = '';
        Object.keys(status).forEach((feat) => {
          const val = status[feat];
          const isHw = val === 'enabled' || val === 'enabled_force' || val === 'enabled_on' || val === 'enabled_readback';
          const tr = document.createElement('tr');
          tr.innerHTML = `
            <td><strong>${feat}</strong></td>
            <td><code>${val}</code></td>
            <td><span class="badge-status ${isHw ? 'enabled' : 'disabled'}">${isHw ? 'Yes (Hardware)' : 'No (Software)'}</span></td>
          `;
          this.gpuFeaturesTbody.appendChild(tr);
        });

        // Render full GPU info with JsonViewer
        this.gpuViewer.render(info);

        if (this.deps.showOverlay) {
          this.deps.showOverlay(this.gpuModal);
        } else {
          this.gpuModal.classList.remove('hidden');
        }
      } catch (err) {
        console.error('Failed to load GPU info:', err);
      }
    }

    closeGpuModal() {
      if (this.deps.hideOverlay) {
        this.deps.hideOverlay(this.gpuModal);
      } else {
        this.gpuModal.classList.add('hidden');
      }
    }
  }

  // Export to window or module
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = ToolkitPanel;
  }
  if (typeof window !== 'undefined') {
    window.ToolkitPanel = ToolkitPanel;
  }
})(typeof window !== 'undefined' ? window : global);
