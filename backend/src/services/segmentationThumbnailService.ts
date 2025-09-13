import { PrismaClient } from '@prisma/client';
import path from 'path';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import sharp from 'sharp';
import { VisualizationGenerator, Polygon } from './visualization/visualizationGenerator';
import { logger } from '../utils/logger';
import { getStorageProvider } from '../storage';
import { retryService, RetryService } from '../utils/retryService';
import { ConcurrencyManager } from '../utils/concurrencyManager';
import { batchProcessor } from '../utils/batchProcessor';

// Default retry configuration optimized for thumbnail generation
const DEFAULT_THUMBNAIL_RETRY_CONFIG = {
  maxRetries: 3,
  initialDelay: 1000,  // 1 second
  maxDelay: 10000,     // 10 seconds
  backoffFactor: 2,
  operationName: 'Thumbnail generation'
};

// Global concurrency controller instance
const thumbnailConcurrencyController = new ConcurrencyManager(5);

interface SegmentationThumbnailOptions {
  width?: number;
  height?: number;
  showNumbers?: boolean;
}

/**
 * Service for generating actual thumbnail images with segmentation overlays
 * This replaces the Canvas-based rendering with server-side generated images
 */
export class SegmentationThumbnailService {
  private prisma: PrismaClient;
  private visualizationGenerator: VisualizationGenerator;
  private storage = getStorageProvider();

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
    this.visualizationGenerator = new VisualizationGenerator();
  }

  /**
   * Generate a thumbnail image with segmentation overlay
   * This creates an actual image file, not just polygon data
   */
  async generateSegmentationThumbnail(
    segmentationId: string,
    options: SegmentationThumbnailOptions = {}
  ): Promise<string | null> {
    try {
      // Fetch segmentation with image data
      const segmentation = await this.prisma.segmentation.findUnique({
        where: { id: segmentationId },
        include: {
          image: {
            include: {
              project: true
            }
          }
        }
      });

      if (!segmentation || !segmentation.image) {
        logger.error('Segmentation or image not found', undefined, 'SegmentationThumbnailService', {
          segmentationId
        });
        return null;
      }

      // Parse polygons from JSON
      const polygons = JSON.parse(segmentation.polygons as string) as Polygon[];
      
      if (!polygons || polygons.length === 0) {
        logger.warn('No polygons found for segmentation', 'SegmentationThumbnailService', {
          segmentationId
        });
        return null;
      }

      const image = segmentation.image;
      const project = image.project;

      // Get original image path - the originalPath already includes the full relative path
      const originalImagePath = image.originalPath.startsWith('/') 
        ? image.originalPath 
        : path.join('/app/uploads', image.originalPath.replace(/^.*\/uploads\//, ''));

      // Check if original image exists
      if (!existsSync(originalImagePath)) {
        logger.error('Original image file not found', undefined, 'SegmentationThumbnailService', {
          originalImagePath
        });
        return null;
      }

      // Generate segmentation thumbnail path
      const thumbnailFileName = `seg_${Date.now()}_${path.basename(image.originalPath, path.extname(image.originalPath))}.jpg`;
      const thumbnailRelativePath = path.join(
        project.userId,
        project.id,
        'segmentation_thumbnails',
        thumbnailFileName
      );
      const thumbnailFullPath = path.join(
        '/app/uploads',
        thumbnailRelativePath
      );

      // Ensure directory exists
      const thumbnailDir = path.dirname(thumbnailFullPath);
      await fs.mkdir(thumbnailDir, { recursive: true });

      // Create temporary visualization at full size
      const tempVisualizationPath = path.join(
        '/app/uploads/temp',
        `temp_viz_${Date.now()}.png`
      );

      // Ensure temp directory exists
      await fs.mkdir(path.dirname(tempVisualizationPath), { recursive: true });

      // Generate visualization with segmentation overlay
      await this.visualizationGenerator.generateVisualization(
        originalImagePath,
        polygons,
        tempVisualizationPath,
        {
          showNumbers: options.showNumbers ?? false,
          strokeWidth: 2,
          transparency: 0.4,
          polygonColors: {
            external: '#FF0000',
            internal: '#0000FF'
          }
        }
      );

      // Create thumbnail from visualization
      const thumbnailWidth = options.width || 300;
      const thumbnailHeight = options.height || 300;

      await sharp(tempVisualizationPath)
        .resize(thumbnailWidth, thumbnailHeight, {
          fit: 'cover',
          position: 'center'
        })
        .jpeg({ quality: 90, mozjpeg: true })
        .toFile(thumbnailFullPath);

      // Clean up temp file
      try {
        await fs.unlink(tempVisualizationPath);
      } catch (_error) {
        logger.warn('Failed to clean up temp visualization file', 'SegmentationThumbnailService', {
          tempPath: tempVisualizationPath
        });
      }

      // Update image record with new segmentation thumbnail path (relative, without /uploads/ prefix)
      // This makes it consistent with originalPath and thumbnailPath fields
      
      await this.prisma.image.update({
        where: { id: image.id },
        data: {
          segmentationThumbnailPath: thumbnailRelativePath, // Store relative path without /uploads/
          updatedAt: new Date()
        }
      });

      logger.info('Segmentation thumbnail generated successfully', 'SegmentationThumbnailService', {
        segmentationId,
        thumbnailPath: thumbnailFullPath,
        thumbnailRelativePath: thumbnailRelativePath
      });

      return `/uploads/${thumbnailRelativePath}`; // Return with prefix for immediate use

    } catch (error) {
      logger.error(
        'Failed to generate segmentation thumbnail',
        error instanceof Error ? error : new Error(String(error)),
        'SegmentationThumbnailService',
        { segmentationId }
      );
      return null;
    }
  }

  /**
   * Generate a segmentation thumbnail with retry logic and exponential backoff
   * This method provides robust thumbnail generation following the emailRetryService pattern
   */
  async generateSegmentationThumbnailWithRetry(
    segmentationId: string,
    options: SegmentationThumbnailOptions = {}
  ): Promise<string | null> {
    // Use concurrency control and shared retry service
    return thumbnailConcurrencyController.execute(async () => {
      return retryService.executeWithRetry(
        () => this.generateSegmentationThumbnail(segmentationId, options),
        {
          ...DEFAULT_THUMBNAIL_RETRY_CONFIG,
          operationName: `Thumbnail generation for ${segmentationId}`
        },
        (error) => this.isRetriableError(error)
      );
    }, `Thumbnail generation for ${segmentationId}`);
  }

  /**
   * Determine if a thumbnail generation error is retriable
   * Uses shared logic plus thumbnail-specific rules
   */
  private isRetriableError(error: Error): boolean {
    // Check common retriable errors first
    if (RetryService.isCommonRetriableError(error)) {
      return true;
    }
    
    const message = error.message.toLowerCase();
    
    // Additional thumbnail-specific retriable errors
    if (message.includes('sharp') && 
        (message.includes('memory') ||    // Memory issues
         message.includes('buffer') ||    // Buffer issues
         message.includes('processing'))) { // Processing issues
      return true;
    }
    
    // Database errors that might be temporary
    if (message.includes('prisma') &&
        (message.includes('timeout') ||   // DB timeouts
         message.includes('connection'))) { // Connection issues
      return true;
    }
    
    // Do not retry for permanent errors
    if (message.includes('invalid') ||    // Invalid data
        message.includes('corrupt') ||    // Corrupted files
        message.includes('unsupported') || // Unsupported formats
        message.includes('not found') && !message.includes('enoent')) { // Permanent not found
      return false;
    }
    
    // Default to retriable for unknown errors
    return true;
  }

  /**
   * Generate thumbnails for all images in a batch with improved concurrency control
   * Now uses the retry wrapper for each thumbnail generation
   */
  async generateBatchThumbnails(
    segmentationIds: string[],
    options: SegmentationThumbnailOptions = {}
  ): Promise<Map<string, string | null>> {
    const results = new Map<string, string | null>();

    // Use shared BatchProcessor
    await batchProcessor.processBatch(
      segmentationIds,
      async (id) => {
        const result = await this.generateSegmentationThumbnailWithRetry(id, options);
        results.set(id, result);
        return result;
      },
      {
        batchSize: 5,
        concurrency: 5,
        onBatchComplete: (index, batchResults) => {
          logger.info(`Thumbnail batch ${index + 1} completed, ${batchResults.length} successful`);
        },
        onItemError: (id, error) => {
          logger.error(`Failed to generate thumbnail for ${id}`, error);
          results.set(id, null);
        }
      }
    );

    const successCount = Array.from(results.values()).filter(r => r !== null).length;
    const failureCount = results.size - successCount;

    logger.info('Batch thumbnail generation completed', 'SegmentationThumbnailService', {
      batchSize: segmentationIds.length,
      successCount,
      failureCount,
      concurrencyStatus: thumbnailConcurrencyController.getStatus()
    });

    return results;
  }

  /**
   * Get concurrency controller status for monitoring
   */
  getConcurrencyStatus(): { active: number; queued: number; maxConcurrent: number } {
    return thumbnailConcurrencyController.getStatus();
  }
}

export default SegmentationThumbnailService;