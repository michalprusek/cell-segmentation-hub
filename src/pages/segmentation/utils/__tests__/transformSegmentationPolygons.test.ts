import { describe, it, expect, vi } from 'vitest';
import { transformSegmentationPolygons } from '../transformSegmentationPolygons';
import type { SegmentationPolygon } from '@/lib/api';

// Silence the deterministic warn/debug logs the transform emits.
vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), debug: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const dims = { width: 100, height: 100 };

// Minimal helper — only the fields the transform reads.
const poly = (over: Partial<SegmentationPolygon> = {}): SegmentationPolygon =>
  ({
    id: 'p1',
    points: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ],
    type: 'external',
    ...over,
  }) as SegmentationPolygon;

describe('transformSegmentationPolygons', () => {
  describe('empty / invalid input', () => {
    it.each([
      ['null', null],
      ['undefined', undefined],
      ['empty array', []],

      ['non-array', {} as any],
    ])('returns [] for %s', (_label, input) => {
      expect(transformSegmentationPolygons(input, dims)).toEqual([]);
    });
  });

  describe('degenerate-shape filtering', () => {
    it('drops a polygon with fewer than 3 points', () => {
      const out = transformSegmentationPolygons(
        [
          poly({
            points: [
              { x: 0, y: 0 },
              { x: 1, y: 1 },
            ],
          }),
        ],
        dims
      );
      expect(out).toHaveLength(0);
    });

    it('keeps a polyline with exactly 2 points (lower minimum for polylines)', () => {
      const out = transformSegmentationPolygons(
        [
          poly({
            geometry: 'polyline',
            points: [
              { x: 0, y: 0 },
              { x: 1, y: 1 },
            ],
          }),
        ],
        dims
      );
      expect(out).toHaveLength(1);
      expect(out[0].points).toHaveLength(2);
    });

    it('drops a polyline with only 1 point', () => {
      const out = transformSegmentationPolygons(
        [poly({ geometry: 'polyline', points: [{ x: 0, y: 0 }] })],
        dims
      );
      expect(out).toHaveLength(0);
    });
  });

  describe('point normalisation', () => {
    it('converts [x, y] tuple points to { x, y }', () => {
      const out = transformSegmentationPolygons(
        [
          poly({
            points: [
              [0, 0],
              [10, 0],
              [10, 10],
            ] as any,
          }),
        ],
        dims
      );
      expect(out[0].points).toEqual([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ]);
    });

    it('drops a polygon whose non-numeric points leave fewer than the minimum', () => {
      const out = transformSegmentationPolygons(
        [
          poly({
            points: [{ x: 0, y: 0 }, { x: 'nope', y: 1 } as any, null as any],
          }),
        ],
        dims
      );
      expect(out).toHaveLength(0);
    });
  });

  describe('id coercion', () => {
    it('keeps a valid id unchanged', () => {
      const out = transformSegmentationPolygons(
        [poly({ id: 'valid-id' })],
        dims
      );
      expect(out[0].id).toBe('valid-id');
    });

    it('replaces an empty/invalid id with a generated fallback', () => {
      const out = transformSegmentationPolygons([poly({ id: '   ' })], dims);
      expect(out).toHaveLength(1);
      expect(typeof out[0].id).toBe('string');
      expect(out[0].id.trim().length).toBeGreaterThan(0);
      expect(out[0].id).not.toBe('   ');
    });
  });

  describe('field mapping', () => {
    it('converts parentIds[] to parent_id (first element)', () => {
      const out = transformSegmentationPolygons(
        [
          poly({
            type: 'internal',
            parentIds: ['parent-7', 'parent-8'],
          } as any),
        ],
        dims
      );
      expect(out[0].parent_id).toBe('parent-7');
      // parentIds is not carried through (only parent_id)
      expect('parentIds' in out[0]).toBe(false);
    });

    it('leaves parent_id undefined when there are no parentIds', () => {
      const out = transformSegmentationPolygons([poly()], dims);
      expect(out[0].parent_id).toBeUndefined();
    });

    it('spreads other wire fields (trackId, partClass) through unchanged', () => {
      const out = transformSegmentationPolygons(
        [poly({ trackId: 'mt-3', partClass: 'head' } as any)],
        dims
      );

      expect((out[0] as any).trackId).toBe('mt-3');

      expect((out[0] as any).partClass).toBe('head');
    });
  });

  it('processes a mixed batch — keeping valid, dropping degenerate', () => {
    const out = transformSegmentationPolygons(
      [
        poly({ id: 'keep-1' }),
        poly({ id: 'drop-1', points: [{ x: 0, y: 0 }] }), // too few
        poly({ id: 'keep-2' }),
      ],
      dims
    );
    expect(out.map(p => p.id)).toEqual(['keep-1', 'keep-2']);
  });

  it('does not require imageDimensions (used only for logging)', () => {
    const out = transformSegmentationPolygons([poly({ id: 'x' })], null);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('x');
  });
});
