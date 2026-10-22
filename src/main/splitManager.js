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
          if (tab.isSuspended && this.tabSuspender) {
            this.tabSuspender.unsuspendTab(tab.id);
          }
          if (tab.view) {
            if (!contentView.children.includes(tab.view)) {
              contentView.addChildView(tab.view);
            }
            tab.view.setVisible(true);

            const b = this.layoutBounds.viewArea;
            tab.view.setBounds({
              x: Math.round(b.x),
              y: Math.round(b.y),
              width: Math.max(0, Math.round(b.width)),
              height: Math.max(0, Math.round(b.height)),
            });
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
        if (leftTab.isSuspended && this.tabSuspender) {
          this.tabSuspender.unsuspendTab(leftTab.id);
        }
        if (leftTab.view) {
          if (!contentView.children.includes(leftTab.view)) {
            contentView.addChildView(leftTab.view);
          }
          leftTab.view.setVisible(true);

          const lb = this.layoutBounds.leftPane;
          leftTab.view.setBounds({
            x: Math.round(lb.x),
            y: Math.round(lb.y),
            width: Math.max(0, Math.round(lb.width)),
            height: Math.max(0, Math.round(lb.height)),
          });
        }
      }

      // Right pane view (only if picked; otherwise DOM picker stays visible)
      if (rightTab && !this.isPickingRight) {
        if (rightTab.isSuspended && this.tabSuspender) {
          this.tabSuspender.unsuspendTab(rightTab.id);
        }
        if (rightTab.view) {
          if (!contentView.children.includes(rightTab.view)) {
            contentView.addChildView(rightTab.view);
          }
          rightTab.view.setVisible(true);

          const rb = this.layoutBounds.rightPane;
          rightTab.view.setBounds({
            x: Math.round(rb.x),
            y: Math.round(rb.y),
            width: Math.max(0, Math.round(rb.width)),
            height: Math.max(0, Math.round(rb.height)),
          });
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
