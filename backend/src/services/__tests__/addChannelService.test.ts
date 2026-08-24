import { describe, it, expect, beforeEach, vi } from 'vitest';

// Hoisted mocks so the service pulls in test doubles for its IO deps.
//
// The vitest config sets `clearMocks` AND `restoreMocks`, which run before
// every test and strip the implementation off every `vi.fn()` — including the
// ones created inside these factories, since a factory runs once per file.
// So the factories only declare the SHAPE; every implementation is (re)applied
// in the top-level `beforeEach` below, which runs after the restore.
vi.mock('../../db/prismaClient', () => ({
  prisma: {
    project: { findUnique: vi.fn() },
    image: { findMany: vi.fn(), update: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock('../../utils/config', () => ({ config: { UPLOAD_DIR: '/app/uploads' } }));
vi.mock('../../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('fs/promises', () => ({
  mkdir: vi.fn(),
  copyFile: vi.fn(),
  writeFile: vi.fn(),
  rm: vi.fn(),
}));
vi.mock('sharp', () => ({ default: vi.fn() }));
vi.mock('../video/videoExtractor', () => ({
  detectVideoKind: vi.fn(),
  extractVideoSafe: vi.fn(),
}));
vi.mock('../video/pythonExtractor', () => ({ alignChannelFrames: vi.fn() }));
vi.mock('../videoUploadService', () => ({ frameStorageKey: vi.fn() }));

import * as fs from 'fs/promises';
import sharp from 'sharp';
import {
  addChannelToFrames,
  slugifyChannelName,
  uniqueName,
  summarizeAlignment,
  formatAlignReasons,
  MIN_ALIGN_CONFIDENCE,
  type AlignShiftRow,
} from '../addChannelService';
import { prisma } from '../../db/prismaClient';
import { logger } from '../../utils/logger';
import { detectVideoKind, extractVideoSafe } from '../video/videoExtractor';
import { alignChannelFrames } from '../video/pythonExtractor';
import { frameStorageKey } from '../videoUploadService';

const mockProject = prisma.project.findUnique as ReturnType<typeof vi.fn>;
const mockImageFindMany = prisma.image.findMany as ReturnType<typeof vi.fn>;
const mockDetectKind = detectVideoKind as ReturnType<typeof vi.fn>;
const mockExtract = extractVideoSafe as ReturnType<typeof vi.fn>;
const mockAlign = alignChannelFrames as ReturnType<typeof vi.fn>;
const mockLogInfo = logger.info as ReturnType<typeof vi.fn>;
const mockLogWarn = logger.warn as ReturnType<typeof vi.fn>;

const baseParams = {
  projectId: 'p1',
  originalName: 'ref.png',
  tempFilePath: '/tmp/x.png',
  channelName: 'GFP',
  align: false,
  imageIds: ['f1', 'f2'],
};

/** Re-arm every mocked dependency. Must run for EVERY test — see the note on
 *  `restoreMocks` above. */
beforeEach(() => {
  (fs.mkdir as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  (fs.copyFile as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  (fs.writeFile as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  (fs.rm as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

  (sharp as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => {
    const chain = {
      metadata: vi.fn().mockResolvedValue({ width: 512, height: 512 }),
      grayscale: vi.fn(() => chain),
      png: vi.fn(() => chain),
      toFile: vi.fn().mockResolvedValue(undefined),
    };
    return chain;
  });

  (frameStorageKey as ReturnType<typeof vi.fn>).mockImplementation(
    (pid: string, cid: string, i: number, name: string) =>
      `projects/${pid}/images/${cid}/frames/${String(i).padStart(4, '0')}/${name}.png`
  );

  (prisma.image.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
  (prisma.$transaction as ReturnType<typeof vi.fn>).mockResolvedValue([]);
});

describe('slugifyChannelName', () => {
  it('keeps a path-safe name', () => {
    expect(slugifyChannelName('GFP_640')).toBe('GFP_640');
  });
  it('replaces runs of unsafe chars with a single underscore', () => {
    expect(slugifyChannelName('  GFP 640 nm! ')).toBe('GFP_640_nm');
  });
  it('throws when nothing usable remains', () => {
    expect(() => slugifyChannelName('   ')).toThrow();
    expect(() => slugifyChannelName('!!!')).toThrow();
  });
  it('truncates to 64 chars', () => {
    expect(slugifyChannelName('a'.repeat(200))).toHaveLength(64);
  });
});

describe('uniqueName', () => {
  it('returns the base when free', () => {
    expect(uniqueName('GFP', new Set())).toBe('GFP');
  });
  it('suffixes on collision', () => {
    expect(uniqueName('GFP', new Set(['GFP']))).toBe('GFP_2');
    expect(uniqueName('GFP', new Set(['GFP', 'GFP_2']))).toBe('GFP_3');
  });
});

describe('summarizeAlignment', () => {
  it('counts a run where every frame was actually shifted', () => {
    const s = summarizeAlignment([
      [3, -2, 8.5],
      [4, -2, 7.5],
    ]);
    expect(s).toMatchObject({
      frames: 2,
      shifted: 2,
      rejected: 0,
      zeroShift: 0,
      rejectedFraction: 0,
      maxAbsShift: { dy: 4, dx: 2 },
    });
    expect(s.confidence).toEqual({ min: 7.5, median: 8, max: 8.5 });
  });

  it('counts a run where every estimate was rejected as too weak', () => {
    // (0, 0, conf) with conf < _MIN_CONFIDENCE is exactly what
    // estimate_translation returns when the correlation peak is untrustworthy.
    const s = summarizeAlignment([
      [0, 0, 1.2],
      [0, 0, 1.4],
      [0, 0, 0.0], // shape mismatch — the helper's only true zero-confidence
    ]);
    expect(s).toMatchObject({
      frames: 3,
      shifted: 0,
      rejected: 3,
      zeroShift: 0,
      rejectedFraction: 1,
      maxAbsShift: { dy: 0, dx: 0 },
    });
    expect(s.confidence).toEqual({ min: 0, median: 1.2, max: 1.4 });
  });

  it('separates a trusted zero shift from a rejected estimate', () => {
    // A confident peak at the origin is NOT a rejection: the channels are
    // already aligned (or an implausible peak was discarded — indistinguishable
    // from this output, hence its own bucket).
    const s = summarizeAlignment([
      [0, 0, 12.0],
      [0, 0, 9.0],
    ]);
    expect(s).toMatchObject({
      frames: 2,
      shifted: 0,
      rejected: 0,
      zeroShift: 2,
      rejectedFraction: 0,
    });
  });

  it('classifies a mixed run and reports the confidence spread', () => {
    const s = summarizeAlignment([
      [2, 1, 6.0],
      [0, 0, 1.0],
      [0, 0, 11.0],
      [-5, 0, 4.0],
    ]);
    expect(s).toMatchObject({
      frames: 4,
      shifted: 2,
      rejected: 1,
      zeroShift: 1,
      rejectedFraction: 0.25,
      maxAbsShift: { dy: 5, dx: 1 },
    });
    expect(s.confidence).toEqual({ min: 1, median: 5, max: 11 });
  });

  it('treats the threshold as exclusive on the reject side', () => {
    // conf === _MIN_CONFIDENCE passes in channel_registration (`< _MIN`), so a
    // zero shift at exactly the threshold is trusted, not rejected.
    expect(summarizeAlignment([[0, 0, MIN_ALIGN_CONFIDENCE]])).toMatchObject({
      rejected: 0,
      zeroShift: 1,
    });
    expect(
      summarizeAlignment([[0, 0, MIN_ALIGN_CONFIDENCE - 0.001]])
    ).toMatchObject({ rejected: 1, zeroShift: 0 });
  });

  it('handles an empty / missing shifts array', () => {
    expect(summarizeAlignment([])).toMatchObject({
      frames: 0,
      rejectedFraction: 0,
      confidence: null,
    });
    expect(summarizeAlignment(undefined)).toMatchObject({ frames: 0 });
  });
});

describe('summarizeAlignment reason breakdown', () => {
  it('separates an already-aligned success from a discarded implausible peak', () => {
    // The whole point of the reason field: these four rows are the SAME
    // [0, 0, high-confidence] triple, and mean opposite things.
    const s = summarizeAlignment([
      [0, 0, 14.0, 'ok', 0, 0],
      [0, 0, 12.0, 'ok', 0, 0],
      [0, 0, 53.1, 'implausible_shift', -40, 0],
      [0, 0, 49.4, 'implausible_shift', -38, 2],
    ]);
    // The legacy buckets still cannot tell them apart...
    expect(s.zeroShift).toBe(4);
    expect(s.rejected).toBe(0);
    // ...the reasons can.
    expect(s.reasons).toEqual({
      ok: 2,
      low_confidence: 0,
      implausible_shift: 2,
      shape_mismatch: 0,
      unreported: 0,
    });
    expect(s.reasonsReported).toBe(true);
    expect(s.failed).toBe(2);
    expect(s.failedFraction).toBe(0.5);
    expect(s.dominantFailure).toBe('implausible_shift');
    // The largest discarded candidate is kept, so the log can say WHAT was
    // refused rather than only that something was.
    expect(s.implausiblePeak).toEqual({ dy: -40, dx: 0 });
  });

  it('counts each reason the helper can emit', () => {
    const s = summarizeAlignment([
      [3, -2, 8.5, 'ok', 3, -2],
      [0, 0, 1.2, 'low_confidence', 5, 1],
      [0, 0, 53.1, 'implausible_shift', -40, 0],
      [0, 0, 0.0, 'shape_mismatch', 0, 0],
    ]);
    expect(s.reasons).toEqual({
      ok: 1,
      low_confidence: 1,
      implausible_shift: 1,
      shape_mismatch: 1,
      unreported: 0,
    });
    expect(s.failed).toBe(3);
    expect(s.failedFraction).toBe(0.75);
    // Tie on 1 each → ALIGN_REASONS order decides, deterministically.
    expect(s.dominantFailure).toBe('low_confidence');
    expect(formatAlignReasons(s.reasons)).toBe(
      'ok=1, low_confidence=1, implausible_shift=1, shape_mismatch=1'
    );
  });

  it('marks nothing failed when every frame reported ok', () => {
    const s = summarizeAlignment([
      [0, 0, 14.0, 'ok', 0, 0],
      [4, 1, 9.0, 'ok', 4, 1],
    ]);
    expect(s.failed).toBe(0);
    expect(s.failedFraction).toBe(0);
    expect(s.dominantFailure).toBeNull();
    expect(s.implausiblePeak).toBeNull();
  });

  it('parses a legacy 3-element row and refuses to guess the ambiguous one', () => {
    // Backward compatibility: rows from a helper that predates the reason
    // field. What the triple determines is inferred; what it does not — a
    // trusted zero shift — is `unreported`, NOT silently called a success.
    const s = summarizeAlignment([
      [3, -2, 8.5],
      [0, 0, 1.2],
      [0, 0, 11.0],
    ]);
    expect(s.reasons).toEqual({
      ok: 1,
      low_confidence: 1,
      implausible_shift: 0,
      shape_mismatch: 0,
      unreported: 1,
    });
    expect(s.reasonsReported).toBe(false);
    // Legacy input must reproduce the old warn behaviour exactly.
    expect(s.failed).toBe(s.rejected);
    expect(s.failedFraction).toBe(s.rejectedFraction);
  });

  it('ignores a reason it does not recognise and falls back to inference', () => {
    // Forward compatibility: a future helper reason must not crash or be
    // counted as something it is not.
    const s = summarizeAlignment([
      [0, 0, 1.0, 'some_future_reason', 0, 0],
    ] as unknown as AlignShiftRow[]);
    expect(s.reasons.low_confidence).toBe(1);
    expect(s.reasonsReported).toBe(false);
  });

  it('survives a row with a missing peak tail', () => {
    // reason present, peak absent (a helper reporting only the reason).
    const s = summarizeAlignment([[0, 0, 20.0, 'implausible_shift']]);
    expect(s.reasons.implausible_shift).toBe(1);
    expect(s.implausiblePeak).toEqual({ dy: 0, dx: 0 });
    expect(s.failedFraction).toBe(1);
  });
});

describe('addChannelToFrames validation', () => {
  it('rejects a non-microtubule project', async () => {
    mockProject.mockResolvedValue({ type: 'spheroid' });
    await expect(addChannelToFrames(baseParams)).rejects.toThrow(/microtubule/i);
  });

  it('rejects an empty selection', async () => {
    mockProject.mockResolvedValue({ type: 'microtubules' });
    await expect(
      addChannelToFrames({ ...baseParams, imageIds: [] })
    ).rejects.toThrow(/No images selected/i);
  });

  it('rejects a selection with no video frames', async () => {
    mockProject.mockResolvedValue({ type: 'microtubules' });
    mockImageFindMany.mockResolvedValueOnce([
      { id: 'f1', parentVideoId: null, frameIndex: null, isVideoContainer: false },
    ]);
    await expect(addChannelToFrames(baseParams)).rejects.toThrow(
      /video frames/i
    );
  });

  it('rejects a dimension mismatch', async () => {
    mockProject.mockResolvedValue({ type: 'microtubules' });
    mockDetectKind.mockReturnValue(null); // single image path → 512x512 (sharp mock)
    mockImageFindMany
      .mockResolvedValueOnce([
        { id: 'f1', parentVideoId: 'c1', frameIndex: 0, isVideoContainer: false },
        { id: 'f2', parentVideoId: 'c1', frameIndex: 1, isVideoContainer: false },
      ])
      .mockResolvedValueOnce([
        { id: 'c1', channels: [], width: 1024, height: 1024, frameCount: 5 },
      ]);
    await expect(addChannelToFrames(baseParams)).rejects.toThrow(
      /Dimension mismatch/i
    );
  });

  it('rejects a multi-frame source spanning multiple videos', async () => {
    mockProject.mockResolvedValue({ type: 'microtubules' });
    mockDetectKind.mockReturnValue('tiff-stack');
    mockExtract.mockResolvedValue({
      kind: 'single',
      result: {
        frameCount: 2,
        width: 512,
        height: 512,
        channels: [{ name: 'c0', type: 'fluorescent', isSegmentationSource: false }],
      },
    });
    mockImageFindMany.mockResolvedValueOnce([
      { id: 'f1', parentVideoId: 'c1', frameIndex: 0, isVideoContainer: false },
      { id: 'f2', parentVideoId: 'c2', frameIndex: 0, isVideoContainer: false },
    ]);
    await expect(addChannelToFrames(baseParams)).rejects.toThrow(
      /single video/i
    );
  });

  it('adds a single-image channel to the selected frames (partial coverage)', async () => {
    mockProject.mockResolvedValue({ type: 'microtubules' });
    mockDetectKind.mockReturnValue(null); // image path
    mockImageFindMany
      .mockResolvedValueOnce([
        { id: 'f1', parentVideoId: 'c1', frameIndex: 0, isVideoContainer: false },
        { id: 'f2', parentVideoId: 'c1', frameIndex: 1, isVideoContainer: false },
      ])
      .mockResolvedValueOnce([
        {
          id: 'c1',
          channels: [
            { name: 'irm', type: 'irm', isSegmentationSource: true },
          ],
          width: 512,
          height: 512,
          frameCount: 5, // selection (2) < frameCount → partial coverage
        },
      ]);

    const result = await addChannelToFrames(baseParams);

    expect(result.addedChannels).toEqual(['GFP']);
    expect(result.affectedContainerIds).toEqual(['c1']);
    expect(result.framesWritten).toBe(2);
    // Channel appended with pngBacked + partial-coverage frameIds.
    const updateArg = (prisma.image.update as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    const added = updateArg.data.channels.at(-1);
    expect(added).toMatchObject({
      name: 'GFP',
      pngBacked: true,
      isSegmentationSource: false,
    });
    expect(added.frameIds).toEqual(['f1', 'f2']);
    // align was false → nothing to report about registration.
    expect(result.alignment).toBeUndefined();
    expect(mockAlign).not.toHaveBeenCalled();
  });
});

describe('addChannelToFrames alignment reporting', () => {
  /** Wire up an align:true run over `frameIds` against a container whose
   *  segmentation source is `irm`, with the helper returning `shifts`. */
  const runAligned = async (
    frameIds: string[],
    shifts: Array<[number, number, number, ...unknown[]]>
  ) => {
    mockProject.mockResolvedValue({ type: 'microtubules' });
    mockDetectKind.mockReturnValue(null); // single image source
    mockImageFindMany
      .mockResolvedValueOnce(
        frameIds.map((id, i) => ({
          id,
          parentVideoId: 'c1',
          frameIndex: i,
          isVideoContainer: false,
        }))
      )
      .mockResolvedValueOnce([
        {
          id: 'c1',
          channels: [{ name: 'irm', type: 'irm', isSegmentationSource: true }],
          width: 512,
          height: 512,
          frameCount: frameIds.length,
        },
      ]);
    mockAlign.mockResolvedValue({ aligned: shifts.length, shifts });
    return addChannelToFrames({ ...baseParams, align: true, imageIds: frameIds });
  };

  const infoMessages = () => mockLogInfo.mock.calls.map(c => String(c[0]));
  const warnMessages = () => mockLogWarn.mock.calls.map(c => String(c[0]));

  it('reports every frame shifted, with no warning', async () => {
    const result = await runAligned(
      ['f1', 'f2'],
      [
        [3, -2, 8.5],
        [3, -2, 7.5],
      ]
    );

    expect(result.alignment).toMatchObject({
      frames: 2,
      shifted: 2,
      rejected: 0,
      zeroShift: 0,
      rejectedFraction: 0,
      confidence: { min: 7.5, median: 8, max: 8.5 },
      maxAbsShift: { dy: 3, dx: 2 },
    });
    expect(infoMessages()).toContain(
      'Add-channel alignment: 2/2 frame(s) shifted, 0 rejected (confidence < 3), 0 zero-shift (already aligned or rejected as implausible)'
    );
    expect(warnMessages()).toHaveLength(0);
  });

  it('says loudly when NOTHING was aligned (the orthogonal-structure case)', async () => {
    const result = await runAligned(
      ['f1', 'f2', 'f3', 'f4'],
      [
        [0, 0, 1.1],
        [0, 0, 1.3],
        [0, 0, 0.9],
        [0, 0, 1.2],
      ]
    );

    expect(result.alignment).toMatchObject({
      frames: 4,
      shifted: 0,
      rejected: 4,
      zeroShift: 0,
      rejectedFraction: 1,
    });
    expect(infoMessages()).toContain(
      'Add-channel alignment: 0/4 frame(s) shifted, 4 rejected (confidence < 3), 0 zero-shift (already aligned or rejected as implausible)'
    );
    const warns = warnMessages();
    expect(warns).toHaveLength(1);
    expect(warns[0]).toMatch(/FAILED for most frames: 4\/4/);
    expect(warns[0]).toMatch(/UNSHIFTED/);
    expect(warns[0]).toMatch(/cross-modality/i);
    // The warning carries the numbers, not just prose.
    expect(mockLogWarn.mock.calls[0][2]).toMatchObject({
      jobs: 4,
      rejected: 4,
      rejectedFraction: 1,
      minConfidence: MIN_ALIGN_CONFIDENCE,
    });
  });

  it('does not warn on a mixed run below the warn threshold', async () => {
    const result = await runAligned(
      ['f1', 'f2', 'f3', 'f4'],
      [
        [2, 1, 6.0],
        [0, 0, 1.0], // 1/4 rejected = 0.25 < 0.5
        [0, 0, 11.0],
        [-5, 0, 4.0],
      ]
    );

    expect(result.alignment).toMatchObject({
      frames: 4,
      shifted: 2,
      rejected: 1,
      zeroShift: 1,
      rejectedFraction: 0.25,
    });
    expect(infoMessages()).toContain(
      'Add-channel alignment: 2/4 frame(s) shifted, 1 rejected (confidence < 3), 1 zero-shift (already aligned or rejected as implausible)'
    );
    expect(warnMessages()).toHaveLength(0);
  });

  it('warns once the rejected fraction reaches the threshold', async () => {
    await runAligned(
      ['f1', 'f2', 'f3', 'f4'],
      [
        [2, 1, 6.0],
        [3, 1, 5.0],
        [0, 0, 1.0], // 2/4 rejected = 0.50 → warn (threshold is inclusive)
        [0, 0, 0.8],
      ]
    );
    const warns = warnMessages();
    expect(warns).toHaveLength(1);
    expect(warns[0]).toMatch(/FAILED for most frames: 2\/4/);
  });

  it('does NOT warn when every frame was confidently already aligned', async () => {
    // A perfectly co-registered pair yields a trusted peak at (0, 0) on every
    // frame. Nothing is shifted, but nothing failed either — warning here
    // would be the same lie in the opposite direction.
    const result = await runAligned(
      ['f1', 'f2'],
      [
        [0, 0, 14.0],
        [0, 0, 12.0],
      ]
    );

    expect(result.alignment).toMatchObject({
      frames: 2,
      shifted: 0,
      rejected: 0,
      zeroShift: 2,
      rejectedFraction: 0,
    });
    expect(infoMessages()).toContain(
      'Add-channel alignment: 0/2 frame(s) shifted, 0 rejected (confidence < 3), 2 zero-shift (already aligned or rejected as implausible)'
    );
    expect(warnMessages()).toHaveLength(0);
  });

  it('warns when the helper reports fewer frames than jobs', async () => {
    await runAligned(['f1', 'f2'], [[3, -2, 8.5]]);
    expect(warnMessages()[0]).toMatch(
      /reported 1 frame\(s\) for 2 job\(s\)/
    );
  });

  // ---------------------------------------------------------------------
  // The reported bug: "aligned: 20", frames visibly unregistered. Every
  // estimate was a confident peak refused as implausible — a zero shift with a
  // GOOD confidence, which the old three buckets filed under `zeroShift` and
  // said nothing about.
  // ---------------------------------------------------------------------

  it('now warns — and names the cause — when every peak was discarded as implausible', async () => {
    const result = await runAligned(
      ['f1', 'f2', 'f3', 'f4'],
      [
        [0, 0, 53.1, 'implausible_shift', -40, 0],
        [0, 0, 49.4, 'implausible_shift', -41, 1],
        [0, 0, 51.0, 'implausible_shift', -40, 0],
        [0, 0, 47.8, 'implausible_shift', -39, 0],
      ]
    );

    expect(result.alignment).toMatchObject({
      frames: 4,
      shifted: 0,
      rejected: 0, // the old count says nothing failed...
      zeroShift: 4,
      rejectedFraction: 0,
      failed: 4, // ...the new one does
      failedFraction: 1,
      dominantFailure: 'implausible_shift',
      implausiblePeak: { dy: -41, dx: 1 },
    });

    // Info line carries the breakdown now that the helper reports reasons.
    expect(infoMessages()).toContain(
      'Add-channel alignment: 0/4 frame(s) shifted, 0 rejected (confidence < 3), ' +
        '4 zero-shift (already aligned or rejected as implausible) — ' +
        'per-frame reasons: implausible_shift=4'
    );

    const warns = warnMessages();
    expect(warns).toHaveLength(1);
    expect(warns[0]).toMatch(/FAILED for most frames: 4\/4/);
    // The cause is named, and it is NOT the weak-correlation story.
    expect(warns[0]).toMatch(/plausibility cap/);
    expect(warns[0]).toMatch(/largest discarded peak was dy=-41, dx=1/i);
    expect(warns[0]).toMatch(/HIGH confidence/);
    expect(warns[0]).not.toMatch(/cross-modality/i);
  });

  it('keeps the weak-correlation wording when that is the real cause', async () => {
    await runAligned(
      ['f1', 'f2'],
      [
        [0, 0, 1.1, 'low_confidence', 3, 1],
        [0, 0, 1.3, 'low_confidence', -2, 4],
      ]
    );
    const warns = warnMessages();
    expect(warns).toHaveLength(1);
    expect(warns[0]).toMatch(/FAILED for most frames: 2\/2/);
    expect(warns[0]).toMatch(/too weak to trust/);
    expect(warns[0]).toMatch(/cross-modality/i);
    expect(warns[0]).not.toMatch(/plausibility cap/);
  });

  it('names a shape mismatch as a shape mismatch', async () => {
    await runAligned(
      ['f1', 'f2'],
      [
        [0, 0, 0.0, 'shape_mismatch', 0, 0],
        [0, 0, 0.0, 'shape_mismatch', 0, 0],
      ]
    );
    expect(warnMessages()[0]).toMatch(/different shapes/);
    expect(warnMessages()[0]).toMatch(/share a pixel grid/);
  });

  it('stays silent when confident zero shifts are genuinely already aligned', async () => {
    // Same triples as the implausible case above; only the reason differs.
    const result = await runAligned(
      ['f1', 'f2'],
      [
        [0, 0, 53.1, 'ok', 0, 0],
        [0, 0, 49.4, 'ok', 0, 0],
      ]
    );
    expect(result.alignment).toMatchObject({
      zeroShift: 2,
      failed: 0,
      failedFraction: 0,
      dominantFailure: null,
    });
    expect(warnMessages()).toHaveLength(0);
    expect(infoMessages()).toContain(
      'Add-channel alignment: 0/2 frame(s) shifted, 0 rejected (confidence < 3), ' +
        '2 zero-shift (already aligned or rejected as implausible) — ' +
        'per-frame reasons: ok=2'
    );
  });
});
