/**
 * CellModel - Data model for individual notebook cells
 */

const { Emitter } = require("atom");
const Anser = require("anser");

function sourceToNotebookLines(source) {
  return (source || "")
    .split("\n")
    .map((line, i, arr) => (i < arr.length - 1 ? line + "\n" : line))
    .filter((line) => line !== "");
}

function asPlainText(value) {
  const text = Array.isArray(value) ? value.join("") : value || "";
  return Anser.ansiToText(text).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function escapeCarriageReturn(text) {
  if (!text || typeof text !== "string") return text;

  const lines = text.split("\n");
  const result = [];

  for (const line of lines) {
    if (!line.includes("\r")) {
      result.push(line);
      continue;
    }

    const segments = line.split("\r");
    let currentLine = "";

    for (const segment of segments) {
      if (segment === "") {
        currentLine = "";
      } else {
        currentLine = segment + currentLine.slice(segment.length);
      }
    }
    result.push(currentLine);
  }

  return result.join("\n");
}

function getOutputText(output) {
  if (!output) return "";
  if (output.output_type === "stream") {
    return asPlainText(output.text);
  }
  if (output.output_type === "error") {
    return asPlainText(
      [output.ename, output.evalue, ...(output.traceback || [])].filter(Boolean).join("\n"),
    );
  }
  const data = output.data || {};
  const text = data["text/plain"] || data["text/html"] || data["text/markdown"];
  return asPlainText(text);
}

class CellModel {
  constructor({ id, type, source, outputs, executionCount, metadata }) {
    this.id = id;
    this.type = type || "code";
    this.source = source || "";
    this.outputs = outputs || [];
    this.executionCount = executionCount;
    this.metadata = metadata || {};
    this.outputVisible = true;
    this.inputVisible = true;
    this.emitter = new Emitter();
  }

  setType(type) {
    if (["code", "markdown", "raw"].includes(type)) {
      this.type = type;
      if (type !== "code") {
        this.outputs = [];
        this.executionCount = null;
      }
      this.emitter.emit("did-change");
    }
  }

  setSource(source) {
    this.source = source;
    this.emitter.emit("did-change");
  }

  setExecutionCount(count) {
    this.executionCount = count;
    this.emitter.emit("did-change");
  }

  /**
   * Add output to the cell. Adjacent streams with the same name are merged.
   */
  addOutput(output) {
    const previous = this.outputs[this.outputs.length - 1];
    if (
      previous &&
      previous.output_type === "stream" &&
      output?.output_type === "stream" &&
      previous.name === output.name
    ) {
      const previousText = Array.isArray(previous.text) ? previous.text.join("") : previous.text || "";
      const nextText = Array.isArray(output.text) ? output.text.join("") : output.text || "";
      previous.text = escapeCarriageReturn(previousText + nextText);
    } else if (output) {
      this.outputs.push(output);
    }

    this.emitter.emit("did-change");
  }

  clearOutputs() {
    this.outputs = [];
    this.executionCount = null;
    this.emitter.emit("did-change");
  }

  toggleOutputVisibility() {
    this.outputVisible = !this.outputVisible;
    this.emitter.emit("did-change");
  }

  toggleInputVisibility() {
    this.inputVisible = !this.inputVisible;
    this.emitter.emit("did-change");
  }

  getDisplaySource() {
    return this.source;
  }

  hasOutput() {
    return this.outputs && this.outputs.length > 0;
  }

  /**
   * Get plain text representation of outputs
   */
  getOutputText() {
    return (this.outputs || []).map(getOutputText).filter(Boolean).join("\n");
  }

  /**
   * Convert cell to notebook JSON format
   */
  toJSON() {
    const cell = {
      id: this.id,
      cell_type: this.type,
      metadata: this.metadata,
      source: sourceToNotebookLines(this.source),
    };

    if (this.type === "code") {
      cell.execution_count = this.executionCount;
      cell.outputs = this.outputs || [];
    }

    return cell;
  }

  onDidChange(callback) {
    return this.emitter.on("did-change", callback);
  }

  destroy() {
    this.emitter.dispose();
  }
}

module.exports = CellModel;
