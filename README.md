# jupyter-next

Open and edit Jupyter notebooks. Interactive computing with kernel management and rich output rendering.

![demo](https://github.com/asiloisad/pulsar-jupyter-next/blob/master/assets/demo.png?raw=true)

## Features

- **Notebook editing**: Open and edit `.ipynb` files with cell-based interface.
- **Execute cells**: Run code with real-time output display.
- **Markdown support**: Live preview for markdown cells.
- **Multiple kernels**: Python, Julia, R, and other Jupyter kernels.
- **Rich output**: Images, HTML, LaTeX, Plotly, Vega, and interactive plots.
- **Cell operations**: Insert, delete, move, merge, and split cells.
- **Multi-select cells**: Ctrl+click to toggle, Shift+click for range selection.
- **Drag & drop**: Reorder cells by dragging with auto-scroll near edges.
- **Undo/redo**: Full cell operation history with keyboard shortcuts.
- **Dual mode**: Command mode for navigation, edit mode for typing (like Jupyter).
- **Jupyter keybindings**: Familiar shortcuts like J/K navigation, A/B insert, D D delete.
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
- `jupyter-next:new-notebook`: create new notebook.

Commands available in `.jupyter-notebook`:

- `jupyter-next:run-cell`: (`Ctrl+Enter`) run cell and stay,
- `jupyter-next:run-cell-and-advance`: (`Shift+Enter`) run cell and advance,
- `jupyter-next:run-all-cells`: run all cells,
- `jupyter-next:run-all-above`: run all cells above,
- `jupyter-next:run-all-below`: run all cells below,
- `jupyter-next:clear-output`: clear cell output,
- `jupyter-next:clear-all-outputs`: clear all outputs,
- `jupyter-next:insert-cell-above`: (`A`) insert cell above,
- `jupyter-next:insert-cell-below`: (`B`) insert cell below,
- `jupyter-next:delete-cell`: (`D D`) delete cell,
- `jupyter-next:move-cell-up`: move cell up,
- `jupyter-next:move-cell-down`: move cell down,
- `jupyter-next:change-cell-to-code`: (`Y`) change to code cell,
- `jupyter-next:change-cell-to-markdown`: (`M`) change to markdown cell,
- `jupyter-next:change-cell-to-raw`: change to raw cell,
- `jupyter-next:toggle-cell-output`: toggle output visibility,
- `jupyter-next:toggle-cell-input`: toggle input visibility,
- `jupyter-next:connect-kernel`: connect to kernel,
- `jupyter-next:disconnect-kernel`: disconnect kernel,
- `jupyter-next:restart-kernel`: restart kernel,
- `jupyter-next:interrupt-kernel`: interrupt kernel,
- `jupyter-next:enter-edit-mode`: (`Enter`) enter edit mode,
- `jupyter-next:enter-command-mode`: (`Escape`) enter command mode,
- `jupyter-next:focus-previous-cell`: (`K`) focus previous cell,
- `jupyter-next:focus-next-cell`: (`J`) focus next cell,
- `jupyter-next:focus-first-cell`: focus first cell,
- `jupyter-next:focus-last-cell`: focus last cell,
- `jupyter-next:cut-cell`: (`X`) cut cell,
- `jupyter-next:copy-cell`: (`C`) copy cell,
- `jupyter-next:paste-cell-below`: (`V`) paste cell below,
- `jupyter-next:paste-cell-above`: paste cell above,
- `jupyter-next:duplicate-cell`: duplicate cell,
- `jupyter-next:merge-cell-below`: merge with cell below,
- `jupyter-next:undo-cell-operation`: (`Z`) undo cell operation,
- `jupyter-next:redo-cell-operation`: redo cell operation,
- `jupyter-next:save`: save notebook,
- `jupyter-next:save-as`: save notebook as,
- `jupyter-next:export-to-python`: export to Python script,
- `jupyter-next:export-to-html`: export to HTML.

## Provided Service `jupyter-next`

Allows other packages to interact with Jupyter notebooks — access kernel management, run code, and monitor kernel status.

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

Got ideas to make this package better, found a bug, or want to help add new features? Just drop your thoughts on GitHub — any feedback's welcome!
