import { describe, it, expect, beforeEach as _beforeEach } from 'vitest';
import {
  getCanvasCoordinates,
  imageToCanvasCoordinates,
  canvasToImageCoordinates,
  calculateCenteringTransform,
  calculateWheelZoom as _calculateWheelZoom,
  calculateFixedPointZoom as _calculateFixedPointZoom,
  constrainTransform,
  isPointVisible,
  isPolygonVisible,
  getViewportBounds,
} from '@/lib/coordinateUtils';
import type { TransformState } from '@/pages/segmentation/types';
import { createRef } from 'react';

describe('Coordinate Utilities', () => {
  const mockTransform: TransformState = {
    zoom: 1,
    translateX: 0,
    translateY: 0,
  };

  const createMockCanvasRef = (rect: Partial<DOMRect>) => {
    const ref = createRef<HTMLDivElement>();
    Object.defineProperty(ref, 'current', {
      value: {
        getBoundingClientRect: () => ({
          left: 0,
          top: 0,
          width: 800,
          height: 600,
          right: 800,
          bottom: 600,
          x: 0,
          y: 0,
          toJSON: () => ({}),
          ...rect,
        }),
      },
      writable: true,
    });
    return ref;
  };

  describe('getCanvasCoordinates', () => {
    it('should convert mouse coordinates to canvas coordinates', () => {
      const canvasRef = createMockCanvasRef({
        left: 100,
        top: 50,
        width: 800,
        height: 600,
      });

      const result = getCanvasCoordinates(300, 200, mockTransform, canvasRef);

      expect(result.canvasX).toBe(200); // 300 - 100
      expect(result.canvasY).toBe(150); // 200 - 50
    });

    it('should handle null canvas ref', () => {
      const ref = createRef<HTMLDivElement>();
      const result = getCanvasCoordinates(100, 100, mockTransform, ref);

      expect(result.imageX).toBe(100);
      expect(result.imageY).toBe(100);
      expect(result.canvasX).toBe(100);
      expect(result.canvasY).toBe(100);
    });
  });

  describe('imageToCanvasCoordinates', () => {
    it('should convert image coordinates to canvas coordinates', () => {
      const result = imageToCanvasCoordinates({ x: 50, y: 50 }, mockTransform);

      // Should apply zoom and translate: (x * zoom) + translateX
      expect(result.x).toBe(50 * mockTransform.zoom + mockTransform.translateX);
      expect(result.y).toBe(50 * mockTransform.zoom + mockTransform.translateY);
      expect(typeof result.x).toBe('number');
      expect(typeof result.y).toBe('number');
    });
  });

  describe('canvasToImageCoordinates', () => {
    it('should convert canvas coordinates to image coordinates', () => {
      const result = canvasToImageCoordinates(
        { x: 400, y: 300 },
        mockTransform
      );

      // Should reverse the transformation: (x - translateX) / zoom
      expect(result.x).toBe(
        (400 - mockTransform.translateX) / mockTransform.zoom
      );
      expect(result.y).toBe(
        (300 - mockTransform.translateY) / mockTransform.zoom
      );
      expect(typeof result.x).toBe('number');
      expect(typeof result.y).toBe('number');
    });
  });

  describe('calculateCenteringTransform', () => {
    it('should calculate transform to center image in container', () => {
      const result = calculateCenteringTransform(400, 300, 800, 600);

      expect(result.zoom).toBeDefined();
      expect(result.translateX).toBeDefined();
      expect(result.translateY).toBeDefined();
      expect(typeof result.zoom).toBe('number');
      expect(typeof result.translateX).toBe('number');
      expect(typeof result.translateY).toBe('number');
    });

    it('should fit wide image', () => {
      const result = calculateCenteringTransform(1600, 600, 800, 600);

      expect(result.zoom).toBeLessThanOrEqual(1);
    });

    it('should fit tall image', () => {
      const result = calculateCenteringTransform(400, 1200, 800, 600);

      expect(result.zoom).toBeLessThanOrEqual(1);
    });
  });

  describe('constrainTransform', () => {
    it('should constrain zoom to reasonable limits', () => {
      const extremeTransform: TransformState = {
        zoom: 15, // Very high zoom
        translateX: 0,
        translateY: 0,
      };

      const result = constrainTransform(extremeTransform, 800, 600, 400, 300);

      expect(result.zoom).toBeGreaterThan(0.1); // Min zoom constraint
      expect(result.zoom).toBeLessThanOrEqual(10); // Max zoom constraint - should be <= not <
      expect(typeof result.zoom).toBe('number');
      expect(typeof result.translateX).toBe('number');
      expect(typeof result.translateY).toBe('number');
    });

    it('should constrain translation to keep image in bounds', () => {
      // Use zoom < 2 to test translation constraints (zoom >= 2 allows unlimited panning)
      const extremeTransform: TransformState = {
        zoom: 1.5, // Below 2.0 threshold where constraints apply
        translateX: -2000, // Far out of bounds
        translateY: -2000,
      };

      const result = constrainTransform(extremeTransform, 800, 600, 400, 300);

      // Translation should be constrained to keep image visible
      // For zoom >= 1.0, very generous constraints apply
      expect(result.translateX).toBeGreaterThan(-2000); // Should be constrained from original
      expect(result.translateY).toBeGreaterThan(-2000); // Should be constrained from original
    });
  });

  describe('isPointVisible', () => {
    it('should detect points within viewport', () => {
      // Point at center of canvas
      const visibleResult = isPointVisible(
        { x: 50, y: 50 }, // Image coordinates
        mockTransform,
        800,
        600
      );

      expect(typeof visibleResult).toBe('boolean');
      expect(visibleResult).toBe(true);
    });

    it('should detect points outside viewport', () => {
      // Point far outside image bounds
      const invisibleResult = isPointVisible(
        { x: 10000, y: 10000 },
        mockTransform,
        800,
        600
      );

      expect(typeof invisibleResult).toBe('boolean');
      expect(invisibleResult).toBe(false);
    });
  });

  describe('isPolygonVisible', () => {
    it('should detect visible polygon', () => {
      const visiblePolygon = [
        { x: 50, y: 50 },
        { x: 100, y: 50 },
        { x: 100, y: 100 },
        { x: 50, y: 100 },
      ];

      const result = isPolygonVisible(visiblePolygon, mockTransform, 800, 600);

      expect(typeof result).toBe('boolean');
      expect(result).toBe(true);
    });

    it('should detect invisible polygon', () => {
      const invisiblePolygon = [
        { x: 10000, y: 10000 },
        { x: 10100, y: 10000 },
        { x: 10100, y: 10100 },
        { x: 10000, y: 10100 },
      ];

      const result = isPolygonVisible(
        invisiblePolygon,
        mockTransform,
        800,
        600
      );

      expect(typeof result).toBe('boolean');
      expect(result).toBe(false);
    });
  });

  describe('getViewportBounds', () => {
    it('should calculate correct viewport bounds', () => {
      const result = getViewportBounds(mockTransform, 800, 600);

      // Bounds should be calculated from viewport size and transform
      expect(result.minX).toBeGreaterThanOrEqual(0);
      expect(result.minY).toBeGreaterThanOrEqual(0);
      expect(result.maxX).toBeGreaterThan(result.minX);
      expect(result.maxY).toBeGreaterThan(result.minY);
      expect(typeof result.minX).toBe('number');
      expect(typeof result.minY).toBe('number');
      expect(typeof result.maxX).toBe('number');
      expect(typeof result.maxY).toBe('number');
    });
  });
});
