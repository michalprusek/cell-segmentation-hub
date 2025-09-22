import { PrismaClient } from '@prisma/client';
import { RetryService } from '../utils/retryService';
import { ConcurrencyManager } from '../utils/concurrencyManager';
import { BatchProcessor } from '../utils/batchProcessor';
import { logger } from '../utils/logger';
import { SegmentationThumbnailService } from './segmentationThumbnailService';
// Removed ThumbnailService - using only SegmentationThumbnailService for unified approach

export class ThumbnailManager {
  private retryService: RetryService;
  private concurrencyManager: ConcurrencyManager;
  private batchProcessor: BatchProcessor;
  private segmentationThumbnailService: SegmentationThumbnailService;
  // Polygon thumbnail service removed - unified approach

  constructor(private prisma: PrismaClient) {
    this.retryService = new RetryService();
    this.concurrencyManager = new ConcurrencyManager(5); // Max 5 concurrent thumbnails
    this.batchProcessor = new BatchProcessor();
    this.segmentationThumbnailService = new SegmentationThumbnailService(
      prisma
    );
    // Unified thumbnail approach - no polygon service needed
  }

  async generateAllThumbnails(segmentationId: string): Promise<void> {
    // Generate only image thumbnails (unified approach)
    await this.generateImageThumbnailWithRetry(segmentationId);
  }

  async generateImageThumbnailWithRetry(
    segmentationId: string
  ): Promise<string | null> {
    return this.retryService.executeWithRetry(
      () =>
        this.concurrencyManager.execute(
          () =>
            this.segmentationThumbnailService.generateSegmentationThumbnail(
              segmentationId
            ),
          `Image thumbnail for ${segmentationId}`
        ),
      {
        maxRetries: 3,
        initialDelay: 1000,
        maxDelay: 10000,
        backoffFactor: 2,
        operationName: `Image thumbnail generation for ${segmentationId}`,
      },
      RetryService.isCommonRetriableError
    );
  }

  // Polygon thumbnail generation removed - unified approach uses only image thumbnails

  async generateBatchThumbnails(segmentationIds: string[]): Promise<void> {
    await this.batchProcessor.processBatch(
      segmentationIds,
      id => this.generateAllThumbnails(id),
      {
        batchSize: 5,
        concurrency: 5,
        onBatchComplete: (index, results) => {
          logger.info(
            `Thumbnail batch ${index + 1} completed, ${results.length} successful`
          );
        },
        onItemError: (id, error) => {
          logger.error(
            `Failed to generate thumbnail for ${id}`,
            error instanceof Error ? error : new Error(String(error))
          );
        },
      }
    );
  }

  getConcurrencyStatus(): unknown {
    return this.concurrencyManager.getStatus();
  }
}
