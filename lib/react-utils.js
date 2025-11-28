/**
 * React utilities for jupyter-next
 *
 * Provides lazy-loaded React/ReactDOM access and hydrogen-next integration.
 * This is the central location for all hydrogen-next package integration.
 *
 * Updated for React 19: Uses createRoot API instead of deprecated ReactDOM.render
 */

const path = require("path");

// Minimum required hydrogen-next shared API version
const REQUIRED_API_VERSION = "1.0.0";

let React = null;
let ReactDOM = null;
let ReactDOMClient = null;
let loadAttempted = false;
let hydrogenPackagePath = null;
let hydrogenShared = null;
let versionWarningShown = false;

// Map of container elements to their React roots (for React 18+ createRoot API)
const rootMap = new WeakMap();

/**
 * Get hydrogen-next package path (for loading shared components)
 * Cached for performance - only looks up once per session.
 * @returns {string|null} The package path or null if not found
 */
function getHydrogenPackagePath() {
  if (hydrogenPackagePath !== null) return hydrogenPackagePath || null;

  const pkg = atom.packages.getLoadedPackage("hydrogen-next");
  hydrogenPackagePath = pkg ? pkg.path : "";
  return hydrogenPackagePath || null;
}

/**
 * Check if a version string satisfies the minimum required version.
 * Uses simple major.minor.patch comparison.
 * @param {string} version - Version to check (e.g., '1.0.0')
 * @param {string} required - Minimum required version
 * @returns {boolean} True if version >= required
 */
function isVersionCompatible(version, required) {
  if (!version || !required) return false;

  const vParts = version.split(".").map(Number);
  const rParts = required.split(".").map(Number);

  for (let i = 0; i < 3; i++) {
    const v = vParts[i] || 0;
    const r = rParts[i] || 0;
    if (v > r) return true;
    if (v < r) return false;
  }
  return true; // Equal versions
}

/**
 * Get hydrogen-next shared module
 * Provides access to shared utilities and components.
 * Cached for performance - only loads once per session.
 * Validates API version compatibility.
 * @returns {Object|null} The shared module or null if not available
 */
function getHydrogenShared() {
  if (hydrogenShared) return hydrogenShared;

  const pkgPath = getHydrogenPackagePath();
  if (!pkgPath) {
    console.error(
      "[jupyter-next] hydrogen-next package not found - this package requires hydrogen-next"
    );
    return null;
  }

  try {
    hydrogenShared = require(path.join(pkgPath, "lib", "shared"));

    // Validate API version compatibility
    const apiVersion = hydrogenShared.SHARED_API_VERSION;
    if (apiVersion && !isVersionCompatible(apiVersion, REQUIRED_API_VERSION)) {
      if (!versionWarningShown) {
        versionWarningShown = true;
        console.warn(
          `[jupyter-next] hydrogen-next API version ${apiVersion} may be incompatible. ` +
            `Required: >= ${REQUIRED_API_VERSION}`
        );
      }
    }

    return hydrogenShared;
  } catch (e) {
    console.error(
      "[jupyter-next] Failed to load hydrogen-next shared module:",
      e.message
    );
    return null;
  }
}

/**
 * Load React and ReactDOM
 * @returns {{ React: Object|null, ReactDOM: Object|null, ReactDOMClient: Object|null }}
 */
function loadReact() {
  if (loadAttempted) {
    return { React, ReactDOM, ReactDOMClient };
  }
  loadAttempted = true;

  try {
    React = require("react");
    ReactDOM = require("react-dom");
    // React 18+ uses react-dom/client for createRoot
    try {
      ReactDOMClient = require("react-dom/client");
    } catch (e) {
      // Fallback for older React versions
      ReactDOMClient = null;
    }
  } catch (e) {
    console.error("[jupyter-next] Failed to load React:", e.message);
    React = null;
    ReactDOM = null;
    ReactDOMClient = null;
  }

  return { React, ReactDOM, ReactDOMClient };
}

/**
 * Get React module
 * @returns {Object|null}
 */
function getReact() {
  if (!React) {
    loadReact();
  }
  return React;
}

/**
 * Get ReactDOM module
 * @returns {Object|null}
 */
function getReactDOM() {
  if (!ReactDOM) {
    loadReact();
  }
  return ReactDOM;
}

/**
 * Create a React element (convenience wrapper)
 * @param {...any} args - Arguments to pass to React.createElement
 * @returns {Object|null}
 */
function createElement(...args) {
  const R = getReact();
  if (R) {
    return R.createElement(...args);
  }
  return null;
}

/**
 * Render a React element to a DOM container
 * Uses React 18+ createRoot API if available, falls back to legacy render
 * @param {Object} element - React element to render
 * @param {HTMLElement} container - DOM container
 * @returns {boolean} True if rendered successfully
 */
function render(element, container) {
  loadReact();
  if (!container) return false;

  // Use React 18+ createRoot API if available
  if (ReactDOMClient && ReactDOMClient.createRoot) {
    let root = rootMap.get(container);
    if (!root) {
      root = ReactDOMClient.createRoot(container);
      rootMap.set(container, root);
    }
    root.render(element);
    return true;
  }

  // Fallback to legacy ReactDOM.render for older React versions
  const DOM = getReactDOM();
  if (DOM && DOM.render) {
    DOM.render(element, container);
    return true;
  }

  return false;
}

/**
 * Unmount React component from a DOM container
 * Uses React 18+ root.unmount() if available, falls back to legacy unmountComponentAtNode
 * @param {HTMLElement} container - DOM container
 * @returns {boolean} True if unmounted successfully
 */
function unmount(container) {
  if (!container) return false;

  // Check if we have a React 18+ root for this container
  const root = rootMap.get(container);
  if (root) {
    try {
      root.unmount();
      rootMap.delete(container);
      return true;
    } catch (e) {
      // Ignore cleanup errors
    }
  }

  // Fallback to legacy unmountComponentAtNode
  const DOM = getReactDOM();
  if (DOM && DOM.unmountComponentAtNode) {
    try {
      DOM.unmountComponentAtNode(container);
      return true;
    } catch (e) {
      // Ignore cleanup errors
    }
  }
  return false;
}

/**
 * Check if React is available
 * @returns {boolean}
 */
function isReactAvailable() {
  loadReact();
  return React !== null && ReactDOM !== null;
}

/**
 * Reset cached state (for testing or package reload)
 */
function resetCache() {
  hydrogenPackagePath = null;
  hydrogenShared = null;
  React = null;
  ReactDOM = null;
  ReactDOMClient = null;
  loadAttempted = false;
  versionWarningShown = false;
  // Note: rootMap uses WeakMap so it will clean up automatically
}

module.exports = {
  // Hydrogen-next integration (use these instead of local implementations)
  getHydrogenPackagePath,
  getHydrogenShared,
  // React utilities
  loadReact,
  getReact,
  getReactDOM,
  createElement,
  render,
  unmount,
  isReactAvailable,
  resetCache,
};
