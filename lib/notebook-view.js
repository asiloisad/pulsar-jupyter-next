/**
 * NotebookView - DOM-based component for rendering Jupyter notebooks
 */

const CellView = require("./cell-view");

/**
 * NotebookView manages rendering of the entire notebook.
 * Uses plain DOM for reliable integration with Pulsar.
 */
class NotebookView {
  constructor(props) {
    this.props = props;
    this.mode = "command"; // 'command' or 'edit'
    this.cellViews = new Map(); // cell.id -> CellView
    this.selectedCells = new Set(); // Set of selected cell indices
    this.draggingCellIndex = null;
    this.cellsContainer = null;
    this._autoScrollInterval = null;
    this._autoScrollSpeed = 0;
    this._mouseButtonDown = false; // Track mouse button state for selection

    this.element = document.createElement("div");
    this.element.className = "jupyter-notebook command-mode";
    this.element.setAttribute("tabindex", "-1");

    this.render();

    // Set up focus tracking for mode switching
    this.element.addEventListener("focusin", this.handleFocusIn.bind(this));
    this.element.addEventListener("focusout", this.handleFocusOut.bind(this));
    this.element.addEventListener("click", this.handleClick.bind(this));

    // Watch for scrollPastEnd setting changes
    this._scrollPastEndDisposable = atom.config.onDidChange("editor.scrollPastEnd", () => {
      this.applyScrollPastEnd();
    });

    // Watch for container resize to update scroll past end padding
    this._resizeObserver = new ResizeObserver(() => {
      if (atom.config.get("editor.scrollPastEnd")) {
        this.applyScrollPastEnd();
      }
    });

    // Track mouse button state to avoid mode switch during text selection
    // Also activate pane immediately on mousedown for responsive feel
    this.element.addEventListener("mousedown", () => {
      this._mouseButtonDown = true;
      this.activatePane();
    });
    document.addEventListener(
      "mouseup",
      (this._handleGlobalMouseUp = () => {
        this._mouseButtonDown = false;
      }),
    );
  }

  render() {
    // Preserve scroll position before clearing
    const scrollTop = this.cellsContainer ? this.cellsContainer.scrollTop : 0;

    // Update notebook classes
    this.element.className = `jupyter-notebook ${
      this.mode === "edit" ? "edit-mode" : "command-mode"
    }`;

    // Clear content
    this.element.innerHTML = "";

    // Build toolbar
    const toolbar = this.buildToolbar();
    this.element.appendChild(toolbar);

    // Create cells container
    this.cellsContainer = document.createElement("div");
    this.cellsContainer.className = "jupyter-notebook-cells";
    this.element.appendChild(this.cellsContainer);

    // Apply scroll past end padding if enabled
    this.applyScrollPastEnd();

    // Observe container resize for scroll past end updates
    if (this._resizeObserver) {
      this._resizeObserver.observe(this.cellsContainer);
    }

    // Set up drag auto-scroll on cells container
    this.setupDragAutoScroll();

    // Render cells
    this.renderCells();

    // Restore scroll position after DOM is updated
    if (scrollTop > 0) {
      requestAnimationFrame(() => {
        if (this.cellsContainer) {
          this.cellsContainer.scrollTop = scrollTop;
        }
      });
    }
  }

  setupDragAutoScroll() {
    if (!this.cellsContainer) return;

    // Remove old listeners if they exist (prevents leaks on re-render)
    if (this._dragOverHandler) {
      this.cellsContainer.removeEventListener("dragover", this._dragOverHandler);
      this.cellsContainer.removeEventListener("dragleave", this._dragLeaveHandler);
      this.cellsContainer.removeEventListener("drop", this._dropHandler);
      this.cellsContainer.removeEventListener("dragend", this._dragEndHandler);
    }

    const SCROLL_ZONE = 60; // pixels from edge to trigger scroll
    const MAX_SCROLL_SPEED = 15; // max pixels per frame

    this._dragOverHandler = (event) => {
      const rect = this.cellsContainer.getBoundingClientRect();
      const mouseY = event.clientY;

      // Calculate distance from edges
      const distFromTop = mouseY - rect.top;
      const distFromBottom = rect.bottom - mouseY;

      if (distFromTop < SCROLL_ZONE) {
        // Near top - scroll up (negative speed)
        const intensity = 1 - distFromTop / SCROLL_ZONE;
        this._autoScrollSpeed = -MAX_SCROLL_SPEED * intensity;
        this.startAutoScroll();
      } else if (distFromBottom < SCROLL_ZONE) {
        // Near bottom - scroll down (positive speed)
        const intensity = 1 - distFromBottom / SCROLL_ZONE;
        this._autoScrollSpeed = MAX_SCROLL_SPEED * intensity;
        this.startAutoScroll();
      } else {
        // Not in scroll zone
        this.stopAutoScroll();
      }
    };

    this._dragLeaveHandler = (event) => {
      // Stop scrolling when drag leaves the container
      if (!this.cellsContainer.contains(event.relatedTarget)) {
        this.stopAutoScroll();
      }
    };

    this._dropHandler = () => {
      this.stopAutoScroll();
    };

    this._dragEndHandler = () => {
      this.stopAutoScroll();
    };

    this.cellsContainer.addEventListener("dragover", this._dragOverHandler);
    this.cellsContainer.addEventListener("dragleave", this._dragLeaveHandler);
    this.cellsContainer.addEventListener("drop", this._dropHandler);
    this.cellsContainer.addEventListener("dragend", this._dragEndHandler);
  }

  startAutoScroll() {
    if (this._autoScrollInterval) return;

    this._autoScrollInterval = setInterval(() => {
      if (this.cellsContainer && this._autoScrollSpeed !== 0) {
        this.cellsContainer.scrollTop += this._autoScrollSpeed;
      }
    }, 16); // ~60fps
  }

  stopAutoScroll() {
    if (this._autoScrollInterval) {
      clearInterval(this._autoScrollInterval);
      this._autoScrollInterval = null;
    }
    this._autoScrollSpeed = 0;
  }

  /**
   * Apply scroll past end padding based on Pulsar's editor.scrollPastEnd setting
   */
  applyScrollPastEnd() {
    if (!this.cellsContainer) return;

    const scrollPastEnd = atom.config.get("editor.scrollPastEnd");
    if (scrollPastEnd) {
      // Add padding-bottom equal to the container's height minus some minimal space
      // This allows scrolling the last cell to near the top of the viewport
      requestAnimationFrame(() => {
        if (this.cellsContainer) {
          const containerHeight = this.cellsContainer.clientHeight;
          // Leave at least 50px visible at the bottom
          const padding = Math.max(0, containerHeight - 50);
          this.cellsContainer.style.paddingBottom = `${padding}px`;
        }
      });
    } else {
      this.cellsContainer.style.paddingBottom = "";
    }
  }

  buildToolbar() {
    const { cells, activeCellIndex, kernel, editor } = this.props;

    const toolbar = document.createElement("div");
    toolbar.className = "jupyter-notebook-toolbar";

    // Left side
    const toolbarLeft = document.createElement("div");
    toolbarLeft.className = "toolbar-left";

    // Run button (run and stay)
    const runBtn = document.createElement("button");
    runBtn.className = "btn btn-sm icon icon-playback-play";
    runBtn.title = "Run Cell (Ctrl+Enter)";
    runBtn.onclick = () => editor && editor.runCell();
    toolbarLeft.appendChild(runBtn);

    // Run and advance button
    const runAdvanceBtn = document.createElement("button");
    runAdvanceBtn.className = "btn btn-sm icon icon-move-down";
    runAdvanceBtn.title = "Run Cell and Advance (Shift+Enter)";
    runAdvanceBtn.onclick = () => editor && editor.runCellAndAdvance();
    toolbarLeft.appendChild(runAdvanceBtn);

    // Run all cells button
    const runAllBtn = document.createElement("button");
    runAllBtn.className = "btn btn-sm icon icon-playback-fast-forward";
    runAllBtn.title = "Run All Cells";
    runAllBtn.onclick = () => editor && editor.runAllCells();
    toolbarLeft.appendChild(runAllBtn);

    // Interrupt button
    const interruptBtn = document.createElement("button");
    interruptBtn.className = "btn btn-sm icon icon-primitive-square";
    interruptBtn.title = "Interrupt Kernel";
    interruptBtn.onclick = () => editor && editor.interruptKernel();
    toolbarLeft.appendChild(interruptBtn);

    // Restart button
    const restartBtn = document.createElement("button");
    restartBtn.className = "btn btn-sm icon icon-sync";
    restartBtn.title = "Restart Kernel";
    restartBtn.onclick = () => editor && editor.restartKernel();
    toolbarLeft.appendChild(restartBtn);

    // Shutdown kernel button
    const shutdownBtn = document.createElement("button");
    shutdownBtn.className = "btn btn-sm icon icon-x";
    shutdownBtn.title = "Shutdown Kernel";
    shutdownBtn.onclick = () => editor && editor.disconnectKernel();
    toolbarLeft.appendChild(shutdownBtn);

    // Separator
    toolbarLeft.appendChild(this.createSeparator());

    // Insert cell above button
    const insertAboveBtn = document.createElement("button");
    insertAboveBtn.className = "btn btn-sm icon icon-chevron-up";
    insertAboveBtn.title = "Insert Cell Above (a)";
    insertAboveBtn.onclick = () => editor && editor.insertCellAbove();
    toolbarLeft.appendChild(insertAboveBtn);

    // Insert cell below button
    const insertBelowBtn = document.createElement("button");
    insertBelowBtn.className = "btn btn-sm icon icon-chevron-down";
    insertBelowBtn.title = "Insert Cell Below (b)";
    insertBelowBtn.onclick = () => editor && editor.insertCellBelow();
    toolbarLeft.appendChild(insertBelowBtn);

    // Move up button
    const moveUpBtn = document.createElement("button");
    moveUpBtn.className = "btn btn-sm icon icon-arrow-up";
    moveUpBtn.title = "Move Cell Up";
    moveUpBtn.onclick = () => editor && editor.moveCellUp();
    toolbarLeft.appendChild(moveUpBtn);

    // Move down button
    const moveDownBtn = document.createElement("button");
    moveDownBtn.className = "btn btn-sm icon icon-arrow-down";
    moveDownBtn.title = "Move Cell Down";
    moveDownBtn.onclick = () => editor && editor.moveCellDown();
    toolbarLeft.appendChild(moveDownBtn);

    // Delete cell button
    const deleteBtn = document.createElement("button");
    deleteBtn.className = "btn btn-sm icon icon-trashcan";
    deleteBtn.title = "Delete Cell (dd)";
    deleteBtn.onclick = () => editor && editor.deleteCell();
    toolbarLeft.appendChild(deleteBtn);

    // Separator
    toolbarLeft.appendChild(this.createSeparator());

    // Clear output button
    const clearOutputBtn = document.createElement("button");
    clearOutputBtn.className = "btn btn-sm icon icon-circle-slash";
    clearOutputBtn.title = "Clear Cell Output";
    clearOutputBtn.onclick = () => editor && editor.clearOutput();
    toolbarLeft.appendChild(clearOutputBtn);

    // Clear all outputs button
    const clearAllOutputsBtn = document.createElement("button");
    clearAllOutputsBtn.className = "btn btn-sm icon icon-dash";
    clearAllOutputsBtn.title = "Clear All Outputs";
    clearAllOutputsBtn.onclick = () => editor && editor.clearAllOutputs();
    toolbarLeft.appendChild(clearAllOutputsBtn);

    // Separator
    toolbarLeft.appendChild(this.createSeparator());

    // Cell type select
    const cellTypeSelect = document.createElement("select");
    cellTypeSelect.className = "input-select cell-type-select";
    cellTypeSelect.title = "Cell Type";
    cellTypeSelect.innerHTML =
      '<option value="code">Code</option><option value="markdown">Markdown</option><option value="raw">Raw</option>';
    if (cells && cells[activeCellIndex]) {
      cellTypeSelect.value = cells[activeCellIndex].type;
    }
    cellTypeSelect.onchange = (e) => editor && editor.changeCellType(e.target.value);
    toolbarLeft.appendChild(cellTypeSelect);

    // Separator
    toolbarLeft.appendChild(this.createSeparator());

    // Mode indicator
    const modeIndicator = document.createElement("span");
    modeIndicator.className = "mode-indicator";
    modeIndicator.textContent = this.mode === "edit" ? "Edit" : "Command";
    toolbarLeft.appendChild(modeIndicator);

    toolbar.appendChild(toolbarLeft);

    // Right side
    const toolbarRight = document.createElement("div");
    toolbarRight.className = "toolbar-right";

    const kernelIndicator = document.createElement("span");
    kernelIndicator.className = "kernel-indicator";
    kernelIndicator.style.cursor = "pointer";
    kernelIndicator.title = "Click to select kernel";

    const kernelStatus = document.createElement("span");
    kernelStatus.className = `kernel-status ${kernel ? kernel.status : "disconnected"}`;
    kernelIndicator.appendChild(kernelStatus);

    const kernelName = document.createElement("span");
    kernelName.className = "kernel-name";
    kernelName.textContent = kernel ? kernel.displayName : "No Kernel";
    kernelIndicator.appendChild(kernelName);

    // Open kernel picker on click
    kernelIndicator.addEventListener("click", () => {
      atom.commands.dispatch(atom.views.getView(atom.workspace), "jupyter-next:connect-kernel");
    });

    toolbarRight.appendChild(kernelIndicator);
    toolbar.appendChild(toolbarRight);

    return toolbar;
  }

  createSeparator() {
    const sep = document.createElement("div");
    sep.className = "toolbar-separator";
    return sep;
  }

  renderCells() {
    const { cells, activeCellIndex, editor } = this.props;

    if (!this.cellsContainer) return;

    // Track which cell IDs we've seen
    const currentCellIds = new Set();
    const cellsArray = cells || [];

    // Create/update cell views
    cellsArray.forEach((cell, index) => {
      currentCellIds.add(cell.id);

      let cellView = this.cellViews.get(cell.id);

      // Create navigation callbacks for this cell
      const cellProps = {
        cell: cell,
        index: index,
        active: index === activeCellIndex,
        selected: this.selectedCells.has(index),
        mode: this.mode,
        editor: editor,
        notebookView: this,
        onCellSelect: (event) => this.handleCellSelect(index, event),
        onFocus: () => editor && editor.setActiveCell(index),
        onSourceChange: (source) => editor && editor.updateCellSource(index, source),
        onEnterEditMode: () => this.setMode("edit"),
        onEnterCommandMode: () => this.setMode("command"),
        onNavigateToPreviousCell: () => {
          if (editor && index > 0) {
            editor.setActiveCell(index - 1);
            // Focus the previous cell and move cursor to last row
            requestAnimationFrame(() => {
              const prevCellView = this.cellViews.get(cellsArray[index - 1]?.id);
              if (prevCellView) {
                prevCellView.focus();
                if (prevCellView.editor) {
                  const lastRow = prevCellView.editor.getLastBufferRow();
                  prevCellView.editor.setCursorBufferPosition([lastRow, Infinity]);
                }
              }
            });
          }
        },
        onNavigateToNextCell: () => {
          if (editor && index < cellsArray.length - 1) {
            editor.setActiveCell(index + 1);
            // Focus the next cell and move cursor to first row
            requestAnimationFrame(() => {
              const nextCellView = this.cellViews.get(cellsArray[index + 1]?.id);
              if (nextCellView) {
                nextCellView.focus();
                if (nextCellView.editor) {
                  nextCellView.editor.setCursorBufferPosition([0, 0]);
                }
              }
            });
          }
        },
      };

      if (!cellView) {
        // Create new cell view
        cellView = new CellView(cellProps);
        this.cellViews.set(cell.id, cellView);
      } else {
        // Update existing cell view
        cellView.update(cellProps);
      }
    });

    // Remove old cell views
    for (const [id, cellView] of this.cellViews) {
      if (!currentCellIds.has(id)) {
        cellView.destroy();
        this.cellViews.delete(id);
      }
    }

    // Only rebuild DOM if cell order changed or new cells added/removed
    // This preserves focus when just updating cell contents (like outputs)
    const currentChildren = Array.from(this.cellsContainer.children);
    const expectedOrder = cellsArray
      .map((cell) => this.cellViews.get(cell.id)?.element)
      .filter(Boolean);

    const needsReorder =
      currentChildren.length !== expectedOrder.length ||
      currentChildren.some((child, i) => child !== expectedOrder[i]);

    if (needsReorder) {
      // Preserve scroll position before DOM manipulation
      const scrollTop = this.cellsContainer.scrollTop;

      // Only manipulate DOM when order actually changed
      this.cellsContainer.innerHTML = "";
      expectedOrder.forEach((element) => {
        this.cellsContainer.appendChild(element);
      });

      // Restore scroll position after DOM is updated
      requestAnimationFrame(() => {
        if (this.cellsContainer) {
          this.cellsContainer.scrollTop = scrollTop;
        }
      });
    }
  }

  update(props) {
    const oldProps = this.props;
    this.props = { ...this.props, ...props };

    if (oldProps.kernel !== props.kernel) {
      // Full re-render needed for kernel change (toolbar needs update)
      this.render();
    } else {
      // Update cell views for any change (cells, active cell, or content like outputs)
      this.renderCells();
      this.updateCellTypeSelect();
    }
  }

  /**
   * Update the cell type dropdown to reflect the active cell's type
   */
  updateCellTypeSelect() {
    const { cells, activeCellIndex } = this.props;
    const cellTypeSelect = this.element.querySelector(".cell-type-select");
    if (cellTypeSelect && cells && cells[activeCellIndex]) {
      cellTypeSelect.value = cells[activeCellIndex].type;
    }
  }

  setMode(mode) {
    if (this.mode !== mode) {
      this.mode = mode;

      // Update element classes immediately for keymap selectors
      this.element.classList.remove("edit-mode", "command-mode");
      this.element.classList.add(mode === "edit" ? "edit-mode" : "command-mode");

      // Update mode indicator
      const modeIndicator = this.element.querySelector(".mode-indicator");
      if (modeIndicator) {
        modeIndicator.textContent = mode === "edit" ? "Edit" : "Command";
      }
    }
  }

  enterEditMode() {
    this.setMode("edit");
    // Focus the active cell's editor
    this.focusActiveCellEditor();
  }

  /**
   * Focus the active cell's editor without changing mode
   */
  focusActiveCellEditor() {
    const activeCellIndex = this.props.activeCellIndex;
    const cells = this.props.cells;
    if (cells && cells[activeCellIndex]) {
      const cellView = this.cellViews.get(cells[activeCellIndex].id);
      if (cellView) {
        // Temporarily disable mode switching from focus events
        this._skipFocusModeChange = true;
        cellView.focus();
        // Re-enable after focus events have been processed
        // Use setTimeout to ensure it runs after handleFocusOut's setTimeout(0)
        setTimeout(() => {
          this._skipFocusModeChange = false;
        }, 50);
      }
    }
  }

  enterCommandMode() {
    this.setMode("command");
    // Focus the notebook itself for command mode keybindings
    this.element.focus();
  }

  /**
   * Activate the pane containing this notebook
   */
  activatePane() {
    const { editor } = this.props;
    if (editor) {
      const pane = atom.workspace.paneForItem(editor);
      if (pane && !pane.isActive()) {
        pane.activate();
      }
    }
  }

  handleFocusIn(event) {
    // Activate the pane containing this notebook when any element receives focus
    this.activatePane();

    // Restore selection styling when notebook gains focus
    this.updateCellSelectionClasses();

    // Skip mode change if programmatically focusing (e.g., run-and-advance)
    if (this._skipFocusModeChange) return;

    // Check if focus went to an editor inside a cell
    const isEditor = event.target.closest("atom-text-editor");
    const isInCell = event.target.closest(".jupyter-cell");

    if (isEditor && isInCell) {
      this.setMode("edit");
    }
  }

  handleFocusOut() {
    // Check if focus is leaving the notebook entirely
    setTimeout(() => {
      // Guard against destroyed view
      if (!this.element) return;

      // Don't switch mode if programmatically focusing or mouse button held
      if (this._skipFocusModeChange) return;
      if (this._mouseButtonDown) return;

      if (!this.element.contains(document.activeElement)) {
        // Focus left the notebook - hide selections
        this._hideSelectionClasses();
      } else if (!document.activeElement.closest("atom-text-editor")) {
        // Focus is in notebook but not in an editor
        this.setMode("command");
      }
    }, 0);
  }

  handleClick(event) {
    // Activate pane on any click
    this.activatePane();

    // Clicking on a cell but not in the editor should enter command mode
    const isEditor = event.target.closest("atom-text-editor");
    const isCell = event.target.closest(".jupyter-cell");

    if (isCell && !isEditor) {
      // Clicked on cell but not editor - command mode
      this.setMode("command");
      this.element.focus();
    } else if (isEditor) {
      // Clicked in editor - edit mode
      this.setMode("edit");
      this.clearSelection();
    } else if (!isCell) {
      // Clicked on background (not on any cell) - command mode and clear selection
      this.setMode("command");
      this.element.focus();
      this.clearSelection();
    }
  }

  /**
   * Handle cell selection with Ctrl/Shift modifiers
   * @param {number} index - Cell index that was clicked
   * @param {MouseEvent} event - The click event
   */
  handleCellSelect(index, event) {
    const { editor, activeCellIndex } = this.props;

    if (event.ctrlKey || event.metaKey) {
      // Ctrl+click: toggle selection of clicked cell
      if (this.selectedCells.has(index)) {
        this.selectedCells.delete(index);
      } else {
        this.selectedCells.add(index);
      }
      // Set active cell to clicked cell
      if (editor) editor.setActiveCell(index);
    } else if (event.shiftKey) {
      // Shift+click: select range from active cell to clicked cell
      const start = Math.min(activeCellIndex, index);
      const end = Math.max(activeCellIndex, index);
      this.selectedCells.clear();
      for (let i = start; i <= end; i++) {
        this.selectedCells.add(i);
      }
    } else {
      // Normal click: clear selection and select only clicked cell
      this.selectedCells.clear();
      this.selectedCells.add(index);
      if (editor) editor.setActiveCell(index);
    }

    // Update cell views to reflect selection state
    this.updateCellSelectionClasses();
  }

  /**
   * Update CSS classes on cells to reflect selection state
   * Also validates and cleans up any invalid indices in selectedCells
   */
  updateCellSelectionClasses() {
    const { cells } = this.props;
    if (!cells) return;

    // Validate selection indices - remove any that are out of bounds
    const validSelection = new Set();
    for (const index of this.selectedCells) {
      if (index >= 0 && index < cells.length) {
        validSelection.add(index);
      }
    }
    this.selectedCells = validSelection;

    cells.forEach((cell, index) => {
      const cellView = this.cellViews.get(cell.id);
      if (cellView && cellView.element) {
        if (this.selectedCells.has(index)) {
          cellView.element.classList.add("selected");
        } else {
          cellView.element.classList.remove("selected");
        }
      }
    });
  }

  /**
   * Hide selection classes without clearing the selection data
   * Used when notebook loses focus
   */
  _hideSelectionClasses() {
    const { cells } = this.props;
    if (!cells) return;

    cells.forEach((cell) => {
      const cellView = this.cellViews.get(cell.id);
      if (cellView && cellView.element) {
        cellView.element.classList.remove("selected");
      }
    });
  }

  /**
   * Clear all cell selections
   */
  clearSelection() {
    this.selectedCells.clear();
    this.updateCellSelectionClasses();
  }

  /**
   * Extend selection to include the specified cell index
   */
  extendSelection(index) {
    this.selectedCells.add(index);
    this.updateCellSelectionClasses();
  }

  /**
   * Get array of selected cell indices
   */
  getSelectedCells() {
    return Array.from(this.selectedCells).sort((a, b) => a - b);
  }

  focusPreviousCell() {
    const { editor, activeCellIndex } = this.props;
    if (editor && activeCellIndex > 0) {
      editor.setActiveCell(activeCellIndex - 1);
      this.scrollToCell(activeCellIndex - 1);
    }
  }

  focusNextCell() {
    const { editor, activeCellIndex, cells } = this.props;
    if (editor && cells && activeCellIndex < cells.length - 1) {
      editor.setActiveCell(activeCellIndex + 1);
      this.scrollToCell(activeCellIndex + 1);
    }
  }

  focusFirstCell() {
    const { editor, cells } = this.props;
    if (editor && cells && cells.length > 0) {
      editor.setActiveCell(0);
      this.scrollToCell(0);
    }
  }

  focusLastCell() {
    const { editor, cells } = this.props;
    if (editor && cells && cells.length > 0) {
      editor.setActiveCell(cells.length - 1);
      this.scrollToCell(cells.length - 1);
    }
  }

  scrollToCell(index) {
    const cells = this.props.cells;
    if (cells && cells[index]) {
      const cellView = this.cellViews.get(cells[index].id);
      if (cellView && cellView.element) {
        cellView.element.scrollIntoView({
          behavior: "smooth",
          block: "nearest",
        });
      }
    }
  }

  getMode() {
    return this.mode;
  }

  setDraggingCell(index) {
    this.draggingCellIndex = index;
  }

  getDraggingCell() {
    return this.draggingCellIndex;
  }

  destroy() {
    // Stop any auto-scroll
    this.stopAutoScroll();

    // Remove global mouse up listener
    if (this._handleGlobalMouseUp) {
      document.removeEventListener("mouseup", this._handleGlobalMouseUp);
      this._handleGlobalMouseUp = null;
    }

    // Remove drag scroll listeners
    if (this.cellsContainer && this._dragOverHandler) {
      this.cellsContainer.removeEventListener("dragover", this._dragOverHandler);
      this.cellsContainer.removeEventListener("dragleave", this._dragLeaveHandler);
      this.cellsContainer.removeEventListener("drop", this._dropHandler);
      this.cellsContainer.removeEventListener("dragend", this._dragEndHandler);
    }
    this._dragOverHandler = null;
    this._dragLeaveHandler = null;
    this._dropHandler = null;
    this._dragEndHandler = null;

    // Dispose scrollPastEnd config observer
    if (this._scrollPastEndDisposable) {
      this._scrollPastEndDisposable.dispose();
      this._scrollPastEndDisposable = null;
    }

    // Disconnect resize observer
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }

    // Destroy all cell views
    for (const cellView of this.cellViews.values()) {
      cellView.destroy();
    }
    this.cellViews.clear();

    this.cellsContainer = null;
    this.element = null;
  }
}

module.exports = NotebookView;
