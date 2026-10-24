// AI Sidebar Assistant UI Module - Manages chat panel, streaming, quick actions, and settings modal
(function (global) {
  'use strict';

  class AIPanel {
    constructor(deps = {}) {
      this.deps = deps; // { onBoundsChange, getActiveWorkspaceId, showOverlay, hideOverlay }
      this.activeWorkspaceId = null;
      this.isGenerating = false;
      this.currentStreamId = null;
      this.currentStreamingText = '';
      this.pendingPageContext = null;
      this.settings = null;
      this._thinkingInterval = null;  // interval for "Thinking..." timer
      this._rafPending = false;       // requestAnimationFrame flush flag
      this._pendingChunks = '';       // batched chunk text for RAF flush

      this.initDOMElements();
      this.bindEvents();
      this.loadSettings();
    }

    initDOMElements() {
      // Main Panel & Tabs
      this.panel = document.getElementById('dev-toolkit-panel');
      this.paneAi = document.getElementById('toolkit-tab-ai');
      this.tabBtnAi = document.getElementById('toolkit-tab-btn-ai');

      // Header Controls
      this.modelBadge = document.getElementById('ai-model-badge');
      this.btnSettings = document.getElementById('btn-ai-settings');
      this.btnNewChat = document.getElementById('btn-ai-new-chat');

      // Page Context Bar
      this.contextBar = document.getElementById('ai-context-indicator');
      this.contextTitle = document.getElementById('ai-context-title');
      this.btnRemoveContext = document.getElementById('btn-ai-remove-context');

      // Quick Actions
      this.quickActionBtns = document.querySelectorAll('.ai-quick-btn');

      // Chat List & Form
      this.chatMessages = document.getElementById('ai-chat-messages');
      this.chatForm = document.getElementById('ai-chat-form');
      this.chatInput = document.getElementById('ai-chat-input');
      this.btnAttachPage = document.getElementById('btn-ai-attach-page');
      this.btnSend = document.getElementById('btn-ai-send');
      this.btnStop = document.getElementById('btn-ai-stop');

      // Settings Modal
      this.settingsModal = document.getElementById('ai-settings-modal');
      this.apiKeyInput = document.getElementById('ai-key-input');
      this.btnToggleKeyVisibility = document.getElementById('btn-toggle-key-visibility');
      this.keyStatusLabel = document.getElementById('ai-key-status-label');
      this.encryptionStatus = document.getElementById('ai-encryption-status');
      this.btnDeleteKey = document.getElementById('btn-delete-ai-key');
      this.modelSelect = document.getElementById('ai-model-select');
      this.speedSelect = document.getElementById('ai-speed-select');
      this.btnTestConnection = document.getElementById('btn-test-ai-connection');
      this.testStatusBanner = document.getElementById('ai-test-status-banner');
      this.neverShareInput = document.getElementById('ai-never-share-input');
      this.btnAddNeverShare = document.getElementById('btn-add-never-share');
      this.neverShareList = document.getElementById('ai-never-share-list');
      this.usageCounter = document.getElementById('ai-usage-counter');
      this.btnCloseSettings = document.getElementById('btn-close-ai-settings');
      this.btnSaveSettings = document.getElementById('btn-save-ai-settings');
    }

    bindEvents() {
      // Chat Form submission
      if (this.chatForm) {
        this.chatForm.addEventListener('submit', (e) => {
          e.preventDefault();
          this.sendMessage();
        });
      }

      // Send Button click
      if (this.btnSend) {
        this.btnSend.addEventListener('click', (e) => {
          e.preventDefault();
          this.sendMessage();
        });
      }

      // Enter to send, Shift+Enter for newline
      if (this.chatInput) {
        this.chatInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            this.sendMessage();
          }
        });

        // Auto-expand textarea
        this.chatInput.addEventListener('input', () => {
          this.chatInput.style.height = 'auto';
          this.chatInput.style.height = Math.min(140, Math.max(38, this.chatInput.scrollHeight)) + 'px';
        });
      }

      // Stop Streaming button
      if (this.btnStop) {
        this.btnStop.addEventListener('click', () => {
          this.stopStreaming();
        });
      }

      // New Chat / Clear History
      if (this.btnNewChat) {
        this.btnNewChat.addEventListener('click', () => {
          this.clearCurrentHistory();
        });
      }

      // Attach Page button
      if (this.btnAttachPage) {
        this.btnAttachPage.addEventListener('click', () => {
          this.attachActivePage();
        });
      }

      // Remove Page Context
      if (this.btnRemoveContext) {
        this.btnRemoveContext.addEventListener('click', () => {
          this.clearPendingPageContext();
        });
      }

      // Quick Actions
      this.quickActionBtns.forEach((btn) => {
        btn.addEventListener('click', () => {
          const action = btn.dataset.action;
          this.handleQuickAction(action);
        });
      });

      // Settings Modal Open/Close
      if (this.btnSettings) {
        this.btnSettings.addEventListener('click', () => {
          this.openSettingsModal();
        });
      }
      if (this.btnCloseSettings) {
        this.btnCloseSettings.addEventListener('click', () => {
          this.closeSettingsModal();
        });
      }
      if (this.btnSaveSettings) {
        this.btnSaveSettings.addEventListener('click', () => {
          this.saveSettingsFromModal();
        });
      }

      // Toggle key visibility
      if (this.btnToggleKeyVisibility) {
        this.btnToggleKeyVisibility.addEventListener('click', () => {
          if (this.apiKeyInput.type === 'password') {
            this.apiKeyInput.type = 'text';
            this.btnToggleKeyVisibility.textContent = '🙈';
          } else {
            this.apiKeyInput.type = 'password';
            this.btnToggleKeyVisibility.textContent = '👁️';
          }
        });
      }

      // Delete Key button
      if (this.btnDeleteKey) {
        this.btnDeleteKey.addEventListener('click', async () => {
          if (confirm('Are you sure you want to delete your stored API key?')) {
            await window.browserAPI.updateAiSettings({ apiKey: '' });
            this.apiKeyInput.value = '';
            await this.loadSettings();
            this.showTestStatus('API key deleted.', 'info');
          }
        });
      }

      // Test Connection button
      if (this.btnTestConnection) {
        this.btnTestConnection.addEventListener('click', () => {
          this.testConnection();
        });
      }

      // Add "Never share" domain
      if (this.btnAddNeverShare) {
        this.btnAddNeverShare.addEventListener('click', () => {
          this.addNeverShareDomain();
        });
      }
      if (this.neverShareInput) {
        this.neverShareInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            this.addNeverShareDomain();
          }
        });
      }

      // Stream IPC listeners
      if (window.browserAPI.onAiStreamChunk) {
        window.browserAPI.onAiStreamChunk((data) => {
          if (data && data.streamId === this.currentStreamId) {
            this.handleStreamChunk(data.chunk);
          }
        });
      }

      if (window.browserAPI.onAiStreamEnd) {
        window.browserAPI.onAiStreamEnd((data) => {
          if (data && data.streamId === this.currentStreamId) {
            this.handleStreamEnd(data.fullText, data.message);
          }
        });
      }

      if (window.browserAPI.onAiStreamError) {
        window.browserAPI.onAiStreamError((data) => {
          if (data && data.streamId === this.currentStreamId) {
            this.handleStreamError(data.error, data.details, data.type);
          }
        });
      }

      // Model retired or switched notification listener
      if (window.browserAPI.onAiModelNotice) {
        window.browserAPI.onAiModelNotice((data) => {
          if (data && data.newModel) {
            this.handleModelNotice(data);
          }
        });
      }

      // Context menu right-click trigger: "Ask AI about selection"
      if (window.browserAPI.onAiAskSelection) {
        window.browserAPI.onAiAskSelection(({ text }) => {
          this.handleAskSelectionFromContextMenu(text);
        });
      }
    }

    /**
     * Loads settings from the main process.
     */
    async loadSettings(forceRefresh = false) {
      try {
        const settings = await window.browserAPI.getAiSettings(forceRefresh);
        if (settings) {
          this.settings = settings;
          if (this.modelBadge) {
            this.modelBadge.textContent = settings.model || 'No model';
          }
          this.populateSettingsModal();
        }
      } catch (err) {
        console.error('Failed to load AI settings:', err);
      }
    }

    populateSettingsModal() {
      if (!this.settings) return;

      // Masked key display
      if (this.settings.hasKey) {
        this.keyStatusLabel.textContent = `Stored securely (${this.settings.maskedKey})`;
        this.keyStatusLabel.classList.remove('text-muted');
        this.keyStatusLabel.classList.add('text-success');
        this.btnDeleteKey.classList.remove('hidden');
      } else {
        this.keyStatusLabel.textContent = 'No API key stored';
        this.keyStatusLabel.classList.remove('text-success');
        this.keyStatusLabel.classList.add('text-muted');
        this.btnDeleteKey.classList.add('hidden');
      }

      // Encryption status badge
      if (this.settings.encryptionAvailable) {
        this.encryptionStatus.textContent = '🔒 Protected with system safeStorage (DPAPI/Keychain)';
        this.encryptionStatus.className = 'ai-encryption-badge encrypted';
      } else {
        this.encryptionStatus.textContent = '⚠️ System safeStorage unavailable (fallback storage)';
        this.encryptionStatus.className = 'ai-encryption-badge unencrypted';
      }

      // Populate model options dynamically
      if (this.modelSelect) {
        this.modelSelect.innerHTML = '';
        if (this.settings.availableModels && this.settings.availableModels.length > 0) {
          this.settings.availableModels.forEach((m) => {
            const opt = document.createElement('option');
            opt.value = m.id;
            opt.textContent = m.name;
            if (m.id === this.settings.model) opt.selected = true;
            this.modelSelect.appendChild(opt);
          });
        } else {
          const opt = document.createElement('option');
          opt.value = '';
          opt.textContent = this.settings.hasKey ? 'Loading available models...' : 'Enter API key to load models';
          this.modelSelect.appendChild(opt);
        }
      }

      // Populate Never Share domains
      this.renderNeverShareList();

      // Set response speed dropdown
      if (this.speedSelect && this.settings.responseSpeed) {
        this.speedSelect.value = this.settings.responseSpeed;
      }

      // Populate daily usage tracker (Free-tier friendly count per model)
      if (this.usageCounter) {
        const usage = this.settings.usageToday || { requests: {} };
        const requests = usage.requests || {};
        const entries = Object.entries(requests);
        if (entries.length === 0) {
          this.usageCounter.innerHTML = '<span class="text-xs text-muted">0 requests recorded today</span>';
        } else {
          const total = entries.reduce((sum, [, count]) => sum + count, 0);
          let html = `<div class="ai-usage-total-badge"><strong>Total Today:</strong> ${total} requests</div><div class="ai-usage-list">`;
          entries.forEach(([modelId, count]) => {
            const isCurrent = modelId === this.settings.model;
            html += `
              <div class="ai-usage-row ${isCurrent ? 'current' : ''}">
                <span class="ai-usage-model-name">${escapeHtml(modelId)}${isCurrent ? ' (active)' : ''}</span>
                <span class="ai-usage-count">${count} req</span>
              </div>
            `;
          });
          html += '</div>';
          this.usageCounter.innerHTML = html;
        }
      }
    }

    renderNeverShareList() {
      if (!this.neverShareList || !this.settings) return;
      this.neverShareList.innerHTML = '';

      const domains = this.settings.neverShareDomains || [];
      if (domains.length === 0) {
        this.neverShareList.innerHTML = '<span class="text-muted text-xs">No excluded domains configured.</span>';
        return;
      }

      domains.forEach((domain) => {
        const chip = document.createElement('div');
        chip.className = 'ai-domain-chip';
        chip.innerHTML = `
          <span>${escapeHtml(domain)}</span>
          <button type="button" class="chip-remove-btn" title="Remove">✕</button>
        `;
        chip.querySelector('.chip-remove-btn').addEventListener('click', () => {
          this.removeNeverShareDomain(domain);
        });
        this.neverShareList.appendChild(chip);
      });
    }

    addNeverShareDomain() {
      const val = (this.neverShareInput.value || '').trim().toLowerCase();
      if (!val) return;
      if (!this.settings.neverShareDomains.includes(val)) {
        this.settings.neverShareDomains.push(val);
        this.renderNeverShareList();
      }
      this.neverShareInput.value = '';
    }

    removeNeverShareDomain(domain) {
      if (!this.settings || !this.settings.neverShareDomains) return;
      this.settings.neverShareDomains = this.settings.neverShareDomains.filter((d) => d !== domain);
      this.renderNeverShareList();
    }

    async saveSettingsFromModal() {
      const newKey = (this.apiKeyInput.value || '').trim();
      const selectedModel = this.modelSelect ? this.modelSelect.value : (this.settings && this.settings.model) || '';
      const selectedSpeed = this.speedSelect ? this.speedSelect.value : 'fast';

      const updatePayload = {
        model: selectedModel,
        neverShareDomains: this.settings ? this.settings.neverShareDomains : [],
        responseSpeed: selectedSpeed,
      };
      if (newKey) {
        updatePayload.apiKey = newKey;
      }

      const updated = await window.browserAPI.updateAiSettings(updatePayload);
      if (updated) {
        this.settings = updated;
        this.apiKeyInput.value = '';
        this.populateSettingsModal();
        if (this.modelBadge) {
          this.modelBadge.textContent = updated.model || 'No model';
        }
      }
      this.closeSettingsModal();
    }

    async testConnection() {
      const tempKey = (this.apiKeyInput.value || '').trim();
      const selectedModel = this.modelSelect ? this.modelSelect.value : (this.settings && this.settings.model) || '';

      this.showTestStatus('Testing connection to Gemini API...', 'loading');
      this.btnTestConnection.disabled = true;

      try {
        const result = await window.browserAPI.testAiConnection({
          apiKey: tempKey || undefined,
          model: selectedModel || undefined,
        });

        if (result && result.success) {
          this.showTestStatus(result.message || 'Connection successful!', 'success');
        } else {
          this.showTestStatus(result.message || 'Connection failed.', 'error', result.details);
        }
      } catch (err) {
        this.showTestStatus(`Error: ${err.message}`, 'error', err.stack);
      } finally {
        this.btnTestConnection.disabled = false;
      }
    }

    showTestStatus(message, type, details) {
      if (!this.testStatusBanner) return;
      this.testStatusBanner.className = `ai-test-status-banner ${type}`;
      let detailsHtml = '';
      if (details) {
        detailsHtml = `
          <details class="ai-error-details">
            <summary class="ai-error-details-summary">Details</summary>
            <pre class="ai-error-details-raw">${escapeHtml(details)}</pre>
          </details>
        `;
      }
      this.testStatusBanner.innerHTML = `<div>${escapeHtml(message)}</div>${detailsHtml}`;
      this.testStatusBanner.classList.remove('hidden');
    }

    async openSettingsModal() {
      if (this.testStatusBanner) {
        this.testStatusBanner.classList.add('hidden');
      }
      if (this.deps.showOverlay) {
        this.deps.showOverlay(this.settingsModal);
      } else {
        this.settingsModal.classList.remove('hidden');
      }
      this.apiKeyInput.focus();
      // Dynamically load fresh models on opening settings
      await this.loadSettings(true);
    }

    closeSettingsModal() {
      if (this.deps.hideOverlay) {
        this.deps.hideOverlay(this.settingsModal);
      } else {
        this.settingsModal.classList.add('hidden');
      }
    }

    /**
     * Workspace sync: switches conversation history when the user changes workspace.
     */
    async setWorkspace(workspaceId) {
      this.activeWorkspaceId = workspaceId;
      await this.loadWorkspaceHistory(workspaceId);
    }

    async loadWorkspaceHistory(workspaceId) {
      const wsId = workspaceId || (this.deps.getActiveWorkspaceId ? this.deps.getActiveWorkspaceId() : 'ws-default');
      try {
        const history = await window.browserAPI.getAiHistory(wsId);
        this.renderHistory(history || []);
      } catch (err) {
        console.error('Failed to load AI history:', err);
      }
    }

    async clearCurrentHistory() {
      const wsId = this.activeWorkspaceId || (this.deps.getActiveWorkspaceId ? this.deps.getActiveWorkspaceId() : 'ws-default');
      if (confirm('Clear AI conversation history for this workspace?')) {
        await window.browserAPI.clearAiHistory(wsId);
        this.renderHistory([]);
      }
    }

    /**
     * Renders conversation message items in the chat container.
     */
    renderHistory(messages) {
      if (!this.chatMessages) return;
      this.chatMessages.innerHTML = '';

      if (!messages || messages.length === 0) {
        this.chatMessages.innerHTML = `
          <div class="ai-empty-state">
            <div class="ai-empty-icon">✨</div>
            <h3>AI Coding Assistant</h3>
            <p>Ask coding questions, summarize pages, explain code, or use the quick action buttons above.</p>
          </div>
        `;
        return;
      }

      messages.forEach((msg) => {
        this.appendMessageBubble(msg);
      });
      this.scrollToBottom();
    }

    appendMessageBubble(msg) {
      // Remove empty state if present
      const emptyState = this.chatMessages.querySelector('.ai-empty-state');
      if (emptyState) emptyState.remove();

      const el = document.createElement('div');
      el.className = `ai-message ${msg.role}`;
      el.id = msg.id;

      // Header row with role avatar & copy button
      const header = document.createElement('div');
      header.className = 'ai-message-header';

      const roleLabel = document.createElement('span');
      roleLabel.className = 'ai-message-author';
      roleLabel.innerHTML = msg.role === 'user' ? '🧑 <strong>You</strong>' : '✨ <strong>Gemini</strong>';
      header.appendChild(roleLabel);

      const copyBtn = document.createElement('button');
      copyBtn.className = 'ai-copy-btn';
      copyBtn.title = 'Copy message';
      copyBtn.innerHTML = '📋 Copy';
      copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(msg.content);
        copyBtn.innerHTML = '✓ Copied';
        setTimeout(() => { copyBtn.innerHTML = '📋 Copy'; }, 2000);
      });
      header.appendChild(copyBtn);

      el.appendChild(header);

      // Context badge if message utilized page content
      if (msg.pageContext && msg.pageContext.title) {
        const badge = document.createElement('div');
        badge.className = 'ai-message-context-badge';
        badge.innerHTML = `📎 <em>Using content from:</em> <strong>${escapeHtml(msg.pageContext.title)}</strong>`;
        el.appendChild(badge);
      }

      // Message body formatted as Markdown and sanitized via DOMPurify
      const body = document.createElement('div');
      body.className = 'ai-message-body markdown-body';
      if (window.markdownAPI && window.markdownAPI.render) {
        body.innerHTML = window.markdownAPI.render(msg.content);
      } else {
        body.textContent = msg.content;
      }

      // Add "Copy Code" buttons to all code blocks
      this.attachCodeBlockCopyButtons(body);

      el.appendChild(body);
      this.chatMessages.appendChild(el);
      return el;
    }

    attachCodeBlockCopyButtons(container) {
      const codeBlocks = container.querySelectorAll('pre');
      codeBlocks.forEach((pre) => {
        if (pre.querySelector('.code-copy-btn')) return; // already added

        const btn = document.createElement('button');
        btn.className = 'code-copy-btn';
        btn.title = 'Copy code snippet';
        btn.textContent = 'Copy';

        btn.addEventListener('click', () => {
          const code = pre.querySelector('code');
          const text = code ? code.innerText : pre.innerText;
          navigator.clipboard.writeText(text);
          btn.textContent = 'Copied!';
          setTimeout(() => { btn.textContent = 'Copy'; }, 2000);
        });

        pre.style.position = 'relative';
        pre.appendChild(btn);
      });
    }

    scrollToBottom() {
      if (this.chatMessages) {
        this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
      }
    }

    /**
     * Attaches current web page context to the next message.
     */
    async attachActivePage() {
      this.btnAttachPage.disabled = true;
      try {
        const pageData = await window.browserAPI.extractAiPageContent();
        if (!pageData.allowed) {
          alert(pageData.reason || 'Could not attach page content.');
          return;
        }

        this.pendingPageContext = pageData;
        this.contextTitle.textContent = pageData.title || pageData.url;
        this.contextBar.classList.remove('hidden');
      } catch (err) {
        alert(`Failed to extract page content: ${err.message}`);
      } finally {
        this.btnAttachPage.disabled = false;
      }
    }

    clearPendingPageContext() {
      this.pendingPageContext = null;
      if (this.contextBar) {
        this.contextBar.classList.add('hidden');
      }
    }

    /**
     * Handles Quick Action buttons ("Summarize Page", "Explain Code", etc.).
     */
    async handleQuickAction(action) {
      if (this.isGenerating) return;

      // Ensure active page is extracted
      const pageData = await window.browserAPI.extractAiPageContent();
      if (!pageData.allowed) {
        alert(pageData.reason || 'Page content could not be read.');
        return;
      }

      this.pendingPageContext = pageData;

      if (action === 'summarize') {
        const prompt = 'Please summarize this web page. Provide a structured overview with key technical insights and takeaways.';
        this.chatInput.value = prompt;
        this.sendMessage();
      } else if (action === 'explain-selection') {
        if (pageData.selectedText) {
          const prompt = `Please explain the selected text in detail:\n\n"${pageData.selectedText}"`;
          this.chatInput.value = prompt;
          this.sendMessage();
        } else {
          this.contextTitle.textContent = pageData.title;
          this.contextBar.classList.remove('hidden');
          this.chatInput.value = 'Please explain the main topic and purpose of this page.';
          this.chatInput.focus();
        }
      } else if (action === 'explain-code') {
        if (pageData.selectedText) {
          const prompt = `Please analyze and explain this code snippet. Explain how it works, potential bugs, time complexity, and possible improvements:\n\n\`\`\`\n${pageData.selectedText}\n\`\`\``;
          this.chatInput.value = prompt;
          this.sendMessage();
        } else {
          const prompt = 'Please explain the code examples, APIs, and technical architecture described on this page.';
          this.chatInput.value = prompt;
          this.sendMessage();
        }
      } else if (action === 'ask-page') {
        this.contextTitle.textContent = pageData.title;
        this.contextBar.classList.remove('hidden');
        this.chatInput.placeholder = 'Ask a question about this page...';
        this.chatInput.focus();
      }
    }

    /**
     * Handles right-click context menu "Ask AI about selection".
     */
    async handleAskSelectionFromContextMenu(selectedText) {
      if (!selectedText) return;

      // Open toolkit panel and switch to AI tab
      if (window.toolkitPanel) {
        window.toolkitPanel.openPanel();
        window.toolkitPanel.switchTab('ai');
      }

      // Extract active page for title/URL reference
      const pageData = await window.browserAPI.extractAiPageContent();
      if (pageData.allowed) {
        this.pendingPageContext = {
          ...pageData,
          selectedText,
        };
      }

      this.chatInput.value = `Explain the following selected text:\n\n"${selectedText}"`;
      this.sendMessage();
    }

    /**
     * Submits a user message and triggers streaming response.
     * Wrapped in try/catch so any failure shows an error message inside the chat bubble.
     * Guaranteed single request execution with synchronous deduplication locks.
     */
    async sendMessage(overridePrompt = null) {
      const now = Date.now();
      if (this._isSendingLock || (this._lastSubmitTime && now - this._lastSubmitTime < 350)) {
        return;
      }
      this._lastSubmitTime = now;
      this._isSendingLock = true;

      try {
        const prompt = (overridePrompt !== null ? overridePrompt : (this.chatInput ? this.chatInput.value : '')).trim();
        if (!prompt) return;

        // Save last prompt for retries or quota recovery
        this.lastPrompt = prompt;

        // Check if API key is configured
        if (!this.settings || !this.settings.hasKey) {
          alert('Please configure your Gemini API key in settings (⚙️) to use the AI assistant.');
          this.openSettingsModal();
          return;
        }

        // If currently generating, abort it before starting a new stream
        if (this.isGenerating && this.currentStreamId) {
          window.browserAPI.stopAiStream(this.currentStreamId);
          this._stopThinkingTimer();
          this.isGenerating = false;
        }

        const wsId = this.activeWorkspaceId || (this.deps.getActiveWorkspaceId ? this.deps.getActiveWorkspaceId() : 'ws-default');
        const pageContext = this.pendingPageContext;

        // 1. Render user message bubble
        const userMsg = {
          id: `msg-${Date.now()}-u`,
          role: 'user',
          content: prompt,
          timestamp: Date.now(),
          pageContext: pageContext ? { title: pageContext.title, url: pageContext.url } : null,
        };
        this.appendMessageBubble(userMsg);

        // Reset input & context bar if sending from input
        if (this.chatInput && overridePrompt === null) {
          this.chatInput.value = '';
          this.chatInput.style.height = '38px';
        }
        this.clearPendingPageContext();

        // 2. Prepare streaming assistant bubble
        this.isGenerating = true;
        this.currentStreamId = `stream-${Date.now()}`;
        this.currentStreamingText = '';
        this._pendingChunks = '';
        this._rafPending = false;

        this.btnSend.classList.add('hidden');
        this.btnStop.classList.remove('hidden');

        const assistantMsg = {
          id: `msg-${Date.now()}-a`,
          role: 'assistant',
          content: '',
          timestamp: Date.now(),
        };
        this.streamingBubbleEl = this.appendMessageBubble(assistantMsg);
        this.streamingBodyEl = this.streamingBubbleEl.querySelector('.ai-message-body');

        // Show "Thinking..." with elapsed timer immediately
        this._thinkingStartTime = Date.now();
        this.streamingBodyEl.innerHTML = '<span class="ai-thinking-label">Thinking… <span class="ai-thinking-timer" id="ai-thinking-timer-span">0s</span></span><span class="ai-streaming-cursor">▋</span>';
        this._startThinkingTimer();
        this.scrollToBottom();

        // 3. Send IPC request to main process
        try {
          await window.browserAPI.sendAiMessage({
            workspaceId: wsId,
            prompt,
            pageContext,
            streamId: this.currentStreamId,
          });
        } catch (err) {
          this.handleStreamError(err.message, err.stack, err.type);
        }
      } catch (outerErr) {
        console.error('[aiPanel] Uncaught error in sendMessage:', outerErr);
        this.handleStreamError(outerErr.message || 'An unexpected error occurred while sending.', outerErr.stack);
      } finally {
        this._isSendingLock = false;
      }
    }

    /**
     * Handles streaming chunk arriving over IPC.
     * Uses requestAnimationFrame for batched DOM updates.
     */
    handleStreamChunk(chunk) {
      if (!this.isGenerating || !this.streamingBodyEl) return;

      // Clear "Thinking..." on first real text chunk
      if (!this.currentStreamingText && this._thinkingInterval) {
        this._stopThinkingTimer();
      }

      this.currentStreamingText += chunk;
      this._pendingChunks += chunk;

      if (!this._rafPending) {
        this._rafPending = true;
        requestAnimationFrame(() => {
          this._rafPending = false;
          this._pendingChunks = '';
          if (!this.streamingBodyEl) return;
          if (window.markdownAPI && window.markdownAPI.render) {
            this.streamingBodyEl.innerHTML = window.markdownAPI.render(this.currentStreamingText) + '<span class="ai-streaming-cursor">▋</span>';
          } else {
            this.streamingBodyEl.textContent = this.currentStreamingText;
          }
          this.attachCodeBlockCopyButtons(this.streamingBodyEl);
          this.scrollToBottom();
        });
      }
    }

    /**
     * Handles streaming completion.
     */
    handleStreamEnd(fullText) {
      this._stopThinkingTimer();
      this.isGenerating = false;
      this.btnSend.classList.remove('hidden');
      this.btnStop.classList.add('hidden');

      if (this.streamingBodyEl) {
        const text = (fullText || this.currentStreamingText || '').trim();
        if (!text) {
          this.streamingBodyEl.innerHTML = '<span class="text-muted"><em>(No response received from model. Please verify your API key or prompt)</em></span>';
        } else if (window.markdownAPI && window.markdownAPI.render) {
          this.streamingBodyEl.innerHTML = window.markdownAPI.render(text);
        } else {
          this.streamingBodyEl.textContent = text;
        }
        this.attachCodeBlockCopyButtons(this.streamingBodyEl);
      }
      this.scrollToBottom();
    }

    /**
     * Handles streaming errors with user-friendly messages and expandable details toggle.
     * On quota/429 limits, provides a one-click "Switch to Flash-Lite & Resend" action button.
     */
    handleStreamError(errorMsg, details, type) {
      this._stopThinkingTimer();
      this.isGenerating = false;
      this.btnSend.classList.remove('hidden');
      this.btnStop.classList.add('hidden');

      if (this.streamingBodyEl) {
        let detailsHtml = '';
        if (details) {
          detailsHtml = `
            <details class="ai-error-details">
              <summary class="ai-error-details-summary">Details</summary>
              <pre class="ai-error-details-raw">${escapeHtml(details)}</pre>
            </details>
          `;
        }

        const isQuota = type === 'quota_exceeded' ||
                        (errorMsg && (
                          errorMsg.toLowerCase().includes('quota') ||
                          errorMsg.toLowerCase().includes('429') ||
                          errorMsg.toLowerCase().includes('resource_exhausted')
                        ));

        let quotaButtonHtml = '';
        if (isQuota) {
          quotaButtonHtml = `
            <div class="ai-quota-action-box">
              <p class="text-xs text-muted mb-2">You reached your rate or daily request limit for this model. Switch to Flash-Lite which has higher free-tier allowances:</p>
              <button type="button" id="btn-quota-switch-flash-lite" class="toolkit-btn primary small">
                ⚡ Switch to Flash-Lite &amp; Resend
              </button>
            </div>
          `;
        }

        this.streamingBodyEl.innerHTML = `
          <div class="ai-error-box ${isQuota ? 'quota' : ''}">
            <div class="ai-error-summary">⚠️ <strong>${isQuota ? 'Quota Limit Reached:' : 'Error:'}</strong> ${escapeHtml(errorMsg || 'Failed to generate response.')}</div>
            ${quotaButtonHtml}
            ${detailsHtml}
          </div>
        `;

        if (isQuota) {
          const btnSwitch = this.streamingBodyEl.querySelector('#btn-quota-switch-flash-lite');
          if (btnSwitch) {
            btnSwitch.addEventListener('click', async () => {
              btnSwitch.disabled = true;
              btnSwitch.textContent = 'Switching to Flash-Lite...';
              await this.switchToFlashLiteAndResend();
            });
          }
        }
      }
      this.scrollToBottom();
    }

    /**
     * Finds the best Flash-Lite model, updates settings, and resends the user's message.
     */
    async switchToFlashLiteAndResend() {
      try {
        let flashLiteId = null;
        if (this.settings && Array.isArray(this.settings.availableModels)) {
          const found = this.settings.availableModels.find((m) =>
            m.id.toLowerCase().includes('flash-lite') && !m.id.toLowerCase().includes('tts')
          );
          if (found) flashLiteId = found.id;
        }

        if (!flashLiteId) {
          flashLiteId = 'gemini-2.5-flash-lite';
        }

        const updated = await window.browserAPI.updateAiSettings({ model: flashLiteId });
        if (updated) {
          this.settings = updated;
          if (this.modelBadge) this.modelBadge.textContent = updated.model;
          if (this.modelSelect) this.modelSelect.value = updated.model;
        }

        // Resend last prompt
        if (this.lastPrompt) {
          await this.sendMessage(this.lastPrompt);
        }
      } catch (err) {
        console.error('Failed to switch to Flash-Lite:', err);
        alert(`Failed to switch to Flash-Lite: ${err.message}`);
      }
    }

    /**
     * Handles notifications when a model is retired and automatically switched.
     */
    handleModelNotice(data) {
      if (!data) return;

      if (data.newModel) {
        if (this.modelBadge) {
          this.modelBadge.textContent = data.newModel;
        }
        if (this.settings) {
          this.settings.model = data.newModel;
        }
        if (this.modelSelect) {
          this.modelSelect.value = data.newModel;
        }
      }

      if (this.chatMessages && data.message) {
        const noticeEl = document.createElement('div');
        noticeEl.className = 'ai-notice-banner';
        noticeEl.innerHTML = `<span>ℹ️ <strong>Model update:</strong> ${escapeHtml(data.message)}</span>`;
        this.chatMessages.appendChild(noticeEl);
        this.scrollToBottom();
      }
    }

    /**
     * Aborts current generation.
     */
    stopStreaming() {
      if (this.isGenerating && this.currentStreamId) {
        window.browserAPI.stopAiStream(this.currentStreamId);
        this._stopThinkingTimer();
        this.handleStreamEnd(this.currentStreamingText);
      }
    }

    /**
     * Starts the "Thinking..." elapsed-time interval timer.
     */
    _startThinkingTimer() {
      this._stopThinkingTimer(); // clear any existing
      this._thinkingStartTime = Date.now();
      this._thinkingInterval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - this._thinkingStartTime) / 1000);
        // Update the timer span if it's still in the DOM
        if (this.streamingBodyEl) {
          const timerSpan = this.streamingBodyEl.querySelector('.ai-thinking-timer');
          if (timerSpan) {
            timerSpan.textContent = `${elapsed}s`;
          }
        }
      }, 1000);
    }

    /**
     * Stops and clears the thinking timer interval.
     */
    _stopThinkingTimer() {
      if (this._thinkingInterval) {
        clearInterval(this._thinkingInterval);
        this._thinkingInterval = null;
      }
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>"']/g, (m) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[m]));
  }

  global.AIPanel = AIPanel;
})(window);
