# Jupyter Next for Pulsar

Jupyter notebook support for Pulsar with interactive computing, kernel management, and rich output rendering.

## Features

- **Open and edit Jupyter notebooks** (.ipynb files)
- **Execute code cells** with real-time output
- **Markdown cells** with live preview
- **Multiple kernel support** (Python, Julia, R, and more)
- **Rich output rendering** including images, HTML, LaTeX, and plots
- **Cell operations**: insert, delete, move, merge, split
- **Keyboard shortcuts** compatible with Jupyter conventions
- **Export notebooks** to Python scripts or HTML
- **Status bar integration** showing kernel status

## Requirements

- Python 3.6+
- Jupyter (`pip install jupyter`)
- IPython kernel (`pip install ipykernel`)

## Installation

### From Pulsar

1. Open Pulsar Settings (Ctrl+,)
2. Go to Install
3. Search for `jupyter-next`
4. Click Install

### From Source

```bash
cd ~/.pulsar/packages
git clone https://github.com/pulsar-edit/jupyter-next.git
cd jupyter-next
npm install
```

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

### Kernel Operations

- **Ctrl+Shift+C**: Interrupt kernel
- **Ctrl+Shift+R**: Restart kernel

## Configuration

Open Pulsar Settings and navigate to Packages > jupyter-next.

### Kernel Settings

- **Python Path**: Path to Python executable
- **Jupyter Path**: Path to Jupyter executable
- **Startup Timeout**: Maximum time to wait for kernel startup

### Notebook Settings

- **Default Kernel**: Default kernel for new notebooks
- **Auto Save**: Automatically save after cell execution
- **Max Output Height**: Maximum height for output scrolling

### Display Settings

- **Theme**: Light, dark, or auto
- **Font Size**: Custom font size for cells
- **Line Numbers**: Show line numbers in code cells

## Keybindings

| Key | Action |
|-----|--------|
| Shift+Enter | Run cell and advance |
| Ctrl+Enter | Run cell |
| Alt+Enter | Run and insert below |
| A | Insert cell above |
| B | Insert cell below |
| D D | Delete cell |
| M | Change to markdown |
| Y | Change to code |
| Ctrl+Shift+C | Interrupt kernel |
| Ctrl+Shift+R | Restart kernel |
| Ctrl+Up | Focus previous cell |
| Ctrl+Down | Focus next cell |
| Escape | Exit edit mode |

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

## Known Limitations

- ZMQ-based kernel communication requires native modules
- Some IPyWidgets may not render correctly
- Large notebook files may impact performance

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## License

MIT License - see [LICENSE](LICENSE) for details.

## Credits

Inspired by [vscode-jupyter](https://github.com/microsoft/vscode-jupyter) by Microsoft.
