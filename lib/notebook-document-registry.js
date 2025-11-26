const NotebookDocument = require('./notebook-document')
const JupyterNotebookEditor = require('./jupyter-notebook-editor')

/**
 * NotebookDocumentRegistry manages the mapping between file paths and NotebookDocuments.
 * This ensures that multiple editors opening the same file share the same document
 * (like Pulsar's TextBuffer registry).
 */
class NotebookDocumentRegistry {
  constructor(kernelManager) {
    this.kernelManager = kernelManager
    this.documents = new Map() // filePath -> NotebookDocument
    this.untitledCounter = 0
  }

  /**
   * Get or create a document for the given file path.
   * Returns an existing document if one is already open for this path.
   */
  async getOrCreateDocument(filePath) {
    if (filePath && this.documents.has(filePath)) {
      return this.documents.get(filePath)
    }

    const document = new NotebookDocument(filePath, this.kernelManager)

    if (filePath) {
      this.documents.set(filePath, document)

      // Remove from registry when document is destroyed
      document.onDidDestroy(() => {
        this.documents.delete(filePath)
      })

      // Update registry if path changes (Save As)
      document.onDidChangePath((newPath) => {
        // Remove old path entry
        for (const [path, doc] of this.documents) {
          if (doc === document && path !== newPath) {
            this.documents.delete(path)
            break
          }
        }
        // Add new path entry
        if (newPath) {
          this.documents.set(newPath, document)
        }
      })
    }

    await document.load()
    return document
  }

  /**
   * Create a new untitled document.
   */
  async createUntitledDocument() {
    this.untitledCounter++
    const document = new NotebookDocument(null, this.kernelManager)
    await document.initialize()
    return document
  }

  /**
   * Build an editor for a file path.
   * This is the main entry point for opening notebooks.
   */
  async buildEditor(filePath) {
    const document = filePath
      ? await this.getOrCreateDocument(filePath)
      : await this.createUntitledDocument()

    return new JupyterNotebookEditor(document)
  }

  /**
   * Build an editor from serialized notebook data (for restoring unsaved notebooks).
   */
  async buildEditorFromData(notebookData, activeCellIndex = 0) {
    this.untitledCounter++
    const document = new NotebookDocument(null, this.kernelManager)
    await document.initializeFromData(notebookData)

    const editor = new JupyterNotebookEditor(document)
    editor.setActiveCell(activeCellIndex)
    return editor
  }

  /**
   * Get the document for a file path if it exists.
   */
  getDocument(filePath) {
    return this.documents.get(filePath)
  }

  /**
   * Check if a document exists for a file path.
   */
  hasDocument(filePath) {
    return this.documents.has(filePath)
  }

  /**
   * Get all open documents.
   */
  getDocuments() {
    return Array.from(this.documents.values())
  }

  /**
   * Destroy all documents and clean up.
   */
  destroy() {
    for (const document of this.documents.values()) {
      document.destroy()
    }
    this.documents.clear()
  }
}

module.exports = NotebookDocumentRegistry
