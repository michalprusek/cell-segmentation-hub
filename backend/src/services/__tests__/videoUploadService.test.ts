/**
 * Regression tests for videoUploadService.uploadVideoFromFile.
 *
 * Round-2 review (PR #142) flagged G1: the new cleanupOnFailure helper
 * has no test, so a future "simplify the rollback" PR could silently
 * leak 100 GB partial state. These tests pin down:
 *
 *  - Happy path: container row + N frame rows are created with the
 *    right paths; the tmp file is renamed (not copied) into place.
 *  - Failure path: extractor throws → container row is updated to
 *    `extraction_failed`, baseDir is recursively removed, and the
 *    multer tmp file is removed.
 *  - Secondary-failure path: if the "mark as failed" Prisma update
 *    ALSO throws, we log at error level but still propagate the
 *    original error (caller's error path must run).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- hoisted mocks -----------------------------------------------------

const {
  prismaImageCreate,
  prismaImageUpdate,
  prismaImageCreateMany,
  extractMock,
  fsStatMock,
  fsMkdirMock,
  fsRenameMock,
  fsRmMock,
  fsReaddirMock,
  sharpMock,
  loggerErrorMock,
} = vi.hoisted(() => ({
  prismaImageCreate: vi.fn(),
  prismaImageUpdate: vi.fn(),
  prismaImageCreateMany: vi.fn(),
  extractMock: vi.fn(),
  fsStatMock: vi.fn(),
  fsMkdirMock: vi.fn(),
  fsRenameMock: vi.fn(),
  fsRmMock: vi.fn(),
  fsReaddirMock: vi.fn(),
  sharpMock: vi.fn(),
  loggerErrorMock: vi.fn(),
}));

vi.mock('../../db/prismaClient', () => ({
  prisma: {
    image: {
      create: prismaImageCreate,
      update: prismaImageUpdate,
      createMany: prismaImageCreateMany,
    },
  },
}));

vi.mock('fs/promises', () => ({
  default: {
    stat: fsStatMock,
    mkdir: fsMkdirMock,
    rename: fsRenameMock,
    rm: fsRmMock,
    readdir: fsReaddirMock,
    copyFile: vi.fn(),
    cp: vi.fn(),
    unlink: vi.fn(),
  },
  stat: fsStatMock,
  mkdir: fsMkdirMock,
  rename: fsRenameMock,
  rm: fsRmMock,
  readdir: fsReaddirMock,
  copyFile: vi.fn(),
  cp: vi.fn(),
  unlink: vi.fn(),
}));

vi.mock('sharp', () => ({
  default: () => ({
    resize: () => ({
      jpeg: () => ({ toFile: sharpMock }),
    }),
  }),
}));

vi.mock('../video/videoExtractor', () => ({
  extractVideoSafe: extractMock,
}));

vi.mock('../../utils/config', () => ({
  config: { UPLOAD_DIR: '/tmp/test-uploads' },
}));

vi.mock('../../utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: loggerErrorMock,
  },
}));

// --- import SUT after mocks --------------------------------------------

import { uploadVideoFromFile } from '../videoUploadService';

// --- tests -------------------------------------------------------------

describe('videoUploadService.uploadVideoFromFile (round-2 GAP-1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fsStatMock.mockResolvedValue({ size: 1024 });
    fsMkdirMock.mockResolvedValue(undefined);
    fsRenameMock.mockResolvedValue(undefined);
    fsRmMock.mockResolvedValue(undefined);
    fsReaddirMock.mockResolvedValue(['irm.png']);
    sharpMock.mockResolvedValue(undefined);
    prismaImageCreate.mockResolvedValue({ id: 'container-1' });
    prismaImageUpdate.mockResolvedValue({});
    prismaImageCreateMany.mockResolvedValue({ count: 5 });
  });

  it('happy path: creates container row, renames tmp, creates frame rows', async () => {
    extractMock.mockResolvedValue({
      single: {
        frameCount: 5,
        durationMs: 5000,
        channels: [{ name: 'irm', type: 'irm', isSegmentationSource: true }],
        width: 128,
        height: 96,
      },
    });

    const result = await uploadVideoFromFile({
      projectId: 'proj-1',
      originalName: 'clip.mp4',
      mimeType: 'video/mp4',
      tempFilePath: '/tmp/multer/abc-clip.mp4',
    });

    expect(result.containerId).toBe('container-1');
    expect(result.frameCount).toBe(5);
    // Multer tmp file was renamed (not copied) — critical for disk
    // efficiency and atomic move.
    expect(fsRenameMock).toHaveBeenCalledOnce();
    expect(prismaImageCreate).toHaveBeenCalledOnce();
    expect(prismaImageCreateMany).toHaveBeenCalledOnce();
    const framesCall = prismaImageCreateMany.mock.calls[0]?.[0] as
      | { data: Array<{ parentVideoId: string; frameIndex: number }> }
      | undefined;
    expect(framesCall?.data).toHaveLength(5);
    expect(framesCall?.data?.[0]?.parentVideoId).toBe('container-1');
    // Container metadata is updated AFTER frames land.
    expect(prismaImageUpdate).toHaveBeenCalledOnce();
  });

  it('multi-position ND2: fans out into one container per XY position', async () => {
    // Position 0 reuses the pre-created row; positions 1..N get fresh rows.
    let nextId = 0;
    prismaImageCreate.mockImplementation(() =>
      Promise.resolve({ id: `container-${++nextId}` })
    );
    prismaImageCreateMany.mockResolvedValue({ count: 1 });

    const mkPos = (index: number, name: string | null) => ({
      positionIndex: index,
      positionName: name,
      stageXUm: index,
      stageYUm: -index,
      framesSubdir: `pos_${String(index).padStart(4, '0')}`,
      result: {
        frameCount: 1,
        durationMs: null,
        frameIntervalMs: null,
        pixelSizeUm: 0.072,
        channels: [
          { name: 'IRM', type: 'irm', isSegmentationSource: true },
          { name: 'TIRF_488', type: 'fluorescent', isSegmentationSource: false },
        ],
        width: 2048,
        height: 2048,
      },
    });
    extractMock.mockResolvedValue({
      positions: [
        mkPos(0, 'D03_0000'),
        mkPos(1, 'D03_0001'),
        mkPos(2, 'D03_0002'),
      ],
    });

    const result = await uploadVideoFromFile({
      projectId: 'proj-1',
      originalName: 'WellD03.nd2',
      mimeType: 'image/nd2',
      tempFilePath: '/tmp/multer/well.nd2',
    });

    // 3 positions → 3 containers (1 pre-created + 2 extra creates).
    expect(result.positionCount).toBe(3);
    expect(result.containerIds).toHaveLength(3);
    expect(result.containerId).toBe('container-1');
    expect(prismaImageCreate).toHaveBeenCalledTimes(3);
    // Each position writes its own frame rows + container metadata update.
    expect(prismaImageCreateMany).toHaveBeenCalledTimes(3);
    // Position container names carry the metadata label.
    const updateNames = prismaImageUpdate.mock.calls
      .map(c => (c[0] as { data?: { name?: string } })?.data?.name)
      .filter(Boolean);
    expect(updateNames).toContain('WellD03.nd2 — D03_0000');
    expect(updateNames).toContain('WellD03.nd2 — D03_0002');
    // Frames are relocated per position: 1 original move + 3 frame moves.
    expect(fsRenameMock).toHaveBeenCalledTimes(4);
  });

  it('rollback: when extractor throws, container is marked failed AND baseDir is removed', async () => {
    extractMock.mockRejectedValue(new Error('ffmpeg crashed'));

    await expect(
      uploadVideoFromFile({
        projectId: 'proj-1',
        originalName: 'broken.mp4',
        mimeType: 'video/mp4',
        tempFilePath: '/tmp/multer/zzz-broken.mp4',
      })
    ).rejects.toThrow(/ffmpeg crashed/);

    // 1) Container marked as extraction_failed
    expect(prismaImageUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'container-1' },
        data: { segmentationStatus: 'extraction_failed' },
      })
    );
    // 2) baseDir AND tmp file removed
    const rmTargets = fsRmMock.mock.calls.map(c => c[0]) as string[];
    expect(rmTargets.some(p => p.includes('container-1'))).toBe(true);
    expect(rmTargets.some(p => p === '/tmp/multer/zzz-broken.mp4')).toBe(true);
  });

  it('secondary-failure: rethrows original error even when status update also fails', async () => {
    extractMock.mockRejectedValue(new Error('ffmpeg crashed'));
    // Second prisma.image.update (the "mark as failed" one) fails too.
    prismaImageUpdate.mockRejectedValue(new Error('db gone'));

    await expect(
      uploadVideoFromFile({
        projectId: 'proj-1',
        originalName: 'broken.mp4',
        mimeType: 'video/mp4',
        tempFilePath: '/tmp/multer/zzz-broken.mp4',
      })
    ).rejects.toThrow(/ffmpeg crashed/); // ORIGINAL error, not db gone

    // Logger.error called twice: once for the primary failure, once for
    // the secondary mark-as-failed failure.
    expect(loggerErrorMock).toHaveBeenCalled();
    const errorMessages = loggerErrorMock.mock.calls.map(c => c[0] as string);
    expect(errorMessages.some(m => m.includes('Video upload failed'))).toBe(
      true
    );
    expect(
      errorMessages.some(m => m.includes('mark container as extraction_failed'))
    ).toBe(true);
  });
});
