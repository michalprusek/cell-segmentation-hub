/**
 * segmentationService.trackOpsService.test.ts
 *
 * Orchestration tests (mocked Prisma) for the cross-frame track endpoints —
 * complements the pure-helper unit tests in segmentationService.trackOps.test.ts.
 *
 *  propagateTrackGeometryForward
 *   - generates one mt_<hex> trackId when the source is untracked and writes
 *     that SAME id into every following frame (the feature's core identity
 *     promise — a regression here silently gives each frame a different colour)
 *   - reuses the source trackId when present
 *   - SKIPS a corrupt-JSON frame instead of overwriting it with just the
 *     propagated polyline (data-loss guard)
 *   - skips frames with no segmentation row; empty set → no transaction
 *   - throws VideoAccessError when the video is not owned
 *
 *  deleteTrackAcrossVideo
 *   - removes the track from exactly the frames that carry it
 *   - throws VideoAccessError when the video is not owned
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import {
  SegmentationService,
  VideoAccessError,
} from '../segmentationService';
import { ImageService } from '../imageService';

vi.mock('../../utils/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../utils/config', () => ({
  config: {
    SEGMENTATION_SERVICE_URL: 'http://localhost:8000',
    STORAGE_TYPE: 'local',
    UPLOAD_DIR: '/tmp/uploads',
    NODE_ENV: 'test',
  },
}));
vi.mock('../../storage');
vi.mock('../segmentationThumbnailService');
vi.mock('../thumbnailManager', () => ({
  ThumbnailManager: function MockThumbnailManager(this: any) {
    this.generateAllThumbnails = vi.fn().mockResolvedValue(undefined);
  },
}));
vi.mock('../imageService');

const seg = (id: string, polygons: unknown[]) => ({
  id: `seg-${id}`,
  polygons: JSON.stringify(polygons),
});
const line = (trackId?: string) => ({
  id: `p-${Math.random().toString(36).slice(2, 7)}`,
  type: 'external',
  geometry: 'polyline',
  points: [
    { x: 1, y: 1 },
    { x: 2, y: 2 },
  ],
  ...(trackId ? { trackId } : {}),
});

/** Parse the polygons JSON written by a given segmentation.update mock call. */
const writtenPolys = (call: any): any[] =>
  JSON.parse(call[0].data.polygons);

describe('SegmentationService track ops (orchestration)', () => {
  let service: SegmentationService;
  let prismaMock: any;
  let imageServiceMock: any;

  beforeEach(() => {
    prismaMock = {
      segmentation: { update: vi.fn(x => x), create: vi.fn(x => x) },
      image: { findMany: vi.fn(), update: vi.fn(x => x) },
      $transaction: vi.fn().mockResolvedValue([]),
    };
    imageServiceMock = { getImageById: vi.fn() };
    service = new SegmentationService(
      prismaMock as PrismaClient,
      imageServiceMock as ImageService
    );
    // getImageById returns a truthy container by default (owned).
    imageServiceMock.getImageById.mockResolvedValue({ id: 'vid', isVideoContainer: true });
  });

  describe('propagateTrackGeometryForward', () => {
    const srcPolyline = {
      geometry: 'polyline' as const,
      points: [
        { x: 5, y: 5 },
        { x: 6, y: 7 },
        { x: 8, y: 9 },
      ],
    };

    it('generates one mt_<hex> trackId and writes it identically into every following frame', async () => {
      prismaMock.image.findMany.mockResolvedValue([
        { id: 'f1', segmentation: seg('1', [line('other')]) },
        { id: 'f2', segmentation: seg('2', []) },
      ]);

      const res = await service.propagateTrackGeometryForward(
        'vid',
        0,
        { ...srcPolyline, trackId: undefined },
        'user'
      );

      expect(res.trackId).toMatch(/^mt_[0-9a-f]{8}$/);
      expect(res.framesUpdated).toBe(2);
      expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);

      // Every written frame carries the SAME generated trackId on the new line.
      const calls = prismaMock.segmentation.update.mock.calls;
      expect(calls).toHaveLength(2);
      for (const call of calls) {
        const added = writtenPolys(call).filter(p => p.trackId === res.trackId);
        expect(added).toHaveLength(1);
        expect(added[0].points).toEqual(srcPolyline.points);
      }
      // Frame f1's unrelated 'other' track is preserved (not clobbered).
      expect(
        writtenPolys(calls[0]).some(p => p.trackId === 'other')
      ).toBe(true);
    });

    it('reuses the source trackId when it already has one', async () => {
      prismaMock.image.findMany.mockResolvedValue([
        { id: 'f1', segmentation: seg('1', [line('t7')]) },
      ]);
      const res = await service.propagateTrackGeometryForward(
        'vid',
        0,
        { ...srcPolyline, trackId: 't7' },
        'user'
      );
      expect(res.trackId).toBe('t7');
      // Overwrite: the frame ends with exactly one 't7' line (no duplicate).
      expect(
        writtenPolys(prismaMock.segmentation.update.mock.calls[0]).filter(
          p => p.trackId === 't7'
        )
      ).toHaveLength(1);
    });

    it('skips a corrupt-JSON frame instead of clobbering it', async () => {
      prismaMock.image.findMany.mockResolvedValue([
        { id: 'good', segmentation: seg('good', [line('a'), line('b')]) },
        { id: 'bad', segmentation: { id: 'seg-bad', polygons: '{not json' } },
      ]);
      const res = await service.propagateTrackGeometryForward(
        'vid',
        0,
        { ...srcPolyline, trackId: 'x' },
        'user'
      );
      // Only the good frame is written; the corrupt frame is left untouched.
      expect(res.framesUpdated).toBe(1);
      expect(prismaMock.segmentation.update).toHaveBeenCalledTimes(1);
      expect(prismaMock.segmentation.update.mock.calls[0][0].where.id).toBe(
        'seg-good'
      );
    });

    it('creates a segmentation row (+ marks segmented) for a frame that has none', async () => {
      prismaMock.image.findMany.mockResolvedValue([
        { id: 'f1', width: 512, height: 512, segmentation: null },
      ]);
      const res = await service.propagateTrackGeometryForward(
        'vid',
        0,
        { ...srcPolyline, trackId: 't' },
        'user'
      );
      // The microtubule now appears in the previously-empty frame.
      expect(res.framesUpdated).toBe(1);
      expect(prismaMock.segmentation.update).not.toHaveBeenCalled();
      // A new segmentation row was created carrying just the propagated line...
      expect(prismaMock.segmentation.create).toHaveBeenCalledTimes(1);
      const created = prismaMock.segmentation.create.mock.calls[0][0].data;
      const polys = JSON.parse(created.polygons);
      expect(polys).toHaveLength(1);
      expect(polys[0].trackId).toBe('t');
      expect(created.imageWidth).toBe(512);
      // ...and the frame was marked segmented, all in one transaction.
      expect(prismaMock.image.update.mock.calls[0][0].data.segmentationStatus).toBe(
        'segmented'
      );
      expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    });

    it('does not open a transaction when there are no following frames', async () => {
      prismaMock.image.findMany.mockResolvedValue([]);
      const res = await service.propagateTrackGeometryForward(
        'vid',
        99,
        { ...srcPolyline, trackId: 't' },
        'user'
      );
      expect(res.framesUpdated).toBe(0);
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it('throws VideoAccessError when the video is not owned', async () => {
      imageServiceMock.getImageById.mockResolvedValue(null);
      await expect(
        service.propagateTrackGeometryForward('vid', 0, srcPolyline, 'user')
      ).rejects.toBeInstanceOf(VideoAccessError);
    });

    it('throws on a degenerate (<2 point) polyline', async () => {
      await expect(
        service.propagateTrackGeometryForward(
          'vid',
          0,
          { geometry: 'polyline', points: [{ x: 1, y: 1 }] },
          'user'
        )
      ).rejects.toThrow(/at least 2/);
    });
  });

  describe('deleteTrackAcrossVideo', () => {
    it('removes the track from exactly the frames that carry it', async () => {
      prismaMock.image.findMany.mockResolvedValue([
        { id: 'f1', segmentation: seg('1', [line('t1'), line('t2')]) },
        { id: 'f2', segmentation: seg('2', [line('t2')]) }, // no t1 → untouched
        { id: 'f3', segmentation: seg('3', [line('t1')]) },
        { id: 'f4', segmentation: null },
      ]);
      const res = await service.deleteTrackAcrossVideo('vid', 't1', 'user');
      expect(res.framesAffected).toBe(2); // f1 + f3
      expect(prismaMock.segmentation.update).toHaveBeenCalledTimes(2);
      // t1 is gone from every written frame; t2 survives.
      for (const call of prismaMock.segmentation.update.mock.calls) {
        const polys = writtenPolys(call);
        expect(polys.some(p => p.trackId === 't1')).toBe(false);
      }
    });

    it('throws VideoAccessError when the video is not owned', async () => {
      imageServiceMock.getImageById.mockResolvedValue(null);
      await expect(
        service.deleteTrackAcrossVideo('vid', 't1', 'user')
      ).rejects.toBeInstanceOf(VideoAccessError);
    });
  });

  describe('setTrackTypeAcrossVideo', () => {
    it('sets mtType on exactly the frames carrying a selected track', async () => {
      prismaMock.image.findMany.mockResolvedValue([
        { id: 'f1', segmentation: seg('1', [line('t1'), line('t2')]) },
        { id: 'f2', segmentation: seg('2', [line('t2')]) }, // no t1 → untouched
        { id: 'f3', segmentation: seg('3', [line('t1')]) },
        { id: 'f4', segmentation: null },
      ]);
      const res = await service.setTrackTypeAcrossVideo(
        'vid',
        ['t1'],
        'mt_type_x',
        'user'
      );
      expect(res.framesAffected).toBe(2); // f1 + f3
      expect(prismaMock.segmentation.update).toHaveBeenCalledTimes(2);
      for (const call of prismaMock.segmentation.update.mock.calls) {
        const polys = writtenPolys(call);
        expect(
          polys
            .filter(p => p.trackId === 't1')
            .every(p => p.mtType === 'mt_type_x')
        ).toBe(true);
        // A different track on the same frame keeps no mtType.
        expect(
          polys.filter(p => p.trackId === 't2').every(p => !p.mtType)
        ).toBe(true);
      }
    });

    it('returns 0 and does not scan for an empty trackIds list', async () => {
      const res = await service.setTrackTypeAcrossVideo(
        'vid',
        [],
        'mt_type_x',
        'user'
      );
      expect(res.framesAffected).toBe(0);
      expect(prismaMock.image.findMany).not.toHaveBeenCalled();
    });

    it('clears mtType when passed null', async () => {
      prismaMock.image.findMany.mockResolvedValue([
        {
          id: 'f1',
          segmentation: seg('1', [{ ...line('t1'), mtType: 'mt_type_x' }]),
        },
      ]);
      const res = await service.setTrackTypeAcrossVideo(
        'vid',
        ['t1'],
        null,
        'user'
      );
      expect(res.framesAffected).toBe(1);
      const polys = writtenPolys(prismaMock.segmentation.update.mock.calls[0]);
      expect(polys[0].mtType).toBeUndefined();
    });

    it('throws VideoAccessError when the video is not owned', async () => {
      imageServiceMock.getImageById.mockResolvedValue(null);
      await expect(
        service.setTrackTypeAcrossVideo('vid', ['t1'], 'mt_type_x', 'user')
      ).rejects.toBeInstanceOf(VideoAccessError);
    });
  });
});
