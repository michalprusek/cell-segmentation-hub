/**
 * Project Statistics Service
 *
 * Single Source of Truth (SSOT) for project statistics calculations.
 * Provides consistent project and dashboard metrics across the application.
 */

import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger';
import { WebSocketService } from './websocketService';
import { ProjectStats, DashboardMetrics, ProjectStatsUpdateData, DashboardMetricsUpdateData, SharedProjectUpdateData, WebSocketEvent } from '../types/websocket';

export class ProjectStatsService {
  constructor(
    private prisma: PrismaClient,
    private websocketService?: WebSocketService
  ) {}

  /**
   * Calculate comprehensive project statistics
   */
  async getProjectStats(projectId: string): Promise<ProjectStats> {
    try {
      const [
        imageCount,
        segmentedCount,
        pendingCount,
        failedCount,
        lastImage,
        lastSegmentation,
        totalFileSize
      ] = await Promise.all([
        // Total image count
        this.prisma.image.count({
          where: { projectId }
        }),

        // Segmented images count
        this.prisma.image.count({
          where: {
            projectId,
            segmentationStatus: 'segmented'
          }
        }),

        // Pending segmentation count
        this.prisma.image.count({
          where: {
            projectId,
            segmentationStatus: { in: ['queued', 'processing'] }
          }
        }),

        // Failed segmentation count
        this.prisma.image.count({
          where: {
            projectId,
            segmentationStatus: 'failed'
          }
        }),

        // Last image added
        this.prisma.image.findFirst({
          where: { projectId },
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true }
        }),

        // Last segmentation completed
        this.prisma.image.findFirst({
          where: {
            projectId,
            segmentationStatus: 'segmented'
          },
          orderBy: { updatedAt: 'desc' },
          select: { updatedAt: true }
        }),

        // Total file size
        this.prisma.image.aggregate({
          where: { projectId },
          _sum: { fileSize: true }
        })
      ]);

      const stats: ProjectStats = {
        imageCount,
        segmentedCount,
        pendingCount,
        failedCount,
        lastUpdated: new Date(),
        lastImageAdded: lastImage?.createdAt,
        lastSegmentationCompleted: lastSegmentation?.updatedAt,
        totalFileSize: totalFileSize._sum.fileSize || 0
      };

      return stats;
    } catch (error) {
      logger.error('Error calculating project stats:', error);
      throw error;
    }
  }

  /**
   * Calculate comprehensive dashboard metrics for a user
   */
  async getDashboardMetrics(userId: string): Promise<DashboardMetrics> {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      weekAgo.setHours(0, 0, 0, 0);

      const [
        totalProjects,
        totalImages,
        totalSegmented,
        imagesUploadedToday,
        segmentationsCompletedToday,
        projectsCreatedThisWeek,
        queueStats,
        storageStats
      ] = await Promise.all([
        // Total projects (owned + shared)
        this.prisma.project.count({
          where: {
            OR: [
              { userId }, // Owned projects
              {
                shares: {
                  some: {
                    sharedWithId: userId,
                    status: 'accepted'
                  }
                }
              } // Shared projects
            ]
          }
        }),

        // Total images across all accessible projects
        this.prisma.image.count({
          where: {
            project: {
              OR: [
                { userId },
                {
                  shares: {
                    some: {
                      sharedWithId: userId,
                      status: 'accepted'
                    }
                  }
                }
              ]
            }
          }
        }),

        // Total segmented images
        this.prisma.image.count({
          where: {
            segmentationStatus: 'segmented',
            project: {
              OR: [
                { userId },
                {
                  shares: {
                    some: {
                      sharedWithId: userId,
                      status: 'accepted'
                    }
                  }
                }
              ]
            }
          }
        }),

        // Images uploaded today
        this.prisma.image.count({
          where: {
            createdAt: { gte: today },
            project: {
              OR: [
                { userId },
                {
                  shares: {
                    some: {
                      sharedWithId: userId,
                      status: 'accepted'
                    }
                  }
                }
              ]
            }
          }
        }),

        // Segmentations completed today
        this.prisma.image.count({
          where: {
            segmentationStatus: 'segmented',
            updatedAt: { gte: today },
            project: {
              OR: [
                { userId },
                {
                  shares: {
                    some: {
                      sharedWithId: userId,
                      status: 'accepted'
                    }
                  }
                }
              ]
            }
          }
        }),

        // Projects created this week
        this.prisma.project.count({
          where: {
            userId,
            createdAt: { gte: weekAgo }
          }
        }),

        // Queue statistics
        this.prisma.segmentationQueue.aggregate({
          _count: { id: true },
          where: {
            status: { in: ['queued', 'processing'] },
            userId
          }
        }),

        // Storage statistics
        this.prisma.image.aggregate({
          _sum: { fileSize: true },
          _avg: { fileSize: true },
          where: {
            project: {
              OR: [
                { userId },
                {
                  shares: {
                    some: {
                      sharedWithId: userId,
                      status: 'accepted'
                    }
                  }
                }
              ]
            }
          }
        })
      ]);

      // Get average processing time from recent segmentations
      const recentSegmentations = await this.prisma.segmentationQueue.findMany({
        where: {
          userId,
          status: 'completed',
          completedAt: { not: null },
          startedAt: { not: null }
        },
        orderBy: { completedAt: 'desc' },
        take: 100 // Last 100 segmentations
      });

      const avgProcessingTime = recentSegmentations.length > 0
        ? recentSegmentations.reduce((sum, item) => {
            if (item.startedAt && item.completedAt) {
              return sum + (item.completedAt.getTime() - item.startedAt.getTime());
            }
            return sum;
          }, 0) / recentSegmentations.length / 1000 // Convert to seconds
        : 0;

      const totalStorageMB = Math.round((storageStats._sum.fileSize || 0) / (1024 * 1024));
      const totalStorageGB = parseFloat((totalStorageMB / 1024).toFixed(2));
      const averageImageSizeMB = parseFloat(((storageStats._avg.fileSize || 0) / (1024 * 1024)).toFixed(2));

      const metrics: DashboardMetrics = {
        totalProjects,
        totalImages,
        totalSegmented,
        recentActivity: {
          imagesUploadedToday,
          segmentationsCompletedToday,
          projectsCreatedThisWeek
        },
        systemStats: {
          queueLength: queueStats._count.id || 0,
          processingImages: 0, // Will be updated with real-time data
          avgProcessingTime
        },
        storageStats: {
          totalStorageMB,
          totalStorageGB,
          averageImageSizeMB
        }
      };

      return metrics;
    } catch (error) {
      logger.error('Error calculating dashboard metrics:', error);
      throw error;
    }
  }

  /**
   * Get list of users who have access to a shared project
   */
  async getSharedProjectUsers(projectId: string): Promise<string[]> {
    try {
      const shares = await this.prisma.projectShare.findMany({
        where: {
          projectId,
          status: 'accepted'
        },
        select: { sharedWithId: true }
      });

      return shares.map(share => share.sharedWithId);
    } catch (error) {
      logger.error('Error getting shared project users:', error);
      return [];
    }
  }

  /**
   * Emit project statistics update to WebSocket clients
   */
  async emitProjectStatsUpdate(
    projectId: string,
    userId: string,
    operation: ProjectStatsUpdateData['operation'],
    affectedImageIds?: string[]
  ): Promise<void> {
    if (!this.websocketService) {
      logger.warn('WebSocketService not available for project stats update');
      return;
    }

    try {
      const stats = await this.getProjectStats(projectId);

      const updateData: ProjectStatsUpdateData = {
        projectId,
        userId,
        stats,
        operation,
        affectedImageIds,
        timestamp: new Date()
      };

      // Emit to project owner
      this.websocketService.emitToUser(userId, WebSocketEvent.PROJECT_STATS_UPDATE, updateData);

      // Emit to shared project users
      const sharedUsers = await this.getSharedProjectUsers(projectId);
      if (sharedUsers.length > 0) {
        const sharedUpdateData: SharedProjectUpdateData = {
          projectId,
          ownerId: userId,
          sharedWithUserIds: sharedUsers,
          updateType: operation === 'images_added' ? 'images_added' :
                     operation === 'images_deleted' ? 'images_deleted' :
                     operation === 'segmentation_completed' ? 'segmentation_completed' :
                     'project_updated',
          stats,
          timestamp: new Date()
        };

        sharedUsers.forEach(sharedUserId => {
          this.websocketService?.emitToUser(sharedUserId, WebSocketEvent.SHARED_PROJECT_UPDATE, sharedUpdateData);
        });
      }

      logger.info('Project stats update emitted', 'ProjectStatsService', {
        projectId,
        operation,
        userId,
        sharedUserCount: sharedUsers.length
      });
    } catch (error) {
      logger.error('Error emitting project stats update:', error);
    }
  }

  /**
   * Emit dashboard metrics update to WebSocket clients
   */
  async emitDashboardMetricsUpdate(userId: string, changedFields: string[]): Promise<void> {
    if (!this.websocketService) {
      logger.warn('WebSocketService not available for dashboard metrics update');
      return;
    }

    try {
      const metrics = await this.getDashboardMetrics(userId);

      const updateData: DashboardMetricsUpdateData = {
        userId,
        metrics,
        changedFields,
        timestamp: new Date()
      };

      this.websocketService.emitToUser(userId, WebSocketEvent.DASHBOARD_METRICS_UPDATE, updateData);

      logger.info('Dashboard metrics update emitted', 'ProjectStatsService', {
        userId,
        changedFields
      });
    } catch (error) {
      logger.error('Error emitting dashboard metrics update:', error);
    }
  }

  /**
   * Update statistics after image upload operation
   */
  async handleImageUpload(projectId: string, userId: string, uploadedImageIds: string[]): Promise<void> {
    try {
      // Emit project stats update
      await this.emitProjectStatsUpdate(projectId, userId, 'images_added', uploadedImageIds);

      // Emit dashboard metrics update
      await this.emitDashboardMetricsUpdate(userId, ['totalImages', 'recentActivity.imagesUploadedToday', 'storageStats']);

      logger.info('Image upload statistics updated', 'ProjectStatsService', {
        projectId,
        userId,
        imageCount: uploadedImageIds.length
      });
    } catch (error) {
      logger.error('Error handling image upload statistics:', error);
    }
  }

  /**
   * Update statistics after image deletion operation
   */
  async handleImageDeletion(projectId: string, userId: string, deletedImageIds: string[]): Promise<void> {
    try {
      // Emit project stats update
      await this.emitProjectStatsUpdate(projectId, userId, 'images_deleted', deletedImageIds);

      // Emit dashboard metrics update
      await this.emitDashboardMetricsUpdate(userId, ['totalImages', 'storageStats']);

      logger.info('Image deletion statistics updated', 'ProjectStatsService', {
        projectId,
        userId,
        imageCount: deletedImageIds.length
      });
    } catch (error) {
      logger.error('Error handling image deletion statistics:', error);
    }
  }

  /**
   * Update statistics after segmentation completion
   */
  async handleSegmentationCompletion(projectId: string, userId: string, imageId: string): Promise<void> {
    try {
      // Emit project stats update
      await this.emitProjectStatsUpdate(projectId, userId, 'segmentation_completed', [imageId]);

      // Emit dashboard metrics update
      await this.emitDashboardMetricsUpdate(userId, ['totalSegmented', 'recentActivity.segmentationsCompletedToday', 'systemStats']);

      // CRITICAL FIX: Invalidate HTTP caches for project statistics
      // This ensures project cards show updated stats immediately after segmentation
      const { cacheService } = await import('./cacheService');
      await cacheService.invalidationStrategies.projectStats(projectId, userId);

      logger.info('Segmentation completion statistics updated and caches invalidated', 'ProjectStatsService', {
        projectId,
        userId,
        imageId
      });
    } catch (error) {
      logger.error('Error handling segmentation completion statistics:', error);
    }
  }

  /**
   * Update statistics after batch operation
   */
  async handleBatchOperation(
    projectId: string,
    userId: string,
    operation: 'batch_uploaded' | 'batch_deleted',
    affectedImageIds: string[]
  ): Promise<void> {
    try {
      // Emit project stats update
      await this.emitProjectStatsUpdate(projectId, userId, operation, affectedImageIds);

      // Determine which dashboard fields changed based on operation
      const changedFields = operation === 'batch_uploaded'
        ? ['totalImages', 'recentActivity.imagesUploadedToday', 'storageStats']
        : ['totalImages', 'storageStats'];

      // Emit dashboard metrics update
      await this.emitDashboardMetricsUpdate(userId, changedFields);

      logger.info('Batch operation statistics updated', 'ProjectStatsService', {
        projectId,
        userId,
        operation,
        imageCount: affectedImageIds.length
      });
    } catch (error) {
      logger.error('Error handling batch operation statistics:', error);
    }
  }
}