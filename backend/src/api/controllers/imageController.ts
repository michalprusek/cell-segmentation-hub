import { Request, Response } from 'express';
import { ImageService } from '../../services/imageService';
import { ResponseHelper } from '../../utils/response';
import { logger } from '../../utils/logger';
import { prisma } from '../../db/index';
import {
  imageQuerySchema,
  projectIdSchema,
  projectImageParamsSchema,
  ImageQueryParams,
  ProjectIdParams,
  ProjectImageParams
} from '../../types/validation';

export class ImageController {
  private imageService: ImageService;

  constructor() {
    this.imageService = new ImageService(prisma);
  }

  /**
   * Upload images to a project
   * POST /api/projects/:id/images
   */
  uploadImages = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user!.id;
      const { id: projectId } = req.params;

      // Check if files were uploaded
      const files = req.files as Express.Multer.File[];
      if (!files || files.length === 0) {
        ResponseHelper.validationError(res, 'Je nutné vybrat alespoň jeden soubor');
        return;
      }

      // Validate files before processing
      const allowedMimeTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/bmp', 'image/x-ms-bmp', 'image/x-bmp', 'image/tiff', 'image/tif', 'image/gif'];
      const maxFileSize = 5 * 1024 * 1024; // 5MB

      for (const file of files) {
        if (!file.buffer || !file.originalname) {
          ResponseHelper.validationError(res, 'Invalid file: missing buffer or name');
          return;
        }
        
        if (!allowedMimeTypes.includes(file.mimetype)) {
          ResponseHelper.validationError(res, `Invalid file type: ${file.mimetype}. Allowed types: ${allowedMimeTypes.join(', ')}`);
          return;
        }
        
        if (file.size > maxFileSize) {
          ResponseHelper.validationError(res, `File too large: ${file.originalname}. Maximum size: 5MB`);
          return;
        }
      }

      // Convert multer files to service format
      const uploadFiles = files.map(file => ({
        originalname: file.originalname,
        buffer: file.buffer,
        mimetype: file.mimetype,
        size: file.size
      }));

      logger.info('Starting image upload request', 'ImageController', {
        projectId,
        userId,
        fileCount: files.length
      });

      // Upload images
      const uploadedImages = await this.imageService.uploadImages(
        projectId!,
        userId!,
        uploadFiles
      );

      ResponseHelper.success(res, {
        images: uploadedImages,
        count: uploadedImages.length
      }, `Úspěšně nahráno ${uploadedImages.length} obrázků`);

    } catch (error) {
      logger.error('Image upload failed', error instanceof Error ? error : undefined, 'ImageController', {
        userId: req.user?.id,
        projectId: req.params.id
      });

      const errorMessage = error instanceof Error ? error.message : 'Neznámá chyba';
      if (errorMessage.includes('nenalezen') || errorMessage.includes('oprávnění')) {
        ResponseHelper.notFound(res, errorMessage);
      } else {
        ResponseHelper.internalError(res, error as Error);
      }
    }
  };

  /**
   * Get images in a project
   * GET /api/projects/:projectId/images
   */
  getImages = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user!.id;
      const { id: projectId } = req.params;
      const queryParams = req.query as any; // Already validated by middleware

      if (!projectId) {
        ResponseHelper.badRequest(res, 'Project ID is required');
        return;
      }

      logger.info('Getting project images', 'ImageController', {
        projectId,
        userId,
        queryParams
      });

      const result = await this.imageService.getProjectImages(
        projectId,
        userId,
        queryParams
      );

      ResponseHelper.success(res, result, 'Seznam obrázků úspěšně načten');

    } catch (error) {
      logger.error('Failed to get project images', error instanceof Error ? error : undefined, 'ImageController', {
        userId: req.user?.id,
        projectId: req.params.id
      });

      const errorMessage = error instanceof Error ? error.message : 'Neznámá chyba';
      if (errorMessage.includes('nenalezen') || errorMessage.includes('oprávnění')) {
        ResponseHelper.notFound(res, errorMessage);
      } else {
        ResponseHelper.internalError(res, error as Error);
      }
    }
  };

  /**
   * Get single image detail
   * GET /api/projects/:projectId/images/:imageId
   */
  getImage = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user!.id;
      const { imageId } = req.params;

      if (!imageId) {
        ResponseHelper.badRequest(res, 'Image ID is required');
        return;
      }

      logger.info('Getting image detail', 'ImageController', {
        imageId,
        userId
      });

      const image = await this.imageService.getImageById(imageId, userId);

      if (!image) {
        ResponseHelper.notFound(res, 'Obrázek nenalezen');
        return;
      }

      ResponseHelper.success(res, { image }, 'Detail obrázku úspěšně načten');

    } catch (error) {
      logger.error('Failed to get image detail', error instanceof Error ? error : undefined, 'ImageController', {
        userId: req.user?.id,
        imageId: req.params.imageId
      });

      ResponseHelper.internalError(res, error as Error);
    }
  };

  /**
   * Delete image
   * DELETE /api/projects/:projectId/images/:imageId
   */
  deleteImage = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user!.id;
      const { imageId } = req.params;

      if (!imageId) {
        ResponseHelper.badRequest(res, 'Image ID is required');
        return;
      }

      logger.info('Deleting image', 'ImageController', {
        imageId,
        userId
      });

      await this.imageService.deleteImage(imageId, userId);

      ResponseHelper.success(res, null, 'Obrázek byl úspěšně smazán');

    } catch (error) {
      logger.error('Failed to delete image', error instanceof Error ? error : undefined, 'ImageController', {
        userId: req.user?.id,
        imageId: req.params.imageId
      });

      const errorMessage = error instanceof Error ? error.message : 'Neznámá chyba';
      if (errorMessage.includes('nenalezen') || errorMessage.includes('oprávnění')) {
        ResponseHelper.notFound(res, errorMessage);
      } else {
        ResponseHelper.internalError(res, error as Error);
      }
    }
  };

  /**
   * Get single image with optional segmentation data
   * GET /api/images/:imageId
   */
  getImageWithSegmentation = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user!.id;
      const { imageId } = req.params;
      const { includeSegmentation } = req.query;

      if (!imageId) {
        ResponseHelper.badRequest(res, 'Image ID is required');
        return;
      }

      logger.info('Getting image with segmentation', 'ImageController', {
        imageId,
        userId,
        includeSegmentation
      });

      // Get image data
      const image = await this.imageService.getImageById(imageId, userId);
      
      if (!image) {
        ResponseHelper.notFound(res, 'Obrázek nenalezen');
        return;
      }

      // Include segmentation if requested
      if (includeSegmentation === 'true') {
        const segmentation = await prisma.segmentation.findUnique({
          where: { imageId }
        });

        if (segmentation) {
          let parsedPolygons;
          try {
            parsedPolygons = JSON.parse(segmentation.polygons);
          } catch (error) {
            logger.error('Failed to parse segmentation polygons:', error);
            return ResponseHelper.error(res, 'Invalid segmentation data format', 500);
          }
          ResponseHelper.success(res, {
            ...image,
            segmentation: {
              id: segmentation.id,
              imageId: segmentation.imageId,
              polygons: parsedPolygons,
              model: segmentation.model,
              threshold: segmentation.threshold,
              confidence: segmentation.confidence,
              processingTime: segmentation.processingTime,
              imageWidth: segmentation.imageWidth,
              imageHeight: segmentation.imageHeight,
              status: 'completed',
              createdAt: segmentation.createdAt,
              updatedAt: segmentation.updatedAt
            }
          }, 'Obrázek načten');
        } else {
          ResponseHelper.success(res, image, 'Obrázek načten');
        }
      } else {
        ResponseHelper.success(res, image, 'Obrázek načten');
      }

    } catch (error) {
      logger.error('Failed to get image with segmentation', error instanceof Error ? error : undefined, 'ImageController', {
        userId: req.user?.id,
        imageId: req.params.imageId
      });

      const errorMessage = error instanceof Error ? error.message : 'Neznámá chyba';
      ResponseHelper.internalError(res, error as Error);
    }
  };

  /**
   * Get image statistics for a project
   * GET /api/projects/:projectId/images/stats
   */
  getImageStats = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user!.id;
      const { id: projectId } = req.params;

      if (!projectId) {
        ResponseHelper.badRequest(res, 'Project ID is required');
        return;
      }

      logger.info('Getting image statistics', 'ImageController', {
        projectId,
        userId
      });

      const stats = await this.imageService.getImageStats(projectId, userId);

      ResponseHelper.success(res, { stats }, 'Statistiky obrázků úspěšně načteny');

    } catch (error) {
      logger.error('Failed to get image statistics', error instanceof Error ? error : undefined, 'ImageController', {
        userId: req.user?.id,
        projectId: req.params.id
      });

      const errorMessage = error instanceof Error ? error.message : 'Neznámá chyba';
      if (errorMessage.includes('nenalezen') || errorMessage.includes('oprávnění')) {
        ResponseHelper.notFound(res, errorMessage);
      } else {
        ResponseHelper.internalError(res, error as Error);
      }
    }
  };
}