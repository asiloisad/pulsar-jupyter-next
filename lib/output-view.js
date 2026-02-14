/**
 * OutputView - React component for rendering Jupyter cell outputs
 *
 * This component uses hydrogen-next's shared output rendering components
 * for consistent display between inline and notebook modes.
 */

const { getHydrogenShared, loadReact } = require("./react-utils");

/**
 * OutputView wrapper class that manages React rendering
 */
class OutputView {
  constructor(props) {
    this.props = props;
    this.element = document.createElement("div");
    this.element.className = "jupyter-output-container";
    // Track last rendered outputs for efficient diffing
    this._lastOutputsHash = null;
    this._lastMaxHeight = null;
    this.renderContent();
  }

  /**
   * Generate a hash string to compare outputs efficiently
   */
  _getOutputsHash(outputs) {
    if (!outputs || outputs.length === 0) return "empty";
    return outputs
      .map((o) => {
        // Create a simple hash based on output type and key content
        const type = o.output_type || "unknown";
        let content = "";
        if (type === "stream") {
          content = Array.isArray(o.text) ? o.text.join("") : o.text || "";
        } else if (type === "error") {
          content = `${o.ename}:${o.evalue}:${(o.traceback || []).length}`;
        } else if (o.data) {
          // For display_data/execute_result, hash the mime types and content lengths
          content = Object.keys(o.data)
            .map((k) => {
              const val = o.data[k];
              const len = Array.isArray(val) ? val.join("").length : val?.length || 0;
              return `${k}:${len}`;
            })
            .join(",");
        }
        return `${type}:${content.length}:${content.slice(0, 100)}`;
      })
      .join("|");
  }

  renderContent() {
    const { React } = loadReact();
    const { render } = require("./react-utils");
    const shared = getHydrogenShared();
    const { outputs, maxHeight } = this.props;

    // Track what we rendered for efficient update detection
    this._lastOutputsHash = this._getOutputsHash(outputs);
    this._lastMaxHeight = maxHeight;

    const scrollOutput = atom.config.get("jupyter-next.scrollOutput");
    const style =
      scrollOutput && maxHeight ? { maxHeight: `${maxHeight}px`, overflowY: "auto" } : {};

    // Render using hydrogen-next's Display component
    const elements = (outputs || []).map((output, index) => {
      // Normalize the output using shared utility
      const normalizedOutput = shared.normalizeOutput(output);

      return React.createElement(
        "div",
        {
          key: index,
          className: `jupyter-output output-${output.output_type}`,
        },
        React.createElement(shared.Display, { output: normalizedOutput }),
      );
    });

    const wrapper = React.createElement(
      "div",
      {
        className: "jupyter-outputs",
        style,
      },
      ...elements,
    );

    // Use react-utils render which handles React 18+ createRoot API
    render(wrapper, this.element);
  }

  update(props) {
    this.props = { ...this.props, ...props };

    // Check if outputs actually changed by comparing hashes
    const newHash = this._getOutputsHash(props.outputs);
    const maxHeightChanged = props.maxHeight !== this._lastMaxHeight;

    // Skip re-render if nothing changed
    if (newHash === this._lastOutputsHash && !maxHeightChanged) {
      return;
    }

    // Only update maxHeight style if that's the only change (avoid full re-render)
    if (newHash === this._lastOutputsHash && maxHeightChanged) {
      const container = this.element.querySelector(".jupyter-outputs");
      if (container) {
        const scrollOutput = atom.config.get("jupyter-next.notebook.scrollOutput");
        if (scrollOutput && props.maxHeight) {
          container.style.maxHeight = `${props.maxHeight}px`;
          container.style.overflowY = "auto";
        } else {
          container.style.maxHeight = "";
          container.style.overflowY = "";
        }
        this._lastMaxHeight = props.maxHeight;
        return;
      }
    }

    // Outputs changed - need full re-render
    // Unmount React root BEFORE clearing DOM to avoid React 19 errors
    const { unmount } = require("./react-utils");
    unmount(this.element);
    this.element.innerHTML = "";
    this.renderContent();
  }

  destroy() {
    if (!this.element) return;

    const { unmount } = require("./react-utils");
    // Use react-utils unmount which handles React 19 root.unmount() API
    // Note: unmount clears the root from the map first to prevent errors
    unmount(this.element);
    this.element = null;
  }
}

module.exports = OutputView;
