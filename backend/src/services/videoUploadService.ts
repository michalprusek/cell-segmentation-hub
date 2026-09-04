/**
 * Service that owns the per-upload video flow:
 *
 *   multer temp file → rename into projects/<pid>/images/<vid>/original.<ext>
 *   → extractVideoSafe → one container Image row + N child frame Image rows
 *   + thumbnail.
 *
 * The controller routes a file here when the extension matches a video
 * format (mp4/avi/mov/mkv/webm/nd2 or a multi-page TIFF). Static-image
 * uploads keep going through imageService unchanged.
 *
 * **Multi-position ND2** (well-plate / multipoint acquisitions) fan out into
 * *several* containers — one per XY position — because each position is a
 * distinct field of view, not a time frame. The pre-created container row is
 * reused as position 0; positions 1..N-1 get fresh container rows. All
 * positions share the single ``original.nd2`` stored under position 0's dir
 * (copying an 800 MB source N times would be wasteful), so their
 * ``originalPath`` points there.
 *
 * Failure handling guarantees:
 *
 *   - If any step in the happy path throws, every container row created for
 *     this upload is updated to ``segmentationStatus='extraction_failed'``
 *     AND its directory under projects/<pid>/images/<vid>/ is removed so
 *     retrying starts from a clean slate.
 *   - The multer-supplied temp file is always removed, even on success
 *     (renamed into the canonical location).
 *   - If a secondary "mark as failed" Prisma update itself fails, that error
 *     is logged at ``error`` level with the container ID so ops can find
 *     stuck-in-pending rows.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import sharp from 'sharp';
import { prisma } from '../db/prismaClient';
import { config } from '../utils/config';
import { logger } from '../utils/logger';
import { assertSafeStorageSegment } from '../utils/storagePath';
import { extractVideoSafe } from './video/videoExtractor';
import {
  EXIT_DRIFT_REWRITE_FAILED,
  correctDriftInContainer,
} from './video/pythonExtractor';
import type { HelperExitError } from './video/pythonExtractor';
import { isMicrotubuleProject } from '../types/validation';
import { isSafeChannelName, resolveSegmentationSource } from './video/types';
import type {
  ChannelMeta,
  ExtractedPosition,
  ExtractionProgress,
  ExtractionResult,
  ProgressCallback,
} from './video/types';

export interface VideoUploadProgressEvent {
  videoContainerId: string;
  filename: string;
  phase: 'saving' | 'extracting' | 'persisting' | 'completed' | 'failed';
  progress: number;
  /** Human-readable English phase name. RETAINED, but it is a fallback: the
   *  server has no idea what locale the browser is in, so composing the
   *  user-visible sentence here can only ever produce English. `messageKey`
   *  is what the card actually renders. */
  message?: string;
  /** Translation key naming the phase, resolved in the browser. */
  messageKey?: string;
  messageParams?: Record<string, string | number>;
  error?: string;
}

export type VideoProgressCallback = (event: VideoUploadProgressEvent) => void;

export interface VideoUploadResult {
  /** Primary container — position 0 for a multi-position upload, or the sole
   *  container otherwise. */
  containerId: string;
  frameCount: number;
  channels: ChannelMeta[];
  /** Number of XY positions split out (1 for ordinary single-video uploads). */
  positionCount: number;
  /** All container IDs created by this upload, in position order. */
  containerIds: string[];
}

/** Storage-key prefix (relative to UPLOAD_DIR) under which a container
 *  and its extracted frames live. This is what gets persisted to
 *  Image.originalPath / thumbnailPath so `storage.getUrl(path)` resolves
 *  correctly to `/uploads/projects/<pid>/images/<cid>/...`. */
function videoContainerStorageKey(
  projectId: string,
  containerId: string
): string {
  return path.posix.join(
    'projects',
    assertSafeStorageSegment(projectId, 'projectId'),
    'images',
    assertSafeStorageSegment(containerId, 'containerId')
  );
}

/** Absolute filesystem path for the container directory — UPLOAD_DIR
 *  prepended to the storage key. Used for `mkdir`, `rm`, sharp/extract
 *  I/O. Stays in node `path` (OS separators) so Windows dev still works. */
function videoContainerDir(projectId: string, containerId: string): string {
  return path.join(
    config.UPLOAD_DIR,
    'projects',
    assertSafeStorageSegment(projectId, 'projectId'),
    'images',
    assertSafeStorageSegment(containerId, 'containerId')
  );
}

/** Frame-relative storage key, persisted as the child Image's
 *  ``originalPath``. Points at the segmentation source channel for now;
 *  consumers that need a different channel build their own URL via the
 *  /frame-data?channel=X route. */
export function frameStorageKey(
  projectId: string,
  containerId: string,
  frameIndex: number,
  channelName: string
): string {
  return path.posix.join(
    videoContainerStorageKey(projectId, containerId),
    'frames',
    String(frameIndex).padStart(4, '0'),
    `${assertSafeStorageSegment(channelName, 'channel')}.png`
  );
}

/** Human label for one XY position: the ND2 point name when present (e.g.
 *  ``"D03_0000"``), otherwise a 1-based ordinal. */
function positionLabel(pos: ExtractedPosition): string {
  const name = pos.positionName?.trim();
  return name && name.length > 0 ? name : `position ${pos.positionIndex + 1}`;
}

async function generateContainerThumbnail(
  framesRoot: string,
  defaultChannel: string,
  outPath: string,
  /** Frame to draw the thumbnail from. Almost always 0; a sparse channel whose
   *  first real acquisition is later says so, because a thumbnail rendered from
   *  a gap frame is a black square. */
  frameIndex = 0
): Promise<void> {
  const firstFrameDir = path.join(
    framesRoot,
    String(frameIndex).padStart(4, '0')
  );
  let listedFiles: string[] = [];
  try {
    listedFiles = await fs.readdir(firstFrameDir);
  } catch (err) {
    logger.warn(
      `Cannot list first-frame dir for thumbnail: ${(err as Error).message}`,
      'VideoUploadService',
      { firstFrameDir }
    );
  }
  const candidates = [
    path.join(firstFrameDir, `${defaultChannel}.png`),
    ...listedFiles
      .filter(f => f.endsWith('.png'))
      .map(f => path.join(firstFrameDir, f)),
  ];
  for (const candidate of candidates) {
    try {
      await sharp(candidate)
        .resize(300, 300, { fit: 'inside' })
        .jpeg({ quality: 85 })
        .toFile(outPath);
      return;
    } catch (err) {
      logger.warn(
        `Thumbnail candidate failed: ${candidate} (${(err as Error).message})`,
        'VideoUploadService'
      );
    }
  }
  throw new Error(
    `Failed to generate thumbnail from any frame in ${firstFrameDir}`
  );
}

/** Move (rename) the multer temp file into ``destPath``. Falls back to
 *  copy+unlink if the rename crosses filesystems (EXDEV). */
async function moveFile(srcPath: string, destPath: string): Promise<void> {
  try {
    await fs.rename(srcPath, destPath);
    return;
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code !== 'EXDEV') {
      throw err;
    }
    await fs.copyFile(srcPath, destPath);
    await fs.unlink(srcPath).catch(() => undefined);
  }
}

/** Move a directory tree (rename; copy+rm fallback across filesystems).
 *  Used to relocate a position's ``frames`` subtree into its container. */
async function moveDir(srcDir: string, destDir: string): Promise<void> {
  await fs.mkdir(path.dirname(destDir), { recursive: true });
  try {
    await fs.rename(srcDir, destDir);
    return;
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code !== 'EXDEV') {
      throw err;
    }
    await fs.cp(srcDir, destDir, { recursive: true });
    await fs
      .rm(srcDir, { recursive: true, force: true })
      .catch(() => undefined);
  }
}

/**
 * Add `sparseFillFrameIds` to every channel the extractor flagged sparse.
 *
 * The extractor works in frame INDICES because that is all it has: the child
 * `Image` rows a frame id would name do not exist until `createMany` has run.
 * The editor, on the other hand, only ever holds ids — `resolveFrameId` is
 * handed a frame id and a channel name and nothing else — so it needs the same
 * map in id space to point a gap frame's URL and decode-cache key at the frame
 * it actually reads from.
 *
 * Returns the channel list unchanged (same objects) when nothing is sparse,
 * which is every ordinary upload, and costs no query in that case.
 */
async function withSparseFrameIds(
  containerId: string,
  channels: ChannelMeta[]
): Promise<ChannelMeta[]> {
  const sparse = channels.filter(
    c => c.sparseSource === true && c.sparseFill !== undefined
  );
  if (sparse.length === 0) {
    return channels;
  }

  const rows = await prisma.image.findMany({
    where: { parentVideoId: containerId },
    select: { id: true, frameIndex: true },
  });
  const idByIndex = new Map<number, string>();
  for (const r of rows) {
    if (r.frameIndex !== null) {
      idByIndex.set(r.frameIndex, r.id);
    }
  }

  return channels.map(c => {
    if (c.sparseSource !== true || !c.sparseFill) {
      return c;
    }
    const byFrameId: Record<string, string> = {};
    let unresolved = 0;
    for (const [gapIndex, anchorIndex] of Object.entries(c.sparseFill)) {
      const gapId = idByIndex.get(Number(gapIndex));
      const anchorId = idByIndex.get(anchorIndex);
      // A gap we cannot name in id space is simply left out: the frame-data
      // route still resolves it from `sparseFill` (which is index-keyed), so
      // the picture is right either way — the editor just pays for a second
      // copy of the same bytes. Never guess an id.
      if (gapId === undefined || anchorId === undefined) {
        unresolved++;
        continue;
      }
      byFrameId[gapId] = anchorId;
    }
    if (unresolved > 0) {
      logger.warn(
        `Sparse channel '${c.name}': ${unresolved} of ${Object.keys(c.sparseFill).length} gap frames have no Image row; their editor requests will not be de-duplicated`,
        'VideoUploadService',
        { containerId }
      );
    }
    return { ...c, sparseFillFrameIds: byFrameId };
  });
}

/** Remove stage drift from one finished container, driven by the channel the
 *  measurements live on.
 *
 *  Runs here rather than inside the extractor because that channel is only
 *  resolved by `buildChannelMeta` once extraction has returned, and picking the
 *  wrong one is not cosmetic: on a motility assay a fluorescence channel
 *  measures filament gliding, so de-drifting on it would subtract the very
 *  signal the experiment records. Across 65 production microtubule containers
 *  the source is channel 0 on only 45; on the SEVEN where channel 0 is TIRF and
 *  the source is IRM, the two trajectories disagree by up to 28 px, and on two
 *  of them the choice flips whether any correction runs at all.
 *
 *  Non-fatal for everything that leaves the pixels ALONE — an estimate that
 *  declines, or a helper that fails before touching a frame, is an optional
 *  improvement not taken, and losing an hour of ND2 extraction to it would be
 *  the wrong trade.
 *
 *  FATAL when the helper fails after it has started rewriting. The Python side
 *  deliberately does not catch that ("a half-corrected stack is worse than an
 *  uncorrected one"), and swallowing it here cancelled exactly that intent:
 *  verified by injecting ENOSPC at the 21st save of a 40-frame stack — 10
 *  frames de-drifted, 30 untouched, no composed sidecar, and the upload still
 *  returned 200 with "frames left uncorrected" in the log. Frames either side
 *  of that seam are in different coordinate spaces and every cross-frame
 *  consumer — tracking, kymographs, MT metrics — measures across it silently.
 *  A rolled-back upload the user can retry is strictly better.
 */
async function correctDriftForContainer(
  containerDir: string,
  channels: { name: string; isSegmentationSource?: boolean }[],
  onProgress?: ProgressCallback
): Promise<void> {
  const source = resolveSegmentationSource(channels);
  if (!source) {
    return;
  }
  try {
    await correctDriftInContainer(
      containerDir,
      channels.map(c => c.name),
      source,
      onProgress
    );
  } catch (err) {
    // A KILLED helper (SIGKILL from the cgroup OOM killer is the realistic
    // one on this deployment) never gets to report anything, so it cannot tell
    // us whether it had started rewriting. Treated as fatal for the same reason
    // exit 4 is: the cost of rolling back an upload that was actually fine is a
    // retry, and the cost of keeping a seam-corrupted one is silently wrong
    // measurements nobody can detect.
    const failure = err as HelperExitError;
    if (
      failure?.exitCode === EXIT_DRIFT_REWRITE_FAILED ||
      failure?.signal !== undefined
    ) {
      // Pixels have already moved. Let this reach `uploadVideoFromFile`'s
      // catch so cleanupOnFailure runs and the container is rolled back.
      logger.error(
        `Drift correction failed for ${containerDir} at a point where frames ` +
          'may already have been rewritten: they would be in mixed coordinate ' +
          'spaces with registration.json not composed. Rolling the upload back ' +
          'rather than keeping a container whose cross-frame measurements are ' +
          'silently wrong.',
        err instanceof Error ? err : new Error(String(err)),
        'VideoUploadService',
        { containerDir, source }
      );
      throw err;
    }
    // Everything else left the frames untouched, so the upload is still good.
    logger.warn(
      `Drift correction declined for ${containerDir}; frames left uncorrected`,
      'VideoUploadService',
      { error: err instanceof Error ? err.message : String(err) }
    );
  }
}

/**
 * Finalize one video container: pick the default (segmentation-source)
 * channel, generate a thumbnail from its first frame, create the child
 * frame Image rows, and stamp the container row with its metadata. Shared
 * by the single-position and per-position paths so they stay in lockstep.
 *
 * Frames must already be on disk at ``<baseDir>/frames/<TTTT>/<channel>.png``.
 */
async function finalizeContainer(params: {
  containerId: string;
  baseDir: string;
  projectId: string;
  displayName: string;
  result: ExtractionResult;
  /** Storage key of this container's original file. Each container owns its
   *  original (a single-position TIFF for split positions, or the source
   *  file for an ordinary single-position upload). */
  originalStorageKey: string;
  /** When set, overwrite the container's fileSize/mimeType — used by the
   *  multi-position path where each container's real original is its own
   *  per-position TIFF, not the create-time source file. */
  fileSize?: number;
  mimeType?: string;
}): Promise<void> {
  const { containerId, baseDir, projectId, displayName, result } = params;

  // Every channel name lands in the DB's `channels` JSON — read back and
  // whitelisted against `isSafeChannelName` by videoController's read/PATCH
  // gates — and becomes a PNG filename on disk. `assertSafeStorageSegment`
  // below only guards the DEFAULT channel against path traversal; it has no
  // length or charset cap, so it happily accepts a name the read gate will
  // later reject with 400. Validate EVERY channel here, before any of them
  // reach a thumbnail read, a frame storage key, or the DB, and fail the
  // upload loudly rather than persist a container the read side can never
  // serve back (see the 2026-08-26 Institut Curie incident: a Fiji/
  // Bio-Formats TIFF export embedded a ~140-char source filename in every
  // channel's per-slice label; nine containers, 148 frames, went silently
  // unreadable).
  for (const ch of result.channels) {
    if (!isSafeChannelName(ch.name)) {
      throw new Error(
        `Extractor produced an invalid channel name: "${ch.name}" — must be ` +
          '1-64 chars of [A-Za-z0-9_-]. Refusing to persist a container the ' +
          'read gate could never serve back.'
      );
    }
  }

  // Channel names originate in source metadata (ND2/OME-TIFF); guard before
  // they reach the thumbnail read-path and the frame storage keys.
  const defaultChannel = assertSafeStorageSegment(
    resolveSegmentationSource(result.channels) ?? 'video',
    'channel'
  );

  // If the default channel is one the microscope only refreshed every N-th
  // frame, frame 0 may be a gap — draw the thumbnail from the frame that gap
  // reads from instead of from a black plane. Note this covers a gap in ONE
  // channel, not a frame 0 that was never acquired in any channel (an aborted
  // or late-started run): the extractor records no fill for those on purpose,
  // so such a container still thumbnails black exactly as it does today.
  const defaultMeta = result.channels.find(c => c.name === defaultChannel);
  const thumbFrameIndex = defaultMeta?.sparseFill?.['0'] ?? 0;

  const thumbnailPath = path.join(baseDir, 'thumbnail.jpg');
  await generateContainerThumbnail(
    path.join(baseDir, 'frames'),
    defaultChannel,
    thumbnailPath,
    thumbFrameIndex
  );

  const frameRows = Array.from({ length: result.frameCount }, (_, i) => ({
    name: `${displayName} (frame ${i + 1})`,
    originalPath: frameStorageKey(projectId, containerId, i, defaultChannel),
    thumbnailPath: null,
    projectId,
    width: result.width || null,
    height: result.height || null,
    mimeType: 'image/png',
    displayOrder: i,
    segmentationStatus: 'no_segmentation',
    parentVideoId: containerId,
    frameIndex: i,
    isVideoContainer: false,
  }));
  if (frameRows.length > 0) {
    await prisma.image.createMany({ data: frameRows });
  }

  // Mirror every sparse channel's index-space gap map into id space, now that
  // the frame rows exist. The extractor can only ever report INDICES — the rows
  // it would need to name are created three lines above it — so this is the one
  // place the two representations are written, and therefore the one place they
  // could disagree.
  const channelsForDb = await withSparseFrameIds(containerId, result.channels);

  const containerKey = videoContainerStorageKey(projectId, containerId);
  await prisma.image.update({
    where: { id: containerId },
    data: {
      name: displayName,
      originalPath: params.originalStorageKey,
      thumbnailPath: path.posix.join(containerKey, 'thumbnail.jpg'),
      width: result.width || null,
      height: result.height || null,
      frameCount: result.frameCount,
      videoDurationMs: result.durationMs ?? null,
      // Calibration extracted from the upload (ND2 voxel_size /
      // OME-TIFF Pixels / ImageJ finterval). Both null when the source
      // carries no metadata — the export modal lets users override.
      pixelSizeUm: result.pixelSizeUm ?? null,
      frameIntervalMs: result.frameIntervalMs ?? null,
      channels: channelsForDb as unknown as object,
      segmentationStatus: 'no_segmentation',
      ...(params.fileSize !== undefined ? { fileSize: params.fileSize } : {}),
      ...(params.mimeType !== undefined ? { mimeType: params.mimeType } : {}),
    },
  });
}

/**
 * Persist an uploaded video. The file is expected to already be on disk
 * at ``tempFilePath`` (multer diskStorage); we only own renaming it into
 * place and orchestrating extraction.
 */
export async function uploadVideoFromFile(options: {
  projectId: string;
  originalName: string;
  mimeType: string;
  tempFilePath: string;
  onProgress?: VideoProgressCallback;
  /** The user asked to align the channels. Whether it actually runs is THIS
   *  function's decision, not the caller's — it is gated on the project type
   *  here, the way `addChannelToFrames` gates itself. Stage drift correction is
   *  derived from the same gate and is deliberately not a parameter: it is not
   *  a user toggle, because the drift it removes is ~0.08 px/frame and
   *  invisible frame-to-frame, so there is nothing a user could judge. */
  registerChannels?: boolean;
}): Promise<VideoUploadResult> {
  const {
    projectId,
    originalName,
    mimeType,
    tempFilePath,
    onProgress,
    registerChannels: requestedRegisterChannels,
  } = options;

  // The microtubule gate lives here rather than in the HTTP handler, so every
  // entry point gets it. While it sat in the controller, the service's own
  // JSDoc had to explain a policy it could not enforce, and any non-HTTP caller
  // — a backfill script, a re-extract job — would silently have got neither
  // registration nor drift correction with nothing to notice.
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { type: true },
  });
  const isMtProject = isMicrotubuleProject(project?.type);
  const registerChannels = Boolean(requestedRegisterChannels) && isMtProject;
  const correctDrift = isMtProject;

  // 1. Create container DB row up front so the worker has a stable ID.
  const fileStat = await fs.stat(tempFilePath);
  const container = await prisma.image.create({
    data: {
      name: originalName,
      originalPath: '', // filled in once the file lands at its final path
      thumbnailPath: null,
      projectId,
      fileSize: Number(fileStat.size),
      mimeType,
      segmentationStatus: 'pending_extraction',
      isVideoContainer: true,
    },
  });
  const containerId = container.id;
  const baseDir = videoContainerDir(projectId, containerId);

  // Every container row created for this upload (position 0 + any extra
  // positions). Drives both the success return value and failure cleanup.
  const createdContainerIds: string[] = [containerId];

  const reportProgress = (
    phase: VideoUploadProgressEvent['phase'],
    progress: number,
    message?: string,
    messageKey?: string,
    messageParams?: Record<string, string | number>
  ): void => {
    onProgress?.({
      videoContainerId: containerId,
      filename: originalName,
      phase,
      progress,
      message,
      messageKey,
      messageParams,
    });
  };

  const cleanupOnFailure = async (): Promise<void> => {
    // Remove the canonical container dirs + any partial frames for every
    // container this upload created.
    for (const id of createdContainerIds) {
      const dir = videoContainerDir(projectId, id);
      await fs.rm(dir, { recursive: true, force: true }).catch(err => {
        logger.error(
          `Failed to clean up dir for failed upload: ${(err as Error).message}`,
          err as Error,
          'VideoUploadService',
          { containerId: id, dir }
        );
      });
    }
    // Also remove the multer temp file in case the rename never happened.
    await fs.rm(tempFilePath, { force: true }).catch(() => undefined);
  };

  try {
    // 2. Move multer's temp file into the canonical location.
    reportProgress('saving', 0.05, 'Persisting original', 'images.upload.op.persistingOriginal');
    await fs.mkdir(baseDir, { recursive: true });
    // ``ext`` comes from the user-supplied filename — guard the canonical
    // ``original.<ext>`` leaf name once and reuse it everywhere below.
    const ext = path.extname(originalName) || '.bin';
    const originalFileName = assertSafeStorageSegment(
      `original${ext}`,
      'original file'
    );
    const originalPath = path.join(baseDir, originalFileName);
    await moveFile(tempFilePath, originalPath);

    // Storage key of the moved source file. Used as-is for an ordinary
    // single-position upload; the multi-position path instead gives each
    // container its own per-position TIFF and deletes this source afterward.
    const sourceOriginalKey = path.posix.join(
      videoContainerStorageKey(projectId, containerId),
      originalFileName
    );

    // 3. Run the extractor end-to-end.
    reportProgress('extracting', 0.1, 'Extracting frames', 'images.upload.op.extractingFramesStart');
    const outcome = await extractVideoSafe(originalPath, baseDir, {
      onProgress: (p: ExtractionProgress) =>
        reportProgress(
          'extracting',
          0.1 + p.progress * 0.7,
          // `Frame ?` was what this actually rendered: the helpers only ever
          // sent a bare fraction, so `currentFrame` was always undefined and
          // the literal question mark reached the card. They now send the
          // counts too; fall back to the percentage rather than to a
          // placeholder that reads like a bug.
          p.message ??
            (p.currentFrame !== undefined && p.totalFrames !== undefined
              ? `Extracting frames ${p.currentFrame}/${p.totalFrames}`
              : `Extracting frames (${Math.round(p.progress * 100)}%)`),
          p.currentFrame !== undefined && p.totalFrames !== undefined
            ? 'images.upload.op.extractingFrames'
            : 'images.upload.op.extractingFramesPct',
          p.currentFrame !== undefined && p.totalFrames !== undefined
            ? { current: p.currentFrame, total: p.totalFrames }
            : { percent: Math.round(p.progress * 100) }
        ),
      registerChannels,
    });

    // 4a. Single-position / ordinary video: finalize the pre-created row.
    if (outcome.kind === 'single') {
      if (correctDrift) {
        reportProgress('persisting', 0.8, 'Correcting stage drift', 'images.upload.op.correctingDrift');
        await correctDriftForContainer(baseDir, outcome.result.channels, p =>
          // Drift correction is the longest step left once extraction is fast
          // (48 s of the 621 s server-side phase measured on the 300-frame ND2,
          // and the majority of it afterwards). Give it a real 0.8..0.95 band
          // rather than a number that sits still while it runs.
          reportProgress(
            'persisting',
            0.8 + p.progress * 0.15,
            'Correcting stage drift'
          )
        );
      }
      reportProgress('persisting', 0.95, 'Generating thumbnail', 'images.upload.op.generatingThumbnail');
      await finalizeContainer({
        containerId,
        baseDir,
        projectId,
        displayName: originalName,
        result: outcome.result,
        originalStorageKey: sourceOriginalKey,
      });

      reportProgress('completed', 1.0, 'Video ready', 'images.upload.op.videoReady');
      logger.info('Video upload complete', 'VideoUploadService', {
        containerId,
        projectId,
        frames: outcome.result.frameCount,
        channels: outcome.result.channels.length,
      });

      return {
        containerId,
        frameCount: outcome.result.frameCount,
        channels: outcome.result.channels,
        positionCount: 1,
        containerIds: [containerId],
      };
    }

    // 4b. Multi-position ND2: one container per XY position, each fully
    // self-contained. Position 0 reuses the pre-created container; the rest
    // get fresh rows. For every position the extractor wrote a frames subtree
    // AND a single-position OME-TIFF original under <baseDir>/<framesSubdir>/;
    // both are relocated into the container's own dir so each container owns
    // its original (the metrics reader can't index the multi-position source
    // ND2 by position, and a shared original would dangle when any one
    // position is deleted).
    const positions = [...outcome.positions].sort(
      (a, b) => a.positionIndex - b.positionIndex
    );
    if (positions.length === 0) {
      throw new Error('ND2 extraction returned zero positions');
    }

    reportProgress('persisting', 0.85, 'Persisting positions', 'images.upload.op.persistingPositions');
    for (let i = 0; i < positions.length; i++) {
      const pos = positions[i];
      const label = positionLabel(pos);
      // The extractor names these (``pos_%04d`` / ``original.tif``), but guard
      // before they enter filesystem paths so a future extractor change can't
      // silently introduce traversal.
      const framesSubdir = assertSafeStorageSegment(
        pos.framesSubdir,
        'framesSubdir'
      );
      const originalFile = assertSafeStorageSegment(
        pos.originalFile,
        'originalFile'
      );

      let cid: string;
      let cBaseDir: string;
      if (i === 0) {
        cid = containerId;
        cBaseDir = baseDir;
      } else {
        const extra = await prisma.image.create({
          data: {
            name: `${originalName} — ${label}`,
            originalPath: '',
            thumbnailPath: null,
            projectId,
            fileSize: 0, // overwritten in finalizeContainer with the TIFF size
            mimeType: 'image/tiff',
            segmentationStatus: 'pending_extraction',
            isVideoContainer: true,
          },
        });
        cid = extra.id;
        createdContainerIds.push(cid);
        cBaseDir = videoContainerDir(projectId, cid);
        await fs.mkdir(cBaseDir, { recursive: true });
      }

      // Relocate EVERY artifact this position produced into its container.
      //
      // Enumerating the ones we happen to know about is how `registration.json`
      // came to be lost: `frames` and the original were moved by name, and the
      // recursive `rm` that followed deleted whatever was left — silently, so
      // `mtMetricsExporter` then sampled the raw file UNREGISTERED. Naming the
      // sidecar as a third case fixes that one file and leaves the trap set for
      // the next artifact an extractor learns to write. Moving everything
      // closes it, and removes the ordering hazard with it: there is no longer
      // a separate sidecar move that could be reordered past the drift
      // correction below, which would compose drift into a map that is then
      // overwritten by the un-composed one.
      const stagingDir = path.join(baseDir, framesSubdir);
      for (const entry of await fs.readdir(stagingDir, {
        withFileTypes: true,
      })) {
        const from = path.join(stagingDir, entry.name);
        const to = path.join(cBaseDir, entry.name);
        // For position 0, cBaseDir IS baseDir, which already holds the source
        // original and the other positions' staging dirs. `fs.rename` silently
        // overwrites a file, so a future extractor emitting e.g. `original.nd2`
        // or `thumbnail.jpg` per position would destroy the container's own
        // copy with no error. Nothing collides today; refuse rather than rely
        // on that, since moving EVERYTHING is precisely the point of the loop.
        if (
          await fs
            .access(to)
            .then(() => true)
            .catch(() => false)
        ) {
          throw new Error(
            `refusing to relocate ${from}: ${to} already exists. A position's ` +
              'artifact would overwrite the container\'s own file.'
          );
        }
        await (entry.isDirectory() ? moveDir(from, to) : moveFile(from, to));
      }
      // Non-recursive on purpose: an EMPTY staging dir is the proof that
      // nothing was left behind. Anything the loop could not move now fails
      // loudly here instead of being deleted quietly.
      await fs.rmdir(stagingDir);
      const originalDest = path.join(cBaseDir, originalFile);

      if (correctDrift) {
        reportProgress(
          'persisting',
          0.85 + (i / positions.length) * 0.14,
          `Correcting stage drift (position ${i + 1}/${positions.length})`
        );
        await correctDriftForContainer(cBaseDir, pos.result.channels, dp =>
          reportProgress(
            'persisting',
            0.85 + ((i + dp.progress) / positions.length) * 0.14,
            `Correcting stage drift (position ${i + 1}/${positions.length})`
          )
        );
      }

      const originalStat = await fs.stat(originalDest);
      await finalizeContainer({
        containerId: cid,
        baseDir: cBaseDir,
        projectId,
        displayName: `${originalName} — ${label}`,
        result: pos.result,
        originalStorageKey: path.posix.join(
          videoContainerStorageKey(projectId, cid),
          originalFile
        ),
        fileSize: Number(originalStat.size),
        mimeType: 'image/tiff',
      });

      reportProgress(
        'persisting',
        0.85 + ((i + 1) / positions.length) * 0.14,
        `Position ${i + 1}/${positions.length}`
      );
    }

    // The multi-position source ND2 has been fully split into per-position
    // frames + TIFF originals; drop it so it isn't counted/served as position
    // 0's original (its key now points at position 0's TIFF). ``originalPath``
    // is the same join computed when the source was first persisted.
    await fs.rm(originalPath, { force: true }).catch(() => undefined);

    reportProgress('completed', 1.0, 'Video ready', 'images.upload.op.videoReady');
    logger.info('Multi-position video upload complete', 'VideoUploadService', {
      containerId,
      projectId,
      positions: positions.length,
      containerIds: createdContainerIds,
      framesEach: positions[0].result.frameCount,
      channels: positions[0].result.channels.length,
    });

    return {
      containerId,
      frameCount: positions[0].result.frameCount,
      channels: positions[0].result.channels,
      positionCount: positions.length,
      containerIds: createdContainerIds,
    };
  } catch (err) {
    const message = (err as Error).message;
    logger.error(
      `Video upload failed: ${message}`,
      err as Error,
      'VideoUploadService',
      { containerId, projectId, originalName }
    );

    // A mid-fan-out failure can leave already-finalized positions (0..k-1)
    // with committed child frame rows whose on-disk PNGs are about to be
    // rm'd by cleanupOnFailure. The Image self-relation only cascade-deletes
    // frames when the CONTAINER row is deleted, not when it's merely updated,
    // so we must remove the frames explicitly to avoid rows that point at
    // deleted files.
    try {
      // 1. Drop child frame rows for every container this upload created.
      await prisma.image.deleteMany({
        where: { parentVideoId: { in: createdContainerIds } },
      });
      // 2. Delete the extra-position container rows entirely; keep only the
      //    primary (position 0) row as the extraction_failed marker, mirroring
      //    the single-position path's "keep a row to record the failure".
      const extraIds = createdContainerIds.filter(id => id !== containerId);
      if (extraIds.length > 0) {
        await prisma.image.deleteMany({ where: { id: { in: extraIds } } });
      }
      // 3. Mark the primary container failed.
      await prisma.image.update({
        where: { id: containerId },
        data: { segmentationStatus: 'extraction_failed' },
      });
    } catch (secondaryErr) {
      logger.error(
        `Failed to roll back containers after upload failure: ${(secondaryErr as Error).message}`,
        secondaryErr as Error,
        'VideoUploadService',
        { containerId, createdContainerIds }
      );
    }

    await cleanupOnFailure();

    onProgress?.({
      videoContainerId: containerId,
      filename: originalName,
      phase: 'failed',
      progress: 1.0,
      error: message,
    });
    throw err;
  }
}
