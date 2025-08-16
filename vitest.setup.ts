import { vi } from 'vitest';

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

// Setup global test utilities
global.expect = expect;
