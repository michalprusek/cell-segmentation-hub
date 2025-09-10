import { describe, it, expect, beforeEach, jest, afterEach } from '@jest/globals';
import { PrismaClient } from '@prisma/client';
import { SegmentationService } from '../segmentationService';
import { ImageService } from '../imageService';
import { logger } from '../../utils/logger';

// Mock dependencies
jest.mock('../../utils/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('../../utils/config', () => ({
  config: {
    SEGMENTATION_SERVICE_URL: 'http://localhost:8000',
  },
}));

jest.mock('../imageService');

describe('SegmentationService - Batch Result Fetching', () => {
  let segmentationService: SegmentationService;
  let prismaMock: any;
  let imageServiceMock: any;

  beforeEach(() => {
    // Create comprehensive Prisma mock
    prismaMock = {
      segmentation: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        upsert: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        deleteMany: jest.fn(),
      },
      image: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        count: jest.fn(),
      },
      project: {
        findFirst: jest.fn(),
      },
    };

    // Mock ImageService
    imageServiceMock = {
      getImageById: jest.fn(),
      updateSegmentationStatus: jest.fn(),
    };

    segmentationService = new SegmentationService(
      prismaMock as PrismaClient,
      imageServiceMock as ImageService
    );

    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('getBatchSegmentationResults', () => {
    const userId = 'test-user-id';
    const imageIds = ['img-1', 'img-2', 'img-3'];

    it('should fetch batch segmentation results with valid JSON data', async () => {
      // Mock accessible images
      prismaMock.image.findMany.mockResolvedValue([
        { id: 'img-1' },
        { id: 'img-2' },
        { id: 'img-3' },
      ]);

      // Mock segmentation data with valid JSON polygons
      const mockPolygons = [
        {
          points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }],
          area: 100,
          confidence: 0.95,
          type: 'external'
        }
      ];

      prismaMock.segmentation.findMany.mockResolvedValue([
        {
          imageId: 'img-1',
          polygons: JSON.stringify(mockPolygons),
          model: 'hrnet',
          threshold: 0.5,
          confidence: 0.95,
          processingTime: 2500,
          imageWidth: 800,
          imageHeight: 600,
        },
        {
          imageId: 'img-2',
          polygons: JSON.stringify([]),
          model: 'hrnet',
          threshold: 0.5,
          confidence: null,
          processingTime: 1200,
          imageWidth: 1024,
          imageHeight: 768,
        },
      ]);

      const results = await segmentationService.getBatchSegmentationResults(imageIds, userId);

      expect(prismaMock.image.findMany).toHaveBeenCalledWith({
        where: {
          id: { in: imageIds },
          project: { userId }
        },
        select: { id: true }
      });

      expect(prismaMock.segmentation.findMany).toHaveBeenCalledWith({
        where: {
          imageId: { in: ['img-1', 'img-2', 'img-3'] }
        }
      });

      expect(results['img-1']).toEqual({
        success: true,
        polygons: mockPolygons,
        model_used: 'hrnet',
        threshold_used: 0.5,
        confidence: 0.95,
        processing_time: 2.5,
        image_size: { width: 800, height: 600 },
        imageWidth: 800,
        imageHeight: 600,
      });

      expect(results['img-2']).toEqual({
        success: true,
        polygons: [],
        model_used: 'hrnet',
        threshold_used: 0.5,
        confidence: null,
        processing_time: 1.2,
        image_size: { width: 1024, height: 768 },
        imageWidth: 1024,
        imageHeight: 768,
      });

      expect(results['img-3']).toBeNull();
    });

    it('should handle null segmentation results gracefully', async () => {
      prismaMock.image.findMany.mockResolvedValue([
        { id: 'img-1' },
        { id: 'img-2' },
      ]);

      // Mock segmentation with null/missing results
      prismaMock.segmentation.findMany.mockResolvedValue([
        {
          imageId: 'img-1',
          polygons: null,
          model: 'hrnet',
          threshold: 0.5,
          confidence: null,
          processingTime: null,
          imageWidth: null,
          imageHeight: null,
        },
      ]);

      const results = await segmentationService.getBatchSegmentationResults(['img-1', 'img-2'], userId);

      // Should not throw errors
      expect(results['img-1']).toEqual({
        success: true,
        polygons: [],
        model_used: 'hrnet',
        threshold_used: 0.5,
        confidence: null,
        processing_time: null,
        image_size: { width: 0, height: 0 },
        imageWidth: 0,
        imageHeight: 0,
      });

      expect(results['img-2']).toBeNull();
      expect(logger.error).not.toHaveBeenCalled();
    });

    it('should handle malformed JSON polygons gracefully', async () => {
      prismaMock.image.findMany.mockResolvedValue([
        { id: 'img-1' },
        { id: 'img-2' },
      ]);

      prismaMock.segmentation.findMany.mockResolvedValue([
        {
          imageId: 'img-1',
          polygons: 'invalid-json{',
          model: 'hrnet',
          threshold: 0.5,
          confidence: 0.8,
          processingTime: 3000,
          imageWidth: 800,
          imageHeight: 600,
        },
        {
          imageId: 'img-2',
          polygons: 'null',
          model: 'unet',
          threshold: 0.3,
          confidence: 0.7,
          processingTime: 2000,
          imageWidth: 1024,
          imageHeight: 768,
        },
      ]);

      const results = await segmentationService.getBatchSegmentationResults(['img-1', 'img-2'], userId);

      // Should gracefully handle malformed JSON
      expect(results['img-1']).toEqual({
        success: true,
        polygons: [],
        model_used: 'hrnet',
        threshold_used: 0.5,
        confidence: 0.8,
        processing_time: 3,
        image_size: { width: 800, height: 600 },
        imageWidth: 800,
        imageHeight: 600,
      });

      expect(results['img-2']).toEqual({
        success: true,
        polygons: [],
        model_used: 'unet',
        threshold_used: 0.3,
        confidence: 0.7,
        processing_time: 2,
        image_size: { width: 1024, height: 768 },
        imageWidth: 1024,
        imageHeight: 768,
      });

      expect(logger.error).toHaveBeenCalledWith(
        'Failed to parse polygons JSON in batch',
        expect.any(Error),
        'SegmentationService',
        {
          imageId: 'img-1',
          polygonsRaw: 'invalid-json{',
        }
      );
    });

    it('should respect user access permissions', async () => {
      // Mock user has access to only some images
      prismaMock.image.findMany.mockResolvedValue([
        { id: 'img-1' },
        { id: 'img-3' }, // img-2 is not accessible
      ]);

      prismaMock.segmentation.findMany.mockResolvedValue([
        {
          imageId: 'img-1',
          polygons: JSON.stringify([]),
          model: 'hrnet',
          threshold: 0.5,
          confidence: 0.8,
          processingTime: 1000,
          imageWidth: 800,
          imageHeight: 600,
        },
      ]);

      const results = await segmentationService.getBatchSegmentationResults(imageIds, userId);

      expect(results['img-1']).toBeDefined();
      expect(results['img-2']).toBeUndefined(); // Not accessible, not in results
      expect(results['img-3']).toBeNull(); // Accessible but no segmentation
    });

    it('should handle different batch sizes efficiently', async () => {
      // Test with single image
      prismaMock.image.findMany.mockResolvedValue([{ id: 'img-1' }]);
      prismaMock.segmentation.findMany.mockResolvedValue([]);

      let results = await segmentationService.getBatchSegmentationResults(['img-1'], userId);
      expect(Object.keys(results)).toHaveLength(1);

      // Test with large batch (100 images)
      const largeImageIds = Array.from({ length: 100 }, (_, i) => `img-${i}`);
      const accessibleImages = largeImageIds.map(id => ({ id }));
      prismaMock.image.findMany.mockResolvedValue(accessibleImages);
      prismaMock.segmentation.findMany.mockResolvedValue([]);

      results = await segmentationService.getBatchSegmentationResults(largeImageIds, userId);
      expect(Object.keys(results)).toHaveLength(100);

      // All should be null (no segmentation data)
      Object.values(results).forEach(result => {
        expect(result).toBeNull();
      });
    });

    it('should handle empty imageIds array', async () => {
      const results = await segmentationService.getBatchSegmentationResults([], userId);
      expect(results).toEqual({});
      expect(prismaMock.image.findMany).toHaveBeenCalledWith({
        where: {
          id: { in: [] },
          project: { userId }
        },
        select: { id: true }
      });
    });

    it('should handle database errors gracefully', async () => {
      const databaseError = new Error('Database connection failed');
      prismaMock.image.findMany.mockRejectedValue(databaseError);

      await expect(
        segmentationService.getBatchSegmentationResults(imageIds, userId)
      ).rejects.toThrow('Database connection failed');

      expect(logger.error).toHaveBeenCalledWith(
        'Failed to batch fetch segmentation results',
        databaseError,
        'SegmentationService',
        {
          imageCount: 3,
          userId: userId,
        }
      );
    });

    it('should process complex polygon data correctly', async () => {
      const complexPolygons = [
        {
          points: [
            { x: 10.5, y: 20.3 },
            { x: 30.7, y: 25.1 },
            { x: 35.2, y: 45.8 },
            { x: 15.9, y: 40.4 },
          ],
          area: 625.75,
          confidence: 0.92,
          type: 'external',
          parent_id: null,
        },
        {
          points: [
            { x: 20, y: 30 },
            { x: 25, y: 30 },
            { x: 25, y: 35 },
            { x: 20, y: 35 },
          ],
          area: 25,
          confidence: 0.88,
          type: 'internal',
          parent_id: 'polygon-1',
        },
      ];

      prismaMock.image.findMany.mockResolvedValue([{ id: 'img-1' }]);
      prismaMock.segmentation.findMany.mockResolvedValue([
        {
          imageId: 'img-1',
          polygons: JSON.stringify(complexPolygons),
          model: 'cbam_resunet',
          threshold: 0.7,
          confidence: 0.9,
          processingTime: 5500,
          imageWidth: 1920,
          imageHeight: 1080,
        },
      ]);

      const results = await segmentationService.getBatchSegmentationResults(['img-1'], userId);

      expect(results['img-1'].polygons).toEqual(complexPolygons);
      expect(results['img-1'].polygons[0].points).toHaveLength(4);
      expect(results['img-1'].polygons[1].type).toBe('internal');
      expect(results['img-1'].polygons[1].parent_id).toBe('polygon-1');
    });

    it('should log debug information correctly', async () => {
      prismaMock.image.findMany.mockResolvedValue([{ id: 'img-1' }]);
      prismaMock.segmentation.findMany.mockResolvedValue([
        {
          imageId: 'img-1',
          polygons: JSON.stringify([]),
          model: 'hrnet',
          threshold: 0.5,
          confidence: 0.8,
          processingTime: 1000,
          imageWidth: 800,
          imageHeight: 600,
        },
      ]);

      await segmentationService.getBatchSegmentationResults(['img-1'], userId);

      expect(logger.debug).toHaveBeenCalledWith(
        'Batch segmentation results fetched successfully',
        'SegmentationService',
        {
          requestedImages: 1,
          accessibleImages: 1,
          resultsFound: 1,
        }
      );
    });
  });

  describe('getSegmentationResults - Single Image', () => {
    const imageId = 'test-image-id';
    const userId = 'test-user-id';

    it('should handle null response from database', async () => {
      imageServiceMock.getImageById.mockResolvedValue({ id: imageId, name: 'test.jpg' });
      prismaMock.segmentation.findUnique.mockResolvedValue(null);

      const result = await segmentationService.getSegmentationResults(imageId, userId);

      expect(result).toBeNull();
      expect(logger.debug).toHaveBeenCalledWith(
        'No segmentation data found for image',
        'SegmentationService',
        { imageId }
      );
    });

    it('should handle malformed JSON in polygons column', async () => {
      imageServiceMock.getImageById.mockResolvedValue({ id: imageId, name: 'test.jpg' });
      prismaMock.segmentation.findUnique.mockResolvedValue({
        imageId,
        polygons: 'invalid-json{',
        model: 'hrnet',
        threshold: 0.5,
        confidence: 0.8,
        processingTime: 2000,
        imageWidth: 800,
        imageHeight: 600,
      });

      const result = await segmentationService.getSegmentationResults(imageId, userId);

      expect(result).toBeDefined();
      expect(result?.polygons).toEqual([]);
      expect(logger.error).toHaveBeenCalledWith(
        'Failed to parse polygons JSON',
        expect.any(Error),
        'SegmentationService',
        {
          imageId,
          polygonsRaw: 'invalid-json{',
        }
      );
    });
  });
});