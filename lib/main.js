const { CompositeDisposable, Disposable, File } = require('atom')
const path = require('path')

// Lazy-loaded modules
let NotebookDocumentRegistry = null
let KernelManager = null
let KernelPicker = null

function getNotebookDocumentRegistry() {
  if (!NotebookDocumentRegistry) {
    NotebookDocumentRegistry = require('./notebook-document-registry')
  }
  return NotebookDocumentRegistry
}

function getKernelManager() {
  if (!KernelManager) {
    KernelManager = require('./kernel-manager')
  }
  return KernelManager
}

function getKernelPicker() {
  if (!KernelPicker) {
    KernelPicker = require('./kernel-picker')
  }
  return KernelPicker
}

/**
 * Helper to delegate a method call to the active notebook or its view
 * @param {Object} context - The module context (this)
 * @param {string} methodName - Method name to call
 * @param {boolean} useView - If true, delegate to notebook.view instead
 * @param {...any} args - Arguments to pass to the method
 */
function delegateToNotebook(context, methodName, useView = false, ...args) {
  const notebook = context.getActiveNotebook()
  if (!notebook) return

  const target = useView ? notebook.view : notebook
  if (target && typeof target[methodName] === 'function') {
    return target[methodName](...args)
  }
}

module.exports = {
  config: require('../package.json').configSchema,

  activate(state) {
    this.disposables = new CompositeDisposable()
    this.kernelManager = null
    this.documentRegistry = null
    this.notebookEditors = new Set()

    // Disable hydrogen-next's .ipynb opener so jupyter-next handles notebooks
    // The import command remains available for users who want to convert notebooks to scripts
    atom.config.set('hydrogen-next.importNotebookURI', false)

    // Register commands
    this.disposables.add(atom.commands.add('atom-workspace', {
      'jupyter-next:toggle': () => this.toggle(),
      'jupyter-next:new-notebook': () => this.newNotebook(),
      'jupyter-next:connect-kernel': () => this.showKernelPicker(),
      'jupyter-next:disconnect-kernel': () => this.disconnectKernel(),
      'jupyter-next:restart-kernel': () => this.restartKernel(),
      'jupyter-next:interrupt-kernel': () => this.interruptKernel(),
    }))

    // Register notebook-specific commands
    this.disposables.add(atom.commands.add('atom-workspace', {
      'jupyter-next:run-cell': () => this.runCell(),
      'jupyter-next:run-cell-and-advance': () => this.runCellAndAdvance(),
      'jupyter-next:run-all-cells': () => this.runAllCells(),
      'jupyter-next:run-all-above': () => this.runAllAbove(),
      'jupyter-next:run-all-below': () => this.runAllBelow(),
      'jupyter-next:clear-output': () => this.clearOutput(),
      'jupyter-next:clear-all-outputs': () => this.clearAllOutputs(),
      'jupyter-next:insert-cell-above': () => this.insertCellAbove(),
      'jupyter-next:insert-cell-below': () => this.insertCellBelow(),
      'jupyter-next:insert-cell-below-and-extend-selection': () => this.insertCellBelowAndExtendSelection(),
      'jupyter-next:insert-cell-above-and-extend-selection': () => this.insertCellAboveAndExtendSelection(),
      'jupyter-next:delete-cell': () => this.deleteCell(),
      'jupyter-next:move-cell-up': () => this.moveCellUp(),
      'jupyter-next:move-cell-down': () => this.moveCellDown(),
      'jupyter-next:change-cell-to-code': () => this.changeCellType('code'),
      'jupyter-next:change-cell-to-markdown': () => this.changeCellType('markdown'),
      'jupyter-next:change-cell-to-raw': () => this.changeCellType('raw'),
      'jupyter-next:toggle-cell-output': () => this.toggleCellOutput(),
      'jupyter-next:toggle-cell-input': () => this.toggleCellInput(),
      'jupyter-next:export-to-python': () => this.exportToPython(),
      'jupyter-next:export-to-html': () => this.exportToHtml(),
      // Mode switching
      'jupyter-next:enter-edit-mode': () => this.enterEditMode(),
      'jupyter-next:enter-command-mode': () => this.enterCommandMode(),
      // Navigation
      'jupyter-next:focus-previous-cell': () => this.focusPreviousCell(),
      'jupyter-next:focus-next-cell': () => this.focusNextCell(),
      'jupyter-next:focus-first-cell': () => this.focusFirstCell(),
      'jupyter-next:focus-last-cell': () => this.focusLastCell(),
      // Save
      'jupyter-next:save': () => this.save(),
      'jupyter-next:save-as': () => this.saveAs(),
      // Undo/Redo cell operations
      'jupyter-next:undo-cell-operation': () => this.undoCellOperation(),
      'jupyter-next:redo-cell-operation': () => this.redoCellOperation(),
      // Cut/Copy/Paste cells
      'jupyter-next:cut-cell': () => this.cutCell(),
      'jupyter-next:copy-cell': () => this.copyCell(),
      'jupyter-next:paste-cell-below': () => this.pasteCellBelow(),
      'jupyter-next:paste-cell-above': () => this.pasteCellAbove(),
      // Duplicate cell
      'jupyter-next:duplicate-cell': () => this.duplicateCell(),
      // Merge cells
      'jupyter-next:merge-cell-below': () => this.mergeCellBelow(),
      // Pane split/copy commands
      'jupyter-next:split-left': () => this.splitPane('horizontal', 'before'),
      'jupyter-next:split-right': () => this.splitPane('horizontal', 'after'),
      'jupyter-next:split-up': () => this.splitPane('vertical', 'before'),
      'jupyter-next:split-down': () => this.splitPane('vertical', 'after'),
      'jupyter-next:split-left-and-copy': () => this.splitPane('horizontal', 'before', true),
      'jupyter-next:split-right-and-copy': () => this.splitPane('horizontal', 'after', true),
      'jupyter-next:split-up-and-copy': () => this.splitPane('vertical', 'before', true),
      'jupyter-next:split-down-and-copy': () => this.splitPane('vertical', 'after', true),
    }))

    // Map core:save and core:save-as to notebook save when a notebook is active
    // Use .jupyter-notebook-container selector to only handle saves within notebooks
    this.disposables.add(atom.commands.add('.jupyter-notebook-container', {
      'core:save': (event) => {
        event.stopPropagation()
        this.save()
      },
      'core:save-as': (event) => {
        event.stopPropagation()
        this.saveAs()
      }
    }))

    // Register opener for .ipynb files
    this.disposables.add(atom.workspace.addOpener((uri) => {
      if (uri && uri.toLowerCase().endsWith('.ipynb')) {
        return this.openNotebook(uri)
      }
    }))

    // Note: Notebook restoration is handled by Pulsar's workspace via the
    // JupyterNotebookEditor deserializer. We don't need to manually re-open
    // notebooks here as that would cause duplicate tabs.
  },

  deactivate() {
    try {
      // First, destroy notebook editors (this will trigger document cleanup)
      this.notebookEditors.forEach(editor => {
        try {
          if (editor.destroy) {
            editor.destroy()
          }
        } catch (e) {
          console.error('[jupyter-next] Error destroying editor:', e)
        }
      })
      this.notebookEditors.clear()

      // Then destroy document registry (disconnects kernels from documents)
      if (this.documentRegistry) {
        try {
          this.documentRegistry.destroy()
        } catch (e) {
          console.error('[jupyter-next] Error destroying document registry:', e)
        }
        this.documentRegistry = null
      }

      // Finally shutdown all kernels after documents are disconnected
      if (this.kernelManager) {
        try {
          this.kernelManager.shutdownAll()
          this.kernelManager.destroy()
        } catch (e) {
          console.error('[jupyter-next] Error shutting down kernel manager:', e)
        }
        this.kernelManager = null
      }

      this.disposables.dispose()
    } catch (e) {
      console.error('[jupyter-next] Error during deactivation:', e)
    }
  },

  serialize() {
    // Notebook editors are serialized individually by Pulsar's workspace
    // via the JupyterNotebookEditor.serialize() method.
    // We don't need to track open notebooks at the package level.
    return {}
  },

  // Deserializer for notebook editors
  deserializeNotebookEditor(state) {
    // Ensure notebookEditors set exists
    if (!this.notebookEditors) {
      this.notebookEditors = new Set()
    }

    if (!state || (!state.filePath && !state.notebookData)) {
      return null
    }

    // Use JupyterNotebookEditor's static deserialize method
    // This checks for existing editors first (to prevent reload when moving panes)
    // and returns a placeholder that loads async if creating new
    const JupyterNotebookEditor = require('./jupyter-notebook-editor')
    const editor = JupyterNotebookEditor.deserialize(state)

    // Only track new editors (not existing ones being reused)
    if (!this.notebookEditors.has(editor)) {
      this.notebookEditors.add(editor)
      editor.onDidDestroy(() => {
        this.notebookEditors.delete(editor)
      })
    }

    return editor
  },

  // Service providers
  provideJupyter() {
    return {
      getKernelManager: () => this.getKernelManager(),
      getActiveNotebook: () => this.getActiveNotebook(),
      getDocumentRegistry: () => this.getDocumentRegistry(),
      runCode: (code, kernelName) => this.runCode(code, kernelName),
      onDidChangeKernelStatus: (callback) => {
        const km = this.getKernelManager()
        return km.onDidChangeStatus(callback)
      }
    }
  },

  // Core functionality
  getKernelManager() {
    if (!this.kernelManager) {
      const KernelManagerClass = getKernelManager()
      this.kernelManager = new KernelManagerClass()
    }
    return this.kernelManager
  },

  getDocumentRegistry() {
    if (!this.documentRegistry) {
      const RegistryClass = getNotebookDocumentRegistry()
      this.documentRegistry = new RegistryClass(this.getKernelManager())
    }
    return this.documentRegistry
  },

  getActiveNotebook() {
    const item = atom.workspace.getActivePaneItem()
    if (item && item.constructor.name === 'JupyterNotebookEditor') {
      return item
    }
    return null
  },

  async openNotebook(uri) {
    // Check if there's already an open editor for this file
    // If so, create a copy (like split pane) to share the same document
    const normalizedUri = uri ? path.normalize(uri).toLowerCase() : null

    if (normalizedUri) {
      // Search all pane items for an existing editor with this path
      // This includes deserialized editors that might not be in notebookEditors yet
      const JupyterNotebookEditor = require('./jupyter-notebook-editor')

      for (const paneContainer of [atom.workspace.getCenter(), atom.workspace.getLeftDock(), atom.workspace.getRightDock(), atom.workspace.getBottomDock()]) {
        if (!paneContainer) continue
        for (const pane of paneContainer.getPanes()) {
          for (const item of pane.getItems()) {
            if (!(item instanceof JupyterNotebookEditor)) continue
            if (item._destroyed) continue

            const existingPath = item.getPath()
            if (existingPath && path.normalize(existingPath).toLowerCase() === normalizedUri) {
              // Found matching editor - wait for it to finish loading if needed
              if (item._loadingPromise) {
                await item._loadingPromise
              }

              // After loading, verify editor is ready and not destroyed
              if (item._destroyed || !item.document || !item.view) {
                continue
              }

              // Ensure it's tracked in notebookEditors
              if (!this.notebookEditors.has(item)) {
                this.notebookEditors.add(item)
                item.onDidDestroy(() => {
                  this.notebookEditors.delete(item)
                })
              }

              // Create a copy that shares the document
              const editor = item.copy()

              this.notebookEditors.add(editor)

              editor.onDidDestroy(() => {
                this.notebookEditors.delete(editor)
              })

              return editor
            }
          }
        }
      }
    }

    // No existing ready editor found - create new one via registry
    // The registry handles document sharing at the document level
    const registry = this.getDocumentRegistry()
    const editor = await registry.buildEditor(uri)

    this.notebookEditors.add(editor)

    editor.onDidDestroy(() => {
      this.notebookEditors.delete(editor)
    })

    return editor
  },

  async newNotebook() {
    const registry = this.getDocumentRegistry()
    const editor = await registry.buildEditor(null)

    this.notebookEditors.add(editor)

    editor.onDidDestroy(() => {
      this.notebookEditors.delete(editor)
    })

    atom.workspace.getActivePane().activateItem(editor)
    return editor
  },

  toggle() {
    const notebook = this.getActiveNotebook()
    if (notebook) {
      atom.workspace.toggle(notebook)
    } else {
      this.newNotebook()
    }
  },

  async showKernelPicker() {
    const notebook = this.getActiveNotebook()
    const KernelPickerClass = getKernelPicker()

    // Pass preferred kernel name and language from notebook metadata
    // Language is used to filter kernels (like hydrogen-next's grammar filtering)
    const metadata = notebook?.document?.metadata
    const preferredKernelName = metadata?.kernelspec?.name || null
    const language = metadata?.kernelspec?.language || metadata?.language_info?.name || null
    const picker = new KernelPickerClass(this.getKernelManager(), { preferredKernelName, language })

    const kernelSpec = await picker.show()
    if (kernelSpec && notebook) {
      await notebook.connectToKernel(kernelSpec)
    }
  },

  // Kernel operations
  disconnectKernel() { delegateToNotebook(this, 'disconnectKernel') },
  restartKernel() { delegateToNotebook(this, 'restartKernel') },
  interruptKernel() { delegateToNotebook(this, 'interruptKernel') },

  // Cell execution
  runCell() { delegateToNotebook(this, 'runCell') },
  runCellAndAdvance() { delegateToNotebook(this, 'runCellAndAdvance') },
  runAllCells() { delegateToNotebook(this, 'runAllCells') },
  runAllAbove() { delegateToNotebook(this, 'runAllAbove') },
  runAllBelow() { delegateToNotebook(this, 'runAllBelow') },

  // Output operations
  clearOutput() { delegateToNotebook(this, 'clearOutput') },
  clearAllOutputs() { delegateToNotebook(this, 'clearAllOutputs') },

  // Cell insertion
  insertCellAbove() { delegateToNotebook(this, 'insertCellAbove') },
  insertCellBelow() { delegateToNotebook(this, 'insertCellBelow') },
  insertCellBelowAndExtendSelection() { delegateToNotebook(this, 'insertCellBelowAndExtendSelection') },
  insertCellAboveAndExtendSelection() { delegateToNotebook(this, 'insertCellAboveAndExtendSelection') },

  // Cell manipulation
  deleteCell() { delegateToNotebook(this, 'deleteCell') },
  moveCellUp() { delegateToNotebook(this, 'moveCellUp') },
  moveCellDown() { delegateToNotebook(this, 'moveCellDown') },
  changeCellType(type) { delegateToNotebook(this, 'changeCellType', false, type) },
  toggleCellOutput() { delegateToNotebook(this, 'toggleCellOutput') },
  toggleCellInput() { delegateToNotebook(this, 'toggleCellInput') },

  // Export functions
  exportToPython() { delegateToNotebook(this, 'exportToPython') },
  exportToHtml() { delegateToNotebook(this, 'exportToHtml') },

  // Mode switching (delegate to view)
  enterEditMode() { delegateToNotebook(this, 'enterEditMode', true) },
  enterCommandMode() { delegateToNotebook(this, 'enterCommandMode', true) },

  // Navigation (delegate to view)
  focusPreviousCell() { delegateToNotebook(this, 'focusPreviousCell', true) },
  focusNextCell() { delegateToNotebook(this, 'focusNextCell', true) },
  focusFirstCell() { delegateToNotebook(this, 'focusFirstCell', true) },
  focusLastCell() { delegateToNotebook(this, 'focusLastCell', true) },

  // Save
  save() { delegateToNotebook(this, 'save') },

  saveAs() {
    const notebook = this.getActiveNotebook()
    if (notebook) {
      // Use Pulsar's pane to show save dialog properly
      const pane = atom.workspace.paneForItem(notebook)
      if (pane) {
        pane.saveItemAs(notebook)
      }
    }
  },

  // Undo/Redo cell operations
  undoCellOperation() { delegateToNotebook(this, 'undoCellOperation') },
  redoCellOperation() { delegateToNotebook(this, 'redoCellOperation') },

  // Cut/Copy/Paste cells
  cutCell() { delegateToNotebook(this, 'cutCell') },
  copyCell() { delegateToNotebook(this, 'copyCell') },
  pasteCellBelow() { delegateToNotebook(this, 'pasteCellBelow') },
  pasteCellAbove() { delegateToNotebook(this, 'pasteCellAbove') },
  duplicateCell() { delegateToNotebook(this, 'duplicateCell') },

  // Merge cells
  mergeCellBelow() { delegateToNotebook(this, 'mergeCellBelow') },

  /**
   * Split the pane containing the active notebook.
   *
   * @param {string} orientation - 'horizontal' or 'vertical'
   * @param {string} side - 'before' or 'after'
   * @param {boolean} copyItem - Whether to copy the item to the new pane
   */
  splitPane(orientation, side, copyItem = false) {
    const notebook = this.getActiveNotebook()
    if (!notebook) return

    const pane = atom.workspace.paneForItem(notebook)
    if (!pane) return

    // For copyActiveItem to work, the notebook must be the active item in the pane.
    pane.activateItem(notebook)

    // Split the pane with copyActiveItem option
    const params = { copyActiveItem: copyItem }

    if (orientation === 'horizontal') {
      side === 'before' ? pane.splitLeft(params) : pane.splitRight(params)
    } else {
      side === 'before' ? pane.splitUp(params) : pane.splitDown(params)
    }
  },

  // Run arbitrary code
  async runCode(code, kernelName = 'python3') {
    const km = this.getKernelManager()
    const kernel = await km.getOrStartKernel(kernelName)
    if (kernel) {
      return kernel.execute(code)
    }
    throw new Error(`Could not start kernel: ${kernelName}`)
  }
}
