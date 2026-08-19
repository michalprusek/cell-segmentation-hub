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
import { ChannelMeta, defaultColorForWavelength } from './video/types';
import { isMicrotubuleProject } from '../types/validation';
import { detectVideoKind, extractVideoSafe } from './video/videoExtractor';
import { alignChannelFrames, ChannelAlignJob } from './video/pythonExtractor';
import { frameStorageKey } from './videoUploadService';

const CHANNEL_NAME_RE = /^[A-Za-z0-9_-]{1,64}$/;
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
 * Fraction of frames whose estimate was rejected above which the run is
 * reported at ``warn``. Rationale: ``_MIN_CONFIDENCE`` already vets each frame
 * individually, so a handful of rejections (a dark or out-of-focus frame) is
 * expected noise on an otherwise good pair. A *majority* of frames failing is
 * not noise — it is the signature of a channel pair that shares no
 * correlatable structure, i.e. registration that cannot work at all.
 */
export const ALIGN_REJECTED_WARN_FRACTION = 0.5;

/**
 * What the aligner actually did, derived from the helper's per-frame
 * ``[dy, dx, confidence]`` triples.
 *
 * Classification (see ``channel_registration.estimate_translation``): a
 * rejected estimate returns ``(0, 0, confidence)`` — the confidence survives,
 * only the shift is zeroed — so a weak correlation IS distinguishable from a
 * real zero shift. What is NOT distinguishable from the helper's output alone
 * is a *trusted* peak at the origin (channels already aligned — a success)
 * from a peak rejected for exceeding ``_MAX_SHIFT_FRACTION`` (a failure):
 * both surface as ``[0, 0, <high confidence>]``. Those share the
 * ``zeroShift`` bucket and are labelled ambiguous rather than counted as
 * either.
 */
export interface ChannelAlignmentSummary {
  /** Frames the helper reported on (target frames × source channels). */
  frames: number;
  /** Frames that received a non-zero translation — actually registered. */
  shifted: number;
  /**
   * Frames whose estimate was too weak to trust (confidence below
   * {@link MIN_ALIGN_CONFIDENCE}) and were therefore copied unshifted. A
   * shape mismatch (helper emits ``[0, 0, 0.0]``) also lands here.
   */
  rejected: number;
  /**
   * Frames with a trusted peak at the origin: either already aligned (nothing
   * to correct) or an implausibly large peak rejected by
   * ``_MAX_SHIFT_FRACTION``. The helper's output cannot separate the two.
   */
  zeroShift: number;
  /** ``rejected / frames``, 0..1, rounded to 3 decimals. */
  rejectedFraction: number;
  /** Peak-to-background confidence spread; null when no frames were reported. */
  confidence: { min: number; median: number; max: number } | null;
  /** Largest translation actually applied, per axis (absolute pixels). */
  maxAbsShift: { dy: number; dx: number };
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * Turn the helper's raw per-frame shifts into a summary of what happened.
 * Pure, and exported so the reporting can be tested without running Python.
 */
export function summarizeAlignment(
  shifts: ReadonlyArray<readonly [number, number, number]> | undefined
): ChannelAlignmentSummary {
  const rows = shifts ?? [];

  let shifted = 0;
  let rejected = 0;
  let zeroShift = 0;
  let maxDy = 0;
  let maxDx = 0;
  const confidences: number[] = [];

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

  const frames = rows.length;
  return {
    frames,
    shifted,
    rejected,
    zeroShift,
    rejectedFraction: frames > 0 ? round3(rejected / frames) : 0,
    confidence,
    maxAbsShift: { dy: maxDy, dx: maxDx },
  };
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
  const slug = label
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
  if (!CHANNEL_NAME_RE.test(slug)) {
    throw new Error(
      'Channel name must contain at least one letter, digit, underscore or dash'
    );
  }
  return slug;
}

/** First unique ``base``/``base_2``/``base_3`` … not already in ``used``. */
export function uniqueName(base: string, used: Set<string>): string {
  if (!used.has(base)) return base;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base}_${i}`.slice(0, 64);
    if (!used.has(candidate)) return candidate;
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
  const { projectId, originalName, tempFilePath, channelName, align, imageIds } =
    params;

  const baseSlug = slugifyChannelName(channelName);
  const displayBase = channelName.trim().slice(0, MAX_DISPLAY_NAME_LEN);

  const tempDir = path.join(os.tmpdir(), `add-channel-${randomUUID()}`);

  try {
    // 1. Project must be a microtubule project.
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { type: true },
    });
    if (!isMicrotubuleProject(project?.type)) {
      throw new Error('Add channel is only available for microtubule projects');
    }

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
      if (r.isVideoContainer || r.parentVideoId == null || r.frameIndex == null) {
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

    // 3. Decode the uploaded source.
    await fs.mkdir(tempDir, { recursive: true });
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
    const newChannelsByContainer = new Map<string, ChannelMeta[]>();
    const addedChannelNames = new Set<string>();
    let framesWritten = 0;

    for (const [containerId, frames] of byContainer) {
      const container = containerById.get(containerId);
      if (!container) continue;
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
            projectId,
            containerId,
            target.frameIndex,
            finalName
          );
          await fs.mkdir(path.dirname(outAbs), { recursive: true });

          if (align && segSourceName) {
            alignJobs.push({
              moving,
              reference: frameChannelAbs(
                projectId,
                containerId,
                target.frameIndex,
                segSourceName
              ),
              out: outAbs,
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

      logger.info(
        `Add-channel alignment: ${alignment.shifted}/${alignment.frames} frame(s) shifted, ` +
          `${alignment.rejected} rejected (confidence < ${MIN_ALIGN_CONFIDENCE}), ` +
          `${alignment.zeroShift} zero-shift (already aligned or rejected as implausible)`,
        'AddChannelService',
        logData
      );

      if (alignment.rejectedFraction >= ALIGN_REJECTED_WARN_FRACTION) {
        logger.warn(
          `Add-channel alignment FAILED for most frames: ${alignment.rejected}/${alignment.frames} ` +
            `estimate(s) were too weak to trust (peak-to-background confidence < ${MIN_ALIGN_CONFIDENCE}) ` +
            `and those frames were written UNSHIFTED. Likely cause: this channel pair does not ` +
            `correlate — cross-modality channels (e.g. IRM vs fluorescence) correlate poorly, and a ` +
            `pair with no shared structure cannot be registered at all. The channel was still added; ` +
            `its frames are simply not registered to the segmentation source.`,
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
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
