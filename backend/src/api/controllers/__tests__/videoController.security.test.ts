/**
 * Security regression tests for VideoController.
 *
 * Round-2 review (PR #142) flagged that the round-1 path-traversal +
 * authz fixes need test coverage so future refactors can't silently
 * regress them. These tests pin down:
 *
 *  - GAP-2: `getFrameData` rejects `?channel=../...` with 400 BEFORE
 *    touching the DB or the filesystem. Asserts the regex layer is the
 *    first gate.
 *  - GAP-2: `getFrameData` rejects regex-valid-but-undeclared channels
 *    with 400. Asserts the container.channels whitelist layer.
 *  - GAP-3: `updateChannels` rejects a body with two
 *    `isSegmentationSource: true` channels with 400 and never calls
 *    prisma.image.update. The "at-most-one" invariant is what keeps the
 *    downstream pipeline deterministic about which channel feeds the
 *    segmenter.
 *  - GAP-3: `updateChannels` rejects a channel.type outside
 *    `'irm'|'fluorescent'`.
 *
 * Mocked surface: prisma (db/prismaClient), fs/promises (the access()
 * call), authz (assertProjectAccess via prisma.user + prisma.project
 * stubs). No real filesystem or network.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// --- mocks (must come before importing the SUT) ------------------------

const {
  fsAccessMock,
  prismaImageFindUnique,
  prismaImageUpdate,
  prismaUserFindUnique,
  prismaProjectFindFirst,
} = vi.hoisted(() => ({
  fsAccessMock: vi.fn(),
  prismaImageFindUnique: vi.fn(),
  prismaImageUpdate: vi.fn(),
  prismaUserFindUnique: vi.fn(),
  prismaProjectFindFirst: vi.fn(),
}));

vi.mock('fs/promises', () => ({
  default: { access: fsAccessMock, rm: vi.fn() },
  access: fsAccessMock,
  rm: vi.fn(),
}));

vi.mock('../../../db/prismaClient', () => ({
  prisma: {
    image: { findUnique: prismaImageFindUnique, update: prismaImageUpdate },
    user: { findUnique: prismaUserFindUnique },
    project: { findFirst: prismaProjectFindFirst },
  },
}));

vi.mock('../../../utils/config', () => ({
  config: { UPLOAD_DIR: '/tmp/test-uploads' },
}));

vi.mock('../../../utils/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../../services/videoUploadService', () => ({
  uploadVideoFromFile: vi.fn(),
}));

vi.mock('../../../services/video/videoExtractor', () => ({
  isVideoFilename: () => true,
}));

import { VideoController } from '../videoController';

// --- helpers -----------------------------------------------------------

/** Build a minimal Express app that injects req.user.id then mounts the
 *  routes under test. Mirrors the real wiring without pulling in the
 *  full middleware chain (auth, validation, rate-limit). */
function buildApp() {
  const app = express();
  app.use(express.json());
  // Stub auth — every request lands as user 'u-1'.
  app.use((req, _res, next) => {
    (req as unknown as { user: { id: string } }).user = { id: 'u-1' };
    next();
  });
  app.get('/images/:imageId/frame-data', (req, res) =>
    VideoController.getFrameData(req, res)
  );
  app.patch('/images/:imageId/channels', (req, res) =>
    VideoController.updateChannels(req, res)
  );
  return app;
}

const VALID_FRAME_ROW = {
  id: 'frame-1',
  projectId: 'proj-1',
  originalPath: 'video-1/frames/0000/irm.png',
  isVideoContainer: false,
  parentVideoId: 'video-1',
  frameIndex: 0,
  channels: null,
  name: 'frame',
  width: 100,
  height: 100,
  frameCount: null,
  videoDurationMs: null,
};

const VALID_CONTAINER_ROW = {
  id: 'video-1',
  projectId: 'proj-1',
  originalPath: 'video-1/original.mp4',
  isVideoContainer: true,
  parentVideoId: null,
  frameIndex: null,
  channels: [
    {
      name: 'IRM',
      type: 'irm',
      isSegmentationSource: true,
    },
  ],
  name: 'video',
  width: 100,
  height: 100,
  frameCount: 5,
  videoDurationMs: null,
};

// --- tests -------------------------------------------------------------

describe('VideoController security regressions (round-2 GAP-2 + GAP-3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default authz pass-through: user exists, project access granted.
    prismaUserFindUnique.mockResolvedValue({ email: 'u@example.com' });
    prismaProjectFindFirst.mockResolvedValue({ id: 'proj-1' });
  });

  describe('getFrameData path traversal', () => {
    it('rejects ?channel=../../../etc/passwd with 400 BEFORE touching the DB', async () => {
      const res = await request(buildApp())
        .get('/images/frame-1/frame-data')
        .query({ channel: '../../../etc/passwd' });

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ success: false });
      // The regex must reject BEFORE the DB lookup so a malicious query
      // never even hits Prisma.
      expect(prismaImageFindUnique).not.toHaveBeenCalled();
      expect(fsAccessMock).not.toHaveBeenCalled();
    });

    it('rejects channels containing slashes / nulls / dots with 400', async () => {
      // Empty string is treated as "no channel" (falls through to default
      // originalPath branch), so it's NOT in this invalid set — only truly
      // path-unsafe values are.
      for (const evil of [
        '/etc/passwd',
        'a\0b',
        'channel.png', // dots banned
        'foo/bar',
        '..',
      ]) {
        const res = await request(buildApp())
          .get('/images/frame-1/frame-data')
          .query({ channel: evil });
        expect(
          res.status,
          `expected 400 for channel=${JSON.stringify(evil)}`
        ).toBe(400);
      }
      // After all invalid attempts, still no DB lookups (regex first gate).
      expect(prismaImageFindUnique).not.toHaveBeenCalled();
    });

    it('rejects a regex-valid channel that is NOT in the container whitelist', async () => {
      prismaImageFindUnique.mockImplementation(({ where }) => {
        if (where.id === 'frame-1') return Promise.resolve(VALID_FRAME_ROW);
        if (where.id === 'video-1')
          return Promise.resolve({
            ...VALID_CONTAINER_ROW,
            channels: [
              { name: 'IRM', type: 'irm', isSegmentationSource: true },
            ],
          });
        return Promise.resolve(null);
      });

      const res = await request(buildApp())
        .get('/images/frame-1/frame-data')
        .query({ channel: 'NOT_IN_WHITELIST' });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Unknown channel/);
      // Channel-whitelist check happens BEFORE filesystem access.
      expect(fsAccessMock).not.toHaveBeenCalled();
    });
  });

  describe('updateChannels invariant', () => {
    it('rejects two channels with isSegmentationSource:true', async () => {
      const res = await request(buildApp())
        .patch('/images/video-1/channels')
        .send({
          channels: [
            { name: 'IRM', type: 'irm', isSegmentationSource: true },
            { name: 'GFP', type: 'fluorescent', isSegmentationSource: true },
          ],
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/At most one channel/);
      expect(prismaImageUpdate).not.toHaveBeenCalled();
    });

    it("rejects channel.type outside 'irm'|'fluorescent'", async () => {
      const res = await request(buildApp())
        .patch('/images/video-1/channels')
        .send({
          channels: [
            { name: 'IRM', type: 'phase', isSegmentationSource: true },
          ],
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/channel\.type/);
      expect(prismaImageUpdate).not.toHaveBeenCalled();
    });

    it("rejects an unsafe channel.name (e.g. '../')", async () => {
      const res = await request(buildApp())
        .patch('/images/video-1/channels')
        .send({
          channels: [
            { name: '../etc', type: 'irm', isSegmentationSource: false },
          ],
        });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/alnum/);
      expect(prismaImageUpdate).not.toHaveBeenCalled();
    });

    it('accepts a single source channel + persists', async () => {
      prismaImageFindUnique.mockResolvedValue(VALID_CONTAINER_ROW);
      prismaImageUpdate.mockResolvedValue({});

      const res = await request(buildApp())
        .patch('/images/video-1/channels')
        .send({
          channels: [
            { name: 'IRM', type: 'irm', isSegmentationSource: true },
            { name: 'GFP', type: 'fluorescent', isSegmentationSource: false },
          ],
        });

      expect(res.status).toBe(200);
      expect(prismaImageUpdate).toHaveBeenCalledOnce();
      const call = prismaImageUpdate.mock.calls[0]?.[0];
      expect(call?.where).toEqual({ id: 'video-1' });
    });
  });
});
