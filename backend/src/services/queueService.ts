import { PrismaClient, SegmentationQueue, Prisma } from '@prisma/client';
import { logger } from '../utils/logger';
import { SegmentationService, SegmentationResponse } from './segmentationService';
import { ImageService } from './imageService';
import { WebSocketService } from './websocketService';
import { ProjectStatsService } from './projectStatsService';
import { batchProcessor } from '../utils/batchProcessor';
import { SegmentationUpdateData, ParallelProcessingStatusData } from '../types/websocket';
import { QueueStatus } from '../types/queue';

export interface QueueStats {
  queued: number;
  processing: number;
  total: number;
}

export interface BatchConfig {
  hrnet: number;
  cbam_resunet: number;
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
    cbam_resunet: 4
  };
  private websocketService: WebSocketService | null = null;
  private projectStatsService: ProjectStatsService | null = null;
  private queueWorkerInstance: unknown = null; // Reference to QueueWorker for triggering

  constructor(
    private prisma: PrismaClient,
    private segmentationService: SegmentationService,
    private imageService: ImageService
  ) {
    // WebSocket service will be set after initialization
    this.websocketService = null;
    this.projectStatsService = null;
  }

  /**
   * Helper method to process simple operations using shared BatchProcessor
   */
  private async processBatchOperations<T, R>(
    items: T[],
    processor: (item: T) => Promise<R>,
    operationName: string,
    batchSize = 10
  ): Promise<R[]> {
    return batchProcessor.processBatch(
      items,
      processor,
      {
        batchSize,
        concurrency: 3,
        onBatchComplete: (index, results) => {
          logger.debug(`${operationName} batch ${index + 1} completed, ${results.length} successful`);
        },
        onItemError: (item, error) => {
          logger.error(`${operationName} failed for item`, error instanceof Error ? error : new Error(String(error)));
        }
      }
    );
  }
  
  public setWebSocketService(wsService: WebSocketService): void {
    this.websocketService = wsService;

    // Initialize ProjectStatsService with WebSocket service
    if (!this.projectStatsService) {
      this.projectStatsService = new ProjectStatsService(this.prisma, wsService);
    }

    logger.info('WebSocket service connected to QueueService', 'QueueService');
  }

  public setQueueWorker(queueWorker: unknown): void {
    this.queueWorkerInstance = queueWorker;
    logger.info('QueueWorker connected to QueueService for immediate processing', 'QueueService');
  }

  private triggerQueueProcessing(): void {
    if (this.queueWorkerInstance && typeof (this.queueWorkerInstance as Record<string, unknown>).triggerImmediateProcessing === 'function') {
      (this.queueWorkerInstance as Record<string, () => void>).triggerImmediateProcessing();
    }
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
    priority = 0,
    detectHoles = true
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
          detectHoles,
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

      // Trigger immediate processing for low latency
      this.triggerQueueProcessing();

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
    priority = 0,
    forceResegment = false,
    detectHoles = true
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

          // Skip if already in queue or processing (unless forceResegment)
          if (!forceResegment && (image.segmentationStatus === 'queued' || 
              image.segmentationStatus === 'processing')) {
            logger.info('Skipping image - already in queue or processing', 'QueueService', {
              imageId,
              status: image.segmentationStatus
            });
            continue;
          }

          // Use transaction for atomic operations
          const queueEntry = await this.prisma.$transaction(async (tx) => {
            // If forceResegment, delete existing segmentation results
            if (forceResegment && (image.segmentationStatus === 'completed' || 
                image.segmentationStatus === 'segmented')) {
              logger.info('Force resegment - removing existing segmentation', 'QueueService', {
                imageId,
                oldStatus: image.segmentationStatus
              });
              
              // Delete existing segmentation results
              await tx.segmentation.deleteMany({
                where: { imageId }
              });
            }

            // Create queue entry
            return await tx.segmentationQueue.create({
              data: {
                imageId,
                projectId,
                userId,
                model,
                threshold,
                detectHoles,
                priority,
                status: 'queued',
                batchId
              }
            });
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

      // Trigger immediate processing for low latency
      if (queueEntries.length > 0) {
        this.triggerQueueProcessing();

        // Emit parallel processing status update
        await this.getParallelProcessingStatus();
      }

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
      const whereClause: Prisma.SegmentationQueueWhereInput = {};
      
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
   * Get parallel processing status and emit WebSocket update
   */
  async getParallelProcessingStatus(): Promise<ParallelProcessingStatusData> {
    try {
      // Get current processing count to estimate active ML workers
      const processingCount = await this.prisma.segmentationQueue.count({
        where: { status: 'processing' }
      });

      // Calculate active ML workers (max 2 based on ThreadPoolExecutor)
      const activeMlWorkers = Math.min(processingCount, 2);

      // Calculate active concurrent operations (max 3 based on ConcurrencyManager)
      const activeConcurrentOps = Math.min(processingCount, 3);

      // Get current batch size (assume hrnet as default, but in real implementation this would be dynamic)
      const currentBatchSize = this.batchSizes.hrnet;

      const status: ParallelProcessingStatusData = {
        concurrentOperations: {
          active: activeConcurrentOps,
          max: 3
        },
        mlWorkers: {
          active: activeMlWorkers,
          max: 2
        },
        batchProcessing: {
          currentBatchSize,
          modelOptimalSizes: {
            hrnet: this.batchSizes.hrnet,
            cbam_resunet: this.batchSizes.cbam_resunet
          }
        },
        timestamp: new Date()
      };

      // Emit via WebSocket if available
      if (this.websocketService) {
        this.websocketService.emitParallelProcessingStatus(status);
      }

      return status;
    } catch (error) {
      logger.error('Failed to get parallel processing status', error instanceof Error ? error : undefined, 'QueueService');
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

      // Emit parallel processing status update
      await this.getParallelProcessingStatus();
    } catch (error) {
      logger.error('Failed to remove item from queue', error instanceof Error ? error : undefined, 'QueueService', {
        queueId,
        userId
      });
      throw error;
    }
  }

  /**
   * Remove from queue with pre-fetched item to avoid race conditions
   * This method accepts a queue item that was already validated by the controller
   */
  async removeFromQueueWithItem(queueId: string, userId: string, queueItem: any): Promise<void> {
    try {
      // Verify the item still exists and can be removed
      const currentItem = await this.prisma.segmentationQueue.findFirst({
        where: {
          id: queueId,
          userId,
          status: { in: ['queued'] } // Only allow removal of queued items
        }
      });

      if (!currentItem) {
        throw new Error('Queue item no longer exists or cannot be removed');
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

      // Emit parallel processing status update
      await this.getParallelProcessingStatus();
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
      'cbam_resunet': 4  // Batch size of 4 for CBAM-ResUNet
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

    // If no exact matches found but we have the first item, process it alone
    if (batch.length === 0) {
      batch = [firstItem];
    }
    
    // IMPORTANT: Allow partial batches for remaining items
    // If we have items but less than full batch, still process them
    // This prevents the last odd items from being stuck
    if (batch.length > 0 && batch.length < batchLimit) {
      // Check if there are more items waiting with same model but different threshold/priority
      const totalQueued = await this.prisma.segmentationQueue.count({
        where: {
          status: 'queued',
          model: firstItem.model
        }
      });
      
      // If this is all that's left for this model, process as partial batch
      if (totalQueued === batch.length) {
        logger.info('Processing partial batch - remaining items for model', 'QueueService', {
          batchSize: batch.length,
          batchLimit,
          model: firstItem.model,
          reason: 'Last remaining items'
        });
      }
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

    const firstItem = batch[0];
    if (!firstItem) {
      return; // Should never happen due to length check above
    }
    const model = firstItem.model;
    const threshold = firstItem.threshold;
    
    logger.info('Starting batch processing', 'QueueService', {
      batchSize: batch.length,
      model,
      threshold,
      itemIds: batch.map(item => item.id)
    });

    // Batch update all items to processing status
    const batchIds = batch.map(item => item.id);
    const imageIds = batch.map(item => item.imageId);
    const startedAt = new Date();
    
    // Use batch update for better performance
    await this.prisma.segmentationQueue.updateMany({
      where: { id: { in: batchIds } },
      data: { 
        status: 'processing',
        startedAt: startedAt
      }
    });

    // Batch update image statuses
    await this.prisma.image.updateMany({
      where: { id: { in: imageIds } },
      data: { segmentationStatus: 'processing' }
    });

    // Batch emit WebSocket notifications
    if (this.websocketService) {
      const notifications = batch.map(item => ({
        userId: item.userId,
        data: {
          imageId: item.imageId,
          projectId: item.projectId,
          status: 'processing' as QueueStatus,
          queueId: item.id
        }
      }));
      
      // Group notifications by userId for efficient emission
      const groupedNotifications = notifications.reduce((acc, notif) => {
        if (!acc[notif.userId]) {acc[notif.userId] = [];}
        acc[notif.userId].push(notif.data);
        return acc;
      }, {} as Record<string, SegmentationUpdateData[]>);
      
      for (const [userId, updates] of Object.entries(groupedNotifications)) {
        // Emit all updates for this user at once
        updates.forEach(update => {
          this.websocketService?.emitSegmentationUpdate(userId, update);
        });
      }
    }

    try {
      // Check if this batch will empty the queue (making it the last batch)
      const remainingQueuedCount = await this.prisma.segmentationQueue.count({
        where: { status: 'queued' }
      });
      const isLastBatch = remainingQueuedCount === batch.length;
      
      if (isLastBatch) {
        logger.info('🏁 Processing LAST BATCH - will coordinate thumbnail generation', 'QueueService', {
          batchSize: batch.length,
          remainingQueuedCount,
          model,
          message: 'Thumbnails will be generated synchronously to prevent race condition'
        });
      } else {
        logger.info('Batch processing details', 'QueueService', {
          batchSize: batch.length,
          remainingQueuedCount,
          isLastBatch,
          model
        });
      }

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
      let results: SegmentationResponse[];
      if (batch.length === 1) {
        // Single item - use individual segmentation endpoint for better compatibility
        const singleResult = await this.segmentationService.requestSegmentation({
          imageId: firstItem.imageId,
          model: model as 'hrnet' | 'resunet_advanced' | 'resunet_small',
          threshold: threshold,
          userId: firstItem.userId,
          detectHoles: firstItem.detectHoles ?? false
        });
        results = [singleResult];
      } else {
        // Multiple items - use batch segmentation endpoint
        results = await this.segmentationService.requestBatchSegmentation(
          imageData,
          model,
          threshold,
          firstItem.detectHoles ?? false
        );
      }

      // Process results for each item
      for (let i = 0; i < batch.length; i++) {
        const item = batch[i];
        const result = results[i];
        const image = imageData[i];
        
        if (!item || !image || !result) {
          continue;
        }

        if (result.polygons && result.polygons.length > 0) {
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
            result.processing_time || null,
            imageWidth,
            imageHeight,
            item.userId,
            isLastBatch
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
              status: 'segmented',  // Changed from 'completed' to match database status
              queueId: item.id
            });

            this.websocketService.emitSegmentationComplete(
              item.userId,
              item.imageId,
              item.projectId,
              result.polygons.length
            );
          }

          // Update project statistics after successful segmentation
          if (this.projectStatsService) {
            try {
              await this.projectStatsService.handleSegmentationCompletion(item.projectId, item.userId, item.imageId);
            } catch (error) {
              logger.error('Failed to update project stats after segmentation completion', error instanceof Error ? error : undefined, 'QueueService', {
                projectId: item.projectId,
                userId: item.userId,
                imageId: item.imageId
              });
            }
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
            result?.processing_time || null,
            imageWidth,
            imageHeight,
            item.userId,
            isLastBatch
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
              status: 'no_segmentation',
              queueId: item.id
            });

            this.websocketService.emitSegmentationComplete(
              item.userId,
              item.imageId,
              item.projectId,
              0 // 0 polygons found
            );
          }

          // Update project statistics after segmentation attempt (even if no polygons found)
          if (this.projectStatsService) {
            try {
              await this.projectStatsService.handleSegmentationCompletion(item.projectId, item.userId, item.imageId);
            } catch (error) {
              logger.error('Failed to update project stats after segmentation completion (no polygons)', error instanceof Error ? error : undefined, 'QueueService', {
                projectId: item.projectId,
                userId: item.userId,
                imageId: item.imageId
              });
            }
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

      // Emit updated queue stats for all affected projects and users
      const projectUserPairs = batch.map(item => ({ projectId: item.projectId, userId: item.userId }));
      const uniquePairs = Array.from(
        new Map(projectUserPairs.map(pair => [`${pair.projectId}-${pair.userId}`, pair])).values()
      );
      
      for (const { projectId, userId } of uniquePairs) {
        const stats = await this.getQueueStats(projectId, userId);
        logger.debug('Emitted queue stats after batch completion', 'QueueService', {
          projectId,
          userId,
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
          // Increment retry count and reset to queued for retry
          await this.prisma.segmentationQueue.update({
            where: { id: item.id },
            data: { 
              status: 'queued',
              retryCount: item.retryCount + 1,  // INCREMENT RETRY COUNT
              error: error instanceof Error ? error.message : 'Processing failed',
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
   * Also handles items stuck in processing-queued loop
   */
  async resetStuckItems(maxProcessingMinutes = 10): Promise<number> {
    try {
      const cutoffTime = new Date();
      cutoffTime.setMinutes(cutoffTime.getMinutes() - maxProcessingMinutes);

      // First, get all stuck items to handle retry logic properly
      const stuckItems = await this.prisma.segmentationQueue.findMany({
        where: {
          status: 'processing',
          startedAt: { lt: cutoffTime }
        }
      });

      let resetCount = 0;
      let failedCount = 0;

      for (const item of stuckItems) {
        if (item.retryCount >= 3) {
          // Max retries exceeded - mark as failed and remove
          await this.prisma.segmentationQueue.delete({
            where: { id: item.id }
          });
          
          await this.imageService.updateSegmentationStatus(item.imageId, 'failed', item.userId);
          
          logger.warn('Stuck item exceeded max retries - marked as failed', 'QueueService', {
            queueId: item.id,
            imageId: item.imageId,
            retryCount: item.retryCount
          });
          
          failedCount++;
        } else {
          // Reset to queued with incremented retry count
          await this.prisma.segmentationQueue.update({
            where: { id: item.id },
            data: {
              status: 'queued',
              retryCount: item.retryCount + 1,
              startedAt: null,
              error: `Reset due to timeout (attempt ${item.retryCount + 1})`
            }
          });
          
          await this.imageService.updateSegmentationStatus(item.imageId, 'queued', item.userId);
          
          resetCount++;
        }
      }

      if (resetCount > 0 || failedCount > 0) {
        logger.warn('Handled stuck queue items', 'QueueService', {
          resetCount,
          failedCount,
          maxProcessingMinutes
        });
      }

      return resetCount + failedCount;
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

  /**
   * Cancel all queue items for a user in a specific project
   */
  async cancelByProject(projectId: string, userId: string): Promise<number> {
    try {
      // Use transaction to ensure atomicity
      const result = await this.prisma.$transaction(async (tx) => {
        // Find items to cancel
        const itemsToCancel = await tx.segmentationQueue.findMany({
          where: {
            projectId,
            userId,
            status: { in: ['queued', 'processing'] }
          }
        });

        if (itemsToCancel.length === 0) {
          return 0;
        }

        // Update to cancelled status
        const updateResult = await tx.segmentationQueue.updateMany({
          where: {
            projectId,
            userId,
            status: { in: ['queued', 'processing'] }
          },
          data: {
            status: 'cancelled',
            completedAt: new Date(),
            error: 'Cancelled by user'
          }
        });

        // Update image segmentation status for cancelled items
        for (const item of itemsToCancel) {
          await this.imageService.updateSegmentationStatus(item.imageId, 'no_segmentation', userId);
        }

        return updateResult.count;
      });

      if (result > 0) {
        logger.info('Queue items cancelled by project', 'QueueService', {
          projectId,
          userId,
          count: result
        });

        // Emit queue stats update
        if (this.websocketService) {
          const stats = await this.getQueueStats(projectId, userId);
          this.websocketService.emitQueueStatsUpdate(projectId, {
            projectId,
            ...stats
          });
        }
      }

      return result;
    } catch (error) {
      logger.error('Failed to cancel project queue', error instanceof Error ? error : undefined, 'QueueService', {
        projectId,
        userId
      });
      throw error;
    }
  }

  /**
   * Cancel all queue items for a specific batch
   */
  async cancelBatch(batchId: string, userId: string): Promise<number> {
    try {
      // Use transaction to ensure atomicity
      const result = await this.prisma.$transaction(async (tx) => {
        // Find items to cancel
        const itemsToCancel = await tx.segmentationQueue.findMany({
          where: {
            batchId,
            userId,
            status: { in: ['queued', 'processing'] }
          }
        });

        if (itemsToCancel.length === 0) {
          return 0;
        }

        // Update to cancelled status
        const updateResult = await tx.segmentationQueue.updateMany({
          where: {
            batchId,
            userId,
            status: { in: ['queued', 'processing'] }
          },
          data: {
            status: 'cancelled',
            completedAt: new Date(),
            error: 'Cancelled by user'
          }
        });

        // Update image segmentation status for cancelled items
        for (const item of itemsToCancel) {
          await this.imageService.updateSegmentationStatus(item.imageId, 'no_segmentation', userId);
        }

        return updateResult.count;
      });

      if (result > 0) {
        logger.info('Batch cancelled', 'QueueService', {
          batchId,
          userId,
          count: result
        });

        // Emit queue stats update for the project if we can determine it
        if (this.websocketService && result > 0) {
          // Get project ID from one of the cancelled items
          const sampleItem = await this.prisma.segmentationQueue.findFirst({
            where: { batchId },
            select: { projectId: true }
          });

          if (sampleItem) {
            const stats = await this.getQueueStats(sampleItem.projectId, userId);
            this.websocketService.emitQueueStatsUpdate(sampleItem.projectId, {
              projectId: sampleItem.projectId,
              ...stats
            });
          }
        }
      }

      return result;
    } catch (error) {
      logger.error('Failed to cancel batch', error instanceof Error ? error : undefined, 'QueueService', {
        batchId,
        userId
      });
      throw error;
    }
  }
}