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
import { extractVideoSafe } from './video/videoExtractor';
import type {
  ChannelMeta,
  ExtractedPosition,
  ExtractionProgress,
  ExtractionResult,
} from './video/types';

export interface VideoUploadProgressEvent {
  videoContainerId: string;
  filename: string;
  phase: 'saving' | 'extracting' | 'persisting' | 'completed' | 'failed';
  progress: number;
  message?: string;
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
  return path.posix.join('projects', projectId, 'images', containerId);
}

/** Absolute filesystem path for the container directory — UPLOAD_DIR
 *  prepended to the storage key. Used for `mkdir`, `rm`, sharp/extract
 *  I/O. Stays in node `path` (OS separators) so Windows dev still works. */
function videoContainerDir(projectId: string, containerId: string): string {
  return path.join(
    config.UPLOAD_DIR,
    'projects',
    projectId,
    'images',
    containerId
  );
}

/** Frame-relative storage key, persisted as the child Image's
 *  ``originalPath``. Points at the segmentation source channel for now;
 *  consumers that need a different channel build their own URL via the
 *  /frame-data?channel=X route. */
function frameStorageKey(
  projectId: string,
  containerId: string,
  frameIndex: number,
  channelName: string
): string {
  return path.posix.join(
    videoContainerStorageKey(projectId, containerId),
    'frames',
    String(frameIndex).padStart(4, '0'),
    `${channelName}.png`
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
  outPath: string
): Promise<void> {
  const firstFrameDir = path.join(framesRoot, '0000');
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
    if (e.code !== 'EXDEV') throw err;
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
    if (e.code !== 'EXDEV') throw err;
    await fs.cp(srcDir, destDir, { recursive: true });
    await fs.rm(srcDir, { recursive: true, force: true }).catch(() => undefined);
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

  const defaultChannel =
    result.channels.find(c => c.isSegmentationSource)?.name ??
    result.channels[0]?.name ??
    'video';

  const thumbnailPath = path.join(baseDir, 'thumbnail.jpg');
  await generateContainerThumbnail(
    path.join(baseDir, 'frames'),
    defaultChannel,
    thumbnailPath
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
      channels: result.channels as unknown as object,
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
}): Promise<VideoUploadResult> {
  const { projectId, originalName, mimeType, tempFilePath, onProgress } =
    options;

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
    message?: string
  ) => {
    onProgress?.({
      videoContainerId: containerId,
      filename: originalName,
      phase,
      progress,
      message,
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
    reportProgress('saving', 0.05, 'Persisting original');
    await fs.mkdir(baseDir, { recursive: true });
    const ext = path.extname(originalName) || '.bin';
    const originalPath = path.join(baseDir, `original${ext}`);
    await moveFile(tempFilePath, originalPath);

    // Storage key of the moved source file. Used as-is for an ordinary
    // single-position upload; the multi-position path instead gives each
    // container its own per-position TIFF and deletes this source afterward.
    const sourceOriginalKey = path.posix.join(
      videoContainerStorageKey(projectId, containerId),
      `original${ext}`
    );

    // 3. Run the extractor end-to-end.
    reportProgress('extracting', 0.1, 'Extracting frames');
    const outcome = await extractVideoSafe(originalPath, baseDir, {
      onProgress: (p: ExtractionProgress) =>
        reportProgress(
          'extracting',
          0.1 + p.progress * 0.7,
          p.message ?? `Frame ${p.currentFrame ?? '?'}`
        ),
    });

    // 4a. Single-position / ordinary video: finalize the pre-created row.
    if (outcome.kind === 'single') {
      reportProgress('persisting', 0.85, 'Generating thumbnail');
      await finalizeContainer({
        containerId,
        baseDir,
        projectId,
        displayName: originalName,
        result: outcome.result,
        originalStorageKey: sourceOriginalKey,
      });

      reportProgress('completed', 1.0, 'Video ready');
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

    reportProgress('persisting', 0.85, 'Persisting positions');
    for (let i = 0; i < positions.length; i++) {
      const pos = positions[i];
      const label = positionLabel(pos);

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

      // Relocate this position's frames + its single-position TIFF original
      // into the container dir, then drop the now-empty pos_<NNNN> staging
      // subdir.
      const stagingDir = path.join(baseDir, pos.framesSubdir);
      await moveDir(path.join(stagingDir, 'frames'), path.join(cBaseDir, 'frames'));
      const originalDest = path.join(cBaseDir, pos.originalFile);
      await moveFile(path.join(stagingDir, pos.originalFile), originalDest);
      await fs
        .rm(stagingDir, { recursive: true, force: true })
        .catch(() => undefined);

      const originalStat = await fs.stat(originalDest);
      await finalizeContainer({
        containerId: cid,
        baseDir: cBaseDir,
        projectId,
        displayName: `${originalName} — ${label}`,
        result: pos.result,
        originalStorageKey: path.posix.join(
          videoContainerStorageKey(projectId, cid),
          pos.originalFile
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
    // 0's original (its key now points at position 0's TIFF).
    await fs
      .rm(path.join(baseDir, `original${ext}`), { force: true })
      .catch(() => undefined);

    reportProgress('completed', 1.0, 'Video ready');
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
