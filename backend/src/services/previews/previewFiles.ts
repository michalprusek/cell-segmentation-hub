import fs from 'fs/promises';
import path from 'path';
import { config } from '../../utils/config';
import { logger } from '../../utils/logger';
import { assertSafeStorageSegment } from '../../utils/storagePath';

/**
 * Where previews live on disk, and removing them. Kept apart from
 * `previewService` so the image/project services can clean up without
 * importing the renderer's native modules or the database client.
 */

const PREVIEWS_SEGMENT = 'previews';

const uploadDir = (): string => config.UPLOAD_DIR || './uploads';

export function previewDirKey(projectId: string, imageId: string): string {
  return path.posix.join(
    'projects',
    assertSafeStorageSegment(projectId, 'projectId'),
    PREVIEWS_SEGMENT,
    assertSafeStorageSegment(imageId, 'imageId')
  );
}

/** `projects/<projectId>/previews`, relative to UPLOAD_DIR. */
export function projectPreviewsKey(projectId: string): string {
  return path.posix.join(
    'projects',
    assertSafeStorageSegment(projectId, 'projectId'),
    PREVIEWS_SEGMENT
  );
}

/**
 * Remove the previews of images that are being deleted. Best-effort: what
 * this misses (a crash, a render that finished after the delete) the garbage
 * collector removes, because it keeps only directories named after a live
 * image.
 */
export async function removePreviews(
  projectId: string,
  imageIds: Iterable<string>
): Promise<void> {
  for (const imageId of imageIds) {
    try {
      await fs.rm(path.join(uploadDir(), previewDirKey(projectId, imageId)), {
        recursive: true,
        force: true,
      });
    } catch (error) {
      logger.warn('Failed to remove previews', 'PreviewService', {
        projectId,
        imageId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
