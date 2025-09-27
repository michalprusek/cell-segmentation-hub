import { PrismaClient, SegmentationQueue, Prisma } from '@prisma/client';
import { logger } from '../utils/logger';
import {
  SegmentationService,
  SegmentationResponse,
} from './segmentationService';
import { ImageService } from './imageService';
import { WebSocketService } from './websocketService';
import { batchProcessor } from '../utils/batchProcessor';
import { SegmentationUpdateData } from '../types/websocket';
import { QueueStatus } from '../types/queue';

export interface QueueStats {
  queued: number;
  processing: number;
  total: number;
}

export interface ParallelProcessingStats {
  activeStreams: number;
  maxConcurrentStreams: number;
  totalProcessingCapacity: number;
  currentThroughput: number;
  averageProcessingTime: number;
}

export interface QueueBatch {
  id: string;
  items: SegmentationQueue[];
  model: string;
  threshold: number;
  priority: number;
  estimatedProcessingTime: number;
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
    hrnet: 6, // Reduced for concurrent processing
    cbam_resunet: 4,
  };
  private websocketService: WebSocketService | null = null;
  private queueWorkerInstance: unknown = null; // Reference to QueueWorker for triggering
  private maxConcurrentBatches = 4; // Support 4-way parallel processing
  private activeBatches: Map<string, Date> = new Map(); // Track active batch processing
  private processingStats: ParallelProcessingStats = {
    activeStreams: 0,
    maxConcurrentStreams: 4,
    totalProcessingCapacity: 0,
    currentThroughput: 0,
    averageProcessingTime: 0,
  };

  constructor(
    private prisma: PrismaClient,
    private segmentationService: SegmentationService,
    private imageService: ImageService
  ) {
    // WebSocket service will be set after initialization
    this.websocketService = null;
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
    return batchProcessor.processBatch(items, processor, {
      batchSize,
      concurrency: 3,
      onBatchComplete: (index, results) => {
        logger.debug(
          `${operationName} batch ${index + 1} completed, ${results.length} successful`
        );
      },
      onItemError: (item, error) => {
        logger.error(
          `${operationName} failed for item`,
          error instanceof Error ? error : new Error(String(error))
        );
      },
    });
  }

  public setWebSocketService(wsService: WebSocketService): void {
    this.websocketService = wsService;
    logger.info('WebSocket service connected to QueueService', 'QueueService');
  }

  public setQueueWorker(queueWorker: unknown): void {
    this.queueWorkerInstance = queueWorker;
    logger.info(
      'QueueWorker connected to QueueService for immediate processing',
      'QueueService'
    );
  }

  private triggerQueueProcessing(): void {
    if (
      this.queueWorkerInstance &&
      typeof (this.queueWorkerInstance as Record<string, unknown>)
        .triggerImmediateProcessing === 'function'
    ) {
      (
        this.queueWorkerInstance as Record<string, () => void>
      ).triggerImmediateProcessing();
    }
  }

  public static getInstance(
    prisma: PrismaClient,
    segmentationService?: SegmentationService,
    imageService?: ImageService
  ): QueueService {
    if (!QueueService.instance) {
      if (!segmentationService || !imageService) {
        throw new Error(
          'SegmentationService and ImageService are required for first initialization'
        );
      }
      QueueService.instance = new QueueService(
        prisma,
        segmentationService,
        imageService
      );
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
          status: { in: ['queued', 'processing'] },
        },
      });

      if (existingEntry) {
        logger.warn('Image already in queue', 'QueueService', {
          imageId,
          existingQueueId: existingEntry.id,
          existingStatus: existingEntry.status,
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
          status: 'queued',
        },
      });

      // Update image status
      await this.imageService.updateSegmentationStatus(
        imageId,
        'queued',
        userId
      );

      logger.info('Image added to segmentation queue', 'QueueService', {
        imageId,
        projectId,
        model,
        queueId: queueEntry.id,
      });

      // Trigger immediate processing for low latency
      this.triggerQueueProcessing();

      return queueEntry;
    } catch (error) {
      logger.error(
        'Failed to add image to queue',
        error instanceof Error ? error : undefined,
        'QueueService',
        {
          imageId,
          projectId,
          userId,
        }
      );
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
            logger.warn('Image not found or no access', 'QueueService', {
              imageId,
              userId,
            });
            continue;
          }

          // Skip if already in queue or processing (unless forceResegment)
          if (
            !forceResegment &&
            (image.segmentationStatus === 'queued' ||
              image.segmentationStatus === 'processing')
          ) {
            logger.info(
              'Skipping image - already in queue or processing',
              'QueueService',
              {
                imageId,
                status: image.segmentationStatus,
              }
            );
            continue;
          }

          // Use transaction for atomic operations
          const queueEntry = await this.prisma.$transaction(async tx => {
            // If forceResegment, delete existing segmentation results
            if (
              forceResegment &&
              (image.segmentationStatus === 'completed' ||
                image.segmentationStatus === 'segmented')
            ) {
              logger.info(
                'Force resegment - removing existing segmentation',
                'QueueService',
                {
                  imageId,
                  oldStatus: image.segmentationStatus,
                }
              );

              // Delete existing segmentation results
              await tx.segmentation.deleteMany({
                where: { imageId },
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
                batchId,
              },
            });
          });

          // Update image status
          await this.imageService.updateSegmentationStatus(
            imageId,
            'queued',
            userId
          );

          queueEntries.push(queueEntry);
        } catch (error) {
          logger.error(
            'Failed to add single image to batch',
            error instanceof Error ? error : undefined,
            'QueueService',
            {
              imageId,
              batchId,
            }
          );
        }
      }

      logger.info('Batch added to segmentation queue', 'QueueService', {
        batchId,
        totalImages: imageIds.length,
        queuedImages: queueEntries.length,
        model,
      });

      // Trigger immediate processing for low latency
      if (queueEntries.length > 0) {
        this.triggerQueueProcessing();
      }

      return queueEntries;
    } catch (error) {
      logger.error(
        'Failed to add batch to queue',
        error instanceof Error ? error : undefined,
        'QueueService',
        {
          projectId,
          userId,
          imageCount: imageIds.length,
        }
      );
      throw error;
    }
  }

  /**
   * Get queue statistics
   */
  async getQueueStats(
    projectId?: string,
    userId?: string
  ): Promise<QueueStats> {
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
          where: { ...whereClause, status: 'queued' },
        }),
        this.prisma.segmentationQueue.count({
          where: { ...whereClause, status: 'processing' },
        }),
        this.prisma.segmentationQueue.count({
          where: { ...whereClause, status: { in: ['queued', 'processing'] } },
        }),
      ]);

      const stats = { queued, processing, total };

      // Emit queue stats via WebSocket if projectId is provided
      if (this.websocketService && projectId) {
        this.websocketService.emitQueueStatsUpdate(projectId, {
          projectId,
          queued,
          processing,
          total,
        });
      }

      return stats;
    } catch (error) {
      logger.error(
        'Failed to get queue stats',
        error instanceof Error ? error : undefined,
        'QueueService',
        {
          projectId,
          userId,
        }
      );
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
          status: { in: ['queued', 'processing'] },
        },
        orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
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
        createdAt: item.createdAt,
      }));
    } catch (error) {
      logger.error(
        'Failed to get queue items',
        error instanceof Error ? error : undefined,
        'QueueService',
        {
          projectId,
          userId,
        }
      );
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
          status: { in: ['queued'] }, // Only allow removal of queued items
        },
      });

      if (!queueItem) {
        throw new Error('Queue item not found or cannot be removed');
      }

      // Remove from queue
      await this.prisma.segmentationQueue.delete({
        where: { id: queueId },
      });

      // Update image status back to no_segmentation
      await this.imageService.updateSegmentationStatus(
        queueItem.imageId,
        'no_segmentation',
        userId
      );

      logger.info('Item removed from queue', 'QueueService', {
        queueId,
        imageId: queueItem.imageId,
      });
    } catch (error) {
      logger.error(
        'Failed to remove item from queue',
        error instanceof Error ? error : undefined,
        'QueueService',
        {
          queueId,
          userId,
        }
      );
      throw error;
    }
  }

  /**
   * Get multiple batches for parallel processing
   * Returns up to maxBatches for concurrent execution
   */
  async getMultipleBatches(maxBatches = 4): Promise<QueueBatch[]> {
    const batches: QueueBatch[] = [];
    const processedImageIds = new Set<string>();

    for (let i = 0; i < maxBatches; i++) {
      const batchItems = await this.getNextBatchExcluding(processedImageIds);
      if (batchItems.length === 0) {
        break; // No more items to process
      }

      const firstItem = batchItems[0];
      const batchId = `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      batches.push({
        id: batchId,
        items: batchItems,
        model: firstItem.model,
        threshold: firstItem.threshold,
        priority: firstItem.priority,
        estimatedProcessingTime: this.estimateProcessingTime(
          batchItems.length,
          firstItem.model
        ),
      });

      // Mark these images as being processed to avoid duplicates
      batchItems.forEach(item => processedImageIds.add(item.imageId));
    }

    logger.info(
      'Retrieved multiple batches for parallel processing',
      'QueueService',
      {
        batchCount: batches.length,
        totalItems: batches.reduce((sum, batch) => sum + batch.items.length, 0),
        models: [...new Set(batches.map(batch => batch.model))],
      }
    );

    return batches;
  }

  /**
   * Get next batch excluding specific image IDs (to avoid duplicate processing)
   */
  private async getNextBatchExcluding(
    excludeImageIds: Set<string>
  ): Promise<SegmentationQueue[]> {
    // Model batch size limits (reduced for concurrent processing)
    const BATCH_LIMITS = {
      hrnet: 6, // Reduced from 8 for parallel processing
      cbam_resunet: 4, // Batch size of 4 for CBAM-ResUNet
    };

    // Get the highest priority item first, excluding specified image IDs
    const whereClause: Record<string, unknown> = {
      status: 'queued',
    };

    if (excludeImageIds.size > 0) {
      whereClause.imageId = {
        notIn: Array.from(excludeImageIds),
      };
    }

    const firstItem = await this.prisma.segmentationQueue.findFirst({
      where: whereClause,
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
    });

    if (!firstItem) {
      return [];
    }

    // Get batch size limit for this model
    const batchLimit =
      BATCH_LIMITS[firstItem.model as keyof typeof BATCH_LIMITS] || 1;

    // Find all items with same model, threshold, and priority for batching
    let batch = await this.prisma.segmentationQueue.findMany({
      where: {
        status: 'queued',
        model: firstItem.model,
        threshold: firstItem.threshold,
        priority: firstItem.priority,
        imageId:
          excludeImageIds.size > 0
            ? {
                notIn: Array.from(excludeImageIds),
              }
            : undefined,
      },
      orderBy: [{ createdAt: 'asc' }],
      take: batchLimit,
    });

    // If no exact matches found but we have the first item, process it alone
    if (batch.length === 0) {
      batch = [firstItem];
    }

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
      itemIds: batch.map(item => item.id),
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
        startedAt: startedAt,
      },
    });

    // Batch update image statuses
    await this.prisma.image.updateMany({
      where: { id: { in: imageIds } },
      data: { segmentationStatus: 'processing' },
    });

    // Batch emit WebSocket notifications
    if (this.websocketService) {
      const notifications = batch.map(item => ({
        userId: item.userId,
        data: {
          imageId: item.imageId,
          projectId: item.projectId,
          status: 'processing' as QueueStatus,
          queueId: item.id,
        },
      }));

      // Group notifications by userId for efficient emission
      const groupedNotifications = notifications.reduce(
        (acc, notif) => {
          if (!acc[notif.userId]) {
            acc[notif.userId] = [];
          }
          acc[notif.userId].push(notif.data);
          return acc;
        },
        {} as Record<string, SegmentationUpdateData[]>
      );

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
        where: { status: 'queued' },
      });
      const isLastBatch = remainingQueuedCount === batch.length;

      if (isLastBatch) {
        logger.info(
          '🏁 Processing LAST BATCH - will coordinate thumbnail generation',
          'QueueService',
          {
            batchSize: batch.length,
            remainingQueuedCount,
            model,
            message:
              'Thumbnails will be generated synchronously to prevent race condition',
          }
        );
      } else {
        logger.info('Batch processing details', 'QueueService', {
          batchSize: batch.length,
          remainingQueuedCount,
          isLastBatch,
          model,
        });
      }

      // Prepare images for batch processing
      const imageData = [];
      for (const item of batch) {
        const image = await this.imageService.getImageById(
          item.imageId,
          item.userId
        );
        if (!image) {
          throw new Error(`Image not found: ${item.imageId}`);
        }
        imageData.push(image);
      }

      // Call appropriate segmentation service based on batch size
      let results: SegmentationResponse[];
      if (batch.length === 1) {
        // Single item - use individual segmentation endpoint for better compatibility
        const singleResult = await this.segmentationService.requestSegmentation(
          {
            imageId: firstItem.imageId,
            model: model as 'hrnet' | 'resunet_advanced' | 'resunet_small',
            threshold: threshold,
            userId: firstItem.userId,
            detectHoles: firstItem.detectHoles ?? false,
          }
        );
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
          await this.imageService.updateSegmentationStatus(
            item.imageId,
            'segmented',
            item.userId
          );

          // Delete completed item from queue to prevent confusion
          await this.prisma.segmentationQueue.delete({
            where: { id: item.id },
          });

          // Emit success notification via WebSocket
          if (this.websocketService) {
            this.websocketService.emitSegmentationUpdate(item.userId, {
              imageId: item.imageId,
              projectId: item.projectId,
              status: 'segmented', // Changed from 'completed' to match database status
              queueId: item.id,
            });

            this.websocketService.emitSegmentationComplete(
              item.userId,
              item.imageId,
              item.projectId,
              result.polygons.length
            );
          }

          logger.info(
            'Batch item processed successfully and removed from queue',
            'QueueService',
            {
              queueId: item.id,
              imageId: item.imageId,
              polygonCount: result.polygons.length,
            }
          );
        } else {
          // No polygons found - save empty results but mark as no_segmentation, not segmented
          logger.warn(
            'ML service returned no polygons - marking as no_segmentation',
            'QueueService',
            {
              queueId: item.id,
              imageId: item.imageId,
              model,
              threshold,
              result,
            }
          );

          // Save empty segmentation results to database so frontend can read them
          // Prioritize image dimensions from ML service result, fallback to database
          const imageWidth = result?.image_size?.width || image.width || null;
          const imageHeight =
            result?.image_size?.height || image.height || null;

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
          await this.imageService.updateSegmentationStatus(
            item.imageId,
            'no_segmentation',
            item.userId
          );

          // Delete completed item from queue to prevent confusion
          await this.prisma.segmentationQueue.delete({
            where: { id: item.id },
          });

          if (this.websocketService) {
            this.websocketService.emitSegmentationUpdate(item.userId, {
              imageId: item.imageId,
              projectId: item.projectId,
              status: 'no_segmentation',
              queueId: item.id,
            });

            this.websocketService.emitSegmentationComplete(
              item.userId,
              item.imageId,
              item.projectId,
              0 // 0 polygons found
            );
          }

          logger.info(
            'Batch item completed with no polygons - empty result saved as no_segmentation and removed from queue',
            'QueueService',
            {
              queueId: item.id,
              imageId: item.imageId,
            }
          );
        }
      }

      logger.info('Batch processing completed successfully', 'QueueService', {
        batchSize: batch.length,
        model,
        threshold,
      });

      // Emit updated queue stats for all affected projects and users
      const projectUserPairs = batch.map(item => ({
        projectId: item.projectId,
        userId: item.userId,
      }));
      const uniquePairs = Array.from(
        new Map(
          projectUserPairs.map(pair => [
            `${pair.projectId}-${pair.userId}`,
            pair,
          ])
        ).values()
      );

      for (const { projectId, userId } of uniquePairs) {
        const stats = await this.getQueueStats(projectId, userId);
        logger.debug(
          'Emitted queue stats after batch completion',
          'QueueService',
          {
            projectId,
            userId,
            stats,
          }
        );
      }
    } catch (error) {
      logger.error(
        'Batch processing failed',
        error instanceof Error ? error : undefined,
        'QueueService',
        {
          batchSize: batch.length,
          model,
          threshold,
          itemIds: batch.map(item => item.id),
        }
      );

      // Mark all items as failed and handle retries
      for (const item of batch) {
        if (item && item.retryCount < 3) {
          // Increment retry count and reset to queued for retry
          await this.prisma.segmentationQueue.update({
            where: { id: item.id },
            data: {
              status: 'queued',
              retryCount: item.retryCount + 1, // INCREMENT RETRY COUNT
              error:
                error instanceof Error ? error.message : 'Processing failed',
              startedAt: null,
              completedAt: null,
            },
          });

          await this.imageService.updateSegmentationStatus(
            item.imageId,
            'no_segmentation',
            item.userId
          );

          if (this.websocketService) {
            this.websocketService.emitSegmentationUpdate(item.userId, {
              imageId: item.imageId,
              projectId: item.projectId,
              status: 'queued',
              queueId: item.id,
            });
          }
        } else {
          // Max retries exceeded - mark as permanently failed and remove from queue
          await this.imageService.updateSegmentationStatus(
            item.imageId,
            'failed',
            item.userId
          );

          // Delete failed item from queue after max retries
          await this.prisma.segmentationQueue.delete({
            where: { id: item.id },
          });

          if (this.websocketService) {
            this.websocketService.emitSegmentationUpdate(item.userId, {
              imageId: item.imageId,
              projectId: item.projectId,
              status: 'failed',
              error: error instanceof Error ? error.message : 'Unknown error',
              queueId: item.id,
            });
          }
        }
      }

      // Don't re-throw - we've handled all items appropriately
    }
  }

  /**
   * Process multiple batches concurrently using Promise.allSettled
   */
  async processMultipleBatches(batches: QueueBatch[]): Promise<void> {
    if (batches.length === 0) {
      return;
    }

    logger.info('Starting parallel batch processing', 'QueueService', {
      batchCount: batches.length,
      totalItems: batches.reduce((sum, batch) => sum + batch.items.length, 0),
      models: [...new Set(batches.map(batch => batch.model))],
    });

    // Update processing stats
    this.processingStats.activeStreams = batches.length;
    this.processingStats.totalProcessingCapacity = batches.reduce(
      (sum, batch) => sum + batch.items.length,
      0
    );

    // Track active batches
    const startTime = new Date();
    batches.forEach(batch => {
      this.activeBatches.set(batch.id, startTime);
    });

    // Process batches concurrently
    const batchPromises = batches.map(batch =>
      this.processSingleBatch(batch.items).catch(error => {
        logger.error(
          'Batch processing failed',
          error instanceof Error ? error : undefined,
          'QueueService',
          {
            batchId: batch.id,
            batchSize: batch.items.length,
            model: batch.model,
          }
        );
        return error; // Return error instead of throwing to continue with other batches
      })
    );

    // Wait for all batches to complete
    const results = await Promise.allSettled(batchPromises);

    // Clean up tracking
    batches.forEach(batch => {
      this.activeBatches.delete(batch.id);
    });

    // Update processing stats
    const endTime = new Date();
    const processingTime = endTime.getTime() - startTime.getTime();
    this.processingStats.activeStreams = 0;
    this.processingStats.averageProcessingTime = processingTime;
    this.processingStats.currentThroughput =
      this.processingStats.totalProcessingCapacity / (processingTime / 1000);

    // Log results
    const successCount = results.filter(
      result => result.status === 'fulfilled'
    ).length;
    const failureCount = results.filter(
      result => result.status === 'rejected'
    ).length;

    logger.info('Parallel batch processing completed', 'QueueService', {
      batchCount: batches.length,
      successCount,
      failureCount,
      totalProcessingTime: processingTime,
      throughput: this.processingStats.currentThroughput,
    });

    // Emit parallel processing status update
    if (this.websocketService) {
      this.emitParallelProcessingStatus();
    }
  }

  /**
   * Process a single batch (extracted from original processBatch method)
   */
  async processSingleBatch(batch: SegmentationQueue[]): Promise<void> {
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
      itemIds: batch.map(item => item.id),
    });

    // Call the main processBatch method which contains the full logic
    return this.processBatch(batch);
  }

  /**
   * Legacy method for backward compatibility - get single batch
   */
  async getNextBatch(): Promise<SegmentationQueue[]> {
    const batches = await this.getMultipleBatches(1);
    return batches.length > 0 ? batches[0].items : [];
  }

  /**
   * Estimate processing time based on batch size and model
   */
  private estimateProcessingTime(batchSize: number, model: string): number {
    // Processing time estimates in milliseconds (based on analysis)
    const modelTimes = {
      hrnet: 196, // ~196ms per image
      cbam_resunet: 396, // ~396ms per image
      unet_spherohq: 1000, // ~1000ms per image
    };

    const timePerImage = modelTimes[model as keyof typeof modelTimes] || 500;
    return batchSize * timePerImage;
  }

  /**
   * Get parallel processing statistics
   */
  async getParallelProcessingStats(): Promise<ParallelProcessingStats> {
    // Update active streams count
    this.processingStats.activeStreams = this.activeBatches.size;

    return {
      ...this.processingStats,
      // Add real-time metrics
      activeStreams: this.activeBatches.size,
      maxConcurrentStreams: this.maxConcurrentBatches,
    };
  }

  /**
   * Emit parallel processing status via WebSocket
   */
  private emitParallelProcessingStatus(): void {
    // Disabled - parallel processing notifications removed per user request
    // if (!this.websocketService) {
    //   return;
    // }
    // const stats = this.processingStats;
    // // Emit to all connected users (system-wide status)
    // this.websocketService.broadcastSystemMessage(
    //   `Parallel Processing: ${stats.activeStreams}/${stats.maxConcurrentStreams} streams active`,
    //   'info'
    // );
  }

  /**
   * Emit queue stats for all users/projects affected by a batch
   */
  private async emitQueueStatsForBatch(
    batch: SegmentationQueue[]
  ): Promise<void> {
    const projectUserPairs = batch.map(item => ({
      projectId: item.projectId,
      userId: item.userId,
    }));
    const uniquePairs = Array.from(
      new Map(
        projectUserPairs.map(pair => [`${pair.projectId}-${pair.userId}`, pair])
      ).values()
    );

    for (const { projectId, userId } of uniquePairs) {
      const stats = await this.getQueueStats(projectId, userId);
      logger.debug(
        'Emitted queue stats after batch completion',
        'QueueService',
        {
          projectId,
          userId,
          stats,
        }
      );
    }
  }

  /**
   * Get comprehensive health status of the queue system including parallel processing metrics
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
    parallelStats: ParallelProcessingStats;
    oldestQueuedItem?: Date;
    mlServiceHealthy: boolean;
    issues: string[];
  }> {
    try {
      const now = new Date();
      const tenMinutesAgo = new Date(now.getTime() - 10 * 60 * 1000);

      // Get queue statistics
      const [queued, processing, completed, failed, stuck, oldestQueued] =
        await Promise.all([
          this.prisma.segmentationQueue.count({ where: { status: 'queued' } }),
          this.prisma.segmentationQueue.count({
            where: { status: 'processing' },
          }),
          this.prisma.segmentationQueue.count({
            where: { status: 'completed' },
          }),
          this.prisma.segmentationQueue.count({ where: { status: 'failed' } }),
          this.prisma.segmentationQueue.count({
            where: {
              status: 'processing',
              startedAt: { lt: tenMinutesAgo },
            },
          }),
          this.prisma.segmentationQueue.findFirst({
            where: { status: 'queued' },
            orderBy: { createdAt: 'asc' },
            select: { createdAt: true },
          }),
        ]);

      // Check ML service health
      const mlServiceHealthy =
        await this.segmentationService.checkServiceHealth();

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

      if (
        oldestQueued &&
        now.getTime() - oldestQueued.createdAt.getTime() > 30 * 60 * 1000
      ) {
        issues.push('Oldest queued item is over 30 minutes old');
      }

      const healthy = issues.length === 0;

      // Get parallel processing stats
      const parallelStats = await this.getParallelProcessingStats();

      return {
        healthy,
        queueStats: {
          queued,
          processing,
          completed,
          failed,
          stuck,
        },
        parallelStats,
        oldestQueuedItem: oldestQueued?.createdAt,
        mlServiceHealthy,
        issues,
      };
    } catch (error) {
      logger.error(
        'Failed to get queue health status',
        error instanceof Error ? error : undefined,
        'QueueService'
      );
      return {
        healthy: false,
        queueStats: {
          queued: 0,
          processing: 0,
          completed: 0,
          failed: 0,
          stuck: 0,
        },
        parallelStats: {
          activeStreams: 0,
          maxConcurrentStreams: 4,
          totalProcessingCapacity: 0,
          currentThroughput: 0,
          averageProcessingTime: 0,
        },
        mlServiceHealthy: false,
        issues: ['Failed to check queue health'],
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
          startedAt: { lt: cutoffTime },
        },
      });

      let resetCount = 0;
      let failedCount = 0;

      for (const item of stuckItems) {
        if (item.retryCount >= 3) {
          // Max retries exceeded - mark as failed and remove
          await this.prisma.segmentationQueue.delete({
            where: { id: item.id },
          });

          await this.imageService.updateSegmentationStatus(
            item.imageId,
            'failed',
            item.userId
          );

          logger.warn(
            'Stuck item exceeded max retries - marked as failed',
            'QueueService',
            {
              queueId: item.id,
              imageId: item.imageId,
              retryCount: item.retryCount,
            }
          );

          failedCount++;
        } else {
          // Reset to queued with incremented retry count
          await this.prisma.segmentationQueue.update({
            where: { id: item.id },
            data: {
              status: 'queued',
              retryCount: item.retryCount + 1,
              startedAt: null,
              error: `Reset due to timeout (attempt ${item.retryCount + 1})`,
            },
          });

          await this.imageService.updateSegmentationStatus(
            item.imageId,
            'queued',
            item.userId
          );

          resetCount++;
        }
      }

      if (resetCount > 0 || failedCount > 0) {
        logger.warn('Handled stuck queue items', 'QueueService', {
          resetCount,
          failedCount,
          maxProcessingMinutes,
        });
      }

      return resetCount + failedCount;
    } catch (error) {
      logger.error(
        'Failed to reset stuck items',
        error instanceof Error ? error : undefined,
        'QueueService'
      );
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
          completedAt: { lt: cutoffDate },
        },
      });

      logger.info('Cleaned up old queue entries', 'QueueService', {
        deletedCount: result.count,
        daysOld,
      });

      return result.count;
    } catch (error) {
      logger.error(
        'Failed to cleanup old queue entries',
        error instanceof Error ? error : undefined,
        'QueueService'
      );
      throw error;
    }
  }

  /**
   * Cancel batch processing for a specific user and batch
   * @param batchId Batch ID to cancel
   * @param userId User ID requesting cancellation
   * @returns Number of cancelled queue items
   */
  /**
   * Cancel batch processing for a specific user and batch
   * @param batchId Batch ID to cancel
   * @param userId User ID requesting cancellation
   * @returns Number of cancelled queue items
   */
  /**
   * Cancel batch processing for a specific user and batch
   * @param batchId Batch ID to cancel
   * @param userId User ID requesting cancellation
   * @returns Number of cancelled queue items
   */
  async cancelBatch(batchId: string, userId: string): Promise<number> {
    try {
      logger.info('Cancelling batch', 'QueueService', { batchId, userId });

      // Find all queued items for this batch and user
      const queuedItems = await this.prisma.segmentationQueue.findMany({
        where: {
          batchId,
          userId,
          status: 'queued',
        },
        include: {
          image: true,
        },
      });

      if (queuedItems.length === 0) {
        logger.info(
          'No queued items found for batch cancellation',
          'QueueService',
          { batchId, userId }
        );
        return 0;
      }

      // Delete queued items
      const deleteResult = await this.prisma.segmentationQueue.deleteMany({
        where: {
          batchId,
          userId,
          status: 'queued',
        },
      });

      // Update affected images' segmentation status to 'no_segmentation'
      const imageIds = queuedItems.map(item => item.imageId);
      await this.prisma.image.updateMany({
        where: {
          id: { in: imageIds },
        },
        data: {
          segmentationStatus: 'no_segmentation',
        },
      });

      // Emit cancellation events via WebSocket
      if (this.websocketService) {
        for (const item of queuedItems) {
          this.websocketService.emitToUser(userId, 'segmentation:cancelled', {
            imageId: item.imageId,
            batchId,
            message: 'Batch processing cancelled by user',
          });
        }

        // Update queue stats for affected projects
        const projectIds = [
          ...new Set(queuedItems.map(item => item.image.projectId)),
        ];
        for (const projectId of projectIds) {
          const stats = await this.getQueueStats(projectId);
          this.websocketService.emitQueueStatsUpdate(projectId, stats);
        }
      }

      logger.info('Batch cancelled successfully', 'QueueService', {
        batchId,
        userId,
        cancelledCount: deleteResult.count,
        affectedImages: imageIds.length,
      });

      return deleteResult.count;
    } catch (error) {
      logger.error(
        'Failed to cancel batch',
        error instanceof Error ? error : undefined,
        'QueueService',
        {
          batchId,
          userId,
        }
      );
      throw error;
    }
  }

  /**
   * Cancel all segmentation tasks for a specific user across all projects
   * This will cancel all queued and processing segmentations
   */
  async cancelAllUserSegmentations(userId: string): Promise<{
    cancelledCount: number;
    affectedProjects: string[];
    affectedBatches: string[];
  }> {
    try {
      logger.info('Cancelling all user segmentations', 'QueueService', {
        userId,
      });

      // Find all queued and processing items for this user
      const queuedItems = await this.prisma.segmentationQueue.findMany({
        where: {
          userId,
          status: {
            in: ['queued', 'processing'],
          },
        },
        include: {
          image: true,
        },
      });

      if (queuedItems.length === 0) {
        logger.info('No active segmentations found for user', 'QueueService', {
          userId,
        });
        return {
          cancelledCount: 0,
          affectedProjects: [],
          affectedBatches: [],
        };
      }

      // Group by status to handle differently
      const _queuedOnly = queuedItems.filter(item => item.status === 'queued');
      const processingItems = queuedItems.filter(
        item => item.status === 'processing'
      );

      // Delete all queued items
      const deleteResult = await this.prisma.segmentationQueue.deleteMany({
        where: {
          userId,
          status: 'queued',
        },
      });

      // Mark processing items as cancelled (they'll be handled by the ML service)
      if (processingItems.length > 0) {
        await this.prisma.segmentationQueue.updateMany({
          where: {
            userId,
            status: 'processing',
          },
          data: {
            status: 'cancelled',
          },
        });
      }

      // Update affected images' segmentation status
      const imageIds = queuedItems.map(item => item.imageId);
      if (imageIds.length > 0) {
        await this.prisma.image.updateMany({
          where: {
            id: { in: imageIds },
          },
          data: {
            segmentationStatus: 'no_segmentation',
          },
        });
      }

      // Collect affected batches and projects
      const affectedBatches = [
        ...new Set(
          queuedItems
            .filter(item => item.batchId)
            .map(item => item.batchId)
            .filter(Boolean)
        ),
      ];
      const affectedProjects = [
        ...new Set(queuedItems.map(item => item.image.projectId)),
      ];

      // Emit cancellation events via WebSocket
      if (this.websocketService) {
        // Send bulk cancellation notification
        this.websocketService.emitToUser(
          userId,
          'segmentation:bulk-cancelled',
          {
            cancelledCount: queuedItems.length,
            affectedProjects,
            affectedBatches,
            message: 'All segmentations cancelled by user',
          }
        );

        // Send individual cancellation events for each image
        for (const item of queuedItems) {
          this.websocketService.emitToUser(userId, 'segmentation:cancelled', {
            imageId: item.imageId,
            batchId: item.batchId,
            message: 'Segmentation cancelled by user',
          });
        }

        // Update queue stats for all affected projects
        for (const projectId of affectedProjects) {
          const stats = await this.getQueueStats(projectId);
          this.websocketService.emitQueueStatsUpdate(projectId, stats);
        }
      }

      // Cancel processing in ML service if needed
      if (processingItems.length > 0) {
        try {
          // Call ML service to cancel active jobs
          logger.info(
            'Requesting ML service to cancel processing jobs',
            'QueueService',
            {
              userId,
              jobCount: processingItems.length,
            }
          );
          // TODO: Implement ML service cancellation API call if needed
        } catch (mlError) {
          logger.error(
            'Failed to cancel ML processing',
            mlError instanceof Error ? mlError : undefined,
            'QueueService'
          );
        }
      }

      logger.info(
        'All user segmentations cancelled successfully',
        'QueueService',
        {
          userId,
          cancelledCount: queuedItems.length,
          deletedCount: deleteResult.count,
          processingCancelled: processingItems.length,
          affectedProjects: affectedProjects.length,
          affectedBatches: affectedBatches.length,
        }
      );

      return {
        cancelledCount: queuedItems.length,
        affectedProjects,
        affectedBatches,
      };
    } catch (error) {
      logger.error(
        'Failed to cancel all user segmentations',
        error instanceof Error ? error : undefined,
        'QueueService',
        {
          userId,
        }
      );
      throw error;
    }
  }
}
