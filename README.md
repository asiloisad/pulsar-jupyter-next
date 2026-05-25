# jupyter-next

Open and edit Jupyter notebooks in Pulsar.

![demo](https://github.com/asiloisad/pulsar-jupyter-next/blob/master/assets/demo.png?raw=true)

## Features

- **Notebook editing**: Open and edit `.ipynb` files with a cell-based interface.
- **Stored output rendering**: Existing notebook outputs are displayed from notebook JSON.
- **Markdown support**: Markdown cells render in command mode.
- **Cell operations**: Insert, delete, move, merge, cut, copy, paste, duplicate, and change cell type.
- **Cell type selector**: Switch active cell type via the toolbar dropdown or mouse wheel scroll over the selector.
- **Multi-select cells**: Ctrl+click to toggle, Shift+click for range selection, Shift+Up/Down to grow the selection from an anchor cell.
- **Drag & drop**: Reorder cells by dragging with auto-scroll near edges.
- **Undo/redo**: Buffer-based notebook edit history for cell text and notebook operations.
- **Open source**: Open `.ipynb` files as plain JSON text from an active notebook or tree-view.
- **Dual mode**: Command mode for navigation, edit mode for typing.
- **Hydrogen execution**: Run cells with [hydrogen-next](https://github.com/asiloisad/pulsar-hydrogen-next) via the `hydrogen-adapter` service. Run/interrupt/restart/shutdown buttons appear in the toolbar; each code cell shows a per-cell Run button.
- **Execution status**: Running cells pulse a warning border and show a marching diagonal hatch on the gutter. The execution count switches to `[*]` while running. Each cell's gutter shows the last completed run duration.
- **Output protection**: Output images cannot be dragged out of the notebook.
- **Linting support**: Code cells are exposed through a backing `.ipynb` editor for linter integrations.
- **Navigation panel**: Markdown headings are exposed through the navigation adapter.
- **Scrollmap markers**: Markdown headings, selected or active cells, and linter messages appear on the notebook scrollbar when `scrollmap` is installed. Linter ticks render in the left lane and are color-coded by severity.
- **Export options**: Save as Python scripts or HTML.

## Installation

Install `jupyter-next` from Pulsar's package installer or run `ppm install jupyter-next`.

## Commands

Workspace commands:

- `jupyter-next:toggle`: toggle the active notebook item.
- `jupyter-next:new-notebook`: create a new notebook.
- `jupyter-next:open-source`: open the active notebook as plain text.

Notebook commands:

- `jupyter-next:clear-output`: clear active cell output.
- `jupyter-next:clear-all-outputs`: clear all outputs.
- `jupyter-next:insert-cell-above`: insert cell above.
- `jupyter-next:insert-cell-below`: insert cell below.
- `jupyter-next:delete-cell`: delete cell.
- `jupyter-next:move-cell-up`: move cell up.
- `jupyter-next:move-cell-down`: move cell down.
- `jupyter-next:change-cell-to-code`: change to code cell.
- `jupyter-next:change-cell-to-markdown`: change to markdown cell.
- `jupyter-next:change-cell-to-raw`: change to raw cell.
- `jupyter-next:toggle-cell-output`: toggle output visibility.
- `jupyter-next:toggle-cell-input`: toggle input visibility.
- `jupyter-next:enter-edit-mode`: enter edit mode.
- `jupyter-next:enter-command-mode`: enter command mode.
- `jupyter-next:focus-previous-cell`: focus previous cell.
- `jupyter-next:focus-next-cell`: focus next cell.
- `jupyter-next:focus-first-cell`: focus first cell.
- `jupyter-next:focus-last-cell`: focus last cell.
- `jupyter-next:select-previous-cell`: extend selection to previous cell.
- `jupyter-next:select-next-cell`: extend selection to next cell.
- `jupyter-next:cut-cell`: cut cell.
- `jupyter-next:copy-cell`: copy cell.
- `jupyter-next:paste-cell-below`: paste cell below.
- `jupyter-next:paste-cell-above`: paste cell above.
- `jupyter-next:duplicate-cell`: duplicate cell.
- `jupyter-next:merge-cell-below`: merge with cell below.
- `jupyter-next:undo-cell-operation`: undo the latest notebook edit.
- `jupyter-next:redo-cell-operation`: redo the latest notebook edit.
- `jupyter-next:save`: save notebook.
- `jupyter-next:save-as`: save notebook as.
- `jupyter-next:export-to-python`: export to Python script.
- `jupyter-next:export-to-html`: export to HTML.

Tree-view commands:

- `jupyter-next:open-notebook`: open the selected `.ipynb` file as a notebook.
- `jupyter-next:open-source`: open the selected `.ipynb` file as plain text.

## Services

`jupyter-next` consumes `tree-view@1.0.0` and `simplemap@1.0.0` when available.

It provides:

- `jupyter@1.0.0`: access to the active notebook and document registry.
- `hydrogen-adapter@1.0.0`: lets `hydrogen-next` run notebook cells through the adapter pattern (target enumeration, output routing, kernel control).
- `linter-adapter@1.0.0`: map linter messages to notebook cell editors for navigation and the current-message UI.
- `linter-ui@1.0.0`: receive linter message sets so they can be rendered as markers on the notebook scrollmap.
- `navigation-adapter@1.0.0`: expose markdown headings as navigation entries.

## Contributing

Got ideas to make this package better, found a bug, or want to help add new features? Just drop your thoughts on GitHub. Any feedback is welcome!
