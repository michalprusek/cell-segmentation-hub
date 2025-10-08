import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Import React and configure for testing
import _React from 'react';

// Force React to use development mode features in tests
if (typeof window !== 'undefined') {
  // @ts-expect-error - Internal React flag
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    ...window.__REACT_DEVTOOLS_GLOBAL_HOOK__,
    isDisabled: false,
    supportsFiber: true,
    inject: vi.fn(),
    onCommitFiberRoot: vi.fn(),
    onCommitFiberUnmount: vi.fn(),
  };
}

// Set required environment variables for tests
process.env.NODE_ENV = 'test';
process.env.VITE_API_URL = 'http://localhost:3001/api';
process.env.VITE_ML_SERVICE_URL = 'http://localhost:8000';
process.env.VITE_WS_URL = 'ws://localhost:3001';

// Mock IntersectionObserver
global.IntersectionObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

// Mock ResizeObserver
global.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

// Mock WebSocket
global.WebSocket = vi.fn().mockImplementation(() => ({
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  send: vi.fn(),
  close: vi.fn(),
  readyState: 1,
}));

// Enhanced Canvas API mocking with comprehensive methods
import { createMockCanvasContext } from '@/test-utils/canvasTestUtils';

// Mock Canvas API with our comprehensive mock
HTMLCanvasElement.prototype.getContext = vi.fn((contextType: string) => {
  if (contextType === '2d') {
    return createMockCanvasContext();
  }
  return null;
});

// Mock canvas properties and additional methods
HTMLCanvasElement.prototype.toDataURL = vi.fn(
  () => 'data:image/png;base64,mock-data'
);
HTMLCanvasElement.prototype.toBlob = vi.fn((callback: BlobCallback) => {
  callback(new Blob(['mock-canvas-data'], { type: 'image/png' }));
});

// Mock getBoundingClientRect for all elements
Element.prototype.getBoundingClientRect = vi.fn(() => ({
  width: 800,
  height: 600,
  top: 0,
  left: 0,
  bottom: 600,
  right: 800,
  x: 0,
  y: 0,
  toJSON: vi.fn(),
}));

// Mock requestAnimationFrame and cancelAnimationFrame
let rafId = 1;
global.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
  setTimeout(callback, 16);
  return rafId++;
});
global.cancelAnimationFrame = vi.fn();

// Mock performance.now
Object.defineProperty(global.performance, 'now', {
  writable: true,
  value: vi.fn(() => Date.now()),
});

// Mock Image constructor for testing image loading
global.Image = vi.fn().mockImplementation(() => ({
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  naturalWidth: 1000,
  naturalHeight: 800,
  width: 1000,
  height: 800,
  complete: true,
  src: '',
  onload: null,
  onerror: null,
})) as any;

// Mock File and FileReader for file upload testing
global.File = vi.fn().mockImplementation((chunks, name, options) => ({
  name,
  size: chunks.reduce((size: number, chunk: any) => size + chunk.length, 0),
  type: options?.type || '',
  lastModified: Date.now(),
  arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
  text: vi.fn().mockResolvedValue(''),
})) as any;

global.FileReader = vi.fn().mockImplementation(() => ({
  readAsDataURL: vi.fn(),
  readAsText: vi.fn(),
  readAsArrayBuffer: vi.fn(),
  onload: null,
  onerror: null,
  result: null,
})) as any;

// FormData polyfill for tests
class FormDataPolyfill {
  private data: Map<string, any> = new Map();

  append(key: string, value: any, filename?: string): void {
    if (value instanceof Blob && filename) {
      this.data.set(key, { value, filename });
    } else {
      this.data.set(key, value);
    }
  }

  get(key: string): any {
    return this.data.get(key);
  }

  getAll(key: string): any[] {
    const value = this.data.get(key);
    return value !== undefined ? [value] : [];
  }

  has(key: string): boolean {
    return this.data.has(key);
  }

  delete(key: string): void {
    this.data.delete(key);
  }

  entries(): IterableIterator<[string, any]> {
    return this.data.entries();
  }

  keys(): IterableIterator<string> {
    return this.data.keys();
  }

  values(): IterableIterator<any> {
    return this.data.values();
  }

  forEach(callback: (value: any, key: string, parent: FormDataPolyfill) => void): void {
    this.data.forEach((value, key) => callback(value, key, this));
  }
}

// @ts-ignore
global.FormData = FormDataPolyfill;

// Enhanced File polyfill with proper Blob inheritance
class FilePolyfill extends Blob {
  name: string;
  lastModified: number;

  constructor(parts: BlobPart[], name: string, options?: FilePropertyBag) {
    super(parts, options);
    this.name = name;
    this.lastModified = options?.lastModified || Date.now();
  }
}

// Override File with enhanced polyfill
// @ts-ignore
global.File = FilePolyfill;

// Mock window.matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock localStorage with specific return values for contexts
const localStorageMock = {
  getItem: vi.fn((key: string) => {
    if (key === 'theme') return 'system';
    if (key === 'language') return 'en';
    return null;
  }),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
};
global.localStorage = localStorageMock;

// Mock sessionStorage
const sessionStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
};
global.sessionStorage = sessionStorageMock;

// Mock window.location
Object.defineProperty(window, 'location', {
  value: {
    ...window.location,
    reload: vi.fn(),
    assign: vi.fn(),
    replace: vi.fn(),
  },
  writable: true,
});

// Mock crypto for UUID generation
Object.defineProperty(global, 'crypto', {
  value: {
    randomUUID: vi.fn(() => 'test-uuid-1234'),
    getRandomValues: vi.fn().mockReturnValue(new Uint8Array(16)),
  },
});

// Mock DOMMatrix for canvas transformations
global.DOMMatrix = vi
  .fn()
  .mockImplementation((values?: number[] | DOMMatrix) => {
    const matrix = {
      a: 1,
      b: 0,
      c: 0,
      d: 1,
      e: 0,
      f: 0,
      m11: 1,
      m12: 0,
      m13: 0,
      m14: 0,
      m21: 0,
      m22: 1,
      m23: 0,
      m24: 0,
      m31: 0,
      m32: 0,
      m33: 1,
      m34: 0,
      m41: 0,
      m42: 0,
      m43: 0,
      m44: 1,
      is2D: true,
      isIdentity: true,

      multiply: vi.fn().mockReturnThis(),
      scale: vi.fn().mockReturnThis(),
      rotate: vi.fn().mockReturnThis(),
      translate: vi.fn().mockReturnThis(),
      inverse: vi.fn().mockReturnThis(),
      transformPoint: vi.fn(point => point),
      toString: vi.fn(() => 'matrix(1, 0, 0, 1, 0, 0)'),
    };

    // Initialize with values if provided
    if (Array.isArray(values) && values.length >= 6) {
      matrix.a = values[0];
      matrix.b = values[1];
      matrix.c = values[2];
      matrix.d = values[3];
      matrix.e = values[4];
      matrix.f = values[5];
    }

    return matrix;
  }) as any;

// Silence console errors during tests unless explicitly testing them
const originalError = console.error;
beforeAll(() => {
  console.error = vi.fn();
});

afterAll(() => {
  console.error = originalError;
});

// Global cleanup to prevent memory leaks
afterEach(() => {
  // Clear all timers to prevent accumulation
  vi.clearAllTimers();

  // Clean up any pending promises
  vi.clearAllMocks();

  // Force garbage collection hint by clearing large objects
  if (global.gc) {
    global.gc();
  }
});

// Mock apiClient globally to prevent import errors
vi.mock('@/lib/api', () => ({
  apiClient: {
    // Authentication methods
    isAuthenticated: vi.fn(() => false),
    getAccessToken: vi.fn(() => null),
    login: vi.fn(),
    logout: vi.fn(),
    register: vi.fn(),
    refreshAccessToken: vi.fn(),

    // User profile methods
    getUserProfile: vi.fn().mockResolvedValue({
      preferred_theme: 'system',
      preferredLang: 'en',
    }),
    updateUserProfile: vi.fn(),
    changePassword: vi.fn(),
    getUserStorageStats: vi.fn(),
    deleteAccount: vi.fn(),

    // Project methods
    getProjects: vi.fn(() =>
      Promise.resolve({ projects: [], total: 0, page: 1, totalPages: 1 })
    ),
    createProject: vi.fn(),
    getProject: vi.fn(),
    updateProject: vi.fn(),
    deleteProject: vi.fn(),

    // Image methods
    getProjectImages: vi.fn(() =>
      Promise.resolve({ images: [], total: 0, page: 1, totalPages: 1 })
    ),
    getProjectImagesWithThumbnails: vi.fn(),
    uploadImages: vi.fn(() => Promise.resolve([])),
    getImage: vi.fn(),
    deleteImage: vi.fn(),

    // Segmentation methods
    requestBatchSegmentation: vi.fn(),
    getSegmentationResults: vi.fn(() => Promise.resolve(null)),
    updateSegmentationResults: vi.fn(() => Promise.resolve({ polygons: [] })),
    deleteSegmentationResults: vi.fn(),
    getImageWithSegmentation: vi.fn(),

    // Queue management methods
    addImageToQueue: vi.fn(),
    addBatchToQueue: vi.fn(),
    getQueueStats: vi.fn(() =>
      Promise.resolve({
        total: 0,
        queued: 0,
        processing: 0,
        completed: 0,
        failed: 0,
      })
    ),
    getQueueItems: vi.fn(() => Promise.resolve([])),
    removeFromQueue: vi.fn(),

    // Generic HTTP methods
    post: vi.fn(),
    get: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
  default: {
    isAuthenticated: vi.fn(() => false),
    getAccessToken: vi.fn(() => null),
    login: vi.fn(),
    logout: vi.fn(),
    register: vi.fn(),
    refreshAccessToken: vi.fn(),
    getUserProfile: vi.fn().mockResolvedValue({
      preferred_theme: 'system',
      preferredLang: 'en',
    }),
    updateUserProfile: vi.fn(),
    changePassword: vi.fn(),
    getUserStorageStats: vi.fn(),
    deleteAccount: vi.fn(),
    getProjects: vi.fn(() =>
      Promise.resolve({ projects: [], total: 0, page: 1, totalPages: 1 })
    ),
    createProject: vi.fn(),
    getProject: vi.fn(),
    updateProject: vi.fn(),
    deleteProject: vi.fn(),
    getProjectImages: vi.fn(() =>
      Promise.resolve({ images: [], total: 0, page: 1, totalPages: 1 })
    ),
    getProjectImagesWithThumbnails: vi.fn(),
    uploadImages: vi.fn(() => Promise.resolve([])),
    getImage: vi.fn(),
    deleteImage: vi.fn(),
    requestBatchSegmentation: vi.fn(),
    getSegmentationResults: vi.fn(() => Promise.resolve(null)),
    updateSegmentationResults: vi.fn(() => Promise.resolve({ polygons: [] })),
    deleteSegmentationResults: vi.fn(),
    getImageWithSegmentation: vi.fn(),
    addImageToQueue: vi.fn(),
    addBatchToQueue: vi.fn(),
    getQueueStats: vi.fn(() =>
      Promise.resolve({
        total: 0,
        queued: 0,
        processing: 0,
        completed: 0,
        failed: 0,
      })
    ),
    getQueueItems: vi.fn(() => Promise.resolve([])),
    removeFromQueue: vi.fn(),
    post: vi.fn(),
    get: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));
