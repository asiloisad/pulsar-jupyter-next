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
- **Notebook search**: Search and replace cell source through [search-panel](https://github.com/asiloisad/pulsar-search-panel). Find Next/Previous enters edit mode, focuses the matching cell editor, and selects the current match.
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

## Provided Service `search-adapter`

Allows [search-panel](https://github.com/asiloisad/pulsar-search-panel) to search and replace cell source in the active notebook through the buffer find panel:

- `search-panel:show`, `search-panel:find-next`, `search-panel:find-previous`, `search-panel:replace-current`, and `search-panel:replace-all` operate on notebook cell source while the notebook is the active pane item.
- Search scans all cells and reports the total match count in the find panel.
- Navigation enters edit mode, scrolls to the matching cell, focuses its editor, and selects the current match so typing can immediately replace it.
- Markdown cells are searched by source text. If a match is in a rendered markdown cell, navigation switches the notebook to edit mode before selecting the text.
- Replace works across code, markdown, and raw cells and updates the notebook document model.
- Transient search highlights and search-created selections are cleared when the notebook stops being the active search target.

This service is provided as `search-adapter@1.0.0` through `provideSearchAdapter`.

## Provided Service `jupyter`

Provides access to notebook documents and active notebook items for packages that need notebook-aware behavior.

In your `package.json`:

```json
{
  "consumedServices": {
    "jupyter": {
      "versions": {
        "1.0.0": "consumeJupyter"
      }
    }
  }
}
```

## Provided Service `hydrogen-adapter`

Allows [hydrogen-next](https://github.com/asiloisad/pulsar-hydrogen-next) to execute notebook cells using normal Hydrogen commands. The adapter maps notebook cells to run targets, supplies source text and metadata, routes kernel output back into cells, stores execution counts, and controls kernel-related focus/navigation.

This service is provided as `hydrogen-adapter@1.0.0` through `provideHydrogenAdapter`.

## Provided Service `linter-adapter`

Allows [linter-bundle](https://github.com/asiloisad/pulsar-linter-bundle) to map diagnostics from the notebook backing editor to visible notebook cells. The adapter resolves messages for notebook items, finds the current/next/previous message, and reveals the corresponding cell editor location.

This service is provided as `linter-adapter@1.0.0` through `provideLinterItemAdapter`.

## Provided Service `linter-ui`

Receives linter message updates so notebook-specific UI, such as scrollmap markers, can stay synchronized with diagnostics.

This service is provided as `linter-ui@1.0.0` through `provideLinterUI`.

## Provided Service `navigation-adapter`

Allows [navigation-panel](https://github.com/asiloisad/pulsar-navigation-panel) to show notebook markdown headings as a document outline. Selecting a heading activates the corresponding cell and scrolls it into view.

This service is provided as `navigation-adapter@1.0.0` through `provideNavigationAdapter`.

## Consumed Service `tree-view`

Adds tree-view commands for opening selected `.ipynb` files as notebooks or as plain JSON source.

## Consumed Service `simplemap`

Allows notebook scrollmap markers to render in a standalone scrollbar widget when [scrollmap](https://github.com/asiloisad/pulsar-scrollmap) is available.

## Contributing

Got ideas to make this package better, found a bug, or want to help add new features? Just drop your thoughts on GitHub. Any feedback is welcome!
