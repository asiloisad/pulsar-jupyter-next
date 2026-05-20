/**
 * JupyterNotebookEditor - Editor for Jupyter notebooks using React
 */

const { Emitter, CompositeDisposable, Disposable } = require("atom");
const path = require("path");

// Lazy load components
let NotebookView = null;
let NotebookDocument = null;
let CellUndoManager = null;

function getNotebookView() {
  if (!NotebookView) {
    NotebookView = require("./notebook-view");
  }
  return NotebookView;
}

function getNotebookDocument() {
  if (!NotebookDocument) {
    NotebookDocument = require("./notebook-document");
  }
  return NotebookDocument;
}

function getCellUndoManager() {
  if (!CellUndoManager) {
    CellUndoManager = require("./cell-undo-manager");
  }
  return CellUndoManager;
}

/**
 * JupyterNotebookEditor is a view/editor for a NotebookDocument.
 * Multiple editors can share the same document (like Pulsar's TextEditor/TextBuffer).
 */
class JupyterNotebookEditor {
  static deserialize(state, deserializeServices = null) {
    // Check if there's already an open editor for this file/content
    // This prevents reloading when moving panes between containers
    const searchPath = state.filePath;

    // Search all pane items for an existing editor with same path and loaded view
    for (const paneContainer of [
      atom.workspace.getCenter(),
      atom.workspace.getLeftDock(),
      atom.workspace.getRightDock(),
      atom.workspace.getBottomDock(),
    ]) {
      if (!paneContainer) continue;
      for (const pane of paneContainer.getPanes()) {
        for (const item of pane.getItems()) {
          if (item instanceof JupyterNotebookEditor && item.view && !item._destroyed) {
            // Match by file path if available
            if (searchPath && item.getPath() === searchPath) {
              return item;
            }
          }
        }
      }
    }

    // Return a synchronous placeholder that loads asynchronously
    // This prevents Pulsar from trying to create a view for a Promise
    const editor = new JupyterNotebookEditor(null, state, deserializeServices);
    return editor;
  }

  constructor(notebookDocument, deserializeState = null, deserializeServices = null) {
    this.emitter = new Emitter();
    this.disposables = new CompositeDisposable();
    this.activeCellIndex = 0;
    this.view = null;
    this.document = null;
    this._loading = false;
    this._loadError = null;
    this._destroyed = false;
    this.sourceEditor = null;
    this.deserializeServices = deserializeServices;

    // Cell operation undo/redo manager
    const CellUndoManagerClass = getCellUndoManager();
    this.cellUndoManager = new CellUndoManagerClass();

    // Clipboard for cut/copy/paste
    this.cellClipboard = null;

    // Create a stable container element that ViewRegistry will cache.
    // We swap its contents between placeholder and view to work around
    // ViewRegistry's caching behavior (it caches getElement() result once).
    this._containerElement = window.document.createElement("div");
    this._containerElement.className = "jupyter-next jupyter-notebook-container";

    if (notebookDocument) {
      // Normal construction with document
      this._initWithDocument(notebookDocument);
    } else if (deserializeState) {
      // Create placeholder and async load from serialized state
      this._createPlaceholder();
      this._loadFromState(deserializeState);
    }
  }

  _createPlaceholder() {
    // Create placeholder content inside the stable container
    this._containerElement.innerHTML =
      '<div class="jupyter-notebook-loading"><div class="loading-spinner-large"></div><div class="loading-message">Loading notebook...</div></div>';
  }

  async _loadFromState(state) {
    // Guard against concurrent calls
    if (this._loadingPromise) {
      return this._loadingPromise;
    }

    this._loading = true;
    this._deserializeState = state;

    this._loadingPromise = (async () => {
      try {
        const { documentRegistry, kernelManager } = this._getDeserializeServices();

        let doc;
        if (state.filePath && state.notebookData && state.wasModified) {
          // Modified saved file - restore from serialized data with file path
          const NotebookDocumentClass = getNotebookDocument();
          doc = new NotebookDocumentClass(state.filePath, kernelManager);
          await doc.initializeFromData(state.notebookData);
          // Mark as modified since it has unsaved changes
          doc.setModified(true);
          if (state.activeCellIndex !== undefined) {
            this.activeCellIndex = state.activeCellIndex;
          }
        } else if (state.filePath) {
          // Unmodified saved file - load from disk
          doc = await documentRegistry.getOrCreateDocument(state.filePath);
        } else if (state.notebookData) {
          // Unsaved notebook - restore from serialized data
          const NotebookDocumentClass = getNotebookDocument();
          doc = new NotebookDocumentClass(null, kernelManager);
          await doc.initializeFromData(state.notebookData);
          // Mark as modified since it's unsaved
          if (state.wasModified) {
            doc.setModified(true);
          }
          if (state.activeCellIndex !== undefined) {
            this.activeCellIndex = state.activeCellIndex;
          }
        }

        if (doc) {
          this._initWithDocument(doc);
        } else {
          // No document loaded - show error
          this._containerElement.innerHTML =
            '<div class="error-message">Failed to load notebook: No document</div>';
        }
      } catch (error) {
        this._loadError = error;
        console.error("[jupyter-next] Failed to load notebook:", error);
        this._containerElement.innerHTML = `<div class="error-message">Failed to load notebook: ${error.message}</div>`;
      } finally {
        this._loading = false;
        this._loadingPromise = null;
        // Notify that title has changed (was "Loading...", now is actual filename)
        this.emitter.emit("did-change-title");
      }
    })();

    return this._loadingPromise;
  }

  _getDeserializeServices() {
    const { documentRegistry, kernelManager } = this.deserializeServices || {};
    if (!documentRegistry || !kernelManager) {
      throw new Error("Cannot restore notebook without document services");
    }
    return { documentRegistry, kernelManager };
  }

  _initWithDocument(notebookDocument) {
    this.document = notebookDocument;
    this.document.retain();

    // Create the view
    const NotebookViewClass = getNotebookView();
    this.view = new NotebookViewClass({
      editor: this,
      cells: this.document.cells,
      activeCellIndex: this.activeCellIndex,
      kernel: this.document.kernel,
    });

    // Replace container contents with the view element
    // This handles both initial load and deserialization (replaces placeholder)
    this._containerElement.innerHTML = "";
    this._containerElement.appendChild(this.view.element);

    // Subscribe to document changes
    this.subscribeToDocument();

    // Register a backing editor so editor services can lint the notebook as .ipynb JSON.
    this.setupSourceEditor();

    // Subscribe to pane item activation to redirect focus appropriately
    this.subscribeToActivation();

    // Emit initial modified status for tabs to pick up
    this.emitter.emit("did-change-modified", this.document.isModified());

    // Notify services (e.g. navigation-panel) that headers are now available
    this.emitter.emit("did-change");
    this.emitter.emit("did-change-navigation");

    // Apply pending state from copy() if any (cursor positions, mode, scroll)
    this._applyPendingStateSoon();
  }

  subscribeToDocument() {
    this.disposables.add(
      this.document.onDidChange(() => {
        this.updateView();
        this.scheduleSourceEditorSync();
        this.emitter.emit("did-change");
        this.emitter.emit("did-change-navigation");
      }),

      this.document.onDidSave(() => {
        this.syncSourceEditor();
        this.emitter.emit("did-save", { path: this.document.filePath });
      }),

      this.document.onDidChangePath(() => {
        this.syncSourceEditor();
        this.emitter.emit("did-change-title");
      }),

      this.document.onDidReload(() => {
        this.cellUndoManager.clear();
        this.activeCellIndex = Math.max(
          0,
          Math.min(this.activeCellIndex, this.document.getCellCount() - 1),
        );
        this.updateView();
        this.syncSourceEditor();
        this.emitter.emit("did-change-navigation");
      }),

      this.document.onDidConnectKernel((kernel) => {
        this.updateView();
        this.emitter.emit("did-connect-kernel", kernel);
      }),

      this.document.onDidDisconnectKernel(() => {
        this.updateView();
        this.emitter.emit("did-disconnect-kernel");
      }),

      this.document.onDidChangeKernelStatus((status) => {
        this.updateView();
        this.emitter.emit("did-change-kernel-status", status);
      }),

      this.document.onDidInsertCell(({ index }) => {
        // Adjust active cell index if needed
        if (index <= this.activeCellIndex) {
          this.activeCellIndex++;
        }
        // Adjust selected cell indices in view
        this._adjustSelectionForInsert(index);
        this.updateView();
      }),

      this.document.onDidDeleteCell(({ index }) => {
        // Adjust active cell index if needed
        if (index < this.activeCellIndex) {
          this.activeCellIndex--;
        } else if (
          index === this.activeCellIndex &&
          this.activeCellIndex >= this.document.getCellCount()
        ) {
          this.activeCellIndex = Math.max(0, this.document.getCellCount() - 1);
        }
        // Adjust selected cell indices in view
        this._adjustSelectionForDelete(index);
        this.updateView();
      }),

      this.document.onDidMoveCell(({ fromIndex, toIndex }) => {
        // Adjust active cell index if it was moved
        if (this.activeCellIndex === fromIndex) {
          this.activeCellIndex = toIndex;
        } else if (fromIndex < this.activeCellIndex && toIndex >= this.activeCellIndex) {
          this.activeCellIndex--;
        } else if (fromIndex > this.activeCellIndex && toIndex <= this.activeCellIndex) {
          this.activeCellIndex++;
        }
        // Adjust selected cell indices in view
        this._adjustSelectionForMove(fromIndex, toIndex);
        this.updateView();
      }),

      this.document.onDidDestroy(() => {
        this.destroy();
      }),

      this.document.onDidChangeModified((modified) => {
        this.emitter.emit("did-change-modified", modified);
        // Exit pending state when notebook is modified
        if (modified) {
          this.terminatePendingState();
        }
      }),
    );
  }

  subscribeToActivation() {
    // When this pane item becomes active, restore focus without scrolling.
    // Focusing the notebook container is enough — the user's scroll position
    // is preserved and they can click or press Enter to resume editing.
    this.disposables.add(
      atom.workspace.onDidChangeActivePaneItem((item) => {
        if (item === this && this.view) {
          requestAnimationFrame(() => {
            if (this.sourceEditor) {
              this.sourceEditor.jupyterNotebookEditor = this;
            }
            this.view.element.focus();
          });
        }
      }),
    );
  }

  updateView() {
    if (this.view) {
      this.view.update({
        editor: this,
        cells: this.document.cells,
        activeCellIndex: this.activeCellIndex,
        kernel: this.document.kernel,
      });
    }
  }

  setupSourceEditor() {
    if (!this.document) return;

    if (!this.document._sourceEditor) {
      const editor = atom.workspace.buildTextEditor({
        mini: false,
        lineNumberGutterVisible: false,
      });
      editor.isJupyterNotebookSourceEditor = true;

      const grammar = atom.grammars.grammarForScopeName("source.jupyter");
      if (grammar) {
        editor.setGrammar(grammar);
      }
      atom.packages.triggerActivationHook?.("source.jupyter:root-scope-used");
      atom.packages.triggerActivationHook?.("jupyter-next:grammar-used");

      const registration = atom.textEditors.add(editor);
      this.document._sourceEditor = editor;
      this.document._sourceEditorDisposable = new CompositeDisposable(
        registration,
        new Disposable(() => editor.destroy()),
      );
      this.document.disposables.add(this.document._sourceEditorDisposable);
    }

    this.sourceEditor = this.document._sourceEditor;
    this.sourceEditor.jupyterNotebookEditor = this;
    this.syncSourceEditor();
  }

  scheduleSourceEditorSync() {
    if (this._sourceEditorSyncScheduled) return;
    this._sourceEditorSyncScheduled = true;
    requestAnimationFrame(() => {
      this._sourceEditorSyncScheduled = false;
      this.syncSourceEditor();
    });
  }

  syncSourceEditor() {
    if (!this.sourceEditor || !this.document) return;

    const buffer = this.sourceEditor.getBuffer();
    if (this.document.filePath && buffer.getPath() !== this.document.filePath) {
      buffer.setPath(this.document.filePath);
    }

    const text = JSON.stringify(this.getSourceEditorJSON(), null, 2);
    if (this.sourceEditor.getText() !== text) {
      this.sourceEditor.setText(text);
    }
  }

  getSourceEditorJSON() {
    return {
      nbformat: this.document.nbformat,
      nbformat_minor: this.document.nbformat_minor,
      metadata: this.document.metadata || {},
      cells: this.document.cells.map((cell) => {
        const source = cell.type === "code" ? cell.source : "";
        const data = {
          id: cell.id,
          cell_type: cell.type,
          metadata: cell.metadata || {},
          source: source
            .split("\n")
            .map((line, i, arr) => (i < arr.length - 1 ? line + "\n" : line))
            .filter((line) => line !== ""),
        };

        if (cell.type === "code") {
          data.execution_count = null;
          data.outputs = [];
        }

        return data;
      }),
    };
  }

  getCellEditor(cellNumber) {
    const index = cellNumber - 1;
    const cell = this.document?.cells?.[index];
    if (!cell || cell.type !== "code") return null;

    const cellView = this.view?.cellViews?.get(cell.id);
    return cellView?.editor || null;
  }

  getSourceEditor() {
    return this.sourceEditor || null;
  }

  getLinterMessageCellIndex(message) {
    if (message?.location?.cell != null) {
      return message.location.cell - 1;
    }

    const messageBuffer = message?.location?.buffer;
    if (!messageBuffer || !this.document || !this.view) return -1;

    for (let i = 0; i < this.document.cells.length; i++) {
      const cell = this.document.cells[i];
      const cellView = this.view.cellViews.get(cell.id);
      if (cellView?.editor?.getBuffer?.() === messageBuffer) {
        return i;
      }
    }
    return -1;
  }

  getLinterMessageEditor(message) {
    const index = this.getLinterMessageCellIndex(message);
    if (index < 0) return null;
    return this.getCellEditor(index + 1);
  }

  getLinterMessageSortKey(message) {
    const position = message?.location?.position?.start || { row: 0, column: 0 };
    return {
      cellIndex: this.getLinterMessageCellIndex(message),
      row: position.row || 0,
      column: position.column || 0,
    };
  }

  compareLinterMessages(a, b) {
    const keyA = this.getLinterMessageSortKey(a);
    const keyB = this.getLinterMessageSortKey(b);
    if (keyA.cellIndex !== keyB.cellIndex) return keyA.cellIndex - keyB.cellIndex;
    if (keyA.row !== keyB.row) return keyA.row - keyB.row;
    return keyA.column - keyB.column;
  }

  getCurrentLinterMessage(messages) {
    const editor = this.getCellEditor(this.activeCellIndex + 1);
    if (!editor) return;

    const cursor = editor.getCursorBufferPosition();
    return messages.find((message) => {
      if (this.getLinterMessageCellIndex(message) !== this.activeCellIndex) return false;
      return message.location.position.containsPoint(cursor);
    });
  }

  getNextLinterMessage(messages) {
    if (!messages.length) return;

    const editor = this.getCellEditor(this.activeCellIndex + 1);
    const cursor = editor?.getCursorBufferPosition?.() || { row: 0, column: 0 };
    const sorted = messages.slice().sort((a, b) => this.compareLinterMessages(a, b));

    for (const message of sorted) {
      const key = this.getLinterMessageSortKey(message);
      if (
        key.cellIndex > this.activeCellIndex ||
        (key.cellIndex === this.activeCellIndex &&
          (key.row > cursor.row || (key.row === cursor.row && key.column > cursor.column)))
      ) {
        return message;
      }
    }

    return sorted[0];
  }

  getPreviousLinterMessage(messages) {
    if (!messages.length) return;

    const editor = this.getCellEditor(this.activeCellIndex + 1);
    const cursor = editor?.getCursorBufferPosition?.() || { row: 0, column: 0 };
    const sorted = messages.slice().sort((a, b) => this.compareLinterMessages(a, b));

    for (let i = sorted.length - 1; i >= 0; i--) {
      const message = sorted[i];
      const key = this.getLinterMessageSortKey(message);
      if (
        key.cellIndex < this.activeCellIndex ||
        (key.cellIndex === this.activeCellIndex &&
          (key.row < cursor.row || (key.row === cursor.row && key.column < cursor.column)))
      ) {
        return message;
      }
    }

    return sorted[sorted.length - 1];
  }

  revealLinterMessage(message) {
    const index = this.getLinterMessageCellIndex(message);
    if (index < 0) return;

    const pane = atom.workspace.getCenter().paneForItem(this) || atom.workspace.paneForItem(this);
    if (pane) {
      pane.activateItem(this);
      pane.activate();
    }

    this.setActiveCell(index);

    requestAnimationFrame(() => {
      if (!this.view) return;
      this.view.scrollToCell(index);
      this.view.enterEditMode();

      requestAnimationFrame(() => {
        const editor = this.getLinterMessageEditor(message);
        if (!editor) return;

        editor.setCursorBufferPosition(message.location.position.start, {
          autoscroll: false,
        });
        this.view.scrollToCursor(index, editor);

        const workspaceElement = atom.views.getView(atom.workspace);
        workspaceElement?.focus?.();

        const editorElement = atom.views.getView(editor);
        editorElement.focus({ preventScroll: true });
      });
    });
  }

  getNavigationHeaders() {
    if (!this.document) return [];
    const headings = [];
    const visibleCellIndexes = this.getVisibleNavigationCellIndexes();
    const regex = /^(#{1,6})\s+(.+)$/gm;
    this.document.cells.forEach((cell, index) => {
      if (cell.type !== "markdown") return;
      regex.lastIndex = 0;
      let match;
      while ((match = regex.exec(cell.source)) !== null) {
        const cellRow = cell.source.slice(0, match.index).split("\n").length - 1;
        headings.push({
          text: match[2].trim(),
          level: match[1].length,
          classList: [],
          cellIndex: index,
          cellRow,
        });
      }
    });
    return buildNavigationTree(headings, this.activeCellIndex, visibleCellIndexes);
  }

  revealNavigationHeader(header) {
    const mode = this.view?.getMode();
    const pane = atom.workspace.getCenter().paneForItem(this);
    if (pane) {
      pane.activateItem(this);
      pane.activate();
    }
    if (mode !== "edit") {
      this.view?.clearSelection();
    }
    this.setActiveCell(header.cellIndex);
    requestAnimationFrame(() => {
      if (!this.view) return;
      this.updateView();
      this.view.scrollToCell(header.cellIndex);
      if (mode !== "edit") return;

      this.view.enterEditMode();
      const cell = this.document?.cells?.[header.cellIndex];
      if (cell) {
        const cellView = this.view?.cellViews?.get(cell.id);
        if (cellView?.editor) {
          cellView.editor.setCursorBufferPosition([header.cellRow ?? 0, 0]);
          atom.views.getView(cellView.editor)?.focus();
        }
      }
    });
  }

  onNavigationChange(callback) {
    return this.emitter.on("did-change-navigation", callback);
  }

  observeNavigationHeaders(callback) {
    let disposed = false;
    let frame = null;
    let scrollDispose = null;
    let previousKey = null;
    let pendingInstant = false;

    const emit = (options) => {
      pendingInstant = pendingInstant || Boolean(options?.instant);
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        if (!disposed) {
          const headers = this.getNavigationHeaders();
          const visibleCellIndexes = this.getVisibleNavigationCellIndexes();
          const key = `${this.activeCellIndex}:${visibleCellIndexes.join(",")}`;
          if (pendingInstant || key !== previousKey) {
            previousKey = key;
            callback(headers, pendingInstant ? { instant: true } : options);
          }
        }
        pendingInstant = false;
      });
    };

    const attachScrollListener = () => {
      if (scrollDispose || !this.view?.onDidScroll) return;
      scrollDispose = this.view.onDidScroll(() => emit());
    };

    attachScrollListener();
    emit({ instant: true });

    const changeDispose = this.onNavigationChange(() => {
      attachScrollListener();
      emit({ instant: true });
    });

    return new Disposable(() => {
      disposed = true;
      if (frame !== null) {
        cancelAnimationFrame(frame);
      }
      scrollDispose?.dispose();
      changeDispose.dispose();
    });
  }

  getVisibleNavigationCellIndexes() {
    const container = this.view?.cellsContainer;
    if (!container || !this.document) return [];

    const containerRect = container.getBoundingClientRect();
    const visibleCellIndexes = new Set();

    this.document.cells.forEach((cell, index) => {
      const cellView = this.view?.cellViews?.get(cell.id);
      const element = cellView?.element;
      if (!element) return;

      const rect = element.getBoundingClientRect();
      if (rect.bottom >= containerRect.top && rect.top <= containerRect.bottom) {
        visibleCellIndexes.add(index);
      }
    });

    return Array.from(visibleCellIndexes).sort((a, b) => a - b);
  }

  // Create a copy of this editor (for split panes)
  // Used by Pulsar's pane:split-* and pane:copy-* commands
  copy() {
    const copy = new JupyterNotebookEditor(this.document);

    // Preserve the active cell index
    copy.activeCellIndex = this.activeCellIndex;
    copy.updateView();

    // Preserve cursor positions from each cell's editor
    if (this.view && this.view.cellViews) {
      const cursorPositions = new Map();
      for (const [cellId, cellView] of this.view.cellViews) {
        if (cellView.editor) {
          const position = cellView.editor.getCursorBufferPosition();
          const selections = cellView.editor.getSelectedBufferRanges();
          cursorPositions.set(cellId, { position, selections });
        }
      }

      // Store for restoration after view is created
      copy._pendingCursorPositions = cursorPositions;
    }

    // Preserve the mode (command/edit)
    if (this.view) {
      copy._pendingMode = this.view.getMode();
    }

    // Preserve scroll position
    if (this.view && this.view.cellsContainer) {
      copy._pendingScrollTop = this.view.cellsContainer.scrollTop;
    }

    copy._applyPendingStateSoon();

    return copy;
  }

  _applyPendingStateSoon() {
    if (!this._pendingCursorPositions && !this._pendingMode && this._pendingScrollTop === undefined) {
      return;
    }

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        this._applyPendingState();
      });
    });
  }

  /**
   * Apply pending state from copy() after view is ready
   * Called after the view is created and cells are rendered
   */
  _applyPendingState() {
    if (!this.view) return;

    // First restore scroll position so cell is visible
    if (this._pendingScrollTop !== undefined && this.view.cellsContainer) {
      this.view.cellsContainer.scrollTop = this._pendingScrollTop;
      this._pendingScrollTop = undefined;
    } else {
      // Ensure active cell is visible
      this.view.scrollToCell(this.activeCellIndex);
    }

    // Get the active cell to restore its cursor position
    const cells = this.document.cells;
    if (cells && cells[this.activeCellIndex] && this._pendingCursorPositions) {
      const activeCell = cells[this.activeCellIndex];
      const activeCellView = this.view.cellViews.get(activeCell.id);
      const cursorState = this._pendingCursorPositions.get(activeCell.id);

      if (activeCellView && activeCellView.editor && cursorState) {
        try {
          // Validate position is within buffer range before setting
          const buffer = activeCellView.editor.getBuffer();
          if (buffer && buffer.getLineCount() > 0) {
            const lastRow = buffer.getLastRow();
            const position = cursorState.position;
            // Clamp position to valid range
            const validRow = Math.min(position.row, lastRow);
            const validColumn = Math.min(position.column, buffer.lineLengthForRow(validRow) || 0);
            activeCellView.editor.setCursorBufferPosition([validRow, validColumn]);

            if (cursorState.selections && cursorState.selections.length > 0) {
              // Filter selections to valid ranges
              const validSelections = cursorState.selections.filter((range) => {
                return range.start.row <= lastRow && range.end.row <= lastRow;
              });
              if (validSelections.length > 0) {
                activeCellView.editor.setSelectedBufferRanges(validSelections);
              }
            }
          }
        } catch (e) {
          // Ignore cursor restoration errors - not critical
          console.warn("[jupyter-next] Could not restore cursor position:", e.message);
        }
      }
      this._pendingCursorPositions = null;
    }

    // Restore mode and focus the active cell appropriately
    if (this._pendingMode) {
      if (this._pendingMode === "edit") {
        this.view.setMode("edit");
      } else {
        this.view.enterCommandMode();
      }
      this._pendingMode = null;
    }
  }

  // Atom pane item interface
  getTitle() {
    if (this.document && this.document.filePath) {
      return path.basename(this.document.filePath);
    }
    return "Untitled.ipynb";
  }

  getLongTitle() {
    return (this.document && this.document.filePath) || "Untitled.ipynb";
  }

  getPath() {
    if (this.document) {
      return this.document.filePath;
    }
    // For loading editors, return path from deserialize state
    if (this._deserializeState) {
      return this._deserializeState.filePath;
    }
    return null;
  }

  getURI() {
    return this.getPath();
  }

  getElement() {
    // Always return the stable container element.
    // ViewRegistry caches this on first call and never asks again.
    // We manage the container's contents internally (placeholder -> view).
    return this._containerElement;
  }

  isModified() {
    return this.document ? this.document.isModified() : false;
  }

  // Called by Pulsar to determine if it should prompt to save before closing
  // Options may contain windowCloseRequested: true when closing the whole window
  shouldPromptToSave(options = {}) {
    // Don't prompt when closing Pulsar - content is serialized and restored
    if (options.windowCloseRequested) {
      return false;
    }
    // Don't prompt if not modified
    if (!this.isModified()) {
      return false;
    }
    // Don't prompt if other views of this notebook exist in the workspace
    // (the document will remain open in those views)
    if (this.document && this.document.refCount > 1) {
      return false;
    }
    return true;
  }

  // Exit pending state when the notebook is modified
  terminatePendingState() {
    // This is called by Pulsar's pane when we want to make the tab permanent
    // (e.g., when user makes changes to a pending/preview tab)
    this.emitter.emit("did-terminate-pending-state");
  }

  onDidTerminatePendingState(callback) {
    return this.emitter.on("did-terminate-pending-state", callback);
  }

  isPermanentDockItem() {
    return false;
  }

  getDefaultLocation() {
    return "center";
  }

  getAllowedLocations() {
    return ["center"];
  }

  serialize() {
    // Don't serialize if still loading or no document
    if (!this.document) {
      return null;
    }

    if (this.document.filePath) {
      // Saved notebook - store path and modified state
      // If modified, also store the current content so changes aren't lost
      if (this.document.isModified()) {
        return {
          deserializer: "JupyterNotebookEditor",
          filePath: this.document.filePath,
          notebookData: this.document.toJSON(),
          activeCellIndex: this.activeCellIndex,
          wasModified: true,
        };
      } else {
        return {
          deserializer: "JupyterNotebookEditor",
          filePath: this.document.filePath,
        };
      }
    } else {
      // Unsaved notebook - store full content (always modified)
      return {
        deserializer: "JupyterNotebookEditor",
        notebookData: this.document.toJSON(),
        activeCellIndex: this.activeCellIndex,
        wasModified: true,
      };
    }
  }

  // Delegate save to document
  async save() {
    if (!this.document) return false;
    if (!this.document.filePath) {
      // Use Pulsar's pane to show save dialog properly
      const pane = atom.workspace.paneForItem(this);
      if (pane) {
        return pane.saveItemAs(this);
      }
      return false;
    }
    return this.document.save();
  }

  // Called by Pulsar's Pane with the selected path from save dialog
  async saveAs(newPath) {
    if (!this.document) return false;
    // Handle both string path and object { canceled, filePath } from Electron dialog
    const filePath = typeof newPath === "string" ? newPath : newPath?.filePath;
    if (filePath) {
      this.document.setPath(filePath);
      return this.document.save();
    }
    return false;
  }

  // Pulsar pane item interface - provides options for save dialog
  getSaveDialogOptions() {
    let defaultPath = this.document?.filePath;
    if (!defaultPath) {
      const projectPath = atom.project.getPaths()[0];
      defaultPath = projectPath ? path.join(projectPath, "Untitled.ipynb") : "Untitled.ipynb";
    }
    return {
      defaultPath,
      filters: [{ name: "Jupyter Notebook", extensions: ["ipynb"] }],
    };
  }

  // Kernel management - delegate to document
  async connectToKernel(kernelSpec) {
    if (!this.document) return;
    return this.document.connectToKernel(kernelSpec);
  }

  async disconnectKernel() {
    if (!this.document) return;
    return this.document.disconnectKernel();
  }

  async restartKernel() {
    if (!this.document) return;
    return this.document.restartKernel();
  }

  async interruptKernel() {
    if (!this.document) return;
    return this.document.interruptKernel();
  }

  getKernel() {
    return this.document ? this.document.kernel : null;
  }

  // Cell operations
  getActiveCell() {
    if (!this.document) return null;
    return this.document.getCell(this.activeCellIndex);
  }

  setActiveCell(index) {
    if (!this.document) return;
    if (index >= 0 && index < this.document.getCellCount()) {
      this.activeCellIndex = index;
      this.updateView();
      this.emitter.emit("did-change-navigation");
    }
  }

  focusActiveCell() {
    if (this.view) {
      this.view.enterEditMode();
    }
  }

  focusActiveCellEditor() {
    if (this.view) {
      this.view.focusActiveCellEditor();
    }
  }

  async runCell() {
    if (!this.document) return;
    const selectedIndices = this.view ? this.view.getSelectedCells() : [];
    const indices = selectedIndices.length > 1 ? selectedIndices : [this.activeCellIndex];
    const shouldRefocusEditor = this.view && this.view.getMode() === "edit";

    for (const index of indices) {
      this.setActiveCell(index);
      try {
        const result = await this.document.executeCell(index);
        if (result === false || (result && result.status === "error")) break;
      } catch (error) {
        break;
      }
    }

    if (shouldRefocusEditor) {
      this.focusActiveCellEditor();
    }
  }

  async runCellAt(index) {
    if (!this.document) return;
    const shouldRefocusEditor = this.view && this.view.getMode() === "edit";
    try {
      await this.document.executeCell(index);
    } catch (error) {
      // Error already handled in document
    }

    if (shouldRefocusEditor) {
      this.focusActiveCellEditor();
    }
  }

  deleteCellAt(index) {
    if (!this.document) return;
    const cell = this.document.getCell(index);
    if (!cell) return;

    if (!this.cellUndoManager.isUndoingOrRedoing()) {
      this.cellUndoManager.pushOperation({
        type: "delete",
        data: {
          index,
          cell: cell.toJSON(),
          previousActiveIndex: this.activeCellIndex,
        },
      });
    }

    // Adjust active index so the same active cell stays active after deletion
    if (index < this.activeCellIndex) {
      this.activeCellIndex -= 1;
    } else if (index === this.activeCellIndex) {
      const newCount = this.document.getCellCount() - 1;
      this.activeCellIndex = Math.max(0, Math.min(this.activeCellIndex, newCount - 1));
    }

    this.document.deleteCell(index);
  }

  runCellAndMoveDown() {
    if (!this.document) return;

    const selectedIndices = this.view ? this.view.getSelectedCells() : [];
    const indices = selectedIndices.length > 1 ? selectedIndices : [this.activeCellIndex];
    const cellsToExecute = indices.map((index) => this.document.getCell(index)).filter(Boolean);
    const advanceFromIndex = indices[indices.length - 1];

    // Clear multi-cell selection before advancing
    if (this.view) this.view.clearSelection();

    // Advance immediately, before execution completes.
    if (advanceFromIndex < this.document.getCellCount() - 1) {
      this.setActiveCell(advanceFromIndex + 1);
    } else {
      // Insert new cell at end
      this.setActiveCell(advanceFromIndex);
      this.insertCellBelow();
    }

    // Only focus editor if we're in edit mode, otherwise just scroll to the cell
    if (this.view && this.view.getMode() === "edit") {
      this.focusActiveCellEditor();
    } else if (this.view) {
      this.view.scrollToCell(this.activeCellIndex);
    }

    this.executeCellsInBackground(cellsToExecute);
  }

  async executeCellsInBackground(cells) {
    const document = this.document;
    if (!document) return;

    for (const cell of cells) {
      if (this._destroyed || this.document !== document) break;

      const index = document.cells.indexOf(cell);
      if (index === -1) continue;

      try {
        const result = await document.executeCell(index);
        if (result === false || (result && result.status === "error")) break;
      } catch (error) {
        break;
      }
    }
  }

  async runAllCells() {
    if (!this.document) return;

    for (let i = 0; i < this.document.getCellCount(); i++) {
      this.setActiveCell(i);
      const cell = this.document.getCell(i);

      if (cell.type === "code") {
        try {
          const result = await this.document.executeCell(i);
          if (result === false || (result && result.status === "error")) break;
        } catch (error) {
          break;
        }
      }
    }
  }

  async runAllAbove() {
    if (!this.document) return;
    const currentIndex = this.activeCellIndex;

    for (let i = 0; i < currentIndex; i++) {
      this.setActiveCell(i);
      if (this.document.getCell(i).type === "code") {
        const result = await this.document.executeCell(i);
        if (result === false || (result && result.status === "error")) break;
      }
    }

    this.setActiveCell(currentIndex);
  }

  async runAllBelow() {
    if (!this.document) return;
    const startIndex = this.activeCellIndex;

    for (let i = startIndex; i < this.document.getCellCount(); i++) {
      this.setActiveCell(i);
      if (this.document.getCell(i).type === "code") {
        const result = await this.document.executeCell(i);
        if (result === false || (result && result.status === "error")) break;
      }
    }
  }

  clearOutput() {
    if (!this.document) return;
    this.document.clearCellOutput(this.activeCellIndex);
  }

  clearOutputAt(index) {
    if (!this.document) return;
    this.document.clearCellOutput(index);
  }

  clearAllOutputs() {
    if (!this.document) return;
    this.document.clearAllOutputs();
  }

  /**
   * Insert a new cell at the specified position
   * @param {string} position - 'above' or 'below'
   * @param {boolean} extendSelection - Whether to extend selection to include the new cell
   */
  _insertCell(position = "below", extendSelection = false) {
    if (!this.document) return;

    const isAbove = position === "above";
    const previousIndex = this.activeCellIndex;
    const insertIndex = isAbove ? this.activeCellIndex : this.activeCellIndex + 1;

    // Clear selection unless extending
    if (this.view && !extendSelection) {
      this.view.clearSelection();
    }

    // Record for undo (before the insert)
    if (!this.cellUndoManager.isUndoingOrRedoing()) {
      this.cellUndoManager.pushOperation({
        type: "insert",
        data: { index: insertIndex },
      });
    }

    this.document.insertCell(insertIndex, "code");

    // Update active cell index
    if (isAbove) {
      // Stay on the newly inserted cell
      this.activeCellIndex = insertIndex;
    } else {
      // Move to the newly inserted cell below
      this.activeCellIndex++;
    }

    this.updateView();

    // Extend selection if requested
    if (extendSelection && this.view) {
      if (isAbove) {
        this.view.extendSelection(insertIndex);
        this.view.extendSelection(previousIndex + 1);
      } else {
        this.view.extendSelection(previousIndex);
        this.view.extendSelection(insertIndex);
      }
    }
  }

  insertCellAbove() {
    this._insertCell("above", false);
  }
  insertCellBelow() {
    this._insertCell("below", false);
  }
  insertCellBelowAndEdit() {
    this._insertCell("below", false);
    if (this.view) {
      this.view.enterEditMode();
      this.focusActiveCellEditor();
    }
  }
  insertCellAboveAndExtendSelection() {
    this._insertCell("above", true);
  }
  insertCellBelowAndExtendSelection() {
    this._insertCell("below", true);
  }

  deleteCell() {
    if (!this.document) return;

    // Check if there are selected cells in the view
    const selectedIndices = this.view ? this.view.getSelectedCells() : [];

    // Clear selection before any delete operation
    if (this.view) {
      this.view.clearSelection();
    }

    if (selectedIndices.length > 1) {
      // Delete all selected cells - save cell data for undo
      if (!this.cellUndoManager.isUndoingOrRedoing()) {
        const cellsData = selectedIndices.map((i) => ({
          index: i,
          cell: this.document.getCell(i).toJSON(),
        }));
        this.cellUndoManager.pushOperation({
          type: "deleteMultiple",
          data: {
            cells: cellsData,
            previousActiveIndex: this.activeCellIndex,
          },
        });
      }

      this.document.deleteCells(selectedIndices);
      // Adjust active cell index
      const minDeleted = Math.min(...selectedIndices);
      this.activeCellIndex = Math.min(minDeleted, this.document.getCellCount() - 1);
      this.activeCellIndex = Math.max(0, this.activeCellIndex);
      this.updateView();
    } else {
      // Delete single active cell - save cell data for undo
      if (!this.cellUndoManager.isUndoingOrRedoing()) {
        const cell = this.document.getCell(this.activeCellIndex);
        this.cellUndoManager.pushOperation({
          type: "delete",
          data: {
            index: this.activeCellIndex,
            cell: cell.toJSON(),
            previousActiveIndex: this.activeCellIndex,
          },
        });
      }

      this.document.deleteCell(this.activeCellIndex);
    }
  }

  moveCellUp() {
    if (!this.document) return;

    const selectedIndices = this.view ? this.view.getSelectedCells() : [];

    if (selectedIndices.length > 1) {
      // Move multiple selected cells up
      const sortedIndices = [...selectedIndices].sort((a, b) => a - b);
      const minIndex = sortedIndices[0];

      // Can't move up if first selected cell is already at top
      if (minIndex === 0) return;

      const targetIndex = minIndex - 1;

      if (!this.cellUndoManager.isUndoingOrRedoing()) {
        this.cellUndoManager.pushOperation({
          type: "moveMultiple",
          data: {
            indices: sortedIndices,
            targetIndex,
            previousActiveIndex: this.activeCellIndex,
          },
        });
      }

      this.document.moveCells(sortedIndices, targetIndex);

      // Update selection to new positions
      const newIndices = sortedIndices.map((i) => i - 1);
      this.view.clearSelection();
      newIndices.forEach((i) => this.view.extendSelection(i));
      this.activeCellIndex = this.activeCellIndex - 1;
      this.updateView();
    } else {
      // Move single active cell up
      if (this.activeCellIndex > 0) {
        if (!this.cellUndoManager.isUndoingOrRedoing()) {
          this.cellUndoManager.pushOperation({
            type: "move",
            data: {
              fromIndex: this.activeCellIndex,
              toIndex: this.activeCellIndex - 1,
            },
          });
        }
        this.document.moveCell(this.activeCellIndex, this.activeCellIndex - 1);
      }
    }
  }

  moveCellDown() {
    if (!this.document) return;

    const selectedIndices = this.view ? this.view.getSelectedCells() : [];

    if (selectedIndices.length > 1) {
      // Move multiple selected cells down
      const sortedIndices = [...selectedIndices].sort((a, b) => a - b);
      const maxIndex = sortedIndices[sortedIndices.length - 1];

      // Can't move down if last selected cell is already at bottom
      if (maxIndex >= this.document.getCellCount() - 1) return;

      // Target is after the last selected cell + 1 (the cell below)
      const targetIndex = maxIndex + 2;

      if (!this.cellUndoManager.isUndoingOrRedoing()) {
        this.cellUndoManager.pushOperation({
          type: "moveMultiple",
          data: {
            indices: sortedIndices,
            targetIndex,
            previousActiveIndex: this.activeCellIndex,
          },
        });
      }

      this.document.moveCells(sortedIndices, targetIndex);

      // Update selection to new positions
      const newIndices = sortedIndices.map((i) => i + 1);
      this.view.clearSelection();
      newIndices.forEach((i) => this.view.extendSelection(i));
      this.activeCellIndex = this.activeCellIndex + 1;
      this.updateView();
    } else {
      // Move single active cell down
      if (this.activeCellIndex < this.document.getCellCount() - 1) {
        if (!this.cellUndoManager.isUndoingOrRedoing()) {
          this.cellUndoManager.pushOperation({
            type: "move",
            data: {
              fromIndex: this.activeCellIndex,
              toIndex: this.activeCellIndex + 1,
            },
          });
        }
        this.document.moveCell(this.activeCellIndex, this.activeCellIndex + 1);
      }
    }
  }

  moveCell(fromIndex, toIndex) {
    if (!this.document) return;
    if (!this.cellUndoManager.isUndoingOrRedoing()) {
      this.cellUndoManager.pushOperation({
        type: "move",
        data: { fromIndex, toIndex },
      });
    }
    this.document.moveCell(fromIndex, toIndex);
  }

  /**
   * Move multiple cells to a target position
   * @param {number[]} indices - Array of cell indices to move (must be sorted)
   * @param {number} targetIndex - Target position to move cells to
   */
  moveCells(indices, targetIndex) {
    if (!this.document) return;
    if (!this.cellUndoManager.isUndoingOrRedoing()) {
      this.cellUndoManager.pushOperation({
        type: "moveMultiple",
        data: {
          indices: [...indices],
          targetIndex,
          previousActiveIndex: this.activeCellIndex,
        },
      });
    }
    this.document.moveCells(indices, targetIndex);
  }

  /**
   * Delete multiple cells at specified indices
   * @param {number[]} indices - Array of cell indices to delete
   */
  deleteCells(indices) {
    if (!this.document) return;
    if (!this.cellUndoManager.isUndoingOrRedoing()) {
      const cellsData = indices.map((i) => ({
        index: i,
        cell: this.document.getCell(i).toJSON(),
      }));
      this.cellUndoManager.pushOperation({
        type: "deleteMultiple",
        data: {
          cells: cellsData,
          previousActiveIndex: this.activeCellIndex,
        },
      });
    }
    this.document.deleteCells(indices);
  }

  changeCellType(type) {
    if (!this.document) return;
    const cell = this.document.getCell(this.activeCellIndex);
    if (!cell) return;

    const previousType = cell.type;
    if (previousType === type) return;

    if (!this.cellUndoManager.isUndoingOrRedoing()) {
      this.cellUndoManager.pushOperation({
        type: "changeType",
        data: {
          index: this.activeCellIndex,
          previousType,
          newType: type,
        },
      });
    }
    this.document.changeCellType(this.activeCellIndex, type);
  }

  // Cut/Copy/Paste cell operations
  cutCell() {
    if (!this.document) return;

    const selectedIndices = this.view ? this.view.getSelectedCells() : [];
    const indicesToCut = selectedIndices.length > 0 ? selectedIndices : [this.activeCellIndex];

    // Copy cells to clipboard
    this.cellClipboard = indicesToCut.map((i) => this.document.getCell(i).toJSON());

    // Record for undo before deleting
    if (!this.cellUndoManager.isUndoingOrRedoing()) {
      const cellsData = indicesToCut.map((i) => ({
        index: i,
        cell: this.document.getCell(i).toJSON(),
      }));
      this.cellUndoManager.pushOperation({
        type: "cut",
        data: {
          cells: cellsData,
          previousActiveIndex: this.activeCellIndex,
        },
      });
    }

    // Clear selection before delete
    if (this.view) {
      this.view.clearSelection();
    }

    // Delete the cells
    if (indicesToCut.length > 1) {
      this.document.deleteCells(indicesToCut);
      const minDeleted = Math.min(...indicesToCut);
      this.activeCellIndex = Math.min(minDeleted, this.document.getCellCount() - 1);
      this.activeCellIndex = Math.max(0, this.activeCellIndex);
      this.updateView();
    } else {
      this.document.deleteCell(this.activeCellIndex);
    }
  }

  copyCell() {
    if (!this.document) return;

    const selectedIndices = this.view ? this.view.getSelectedCells() : [];
    const indicesToCopy = selectedIndices.length > 0 ? selectedIndices : [this.activeCellIndex];

    // Copy cells to clipboard
    this.cellClipboard = indicesToCopy.map((i) => this.document.getCell(i).toJSON());
  }

  pasteCellBelow() {
    if (!this.document || !this.cellClipboard || this.cellClipboard.length === 0) return;

    // Clear selection before pasting
    if (this.view) {
      this.view.clearSelection();
    }

    const insertIndex = this.activeCellIndex + 1;

    if (!this.cellUndoManager.isUndoingOrRedoing()) {
      this.cellUndoManager.pushOperation({
        type: "paste",
        data: {
          index: insertIndex,
          count: this.cellClipboard.length,
          previousActiveIndex: this.activeCellIndex,
        },
      });
    }

    // Insert cells from clipboard and activate the first pasted cell
    this._insertCellsFromData(insertIndex, this.cellClipboard);
    this.activeCellIndex = insertIndex;
    this.updateView();
  }

  pasteCellAbove() {
    if (!this.document || !this.cellClipboard || this.cellClipboard.length === 0) return;

    // Clear selection before pasting
    if (this.view) {
      this.view.clearSelection();
    }

    const insertIndex = this.activeCellIndex;

    if (!this.cellUndoManager.isUndoingOrRedoing()) {
      this.cellUndoManager.pushOperation({
        type: "paste",
        data: {
          index: insertIndex,
          count: this.cellClipboard.length,
          previousActiveIndex: this.activeCellIndex,
        },
      });
    }

    // Insert cells from clipboard and activate the first pasted cell
    this._insertCellsFromData(insertIndex, this.cellClipboard);
    this.activeCellIndex = insertIndex;
    this.updateView();
  }

  /**
   * Duplicate the active cell (or selected cells) below
   */
  duplicateCell() {
    if (!this.document) return;

    // Get selected indices BEFORE clearing selection
    const selectedIndices = this.view ? this.view.getSelectedCells() : [];
    const indicesToDuplicate =
      selectedIndices.length > 0 ? selectedIndices : [this.activeCellIndex];

    // Now clear selection
    if (this.view) {
      this.view.clearSelection();
    }

    // Get cell data to duplicate
    const cellsData = indicesToDuplicate.map((i) => this.document.getCell(i).toJSON());

    // Insert after the last selected cell
    const insertIndex = Math.max(...indicesToDuplicate) + 1;

    if (!this.cellUndoManager.isUndoingOrRedoing()) {
      this.cellUndoManager.pushOperation({
        type: "duplicate",
        data: {
          index: insertIndex,
          count: cellsData.length,
          cellsData: cellsData, // Store for redo
          previousActiveIndex: this.activeCellIndex,
        },
      });
    }

    // Insert duplicated cells and activate the first duplicated cell
    this._insertCellsFromData(insertIndex, cellsData);
    this.activeCellIndex = insertIndex;
    this.updateView();
  }

  /**
   * Insert cells from JSON data at specified index
   * @private
   */
  _insertCellsFromData(startIndex, cellsData) {
    const { v4: uuidv4 } = require("uuid");
    const CellModel = require("./cell-model");

    for (let i = 0; i < cellsData.length; i++) {
      const cellData = cellsData[i];
      const newCell = new CellModel({
        id: uuidv4(),
        type: cellData.cell_type || "code",
        source: Array.isArray(cellData.source) ? cellData.source.join("") : cellData.source || "",
        outputs: cellData.outputs || [],
        executionCount: null, // Reset execution count for pasted cells
        metadata: cellData.metadata || {},
      });

      this.document.cells.splice(startIndex + i, 0, newCell);
    }

    this.activeCellIndex = startIndex;
    this.document.setModified(true);
    this.document.emitter.emit("did-change");
    this.updateView();
  }

  // Undo/Redo operations
  undoCellOperation() {
    if (!this.document) return;
    this.flushPendingCellSourceChanges();
    if (!this.cellUndoManager.canUndo()) return;

    const operation = this.cellUndoManager.popUndo();
    if (!operation) return;

    try {
      this._applyUndoOperation(operation);
      // Check if undo returned to saved state
      this.document.updateModifiedState();
    } finally {
      this.cellUndoManager.finishUndoRedo();
    }
  }

  redoCellOperation() {
    if (!this.document) return;
    this.flushPendingCellSourceChanges();
    if (!this.cellUndoManager.canRedo()) return;

    const operation = this.cellUndoManager.popRedo();
    if (!operation) return;

    try {
      this._applyRedoOperation(operation);
      // Check if redo changed from saved state
      this.document.updateModifiedState();
    } finally {
      this.cellUndoManager.finishUndoRedo();
    }
  }

  /**
   * Apply an undo operation (reverse the original operation)
   * @private
   */
  _applyUndoOperation(operation) {
    const { type, data } = operation;

    switch (type) {
      case "source":
        this._restoreCellSource(data, data.previousSource);
        break;

      case "insert":
        // Undo insert = delete the inserted cell
        this.document.deleteCell(data.index);
        break;

      case "delete":
        // Undo delete = restore the cell
        this._restoreCell(data.index, data.cell);
        this.activeCellIndex = data.previousActiveIndex;
        this.updateView();
        break;

      case "deleteMultiple":
      case "cut": {
        // Undo delete multiple = restore all cells in order
        // Sort by index ascending to restore in correct order
        const sortedCells = [...data.cells].sort((a, b) => a.index - b.index);
        for (const cellInfo of sortedCells) {
          this._restoreCell(cellInfo.index, cellInfo.cell);
        }
        this.activeCellIndex = data.previousActiveIndex;
        this.updateView();
        break;
      }

      case "move":
        // Undo move = move back
        this.document.moveCell(data.toIndex, data.fromIndex);
        break;

      case "moveMultiple":
        // Undo move multiple is complex - for now just note it
        // TODO: implement proper reverse for multi-cell moves
        break;

      case "changeType":
        // Undo change type = change back to previous type
        this.document.changeCellType(data.index, data.previousType);
        break;

      case "paste":
      case "duplicate": {
        // Undo paste/duplicate = delete the inserted cells
        const indicesToDelete = [];
        for (let i = 0; i < data.count; i++) {
          indicesToDelete.push(data.index + i);
        }
        this.document.deleteCells(indicesToDelete);
        this.activeCellIndex = data.previousActiveIndex;
        this.updateView();
        break;
      }

      case "merge":
        // Undo merge = restore original cells
        // Delete merged cell and restore originals
        this.document.deleteCell(data.index);
        this._restoreCell(data.index, data.firstCell);
        this._restoreCell(data.index + 1, data.secondCell);
        this.activeCellIndex = data.previousActiveIndex;
        this.updateView();
        break;
    }
  }

  /**
   * Apply a redo operation (re-apply the original operation)
   * @private
   */
  _applyRedoOperation(operation) {
    const { type, data } = operation;

    switch (type) {
      case "source":
        this._restoreCellSource(data, data.newSource);
        break;

      case "insert":
        // Redo insert = insert cell again
        this.document.insertCell(data.index, "code");
        break;

      case "delete":
        // Redo delete = delete the cell again
        this.document.deleteCell(data.index);
        break;

      case "deleteMultiple":
      case "cut": {
        // Redo delete multiple = delete cells again
        const indicesToDelete = data.cells.map((c) => c.index);
        this.document.deleteCells(indicesToDelete);
        break;
      }

      case "move":
        // Redo move = move again
        this.document.moveCell(data.fromIndex, data.toIndex);
        break;

      case "moveMultiple":
        // Redo move multiple
        this.document.moveCells(data.indices, data.targetIndex);
        break;

      case "changeType":
        // Redo change type = change to new type
        this.document.changeCellType(data.index, data.newType);
        break;

      case "paste":
        // Redo paste - need clipboard data, skip for now
        break;

      case "duplicate":
        // Redo duplicate - re-insert the duplicated cells
        if (data.cellsData) {
          this._insertCellsFromData(data.index, data.cellsData);
        }
        break;

      case "merge":
        // Redo merge = merge again
        this.mergeCellBelow();
        break;
    }
  }

  /**
   * Restore a cell from JSON data at specified index
   * @private
   */
  _restoreCell(index, cellData) {
    const { v4: uuidv4 } = require("uuid");
    const CellModel = require("./cell-model");

    const newCell = new CellModel({
      id: cellData.id || uuidv4(),
      type: cellData.cell_type || "code",
      source: Array.isArray(cellData.source) ? cellData.source.join("") : cellData.source || "",
      outputs: cellData.outputs || [],
      executionCount: cellData.execution_count,
      metadata: cellData.metadata || {},
    });

    this.document.cells.splice(index, 0, newCell);
    this.document.setModified(true);
    this.document.emitter.emit("did-change");
  }

  /**
   * Restore a cell's source as part of notebook undo/redo.
   * Prefer the stable cell id so source edits still target the same cell after moves.
   * @private
   */
  _restoreCellSource(data, source) {
    const index = this._findCellIndex(data.cellId, data.index);
    if (index === -1) return;

    this.document.updateCellSource(index, source);
    this.activeCellIndex = index;
    this.updateView();
  }

  _findCellIndex(cellId, fallbackIndex = -1) {
    if (!this.document) return -1;

    if (cellId) {
      const idIndex = this.document.cells.findIndex((cell) => cell.id === cellId);
      if (idIndex !== -1) return idIndex;
    }

    if (fallbackIndex >= 0 && fallbackIndex < this.document.getCellCount()) {
      return fallbackIndex;
    }

    return -1;
  }

  /**
   * Merge the active cell with the cell below
   */
  mergeCellBelow() {
    if (!this.document) return;
    if (this.activeCellIndex >= this.document.getCellCount() - 1) return;

    const firstCell = this.document.getCell(this.activeCellIndex);
    const secondCell = this.document.getCell(this.activeCellIndex + 1);

    if (!firstCell || !secondCell) return;

    // Record for undo
    if (!this.cellUndoManager.isUndoingOrRedoing()) {
      this.cellUndoManager.pushOperation({
        type: "merge",
        data: {
          index: this.activeCellIndex,
          firstCell: firstCell.toJSON(),
          secondCell: secondCell.toJSON(),
          previousActiveIndex: this.activeCellIndex,
        },
      });
    }

    // Merge sources with newline
    const mergedSource = firstCell.source + "\n" + secondCell.source;

    // Update first cell
    this.document.updateCellSource(this.activeCellIndex, mergedSource);

    // Delete second cell
    this.document.deleteCell(this.activeCellIndex + 1);
  }

  toggleCellOutput() {
    if (!this.document) return;
    this.document.toggleCellOutput(this.activeCellIndex);
  }

  toggleCellInput() {
    if (!this.document) return;

    // Get the cell and toggle its visibility
    const cell = this.document.getCell(this.activeCellIndex);
    if (!cell) return;

    // Toggle the model state
    cell.inputVisible = !cell.inputVisible;

    // Immediately update the DOM for instant feedback
    if (this.view) {
      const cellView = this.view.cellViews.get(cell.id);
      if (cellView && cellView.element) {
        const inputArea = cellView.element.querySelector(".cell-input");
        if (inputArea) {
          inputArea.style.display = cell.inputVisible ? "" : "none";
        }
      }
    }

    // Mark document as modified
    this.document.setModified(true);
  }

  updateCellSource(index, source) {
    if (!this.document) return;
    const cell = this.document.getCell(index);
    if (!cell) return;

    const previousSource = cell.source;
    if (previousSource === source) return;

    if (!this.cellUndoManager.isUndoingOrRedoing()) {
      this.cellUndoManager.pushOperation({
        type: "source",
        data: {
          index,
          cellId: cell.id,
          previousSource,
          newSource: source,
          previousActiveIndex: this.activeCellIndex,
        },
      });
    }

    this.document.updateCellSource(index, source);
  }

  flushPendingCellSourceChanges() {
    if (!this.document || !this.view || !this.view.cellViews) return;

    for (const [cellId, cellView] of this.view.cellViews) {
      if (!cellView || !cellView.editor) continue;

      const index = this._findCellIndex(cellId);
      if (index === -1) continue;

      const cell = this.document.getCell(index);
      if (!cell) continue;

      const source = cellView.editor.getText();
      if (source !== cell.source) {
        this.updateCellSource(index, source);
      }
    }
  }

  // Export functions
  async exportToPython() {
    if (!this.document) return;
    const lines = [];
    const File = require("atom").File;

    lines.push("#!/usr/bin/env python");
    lines.push("# -*- coding: utf-8 -*-");
    lines.push("");
    lines.push(`# Exported from: ${this.getTitle()}`);
    lines.push("");

    for (let i = 0; i < this.document.getCellCount(); i++) {
      const cell = this.document.getCell(i);
      if (cell.type === "code") {
        lines.push(`# In[${cell.executionCount || i + 1}]:`);
        lines.push(cell.source);
        lines.push("");
      } else if (cell.type === "markdown") {
        lines.push("# " + cell.source.split("\n").join("\n# "));
        lines.push("");
      }
    }

    const content = lines.join("\n");
    const defaultPath = this.document.filePath
      ? this.document.filePath.replace(".ipynb", ".py")
      : "Untitled.py";

    const newPath = atom.showSaveDialogSync({
      defaultPath,
      filters: [{ name: "Python", extensions: ["py"] }],
    });

    if (newPath) {
      const file = new File(newPath);
      await file.write(content);
      atom.notifications.addSuccess(`Exported to ${path.basename(newPath)}`);
    }
  }

  async exportToHtml() {
    if (!this.document) return;
    const File = require("atom").File;
    const lines = [];

    lines.push("<!DOCTYPE html>");
    lines.push("<html><head>");
    lines.push('<meta charset="utf-8">');
    lines.push(`<title>${this.getTitle()}</title>`);
    lines.push("<style>");
    lines.push(
      "body { font-family: sans-serif; max-width: 900px; margin: 0 auto; padding: 20px; }",
    );
    lines.push(".cell { margin: 10px 0; border: 1px solid #ddd; border-radius: 4px; }");
    lines.push(
      ".cell-code { background: #f5f5f5; padding: 10px; font-family: monospace; white-space: pre-wrap; }",
    );
    lines.push(".cell-markdown { padding: 10px; }");
    lines.push(".cell-output { padding: 10px; border-top: 1px solid #ddd; background: #fff; }");
    lines.push(".execution-count { color: #888; font-size: 12px; padding: 5px 10px; }");
    lines.push("</style>");
    lines.push("</head><body>");
    lines.push(`<h1>${this.getTitle()}</h1>`);

    for (let i = 0; i < this.document.getCellCount(); i++) {
      const cell = this.document.getCell(i);
      lines.push('<div class="cell">');

      if (cell.type === "code") {
        if (cell.executionCount) {
          lines.push(`<div class="execution-count">In [${cell.executionCount}]:</div>`);
        }
        lines.push(`<div class="cell-code">${this.escapeHtml(cell.source)}</div>`);

        if (cell.outputs && cell.outputs.length > 0) {
          lines.push('<div class="cell-output">');
          cell.outputs.forEach((output) => {
            if (output.text) {
              lines.push(
                `<pre>${this.escapeHtml(
                  Array.isArray(output.text) ? output.text.join("") : output.text,
                )}</pre>`,
              );
            } else if (output.data) {
              if (output.data["text/html"]) {
                lines.push(
                  Array.isArray(output.data["text/html"])
                    ? output.data["text/html"].join("")
                    : output.data["text/html"],
                );
              } else if (output.data["text/plain"]) {
                lines.push(
                  `<pre>${this.escapeHtml(
                    Array.isArray(output.data["text/plain"])
                      ? output.data["text/plain"].join("")
                      : output.data["text/plain"],
                  )}</pre>`,
                );
              }
            }
          });
          lines.push("</div>");
        }
      } else if (cell.type === "markdown") {
        lines.push(`<div class="cell-markdown">${cell.source}</div>`);
      }

      lines.push("</div>");
    }

    lines.push("</body></html>");

    const content = lines.join("\n");
    const defaultPath = this.document.filePath
      ? this.document.filePath.replace(".ipynb", ".html")
      : "Untitled.html";

    const newPath = atom.showSaveDialogSync({
      defaultPath,
      filters: [{ name: "HTML", extensions: ["html"] }],
    });

    if (newPath) {
      const file = new File(newPath);
      await file.write(content);
      atom.notifications.addSuccess(`Exported to ${path.basename(newPath)}`);
    }
  }

  escapeHtml(text) {
    const map = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    };
    return text.replace(/[&<>"']/g, (m) => map[m]);
  }

  // Selection adjustment helpers
  // These adjust the view's selectedCells Set when cells are inserted/deleted/moved

  /**
   * Adjust selection indices when a cell is inserted
   * @private
   */
  _adjustSelectionForInsert(insertIndex) {
    if (!this.view || this.view.selectedCells.size === 0) return;

    const newSelection = new Set();
    for (const selectedIndex of this.view.selectedCells) {
      if (insertIndex <= selectedIndex) {
        newSelection.add(selectedIndex + 1);
      } else {
        newSelection.add(selectedIndex);
      }
    }
    this.view.selectedCells = newSelection;
  }

  /**
   * Adjust selection indices when a cell is deleted
   * @private
   */
  _adjustSelectionForDelete(deletedIndex) {
    if (!this.view || this.view.selectedCells.size === 0) return;

    const newSelection = new Set();
    for (const selectedIndex of this.view.selectedCells) {
      if (selectedIndex < deletedIndex) {
        newSelection.add(selectedIndex);
      } else if (selectedIndex > deletedIndex) {
        newSelection.add(selectedIndex - 1);
      }
      // Deleted index is simply not added to newSelection
    }
    this.view.selectedCells = newSelection;
  }

  /**
   * Adjust selection indices when a cell is moved
   * @private
   */
  _adjustSelectionForMove(fromIndex, toIndex) {
    if (!this.view || this.view.selectedCells.size === 0) return;

    const newSelection = new Set();
    for (const selectedIndex of this.view.selectedCells) {
      if (selectedIndex === fromIndex) {
        // The moved cell
        newSelection.add(toIndex);
      } else if (fromIndex < toIndex) {
        // Moving down: indices between fromIndex and toIndex shift up by 1
        if (selectedIndex > fromIndex && selectedIndex <= toIndex) {
          newSelection.add(selectedIndex - 1);
        } else {
          newSelection.add(selectedIndex);
        }
      } else {
        // Moving up: indices between toIndex and fromIndex shift down by 1
        if (selectedIndex >= toIndex && selectedIndex < fromIndex) {
          newSelection.add(selectedIndex + 1);
        } else {
          newSelection.add(selectedIndex);
        }
      }
    }
    this.view.selectedCells = newSelection;
  }

  // Event handlers
  onDidChange(callback) {
    return this.emitter.on("did-change", callback);
  }

  onDidSave(callback) {
    return this.emitter.on("did-save", callback);
  }

  onDidDestroy(callback) {
    return this.emitter.on("did-destroy", callback);
  }

  onDidChangeTitle(callback) {
    return this.emitter.on("did-change-title", callback);
  }

  onDidConnectKernel(callback) {
    return this.emitter.on("did-connect-kernel", callback);
  }

  onDidDisconnectKernel(callback) {
    return this.emitter.on("did-disconnect-kernel", callback);
  }

  onDidChangeKernelStatus(callback) {
    return this.emitter.on("did-change-kernel-status", callback);
  }

  // Pulsar pane item interface - required for tabs to show modified indicator
  onDidChangeModified(callback) {
    return this.emitter.on("did-change-modified", callback);
  }

  destroy() {
    this._destroyed = true;

    if (this.disposables) {
      this.disposables.dispose();
    }

    if (this.emitter) {
      this.emitter.emit("did-destroy");
      this.emitter.dispose();
    }

    if (this.view) {
      this.view.destroy();
    }

    // Clean up container element
    if (this._containerElement) {
      this._containerElement.innerHTML = "";
      if (this._containerElement.parentNode) {
        this._containerElement.parentNode.removeChild(this._containerElement);
      }
    }
    this._containerElement = null;

    // Release reference to document
    if (this.document) {
      this.document.release();
    }
  }
}

function buildNavigationTree(headings, activeCellIndex, visibleCellIndexes) {
  const headers = [];
  const stack = [];
  let lastItem = null;
  const visibleCells = new Set(visibleCellIndexes);

  headings.forEach((heading, index) => {
    const current = heading.cellIndex === activeCellIndex;
    const item = {
      ...heading,
      children: [],
      startPoint: { row: index, column: 0 },
      endPoint: { row: index, column: 0 },
      lastRow: headings.length,
      currentCount: current ? 1 : 0,
      stackCount: current ? 1 : 0,
      visibility: visibleCells.has(heading.cellIndex) ? 1 : 0,
    };

    while (stack.length && stack[stack.length - 1].level >= item.level) {
      stack.pop();
    }

    if (stack.length) {
      stack[stack.length - 1].children.push(item);
    } else {
      headers.push(item);
    }

    stack.push(item);
    if (lastItem) lastItem.lastRow = item.startPoint.row - 1;
    lastItem = item;
  });

  markCurrentAncestors(headers);
  return headers;
}

function markCurrentAncestors(items) {
  let hasCurrent = false;
  for (const item of items) {
    const childCurrent = markCurrentAncestors(item.children);
    if (item.currentCount || childCurrent) {
      item.stackCount = 1;
      hasCurrent = true;
    }
  }
  return hasCurrent;
}

module.exports = JupyterNotebookEditor;
