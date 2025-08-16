import { Router } from 'express';
import { ImageController } from '../controllers/imageController';
import { authenticate, requireEmailVerification } from '../../middleware/auth';
import { validateParams, validateQuery } from '../../middleware/validation';
import { 
  uploadImages, 
  handleUploadError, 
  validateUploadedFiles 
} from '../../middleware/upload';
import {
  projectIdSchema,
  projectImageParamsSchema,
  imageQuerySchema
} from '../../types/validation';

const router = Router();
const imageController = new ImageController();

// All routes require authentication (email verification disabled for development)
router.use(authenticate);
// router.use(requireEmailVerification); // Temporarily disabled for development

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
router.get(
  '/:imageId',
  imageController.getImageWithSegmentation
);

export default router;