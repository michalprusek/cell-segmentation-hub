/**
 * Tests for polygon ID utilities
 */

import {
  generatePolygonId,
  validatePolygonId,
  ensureValidPolygonId,
  generateSafePolygonKey,
  logPolygonIdIssue
} from '../polygonIdUtils';

describe('polygonIdUtils', () => {
  describe('validatePolygonId', () => {
    it('should return true for valid string IDs', () => {
      expect(validatePolygonId('polygon_123')).toBe(true);
      expect(validatePolygonId('valid-id')).toBe(true);
      expect(validatePolygonId('abc123')).toBe(true);
    });

    it('should return false for invalid IDs', () => {
      expect(validatePolygonId(undefined)).toBe(false);
      expect(validatePolygonId(null)).toBe(false);
      expect(validatePolygonId('')).toBe(false);
      expect(validatePolygonId('   ')).toBe(false);
      expect(validatePolygonId(123)).toBe(false);
      expect(validatePolygonId({})).toBe(false);
      expect(validatePolygonId([])).toBe(false);
    });
  });

  describe('generatePolygonId', () => {
    it('should generate unique IDs with default prefix', () => {
      const id1 = generatePolygonId();
      const id2 = generatePolygonId();

      expect(id1).toMatch(/^polygon_\d+_[a-z0-9]+$/);
      expect(id2).toMatch(/^polygon_\d+_[a-z0-9]+$/);
      expect(id1).not.toBe(id2);
    });

    it('should generate IDs with custom prefix', () => {
      const id = generatePolygonId('custom');
      expect(id).toMatch(/^custom_\d+_[a-z0-9]+$/);
    });
  });

  describe('ensureValidPolygonId', () => {
    it('should return valid IDs unchanged', () => {
      expect(ensureValidPolygonId('valid-id')).toBe('valid-id');
      expect(ensureValidPolygonId('polygon_123')).toBe('polygon_123');
    });

    it('should generate fallback for invalid IDs', () => {
      const result = ensureValidPolygonId(undefined);
      expect(result).toMatch(/^fallback_\d+_[a-z0-9]+$/);

      const customResult = ensureValidPolygonId(null, 'custom');
      expect(customResult).toMatch(/^custom_\d+_[a-z0-9]+$/);
    });
  });

  describe('generateSafePolygonKey', () => {
    it('should generate safe React keys for valid polygons', () => {
      const polygon = { id: 'polygon_123', type: 'external' };

      expect(generateSafePolygonKey(polygon, false)).toBe('polygon_123-normal');
      expect(generateSafePolygonKey(polygon, true)).toBe('polygon_123-undo');
    });

    it('should generate safe fallback keys for undefined IDs', () => {
      const polygon = { id: undefined, type: 'external' };

      const normalKey = generateSafePolygonKey(polygon, false);
      const undoKey = generateSafePolygonKey(polygon, true);

      expect(normalKey).toMatch(/^polygon_\d+_[a-z0-9]+-normal$/);
      expect(undoKey).toMatch(/^polygon_\d+_[a-z0-9]+-undo$/);

      // Should not contain 'undefined'
      expect(normalKey).not.toContain('undefined');
      expect(undoKey).not.toContain('undefined');
    });

    it('should prevent React key conflicts', () => {
      const polygon1 = { id: undefined, type: 'external' };
      const polygon2 = { id: null, type: 'internal' };

      const key1 = generateSafePolygonKey(polygon1, false);
      const key2 = generateSafePolygonKey(polygon2, false);

      expect(key1).not.toBe(key2);
      expect(key1).not.toContain('undefined');
      expect(key2).not.toContain('null');
    });
  });

  describe('logPolygonIdIssue', () => {
    it('should log polygon validation issues', () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const polygon = { id: undefined, type: 'external', points: [] };

      logPolygonIdIssue(polygon, 'Test reason');

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        '[PolygonID] Validation issue:',
        expect.objectContaining({
          reason: 'Test reason',
          polygonId: undefined,
          polygonType: 'external',
          polygonData: expect.objectContaining({
            hasId: false,
            idType: 'undefined',
            pointsCount: 0
          })
        })
      );

      consoleWarnSpy.mockRestore();
    });
  });
});