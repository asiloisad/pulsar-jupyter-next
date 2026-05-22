const { CompositeDisposable, Disposable } = require("atom");
const path = require("path");

/**
 * Jupyter Next Package
 * Provides notebook UI, navigation, and cell model editing within Pulsar.
 */

// Lazy-loaded modules
let NotebookDocumentRegistry = null;
let NotebookScrollmap = null;
let HydrogenAdapterService = null;

function getNotebookDocumentRegistry() {
  if (!NotebookDocumentRegistry) {
    NotebookDocumentRegistry = require("./notebook-document-registry");
  }
  return NotebookDocumentRegistry;
}

function getNotebookScrollmap() {
  if (!NotebookScrollmap) {
    NotebookScrollmap = require("./scrollmap-integration");
  }
  return NotebookScrollmap;
}

function getHydrogenAdapterService() {
  if (!HydrogenAdapterService) {
    HydrogenAdapterService = require("./hydrogen-adapter");
  }
  return HydrogenAdapterService;
}

/**
 * Helper to delegate a method call to the active notebook or its view
 * @param {Object} context - The module context (this)
 * @param {string} methodName - Method name to call
 * @param {boolean} useView - If true, delegate to notebook.view instead
 * @param {...any} args - Arguments to pass to the method
 */
function delegateToNotebook(context, methodName, useView = false, ...args) {
  const notebook = context.getActiveNotebook();
  if (!notebook) return;

  const target = useView ? notebook.view : notebook;
  if (target && typeof target[methodName] === "function") {
    return target[methodName](...args);
  }
}

module.exports = {
  config: require("../package.json").configSchema,

  /**
   * Activates the package and registers notebook commands.
   * @param {Object} state - Serialized state from previous session
   */
  activate() {
    this.disposables = new CompositeDisposable();
    this.documentRegistry = this.documentRegistry || null;
    this.notebookEditors = this.notebookEditors || new Set();
    this.notebookScrollmaps = this.notebookScrollmaps || new Map();
    this.Simplemap = this.Simplemap || null;
    this.workspaceOpenerDisposable = null;
    this.lastTreeViewContextPath = null;
    this.treeViewService = null;

    // Register commands
    this.disposables.add(
      atom.commands.add("atom-workspace", {
        "jupyter-next:toggle": () => this.toggle(),
        "jupyter-next:new-notebook": () => this.newNotebook(),
        "jupyter-next:open-source": () => this.openSource(),
      }),
    );

    // Register notebook-specific commands
    this.disposables.add(
      atom.commands.add("atom-workspace", {
        "jupyter-next:clear-output": () => this.clearOutput(),
        "jupyter-next:clear-all-outputs": () => this.clearAllOutputs(),
        "jupyter-next:insert-cell-above": () => this.insertCellAbove(),
        "jupyter-next:insert-cell-below": () => this.insertCellBelow(),
        "jupyter-next:insert-cell-below-and-edit": () => this.insertCellBelowAndEdit(),
        "jupyter-next:insert-cell-below-and-extend-selection": () =>
          this.insertCellBelowAndExtendSelection(),
        "jupyter-next:insert-cell-above-and-extend-selection": () =>
          this.insertCellAboveAndExtendSelection(),
        "jupyter-next:delete-cell": () => this.deleteCell(),
        "jupyter-next:move-cell-up": () => this.moveCellUp(),
        "jupyter-next:move-cell-down": () => this.moveCellDown(),
        "jupyter-next:change-cell-to-code": () => this.changeCellType("code"),
        "jupyter-next:change-cell-to-markdown": () => this.changeCellType("markdown"),
        "jupyter-next:change-cell-to-raw": () => this.changeCellType("raw"),
        "jupyter-next:toggle-cell-output": () => this.toggleCellOutput(),
        "jupyter-next:toggle-cell-input": () => this.toggleCellInput(),
        "jupyter-next:export-to-python": () => this.exportToPython(),
        "jupyter-next:export-to-html": () => this.exportToHtml(),
        // Mode switching
        "jupyter-next:enter-edit-mode": () => this.enterEditMode(),
        "jupyter-next:enter-command-mode": (event) => this.enterCommandMode(event),
        // Navigation
        "jupyter-next:focus-previous-cell": () => this.focusPreviousCell(),
        "jupyter-next:focus-next-cell": () => this.focusNextCell(),
        "jupyter-next:focus-first-cell": () => this.focusFirstCell(),
        "jupyter-next:focus-last-cell": () => this.focusLastCell(),
        "jupyter-next:select-previous-cell": () => this.selectPreviousCell(),
        "jupyter-next:select-next-cell": () => this.selectNextCell(),
        // Save
        "jupyter-next:save": () => this.save(),
        "jupyter-next:save-as": () => this.saveAs(),
        // Undo/Redo notebook edits
        "jupyter-next:undo-cell-operation": () => this.undoCellOperation(),
        "jupyter-next:redo-cell-operation": () => this.redoCellOperation(),
        // Cut/Copy/Paste cells
        "jupyter-next:cut-cell": () => this.cutCell(),
        "jupyter-next:copy-cell": () => this.copyCell(),
        "jupyter-next:paste-cell-below": () => this.pasteCellBelow(),
        "jupyter-next:paste-cell-above": () => this.pasteCellAbove(),
        // Duplicate cell
        "jupyter-next:duplicate-cell": () => this.duplicateCell(),
        // Merge cells
        "jupyter-next:merge-cell-below": () => this.mergeCellBelow(),
      }),
    );

    // Copy selected text from cell output
    this.disposables.add(
      atom.commands.add(".jupyter-output-container", {
        "jupyter-next:copy-output-selection": () => {
          const selection = window.getSelection().toString();
          if (selection) atom.clipboard.write(selection);
        },
      }),
    );

    this.disposables.add(
      atom.contextMenu.add({
        ".jupyter-output-container": [
          {
            label: "Copy",
            command: "jupyter-next:copy-output-selection",
            shouldDisplay: () => !!window.getSelection().toString(),
          },
        ],
      }),
    );

    // Map core:save and core:save-as to notebook save when a notebook is active
    // Use .jupyter-notebook-container selector to only handle saves within notebooks
    this.disposables.add(
      atom.commands.add(".jupyter-notebook-container", {
        "core:save": (event) => {
          event.stopPropagation();
          this.save();
        },
        "core:save-as": (event) => {
          event.stopPropagation();
          this.saveAs();
        },
        "core:undo": (event) => {
          event.stopPropagation();
          this.undoCellOperation();
        },
        "core:redo": (event) => {
          event.stopPropagation();
          this.redoCellOperation();
        },
      }),
    );

    this.disposables.add(
      atom.commands.add(".tree-view", {
        "jupyter-next:open-notebook": (event) => {
          event.stopPropagation();
          this.openSelectedTreeViewNotebook(event);
        },
        "jupyter-next:open-source": (event) => {
          event.stopPropagation();
          this.openSelectedTreeViewSource(event);
        },
      }),
    );

    const rememberTreeViewContextPath = (event) => {
      const fileEntry = event.target?.closest?.('.tree-view [is="tree-view-file"]');
      if (!fileEntry) return;
      this.lastTreeViewContextPath =
        fileEntry.getPath?.() || fileEntry.fileName?.dataset?.path || null;
    };
    document.addEventListener("contextmenu", rememberTreeViewContextPath, true);
    this.disposables.add(
      new Disposable(() => {
        document.removeEventListener("contextmenu", rememberTreeViewContextPath, true);
      }),
    );

    this.disposables.add(
      atom.commands.add("atom-text-editor.jupyter-cell-editor", {
        "core:undo": (event) => {
          event.stopPropagation();
          this.undoCellOperation();
        },
        "core:redo": (event) => {
          event.stopPropagation();
          this.redoCellOperation();
        },
      }),
    );

    // Scroll commands — handled on .jupyter-notebook so smooth-scroll handles
    // text editors inside cells while this handles the notebook container itself
    this.disposables.add(
      atom.commands.add(".jupyter-notebook", {
        "smooth-scroll:scroll-up": () => delegateToNotebook(this, "scrollUp", true),
        "smooth-scroll:scroll-down": () => delegateToNotebook(this, "scrollDown", true),
      }),
    );

    this.disposables.add(
      atom.config.onDidChange("jupyter-next.notebook.useOpener", ({ newValue }) => {
        if (newValue !== false) {
          this.registerWorkspaceOpener();
        } else {
          this.unregisterWorkspaceOpener();
        }
      }),
    );

    // Register opener for .ipynb files
    this.registerWorkspaceOpener();

    this.disposables.add(
      atom.workspace.onDidAddPaneItem(({ item }) => {
        this.trackNotebookEditor(item);
      }),
    );

    // Note: Notebook restoration is handled by Pulsar's workspace via the
    // JupyterNotebookEditor deserializer. We don't need to manually re-open
    // notebooks here as that would cause duplicate tabs.
    this.discoverNotebookEditors();
    requestAnimationFrame(() => this.discoverNotebookEditors());
  },

  deactivate() {
    try {
      // First, destroy notebook editors (this will trigger document cleanup)
      this.destroyNotebookScrollmaps();
      this.notebookEditors.forEach((editor) => {
        try {
          if (editor.destroy) {
            editor.destroy();
          }
        } catch (e) {
          console.error("[jupyter-next] Error destroying editor:", e);
        }
      });
      this.notebookEditors.clear();

      // Then destroy document registry
      if (this.documentRegistry) {
        try {
          this.documentRegistry.destroy();
        } catch (e) {
          console.error("[jupyter-next] Error destroying document registry:", e);
        }
        this.documentRegistry = null;
      }

      this.disposables.dispose();
      this.workspaceOpenerDisposable = null;
    } catch (e) {
      console.error("[jupyter-next] Error during deactivation:", e);
    }
  },

  serialize() {
    // Notebook editors are serialized individually by Pulsar's workspace
    // via the JupyterNotebookEditor.serialize() method.
    // We don't need to track open notebooks at the package level.
    return {};
  },

  // Deserializer for notebook editors
  deserializeNotebookEditor(state) {
    // Ensure notebookEditors set exists
    if (!this.notebookEditors) {
      this.notebookEditors = new Set();
    }
    if (!this.notebookScrollmaps) {
      this.notebookScrollmaps = new Map();
    }

    if (!state || (!state.filePath && !state.notebookData)) {
      return null;
    }

    // Use JupyterNotebookEditor's static deserialize method
    // This checks for existing editors first (to prevent reload when moving panes)
    // and returns a placeholder that loads async if creating new
    const JupyterNotebookEditor = require("./jupyter-notebook-editor");
    const editor = JupyterNotebookEditor.deserialize(state, {
      documentRegistry: this.getDocumentRegistry(),
    });

    this.trackNotebookEditor(editor);

    return editor;
  },

  // Service providers
  provideJupyter() {
    return {
      getActiveNotebook: () => this.getActiveNotebook(),
      getDocumentRegistry: () => this.getDocumentRegistry(),
    };
  },

  provideHydrogenAdapter() {
    const AdapterService = getHydrogenAdapterService();
    return new AdapterService();
  },

  provideLinterItemAdapter() {
    return {
      handlesItem: (item) => item?.constructor?.name === "JupyterNotebookEditor",
      getMessagesForItem: (item, messages) => {
        const notebookPath = item?.getPath?.();
        if (!notebookPath) return [];
        return messages.filter((message) => message.location?.file === notebookPath);
      },
      getTextEditorForItem: (item) => item.getSourceEditor(),
      getCurrentMessage: (item, messages) => item.getCurrentLinterMessage(messages),
      getNextMessage: (item, messages) => item.getNextLinterMessage(messages),
      getPreviousMessage: (item, messages) => item.getPreviousLinterMessage(messages),
      revealMessage: (item, message) => item.revealLinterMessage(message),
    };
  },

  provideNavigationAdapter() {
    return {
      handlesItem: (item) => item?.constructor?.name === "JupyterNotebookEditor",
      observeHeaders: (item, callback) => item.observeNavigationHeaders(callback),
      navigateTo: (item, header) => item.revealNavigationHeader(header),
    };
  },

  consumeTreeView(service) {
    this.treeViewService = service;
    return new Disposable(() => {
      this.treeViewService = null;
    });
  },

  useWorkspaceOpener() {
    return atom.config.get("jupyter-next.notebook.useOpener") !== false;
  },

  registerWorkspaceOpener() {
    if (!this.useWorkspaceOpener() || this.workspaceOpenerDisposable) return;

    this.workspaceOpenerDisposable = atom.workspace.addOpener((uri, options = {}) => {
      if (options.skipJupyterNextOpener) return;
      if (uri && uri.toLowerCase().endsWith(".ipynb")) {
        return this.openNotebook(uri);
      }
    });
    this.disposables.add(this.workspaceOpenerDisposable);
  },

  unregisterWorkspaceOpener() {
    if (!this.workspaceOpenerDisposable) return;
    this.workspaceOpenerDisposable.dispose();
    this.workspaceOpenerDisposable = null;
  },

  consumeSimpleMap(Simplemap) {
    this.Simplemap = Simplemap;
    this.discoverNotebookEditors();
    for (const editor of this.notebookEditors || []) {
      this.setupNotebookScrollmap(editor);
    }
    return new Disposable(() => {
      this.Simplemap = null;
      this.destroyNotebookScrollmaps();
    });
  },

  isNotebookEditor(item) {
    return item?.constructor?.name === "JupyterNotebookEditor";
  },

  discoverNotebookEditors() {
    for (const item of atom.workspace.getPaneItems()) {
      this.trackNotebookEditor(item);
    }
  },

  trackNotebookEditor(editor) {
    if (!this.isNotebookEditor(editor) || editor._destroyed) return;
    this.notebookEditors = this.notebookEditors || new Set();
    this.notebookScrollmaps = this.notebookScrollmaps || new Map();

    if (!this.notebookEditors.has(editor)) {
      this.notebookEditors.add(editor);
      editor.onDidDestroy(() => {
        this.notebookEditors.delete(editor);
        this.destroyNotebookScrollmap(editor);
      });
    }

    this.setupNotebookScrollmap(editor);
  },

  setupNotebookScrollmap(editor) {
    this.notebookScrollmaps = this.notebookScrollmaps || new Map();
    if (!this.Simplemap || !editor || this.notebookScrollmaps?.has(editor)) return;
    const ScrollmapClass = getNotebookScrollmap();
    this.notebookScrollmaps.set(editor, new ScrollmapClass(editor, this.Simplemap));
  },

  destroyNotebookScrollmap(editor) {
    const scrollmap = this.notebookScrollmaps?.get(editor);
    if (!scrollmap) return;
    scrollmap.destroy();
    this.notebookScrollmaps.delete(editor);
  },

  destroyNotebookScrollmaps() {
    for (const scrollmap of this.notebookScrollmaps?.values() || []) {
      scrollmap.destroy();
    }
    this.notebookScrollmaps?.clear();
  },

  // Core functionality
  getDocumentRegistry() {
    if (!this.documentRegistry) {
      const RegistryClass = getNotebookDocumentRegistry();
      this.documentRegistry = new RegistryClass();
    }
    return this.documentRegistry;
  },

  getActiveNotebook() {
    const item = atom.workspace.getCenter().getActivePaneItem();
    if (item && item.constructor.name === "JupyterNotebookEditor") {
      return item;
    }
    return null;
  },

  async openNotebook(uri) {
    // Check if there's already an open editor for this file
    // If so, create a copy (like split pane) to share the same document
    const normalizedUri = uri ? path.normalize(uri).toLowerCase() : null;

    if (normalizedUri) {
      // Search all pane items for an existing editor with this path
      // This includes deserialized editors that might not be in notebookEditors yet
      const JupyterNotebookEditor = require("./jupyter-notebook-editor");

      for (const paneContainer of [
        atom.workspace.getCenter(),
        atom.workspace.getLeftDock(),
        atom.workspace.getRightDock(),
        atom.workspace.getBottomDock(),
      ]) {
        if (!paneContainer) continue;
        for (const pane of paneContainer.getPanes()) {
          for (const item of pane.getItems()) {
            if (!(item instanceof JupyterNotebookEditor)) continue;
            if (item._destroyed) continue;

            const existingPath = item.getPath();
            if (existingPath && path.normalize(existingPath).toLowerCase() === normalizedUri) {
              // Found matching editor - wait for it to finish loading if needed
              if (item._loadingPromise) {
                await item._loadingPromise;
              }

              // After loading, verify editor is ready and not destroyed
              if (item._destroyed || !item.document || !item.view) {
                continue;
              }

              // Ensure it's tracked in notebookEditors
              this.trackNotebookEditor(item);

              // Create a copy that shares the document
              const editor = item.copy();
              this.trackNotebookEditor(editor);

              return editor;
            }
          }
        }
      }
    }

    // No existing ready editor found - create new one via registry
    // The registry handles document sharing at the document level
    const registry = this.getDocumentRegistry();
    const editor = await registry.buildEditor(uri);
    this.trackNotebookEditor(editor);

    return editor;
  },

  async openSource(filePath = null) {
    const sourcePath = filePath || this.getActiveNotebook()?.getPath?.();
    if (!sourcePath) return;

    if (!sourcePath.toLowerCase().endsWith(".ipynb")) {
      atom.notifications.addWarning("Can only open notebook source for .ipynb files", {
        detail: sourcePath,
        dismissable: true,
      });
      return;
    }

    const existingEditor = atom.workspace
      .getTextEditors()
      .find((editor) => editor.getPath && editor.getPath() === sourcePath);

    if (existingEditor) {
      const pane = atom.workspace.paneForItem(existingEditor);
      if (pane) {
        pane.activateItem(existingEditor);
        pane.activate();
        return existingEditor;
      }
    }

    const editor = await atom.workspace.createItemForURI(sourcePath, {
      skipJupyterNextOpener: true,
    });
    return atom.workspace.open(editor);
  },

  async openSelectedTreeViewSource(event = null) {
    const selectedPath = this.getSelectedTreeViewNotebookPath(event);
    if (!selectedPath) return;
    return this.openSource(selectedPath);
  },

  async openSelectedTreeViewNotebook(event = null) {
    const selectedPath = this.getSelectedTreeViewNotebookPath(event);
    if (!selectedPath) return;

    const editor = await this.openNotebook(selectedPath);
    const pane = atom.workspace.getCenter().getActivePane();
    pane.activateItem(editor);
    pane.activate();
    return editor;
  },

  getSelectedTreeViewNotebookPath(event = null) {
    const clickedEntry = event?.target?.closest?.('[is="tree-view-file"]');
    const clickedPath = clickedEntry?.getPath?.() || clickedEntry?.fileName?.dataset?.path;
    if (clickedPath?.toLowerCase?.().endsWith(".ipynb")) {
      return clickedPath;
    }

    if (this.lastTreeViewContextPath?.toLowerCase?.().endsWith(".ipynb")) {
      return this.lastTreeViewContextPath;
    }

    const selectedPaths = this.treeViewService?.selectedPaths?.() || [];
    const selectedPath = selectedPaths.find((entryPath) =>
      entryPath.toLowerCase().endsWith(".ipynb"),
    );

    if (!selectedPath) {
      atom.notifications.addWarning("Select a .ipynb file", {
        dismissable: true,
      });
    }

    return selectedPath;
  },

  async newNotebook() {
    const registry = this.getDocumentRegistry();
    const editor = await registry.buildEditor(null);
    this.trackNotebookEditor(editor);

    atom.workspace.getActivePane().activateItem(editor);
    return editor;
  },

  toggle() {
    const notebook = this.getActiveNotebook();
    if (notebook) {
      atom.workspace.toggle(notebook);
    } else {
      this.newNotebook();
    }
  },

  // Output operations
  clearOutput() {
    delegateToNotebook(this, "clearOutput");
  },
  clearAllOutputs() {
    delegateToNotebook(this, "clearAllOutputs");
  },

  // Cell insertion
  insertCellAbove() {
    delegateToNotebook(this, "insertCellAbove");
  },
  insertCellBelow() {
    delegateToNotebook(this, "insertCellBelow");
  },
  insertCellBelowAndEdit() {
    delegateToNotebook(this, "insertCellBelowAndEdit");
  },
  insertCellBelowAndExtendSelection() {
    delegateToNotebook(this, "insertCellBelowAndExtendSelection");
  },
  insertCellAboveAndExtendSelection() {
    delegateToNotebook(this, "insertCellAboveAndExtendSelection");
  },

  // Cell manipulation
  deleteCell() {
    delegateToNotebook(this, "deleteCell");
  },
  moveCellUp() {
    delegateToNotebook(this, "moveCellUp");
  },
  moveCellDown() {
    delegateToNotebook(this, "moveCellDown");
  },
  changeCellType(type) {
    delegateToNotebook(this, "changeCellType", false, type);
  },
  toggleCellOutput() {
    delegateToNotebook(this, "toggleCellOutput");
  },
  toggleCellInput() {
    delegateToNotebook(this, "toggleCellInput");
  },

  // Export functions
  exportToPython() {
    delegateToNotebook(this, "exportToPython");
  },
  exportToHtml() {
    delegateToNotebook(this, "exportToHtml");
  },

  // Mode switching (delegate to view)
  enterEditMode() {
    delegateToNotebook(this, "enterEditMode", true);
  },
  enterCommandMode(event) {
    if (this.shouldLetEscapeReduceCursors(event)) {
      event.abortKeyBinding();
      return;
    }
    delegateToNotebook(this, "enterCommandMode", true);
  },

  shouldLetEscapeReduceCursors(event) {
    const target = event?.target;
    const editorElement =
      target?.closest?.("atom-text-editor.jupyter-cell-editor") ||
      (target?.matches?.("atom-text-editor.jupyter-cell-editor") ? target : null);
    const editor = editorElement?.getModel?.();
    return (editor?.getCursors?.().length || 0) > 1;
  },

  // Navigation (delegate to view)
  focusPreviousCell() {
    delegateToNotebook(this, "focusPreviousCell", true);
  },
  focusNextCell() {
    delegateToNotebook(this, "focusNextCell", true);
  },
  focusFirstCell() {
    delegateToNotebook(this, "focusFirstCell", true);
  },
  focusLastCell() {
    delegateToNotebook(this, "focusLastCell", true);
  },
  selectPreviousCell() {
    delegateToNotebook(this, "selectPreviousCell", true);
  },
  selectNextCell() {
    delegateToNotebook(this, "selectNextCell", true);
  },

  // Save
  save() {
    delegateToNotebook(this, "save");
  },

  saveAs() {
    const notebook = this.getActiveNotebook();
    if (notebook) {
      // Use Pulsar's pane to show save dialog properly
      const pane = atom.workspace.paneForItem(notebook);
      if (pane) {
        pane.saveItemAs(notebook);
      }
    }
  },

  // Undo/Redo notebook edits
  undoCellOperation() {
    delegateToNotebook(this, "undoCellOperation");
  },
  redoCellOperation() {
    delegateToNotebook(this, "redoCellOperation");
  },

  // Cut/Copy/Paste cells
  cutCell() {
    delegateToNotebook(this, "cutCell");
  },
  copyCell() {
    delegateToNotebook(this, "copyCell");
  },
  pasteCellBelow() {
    delegateToNotebook(this, "pasteCellBelow");
  },
  pasteCellAbove() {
    delegateToNotebook(this, "pasteCellAbove");
  },
  duplicateCell() {
    delegateToNotebook(this, "duplicateCell");
  },

  // Merge cells
  mergeCellBelow() {
    delegateToNotebook(this, "mergeCellBelow");
  },
};
