/**
 * Kernel Manager for jupyter-next
 *
 * This module wraps hydrogen-next's kernel management functionality,
 * adapting it for notebook-style execution.
 */

const { Emitter } = require("atom");
const { getHydrogenShared } = require("./react-utils");

// Lazy load hydrogen-next kernel manager
let hydrogenKernelManager = null;

function getHydrogenKernelManager() {
  if (hydrogenKernelManager) {
    return hydrogenKernelManager;
  }

  // Use shared module's KernelManager export
  const shared = getHydrogenShared();
  if (shared && shared.KernelManager) {
    hydrogenKernelManager = new shared.KernelManager();
    return hydrogenKernelManager;
  }

  console.error("[jupyter-next] hydrogen-next KernelManager not available");
  return null;
}

/**
 * KernelManager - Manages Jupyter kernel lifecycle for notebooks
 */
class KernelManager {
  constructor() {
    this.emitter = new Emitter();
    this.kernels = new Map();
    this.kernelSpecs = null;
  }

  /**
   * Get all available kernel specs
   */
  async getKernelSpecs() {
    if (this.kernelSpecs) {
      return this.kernelSpecs;
    }

    const hydrogenKM = getHydrogenKernelManager();
    if (!hydrogenKM) {
      throw new Error("hydrogen-next kernel manager not available");
    }

    const specs = await hydrogenKM.getAllKernelSpecs();
    if (!specs || specs.length === 0) {
      throw new Error(
        "No kernel specs found. Please install a Jupyter kernel (e.g., python -m pip install ipykernel)"
      );
    }

    this.kernelSpecs = specs.map((spec) => ({
      name: spec.name,
      displayName: spec.display_name,
      language: spec.language,
      resourceDir: spec.resource_dir,
      spec: spec,
    }));

    return this.kernelSpecs;
  }

  /**
   * Get kernel specs filtered by language
   */
  async getKernelSpecsForLanguage(language) {
    const specs = await this.getKernelSpecs();

    if (!language) {
      return specs;
    }

    const targetLanguage = language.toLowerCase();
    const shared = getHydrogenShared();

    // Use hydrogen-next's kernelSpecProvidesGrammar if available
    if (shared && shared.kernelSpecProvidesGrammar) {
      const grammar = { name: language };
      return specs.filter((spec) =>
        shared.kernelSpecProvidesGrammar(spec.spec, grammar)
      );
    }

    // Fallback: simple language matching
    const languageMappings =
      atom.config.get("hydrogen-next.languageMappings") || {};

    return specs.filter((spec) => {
      if (!spec.language) return false;

      const kernelLanguage = spec.language.toLowerCase();

      // Direct match
      if (kernelLanguage === targetLanguage) {
        return true;
      }

      // Check language mappings
      const mappedLanguage = languageMappings[kernelLanguage];
      if (mappedLanguage && mappedLanguage.toLowerCase() === targetLanguage) {
        return true;
      }

      return false;
    });
  }

  /**
   * Get or start a kernel by name
   */
  async getOrStartKernel(kernelName) {
    // Check if kernel is already running
    if (this.kernels.has(kernelName)) {
      const kernel = this.kernels.get(kernelName);
      if (kernel.isAlive()) {
        return kernel;
      }
      // Kernel died, remove it
      this.kernels.delete(kernelName);
    }

    // Start new kernel
    return this.startKernel(kernelName);
  }

  /**
   * Start a kernel by name
   */
  async startKernel(kernelName, editor = null) {
    const specs = await this.getKernelSpecs();
    const spec = specs.find((s) => s.name === kernelName);

    if (!spec) {
      throw new Error(`Kernel not found: ${kernelName}`);
    }

    return this._startHydrogenKernel(spec, editor);
  }

  /**
   * Start kernel using hydrogen-next's infrastructure
   */
  async _startHydrogenKernel(spec, editor) {
    const hydrogenKM = getHydrogenKernelManager();
    if (!hydrogenKM) {
      throw new Error("hydrogen-next kernel manager not available");
    }

    return new Promise((resolve, reject) => {
      try {
        const language = spec.language || "python";
        const grammar = {
          name: language,
          scopeName: `source.${language}`,
        };

        const filePath =
          editor?.getPath?.() || `jupyter-next-${spec.name}-${Date.now()}`;

        // Create mock editor for hydrogen-next
        const mockEditor = editor || {
          getGrammar: () => grammar,
          getPath: () => filePath,
          onDidDestroy: () => ({ dispose: () => {} }),
        };

        hydrogenKM.startKernel(
          spec.spec,
          grammar,
          mockEditor,
          filePath,
          (hydrogenKernel) => {
            const kernel = new HydrogenKernelWrapper(
              hydrogenKernel,
              spec,
              this
            );

            this.kernels.set(spec.name, kernel);

            kernel.onDidChangeStatus((status) => {
              this.emitter.emit("did-change-status", {
                kernelName: spec.name,
                status,
              });
            });

            kernel.onDidTerminate(() => {
              this.kernels.delete(spec.name);
              this.emitter.emit("did-terminate-kernel", spec.name);
            });

            this.emitter.emit("did-start-kernel", kernel);
            resolve(kernel);
          }
        );
      } catch (e) {
        reject(e);
      }
    });
  }

  /**
   * Shutdown a kernel by name
   */
  shutdownKernel(kernelName) {
    const kernel = this.kernels.get(kernelName);
    if (kernel) {
      kernel.shutdown();
      this.kernels.delete(kernelName);
    }
  }

  /**
   * Shutdown all kernels
   */
  shutdownAll() {
    for (const [name, kernel] of this.kernels) {
      try {
        kernel.shutdown();
      } catch (e) {
        console.error(`[jupyter-next] Error shutting down ${name}:`, e);
      }
    }
    this.kernels.clear();
  }

  /**
   * Restart a kernel
   */
  async restartKernel(kernelName) {
    const kernel = this.kernels.get(kernelName);
    if (kernel) {
      await kernel.restart();
    }
  }

  // Event handlers
  onDidChangeStatus(callback) {
    return this.emitter.on("did-change-status", callback);
  }

  onDidStartKernel(callback) {
    return this.emitter.on("did-start-kernel", callback);
  }

  onDidTerminateKernel(callback) {
    return this.emitter.on("did-terminate-kernel", callback);
  }

  destroy() {
    this.shutdownAll();
    this.emitter.dispose();
  }
}

/**
 * HydrogenKernelWrapper - Adapts hydrogen-next kernel to jupyter-next interface
 */
class HydrogenKernelWrapper {
  constructor(hydrogenKernel, spec, manager) {
    this.hydrogenKernel = hydrogenKernel;
    this.spec = spec;
    this.manager = manager;
    this.emitter = new Emitter();

    this.name = spec.name;
    this.displayName = spec.displayName || spec.display_name;
    this.language = spec.language;
    this.status = "idle";
    this.executionCount = 0;
    this._executionStateSubscription = null;

    this._subscribeToKernel();
  }

  _subscribeToKernel() {
    const kernel = this.hydrogenKernel;
    if (!kernel) return;

    // Use hydrogen-next's event API for status changes (preferred over monkey-patching)
    if (kernel.onDidChangeExecutionState) {
      this._executionStateSubscription = kernel.onDidChangeExecutionState(
        (state) => {
          if (this.hydrogenKernel) {
            this.setStatus(state);
          }
        }
      );
    } else if (kernel.transport?.onDidChangeExecutionState) {
      // Fallback: subscribe to transport directly
      this._executionStateSubscription = kernel.transport.onDidChangeExecutionState(
        (state) => {
          if (this.hydrogenKernel) {
            this.setStatus(state);
          }
        }
      );
    }
  }

  _unsubscribeFromKernel() {
    if (this._executionStateSubscription) {
      this._executionStateSubscription.dispose();
      this._executionStateSubscription = null;
    }
  }

  /**
   * Convert hydrogen message to notebook output format
   */
  _messageToOutput(message) {
    if (!message) return null;

    // Handle hydrogen internal format - execution status
    if (message.stream === "status") {
      return { type: "status", status: message.data };
    }

    // Handle hydrogen internal format - execution count
    if (message.stream === "execution_count") {
      this.executionCount = message.data;
      return { type: "execution_count", count: message.data };
    }

    // Handle notebook output format (already converted by hydrogen)
    if (message.output_type) {
      return message;
    }

    // Handle raw status messages from iopub
    if (message.content?.execution_state) {
      this.setStatus(message.content.execution_state);
      return null;
    }

    return null;
  }

  /**
   * Execute code with callbacks
   * @param {string} code - Code to execute
   * @param {Object} callbacks - Optional callbacks: onStatus, onOutput
   * @param {number} timeout - Execution timeout in ms (default: 5 minutes, 0 = no timeout)
   */
  async execute(code, callbacks = {}, timeout = 300000) {
    if (!this.hydrogenKernel) {
      throw new Error("No kernel connected");
    }

    return new Promise((resolve, reject) => {
      const outputs = [];
      let resolved = false;
      let timeoutId = null;

      const cleanup = () => {
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
      };

      const finish = (status) => {
        if (!resolved) {
          resolved = true;
          cleanup();
          resolve({ status, outputs });
        }
      };

      // Set up timeout to prevent hanging executions
      if (timeout > 0) {
        timeoutId = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            reject(new Error(`Execution timed out after ${timeout}ms`));
          }
        }, timeout);
      }

      try {
        this.hydrogenKernel.execute(code, (result) => {
          if (resolved) return;

          try {
            const output = this._messageToOutput(result);

            if (!output) return;

            if (output.type === "status") {
              if (callbacks.onStatus) {
                callbacks.onStatus(output.status);
              }
              if (output.status === "ok" || output.status === "error") {
                finish(output.status);
              }
              return;
            }

            if (output.type === "execution_count") {
              return;
            }

            outputs.push(output);
            if (callbacks.onOutput) {
              callbacks.onOutput(output);
            }
          } catch (e) {
            console.error(
              "[jupyter-next] Error processing execution result:",
              e
            );
          }
        });
      } catch (e) {
        cleanup();
        reject(e);
      }
    });
  }

  interrupt() {
    if (this.hydrogenKernel) {
      this.hydrogenKernel.interrupt();
    }
  }

  async restart() {
    if (!this.hydrogenKernel) return;

    return new Promise((resolve) => {
      this.setStatus("restarting");
      this.hydrogenKernel.restart(() => {
        this.executionCount = 0;
        this.setStatus("idle");
        this.emitter.emit("did-restart");
        resolve();
      });
    });
  }

  shutdown() {
    if (this.hydrogenKernel) {
      try {
        this._unsubscribeFromKernel();
        this.hydrogenKernel.shutdown();
        this.hydrogenKernel.destroy();
      } catch (e) {
        console.error("[jupyter-next] Error shutting down kernel:", e);
      }
      this.hydrogenKernel = null;
      this.setStatus("dead");
      this.emitter.emit("did-terminate");
    }
  }

  isAlive() {
    return this.hydrogenKernel && this.status !== "dead";
  }

  setStatus(status) {
    const oldStatus = this.status;
    this.status = status;
    if (oldStatus !== status) {
      this.emitter.emit("did-change-status", status);
    }
  }

  onDidChangeStatus(callback) {
    return this.emitter.on("did-change-status", callback);
  }

  onDidTerminate(callback) {
    return this.emitter.on("did-terminate", callback);
  }

  onDidRestart(callback) {
    return this.emitter.on("did-restart", callback);
  }

  destroy() {
    this.shutdown();
    this.emitter.dispose();
  }
}

module.exports = KernelManager;
