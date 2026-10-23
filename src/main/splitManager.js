// Split Manager - Manages split view state, pane focus, and WebContentsView layout
class SplitManager {
  constructor(mainWindow, tabManager) {
    this.mainWindow = mainWindow;
    this.tabManager = tabManager;

    this.isSplit = false;
    this.isPickingRight = false; // Waiting for right pane tab selection
    this.leftTabId = null;
    this.rightTabId = null;
    this.focusedTabId = null;
    this.splitRatio = 0.5;
    this.isOverlayOpen = false; // When true, hides WebContentsViews so HTML modals/menus are not covered

    // DOM-measured bounding coordinates (sent from UI renderer)
    this.layoutBounds = {
      viewArea: { x: 220, y: 48, width: 980, height: 752 },
      leftPane: { x: 220, y: 76, width: 486, height: 724 },
      rightPane: { x: 714, y: 76, width: 486, height: 724 },
    };

    this.onStateChanged = null;
  }

  /**
   * Returns current split view state snapshot.
   */
  getState() {
    return {
      isSplit: this.isSplit,
      isPickingRight: this.isPickingRight,
      leftTabId: this.leftTabId,
      rightTabId: this.rightTabId,
      focusedTabId: this.focusedTabId,
      splitRatio: this.splitRatio,
    };
  }

  notifyState() {
    if (this.onStateChanged) {
      this.onStateChanged(this.getState());
    }
  }

  /**
   * Enters split mode. Places current active tab on the left and prompts for right tab.
   */
  startSplit(currentActiveTabId) {
    this.isSplit = true;
    this.isPickingRight = true;
    this.leftTabId = currentActiveTabId;
    this.rightTabId = null;
    this.focusedTabId = currentActiveTabId;

    this.notifyState();
    this.applyLayout();
  }

  /**
   * Assigns the selected tab to the right pane and completes split view activation.
   */
  setRightTab(tabId) {
    if (!this.isSplit) return;
    this.rightTabId = tabId;
    this.isPickingRight = false;
    this.focusedTabId = tabId;

    this.notifyState();
    this.applyLayout();
  }

  /**
   * Exits split view and restores single view of the chosen or focused tab.
   */
  closeSplit(stayOnTabId = null) {
    const finalActiveTab = stayOnTabId || this.focusedTabId || this.leftTabId;
    this.isSplit = false;
    this.isPickingRight = false;
    this.leftTabId = finalActiveTab;
    this.rightTabId = null;
    this.focusedTabId = finalActiveTab;
    this.tabManager.activeTabId = finalActiveTab;

    this.notifyState();
    this.applyLayout();
  }

  /**
   * Swaps the positions of the left and right panes.
   */
  swapPanes() {
    if (!this.isSplit || !this.rightTabId) return;
    const temp = this.leftTabId;
    this.leftTabId = this.rightTabId;
    this.rightTabId = temp;

    this.notifyState();
    this.applyLayout();
  }

  /**
   * Sets the active/focused tab for address bar & navigation controls.
   */
  setFocusedTab(tabId) {
    if (this.focusedTabId === tabId) return;
    this.focusedTabId = tabId;
    this.notifyState();
  }

  /**
   * Automatically exits split view if a tab involved in the split is closed.
   */
  handleTabClosed(tabId) {
    if (!this.isSplit) return;

    if (this.leftTabId === tabId) {
      // Exit split and keep the remaining right tab
      this.closeSplit(this.rightTabId);
    } else if (this.rightTabId === tabId) {
      // Exit split and keep the remaining left tab
      this.closeSplit(this.leftTabId);
    }
  }

  /**
   * Updates coordinates based on client DOM measurements and reapplies layout.
   */
  updateLayoutBounds(bounds) {
    if (bounds) {
      if (bounds.viewArea) this.layoutBounds.viewArea = bounds.viewArea;
      if (bounds.leftPane) this.layoutBounds.leftPane = bounds.leftPane;
      if (bounds.rightPane) this.layoutBounds.rightPane = bounds.rightPane;
      if (typeof bounds.splitRatio === 'number') this.splitRatio = bounds.splitRatio;
    }
    this.applyLayout();
  }

  /**
   * Temporarily hides or restores WebContentsViews when an HTML overlay (modal, menu) is open.
   */
  setOverlayOpen(isOpen) {
    this.isOverlayOpen = !!isOpen;
    this.applyLayout();
  }

  /**
   * Repositions and attaches/detaches WebContentsViews according to the current layout.
   */
  applyLayout() {
    const contentView = this.mainWindow.contentView;
    if (!contentView) return;

    const allTabs = Array.from(this.tabManager.tabs.values());

    // If an HTML overlay/modal is open, hide all WebContentsViews so the modal is fully visible
    if (this.isOverlayOpen) {
      allTabs.forEach((tab) => {
        if (tab.view) {
          tab.view.setVisible(false);
          try {
            contentView.removeChildView(tab.view);
          } catch (e) {}
        }
      });
      return;
    }

    if (!this.isSplit) {
      // 1. Single Tab View Mode
      const activeTabId = this.tabManager.activeTabId || this.focusedTabId;

      allTabs.forEach((tab) => {
        if (tab.id === activeTabId) {
          // Check 5 Safety Net: if view is missing, destroyed, or tab is suspended, recreate and awaken
          const isMissingOrDestroyed = !tab.view || !tab.view.webContents || tab.view.webContents.isDestroyed();
          if (isMissingOrDestroyed || tab.isSuspended) {
            console.log(`[SafetyNet] Active tab ${tab.id} view missing/destroyed/suspended, recreating...`);
            if (this.tabSuspender) {
              this.tabSuspender.unsuspendTab(tab.id);
            } else {
              this.tabManager.setupTabView(tab, tab.url);
              tab.isSuspended = false;
              tab.isLazy = false;
              if (this.tabManager.onTabUpdated) this.tabManager.onTabUpdated(tab);
            }
          }

          if (tab.view) {
            if (!contentView.children.includes(tab.view)) {
              contentView.addChildView(tab.view);
            }
            tab.view.setVisible(true);

            const b = this.layoutBounds.viewArea;
            const winBounds = this.mainWindow.getBounds();
            const width = (b && b.width > 0) ? Math.round(b.width) : Math.max(100, winBounds.width - 220);
            const height = (b && b.height > 0) ? Math.round(b.height) : Math.max(100, winBounds.height - 48);
            const x = (b && b.width > 0) ? Math.round(b.x) : 220;
            const y = (b && b.height > 0) ? Math.round(b.y) : 48;

            tab.view.setBounds({ x, y, width, height });

            // Zero-size bounds safety net
            const actualBounds = tab.view.getBounds();
            if (actualBounds.width === 0 || actualBounds.height === 0) {
              console.log(`[SafetyNet] Active tab ${tab.id} view had zero bounds, applying fallback layout`);
              tab.view.setBounds({ x: 220, y: 48, width: 800, height: 600 });
            }
          }
        } else {
          if (tab.view) {
            tab.view.setVisible(false);
            try {
              contentView.removeChildView(tab.view);
            } catch (e) {}
          }
        }
      });
    } else {
      // 2. Split View Mode
      const leftTab = this.tabManager.getTab(this.leftTabId);
      const rightTab = this.tabManager.getTab(this.rightTabId);

      // Hide all non-split tabs
      allTabs.forEach((tab) => {
        if (tab.id !== this.leftTabId && tab.id !== this.rightTabId) {
          if (tab.view) {
            tab.view.setVisible(false);
            try {
              contentView.removeChildView(tab.view);
            } catch (e) {}
          }
        }
      });

      // Left pane view
      if (leftTab) {
        const isLeftMissingOrDestroyed = !leftTab.view || !leftTab.view.webContents || leftTab.view.webContents.isDestroyed();
        if (isLeftMissingOrDestroyed || leftTab.isSuspended) {
          console.log(`[SafetyNet] Left split tab ${leftTab.id} view missing/destroyed/suspended, recreating...`);
          if (this.tabSuspender) {
            this.tabSuspender.unsuspendTab(leftTab.id);
          } else {
            this.tabManager.setupTabView(leftTab, leftTab.url);
            leftTab.isSuspended = false;
            leftTab.isLazy = false;
            if (this.tabManager.onTabUpdated) this.tabManager.onTabUpdated(leftTab);
          }
        }
        if (leftTab.view) {
          if (!contentView.children.includes(leftTab.view)) {
            contentView.addChildView(leftTab.view);
          }
          leftTab.view.setVisible(true);

          const lb = this.layoutBounds.leftPane;
          const winBounds = this.mainWindow.getBounds();
          const width = (lb && lb.width > 0) ? Math.round(lb.width) : Math.max(100, Math.floor((winBounds.width - 220) / 2));
          const height = (lb && lb.height > 0) ? Math.round(lb.height) : Math.max(100, winBounds.height - 76);
          const x = (lb && lb.width > 0) ? Math.round(lb.x) : 220;
          const y = (lb && lb.height > 0) ? Math.round(lb.y) : 76;

          leftTab.view.setBounds({ x, y, width, height });

          const actualBounds = leftTab.view.getBounds();
          if (actualBounds.width === 0 || actualBounds.height === 0) {
            console.log(`[SafetyNet] Left tab ${leftTab.id} view had zero bounds, applying fallback layout`);
            leftTab.view.setBounds({ x: 220, y: 76, width: 400, height: 600 });
          }
        }
      }

      // Right pane view (only if picked; otherwise DOM picker stays visible)
      if (rightTab && !this.isPickingRight) {
        const isRightMissingOrDestroyed = !rightTab.view || !rightTab.view.webContents || rightTab.view.webContents.isDestroyed();
        if (isRightMissingOrDestroyed || rightTab.isSuspended) {
          console.log(`[SafetyNet] Right split tab ${rightTab.id} view missing/destroyed/suspended, recreating...`);
          if (this.tabSuspender) {
            this.tabSuspender.unsuspendTab(rightTab.id);
          } else {
            this.tabManager.setupTabView(rightTab, rightTab.url);
            rightTab.isSuspended = false;
            rightTab.isLazy = false;
            if (this.tabManager.onTabUpdated) this.tabManager.onTabUpdated(rightTab);
          }
        }
        if (rightTab.view) {
          if (!contentView.children.includes(rightTab.view)) {
            contentView.addChildView(rightTab.view);
          }
          rightTab.view.setVisible(true);

          const rb = this.layoutBounds.rightPane;
          const winBounds = this.mainWindow.getBounds();
          const width = (rb && rb.width > 0) ? Math.round(rb.width) : Math.max(100, Math.floor((winBounds.width - 220) / 2));
          const height = (rb && rb.height > 0) ? Math.round(rb.height) : Math.max(100, winBounds.height - 76);
          const x = (rb && rb.width > 0) ? Math.round(rb.x) : Math.floor(winBounds.width / 2);
          const y = (rb && rb.height > 0) ? Math.round(rb.y) : 76;

          rightTab.view.setBounds({ x, y, width, height });

          const actualBounds = rightTab.view.getBounds();
          if (actualBounds.width === 0 || actualBounds.height === 0) {
            console.log(`[SafetyNet] Right tab ${rightTab.id} view had zero bounds, applying fallback layout`);
            rightTab.view.setBounds({ x: 620, y: 76, width: 400, height: 600 });
          }
        }
      } else if (rightTab && rightTab.view) {
        rightTab.view.setVisible(false);
        try {
          contentView.removeChildView(rightTab.view);
        } catch (e) {}
      }
    }
  }
}

module.exports = SplitManager;
