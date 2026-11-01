import '@testing-library/jest-dom/vitest';

// React Flow measures its container; jsdom has no layout, so give it inert stand-ins.
class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
globalThis.ResizeObserver = globalThis.ResizeObserver || ResizeObserverStub;
if (!globalThis.DOMMatrixReadOnly) globalThis.DOMMatrixReadOnly = class { constructor() { this.m22 = 1; } };
