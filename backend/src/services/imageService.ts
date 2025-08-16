import { PrismaClient, Image, Prisma } from '@prisma/client';
import { getStorageProvider, LocalStorageProvider } from '../storage/index';
import { logger } from '../utils/logger';
import { ImageQueryParams } from '../types/validation';
import { v4 as uuidv4 } from 'uuid';

export interface UploadImageData {
  originalname: string;
  buffer: Buffer;
  mimetype: string;
  size: number;
}

export interface ImageWithUrls extends Image {
  originalUrl: string;
  thumbnailUrl?: string;
}

export interface ImageStats {
  totalImages: number;
  totalSize: number;
  byStatus: {
    no_segmentation: number;
    queued: number;
    processing: number;
    segmented: number;
    failed: number;
  };
  byMimeType: Record<string, number>;
}

export interface PaginatedImages {
  images: ImageWithUrls[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

export class ImageService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Upload multiple images to a project
   */
  async uploadImages(
    projectId: string,
    userId: string,
    files: UploadImageData[]
  ): Promise<ImageWithUrls[]> {
    const storage = getStorageProvider();
    const uploadedImages: ImageWithUrls[] = [];

    // Verify project ownership
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, userId }
    });

    if (!project) {
      throw new Error('Projekt nenalezen nebo nemáte oprávnění');
    }

    logger.info('Starting image upload', 'ImageService', {
      projectId,
      userId,
      fileCount: files.length,
      totalSize: files.reduce((sum, file) => sum + file.size, 0)
    });

    // Process each file
    for (const file of files) {
      try {
        // Generate unique storage key
        const storageKey = LocalStorageProvider.generateKey(
          userId,
          projectId,
          file.originalname,
          true
        );

        // Upload to storage with thumbnail generation
        const uploadResult = await storage.upload(file.buffer, storageKey, {
          mimeType: file.mimetype,
          originalName: file.originalname,
          generateThumbnail: true
        });

        // Create database record
        const image = await this.prisma.image.create({
          data: {
            name: file.originalname,
            originalPath: uploadResult.originalPath,
            thumbnailPath: uploadResult.thumbnailPath,
            projectId,
            fileSize: uploadResult.fileSize,
            width: uploadResult.width,
            height: uploadResult.height,
            mimeType: uploadResult.mimeType,
            segmentationStatus: 'no_segmentation'
          }
        });

        // Get URLs for response
        const originalUrl = await storage.getUrl(uploadResult.originalPath);
        const thumbnailUrl = uploadResult.thumbnailPath 
          ? await storage.getUrl(uploadResult.thumbnailPath)
          : undefined;

        uploadedImages.push({
          ...image,
          originalUrl,
          thumbnailUrl
        });

        logger.info('Image uploaded successfully', 'ImageService', {
          imageId: image.id,
          filename: file.originalname,
          size: uploadResult.fileSize
        });

      } catch (error) {
        logger.error('Failed to upload image', error instanceof Error ? error : undefined, 'ImageService', {
          filename: file.originalname,
          projectId,
          userId
        });
        
        // Continue with other files, don't throw error
        // We'll handle partial failures gracefully
      }
    }

    // Check if at least some images were uploaded
    if (uploadedImages.length === 0 && files.length > 0) {
      throw new Error('Žádný soubor se nepodařilo nahrát. Zkontrolujte formát a velikost souborů.');
    }

    logger.info('Image upload completed', 'ImageService', {
      projectId,
      userId,
      uploadedCount: uploadedImages.length,
      failedCount: files.length - uploadedImages.length
    });

    return uploadedImages;
  }

  /**
   * Get paginated list of images in a project
   */
  async getProjectImages(
    projectId: string,
    userId: string,
    options: ImageQueryParams
  ): Promise<PaginatedImages> {
    // Verify project ownership
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, userId }
    });

    if (!project) {
      throw new Error('Projekt nenalezen nebo nemáte oprávnění');
    }

    const { page, limit, status, sortBy, sortOrder } = options;
    const skip = (page - 1) * limit;

    // Build where clause
    const where: Prisma.ImageWhereInput = {
      projectId
    };

    if (status) {
      where.segmentationStatus = status;
    }

    // Build order by clause
    const orderBy: Prisma.ImageOrderByWithRelationInput = {};
    orderBy[sortBy] = sortOrder;

    // Get total count
    const total = await this.prisma.image.count({ where });

    // Get images
    const images = await this.prisma.image.findMany({
      where,
      orderBy,
      skip,
      take: limit
    });

    // Add URLs to images
    const storage = getStorageProvider();
    const imagesWithUrls: ImageWithUrls[] = await Promise.all(
      images.map(async (image) => {
        const originalUrl = await storage.getUrl(image.originalPath);
        const thumbnailUrl = image.thumbnailPath 
          ? await storage.getUrl(image.thumbnailPath)
          : undefined;

        return {
          ...image,
          originalUrl,
          thumbnailUrl
        };
      })
    );

    const totalPages = Math.ceil(total / limit);

    return {
      images: imagesWithUrls,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1
      }
    };
  }

  /**
   * Get single image by ID with permission check
   */
  async getImageById(imageId: string, userId: string): Promise<ImageWithUrls | null> {
    const image = await this.prisma.image.findFirst({
      where: {
        id: imageId,
        project: {
          userId
        }
      },
      include: {
        project: true
      }
    });

    if (!image) {
      return null;
    }

    // Add URLs
    const storage = getStorageProvider();
    const originalUrl = await storage.getUrl(image.originalPath);
    const thumbnailUrl = image.thumbnailPath 
      ? await storage.getUrl(image.thumbnailPath)
      : undefined;

    return {
      ...image,
      originalUrl,
      thumbnailUrl
    };
  }

  /**
   * Delete image with storage cleanup
   */
  async deleteImage(imageId: string, userId: string): Promise<void> {
    // Find image with permission check
    const image = await this.prisma.image.findFirst({
      where: {
        id: imageId,
        project: {
          userId
        }
      }
    });

    if (!image) {
      throw new Error('Obrázek nenalezen nebo nemáte oprávnění');
    }

    const storage = getStorageProvider();

    try {
      // Delete from storage
      await storage.delete(image.originalPath);
      
      if (image.thumbnailPath) {
        await storage.delete(image.thumbnailPath);
      }

      // Delete from database (this will also delete related segmentation data due to CASCADE)
      await this.prisma.image.delete({
        where: { id: imageId }
      });

      logger.info('Image deleted successfully', 'ImageService', {
        imageId,
        filename: image.name,
        userId
      });

    } catch (error) {
      logger.error('Failed to delete image', error instanceof Error ? error : undefined, 'ImageService', {
        imageId,
        userId
      });
      
      throw new Error(`Chyba při mazání obrázku: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get image statistics for a project
   */
  async getImageStats(projectId: string, userId: string): Promise<ImageStats> {
    // Verify project ownership
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, userId }
    });

    if (!project) {
      throw new Error('Projekt nenalezen nebo nemáte oprávnění');
    }

    // Get all images in the project
    const images = await this.prisma.image.findMany({
      where: { projectId },
      select: {
        fileSize: true,
        segmentationStatus: true,
        mimeType: true
      }
    });

    const totalImages = images.length;
    const totalSize = images.reduce((sum, img) => sum + (img.fileSize || 0), 0);

    // Count by status
    const byStatus = {
      no_segmentation: 0,
      queued: 0,
      processing: 0,
      segmented: 0,
      failed: 0
    };

    // Count by MIME type
    const byMimeType: Record<string, number> = {};

    images.forEach(image => {
      // Count by status
      if (image.segmentationStatus in byStatus) {
        byStatus[image.segmentationStatus as keyof typeof byStatus]++;
      }

      // Count by MIME type
      if (image.mimeType) {
        byMimeType[image.mimeType] = (byMimeType[image.mimeType] || 0) + 1;
      }
    });

    return {
      totalImages,
      totalSize,
      byStatus,
      byMimeType
    };
  }

  /**
   * Update image segmentation status
   */
  async updateSegmentationStatus(
    imageId: string,
    status: 'no_segmentation' | 'queued' | 'processing' | 'segmented' | 'failed',
    userId?: string
  ): Promise<void> {
    const where: Prisma.ImageWhereInput = { id: imageId };
    
    // Add user permission check if userId is provided
    if (userId) {
      where.project = { userId };
    }

    const image = await this.prisma.image.findFirst({ where });

    if (!image) {
      throw new Error('Obrázek nenalezen nebo nemáte oprávnění');
    }

    await this.prisma.image.update({
      where: { id: imageId },
      data: { segmentationStatus: status }
    });

    logger.info('Image segmentation status updated', 'ImageService', {
      imageId,
      status,
      userId
    });
  }
}