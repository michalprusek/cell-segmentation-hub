/**
 * Tests for batch segmentation index misalignment fix
 * Ensures that the last image in batch receives correct results even when some images are invalid
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { SegmentationService } from '../segmentationService';
import { getStorageProvider } from '../../storage';
import axios from 'axios';

jest.mock('axios');
jest.mock('../../storage');
jest.mock('../../utils/logger');

describe('SegmentationService - Batch Index Fix', () => {
  let service: SegmentationService;
  let mockAxiosInstance: any;
  let mockStorage: any;

  beforeEach(() => {
    mockAxiosInstance = {
      post: jest.fn(),
      get: jest.fn(),
    };
    (axios.create as any).mockReturnValue(mockAxiosInstance);

    mockStorage = {
      getBuffer: jest.fn().mockResolvedValue(Buffer.from('test-image-data')),
    };
    (getStorageProvider as any).mockReturnValue(mockStorage);

    service = new SegmentationService();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('requestBatchSegmentation with invalid images', () => {
    it('should correctly map results when middle image is invalid', async () => {
      // Arrange: 3 images, middle one is invalid
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
          originalPath: null, // Invalid - no path
          width: 1024,
          height: 768,
          mimeType: 'image/jpeg',
        },
        {
          id: 'img3',
          name: 'image3.jpg',
          originalPath: 'path/to/image3.jpg',
          width: 1024,
          height: 768,
          mimeType: 'image/jpeg',
        },
      ];

      // ML service returns results only for valid images (img1 and img3)
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
              threshold_used: 0.5,
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
              threshold_used: 0.5,
              confidence: 0.92,
              processing_time: 0.6,
              image_size: { width: 1024, height: 768 },
            },
          ],
          processing_time: 1.1,
        },
      };

      mockAxiosInstance.post.mockResolvedValueOnce(mlResponse);

      // Act
      const results = await service.requestBatchSegmentation(images);

      // Assert
      expect(results).toHaveLength(3);

      // First image should have first ML result
      expect(results[0].success).toBe(true);
      expect(results[0].polygons).toHaveLength(1);
      expect(results[0].confidence).toBe(0.95);

      // Second (invalid) image should have error result
      expect(results[1].success).toBe(false);
      expect(results[1].polygons).toHaveLength(0);
      expect(results[1].error).toBe('Image skipped or invalid');

      // Third image should have second ML result (NOT undefined!)
      expect(results[2].success).toBe(true);
      expect(results[2].polygons).toHaveLength(1);
      expect(results[2].confidence).toBe(0.92);
    });

    it('should handle last image correctly when first images are invalid', async () => {
      // Arrange: 3 images, first two are invalid
      const images = [
        {
          id: 'img1',
          name: 'image1.jpg',
          originalPath: null, // Invalid
          width: 1024,
          height: 768,
        },
        {
          id: 'img2',
          name: 'image2.jpg',
          originalPath: undefined, // Invalid
          width: 1024,
          height: 768,
        },
        {
          id: 'img3',
          name: 'image3.jpg',
          originalPath: 'path/to/image3.jpg', // Valid - last image
          width: 1024,
          height: 768,
          mimeType: 'image/jpeg',
        },
      ];

      // ML service returns result only for the last valid image
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
                {
                  points: [
                    [200, 200],
                    [300, 200],
                    [300, 300],
                    [200, 300],
                  ],
                },
              ],
              model_used: 'hrnet',
              threshold_used: 0.5,
              confidence: 0.98,
              processing_time: 0.8,
              image_size: { width: 1024, height: 768 },
            },
          ],
          processing_time: 0.8,
        },
      };

      mockAxiosInstance.post.mockResolvedValueOnce(mlResponse);

      // Act
      const results = await service.requestBatchSegmentation(images);

      // Assert
      expect(results).toHaveLength(3);

      // First two should be marked as invalid
      expect(results[0].success).toBe(false);
      expect(results[0].error).toBe('Image skipped or invalid');

      expect(results[1].success).toBe(false);
      expect(results[1].error).toBe('Image skipped or invalid');

      // Last image MUST have successful segmentation result
      expect(results[2].success).toBe(true);
      expect(results[2].polygons).toHaveLength(2);
      expect(results[2].confidence).toBe(0.98);
      expect(results[2].model_used).toBe('hrnet');
    });

    it('should handle mixed valid/invalid images in large batch', async () => {
      // Arrange: 5 images with indices 1 and 3 invalid
      const images = [
        {
          id: 'img0',
          name: 'img0.jpg',
          originalPath: 'path/0.jpg',
          width: 1024,
          height: 768,
        },
        {
          id: 'img1',
          name: 'img1.jpg',
          originalPath: null,
          width: 1024,
          height: 768,
        }, // Invalid
        {
          id: 'img2',
          name: 'img2.jpg',
          originalPath: 'path/2.jpg',
          width: 1024,
          height: 768,
        },
        {
          id: 'img3',
          name: 'img3.jpg',
          originalPath: undefined,
          width: 1024,
          height: 768,
        }, // Invalid
        {
          id: 'img4',
          name: 'img4.jpg',
          originalPath: 'path/4.jpg',
          width: 1024,
          height: 768,
        }, // Last image
      ];

      // ML service returns 3 results for valid images (0, 2, 4)
      const mlResponse = {
        data: {
          results: [
            {
              success: true,
              polygons: [{ points: [[0, 0]] }],
              confidence: 0.91,
            },
            {
              success: true,
              polygons: [{ points: [[1, 1]] }],
              confidence: 0.92,
            },
            {
              success: true,
              polygons: [{ points: [[2, 2]] }],
              confidence: 0.93,
            },
          ],
        },
      };

      mockAxiosInstance.post.mockResolvedValueOnce(mlResponse);

      // Act
      const results = await service.requestBatchSegmentation(images);

      // Assert
      expect(results).toHaveLength(5);

      // Check correct mapping
      expect(results[0].success).toBe(true);
      expect(results[0].confidence).toBe(0.91);

      expect(results[1].success).toBe(false); // Invalid

      expect(results[2].success).toBe(true);
      expect(results[2].confidence).toBe(0.92);

      expect(results[3].success).toBe(false); // Invalid

      // Last image must be successful with correct result
      expect(results[4].success).toBe(true);
      expect(results[4].confidence).toBe(0.93);
      expect(results[4].polygons).toBeDefined();
      expect(results[4].polygons).toHaveLength(1);
    });

    it('should handle all images being invalid', async () => {
      // Arrange: All images invalid
      const images = [
        { id: 'img1', name: 'img1.jpg', originalPath: null },
        { id: 'img2', name: 'img2.jpg', originalPath: undefined },
        { id: 'img3', name: 'img3.jpg', originalPath: '' },
      ];

      // ML service would receive empty FormData, should return empty results
      const mlResponse = {
        data: {
          results: [],
          processing_time: 0,
        },
      };

      mockAxiosInstance.post.mockResolvedValueOnce(mlResponse);

      // Act
      const results = await service.requestBatchSegmentation(images);

      // Assert
      expect(results).toHaveLength(3);
      results.forEach(result => {
        expect(result.success).toBe(false);
        expect(result.error).toBe('Image skipped or invalid');
      });
    });
  });
});
