import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import type { AxiosResponse, AxiosError } from 'axios';

// Mock axios completely
vi.mock('axios');
const mockAxios = axios as any;

// Mock localStorage and sessionStorage
const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
};
const sessionStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
};

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
});
Object.defineProperty(window, 'sessionStorage', {
  value: sessionStorageMock,
});

// Mock config
vi.mock('../config', () => ({
  default: {
    apiBaseUrl: 'http://localhost:3001/api',
  },
}));

// Mock logger
vi.mock('../logger', () => ({
  logger: {
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('API Client - Advanced Features', () => {
  let mockAxiosInstance: any;
  let apiClient: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    mockAxiosInstance = {
      post: vi.fn(),
      get: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
      interceptors: {
        request: { use: vi.fn() },
        response: { use: vi.fn() },
      },
    };

    mockAxios.create.mockReturnValue(mockAxiosInstance);

    // Reset storage mocks
    localStorageMock.getItem.mockReturnValue(null);
    sessionStorageMock.getItem.mockReturnValue(null);

    // Import fresh API client
    vi.resetModules();
    const { apiClient: freshApiClient } = await import('../api');
    apiClient = freshApiClient;

    // Mock the internal instance property directly
    (apiClient as any).instance = mockAxiosInstance;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.resetAllMocks();
  });

  describe('Token Management and Storage', () => {
    test('should load tokens from localStorage on initialization', async () => {
      localStorageMock.getItem.mockImplementation((key: string) => {
        if (key === 'accessToken') return 'stored-access-token';
        if (key === 'refreshToken') return 'stored-refresh-token';
        return null;
      });

      // Re-import to trigger constructor with mocked localStorage
      vi.resetModules();
      const { apiClient: newApiClient } = await import('../api');

      expect(newApiClient.isAuthenticated()).toBe(true);
      expect(newApiClient.getAccessToken()).toBe('stored-access-token');
    });

    test('should prioritize localStorage over sessionStorage', async () => {
      localStorageMock.getItem.mockImplementation((key: string) => {
        if (key === 'accessToken') return 'local-token';
        if (key === 'refreshToken') return 'local-refresh';
        return null;
      });

      sessionStorageMock.getItem.mockImplementation((key: string) => {
        if (key === 'accessToken') return 'session-token';
        if (key === 'refreshToken') return 'session-refresh';
        return null;
      });

      vi.resetModules();
      const { apiClient: newApiClient } = await import('../api');

      expect(newApiClient.getAccessToken()).toBe('local-token');
    });

    test('should fallback to sessionStorage when localStorage is empty', async () => {
      localStorageMock.getItem.mockReturnValue(null);
      sessionStorageMock.getItem.mockImplementation((key: string) => {
        if (key === 'accessToken') return 'session-token';
        if (key === 'refreshToken') return 'session-refresh';
        return null;
      });

      vi.resetModules();
      const { apiClient: newApiClient } = await import('../api');

      expect(newApiClient.getAccessToken()).toBe('session-token');
    });

    test('should clear tokens from both storages on logout', async () => {
      (apiClient as any).refreshToken = 'test-refresh-token';
      mockAxiosInstance.post.mockResolvedValue({});

      await apiClient.logout();

      expect(localStorageMock.removeItem).toHaveBeenCalledWith('accessToken');
      expect(localStorageMock.removeItem).toHaveBeenCalledWith('refreshToken');
      expect(sessionStorageMock.removeItem).toHaveBeenCalledWith('accessToken');
      expect(sessionStorageMock.removeItem).toHaveBeenCalledWith(
        'refreshToken'
      );
    });
  });

  describe('Automatic Token Refresh', () => {
    test('should automatically refresh token on 401 and retry request', async () => {
      const originalRequest = { url: '/test-endpoint', headers: {} };

      // Set up client with tokens
      (apiClient as any).accessToken = 'expired-token';
      (apiClient as any).refreshToken = 'valid-refresh-token';

      // Mock 401 error response
      const unauthorizedError = {
        response: { status: 401 },
        config: originalRequest,
      };

      // Mock successful refresh response
      const refreshResponse = {
        data: {
          success: true,
          data: { accessToken: 'new-access-token' },
        },
      };

      // Mock successful retry response
      const retryResponse = {
        data: { result: 'success' },
      };

      mockAxiosInstance.post.mockResolvedValueOnce(refreshResponse);
      mockAxiosInstance
        .mockImplementationOnce(() => Promise.reject(unauthorizedError))
        .mockImplementationOnce(() => Promise.resolve(retryResponse));

      // Simulate interceptor behavior
      const responseInterceptor =
        mockAxiosInstance.interceptors.response.use.mock.calls[0][1];

      const result = await responseInterceptor(unauthorizedError);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/auth/refresh', {
        refreshToken: 'valid-refresh-token',
      });

      expect(result.data.result).toBe('success');
    });

    test('should not retry auth endpoints on 401', async () => {
      const loginRequest = { url: '/auth/login', headers: {} };

      const unauthorizedError = {
        response: { status: 401 },
        config: loginRequest,
      };

      const responseInterceptor =
        mockAxiosInstance.interceptors.response.use.mock.calls[0][1];

      await expect(responseInterceptor(unauthorizedError)).rejects.toEqual(
        unauthorizedError
      );

      // Should not attempt refresh for auth endpoints
      expect(mockAxiosInstance.post).not.toHaveBeenCalledWith(
        '/auth/refresh',
        expect.any(Object)
      );
    });

    test('should clear tokens when refresh fails', async () => {
      const originalRequest = { url: '/protected-endpoint', headers: {} };

      (apiClient as any).accessToken = 'expired-token';
      (apiClient as any).refreshToken = 'invalid-refresh-token';

      const unauthorizedError = {
        response: { status: 401 },
        config: originalRequest,
      };

      // Mock failed refresh
      mockAxiosInstance.post.mockRejectedValue(new Error('Refresh failed'));

      const responseInterceptor =
        mockAxiosInstance.interceptors.response.use.mock.calls[0][1];

      await expect(responseInterceptor(unauthorizedError)).rejects.toThrow(
        'Refresh failed'
      );

      expect(localStorageMock.removeItem).toHaveBeenCalledWith('accessToken');
      expect(localStorageMock.removeItem).toHaveBeenCalledWith('refreshToken');
    });

    test('should not retry request that already has _retry flag', async () => {
      const requestWithRetry = { url: '/test', headers: {}, _retry: true };

      const unauthorizedError = {
        response: { status: 401 },
        config: requestWithRetry,
      };

      const responseInterceptor =
        mockAxiosInstance.interceptors.response.use.mock.calls[0][1];

      await expect(responseInterceptor(unauthorizedError)).rejects.toEqual(
        unauthorizedError
      );

      expect(mockAxiosInstance.post).not.toHaveBeenCalled();
    });
  });

  describe('Exponential Backoff for Rate Limiting', () => {
    test('should retry on 429 with exponential backoff', async () => {
      const originalRequest = { url: '/rate-limited-endpoint' };

      const rateLimitError = {
        response: { status: 429 },
        config: originalRequest,
      };

      // Mock successful retry after backoff
      const successResponse = { data: { result: 'success' } };

      mockAxiosInstance
        .mockImplementationOnce(() => Promise.reject(rateLimitError))
        .mockImplementationOnce(() => Promise.resolve(successResponse));

      const responseInterceptor =
        mockAxiosInstance.interceptors.response.use.mock.calls[0][1];

      // Start the retry process
      const retryPromise = responseInterceptor(rateLimitError);

      // Fast-forward time to trigger retry
      await vi.advanceTimersByTimeAsync(1500); // Should include base delay + jitter

      const result = await retryPromise;
      expect(result.data.result).toBe('success');
    });

    test('should respect maximum retry attempts for 429 errors', async () => {
      const originalRequest = { url: '/always-rate-limited' };

      const rateLimitError = {
        response: { status: 429 },
        config: originalRequest,
      };

      // Always return rate limit error
      mockAxiosInstance.mockImplementation(() =>
        Promise.reject(rateLimitError)
      );

      const responseInterceptor =
        mockAxiosInstance.interceptors.response.use.mock.calls[0][1];

      const retryPromise = responseInterceptor(rateLimitError);

      // Fast-forward through all retry attempts
      for (let i = 0; i < 5; i++) {
        await vi.advanceTimersByTimeAsync(15000); // Max delay
      }

      await expect(retryPromise).rejects.toEqual(rateLimitError);
    });

    test('should not retry non-429 errors with exponential backoff', async () => {
      const originalRequest = { url: '/server-error' };

      const serverError = {
        response: { status: 500 },
        config: originalRequest,
      };

      const responseInterceptor =
        mockAxiosInstance.interceptors.response.use.mock.calls[0][1];

      await expect(responseInterceptor(serverError)).rejects.toEqual(
        serverError
      );

      // Should not retry
      expect(mockAxiosInstance).toHaveBeenCalledTimes(0);
    });

    test('should apply jitter to backoff delays', async () => {
      // Mock Math.random to return predictable values for testing
      const originalRandom = Math.random;
      let randomCallCount = 0;
      Math.random = () => {
        randomCallCount++;
        return 0.5; // Return consistent value for testing
      };

      const originalRequest = { url: '/jitter-test' };
      const rateLimitError = {
        response: { status: 429 },
        config: originalRequest,
      };

      const successResponse = { data: { result: 'success' } };
      mockAxiosInstance
        .mockImplementationOnce(() => Promise.reject(rateLimitError))
        .mockImplementationOnce(() => Promise.resolve(successResponse));

      const responseInterceptor =
        mockAxiosInstance.interceptors.response.use.mock.calls[0][1];

      const retryPromise = responseInterceptor(rateLimitError);

      // Verify jitter was applied (Math.random should have been called)
      expect(randomCallCount).toBeGreaterThan(0);

      await vi.advanceTimersByTimeAsync(2000);
      await retryPromise;

      // Restore original Math.random
      Math.random = originalRandom;
    });
  });

  describe('Request and Response Interceptors', () => {
    test('should add authorization header to requests when authenticated', () => {
      (apiClient as any).accessToken = 'test-access-token';

      const requestConfig = { headers: {} };
      const requestInterceptor =
        mockAxiosInstance.interceptors.request.use.mock.calls[0][0];

      const modifiedConfig = requestInterceptor(requestConfig);

      expect(modifiedConfig.headers.Authorization).toBe(
        'Bearer test-access-token'
      );
    });

    test('should not add authorization header when not authenticated', () => {
      (apiClient as any).accessToken = null;

      const requestConfig = { headers: {} };
      const requestInterceptor =
        mockAxiosInstance.interceptors.request.use.mock.calls[0][0];

      const modifiedConfig = requestInterceptor(requestConfig);

      expect(modifiedConfig.headers.Authorization).toBeUndefined();
    });

    test('should pass through successful responses', () => {
      const response = { data: { success: true }, status: 200 };
      const responseInterceptor =
        mockAxiosInstance.interceptors.response.use.mock.calls[0][0];

      const result = responseInterceptor(response);

      expect(result).toBe(response);
    });
  });

  describe('Data Extraction and Transformation', () => {
    test('should handle backend response with success wrapper', async () => {
      const mockResponse = {
        data: {
          success: true,
          data: { id: '1', name: 'Test' },
          message: 'Operation successful',
        },
      };

      mockAxiosInstance.get.mockResolvedValue(mockResponse);

      const result = await apiClient.getUserProfile();

      expect(result).toEqual({ id: '1', name: 'Test' });
    });

    test('should handle direct data response without wrapper', async () => {
      const mockResponse = {
        data: { id: '1', name: 'Direct' },
      };

      mockAxiosInstance.get.mockResolvedValue(mockResponse);

      const result = await apiClient.getUserProfile();

      expect(result).toEqual({ id: '1', name: 'Direct' });
    });

    test('should map backend field names to frontend expectations', async () => {
      const mockResponse = {
        data: {
          success: true,
          data: [
            {
              id: '1',
              title: 'Backend Title', // Maps to 'name'
              createdAt: '2024-01-01T00:00:00Z', // Maps to 'created_at'
              userId: 'user123', // Maps to 'user_id'
            },
          ],
          pagination: { total: 1, page: 1, totalPages: 1 },
        },
      };

      mockAxiosInstance.get.mockResolvedValue(mockResponse);

      const result = await apiClient.getProjects();

      expect(result.projects[0]).toMatchObject({
        id: '1',
        name: 'Backend Title',
        created_at: '2024-01-01T00:00:00Z',
        user_id: 'user123',
      });
    });

    test('should ensure absolute URLs for images', async () => {
      const mockResponse = {
        data: {
          success: true,
          data: {
            images: [
              {
                id: '1',
                name: 'test.jpg',
                projectId: 'proj1',
                userId: 'user1',
                originalUrl: '/uploads/relative.jpg', // Relative URL
                thumbnailUrl: '/thumbnails/thumb.jpg', // Relative URL
                createdAt: '2024-01-01T00:00:00Z',
                updatedAt: '2024-01-01T00:00:00Z',
              },
            ],
            pagination: { total: 1, page: 1, totalPages: 1 },
          },
        },
      };

      mockAxiosInstance.get.mockResolvedValue(mockResponse);

      const result = await apiClient.getProjectImages('proj1');

      expect(result.images[0].image_url).toBe(
        'http://localhost:3001/uploads/relative.jpg'
      );
      expect(result.images[0].thumbnail_url).toBe(
        'http://localhost:3001/thumbnails/thumb.jpg'
      );
    });

    test('should preserve absolute URLs', async () => {
      const mockResponse = {
        data: {
          success: true,
          data: {
            images: [
              {
                id: '1',
                name: 'test.jpg',
                projectId: 'proj1',
                userId: 'user1',
                originalUrl: 'https://cdn.example.com/image.jpg', // Already absolute
                thumbnailUrl: 'https://cdn.example.com/thumb.jpg', // Already absolute
                createdAt: '2024-01-01T00:00:00Z',
                updatedAt: '2024-01-01T00:00:00Z',
              },
            ],
            pagination: { total: 1, page: 1, totalPages: 1 },
          },
        },
      };

      mockAxiosInstance.get.mockResolvedValue(mockResponse);

      const result = await apiClient.getProjectImages('proj1');

      expect(result.images[0].image_url).toBe(
        'https://cdn.example.com/image.jpg'
      );
      expect(result.images[0].thumbnail_url).toBe(
        'https://cdn.example.com/thumb.jpg'
      );
    });
  });

  describe('Segmentation Status Mapping', () => {
    test('should map backend segmentation statuses correctly', async () => {
      const testCases = [
        { backend: 'no_segmentation', expected: 'pending' },
        { backend: 'queued', expected: 'pending' },
        { backend: 'segmented', expected: 'completed' },
        { backend: 'pending', expected: 'pending' },
        { backend: 'processing', expected: 'processing' },
        { backend: 'completed', expected: 'completed' },
        { backend: 'failed', expected: 'failed' },
        { backend: 'unknown_status', expected: 'failed' }, // Unknown maps to failed
        { backend: null, expected: 'failed' },
        { backend: undefined, expected: 'failed' },
      ];

      for (const { backend, expected } of testCases) {
        const mockResponse = {
          data: {
            success: true,
            data: {
              image: {
                id: '1',
                name: 'test.jpg',
                projectId: 'proj1',
                userId: 'user1',
                originalUrl: '/test.jpg',
                segmentationStatus: backend,
                createdAt: '2024-01-01T00:00:00Z',
                updatedAt: '2024-01-01T00:00:00Z',
              },
            },
          },
        };

        mockAxiosInstance.get.mockResolvedValue(mockResponse);

        const result = await apiClient.getImage('proj1', '1');
        expect(result.segmentation_status).toBe(expected);
      }
    });
  });

  describe('Complex Segmentation Data Handling', () => {
    test('should handle segmentation data with point format conversion', async () => {
      const mockResponse = {
        data: {
          success: true,
          data: {
            image: {
              id: '1',
              name: 'test.jpg',
              projectId: 'proj1',
              userId: 'user1',
              originalUrl: '/test.jpg',
              createdAt: '2024-01-01T00:00:00Z',
              updatedAt: '2024-01-01T00:00:00Z',
            },
            segmentation: {
              id: 'seg1',
              imageId: '1',
              polygons: [
                {
                  id: 'poly1',
                  points: [
                    [10, 20],
                    [30, 40],
                    [50, 60],
                  ], // Array format
                  type: 'external',
                  confidence: 0.95,
                },
                {
                  id: 'poly2',
                  points: [
                    { x: 100, y: 200 },
                    { x: 300, y: 400 },
                  ], // Object format
                  type: 'internal',
                },
              ],
              model: 'hrnet',
              threshold: 0.5,
              imageWidth: 800,
              imageHeight: 600,
            },
          },
        },
      };

      mockAxiosInstance.get.mockResolvedValue(mockResponse);

      const result = await apiClient.getImageWithSegmentation('1');

      expect(result.segmentation).toBeDefined();
      expect(result.segmentation!.polygons).toHaveLength(2);

      // First polygon should have converted points
      expect(result.segmentation!.polygons[0].points).toEqual([
        { x: 10, y: 20 },
        { x: 30, y: 40 },
        { x: 50, y: 60 },
      ]);

      // Second polygon should have preserved object format
      expect(result.segmentation!.polygons[1].points).toEqual([
        { x: 100, y: 200 },
        { x: 300, y: 400 },
      ]);
    });

    test('should filter out invalid polygons during conversion', async () => {
      const mockResponse = {
        data: {
          success: true,
          data: {
            image: {
              id: '1',
              name: 'test.jpg',
              projectId: 'proj1',
              userId: 'user1',
              originalUrl: '/test.jpg',
              createdAt: '2024-01-01T00:00:00Z',
              updatedAt: '2024-01-01T00:00:00Z',
            },
            segmentation: {
              polygons: [
                {
                  id: 'valid',
                  points: [
                    [0, 0],
                    [10, 0],
                    [5, 10],
                  ], // Valid triangle
                  type: 'external',
                },
                {
                  id: 'invalid-points',
                  points: [
                    [0, 0],
                    [10, 0],
                  ], // Only 2 points - insufficient
                  type: 'external',
                },
                {
                  id: 'no-points',
                  points: [], // No points
                  type: 'external',
                },
                null, // Null polygon
                {
                  id: 'invalid-structure',
                  // Missing points entirely
                  type: 'external',
                },
              ],
            },
          },
        },
      };

      mockAxiosInstance.get.mockResolvedValue(mockResponse);

      const result = await apiClient.getImageWithSegmentation('1');

      // Should only have the valid polygon
      expect(result.segmentation!.polygons).toHaveLength(1);
      expect(result.segmentation!.polygons[0].id).toBe('valid');
    });

    test('should handle malformed segmentation data gracefully', async () => {
      const mockResponse = {
        data: {
          success: true,
          data: {
            image: {
              id: '1',
              name: 'test.jpg',
              projectId: 'proj1',
              userId: 'user1',
              originalUrl: '/test.jpg',
              createdAt: '2024-01-01T00:00:00Z',
              updatedAt: '2024-01-01T00:00:00Z',
            },
            segmentation: null, // Null segmentation
          },
        },
      };

      const logger = require('@/lib/logger').logger;
      mockAxiosInstance.get.mockResolvedValue(mockResponse);

      const result = await apiClient.getImageWithSegmentation('1');

      expect(result.segmentation).toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(
        'Invalid segmentation data structure:',
        null
      );
    });
  });

  describe('Upload Progress and File Handling', () => {
    test('should handle upload progress events', async () => {
      const mockResponse = {
        data: {
          success: true,
          data: {
            images: [{ id: '1', name: 'uploaded.jpg' }],
            count: 1,
          },
        },
      };

      const progressCallback = vi.fn();

      mockAxiosInstance.post.mockImplementation((url, data, config) => {
        // Simulate progress events
        if (config?.onUploadProgress) {
          config.onUploadProgress({ loaded: 25, total: 100 });
          config.onUploadProgress({ loaded: 50, total: 100 });
          config.onUploadProgress({ loaded: 100, total: 100 });
        }
        return Promise.resolve(mockResponse);
      });

      const mockFile = new File(['test'], 'test.jpg', { type: 'image/jpeg' });

      await apiClient.uploadImages('project1', [mockFile], progressCallback);

      expect(progressCallback).toHaveBeenCalledWith(25);
      expect(progressCallback).toHaveBeenCalledWith(50);
      expect(progressCallback).toHaveBeenCalledWith(100);
    });

    test('should handle upload without progress callback', async () => {
      const mockResponse = {
        data: {
          data: {
            images: [{ id: '1', name: 'uploaded.jpg' }],
            count: 1,
          },
        },
      };

      mockAxiosInstance.post.mockResolvedValue(mockResponse);

      const mockFile = new File(['test'], 'test.jpg');

      const result = await apiClient.uploadImages('project1', [mockFile]);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('uploaded.jpg');
    });

    test('should validate avatar crop data', async () => {
      const invalidCropData = {
        x: -10, // Invalid negative x
        y: 5,
        width: 100,
        height: 100,
      };

      const mockFile = new File(['test'], 'avatar.jpg');

      await expect(
        apiClient.uploadAvatar(mockFile, invalidCropData)
      ).rejects.toThrow('Invalid crop position: x and y must be non-negative');
    });

    test('should validate avatar crop dimensions', async () => {
      const invalidCropData = {
        x: 10,
        y: 10,
        width: 0, // Invalid zero width
        height: 100,
      };

      const mockFile = new File(['test'], 'avatar.jpg');

      await expect(
        apiClient.uploadAvatar(mockFile, invalidCropData)
      ).rejects.toThrow(
        'Invalid crop dimensions: width and height must be positive'
      );
    });
  });

  describe('Queue Management and Batch Operations', () => {
    test('should handle batch queue operations', async () => {
      const mockResponse = {
        data: {
          success: true,
          data: {
            queuedCount: 3,
            queueItems: [
              { id: 'q1', imageId: 'img1', status: 'queued' },
              { id: 'q2', imageId: 'img2', status: 'queued' },
              { id: 'q3', imageId: 'img3', status: 'queued' },
            ],
            message: 'Batch queued successfully',
          },
        },
      };

      mockAxiosInstance.post.mockResolvedValue(mockResponse);

      const result = await apiClient.addBatchToQueue(
        ['img1', 'img2', 'img3'],
        'project1',
        'hrnet',
        0.5,
        1,
        false,
        true
      );

      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/queue/batch', {
        imageIds: ['img1', 'img2', 'img3'],
        projectId: 'project1',
        model: 'hrnet',
        threshold: 0.5,
        priority: 1,
        forceResegment: false,
        detectHoles: true,
      });

      expect(result.queuedCount).toBe(3);
      expect(result.queueItems).toHaveLength(3);
    });

    test('should handle batch deletion with partial failures', async () => {
      const mockResponse = {
        data: {
          success: true,
          data: {
            deletedCount: 2,
            failedIds: ['img3'],
            errors: ['Image img3 not found'],
          },
        },
      };

      mockAxiosInstance.delete.mockResolvedValue(mockResponse);

      const result = await apiClient.deleteBatch(
        ['img1', 'img2', 'img3'],
        'project1'
      );

      expect(result.deletedCount).toBe(2);
      expect(result.failedIds).toEqual(['img3']);
      expect(result.errors).toEqual(['Image img3 not found']);
    });
  });

  describe('Timeout and Long-Running Operations', () => {
    test('should use extended timeout for batch operations', async () => {
      const mockResponse = { data: { success: true } };
      mockAxiosInstance.post.mockResolvedValue(mockResponse);

      await apiClient.requestBatchSegmentation(['img1', 'img2']);

      // Verify axios instance was created with extended timeout
      expect(mockAxios.create).toHaveBeenCalledWith(
        expect.objectContaining({
          timeout: 120000, // 2 minutes
        })
      );
    });

    test('should use shorter timeout for file uploads', async () => {
      const mockResponse = {
        data: { data: { images: [], count: 0 } },
      };

      mockAxiosInstance.post.mockResolvedValue(mockResponse);

      const mockFile = new File(['test'], 'test.jpg');
      await apiClient.uploadImages('project1', [mockFile]);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(FormData),
        expect.objectContaining({
          timeout: 60000, // 1 minute
        })
      );
    });
  });

  describe('Edge Cases and Error Recovery', () => {
    test('should handle extremely malformed responses', async () => {
      const malformedResponses = [
        { data: null },
        { data: undefined },
        { data: 'not an object' },
        { data: 123 },
        { data: [] },
        {},
        null,
        undefined,
      ];

      for (const response of malformedResponses) {
        mockAxiosInstance.get.mockResolvedValueOnce(response);

        const result = await apiClient.getProjects();

        // Should return safe defaults
        expect(result).toMatchObject({
          projects: [],
          total: 0,
          page: 1,
          totalPages: 1,
        });
      }
    });

    test('should handle concurrent token refresh attempts', async () => {
      const unauthorizedError = {
        response: { status: 401 },
        config: { url: '/test1', headers: {} },
      };

      const refreshResponse = {
        data: { success: true, data: { accessToken: 'new-token' } },
      };

      (apiClient as any).accessToken = 'expired-token';
      (apiClient as any).refreshToken = 'valid-refresh-token';

      // Mock only one successful refresh
      mockAxiosInstance.post.mockResolvedValueOnce(refreshResponse);

      const responseInterceptor =
        mockAxiosInstance.interceptors.response.use.mock.calls[0][1];

      // Simulate concurrent requests hitting 401
      const promise1 = responseInterceptor(unauthorizedError);
      const promise2 = responseInterceptor({
        ...unauthorizedError,
        config: { url: '/test2', headers: {} },
      });

      await Promise.allSettled([promise1, promise2]);

      // Should only call refresh once even with concurrent requests
      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(1);
    });

    test('should handle very large segmentation datasets', async () => {
      // Generate large dataset
      const largePolygons = Array.from({ length: 1000 }, (_, i) => ({
        id: `poly_${i}`,
        points: Array.from({ length: 100 }, (_, j) => ({ x: j, y: j })),
        type: 'external',
      }));

      const largeResponse = {
        data: {
          success: true,
          data: {
            polygons: largePolygons,
            imageWidth: 4000,
            imageHeight: 3000,
          },
        },
      };

      mockAxiosInstance.get.mockResolvedValue(largeResponse);

      const result = await apiClient.getSegmentationResults('large-image');

      expect(result!.polygons).toHaveLength(1000);
      expect(result!.polygons[0].points).toHaveLength(100);
    });
  });
});
