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
 *  - `updateChannels` treats the STORED row as authoritative for the
 *    keys that record how a channel was built (`SERVER_OWNED_CHANNEL_KEYS`).
 *    A PATCH body can neither erase them nor assert them. Both directions
 *    matter: erasing `staticSource` makes a 299-frame video re-segment frame
 *    by frame and lose the cross-frame identity the projection mints, and
 *    asserting it makes the server skip 298 frames of real acquisition on a
 *    claim nothing measured.
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

  describe('updateChannels — the stored row owns how a channel was built', () => {
    /** An IRM snapshot glued onto every frame by "Add channel", plus a
     *  channel the microscope only refreshed every third frame. Both records
     *  are measurements; neither is reconstructible from a request body. */
    const STORED = [
      {
        name: 'IRM',
        displayName: 'IRM',
        type: 'fluorescent',
        isSegmentationSource: false,
        pngBacked: true,
        staticSource: true,
        frameIds: ['f0', 'f1', 'f2'],
        staticShifts: { f0: [0, 0], f1: [3, -2] },
        proxyRangeMax: 32767,
      },
      {
        name: 'Channel_1',
        type: 'fluorescent',
        isSegmentationSource: true,
        sparseSource: true,
        sparseFill: { '1': 0, '2': 0 },
        sparseFillFrameIds: { 'f1': 'f0' },
      },
    ];

    /** What a client built from `apiClient.updateImageChannels`'s DTO sends:
     *  the enumerated fields only. `staticSource` / `staticShifts` /
     *  `proxyRangeMax` are not in that type, so they simply vanish. */
    const NARROW_BODY = [
      {
        name: 'IRM',
        displayName: 'IRM snapshot',
        type: 'fluorescent',
        isSegmentationSource: false,
      },
      {
        name: 'Channel_1',
        type: 'fluorescent',
        isSegmentationSource: true,
      },
    ];

    function storedContainer(channels: unknown = STORED) {
      prismaImageFindUnique.mockResolvedValue({
        ...VALID_CONTAINER_ROW,
        channels,
      });
      prismaImageUpdate.mockResolvedValue({});
    }

    /** The channels JSON actually persisted. */
    function persisted(): Record<string, unknown>[] {
      const call = prismaImageUpdate.mock.calls[0]?.[0] as {
        data: { channels: Record<string, unknown>[] };
      };
      return call.data.channels;
    }

    it('re-grafts every server-owned field a narrow client dropped', async () => {
      storedContainer();

      const res = await request(buildApp())
        .patch('/images/video-1/channels')
        .send({ channels: NARROW_BODY });

      expect(res.status).toBe(200);
      const [irm, sparse] = persisted();
      expect(irm).toMatchObject({
        // the client's edit lands …
        displayName: 'IRM snapshot',
        // … and everything the ingest recorded survives it
        staticSource: true,
        staticShifts: { f0: [0, 0], f1: [3, -2] },
        pngBacked: true,
        frameIds: ['f0', 'f1', 'f2'],
        proxyRangeMax: 32767,
      });
      expect(sparse).toMatchObject({
        sparseSource: true,
        sparseFill: { '1': 0, '2': 0 },
        sparseFillFrameIds: { 'f1': 'f0' },
      });
    });

    it('refuses an explicit attempt to clear them', async () => {
      // Not hypothetical malice: a stale client cache round-tripping an old
      // copy of the row looks exactly like this.
      storedContainer();

      const res = await request(buildApp())
        .patch('/images/video-1/channels')
        .send({
          channels: [
            { ...NARROW_BODY[0], staticSource: false, frameIds: [] },
            { ...NARROW_BODY[1], sparseSource: false, sparseFill: {} },
          ],
        });

      expect(res.status).toBe(200);
      const [irm, sparse] = persisted();
      expect(irm.staticSource).toBe(true);
      expect(irm.frameIds).toEqual(['f0', 'f1', 'f2']);
      expect(sparse.sparseSource).toBe(true);
      expect(sparse.sparseFill).toEqual({ '1': 0, '2': 0 });
    });

    it('refuses to let a body ASSERT them on a plain channel', async () => {
      // "This channel came from one image" is something the ingest measured.
      // Believing a request would skip segmenting frames that hold real,
      // different acquisitions.
      storedContainer([
        { name: 'GFP', type: 'fluorescent', isSegmentationSource: false },
      ]);

      const res = await request(buildApp())
        .patch('/images/video-1/channels')
        .send({
          channels: [
            {
              name: 'GFP',
              type: 'fluorescent',
              isSegmentationSource: false,
              staticSource: true,
              sparseSource: true,
              sparseFill: { '1': 0 },
              frameIds: ['forged'],
            },
          ],
        });

      expect(res.status).toBe(200);
      const [gfp] = persisted();
      expect(gfp).not.toHaveProperty('staticSource');
      expect(gfp).not.toHaveProperty('sparseSource');
      expect(gfp).not.toHaveProperty('sparseFill');
      expect(gfp).not.toHaveProperty('frameIds');
    });

    it('still lets the client own label, colour and the segmentation source', async () => {
      storedContainer();

      const res = await request(buildApp())
        .patch('/images/video-1/channels')
        .send({
          channels: [
            {
              ...NARROW_BODY[0],
              displayName: 'renamed',
              displayColor: '#ff00ff',
              isSegmentationSource: true,
            },
            { ...NARROW_BODY[1], isSegmentationSource: false },
          ],
        });

      expect(res.status).toBe(200);
      const [irm, sparse] = persisted();
      expect(irm.displayName).toBe('renamed');
      expect(irm.displayColor).toBe('#ff00ff');
      expect(irm.isSegmentationSource).toBe(true);
      expect(sparse.isSegmentationSource).toBe(false);
    });

    it('passes a genuinely new channel through untouched', async () => {
      storedContainer();

      const res = await request(buildApp())
        .patch('/images/video-1/channels')
        .send({
          channels: [
            ...NARROW_BODY,
            { name: 'GFP', type: 'fluorescent', isSegmentationSource: false },
          ],
        });

      expect(res.status).toBe(200);
      expect(persisted()[2]).toEqual({
        name: 'GFP',
        type: 'fluorescent',
        isSegmentationSource: false,
      });
    });

    it('strips the forged keys off a channel the stored row has never heard of', async () => {
      // The assert direction has to hold for a name that is NOT in the stored
      // row too, or the hole is trivial to walk through: invent a channel (or
      // rename an existing one, which misses the lookup the same way), claim
      // `staticSource`, and `collapseStaticChannelFrames` will drop 298 frames
      // of real acquisition from the queue on that claim alone.
      storedContainer();

      const res = await request(buildApp())
        .patch('/images/video-1/channels')
        .send({
          channels: [
            ...NARROW_BODY,
            {
              name: 'IRM_2',
              type: 'irm',
              isSegmentationSource: false,
              staticSource: true,
              staticShifts: { f0: [0, 0] },
              sparseSource: true,
              sparseFill: { '1': 0 },
              frameIds: ['forged'],
              pngBacked: true,
              proxyRangeMax: 1,
            },
          ],
        });

      expect(res.status).toBe(200);
      expect(persisted()[2]).toEqual({
        name: 'IRM_2',
        type: 'irm',
        isSegmentationSource: false,
      });
    });
  });
});
