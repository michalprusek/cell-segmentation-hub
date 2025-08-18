import { Request, Response } from 'express';
import { ImageService } from '../../services/imageService';
import { ThumbnailService } from '../../services/thumbnailService';
import { ResponseHelper } from '../../utils/response';
import { logger } from '../../utils/logger';
import { prisma } from '../../db/index';
import { getStorageProvider } from '../../storage/index';

export class ImageController {
  private imageService: ImageService;
  private thumbnailService: ThumbnailService;

  constructor() {
    this.imageService = new ImageService(prisma);
    this.thumbnailService = new ThumbnailService(prisma);
  }

  /**
   * Upload images to a project
   * POST /api/projects/:id/images
   */
  uploadImages = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        ResponseHelper.unauthorized(res, 'Unauthorized access');
        return;
      }
      const { id: projectId } = req.params;
      if (!projectId) {
        ResponseHelper.badRequest(res, 'Project ID is required');
        return;
      }

      // Check if files were uploaded
      const files = req.files as Array<{
        fieldname: string;
        originalname: string;
        path: string;
        size: number;
        buffer: Buffer;
        mimetype: string;
      }> | undefined;
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
        projectId,
        userId,
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
      const userId = req.user?.id;
      if (!userId) {
        ResponseHelper.unauthorized(res, 'Unauthorized access');
        return;
      }
      const { id: projectId } = req.params;
      if (!projectId) {
        ResponseHelper.badRequest(res, 'Project ID is required');
        return;
      }

      // Parse query parameters with defaults
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const sortByRaw = (req.query.sortBy as string) || 'createdAt';
      const sortOrderRaw = (req.query.sortOrder as string) || 'desc';
      const statusRaw = req.query.status as string | undefined;

      // Validate sortBy
      const allowedSortFields = ['name', 'createdAt', 'updatedAt', 'fileSize'];
      if (!allowedSortFields.includes(sortByRaw)) {
        res.status(400).json({ error: 'Invalid query parameter', field: 'sortBy' });
        return;
      }

      // Validate sortOrder
      if (!['asc', 'desc'].includes(sortOrderRaw)) {
        res.status(400).json({ error: 'Invalid query parameter', field: 'sortOrder' });
        return;
      }

      // Validate status
      const allowedStatuses = ['pending', 'processing', 'completed', 'failed'];
      if (statusRaw && !allowedStatuses.includes(statusRaw)) {
        res.status(400).json({ error: 'Invalid query parameter', field: 'status' });
        return;
      }

      const sortBy = sortByRaw;
      const sortOrder = sortOrderRaw;
      const status = statusRaw;

      const queryParams = {
        page,
        limit,
        sortBy: sortBy as 'name' | 'createdAt' | 'updatedAt' | 'fileSize',
        sortOrder: sortOrder as 'asc' | 'desc',
        status: status as 'pending' | 'processing' | 'completed' | 'failed' | undefined
      };

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
      const userId = req.user?.id;
      if (!userId) {
        ResponseHelper.unauthorized(res, 'Unauthorized access');
        return;
      }
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
      const userId = req.user?.id;
      if (!userId) {
        ResponseHelper.unauthorized(res, 'Unauthorized access');
        return;
      }
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
      const userId = req.user?.id;
      if (!userId) {
        ResponseHelper.unauthorized(res, 'Unauthorized access');
        return;
      }
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
            logger.error('Failed to parse segmentation polygons:', error instanceof Error ? error : new Error(String(error)), 'ImageController');
            ResponseHelper.internalError(res, new Error('Invalid segmentation data format'));
            return;
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

      ResponseHelper.internalError(res, error as Error);
    }
  };

  /**
   * Get image statistics for a project
   * GET /api/projects/:projectId/images/stats
   */
  getImageStats = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        ResponseHelper.unauthorized(res, 'Unauthorized access');
        return;
      }
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

  /**
   * Get project images with optimized thumbnail data for cards
   * GET /api/projects/:projectId/images-with-thumbnails
   */
  getProjectImagesWithThumbnails = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        ResponseHelper.unauthorized(res, 'Unauthorized access');
        return;
      }

      const { projectId } = req.params;
      const { 
        lod = 'low',  // level of detail: low, medium, high
        page = '1',
        limit = '50'
      } = req.query;

      if (!projectId) {
        ResponseHelper.badRequest(res, 'Project ID is required');
        return;
      }

      // Validate and parse page parameter
      const pageNum = parseInt(page as string, 10);
      if (isNaN(pageNum) || pageNum < 1) {
        ResponseHelper.badRequest(res, 'Page must be a positive integer');
        return;
      }

      // Validate and parse limit parameter
      const limitNum = parseInt(limit as string, 10);
      if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
        ResponseHelper.badRequest(res, 'Limit must be a positive integer between 1 and 100');
        return;
      }

      // Validate level of detail parameter
      const validLods = ['low', 'medium', 'high'] as const;
      const levelOfDetail = lod as string;
      if (!validLods.includes(levelOfDetail as any)) {
        ResponseHelper.badRequest(res, 'Level of detail must be one of: low, medium, high');
        return;
      }

      logger.info('Getting project images with thumbnails', 'ImageController', {
        projectId,
        userId,
        levelOfDetail,
        page: pageNum,
        limit: limitNum
      });

      // Verify project ownership
      const project = await prisma.project.findFirst({
        where: {
          id: projectId,
          userId
        }
      });

      if (!project) {
        ResponseHelper.notFound(res, 'Projekt nenalezen nebo nemáte oprávnění');
        return;
      }

      // Get images with segmentation data in a single optimized query
      const images = await prisma.image.findMany({
        where: {
          projectId
        },
        include: {
          segmentation: {
            include: {
              segmentationThumbnails: {
                where: {
                  levelOfDetail
                }
              }
            }
          }
        },
        orderBy: {
          updatedAt: 'desc'
        },
        skip: (pageNum - 1) * limitNum,
        take: limitNum
      });

      // Get total count for pagination
      const totalCount = await prisma.image.count({
        where: { projectId }
      });

      // Get storage provider for URL generation
      const storage = getStorageProvider();

      // Transform data for frontend with proper URLs
      const transformedImages = await Promise.all(images.map(async (image) => {
        let thumbnailData: {
          polygons: any[];
          imageWidth: number | null;
          imageHeight: number | null;
          levelOfDetail: string;
          polygonCount: number;
          pointCount: number;
          compressionRatio: number;
        } | null = null;

        if (image.segmentation && image.segmentation.segmentationThumbnails.length > 0) {
          const thumbnail = image.segmentation.segmentationThumbnails[0];
          if (thumbnail) {
            try {
              const parsedPolygons = JSON.parse(thumbnail.simplifiedData);
              
              // Validate the parsed data structure
              if (!Array.isArray(parsedPolygons)) {
                throw new Error('Parsed polygon data is not an array');
              }
              
              // Basic validation for polygon structure
              for (const polygon of parsedPolygons) {
                if (!polygon || typeof polygon !== 'object') {
                  throw new Error('Invalid polygon structure');
                }
                if (!Array.isArray(polygon.points) && !Array.isArray(polygon.coordinates)) {
                  throw new Error('Polygon missing points/coordinates array');
                }
              }
              
              thumbnailData = {
                polygons: parsedPolygons,
                imageWidth: image.segmentation.imageWidth,
                imageHeight: image.segmentation.imageHeight,
                levelOfDetail: thumbnail.levelOfDetail,
                polygonCount: thumbnail.polygonCount,
                pointCount: thumbnail.pointCount,
                compressionRatio: thumbnail.compressionRatio
              };
            } catch (error) {
              logger.error(
                `Failed to parse or validate thumbnail data for image ${image.id}: ${error instanceof Error ? error.message : String(error)}`,
                error instanceof Error ? error : new Error(String(error)),
                'ImageController'
              );
              // Use safe default when parsing fails
              thumbnailData = {
                polygons: [],
                imageWidth: image.segmentation.imageWidth,
                imageHeight: image.segmentation.imageHeight,
                levelOfDetail: thumbnail.levelOfDetail,
                polygonCount: 0,
                pointCount: 0,
                compressionRatio: thumbnail.compressionRatio
              };
            }
          }
        }

        // Generate proper URLs using storage service
        const originalUrl = await storage.getUrl(image.originalPath);
        const thumbnailUrl = image.thumbnailPath 
          ? await storage.getUrl(image.thumbnailPath)
          : originalUrl; // Fallback to original if no thumbnail

        return {
          id: image.id,
          name: image.name,
          thumbnail_url: thumbnailUrl,
          url: originalUrl,
          image_url: originalUrl,
          projectId: image.projectId,
          segmentationStatus: image.segmentationStatus,
          fileSize: image.fileSize,
          width: image.width,
          height: image.height,
          mimeType: image.mimeType,
          createdAt: image.createdAt,
          updatedAt: image.updatedAt,
          segmentationResult: thumbnailData
        };
      }));

      const response = {
        images: transformedImages,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total: totalCount,
          pages: Math.ceil(totalCount / limitNum)
        },
        metadata: {
          levelOfDetail,
          totalImages: totalCount,
          imagesWithThumbnails: transformedImages.filter(img => img.segmentationResult).length
        }
      };

      logger.debug(
        `✅ Retrieved ${transformedImages.length} images with thumbnails (${response.metadata.imagesWithThumbnails} with segmentation)`,
        'ImageController',
        {
          projectId,
          levelOfDetail,
          totalImages: totalCount
        }
      );

      ResponseHelper.success(res, response, 'Obrázky s náhledy úspěšně načteny');

    } catch (error) {
      logger.error(
        'Failed to get project images with thumbnails',
        error instanceof Error ? error : undefined,
        'ImageController',
        {
          userId: req.user?.id,
          projectId: req.params.projectId
        }
      );

      const errorMessage = error instanceof Error ? error.message : 'Neznámá chyba';
      if (errorMessage.includes('nenalezen') || errorMessage.includes('oprávnění')) {
        ResponseHelper.notFound(res, errorMessage);
      } else {
        ResponseHelper.internalError(res, error as Error);
      }
    }
  };

  /**
   * Get browser-compatible image for display
   * GET /api/images/:imageId/display
   */
  getImageForDisplay = async (req: Request, res: Response): Promise<void> => {
    try {
      const { imageId } = req.params;
      if (!imageId) {
        ResponseHelper.badRequest(res, 'Image ID is required');
        return;
      }

      // Optional user ID for logging (but don't require authentication for display)
      const userId = req.user?.id;
      
      logger.info('Serving image for display', 'ImageController', {
        imageId,
        userId: userId || 'anonymous'
      });

      // Get browser-compatible image data (without strict user permission check for display)
      const imageData = await this.imageService.getBrowserCompatibleImage(imageId);

      // Set appropriate headers
      res.set({
        'Content-Type': imageData.mimeType,
        'Content-Length': imageData.buffer.length.toString(),
        'Cache-Control': 'public, max-age=31536000', // Cache for 1 year
        'ETag': `"${imageId}"`,
        'Content-Disposition': `inline; filename="${imageData.filename}"`
      });

      // Send the image buffer
      res.send(imageData.buffer);

    } catch (error) {
      logger.error('Failed to serve image for display', error instanceof Error ? error : undefined, 'ImageController', {
        imageId: req.params.imageId,
        userId: req.user?.id
      });

      if (error instanceof Error && error.message.includes('nenalezen')) {
        ResponseHelper.notFound(res, 'Image not found or access denied');
      } else {
        ResponseHelper.internalError(res, error as Error, undefined, 'ImageController');
      }
    }
  };
}