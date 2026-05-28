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
  extractTrackedPolys,
  diffTrackOps,
  parsePolygonsJsonForDiff,
} from '../segmentationService';

const polyline = (
  trackId: string | undefined,
  extra: Record<string, unknown> = {}
) => ({
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

describe('cross-frame propagation diff', () => {
  describe('extractTrackedPolys', () => {
    it('skips polygons without trackId', () => {
      const result = extractTrackedPolys([
        polyline(undefined, { name: 'X' }),
        polyline('t1', { name: 'A' }),
      ]);
      expect(result.size).toBe(1);
      expect(result.get('t1')).toMatchObject({ trackId: 't1', name: 'A' });
    });

    it('skips polygons with empty-string trackId (collision risk)', () => {
      const result = extractTrackedPolys([polyline('', { name: 'X' })]);
      expect(result.size).toBe(0);
    });
  });

  describe('diffTrackOps', () => {
    it('emits a rename op when name changes for the same trackId', () => {
      const prev = [polyline('t1', { name: 'MT-A' })];
      const next = [polyline('t1', { name: 'MT-A-renamed' })];
      const { renames, deletes } = diffTrackOps(prev, next);
      expect(deletes.size).toBe(0);
      expect(renames.get('t1')).toMatchObject({
        type: 'rename',
        name: 'MT-A-renamed',
      });
    });

    it('emits a rename op when partClass changes', () => {
      const prev = [polyline('t1', { partClass: 'head' })];
      const next = [polyline('t1', { partClass: 'tail' })];
      const { renames } = diffTrackOps(prev, next);
      expect(renames.get('t1')).toMatchObject({ partClass: 'tail' });
    });

    it('emits a delete when a trackId disappears from new polygons', () => {
      const prev = [polyline('t1', { name: 'A' }), polyline('t2', { name: 'B' })];
      const next = [polyline('t1', { name: 'A' })]; // t2 deleted
      const { renames, deletes } = diffTrackOps(prev, next);
      expect(renames.size).toBe(0);
      expect(deletes.has('t2')).toBe(true);
    });

    it('does NOT emit any op when only points change (per-frame geometry)', () => {
      const prev = [
        { ...polyline('t1', { name: 'A' }), points: [{ x: 1, y: 1 }] },
      ];
      const next = [
        { ...polyline('t1', { name: 'A' }), points: [{ x: 99, y: 99 }] },
      ];
      const { renames, deletes } = diffTrackOps(prev, next);
      expect(renames.size).toBe(0);
      expect(deletes.size).toBe(0);
    });

    it('does NOT propagate fresh trackIds (new on this frame only)', () => {
      const prev: unknown[] = [];
      const next = [polyline('t_new', { name: 'fresh' })];
      const { renames, deletes } = diffTrackOps(prev, next);
      expect(renames.size).toBe(0);
      expect(deletes.size).toBe(0);
    });

    it('handles polygons without trackId without crashing', () => {
      const prev = [polyline(undefined), polyline('t1', { name: 'A' })];
      const next = [polyline(undefined), polyline('t1', { name: 'B' })];
      const { renames } = diffTrackOps(prev, next);
      expect(renames.size).toBe(1);
      expect(renames.get('t1')!.name).toBe('B');
    });
  });

  describe('parsePolygonsJsonForDiff', () => {
    const ctx = { currentImageId: 'img1', parentVideoId: 'vid1' };

    it('parses a well-formed JSON array', () => {
      const json = JSON.stringify([polyline('t1', { name: 'A' })]);
      const result = parsePolygonsJsonForDiff(json, ctx);
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(1);
    });

    it('returns [] when JSON is malformed', () => {
      expect(parsePolygonsJsonForDiff('not json {[', ctx)).toEqual([]);
    });

    it('returns [] when JSON parses to a non-array', () => {
      expect(parsePolygonsJsonForDiff('{"oops": true}', ctx)).toEqual([]);
    });
  });
});
