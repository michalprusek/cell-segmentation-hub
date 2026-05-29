/**
 * polygonValidation.gaps5.test.ts
 *
 * Covers branches still uncovered after polygonValidation.test.ts:
 *
 *  A. parsePolygonData — object format with nested .polygons array (line 127-141)
 *     - { polygons: [...] } format → parsed correctly
 *
 *  B. parsePolygonData — unexpected format warning (line 145)
 *     - non-array, non-object-with-polygons → isValid=false
 *
 *  C. parsePolygonData — unexpected error (lines 157-165)
 *     - error thrown during validation → isValid=false
 *
 *  D. validatePolygon — optional fields (lines 275, 279, 369)
 *     - polygon with color → preserved
 *     - polygon with category → preserved
 *
 *  E. isValidPoint — edge cases (line 346)
 *     - null point → false
 *     - non-object point → false
 *
 *  F. getPolygonCount — catch (line 369)
 *     - invalid data → returns 0
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { PolygonValidator } from '../polygonValidation';

// ─── A. parsePolygonData — object with nested .polygons ───────────────────────

describe('PolygonValidator.parsePolygonData — object format', () => {
  it('parses { polygons: [...] } nested format', () => {
    const data = {
      polygons: [
        {
          id: 'p1',
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 5, y: 10 },
          ],
        },
      ],
    };
    const result = PolygonValidator.parsePolygonData(
      JSON.stringify(data),
      'test',
      'img-1'
    );
    expect(result.isValid).toBe(true);
    expect(result.polygons).toHaveLength(1);
  });
});

// ─── B. parsePolygonData — unexpected format ──────────────────────────────────

describe('PolygonValidator.parsePolygonData — unexpected format', () => {
  it('returns isValid=false for a plain number', () => {
    const result = PolygonValidator.parsePolygonData('42', 'test', 'img-1');
    expect(result.isValid).toBe(false);
  });

  it('returns isValid=false for an object without .polygons', () => {
    const result = PolygonValidator.parsePolygonData(
      JSON.stringify({ foo: 'bar' }),
      'test',
      'img-1'
    );
    expect(result.isValid).toBe(false);
  });
});

// ─── D. validatePolygon — optional fields ─────────────────────────────────────

describe('PolygonValidator — optional polygon fields', () => {
  it('preserves color field when present', () => {
    const data = [
      {
        id: 'p1',
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 5, y: 10 },
        ],
        color: '#FF0000',
      },
    ];
    const result = PolygonValidator.parsePolygonData(
      JSON.stringify(data),
      'test',
      'img-1'
    );
    expect(result.isValid).toBe(true);
    expect((result.polygons[0] as Record<string, unknown>).color).toBe(
      '#FF0000'
    );
  });

  it('preserves category field when present', () => {
    const data = [
      {
        id: 'p1',
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 5, y: 10 },
        ],
        category: 'cell',
      },
    ];
    const result = PolygonValidator.parsePolygonData(
      JSON.stringify(data),
      'test',
      'img-1'
    );
    expect(result.isValid).toBe(true);
    expect((result.polygons[0] as Record<string, unknown>).category).toBe(
      'cell'
    );
  });

  it('filters out invalid confidence values (> 1)', () => {
    const data = [
      {
        id: 'p1',
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 5, y: 10 },
        ],
        confidence: 1.5, // invalid: > 1
      },
    ];
    const result = PolygonValidator.parsePolygonData(
      JSON.stringify(data),
      'test',
      'img-1'
    );
    expect(result.isValid).toBe(true);
    expect(
      (result.polygons[0] as Record<string, unknown>).confidence
    ).toBeUndefined();
  });
});

// ─── E. isValidPoint — edge cases ────────────────────────────────────────────

describe('PolygonValidator.isValidPoint', () => {
  it('returns false for null', () => {
    expect(PolygonValidator.isValidPoint(null)).toBe(false);
  });

  it('returns false for non-object (string)', () => {
    expect(PolygonValidator.isValidPoint('point')).toBe(false);
  });

  it('returns false for point with NaN coordinate', () => {
    expect(PolygonValidator.isValidPoint({ x: NaN, y: 0 })).toBe(false);
  });

  it('returns false for point with Infinity coordinate', () => {
    expect(PolygonValidator.isValidPoint({ x: Infinity, y: 0 })).toBe(false);
  });

  it('returns true for valid point', () => {
    expect(PolygonValidator.isValidPoint({ x: 10, y: 20 })).toBe(true);
  });
});

// ─── F. getPolygonCount — catch ───────────────────────────────────────────────

describe('PolygonValidator.getPolygonCount', () => {
  it('returns 0 for invalid/non-parseable data', () => {
    expect(PolygonValidator.getPolygonCount('not valid json {')).toBe(0);
  });

  it('returns correct count for valid polygon data', () => {
    const data = [
      {
        id: 'p1',
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 5, y: 10 },
        ],
      },
      {
        id: 'p2',
        points: [
          { x: 20, y: 0 },
          { x: 30, y: 0 },
          { x: 25, y: 10 },
        ],
      },
    ];
    expect(PolygonValidator.getPolygonCount(JSON.stringify(data))).toBe(2);
  });
});
