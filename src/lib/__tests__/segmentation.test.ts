import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  applyThresholding,
  findContours,
  segmentImage,
  calculatePolygonArea,
  calculatePerimeter
} from '@/lib/segmentation';
import {
  createTestPolygons,
  createMockImageData,
  measurePerformance
} from '@/test-utils/polygonTestUtils';
import type { Point } from '@/lib/segmentation';

// Mock DOM APIs for testing
Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
  value: vi.fn().mockReturnValue({
    drawImage: vi.fn(),
    getImageData: vi.fn(),
    putImageData: vi.fn(),
  }),
  configurable: true,
  writable: true,
});

let crossOriginValue: string | null = null;
Object.defineProperty(HTMLImageElement.prototype, 'crossOrigin', {
  get: () => crossOriginValue,
  set: (v: string | null) => { crossOriginValue = v; },
  configurable: true,
  enumerable: true,
});

describe('Segmentation Algorithms', () => {
  let testPolygons: ReturnType<typeof createTestPolygons>;

  beforeEach(() => {
    testPolygons = createTestPolygons();
    vi.clearAllMocks();
  });

  describe('applyThresholding', () => {
    it('should apply binary thresholding correctly', async () => {
      // Mock Image constructor and loading
      const mockImg = {
        crossOrigin: '',
        width: 100,
        height: 100,
        onload: null as any,
        onerror: null as any,
        src: ''
      };

      const mockCanvas = document.createElement('canvas');
      const mockCtx = {
        drawImage: vi.fn(),
        getImageData: vi.fn().mockReturnValue(createMockImageData(100, 100, 'gradient'))
      };

      vi.spyOn(document, 'createElement').mockReturnValue(mockCanvas);
      vi.spyOn(mockCanvas, 'getContext').mockReturnValue(mockCtx as any);

      // Create mock Image constructor
      global.Image = vi.fn().mockImplementation(() => mockImg);

      const thresholdPromise = applyThresholding('test-image.jpg', 128);

      // Simulate image load
      setTimeout(() => {
        if (mockImg.onload) {
          mockImg.onload({} as any);
        }
      }, 0);

      const result = await thresholdPromise;

      expect(result).toBeDefined();
      expect(mockCtx.drawImage).toHaveBeenCalledWith(mockImg, 0, 0);
      expect(mockCtx.getImageData).toHaveBeenCalledWith(0, 0, 100, 100);
    });

    it('should handle different threshold values', async () => {
      const mockImg = {
        crossOrigin: '',
        width: 10,
        height: 10,
        onload: null as any,
        onerror: null as any,
        src: ''
      };

      const mockCanvas = document.createElement('canvas');
      const imageData = createMockImageData(10, 10, 'gradient');
      const mockCtx = {
        drawImage: vi.fn(),
        getImageData: vi.fn().mockReturnValue(imageData)
      };

      vi.spyOn(document, 'createElement').mockReturnValue(mockCanvas);
      vi.spyOn(mockCanvas, 'getContext').mockReturnValue(mockCtx as any);
      global.Image = vi.fn().mockImplementation(() => mockImg);

      const thresholdPromise = applyThresholding('test-image.jpg', 200); // High threshold

      setTimeout(() => {
        if (mockImg.onload) {
          mockImg.onload({} as any);
        }
      }, 0);

      const result = await thresholdPromise;
      expect(result).toBeDefined();

      // Check that data was modified (would be mostly black with high threshold)
      const data = result.data;
      let blackPixels = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i] === 0) blackPixels++; // Count black pixels
      }
      expect(blackPixels).toBeGreaterThan(0);
    });

    it('should reject on image load error', async () => {
      const mockImg = {
        crossOrigin: '',
        width: 100,
        height: 100,
        onload: null as any,
        onerror: null as any,
        src: ''
      };

      global.Image = vi.fn().mockImplementation(() => mockImg);

      const thresholdPromise = applyThresholding('invalid-image.jpg');

      // Simulate image error
      setTimeout(() => {
        if (mockImg.onerror) {
          mockImg.onerror({} as any);
        }
      }, 0);

      await expect(thresholdPromise).rejects.toThrow('Failed to load image');
    });

    it('should reject when canvas context is unavailable', async () => {
      const mockImg = {
        crossOrigin: '',
        width: 100,
        height: 100,
        onload: null as any,
        onerror: null as any,
        src: ''
      };

      const mockCanvas = document.createElement('canvas');
      vi.spyOn(document, 'createElement').mockReturnValue(mockCanvas);
      vi.spyOn(mockCanvas, 'getContext').mockReturnValue(null); // Simulate failure

      global.Image = vi.fn().mockImplementation(() => mockImg);

      const thresholdPromise = applyThresholding('test-image.jpg');

      setTimeout(() => {
        if (mockImg.onload) {
          mockImg.onload({} as any);
        }
      }, 0);

      await expect(thresholdPromise).rejects.toThrow('Failed to get canvas context');
    });

    it('should apply correct grayscale conversion', async () => {
      const mockImg = {
        crossOrigin: '',
        width: 2,
        height: 2,
        onload: null as any,
        onerror: null as any,
        src: ''
      };

      const mockCanvas = document.createElement('canvas');
      
      // Create specific test image data
      const testImageData = createMockImageData(2, 2);
      // Set first pixel to white (255, 255, 255, 255)
      testImageData.data[0] = 255; // R
      testImageData.data[1] = 255; // G
      testImageData.data[2] = 255; // B
      testImageData.data[3] = 255; // A
      
      // Set second pixel to black (0, 0, 0, 255)
      testImageData.data[4] = 0;   // R
      testImageData.data[5] = 0;   // G
      testImageData.data[6] = 0;   // B
      testImageData.data[7] = 255; // A

      const mockCtx = {
        drawImage: vi.fn(),
        getImageData: vi.fn().mockReturnValue(testImageData)
      };

      vi.spyOn(document, 'createElement').mockReturnValue(mockCanvas);
      vi.spyOn(mockCanvas, 'getContext').mockReturnValue(mockCtx as any);
      global.Image = vi.fn().mockImplementation(() => mockImg);

      const thresholdPromise = applyThresholding('test-image.jpg', 128);

      setTimeout(() => {
        if (mockImg.onload) {
          mockImg.onload({} as any);
        }
      }, 0);

      const result = await thresholdPromise;

      // First pixel (white) should become white (255)
      expect(result.data[0]).toBe(255);
      expect(result.data[1]).toBe(255);
      expect(result.data[2]).toBe(255);
      
      // Second pixel (black) should become black (0)
      expect(result.data[4]).toBe(0);
      expect(result.data[5]).toBe(0);
      expect(result.data[6]).toBe(0);
    });
  });

  describe('findContours', () => {
    it('should return empty array as documented', () => {
      const mockImageData = createMockImageData(100, 100);
      const contours = findContours(mockImageData);
      
      expect(contours).toEqual([]);
      expect(Array.isArray(contours)).toBe(true);
    });

    it('should handle different image sizes', () => {
      const smallImage = createMockImageData(10, 10);
      const largeImage = createMockImageData(1000, 1000);
      
      expect(findContours(smallImage)).toEqual([]);
      expect(findContours(largeImage)).toEqual([]);
    });

    it('should handle edge cases gracefully', () => {
      const tinyImage = createMockImageData(1, 1);
      const emptyImage = createMockImageData(0, 0);
      
      expect(() => findContours(tinyImage)).not.toThrow();
      expect(() => findContours(emptyImage)).not.toThrow();
      expect(findContours(tinyImage)).toEqual([]);
      expect(findContours(emptyImage)).toEqual([]);
    });
  });

  describe('segmentImage', () => {
    it('should return empty segmentation result', async () => {
      const result = await segmentImage('test-image.jpg');
      
      expect(result).toBeDefined();
      expect(result.imageSrc).toBe('test-image.jpg');
      expect(result.polygons).toEqual([]);
      expect(result.imageWidth).toBe(0);
      expect(result.imageHeight).toBe(0);
      expect(result.timestamp).toBeInstanceOf(Date);
    });

    it('should handle different image sources', async () => {
      const sources = [
        'image1.png',
        'path/to/image2.jpg',
        'https://example.com/image3.gif'
      ];

      for (const src of sources) {
        const result = await segmentImage(src);
        expect(result.imageSrc).toBe(src);
        expect(result.polygons).toEqual([]);
      }
    });

    it('should create results with recent timestamps', async () => {
      const before = new Date();
      const result = await segmentImage('test.jpg');
      const after = new Date();
      
      expect(result.timestamp.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(result.timestamp.getTime()).toBeLessThanOrEqual(after.getTime());
    });
  });

  describe('calculatePolygonArea', () => {
    it('should calculate triangle area correctly', () => {
      const area = calculatePolygonArea(testPolygons.triangle);
      expect(area).toBeCloseTo(5000, 1); // Base=100, height=100 → area=5000
    });

    it('should calculate square area correctly', () => {
      const area = calculatePolygonArea(testPolygons.square);
      expect(area).toBeCloseTo(10000, 1); // 100x100 = 10000
    });

    it('should handle empty polygon', () => {
      const area = calculatePolygonArea([]);
      expect(area).toBe(0);
    });

    it('should handle single point', () => {
      const area = calculatePolygonArea([{ x: 10, y: 10 }]);
      expect(area).toBe(0);
    });

    it('should handle line (two points)', () => {
      const area = calculatePolygonArea([
        { x: 0, y: 0 },
        { x: 100, y: 0 }
      ]);
      expect(area).toBe(0);
    });

    it('should be consistent regardless of winding order', () => {
      const clockwise = testPolygons.square;
      const counterClockwise = [...clockwise].reverse();
      
      const area1 = calculatePolygonArea(clockwise);
      const area2 = calculatePolygonArea(counterClockwise);
      
      expect(area1).toBeCloseTo(area2, 5);
    });

    it('should handle complex polygons', () => {
      const area = calculatePolygonArea(testPolygons.complex);
      expect(area).toBeGreaterThan(0);
      expect(area).toBeLessThan(calculatePolygonArea(testPolygons.square));
    });

    it('should be accurate for regular polygons', () => {
      // Create a perfect square with known area
      const perfectSquare: Point[] = [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 }
      ];
      
      const area = calculatePolygonArea(perfectSquare);
      expect(area).toBeCloseTo(100, 10); // Should be exactly 100
    });
  });

  describe('calculatePerimeter', () => {
    it('should calculate square perimeter correctly', () => {
      const perimeter = calculatePerimeter(testPolygons.square);
      expect(perimeter).toBeCloseTo(400, 1); // 4 sides of 100
    });

    it('should calculate triangle perimeter correctly', () => {
      const perimeter = calculatePerimeter(testPolygons.triangle);
      // Triangle: (0,0) to (100,0) = 100
      //          (100,0) to (50,100) = sqrt(50^2 + 100^2) ≈ 111.8
      //          (50,100) to (0,0) = sqrt(50^2 + 100^2) ≈ 111.8
      const expected = 100 + 2 * Math.sqrt(50*50 + 100*100);
      expect(perimeter).toBeCloseTo(expected, 1);
    });

    it('should handle empty polygon', () => {
      const perimeter = calculatePerimeter([]);
      expect(perimeter).toBe(0);
    });

    it('should handle single point', () => {
      const perimeter = calculatePerimeter([{ x: 10, y: 10 }]);
      expect(perimeter).toBe(0);
    });

    it('should handle line (two points)', () => {
      const line: Point[] = [
        { x: 0, y: 0 },
        { x: 100, y: 0 }
      ];
      const perimeter = calculatePerimeter(line);
      expect(perimeter).toBeCloseTo(200, 1); // 100 + 100 (back and forth)
    });

    it('should handle complex polygons', () => {
      const perimeter = calculatePerimeter(testPolygons.complex);
      expect(perimeter).toBeGreaterThan(0);
      expect(perimeter).toBeGreaterThanOrEqual(calculatePerimeter(testPolygons.square));
    });

    it('should be accurate for known shapes', () => {
      // Perfect square with side length 10
      const square: Point[] = [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 }
      ];
      
      const perimeter = calculatePerimeter(square);
      expect(perimeter).toBeCloseTo(40, 10); // Should be exactly 40
    });

    it('should handle very small polygons', () => {
      const tiny: Point[] = [
        { x: 0, y: 0 },
        { x: 0.001, y: 0 },
        { x: 0.0005, y: 0.001 }
      ];
      
      const perimeter = calculatePerimeter(tiny);
      expect(perimeter).toBeGreaterThan(0);
      expect(perimeter).toBeLessThan(0.01);
    });
  });

  describe('Performance Tests', () => {
    it('should apply thresholding efficiently for reasonable image sizes', async () => {
      // Skip actual image loading in performance test
      const mockImg = {
        crossOrigin: '',
        width: 500,
        height: 500,
        onload: null as any,
        onerror: null as any,
        src: ''
      };

      const mockCanvas = document.createElement('canvas');
      const mockCtx = {
        drawImage: vi.fn(),
        getImageData: vi.fn().mockReturnValue(createMockImageData(500, 500))
      };

      vi.spyOn(document, 'createElement').mockReturnValue(mockCanvas);
      vi.spyOn(mockCanvas, 'getContext').mockReturnValue(mockCtx as any);
      global.Image = vi.fn().mockImplementation(() => mockImg);

      const performance = await measurePerformance(async () => {
        const promise = applyThresholding('test.jpg');
        setTimeout(() => {
          if (mockImg.onload) mockImg.onload({} as any);
        }, 0);
        await promise;
      }, 10);

      expect(performance.averageTime).toBeLessThan(100); // Should be reasonably fast
    });

    it('should calculate polygon metrics efficiently for large polygons', async () => {
      const performance = await measurePerformance(() => {
        calculatePolygonArea(testPolygons.large);
        calculatePerimeter(testPolygons.large);
      }, 100);

      expect(performance.averageTime).toBeLessThan(5); // Should be very fast
    });
  });

  describe('Integration and Edge Cases', () => {
    it('should handle malformed image data gracefully', () => {
      // Create invalid ImageData
      const invalidImageData = createMockImageData(1, 1);
      invalidImageData.data[0] = NaN;

      expect(() => findContours(invalidImageData)).not.toThrow();
    });

    it('should handle very large coordinates', () => {
      const largePolygon: Point[] = [
        { x: 0, y: 0 },
        { x: 1e6, y: 0 },
        { x: 1e6, y: 1e6 },
        { x: 0, y: 1e6 }
      ];

      const area = calculatePolygonArea(largePolygon);
      const perimeter = calculatePerimeter(largePolygon);

      expect(area).toBe(1e12);
      expect(perimeter).toBe(4e6);
    });

    it('should handle negative coordinates', () => {
      const negativePolygon: Point[] = [
        { x: -100, y: -100 },
        { x: 0, y: -100 },
        { x: 0, y: 0 },
        { x: -100, y: 0 }
      ];

      const area = calculatePolygonArea(negativePolygon);
      const perimeter = calculatePerimeter(negativePolygon);

      expect(area).toBe(10000);
      expect(perimeter).toBe(400);
    });

    it('should handle floating point precision issues', () => {
      const precisionPolygon: Point[] = [
        { x: 0.1, y: 0.1 },
        { x: 0.2, y: 0.1 },
        { x: 0.2, y: 0.2 },
        { x: 0.1, y: 0.2 }
      ];

      const area = calculatePolygonArea(precisionPolygon);
      expect(area).toBeCloseTo(0.01, 10);
    });

    it('should handle duplicate consecutive points', () => {
      const duplicatePolygon: Point[] = [
        { x: 0, y: 0 },
        { x: 0, y: 0 }, // Duplicate
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 }
      ];

      const area = calculatePolygonArea(duplicatePolygon);
      const perimeter = calculatePerimeter(duplicatePolygon);

      expect(area).toBeGreaterThan(0);
      expect(perimeter).toBeGreaterThan(0);
    });

    it('should handle polygons with collinear points', () => {
      const collinearPolygon: Point[] = [
        { x: 0, y: 0 },
        { x: 50, y: 0 }, // Collinear with first and next
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 }
      ];

      const area = calculatePolygonArea(collinearPolygon);
      expect(area).toBeCloseTo(10000, 1); // Should still be a valid square
    });
  });

  describe('Type Safety and API Consistency', () => {
    it('should maintain consistent return types', async () => {
      const result = await segmentImage('test.jpg');
      
      expect(typeof result.imageSrc).toBe('string');
      expect(Array.isArray(result.polygons)).toBe(true);
      expect(typeof result.imageWidth).toBe('number');
      expect(typeof result.imageHeight).toBe('number');
      expect(result.timestamp).toBeInstanceOf(Date);
    });

    it('should handle null/undefined inputs consistently', () => {
      // These functions don't currently handle null gracefully - test actual behavior
      expect(() => calculatePolygonArea(null as any)).toThrow();
      expect(() => calculatePolygonArea(undefined as any)).toThrow();
      expect(() => calculatePerimeter(null as any)).toThrow();
      expect(() => calculatePerimeter(undefined as any)).toThrow();
    });

    it('should validate point structure', () => {
      const invalidPoints = [
        { x: 0 }, // Missing y
        { y: 0 }, // Missing x
        { x: 0, y: 0, z: 0 }, // Extra property (should still work)
        null,
        undefined
      ] as any;

      // These functions will throw when encountering invalid point structures
      expect(() => calculatePolygonArea(invalidPoints)).toThrow();
      expect(() => calculatePerimeter(invalidPoints)).toThrow();
    });
  });
});