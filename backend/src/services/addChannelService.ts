/**
 * "Add channel" service (microtubule projects).
 *
 * Appends an extra image channel to a set of SELECTED video frames by
 * decoding an uploaded source (video / stack / ND2 / single image) and writing
 * one per-frame PNG per source channel into the target frames' existing
 * ``frames/<TTTT>/`` directories, then appending the new channel(s) to each
 * affected video container's ``channels`` JSON.
 *
 * The added channel is **PNG-backed** (`ChannelMeta.pngBacked = true`): its
 * pixels live only in the per-frame PNGs, never in the container's original
 * volume. It renders in the editor and can be kymographed like any channel;
 * ``mt_metrics.py`` samples it from the PNGs (see `mtMetricsExporter.ts`).
 *
 * Coverage is exactly the selected frames — other frames of the same video do
 * not get the channel, which every consumer tolerates (a missing per-frame PNG
 * is expected).
 */

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';
import sharp from 'sharp';
import { prisma } from '../db/prismaClient';
import { config } from '../utils/config';
import { logger } from '../utils/logger';
import {
  ChannelMeta,
  CHANNEL_NAME_RE,
  defaultColorForWavelength,
} from './video/types';
import { isMicrotubuleProject } from '../types/validation';
import { detectVideoKind, extractVideoSafe } from './video/videoExtractor';
import { alignChannelFrames, ChannelAlignJob } from './video/pythonExtractor';
import { frameStorageKey } from './videoUploadService';

const MAX_DISPLAY_NAME_LEN = 128;

/**
 * Peak-to-background confidence below which the phase-correlation estimate is
 * discarded and the frame is copied UNSHIFTED. Mirrors ``_MIN_CONFIDENCE`` in
 * ``video/pythonHelpers/channel_registration.py`` — the threshold lives in
 * Python, so this copy exists only to *classify* the helper's output, never to
 * drive the alignment. Keep the two in sync.
 */
export const MIN_ALIGN_CONFIDENCE = 3.0;

/**
 * Fraction of frames that failed to register, above which the run is reported
 * at ``warn``. Rationale: the per-frame guards already vet each frame
 * individually, so a handful of failures (a dark or out-of-focus frame) is
 * expected noise on an otherwise good pair. A *majority* of frames failing is
 * not noise — it is the signature of a channel pair that cannot be registered
 * at all.
 *
 * Measured against {@link ChannelAlignmentSummary.failedFraction}, which counts
 * every non-``ok`` outcome. It used to be measured against
 * ``rejectedFraction``, which counts only weak-correlation frames — so a run
 * where every frame's peak was discarded as implausible (a total failure with
 * a HIGH confidence) fell in the ``zeroShift`` bucket and warned about
 * nothing.
 */
export const ALIGN_REJECTED_WARN_FRACTION = 0.5;

/**
 * Why one frame ended up with the shift it did — the helper's per-frame
 * ``reason``, mirroring the branch names in
 * ``video/pythonHelpers/channel_registration.py``:
 *
 * - ``ok`` — the estimate was accepted. ``(0, 0)`` here is a *success*: the
 *   channels were already aligned and there was nothing to correct.
 * - ``low_confidence`` — the correlation peak was below
 *   {@link MIN_ALIGN_CONFIDENCE}; the frame was written unshifted.
 * - ``implausible_shift`` — a peak was found but sat further from the origin
 *   than the estimator's search window allows, so it was discarded and the frame was
 *   written unshifted. Its confidence is usually HIGH, which is what made this
 *   failure indistinguishable from "already aligned". Python checks
 *   plausibility BEFORE confidence, so an estimate that would fail both
 *   branches reports this one.
 * - ``shape_mismatch`` — moving and reference rasters differ in shape, so no
 *   correlation was attempted (emitted by ``add_channel_align.py`` itself;
 *   ``estimate_translation_detailed`` raises on that input).
 * - ``unreported`` — NOT a Python outcome. Marks a row from a helper that
 *   predates the reason field whose reason cannot be recovered: a zero shift
 *   with a good confidence is exactly the ambiguity this field exists to
 *   resolve, so it is labelled unknown rather than guessed at.
 */
export const ALIGN_REASONS = [
  'ok',
  'low_confidence',
  'implausible_shift',
  'shape_mismatch',
  'unreported',
] as const;
export type AlignReason = (typeof ALIGN_REASONS)[number];

/** Reasons that mean the frame was NOT registered. ``unreported`` is absent on
 *  purpose: an unknown outcome is not evidence of failure. */
const FAILURE_REASONS: readonly AlignReason[] = [
  'low_confidence',
  'implausible_shift',
  'shape_mismatch',
];

/**
 * One row of the helper's ``shifts`` array. Historically
 * ``[dy, dx, confidence]``; since the reason field it is
 * ``[dy, dx, confidence, reason, peakDy, peakDx]``. Typed as "three numbers
 * plus an unknown tail" so BOTH shapes parse — this is the tolerant side of
 * the wire contract (a new backend reading an old helper's output). The other
 * direction is tolerant for free: an old backend destructures three elements
 * and ignores the tail.
 */
export type AlignShiftRow = readonly [number, number, number, ...unknown[]];

/**
 * What the aligner actually did, derived from the helper's per-frame rows.
 *
 * The ``shifted`` / ``rejected`` / ``zeroShift`` trio is unchanged — a pure
 * function of ``(dy, dx, confidence)`` — so existing consumers keep working.
 * It cannot tell a *trusted* peak at the origin (already aligned — a success)
 * from a peak discarded for falling outside the search window (a silent
 * failure): both are ``[0, 0, <high confidence>]`` and both land in
 * ``zeroShift``. {@link ChannelAlignmentSummary.reasons} resolves that, and
 * {@link ChannelAlignmentSummary.failed} — not ``rejected`` — is the count
 * that should drive any "registration did not work" reporting.
 */
export interface ChannelAlignmentSummary {
  /** Frames the helper reported on (target frames × source channels). */
  frames: number;
  /** Frames that received a non-zero translation — actually registered. */
  shifted: number;
  /**
   * Frames with a zero shift and a confidence below
   * {@link MIN_ALIGN_CONFIDENCE}. Legacy bucket, kept for compatibility;
   * ``reasons.low_confidence`` is the accurate count (such a row can also
   * carry ``implausible_shift``, since Python checks plausibility first).
   */
  rejected: number;
  /**
   * Frames with a zero shift and a trusted confidence: already aligned, or an
   * implausibly large peak that was discarded. Legacy bucket — ``reasons``
   * separates the two.
   */
  zeroShift: number;
  /** ``rejected / frames``, 0..1, rounded to 3 decimals. Legacy; prefer
   *  {@link ChannelAlignmentSummary.failedFraction}. */
  rejectedFraction: number;
  /** How many frames ended on each reason. Every key is always present. */
  reasons: Record<AlignReason, number>;
  /** True when the helper actually emitted reasons, false when they had to be
   *  inferred from legacy 3-element rows. */
  reasonsReported: boolean;
  /** Frames NOT registered: ``low_confidence`` + ``implausible_shift`` +
   *  ``shape_mismatch``. */
  failed: number;
  /** ``failed / frames``, 0..1, rounded to 3 decimals. */
  failedFraction: number;
  /** Failure reason with the most frames (ties broken by
   *  {@link ALIGN_REASONS} order); null when nothing failed. */
  dominantFailure: AlignReason | null;
  /** Largest correlation peak an ``implausible_shift`` frame discarded — what
   *  the aligner *wanted* to do. Null when no frame hit that branch. */
  implausiblePeak: { dy: number; dx: number } | null;
  /** Peak-to-background confidence spread; null when no frames were reported. */
  confidence: { min: number; median: number; max: number } | null;
  /** Largest translation actually applied, per axis (absolute pixels). */
  maxAbsShift: { dy: number; dx: number };
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * Reason for one row: the helper's own label when present, otherwise the most
 * the legacy triple allows.
 *
 * The inference reproduces the old buckets exactly — nonzero → ``ok``,
 * zero+weak → ``low_confidence``, zero+trusted → ``unreported`` — which is why
 * ``failedFraction === rejectedFraction`` on legacy input and the warn
 * threshold fires there exactly as it did before. The inferred
 * ``low_confidence`` really is an inference: Python checks plausibility first,
 * so such a row could equally have come from the ``implausible_shift`` branch.
 * Only a reporting helper can tell them apart.
 */
function rowReason(row: AlignShiftRow): {
  reason: AlignReason;
  reported: boolean;
} {
  const raw = row[3];
  if (
    typeof raw === 'string' &&
    raw !== 'unreported' &&
    (ALIGN_REASONS as readonly string[]).includes(raw)
  ) {
    return { reason: raw as AlignReason, reported: true };
  }
  const [dy, dx, conf] = row;
  if (dy !== 0 || dx !== 0) {
    return { reason: 'ok', reported: false };
  }
  if (conf < MIN_ALIGN_CONFIDENCE) {
    return { reason: 'low_confidence', reported: false };
  }
  return { reason: 'unreported', reported: false };
}

/**
 * Write each aligned frame's applied shift onto the static channel it belongs
 * to, keyed by frame Image id.
 *
 * Exported for testing: the positional correspondence between the helper's
 * `shifts` rows and the jobs that produced them is the whole contract, and it
 * is the kind of thing that breaks silently when either side is reordered.
 * A row the helper did not return (short array) leaves that frame without a
 * recorded shift, which downstream must treat as "unknown", NOT as zero —
 * projecting a segmentation by an assumed zero shift would put filaments in
 * the wrong place.
 */
export function recordStaticShifts(
  shifts: ReadonlyArray<AlignShiftRow> | undefined,
  owners: ReadonlyArray<{
    containerId: string;
    channelIndex: number;
    frameId: string;
  }>,
  channelsByContainer: Map<string, ChannelMeta[]>,
  onMissingContainer?: (containerId: string) => void
): void {
  const rows = shifts ?? [];
  for (let i = 0; i < owners.length; i++) {
    const row = rows[i];
    if (!row) {
      continue;
    }
    const owner = owners[i];
    const metas = channelsByContainer.get(owner.containerId);
    if (!metas) {
      onMissingContainer?.(owner.containerId);
      continue;
    }
    const meta = metas[owner.channelIndex];
    if (!meta?.staticSource) {
      continue;
    }
    const dy = Number(row[0]);
    const dx = Number(row[1]);
    if (!Number.isFinite(dy) || !Number.isFinite(dx)) {
      continue;
    }
    (meta.staticShifts ??= {})[owner.frameId] = [dy, dx];
  }
}


/**
 * Turn the helper's raw per-frame shifts into a summary of what happened.
 * Pure, and exported so the reporting can be tested without running Python.
 */
export function summarizeAlignment(
  shifts: ReadonlyArray<AlignShiftRow> | undefined
): ChannelAlignmentSummary {
  const rows = shifts ?? [];

  let shifted = 0;
  let rejected = 0;
  let zeroShift = 0;
  let maxDy = 0;
  let maxDx = 0;
  let reasonsReported = false;
  let implausiblePeak: { dy: number; dx: number } | null = null;
  const confidences: number[] = [];
  const reasons = Object.fromEntries(ALIGN_REASONS.map(r => [r, 0])) as Record<
    AlignReason,
    number
  >;

  for (const row of rows) {
    const [dy, dx, conf] = row;
    confidences.push(conf);
    if (dy !== 0 || dx !== 0) {
      shifted++;
      maxDy = Math.max(maxDy, Math.abs(dy));
      maxDx = Math.max(maxDx, Math.abs(dx));
    } else if (conf < MIN_ALIGN_CONFIDENCE) {
      rejected++;
    } else {
      zeroShift++;
    }

    const { reason, reported } = rowReason(row);
    reasons[reason]++;
    reasonsReported = reasonsReported || reported;

    if (reason === 'implausible_shift') {
      const peakDy = typeof row[4] === 'number' ? row[4] : 0;
      const peakDx = typeof row[5] === 'number' ? row[5] : 0;
      const magnitude = Math.abs(peakDy) + Math.abs(peakDx);
      const best = implausiblePeak
        ? Math.abs(implausiblePeak.dy) + Math.abs(implausiblePeak.dx)
        : -1;
      if (magnitude > best) {
        implausiblePeak = { dy: peakDy, dx: peakDx };
      }
    }
  }

  let confidence: ChannelAlignmentSummary['confidence'] = null;
  if (confidences.length > 0) {
    const sorted = [...confidences].sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    const median =
      sorted.length % 2 === 1
        ? sorted[mid]
        : (sorted[mid - 1] + sorted[mid]) / 2;
    confidence = {
      min: round3(sorted[0]),
      median: round3(median),
      max: round3(sorted[sorted.length - 1]),
    };
  }

  const failed = FAILURE_REASONS.reduce((n, r) => n + reasons[r], 0);
  let dominantFailure: AlignReason | null = null;
  for (const r of FAILURE_REASONS) {
    if (
      reasons[r] > 0 &&
      (dominantFailure === null || reasons[r] > reasons[dominantFailure])
    ) {
      dominantFailure = r;
    }
  }

  const frames = rows.length;
  return {
    frames,
    shifted,
    rejected,
    zeroShift,
    rejectedFraction: frames > 0 ? round3(rejected / frames) : 0,
    reasons,
    reasonsReported,
    failed,
    failedFraction: frames > 0 ? round3(failed / frames) : 0,
    dominantFailure,
    implausiblePeak,
    confidence,
    maxAbsShift: { dy: maxDy, dx: maxDx },
  };
}

/** ``ok=12, implausible_shift=8`` — non-zero reasons only, stable order. */
export function formatAlignReasons(
  reasons: Record<AlignReason, number>
): string {
  return ALIGN_REASONS.filter(r => reasons[r] > 0)
    .map(r => `${r}=${reasons[r]}`)
    .join(', ');
}

/**
 * One sentence naming WHY most frames failed, chosen by the dominant failure
 * reason. The three causes want three different fixes, so a single generic
 * "the channels could not be correlated" sentence is wrong for two of them:
 * an implausible peak means the correlation worked *and found something*, it
 * was just refused as too far.
 */
export function alignFailureCause(
  alignment: Pick<
    ChannelAlignmentSummary,
    'dominantFailure' | 'reasons' | 'implausiblePeak'
  >
): string {
  switch (alignment.dominantFailure) {
    case 'implausible_shift': {
      const peak = alignment.implausiblePeak;
      const found =
        peak && (peak.dy !== 0 || peak.dx !== 0)
          ? ` The largest discarded peak was dy=${peak.dy}, dx=${peak.dx}.`
          : '';
      return (
        `Cause: the correlation DID find a peak on ${alignment.reasons.implausible_shift} ` +
        `frame(s), but further from the origin than the plausibility cap allows (10% of the ` +
        `smaller frame dimension), so it was discarded as spurious.${found} Likely either a ` +
        `genuine offset larger than the cap (a differently cropped or stage-offset source) or ` +
        `a periodic/self-similar structure the correlation locked onto in the wrong place. ` +
        `Note this failure carries a HIGH confidence — it is not a weak-signal problem.`
      );
    }
    case 'shape_mismatch':
      return (
        `Cause: on ${alignment.reasons.shape_mismatch} frame(s) the added channel's raster and ` +
        `the reference frame have different shapes, so no correlation was attempted at all. ` +
        `The two channels must share a pixel grid.`
      );
    case 'low_confidence':
      return (
        `Cause: ${alignment.reasons.low_confidence} estimate(s) were too weak to trust ` +
        `(peak-to-background confidence < ${MIN_ALIGN_CONFIDENCE}) — this channel pair does not ` +
        `correlate. Cross-modality channels (e.g. IRM vs fluorescence) correlate poorly, and a ` +
        `pair with no shared structure cannot be registered at all.`
      );
    default:
      return 'Cause: unknown — the aligner reported no per-frame reason.';
  }
}

export interface AddChannelParams {
  projectId: string;
  /** Uploaded source file's original name — drives format detection. */
  originalName: string;
  /** Multer temp path of the uploaded source (owned by the caller). */
  tempFilePath: string;
  /** User-provided friendly channel name (base label). */
  channelName: string;
  /** Phase-correlation align each added frame to the frame's seg source. */
  align: boolean;
  /** Selected frame Image ids. */
  imageIds: string[];
}

export interface AddChannelResult {
  addedChannels: string[];
  affectedContainerIds: string[];
  framesWritten: number;
  /**
   * What the phase-correlation alignment achieved. Present only when
   * ``align`` was requested AND at least one frame was handed to the aligner;
   * absent otherwise, so pre-existing consumers of this shape are unaffected.
   * Writing the frames always succeeds — this is the only thing that says
   * whether they were actually *registered*.
   */
  alignment?: ChannelAlignmentSummary;
}

interface TargetFrame {
  id: string;
  frameIndex: number;
}

/** Slugify a user label into a path-safe channel machine name. */
export function slugifyChannelName(label: string): string {
  // The 64-char cap comes BEFORE the leading/trailing-underscore trim, not
  // after. `/^_+|_+$/` backtracks quadratically on a long run of underscores
  // (the engine retries `_+$` from every position), and every character of
  // `label` is user input; truncating first bounds that work to a constant no
  // matter how long the label is. The result is unchanged for any label the
  // cap does not truncate, and for one it does the trim still runs — so a
  // truncated slug can never end in the underscore the trim exists to remove.
  const slug = label
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .slice(0, 64)
    .replace(/^_+|_+$/g, '');
  if (!CHANNEL_NAME_RE.test(slug)) {
    throw new Error(
      'Channel name must contain at least one letter, digit, underscore or dash'
    );
  }
  return slug;
}

/** First unique ``base``/``base_2``/``base_3`` … not already in ``used``. */
export function uniqueName(base: string, used: Set<string>): string {
  if (!used.has(base)) {
    return base;
  }
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base}_${i}`.slice(0, 64);
    if (!used.has(candidate)) {
      return candidate;
    }
  }
  // Practically unreachable; fall back to a random suffix.
  return `${base}_${randomUUID().slice(0, 6)}`.slice(0, 64);
}

/** Absolute path of a frame's channel PNG under the upload root. */
function frameChannelAbs(
  projectId: string,
  containerId: string,
  frameIndex: number,
  channelName: string
): string {
  return path.join(
    config.UPLOAD_DIR,
    frameStorageKey(projectId, containerId, frameIndex, channelName)
  );
}

/**
 * Decode the uploaded source into a temp ``frames/<j>/<channel>.png`` layout
 * plus the list of its channels. For a plain image (png/jpg) this is a single
 * grayscale frame; for a video/stack/ND2 it delegates to the shared extractor.
 */
async function extractSource(
  originalName: string,
  tempFilePath: string,
  tempDir: string
): Promise<{
  frameCount: number;
  width: number;
  height: number;
  /** Machine channel names as written on disk under frames/<j>/. */
  channelNames: string[];
  /** Parallel metadata for building the final ChannelMeta. */
  channelMeta: ChannelMeta[];
}> {
  const isVideoLike = detectVideoKind(originalName) !== null;

  if (isVideoLike) {
    const outcome = await extractVideoSafe(tempFilePath, tempDir, {
      registerChannels: false,
    });
    if (outcome.kind === 'multi') {
      throw new Error(
        'A multi-position ND2 cannot be added as a channel. Upload a single-position video, stack, or image.'
      );
    }
    const r = outcome.result;
    return {
      frameCount: r.frameCount,
      width: r.width,
      height: r.height,
      channelNames: r.channels.map(c => c.name),
      channelMeta: r.channels,
    };
  }

  // Single image → one grayscale frame at frames/0000/ch0.png.
  const framesDir = path.join(tempDir, 'frames', '0000');
  await fs.mkdir(framesDir, { recursive: true });
  const meta = await sharp(tempFilePath, { unlimited: true }).metadata();
  if (!meta.width || !meta.height) {
    throw new Error('Could not read image dimensions from the uploaded file');
  }
  await sharp(tempFilePath, { unlimited: true })
    .grayscale()
    .png()
    .toFile(path.join(framesDir, 'ch0.png'));
  return {
    frameCount: 1,
    width: meta.width,
    height: meta.height,
    channelNames: ['ch0'],
    channelMeta: [
      {
        name: 'ch0',
        type: 'fluorescent',
        isSegmentationSource: false,
      },
    ],
  };
}

/**
 * Core entry point. Assumes the caller has already verified project access.
 * Always removes ``tempFilePath`` and the temp extraction dir before returning
 * (success or throw).
 */
export async function addChannelToFrames(
  params: AddChannelParams
): Promise<AddChannelResult> {
  const {
    projectId,
    originalName,
    tempFilePath,
    channelName,
    align,
    imageIds,
  } = params;

  const baseSlug = slugifyChannelName(channelName);
  const displayBase = channelName.trim().slice(0, MAX_DISPLAY_NAME_LEN);

  // mkdtemp, not join-then-mkdir: it creates the directory ATOMICALLY with
  // mode 0700 and a name the caller cannot predict. `mkdir(recursive: true)`
  // does neither — it succeeds against a path that already exists, including a
  // symlink another user of the shared /tmp planted there, and everything the
  // extraction writes would follow it. Created before the try/finally so the
  // cleanup below can never run against a directory this call did not make.
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'add-channel-'));

  try {
    // 1. Project must be a microtubule project.
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, type: true },
    });
    if (!project || !isMicrotubuleProject(project.type)) {
      throw new Error('Add channel is only available for microtubule projects');
    }
    // Storage paths are built from the ROW's id, never from the URL segment
    // that found it. The two are equal on every legitimate request, so nothing
    // observable changes — but a value that came back out of Postgres cannot
    // carry a `../`, which means the traversal guard inside frameStorageKey is
    // no longer the only thing standing between a crafted :id and the uploads
    // volume. Same reasoning as EssaysService.rerunJob.
    const storageProjectId = project.id;

    // 2. Load the selected frames (video-frame rows only) and group by video.
    if (!Array.isArray(imageIds) || imageIds.length === 0) {
      throw new Error('No images selected');
    }
    const rows = await prisma.image.findMany({
      where: { id: { in: imageIds }, projectId },
      select: {
        id: true,
        parentVideoId: true,
        frameIndex: true,
        isVideoContainer: true,
      },
    });
    const byContainer = new Map<string, TargetFrame[]>();
    for (const r of rows) {
      if (
        r.isVideoContainer ||
        r.parentVideoId == null ||
        r.frameIndex == null
      ) {
        continue;
      }
      const list = byContainer.get(r.parentVideoId) ?? [];
      list.push({ id: r.id, frameIndex: r.frameIndex });
      byContainer.set(r.parentVideoId, list);
    }
    if (byContainer.size === 0) {
      throw new Error(
        'Select video frames to add a channel to (standalone images are not supported)'
      );
    }
    const selectedCount = [...byContainer.values()].reduce(
      (n, l) => n + l.length,
      0
    );
    // Deterministic pairing order.
    for (const list of byContainer.values()) {
      list.sort((a, b) => a.frameIndex - b.frameIndex);
    }

    // 3. Decode the uploaded source. (tempDir already exists — see mkdtemp.)
    const source = await extractSource(originalName, tempFilePath, tempDir);

    // 4. Coverage rules for a multi-frame (video/stack) source.
    if (source.frameCount > 1) {
      if (byContainer.size > 1) {
        throw new Error(
          'A multi-frame video can only be added to frames of a single video. Select frames from one video, or upload a single image.'
        );
      }
      if (source.frameCount !== selectedCount) {
        throw new Error(
          `Frame count mismatch: the uploaded video has ${source.frameCount} frames but ${selectedCount} frames are selected. They must match.`
        );
      }
    }

    // 5. Load affected containers (channels + dimensions + seg source).
    const containers = await prisma.image.findMany({
      where: { id: { in: [...byContainer.keys()] }, projectId },
      select: {
        id: true,
        channels: true,
        width: true,
        height: true,
        frameCount: true,
      },
    });
    const containerById = new Map(containers.map(c => [c.id, c]));

    // 6. Dimension check — an added channel must share the frames' pixel grid.
    for (const c of containers) {
      if (
        c.width != null &&
        c.height != null &&
        (c.width !== source.width || c.height !== source.height)
      ) {
        throw new Error(
          `Dimension mismatch: the source is ${source.width}×${source.height} but the target video is ${c.width}×${c.height}. Channels must share the same pixel grid.`
        );
      }
    }

    // 7. Write PNGs (copy, or collect alignment jobs) + build ChannelMeta per
    //    container. Names are resolved against each container's existing set.
    const alignJobs: ChannelAlignJob[] = [];
    /** Parallel to `alignJobs`: which (container, channel, frame) each job
     *  belongs to. The helper returns shifts positionally, and jobs from every
     *  container and channel share one batched call, so without this the rows
     *  cannot be attributed back — and a static channel needs its per-frame
     *  shift to project one segmentation onto the other frames. */
    const alignJobOwner: Array<{
      containerId: string;
      channelIndex: number;
      frameId: string;
    }> = [];
    const newChannelsByContainer = new Map<string, ChannelMeta[]>();
    const addedChannelNames = new Set<string>();
    let framesWritten = 0;

    for (const [containerId, frames] of byContainer) {
      const container = containerById.get(containerId);
      if (!container) {
        continue;
      }
      const existing: ChannelMeta[] = Array.isArray(container.channels)
        ? (container.channels as unknown as ChannelMeta[])
        : [];
      const usedNames = new Set(existing.map(c => c.name));
      const segSourceName =
        existing.find(c => c.isSegmentationSource)?.name ??
        existing[0]?.name ??
        null;
      if (align && !segSourceName) {
        throw new Error(
          'Cannot align: the target video has no channels to align against'
        );
      }

      // Coverage: the selected frame ids for THIS container. Omitted (=> full
      // coverage) when the selection is every frame of the container, keeping
      // the channels JSON compact for the common "add to the whole video" case.
      const targetFrameIds = frames.map(f => f.id);
      const fullCoverage =
        container.frameCount != null &&
        targetFrameIds.length >= container.frameCount;
      const coverageIds = fullCoverage ? undefined : targetFrameIds;

      const finalMeta: ChannelMeta[] = [];
      source.channelMeta.forEach((srcMeta, ci) => {
        const multi = source.channelMeta.length > 1;
        const finalName = uniqueName(
          multi ? `${baseSlug}_${ci + 1}`.slice(0, 64) : baseSlug,
          usedNames
        );
        usedNames.add(finalName);
        const displayName = (
          multi
            ? `${displayBase} (${srcMeta.displayName ?? srcMeta.name})`
            : displayBase
        ).slice(0, MAX_DISPLAY_NAME_LEN);
        finalMeta.push({
          name: finalName,
          displayName,
          type: 'fluorescent',
          isSegmentationSource: false,
          pngBacked: true,
          // A single source image stamped onto every covered frame: every
          // frame shows the SAME picture, so segmenting it per frame repeats
          // one piece of work N times. Recorded here rather than re-derived
          // later, because after the PNGs are written the two cases are
          // indistinguishable without comparing pixels.
          ...(source.frameCount === 1 ? { staticSource: true } : {}),
          ...(coverageIds ? { frameIds: coverageIds } : {}),
          wavelengthNm: srcMeta.wavelengthNm,
          displayColor:
            srcMeta.displayColor ??
            defaultColorForWavelength(srcMeta.wavelengthNm),
        });
        addedChannelNames.add(finalName);
      });
      newChannelsByContainer.set(containerId, finalMeta);

      // Write / queue one PNG per (target frame × source channel).
      for (let fi = 0; fi < frames.length; fi++) {
        const target = frames[fi];
        // Single-image source → always source frame 0; multi-frame → paired.
        const sourceFrameIndex = source.frameCount > 1 ? fi : 0;
        const srcFrameDir = String(sourceFrameIndex).padStart(4, '0');

        for (let ci = 0; ci < source.channelMeta.length; ci++) {
          const srcName = source.channelNames[ci];
          const finalName = finalMeta[ci].name;
          const moving = path.join(
            tempDir,
            'frames',
            srcFrameDir,
            `${srcName}.png`
          );
          const outAbs = frameChannelAbs(
            storageProjectId,
            containerId,
            target.frameIndex,
            finalName
          );
          await fs.mkdir(path.dirname(outAbs), { recursive: true });

          if (align && segSourceName) {
            alignJobs.push({
              moving,
              reference: frameChannelAbs(
                storageProjectId,
                containerId,
                target.frameIndex,
                segSourceName
              ),
              out: outAbs,
            });
            alignJobOwner.push({
              containerId,
              channelIndex: ci,
              frameId: target.id,
            });
          } else {
            await fs.copyFile(moving, outAbs);
          }
          framesWritten++;
        }
      }
    }

    // 8. Run alignment (single batched Python call) if requested.
    //    The helper never fails a frame: an estimate it cannot trust becomes a
    //    (0, 0) no-op and the frame is copied through unshifted. So its
    //    ``aligned`` count is just the job count and says nothing about
    //    whether registration worked — only the per-frame shifts do.
    let alignment: ChannelAlignmentSummary | undefined;
    if (align && alignJobs.length > 0) {
      const manifestPath = path.join(tempDir, 'align_manifest.json');
      await fs.writeFile(
        manifestPath,
        JSON.stringify({ jobs: alignJobs }),
        'utf-8'
      );
      const res = await alignChannelFrames(manifestPath);
      alignment = summarizeAlignment(res.shifts);

      // Attribute each shift back to the frame it moved, so a static channel
      // can later project ONE segmentation onto its other frames instead of
      // segmenting each. Only static channels need this: for a paired
      // video/stack every frame carries different pixels anyway, and storing
      // a shift per frame there would be a large map nothing reads.
      recordStaticShifts(
        res.shifts,
        alignJobOwner,
        newChannelsByContainer,
        containerId => logger.warn(
          `Add-channel: no channel metadata for container ${containerId} while recording static shifts`,
          'AddChannelService'
        )
      );

      const logData = {
        jobs: alignJobs.length,
        ...alignment,
        minConfidence: MIN_ALIGN_CONFIDENCE,
      };

      if (alignment.frames !== alignJobs.length) {
        // Should not happen; the helper emits one entry per job. If it ever
        // does, the summary describes fewer frames than were written.
        logger.warn(
          `Add-channel alignment reported ${alignment.frames} frame(s) for ${alignJobs.length} job(s) — the summary below covers only the reported frames`,
          'AddChannelService',
          logData
        );
      }

      // The reason breakdown is appended only when the helper actually
      // reported reasons; against an older helper the line stays exactly as it
      // was rather than implying a certainty we do not have.
      logger.info(
        `Add-channel alignment: ${alignment.shifted}/${alignment.frames} frame(s) shifted, ` +
          `${alignment.rejected} rejected (confidence < ${MIN_ALIGN_CONFIDENCE}), ` +
          `${alignment.zeroShift} zero-shift (already aligned or rejected as implausible)` +
          (alignment.reasonsReported
            ? ` — per-frame reasons: ${formatAlignReasons(alignment.reasons)}`
            : ''),
        'AddChannelService',
        logData
      );

      if (alignment.failedFraction >= ALIGN_REJECTED_WARN_FRACTION) {
        logger.warn(
          `Add-channel alignment FAILED for most frames: ${alignment.failed}/${alignment.frames} ` +
            `frame(s) were written UNSHIFTED. ${alignFailureCause(alignment)} ` +
            `The channel was still added; its frames are simply not registered to the ` +
            `segmentation source.`,
          'AddChannelService',
          logData
        );
      }
    }

    // 9. Append new channels to each container's channels JSON (transaction).
    await prisma.$transaction(
      [...newChannelsByContainer.entries()].map(([containerId, added]) => {
        const container = containerById.get(containerId);
        const existing: ChannelMeta[] = Array.isArray(container?.channels)
          ? (container!.channels as unknown as ChannelMeta[])
          : [];
        return prisma.image.update({
          where: { id: containerId },
          data: {
            channels: [...existing, ...added] as unknown as object,
          },
        });
      })
    );

    logger.info('Channel added to selected frames', 'AddChannelService', {
      projectId,
      containers: byContainer.size,
      addedChannels: [...addedChannelNames],
      framesWritten,
      align,
      ...(alignment ? { alignedFrames: alignment.shifted } : {}),
    });

    return {
      addedChannels: [...addedChannelNames],
      affectedContainerIds: [...byContainer.keys()],
      framesWritten,
      ...(alignment ? { alignment } : {}),
    };
  } finally {
    await fs.rm(tempFilePath, { force: true }).catch(() => undefined);
    await fs
      .rm(tempDir, { recursive: true, force: true })
      .catch(() => undefined);
  }
}
