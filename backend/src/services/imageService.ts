import { PrismaClient, Image, Prisma } from '@prisma/client';
import { getStorageProvider, LocalStorageProvider } from '../storage/index';
import { logger } from '../utils/logger';
import { config } from '../utils/config';
import { getBaseUrl } from '../utils/getBaseUrl';
import { ImageQueryParams } from '../types/validation';
import { v4 as _uuidv4 } from 'uuid';
import sharp from 'sharp';
import path from 'path';
import { existsSync } from 'fs';
import { promises as fs } from 'fs';
import { ApiError } from '../middleware/error';

export interface UploadImageData {
  originalname: string;
  buffer: Buffer;
  mimetype: string;
  size: number;
}

export interface ImageWithUrls extends Image {
  originalUrl: string;
  thumbnailUrl?: string;
  displayUrl: string; // Browser-compatible URL for display
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

    // Verify project ownership or share access
    const project = await this.prisma.project.findFirst({
      where: {
        id: projectId,
        OR: [
          { userId }, // User owns the project
          {
            shares: {
              some: {
                OR: [
                  { sharedWithId: userId, status: 'accepted' },
                  {
                    sharedWith: { id: userId },
                    status: 'accepted'
                  }
                ]
              }
            }
          }
        ]
      }
    });

    if (!project) {
      throw ApiError.forbidden('Access denied to this project');
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
          thumbnailUrl,
          displayUrl: this.getDisplayUrl(image.id)
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
    // Get user email for share checking
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true }
    });

    if (!user) {
      throw ApiError.notFound('User not found');
    }

    // Verify project ownership or share access
    const project = await this.prisma.project.findFirst({
      where: {
        id: projectId,
        OR: [
          { userId }, // User owns the project
          {
            shares: {
              some: {
                status: 'accepted',
                OR: [
                  { sharedWithId: userId },
                  { email: user.email }
                ]
              }
            }
          }
        ]
      }
    });
    
    if (!project) {
      throw ApiError.forbidden('Access denied to this project');
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
          thumbnailUrl,
          displayUrl: this.getDisplayUrl(image.id)
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
    // Get user email for share checking
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true }
    });

    if (!user) {
      return null;
    }

    const image = await this.prisma.image.findFirst({
      where: {
        id: imageId,
        project: {
          OR: [
            { userId }, // User owns the project
            {
              shares: {
                some: {
                  OR: [
                    { sharedWithId: userId, status: 'accepted' },
                    { email: user.email, status: { in: ['pending', 'accepted'] } }
                  ]
                }
              }
            }
          ]
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
      thumbnailUrl,
      displayUrl: this.getDisplayUrl(image.id)
    };
  }

  /**
   * Delete image with storage cleanup
   */
  async deleteImage(imageId: string, userId: string): Promise<void> {
    // Find image with permission check - allow both owners and shared users
    const image = await this.prisma.image.findFirst({
      where: {
        id: imageId,
        project: {
          OR: [
            { userId }, // User owns the project
            {
              shares: {
                some: {
                  OR: [
                    { sharedWithId: userId, status: 'accepted' },
                    {
                      sharedWith: { id: userId },
                      status: 'accepted'
                    }
                  ]
                }
              }
            }
          ]
        }
      }
    });

    if (!image) {
      throw ApiError.forbidden('Access denied to this image');
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
   * Delete multiple images in batch with transaction
   */
  async deleteBatch(imageIds: string[], userId: string, projectId: string): Promise<{
    deletedCount: number;
    failedIds: string[];
    errors: string[];
  }> {
    let deletedCount = 0;
    const failedIds: string[] = [];
    const errors: string[] = [];

    logger.info('Starting batch delete operation', 'ImageService', {
      imageIds,
      userId,
      projectId,
      count: imageIds.length
    });

    // Verify project ownership or shared access first
    const project = await this.prisma.project.findFirst({
      where: {
        id: projectId,
        OR: [
          { userId }, // User owns the project
          {
            shares: {
              some: {
                OR: [
                  { sharedWithId: userId, status: 'accepted' },
                  {
                    sharedWith: { id: userId },
                    status: 'accepted'
                  }
                ]
              }
            }
          }
        ]
      }
    });

    if (!project) {
      throw ApiError.forbidden('Access denied to this project');
    }

    // Get all images that exist and belong to the project (owner or shared)
    const imagesToDelete = await this.prisma.image.findMany({
      where: {
        id: { in: imageIds },
        projectId,
        project: {
          OR: [
            { userId }, // User owns the project
            {
              shares: {
                some: {
                  OR: [
                    { sharedWithId: userId, status: 'accepted' },
                    {
                      sharedWith: { id: userId },
                      status: 'accepted'
                    }
                  ]
                }
              }
            }
          ]
        }
      }
    });

    if (imagesToDelete.length === 0) {
      throw new Error('No images found for deletion');
    }

    const storage = getStorageProvider();

    // Process deletions in transaction for database operations
    await this.prisma.$transaction(async (tx) => {
      for (const image of imagesToDelete) {
        try {
          // Delete from storage first
          await storage.delete(image.originalPath);
          
          if (image.thumbnailPath) {
            await storage.delete(image.thumbnailPath);
          }

          // Delete from database (CASCADE will handle segmentation data)
          await tx.image.delete({
            where: { id: image.id }
          });

          deletedCount++;

          logger.info('Image deleted in batch', 'ImageService', {
            imageId: image.id,
            filename: image.name,
            userId
          });

        } catch (error) {
          failedIds.push(image.id);
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';
          errors.push(`Image ${image.name}: ${errorMsg}`);
          
          logger.error('Failed to delete image in batch', error instanceof Error ? error : undefined, 'ImageService', {
            imageId: image.id,
            userId
          });
        }
      }
    });

    // Check for images that weren't found
    const foundIds = imagesToDelete.map(img => img.id);
    const notFoundIds = imageIds.filter(id => !foundIds.includes(id));
    
    if (notFoundIds.length > 0) {
      failedIds.push(...notFoundIds);
      errors.push(...notFoundIds.map(id => `Image ${id}: Not found or no permission`));
    }

    logger.info('Batch delete operation completed', 'ImageService', {
      deletedCount,
      failedCount: failedIds.length,
      userId,
      projectId
    });

    return {
      deletedCount,
      failedIds,
      errors
    };
  }

  /**
   * Get image statistics for a project
   */
  async getImageStats(projectId: string, userId: string): Promise<ImageStats> {
    // Verify project ownership or share access
    const project = await this.prisma.project.findFirst({
      where: {
        id: projectId,
        OR: [
          { userId }, // User owns the project
          {
            shares: {
              some: {
                OR: [
                  { sharedWithId: userId, status: 'accepted' },
                  {
                    sharedWith: { id: userId },
                    status: 'accepted'
                  }
                ]
              }
            }
          }
        ]
      }
    });

    if (!project) {
      throw ApiError.forbidden('Access denied to this project');
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
    let where: Prisma.ImageWhereInput = { id: imageId };
    
    // Add user permission check if userId is provided
    if (userId) {
      // Get user email for share checking
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { email: true }
      });

      if (!user) {
        throw ApiError.notFound('User not found');
      }

      // Use same permission check as getImageById method - check both ownership AND shared access
      where = {
        id: imageId,
        project: {
          OR: [
            { userId }, // User owns the project
            {
              shares: {
                some: {
                  status: 'accepted',
                  OR: [
                    { sharedWithId: userId },
                    { email: user.email }
                  ]
                }
              }
            }
          ]
        }
      };
    }

    const image = await this.prisma.image.findFirst({ where });

    if (!image) {
      throw ApiError.forbidden('Access denied to this project');
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

  /**
   * Get browser-compatible image data by converting unsupported formats
   */
  async getBrowserCompatibleImage(imageId: string, userId?: string): Promise<{
    buffer: Buffer;
    mimeType: string;
    filename: string;
  }> {
    // Find the image
    const where: Prisma.ImageWhereInput = { id: imageId };
    if (userId) {
      where.project = { userId };
    }

    const image = await this.prisma.image.findFirst({ where });
    if (!image) {
      throw ApiError.forbidden('Access denied to this project');
    }
    
    // Check if conversion is needed
    const browserSupportedTypes = [
      'image/jpeg',
      'image/jpg', 
      'image/png',
      'image/gif',
      'image/webp',
      'image/bmp'
    ];

    // If already browser-compatible, return original
    if (image.mimeType && browserSupportedTypes.includes(image.mimeType)) {
      const originalBuffer = await this.getImageBuffer(image.originalPath);
      return {
        buffer: originalBuffer,
        mimeType: image.mimeType,
        filename: image.name
      };
    }

    // Check for cached converted version
    const convertedKey = `converted/${imageId}.png`;
    const convertedPath = path.join(process.env.UPLOAD_DIR || './uploads', convertedKey);
    
    if (existsSync(convertedPath)) {
      // Periodically clean up old converted files (don't await to avoid blocking)
      this.cleanupConvertedCache().catch(error => 
        logger.error('Background cleanup failed', error)
      );
      
      logger.info('Serving cached converted image', 'ImageService', { imageId, originalType: image.mimeType });
      const cachedBuffer = await fs.readFile(convertedPath);
      return {
        buffer: cachedBuffer,
        mimeType: 'image/png',
        filename: image.name.replace(/\.[^.]+$/, '.png')
      };
    }

    // Convert unsupported format to PNG
    logger.info('Converting image for browser compatibility', 'ImageService', { 
      imageId, 
      originalType: image.mimeType,
      targetType: 'image/png'
    });

    try {
      const originalBuffer = await this.getImageBuffer(image.originalPath);
      
      // Convert using Sharp
      const convertedBuffer = await sharp(originalBuffer)
        .png({
          quality: 90,
          compressionLevel: 6
        })
        .toBuffer();

      // Cache the converted image
      const convertedDir = path.dirname(convertedPath);
      if (!existsSync(convertedDir)) {
        await fs.mkdir(convertedDir, { recursive: true });
      }
      await fs.writeFile(convertedPath, convertedBuffer);

      logger.info('Image converted and cached successfully', 'ImageService', {
        imageId,
        originalSize: originalBuffer.length,
        convertedSize: convertedBuffer.length,
        originalType: image.mimeType
      });

      return {
        buffer: convertedBuffer,
        mimeType: 'image/png',
        filename: image.name.replace(/\.[^.]+$/, '.png')
      };

    } catch (error) {
      logger.error('Failed to convert image', error instanceof Error ? error : undefined, 'ImageService', {
        imageId,
        originalType: image.mimeType
      });
      throw new Error(`Error converting image: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Generate display URL for browser-compatible image viewing
   */
  private getDisplayUrl(imageId: string): string {
    const baseUrl = getBaseUrl();
    
    if (!baseUrl) {
      const missingVars = [
        'API_BASE_URL', 'BACKEND_URL', 'PUBLIC_URL'
      ].filter(varName => !process.env[varName]);
      
      logger.error(
        `Base URL configuration missing. Environment: ${config.NODE_ENV}. Missing variables: ${missingVars.join(', ')}`, 
        undefined, 
        'ImageService'
      );
      
      // Try fallback from DEFAULT_BASE_URL if configured
      if (process.env.DEFAULT_BASE_URL) {
        logger.warn(`Using fallback DEFAULT_BASE_URL: ${process.env.DEFAULT_BASE_URL}`, undefined, 'ImageService');
        const fallbackBase = process.env.DEFAULT_BASE_URL.replace(/\/+$/, '');
        return `${fallbackBase}/api/images/${imageId}/display`;
      }
      
      throw new Error(`Base URL configuration required. Missing: ${missingVars.join(', ')}. Set one of: API_BASE_URL, BACKEND_URL, PUBLIC_URL, or DEFAULT_BASE_URL`);
    }
    
    // Remove trailing slash for consistency
    const normalizedBase = baseUrl.replace(/\/+$/, '');
    
    return `${normalizedBase}/api/images/${imageId}/display`;
  }

  /**
   * Helper method to get image buffer from storage
   */
  private async getImageBuffer(imagePath: string): Promise<Buffer> {
    const storage = getStorageProvider();
    
    if (storage instanceof LocalStorageProvider) {
      // For local storage, read file directly
      const fullPath = path.join(process.env.UPLOAD_DIR || './uploads', imagePath);
      if (!existsSync(fullPath)) {
        throw new Error('Image file not found');
      }
      return await fs.readFile(fullPath);
    } else {
      // For other storage providers, implement buffer retrieval
      throw new Error('Buffer retrieval not implemented for this storage provider');
    }
  }

  /**
   * Clean up old converted PNG files from cache
   */
  private async cleanupConvertedCache(retentionDays = 7): Promise<void> {
    try {
      const convertedDir = path.join(process.env.UPLOAD_DIR || './uploads', 'converted');
      
      // Skip if directory doesn't exist
      if (!existsSync(convertedDir)) {
        return;
      }

      const files = await fs.readdir(convertedDir);
      const cutoffTime = Date.now() - (retentionDays * 24 * 60 * 60 * 1000);

      for (const file of files) {
        const filePath = path.join(convertedDir, file);
        
        try {
          const stats = await fs.stat(filePath);
          if (stats.mtimeMs < cutoffTime) {
            await fs.unlink(filePath);
            logger.info('Removed old converted file', 'ImageService', { 
              file, 
              ageInDays: Math.floor((Date.now() - stats.mtimeMs) / (24 * 60 * 60 * 1000)) 
            });
          }
        } catch (error) {
          logger.error('Failed to process converted file during cleanup', error instanceof Error ? error : new Error(String(error)));
        }
      }
    } catch (error) {
      logger.error('Failed to cleanup converted cache', error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Remove converted files for a specific image
   */
  async removeConvertedFile(imageId: string): Promise<void> {
    try {
      const convertedPath = path.join(
        process.env.UPLOAD_DIR || './uploads',
        'converted',
        `${imageId}.png`
      );
      
      if (existsSync(convertedPath)) {
        await fs.unlink(convertedPath);
        logger.info('Removed converted file for deleted image', 'ImageService', { imageId });
      }
    } catch (error) {
      logger.error('Failed to remove converted file', error instanceof Error ? error : new Error(String(error)));
    }
  }
}