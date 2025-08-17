import { PrismaClient, SegmentationQueue } from '@prisma/client';
import { logger } from '../utils/logger';
import { SegmentationService } from './segmentationService';
import { ImageService } from './imageService';
import { WebSocketService } from './websocketService';

export interface QueueStats {
  queued: number;
  processing: number;
  total: number;
}

export interface BatchConfig {
  hrnet: number;
  resunet_small: number;
  resunet_advanced: number;
}

export interface QueueItem {
  id: string;
  imageId: string;
  projectId: string;
  userId: string;
  model: string;
  threshold: number;
  priority: number;
  status: string;
  createdAt: Date;
}

export class QueueService {
  private static instance: QueueService;
  private batchSizes: BatchConfig = {
    hrnet: 8,
    resunet_small: 4,
    resunet_advanced: 2
  };
  private websocketService: WebSocketService | null = null;

  constructor(
    private prisma: PrismaClient,
    private segmentationService: SegmentationService,
    private imageService: ImageService
  ) {
    // WebSocket service will be set after initialization
    this.websocketService = null;
  }
  
  public setWebSocketService(wsService: WebSocketService): void {
    this.websocketService = wsService;
    logger.info('WebSocket service connected to QueueService', 'QueueService');
  }

  public static getInstance(
    prisma: PrismaClient,
    segmentationService?: SegmentationService,
    imageService?: ImageService
  ): QueueService {
    if (!QueueService.instance) {
      if (!segmentationService || !imageService) {
        throw new Error('SegmentationService and ImageService are required for first initialization');
      }
      QueueService.instance = new QueueService(prisma, segmentationService, imageService);
    }
    return QueueService.instance;
  }

  /**
   * Add image to segmentation queue
   */
  async addToQueue(
    imageId: string,
    projectId: string,
    userId: string,
    model = 'hrnet',
    threshold = 0.5,
    priority = 0
  ): Promise<SegmentationQueue> {
    try {
      // Check if image is already in queue
      const existingEntry = await this.prisma.segmentationQueue.findFirst({
        where: {
          imageId,
          status: { in: ['queued', 'processing'] }
        }
      });

      if (existingEntry) {
        logger.warn('Image already in queue', 'QueueService', {
          imageId,
          existingQueueId: existingEntry.id,
          existingStatus: existingEntry.status
        });
        throw new Error('Image is already in segmentation queue');
      }

      // Create queue entry
      const queueEntry = await this.prisma.segmentationQueue.create({
        data: {
          imageId,
          projectId,
          userId,
          model,
          threshold,
          priority,
          status: 'queued'
        }
      });

      // Update image status
      await this.imageService.updateSegmentationStatus(imageId, 'queued', userId);

      logger.info('Image added to segmentation queue', 'QueueService', {
        imageId,
        projectId,
        model,
        queueId: queueEntry.id
      });

      // Processing will be handled by QueueWorker

      return queueEntry;
    } catch (error) {
      logger.error('Failed to add image to queue', error instanceof Error ? error : undefined, 'QueueService', {
        imageId,
        projectId,
        userId
      });
      throw error;
    }
  }

  /**
   * Add multiple images to queue in batch
   */
  async addBatchToQueue(
    imageIds: string[],
    projectId: string,
    userId: string,
    model = 'hrnet',
    threshold = 0.5,
    priority = 0
  ): Promise<SegmentationQueue[]> {
    try {
      const batchId = `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const queueEntries: SegmentationQueue[] = [];

      for (const imageId of imageIds) {
        try {
          // Check if image exists and user has access
          const image = await this.imageService.getImageById(imageId, userId);
          if (!image) {
            logger.warn('Image not found or no access', 'QueueService', { imageId, userId });
            continue;
          }

          // Skip if already in queue or segmented
          if (image.segmentationStatus === 'queued' || 
              image.segmentationStatus === 'processing' || 
              image.segmentationStatus === 'segmented') {
            logger.info('Skipping image - already processed or in queue', 'QueueService', {
              imageId,
              status: image.segmentationStatus
            });
            continue;
          }

          const queueEntry = await this.prisma.segmentationQueue.create({
            data: {
              imageId,
              projectId,
              userId,
              model,
              threshold,
              priority,
              status: 'queued',
              batchId
            }
          });

          // Update image status
          await this.imageService.updateSegmentationStatus(imageId, 'queued', userId);

          queueEntries.push(queueEntry);
        } catch (error) {
          logger.error('Failed to add single image to batch', error instanceof Error ? error : undefined, 'QueueService', {
            imageId,
            batchId
          });
        }
      }

      logger.info('Batch added to segmentation queue', 'QueueService', {
        batchId,
        totalImages: imageIds.length,
        queuedImages: queueEntries.length,
        model
      });

      // Processing will be handled by QueueWorker

      return queueEntries;
    } catch (error) {
      logger.error('Failed to add batch to queue', error instanceof Error ? error : undefined, 'QueueService', {
        projectId,
        userId,
        imageCount: imageIds.length
      });
      throw error;
    }
  }

  /**
   * Get queue statistics
   */
  async getQueueStats(projectId?: string, userId?: string): Promise<QueueStats> {
    try {
      const whereClause: any = {};
      
      if (projectId) {
        whereClause.projectId = projectId;
      }
      
      if (userId) {
        whereClause.userId = userId;
      }

      const [queued, processing, total] = await Promise.all([
        this.prisma.segmentationQueue.count({
          where: { ...whereClause, status: 'queued' }
        }),
        this.prisma.segmentationQueue.count({
          where: { ...whereClause, status: 'processing' }
        }),
        this.prisma.segmentationQueue.count({
          where: { ...whereClause, status: { in: ['queued', 'processing'] } }
        })
      ]);

      const stats = { queued, processing, total };
      
      // Emit queue stats via WebSocket if projectId is provided
      if (this.websocketService && projectId) {
        this.websocketService.emitQueueStatsUpdate(projectId, {
          projectId,
          queued,
          processing,
          total
        });
      }

      return stats;
    } catch (error) {
      logger.error('Failed to get queue stats', error instanceof Error ? error : undefined, 'QueueService', {
        projectId,
        userId
      });
      throw error;
    }
  }

  /**
   * Get queue items for a project
   */
  async getQueueItems(projectId: string, userId: string): Promise<QueueItem[]> {
    try {
      const items = await this.prisma.segmentationQueue.findMany({
        where: {
          projectId,
          userId,
          status: { in: ['queued', 'processing'] }
        },
        orderBy: [
          { priority: 'desc' },
          { createdAt: 'asc' }
        ]
      });

      return items.map(item => ({
        id: item.id,
        imageId: item.imageId,
        projectId: item.projectId,
        userId: item.userId,
        model: item.model,
        threshold: item.threshold,
        priority: item.priority,
        status: item.status,
        createdAt: item.createdAt
      }));
    } catch (error) {
      logger.error('Failed to get queue items', error instanceof Error ? error : undefined, 'QueueService', {
        projectId,
        userId
      });
      throw error;
    }
  }

  /**
   * Remove item from queue
   */
  async removeFromQueue(queueId: string, userId: string): Promise<void> {
    try {
      const queueItem = await this.prisma.segmentationQueue.findFirst({
        where: {
          id: queueId,
          userId,
          status: { in: ['queued'] } // Only allow removal of queued items
        }
      });

      if (!queueItem) {
        throw new Error('Queue item not found or cannot be removed');
      }

      // Remove from queue
      await this.prisma.segmentationQueue.delete({
        where: { id: queueId }
      });

      // Update image status back to no_segmentation
      await this.imageService.updateSegmentationStatus(queueItem.imageId, 'no_segmentation', userId);

      logger.info('Item removed from queue', 'QueueService', {
        queueId,
        imageId: queueItem.imageId
      });
    } catch (error) {
      logger.error('Failed to remove item from queue', error instanceof Error ? error : undefined, 'QueueService', {
        queueId,
        userId
      });
      throw error;
    }
  }


  /**
   * Get next batch of queue items for batch processing
   * Groups items by model and threshold for efficient processing
   */
  async getNextBatch(): Promise<SegmentationQueue[]> {
    // Model batch size limits (from ML service)
    const BATCH_LIMITS = {
      'hrnet': 8,
      'resunet_small': 2,  // Reduced for CBAM-ResUNet stability
      'resunet_advanced': 1  // Keep at 1 for MA-ResUNet due to high memory usage
    };

    // Get the highest priority item first
    const firstItem = await this.prisma.segmentationQueue.findFirst({
      where: { status: 'queued' },
      orderBy: [
        { priority: 'desc' },
        { createdAt: 'asc' }
      ]
    });

    if (!firstItem) {
      return [];
    }

    // Get batch size limit for this model
    const batchLimit = BATCH_LIMITS[firstItem.model as keyof typeof BATCH_LIMITS] || 1;

    // Find all items with same model, threshold, and priority for batching
    // If no exact matches, take just the first item (single item batch)
    let batch = await this.prisma.segmentationQueue.findMany({
      where: {
        status: 'queued',
        model: firstItem.model,
        threshold: firstItem.threshold,
        priority: firstItem.priority
      },
      orderBy: [
        { createdAt: 'asc' }
      ],
      take: batchLimit
    });

    // If no matching items found, create single item batch  
    if (batch.length === 0) {
      batch = [firstItem];
    }

    logger.info('Retrieved batch for processing', 'QueueService', {
      batchSize: batch.length,
      model: firstItem.model,
      threshold: firstItem.threshold,
      priority: firstItem.priority,
      maxBatchSize: batchLimit,
      itemIds: batch.map(item => item.id)
    });

    return batch;
  }


  /**
   * Process a batch of queue items using ML service batch endpoint
   */
  async processBatch(batch: SegmentationQueue[]): Promise<void> {
    if (batch.length === 0) {
      return;
    }

    const model = batch[0]!.model;
    const threshold = batch[0]!.threshold;
    
    logger.info('Starting batch processing', 'QueueService', {
      batchSize: batch.length,
      model,
      threshold,
      itemIds: batch.map(item => item.id)
    });

    // Mark all items as processing
    for (const item of batch) {
      await this.prisma.segmentationQueue.update({
        where: { id: item.id },
        data: { 
          status: 'processing',
          startedAt: new Date()
        }
      });

      // Update image status
      await this.imageService.updateSegmentationStatus(item.imageId, 'processing', item.userId);

      // Emit processing status
      if (this.websocketService) {
        this.websocketService.emitSegmentationUpdate(item.userId, {
          imageId: item.imageId,
          projectId: item.projectId,
          status: 'processing',
          queueId: item.id
        });
      }
    }

    try {
      // Prepare images for batch processing
      const imageData = [];
      for (const item of batch) {
        const image = await this.imageService.getImageById(item.imageId, item.userId);
        if (!image) {
          throw new Error(`Image not found: ${item.imageId}`);
        }
        imageData.push(image);
      }

      // Call appropriate segmentation service based on batch size
      let results: any[];
      if (batch.length === 1) {
        // Single item - use individual segmentation endpoint for better compatibility
        const singleResult = await this.segmentationService.requestSegmentation({
          imageId: batch[0]!.imageId,
          model: model as any,
          threshold: threshold,
          userId: batch[0]!.userId
        });
        results = [singleResult];
      } else {
        // Multiple items - use batch segmentation endpoint
        results = await this.segmentationService.requestBatchSegmentation(
          imageData,
          model,
          threshold
        );
      }

      // Process results for each item
      for (let i = 0; i < batch.length; i++) {
        const item = batch[i]!;
        const result = results[i];
        const image = imageData[i]!;

        if (result && result.polygons && result.polygons.length > 0) {
          // Success - save results and update image status
          // Prioritize image dimensions from ML service result, fallback to database
          const imageWidth = result.image_size?.width || image.width || null;
          const imageHeight = result.image_size?.height || image.height || null;
          
          await this.segmentationService.saveSegmentationResults(
            item.imageId,
            result.polygons,
            model,
            threshold,
            result.confidence || null,
            result.processingTime || null,
            imageWidth,
            imageHeight,
            item.userId
          );

          // Update image status to segmented
          await this.imageService.updateSegmentationStatus(item.imageId, 'segmented', item.userId);

          // Delete completed item from queue to prevent confusion
          await this.prisma.segmentationQueue.delete({
            where: { id: item.id }
          });

          // Emit success notification via WebSocket
          if (this.websocketService) {
            this.websocketService.emitSegmentationUpdate(item.userId, {
              imageId: item.imageId,
              projectId: item.projectId,
              status: 'segmented',
              queueId: item.id
            });
            
            this.websocketService.emitSegmentationComplete(
              item.userId,
              item.imageId,
              item.projectId,
              result.polygons.length
            );
          }

          logger.info('Batch item processed successfully and removed from queue', 'QueueService', {
            queueId: item.id,
            imageId: item.imageId,
            polygonCount: result.polygons.length
          });
        } else {
          // No polygons found - save empty results but mark as no_segmentation, not segmented
          logger.warn('ML service returned no polygons - marking as no_segmentation', 'QueueService', {
            queueId: item.id,
            imageId: item.imageId,
            model,
            threshold,
            result
          });

          // Save empty segmentation results to database so frontend can read them
          // Prioritize image dimensions from ML service result, fallback to database
          const imageWidth = result?.image_size?.width || image.width || null;
          const imageHeight = result?.image_size?.height || image.height || null;
          
          await this.segmentationService.saveSegmentationResults(
            item.imageId,
            [], // Empty polygons array
            model,
            threshold,
            result?.confidence || null,
            result?.processingTime || null,
            imageWidth,
            imageHeight,
            item.userId
          );

          // Update image status to no_segmentation (not segmented) since no polygons were detected
          await this.imageService.updateSegmentationStatus(item.imageId, 'no_segmentation', item.userId);

          // Delete completed item from queue to prevent confusion
          await this.prisma.segmentationQueue.delete({
            where: { id: item.id }
          });

          if (this.websocketService) {
            this.websocketService.emitSegmentationUpdate(item.userId, {
              imageId: item.imageId,
              projectId: item.projectId,
              status: 'no_segmentation', // Changed from 'segmented' to 'no_segmentation'
              queueId: item.id
            });

            this.websocketService.emitSegmentationComplete(
              item.userId,
              item.imageId,
              item.projectId,
              0 // 0 polygons found
            );
          }

          logger.info('Batch item completed with no polygons - empty result saved as no_segmentation and removed from queue', 'QueueService', {
            queueId: item.id,
            imageId: item.imageId
          });
        }
      }

      logger.info('Batch processing completed successfully', 'QueueService', {
        batchSize: batch.length,
        model,
        threshold
      });

      // Emit updated queue stats for all affected projects
      const projectIds = [...new Set(batch.map(item => item.projectId))];
      for (const projectId of projectIds) {
        const stats = await this.getQueueStats(projectId, batch[0]!.userId);
        logger.debug('Emitted queue stats after batch completion', 'QueueService', {
          projectId,
          stats
        });
      }

    } catch (error) {
      logger.error('Batch processing failed', error instanceof Error ? error : undefined, 'QueueService', {
        batchSize: batch.length,
        model,
        threshold,
        itemIds: batch.map(item => item.id)
      });

      // Mark all items as failed and handle retries
      for (const item of batch) {
        if (item && item.retryCount < 3) {
          // Reset to queued for retry
          await this.prisma.segmentationQueue.update({
            where: { id: item.id },
            data: { 
              status: 'queued',
              error: null,
              startedAt: null,
              completedAt: null
            }
          });

          await this.imageService.updateSegmentationStatus(item.imageId, 'no_segmentation', item.userId);

          if (this.websocketService) {
            this.websocketService.emitSegmentationUpdate(item.userId, {
              imageId: item.imageId,
              projectId: item.projectId,
              status: 'queued',
              queueId: item.id
            });
          }
        } else {
          // Max retries exceeded - mark as permanently failed and remove from queue
          await this.imageService.updateSegmentationStatus(item.imageId, 'failed', item.userId);

          // Delete failed item from queue after max retries
          await this.prisma.segmentationQueue.delete({
            where: { id: item.id }
          });

          if (this.websocketService) {
            this.websocketService.emitSegmentationUpdate(item.userId, {
              imageId: item.imageId,
              projectId: item.projectId,
              status: 'failed',
              error: error instanceof Error ? error.message : 'Unknown error',
              queueId: item.id
            });
          }
        }
      }

      // Don't re-throw - we've handled all items appropriately
    }
  }

  /**
   * Get comprehensive health status of the queue system
   */
  async getQueueHealthStatus(): Promise<{
    healthy: boolean;
    queueStats: {
      queued: number;
      processing: number;
      completed: number;
      failed: number;
      stuck: number; // Processing items older than 10 minutes
    };
    oldestQueuedItem?: Date;
    mlServiceHealthy: boolean;
    issues: string[];
  }> {
    try {
      const now = new Date();
      const tenMinutesAgo = new Date(now.getTime() - 10 * 60 * 1000);
      
      // Get queue statistics
      const [queued, processing, completed, failed, stuck, oldestQueued] = await Promise.all([
        this.prisma.segmentationQueue.count({ where: { status: 'queued' } }),
        this.prisma.segmentationQueue.count({ where: { status: 'processing' } }),
        this.prisma.segmentationQueue.count({ where: { status: 'completed' } }),
        this.prisma.segmentationQueue.count({ where: { status: 'failed' } }),
        this.prisma.segmentationQueue.count({
          where: {
            status: 'processing',
            startedAt: { lt: tenMinutesAgo }
          }
        }),
        this.prisma.segmentationQueue.findFirst({
          where: { status: 'queued' },
          orderBy: { createdAt: 'asc' },
          select: { createdAt: true }
        })
      ]);

      // Check ML service health
      const mlServiceHealthy = await this.segmentationService.checkServiceHealth();

      // Identify issues
      const issues: string[] = [];
      
      if (stuck > 0) {
        issues.push(`${stuck} items stuck in processing for over 10 minutes`);
      }
      
      if (!mlServiceHealthy) {
        issues.push('ML service is not responding');
      }
      
      if (queued > 100) {
        issues.push(`High queue backlog: ${queued} items waiting`);
      }
      
      if (oldestQueued && (now.getTime() - oldestQueued.createdAt.getTime()) > 30 * 60 * 1000) {
        issues.push('Oldest queued item is over 30 minutes old');
      }

      const healthy = issues.length === 0;

      return {
        healthy,
        queueStats: {
          queued,
          processing,
          completed,
          failed,
          stuck
        },
        oldestQueuedItem: oldestQueued?.createdAt,
        mlServiceHealthy,
        issues
      };
    } catch (error) {
      logger.error('Failed to get queue health status', error instanceof Error ? error : undefined, 'QueueService');
      return {
        healthy: false,
        queueStats: { queued: 0, processing: 0, completed: 0, failed: 0, stuck: 0 },
        mlServiceHealthy: false,
        issues: ['Failed to check queue health']
      };
    }
  }

  /**
   * Reset stuck items (processing items older than specified minutes)
   */
  async resetStuckItems(maxProcessingMinutes = 10): Promise<number> {
    try {
      const cutoffTime = new Date();
      cutoffTime.setMinutes(cutoffTime.getMinutes() - maxProcessingMinutes);

      const result = await this.prisma.segmentationQueue.updateMany({
        where: {
          status: 'processing',
          startedAt: { lt: cutoffTime }
        },
        data: {
          status: 'queued',
          startedAt: null,
          error: 'Reset due to timeout'
        }
      });

      if (result.count > 0) {
        logger.warn('Reset stuck queue items', 'QueueService', {
          resetCount: result.count,
          maxProcessingMinutes
        });
      }

      return result.count;
    } catch (error) {
      logger.error('Failed to reset stuck items', error instanceof Error ? error : undefined, 'QueueService');
      throw error;
    }
  }

  /**
   * Cleanup completed and failed queue entries older than specified days
   */
  async cleanupOldEntries(daysOld = 7): Promise<number> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysOld);

      const result = await this.prisma.segmentationQueue.deleteMany({
        where: {
          status: { in: ['completed', 'failed'] },
          completedAt: { lt: cutoffDate }
        }
      });

      logger.info('Cleaned up old queue entries', 'QueueService', {
        deletedCount: result.count,
        daysOld
      });

      return result.count;
    } catch (error) {
      logger.error('Failed to cleanup old queue entries', error instanceof Error ? error : undefined, 'QueueService');
      throw error;
    }
  }
}