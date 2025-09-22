/**
 * Test utilities for polygon and segmentation testing
 */

import { expect } from 'vitest';
import type { Point, Polygon } from '@/lib/segmentation';

/**
 * Create test polygon data with predictable shapes
 */
export const createTestPolygons = () => {
  return {
    // Simple triangle
    triangle: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 50, y: 100 },
    ] as Point[],

    // Simple square
    square: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ] as Point[],

    // Complex polygon with concave sections
    complex: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 50 },
      { x: 50, y: 50 },
      { x: 50, y: 100 },
      { x: 0, y: 100 },
    ] as Point[],

    // Very small polygon for edge cases
    tiny: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0.5, y: 1 },
    ] as Point[],

    // Large polygon
    large: Array.from({ length: 20 }, (_, i) => ({
      x: Math.cos((i / 20) * 2 * Math.PI) * 1000,
      y: Math.sin((i / 20) * 2 * Math.PI) * 1000,
    })) as Point[],

    // Degenerate polygon (line)
    line: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ] as Point[],

    // Single point
    point: [{ x: 50, y: 50 }] as Point[],
  };
};

/**
 * Create test polygon objects with IDs and metadata
 */
export const createTestPolygonObjects = (): Record<string, Polygon> => {
  const shapes = createTestPolygons();

  return {
    trianglePolygon: {
      id: 'test-triangle',
      points: shapes.triangle,
      type: 'external',
      confidence: 0.95,
      area: 5000,
    },
    squarePolygon: {
      id: 'test-square',
      points: shapes.square,
      type: 'external',
      confidence: 0.98,
      area: 10000,
    },
    complexPolygon: {
      id: 'test-complex',
      points: shapes.complex,
      type: 'external',
      confidence: 0.85,
      area: 7500,
    },
  };
};

/**
 * Assert that two points are approximately equal
 */
export const expectPointsEqual = (
  actual: Point,
  expected: Point,
  tolerance: number = 0.001
) => {
  expect(Math.abs(actual.x - expected.x)).toBeLessThan(tolerance);
  expect(Math.abs(actual.y - expected.y)).toBeLessThan(tolerance);
};

/**
 * Assert that two arrays of points are approximately equal
 */
export const expectPointArraysEqual = (
  actual: Point[],
  expected: Point[],
  tolerance: number = 0.001
) => {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((point, index) => {
    expectPointsEqual(point, expected[index], tolerance);
  });
};

/**
 * Create mock canvas ImageData for testing
 */
export const createMockImageData = (
  width: number,
  height: number,
  pattern: 'solid' | 'checkerboard' | 'gradient' = 'solid'
): ImageData => {
  const data = new Uint8ClampedArray(width * height * 4);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;

      let value: number;
      switch (pattern) {
        case 'checkerboard':
          value = (x + y) % 2 === 0 ? 255 : 0;
          break;
        case 'gradient':
          value = Math.floor((x / width) * 255);
          break;
        case 'solid':
        default:
          value = 128;
          break;
      }

      data[index] = value; // R
      data[index + 1] = value; // G
      data[index + 2] = value; // B
      data[index + 3] = 255; // A
    }
  }

  // Use a mock ImageData for testing environment
  if (typeof ImageData === 'undefined') {
    return {
      data,
      width,
      height,
      colorSpace: 'srgb' as PredefinedColorSpace,
    } as ImageData;
  }

  return new ImageData(data, width, height);
};

/**
 * Create mock mouse/touch event for testing interactions
 */
export const createMockPointerEvent = (
  x: number,
  y: number,
  type: 'mouse' | 'touch' = 'mouse',
  button = 0
): PointerEvent => {
  return new PointerEvent('pointerdown', {
    clientX: x,
    clientY: y,
    button,
    bubbles: true,
    cancelable: true,
    pointerId: 1,
    pointerType: type,
  });
};

/**
 * Create mock keyboard event for testing shortcuts
 */
export const createMockKeyboardEvent = (
  key: string,
  modifiers: {
    ctrl?: boolean;
    shift?: boolean;
    alt?: boolean;
    meta?: boolean;
  } = {}
): KeyboardEvent => {
  return new KeyboardEvent('keydown', {
    key,
    ctrlKey: modifiers.ctrl || false,
    shiftKey: modifiers.shift || false,
    altKey: modifiers.alt || false,
    metaKey: modifiers.meta || false,
    bubbles: true,
    cancelable: true,
  });
};

/**
 * Mock transform state for testing
 */
export const createMockTransform = (
  zoom = 1,
  translateX = 0,
  translateY = 0
) => ({
  zoom,
  translateX,
  translateY,
});

/**
 * Performance testing utilities
 */
export const measurePerformance = async (
  operation: () => Promise<void> | void,
  iterations = 100
): Promise<{
  averageTime: number;
  minTime: number;
  maxTime: number;
  totalTime: number;
}> => {
  const times: number[] = [];

  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await operation();
    const end = performance.now();
    times.push(end - start);
  }

  const totalTime = times.reduce((sum, time) => sum + time, 0);
  const averageTime = totalTime / iterations;
  const minTime = Math.min(...times);
  const maxTime = Math.max(...times);

  return {
    averageTime,
    minTime,
    maxTime,
    totalTime,
  };
};

/**
 * Memory usage testing utilities
 */
export const getMemoryUsage = (): {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
} => {
  if ('memory' in performance) {
    const memory = (performance as any).memory;
    return {
      usedJSHeapSize: memory.usedJSHeapSize,
      totalJSHeapSize: memory.totalJSHeapSize,
      jsHeapSizeLimit: memory.jsHeapSizeLimit,
    };
  }

  return {
    usedJSHeapSize: 0,
    totalJSHeapSize: 0,
    jsHeapSizeLimit: 0,
  };
};
