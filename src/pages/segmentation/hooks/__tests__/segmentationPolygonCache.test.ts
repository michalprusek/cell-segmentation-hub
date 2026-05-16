import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import {
  buildFrameImageUrl,
  fetchSegmentationPolygonsForCache,
  getCachedSegmentationPolygons,
  segmentationPolygonsQueryKey,
  setCachedSegmentationPolygons,
} from '../segmentationPolygonCache';
import apiClient from '@/lib/api';

vi.mock('@/lib/api', () => ({
  default: {
    getSegmentationResults: vi.fn(),
  },
}));

const mockGet = apiClient.getSegmentationResults as unknown as ReturnType<
  typeof vi.fn
>;

describe('segmentationPolygonCache', () => {
  beforeEach(() => {
    mockGet.mockReset();
  });

  describe('fetchSegmentationPolygonsForCache', () => {
    it('returns { polygons: null } when apiClient returns null (404 case)', async () => {
      mockGet.mockResolvedValue(null);
      const result = await fetchSegmentationPolygonsForCache('frame-1');
      expect(result).toEqual({ polygons: null });
    });

    it('returns { polygons: null } when payload has no polygons field', async () => {
      // Backend returns 200 but the polygons field is missing — must
      // normalise to null so consumers don't crash on undefined.
      mockGet.mockResolvedValue({ imageWidth: 1024, imageHeight: 768 });
      const result = await fetchSegmentationPolygonsForCache('frame-1');
      expect(result).toEqual({ polygons: null });
    });

    it('returns the polygons + dimensions when payload is well-formed', async () => {
      const polygons = [{ id: 'p1', points: [] }];
      mockGet.mockResolvedValue({
        polygons,
        imageWidth: 320,
        imageHeight: 240,
      });
      const result = await fetchSegmentationPolygonsForCache('frame-1');
      expect(result).toEqual({
        polygons,
        imageWidth: 320,
        imageHeight: 240,
      });
    });

    it('re-throws real network/5xx errors so React Query can retry', async () => {
      const err = new Error('upstream down');
      mockGet.mockRejectedValue(err);
      await expect(fetchSegmentationPolygonsForCache('frame-1')).rejects.toBe(
        err
      );
    });

    it('forwards the abort signal to apiClient', async () => {
      mockGet.mockResolvedValue(null);
      const controller = new AbortController();
      await fetchSegmentationPolygonsForCache('frame-1', controller.signal);
      expect(mockGet).toHaveBeenCalledWith('frame-1', {
        signal: controller.signal,
      });
    });
  });

  describe('cache helpers', () => {
    it('round-trips polygons through React Query cache by canonical key', () => {
      const qc = new QueryClient();
      const data = { polygons: [], imageWidth: 100, imageHeight: 100 };
      setCachedSegmentationPolygons(qc, 'frame-9', data);
      expect(getCachedSegmentationPolygons(qc, 'frame-9')).toEqual(data);
    });

    it('returns undefined for unknown imageIds', () => {
      const qc = new QueryClient();
      expect(getCachedSegmentationPolygons(qc, 'nope')).toBeUndefined();
    });

    it('uses a stable query key shape', () => {
      expect(segmentationPolygonsQueryKey('frame-x')).toEqual([
        'segmentation-results',
        'frame-x',
      ]);
    });
  });

  describe('buildFrameImageUrl', () => {
    it('omits channel param when null', () => {
      expect(buildFrameImageUrl('frame-1', null)).toBe(
        '/api/images/frame-1/display'
      );
    });

    it('encodes channel name in the query string', () => {
      expect(buildFrameImageUrl('frame-1', 'TIRF 640')).toBe(
        '/api/images/frame-1/frame-data?channel=TIRF%20640'
      );
    });
  });
});
