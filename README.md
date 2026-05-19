# jupyter-next

Open and edit Jupyter notebooks. Interactive computing with kernel management and rich output rendering.

![demo](https://github.com/asiloisad/pulsar-jupyter-next/blob/master/assets/demo.png?raw=true)

## Features

- **Notebook editing**: Open and edit `.ipynb` files with cell-based interface.
- **Execute cells**: Run code with real-time output display and a live execution timer while running.
- **Markdown support**: Live preview for markdown cells, rendered whenever the notebook is in command mode.
- **Multiple kernels**: Python, Julia, R, and other Jupyter kernels.
- **Rich output**: Images, HTML, LaTeX, Plotly, Vega, and interactive plots.
- **Cell operations**: Insert, delete, move, merge, and split cells.
- **Cell hover actions**: Run, clear output, and delete buttons appear on cell hover and act on that specific cell without changing the active cell.
- **Cell type selector**: Switch active cell type via the toolbar dropdown or mouse wheel scroll over the selector.
- **Multi-select cells**: Ctrl+click to toggle, Shift+click for range selection, Shift+Up/Down to grow the selection from an anchor cell.
- **Drag & drop**: Reorder cells by dragging with auto-scroll near edges. Selection and active cell are preserved across the move.
- **Undo/redo**: Single notebook edit history for cell text and notebook operations.
- **Open source**: Open `.ipynb` files as plain JSON text from an active notebook or tree-view.
- **Dual mode**: Command mode for navigation, edit mode for typing (like Jupyter).
- **Jupyter keybindings**: Familiar shortcuts like J/K navigation, A/B insert, D D delete.
- **Cell numbers**: Each cell shows its 1-based index, and code cells show Jupyter-style execution counts such as `[1]`.
- **Linting support**: Code cells are linted by packages such as [linter-ruff](https://github.com/asiloisad/pulsar-linter-ruff) and [linter-todo](https://github.com/asiloisad/pulsar-linter-todo). Messages are mapped back to individual cells and the linter panel shows `[cell]:line:col` position.
- **Navigation panel**: Markdown cell headings appear in [navigation-panel](https://github.com/asiloisad/pulsar-navigation-panel) and can be navigated directly.
- **Variable Explorer**: Browse and inspect variables from notebook cells via hydrogen-next.
- **Kernel Monitor**: Track kernel status and resource usage via hydrogen-next.
- **Inspector**: Get documentation and introspection for objects via hydrogen-next.
- **Export options**: Save as Python scripts or HTML.

## Installation

To install `jupyter-next` search for [jupyter-next](https://web.pulsar-edit.dev/packages/jupyter-next) in the Install pane of the Pulsar settings or run `ppm install jupyter-next`. Alternatively, you can run `ppm install asiloisad/pulsar-jupyter-next` to install a package directly from the GitHub repository.

This package requires [hydrogen-next](https://web.pulsar-edit.dev/packages/hydrogen-next).

## Commands

Commands available in `atom-workspace`:

- `jupyter-next:toggle`: toggle jupyter panel,
- `jupyter-next:new-notebook`: create new notebook,
- `jupyter-next:open-source`: open the active notebook as plain text.

Commands available in `.jupyter-notebook`:

- `jupyter-next:run-cell`: <kbd>Ctrl+Enter</kbd> run cell and stay,
- `jupyter-next:run-cell-and-move-down`: <kbd>Shift+Enter</kbd> run cell and move down,
- `jupyter-next:run-all-cells`: run all cells,
- `jupyter-next:run-all-above`: run all cells above,
- `jupyter-next:run-all-below`: run all cells below,
- `jupyter-next:clear-output`: clear cell output,
- `jupyter-next:clear-all-outputs`: clear all outputs,
- `jupyter-next:insert-cell-above`: <kbd>A</kbd> insert cell above,
- `jupyter-next:insert-cell-below`: <kbd>B</kbd> insert cell below,
- `jupyter-next:delete-cell`: <kbd>D D</kbd> delete cell,
- `jupyter-next:move-cell-up`: move cell up,
- `jupyter-next:move-cell-down`: move cell down,
- `jupyter-next:change-cell-to-code`: <kbd>Y</kbd> change to code cell,
- `jupyter-next:change-cell-to-markdown`: <kbd>M</kbd> change to markdown cell,
- `jupyter-next:change-cell-to-raw`: <kbd>R</kbd> change to raw cell,
- `jupyter-next:toggle-cell-output`: toggle output visibility,
- `jupyter-next:toggle-cell-input`: toggle input visibility,
- `jupyter-next:connect-kernel`: connect to kernel,
- `jupyter-next:disconnect-kernel`: disconnect kernel,
- `jupyter-next:restart-kernel`: restart kernel,
- `jupyter-next:interrupt-kernel`: interrupt kernel,
- `jupyter-next:enter-edit-mode`: <kbd>Enter</kbd> enter edit mode,
- `jupyter-next:enter-command-mode`: <kbd>Escape</kbd> enter command mode,
- `jupyter-next:focus-previous-cell`: <kbd>K</kbd> focus previous cell,
- `jupyter-next:focus-next-cell`: <kbd>J</kbd> focus next cell,
- `jupyter-next:focus-first-cell`: focus first cell,
- `jupyter-next:focus-last-cell`: focus last cell,
- `jupyter-next:select-previous-cell`: <kbd>Shift+Up</kbd> extend selection to previous cell,
- `jupyter-next:select-next-cell`: <kbd>Shift+Down</kbd> extend selection to next cell,
- `jupyter-next:cut-cell`: <kbd>X</kbd> cut cell,
- `jupyter-next:copy-cell`: <kbd>C</kbd> copy cell,
- `jupyter-next:paste-cell-below`: <kbd>V</kbd> paste cell below,
- `jupyter-next:paste-cell-above`: paste cell above,
- `jupyter-next:duplicate-cell`: duplicate cell,
- `jupyter-next:merge-cell-below`: merge with cell below,
- `jupyter-next:undo-cell-operation`: <kbd>Z</kbd> undo the latest notebook edit,
- `jupyter-next:redo-cell-operation`: redo the latest notebook edit,
- `jupyter-next:save`: save notebook,
- `jupyter-next:save-as`: save notebook as,
- `jupyter-next:open-source`: open notebook as plain text,
- `jupyter-next:export-to-python`: export to Python script,
- `jupyter-next:export-to-html`: export to HTML.

Commands available in `.tree-view`:

- `jupyter-next:open-source`: open the selected `.ipynb` file as plain text.

## Provided Service `linter-adapter`

Integrates Jupyter notebooks with [linter-bundle](https://github.com/asiloisad/pulsar-linter-bundle). Linters that support the `source.jupyter` grammar scope (such as `linter-ruff` and `linter-todo`) lint the notebook source and messages are routed back to the correct cell editor.

In your `package.json`:

```json
{
  "consumedServices": {
    "linter-adapter": {
      "versions": {
        "1.0.0": "consumeItemLinterAdapter"
      }
    }
  }
}
```

## Provided Service `navigation-adapter`

Integrates Jupyter notebooks with [navigation-panel](https://github.com/asiloisad/pulsar-navigation-panel). Headings from markdown cells are exposed as a navigation tree.

In your `package.json`:

```json
{
  "consumedServices": {
    "navigation-adapter": {
      "versions": {
        "1.0.0": "consumeNavigationAdapter"
      }
    }
  }
}
```

## Provided Service `jupyter-next`

Allows other packages to interact with Jupyter notebooks: access kernel management, run code, and monitor kernel status.

In your `package.json`:

```json
{
  "consumedServices": {
    "jupyter-next": {
      "versions": {
        "1.0.0": "consumeJupyter"
      }
    }
  }
}
```

In your main module:

```javascript
consumeJupyter(jupyter) {
  // Get kernel manager
  const kernelManager = jupyter.getKernelManager()

  // Get active notebook
  const notebook = jupyter.getActiveNotebook()

  // Run code
  const result = await jupyter.runCode('print("Hello")', 'python3')

  // Subscribe to kernel status changes
  jupyter.onDidChangeKernelStatus(({ kernelName, status }) => {
    console.log(`Kernel ${kernelName} is now ${status}`)
  })
}
```

## Contributing

Got ideas to make this package better, found a bug, or want to help add new features? Just drop your thoughts on GitHub. Any feedback is welcome!
