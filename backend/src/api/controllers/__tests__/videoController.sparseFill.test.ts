/**
 * `getFrameData` serves a sparse channel's gap frames from the frame they read
 * from — the read-side half of the forward fill.
 *
 * This is the wiring test, and it is the one that matters: `plane_coverage.py`
 * can classify perfectly and `planSparseCollapse` can plan perfectly, and the
 * user still sees a black frame if this route builds the path from the frame's
 * own index. Production evidence for the shape being tested (2026-08-28,
 * read-only scan): `20260526_Well7_002_DIV4_WT_x2512-100x.tif`, 29 frames,
 * `Channel_1` real on frame 0 and exactly zero on frames 1-28.
 *
 * The assertions are on the path handed to `fs.access`, which is the last thing
 * that happens before the file is read. `fs.access` is made to reject so the
 * handler bails there instead of dragging in the proxy/sendFile machinery — the
 * path it resolved is already the whole claim.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prismaMock, fsAccessMock } = vi.hoisted(() => ({
  prismaMock: {
    image: {
      findUnique: vi.fn() as ReturnType<typeof vi.fn>,
      update: vi.fn() as ReturnType<typeof vi.fn>,
    },
    user: { findUnique: vi.fn() as ReturnType<typeof vi.fn> },
    project: { findFirst: vi.fn() as ReturnType<typeof vi.fn> },
  },
  fsAccessMock: vi.fn(),
}));

vi.mock('../../../db/prismaClient', () => ({ prisma: prismaMock }));
vi.mock('../../../utils/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../../utils/config', () => ({
  config: { UPLOAD_DIR: '/tmp/uploads', NODE_ENV: 'test' },
}));
vi.mock('fs/promises', () => ({ access: fsAccessMock }));

const { mockError } = vi.hoisted(() => ({ mockError: vi.fn() }));
vi.mock('../../../utils/response', () => ({
  ResponseHelper: {
    error: mockError,
    success: vi.fn(),
    badRequest: vi.fn(),
    unauthorized: vi.fn(),
    forbidden: vi.fn(),
    notFound: vi.fn(),
  },
}));

import { VideoController } from '../videoController';

const CONTAINER = 'container-1';
const PROJECT = 'proj-1';

/** Real Well7 shape: `Channel_1` acquired once, everything else a gap. */
const SPARSE_CHANNELS = [
  {
    name: 'Channel_1',
    type: 'irm',
    isSegmentationSource: true,
    sparseSource: true,
    sparseFill: { '1': 0, '2': 0, '4': 3, '5': 3 },
  },
  { name: 'Channel_3', type: 'fluorescent', isSegmentationSource: false },
];

function makeRes() {
  return {
    json: vi.fn(),
    status: vi.fn().mockReturnThis(),
    setHeader: vi.fn(),
    send: vi.fn(),
  } as never;
}

function makeReq(frameId: string, channel: string) {
  return {
    params: { imageId: frameId },
    query: { channel },
    user: { id: 'user-1', email: 'u@test.com', emailVerified: true },
    body: {},
  } as never;
}

/** `loadImageById` first, then the container's channels. */
function primePrisma(frameIndex: number, channels: unknown = SPARSE_CHANNELS) {
  prismaMock.image.findUnique
    .mockResolvedValueOnce({
      id: `frame-${frameIndex}`,
      projectId: PROJECT,
      originalPath: `projects/${PROJECT}/images/${CONTAINER}/frames/000${frameIndex}/Channel_1.png`,
      isVideoContainer: false,
      parentVideoId: CONTAINER,
      frameIndex,
      channels: null,
      name: `video (frame ${frameIndex + 1})`,
      width: 64,
      height: 64,
      frameCount: null,
      videoDurationMs: null,
    })
    .mockResolvedValueOnce({ channels });
}

const framesRoot = `/tmp/uploads/projects/${PROJECT}/images/${CONTAINER}/frames`;

beforeEach(() => {
  vi.clearAllMocks();
  // Bail right after the path is built; the resolved path is the assertion.
  fsAccessMock.mockRejectedValue(new Error('ENOENT'));
});

describe('getFrameData — sparse channel forward fill', () => {
  it('serves a gap frame from the frame it reads from', async () => {
    primePrisma(2);
    const res = makeRes();

    await VideoController.getFrameData(makeReq('frame-2', 'Channel_1'), res);

    expect(fsAccessMock).toHaveBeenCalledWith(`${framesRoot}/0000/Channel_1.png`);
  });

  it('uses the run’s OWN anchor, not the first one', async () => {
    // The piecewise part. Frame 4 reads from frame 3, not from frame 0 — a
    // whole-container anchor would show the user a picture from four
    // timepoints earlier and look entirely plausible doing it.
    primePrisma(4);
    const res = makeRes();

    await VideoController.getFrameData(makeReq('frame-4', 'Channel_1'), res);

    expect(fsAccessMock).toHaveBeenCalledWith(`${framesRoot}/0003/Channel_1.png`);
  });

  it('announces the redirect in a header so it is visible to curl', async () => {
    primePrisma(2);
    const res = makeRes();

    await VideoController.getFrameData(makeReq('frame-2', 'Channel_1'), res);

    expect(res.setHeader).toHaveBeenCalledWith('X-Sparse-Fill-From', '0');
  });

  it('leaves a REAL frame of the same channel alone', async () => {
    primePrisma(3);
    const res = makeRes();

    await VideoController.getFrameData(makeReq('frame-3', 'Channel_1'), res);

    expect(fsAccessMock).toHaveBeenCalledWith(`${framesRoot}/0003/Channel_1.png`);
    expect(res.setHeader).not.toHaveBeenCalledWith(
      'X-Sparse-Fill-From',
      expect.anything()
    );
  });

  it('leaves a DENSE channel of the same container alone', async () => {
    primePrisma(2);
    const res = makeRes();

    await VideoController.getFrameData(makeReq('frame-2', 'Channel_3'), res);

    expect(fsAccessMock).toHaveBeenCalledWith(`${framesRoot}/0002/Channel_3.png`);
  });

  it('ignores the fill map on a channel not flagged sparse', async () => {
    // Half a record is not a record. Acting on the map alone would move pixels
    // around on a container nothing measured.
    primePrisma(2, [
      { ...SPARSE_CHANNELS[0], sparseSource: false },
      SPARSE_CHANNELS[1],
    ]);
    const res = makeRes();

    await VideoController.getFrameData(makeReq('frame-2', 'Channel_1'), res);

    expect(fsAccessMock).toHaveBeenCalledWith(`${framesRoot}/0002/Channel_1.png`);
  });

  it('ignores a non-integer or negative anchor rather than building a path from it', async () => {
    primePrisma(2, [
      {
        ...SPARSE_CHANNELS[0],
        sparseFill: { '1': -1, '2': 1.5 } as unknown as Record<string, number>,
      },
      SPARSE_CHANNELS[1],
    ]);
    const res = makeRes();

    await VideoController.getFrameData(makeReq('frame-2', 'Channel_1'), res);

    expect(fsAccessMock).toHaveBeenCalledWith(`${framesRoot}/0002/Channel_1.png`);
  });

  it('serves an ordinary dense container exactly as before', async () => {
    // The regression guard for every video that already exists.
    primePrisma(2, [
      { name: 'Channel_1', type: 'irm', isSegmentationSource: true },
    ]);
    const res = makeRes();

    await VideoController.getFrameData(makeReq('frame-2', 'Channel_1'), res);

    expect(fsAccessMock).toHaveBeenCalledWith(`${framesRoot}/0002/Channel_1.png`);
    expect(mockError).toHaveBeenCalledWith(
      res,
      expect.stringContaining('Frame data not found'),
      404
    );
  });
});
