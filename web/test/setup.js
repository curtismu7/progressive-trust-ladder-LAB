import '@testing-library/jest-dom/vitest';

// React Flow measures its container; jsdom has no layout, so give it inert stand-ins.
class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
globalThis.ResizeObserver = globalThis.ResizeObserver || ResizeObserverStub;
if (!globalThis.DOMMatrixReadOnly) globalThis.DOMMatrixReadOnly = class { constructor() { this.m22 = 1; } };

// jsdom in this vitest config runs without a localStorage backing store; the floating-dialog tests and the panel's position persistence need one.
if (typeof globalThis.localStorage === 'undefined' || !globalThis.localStorage.clear) {
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), clear: () => store.clear(), key: (i) => [...store.keys()][i] ?? null, get length() { return store.size; } };
}
