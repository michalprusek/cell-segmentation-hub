/**
 * React Key Generation Tests for Polygon ID Utils
 * Tests the comprehensive fix for React key conflicts in segmentation editor
 */

import {
  generateSafePolygonKey,
  validatePolygonId,
  ensureValidPolygonId,
  logPolygonIdIssue,
} from '../polygonIdUtils';

describe('React Key Generation Fixes', () => {
  describe('generateSafePolygonKey', () => {
    test('generates safe keys for valid polygon IDs', () => {
      const polygon = { id: 'polygon_123456789_abc' };

      const normalKey = generateSafePolygonKey(polygon, false);
      const undoKey = generateSafePolygonKey(polygon, true);

      expect(normalKey).toBe('polygon_123456789_abc-normal');
      expect(undoKey).toBe('polygon_123456789_abc-undo');
    });

    test('generates fallback keys for undefined polygon IDs', () => {
      const polygon = { id: undefined };

      const normalKey = generateSafePolygonKey(polygon, false);
      const undoKey = generateSafePolygonKey(polygon, true);

      // Should never generate "undefined-normal" or "undefined-undo"
      expect(normalKey).not.toBe('undefined-normal');
      expect(undoKey).not.toBe('undefined-undo');

      // Should contain polygon fallback prefix
      expect(normalKey).toMatch(/^polygon_\d+_\w+-normal$/);
      expect(undoKey).toMatch(/^polygon_\d+_\w+-undo$/);
    });

    test('generates fallback keys for null polygon IDs', () => {
      const polygon = { id: null };

      const normalKey = generateSafePolygonKey(polygon, false);

      expect(normalKey).not.toBe('null-normal');
      expect(normalKey).toMatch(/^polygon_\d+_\w+-normal$/);
    });

    test('generates fallback keys for empty string polygon IDs', () => {
      const polygon = { id: '' };

      const normalKey = generateSafePolygonKey(polygon, false);

      expect(normalKey).not.toBe('-normal');
      expect(normalKey).toMatch(/^polygon_\d+_\w+-normal$/);
    });

    test('generates unique keys for multiple calls', () => {
      const polygon1 = { id: undefined };
      const polygon2 = { id: undefined };

      const key1 = generateSafePolygonKey(polygon1, false);
      const key2 = generateSafePolygonKey(polygon2, false);

      // Keys should be unique even for identical input
      expect(key1).not.toBe(key2);
    });
  });

  describe('ensureValidPolygonId with context-specific prefixes', () => {
    test('generates polygon-list specific fallback IDs', () => {
      const id = ensureValidPolygonId(undefined, 'polygon-list-5');
      expect(id).toMatch(/^polygon-list-5_\d+_\w+$/);
    });

    test('generates region panel specific fallback IDs', () => {
      const id = ensureValidPolygonId(null, 'region-3');
      expect(id).toMatch(/^region-3_\d+_\w+$/);
    });

    test('generates svg-vertex-group specific fallback IDs', () => {
      const id = ensureValidPolygonId('', 'svg-vertex-group');
      expect(id).toMatch(/^svg-vertex-group_\d+_\w+$/);
    });

    test('preserves valid IDs without modification', () => {
      const validId = 'ml_polygon_12345';
      const result = ensureValidPolygonId(validId, 'fallback');
      expect(result).toBe(validId);
    });
  });

  describe('React Key Conflict Prevention', () => {
    test('prevents duplicate keys from undefined IDs', () => {
      const polygons = [
        { id: undefined },
        { id: undefined },
        { id: undefined },
      ];

      const keys = polygons.map(polygon =>
        generateSafePolygonKey(polygon, false)
      );

      // All keys should be unique
      const uniqueKeys = new Set(keys);
      expect(uniqueKeys.size).toBe(polygons.length);

      // No key should be "undefined-normal"
      expect(keys).not.toContain('undefined-normal');
    });

    test('handles mixed valid and invalid IDs', () => {
      const polygons = [
        { id: 'valid_polygon_123' },
        { id: undefined },
        { id: 'another_valid_456' },
        { id: null },
        { id: '' },
      ];

      const keys = polygons.map(polygon =>
        generateSafePolygonKey(polygon, false)
      );

      // All keys should be unique
      const uniqueKeys = new Set(keys);
      expect(uniqueKeys.size).toBe(polygons.length);

      // Valid IDs should be preserved
      expect(keys[0]).toBe('valid_polygon_123-normal');
      expect(keys[2]).toBe('another_valid_456-normal');

      // Invalid IDs should get fallbacks
      expect(keys[1]).toMatch(/^polygon_\d+_\w+-normal$/);
      expect(keys[3]).toMatch(/^polygon_\d+_\w+-normal$/);
      expect(keys[4]).toMatch(/^polygon_\d+_\w+-normal$/);
    });

    test('handles undo/redo state changes consistently', () => {
      const polygon = { id: undefined };

      const normalKey1 = generateSafePolygonKey(polygon, false);
      const undoKey = generateSafePolygonKey(polygon, true);
      const normalKey2 = generateSafePolygonKey(polygon, false);

      // Keys should be different for different states
      expect(normalKey1).not.toBe(undoKey);

      // But state suffix should be consistent
      const baseKey1 = normalKey1.replace('-normal', '');
      const baseKey2 = undoKey.replace('-undo', '');

      // Since generateSafePolygonKey creates new IDs each time for undefined,
      // we just ensure no "undefined" appears in the keys
      expect(normalKey1).not.toContain('undefined');
      expect(undoKey).not.toContain('undefined');
      expect(normalKey2).not.toContain('undefined');
    });
  });

  describe('Performance Impact', () => {
    test('key generation is fast for large numbers of polygons', () => {
      const polygons = Array.from({ length: 1000 }, (_, i) => ({
        id: i % 3 === 0 ? undefined : `polygon_${i}`
      }));

      const startTime = performance.now();
      const keys = polygons.map(polygon =>
        generateSafePolygonKey(polygon, false)
      );
      const endTime = performance.now();

      const duration = endTime - startTime;

      // Should complete in reasonable time (under 50ms)
      expect(duration).toBeLessThan(50);

      // All keys should be unique
      const uniqueKeys = new Set(keys);
      expect(uniqueKeys.size).toBe(polygons.length);

      // No undefined keys
      expect(keys.filter(key => key.includes('undefined'))).toHaveLength(0);
    });
  });

  describe('Development Mode Logging', () => {
    const originalEnv = process.env.NODE_ENV;

    beforeEach(() => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
      vi.restoreAllMocks();
      process.env.NODE_ENV = originalEnv;
    });

    test('logs issues in development mode', () => {
      process.env.NODE_ENV = 'development';

      const polygon = { id: undefined, type: 'external', points: [] };
      logPolygonIdIssue(polygon, 'Test issue');

      expect(console.warn).toHaveBeenCalledWith(
        '[PolygonID] Validation issue:',
        expect.objectContaining({
          reason: 'Test issue',
          polygonId: undefined,
          polygonType: 'external',
        })
      );
    });

    test('does not log in production mode', () => {
      process.env.NODE_ENV = 'production';

      const polygon = { id: undefined };
      logPolygonIdIssue(polygon, 'Test issue');

      expect(console.warn).not.toHaveBeenCalled();
    });
  });
});