/**
 * Top-level video extractor. Dispatches to ffmpeg (consumer formats) or
 * Python helpers (microscopy formats — multi-page TIFF, ND2) based on
 * the file extension. Buffers the multer upload to disk before kicking
 * off extraction so the helper subprocess sees a stable filename.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { logger } from '../../utils/logger';
import {
  extractWithFfmpeg,
  isFfmpegFormat,
} from './ffmpegExtractor';
import {
  extractNd2,
  extractTiffStack,
} from './pythonExtractor';
import {
  ExtractionOutcome,
  ProgressCallback,
} from './types';

export type SupportedVideoKind = 'mp4-like' | 'tiff-stack' | 'nd2';

/** Sniffs the file extension + magic bytes to decide which extractor
 *  to use. Multi-page TIFFs share the .tif extension with single-page
 *  images, so callers should pass the actual file (we let the Python
 *  helper detect the page count and either succeed or fail). */
export function detectVideoKind(filename: string): SupportedVideoKind | null {
  const ext = path.extname(filename).toLowerCase();
  if (isFfmpegFormat(ext)) return 'mp4-like';
  if (ext === '.nd2') return 'nd2';
  if (ext === '.tif' || ext === '.tiff') return 'tiff-stack';
  return null;
}

/** Returns true if the upload should be treated as a video by the
 *  upload controller. TIFF is ambiguous; callers may decide to attempt
 *  multi-page detection or fall through to single-image handling. */
export function isVideoFilename(filename: string): boolean {
  return detectVideoKind(filename) !== null;
}

export async function extractVideo(
  sourcePath: string,
  destDir: string,
  options: { onProgress?: ProgressCallback } = {}
): Promise<ExtractionOutcome> {
  const kind = detectVideoKind(sourcePath);
  if (kind === null) {
    throw new Error(`Unsupported video format: ${path.extname(sourcePath)}`);
  }

  await fs.mkdir(destDir, { recursive: true });

  switch (kind) {
    // ffmpeg + TIFF always yield a single container's frames at
    // <dest>/frames/...; only ND2 can fan out into multiple positions.
    case 'mp4-like':
      return { single: await extractWithFfmpeg(sourcePath, destDir, options) };
    case 'tiff-stack':
      return {
        single: await extractTiffStack(sourcePath, destDir, options.onProgress),
      };
    case 'nd2':
      return extractNd2(sourcePath, destDir, options.onProgress);
    default: {
      const exhaustive: never = kind;
      throw new Error(`unhandled video kind ${exhaustive}`);
    }
  }
}

/** Convenience wrapper that runs the extractor inside a try/catch and
 *  ensures the partial output directory is cleaned up on failure so a
 *  retry of the same upload starts from a clean slate. */
export async function extractVideoSafe(
  sourcePath: string,
  destDir: string,
  options: { onProgress?: ProgressCallback } = {}
): Promise<ExtractionOutcome> {
  try {
    return await extractVideo(sourcePath, destDir, options);
  } catch (err) {
    logger.error(
      `Video extraction failed: ${(err as Error).message}`,
      err as Error,
      'VideoExtractor'
    );
    await fs.rm(destDir, { recursive: true, force: true }).catch(() => {
      /* best-effort cleanup */
    });
    throw err;
  }
}
