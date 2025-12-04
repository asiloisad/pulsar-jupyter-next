/**
 * CellView - DOM-based component for rendering Jupyter notebook cells
 */

const OutputView = require("./output-view");

/**
 * CellView manages rendering of a single notebook cell.
 * Uses plain DOM for reliable editor integration.
 */
class CellView {
  constructor(props) {
    this.props = props;
    this.editorElement = null;
    this.editor = null;
    this.outputView = null;
    this.dragHandle = null;
    this.editorContainer = null;
    this.outputContainer = null;
    this.contentElement = null;
    this._lastKnownSource = props.cell ? props.cell.source : "";
    this._lastKnownType = props.cell ? props.cell.type : "code"; // Track cell type for change detection
    this._editorIsDirty = false; // Track if editor has unsaved changes
    this._updatingFromExternal = false; // Guard against feedback loops when syncing from other editors

    // Cached DOM element references for efficient updates
    this._cachedElements = {
      execCount: null,
      timeIndicator: null,
      gutter: null,
    };
    // Cache last known values to avoid unnecessary DOM updates
    this._lastState = {
      classes: "",
      execCountText: "",
      timeStr: "",
      inputVisible: true,
    };

    this.element = document.createElement("div");
    this.render();
    this.setupEditor();
    this.setupDragAndDrop();
    this.setupClickHandler();
  }

  setupClickHandler() {
    // Handle click on the cell element for selection
    this.element.addEventListener("click", (event) => {
      // Don't handle clicks that are inside the editor (those go to edit mode)
      const isEditor = event.target.closest("atom-text-editor");
      if (isEditor) return;

      // Call the onCellSelect callback with the event for modifier key handling
      if (this.props.onCellSelect) {
        this.props.onCellSelect(event);
      }
    });
  }

  render() {
    const { cell, index, active, editor } = this.props;
    const showCellNumbers = atom.config.get(
      "jupyter-next.notebook.showCellNumbers"
    );

    // Set classes on the main element and cache for efficient updates
    const classes = this.getCellClasses();
    this.element.className = classes;
    this._lastState.classes = classes;
    this.element.setAttribute("data-cell-id", cell.id);

    // Reset cached element references for new render
    this._cachedElements = {
      execCount: null,
      timeIndicator: null,
      gutter: null,
    };
    this._lastState.inputVisible = cell.inputVisible !== false;

    // Clear existing content but preserve editor if it exists
    const existingEditor = this.editorElement;
    this.element.innerHTML = "";

    // Cell gutter (drag handle)
    const gutter = document.createElement("div");
    gutter.className = "cell-gutter";
    gutter.draggable = true;
    gutter.title = "Drag to reorder";
    this.dragHandle = gutter;
    this._cachedElements.gutter = gutter;

    if (cell.type === "code" && showCellNumbers) {
      const execCount = document.createElement("span");
      execCount.className = "execution-count";
      const execText = this.getExecutionCountText();
      execCount.textContent = execText;
      this._lastState.execCountText = execText;
      gutter.appendChild(execCount);
      this._cachedElements.execCount = execCount;
    }

    // Only show type indicator for non-code cells (code cells have execution count)
    if (cell.type !== "code") {
      const typeIndicator = document.createElement("div");
      typeIndicator.className = "cell-type-indicator";
      typeIndicator.textContent = cell.type === "markdown" ? "md" : "raw";
      gutter.appendChild(typeIndicator);
    }

    // Show execution time for code cells
    if (cell.type === "code") {
      const timeStr = cell.getFormattedExecutionTime();
      this._lastState.timeStr = timeStr || "";
      if (timeStr) {
        const timeIndicator = document.createElement("div");
        timeIndicator.className = "cell-execution-time";
        timeIndicator.textContent = timeStr;
        gutter.appendChild(timeIndicator);
        this._cachedElements.timeIndicator = timeIndicator;
      }
    }

    this.element.appendChild(gutter);

    // Cell content
    const content = document.createElement("div");
    content.className = "cell-content";

    // Input area
    const inputArea = document.createElement("div");
    inputArea.className = "cell-input";
    this.inputArea = inputArea;

    // Hide input area if inputVisible is false
    if (cell.inputVisible === false) {
      inputArea.style.display = "none";
    }

    if (cell.type === "markdown" && !active) {
      // Rendered markdown
      const mdRendered = document.createElement("div");
      mdRendered.className = "markdown-rendered";
      mdRendered.innerHTML = this.renderMarkdown(cell.source);
      mdRendered.addEventListener("dblclick", () => {
        if (this.props.onFocus) this.props.onFocus();
        if (this.props.onEnterEditMode) this.props.onEnterEditMode();
      });
      inputArea.appendChild(mdRendered);
      this.editorContainer = null;
    } else {
      // Editor container
      this.editorContainer = document.createElement("div");
      this.editorContainer.className = "cell-editor-container";
      inputArea.appendChild(this.editorContainer);

      // Re-attach existing editor if we have one
      if (existingEditor && this.editor) {
        this.editorContainer.appendChild(existingEditor);
      }
    }
    content.appendChild(inputArea);

    // Store reference to content for dynamic output container management
    this.contentElement = content;

    this.element.appendChild(content);

    // Cell actions (shown on hover)
    const actions = document.createElement("div");
    actions.className = "cell-actions";

    const runBtn = document.createElement("button");
    runBtn.className = "btn btn-xs icon icon-playback-play";
    runBtn.title = "Run Cell";
    runBtn.onclick = (e) => {
      e.stopPropagation();
      if (editor) editor.runCell();
    };
    actions.appendChild(runBtn);

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "btn btn-xs icon icon-trashcan";
    deleteBtn.title = "Delete Cell";
    deleteBtn.onclick = (e) => {
      e.stopPropagation();
      if (editor) editor.deleteCell();
    };
    actions.appendChild(deleteBtn);

    this.element.appendChild(actions);

    // Render outputs
    this.renderOutputs();
  }

  getCellClasses() {
    const { cell, active, selected } = this.props;
    return [
      "jupyter-cell",
      `jupyter-cell-${cell.type}`,
      active ? "active" : "",
      selected ? "selected" : "",
      cell.running ? "running" : "",
      cell.status === "error" ? "error" : "",
    ]
      .filter(Boolean)
      .join(" ");
  }

  getExecutionCountText() {
    const { cell } = this.props;
    if (cell.running) return "[*]";
    if (cell.executionCount) {
      const hasOutput = cell.outputs && cell.outputs.length > 0;
      const hasError =
        cell.outputs && cell.outputs.some((o) => o.output_type === "error");
      if (hasError) {
        // Show X if cell execution failed
        return `✘ [${cell.executionCount}]`;
      }
      if (!hasOutput) {
        // Show checkmark if cell executed successfully without producing output
        return `✔ [${cell.executionCount}]`;
      }
      return `[${cell.executionCount}]`;
    }
    return "[ ]";
  }

  renderOutputs() {
    // Cancel any pending render
    if (this._outputRenderFrame) {
      cancelAnimationFrame(this._outputRenderFrame);
      this._outputRenderFrame = null;
    }

    // Defer output rendering to next frame to avoid focus loss
    // React's render() can steal focus, so we defer it
    this._outputRenderFrame = requestAnimationFrame(() => {
      this._outputRenderFrame = null;
      this._doRenderOutputs();
    });
  }

  _doRenderOutputs() {
    const { cell } = this.props;

    if (!this.contentElement) return;

    // Filter outputs to only include displayable ones
    // Exclude status, execute_input, and other non-displayable output types
    const displayableOutputs = (cell.outputs || []).filter((output) => {
      const type = output.output_type;
      // Only include stream, execute_result, display_data, and error outputs
      return (
        type === "stream" ||
        type === "execute_result" ||
        type === "display_data" ||
        type === "error"
      );
    });

    // Only render outputs for code cells with visible, displayable outputs
    if (
      cell.type === "code" &&
      displayableOutputs.length > 0 &&
      cell.outputVisible !== false
    ) {
      // Create output container if it doesn't exist
      if (!this.outputContainer) {
        this.outputContainer = document.createElement("div");
        this.outputContainer.className = "cell-output-container";
        this.contentElement.appendChild(this.outputContainer);
      }

      if (this.outputView) {
        // Update existing output view in place to avoid focus loss
        this.outputView.update({
          outputs: displayableOutputs,
          maxHeight: atom.config.get("jupyter-next.maxOutputHeight"),
        });
      } else {
        // Create new output view
        this.outputView = new OutputView({
          outputs: displayableOutputs,
          maxHeight: atom.config.get("jupyter-next.maxOutputHeight"),
        });
        this.outputContainer.innerHTML = "";
        this.outputContainer.appendChild(this.outputView.element);
      }
    } else {
      // Clean up output view and container if no outputs
      if (this.outputView) {
        this.outputView.destroy();
        this.outputView = null;
      }
      if (this.outputContainer) {
        this.outputContainer.remove();
        this.outputContainer = null;
      }
    }
  }

  setupEditor() {
    const { cell } = this.props;

    // Don't set up editor for rendered markdown
    if (cell.type === "markdown" && !this.props.active) {
      return;
    }

    if (!this.editorContainer) return;

    // Don't recreate editor if it already exists
    if (this.editor && this.editorElement) {
      if (!this.editorContainer.contains(this.editorElement)) {
        this.editorContainer.appendChild(this.editorElement);
      }
      return;
    }

    // Create a text editor
    this.editor = atom.workspace.buildTextEditor({
      mini: false,
      lineNumberGutterVisible: true,
      softWrapped: atom.config.get("jupyter-next.wordWrap"),
      autoHeight: true,
    });

    this.editor.setText(cell.source);

    // Apply syntax highlighting grammar
    this.applyGrammar();

    // Get the editor element
    this.editorElement = atom.views.getView(this.editor);
    this.editorElement.classList.add("jupyter-cell-editor");

    // Add to container
    this.editorContainer.appendChild(this.editorElement);

    // Listen for changes - track dirty state to avoid race conditions
    this.editorChangeSubscription = this.editor.onDidChange(() => {
      this._editorIsDirty = true;
    });

    this.editorSubscription = this.editor.onDidStopChanging(() => {
      // Don't trigger source change if we're updating from external source
      if (this._updatingFromExternal) {
        this._updatingFromExternal = false;
        this._editorIsDirty = false;
        return;
      }
      const source = this.editor.getText();
      // Only trigger source change if the source actually changed from last known
      const sourceChanged = source !== this._lastKnownSource;
      this._lastKnownSource = source;
      this._editorIsDirty = false;
      if (sourceChanged && this.props.onSourceChange) {
        this.props.onSourceChange(source);
      }
    });

    // Handle click on editor to enter edit mode and focus
    this.editorElement.addEventListener("mousedown", (e) => {
      if (this.props.onFocus) this.props.onFocus();
      if (this.props.onEnterEditMode) this.props.onEnterEditMode();
    });

    // Handle cursor movement for cell navigation
    this.setupCellNavigation();
  }

  /**
   * Set up keyboard navigation between cells when cursor is at first/last row
   */
  setupCellNavigation() {
    if (!this.editorElement) return;

    this.editorElement.addEventListener("keydown", (e) => {
      // Only handle arrow keys
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;

      // Don't interfere with selection or modified keys
      if (e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;

      const cursor = this.editor.getCursorBufferPosition();
      const lastRow = this.editor.getLastBufferRow();

      if (e.key === "ArrowUp" && cursor.row === 0) {
        // Cursor is on first row and trying to move up
        if (this.props.onNavigateToPreviousCell) {
          e.preventDefault();
          e.stopPropagation();
          this.props.onNavigateToPreviousCell();
        }
      } else if (e.key === "ArrowDown" && cursor.row === lastRow) {
        // Cursor is on last row and trying to move down
        if (this.props.onNavigateToNextCell) {
          e.preventDefault();
          e.stopPropagation();
          this.props.onNavigateToNextCell();
        }
      }
    });
  }

  setupDragAndDrop() {
    // Make the cell a valid drop target
    this.element.addEventListener("dragover", this.handleDragOver.bind(this));
    this.element.addEventListener("dragenter", this.handleDragEnter.bind(this));
    this.element.addEventListener("dragleave", this.handleDragLeave.bind(this));
    this.element.addEventListener("drop", this.handleDrop.bind(this));

    // Handle drag start on the gutter/drag handle
    if (this.dragHandle) {
      this.dragHandle.addEventListener(
        "dragstart",
        this.handleDragStart.bind(this)
      );
      this.dragHandle.addEventListener(
        "dragend",
        this.handleDragEnd.bind(this)
      );
    }
  }

  handleDragStart(event) {
    const { cell, index, notebookView } = this.props;

    // Get selected cells from notebook view, or just use this cell's index
    let selectedIndices = [index];
    if (notebookView) {
      const selected = notebookView.getSelectedCells();
      // If current cell is in selection, drag all selected cells
      // Otherwise, just drag this cell
      if (selected.length > 0 && selected.includes(index)) {
        selectedIndices = selected;
      }
    }

    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(
      "text/plain",
      JSON.stringify({
        cellId: cell.id,
        fromIndex: index,
        selectedIndices: selectedIndices,
      })
    );

    // Add dragging class to all selected cells
    if (notebookView && selectedIndices.length > 1) {
      const cells = this.props.editor?.document?.cells || [];
      selectedIndices.forEach((i) => {
        const cellView = notebookView.cellViews.get(cells[i]?.id);
        if (cellView && cellView.element) {
          cellView.element.classList.add("dragging");
        }
      });
    } else {
      this.element.classList.add("dragging");
    }

    if (notebookView) {
      notebookView.setDraggingCell(index);
    }
  }

  handleDragEnd(event) {
    // Remove dragging class from all cells
    const cells = document.querySelectorAll(".jupyter-cell");
    cells.forEach((cell) => {
      cell.classList.remove("dragging", "drop-above", "drop-below");
    });

    if (this.props.notebookView) {
      this.props.notebookView.setDraggingCell(null);
    }
  }

  handleDragOver(event) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";

    const rect = this.element.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;

    this.element.classList.remove("drop-above", "drop-below");
    if (event.clientY < midY) {
      this.element.classList.add("drop-above");
    } else {
      this.element.classList.add("drop-below");
    }
  }

  handleDragEnter(event) {
    event.preventDefault();
  }

  handleDragLeave(event) {
    if (!this.element.contains(event.relatedTarget)) {
      this.element.classList.remove("drop-above", "drop-below");
    }
  }

  handleDrop(event) {
    event.preventDefault();

    this.element.classList.remove("drop-above", "drop-below");

    try {
      const data = JSON.parse(event.dataTransfer.getData("text/plain"));
      const selectedIndices = data.selectedIndices || [data.fromIndex];
      const { index: toIndex, editor, notebookView } = this.props;

      if (selectedIndices.length === 0) {
        return;
      }

      // Don't drop onto a cell that's being dragged
      if (selectedIndices.includes(toIndex)) {
        return;
      }

      const rect = this.element.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      const dropAbove = event.clientY < midY;

      let targetIndex = dropAbove ? toIndex : toIndex + 1;

      if (editor) {
        if (selectedIndices.length === 1) {
          // Single cell move
          const fromIndex = selectedIndices[0];
          if (fromIndex < targetIndex) {
            targetIndex--;
          }
          if (fromIndex !== targetIndex) {
            editor.moveCell(fromIndex, targetIndex);
          }
        } else {
          // Multiple cells move - move them as a group
          editor.moveCells(selectedIndices, targetIndex);
        }

        // Clear selection after move
        if (notebookView) {
          notebookView.clearSelection();
        }
      }
    } catch (e) {
      console.error("Drop error:", e);
    }
  }

  applyGrammar() {
    if (!this.editor) return;

    const { cell } = this.props;
    let grammar = null;
    let targetScopes = null;

    if (cell.type === "markdown") {
      targetScopes = ["source.gfm", "text.md", "text.md.basic"];
    } else if (cell.type === "code") {
      // Get language from kernel if connected, otherwise fall back to notebook metadata
      const document = this.props.editor?.document;
      const language =
        document?.kernel?.language ||
        document?.metadata?.language_info?.name ||
        document?.metadata?.kernelspec?.language ||
        "python";

      const grammarScopes = {
        python: ["source.python", "text.python"],
        javascript: ["source.js", "source.javascript"],
        typescript: ["source.ts", "source.typescript"],
        r: ["source.r"],
        julia: ["source.julia"],
        ruby: ["source.ruby"],
        go: ["source.go"],
        rust: ["source.rust"],
        c: ["source.c"],
        cpp: ["source.cpp", "source.c++"],
        java: ["source.java"],
        scala: ["source.scala"],
        sql: ["source.sql"],
      };

      targetScopes = grammarScopes[language.toLowerCase()] || [
        `source.${language.toLowerCase()}`,
      ];
    }

    if (targetScopes) {
      for (const scope of targetScopes) {
        grammar = atom.grammars.grammarForScopeName(scope);
        if (grammar) break;
      }
    }

    if (grammar) {
      this.editor.setGrammar(grammar);
    } else if (targetScopes && !this._grammarRetryScheduled) {
      // Grammar not found - might not be loaded yet during restore
      // Schedule a retry after grammars are loaded
      this._grammarRetryScheduled = true;
      const disposable = atom.grammars.onDidAddGrammar(() => {
        disposable.dispose();
        this._grammarRetryScheduled = false;
        this.applyGrammar();
      });
      // Also try again after a short delay as a fallback
      setTimeout(() => {
        if (this._grammarRetryScheduled && this.editor) {
          this._grammarRetryScheduled = false;
          disposable.dispose();
          this.applyGrammar();
        }
      }, 1000);
    }
  }

  renderMarkdown(source) {
    try {
      const marked = require("marked");
      return marked.parse(source || "");
    } catch (e) {
      return this.simpleMarkdown(source || "");
    }
  }

  simpleMarkdown(text) {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/^### (.+)$/gm, "<h3>$1</h3>")
      .replace(/^## (.+)$/gm, "<h2>$1</h2>")
      .replace(/^# (.+)$/gm, "<h1>$1</h1>")
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      .replace(/`(.+?)`/g, "<code>$1</code>")
      .replace(/\n/g, "<br>");
  }

  update(props) {
    const oldProps = this.props;
    this.props = { ...this.props, ...props };

    // Check if we need to rebuild (type changed, or markdown active state changed)
    // Use _lastKnownType since the cell object is mutated in place
    const typeChanged = this._lastKnownType !== props.cell.type;
    const needsRebuild =
      typeChanged ||
      (props.cell.type === "markdown" && oldProps.active !== props.active);

    if (needsRebuild) {
      // Cleanup old editor
      if (this.editor) {
        if (this.editorChangeSubscription) {
          this.editorChangeSubscription.dispose();
          this.editorChangeSubscription = null;
        }
        if (this.editorSubscription) {
          this.editorSubscription.dispose();
          this.editorSubscription = null;
        }
        this.editor.destroy();
        this.editor = null;
        this.editorElement = null;
      }
      this._lastKnownSource = props.cell ? props.cell.source : "";
      this._lastKnownType = props.cell ? props.cell.type : "code";
      this._editorIsDirty = false;

      this.render();
      this.setupEditor();
      this.setupDragAndDrop();
    } else {
      // Granular updates - only update what actually changed

      // Update classes only if changed
      const newClasses = this.getCellClasses();
      if (this._lastState.classes !== newClasses) {
        this.element.className = newClasses;
        this._lastState.classes = newClasses;
      }

      // Update execution count only if changed (use cached element)
      if (this._cachedElements.execCount) {
        const execText = this.getExecutionCountText();
        if (this._lastState.execCountText !== execText) {
          this._cachedElements.execCount.textContent = execText;
          this._lastState.execCountText = execText;
        }
      }

      // Update execution time for code cells (use cached elements)
      if (props.cell.type === "code") {
        const timeStr = props.cell.getFormattedExecutionTime() || "";

        if (this._lastState.timeStr !== timeStr) {
          if (timeStr) {
            if (!this._cachedElements.timeIndicator) {
              // Create the time indicator if it doesn't exist
              const timeIndicator = document.createElement("div");
              timeIndicator.className = "cell-execution-time";
              this._cachedElements.gutter.appendChild(timeIndicator);
              this._cachedElements.timeIndicator = timeIndicator;
            }
            this._cachedElements.timeIndicator.textContent = timeStr;
          } else if (this._cachedElements.timeIndicator) {
            // Remove the time indicator if there's no time to display
            this._cachedElements.timeIndicator.remove();
            this._cachedElements.timeIndicator = null;
          }
          this._lastState.timeStr = timeStr;
        }
      }

      // Update input area visibility only if changed (use cached inputArea)
      const newInputVisible = props.cell.inputVisible !== false;
      if (this._lastState.inputVisible !== newInputVisible) {
        if (this.inputArea) {
          this.inputArea.style.display = newInputVisible ? "" : "none";
        }
        this._lastState.inputVisible = newInputVisible;
      }

      // If cell source changed externally, update editor
      // Compare with _lastKnownSource instead of editor text to handle race conditions
      // _lastKnownSource is what this cell view knows about - if the model differs,
      // the change came from another editor
      if (this.editor && props.cell) {
        const modelSource = props.cell.source;
        // Only update if model differs from what we last knew
        // This handles the case where another editor updated the model
        if (modelSource !== this._lastKnownSource) {
          // Set flag to prevent feedback loop (setText triggers onDidStopChanging)
          this._updatingFromExternal = true;
          const position = this.editor.getCursorBufferPosition();
          this.editor.setText(modelSource);
          this.editor.setCursorBufferPosition(position);
          this._lastKnownSource = modelSource;
          this._editorIsDirty = false;
        }
      }

      // Re-render outputs (OutputView handles its own diffing)
      this.renderOutputs();
    }
  }

  focus() {
    if (this.editor && this.editorElement) {
      // Focus must happen in next frame to work reliably
      requestAnimationFrame(() => {
        if (!this.editorElement) return;

        // Focus the editor element directly
        this.editorElement.focus();

        // Also ensure the text editor model knows it's focused
        const editorView = this.editorElement;
        if (editorView && editorView.getModel) {
          const model = editorView.getModel();
          if (model) {
            // This triggers the cursor to appear
            atom.views.getView(atom.workspace).focus();
            this.editorElement.focus();
          }
        }
      });
    }
  }

  destroy() {
    // Cancel any pending grammar retry
    this._grammarRetryScheduled = false;

    // Cancel any pending output render
    if (this._outputRenderFrame) {
      cancelAnimationFrame(this._outputRenderFrame);
      this._outputRenderFrame = null;
    }

    if (this.editorChangeSubscription) {
      this.editorChangeSubscription.dispose();
      this.editorChangeSubscription = null;
    }

    if (this.editorSubscription) {
      this.editorSubscription.dispose();
      this.editorSubscription = null;
    }

    if (this.editor) {
      this.editor.destroy();
      this.editor = null;
    }

    if (this.outputView) {
      this.outputView.destroy();
      this.outputView = null;
    }

    this.editorElement = null;
    this.outputContainer = null;
    this.contentElement = null;
    this.element = null;
  }
}

module.exports = CellView;
