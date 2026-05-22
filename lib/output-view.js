/**
 * OutputView - static renderer for stored Jupyter cell outputs.
 */

const Anser = require("anser");

function asText(value) {
  if (Array.isArray(value)) return value.join("");
  return value == null ? "" : String(value);
}

function escapeHtml(value) {
  return asText(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function adjustColorForContrast(rgbValues) {
  const parts = rgbValues.split(",").map((part) => parseInt(part.trim(), 10));
  if (parts.length !== 3) return rgbValues;

  const [red, green, blue] = parts;
  const luminance = (0.299 * red + 0.587 * green + 0.114 * blue) / 255;

  if (luminance < 0.5) {
    return `${Math.min(255, red + 100)}, ${Math.min(255, green + 100)}, ${Math.min(
      255,
      blue + 100,
    )}`;
  }

  return `${Math.max(0, red - 100)}, ${Math.max(0, green - 100)}, ${Math.max(0, blue - 100)}`;
}

function appendAnsiText(parent, text) {
  const parsed = Anser.ansiToJson(asText(text), { remove_empty: true });

  for (const part of parsed) {
    if (!part.content) continue;

    const { fg, bg, decoration } = part;
    let foreground = fg || null;
    const background = bg || null;

    const span = document.createElement("span");
    span.textContent = part.content;

    if (foreground && background && foreground === background) {
      foreground = adjustColorForContrast(foreground);
    }
    if (foreground) span.style.color = `rgb(${foreground})`;
    if (background) span.style.backgroundColor = `rgb(${background})`;
    if (decoration === "bold") span.style.fontWeight = "bold";
    else if (decoration === "italic") span.style.fontStyle = "italic";
    else if (decoration === "underline") span.style.textDecoration = "underline";

    parent.appendChild(span);
  }
}

function appendText(parent, className, text) {
  const pre = document.createElement("pre");
  pre.className = className;
  appendAnsiText(pre, text);
  parent.appendChild(pre);
}

function appendMimeBundle(parent, output) {
  const data = output.data || {};

  if (data["image/png"] || data["image/jpeg"] || data["image/gif"]) {
    const mime = data["image/png"] ? "image/png" : data["image/jpeg"] ? "image/jpeg" : "image/gif";
    const img = document.createElement("img");
    img.className = "output-image";
    img.src = `data:${mime};base64,${asText(data[mime]).replace(/\s/g, "")}`;
    parent.appendChild(img);
    return;
  }

  if (data["image/svg+xml"]) {
    const wrapper = document.createElement("div");
    wrapper.className = "output-svg";
    wrapper.innerHTML = asText(data["image/svg+xml"]);
    parent.appendChild(wrapper);
    return;
  }

  if (data["text/html"]) {
    const wrapper = document.createElement("div");
    wrapper.className = "output-html";
    wrapper.innerHTML = asText(data["text/html"]);
    parent.appendChild(wrapper);
    return;
  }

  if (data["text/markdown"]) {
    const wrapper = document.createElement("div");
    wrapper.className = "output-markdown";
    wrapper.innerHTML = escapeHtml(data["text/markdown"]).replace(/\n/g, "<br>");
    parent.appendChild(wrapper);
    return;
  }

  if (data["application/json"]) {
    appendText(
      parent,
      "output-json output-code",
      JSON.stringify(data["application/json"], null, 2),
    );
    return;
  }

  if (data["text/plain"]) {
    appendText(parent, "output-text", data["text/plain"]);
  }
}

class OutputView {
  constructor(props) {
    this.props = props;
    this.element = document.createElement("div");
    this.element.className = "jupyter-output-container";
    this._lastOutputsHash = null;
    this._lastMaxHeight = null;
    this.renderContent();
  }

  _getOutputsHash(outputs) {
    if (!outputs || outputs.length === 0) return "empty";
    return JSON.stringify(outputs);
  }

  renderOutput(output, index) {
    const item = document.createElement("div");
    item.className = `jupyter-output output-${output.output_type || "unknown"}`;
    item.dataset.outputIndex = String(index);

    if (output.output_type === "stream") {
      appendText(item, `output-stream output-${output.name || "stream"}`, output.text);
    } else if (output.output_type === "error") {
      const traceback =
        output.traceback && output.traceback.length
          ? output.traceback
          : [`${output.ename || "Error"}: ${output.evalue || ""}`];
      appendText(item, "output-error", traceback.join("\n"));
    } else if (output.output_type === "display_data" || output.output_type === "execute_result") {
      appendMimeBundle(item, output);
    } else if (output.text) {
      appendText(item, "output-text", output.text);
    }

    return item;
  }

  renderContent() {
    const { outputs, maxHeight } = this.props;
    this._lastOutputsHash = this._getOutputsHash(outputs);
    this._lastMaxHeight = maxHeight;

    const wrapper = document.createElement("div");
    wrapper.className = "jupyter-outputs";
    if (maxHeight > 0) {
      wrapper.style.maxHeight = `${maxHeight}px`;
      wrapper.style.overflowY = "auto";
    }

    for (const [index, output] of (outputs || []).entries()) {
      wrapper.appendChild(this.renderOutput(output, index));
    }

    this.element.innerHTML = "";
    this.element.appendChild(wrapper);
  }

  update(props) {
    this.props = { ...this.props, ...props };

    const newHash = this._getOutputsHash(this.props.outputs);
    const maxHeightChanged = this.props.maxHeight !== this._lastMaxHeight;

    if (newHash === this._lastOutputsHash && !maxHeightChanged) return;

    if (newHash === this._lastOutputsHash && maxHeightChanged) {
      const container = this.element.querySelector(".jupyter-outputs");
      if (container) {
        if (this.props.maxHeight > 0) {
          container.style.maxHeight = `${this.props.maxHeight}px`;
          container.style.overflowY = "auto";
        } else {
          container.style.maxHeight = "";
          container.style.overflowY = "";
        }
        this._lastMaxHeight = this.props.maxHeight;
        return;
      }
    }

    this.renderContent();
  }

  destroy() {
    this.element = null;
  }
}

module.exports = OutputView;
