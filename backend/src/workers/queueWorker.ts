import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger';
import { QueueService } from '../services/queueService';
import { SegmentationService } from '../services/segmentationService';
import { ImageService } from '../services/imageService';

export class QueueWorker {
  private static instance: QueueWorker;
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning = false;
  private queueService: QueueService;
  private imageService: ImageService;
  private segmentationService: SegmentationService;
  
  constructor(
    private prisma: PrismaClient,
    private intervalMs = 5000 // Check every 5 seconds
  ) {
    // Initialize services
    this.imageService = new ImageService(prisma);
    this.segmentationService = new SegmentationService(prisma, this.imageService);
    this.queueService = QueueService.getInstance(prisma, this.segmentationService, this.imageService);
  }
  
  public static getInstance(prisma: PrismaClient): QueueWorker {
    if (!QueueWorker.instance) {
      QueueWorker.instance = new QueueWorker(prisma);
    }
    return QueueWorker.instance;
  }
  
  /**
   * Start the queue worker
   */
  public start(): void {
    if (this.isRunning) {
      logger.warn('Queue worker is already running', 'QueueWorker');
      return;
    }
    
    this.isRunning = true;
    logger.info('🚀 Queue worker started', 'QueueWorker', {
      intervalMs: this.intervalMs
    });
    
    // Reset any stuck items on startup
    this.resetStuckItemsOnStartup();
    
    // Process immediately on start
    this.processQueue();
    
    // Set up interval for periodic processing
    this.intervalId = setInterval(() => {
      this.processQueue();
    }, this.intervalMs);
    
    // Set up interval for periodic health checks and stuck item reset (every minute)
    setInterval(() => {
      this.performHealthCheck();
    }, 60000);
  }
  
  /**
   * Stop the queue worker
   */
  public stop(): void {
    if (!this.isRunning) {
      logger.warn('Queue worker is not running', 'QueueWorker');
      return;
    }
    
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    
    this.isRunning = false;
    logger.info('🛑 Queue worker stopped', 'QueueWorker');
  }
  
  /**
   * Process the queue using batch processing for better performance
   */
  private async processQueue(): Promise<void> {
    try {
      // Try to get a batch of items for processing
      const batch = await this.queueService.getNextBatch();
      
      if (batch.length === 0) {
        return; // Nothing to process
      }
      
      const firstItem = batch[0];
      if (!firstItem) {
        logger.warn('Empty batch received', 'QueueWorker');
        return;
      }
      
      logger.info('Processing segmentation queue batch', 'QueueWorker', {
        batchSize: batch.length,
        model: firstItem.model,
        threshold: firstItem.threshold,
        itemIds: batch.map(item => item.id)
      });
      
      // Process the batch using QueueService batch processing
      try {
        await this.queueService.processBatch(batch);
        
        const firstItem = batch[0];
        logger.info('Batch processing completed successfully', 'QueueWorker', {
          batchSize: batch.length,
          model: firstItem?.model || 'unknown'
        });
      } catch (error) {
        const firstItem = batch[0];
        logger.error('Failed to process queue batch', error instanceof Error ? error : undefined, 'QueueWorker', {
          batchSize: batch.length,
          model: firstItem?.model || 'unknown',
          itemIds: batch.map(item => item.id)
        });
        
        // Error handling is done within processBatch method
        // Individual items are marked for retry or failure as appropriate
      }
      
    } catch (error) {
      logger.error('Failed to process queue', error instanceof Error ? error : undefined, 'QueueWorker');
    }
  }

  /**
   * Reset stuck items on startup
   */
  private async resetStuckItemsOnStartup(): Promise<void> {
    try {
      const resetCount = await this.queueService.resetStuckItems(10);
      if (resetCount > 0) {
        logger.info('Reset stuck items on startup', 'QueueWorker', {
          resetCount
        });
      }
    } catch (error) {
      logger.error('Failed to reset stuck items on startup', error instanceof Error ? error : undefined, 'QueueWorker');
    }
  }

  /**
   * Perform periodic health check and maintenance
   */
  private async performHealthCheck(): Promise<void> {
    try {
      // Reset stuck items (items processing for more than 10 minutes)
      const resetCount = await this.queueService.resetStuckItems(10);
      if (resetCount > 0) {
        logger.warn('Reset stuck items during health check', 'QueueWorker', {
          resetCount
        });
      }

      // Get health status
      const healthStatus = await this.queueService.getQueueHealthStatus();
      
      // Log health issues
      if (!healthStatus.healthy) {
        logger.warn('Queue health check failed', 'QueueWorker', {
          issues: healthStatus.issues,
          queueStats: healthStatus.queueStats
        });
      } else {
        logger.debug('Queue health check passed', 'QueueWorker', {
          queueStats: healthStatus.queueStats
        });
      }

    } catch (error) {
      logger.error('Failed to perform health check', error instanceof Error ? error : undefined, 'QueueWorker');
    }
  }
}