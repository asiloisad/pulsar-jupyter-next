const SelectListView = require("pulsar-select-list");

class KernelPicker {
  constructor(kernelManager, options = {}) {
    this.kernelManager = kernelManager;
    this.panel = null;
    this.previouslyFocusedElement = null;
    this.onConfirmed = null;
    // Optional: preferred kernel name from notebook metadata
    this.preferredKernelName = options.preferredKernelName || null;
    // Optional: language to filter kernels (from notebook metadata)
    this.language = options.language || null;

    this.selectList = new SelectListView({
      itemsClassList: ["mark-active"],
      items: [],
      className: "jupyter-next kernel-picker",
      filterKeyForItem: (item) => item.displayName,
      emptyMessage: "No kernels found",

      willShow: () => {
        this.previouslyFocusedElement = document.activeElement;
      },

      elementForItem: (item, options) => {
        const element = document.createElement("li");
        const matches = this.selectList.getMatchIndices(item) || [];

        element.appendChild(
          SelectListView.highlightMatches(item.displayName, matches)
        );

        return element;
      },

      didConfirmSelection: (item) => {
        if (this.onConfirmed) {
          this.onConfirmed(item);
        }
        this.cancel();
      },

      didCancelSelection: () => {
        if (this.onConfirmed) {
          this.onConfirmed(null);
        }
        this.cancel();
      },
    });
  }

  async show() {
    return new Promise(async (resolve) => {
      this.onConfirmed = resolve;

      // Get available kernels - filter by language if specified (like hydrogen-next)
      const specs = this.language
        ? await this.kernelManager.getKernelSpecsForLanguage(this.language)
        : await this.kernelManager.getKernelSpecs();

      // Check if auto kernel picker is enabled (use hydrogen-next config)
      const autoKernelPicker = atom.config.get(
        "hydrogen-next.autoKernelPicker"
      );

      if (specs.length === 0) {
        // No kernels available
        resolve(null);
        return;
      }

      if (specs.length === 1) {
        // Only one kernel available - always auto-select
        resolve(specs[0]);
        return;
      }

      if (autoKernelPicker) {
        // Auto kernel picker enabled - try to find preferred kernel or use first
        if (this.preferredKernelName) {
          const preferred = specs.find(
            (s) => s.name === this.preferredKernelName
          );
          if (preferred) {
            resolve(preferred);
            return;
          }
        }
        // No preferred kernel found, use first available
        resolve(specs[0]);
        return;
      }

      // Manual selection - show picker UI
      await this.selectList.update({ items: specs });
      this.attach();
    });
  }

  attach() {
    if (this.panel == null) {
      this.panel = atom.workspace.addModalPanel({
        item: this.selectList,
      });
    }
    this.selectList.focus();
    this.selectList.reset();
  }

  cancel() {
    if (this.panel != null) {
      this.panel.destroy();
      this.panel = null;
    }

    if (this.previouslyFocusedElement) {
      this.previouslyFocusedElement.focus();
      this.previouslyFocusedElement = null;
    }
  }

  destroy() {
    this.cancel();
    this.selectList.destroy();
  }
}

module.exports = KernelPicker;
