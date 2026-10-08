/**
 * The two propagate routes over real HTTP: the real router, the real
 * validation chain, the real controller and the real `ResponseHelper`. Only
 * the service's two methods are stubbed — and `VideoAccessError` is kept
 * real, because the controller maps it to 404 by `instanceof`.
 */
import request from 'supertest';
import express from 'express';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { MockedFunction } from 'vitest';

const stubs = vi.hoisted(() => ({
  batch: vi.fn(),
  single: vi.fn(),
}));

vi.mock('../../../middleware/auth');
vi.mock('../../../utils/logger');
vi.mock('../../../db');
vi.mock('../../../services/imageService');
vi.mock('../../../services/segmentationService', async importOriginal => ({
  ...(await importOriginal<
    typeof import('../../../services/segmentationService')
  >()),
  SegmentationService: class {
    propagateTracksGeometryForward = stubs.batch;
    propagateTrackGeometryForward = stubs.single;
  },
}));
vi.mock('../../../utils/config', () => ({
  config: {
    NODE_ENV: 'test',
    PORT: 3001,
    HOST: 'localhost',
    DATABASE_URL: 'file:./test.db',
    JWT_ACCESS_SECRET: 'test-secret-at-least-32-chars-long-for-test',
    JWT_REFRESH_SECRET: 'test-refresh-secret-at-least-32-chars-long',
    REDIS_URL: 'redis://localhost:6379',
    ML_SERVICE_URL: 'http://localhost:8000',
    SEGMENTATION_SERVICE_URL: 'http://localhost:8000',
    FROM_EMAIL: 'test@example.com',
    FROM_NAME: 'Test',
    UPLOAD_DIR: './uploads',
    EMAIL_SERVICE: 'none',
    ALLOWED_ORIGINS: 'http://localhost:3000',
    WS_ALLOWED_ORIGINS: 'http://localhost:3000',
  },
}));

import { segmentationRoutes } from '../segmentationRoutes';
import { authenticate } from '../../../middleware/auth';
import { VideoAccessError } from '../../../services/segmentationService';

const videoId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const BATCH = `/api/segmentation/videos/${videoId}/tracks/propagate-batch`;
const SINGLE = `/api/segmentation/videos/${videoId}/tracks/propagate`;

// Bent, so a route that reordered or dropped a point would show.
const bent = (trackId?: string | null) => ({
  ...(trackId === undefined ? {} : { trackId }),
  geometry: 'polyline',
  points: [
    { x: 10, y: 40 },
    { x: 25.5, y: 31.25 },
    { x: 48, y: 36 },
  ],
});
const answer = (trackId: string) => ({
  trackId,
  framesUpdated: 3,
  framesChanged: 2,
  framesUnchanged: 1,
  framesSkipped: 0,
});

describe('propagate routes', () => {
  let app: express.Application;

  beforeEach(() => {
    stubs.batch.mockReset();
    stubs.single.mockReset();
    (authenticate as MockedFunction<typeof authenticate>).mockImplementation(
      async (req, _res, next) => {
        (req as express.Request & { user?: unknown }).user = {
          id: 'test-user-id',
          email: 'test@example.com',
        };
        next();
      }
    );
    app = express();
    app.use(express.json({ limit: '50mb' }));
    app.use('/api/segmentation', segmentationRoutes);
  });

  describe('POST /videos/:videoId/tracks/propagate-batch', () => {
    it('hands the service every polyline, in order, and answers { results }', async () => {
      const polylines = [bent('t1'), bent(null), bent()];
      const results = [answer('t1'), answer('mt_aaaaaaaa'), answer('mt_bbbbbbbb')];
      stubs.batch.mockResolvedValue(results);

      // The index arrives as a string from some clients; the service must
      // still get a number.
      const res = await request(app)
        .post(BATCH)
        .send({ fromFrameIndex: '3', polylines })
        .expect(200);

      expect(stubs.batch).toHaveBeenCalledTimes(1);
      expect(stubs.batch).toHaveBeenCalledWith(
        videoId,
        3,
        polylines,
        'test-user-id'
      );
      expect(stubs.single).not.toHaveBeenCalled();
      expect(res.body.data).toEqual({ results });
    });

    it('accepts a coordinate that JSON writes with an exponent', async () => {
      // `isNumeric()` refused this, and in a batch one such vertex refused
      // the whole selection.
      stubs.batch.mockResolvedValue([answer('t1')]);
      const polyline = bent('t1');
      polyline.points[0] = { x: 5e-7, y: 1.5e21 };
      expect(JSON.stringify(polyline)).toContain('5e-7');

      await request(app)
        .post(BATCH)
        .send({ fromFrameIndex: 0, polylines: [polyline] })
        .expect(200);
      expect(stubs.batch.mock.calls[0]?.[2]).toEqual([polyline]);
    });

    const withPoints = (points: unknown) => ({
      fromFrameIndex: 0,
      polylines: [bent('t1'), { geometry: 'polyline', points }],
    });
    it.each<[string, unknown]>([
      ['fromFrameIndex negative', { fromFrameIndex: -1, polylines: [bent()] }],
      ['fromFrameIndex fractional', { fromFrameIndex: 1.5, polylines: [bent()] }],
      ['fromFrameIndex missing', { polylines: [bent()] }],
      ['polylines missing', { fromFrameIndex: 0 }],
      ['polylines empty', { fromFrameIndex: 0, polylines: [] }],
      ['polylines not an array', { fromFrameIndex: 0, polylines: bent() }],
      ['an element that is a number', { fromFrameIndex: 0, polylines: [5] }],
      ['an element that is null', { fromFrameIndex: 0, polylines: [null] }],
      ['points missing', withPoints(undefined)],
      ['a single point', withPoints([{ x: 1, y: 1 }])],
      ['points that are numbers', withPoints([1, 2])],
      ['x a numeric STRING', withPoints([{ x: '5', y: 1 }, { x: 2, y: 2 }])],
      ['x null', withPoints([{ x: null, y: 1 }, { x: 2, y: 2 }])],
      ['y missing', withPoints([{ x: 1 }, { x: 2, y: 2 }])],
      [
        'trackId a number',
        { fromFrameIndex: 0, polylines: [{ ...bent(), trackId: 7 }] },
      ],
      [
        'name a number',
        { fromFrameIndex: 0, polylines: [{ ...bent(), name: 3 }] },
      ],
      [
        'an unknown geometry',
        { fromFrameIndex: 0, polylines: [{ ...bent(), geometry: 'circle' }] },
      ],
    ])('refuses %s with 400 and never reaches the service', async (_n, body) => {
      const res = await request(app)
        .post(BATCH)
        .send(body as object);
      expect(res.status).toBe(400);
      expect(stubs.batch).not.toHaveBeenCalled();
    });

    it('refuses a non-UUID video id', async () => {
      await request(app)
        .post('/api/segmentation/videos/not-a-uuid/tracks/propagate-batch')
        .send({ fromFrameIndex: 0, polylines: [bent()] })
        .expect(400);
      expect(stubs.batch).not.toHaveBeenCalled();
    });

    it('takes 2000 polylines and refuses 2001', async () => {
      stubs.batch.mockResolvedValue([]);
      const many = (n: number) => ({
        fromFrameIndex: 0,
        polylines: Array.from({ length: n }, (_, i) => bent(`t${i}`)),
      });
      await request(app).post(BATCH).send(many(2000)).expect(200);
      expect(stubs.batch).toHaveBeenCalledTimes(1);
      await request(app).post(BATCH).send(many(2001)).expect(400);
      expect(stubs.batch).toHaveBeenCalledTimes(1);
    });

    it.each<[string, Error, number]>([
      ['a video the user cannot reach', new VideoAccessError(), 404],
      [
        'a degenerate polyline',
        new Error('Propagated polyline needs at least 2 points'),
        400,
      ],
      [
        'a non-finite coordinate',
        new Error('Propagated polyline needs at least 2 finite points'),
        400,
      ],
      ['anything else', new Error('connection reset'), 500],
    ])('maps %s to its status', async (_n, error, status) => {
      stubs.batch.mockRejectedValue(error);
      await request(app)
        .post(BATCH)
        .send({ fromFrameIndex: 0, polylines: [bent('t1')] })
        .expect(status);
    });
  });

  describe('POST /videos/:videoId/tracks/propagate', () => {
    it('hands the service the one polyline', async () => {
      stubs.single.mockResolvedValue(answer('t1'));
      const res = await request(app)
        .post(SINGLE)
        .send({ fromFrameIndex: 4, polyline: bent('t1') })
        .expect(200);
      expect(stubs.single).toHaveBeenCalledWith(
        videoId,
        4,
        bent('t1'),
        'test-user-id'
      );
      expect(stubs.batch).not.toHaveBeenCalled();
      expect(res.body.data).toEqual(answer('t1'));
    });

    it('accepts an exponent coordinate and refuses a numeric string', async () => {
      stubs.single.mockResolvedValue(answer('t1'));
      const tiny = bent('t1');
      tiny.points[0] = { x: 5e-7, y: 3 };
      await request(app)
        .post(SINGLE)
        .send({ fromFrameIndex: 0, polyline: tiny })
        .expect(200);

      const stringy = { ...bent('t1'), points: [{ x: '5', y: 1 }, { x: 2, y: 2 }] };
      await request(app)
        .post(SINGLE)
        .send({ fromFrameIndex: 0, polyline: stringy })
        .expect(400);
      expect(stubs.single).toHaveBeenCalledTimes(1);
    });
  });
});
