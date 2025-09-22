/**
 * Unit tests for PolygonVisibilityManager viewport calculation fix
 */

import { vi } from 'vitest';
import { PolygonVisibilityManager, VisibilityContext } from '../PolygonVisibilityManager';
import { Polygon } from '@/lib/segmentation';

describe('PolygonVisibilityManager', () => {
  let manager: PolygonVisibilityManager;

  beforeEach(() => {
    manager = new PolygonVisibilityManager();
  });

  describe('viewport calculation fix', () => {
    it('should correctly calculate viewport bounds with zoom', () => {
      // Create test polygons that should be visible
      const testPolygons: Polygon[] = [
        {
          id: 'poly1',
          points: [
            { x: 100, y: 100 },
            { x: 200, y: 100 },
            { x: 200, y: 200 },
            { x: 100, y: 200 },
          ],
          type: 'external',
        },
        {
          id: 'poly2',
          points: [
            { x: 300, y: 300 },
            { x: 400, y: 300 },
            { x: 400, y: 400 },
            { x: 300, y: 400 },
          ],
          type: 'external',
        },
      ];

      // Test with zoom that should make polygons visible
      const context: VisibilityContext = {
        zoom: 1.0,
        offset: { x: -50, y: -50 }, // Offset that includes the polygons
        containerWidth: 500,
        containerHeight: 500,
        selectedPolygonId: null,
        forceRenderSelected: false,
      };

      const result = manager.getVisiblePolygons(testPolygons, context);

      // With the fix, polygons should be visible
      expect(result.visiblePolygons.length).toBe(2);
      expect(result.visibleCount).toBe(2);
      expect(result.culledCount).toBe(0);
    });

    it('should handle small polygon count fallback', () => {
      // Create fewer than 10 polygons
      const testPolygons: Polygon[] = [
        {
          id: 'poly1',
          points: [
            { x: 1000, y: 1000 }, // Far from viewport
            { x: 2000, y: 1000 },
            { x: 2000, y: 2000 },
            { x: 1000, y: 2000 },
          ],
          type: 'external',
        },
      ];

      const context: VisibilityContext = {
        zoom: 1.0,
        offset: { x: 0, y: 0 },
        containerWidth: 500,
        containerHeight: 500,
        selectedPolygonId: null,
        forceRenderSelected: false,
      };

      const result = manager.getVisiblePolygons(testPolygons, context);

      // Should render all polygons due to fallback (< 10 polygons)
      expect(result.visiblePolygons.length).toBe(1);
      expect(result.visibleCount).toBe(1);
    });

    it('should correctly calculate viewport with zoom and offset', () => {
      // Create polygon at specific location
      const testPolygons: Polygon[] = [
        {
          id: 'poly1',
          points: [
            { x: 50, y: 50 },
            { x: 150, y: 50 },
            { x: 150, y: 150 },
            { x: 50, y: 150 },
          ],
          type: 'external',
        },
      ];

      // Test context where viewport should include the polygon
      const context: VisibilityContext = {
        zoom: 2.0, // 2x zoom
        offset: { x: -100, y: -100 }, // Offset to include polygon
        containerWidth: 400,
        containerHeight: 400,
        selectedPolygonId: null,
        forceRenderSelected: false,
      };

      const result = manager.getVisiblePolygons(testPolygons, context);

      // Polygon should be visible with correct viewport calculation
      expect(result.visiblePolygons.length).toBe(1);
      expect(result.visibleCount).toBe(1);
    });

    it('should force render selected polygon even if outside viewport', () => {
      // Create polygon far from viewport
      const testPolygons: Polygon[] = Array.from({ length: 15 }, (_, i) => ({
        id: `poly${i}`,
        points: [
          { x: 2000 + i * 100, y: 2000 },
          { x: 2100 + i * 100, y: 2000 },
          { x: 2100 + i * 100, y: 2100 },
          { x: 2000 + i * 100, y: 2100 },
        ],
        type: 'external' as const,
      }));

      const context: VisibilityContext = {
        zoom: 1.0,
        offset: { x: 0, y: 0 },
        containerWidth: 500,
        containerHeight: 500,
        selectedPolygonId: 'poly5', // Select a polygon far from viewport
        forceRenderSelected: true,
      };

      const result = manager.getVisiblePolygons(testPolygons, context);

      // Selected polygon should be included even if outside viewport
      expect(result.visiblePolygons.some(p => p.id === 'poly5')).toBe(true);
    });
  });

  describe('debug logging', () => {
    it('should log debug information in development mode', () => {
      const consoleSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      const testPolygons: Polygon[] = [
        {
          id: 'poly1',
          points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }],
          type: 'external',
        },
      ];

      const context: VisibilityContext = {
        zoom: 1.0,
        offset: { x: 0, y: 0 },
        containerWidth: 500,
        containerHeight: 500,
        selectedPolygonId: null,
        forceRenderSelected: false,
      };

      manager.getVisiblePolygons(testPolygons, context);

      // Should have logged debug information
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[PolygonVisibility]')
      );

      consoleSpy.mockRestore();
      process.env.NODE_ENV = originalEnv;
    });
  });
});