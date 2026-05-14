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
 * Failure handling guarantees:
 *
 *   - If any step in the happy path throws, the container row is updated to
 *     ``segmentationStatus='extraction_failed'`` AND the entire container
 *     directory under projects/<pid>/images/<vid>/ is removed so retrying
 *     starts from a clean slate.
 *   - The multer-supplied temp file is always removed, even on success
 *     (renamed into the canonical location).
 *   - If the secondary "mark as failed" Prisma update itself fails, that
 *     error is logged at ``error`` level with the container ID so ops can
 *     find stuck-in-pending rows.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import sharp from 'sharp';
import { prisma } from '../db/prismaClient';
import { config } from '../utils/config';
import { logger } from '../utils/logger';
import { extractVideoSafe } from './video/videoExtractor';
import type { ChannelMeta, ExtractionProgress } from './video/types';

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
  containerId: string;
  frameCount: number;
  channels: ChannelMeta[];
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
    // Remove the canonical container dir + any partial frames.
    await fs.rm(baseDir, { recursive: true, force: true }).catch(err => {
      logger.error(
        `Failed to clean up baseDir for failed upload: ${(err as Error).message}`,
        err as Error,
        'VideoUploadService',
        { containerId, baseDir }
      );
    });
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

    // 3. Run the extractor end-to-end.
    reportProgress('extracting', 0.1, 'Extracting frames');
    const result = await extractVideoSafe(originalPath, baseDir, {
      onProgress: (p: ExtractionProgress) =>
        reportProgress(
          'extracting',
          0.1 + p.progress * 0.7,
          p.message ?? `Frame ${p.currentFrame ?? '?'}`
        ),
    });

    // 4. Generate container thumbnail.
    reportProgress('persisting', 0.85, 'Generating thumbnail');
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

    // 5. Persist frame rows + container metadata.
    reportProgress('persisting', 0.9, 'Persisting frame records');
    const frameRows = Array.from({ length: result.frameCount }, (_, i) => ({
      name: `${originalName} (frame ${i + 1})`,
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
        originalPath: path.posix.join(containerKey, `original${ext}`),
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
      },
    });

    reportProgress('completed', 1.0, 'Video ready');
    logger.info('Video upload complete', 'VideoUploadService', {
      containerId,
      projectId,
      frames: result.frameCount,
      channels: result.channels.length,
    });

    return {
      containerId,
      frameCount: result.frameCount,
      channels: result.channels,
    };
  } catch (err) {
    const message = (err as Error).message;
    logger.error(
      `Video upload failed: ${message}`,
      err as Error,
      'VideoUploadService',
      { containerId, projectId, originalName }
    );

    // Mark container as failed BEFORE cleanup so the row's state reflects
    // reality even if the rm -rf takes a while or fails.
    try {
      await prisma.image.update({
        where: { id: containerId },
        data: { segmentationStatus: 'extraction_failed' },
      });
    } catch (secondaryErr) {
      logger.error(
        `Failed to mark container as extraction_failed: ${(secondaryErr as Error).message}`,
        secondaryErr as Error,
        'VideoUploadService',
        { containerId }
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
