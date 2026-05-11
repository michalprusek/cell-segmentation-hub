import { Router } from 'express';
import { ImageController } from '../controllers/imageController';
import { VideoController } from '../controllers/videoController';
import { authenticate } from '../../middleware/auth';
import {
  validateParams,
  validateQuery,
  validateBody,
} from '../../middleware/validation';
import {
  uploadImages,
  uploadSingleVideo,
  handleUploadError,
  validateUploadedFiles,
} from '../../middleware/upload';
import {
  projectIdSchema,
  projectImageParamsSchema,
  imageQuerySchema,
  imageBatchDeleteSchema,
  imageReorderSchema,
} from '../../types/validation';

const router = Router();
const imageController = new ImageController();

/**
 * Public routes that don't require authentication
 */

/**
 * Get browser-compatible image for display
 * GET /images/:imageId/display
 * Note: No authentication required for image display
 */
router.get('/:imageId/display', imageController.getImageForDisplay);

// All other routes require authentication (email verification disabled for development)
router.use(authenticate);
// router.use(requireEmailVerification); // Temporarily disabled for development

/**
 * Delete multiple images in batch
 * DELETE /images/batch
 * NOTE: Must be placed before parameterized routes to avoid routing conflicts
 */
router.delete(
  '/batch',
  validateBody(imageBatchDeleteSchema),
  imageController.deleteBatch
);

/**
 * Get project images with optimized thumbnails
 * GET /projects/:id/images-with-thumbnails?lod=low&page=1&limit=50
 */
router.get(
  '/:id/images-with-thumbnails',
  validateParams(projectIdSchema),
  imageController.getProjectImagesWithThumbnails
);

/**
 * Regenerate missing segmentation thumbnails for a project
 * POST /projects/:id/regenerate-thumbnails
 * POZOR: Musí být před /:id/images kvůli pořadí matchování routes
 */
router.post(
  '/:id/regenerate-thumbnails',
  validateParams(projectIdSchema),
  imageController.regenerateThumbnails
);

/**
 * Get image statistics for project
 * GET /projects/:id/images/stats
 * POZOR: Musí být před /:id/images kvůli pořadí matchování routes
 */
router.get(
  '/:id/images/stats',
  validateParams(projectIdSchema),
  imageController.getImageStats
);

/**
 * Upload images to project
 * POST /projects/:id/images
 */
router.post(
  '/:id/images',
  validateParams(projectIdSchema),
  uploadImages,
  handleUploadError,
  validateUploadedFiles,
  imageController.uploadImages
);

/**
 * Upload a video (or microscopy stack) to a project. Extracts frames
 * synchronously and creates one child Image row per frame.
 * POST /projects/:id/videos
 */
router.post(
  '/:id/videos',
  validateParams(projectIdSchema),
  uploadSingleVideo,
  handleUploadError,
  VideoController.upload
);

/**
 * Fetch the raw PNG for a specific channel of a video frame.
 * GET /images/:imageId/frame-data?channel=irm
 */
router.get(
  '/:imageId/frame-data',
  VideoController.getFrameData
);

/**
 * List the frames of a video container in temporal order.
 * GET /images/:imageId/video-frames
 */
router.get(
  '/:imageId/video-frames',
  VideoController.getVideoFrames
);

/**
 * Update the channel metadata on a video container row.
 * PATCH /images/:imageId/channels
 */
router.patch(
  '/:imageId/channels',
  VideoController.updateChannels
);

/**
 * Reorder images within a project for time-series workflows.
 * PATCH /projects/:id/images/reorder
 * MUST be placed before `/:projectId/images/:imageId` to avoid matching as image detail.
 */
router.patch(
  '/:id/images/reorder',
  validateParams(projectIdSchema),
  validateBody(imageReorderSchema),
  imageController.reorderImages
);

/**
 * Get images in project
 * GET /projects/:id/images
 */
router.get(
  '/:id/images',
  validateParams(projectIdSchema),
  validateQuery(imageQuerySchema),
  imageController.getImages
);

/**
 * Get single image detail
 * GET /projects/:projectId/images/:imageId
 */
router.get(
  '/:projectId/images/:imageId',
  validateParams(projectImageParamsSchema),
  imageController.getImage
);

/**
 * Delete image
 * DELETE /projects/:projectId/images/:imageId
 */
router.delete(
  '/:projectId/images/:imageId',
  validateParams(projectImageParamsSchema),
  imageController.deleteImage
);

/**
 * Get single image with optional segmentation data
 * GET /images/:imageId?includeSegmentation=true
 */
router.get('/:imageId', imageController.getImageWithSegmentation);

export default router;
