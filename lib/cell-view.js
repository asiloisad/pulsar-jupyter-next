/**
 * CellView - DOM-based component for rendering Jupyter notebook cells
 */

const { CompositeDisposable } = require("atom");
const OutputView = require("./output-view");
const { getGrammarForLanguage, getGrammarScopesForLanguage } = require("./notebook-language");

// MIME type tagging the cell-reorder drag payload, so external file/text drops
// (which carry a text/plain path) are ignored instead of failing JSON.parse.
const CELL_DRAG_MIME = "application/x-jupyter-cell";

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
    this._lastKnownLanguage = props.notebookLanguage || null;
    this._editorIsDirty = false; // Track if editor has unsaved changes
    this._updatingFromExternal = false; // Guard against feedback loops when syncing from other editors
    this._localChangeSourceRevision = null;

    // Cached DOM element references for efficient updates
    this._cachedElements = {
      execCount: null,
      gutter: null,
    };
    // Cache last known values to avoid unnecessary DOM updates
    this._lastState = {
      classes: "",
      execCountText: "",
      gutterRunning: false,
      inputVisible: true,
      timerText: "",
    };

    this.element = document.createElement("div");
    this.render();
    this.setupEditor();
    this.setupDragAndDrop();
    this.setupClickHandler();

    this._maxInputHeightDisposable = atom.config.observe("jupyter-next.input.maxHeight", () => {
      this.applyMaxInputHeight();
    });
    this._maxOutputHeightDisposable = atom.config.observe("jupyter-next.output.maxHeight", () => {
      this.applyOutputHeight();
    });
  }

  isMarkdownRendered(cell, active, mode) {
    if (!cell || cell.type !== "markdown") return false;
    return !active || mode !== "edit";
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
    const { cell, active, editor } = this.props;

    // Set classes on the main element and cache for efficient updates
    const classes = this.getCellClasses();
    this.element.className = classes;
    this._lastState.classes = classes;
    this.element.setAttribute("data-cell-id", cell.id);

    // Reset cached element references for new render
    this._cachedElements = {
      execCount: null,
      gutter: null,
      cellNumber: null,
    };
    this._lastState.inputVisible = cell.inputVisible !== false;

    // Dispose tooltips registered in the previous render before clearing the DOM.
    if (this._tooltips) this._tooltips.dispose();
    this._tooltips = new CompositeDisposable();

    // Clear existing content but preserve editor if it exists
    const existingEditor = this.editorElement;
    this.element.innerHTML = "";

    // Cell gutter (drag handle)
    const gutter = document.createElement("div");
    const gutterRunning = cell.status === "running";
    gutter.className = gutterRunning ? "cell-gutter running" : "cell-gutter";
    gutter.draggable = true;
    this.dragHandle = gutter;
    this._cachedElements.gutter = gutter;
    this._lastState.gutterRunning = gutterRunning;

    const prompt = document.createElement("div");
    prompt.className = "cell-prompt";
    gutter.appendChild(prompt);
    this._cachedElements.prompt = prompt;

    if (cell.type === "code") {
      const execCount = document.createElement("span");
      execCount.className = "execution-count";
      const execText = this.getExecutionCountText();
      execCount.textContent = execText;
      this._lastState.execCountText = execText;
      prompt.appendChild(execCount);
      this._cachedElements.execCount = execCount;
    }

    const cellNumber = document.createElement("div");
    cellNumber.className = "cell-number";
    cellNumber.textContent = this.props.index + 1;
    this._lastState.cellNumber = this.props.index + 1;
    prompt.appendChild(cellNumber);
    this._cachedElements.cellNumber = cellNumber;

    // Only show type indicator for non-code cells (code cells have execution count)
    if (cell.type !== "code") {
      const typeIndicator = document.createElement("div");
      typeIndicator.className = "cell-type-indicator";
      typeIndicator.textContent = cell.type === "markdown" ? "md" : "raw";
      gutter.appendChild(typeIndicator);
    }

    // Execution timer (code cells only) — shows last completed run duration only.
    if (cell.type === "code") {
      const timerText = this.getRunTimeText(cell);
      const timer = document.createElement("div");
      timer.className = "cell-timer";
      timer.textContent = timerText;
      this._lastState.timerText = timerText;
      gutter.appendChild(timer);
      this._cachedElements.timer = timer;
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

    if (this.isMarkdownRendered(cell, active, this.props.mode)) {
      // Rendered markdown
      const mdRendered = document.createElement("div");
      mdRendered.className = "markdown-rendered";
      mdRendered.innerHTML = this.renderMarkdown(cell.source);
      this._cachedElements.markdownRendered = mdRendered;
      mdRendered.addEventListener("click", (event) => {
        if (event.ctrlKey || event.metaKey || event.shiftKey) return;
        if (event.target.closest("a, button, input, select, textarea, label")) return;

        event.stopPropagation();
        if (this.props.onCellSelect) this.props.onCellSelect(event);
        if (this.props.onFocus) this.props.onFocus();
        if (this.props.onEnterEditMode) this.props.onEnterEditMode();
      });
      inputArea.appendChild(mdRendered);
      this.editorContainer = null;
    } else {
      // Editor container
      this.editorContainer = document.createElement("div");
      this.editorContainer.className = "cell-editor-container";
      this.applyMaxInputHeight();
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

    if (cell.type === "code") {
      const runBtn = document.createElement("button");
      runBtn.className = "btn btn-xs icon icon-playback-play";
      this._tooltips.add(
        atom.tooltips.add(runBtn, { title: "Run Cell", keyBindingCommand: "hydrogen-next:run-cell" }),
      );
      runBtn.onclick = (e) => {
        e.stopPropagation();
        if (!editor) return;
        editor.setActiveCell(this.props.index);
        atom.commands.dispatch(editor.view?.element || this.element, "hydrogen-next:run-cell");
      };
      actions.appendChild(runBtn);

      const clearBtn = document.createElement("button");
      clearBtn.className = "btn btn-xs icon icon-remove-close";
      this._tooltips.add(
        atom.tooltips.add(clearBtn, {
          title: "Clear Output",
          keyBindingCommand: "jupyter-next:clear-output",
        }),
      );
      clearBtn.onclick = (e) => {
        e.stopPropagation();
        if (editor) editor.clearOutputAt(this.props.index);
      };
      actions.appendChild(clearBtn);
    }

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "btn btn-xs icon icon-trashcan";
    this._tooltips.add(
      atom.tooltips.add(deleteBtn, {
        title: "Delete Cell",
        keyBindingCommand: "jupyter-next:delete-cell",
      }),
    );
    deleteBtn.onclick = (e) => {
      e.stopPropagation();
      if (editor) editor.deleteCellAt(this.props.index);
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
      cell.status === "running" ? "running" : "",
    ]
      .filter(Boolean)
      .join(" ");
  }

  getExecutionCountText() {
    const { cell } = this.props;
    if (cell.status === "running") return "[*]";
    if (cell.executionCount) return `[${cell.executionCount}]`;
    return "";
  }

  renderOutputs() {
    // Cancel any pending render
    if (this._outputRenderFrame) {
      cancelAnimationFrame(this._outputRenderFrame);
      this._outputRenderFrame = null;
    }

    // Defer output rendering to next frame to avoid focus loss.
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
    if (cell.type === "code" && displayableOutputs.length > 0 && cell.outputVisible !== false) {
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
          maxHeight: atom.config.get("jupyter-next.output.maxHeight"),
        });
      } else {
        // Create new output view
        this.outputView = new OutputView({
          outputs: displayableOutputs,
          maxHeight: atom.config.get("jupyter-next.output.maxHeight"),
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
    const { cell, active, mode } = this.props;

    // Don't set up editor for rendered markdown
    if (this.isMarkdownRendered(cell, active, mode)) {
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

    // Register with Pulsar's global text editor registry so packages
    // (linters, formatters, etc.) and atom.textEditors.observe() see this editor
    this.editorRegistryDisposable = atom.textEditors.add(this.editor);

    // Scroll to cursor position on any cursor activity (typing, arrow keys, clicks)
    this.editorCursorSubscription = this.editor.onDidChangeCursorPosition(() => {
      const { notebookView, index } = this.props;
      if (notebookView) {
        notebookView.scrollToCursor(index, this.editor);
      }
    });

    // Listen for changes - track dirty state to avoid race conditions
    this.editorChangeSubscription = this.editor.onDidChange(() => {
      this._editorIsDirty = true;
      if (!this._updatingFromExternal && this._localChangeSourceRevision === null) {
        this._localChangeSourceRevision = this.props.cellSourceRevision || 0;
      }
    });

    this.editorSubscription = this.editor.onDidStopChanging(() => {
      // Don't trigger source change if we're updating from external source
      if (this._updatingFromExternal) {
        this._updatingFromExternal = false;
        this._editorIsDirty = false;
        this._localChangeSourceRevision = null;
        return;
      }
      const source = this.editor.getText();
      const modelSource = this.props.cell?.source || "";
      const currentSourceRevision = this.props.cellSourceRevision || 0;
      const localChangeSourceRevision = this._localChangeSourceRevision;
      this._localChangeSourceRevision = null;

      if (
        localChangeSourceRevision !== null &&
        localChangeSourceRevision !== currentSourceRevision &&
        source !== modelSource
      ) {
        this._updatingFromExternal = true;
        const position = this.editor.getCursorBufferPosition();
        this.editor.setText(modelSource);
        this.editor.setCursorBufferPosition(position);
        this._lastKnownSource = modelSource;
        this._editorIsDirty = false;
        return;
      }
      // Only trigger source change if the source actually changed from last known
      const sourceChanged = source !== this._lastKnownSource;
      this._lastKnownSource = source;
      this._editorIsDirty = false;
      if (sourceChanged && this.props.onSourceChange) {
        this.props.onSourceChange(source);
      }
    });

    // Handle click on editor to enter edit mode and focus
    this.editorElement.addEventListener("mousedown", () => {
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
      this.dragHandle.addEventListener("dragstart", this.handleDragStart.bind(this));
      this.dragHandle.addEventListener("dragend", this.handleDragEnd.bind(this));
    }
  }

  handleDragStart(event) {
    const { cell, index, notebookView, editor } = this.props;

    // Get selected cells from notebook view, or just use this cell's index
    let selectedIndices = [index];
    if (notebookView) {
      const selected = notebookView.getSelectedCells();
      if (selected.length > 0 && selected.includes(index)) {
        // Current cell is in selection, drag all selected cells
        selectedIndices = selected;
      } else {
        // Current cell is not in selection - replace selection with just this cell
        notebookView.clearSelection();
        notebookView.extendSelection(index);
        if (editor) editor.setActiveCell(index);
        selectedIndices = [index];
      }
    }

    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(
      CELL_DRAG_MIME,
      JSON.stringify({
        cellId: cell.id,
        fromIndex: index,
        selectedIndices: selectedIndices,
      }),
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

  handleDragEnd() {
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
    // Only react to cell-reorder drags; let external drops use default handling.
    if (!event.dataTransfer.types.includes(CELL_DRAG_MIME)) {
      return;
    }
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
    if (!event.dataTransfer.types.includes(CELL_DRAG_MIME)) {
      return;
    }
    event.preventDefault();
  }

  handleDragLeave(event) {
    if (!this.element.contains(event.relatedTarget)) {
      this.element.classList.remove("drop-above", "drop-below");
    }
  }

  handleDrop(event) {
    const raw = event.dataTransfer.getData(CELL_DRAG_MIME);
    if (!raw) {
      // Not a cell reorder (e.g. an external file or text drop); leave it to the
      // default handler instead of throwing on JSON.parse.
      return;
    }

    event.preventDefault();

    this.element.classList.remove("drop-above", "drop-below");

    try {
      const data = JSON.parse(raw);
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
        const previousActiveIndex = editor.activeCellIndex;
        let newFirstIndex;
        let movedCount;
        let newActiveIndex;

        if (selectedIndices.length === 1) {
          // Single cell move
          const fromIndex = selectedIndices[0];
          if (fromIndex < targetIndex) {
            targetIndex--;
          }
          if (fromIndex !== targetIndex) {
            editor.moveCell(fromIndex, targetIndex);
          }
          newFirstIndex = targetIndex;
          movedCount = 1;
          newActiveIndex = targetIndex;
        } else {
          // Multiple cells move - move them as a group
          const sorted = [...selectedIndices].sort((a, b) => a - b);
          const cellsBeforeTarget = sorted.filter((i) => i < targetIndex).length;
          newFirstIndex = targetIndex - cellsBeforeTarget;
          movedCount = sorted.length;
          editor.moveCells(selectedIndices, targetIndex);

          // Map previous active cell to its new position in the moved block
          const posInSelection = sorted.indexOf(previousActiveIndex);
          newActiveIndex = posInSelection >= 0 ? newFirstIndex + posInSelection : newFirstIndex;
        }

        // Restore active cell to the moved cell's new position
        editor.setActiveCell(newActiveIndex);

        // Preserve selection on the moved cells at their new positions
        if (notebookView) {
          notebookView.clearSelection();
          if (movedCount > 1) {
            for (let i = 0; i < movedCount; i++) {
              notebookView.extendSelection(newFirstIndex + i);
            }
          }
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
      const language = this.props.notebookLanguage || "python";
      targetScopes = getGrammarScopesForLanguage(language);
      grammar = getGrammarForLanguage(language);
    }

    if (!grammar && targetScopes) {
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

    // Check if we need to rebuild (type changed, or markdown rendered state changed)
    // Use _lastKnownType since the cell object is mutated in place
    const typeChanged = this._lastKnownType !== props.cell.type;
    const wasRendered = this.isMarkdownRendered(oldProps.cell, oldProps.active, oldProps.mode);
    const willBeRendered = this.isMarkdownRendered(props.cell, props.active, props.mode);
    const needsRebuild = typeChanged || wasRendered !== willBeRendered;

    if (needsRebuild) {
      // Cleanup old editor
      if (this.editor) {
        if (this.editorCursorSubscription) {
          this.editorCursorSubscription.dispose();
          this.editorCursorSubscription = null;
        }
        if (this.editorChangeSubscription) {
          this.editorChangeSubscription.dispose();
          this.editorChangeSubscription = null;
        }
        if (this.editorSubscription) {
          this.editorSubscription.dispose();
          this.editorSubscription = null;
        }
        if (this.editorRegistryDisposable) {
          this.editorRegistryDisposable.dispose();
          this.editorRegistryDisposable = null;
        }
        this.editor.destroy();
        this.editor = null;
        this.editorElement = null;
      }
      this._lastKnownSource = props.cell ? props.cell.source : "";
      this._lastKnownType = props.cell ? props.cell.type : "code";
      this._lastKnownLanguage = props.notebookLanguage || null;
      this._editorIsDirty = false;
      this._localChangeSourceRevision = null;

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

      // Update cell number if index changed
      if (this._cachedElements.cellNumber) {
        const cellNumber = this.props.index + 1;
        if (this._lastState.cellNumber !== cellNumber) {
          this._cachedElements.cellNumber.textContent = cellNumber;
          this._lastState.cellNumber = cellNumber;
        }
      }

      // Update execution count only if changed (use cached element)
      if (this._cachedElements.execCount) {
        const execText = this.getExecutionCountText();
        if (this._lastState.execCountText !== execText) {
          this._cachedElements.execCount.textContent = execText;
          this._lastState.execCountText = execText;
        }
      }

      // Mirror running state on the gutter for direct gutter-only styling.
      if (this._cachedElements.gutter) {
        const gutterRunning = props.cell.status === "running";
        if (this._lastState.gutterRunning !== gutterRunning) {
          this._cachedElements.gutter.classList.toggle("running", gutterRunning);
          this._lastState.gutterRunning = gutterRunning;
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
          this._localChangeSourceRevision = null;
        }
      } else if (this._cachedElements.markdownRendered && props.cell) {
        const modelSource = props.cell.source;
        if (modelSource !== this._lastKnownSource) {
          this._cachedElements.markdownRendered.innerHTML = this.renderMarkdown(modelSource);
          this._lastKnownSource = modelSource;
        }
      }

      // Update timer — shows last completed run duration (static, no live interval).
      if (this._cachedElements.timer) {
        const timerText = this.getRunTimeText(props.cell);
        if (this._lastState.timerText !== timerText) {
          this._cachedElements.timer.textContent = timerText;
          this._lastState.timerText = timerText;
        }
      }

      // Re-render outputs (OutputView handles its own diffing)
      this.renderOutputs();

      if (this.editor && props.notebookLanguage !== this._lastKnownLanguage) {
        this._lastKnownLanguage = props.notebookLanguage || null;
        this.applyGrammar();
      }
    }
  }

  _formatRunTime(ms) {
    if (ms < 60000) return (ms / 1000).toFixed(1) + "s";
    const m = Math.floor(ms / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    return `${m}m ${s}s`;
  }

  getRunTimeText(cell) {
    if (!cell) return "";
    if (cell.lastRunTimeText) return cell.lastRunTimeText;
    return cell.lastRunTime > 0 ? this._formatRunTime(cell.lastRunTime) : "";
  }

  focus() {
    if (this.editor && this.editorElement) {
      // Focus must happen in next frame to work reliably
      requestAnimationFrame(() => {
        if (!this.editorElement) return;

        // preventScroll: true — scrolling is handled by scrollToCell (block: nearest)
        this.editorElement.focus({ preventScroll: true });

        // Also ensure the text editor model knows it's focused
        const editorView = this.editorElement;
        if (editorView && editorView.getModel) {
          const model = editorView.getModel();
          if (model) {
            // This triggers the cursor to appear
            atom.views.getView(atom.workspace).focus();
            this.editorElement.focus({ preventScroll: true });
          }
        }
      });
    }
  }

  applyOutputHeight() {
    if (!this.outputView || !this.outputView.element) return;
    const container = this.outputView.element.querySelector(".jupyter-outputs");
    if (!container) return;
    const max = atom.config.get("jupyter-next.output.maxHeight");
    if (max > 0) {
      container.style.maxHeight = `${max}px`;
      container.style.overflowY = "auto";
    } else {
      container.style.maxHeight = "";
      container.style.overflowY = "";
    }
  }

  applyMaxInputHeight() {
    if (!this.editorContainer) return;
    const max = atom.config.get("jupyter-next.input.maxHeight");
    if (max > 0) {
      this.editorContainer.style.maxHeight = `${max}px`;
      this.editorContainer.style.overflowY = "auto";
    } else {
      this.editorContainer.style.maxHeight = "";
      this.editorContainer.style.overflowY = "";
    }
  }

  destroy() {
    if (this._tooltips) {
      this._tooltips.dispose();
      this._tooltips = null;
    }
    if (this._maxInputHeightDisposable) {
      this._maxInputHeightDisposable.dispose();
      this._maxInputHeightDisposable = null;
    }
    if (this._maxOutputHeightDisposable) {
      this._maxOutputHeightDisposable.dispose();
      this._maxOutputHeightDisposable = null;
    }

    // Cancel any pending grammar retry
    this._grammarRetryScheduled = false;

    // Cancel any pending output render
    if (this._outputRenderFrame) {
      cancelAnimationFrame(this._outputRenderFrame);
      this._outputRenderFrame = null;
    }

    if (this.editorCursorSubscription) {
      this.editorCursorSubscription.dispose();
      this.editorCursorSubscription = null;
    }

    if (this.editorChangeSubscription) {
      this.editorChangeSubscription.dispose();
      this.editorChangeSubscription = null;
    }

    if (this.editorSubscription) {
      this.editorSubscription.dispose();
      this.editorSubscription = null;
    }

    if (this.editorRegistryDisposable) {
      this.editorRegistryDisposable.dispose();
      this.editorRegistryDisposable = null;
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
