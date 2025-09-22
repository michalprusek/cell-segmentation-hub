import { PolygonValidator } from '../polygonValidation';

describe('PolygonValidator', () => {
  describe('parsePolygonData', () => {
    test('should parse valid JSON string polygon data', () => {
      const validPolygons = [
        {
          id: '1',
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 5, y: 10 },
          ],
        },
        {
          id: '2',
          points: [
            { x: 20, y: 20 },
            { x: 30, y: 20 },
            { x: 25, y: 30 },
          ],
        },
      ];
      const jsonString = JSON.stringify(validPolygons);

      const result = PolygonValidator.parsePolygonData(
        jsonString,
        'test-context',
        'test-image'
      );

      expect(result.isValid).toBe(true);
      expect(result.polygons).toHaveLength(2);
      expect(result.polygons[0].id).toBe('1');
      expect(result.polygons[0].points).toHaveLength(3);
    });

    test('should handle invalid JSON string gracefully', () => {
      const invalidJson = '{ invalid json';

      const result = PolygonValidator.parsePolygonData(
        invalidJson,
        'test-context',
        'test-image'
      );

      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Invalid JSON format');
      expect(result.polygons).toHaveLength(0);
    });

    test('should handle null/undefined input', () => {
      const nullResult = PolygonValidator.parsePolygonData(
        null,
        'test-context',
        'test-image'
      );
      const undefinedResult = PolygonValidator.parsePolygonData(
        undefined,
        'test-context',
        'test-image'
      );

      expect(nullResult.isValid).toBe(true);
      expect(nullResult.polygons).toHaveLength(0);
      expect(undefinedResult.isValid).toBe(true);
      expect(undefinedResult.polygons).toHaveLength(0);
    });

    test('should handle empty string', () => {
      const result = PolygonValidator.parsePolygonData(
        '',
        'test-context',
        'test-image'
      );

      expect(result.isValid).toBe(true);
      expect(result.polygons).toHaveLength(0);
    });

    test('should filter out invalid polygons', () => {
      const mixedPolygons = [
        {
          id: '1',
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 5, y: 10 },
          ],
        }, // valid
        { id: '2', points: [{ x: 20, y: 20 }] }, // invalid - only 1 point
        {
          id: '3',
          points: [
            { x: 'invalid', y: 30 },
            { x: 25, y: 30 },
          ],
        }, // invalid - non-numeric x
        {
          id: '4',
          points: [
            { x: 40, y: 40 },
            { x: 50, y: 40 },
            { x: 45, y: 50 },
          ],
        }, // valid
      ];
      const jsonString = JSON.stringify(mixedPolygons);

      const result = PolygonValidator.parsePolygonData(
        jsonString,
        'test-context',
        'test-image'
      );

      expect(result.isValid).toBe(true);
      expect(result.polygons).toHaveLength(2); // Only the 2 valid polygons
      expect(result.polygons[0].id).toBe('1');
      expect(result.polygons[1].id).toBe('4');
    });
  });

  describe('getPolygonCount', () => {
    test('should return correct count for valid polygons', () => {
      const validPolygons = [
        {
          id: '1',
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 5, y: 10 },
          ],
        },
        {
          id: '2',
          points: [
            { x: 20, y: 20 },
            { x: 30, y: 20 },
            { x: 25, y: 30 },
          ],
        },
      ];
      const jsonString = JSON.stringify(validPolygons);

      const count = PolygonValidator.getPolygonCount(jsonString);

      expect(count).toBe(2);
    });

    test('should return 0 for invalid JSON', () => {
      const count = PolygonValidator.getPolygonCount('{ invalid json');

      expect(count).toBe(0);
    });

    test('should return 0 for null input', () => {
      const count = PolygonValidator.getPolygonCount(null);

      expect(count).toBe(0);
    });
  });

  describe('hasValidPolygonData', () => {
    test('should return true for valid polygon data', () => {
      const validPolygons = [
        {
          id: '1',
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 5, y: 10 },
          ],
        },
      ];
      const jsonString = JSON.stringify(validPolygons);

      const hasValid = PolygonValidator.hasValidPolygonData(jsonString);

      expect(hasValid).toBe(true);
    });

    test('should return false for empty data', () => {
      expect(PolygonValidator.hasValidPolygonData('')).toBe(false);
      expect(PolygonValidator.hasValidPolygonData(null)).toBe(false);
      expect(PolygonValidator.hasValidPolygonData(undefined)).toBe(false);
      expect(PolygonValidator.hasValidPolygonData('[]')).toBe(false);
    });

    test('should return false for invalid JSON', () => {
      const hasValid = PolygonValidator.hasValidPolygonData('{ invalid json');

      expect(hasValid).toBe(false);
    });
  });
});
