const { SelectListView, highlightMatches } = require("@asiloisad/select-list");

class KernelPicker {
  constructor(kernelManager, options = {}) {
    this.kernelManager = kernelManager;
    this.onConfirmed = null;
    // Optional: preferred kernel name from notebook metadata
    this.preferredKernelName = options.preferredKernelName || null;
    this.preferredKernelDisplayName = options.preferredKernelDisplayName || null;
    // Optional: language to filter kernels (from notebook metadata)
    this.language = options.language || null;
    this.forceSelection = options.forceSelection || false;
    this.filterByLanguage = options.filterByLanguage !== false;

    this.selectList = new SelectListView({
      itemsClassList: ["mark-active"],
      className: "jupyter-next kernel-picker",
      filterKeyForItem: (item) => item.displayName,
      emptyMessage: "No kernels found",
      elementForItem: (item, { filterKey, matchIndices }) => {
        const element = document.createElement("li");
        element.appendChild(highlightMatches(filterKey, matchIndices));
        return element;
      },
      didConfirmSelection: (item) => {
        if (this.onConfirmed) {
          this.onConfirmed(item);
        }
        this.selectList.hide();
      },
      didCancelSelection: () => {
        if (this.onConfirmed) {
          this.onConfirmed(null);
        }
        this.selectList.hide();
      },
    });
  }

  async show() {
    // Get available kernels - filter by language if specified (like hydrogen-next)
    const specs = this.language && this.filterByLanguage
      ? await this.kernelManager.getKernelSpecsForLanguage(this.language)
      : await this.kernelManager.getKernelSpecs();

    // Check if auto kernel picker is enabled (use hydrogen-next config)
    const autoKernelPicker = atom.config.get("hydrogen-next.autoKernelPicker");

    if (specs.length === 0) {
      // No kernels available
      return null;
    }

    if (!this.forceSelection && specs.length === 1) {
      // Only one kernel available - always auto-select
      return specs[0];
    }

    if (!this.forceSelection && autoKernelPicker) {
      // Auto kernel picker enabled - try to find preferred kernel or use first
      if (this.preferredKernelName || this.preferredKernelDisplayName) {
        const preferred = specs.find((spec) => this._matchesPreferredKernel(spec));
        if (preferred) {
          return preferred;
        }
      }
      // No preferred kernel found, use first available
      return specs[0];
    }

    // Manual selection - show picker UI
    return new Promise((resolve) => {
      const initialSelectionIndex = this._getPreferredSelectionIndex(specs);
      this.onConfirmed = resolve;
      this.selectList.update({ items: specs, initialSelectionIndex }).then(() => {
        this.selectList.show();
      });
    });
  }

  _getPreferredSelectionIndex(specs) {
    if (!this.preferredKernelName && !this.preferredKernelDisplayName) return 0;

    const index = specs.findIndex((spec) => this._matchesPreferredKernel(spec));
    return index === -1 ? 0 : index;
  }

  _matchesPreferredKernel(spec) {
    return (
      this._matchesKernelValue(this.preferredKernelName, spec.name) ||
      this._matchesKernelValue(this.preferredKernelName, spec.displayName) ||
      this._matchesKernelValue(this.preferredKernelName, spec.display_name) ||
      this._matchesKernelValue(this.preferredKernelDisplayName, spec.name) ||
      this._matchesKernelValue(this.preferredKernelDisplayName, spec.displayName) ||
      this._matchesKernelValue(this.preferredKernelDisplayName, spec.display_name)
    );
  }

  _matchesKernelValue(preferred, actual) {
    if (!preferred || !actual) return false;
    if (actual === preferred) return true;
    return String(actual).toLowerCase() === String(preferred).toLowerCase();
  }

  destroy() {
    this.selectList.destroy();
  }
}

module.exports = KernelPicker;
