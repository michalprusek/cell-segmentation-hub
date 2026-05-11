/**
 * Service that owns the per-upload video flow:
 *
 *   incoming buffer → temp file → extractVideoSafe →
 *   one container Image row + N child frame Image rows + thumbnail.
 *
 * Kept separate from imageService so the static-image upload path stays
 * untouched. The route layer routes a file to this service when the
 * extension matches a video format (mp4/avi/mov/mkv/webm/nd2 or a
 * multi-page TIFF detected after open).
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import sharp from 'sharp';
import { PrismaClient } from '@prisma/client';
import { config } from '../utils/config';
import { logger } from '../utils/logger';
import { extractVideoSafe } from './video/videoExtractor';
import type {
  ChannelMeta,
  ExtractionProgress,
} from './video/types';

const prisma = new PrismaClient();

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

/** Top-level path under the configured uploads directory that holds a
 *  given video container and its extracted frames. */
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
 *  ``originalPath``. Always points at the segmentation source channel
 *  for now; consumers that need a different channel build their own
 *  URL via the /frame-data?channel=X route. */
function frameStorageKey(
  containerId: string,
  frameIndex: number,
  channelName: string
): string {
  return path.posix.join(
    containerId,
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
  const candidates = [
    path.join(firstFrameDir, `${defaultChannel}.png`),
    // Fallbacks for resilience: any PNG in the first frame dir.
    ...(await fs
      .readdir(firstFrameDir)
      .then(files => files.filter(f => f.endsWith('.png')).map(f => path.join(firstFrameDir, f)))
      .catch(() => [] as string[])),
  ];
  for (const candidate of candidates) {
    try {
      await sharp(candidate)
        .resize(300, 300, { fit: 'inside' })
        .jpeg({ quality: 85 })
        .toFile(outPath);
      return;
    } catch {
      /* try next candidate */
    }
  }
  throw new Error(`Failed to generate thumbnail from any frame in ${firstFrameDir}`);
}

export async function uploadVideo(
  buffer: Buffer,
  options: {
    projectId: string;
    originalName: string;
    mimeType: string;
    onProgress?: VideoProgressCallback;
  }
): Promise<VideoUploadResult> {
  const { projectId, originalName, mimeType, onProgress } = options;

  // 1. Create container DB row up front so the worker has a stable ID.
  const container = await prisma.image.create({
    data: {
      name: originalName,
      originalPath: '', // filled in after the file lands on disk
      thumbnailPath: null,
      projectId,
      fileSize: buffer.byteLength,
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

  try {
    // 2. Persist the original to disk.
    reportProgress('saving', 0.05, 'Saving original');
    await fs.mkdir(baseDir, { recursive: true });
    const ext = path.extname(originalName) || '.bin';
    const originalPath = path.join(baseDir, `original${ext}`);
    await fs.writeFile(originalPath, buffer);

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

    // 4. Generate container thumbnail from the segmentation-source channel
    //    when present, otherwise from the first available channel.
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

    // 5. Persist frame rows in a batch + update container metadata.
    reportProgress('persisting', 0.9, 'Persisting frame records');
    const frameRows = Array.from({ length: result.frameCount }, (_, i) => ({
      name: `${originalName} (frame ${i + 1})`,
      originalPath: frameStorageKey(containerId, i, defaultChannel),
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

    await prisma.image.update({
      where: { id: containerId },
      data: {
        originalPath: path.posix.join(containerId, `original${ext}`),
        thumbnailPath: path.posix.join(containerId, 'thumbnail.jpg'),
        width: result.width || null,
        height: result.height || null,
        frameCount: result.frameCount,
        videoDurationMs: result.durationMs ?? null,
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
      'VideoUploadService'
    );
    await prisma.image.update({
      where: { id: containerId },
      data: { segmentationStatus: 'extraction_failed' },
    }).catch(() => {/* ignore secondary failure */});
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
