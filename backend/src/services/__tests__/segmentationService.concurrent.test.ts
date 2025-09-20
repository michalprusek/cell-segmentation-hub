import { SegmentationService, SegmentationRequest, SegmentationResponse } from '../segmentationService';
import { ImageService } from '../imageService';
import { PrismaClient } from '@prisma/client';
import axios, { AxiosInstance } from 'axios';

// Mock dependencies
jest.mock('axios');
jest.mock('@prisma/client');
jest.mock('../imageService');
jest.mock('../thumbnailService');
jest.mock('../segmentationThumbnailService');
jest.mock('../thumbnailManager');

describe('SegmentationService - Concurrent Request Handling', () => {
  let segmentationService: SegmentationService;
  let mockPrisma: jest.Mocked<PrismaClient>;
  let mockImageService: jest.Mocked<ImageService>;
  let mockAxios: jest.Mocked<AxiosInstance>;

  const mockSegmentationResponse: SegmentationResponse = {
    success: true,
    polygons: [
      {
        points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }],
        area: 10000,
        confidence: 0.95,
        type: 'external'
      }
    ],
    model_used: 'hrnet',
    threshold_used: 0.5,
    processing_time: 1500,
    image_size: { width: 1024, height: 1024 }
  };

  const mockImage = {
    id: 'img1',
    name: 'test.jpg',
    originalPath: '/path/to/image',
    width: 1024,
    height: 1024,
    mimeType: 'image/jpeg'
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup mocks
    mockPrisma = {} as any;
    mockImageService = {
      getImageById: jest.fn().mockResolvedValue(mockImage),
      updateSegmentationStatus: jest.fn().mockResolvedValue(undefined)
    } as any;

    // Mock axios instance
    mockAxios = {
      post: jest.fn(),
      get: jest.fn(),
      interceptors: {
        request: { use: jest.fn() },
        response: { use: jest.fn() }
      }
    } as any;

    // Mock axios.create to return our mock instance
    (axios.create as jest.Mock).mockReturnValue(mockAxios);

    // Create SegmentationService instance
    segmentationService = new SegmentationService(mockPrisma, mockImageService);
  });

  describe('Concurrent Request Management', () => {
    it('should handle multiple concurrent requests efficiently', async () => {
      // Mock successful ML service response
      mockAxios.post.mockResolvedValue({
        status: 200,
        data: mockSegmentationResponse
      });

      const requests: SegmentationRequest[] = [
        { imageId: 'img1', model: 'hrnet', threshold: 0.5, userId: 'user1' },
        { imageId: 'img2', model: 'hrnet', threshold: 0.5, userId: 'user1' },
        { imageId: 'img3', model: 'cbam_resunet', threshold: 0.6, userId: 'user2' },
        { imageId: 'img4', model: 'hrnet', threshold: 0.7, userId: 'user2' }
      ];

      // Process requests concurrently
      const startTime = Date.now();
      const promises = requests.map(request =>
        segmentationService.requestSegmentation(request)
      );

      const results = await Promise.all(promises);
      const duration = Date.now() - startTime;

      // All requests should succeed
      expect(results).toHaveLength(4);
      results.forEach(result => {
        expect(result.success).toBe(true);
        expect(result.polygons).toHaveLength(1);
      });

      // Should complete faster than processing sequentially
      expect(duration).toBeLessThan(6000); // Less than 4 * 1.5s

      // Verify ML service was called for each request
      expect(mockAxios.post).toHaveBeenCalledTimes(4);
    });

    it('should respect concurrent request limits', async () => {
      // Mock ML service to respond with delay
      mockAxios.post.mockImplementation(() =>
        new Promise(resolve =>
          setTimeout(() => resolve({
            status: 200,
            data: mockSegmentationResponse
          }), 1000)
        )
      );

      // Create more requests than the concurrent limit (4)
      const requests: SegmentationRequest[] = Array.from({ length: 6 }, (_, i) => ({
        imageId: `img${i + 1}`,
        model: 'hrnet',
        threshold: 0.5,
        userId: 'user1'
      }));

      const startTime = Date.now();
      const promises = requests.map(request =>
        segmentationService.requestSegmentation(request)
      );

      const results = await Promise.all(promises);
      const duration = Date.now() - startTime;

      // All requests should succeed
      expect(results).toHaveLength(6);

      // Should take longer than the concurrent limit would suggest
      // (indicating requests were queued)
      expect(duration).toBeGreaterThan(1500); // More than 1 batch worth
      expect(duration).toBeLessThan(3000); // But not 6 sequential requests

      expect(mockAxios.post).toHaveBeenCalledTimes(6);
    });

    it('should provide concurrent request metrics', () => {
      const metrics = segmentationService.getConcurrentRequestMetrics();

      expect(metrics).toHaveProperty('activeRequests');
      expect(metrics).toHaveProperty('maxConcurrentRequests');
      expect(metrics).toHaveProperty('utilizationPercentage');

      expect(metrics.maxConcurrentRequests).toBe(4);
      expect(metrics.activeRequests).toBe(0); // No active requests initially
      expect(metrics.utilizationPercentage).toBe(0);
    });

    it('should check available capacity correctly', () => {
      // Initially should have full capacity
      expect(segmentationService.hasAvailableCapacity()).toBe(true);

      // After starting requests up to the limit, capacity should be checked
      // (This would require more complex mocking to test properly in isolation)
    });

    it('should handle individual request failures in concurrent processing', async () => {
      // Mock mixed success/failure responses
      let callCount = 0;
      mockAxios.post.mockImplementation(() => {
        callCount++;
        if (callCount % 2 === 0) {
          return Promise.reject(new Error('ML service error'));
        }
        return Promise.resolve({
          status: 200,
          data: mockSegmentationResponse
        });
      });

      const requests: SegmentationRequest[] = [
        { imageId: 'img1', model: 'hrnet', threshold: 0.5, userId: 'user1' },
        { imageId: 'img2', model: 'hrnet', threshold: 0.5, userId: 'user1' },
        { imageId: 'img3', model: 'hrnet', threshold: 0.5, userId: 'user1' },
        { imageId: 'img4', model: 'hrnet', threshold: 0.5, userId: 'user1' }
      ];

      const promises = requests.map(request =>
        segmentationService.requestSegmentation(request).catch(error => error)
      );

      const results = await Promise.all(promises);

      // Should have mix of successful responses and errors
      const successes = results.filter(r => r.success === true);
      const errors = results.filter(r => r instanceof Error);

      expect(successes.length).toBe(2);
      expect(errors.length).toBe(2);
    });
  });

  describe('Connection Pooling', () => {
    it('should configure HTTP client with connection pooling', () => {
      // Verify axios.create was called with connection pooling configuration
      expect(axios.create).toHaveBeenCalledWith(
        expect.objectContaining({
          timeout: 300000,
          maxBodyLength: Infinity,
          maxContentLength: Infinity,
          httpAgent: expect.any(Object),
          httpsAgent: expect.any(Object)
        })
      );
    });

    it('should reuse connections for multiple requests', async () => {
      mockAxios.post.mockResolvedValue({
        status: 200,
        data: mockSegmentationResponse
      });

      const requests: SegmentationRequest[] = [
        { imageId: 'img1', model: 'hrnet', threshold: 0.5, userId: 'user1' },
        { imageId: 'img2', model: 'hrnet', threshold: 0.5, userId: 'user1' }
      ];

      // Process multiple requests
      await Promise.all(requests.map(request =>
        segmentationService.requestSegmentation(request)
      ));

      // Both requests should use the same HTTP client instance
      expect(mockAxios.post).toHaveBeenCalledTimes(2);

      // Verify connection pooling headers and configuration
      const callArgs = mockAxios.post.mock.calls;
      callArgs.forEach(args => {
        const config = args[2]; // Third argument is the config
        expect(config).toHaveProperty('maxBodyLength', Infinity);
        expect(config).toHaveProperty('maxContentLength', Infinity);
      });
    });
  });

  describe('Request Queue Management', () => {
    it('should queue requests when at capacity limit', async () => {
      let resolveCount = 0;
      const resolvers: Array<(value: any) => void> = [];

      // Mock ML service to respond only when we trigger it
      mockAxios.post.mockImplementation(() =>
        new Promise(resolve => {
          resolvers.push(resolve);
        })
      );

      // Start 6 requests (more than the 4 concurrent limit)
      const requests: SegmentationRequest[] = Array.from({ length: 6 }, (_, i) => ({
        imageId: `img${i + 1}`,
        model: 'hrnet',
        threshold: 0.5,
        userId: 'user1'
      }));

      const promises = requests.map(request =>
        segmentationService.requestSegmentation(request)
      );

      // Wait a moment for all requests to be initiated
      await new Promise(resolve => setTimeout(resolve, 100));

      // Should have 4 requests in progress (at the limit)
      expect(resolvers.length).toBe(4);

      // Resolve first 2 requests
      resolvers[0]({ status: 200, data: mockSegmentationResponse });
      resolvers[1]({ status: 200, data: mockSegmentationResponse });

      // Wait for more requests to be processed
      await new Promise(resolve => setTimeout(resolve, 200));

      // Should now have started the queued requests
      expect(resolvers.length).toBe(6);

      // Resolve remaining requests
      for (let i = 2; i < 6; i++) {
        resolvers[i]({ status: 200, data: mockSegmentationResponse });
      }

      const results = await Promise.all(promises);
      expect(results).toHaveLength(6);
      results.forEach(result => expect(result.success).toBe(true));
    });

    it('should handle request timeout during queuing', async () => {
      // Mock ML service to never respond (timeout scenario)
      mockAxios.post.mockImplementation(() =>
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Request timeout')), 100)
        )
      );

      const request: SegmentationRequest = {
        imageId: 'img1',
        model: 'hrnet',
        threshold: 0.5,
        userId: 'user1'
      };

      await expect(segmentationService.requestSegmentation(request))
        .rejects.toThrow('Request timeout');
    });
  });

  describe('Performance Optimization', () => {
    it('should handle burst of requests efficiently', async () => {
      mockAxios.post.mockResolvedValue({
        status: 200,
        data: mockSegmentationResponse
      });

      // Simulate burst of 20 requests
      const requests: SegmentationRequest[] = Array.from({ length: 20 }, (_, i) => ({
        imageId: `img${i + 1}`,
        model: 'hrnet',
        threshold: 0.5,
        userId: `user${i % 4 + 1}` // 4 different users
      }));

      const startTime = Date.now();
      const results = await Promise.all(
        requests.map(request => segmentationService.requestSegmentation(request))
      );
      const duration = Date.now() - startTime;

      expect(results).toHaveLength(20);
      results.forEach(result => expect(result.success).toBe(true));

      // Should complete much faster than sequential processing
      expect(duration).toBeLessThan(10000); // Less than 20 * 0.5s sequential
    });

    it('should maintain performance under mixed model requests', async () => {
      mockAxios.post.mockResolvedValue({
        status: 200,
        data: mockSegmentationResponse
      });

      const models = ['hrnet', 'cbam_resunet', 'unet_spherohq'];
      const requests: SegmentationRequest[] = Array.from({ length: 12 }, (_, i) => ({
        imageId: `img${i + 1}`,
        model: models[i % 3] as any,
        threshold: 0.5,
        userId: 'user1'
      }));

      const results = await Promise.all(
        requests.map(request => segmentationService.requestSegmentation(request))
      );

      expect(results).toHaveLength(12);
      results.forEach(result => expect(result.success).toBe(true));

      // Should have made requests for all different models
      const uniqueEndpoints = new Set(
        mockAxios.post.mock.calls.map(call => call[0])
      );
      expect(uniqueEndpoints.size).toBe(1); // All use /api/v1/segment endpoint
    });
  });

  describe('Error Handling and Recovery', () => {
    it('should recover from ML service temporary failures', async () => {
      let callCount = 0;
      mockAxios.post.mockImplementation(() => {
        callCount++;
        if (callCount <= 2) {
          return Promise.reject(new Error('Service temporarily unavailable'));
        }
        return Promise.resolve({
          status: 200,
          data: mockSegmentationResponse
        });
      });

      const requests: SegmentationRequest[] = [
        { imageId: 'img1', model: 'hrnet', threshold: 0.5, userId: 'user1' },
        { imageId: 'img2', model: 'hrnet', threshold: 0.5, userId: 'user1' },
        { imageId: 'img3', model: 'hrnet', threshold: 0.5, userId: 'user1' }
      ];

      const results = await Promise.allSettled(
        requests.map(request => segmentationService.requestSegmentation(request))
      );

      // First two should fail, third should succeed
      expect(results[0].status).toBe('rejected');
      expect(results[1].status).toBe('rejected');
      expect(results[2].status).toBe('fulfilled');
    });

    it('should handle network errors gracefully', async () => {
      mockAxios.post.mockRejectedValue(new Error('Network error'));

      const request: SegmentationRequest = {
        imageId: 'img1',
        model: 'hrnet',
        threshold: 0.5,
        userId: 'user1'
      };

      await expect(segmentationService.requestSegmentation(request))
        .rejects.toThrow('Network error');

      // Should update image status even on failure
      expect(mockImageService.updateSegmentationStatus)
        .toHaveBeenCalledWith('img1', 'processing', 'user1');
    });

    it('should handle partial response errors', async () => {
      mockAxios.post.mockResolvedValue({
        status: 200,
        data: null // Invalid response
      });

      const request: SegmentationRequest = {
        imageId: 'img1',
        model: 'hrnet',
        threshold: 0.5,
        userId: 'user1'
      };

      await expect(segmentationService.requestSegmentation(request))
        .rejects.toThrow('Invalid response from ML service');
    });
  });

  describe('Resource Management', () => {
    it('should clean up resources after request completion', async () => {
      mockAxios.post.mockResolvedValue({
        status: 200,
        data: mockSegmentationResponse
      });

      const request: SegmentationRequest = {
        imageId: 'img1',
        model: 'hrnet',
        threshold: 0.5,
        userId: 'user1'
      };

      const initialMetrics = segmentationService.getConcurrentRequestMetrics();
      expect(initialMetrics.activeRequests).toBe(0);

      await segmentationService.requestSegmentation(request);

      const finalMetrics = segmentationService.getConcurrentRequestMetrics();
      expect(finalMetrics.activeRequests).toBe(0); // Should be cleaned up
    });

    it('should track active requests correctly during processing', async () => {
      let resolveRequest: (value: any) => void;
      mockAxios.post.mockImplementation(() =>
        new Promise(resolve => {
          resolveRequest = resolve;
        })
      );

      const request: SegmentationRequest = {
        imageId: 'img1',
        model: 'hrnet',
        threshold: 0.5,
        userId: 'user1'
      };

      // Start request but don't wait for completion
      const promise = segmentationService.requestSegmentation(request);

      // Wait a moment for request to be tracked
      await new Promise(resolve => setTimeout(resolve, 50));

      const metrics = segmentationService.getConcurrentRequestMetrics();
      expect(metrics.activeRequests).toBe(1);
      expect(metrics.utilizationPercentage).toBe(25); // 1/4 * 100

      // Complete the request
      resolveRequest!({ status: 200, data: mockSegmentationResponse });
      await promise;

      const finalMetrics = segmentationService.getConcurrentRequestMetrics();
      expect(finalMetrics.activeRequests).toBe(0);
    });
  });
});