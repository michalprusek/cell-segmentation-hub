import { PrismaClient, Image, Prisma } from '@prisma/client';
import { getStorageProvider, LocalStorageProvider } from '../storage/index';
import { logger } from '../utils/logger';
import { config } from '../utils/config';
import { getBaseUrl } from '../utils/getBaseUrl';
import { ImageQueryParams } from '../types/validation';
import { v4 as _uuidv4 } from 'uuid';
import sharp from 'sharp';
import path from 'path';
import { promises as fs } from 'fs';
import { ApiError } from '../middleware/error';
import { WebSocketService } from './websocketService';
import {
  WebSocketEvent,
  ProjectUpdateData,
  DashboardUpdateData,
} from '../types/websocket';
import * as UserService from './userService';

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export interface UploadImageData {
  originalname: string;
  buffer: Buffer;
  mimetype: string;
  size: number;
}

export interface ImageWithUrls extends Image {
  originalUrl: string;
  thumbnailUrl?: string;
  segmentationThumbnailUrl?: string; // URL for segmentation thumbnail
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
   * Get WebSocket service instance if available
   */
  private getWebSocketService(): WebSocketService | null {
    try {
      return WebSocketService.getInstance();
    } catch {
      // WebSocket service not initialized yet
      return null;
    }
  }

  /**
   * Calculate and emit project statistics update via WebSocket
   */
  private async emitProjectStatsUpdate(
    projectId: string,
    userId: string,
    operation: 'created' | 'updated' | 'deleted'
  ): Promise<void> {
    try {
      const wsService = this.getWebSocketService();
      if (!wsService) {
        logger.debug(
          'WebSocket service not available, skipping project stats update',
          'ImageService'
        );
        return;
      }

      // Calculate current project statistics
      const [imageCount, segmentedCount] = await Promise.all([
        this.prisma.image.count({
          where: { projectId },
        }),
        this.prisma.image.count({
          where: {
            projectId,
            segmentationStatus: 'segmented',
          },
        }),
      ]);

      const projectUpdate: ProjectUpdateData = {
        projectId,
        userId,
        operation,
        updates: {
          imageCount,
          segmentedCount,
        },
        timestamp: new Date(),
      };

      // Emit to user who made the change
      wsService.emitToUser(
        userId,
        WebSocketEvent.PROJECT_UPDATE,
        projectUpdate
      );

      // Also emit to project room for other collaborators
      wsService.broadcastProjectUpdate(projectId, projectUpdate);

      // Emit dashboard metrics update for the user
      await this.emitDashboardUpdate(userId);

      logger.debug('Project stats update emitted', 'ImageService', {
        projectId,
        userId,
        operation,
        imageCount,
        segmentedCount,
      });
    } catch (error) {
      logger.error(
        'Failed to emit project stats update',
        error instanceof Error ? error : undefined,
        'ImageService',
        {
          projectId,
          userId,
          operation,
        }
      );
    }
  }

  /**
   * Calculate and emit dashboard metrics update via WebSocket
   */
  private async emitDashboardUpdate(userId: string): Promise<void> {
    try {
      const wsService = this.getWebSocketService();
      if (!wsService) {
        logger.debug(
          'WebSocket service not available, skipping dashboard update',
          'ImageService'
        );
        return;
      }

      // Get comprehensive user statistics
      const userStats = await UserService.getUserStats(userId);

      const dashboardUpdate: DashboardUpdateData = {
        userId,
        metrics: {
          totalProjects: userStats.totalProjects,
          totalImages: userStats.totalImages,
          processedImages: userStats.processedImages,
          imagesUploadedToday: userStats.imagesUploadedToday,
          storageUsed: userStats.storageUsed,
          storageUsedBytes: userStats.storageUsedBytes,
        },
        timestamp: new Date(),
      };

      // Emit dashboard update to the specific user
      wsService.emitDashboardUpdate(userId, dashboardUpdate);

      logger.debug('Dashboard metrics update emitted', 'ImageService', {
        userId,
        metrics: dashboardUpdate.metrics,
      });
    } catch (error) {
      logger.error(
        'Failed to emit dashboard update',
        error instanceof Error ? error : undefined,
        'ImageService',
        {
          userId,
        }
      );
    }
  }

  /**
   * Upload multiple images to a project with progress tracking
   */
  async uploadImagesWithProgress(
    projectId: string,
    userId: string,
    files: UploadImageData[],
    batchId: string,
    onProgress: (
      filename: string,
      fileSize: number,
      progress: number,
      status: string,
      filesCompleted: number
    ) => void
  ): Promise<ImageWithUrls[]> {
    const storage = getStorageProvider();
    const uploadedImages: ImageWithUrls[] = [];
    let filesCompleted = 0;

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
                    status: 'accepted',
                  },
                ],
              },
            },
          },
        ],
      },
    });

    if (!project) {
      throw ApiError.forbidden('Access denied to this project');
    }

    logger.info(
      'Starting image upload with progress tracking',
      'ImageService',
      {
        projectId,
        userId,
        batchId,
        fileCount: files.length,
        totalSize: files.reduce((sum, file) => sum + file.size, 0),
      }
    );

    // Process each file with progress updates
    for (let index = 0; index < files.length; index++) {
      const file = files[index];

      try {
        // Emit progress - starting file upload
        onProgress(
          file.originalname,
          file.size,
          0,
          'uploading',
          filesCompleted
        );

        // Generate unique storage key
        const storageKey = LocalStorageProvider.generateKey(
          userId,
          projectId,
          file.originalname,
          true
        );

        // Emit progress - uploading file (50% progress)
        onProgress(
          file.originalname,
          file.size,
          50,
          'uploading',
          filesCompleted
        );

        // Upload to storage with thumbnail generation
        const uploadResult = await storage.upload(file.buffer, storageKey, {
          mimeType: file.mimetype,
          originalName: file.originalname,
          generateThumbnail: true,
        });

        // Emit progress - processing file (75% progress)
        onProgress(
          file.originalname,
          file.size,
          75,
          'processing',
          filesCompleted
        );

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
            segmentationStatus: 'no_segmentation',
          },
        });

        // Get URLs for response
        const originalUrl = await storage.getUrl(uploadResult.originalPath);
        const thumbnailUrl = uploadResult.thumbnailPath
          ? await storage.getUrl(uploadResult.thumbnailPath)
          : undefined;

        // No segmentation thumbnail yet for newly uploaded images
        const segmentationThumbnailUrl = undefined;

        uploadedImages.push({
          ...image,
          originalUrl,
          thumbnailUrl,
          segmentationThumbnailUrl,
          displayUrl: this.getDisplayUrl(image.id),
        });

        filesCompleted++;

        // Emit progress - file completed (100% progress)
        onProgress(
          file.originalname,
          file.size,
          100,
          'completed',
          filesCompleted
        );

        logger.info(
          'Image uploaded successfully with progress',
          'ImageService',
          {
            imageId: image.id,
            filename: file.originalname,
            size: uploadResult.fileSize,
            progress: `${filesCompleted}/${files.length}`,
          }
        );
      } catch (error) {
        // Emit progress - file failed
        onProgress(file.originalname, file.size, 0, 'failed', filesCompleted);

        logger.error(
          'Failed to upload image',
          error instanceof Error ? error : undefined,
          'ImageService',
          {
            filename: file.originalname,
            projectId,
            userId,
            batchId,
          }
        );

        // Continue with other files, don't throw error
      }
    }

    // Validate at least one image was uploaded
    if (uploadedImages.length === 0) {
      throw ApiError.badRequest('Failed to upload any images');
    }

    logger.info(
      'Batch upload completed with progress tracking',
      'ImageService',
      {
        projectId,
        userId,
        batchId,
        successCount: uploadedImages.length,
        failedCount: files.length - uploadedImages.length,
      }
    );

    // Emit real-time project stats update for uploaded images
    if (uploadedImages.length > 0) {
      await this.emitProjectStatsUpdate(projectId, userId, 'updated');
    }

    return uploadedImages;
  }

  /**
   * Upload multiple images to a project (legacy method without progress)
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
                    status: 'accepted',
                  },
                ],
              },
            },
          },
        ],
      },
    });

    if (!project) {
      throw ApiError.forbidden('Access denied to this project');
    }

    logger.info('Starting image upload', 'ImageService', {
      projectId,
      userId,
      fileCount: files.length,
      totalSize: files.reduce((sum, file) => sum + file.size, 0),
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
          generateThumbnail: true,
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
            segmentationStatus: 'no_segmentation',
          },
        });

        // Get URLs for response
        const originalUrl = await storage.getUrl(uploadResult.originalPath);
        const thumbnailUrl = uploadResult.thumbnailPath
          ? await storage.getUrl(uploadResult.thumbnailPath)
          : undefined;

        // No segmentation thumbnail yet for newly uploaded images
        const segmentationThumbnailUrl = undefined;

        uploadedImages.push({
          ...image,
          originalUrl,
          thumbnailUrl,
          segmentationThumbnailUrl,
          displayUrl: this.getDisplayUrl(image.id),
        });

        logger.info('Image uploaded successfully', 'ImageService', {
          imageId: image.id,
          filename: file.originalname,
          size: uploadResult.fileSize,
        });
      } catch (error) {
        logger.error(
          'Failed to upload image',
          error instanceof Error ? error : undefined,
          'ImageService',
          {
            filename: file.originalname,
            projectId,
            userId,
          }
        );

        // Continue with other files, don't throw error
        // We'll handle partial failures gracefully
      }
    }

    // Check if at least some images were uploaded
    if (uploadedImages.length === 0 && files.length > 0) {
      throw new Error(
        'Žádný soubor se nepodařilo nahrát. Zkontrolujte formát a velikost souborů.'
      );
    }

    logger.info('Image upload completed', 'ImageService', {
      projectId,
      userId,
      uploadedCount: uploadedImages.length,
      failedCount: files.length - uploadedImages.length,
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
      select: { email: true },
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
                OR: [{ sharedWithId: userId }, { email: user.email }],
              },
            },
          },
        ],
      },
    });

    if (!project) {
      throw ApiError.forbidden('Access denied to this project');
    }

    const { page, limit, status, sortBy, sortOrder } = options;
    const skip = (page - 1) * limit;

    // Build where clause. Hide video CONTAINER rows from the gallery —
    // users see frame children directly (one row per extracted frame),
    // so the container becomes a service-only entity. Standalone images
    // (isVideoContainer = false, parentVideoId = null) and extracted
    // frames (isVideoContainer = false, parentVideoId set) are both
    // returned by this filter; only the parent container is hidden.
    const where: Prisma.ImageWhereInput = {
      projectId,
      isVideoContainer: false,
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
      take: limit,
    });

    // Add URLs to images
    const storage = getStorageProvider();
    const imagesWithUrls: ImageWithUrls[] = await Promise.all(
      images.map(async image => {
        const originalUrl = await storage.getUrl(image.originalPath);
        const thumbnailUrl = image.thumbnailPath
          ? await storage.getUrl(image.thumbnailPath)
          : undefined;

        // Include segmentation thumbnail URL if available
        const segmentationThumbnailUrl = image.segmentationThumbnailPath
          ? await storage.getUrl(image.segmentationThumbnailPath)
          : undefined;

        return {
          ...image,
          originalUrl,
          thumbnailUrl,
          segmentationThumbnailUrl,
          displayUrl: this.getDisplayUrl(image.id),
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
        hasPrev: page > 1,
      },
    };
  }

  /**
   * Persist an explicit time-series ordering for a project's images.
   *
   * The order of ``imageIds`` defines the desired displayOrder: position 0 →
   * displayOrder 0, position 1 → 1, etc. All writes run inside one Prisma
   * ``$transaction`` so each request is atomic. (Two concurrent reorders
   * against the same project are last-write-wins per image under Prisma's
   * default READ COMMITTED isolation — no serialization, but also no torn
   * rows since each row update is atomic.)
   *
   * ``mode`` semantics (see ``imageReorderSchema``):
   * - ``'all'`` (default): payload must cover every image in the project,
   *   otherwise a 400 is returned. Prevents silent sort drift when the
   *   client forgets an image.
   * - ``'partial'``: listed images take displayOrder 0..N-1; the rest keep
   *   their relative createdAt ordering but are shifted to start at N.
   */
  async reorderImages(
    projectId: string,
    userId: string,
    imageIds: string[],
    mode: 'all' | 'partial' = 'all'
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    if (!user) {
      throw ApiError.notFound('User not found');
    }

    const project = await this.prisma.project.findFirst({
      where: {
        id: projectId,
        OR: [
          { userId },
          {
            shares: {
              some: {
                status: 'accepted',
                OR: [{ sharedWithId: userId }, { email: user.email }],
              },
            },
          },
        ],
      },
    });
    if (!project) {
      throw ApiError.forbidden('Access denied to this project');
    }

    const providedImages = await this.prisma.image.findMany({
      where: { id: { in: imageIds }, projectId },
      select: { id: true },
    });
    if (providedImages.length !== imageIds.length) {
      const provided = new Set(providedImages.map(i => i.id));
      const missing = imageIds.filter(id => !provided.has(id));
      const preview = missing.slice(0, 5).join(', ');
      const suffix =
        missing.length > 5 ? ` (+${missing.length - 5} more)` : '';
      throw ApiError.badRequest(
        `Image IDs do not belong to this project: ${preview}${suffix}`
      );
    }

    if (mode === 'all') {
      const total = await this.prisma.image.count({ where: { projectId } });
      if (total !== imageIds.length) {
        throw ApiError.badRequest(
          `Reorder mode 'all' requires every project image in the payload; ` +
            `got ${imageIds.length}, expected ${total}. Use mode 'partial' ` +
            `to reorder a subset.`
        );
      }
    }

    const updates = imageIds.map((id, index) =>
      this.prisma.image.update({
        where: { id },
        data: { displayOrder: index },
      })
    );

    if (mode === 'partial') {
      // Give omitted images a later displayOrder based on their createdAt so
      // tie-breaks stay deterministic. We do this inside the same
      // transaction so the sort is never in a torn state between queries.
      const omitted = await this.prisma.image.findMany({
        where: { projectId, id: { notIn: imageIds } },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
      });
      omitted.forEach((img, idx) => {
        updates.push(
          this.prisma.image.update({
            where: { id: img.id },
            data: { displayOrder: imageIds.length + idx },
          })
        );
      });
    }

    await this.prisma.$transaction(updates);
  }

  /**
   * Get single image by ID with permission check
   */
  async getImageById(
    imageId: string,
    userId: string
  ): Promise<ImageWithUrls | null> {
    // Get user email for share checking
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
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
                    {
                      email: user.email,
                      status: { in: ['pending', 'accepted'] },
                    },
                  ],
                },
              },
            },
          ],
        },
      },
      include: {
        project: true,
      },
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

    // Include segmentation thumbnail URL if available
    const segmentationThumbnailUrl = image.segmentationThumbnailPath
      ? await storage.getUrl(image.segmentationThumbnailPath)
      : undefined;

    return {
      ...image,
      originalUrl,
      thumbnailUrl,
      segmentationThumbnailUrl,
      displayUrl: this.getDisplayUrl(image.id),
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
                      status: 'accepted',
                    },
                  ],
                },
              },
            },
          ],
        },
      },
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

      // Video containers own a whole directory subtree
      // (projects/<pid>/images/<videoId>/frames/NNNN/<channel>.png) that
      // sits outside originalPath/thumbnailPath. Without explicit
      // cleanup, deleting a 200-frame multi-channel ND2 leaves several GB
      // orphaned on disk while DB cascade removes the rows. Recursive rm
      // is best-effort — failure logs but doesn't abort the delete.
      if (image.isVideoContainer) {
        try {
          const fs = await import('fs/promises');
          const path = await import('path');
          const { config } = await import('../utils/config');
          const containerDir = path.join(
            config.UPLOAD_DIR,
            'projects',
            image.projectId,
            'images',
            image.id
          );
          await fs.rm(containerDir, { recursive: true, force: true });
          logger.info('Removed video container directory', 'ImageService', {
            imageId,
            containerDir,
          });
        } catch (rmErr) {
          logger.error(
            `Failed to remove video container directory: ${(rmErr as Error).message}`,
            rmErr as Error,
            'ImageService',
            { imageId }
          );
        }
      }

      // Delete from database (cascades to child frame Image rows + Segmentation)
      await this.prisma.image.delete({
        where: { id: imageId },
      });

      logger.info('Image deleted successfully', 'ImageService', {
        imageId,
        filename: image.name,
        userId,
      });

      // Emit real-time project stats update for deleted image
      await this.emitProjectStatsUpdate(image.projectId, userId, 'updated');
    } catch (error) {
      logger.error(
        'Failed to delete image',
        error instanceof Error ? error : undefined,
        'ImageService',
        {
          imageId,
          userId,
        }
      );

      throw new Error(
        `Chyba při mazání obrázku: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Delete multiple images in batch with transaction
   */
  async deleteBatch(
    imageIds: string[],
    userId: string,
    projectId: string
  ): Promise<{
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
      count: imageIds.length,
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
                    status: 'accepted',
                  },
                ],
              },
            },
          },
        ],
      },
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
                      status: 'accepted',
                    },
                  ],
                },
              },
            },
          ],
        },
      },
    });

    if (imagesToDelete.length === 0) {
      throw new Error('No images found for deletion');
    }

    const storage = getStorageProvider();

    // Process deletions in transaction for database operations
    await this.prisma.$transaction(async tx => {
      for (const image of imagesToDelete) {
        try {
          // Delete from storage first
          await storage.delete(image.originalPath);

          if (image.thumbnailPath) {
            await storage.delete(image.thumbnailPath);
          }

          // Delete from database (CASCADE will handle segmentation data)
          await tx.image.delete({
            where: { id: image.id },
          });

          deletedCount++;

          logger.info('Image deleted in batch', 'ImageService', {
            imageId: image.id,
            filename: image.name,
            userId,
          });
        } catch (error) {
          failedIds.push(image.id);
          const errorMsg =
            error instanceof Error ? error.message : 'Unknown error';
          errors.push(`Image ${image.name}: ${errorMsg}`);

          logger.error(
            'Failed to delete image in batch',
            error instanceof Error ? error : undefined,
            'ImageService',
            {
              imageId: image.id,
              userId,
            }
          );
        }
      }

      // Cascade cleanup: when a deleted frame leaves its parent video
      // container with no remaining children, the container becomes an
      // orphan row. The gallery filter (`isVideoContainer: false` in
      // getProjectImagesWithThumbnails) hides containers from the user,
      // so without this pass the row + its storage (`original.<ext>`,
      // `thumbnail.jpg`) would linger forever — storage usage drift +
      // stale "Segment All" badges on the project header. Same
      // transaction so a partial cascade doesn't leak inconsistent state.
      const parentVideoIds = [
        ...new Set(
          imagesToDelete
            .map(i => i.parentVideoId)
            .filter((id): id is string => typeof id === 'string')
        ),
      ];

      for (const parentId of parentVideoIds) {
        try {
          const remaining = await tx.image.count({
            where: { parentVideoId: parentId },
          });
          if (remaining > 0) continue;

          const container = await tx.image.findUnique({
            where: { id: parentId },
            select: {
              id: true,
              name: true,
              originalPath: true,
              thumbnailPath: true,
              isVideoContainer: true,
            },
          });
          if (!container || !container.isVideoContainer) continue;

          await storage.delete(container.originalPath);
          if (container.thumbnailPath) {
            await storage.delete(container.thumbnailPath);
          }
          await tx.image.delete({ where: { id: container.id } });
          deletedCount++;

          logger.info('Orphan video container cleaned up', 'ImageService', {
            containerId: container.id,
            containerName: container.name,
            projectId,
            userId,
          });
        } catch (error) {
          const errorMsg =
            error instanceof Error ? error.message : 'Unknown error';
          errors.push(`Container ${parentId}: ${errorMsg}`);
          logger.error(
            'Failed to cleanup orphan video container',
            error instanceof Error ? error : undefined,
            'ImageService',
            { containerId: parentId, projectId, userId }
          );
        }
      }
    });

    // Check for images that weren't found
    const foundIds = imagesToDelete.map(img => img.id);
    const notFoundIds = imageIds.filter(id => !foundIds.includes(id));

    if (notFoundIds.length > 0) {
      failedIds.push(...notFoundIds);
      errors.push(
        ...notFoundIds.map(id => `Image ${id}: Not found or no permission`)
      );
    }

    logger.info('Batch delete operation completed', 'ImageService', {
      deletedCount,
      failedCount: failedIds.length,
      userId,
      projectId,
    });

    // Emit real-time project stats update for batch deleted images
    if (deletedCount > 0) {
      await this.emitProjectStatsUpdate(projectId, userId, 'updated');
    }

    return {
      deletedCount,
      failedIds,
      errors,
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
                    status: 'accepted',
                  },
                ],
              },
            },
          },
        ],
      },
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
        mimeType: true,
      },
    });

    const totalImages = images.length;
    // fileSize is BigInt — coerce per row before summing; 2^53 covers any
    // realistic file size, so number arithmetic is safe.
    const totalSize = images.reduce(
      (sum, img) => sum + Number(img.fileSize ?? 0n),
      0
    );

    // Count by status
    const byStatus = {
      no_segmentation: 0,
      queued: 0,
      processing: 0,
      segmented: 0,
      failed: 0,
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
      byMimeType,
    };
  }

  /**
   * Update image segmentation status
   */
  async updateSegmentationStatus(
    imageId: string,
    status:
      | 'no_segmentation'
      | 'queued'
      | 'processing'
      | 'segmented'
      | 'failed',
    userId?: string
  ): Promise<void> {
    let where: Prisma.ImageWhereInput = { id: imageId };

    // Add user permission check if userId is provided
    if (userId) {
      // Get user email for share checking
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { email: true },
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
                  OR: [{ sharedWithId: userId }, { email: user.email }],
                },
              },
            },
          ],
        },
      };
    }

    const image = await this.prisma.image.findFirst({ where });

    if (!image) {
      throw ApiError.forbidden('Access denied to this project');
    }

    await this.prisma.image.update({
      where: { id: imageId },
      data: { segmentationStatus: status },
    });

    logger.info('Image segmentation status updated', 'ImageService', {
      imageId,
      status,
      userId,
    });

    // Emit real-time project stats update when segmentation status changes
    // This is especially important for 'segmented' status changes that affect segmentedCount
    if (
      userId &&
      (status === 'segmented' ||
        status === 'failed' ||
        status === 'no_segmentation')
    ) {
      await this.emitProjectStatsUpdate(image.projectId, userId, 'updated');
    }
  }

  /**
   * Get browser-compatible image data by converting unsupported formats
   */
  async getBrowserCompatibleImage(
    imageId: string,
    userId?: string
  ): Promise<{
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

    // Video containers + extracted frames have no browser-renderable
    // origin (ND2 / TIFF stack binary or per-channel PNG buried under
    // frames/NNNN/<channel>.png). Resolve to the segmentation-source
    // channel of the appropriate frame so the editor canvas can render
    // it directly. For containers we serve frame 0; for frame rows we
    // serve that frame's own source channel.
    if (image.isVideoContainer || image.parentVideoId) {
      const frameBuffer = await this.getVideoFrameForDisplay(image);
      if (frameBuffer) {
        return frameBuffer;
      }
      // Fall through to the original-buffer path on miss — the safer
      // failure mode is letting nginx 404 surface than silently lying.
    }

    // Check if conversion is needed
    const browserSupportedTypes = [
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/gif',
      'image/webp',
      'image/bmp',
    ];

    // If already browser-compatible, return original
    if (image.mimeType && browserSupportedTypes.includes(image.mimeType)) {
      const originalBuffer = await this.getImageBuffer(image.originalPath);
      return {
        buffer: originalBuffer,
        mimeType: image.mimeType,
        filename: image.name,
      };
    }

    // Check for cached converted version
    // Sanitize imageId to prevent path traversal
    const safeImageId = path.basename(imageId);
    const convertedKey = `converted/${safeImageId}.png`;
    const convertedPath = path.join(
      process.env.UPLOAD_DIR || './uploads',
      convertedKey
    );
    // Verify resolved path stays within upload directory
    const resolvedPath = path.resolve(convertedPath);
    const resolvedBase = path.resolve(process.env.UPLOAD_DIR || './uploads');
    if (
      !resolvedPath.startsWith(resolvedBase + path.sep) &&
      resolvedPath !== resolvedBase
    ) {
      logger.warn('Path traversal attempt detected in image request', 'ImageService', {
        imageId,
        safeImageId,
        resolvedPath,
        resolvedBase,
      });
      throw new Error('Invalid image path: path traversal detected');
    }

    if (await pathExists(convertedPath)) {
      // Periodically clean up old converted files (don't await to avoid blocking)
      this.cleanupConvertedCache().catch(error =>
        logger.error('Background cleanup failed', error)
      );

      logger.info('Serving cached converted image', 'ImageService', {
        imageId,
        originalType: image.mimeType,
      });
      const cachedBuffer = await fs.readFile(convertedPath);
      return {
        buffer: cachedBuffer,
        mimeType: 'image/png',
        filename: image.name.replace(/\.[^.]+$/, '.png'),
      };
    }

    // Convert unsupported format to PNG
    logger.info('Converting image for browser compatibility', 'ImageService', {
      imageId,
      originalType: image.mimeType,
      targetType: 'image/png',
    });

    try {
      const originalBuffer = await this.getImageBuffer(image.originalPath);

      // Convert using Sharp
      const convertedBuffer = await sharp(originalBuffer)
        .png({
          quality: 90,
          compressionLevel: 6,
        })
        .toBuffer();

      // Cache the converted image — mkdir with recursive:true is idempotent
      await fs.mkdir(path.dirname(convertedPath), { recursive: true });
      await fs.writeFile(convertedPath, convertedBuffer);

      logger.info('Image converted and cached successfully', 'ImageService', {
        imageId,
        originalSize: originalBuffer.length,
        convertedSize: convertedBuffer.length,
        originalType: image.mimeType,
      });

      return {
        buffer: convertedBuffer,
        mimeType: 'image/png',
        filename: image.name.replace(/\.[^.]+$/, '.png'),
      };
    } catch (error) {
      logger.error(
        'Failed to convert image',
        error instanceof Error ? error : undefined,
        'ImageService',
        {
          imageId,
          originalType: image.mimeType,
        }
      );
      throw new Error(
        `Error converting image: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Generate display URL for browser-compatible image viewing
   */
  private getDisplayUrl(imageId: string): string {
    const baseUrl = getBaseUrl();

    if (!baseUrl) {
      const missingVars = ['API_BASE_URL', 'BACKEND_URL', 'PUBLIC_URL'].filter(
        varName => !process.env[varName]
      );

      logger.error(
        `Base URL configuration missing. Environment: ${config.NODE_ENV}. Missing variables: ${missingVars.join(', ')}`,
        undefined,
        'ImageService'
      );

      // Try fallback from DEFAULT_BASE_URL if configured
      if (process.env.DEFAULT_BASE_URL) {
        logger.warn(
          `Using fallback DEFAULT_BASE_URL: ${process.env.DEFAULT_BASE_URL}`,
          undefined,
          'ImageService'
        );
        const fallbackBase = process.env.DEFAULT_BASE_URL.replace(/\/+$/, '');
        return `${fallbackBase}/api/images/${imageId}/display`;
      }

      throw new Error(
        `Base URL configuration required. Missing: ${missingVars.join(', ')}. Set one of: API_BASE_URL, BACKEND_URL, PUBLIC_URL, or DEFAULT_BASE_URL`
      );
    }

    // Remove trailing slash for consistency
    const normalizedBase = baseUrl.replace(/\/+$/, '');

    return `${normalizedBase}/api/images/${imageId}/display`;
  }

  /**
   * Helper method to get image buffer from storage
   */
  /**
   * Resolve a video-container or video-frame Image row to its actual
   * displayable PNG buffer (the segmentation-source channel of frame 0
   * for containers, the row's own source channel for frame children).
   * Returns null if the channel can't be determined or the file is
   * missing — caller decides how to handle that.
   */
  private async getVideoFrameForDisplay(
    image: Prisma.ImageGetPayload<Record<string, never>>
  ): Promise<{ buffer: Buffer; mimeType: string; filename: string } | null> {
    // We need: projectId, parentVideoId (or own id when container),
    // frameIndex (0 for container default), and the segmentation-source
    // channel name from the container row's channels JSON.
    const containerId = image.isVideoContainer
      ? image.id
      : image.parentVideoId;
    if (!containerId) return null;

    const frameIndex = image.isVideoContainer ? 0 : (image.frameIndex ?? 0);

    // Channels live on the container row, not on the frames.
    const container = image.isVideoContainer
      ? image
      : await this.prisma.image.findUnique({ where: { id: containerId } });
    if (!container) return null;

    const channels = Array.isArray(container.channels)
      ? (container.channels as unknown as Array<{
          name: string;
          isSegmentationSource?: boolean;
        }>)
      : [];
    const sourceChannel =
      channels.find(c => c.isSegmentationSource)?.name ??
      channels[0]?.name ??
      null;
    if (!sourceChannel) return null;

    // Defence in depth: alnum/underscore/dot/dash only — same regex the
    // /frame-data controller uses to keep this path 1:1 with that one.
    if (!/^[A-Za-z0-9._-]+$/.test(sourceChannel)) return null;

    const framePath = path.join(
      'projects',
      container.projectId,
      'images',
      containerId,
      'frames',
      String(frameIndex).padStart(4, '0'),
      `${sourceChannel}.png`
    );

    try {
      const buffer = await this.getImageBuffer(framePath);
      return {
        buffer,
        mimeType: 'image/png',
        filename: `${image.name}_frame${String(frameIndex).padStart(4, '0')}.png`,
      };
    } catch {
      return null;
    }
  }

  private async getImageBuffer(imagePath: string): Promise<Buffer> {
    const storage = getStorageProvider();

    if (storage instanceof LocalStorageProvider) {
      // For local storage, read file directly
      const fullPath = path.join(
        process.env.UPLOAD_DIR || './uploads',
        imagePath
      );
      try {
        return await fs.readFile(fullPath);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          throw new Error('Image file not found');
        }
        throw err;
      }
    } else {
      // For other storage providers, implement buffer retrieval
      throw new Error(
        'Buffer retrieval not implemented for this storage provider'
      );
    }
  }

  /**
   * Clean up old converted PNG files from cache
   */
  private async cleanupConvertedCache(retentionDays = 7): Promise<void> {
    try {
      const convertedDir = path.join(
        process.env.UPLOAD_DIR || './uploads',
        'converted'
      );

      let files: string[];
      try {
        files = await fs.readdir(convertedDir);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          return;
        }
        throw err;
      }
      const cutoffTime = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

      for (const file of files) {
        const filePath = path.join(convertedDir, file);

        try {
          const stats = await fs.stat(filePath);
          if (stats.mtimeMs < cutoffTime) {
            await fs.unlink(filePath);
            logger.info('Removed old converted file', 'ImageService', {
              file,
              ageInDays: Math.floor(
                (Date.now() - stats.mtimeMs) / (24 * 60 * 60 * 1000)
              ),
            });
          }
        } catch (error) {
          logger.error(
            'Failed to process converted file during cleanup',
            error instanceof Error ? error : new Error(String(error))
          );
        }
      }
    } catch (error) {
      logger.error(
        'Failed to cleanup converted cache',
        error instanceof Error ? error : new Error(String(error))
      );
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

      try {
        await fs.unlink(convertedPath);
        logger.info(
          'Removed converted file for deleted image',
          'ImageService',
          { imageId }
        );
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw err;
        }
      }
    } catch (error) {
      logger.error(
        'Failed to remove converted file',
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }
}
