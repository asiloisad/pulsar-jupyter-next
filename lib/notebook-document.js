const { Emitter, CompositeDisposable, File } = require("atom");
const { v4: uuidv4 } = require("uuid");

// Lazy load components
let CellModel = null;

function getCellModel() {
  if (!CellModel) {
    CellModel = require("./cell-model");
  }
  return CellModel;
}

/**
 * NotebookDocument represents the shared data model for a Jupyter notebook.
 * Multiple editors can view/edit the same document (like Pulsar's TextBuffer).
 */
class NotebookDocument {
  constructor(filePath, kernelManager) {
    this.filePath = filePath;
    this.kernelManager = kernelManager;
    this.emitter = new Emitter();
    this.disposables = new CompositeDisposable();
    this.refCount = 0;

    // Notebook data
    this.cells = [];
    this.metadata = {};
    this.modified = false;
    this.kernel = null;
    this.executionCount = 0;

    // Notebook format info
    this.nbformat = 4;
    this.nbformat_minor = 5;

    // Saved content hash for detecting when undo returns to saved state
    this._savedContentHash = null;

    // File watcher
    this.file = filePath ? new File(filePath) : null;

    // Kernel disposables
    this.kernelDisposables = null;
  }

  retain() {
    this.refCount++;
    return this;
  }

  release() {
    this.refCount--;
    if (this.refCount <= 0) {
      this.destroy();
    }
  }

  async load() {
    if (!this.filePath) {
      await this.initialize();
      return;
    }

    try {
      const content = await this.file.read();
      const notebook = JSON.parse(content);

      this.nbformat = notebook.nbformat || 4;
      this.nbformat_minor = notebook.nbformat_minor || 5;
      this.metadata = notebook.metadata || {};

      // Load cells
      const CellModelClass = getCellModel();
      this.cells = (notebook.cells || []).map((cellData) => {
        return new CellModelClass({
          id: cellData.id || uuidv4(),
          type: cellData.cell_type || "code",
          source: Array.isArray(cellData.source)
            ? cellData.source.join("")
            : cellData.source || "",
          outputs: cellData.outputs || [],
          executionCount: cellData.execution_count,
          metadata: cellData.metadata || {},
        });
      });

      // Ensure at least one cell
      if (this.cells.length === 0) {
        this.cells.push(
          new CellModelClass({
            id: uuidv4(),
            type: "code",
            source: "",
            outputs: [],
            executionCount: null,
            metadata: {},
          })
        );
      }

      this.setModified(false);
      this._updateSavedContentHash();
      this.emitter.emit("did-load");
    } catch (error) {
      atom.notifications.addError("Failed to load notebook", {
        detail: error.message,
        dismissable: true,
      });
      await this.initialize();
    }
  }

  async initialize() {
    const CellModelClass = getCellModel();

    this.metadata = {
      kernelspec: {
        display_name: "Python 3",
        language: "python",
        name: "python3",
      },
      language_info: {
        name: "python",
        version: "3.x",
      },
    };

    this.cells = [
      new CellModelClass({
        id: uuidv4(),
        type: "code",
        source: "",
        outputs: [],
        executionCount: null,
        metadata: {},
      }),
    ];

    // New untitled notebooks are modified (need saving)
    // Loaded notebooks from files start as unmodified
    this.setModified(!this.filePath);
    this._updateSavedContentHash();
    this.emitter.emit("did-load");
  }

  /**
   * Initialize from serialized notebook data (for restoring unsaved notebooks)
   */
  async initializeFromData(notebookData) {
    const CellModelClass = getCellModel();

    this.nbformat = notebookData.nbformat || 4;
    this.nbformat_minor = notebookData.nbformat_minor || 5;
    this.metadata = notebookData.metadata || {};

    // Load cells from serialized data
    this.cells = (notebookData.cells || []).map((cellData) => {
      return new CellModelClass({
        id: cellData.id || uuidv4(),
        type: cellData.cell_type || "code",
        source: Array.isArray(cellData.source)
          ? cellData.source.join("")
          : cellData.source || "",
        outputs: cellData.outputs || [],
        executionCount: cellData.execution_count,
        metadata: cellData.metadata || {},
      });
    });

    // Ensure at least one cell
    if (this.cells.length === 0) {
      this.cells.push(
        new CellModelClass({
          id: uuidv4(),
          type: "code",
          source: "",
          outputs: [],
          executionCount: null,
          metadata: {},
        })
      );
    }

    // Mark as modified since it's unsaved
    this.setModified(true);
    this.emitter.emit("did-load");
  }

  // Save functionality
  async save() {
    if (!this.filePath || !this.file) {
      return false;
    }

    try {
      const content = this.toJSON();
      await this.file.write(JSON.stringify(content, null, 2));
      this.setModified(false);
      this._updateSavedContentHash();
      this.emitter.emit("did-save");
      return true;
    } catch (error) {
      atom.notifications.addError("Failed to save notebook", {
        detail: error.message,
        dismissable: true,
      });
      return false;
    }
  }

  setPath(newPath) {
    this.filePath = newPath;
    this.file = new File(newPath);
    this.emitter.emit("did-change-path", newPath);
  }

  toJSON() {
    return {
      nbformat: this.nbformat,
      nbformat_minor: this.nbformat_minor,
      metadata: this.metadata,
      cells: this.cells.map((cell) => cell.toJSON()),
    };
  }

  // Kernel management
  async connectToKernel(kernelSpec) {
    try {
      if (this.kernel) {
        await this.disconnectKernel();
      }

      // Pass notebook's filePath so kernel cwd respects hydrogen-next.startDir config
      this.kernel = await this.kernelManager.getOrStartKernel(
        kernelSpec.name || kernelSpec,
        this.filePath
      );

      // Subscribe to kernel events
      this.kernelDisposables = new CompositeDisposable();
      this.kernelDisposables.add(
        this.kernel.onDidChangeStatus((status) => {
          this.emitter.emit("did-change-kernel-status", status);
        })
      );

      // Update metadata
      this.metadata.kernelspec = {
        display_name: this.kernel.displayName,
        language: this.kernel.language,
        name: this.kernel.name,
      };

      this.emitter.emit("did-connect-kernel", this.kernel);
      // No notification - the UI (toolbar kernel indicator) is sufficient
    } catch (error) {
      atom.notifications.addError("Failed to connect to kernel", {
        detail: error.message,
        dismissable: true,
      });
      throw error;
    }
  }

  async disconnectKernel() {
    if (this.kernel) {
      if (this.kernelDisposables) {
        this.kernelDisposables.dispose();
        this.kernelDisposables = null;
      }

      this.kernel = null;
      this.emitter.emit("did-disconnect-kernel");
    }
  }

  async restartKernel() {
    if (this.kernel) {
      await this.kernel.restart();
      this.executionCount = 0;
      atom.notifications.addInfo("Kernel restarted");
    }
  }

  async interruptKernel() {
    if (this.kernel) {
      await this.kernel.interrupt();
    }
  }

  /**
   * Request kernel connection using the kernel picker.
   * Respects hydrogen-next.autoKernelPicker setting.
   */
  async requestKernelConnection() {
    const KernelPicker = require("./kernel-picker");

    // Get preferred kernel and language from notebook metadata
    const preferredKernelName = this.metadata?.kernelspec?.name || null;
    const language =
      this.metadata?.kernelspec?.language ||
      this.metadata?.language_info?.name ||
      null;

    const picker = new KernelPicker(this.kernelManager, {
      preferredKernelName,
      language,
    });
    return picker.show();
  }

  // Cell operations
  getCell(index) {
    return this.cells[index];
  }

  getCellCount() {
    return this.cells.length;
  }

  async executeCell(index, callbacks = {}) {
    const cell = this.cells[index];
    if (!cell || cell.type !== "code") return;

    // Request kernel connection if not connected
    if (!this.kernel) {
      // Emit event to request kernel - the editor/main will handle showing the picker
      const kernelSpec = await this.requestKernelConnection();
      if (!kernelSpec) {
        // User cancelled kernel selection
        return;
      }
      await this.connectToKernel(kernelSpec);
    }

    if (atom.config.get("jupyter-next.clearOutputBeforeRun")) {
      cell.clearOutputs();
    }

    cell.setRunning(true);
    this.emitter.emit("did-change");

    try {
      this.executionCount++;
      const result = await this.kernel.execute(cell.source, {
        onOutput: (output) => {
          cell.addOutput(output);
          this.emitter.emit("did-change");
          if (callbacks.onOutput) callbacks.onOutput(output);
        },
        onStatus: (status) => {
          cell.setStatus(status);
          this.emitter.emit("did-change");
          if (callbacks.onStatus) callbacks.onStatus(status);
        },
      });

      cell.setExecutionCount(this.executionCount);
      cell.setRunning(false);
      this.setModified(true);
      this.emitter.emit("did-change");

      return result;
    } catch (error) {
      cell.addOutput({
        output_type: "error",
        ename: error.name || "Error",
        evalue: error.message,
        traceback: error.traceback || [error.stack || error.message],
      });
      cell.setRunning(false);
      this.emitter.emit("did-change");
      throw error;
    }
  }

  clearCellOutput(index) {
    const cell = this.cells[index];
    if (cell) {
      cell.clearOutputs();
      this.setModified(true);
      this.emitter.emit("did-change");
    }
  }

  clearAllOutputs() {
    this.cells.forEach((cell) => cell.clearOutputs());
    this.setModified(true);
    this.emitter.emit("did-change");
  }

  insertCell(index, type = "code") {
    const CellModelClass = getCellModel();
    const newCell = new CellModelClass({
      id: uuidv4(),
      type: type,
      source: "",
      outputs: [],
      executionCount: null,
      metadata: {},
    });

    this.cells.splice(index, 0, newCell);
    this.setModified(true);
    this.emitter.emit("did-change");
    this.emitter.emit("did-insert-cell", { index, cell: newCell });

    return newCell;
  }

  deleteCell(index) {
    if (this.cells.length <= 1) {
      // Don't delete the last cell, just clear it
      const cell = this.cells[0];
      cell.source = "";
      cell.clearOutputs();
    } else {
      this.cells.splice(index, 1);
    }

    this.setModified(true);
    this.emitter.emit("did-change");
    this.emitter.emit("did-delete-cell", { index });
  }

  /**
   * Delete multiple cells at specified indices
   * @param {number[]} indices - Array of cell indices to delete
   */
  deleteCells(indices) {
    if (!indices || indices.length === 0) return;

    // Sort indices in descending order to delete from end first
    // This preserves correct indices as we delete
    const sortedIndices = [...indices].sort((a, b) => b - a);

    // Validate indices
    for (const i of sortedIndices) {
      if (i < 0 || i >= this.cells.length) return;
    }

    // If trying to delete all cells, clear the first one instead
    if (sortedIndices.length >= this.cells.length) {
      const cell = this.cells[0];
      cell.source = "";
      cell.clearOutputs();
      // Remove all cells except the first
      this.cells.splice(1);
    } else {
      // Delete cells from highest index to lowest
      for (const index of sortedIndices) {
        this.cells.splice(index, 1);
      }
    }

    this.setModified(true);
    this.emitter.emit("did-change");
    this.emitter.emit("did-delete-cells", { indices: sortedIndices });
  }

  moveCell(fromIndex, toIndex) {
    if (fromIndex < 0 || fromIndex >= this.cells.length) return;
    if (toIndex < 0 || toIndex >= this.cells.length) return;
    if (fromIndex === toIndex) return;

    const cell = this.cells.splice(fromIndex, 1)[0];
    this.cells.splice(toIndex, 0, cell);

    this.setModified(true);
    this.emitter.emit("did-change");
    this.emitter.emit("did-move-cell", { fromIndex, toIndex });
  }

  /**
   * Move multiple cells to a target position
   * @param {number[]} indices - Array of cell indices to move (should be sorted)
   * @param {number} targetIndex - Target position to move cells to
   */
  moveCells(indices, targetIndex) {
    if (!indices || indices.length === 0) return;

    // Sort indices to process correctly
    const sortedIndices = [...indices].sort((a, b) => a - b);

    // Validate indices
    for (const i of sortedIndices) {
      if (i < 0 || i >= this.cells.length) return;
    }

    // Extract cells to move (in order)
    const cellsToMove = sortedIndices.map((i) => this.cells[i]);

    // Calculate how many cells before target will be removed
    const cellsBeforeTarget = sortedIndices.filter((i) => i < targetIndex)
      .length;

    // Remove cells from highest index to lowest to preserve indices
    for (let i = sortedIndices.length - 1; i >= 0; i--) {
      this.cells.splice(sortedIndices[i], 1);
    }

    // Adjust target index based on removed cells
    const adjustedTarget = targetIndex - cellsBeforeTarget;

    // Insert cells at target position
    this.cells.splice(adjustedTarget, 0, ...cellsToMove);

    this.setModified(true);
    this.emitter.emit("did-change");
    this.emitter.emit("did-move-cells", {
      indices: sortedIndices,
      targetIndex: adjustedTarget,
    });
  }

  updateCellSource(index, source) {
    if (index >= 0 && index < this.cells.length) {
      const cell = this.cells[index];
      // Only process if the source actually changed
      if (cell.source !== source) {
        cell.source = source;
        // Check if content matches saved state (handles undo back to original)
        this.updateModifiedState();
        this.emitter.emit("did-change");
      }
    }
  }

  changeCellType(index, type) {
    const cell = this.cells[index];
    if (cell) {
      cell.setType(type);
      this.setModified(true);
      this.emitter.emit("did-change");
    }
  }

  toggleCellOutput(index) {
    const cell = this.cells[index];
    if (cell) {
      cell.toggleOutputVisibility();
      this.emitter.emit("did-change");
    }
  }

  toggleCellInput(index) {
    const cell = this.cells[index];
    if (cell) {
      cell.toggleInputVisibility();
      this.emitter.emit("did-change");
    }
  }

  // Event handlers
  onDidChange(callback) {
    return this.emitter.on("did-change", callback);
  }

  onDidLoad(callback) {
    return this.emitter.on("did-load", callback);
  }

  onDidSave(callback) {
    return this.emitter.on("did-save", callback);
  }

  onDidChangePath(callback) {
    return this.emitter.on("did-change-path", callback);
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

  onDidInsertCell(callback) {
    return this.emitter.on("did-insert-cell", callback);
  }

  onDidDeleteCell(callback) {
    return this.emitter.on("did-delete-cell", callback);
  }

  onDidDeleteCells(callback) {
    return this.emitter.on("did-delete-cells", callback);
  }

  onDidMoveCell(callback) {
    return this.emitter.on("did-move-cell", callback);
  }

  isModified() {
    return this.modified;
  }

  setModified(modified) {
    if (this.modified !== modified) {
      this.modified = modified;
      this.emitter.emit("did-change-modified", modified);
    }
  }

  /**
   * Compute a hash of the current notebook content for comparison.
   * Used to detect when undo returns to saved state.
   */
  _computeContentHash() {
    // Create a simple hash based on cell content
    const content = this.cells.map(cell => {
      return `${cell.type}:${cell.source}:${JSON.stringify(cell.outputs)}`;
    }).join('|');
    // Simple string hash
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return hash;
  }

  /**
   * Store the current content hash as the saved state.
   * Called after save or load.
   */
  _updateSavedContentHash() {
    this._savedContentHash = this._computeContentHash();
  }

  /**
   * Check if current content matches saved content.
   * Returns true if content is same as last saved state.
   */
  matchesSavedContent() {
    if (this._savedContentHash === null) return false;
    return this._computeContentHash() === this._savedContentHash;
  }

  /**
   * Update modified state based on content comparison.
   * Call this after undo operations to detect when content returns to saved state.
   */
  updateModifiedState() {
    const shouldBeModified = !this.matchesSavedContent();
    this.setModified(shouldBeModified);
  }

  onDidChangeModified(callback) {
    return this.emitter.on("did-change-modified", callback);
  }

  getPath() {
    return this.filePath;
  }

  destroy() {
    // Disconnect kernel first to avoid orphan references during reload
    if (this.kernel) {
      if (this.kernelDisposables) {
        this.kernelDisposables.dispose();
        this.kernelDisposables = null;
      }
      this.kernel = null;
    }
    this.disposables.dispose();
    this.emitter.emit("did-destroy");
    this.emitter.dispose();
  }

  onDidDestroy(callback) {
    return this.emitter.on("did-destroy", callback);
  }
}

module.exports = NotebookDocument;
