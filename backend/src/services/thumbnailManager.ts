import { PrismaClient } from '@prisma/client';
import { RetryService } from '../utils/retryService';
import { ConcurrencyManager } from '../utils/concurrencyManager';
import { BatchProcessor } from '../utils/batchProcessor';
import { logger } from '../utils/logger';
import { SegmentationThumbnailService } from './segmentationThumbnailService';
import { ThumbnailService } from './thumbnailService';

export class ThumbnailManager {
  private retryService: RetryService;
  private concurrencyManager: ConcurrencyManager;
  private batchProcessor: BatchProcessor;
  private segmentationThumbnailService: SegmentationThumbnailService;
  private thumbnailService: ThumbnailService;
  
  constructor(private prisma: PrismaClient) {
    this.retryService = new RetryService();
    this.concurrencyManager = new ConcurrencyManager(5); // Max 5 concurrent thumbnails
    this.batchProcessor = new BatchProcessor();
    this.segmentationThumbnailService = new SegmentationThumbnailService(prisma);
    this.thumbnailService = new ThumbnailService(prisma);
  }
  
  async generateAllThumbnails(segmentationId: string): Promise<void> {
    // Generate both types of thumbnails with retry
    await Promise.all([
      this.generateImageThumbnailWithRetry(segmentationId),
      this.generatePolygonThumbnailWithRetry(segmentationId)
    ]);
  }
  
  async generateImageThumbnailWithRetry(segmentationId: string): Promise<string | null> {
    return this.retryService.executeWithRetry(
      () => this.concurrencyManager.execute(
        () => this.segmentationThumbnailService.generateSegmentationThumbnail(segmentationId),
        `Image thumbnail for ${segmentationId}`
      ),
      {
        maxRetries: 3,
        initialDelay: 1000,
        maxDelay: 10000,
        backoffFactor: 2,
        operationName: `Image thumbnail generation for ${segmentationId}`
      },
      RetryService.isCommonRetriableError
    );
  }
  
  async generatePolygonThumbnailWithRetry(segmentationId: string): Promise<void> {
    return this.retryService.executeWithRetry(
      () => this.thumbnailService.generateThumbnails(segmentationId),
      {
        maxRetries: 3,
        initialDelay: 1000,
        maxDelay: 10000,
        backoffFactor: 2,
        operationName: `Polygon thumbnail generation for ${segmentationId}`
      },
      RetryService.isCommonRetriableError
    );
  }
  
  async generateBatchThumbnails(segmentationIds: string[]): Promise<void> {
    await this.batchProcessor.processBatch(
      segmentationIds,
      (id) => this.generateAllThumbnails(id),
      {
        batchSize: 5,
        concurrency: 5,
        onBatchComplete: (index, results) => {
          logger.info(`Thumbnail batch ${index + 1} completed, ${results.length} successful`);
        },
        onItemError: (id, error) => {
          logger.error(`Failed to generate thumbnail for ${id}`, error);
        }
      }
    );
  }
  
  getConcurrencyStatus() {
    return this.concurrencyManager.getStatus();
  }
}