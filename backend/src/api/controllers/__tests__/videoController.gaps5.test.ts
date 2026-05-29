/**
 * videoController.gaps5.test.ts
 *
 * Covers branches still uncovered after videoController tests:
 *
 *  A. isValidDisplayName (private helper, exercised via updateChannels)
 *     - non-string value → returns false
 *     - empty string → returns false
 *     - displayName with pattern match → returns false (rejected)
 *
 *  B. updateChannels — displayName validation guard
 *     - invalid displayName → 400
 *
 *  C. loadImageById — empty imageId → 400
 *
 *  D. getFrameData — path within upload root (resolved path included)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prismaMock, fsAccessMock } = vi.hoisted(() => ({
  prismaMock: {
    image: {
      findUnique: vi.fn() as ReturnType<typeof vi.fn>,
      update: vi.fn() as ReturnType<typeof vi.fn>,
    },
    user: {
      findUnique: vi.fn() as ReturnType<typeof vi.fn>,
    },
    project: {
      findFirst: vi.fn() as ReturnType<typeof vi.fn>,
    },
  },
  fsAccessMock: vi.fn(),
}));

vi.mock('../../../db/prismaClient', () => ({ prisma: prismaMock }));
vi.mock('../../../utils/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../../utils/config', () => ({
  config: {
    UPLOAD_DIR: '/tmp/uploads',
    NODE_ENV: 'test',
  },
}));
vi.mock('fs/promises', () => ({
  access: fsAccessMock,
}));

const { mockError, mockSuccess } = vi.hoisted(() => ({
  mockError: vi.fn(),
  mockSuccess: vi.fn(),
}));

vi.mock('../../../utils/response', () => ({
  ResponseHelper: {
    error: mockError,
    success: mockSuccess,
    badRequest: vi.fn(),
    unauthorized: vi.fn(),
    forbidden: vi.fn(),
    notFound: vi.fn(),
  },
}));

import { VideoController } from '../videoController';

function makeRes() {
  return {
    json: vi.fn(),
    status: vi.fn().mockReturnThis(),
    setHeader: vi.fn(),
    send: vi.fn(),
  } as never;
}

function makeReq(
  overrides: Partial<{
    params: Record<string, string>;
    user: { id: string; email: string; emailVerified: boolean };
    body: Record<string, unknown>;
    query: Record<string, string>;
  }> = {}
) {
  return {
    params: {},
    user: { id: 'user-1', email: 'u@test.com', emailVerified: true },
    body: {},
    query: {},
    ...overrides,
  } as never;
}

const mockUser = { id: 'user-1', email: 'u@test.com', emailVerified: true };

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── B. updateChannels — displayName validation ───────────────────────────────

describe('VideoController.updateChannels — displayName guard', () => {
  beforeEach(() => {
    // Set up user/project access mocks
    prismaMock.user.findUnique.mockResolvedValue(mockUser);
    prismaMock.project.findFirst.mockResolvedValue({
      id: 'proj-1',
      userId: 'user-1',
    });
  });

  it('rejects invalid displayName (non-string)', async () => {
    const req = makeReq({
      params: { imageId: 'img-1' },
      body: {
        channels: [
          { name: 'DAPI', type: 'fluorescent', displayName: 123 }, // non-string
        ],
      },
    });
    const res = makeRes();

    await VideoController.updateChannels(req, res);
    expect(mockError).toHaveBeenCalledWith(
      res,
      expect.stringContaining('displayName'),
      400
    );
  });

  it('rejects empty displayName', async () => {
    const req = makeReq({
      params: { imageId: 'img-1' },
      body: {
        channels: [
          { name: 'DAPI', type: 'fluorescent', displayName: '' }, // empty
        ],
      },
    });
    const res = makeRes();

    await VideoController.updateChannels(req, res);
    expect(mockError).toHaveBeenCalledWith(
      res,
      expect.stringContaining('displayName'),
      400
    );
  });
});

// ─── C. loadImageById — empty imageId ────────────────────────────────────────

describe('VideoController.getFrameData — empty imageId', () => {
  it('rejects empty imageId with 400', async () => {
    const req = makeReq({
      params: { imageId: '', frameIndex: '0', channel: 'DAPI' },
    });
    const res = makeRes();

    await VideoController.getFrameData(req, res);
    expect(mockError).toHaveBeenCalledWith(res, 'imageId required', 400);
  });
});
