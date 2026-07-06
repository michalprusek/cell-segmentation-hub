import { describe, it, expect, vi } from 'vitest';

vi.mock('../../utils/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() },
}));

vi.mock('../../utils/config', () => ({
  config: {
    SEGMENTATION_SERVICE_URL: 'http://localhost:8000',
    UPLOAD_DIR: './test-uploads',
    STORAGE_TYPE: 'local',
    NODE_ENV: 'test',
  },
}));

import {
  removePolygonsWithTrackId,
  upsertTrackPolyline,
  type PropagatedPolyline,
} from '../segmentationService';

const poly = (trackId: string | undefined, extra: Record<string, unknown> = {}) => ({
  id: `poly_${Math.random().toString(36).slice(2, 8)}`,
  points: [
    { x: 0, y: 0 },
    { x: 10, y: 10 },
  ],
  type: 'external',
  geometry: 'polyline',
  ...(trackId !== undefined ? { trackId } : {}),
  ...extra,
});

describe('removePolygonsWithTrackId', () => {
  it('removes every polygon carrying the trackId and counts them', () => {
    const polys = [poly('t1'), poly('t2'), poly('t1'), poly(undefined)];
    const { polygons, removed } = removePolygonsWithTrackId(polys, 't1');
    expect(removed).toBe(2);
    expect(polygons).toHaveLength(2);
    expect(
      polygons.every(p => (p as { trackId?: string }).trackId !== 't1')
    ).toBe(true);
  });

  it('leaves the list untouched when the trackId is absent', () => {
    const polys = [poly('t2'), poly(undefined)];
    const { polygons, removed } = removePolygonsWithTrackId(polys, 't1');
    expect(removed).toBe(0);
    expect(polygons).toHaveLength(2);
  });

  it('never matches an empty-string trackId against a real one', () => {
    const polys = [poly('t1'), poly('')];
    const { removed } = removePolygonsWithTrackId(polys, 't1');
    expect(removed).toBe(1);
  });
});

describe('upsertTrackPolyline', () => {
  const source: PropagatedPolyline = {
    trackId: 't1',
    name: 'MT-A',
    geometry: 'polyline',
    points: [
      { x: 1, y: 2 },
      { x: 3, y: 4 },
      { x: 5, y: 6 },
    ],
  };

  it('overwrites an existing polyline with the same trackId (no duplicate)', () => {
    const existing = [poly('t1', { name: 'stale' }), poly('t2')];
    let n = 0;
    const out = upsertTrackPolyline(existing, 't1', source, () => `new_${n++}`);
    const t1s = out.filter(p => (p as { trackId?: string }).trackId === 't1');
    expect(t1s).toHaveLength(1); // overwritten, not duplicated
    expect(out).toHaveLength(2); // t1 (replaced) + t2 (untouched)
    const added = t1s[0] as Record<string, unknown>;
    expect(added.id).toBe('new_0'); // fresh id, not the stale one
    expect(added.points).toEqual(source.points);
    expect(added.name).toBe('MT-A');
    expect(added.geometry).toBe('polyline');
    expect(added.type).toBe('external');
  });

  it('adds the polyline when the frame does not have that track yet', () => {
    const existing = [poly('t2')];
    const out = upsertTrackPolyline(existing, 't1', source, () => 'fresh');
    expect(out).toHaveLength(2);
    expect(
      out.some(p => (p as { trackId?: string }).trackId === 't1')
    ).toBe(true);
  });

  it('deep-copies points so later edits do not alias the source', () => {
    const out = upsertTrackPolyline([], 't1', source, () => 'id');
    const added = out[0] as { points: Array<{ x: number; y: number }> };
    added.points[0].x = 999;
    expect(source.points[0].x).toBe(1); // source untouched
  });

  it('omits the name field when the source has none', () => {
    const noName: PropagatedPolyline = {
      trackId: 't9',
      geometry: 'polyline',
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ],
    };
    const out = upsertTrackPolyline([], 't9', noName, () => 'id');
    expect('name' in (out[0] as object)).toBe(false);
  });
});
