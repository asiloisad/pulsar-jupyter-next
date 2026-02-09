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
  if (!hydrogenKernelManager) {
    const shared = getHydrogenShared();
    hydrogenKernelManager = new shared.KernelManager();
  }
  return hydrogenKernelManager;
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

    const specs = await getHydrogenKernelManager().getAllKernelSpecs();
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

    const shared = getHydrogenShared();
    const grammar = { name: language };

    // Use hydrogen-next's kernelSpecProvidesGrammar for language matching
    return specs.filter((spec) =>
      shared.kernelSpecProvidesGrammar(spec.spec, grammar)
    );
  }

  /**
   * Get or start a kernel by name
   * @param {string} kernelName - Name of the kernel to start
   * @param {string} filePath - Optional file path for determining kernel cwd
   */
  async getOrStartKernel(kernelName, filePath = null) {
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
    return this.startKernel(kernelName, filePath);
  }

  /**
   * Start a kernel by name
   * @param {string} kernelName - Name of the kernel to start
   * @param {string} filePath - Optional file path for determining kernel cwd
   */
  async startKernel(kernelName, filePath = null) {
    const specs = await this.getKernelSpecs();
    const spec = specs.find((s) => s.name === kernelName);

    if (!spec) {
      throw new Error(`Kernel not found: ${kernelName}`);
    }

    return this._startHydrogenKernel(spec, filePath);
  }

  /**
   * Start kernel using hydrogen-next's infrastructure
   * @param {Object} spec - Kernel spec
   * @param {string} filePath - File path for determining kernel cwd (respects hydrogen-next.startDir config)
   */
  async _startHydrogenKernel(spec, filePath) {
    const hydrogenKM = getHydrogenKernelManager();

    return new Promise((resolve, reject) => {
      try {
        const language = spec.language || "python";
        const grammar = {
          name: language,
          scopeName: `source.${language}`,
        };

        // Use provided filePath or generate a temporary one
        const effectiveFilePath =
          filePath || `jupyter-next-${spec.name}-${Date.now()}`;

        // Create mock editor for hydrogen-next that returns the notebook's path
        // This allows hydrogen-next to use its startDir config properly
        const mockEditor = {
          getGrammar: () => grammar,
          getPath: () => effectiveFilePath,
          onDidDestroy: () => ({ dispose: () => {} }),
        };

        hydrogenKM.startKernel(
          spec.spec,
          grammar,
          mockEditor,
          effectiveFilePath,
          (hydrogenKernel) => {
            // Register kernel with hydrogen-next store so tools like
            // Variable Explorer, Kernel Monitor, and Inspector see it
            const shared = getHydrogenShared();
            shared.registerKernel(hydrogenKernel, effectiveFilePath, mockEditor, grammar);
            // Set as current kernel so Variable Explorer shows it
            shared.setCurrentKernel(hydrogenKernel);

            const kernel = new HydrogenKernelWrapper(
              hydrogenKernel,
              spec,
              this,
              { filePath: effectiveFilePath, mockEditor, grammar }
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
  constructor(hydrogenKernel, spec, manager, registrationInfo = {}) {
    this.hydrogenKernel = hydrogenKernel;
    this.spec = spec;
    this.manager = manager;
    this.emitter = new Emitter();

    // Store registration info for unregistering on shutdown
    this._registrationInfo = registrationInfo;

    this.name = spec.name;
    this.displayName = spec.displayName || spec.display_name;
    this.language = spec.language;
    this.status = "idle";
    this.executionCount = 0;
    this._executionStateSubscription = null;
    // Keep reference to last output store adapter to prevent garbage collection
    // This allows orphan messages from background threads to be captured
    this._lastOutputStoreAdapter = null;

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

      // Create output store adapter for orphan messages (background thread output)
      // This catches outputs that arrive after execution completes
      // Store on instance to prevent garbage collection (WeakRef in zmq-kernel)
      this._lastOutputStoreAdapter = {
        appendOutput: (result) => {
          const output = this._messageToOutput(result);
          if (output && output.output_type) {
            outputs.push(output);
            if (callbacks.onOutput) {
              callbacks.onOutput(output);
            }
          }
        },
      };

      // Register as last output store to catch orphan messages
      if (this.hydrogenKernel.setLastOutputStore) {
        this.hydrogenKernel.setLastOutputStore(this._lastOutputStoreAdapter);
      }

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
          // Continue processing outputs even after resolve - thread outputs may arrive later
          // The promise resolving just means main execution finished, not that all output is done
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

            // Always process outputs, even after execution completes
            // This handles background threads that print after main execution
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

        // Unregister from hydrogen-next store before shutdown
        const shared = getHydrogenShared();
        shared.unregisterKernel(this.hydrogenKernel);
        // Clear current kernel if this was it
        shared.setCurrentKernel(null);

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

  /**
   * Set this kernel as the current kernel for hydrogen-next tools.
   * Call this when the notebook gains focus.
   */
  setAsCurrent() {
    if (this.hydrogenKernel) {
      const shared = getHydrogenShared();
      shared.setCurrentKernel(this.hydrogenKernel);
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
