// JSON Viewer Module - Safe, lazy-rendering, collapsible JSON tree with search and path copying
(function (global) {
  'use strict';

  /**
   * Pinpoints exact line and column of a JSON syntax error.
   */
  function getJsonErrorLocation(str, err) {
    let line = 1;
    let col = 1;
    const posMatch = err.message.match(/position\s+(\d+)/i);
    if (posMatch) {
      const pos = parseInt(posMatch[1], 10);
      const lines = str.slice(0, pos).split('\n');
      line = lines.length;
      col = lines[lines.length - 1].length + 1;
    } else {
      const lineMatch = err.message.match(/line\s+(\d+)\s+column\s+(\d+)/i);
      if (lineMatch) {
        line = parseInt(lineMatch[1], 10);
        col = parseInt(lineMatch[2], 10);
      }
    }
    return { line, col, message: err.message };
  }

  /**
   * Safely formats and renders a JSON tree into a target container.
   */
  class JsonViewer {
    constructor(container, options = {}) {
      this.container = container;
      this.options = Object.assign(
        {
          initialExpandDepth: 2,
          maxChildBatch: 100, // Lazy child rendering limit for large arrays/objects
          showToolbar: true,
          readOnly: true,
        },
        options
      );

      this.data = null;
      this.rawString = '';
      this.isRawMode = false;
      this.searchQuery = '';
      this.treeRootEl = null;
      this.rawEl = null;
    }

    render(jsonInput) {
      this.container.innerHTML = '';
      this.container.classList.add('json-viewer-container');

      if (typeof jsonInput === 'string') {
        this.rawString = jsonInput;
        try {
          this.data = JSON.parse(jsonInput);
        } catch (err) {
          this.renderError(err);
          return false;
        }
      } else {
        this.data = jsonInput;
        try {
          this.rawString = JSON.stringify(jsonInput, null, 2);
        } catch (e) {
          this.rawString = String(jsonInput);
        }
      }

      if (this.options.showToolbar) {
        this.renderToolbar();
      }

      const contentWrapper = document.createElement('div');
      contentWrapper.className = 'json-viewer-content';

      // Tree container
      this.treeRootEl = document.createElement('div');
      this.treeRootEl.className = 'json-tree-root';
      const rootNode = this.buildNode(this.data, '', 'root', 0);
      this.treeRootEl.appendChild(rootNode);
      contentWrapper.appendChild(this.treeRootEl);

      // Raw view container (hidden initially)
      this.rawEl = document.createElement('pre');
      this.rawEl.className = 'json-raw-view hidden';
      this.rawEl.textContent = this.rawString;
      contentWrapper.appendChild(this.rawEl);

      this.container.appendChild(contentWrapper);
      return true;
    }

    renderError(err) {
      const loc = getJsonErrorLocation(this.rawString, err);
      const errBox = document.createElement('div');
      errBox.className = 'json-error-banner';

      const title = document.createElement('div');
      title.className = 'json-error-title';
      title.textContent = `❌ Invalid JSON: Line ${loc.line}, Column ${loc.col}`;

      const msg = document.createElement('div');
      msg.className = 'json-error-msg';
      msg.textContent = loc.message;

      errBox.appendChild(title);
      errBox.appendChild(msg);
      this.container.appendChild(errBox);
    }

    renderToolbar() {
      const toolbar = document.createElement('div');
      toolbar.className = 'json-viewer-toolbar';

      // Search Box
      const searchBox = document.createElement('div');
      searchBox.className = 'json-search-box';
      const searchInput = document.createElement('input');
      searchInput.type = 'text';
      searchInput.placeholder = 'Search keys & values...';
      searchInput.className = 'json-search-input';
      searchInput.addEventListener('input', (e) => {
        this.filterTree(e.target.value.trim().toLowerCase());
      });
      searchBox.appendChild(searchInput);
      toolbar.appendChild(searchBox);

      const btnGroup = document.createElement('div');
      btnGroup.className = 'json-btn-group';

      // Expand All
      const btnExpandAll = document.createElement('button');
      btnExpandAll.type = 'button';
      btnExpandAll.className = 'json-tool-btn';
      btnExpandAll.title = 'Expand All Nodes';
      btnExpandAll.textContent = 'Expand All';
      btnExpandAll.addEventListener('click', () => this.toggleAll(true));
      btnGroup.appendChild(btnExpandAll);

      // Collapse All
      const btnCollapseAll = document.createElement('button');
      btnCollapseAll.type = 'button';
      btnCollapseAll.className = 'json-tool-btn';
      btnCollapseAll.title = 'Collapse All Nodes';
      btnCollapseAll.textContent = 'Collapse All';
      btnCollapseAll.addEventListener('click', () => this.toggleAll(false));
      btnGroup.appendChild(btnCollapseAll);

      // Raw / Pretty toggle
      const btnToggleRaw = document.createElement('button');
      btnToggleRaw.type = 'button';
      btnToggleRaw.className = 'json-tool-btn';
      btnToggleRaw.title = 'Toggle Raw / Formatted Tree';
      btnToggleRaw.textContent = 'Raw';
      btnToggleRaw.addEventListener('click', () => {
        this.isRawMode = !this.isRawMode;
        if (this.isRawMode) {
          this.treeRootEl.classList.add('hidden');
          this.rawEl.classList.remove('hidden');
          btnToggleRaw.textContent = 'Pretty';
        } else {
          this.rawEl.classList.add('hidden');
          this.treeRootEl.classList.remove('hidden');
          btnToggleRaw.textContent = 'Raw';
        }
      });
      btnGroup.appendChild(btnToggleRaw);

      // Copy All
      const btnCopyAll = document.createElement('button');
      btnCopyAll.type = 'button';
      btnCopyAll.className = 'json-tool-btn';
      btnCopyAll.title = 'Copy formatted JSON';
      btnCopyAll.textContent = 'Copy';
      btnCopyAll.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(this.rawString);
          btnCopyAll.textContent = 'Copied!';
          setTimeout(() => (btnCopyAll.textContent = 'Copy'), 1500);
        } catch (e) {}
      });
      btnGroup.appendChild(btnCopyAll);

      toolbar.appendChild(btnGroup);
      this.container.appendChild(toolbar);
    }

    /**
     * Recursively builds tree nodes using pure DOM creation (NEVER innerHTML).
     */
    buildNode(value, key, path, depth) {
      const nodeEl = document.createElement('div');
      nodeEl.className = 'json-node';
      nodeEl.dataset.path = path;

      const isArray = Array.isArray(value);
      const isObject = value !== null && typeof value === 'object';

      const lineEl = document.createElement('div');
      lineEl.className = 'json-line';

      // Key name if present
      if (key !== '' && key !== null && key !== undefined) {
        const keyEl = document.createElement('span');
        keyEl.className = 'json-key';
        keyEl.textContent = isArray ? `${key}: ` : `"${key}": `;
        lineEl.appendChild(keyEl);
      }

      if (isObject) {
        const isCollapsed = depth >= this.options.initialExpandDepth;
        const keys = Object.keys(value);
        const openBrace = isArray ? '[' : '{';
        const closeBrace = isArray ? ']' : '}';

        const toggleBtn = document.createElement('span');
        toggleBtn.className = `json-toggle ${isCollapsed ? 'collapsed' : 'expanded'}`;
        toggleBtn.textContent = isCollapsed ? '▶' : '▼';
        lineEl.insertBefore(toggleBtn, lineEl.firstChild);

        const openSpan = document.createElement('span');
        openSpan.className = 'json-bracket';
        openSpan.textContent = openBrace;
        lineEl.appendChild(openSpan);

        const summarySpan = document.createElement('span');
        summarySpan.className = `json-summary ${isCollapsed ? '' : 'hidden'}`;
        summarySpan.textContent = isArray ? ` ... ${keys.length} items ` : ` ... ${keys.length} keys `;
        lineEl.appendChild(summarySpan);

        const closeSpan = document.createElement('span');
        closeSpan.className = 'json-bracket';
        closeSpan.textContent = closeBrace;

        // Node hover action buttons (Copy path, Copy value)
        const actionsSpan = document.createElement('span');
        actionsSpan.className = 'json-node-actions';

        const copyPathBtn = document.createElement('button');
        copyPathBtn.className = 'json-action-btn';
        copyPathBtn.title = `Copy path (${path})`;
        copyPathBtn.textContent = 'path';
        copyPathBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          navigator.clipboard.writeText(path || 'root');
          copyPathBtn.textContent = 'copied!';
          setTimeout(() => (copyPathBtn.textContent = 'path'), 1200);
        });

        const copyValBtn = document.createElement('button');
        copyValBtn.className = 'json-action-btn';
        copyValBtn.title = 'Copy value';
        copyValBtn.textContent = 'val';
        copyValBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          navigator.clipboard.writeText(JSON.stringify(value, null, 2));
          copyValBtn.textContent = 'copied!';
          setTimeout(() => (copyValBtn.textContent = 'val'), 1200);
        });

        actionsSpan.appendChild(copyPathBtn);
        actionsSpan.appendChild(copyValBtn);
        lineEl.appendChild(actionsSpan);

        nodeEl.appendChild(lineEl);

        // Children container
        const childrenContainer = document.createElement('div');
        childrenContainer.className = `json-children ${isCollapsed ? 'hidden' : ''}`;

        // Lazy child population for large lists
        let renderedCount = 0;
        const batchSize = this.options.maxChildBatch;

        const renderBatch = () => {
          const nextBatch = keys.slice(renderedCount, renderedCount + batchSize);
          nextBatch.forEach((childKey) => {
            const childPath = isArray
              ? `${path}[${childKey}]`
              : path
              ? `${path}.${childKey}`
              : childKey;
            const childNode = this.buildNode(value[childKey], childKey, childPath, depth + 1);
            childrenContainer.appendChild(childNode);
          });
          renderedCount += nextBatch.length;

          // If more remain, add a Show More button
          const existingMoreBtn = childrenContainer.querySelector('.json-show-more-btn');
          if (existingMoreBtn) existingMoreBtn.remove();

          if (renderedCount < keys.length) {
            const moreBtn = document.createElement('button');
            moreBtn.className = 'json-show-more-btn';
            moreBtn.textContent = `... Show ${Math.min(batchSize, keys.length - renderedCount)} more (${keys.length - renderedCount} remaining)`;
            moreBtn.addEventListener('click', () => {
              renderBatch();
            });
            childrenContainer.appendChild(moreBtn);
          }
        };

        renderBatch();

        nodeEl.appendChild(childrenContainer);

        // Bottom closing brace line
        const closeLine = document.createElement('div');
        closeLine.className = 'json-line json-close-line';
        closeLine.appendChild(closeSpan);
        nodeEl.appendChild(closeLine);

        // Click on toggle button or line to toggle open/closed
        const toggleHandler = (e) => {
          if (e.target.closest('.json-node-actions')) return;
          const isCurrentlyHidden = childrenContainer.classList.contains('hidden');
          if (isCurrentlyHidden) {
            childrenContainer.classList.remove('hidden');
            summarySpan.classList.add('hidden');
            toggleBtn.className = 'json-toggle expanded';
            toggleBtn.textContent = '▼';
          } else {
            childrenContainer.classList.add('hidden');
            summarySpan.classList.remove('hidden');
            toggleBtn.className = 'json-toggle collapsed';
            toggleBtn.textContent = '▶';
          }
        };

        toggleBtn.addEventListener('click', toggleHandler);
        lineEl.addEventListener('click', toggleHandler);
      } else {
        // Primitive value (string, number, boolean, null)
        const valSpan = document.createElement('span');
        const valType = typeof value;

        if (value === null) {
          valSpan.className = 'json-value json-null';
          valSpan.textContent = 'null';
        } else if (valType === 'string') {
          valSpan.className = 'json-value json-string';
          valSpan.textContent = `"${value}"`;
        } else if (valType === 'number') {
          valSpan.className = 'json-value json-number';
          valSpan.textContent = String(value);
        } else if (valType === 'boolean') {
          valSpan.className = 'json-value json-boolean';
          valSpan.textContent = String(value);
        } else {
          valSpan.className = 'json-value';
          valSpan.textContent = String(value);
        }

        lineEl.appendChild(valSpan);

        // Actions for primitive
        const actionsSpan = document.createElement('span');
        actionsSpan.className = 'json-node-actions';

        const copyPathBtn = document.createElement('button');
        copyPathBtn.className = 'json-action-btn';
        copyPathBtn.title = `Copy path (${path})`;
        copyPathBtn.textContent = 'path';
        copyPathBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          navigator.clipboard.writeText(path || 'root');
          copyPathBtn.textContent = 'copied!';
          setTimeout(() => (copyPathBtn.textContent = 'path'), 1200);
        });

        const copyValBtn = document.createElement('button');
        copyValBtn.className = 'json-action-btn';
        copyValBtn.title = 'Copy value';
        copyValBtn.textContent = 'val';
        copyValBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          navigator.clipboard.writeText(valType === 'string' ? value : String(value));
          copyValBtn.textContent = 'copied!';
          setTimeout(() => (copyValBtn.textContent = 'val'), 1200);
        });

        actionsSpan.appendChild(copyPathBtn);
        actionsSpan.appendChild(copyValBtn);
        lineEl.appendChild(actionsSpan);

        nodeEl.appendChild(lineEl);
      }

      return nodeEl;
    }

    toggleAll(expand) {
      if (!this.treeRootEl) return;
      const toggles = this.treeRootEl.querySelectorAll('.json-toggle');
      toggles.forEach((t) => {
        const line = t.parentElement;
        const node = line.parentElement;
        const children = node.querySelector(':scope > .json-children');
        const summary = line.querySelector('.json-summary');

        if (children && summary) {
          if (expand) {
            children.classList.remove('hidden');
            summary.classList.add('hidden');
            t.className = 'json-toggle expanded';
            t.textContent = '▼';
          } else {
            children.classList.add('hidden');
            summary.classList.remove('hidden');
            t.className = 'json-toggle collapsed';
            t.textContent = '▶';
          }
        }
      });
    }

    filterTree(query) {
      if (!this.treeRootEl) return;
      const allNodes = this.treeRootEl.querySelectorAll('.json-node');
      if (!query) {
        allNodes.forEach((n) => n.classList.remove('json-hidden', 'json-highlight'));
        return;
      }

      allNodes.forEach((n) => {
        const text = n.textContent.toLowerCase();
        const path = (n.dataset.path || '').toLowerCase();
        const matches = text.includes(query) || path.includes(query);
        if (matches) {
          n.classList.remove('json-hidden');
          n.classList.add('json-highlight');
          // Ensure ancestors are visible and expanded
          let parent = n.parentElement;
          while (parent && parent !== this.treeRootEl) {
            if (parent.classList.contains('json-children')) {
              parent.classList.remove('hidden');
              const parentNode = parent.parentElement;
              const toggle = parentNode.querySelector(':scope > .json-line > .json-toggle');
              const summary = parentNode.querySelector(':scope > .json-line > .json-summary');
              if (toggle) {
                toggle.className = 'json-toggle expanded';
                toggle.textContent = '▼';
              }
              if (summary) summary.classList.add('hidden');
            }
            if (parent.classList.contains('json-node')) {
              parent.classList.remove('json-hidden');
            }
            parent = parent.parentElement;
          }
        } else {
          n.classList.add('json-hidden');
          n.classList.remove('json-highlight');
        }
      });
    }
  }

  // Export to window or module
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = JsonViewer;
  }
  if (typeof window !== 'undefined') {
    window.JsonViewer = JsonViewer;
  }
})(typeof window !== 'undefined' ? window : global);
