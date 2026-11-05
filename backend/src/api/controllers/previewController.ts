import { Request, Response } from 'express';
import { prisma } from '../../db';
import { logger } from '../../utils/logger';
import { ResponseHelper } from '../../utils/response';
import * as SharingService from '../../services/sharingService';
import {
  previewService,
  PreviewUnavailableError,
} from '../../services/previews/previewService';
import { PREVIEW_VERSION_PATTERN } from '../../services/previews/previewVersion';

/**
 * GET /api/images/:imageId/preview?v=<version>
 *
 * The image's project-grid preview. The URL the listing hands out carries the
 * current version, and a request for THAT version is cached forever
 * (`immutable`): the URL changes when the preview does, so there is nothing to
 * revalidate. A request for any other version — a page listed before an edit —
 * still gets the CURRENT picture, but uncacheable, so a stale URL can never
 * pin a stale picture in the browser.
 *
 * Authenticated by the session cookie (an `<img>` sends it) and checked
 * against project access, owner or accepted share.
 */
export async function getImagePreview(
  req: Request,
  res: Response
): Promise<void> {
  const { imageId } = req.params;
  const userId = req.user?.id;
  if (!imageId || !userId) {
    ResponseHelper.badRequest(res, 'Image ID is required');
    return;
  }

  try {
    const image = await prisma.image.findUnique({
      where: { id: imageId },
      select: { projectId: true },
    });
    if (!image) {
      ResponseHelper.notFound(res, 'Image not found');
      return;
    }
    const access = await SharingService.hasProjectAccess(
      image.projectId,
      userId
    );
    if (!access.hasAccess) {
      // Not 403: do not confirm that an image id exists to someone who
      // cannot see it.
      ResponseHelper.notFound(res, 'Image not found');
      return;
    }

    const preview = await previewService.ensurePreview(imageId);
    if (!preview) {
      ResponseHelper.notFound(res, 'Image not found');
      return;
    }

    const requested =
      typeof req.query.v === 'string' && PREVIEW_VERSION_PATTERN.test(req.query.v)
        ? req.query.v
        : null;
    res.set({
      'Content-Type': 'image/jpeg',
      ETag: `"${preview.version}"`,
      'Cache-Control':
        requested === preview.version
          ? 'private, max-age=31536000, immutable'
          : 'private, no-cache',
    });
    res.sendFile(preview.filePath, { lastModified: false, etag: false });
  } catch (error) {
    if (error instanceof PreviewUnavailableError) {
      // The card falls back to the plain thumbnail on any error status.
      res.status(404).set('Cache-Control', 'no-store').end();
      return;
    }
    logger.error(
      'Failed to serve image preview',
      error instanceof Error ? error : undefined,
      'PreviewController',
      { imageId }
    );
    ResponseHelper.internalError(res, error as Error, 'PreviewController');
  }
}
