/**
 * JupyterNotebookEditor - Editor for Jupyter notebooks using React
 */

const { Emitter, CompositeDisposable } = require('atom')
const path = require('path')

// Lazy load components
let NotebookView = null
let NotebookDocument = null
let CellUndoManager = null

function getNotebookView() {
  if (!NotebookView) {
    NotebookView = require('./views/notebook-view')
  }
  return NotebookView
}

function getNotebookDocument() {
  if (!NotebookDocument) {
    NotebookDocument = require('./notebook-document')
  }
  return NotebookDocument
}

function getCellUndoManager() {
  if (!CellUndoManager) {
    CellUndoManager = require('./cell-undo-manager')
  }
  return CellUndoManager
}

/**
 * JupyterNotebookEditor is a view/editor for a NotebookDocument.
 * Multiple editors can share the same document (like Pulsar's TextEditor/TextBuffer).
 */
class JupyterNotebookEditor {
  static deserialize(state, atomEnv) {
    // Check if there's already an open editor for this file/content
    // This prevents reloading when moving panes between containers
    const searchPath = state.filePath

    // Search all pane items for an existing editor with same path and loaded view
    for (const paneContainer of [atom.workspace.getCenter(), atom.workspace.getLeftDock(), atom.workspace.getRightDock(), atom.workspace.getBottomDock()]) {
      if (!paneContainer) continue
      for (const pane of paneContainer.getPanes()) {
        for (const item of pane.getItems()) {
          if (item instanceof JupyterNotebookEditor &&
              item.view &&
              !item._destroyed) {
            // Match by file path if available
            if (searchPath && item.getPath() === searchPath) {
              return item
            }
          }
        }
      }
    }

    // Return a synchronous placeholder that loads asynchronously
    // This prevents Pulsar from trying to create a view for a Promise
    const editor = new JupyterNotebookEditor(null, state)
    return editor
  }

  constructor(notebookDocument, deserializeState = null) {
    this.emitter = new Emitter()
    this.disposables = new CompositeDisposable()
    this.activeCellIndex = 0
    this.view = null
    this.document = null
    this._loading = false
    this._loadError = null
    this._destroyed = false

    // Cell operation undo/redo manager
    const CellUndoManagerClass = getCellUndoManager()
    this.cellUndoManager = new CellUndoManagerClass()

    // Clipboard for cut/copy/paste
    this.cellClipboard = null

    // Create a stable container element that ViewRegistry will cache.
    // We swap its contents between placeholder and view to work around
    // ViewRegistry's caching behavior (it caches getElement() result once).
    this._containerElement = window.document.createElement('div')
    this._containerElement.className = 'jupyter-notebook-container'

    if (notebookDocument) {
      // Normal construction with document
      this._initWithDocument(notebookDocument)
    } else if (deserializeState) {
      // Create placeholder and async load from serialized state
      this._createPlaceholder()
      this._loadFromState(deserializeState)
    }
  }

  _createPlaceholder() {
    // Create placeholder content inside the stable container
    this._containerElement.innerHTML = '<div class="jupyter-notebook-loading"><div class="loading-spinner-large"></div><div class="loading-message">Loading notebook...</div></div>'
  }

  async _loadFromState(state) {
    // Guard against concurrent calls
    if (this._loadingPromise) {
      return this._loadingPromise
    }

    this._loading = true
    this._deserializeState = state

    this._loadingPromise = (async () => {
    try {
      // Wait for the package to be fully activated
      // The deserializer runs during package activation, so we need to wait
      await this._waitForPackageActivation()

      const pkg = atom.packages.getActivePackage('jupyter-next')
      if (!pkg || !pkg.mainModule) {
        throw new Error('jupyter-next package not active')
      }

      const main = pkg.mainModule
      const registry = main.getDocumentRegistry()
      const kernelManager = main.getKernelManager()

      let doc
      if (state.filePath && state.notebookData && state.wasModified) {
        // Modified saved file - restore from serialized data with file path
        const NotebookDocumentClass = getNotebookDocument()
        doc = new NotebookDocumentClass(state.filePath, kernelManager)
        await doc.initializeFromData(state.notebookData)
        // Mark as modified since it has unsaved changes
        doc.setModified(true)
        if (state.activeCellIndex !== undefined) {
          this.activeCellIndex = state.activeCellIndex
        }
      } else if (state.filePath) {
        // Unmodified saved file - load from disk
        doc = await registry.getOrCreateDocument(state.filePath)
      } else if (state.notebookData) {
        // Unsaved notebook - restore from serialized data
        const NotebookDocumentClass = getNotebookDocument()
        doc = new NotebookDocumentClass(null, kernelManager)
        await doc.initializeFromData(state.notebookData)
        // Mark as modified since it's unsaved
        if (state.wasModified) {
          doc.setModified(true)
        }
        if (state.activeCellIndex !== undefined) {
          this.activeCellIndex = state.activeCellIndex
        }
      }

      if (doc) {
        this._initWithDocument(doc)
      } else {
        // No document loaded - show error
        this._containerElement.innerHTML = '<div class="error-message">Failed to load notebook: No document</div>'
      }
    } catch (error) {
      this._loadError = error
      console.error('[jupyter-next] Failed to load notebook:', error)
      this._containerElement.innerHTML = `<div class="error-message">Failed to load notebook: ${error.message}</div>`
    } finally {
      this._loading = false
      this._loadingPromise = null
      // Notify that title has changed (was "Loading...", now is actual filename)
      this.emitter.emit('did-change-title')
    }
    })()

    return this._loadingPromise
  }

  async _waitForPackageActivation() {
    // Check if package is already active
    const pkg = atom.packages.getActivePackage('jupyter-next')
    if (pkg && pkg.mainModule) {
      return
    }

    // Wait for package activation with timeout
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        disposable.dispose()
        reject(new Error('Timeout waiting for jupyter-next activation'))
      }, 10000)

      const disposable = atom.packages.onDidActivatePackage((activatedPkg) => {
        if (activatedPkg.name === 'jupyter-next') {
          clearTimeout(timeout)
          disposable.dispose()
          // Small delay to ensure mainModule is fully initialized
          setTimeout(resolve, 100)
        }
      })
    })
  }

  _initWithDocument(notebookDocument) {
    this.document = notebookDocument
    this.document.retain()

    // Create the view
    const NotebookViewClass = getNotebookView()
    this.view = new NotebookViewClass({
      editor: this,
      cells: this.document.cells,
      activeCellIndex: this.activeCellIndex,
      kernel: this.document.kernel
    })

    // Replace container contents with the view element
    // This handles both initial load and deserialization (replaces placeholder)
    this._containerElement.innerHTML = ''
    this._containerElement.appendChild(this.view.element)

    // Subscribe to document changes
    this.subscribeToDocument()

    // Set up auto-save
    this.setupAutoSave()

    // Subscribe to pane item activation to redirect focus appropriately
    this.subscribeToActivation()

    // Emit initial modified status for tabs to pick up
    this.emitter.emit('did-change-modified', this.document.isModified())

    // Apply pending state from copy() if any (cursor positions, mode, scroll)
    // Use setTimeout to ensure editors are fully set up and attached to DOM
    if (this._pendingCursorPositions || this._pendingMode || this._pendingScrollTop !== undefined) {
      setTimeout(() => {
        this._applyPendingState()
      }, 50)
    }
  }

  subscribeToDocument() {
    this.disposables.add(
      this.document.onDidChange(() => {
        this.updateView()
        this.emitter.emit('did-change')
      }),

      this.document.onDidSave(() => {
        this.emitter.emit('did-save', { path: this.document.filePath })
      }),

      this.document.onDidChangePath((newPath) => {
        this.emitter.emit('did-change-title')
      }),

      this.document.onDidConnectKernel((kernel) => {
        this.updateView()
        this.emitter.emit('did-connect-kernel', kernel)
      }),

      this.document.onDidDisconnectKernel(() => {
        this.updateView()
        this.emitter.emit('did-disconnect-kernel')
      }),

      this.document.onDidChangeKernelStatus((status) => {
        this.updateView()
        this.emitter.emit('did-change-kernel-status', status)
      }),

      this.document.onDidInsertCell(({ index }) => {
        // Adjust active cell index if needed
        if (index <= this.activeCellIndex) {
          this.activeCellIndex++
        }
        // Adjust selected cell indices in view
        this._adjustSelectionForInsert(index)
        this.updateView()
      }),

      this.document.onDidDeleteCell(({ index }) => {
        // Adjust active cell index if needed
        if (index < this.activeCellIndex) {
          this.activeCellIndex--
        } else if (index === this.activeCellIndex && this.activeCellIndex >= this.document.getCellCount()) {
          this.activeCellIndex = Math.max(0, this.document.getCellCount() - 1)
        }
        // Adjust selected cell indices in view
        this._adjustSelectionForDelete(index)
        this.updateView()
      }),

      this.document.onDidMoveCell(({ fromIndex, toIndex }) => {
        // Adjust active cell index if it was moved
        if (this.activeCellIndex === fromIndex) {
          this.activeCellIndex = toIndex
        } else if (fromIndex < this.activeCellIndex && toIndex >= this.activeCellIndex) {
          this.activeCellIndex--
        } else if (fromIndex > this.activeCellIndex && toIndex <= this.activeCellIndex) {
          this.activeCellIndex++
        }
        // Adjust selected cell indices in view
        this._adjustSelectionForMove(fromIndex, toIndex)
        this.updateView()
      }),

      this.document.onDidDestroy(() => {
        this.destroy()
      }),

      this.document.onDidChangeModified((modified) => {
        this.emitter.emit('did-change-modified', modified)
        // Exit pending state when notebook is modified
        if (modified) {
          this.terminatePendingState()
        }
      })
    )
  }

  setupAutoSave() {
    if (atom.config.get('jupyter-next.notebook.autoSave')) {
      this.disposables.add(
        this.document.onDidChange(() => {
          if (this.autoSaveTimeout) {
            clearTimeout(this.autoSaveTimeout)
          }
          const delay = atom.config.get('jupyter-next.notebook.autoSaveDelay')
          this.autoSaveTimeout = setTimeout(() => {
            if (this.document.filePath && this.document.modified) {
              this.document.save()
            }
          }, delay)
        })
      )
    }
  }

  subscribeToActivation() {
    // When this pane item becomes active, redirect focus to appropriate element
    this.disposables.add(
      atom.workspace.onDidChangeActivePaneItem((item) => {
        if (item === this && this.view) {
          // Delay to ensure pane activation is complete
          requestAnimationFrame(() => {
            if (this.view.getMode() === 'edit') {
              this.view.focusActiveCellEditor()
            } else {
              this.view.element.focus()
            }
          })
        }
      })
    )
  }

  updateView() {
    if (this.view) {
      this.view.update({
        editor: this,
        cells: this.document.cells,
        activeCellIndex: this.activeCellIndex,
        kernel: this.document.kernel
      })
    }
  }

  // Create a copy of this editor (for split panes)
  // Used by Pulsar's pane:split-* and pane:copy-* commands
  copy() {
    const copy = new JupyterNotebookEditor(this.document)

    // Preserve the active cell index
    copy.activeCellIndex = this.activeCellIndex

    // Preserve cursor positions from each cell's editor
    if (this.view && this.view.cellViews) {
      const cursorPositions = new Map()
      for (const [cellId, cellView] of this.view.cellViews) {
        if (cellView.editor) {
          const position = cellView.editor.getCursorBufferPosition()
          const selections = cellView.editor.getSelectedBufferRanges()
          cursorPositions.set(cellId, { position, selections })
        }
      }

      // Store for restoration after view is created
      copy._pendingCursorPositions = cursorPositions
    }

    // Preserve the mode (command/edit)
    if (this.view) {
      copy._pendingMode = this.view.getMode()
    }

    // Preserve scroll position
    if (this.view && this.view.cellsContainer) {
      copy._pendingScrollTop = this.view.cellsContainer.scrollTop
    }

    return copy
  }

  /**
   * Apply pending state from copy() after view is ready
   * Called after the view is created and cells are rendered
   */
  _applyPendingState() {
    if (!this.view) return

    // First restore scroll position so cell is visible
    if (this._pendingScrollTop !== undefined && this.view.cellsContainer) {
      this.view.cellsContainer.scrollTop = this._pendingScrollTop
      this._pendingScrollTop = undefined
    } else {
      // Ensure active cell is visible
      this.view.scrollToCell(this.activeCellIndex)
    }

    // Get the active cell to restore its cursor position
    const cells = this.document.cells
    if (cells && cells[this.activeCellIndex] && this._pendingCursorPositions) {
      const activeCell = cells[this.activeCellIndex]
      const activeCellView = this.view.cellViews.get(activeCell.id)
      const cursorState = this._pendingCursorPositions.get(activeCell.id)

      if (activeCellView && activeCellView.editor && cursorState) {
        try {
          // Validate position is within buffer range before setting
          const buffer = activeCellView.editor.getBuffer()
          if (buffer && buffer.getLineCount() > 0) {
            const lastRow = buffer.getLastRow()
            const position = cursorState.position
            // Clamp position to valid range
            const validRow = Math.min(position.row, lastRow)
            const validColumn = Math.min(position.column, buffer.lineLengthForRow(validRow) || 0)
            activeCellView.editor.setCursorBufferPosition([validRow, validColumn])

            if (cursorState.selections && cursorState.selections.length > 0) {
              // Filter selections to valid ranges
              const validSelections = cursorState.selections.filter(range => {
                return range.start.row <= lastRow && range.end.row <= lastRow
              })
              if (validSelections.length > 0) {
                activeCellView.editor.setSelectedBufferRanges(validSelections)
              }
            }
          }
        } catch (e) {
          // Ignore cursor restoration errors - not critical
          console.warn('[jupyter-next] Could not restore cursor position:', e.message)
        }
      }
      this._pendingCursorPositions = null
    }

    // Restore mode and focus the active cell appropriately
    if (this._pendingMode) {
      if (this._pendingMode === 'edit') {
        this.view.enterEditMode()
      } else {
        this.view.enterCommandMode()
      }
      this._pendingMode = null
    }
  }

  // Atom pane item interface
  getTitle() {
    if (this._loading) return 'Loading...'
    if (this.document && this.document.filePath) {
      return path.basename(this.document.filePath)
    }
    return 'Untitled.ipynb'
  }

  getLongTitle() {
    if (this._loading) return 'Loading notebook...'
    return (this.document && this.document.filePath) || 'Untitled.ipynb'
  }

  getPath() {
    if (this.document) {
      return this.document.filePath
    }
    // For loading editors, return path from deserialize state
    if (this._deserializeState) {
      return this._deserializeState.filePath
    }
    return null
  }

  getURI() {
    return this.getPath()
  }

  getElement() {
    // Always return the stable container element.
    // ViewRegistry caches this on first call and never asks again.
    // We manage the container's contents internally (placeholder -> view).
    return this._containerElement
  }

  isModified() {
    return this.document ? this.document.isModified() : false
  }

  // Called by Pulsar to determine if it should prompt to save before closing
  // Options may contain windowCloseRequested: true when closing the whole window
  shouldPromptToSave(options = {}) {
    // Don't prompt when closing Pulsar - content is serialized and restored
    if (options.windowCloseRequested) {
      return false
    }
    // Don't prompt if not modified
    if (!this.isModified()) {
      return false
    }
    // Don't prompt if other views of this notebook exist in the workspace
    // (the document will remain open in those views)
    if (this.document && this.document.refCount > 1) {
      return false
    }
    return true
  }

  // Exit pending state when the notebook is modified
  terminatePendingState() {
    // This is called by Pulsar's pane when we want to make the tab permanent
    // (e.g., when user makes changes to a pending/preview tab)
    this.emitter.emit('did-terminate-pending-state')
  }

  onDidTerminatePendingState(callback) {
    return this.emitter.on('did-terminate-pending-state', callback)
  }

  isPermanentDockItem() {
    return false
  }

  getDefaultLocation() {
    return 'center'
  }

  getAllowedLocations() {
    return ['center']
  }

  serialize() {
    // Don't serialize if still loading or no document
    if (!this.document) {
      return null
    }

    if (this.document.filePath) {
      // Saved notebook - store path and modified state
      // If modified, also store the current content so changes aren't lost
      if (this.document.isModified()) {
        return {
          deserializer: 'JupyterNotebookEditor',
          filePath: this.document.filePath,
          notebookData: this.document.toJSON(),
          activeCellIndex: this.activeCellIndex,
          wasModified: true
        }
      } else {
        return {
          deserializer: 'JupyterNotebookEditor',
          filePath: this.document.filePath
        }
      }
    } else {
      // Unsaved notebook - store full content (always modified)
      return {
        deserializer: 'JupyterNotebookEditor',
        notebookData: this.document.toJSON(),
        activeCellIndex: this.activeCellIndex,
        wasModified: true
      }
    }
  }

  // Delegate save to document
  async save() {
    if (!this.document) return false
    if (!this.document.filePath) {
      // Use Pulsar's pane to show save dialog properly
      const pane = atom.workspace.paneForItem(this)
      if (pane) {
        return pane.saveItemAs(this)
      }
      return false
    }
    return this.document.save()
  }

  // Called by Pulsar's Pane with the selected path from save dialog
  async saveAs(newPath) {
    if (!this.document) return false
    // Handle both string path and object { canceled, filePath } from Electron dialog
    const filePath = typeof newPath === 'string' ? newPath : newPath?.filePath
    if (filePath) {
      this.document.setPath(filePath)
      return this.document.save()
    }
    return false
  }

  // Pulsar pane item interface - provides options for save dialog
  getSaveDialogOptions() {
    return {
      defaultPath: this.document?.filePath || 'Untitled.ipynb',
      filters: [
        { name: 'Jupyter Notebook', extensions: ['ipynb'] }
      ]
    }
  }

  // Kernel management - delegate to document
  async connectToKernel(kernelSpec) {
    if (!this.document) return
    return this.document.connectToKernel(kernelSpec)
  }

  async disconnectKernel() {
    if (!this.document) return
    return this.document.disconnectKernel()
  }

  async restartKernel() {
    if (!this.document) return
    return this.document.restartKernel()
  }

  async interruptKernel() {
    if (!this.document) return
    return this.document.interruptKernel()
  }

  getKernel() {
    return this.document ? this.document.kernel : null
  }

  // Cell operations
  getActiveCell() {
    if (!this.document) return null
    return this.document.getCell(this.activeCellIndex)
  }

  setActiveCell(index) {
    if (!this.document) return
    if (index >= 0 && index < this.document.getCellCount()) {
      this.activeCellIndex = index
      this.updateView()
    }
  }

  focusActiveCell() {
    if (this.view) {
      this.view.enterEditMode()
    }
  }

  focusActiveCellEditor() {
    if (this.view) {
      this.view.focusActiveCellEditor()
    }
  }

  async runCell() {
    if (!this.document) return
    try {
      await this.document.executeCell(this.activeCellIndex)
    } catch (error) {
      // Error already handled in document
    }
  }

  async runCellAndAdvance() {
    if (!this.document) return
    await this.runCell()

    // Always advance to next cell (or create new one at end)
    if (this.activeCellIndex < this.document.getCellCount() - 1) {
      this.setActiveCell(this.activeCellIndex + 1)
    } else {
      // Insert new cell at end
      this.insertCellBelow()
    }

    // Only focus editor if we're in edit mode, otherwise just scroll to the cell
    if (this.view && this.view.getMode() === 'edit') {
      this.focusActiveCellEditor()
    } else if (this.view) {
      this.view.scrollToCell(this.activeCellIndex)
    }
  }

  async runAllCells() {
    if (!this.document) return
    const interruptOnError = atom.config.get('jupyter-next.execution.interruptOnError')

    for (let i = 0; i < this.document.getCellCount(); i++) {
      this.setActiveCell(i)
      const cell = this.document.getCell(i)

      if (cell.type === 'code') {
        try {
          await this.document.executeCell(i)
        } catch (error) {
          if (interruptOnError) {
            break
          }
        }
      }
    }
  }

  async runAllAbove() {
    if (!this.document) return
    const currentIndex = this.activeCellIndex

    for (let i = 0; i < currentIndex; i++) {
      this.setActiveCell(i)
      if (this.document.getCell(i).type === 'code') {
        await this.document.executeCell(i)
      }
    }

    this.setActiveCell(currentIndex)
  }

  async runAllBelow() {
    if (!this.document) return
    const startIndex = this.activeCellIndex

    for (let i = startIndex; i < this.document.getCellCount(); i++) {
      this.setActiveCell(i)
      if (this.document.getCell(i).type === 'code') {
        await this.document.executeCell(i)
      }
    }
  }

  clearOutput() {
    if (!this.document) return
    this.document.clearCellOutput(this.activeCellIndex)
  }

  clearAllOutputs() {
    if (!this.document) return
    this.document.clearAllOutputs()
  }

  /**
   * Insert a new cell at the specified position
   * @param {string} position - 'above' or 'below'
   * @param {boolean} extendSelection - Whether to extend selection to include the new cell
   */
  _insertCell(position = 'below', extendSelection = false) {
    if (!this.document) return

    const isAbove = position === 'above'
    const previousIndex = this.activeCellIndex
    const insertIndex = isAbove ? this.activeCellIndex : this.activeCellIndex + 1

    // Clear selection unless extending
    if (this.view && !extendSelection) {
      this.view.clearSelection()
    }

    // Record for undo (before the insert)
    if (!this.cellUndoManager.isUndoingOrRedoing()) {
      this.cellUndoManager.pushOperation({
        type: 'insert',
        data: { index: insertIndex }
      })
    }

    this.document.insertCell(insertIndex, 'code')

    // Update active cell index
    if (isAbove) {
      // Stay on the newly inserted cell
      this.activeCellIndex = insertIndex
    } else {
      // Move to the newly inserted cell below
      this.activeCellIndex++
    }

    this.updateView()

    // Extend selection if requested
    if (extendSelection && this.view) {
      if (isAbove) {
        this.view.extendSelection(insertIndex)
        this.view.extendSelection(previousIndex + 1)
      } else {
        this.view.extendSelection(previousIndex)
        this.view.extendSelection(insertIndex)
      }
    }
  }

  insertCellAbove() { this._insertCell('above', false) }
  insertCellBelow() { this._insertCell('below', false) }
  insertCellAboveAndExtendSelection() { this._insertCell('above', true) }
  insertCellBelowAndExtendSelection() { this._insertCell('below', true) }

  deleteCell() {
    if (!this.document) return

    // Check if there are selected cells in the view
    const selectedIndices = this.view ? this.view.getSelectedCells() : []

    // Clear selection before any delete operation
    if (this.view) {
      this.view.clearSelection()
    }

    if (selectedIndices.length > 1) {
      // Delete all selected cells - save cell data for undo
      if (!this.cellUndoManager.isUndoingOrRedoing()) {
        const cellsData = selectedIndices.map(i => ({
          index: i,
          cell: this.document.getCell(i).toJSON()
        }))
        this.cellUndoManager.pushOperation({
          type: 'deleteMultiple',
          data: {
            cells: cellsData,
            previousActiveIndex: this.activeCellIndex
          }
        })
      }

      this.document.deleteCells(selectedIndices)
      // Adjust active cell index
      const minDeleted = Math.min(...selectedIndices)
      this.activeCellIndex = Math.min(minDeleted, this.document.getCellCount() - 1)
      this.activeCellIndex = Math.max(0, this.activeCellIndex)
      this.updateView()
    } else {
      // Delete single active cell - save cell data for undo
      if (!this.cellUndoManager.isUndoingOrRedoing()) {
        const cell = this.document.getCell(this.activeCellIndex)
        this.cellUndoManager.pushOperation({
          type: 'delete',
          data: {
            index: this.activeCellIndex,
            cell: cell.toJSON(),
            previousActiveIndex: this.activeCellIndex
          }
        })
      }

      this.document.deleteCell(this.activeCellIndex)
    }
  }

  moveCellUp() {
    if (!this.document) return

    const selectedIndices = this.view ? this.view.getSelectedCells() : []

    if (selectedIndices.length > 1) {
      // Move multiple selected cells up
      const sortedIndices = [...selectedIndices].sort((a, b) => a - b)
      const minIndex = sortedIndices[0]

      // Can't move up if first selected cell is already at top
      if (minIndex === 0) return

      const targetIndex = minIndex - 1

      if (!this.cellUndoManager.isUndoingOrRedoing()) {
        this.cellUndoManager.pushOperation({
          type: 'moveMultiple',
          data: {
            indices: sortedIndices,
            targetIndex,
            previousActiveIndex: this.activeCellIndex
          }
        })
      }

      this.document.moveCells(sortedIndices, targetIndex)

      // Update selection to new positions
      const newIndices = sortedIndices.map(i => i - 1)
      this.view.clearSelection()
      newIndices.forEach(i => this.view.extendSelection(i))
      this.activeCellIndex = this.activeCellIndex - 1
      this.updateView()
    } else {
      // Move single active cell up
      if (this.activeCellIndex > 0) {
        if (!this.cellUndoManager.isUndoingOrRedoing()) {
          this.cellUndoManager.pushOperation({
            type: 'move',
            data: {
              fromIndex: this.activeCellIndex,
              toIndex: this.activeCellIndex - 1
            }
          })
        }
        this.document.moveCell(this.activeCellIndex, this.activeCellIndex - 1)
      }
    }
  }

  moveCellDown() {
    if (!this.document) return

    const selectedIndices = this.view ? this.view.getSelectedCells() : []

    if (selectedIndices.length > 1) {
      // Move multiple selected cells down
      const sortedIndices = [...selectedIndices].sort((a, b) => a - b)
      const maxIndex = sortedIndices[sortedIndices.length - 1]

      // Can't move down if last selected cell is already at bottom
      if (maxIndex >= this.document.getCellCount() - 1) return

      // Target is after the last selected cell + 1 (the cell below)
      const targetIndex = maxIndex + 2

      if (!this.cellUndoManager.isUndoingOrRedoing()) {
        this.cellUndoManager.pushOperation({
          type: 'moveMultiple',
          data: {
            indices: sortedIndices,
            targetIndex,
            previousActiveIndex: this.activeCellIndex
          }
        })
      }

      this.document.moveCells(sortedIndices, targetIndex)

      // Update selection to new positions
      const newIndices = sortedIndices.map(i => i + 1)
      this.view.clearSelection()
      newIndices.forEach(i => this.view.extendSelection(i))
      this.activeCellIndex = this.activeCellIndex + 1
      this.updateView()
    } else {
      // Move single active cell down
      if (this.activeCellIndex < this.document.getCellCount() - 1) {
        if (!this.cellUndoManager.isUndoingOrRedoing()) {
          this.cellUndoManager.pushOperation({
            type: 'move',
            data: {
              fromIndex: this.activeCellIndex,
              toIndex: this.activeCellIndex + 1
            }
          })
        }
        this.document.moveCell(this.activeCellIndex, this.activeCellIndex + 1)
      }
    }
  }

  moveCell(fromIndex, toIndex) {
    if (!this.document) return
    if (!this.cellUndoManager.isUndoingOrRedoing()) {
      this.cellUndoManager.pushOperation({
        type: 'move',
        data: { fromIndex, toIndex }
      })
    }
    this.document.moveCell(fromIndex, toIndex)
  }

  /**
   * Move multiple cells to a target position
   * @param {number[]} indices - Array of cell indices to move (must be sorted)
   * @param {number} targetIndex - Target position to move cells to
   */
  moveCells(indices, targetIndex) {
    if (!this.document) return
    if (!this.cellUndoManager.isUndoingOrRedoing()) {
      this.cellUndoManager.pushOperation({
        type: 'moveMultiple',
        data: {
          indices: [...indices],
          targetIndex,
          previousActiveIndex: this.activeCellIndex
        }
      })
    }
    this.document.moveCells(indices, targetIndex)
  }

  /**
   * Delete multiple cells at specified indices
   * @param {number[]} indices - Array of cell indices to delete
   */
  deleteCells(indices) {
    if (!this.document) return
    if (!this.cellUndoManager.isUndoingOrRedoing()) {
      const cellsData = indices.map(i => ({
        index: i,
        cell: this.document.getCell(i).toJSON()
      }))
      this.cellUndoManager.pushOperation({
        type: 'deleteMultiple',
        data: {
          cells: cellsData,
          previousActiveIndex: this.activeCellIndex
        }
      })
    }
    this.document.deleteCells(indices)
  }

  changeCellType(type) {
    if (!this.document) return
    const cell = this.document.getCell(this.activeCellIndex)
    if (!cell) return

    const previousType = cell.type
    if (previousType === type) return

    if (!this.cellUndoManager.isUndoingOrRedoing()) {
      this.cellUndoManager.pushOperation({
        type: 'changeType',
        data: {
          index: this.activeCellIndex,
          previousType,
          newType: type
        }
      })
    }
    this.document.changeCellType(this.activeCellIndex, type)
  }

  // Cut/Copy/Paste cell operations
  cutCell() {
    if (!this.document) return

    const selectedIndices = this.view ? this.view.getSelectedCells() : []
    const indicesToCut = selectedIndices.length > 0 ? selectedIndices : [this.activeCellIndex]

    // Copy cells to clipboard
    this.cellClipboard = indicesToCut.map(i => this.document.getCell(i).toJSON())

    // Record for undo before deleting
    if (!this.cellUndoManager.isUndoingOrRedoing()) {
      const cellsData = indicesToCut.map(i => ({
        index: i,
        cell: this.document.getCell(i).toJSON()
      }))
      this.cellUndoManager.pushOperation({
        type: 'cut',
        data: {
          cells: cellsData,
          previousActiveIndex: this.activeCellIndex
        }
      })
    }

    // Clear selection before delete
    if (this.view) {
      this.view.clearSelection()
    }

    // Delete the cells
    if (indicesToCut.length > 1) {
      this.document.deleteCells(indicesToCut)
      const minDeleted = Math.min(...indicesToCut)
      this.activeCellIndex = Math.min(minDeleted, this.document.getCellCount() - 1)
      this.activeCellIndex = Math.max(0, this.activeCellIndex)
      this.updateView()
    } else {
      this.document.deleteCell(this.activeCellIndex)
    }
  }

  copyCell() {
    if (!this.document) return

    const selectedIndices = this.view ? this.view.getSelectedCells() : []
    const indicesToCopy = selectedIndices.length > 0 ? selectedIndices : [this.activeCellIndex]

    // Copy cells to clipboard
    this.cellClipboard = indicesToCopy.map(i => this.document.getCell(i).toJSON())
  }

  pasteCellBelow() {
    if (!this.document || !this.cellClipboard || this.cellClipboard.length === 0) return

    // Clear selection before pasting
    if (this.view) {
      this.view.clearSelection()
    }

    const insertIndex = this.activeCellIndex + 1

    if (!this.cellUndoManager.isUndoingOrRedoing()) {
      this.cellUndoManager.pushOperation({
        type: 'paste',
        data: {
          index: insertIndex,
          count: this.cellClipboard.length,
          previousActiveIndex: this.activeCellIndex
        }
      })
    }

    // Insert cells from clipboard and activate the first pasted cell
    this._insertCellsFromData(insertIndex, this.cellClipboard)
    this.activeCellIndex = insertIndex
    this.updateView()
  }

  pasteCellAbove() {
    if (!this.document || !this.cellClipboard || this.cellClipboard.length === 0) return

    // Clear selection before pasting
    if (this.view) {
      this.view.clearSelection()
    }

    const insertIndex = this.activeCellIndex

    if (!this.cellUndoManager.isUndoingOrRedoing()) {
      this.cellUndoManager.pushOperation({
        type: 'paste',
        data: {
          index: insertIndex,
          count: this.cellClipboard.length,
          previousActiveIndex: this.activeCellIndex
        }
      })
    }

    // Insert cells from clipboard and activate the first pasted cell
    this._insertCellsFromData(insertIndex, this.cellClipboard)
    this.activeCellIndex = insertIndex
    this.updateView()
  }

  /**
   * Duplicate the active cell (or selected cells) below
   */
  duplicateCell() {
    if (!this.document) return

    // Get selected indices BEFORE clearing selection
    const selectedIndices = this.view ? this.view.getSelectedCells() : []
    const indicesToDuplicate = selectedIndices.length > 0 ? selectedIndices : [this.activeCellIndex]

    // Now clear selection
    if (this.view) {
      this.view.clearSelection()
    }

    // Get cell data to duplicate
    const cellsData = indicesToDuplicate.map(i => this.document.getCell(i).toJSON())

    // Insert after the last selected cell
    const insertIndex = Math.max(...indicesToDuplicate) + 1

    if (!this.cellUndoManager.isUndoingOrRedoing()) {
      this.cellUndoManager.pushOperation({
        type: 'duplicate',
        data: {
          index: insertIndex,
          count: cellsData.length,
          cellsData: cellsData, // Store for redo
          previousActiveIndex: this.activeCellIndex
        }
      })
    }

    // Insert duplicated cells and activate the first duplicated cell
    this._insertCellsFromData(insertIndex, cellsData)
    this.activeCellIndex = insertIndex
    this.updateView()
  }

  /**
   * Insert cells from JSON data at specified index
   * @private
   */
  _insertCellsFromData(startIndex, cellsData) {
    const { v4: uuidv4 } = require('uuid')
    const CellModel = require('./models/cell-model')

    for (let i = 0; i < cellsData.length; i++) {
      const cellData = cellsData[i]
      const newCell = new CellModel({
        id: uuidv4(),
        type: cellData.cell_type || 'code',
        source: Array.isArray(cellData.source) ? cellData.source.join('') : (cellData.source || ''),
        outputs: cellData.outputs || [],
        executionCount: null, // Reset execution count for pasted cells
        metadata: cellData.metadata || {}
      })

      this.document.cells.splice(startIndex + i, 0, newCell)
    }

    this.activeCellIndex = startIndex
    this.document.setModified(true)
    this.document.emitter.emit('did-change')
    this.updateView()
  }

  // Undo/Redo operations
  undoCellOperation() {
    if (!this.document) return
    if (!this.cellUndoManager.canUndo()) return

    const operation = this.cellUndoManager.popUndo()
    if (!operation) return

    try {
      this._applyUndoOperation(operation)
    } finally {
      this.cellUndoManager.finishUndoRedo()
    }
  }

  redoCellOperation() {
    if (!this.document) return
    if (!this.cellUndoManager.canRedo()) return

    const operation = this.cellUndoManager.popRedo()
    if (!operation) return

    try {
      this._applyRedoOperation(operation)
    } finally {
      this.cellUndoManager.finishUndoRedo()
    }
  }

  /**
   * Apply an undo operation (reverse the original operation)
   * @private
   */
  _applyUndoOperation(operation) {
    const { type, data } = operation

    switch (type) {
      case 'insert':
        // Undo insert = delete the inserted cell
        this.document.deleteCell(data.index)
        break

      case 'delete':
        // Undo delete = restore the cell
        this._restoreCell(data.index, data.cell)
        this.activeCellIndex = data.previousActiveIndex
        this.updateView()
        break

      case 'deleteMultiple':
      case 'cut':
        // Undo delete multiple = restore all cells in order
        // Sort by index ascending to restore in correct order
        const sortedCells = [...data.cells].sort((a, b) => a.index - b.index)
        for (const cellInfo of sortedCells) {
          this._restoreCell(cellInfo.index, cellInfo.cell)
        }
        this.activeCellIndex = data.previousActiveIndex
        this.updateView()
        break

      case 'move':
        // Undo move = move back
        this.document.moveCell(data.toIndex, data.fromIndex)
        break

      case 'moveMultiple':
        // Undo move multiple is complex - for now just note it
        // TODO: implement proper reverse for multi-cell moves
        break

      case 'changeType':
        // Undo change type = change back to previous type
        this.document.changeCellType(data.index, data.previousType)
        break

      case 'paste':
      case 'duplicate':
        // Undo paste/duplicate = delete the inserted cells
        const indicesToDelete = []
        for (let i = 0; i < data.count; i++) {
          indicesToDelete.push(data.index + i)
        }
        this.document.deleteCells(indicesToDelete)
        this.activeCellIndex = data.previousActiveIndex
        this.updateView()
        break

      case 'merge':
        // Undo merge = restore original cells
        // Delete merged cell and restore originals
        this.document.deleteCell(data.index)
        this._restoreCell(data.index, data.firstCell)
        this._restoreCell(data.index + 1, data.secondCell)
        this.activeCellIndex = data.previousActiveIndex
        this.updateView()
        break
    }
  }

  /**
   * Apply a redo operation (re-apply the original operation)
   * @private
   */
  _applyRedoOperation(operation) {
    const { type, data } = operation

    switch (type) {
      case 'insert':
        // Redo insert = insert cell again
        this.document.insertCell(data.index, 'code')
        break

      case 'delete':
        // Redo delete = delete the cell again
        this.document.deleteCell(data.index)
        break

      case 'deleteMultiple':
      case 'cut':
        // Redo delete multiple = delete cells again
        const indicesToDelete = data.cells.map(c => c.index)
        this.document.deleteCells(indicesToDelete)
        break

      case 'move':
        // Redo move = move again
        this.document.moveCell(data.fromIndex, data.toIndex)
        break

      case 'moveMultiple':
        // Redo move multiple
        this.document.moveCells(data.indices, data.targetIndex)
        break

      case 'changeType':
        // Redo change type = change to new type
        this.document.changeCellType(data.index, data.newType)
        break

      case 'paste':
        // Redo paste - need clipboard data, skip for now
        break

      case 'duplicate':
        // Redo duplicate - re-insert the duplicated cells
        if (data.cellsData) {
          this._insertCellsFromData(data.index, data.cellsData)
        }
        break

      case 'merge':
        // Redo merge = merge again
        this.mergeCellBelow()
        break
    }
  }

  /**
   * Restore a cell from JSON data at specified index
   * @private
   */
  _restoreCell(index, cellData) {
    const { v4: uuidv4 } = require('uuid')
    const CellModel = require('./models/cell-model')

    const newCell = new CellModel({
      id: cellData.id || uuidv4(),
      type: cellData.cell_type || 'code',
      source: Array.isArray(cellData.source) ? cellData.source.join('') : (cellData.source || ''),
      outputs: cellData.outputs || [],
      executionCount: cellData.execution_count,
      metadata: cellData.metadata || {}
    })

    this.document.cells.splice(index, 0, newCell)
    this.document.setModified(true)
    this.document.emitter.emit('did-change')
  }

  /**
   * Merge the active cell with the cell below
   */
  mergeCellBelow() {
    if (!this.document) return
    if (this.activeCellIndex >= this.document.getCellCount() - 1) return

    const firstCell = this.document.getCell(this.activeCellIndex)
    const secondCell = this.document.getCell(this.activeCellIndex + 1)

    if (!firstCell || !secondCell) return

    // Record for undo
    if (!this.cellUndoManager.isUndoingOrRedoing()) {
      this.cellUndoManager.pushOperation({
        type: 'merge',
        data: {
          index: this.activeCellIndex,
          firstCell: firstCell.toJSON(),
          secondCell: secondCell.toJSON(),
          previousActiveIndex: this.activeCellIndex
        }
      })
    }

    // Merge sources with newline
    const mergedSource = firstCell.source + '\n' + secondCell.source

    // Update first cell
    this.document.updateCellSource(this.activeCellIndex, mergedSource)

    // Delete second cell
    this.document.deleteCell(this.activeCellIndex + 1)
  }

  toggleCellOutput() {
    if (!this.document) return
    this.document.toggleCellOutput(this.activeCellIndex)
  }

  toggleCellInput() {
    if (!this.document) return

    // Get the cell and toggle its visibility
    const cell = this.document.getCell(this.activeCellIndex)
    if (!cell) return

    // Toggle the model state
    cell.inputVisible = !cell.inputVisible

    // Immediately update the DOM for instant feedback
    if (this.view) {
      const cellView = this.view.cellViews.get(cell.id)
      if (cellView && cellView.element) {
        const inputArea = cellView.element.querySelector('.cell-input')
        if (inputArea) {
          inputArea.style.display = cell.inputVisible ? '' : 'none'
        }
      }
    }

    // Mark document as modified
    this.document.setModified(true)
  }

  updateCellSource(index, source) {
    if (!this.document) return
    this.document.updateCellSource(index, source)
  }

  // Export functions
  async exportToPython() {
    if (!this.document) return
    const lines = []
    const File = require('atom').File

    lines.push('#!/usr/bin/env python')
    lines.push('# -*- coding: utf-8 -*-')
    lines.push('')
    lines.push(`# Exported from: ${this.getTitle()}`)
    lines.push('')

    for (let i = 0; i < this.document.getCellCount(); i++) {
      const cell = this.document.getCell(i)
      if (cell.type === 'code') {
        lines.push(`# In[${cell.executionCount || i + 1}]:`)
        lines.push(cell.source)
        lines.push('')
      } else if (cell.type === 'markdown') {
        lines.push('# ' + cell.source.split('\n').join('\n# '))
        lines.push('')
      }
    }

    const content = lines.join('\n')
    const defaultPath = this.document.filePath
      ? this.document.filePath.replace('.ipynb', '.py')
      : 'Untitled.py'

    const newPath = atom.showSaveDialogSync({
      defaultPath,
      filters: [{ name: 'Python', extensions: ['py'] }]
    })

    if (newPath) {
      const file = new File(newPath)
      await file.write(content)
      atom.notifications.addSuccess(`Exported to ${path.basename(newPath)}`)
    }
  }

  async exportToHtml() {
    if (!this.document) return
    const File = require('atom').File
    const lines = []

    lines.push('<!DOCTYPE html>')
    lines.push('<html><head>')
    lines.push('<meta charset="utf-8">')
    lines.push(`<title>${this.getTitle()}</title>`)
    lines.push('<style>')
    lines.push('body { font-family: sans-serif; max-width: 900px; margin: 0 auto; padding: 20px; }')
    lines.push('.cell { margin: 10px 0; border: 1px solid #ddd; border-radius: 4px; }')
    lines.push('.cell-code { background: #f5f5f5; padding: 10px; font-family: monospace; white-space: pre-wrap; }')
    lines.push('.cell-markdown { padding: 10px; }')
    lines.push('.cell-output { padding: 10px; border-top: 1px solid #ddd; background: #fff; }')
    lines.push('.execution-count { color: #888; font-size: 12px; padding: 5px 10px; }')
    lines.push('</style>')
    lines.push('</head><body>')
    lines.push(`<h1>${this.getTitle()}</h1>`)

    for (let i = 0; i < this.document.getCellCount(); i++) {
      const cell = this.document.getCell(i)
      lines.push('<div class="cell">')

      if (cell.type === 'code') {
        if (cell.executionCount) {
          lines.push(`<div class="execution-count">In [${cell.executionCount}]:</div>`)
        }
        lines.push(`<div class="cell-code">${this.escapeHtml(cell.source)}</div>`)

        if (cell.outputs && cell.outputs.length > 0) {
          lines.push('<div class="cell-output">')
          cell.outputs.forEach(output => {
            if (output.text) {
              lines.push(`<pre>${this.escapeHtml(Array.isArray(output.text) ? output.text.join('') : output.text)}</pre>`)
            } else if (output.data) {
              if (output.data['text/html']) {
                lines.push(Array.isArray(output.data['text/html']) ? output.data['text/html'].join('') : output.data['text/html'])
              } else if (output.data['text/plain']) {
                lines.push(`<pre>${this.escapeHtml(Array.isArray(output.data['text/plain']) ? output.data['text/plain'].join('') : output.data['text/plain'])}</pre>`)
              }
            }
          })
          lines.push('</div>')
        }
      } else if (cell.type === 'markdown') {
        lines.push(`<div class="cell-markdown">${cell.source}</div>`)
      }

      lines.push('</div>')
    }

    lines.push('</body></html>')

    const content = lines.join('\n')
    const defaultPath = this.document.filePath
      ? this.document.filePath.replace('.ipynb', '.html')
      : 'Untitled.html'

    const newPath = atom.showSaveDialogSync({
      defaultPath,
      filters: [{ name: 'HTML', extensions: ['html'] }]
    })

    if (newPath) {
      const file = new File(newPath)
      await file.write(content)
      atom.notifications.addSuccess(`Exported to ${path.basename(newPath)}`)
    }
  }

  escapeHtml(text) {
    const map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    }
    return text.replace(/[&<>"']/g, m => map[m])
  }

  // Selection adjustment helpers
  // These adjust the view's selectedCells Set when cells are inserted/deleted/moved

  /**
   * Adjust selection indices when a cell is inserted
   * @private
   */
  _adjustSelectionForInsert(insertIndex) {
    if (!this.view || this.view.selectedCells.size === 0) return

    const newSelection = new Set()
    for (const selectedIndex of this.view.selectedCells) {
      if (insertIndex <= selectedIndex) {
        newSelection.add(selectedIndex + 1)
      } else {
        newSelection.add(selectedIndex)
      }
    }
    this.view.selectedCells = newSelection
  }

  /**
   * Adjust selection indices when a cell is deleted
   * @private
   */
  _adjustSelectionForDelete(deletedIndex) {
    if (!this.view || this.view.selectedCells.size === 0) return

    const newSelection = new Set()
    for (const selectedIndex of this.view.selectedCells) {
      if (selectedIndex < deletedIndex) {
        newSelection.add(selectedIndex)
      } else if (selectedIndex > deletedIndex) {
        newSelection.add(selectedIndex - 1)
      }
      // Deleted index is simply not added to newSelection
    }
    this.view.selectedCells = newSelection
  }

  /**
   * Adjust selection indices when a cell is moved
   * @private
   */
  _adjustSelectionForMove(fromIndex, toIndex) {
    if (!this.view || this.view.selectedCells.size === 0) return

    const newSelection = new Set()
    for (const selectedIndex of this.view.selectedCells) {
      if (selectedIndex === fromIndex) {
        // The moved cell
        newSelection.add(toIndex)
      } else if (fromIndex < toIndex) {
        // Moving down: indices between fromIndex and toIndex shift up by 1
        if (selectedIndex > fromIndex && selectedIndex <= toIndex) {
          newSelection.add(selectedIndex - 1)
        } else {
          newSelection.add(selectedIndex)
        }
      } else {
        // Moving up: indices between toIndex and fromIndex shift down by 1
        if (selectedIndex >= toIndex && selectedIndex < fromIndex) {
          newSelection.add(selectedIndex + 1)
        } else {
          newSelection.add(selectedIndex)
        }
      }
    }
    this.view.selectedCells = newSelection
  }

  // Event handlers
  onDidChange(callback) {
    return this.emitter.on('did-change', callback)
  }

  onDidSave(callback) {
    return this.emitter.on('did-save', callback)
  }

  onDidDestroy(callback) {
    return this.emitter.on('did-destroy', callback)
  }

  onDidChangeTitle(callback) {
    return this.emitter.on('did-change-title', callback)
  }

  onDidConnectKernel(callback) {
    return this.emitter.on('did-connect-kernel', callback)
  }

  onDidDisconnectKernel(callback) {
    return this.emitter.on('did-disconnect-kernel', callback)
  }

  onDidChangeKernelStatus(callback) {
    return this.emitter.on('did-change-kernel-status', callback)
  }

  // Pulsar pane item interface - required for tabs to show modified indicator
  onDidChangeModified(callback) {
    return this.emitter.on('did-change-modified', callback)
  }

  destroy() {
    this._destroyed = true

    if (this.autoSaveTimeout) {
      clearTimeout(this.autoSaveTimeout)
    }

    if (this.disposables) {
      this.disposables.dispose()
    }

    if (this.emitter) {
      this.emitter.emit('did-destroy')
      this.emitter.dispose()
    }

    if (this.view) {
      this.view.destroy()
    }

    // Clean up container element
    if (this._containerElement) {
      this._containerElement.innerHTML = ''
      if (this._containerElement.parentNode) {
        this._containerElement.parentNode.removeChild(this._containerElement)
      }
    }
    this._containerElement = null

    // Release reference to document
    if (this.document) {
      this.document.release()
    }
  }
}

module.exports = JupyterNotebookEditor
