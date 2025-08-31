import { PrismaClient } from '@prisma/client';
import path from 'path';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import sharp from 'sharp';
import { VisualizationGenerator, Polygon } from './visualization/visualizationGenerator';
import { logger } from '../utils/logger';
import { getStorageProvider } from '../storage';

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
      } catch (error) {
        logger.warn('Failed to clean up temp visualization file', 'SegmentationThumbnailService', {
          tempPath: tempVisualizationPath
        });
      }

      // Update image record with new segmentation thumbnail URL
      const segmentationThumbnailUrl = `/uploads/${thumbnailRelativePath}`;
      
      await this.prisma.image.update({
        where: { id: image.id },
        data: {
          segmentationThumbnailPath: segmentationThumbnailUrl,
          updatedAt: new Date()
        }
      });

      logger.info('Segmentation thumbnail generated successfully', 'SegmentationThumbnailService', {
        segmentationId,
        thumbnailPath: thumbnailFullPath,
        thumbnailUrl: segmentationThumbnailUrl
      });

      return segmentationThumbnailUrl;

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
   * Generate thumbnails for all images in a batch
   */
  async generateBatchThumbnails(
    segmentationIds: string[],
    options: SegmentationThumbnailOptions = {}
  ): Promise<Map<string, string | null>> {
    const results = new Map<string, string | null>();

    // Process thumbnails in parallel with concurrency limit
    const BATCH_SIZE = 5;
    for (let i = 0; i < segmentationIds.length; i += BATCH_SIZE) {
      const batch = segmentationIds.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map(id => this.generateSegmentationThumbnail(id, options))
      );
      
      batch.forEach((id, index) => {
        results.set(id, batchResults[index]);
      });
    }

    return results;
  }
}

export default SegmentationThumbnailService;