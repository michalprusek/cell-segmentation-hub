import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger';
import { WebSocketService, ThumbnailUpdate } from './websocketService';

interface Point {
  x: number;
  y: number;
}

interface Polygon {
  id: string;
  points: Point[];
  type: 'external' | 'internal';
  class?: string;
}

interface SimplifiedPolygon extends Polygon {
  originalPointCount: number;
  compressionRatio: number;
}

export interface ThumbnailData {
  levelOfDetail: 'low' | 'medium' | 'high';
  polygons: SimplifiedPolygon[];
  totalPolygons: number;
  totalPoints: number;
  averageCompressionRatio: number;
}

export class ThumbnailService {
  private webSocketService: WebSocketService | null = null;

  constructor(private prisma: PrismaClient) {
    // Try to get WebSocket service instance (may not be available during initialization)
    try {
      this.webSocketService = WebSocketService.getInstance();
    } catch (error) {
      logger.debug('WebSocket service not yet available for thumbnail service', 'ThumbnailService');
    }
  }

  /**
   * Douglas-Peucker algorithm for polygon simplification
   */
  private simplifyPolygon(points: Point[], tolerance: number): Point[] {
    if (points.length <= 3) {return points;}

    // Find the point with the maximum distance from the line between start and end
    let maxDistance = 0;
    let maxIndex = 0;
    const start = points[0];
    const end = points[points.length - 1];
    
    if (!start || !end) {return points;}

    for (let i = 1; i < points.length - 1; i++) {
      const point = points[i];
      if (!point) {continue;}
      const distance = this.perpendicularDistance(point, start, end);
      if (distance > maxDistance) {
        maxDistance = distance;
        maxIndex = i;
      }
    }

    // If max distance is greater than tolerance, recursively simplify
    if (maxDistance > tolerance) {
      const leftPart = this.simplifyPolygon(points.slice(0, maxIndex + 1), tolerance);
      const rightPart = this.simplifyPolygon(points.slice(maxIndex), tolerance);

      // Combine the two parts (removing the duplicate point at maxIndex)
      return [...leftPart.slice(0, -1), ...rightPart];
    } else {
      // If all points are within tolerance, return just the endpoints
      return [start!, end!];
    }
  }

  /**
   * Calculate perpendicular distance from a point to a line
   */
  private perpendicularDistance(point: Point, lineStart: Point, lineEnd: Point): number {
    const dx = lineEnd.x - lineStart.x;
    const dy = lineEnd.y - lineStart.y;

    if (dx === 0 && dy === 0) {
      // Line start and end are the same
      return Math.sqrt((point.x - lineStart.x) ** 2 + (point.y - lineStart.y) ** 2);
    }

    const normalLength = Math.sqrt(dx * dx + dy * dy);
    return Math.abs(
      (dy * point.x - dx * point.y + lineEnd.x * lineStart.y - lineEnd.y * lineStart.x) /
        normalLength
    );
  }

  /**
   * Generate thumbnail data at different levels of detail
   */
  private generateThumbnailLevels(
    polygons: Polygon[],
    imageWidth: number,
    imageHeight: number
  ): ThumbnailData[] {
    const imageDiagonal = Math.sqrt(imageWidth * imageWidth + imageHeight * imageHeight);
    
    // Define tolerance levels based on image size
    const tolerances = {
      low: imageDiagonal * 0.02,    // 2% of diagonal - very simplified
      medium: imageDiagonal * 0.01,  // 1% of diagonal - moderate detail
      high: imageDiagonal * 0.005   // 0.5% of diagonal - high detail
    };

    const levels: ThumbnailData[] = [];

    for (const [level, tolerance] of Object.entries(tolerances)) {
      const simplifiedPolygons: SimplifiedPolygon[] = polygons.map(polygon => {
        const originalPointCount = polygon.points.length;
        const simplifiedPoints = this.simplifyPolygon(polygon.points, tolerance);
        const compressionRatio = originalPointCount / Math.max(simplifiedPoints.length, 1);

        return {
          ...polygon,
          points: simplifiedPoints,
          originalPointCount,
          compressionRatio
        };
      });

      const totalPoints = simplifiedPolygons.reduce((sum, p) => sum + p.points.length, 0);
      const averageCompressionRatio = simplifiedPolygons.reduce((sum, p) => sum + p.compressionRatio, 0) / simplifiedPolygons.length;

      levels.push({
        levelOfDetail: level as 'low' | 'medium' | 'high',
        polygons: simplifiedPolygons,
        totalPolygons: simplifiedPolygons.length,
        totalPoints,
        averageCompressionRatio
      });
    }

    return levels;
  }

  /**
   * Generate and store thumbnail data for a segmentation
   */
  async generateThumbnails(segmentationId: string): Promise<void> {
    try {
      logger.info(`🖼️ Generating thumbnails for segmentation ${segmentationId}`, 'ThumbnailService');

      // Get the segmentation data
      const segmentation = await this.prisma.segmentation.findUnique({
        where: { id: segmentationId },
        include: { image: true }
      });

      if (!segmentation) {
        throw new Error(`Segmentation ${segmentationId} not found`);
      }

      if (!segmentation.imageWidth || !segmentation.imageHeight) {
        throw new Error(`Segmentation ${segmentationId} missing image dimensions`);
      }

      // Parse polygons
      let polygons: Polygon[];
      try {
        polygons = JSON.parse(segmentation.polygons);
      } catch (error) {
        throw new Error(`Failed to parse polygons for segmentation ${segmentationId}: ${error}`);
      }

      if (!polygons || polygons.length === 0) {
        logger.warn(`⚠️ No polygons found for segmentation ${segmentationId}`, 'ThumbnailService');
        return;
      }

      // Generate thumbnails at different levels of detail
      const thumbnailLevels = this.generateThumbnailLevels(
        polygons,
        segmentation.imageWidth,
        segmentation.imageHeight
      );

      // Store thumbnails in database
      await this.prisma.$transaction(async (tx) => {
        // Remove existing thumbnails
        await tx.segmentationThumbnail.deleteMany({
          where: { segmentationId }
        });

        // Create new thumbnails
        for (const thumbnailData of thumbnailLevels) {
          await tx.segmentationThumbnail.create({
            data: {
              segmentationId,
              levelOfDetail: thumbnailData.levelOfDetail,
              simplifiedData: JSON.stringify(thumbnailData.polygons),
              polygonCount: thumbnailData.totalPolygons,
              pointCount: thumbnailData.totalPoints,
              compressionRatio: thumbnailData.averageCompressionRatio
            }
          });
        }
      });

      // Broadcast thumbnail updates via WebSocket for real-time UI updates
      if (this.webSocketService && segmentation.image.projectId) {
        try {
          // Send only the 'low' level thumbnail for card updates (most commonly used)
          const lowDetailThumbnail = thumbnailLevels.find(t => t.levelOfDetail === 'low');
          if (lowDetailThumbnail) {
            const thumbnailUpdate: ThumbnailUpdate = {
              imageId: segmentation.imageId,
              projectId: segmentation.image.projectId,
              segmentationId,
              thumbnailData: {
                levelOfDetail: lowDetailThumbnail.levelOfDetail,
                polygons: lowDetailThumbnail.polygons,
                polygonCount: lowDetailThumbnail.totalPolygons,
                pointCount: lowDetailThumbnail.totalPoints,
                compressionRatio: lowDetailThumbnail.averageCompressionRatio
              }
            };

            this.webSocketService.broadcastThumbnailUpdate(segmentation.image.projectId, thumbnailUpdate);
          }
        } catch (error) {
          logger.error(
            `Failed to broadcast thumbnail update for segmentation ${segmentationId}`,
            error instanceof Error ? error : new Error(String(error)),
            'ThumbnailService'
          );
        }
      }

      logger.info(
        `✅ Generated ${thumbnailLevels.length} thumbnail levels for segmentation ${segmentationId}`,
        'ThumbnailService',
        {
          segmentationId,
          originalPolygons: polygons.length,
          thumbnailLevels: thumbnailLevels.map(level => ({
            level: level.levelOfDetail,
            polygons: level.totalPolygons,
            points: level.totalPoints,
            compression: level.averageCompressionRatio.toFixed(2)
          }))
        }
      );

    } catch (error) {
      logger.error(
        `❌ Failed to generate thumbnails for segmentation ${segmentationId}`,
        error instanceof Error ? error : new Error(String(error)),
        'ThumbnailService'
      );
      throw error;
    }
  }

  /**
   * Get thumbnail data for a segmentation
   */
  async getThumbnail(
    segmentationId: string,
    levelOfDetail: 'low' | 'medium' | 'high' = 'low'
  ): Promise<ThumbnailData | null> {
    try {
      const thumbnail = await this.prisma.segmentationThumbnail.findUnique({
        where: {
          segmentationId_levelOfDetail: {
            segmentationId,
            levelOfDetail
          }
        }
      });

      if (!thumbnail) {
        return null;
      }

      const polygons = JSON.parse(thumbnail.simplifiedData);

      return {
        levelOfDetail: thumbnail.levelOfDetail as 'low' | 'medium' | 'high',
        polygons,
        totalPolygons: thumbnail.polygonCount,
        totalPoints: thumbnail.pointCount,
        averageCompressionRatio: thumbnail.compressionRatio
      };

    } catch (error) {
      logger.error(
        `❌ Failed to get thumbnail for segmentation ${segmentationId}`,
        error instanceof Error ? error : new Error(String(error)),
        'ThumbnailService'
      );
      return null;
    }
  }

  /**
   * Get thumbnails for multiple segmentations (batch operation)
   */
  async getThumbnailsBatch(
    segmentationIds: string[],
    levelOfDetail: 'low' | 'medium' | 'high' = 'low'
  ): Promise<Map<string, ThumbnailData>> {
    const results = new Map<string, ThumbnailData>();

    try {
      const thumbnails = await this.prisma.segmentationThumbnail.findMany({
        where: {
          segmentationId: { in: segmentationIds },
          levelOfDetail
        }
      });

      for (const thumbnail of thumbnails) {
        try {
          const polygons = JSON.parse(thumbnail.simplifiedData);
          results.set(thumbnail.segmentationId, {
            levelOfDetail: thumbnail.levelOfDetail as 'low' | 'medium' | 'high',
            polygons,
            totalPolygons: thumbnail.polygonCount,
            totalPoints: thumbnail.pointCount,
            averageCompressionRatio: thumbnail.compressionRatio
          });
        } catch (error) {
          logger.error(
            `❌ Failed to parse thumbnail data for segmentation ${thumbnail.segmentationId}`,
            error instanceof Error ? error : new Error(String(error)),
            'ThumbnailService'
          );
        }
      }

      logger.debug(
        `📦 Batch retrieved ${results.size}/${segmentationIds.length} thumbnails`,
        'ThumbnailService',
        { levelOfDetail, segmentationIds: segmentationIds.length }
      );

    } catch (error) {
      logger.error(
        `❌ Failed to batch get thumbnails`,
        error instanceof Error ? error : new Error(String(error)),
        'ThumbnailService'
      );
    }

    return results;
  }

  /**
   * Regenerate thumbnails for all segmentations (maintenance operation)
   */
  async regenerateAllThumbnails(): Promise<void> {
    try {
      logger.info('🔄 Starting regeneration of all thumbnails', 'ThumbnailService');

      const segmentations = await this.prisma.segmentation.findMany({
        select: { id: true }
      });

      let processed = 0;
      let failed = 0;

      for (const segmentation of segmentations) {
        try {
          await this.generateThumbnails(segmentation.id);
          processed++;
        } catch (error) {
          failed++;
          logger.error(
            `❌ Failed to regenerate thumbnail for segmentation ${segmentation.id}`,
            error instanceof Error ? error : new Error(String(error)),
            'ThumbnailService'
          );
        }
      }

      logger.info(
        `✅ Thumbnail regeneration complete: ${processed} processed, ${failed} failed`,
        'ThumbnailService',
        { processed, failed, total: segmentations.length }
      );

    } catch (error) {
      logger.error(
        `❌ Failed to regenerate all thumbnails`,
        error instanceof Error ? error : new Error(String(error)),
        'ThumbnailService'
      );
      throw error;
    }
  }
}