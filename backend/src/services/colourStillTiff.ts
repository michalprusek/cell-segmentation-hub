/**
 * A colour photograph that arrived on the video route.
 *
 * The browser can only route a `.tif` by size: over the still-image cap
 * (20 MB) it is assumed to be a stack and POSTed to `/videos`. An uncompressed
 * RGB frame crosses that cap at about 6.7 Mpx — a 4104 x 2174 brightfield
 * frame from an Olympus DP28 is 26.8 MB — and the stack extractor then refused
 * it: `Cannot interpret TIFF axes='YXS' shape=(2174, 4104, 3)`.
 *
 * The decision is made here, on the server, because this is the first place
 * the file can actually be read; and the photograph is stored through the
 * ordinary image path, so it becomes the same kind of row as every other still
 * in the project. It is NOT taught to the extractor: every frame that writes
 * is one grayscale plane per channel, so a photograph would become a one-frame
 * video of three unrelated "channels", which is not what the colour models
 * were trained on.
 *
 * Raising the still-image cap instead was rejected: that multer buffers in
 * memory and takes 100 files per request.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { VIDEO_UPLOAD_TMP_DIR } from '../config/videoUploadTmpDir';
import { prisma } from '../db/prismaClient';
import { logger } from '../utils/logger';
import { ImageService, type ImageWithUrls } from './imageService';
import { classifyTiff } from './video/pythonExtractor';

/** The image path takes a Buffer, so the whole file is held in memory once.
 *  Video uploads are one file per request, which bounds that to this figure
 *  per in-flight upload; 512 MB of 8-bit RGB is ~179 Mpx, far past any camera
 *  frame, and comfortably inside the backend's 12 GB limit. */
export const COLOUR_STILL_MAX_BYTES = 512 * 1024 * 1024;

const TIFF_NAME = /\.tiff?$/i;

/**
 * Store `tempFilePath` as a still image if it is a single-page colour TIFF.
 *
 * Returns the new image, or `null` when the file is anything else and should
 * go on to the extractor exactly as before. Never deletes `tempFilePath`: the
 * caller owns it either way.
 *
 * A probe that FAILS answers `null` too. The extractor then reports on the
 * file itself, which is a better error than "could not classify" — and a
 * broken probe must not be able to take down uploads of real stacks.
 */
export async function storeColourStillTiff(options: {
  projectId: string;
  userId: string;
  originalName: string;
  mimeType: string;
  tempFilePath: string;
}): Promise<ImageWithUrls | null> {
  const { projectId, userId, originalName, mimeType, tempFilePath } = options;
  if (!TIFF_NAME.test(originalName)) {
    return null;
  }

  // The path is multer's own (a random token under its temp dir), but it
  // arrives here through the request object. Everything below opens it, so
  // hold it to the one directory an upload can legitimately be in.
  const tempRoot = path.resolve(VIDEO_UPLOAD_TMP_DIR);
  const sourcePath = path.resolve(tempFilePath);
  if (!sourcePath.startsWith(tempRoot + path.sep)) {
    throw new Error('Upload temp file is outside the upload temp directory');
  }

  let classification;
  try {
    classification = await classifyTiff(sourcePath);
  } catch (err) {
    logger.warn(
      `TIFF classification failed, leaving the file to the extractor: ${(err as Error).message}`,
      'ColourStillTiff',
      { originalName }
    );
    return null;
  }
  if (classification.kind !== 'colour_still') {
    return null;
  }

  // One handle for the size check and the read, so the file that is measured
  // is the file that is loaded.
  const handle = await fs.open(sourcePath, 'r');
  try {
    const { size } = await handle.stat();
    if (size > COLOUR_STILL_MAX_BYTES) {
      throw new Error(
        `${originalName} is a single colour image of ${Math.round(size / 1024 / 1024)} MB; ` +
          `colour images are accepted up to ${COLOUR_STILL_MAX_BYTES / 1024 / 1024} MB. ` +
          'Save it compressed (LZW TIFF, PNG or JPEG) or at a lower resolution.'
      );
    }

    logger.info(
      'Single-page colour TIFF on the video route, storing it as an image',
      'ColourStillTiff',
      { originalName, size, ...classification }
    );
    const [image] = await new ImageService(prisma).uploadImages(
      projectId,
      userId,
      [
        {
          originalname: originalName,
          buffer: await handle.readFile(),
          mimetype: mimeType,
          size,
        },
      ]
    );
    return image;
  } finally {
    await handle.close();
  }
}
