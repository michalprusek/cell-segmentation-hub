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
  prismaImageDeleteMany,
  prismaImageFindMany,
  prismaProjectFindUnique,
  extractMock,
  fsStatMock,
  fsMkdirMock,
  fsRenameMock,
  fsRmMock,
  fsRmdirMock,
  fsReaddirMock,
  fsAccessMock,
  correctDriftMock,
  sharpMock,
  loggerErrorMock,
} = vi.hoisted(() => ({
  prismaImageCreate: vi.fn(),
  prismaImageUpdate: vi.fn(),
  prismaImageCreateMany: vi.fn(),
  prismaImageDeleteMany: vi.fn(),
  prismaImageFindMany: vi.fn(),
  extractMock: vi.fn(),
  prismaProjectFindUnique: vi.fn(),
  fsStatMock: vi.fn(),
  fsMkdirMock: vi.fn(),
  fsRenameMock: vi.fn(),
  fsRmMock: vi.fn(),
  fsRmdirMock: vi.fn(),
  fsReaddirMock: vi.fn(),
  fsAccessMock: vi.fn(),
  correctDriftMock: vi.fn(),
  sharpMock: vi.fn(),
  loggerErrorMock: vi.fn(),
}));

vi.mock('../../db/prismaClient', () => ({
  prisma: {
    image: {
      create: prismaImageCreate,
      update: prismaImageUpdate,
      createMany: prismaImageCreateMany,
      deleteMany: prismaImageDeleteMany,
      findMany: prismaImageFindMany,
    },
    project: { findUnique: prismaProjectFindUnique },
  },
}));

vi.mock('fs/promises', () => ({
  default: {
    stat: fsStatMock,
    mkdir: fsMkdirMock,
    rename: fsRenameMock,
    rm: fsRmMock,
    rmdir: fsRmdirMock,
    readdir: fsReaddirMock,
    access: fsAccessMock,
    copyFile: vi.fn(),
    cp: vi.fn(),
    unlink: vi.fn(),
  },
  stat: fsStatMock,
  mkdir: fsMkdirMock,
  rename: fsRenameMock,
  rm: fsRmMock,
  rmdir: fsRmdirMock,
  readdir: fsReaddirMock,
  access: fsAccessMock,
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

vi.mock('../video/pythonExtractor', () => ({
  correctDriftInContainer: correctDriftMock,
  EXIT_DRIFT_REWRITE_FAILED: 4,
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

/** What `fs.readdir(stagingDir, { withFileTypes: true })` finds per position.
 *  The relocation loop moves whatever is here, so a test adds an artifact by
 *  adding it to this list rather than by teaching the service about it. */
let stagingEntries: { name: string; dir: boolean }[] = [];

function installReaddir(): void {
  stagingEntries = [
    { name: 'frames', dir: true },
    { name: 'original.tif', dir: false },
  ];
  fsReaddirMock.mockImplementation(
    (_p: unknown, opts?: { withFileTypes?: boolean }) =>
      Promise.resolve(
        opts?.withFileTypes
          ? stagingEntries.map(e => ({
              name: e.name,
              isDirectory: () => e.dir,
            }))
          : ['irm.png']
      )
  );
}

describe('videoUploadService.uploadVideoFromFile (round-2 GAP-1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fsStatMock.mockResolvedValue({ size: 1024 });
    fsMkdirMock.mockResolvedValue(undefined);
    fsRenameMock.mockResolvedValue(undefined);
    fsRmMock.mockResolvedValue(undefined);
    installReaddir();
    // The gate `uploadVideoFromFile` now applies itself. Most tests here run a
    // microtubule project; the ones that care about the other side say so.
    prismaProjectFindUnique.mockResolvedValue({ type: 'microtubules' });
    // No per-position registration.json unless a test says otherwise.
    fsAccessMock.mockRejectedValue(new Error('ENOENT'));
    correctDriftMock.mockResolvedValue({ corrected: false });
    sharpMock.mockResolvedValue(undefined);
    prismaImageCreate.mockResolvedValue({ id: 'container-1' });
    prismaImageUpdate.mockResolvedValue({});
    prismaImageCreateMany.mockResolvedValue({ count: 5 });
    prismaImageDeleteMany.mockResolvedValue({ count: 0 });
    prismaImageFindMany.mockResolvedValue([]);
  });

  it('happy path: creates container row, renames tmp, creates frame rows', async () => {
    extractMock.mockResolvedValue({
      kind: 'single',
      result: {
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

  it('rejects an unsafe channel name from the extractor instead of persisting an unreadable row (GAP-Curie)', async () => {
    // Regression for the 2026-08-26 Institut Curie incident: a Fiji/
    // Bio-Formats TIFF export embedded a ~140-char source filename into
    // every channel's per-slice label. The Python extractor's
    // `_sanitize_name` never truncated, so this long name reached
    // `finalizeContainer` unchanged. Before the ingest-time guard, it was
    // written straight into `Image.channels`, past `assertSafeStorageSegment`
    // (which has no length/charset cap) — producing a row the read-side
    // `isSafeChannelName` whitelist (64-char cap) could never serve back.
    const longName = 'c'.repeat(140);
    extractMock.mockResolvedValue({
      kind: 'single',
      result: {
        frameCount: 3,
        durationMs: 300,
        channels: [
          { name: longName, type: 'irm', isSegmentationSource: true },
        ],
        width: 64,
        height: 64,
      },
    });

    await expect(
      uploadVideoFromFile({
        projectId: 'proj-1',
        originalName: 'curie_export.tif',
        mimeType: 'image/tiff',
        tempFilePath: '/tmp/multer/curie.tif',
      })
    ).rejects.toThrow(/invalid channel name/i);

    // Never reached the thumbnail/frame-row/channels-persist steps.
    expect(sharpMock).not.toHaveBeenCalled();
    expect(prismaImageCreateMany).not.toHaveBeenCalled();
    // Rolled back like any other extraction failure.
    expect(prismaImageUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'container-1' },
        data: { segmentationStatus: 'extraction_failed' },
      })
    );
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
      originalFile: 'original.tif',
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
      kind: 'multi',
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
    // Moves: 1 source temp→original, then per position a frames-dir move +
    // a per-position TIFF move = 1 + 3*2 = 7. No registration.json here —
    // `fsAccessMock` rejects, modelling an upload that did not opt into
    // channel registration.
    expect(fsRenameMock).toHaveBeenCalledTimes(7);
    expect(
      fsRenameMock.mock.calls.filter(c =>
        String(c[0]).endsWith('registration.json')
      )
    ).toHaveLength(0);
    // Each container owns its OWN single-position TIFF original (self-
    // contained — no shared/dangling original across positions).
    const originalPaths = prismaImageUpdate.mock.calls
      .map(c => (c[0] as { data?: { originalPath?: string } })?.data?.originalPath)
      .filter(Boolean)
      .sort();
    expect(originalPaths).toEqual([
      'projects/proj-1/images/container-1/original.tif',
      'projects/proj-1/images/container-2/original.tif',
      'projects/proj-1/images/container-3/original.tif',
    ]);
    // The multi-position source ND2 is deleted after the split.
    const rmTargets = fsRmMock.mock.calls.map(c => String(c[0]));
    expect(rmTargets.some(p => p.endsWith('original.nd2'))).toBe(true);
  });

  it("relocates each position's registration.json instead of deleting it", async () => {
    // The sidecar is written per position into the staging dir, and only
    // `frames` and the TIFF were moved out before that dir was removed — so it
    // was deleted, and `mtMetricsExporter` then sampled the raw original
    // UNREGISTERED, silently and permanently. Pre-existing bug, found while
    // moving drift correction out of the extractor.
    let nextId = 0;
    prismaImageCreate.mockImplementation(() =>
      Promise.resolve({ id: `c-${++nextId}` })
    );
    prismaImageCreateMany.mockResolvedValue({ count: 1 });
    // The extractor wrote a sidecar into the staging dir. Stated as "it is on
    // disk" rather than as "fs.access resolves": the relocation moves whatever
    // it finds, so this is what the condition actually is now.
    stagingEntries.push({ name: 'registration.json', dir: false });
    extractMock.mockResolvedValue({
      kind: 'multi',
      positions: [0, 1, 2].map(index => ({
        positionIndex: index,
        positionName: `D03_000${index}`,
        stageXUm: index,
        stageYUm: -index,
        framesSubdir: `pos_${String(index).padStart(4, '0')}`,
        originalFile: 'original.tif',
        result: {
          frameCount: 1,
          durationMs: null,
          frameIntervalMs: null,
          pixelSizeUm: 0.072,
          channels: [
            { name: 'IRM', type: 'irm', isSegmentationSource: true },
          ],
          width: 512,
          height: 512,
        },
      })),
    });

    await uploadVideoFromFile({
      projectId: 'proj-1',
      originalName: 'WellD03.nd2',
      mimeType: 'image/nd2',
      tempFilePath: '/tmp/multer/well.nd2',
    });

    const sidecars = fsRenameMock.mock.calls
      .map(c => String(c[0]))
      .filter(src => src.endsWith('registration.json'));
    expect(sidecars).toHaveLength(3);
    for (const src of sidecars) {
      expect(src).toMatch(/pos_\d{4}\/registration\.json$/);
    }
  });

  it('moves an artifact nobody taught it about, and empties the staging dir', async () => {
    // The generalisation the sidecar bug asked for. Naming `registration.json`
    // as a third special case rescues that one file and leaves the trap set for
    // whatever an extractor learns to write next; moving EVERYTHING closes it.
    // `drift.json` stands in for that next artifact here.
    let nextId = 0;
    prismaImageCreate.mockImplementation(() =>
      Promise.resolve({ id: `c-${++nextId}` })
    );
    prismaImageCreateMany.mockResolvedValue({ count: 1 });
    stagingEntries.push({ name: 'drift.json', dir: false });
    extractMock.mockResolvedValue({
      kind: 'multi',
      positions: [
        {
          positionIndex: 0,
          positionName: 'D03_0000',
          stageXUm: 0,
          stageYUm: 0,
          framesSubdir: 'pos_0000',
          originalFile: 'original.tif',
          result: {
            frameCount: 1,
            durationMs: null,
            frameIntervalMs: null,
            pixelSizeUm: 0.072,
            channels: [{ name: 'IRM', type: 'irm', isSegmentationSource: true }],
            width: 512,
            height: 512,
          },
        },
      ],
    });

    await uploadVideoFromFile({
      projectId: 'proj-1',
      originalName: 'WellD03.nd2',
      mimeType: 'image/nd2',
      tempFilePath: '/tmp/multer/well.nd2',
    });

    const moved = fsRenameMock.mock.calls.map(c => String(c[0]));
    expect(moved.some(src => src.endsWith('pos_0000/drift.json'))).toBe(true);

    // And the staging dir is removed NON-recursively: an empty directory is the
    // proof nothing was left behind. A recursive rm would delete a missed
    // artifact exactly as quietly as before.
    expect(fsRmdirMock).toHaveBeenCalledWith(
      expect.stringContaining('pos_0000')
    );
    const recursiveStagingRm = fsRmMock.mock.calls.filter(
      c =>
        String(c[0]).includes('pos_0000') &&
        (c[1] as { recursive?: boolean } | undefined)?.recursive
    );
    expect(recursiveStagingRm).toHaveLength(0);
  });

  it('refuses to relocate over an existing file instead of clobbering it', async () => {
    // For position 0 the destination IS baseDir, which already holds the source
    // original. `fs.rename` overwrites silently, so a future extractor writing
    // e.g. `original.nd2` per position would destroy the container's own copy
    // with no error — and moving EVERYTHING is exactly what makes that reachable.
    let nextId = 0;
    prismaImageCreate.mockImplementation(() =>
      Promise.resolve({ id: `c-${++nextId}` })
    );
    prismaImageCreateMany.mockResolvedValue({ count: 1 });
    stagingEntries.push({ name: 'original.nd2', dir: false });
    fsAccessMock.mockResolvedValue(undefined); // the destination already exists
    extractMock.mockResolvedValue({
      kind: 'multi',
      positions: [
        {
          positionIndex: 0,
          positionName: 'D03_0000',
          stageXUm: 0,
          stageYUm: 0,
          framesSubdir: 'pos_0000',
          originalFile: 'original.tif',
          result: {
            frameCount: 1,
            durationMs: null,
            frameIntervalMs: null,
            pixelSizeUm: 0.072,
            channels: [{ name: 'IRM', type: 'irm', isSegmentationSource: true }],
            width: 512,
            height: 512,
          },
        },
      ],
    });

    await expect(
      uploadVideoFromFile({
        projectId: 'proj-1',
        originalName: 'WellD03.nd2',
        mimeType: 'image/nd2',
        tempFilePath: '/tmp/multer/well.nd2',
      })
    ).rejects.toThrow(/already exists/);
  });

  it('drives drift correction with the SEGMENTATION SOURCE, not channel 0', async () => {
    // The single most important property of this path. Stage drift must be
    // measured on the label-free channel the polylines and intensities live
    // on. On a motility assay a fluorescence channel does not measure the
    // stage — every filament is moving — so correlating it measures gliding
    // and subtracting it would cancel the signal the experiment records.
    // Across 65 production microtubule containers channel 0 is the source on
    // only 45; on the other 20 the two trajectories differ by up to 28 px.
    prismaImageCreate.mockResolvedValue({ id: 'container-1' });
    prismaImageCreateMany.mockResolvedValue({ count: 1 });
    extractMock.mockResolvedValue({
      kind: 'single',
      result: {
        frameCount: 3,
        durationMs: null,
        frameIntervalMs: null,
        pixelSizeUm: 0.072,
        channels: [
          { name: 'TIRF_488', type: 'fluorescent', isSegmentationSource: false },
          { name: 'IRM', type: 'irm', isSegmentationSource: true },
        ],
        width: 512,
        height: 512,
      },
    });

    await uploadVideoFromFile({
      projectId: 'proj-1',
      originalName: 'well.nd2',
      mimeType: 'image/nd2',
      tempFilePath: '/tmp/multer/well.nd2',
    });

    expect(correctDriftMock).toHaveBeenCalledTimes(1);
    const [, channelNames, source] = correctDriftMock.mock.calls[0];
    expect(source).toBe('IRM');
    expect(channelNames).toEqual(['TIRF_488', 'IRM']);
  });

  it('ROLLS BACK when drift correction fails after rewriting frames', async () => {
    // The helper deliberately makes the pixel rewrite fatal ("a half-corrected
    // stack is worse than an uncorrected one"). Swallowing that here cancelled
    // the intent: verified by injecting ENOSPC at the 21st save of a 40-frame
    // stack — 10 frames de-drifted, 30 untouched, no composed sidecar, and the
    // upload still returned 200. Frames either side of that seam are in
    // different coordinate spaces and every cross-frame consumer measures
    // across it silently.
    prismaImageCreate.mockResolvedValue({ id: 'container-1' });
    prismaImageCreateMany.mockResolvedValue({ count: 1 });
    extractMock.mockResolvedValue({
      kind: 'single',
      result: {
        frameCount: 3,
        durationMs: null,
        frameIntervalMs: null,
        pixelSizeUm: 0.072,
        channels: [{ name: 'IRM', type: 'irm', isSegmentationSource: true }],
        width: 512,
        height: 512,
      },
    });
    const halfWritten = Object.assign(
      new Error('python helper correct_drift.py exited 4: REWRITE FAILED'),
      { exitCode: 4 }
    );
    correctDriftMock.mockRejectedValue(halfWritten);

    await expect(
      uploadVideoFromFile({
        projectId: 'proj-1',
        originalName: 'well.nd2',
        mimeType: 'image/nd2',
        tempFilePath: '/tmp/multer/well.nd2',
      })
    ).rejects.toThrow(/exited 4/);

    // Rolled back, not finalized: the container must not survive as a
    // seam-corrupted artifact the gallery presents as normal.
    expect(prismaImageUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          segmentationStatus: 'extraction_failed',
        }),
      })
    );
  });

  it('completes the upload when drift correction declines without touching frames', async () => {
    // The other half of the same rule: a decline, or a helper that fails BEFORE
    // rewriting, is an optional improvement not taken. Losing an hour of ND2
    // extraction to it would be the wrong trade.
    prismaImageCreate.mockResolvedValue({ id: 'container-1' });
    prismaImageCreateMany.mockResolvedValue({ count: 1 });
    extractMock.mockResolvedValue({
      kind: 'single',
      result: {
        frameCount: 3,
        durationMs: null,
        frameIntervalMs: null,
        pixelSizeUm: 0.072,
        channels: [{ name: 'IRM', type: 'irm', isSegmentationSource: true }],
        width: 512,
        height: 512,
      },
    });
    correctDriftMock.mockRejectedValue(
      Object.assign(new Error('python helper correct_drift.py exited 2: bad args'), {
        exitCode: 2,
      })
    );

    await expect(
      uploadVideoFromFile({
        projectId: 'proj-1',
        originalName: 'well.nd2',
        mimeType: 'image/nd2',
        tempFilePath: '/tmp/multer/well.nd2',
      })
    ).resolves.toBeTruthy();
  });

  it('does not correct drift on a non-microtubule project', async () => {
    // The gate is the service's, not the caller's: no argument can turn drift
    // correction on for a project type whose frames are not measured against
    // each other.
    prismaProjectFindUnique.mockResolvedValue({ type: 'spheroid' });
    prismaImageCreate.mockResolvedValue({ id: 'container-1' });
    prismaImageCreateMany.mockResolvedValue({ count: 1 });
    extractMock.mockResolvedValue({
      kind: 'single',
      result: {
        frameCount: 3,
        durationMs: null,
        frameIntervalMs: null,
        pixelSizeUm: 0.072,
        channels: [{ name: 'IRM', type: 'irm', isSegmentationSource: true }],
        width: 512,
        height: 512,
      },
    });

    await uploadVideoFromFile({
      projectId: 'proj-1',
      originalName: 'well.nd2',
      mimeType: 'image/nd2',
      tempFilePath: '/tmp/multer/well.nd2',
    });

    expect(correctDriftMock).not.toHaveBeenCalled();
  });

  it('refuses channel registration on a non-microtubule project, even when asked', async () => {
    // Migrated from the controller when the gate moved. A stray
    // `registerChannels=true` from any other project type must be ignored, and
    // that has to hold for every caller, not just the HTTP handler.
    prismaProjectFindUnique.mockResolvedValue({ type: 'spheroid' });
    prismaImageCreate.mockResolvedValue({ id: 'container-1' });
    prismaImageCreateMany.mockResolvedValue({ count: 1 });
    extractMock.mockResolvedValue({
      kind: 'single',
      result: {
        frameCount: 3,
        durationMs: null,
        frameIntervalMs: null,
        pixelSizeUm: 0.072,
        channels: [{ name: 'IRM', type: 'irm', isSegmentationSource: true }],
        width: 512,
        height: 512,
      },
    });

    await uploadVideoFromFile({
      projectId: 'proj-1',
      originalName: 'well.nd2',
      mimeType: 'image/nd2',
      tempFilePath: '/tmp/multer/well.nd2',
      registerChannels: true,
    });

    expect(extractMock).toHaveBeenCalled();
    // `registerChannels` rides in the options object, 3rd arg.
    expect(extractMock.mock.calls[0][2]).toMatchObject({
      registerChannels: false,
    });
    expect(correctDriftMock).not.toHaveBeenCalled();
  });

  it('honours channel registration on a microtubule project', async () => {
    prismaImageCreate.mockResolvedValue({ id: 'container-1' });
    prismaImageCreateMany.mockResolvedValue({ count: 1 });
    extractMock.mockResolvedValue({
      kind: 'single',
      result: {
        frameCount: 3,
        durationMs: null,
        frameIntervalMs: null,
        pixelSizeUm: 0.072,
        channels: [{ name: 'IRM', type: 'irm', isSegmentationSource: true }],
        width: 512,
        height: 512,
      },
    });

    await uploadVideoFromFile({
      projectId: 'proj-1',
      originalName: 'well.nd2',
      mimeType: 'image/nd2',
      tempFilePath: '/tmp/multer/well.nd2',
      registerChannels: true,
    });

    expect(extractMock.mock.calls[0][2]).toMatchObject({
      registerChannels: true,
    });
  });

  it('multi-position partial failure: rolls back ALL created containers (no orphan frame rows)', async () => {
    let nextId = 0;
    prismaImageCreate.mockImplementation(() =>
      Promise.resolve({ id: `container-${++nextId}` })
    );
    prismaImageCreateMany.mockResolvedValue({ count: 1 });

    const mkPos = (index: number) => ({
      positionIndex: index,
      positionName: `P${index}`,
      stageXUm: null,
      stageYUm: null,
      framesSubdir: `pos_${String(index).padStart(4, '0')}`,
      originalFile: 'original.tif',
      result: {
        frameCount: 1,
        durationMs: null,
        frameIntervalMs: null,
        pixelSizeUm: null,
        channels: [{ name: 'IRM', type: 'irm', isSegmentationSource: true }],
        width: 64,
        height: 64,
      },
    });
    extractMock.mockResolvedValue({
      kind: 'multi',
      positions: [mkPos(0), mkPos(1), mkPos(2)],
    });
    // Fail finalize on the 3rd position's thumbnail, AFTER positions 0-1
    // committed frame rows + container updates.
    let sharpCalls = 0;
    sharpMock.mockImplementation(() =>
      ++sharpCalls >= 3
        ? Promise.reject(new Error('thumb boom'))
        : Promise.resolve(undefined)
    );

    // generateContainerThumbnail wraps the sharp rejection; that wrapper
    // error is what propagates and triggers the rollback.
    await expect(
      uploadVideoFromFile({
        projectId: 'proj-1',
        originalName: 'Well.nd2',
        mimeType: 'image/nd2',
        tempFilePath: '/tmp/multer/well.nd2',
      })
    ).rejects.toThrow(/Failed to generate thumbnail/);

    // Child frame rows for ALL created containers are deleted (not left
    // pointing at rm'd files).
    const deleteManyCalls = prismaImageDeleteMany.mock.calls.map(c => c[0]);
    expect(
      deleteManyCalls.some(
        c =>
          c?.where?.parentVideoId?.in &&
          ['container-1', 'container-2', 'container-3'].every(id =>
            c.where.parentVideoId.in.includes(id)
          )
      )
    ).toBe(true);
    // Extra-position container rows (2,3) deleted; primary (1) kept + marked.
    expect(
      deleteManyCalls.some(
        c =>
          Array.isArray(c?.where?.id?.in) &&
          c.where.id.in.includes('container-2') &&
          c.where.id.in.includes('container-3') &&
          !c.where.id.in.includes('container-1')
      )
    ).toBe(true);
    expect(prismaImageUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'container-1' },
        data: { segmentationStatus: 'extraction_failed' },
      })
    );
    // All three dirs cleaned.
    const rmTargets = fsRmMock.mock.calls.map(c => String(c[0]));
    ['container-1', 'container-2', 'container-3'].forEach(id =>
      expect(rmTargets.some(p => p.includes(id))).toBe(true)
    );
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
      errorMessages.some(m => m.includes('roll back containers'))
    ).toBe(true);
  });
});

describe('videoUploadService — sparse channels', () => {
  /** The extractor can only report INDICES: the frame rows a frame id would
   *  name do not exist until `createMany` has run. This is the shape it emits
   *  for a reference channel refreshed every 3rd frame. */
  const SPARSE_RESULT = {
    kind: 'single' as const,
    result: {
      frameCount: 6,
      durationMs: 6000,
      channels: [
        {
          name: 'irm',
          type: 'irm',
          isSegmentationSource: true,
          sparseSource: true,
          sparseFill: { '1': 0, '2': 0, '4': 3, '5': 3 },
        },
        { name: 'tirf', type: 'fluorescent', isSegmentationSource: false },
      ],
      width: 128,
      height: 96,
    },
  };

  const FRAME_ROWS = Array.from({ length: 6 }, (_, i) => ({
    id: `frame-${i}`,
    frameIndex: i,
  }));

  beforeEach(() => {
    vi.clearAllMocks();
    fsStatMock.mockResolvedValue({ size: 1024 });
    fsMkdirMock.mockResolvedValue(undefined);
    fsRenameMock.mockResolvedValue(undefined);
    fsRmMock.mockResolvedValue(undefined);
    installReaddir();
    // The gate `uploadVideoFromFile` now applies itself. Most tests here run a
    // microtubule project; the ones that care about the other side say so.
    prismaProjectFindUnique.mockResolvedValue({ type: 'microtubules' });
    // No per-position registration.json unless a test says otherwise.
    fsAccessMock.mockRejectedValue(new Error('ENOENT'));
    correctDriftMock.mockResolvedValue({ corrected: false });
    sharpMock.mockResolvedValue(undefined);
    prismaImageCreate.mockResolvedValue({ id: 'container-1' });
    prismaImageUpdate.mockResolvedValue({});
    prismaImageCreateMany.mockResolvedValue({ count: 6 });
    prismaImageDeleteMany.mockResolvedValue({ count: 0 });
    prismaImageFindMany.mockResolvedValue(FRAME_ROWS);
    extractMock.mockResolvedValue(SPARSE_RESULT);
  });

  function persistedChannels() {
    const call = prismaImageUpdate.mock.calls[0]?.[0] as {
      data: { channels: Array<Record<string, unknown>> };
    };
    return call.data.channels;
  }

  it('mirrors the index-space gap map into frame ids', async () => {
    // The editor only ever holds ids — `resolveFrameId` is handed a frame id
    // and a channel name and nothing else — so without this mirror it cannot
    // de-duplicate a run of gaps, and each gap re-downloads the same picture.
    await uploadVideoFromFile({
      projectId: 'proj-1',
      originalName: 'sparse.nd2',
      mimeType: 'image/tiff',
      tempFilePath: '/tmp/multer/abc-sparse.nd2',
    });

    expect(persistedChannels()[0]?.sparseFillFrameIds).toEqual({
      'frame-1': 'frame-0',
      'frame-2': 'frame-0',
      'frame-4': 'frame-3',
      'frame-5': 'frame-3',
    });
  });

  it('keeps the index map too — the frame-data route resolves from it', async () => {
    await uploadVideoFromFile({
      projectId: 'proj-1',
      originalName: 'sparse.nd2',
      mimeType: 'image/tiff',
      tempFilePath: '/tmp/multer/abc-sparse.nd2',
    });

    expect(persistedChannels()[0]?.sparseFill).toEqual({
      '1': 0,
      '2': 0,
      '4': 3,
      '5': 3,
    });
    expect(persistedChannels()[0]?.sparseSource).toBe(true);
  });

  it('leaves the dense channel of the same container untouched', async () => {
    await uploadVideoFromFile({
      projectId: 'proj-1',
      originalName: 'sparse.nd2',
      mimeType: 'image/tiff',
      tempFilePath: '/tmp/multer/abc-sparse.nd2',
    });

    expect(persistedChannels()[1]).not.toHaveProperty('sparseFillFrameIds');
    expect(persistedChannels()[1]).not.toHaveProperty('sparseSource');
  });

  it('costs no extra query when nothing is sparse', async () => {
    // Every existing upload takes this path; it must not grow a round-trip.
    extractMock.mockResolvedValue({
      kind: 'single',
      result: {
        frameCount: 5,
        durationMs: 5000,
        channels: [{ name: 'irm', type: 'irm', isSegmentationSource: true }],
        width: 128,
        height: 96,
      },
    });

    await uploadVideoFromFile({
      projectId: 'proj-1',
      originalName: 'dense.mp4',
      mimeType: 'video/mp4',
      tempFilePath: '/tmp/multer/abc-dense.mp4',
    });

    expect(prismaImageFindMany).not.toHaveBeenCalled();
  });

  it('draws the thumbnail from the first REAL frame, not from a gap', async () => {
    // A reference channel whose first acquisition is frame 2 would otherwise
    // give the whole container a black thumbnail in the gallery.
    extractMock.mockResolvedValue({
      kind: 'single',
      result: {
        frameCount: 6,
        durationMs: 6000,
        channels: [
          {
            name: 'irm',
            type: 'irm',
            isSegmentationSource: true,
            sparseSource: true,
            sparseFill: { '0': 2, '1': 2, '3': 2, '4': 2, '5': 2 },
          },
        ],
        width: 128,
        height: 96,
      },
    });

    await uploadVideoFromFile({
      projectId: 'proj-1',
      originalName: 'sparse.nd2',
      mimeType: 'image/tiff',
      tempFilePath: '/tmp/multer/abc-sparse.nd2',
    });

    expect(fsReaddirMock).toHaveBeenCalledWith(
      expect.stringContaining('/frames/0002')
    );
  });

  it('omits a gap it cannot name rather than guessing an id', async () => {
    // The picture is still right — the frame-data route resolves from the
    // index map — so a partial mirror costs a duplicate download, not a wrong
    // frame. Inventing an id would cost the wrong frame.
    prismaImageFindMany.mockResolvedValue(FRAME_ROWS.slice(0, 3));

    await uploadVideoFromFile({
      projectId: 'proj-1',
      originalName: 'sparse.nd2',
      mimeType: 'image/tiff',
      tempFilePath: '/tmp/multer/abc-sparse.nd2',
    });

    expect(persistedChannels()[0]?.sparseFillFrameIds).toEqual({
      'frame-1': 'frame-0',
      'frame-2': 'frame-0',
    });
  });
});
