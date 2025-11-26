/**
 * CellUndoManager - Manages undo/redo for cell structure operations
 *
 * This handles operations like:
 * - Insert cell
 * - Delete cell(s)
 * - Move cell(s)
 * - Change cell type
 * - Cut/Copy/Paste cells
 *
 * Note: Text editing within cells is handled by Atom's TextEditor undo system.
 */
class CellUndoManager {
  constructor(maxStackSize = 100) {
    this.undoStack = [];
    this.redoStack = [];
    this.maxStackSize = maxStackSize;
    this._isUndoingOrRedoing = false;
  }

  /**
   * Check if currently performing undo/redo operation
   * Used to prevent recording operations triggered by undo/redo
   */
  isUndoingOrRedoing() {
    return this._isUndoingOrRedoing;
  }

  /**
   * Push an operation onto the undo stack
   * @param {Object} operation - The operation to record
   * @param {string} operation.type - Type of operation (insert, delete, move, changeType, etc.)
   * @param {Object} operation.data - Operation-specific data for undo/redo
   */
  pushOperation(operation) {
    // Don't record operations during undo/redo
    if (this._isUndoingOrRedoing) return;

    this.undoStack.push(operation);

    // Clear redo stack when new operation is performed
    this.redoStack = [];

    // Limit stack size
    if (this.undoStack.length > this.maxStackSize) {
      this.undoStack.shift();
    }
  }

  /**
   * Check if undo is available
   */
  canUndo() {
    return this.undoStack.length > 0;
  }

  /**
   * Check if redo is available
   */
  canRedo() {
    return this.redoStack.length > 0;
  }

  /**
   * Pop and return the last operation from undo stack
   * Moves it to redo stack
   */
  popUndo() {
    if (!this.canUndo()) return null;

    this._isUndoingOrRedoing = true;
    const operation = this.undoStack.pop();
    this.redoStack.push(operation);
    return operation;
  }

  /**
   * Pop and return the last operation from redo stack
   * Moves it back to undo stack
   */
  popRedo() {
    if (!this.canRedo()) return null;

    this._isUndoingOrRedoing = true;
    const operation = this.redoStack.pop();
    this.undoStack.push(operation);
    return operation;
  }

  /**
   * Call after undo/redo operation is complete
   */
  finishUndoRedo() {
    this._isUndoingOrRedoing = false;
  }

  /**
   * Clear all undo/redo history
   */
  clear() {
    this.undoStack = [];
    this.redoStack = [];
  }

  /**
   * Get summary of undo stack for debugging
   */
  getUndoStackSummary() {
    return this.undoStack.map((op) => op.type);
  }

  /**
   * Get summary of redo stack for debugging
   */
  getRedoStackSummary() {
    return this.redoStack.map((op) => op.type);
  }
}

module.exports = CellUndoManager;
