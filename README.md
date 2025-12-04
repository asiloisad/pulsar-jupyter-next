# jupyter-next

Jupyter notebook support with interactive computing, kernel management, and rich output rendering.

- **Open and edit Jupyter notebooks** (.ipynb files)
- **Execute code cells** with real-time output
- **Markdown cells** with live preview
- **Multiple kernel support** (Python, Julia, R, and more)
- **Rich output rendering** including images, HTML, LaTeX, and plots
- **Cell operations**: insert, delete, move, merge, split
- **Keyboard shortcuts** compatible with Jupyter conventions
- **Export notebooks** to Python scripts or HTML
- **Status bar integration** showing kernel status

## Installation

To install `jupypter-next` search for [jupypter-next](https://web.pulsar-edit.dev/packages/jupypter-next) in the Install pane of the Pulsar settings or run `ppm install jupypter-next`. Alternatively, you can run `ppm install asiloisad/pulsar-jupypter-next` to install a package directly from the GitHub repository.

Make sure [hydrogen-next](https://web.pulsar-edit.dev/packages/hydrogen-next) is installed, because this package reuse it elements.

## Usage

### Opening a Notebook

- Open any `.ipynb` file
- Or use `Packages > Jupyter > New Notebook`
- Or use the command palette: `Jupyter Panel: New Notebook`

### Running Cells

- **Shift+Enter**: Run cell and advance to next
- **Ctrl+Enter**: Run cell and stay
- **Alt+Enter**: Run cell and insert new cell below

### Cell Operations

- **A**: Insert cell above (command mode)
- **B**: Insert cell below (command mode)
- **D D**: Delete cell (command mode)
- **M**: Change to markdown (command mode)
- **Y**: Change to code (command mode)

## API

The package provides a service that other packages can consume:

```javascript
// In your package
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

# Contributing

Got ideas to make this package better, found a bug, or want to help add new features? Just drop your thoughts on GitHub — any feedback's welcome!
