/**
 * CellModel - Data model for individual notebook cells
 *
 * Uses shared utilities from hydrogen-next for output normalization
 * and execution time formatting.
 */

const { Emitter } = require("atom");
const { getHydrogenShared } = require("./react-utils");

class CellModel {
  constructor({
    id,
    type,
    source,
    outputs,
    executionCount,
    metadata,
    executionTime,
  }) {
    this.id = id;
    this.type = type || "code";
    this.source = source || "";
    this.outputs = outputs || [];
    this.executionCount = executionCount;
    this.metadata = metadata || {};
    this.running = false;
    this.status = "idle";
    this.outputVisible = true;
    this.inputVisible = true;
    this.executionTime = executionTime || null;
    this._executionTimeTracker = null; // Use shared tracker from hydrogen-next
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

  setRunning(running) {
    this.running = running;
    this.status = running ? "running" : "idle";

    if (running) {
      // Use shared execution time tracker from hydrogen-next
      const shared = getHydrogenShared();
      this._executionTimeTracker = shared.createExecutionTimeTracker();
      this._executionTimeTracker.start();
      this.executionTime = null;
    } else if (this._executionTimeTracker) {
      this.executionTime = this._executionTimeTracker.stop();
      this._executionTimeTracker = null;
    }
    this.emitter.emit("did-change-status", this.status);
  }

  setExecutionTime(time) {
    this.executionTime = time;
    this.emitter.emit("did-change");
  }

  /**
   * Get formatted execution time using hydrogen-next's shared utility.
   * Returns live elapsed time if currently running.
   */
  getFormattedExecutionTime() {
    // If running, use tracker for live elapsed time
    if (this._executionTimeTracker?.isRunning()) {
      return this._executionTimeTracker.getFormattedTime();
    }

    if (this.executionTime === null) return null;

    const shared = getHydrogenShared();
    return shared.formatExecutionTime(this.executionTime);
  }

  setStatus(status) {
    this.status = status;
    this.emitter.emit("did-change-status", status);
  }

  setExecutionCount(count) {
    this.executionCount = count;
    this.emitter.emit("did-change");
  }

  /**
   * Add output to cell, using hydrogen-next's shared utilities
   */
  addOutput(output) {
    const shared = getHydrogenShared();

    // Normalize output first
    const normalizedOutput = shared.normalizeOutput(output);

    // Use shared reduceOutputs for smart stream merging
    // Handles both same-name merging and interleaved stdout/stderr
    shared.reduceOutputs(this.outputs, normalizedOutput);

    this.emitter.emit("did-change");
  }

  clearOutputs() {
    this.outputs = [];
    this.executionCount = null;
    this.executionTime = null;
    this.status = "idle";
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
    const shared = getHydrogenShared();
    return shared.getOutputPlainText(this.outputs);
  }

  /**
   * Convert cell to notebook JSON format
   */
  toJSON() {
    const shared = getHydrogenShared();

    const cell = {
      id: this.id,
      cell_type: this.type,
      metadata: this.metadata,
      source: this.source
        .split("\n")
        .map((line, i, arr) => (i < arr.length - 1 ? line + "\n" : line))
        .filter((line) => line !== ""),
    };

    if (this.type === "code") {
      cell.execution_count = this.executionCount;
      cell.outputs = this.outputs.map((output) =>
        shared.outputToNotebookFormat(output)
      );
    }

    return cell;
  }

  onDidChange(callback) {
    return this.emitter.on("did-change", callback);
  }

  onDidChangeStatus(callback) {
    return this.emitter.on("did-change-status", callback);
  }

  destroy() {
    this.emitter.dispose();
  }
}

module.exports = CellModel;
