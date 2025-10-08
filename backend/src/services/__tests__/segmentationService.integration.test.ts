/**
 * Integration tests for batch segmentation with race condition handling
 * Tests the complete flow including WebSocket updates and database writes
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { SegmentationService } from '../segmentationService';
import { PrismaClient } from '@prisma/client';
import { getStorageProvider } from '../../storage';
import axios from 'axios';
import { EventEmitter } from 'events';

jest.mock('axios');
jest.mock('../../storage');
jest.mock('@prisma/client');
jest.mock('../../utils/logger');

// Mock WebSocket emitter for testing race conditions
class MockWebSocketEmitter extends EventEmitter {
  emitWithDelay(event: string, data: any, delayMs: number): void {
    setTimeout(() => {
      this.emit(event, data);
    }, delayMs);
  }
}

describe('SegmentationService - Integration Tests', () => {
  let service: SegmentationService;
  let mockAxiosInstance: any;
  let mockStorage: any;
  let mockPrisma: any;
  let mockWsEmitter: MockWebSocketEmitter;

  beforeEach(() => {
    // Setup mocks
    mockAxiosInstance = {
      post: jest.fn(),
      get: jest.fn(),
    };
    (axios.create as any).mockReturnValue(mockAxiosInstance);

    mockStorage = {
      getBuffer: jest.fn().mockResolvedValue(Buffer.from('test-image-data')),
      uploadFile: jest
        .fn()
        .mockResolvedValue({ url: 'https://storage.example.com/file' }),
    };
    (getStorageProvider as any).mockReturnValue(mockStorage);

    // Mock Prisma for database operations
    mockPrisma = {
      segmentationResult: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      image: {
        update: jest.fn(),
        findMany: jest.fn(),
      },
      $transaction: jest.fn(callback => callback(mockPrisma)),
    };

    mockWsEmitter = new MockWebSocketEmitter();
    service = new SegmentationService();
    (service as any).prisma = mockPrisma;
    (service as any).wsEmitter = mockWsEmitter;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Race Condition Handling', () => {
    it('should handle WebSocket update arriving before database write completes', async () => {
      // Arrange: Setup batch with mixed valid/invalid images
      const images = [
        {
          id: 'img1',
          name: 'image1.jpg',
          originalPath: 'path/to/image1.jpg',
          width: 1024,
          height: 768,
          mimeType: 'image/jpeg',
        },
        {
          id: 'img2',
          name: 'image2.jpg',
          originalPath: null, // Invalid
          width: 1024,
          height: 768,
        },
        {
          id: 'img3',
          name: 'image3.jpg',
          originalPath: 'path/to/image3.jpg', // Last valid image
          width: 1024,
          height: 768,
          mimeType: 'image/jpeg',
        },
      ];

      // ML service returns results for valid images only
      const mlResponse = {
        data: {
          results: [
            {
              success: true,
              polygons: [
                {
                  points: [
                    [0, 0],
                    [100, 0],
                    [100, 100],
                    [0, 100],
                  ],
                },
              ],
              model_used: 'hrnet',
              confidence: 0.95,
              processing_time: 0.5,
              image_size: { width: 1024, height: 768 },
            },
            {
              success: true,
              polygons: [
                {
                  points: [
                    [50, 50],
                    [150, 50],
                    [150, 150],
                    [50, 150],
                  ],
                },
              ],
              model_used: 'hrnet',
              confidence: 0.98, // Last image result
              processing_time: 0.6,
              image_size: { width: 1024, height: 768 },
            },
          ],
          processing_time: 1.1,
        },
      };

      mockAxiosInstance.post.mockResolvedValueOnce(mlResponse);

      // Simulate slow database write (500ms delay)
      let databaseWriteComplete = false;
      mockPrisma.segmentationResult.create.mockImplementation(async data => {
        await new Promise(resolve => setTimeout(resolve, 500)); // Simulate delay
        databaseWriteComplete = true;
        return {
          id: 'result-id',
          imageId: data.data.imageId,
          polygons: data.data.polygons,
          createdAt: new Date(),
        };
      });

      // Mock the findUnique to return null initially, then the result after DB write
      let findUniqueCallCount = 0;
      mockPrisma.segmentationResult.findUnique.mockImplementation(
        async ({ where }) => {
          findUniqueCallCount++;

          // First call: database write not complete yet
          if (findUniqueCallCount === 1 && !databaseWriteComplete) {
            return null;
          }

          // Second call (after retry): database write complete
          if (where.imageId === 'img3') {
            return {
              id: 'result-id-3',
              imageId: 'img3',
              polygons: mlResponse.data.results[1].polygons,
              modelUsed: 'hrnet',
              confidence: 0.98,
            };
          }

          return null;
        }
      );

      // Act: Process batch segmentation
      const processingPromise = service.requestBatchSegmentation(images);

      // Simulate WebSocket update arriving immediately (before DB write)
      mockWsEmitter.emitWithDelay(
        'segmentation-update',
        {
          imageId: 'img3',
          projectId: 'project-1',
          status: 'completed',
        },
        100
      ); // WebSocket update after 100ms

      const results = await processingPromise;

      // Assert: Results should be correctly mapped
      expect(results).toHaveLength(3);

      // Last image should have correct result
      expect(results[2].success).toBe(true);
      expect(results[2].confidence).toBe(0.98);
      expect(results[2].polygons).toHaveLength(1);

      // Verify retry logic was triggered (findUnique called twice for last image)
      expect(mockPrisma.segmentationResult.findUnique).toHaveBeenCalledTimes(2);
    });

    it('should handle multiple images with race conditions in batch', async () => {
      // Arrange: All valid images
      const images = Array.from({ length: 5 }, (_, i) => ({
        id: `img${i}`,
        name: `image${i}.jpg`,
        originalPath: `path/to/image${i}.jpg`,
        width: 1024,
        height: 768,
        mimeType: 'image/jpeg',
      }));

      // ML service returns results for all images
      const mlResponse = {
        data: {
          results: images.map((_, i) => ({
            success: true,
            polygons: [
              {
                points: [
                  [i, i],
                  [i + 100, i],
                  [i + 100, i + 100],
                  [i, i + 100],
                ],
              },
            ],
            model_used: 'hrnet',
            confidence: 0.9 + i * 0.01,
            processing_time: 0.5 + i * 0.1,
            image_size: { width: 1024, height: 768 },
          })),
          processing_time: 3.0,
        },
      };

      mockAxiosInstance.post.mockResolvedValueOnce(mlResponse);

      // Simulate varying database write delays
      const dbDelays = [100, 300, 200, 400, 600]; // Different delays for each image
      mockPrisma.segmentationResult.create.mockImplementation(async data => {
        const imageIndex = parseInt(data.data.imageId.replace('img', ''));
        await new Promise(resolve => setTimeout(resolve, dbDelays[imageIndex]));
        return {
          id: `result-${data.data.imageId}`,
          imageId: data.data.imageId,
          polygons: data.data.polygons,
          createdAt: new Date(),
        };
      });

      // Act
      const results = await service.requestBatchSegmentation(images);

      // Assert: All results should be correctly mapped
      expect(results).toHaveLength(5);
      results.forEach((result, i) => {
        expect(result.success).toBe(true);
        expect(result.confidence).toBeCloseTo(0.9 + i * 0.01, 2);
      });
    });

    it('should timeout and use fallback after max retries', async () => {
      // Arrange: Setup image that will never get DB results
      const images = [
        {
          id: 'img-timeout',
          name: 'timeout.jpg',
          originalPath: 'path/to/timeout.jpg',
          width: 1024,
          height: 768,
          mimeType: 'image/jpeg',
        },
      ];

      const mlResponse = {
        data: {
          results: [
            {
              success: true,
              polygons: [
                {
                  points: [
                    [0, 0],
                    [100, 0],
                    [100, 100],
                    [0, 100],
                  ],
                },
              ],
              model_used: 'hrnet',
              confidence: 0.95,
              processing_time: 0.5,
              image_size: { width: 1024, height: 768 },
            },
          ],
          processing_time: 0.5,
        },
      };

      mockAxiosInstance.post.mockResolvedValueOnce(mlResponse);

      // Simulate database never writing (returns null always)
      mockPrisma.segmentationResult.findUnique.mockResolvedValue(null);

      // Mock retry configuration with shorter timeout for testing
      const originalTimeout = process.env.SEGMENTATION_RETRY_TIMEOUT;
      process.env.SEGMENTATION_RETRY_TIMEOUT = '1500'; // 1.5 seconds total

      // Act
      const startTime = Date.now();
      const results = await service.requestBatchSegmentation(images);
      const elapsed = Date.now() - startTime;

      // Assert
      expect(results[0].success).toBe(true); // Should still have ML result
      expect(results[0].confidence).toBe(0.95);
      expect(elapsed).toBeLessThan(2000); // Should timeout within 2 seconds

      // Verify retries were attempted
      expect(
        mockPrisma.segmentationResult.findUnique.mock.calls.length
      ).toBeGreaterThan(1);

      // Cleanup
      process.env.SEGMENTATION_RETRY_TIMEOUT = originalTimeout;
    });

    it('should handle WebSocket disconnection during batch processing', async () => {
      // Arrange
      const images = [
        {
          id: 'img1',
          name: 'image1.jpg',
          originalPath: 'path/to/image1.jpg',
          width: 1024,
          height: 768,
          mimeType: 'image/jpeg',
        },
      ];

      const mlResponse = {
        data: {
          results: [
            {
              success: true,
              polygons: [
                {
                  points: [
                    [0, 0],
                    [100, 0],
                    [100, 100],
                    [0, 100],
                  ],
                },
              ],
              model_used: 'hrnet',
              confidence: 0.95,
              processing_time: 0.5,
              image_size: { width: 1024, height: 768 },
            },
          ],
          processing_time: 0.5,
        },
      };

      mockAxiosInstance.post.mockResolvedValueOnce(mlResponse);

      // Simulate WebSocket disconnection (no events emitted)
      mockWsEmitter.emit = jest.fn().mockImplementation(() => {
        throw new Error('WebSocket disconnected');
      });

      // Database write succeeds
      mockPrisma.segmentationResult.create.mockResolvedValue({
        id: 'result-1',
        imageId: 'img1',
        polygons: mlResponse.data.results[0].polygons,
      });

      // Act
      const results = await service.requestBatchSegmentation(images);

      // Assert: Should still process successfully even without WebSocket
      expect(results[0].success).toBe(true);
      expect(results[0].confidence).toBe(0.95);

      // Verify WebSocket error was caught gracefully
      expect(mockWsEmitter.emit).toHaveBeenCalled();
    });
  });

  describe('Batch Processing Edge Cases', () => {
    it('should handle empty batch gracefully', async () => {
      const results = await service.requestBatchSegmentation([]);
      expect(results).toEqual([]);
      expect(mockAxiosInstance.post).not.toHaveBeenCalled();
    });

    it('should handle all invalid images in batch', async () => {
      const images = [
        { id: 'img1', name: 'img1.jpg', originalPath: null },
        { id: 'img2', name: 'img2.jpg', originalPath: undefined },
        { id: 'img3', name: 'img3.jpg', originalPath: '' },
      ];

      const results = await service.requestBatchSegmentation(images);

      expect(results).toHaveLength(3);
      results.forEach(result => {
        expect(result.success).toBe(false);
        expect(result.error).toBe('Image skipped or invalid');
      });
    });

    it('should handle ML service timeout gracefully', async () => {
      const images = [
        {
          id: 'img1',
          name: 'image1.jpg',
          originalPath: 'path/to/image1.jpg',
          width: 1024,
          height: 768,
          mimeType: 'image/jpeg',
        },
      ];

      // Simulate ML service timeout
      mockAxiosInstance.post.mockRejectedValueOnce(new Error('Timeout'));

      const results = await service.requestBatchSegmentation(images);

      expect(results[0].success).toBe(false);
      expect(results[0].error).toContain('Timeout');
    });
  });
});
