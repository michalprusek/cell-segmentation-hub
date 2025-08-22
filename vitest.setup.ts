import { vi, expect } from 'vitest';

// Mock localStorage for test environment
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
Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
});

// Mock window.matchMedia for ThemeContext
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(), // Deprecated
    removeListener: vi.fn(), // Deprecated
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock navigator.language for LanguageContext
Object.defineProperty(navigator, 'language', {
  writable: true,
  value: 'en-US',
});

// Mock ImageData for Node.js test environment
global.ImageData = class MockImageData {
  public data: Uint8ClampedArray;
  public width: number;
  public height: number;
  public colorSpace: PredefinedColorSpace = 'srgb';

  constructor(
    data: Uint8ClampedArray | number,
    widthOrHeight?: number,
    height?: number
  ) {
    if (typeof data === 'number') {
      this.width = data;
      this.height = widthOrHeight || data;
      this.data = new Uint8ClampedArray(this.width * this.height * 4);
    } else {
      this.data = data;
      this.width = widthOrHeight!;
      this.height = height!;
    }
  }
} as any;

// Mock performance.memory for memory testing
if (!('memory' in performance)) {
  Object.defineProperty(performance, 'memory', {
    value: {
      usedJSHeapSize: 1048576,
      totalJSHeapSize: 2097152,
      jsHeapSizeLimit: 4294967296,
    },
  });
}

// Mock API client to prevent network calls in tests
vi.mock('@/lib/api', () => ({
  default: {
    getUserProfile: vi.fn().mockResolvedValue({
      preferred_theme: 'system',
      preferredLang: 'en',
    }),
    updateUserProfile: vi.fn().mockResolvedValue({}),
  },
}));

// Setup global test utilities
(globalThis as any).expect = expect;
(globalThis as any).vi = vi;
