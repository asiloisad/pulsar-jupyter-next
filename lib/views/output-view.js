/**
 * OutputView - React component for rendering Jupyter cell outputs
 *
 * This component uses hydrogen-next's shared output rendering components
 * for consistent display between inline and notebook modes.
 */

const { getHydrogenShared, loadReact } = require("../react-utils");

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
              const len = Array.isArray(val)
                ? val.join("").length
                : val?.length || 0;
              return `${k}:${len}`;
            })
            .join(",");
        }
        return `${type}:${content.length}:${content.slice(0, 100)}`;
      })
      .join("|");
  }

  renderContent() {
    const { React, ReactDOM } = loadReact();

    if (!React || !ReactDOM) {
      this.renderFallback();
      return;
    }

    const shared = getHydrogenShared();
    const { outputs, maxHeight } = this.props;

    // Track what we rendered for efficient update detection
    this._lastOutputsHash = this._getOutputsHash(outputs);
    this._lastMaxHeight = maxHeight;

    const scrollOutput = atom.config.get("jupyter-next.notebook.scrollOutput");
    const style =
      scrollOutput && maxHeight
        ? { maxHeight: `${maxHeight}px`, overflowY: "auto" }
        : {};

    // Render using hydrogen-next's Display component
    if (shared && shared.Display) {
      const elements = (outputs || []).map((output, index) => {
        // Normalize the output using shared utility
        const normalizedOutput = shared.normalizeOutput(output);

        return React.createElement(
          "div",
          {
            key: index,
            className: `jupyter-output output-${output.output_type}`,
          },
          React.createElement(shared.Display, { output: normalizedOutput })
        );
      });

      const wrapper = React.createElement(
        "div",
        {
          className: "jupyter-outputs",
          style,
        },
        ...elements
      );

      ReactDOM.render(wrapper, this.element);
    } else {
      // hydrogen-next shared module required - show error if not available
      console.error(
        "[jupyter-next] hydrogen-next shared module is required for output rendering"
      );
      this.renderFallback();
    }
  }

  /**
   * Fallback rendering when React is not available
   * Uses hydrogen-next's shared utilities for ANSI and HTML handling
   */
  renderFallback() {
    const shared = getHydrogenShared();
    const ansiToHtml = shared?.ansiToHtml || this._ansiToHtmlSimple.bind(this);
    const sanitizeHtml =
      shared?.sanitizeHtml || this._sanitizeHtmlSimple.bind(this);

    const { outputs, maxHeight } = this.props;

    // Track what we rendered for efficient update detection
    this._lastOutputsHash = this._getOutputsHash(outputs);
    this._lastMaxHeight = maxHeight;
    const scrollOutput = atom.config.get("jupyter-next.notebook.scrollOutput");

    const container = document.createElement("div");
    container.className = "jupyter-outputs";

    if (scrollOutput && maxHeight) {
      container.style.maxHeight = `${maxHeight}px`;
      container.style.overflowY = "auto";
    }

    if (!outputs || outputs.length === 0) {
      this.element.appendChild(container);
      return;
    }

    outputs.forEach((output) => {
      const div = document.createElement("div");
      div.className = `jupyter-output output-${
        output.output_type || "unknown"
      }`;

      switch (output.output_type) {
        case "stream":
          const pre = document.createElement("pre");
          pre.className =
            output.name === "stderr" ? "output-stderr" : "output-stdout";
          pre.innerHTML = ansiToHtml(
            Array.isArray(output.text) ? output.text.join("") : output.text
          );
          div.appendChild(pre);
          break;

        case "execute_result":
        case "display_data":
          this.renderDisplayDataFallback(
            div,
            output.data,
            sanitizeHtml,
            ansiToHtml
          );
          break;

        case "error":
          const errorDiv = document.createElement("div");
          errorDiv.className = "output-error";
          const header = document.createElement("div");
          header.className = "error-header";
          header.textContent = `${output.ename}: ${output.evalue}`;
          errorDiv.appendChild(header);

          if (output.traceback) {
            const tb = document.createElement("pre");
            tb.className = "error-traceback";
            tb.innerHTML = output.traceback
              .map((line) =>
                ansiToHtml(Array.isArray(line) ? line.join("") : line)
              )
              .join("\n");
            errorDiv.appendChild(tb);
          }
          div.appendChild(errorDiv);
          break;

        default:
          div.textContent = `Unknown output type: ${output.output_type}`;
      }

      container.appendChild(div);
    });

    this.element.appendChild(container);
  }

  renderDisplayDataFallback(container, data, sanitizeHtml, ansiToHtml) {
    if (!data) return;

    const mimeTypes = [
      "text/html",
      "image/svg+xml",
      "image/png",
      "image/jpeg",
      "image/gif",
      "application/json",
      "text/latex",
      "text/markdown",
      "text/plain",
    ];

    for (const mimeType of mimeTypes) {
      if (data[mimeType]) {
        const content = Array.isArray(data[mimeType])
          ? data[mimeType].join("")
          : data[mimeType];

        switch (mimeType) {
          case "text/html":
            const htmlDiv = document.createElement("div");
            htmlDiv.className = "output-html";
            htmlDiv.innerHTML = sanitizeHtml(content);
            container.appendChild(htmlDiv);
            return;

          case "image/svg+xml":
            const svgDiv = document.createElement("div");
            svgDiv.className = "output-svg";
            svgDiv.innerHTML = content;
            container.appendChild(svgDiv);
            return;

          case "image/png":
          case "image/jpeg":
          case "image/gif":
            const img = document.createElement("img");
            img.src = `data:${mimeType};base64,${content}`;
            img.alt = "Output image";
            container.appendChild(img);
            return;

          case "text/plain":
          default:
            const textPre = document.createElement("pre");
            textPre.className = "output-text";
            textPre.innerHTML = ansiToHtml(content);
            container.appendChild(textPre);
            return;
        }
      }
    }
  }

  // Simple ANSI to HTML fallback (only used if hydrogen-next unavailable)
  _ansiToHtmlSimple(text) {
    if (!text) return "";
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\x1b\[[0-9;]*m/g, "");
  }

  // Simple HTML sanitization fallback (only used if hydrogen-next unavailable)
  _sanitizeHtmlSimple(html) {
    if (!html) return "";
    return html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
      .replace(/\s*on\w+\s*=\s*["'][^"']*["']/gi, "")
      .replace(/\s*on\w+\s*=\s*[^\s>]+/gi, "");
  }

  update(props) {
    const oldProps = this.props;
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
        const scrollOutput = atom.config.get(
          "jupyter-next.notebook.scrollOutput"
        );
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
    this.element.innerHTML = "";
    this.renderContent();
  }

  destroy() {
    if (!this.element) return;

    const { ReactDOM } = loadReact();
    if (ReactDOM) {
      try {
        if (this.element.parentNode) {
          ReactDOM.unmountComponentAtNode(this.element);
        }
      } catch (e) {
        // Ignore cleanup errors
      }
    }
    if (this.element) {
      this.element.innerHTML = "";
    }
    this.element = null;
  }
}

module.exports = OutputView;
