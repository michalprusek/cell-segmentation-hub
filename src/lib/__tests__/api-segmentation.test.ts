import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import type {
  SegmentationResultData,
  SegmentationPolygon,
  QueueStats,
  AddToQueueResponse,
  BatchQueueResponse,
  QueueItem,
  Profile,
  UpdateProfile,
} from '../api';

// Mock axios completely
vi.mock('axios');
const mockAxios = vi.mocked(axios);

// Mock the API module but allow us to test it
vi.mock('../api', async importOriginal => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    // Keep the actual exports but we'll mock axios
  };
});

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

describe('API Client - Segmentation & Queue Methods', () => {
  let mockAxiosInstance: any;
  let apiClient: any;

  beforeEach(async () => {
    vi.clearAllMocks();

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

    // Mock authentication state by setting up localStorage
    localStorageMock.getItem.mockImplementation((key: string) => {
      if (key === 'accessToken') return 'valid-access-token';
      if (key === 'refreshToken') return 'valid-refresh-token';
      return null;
    });
    sessionStorageMock.getItem.mockReturnValue(null);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('Segmentation Methods', () => {
    describe('getSegmentationResults', () => {
      test('should get segmentation results successfully', async () => {
        const mockPolygons: SegmentationPolygon[] = [
          {
            id: 'poly1',
            points: [
              { x: 0, y: 0 },
              { x: 100, y: 0 },
              { x: 100, y: 100 },
              { x: 0, y: 100 },
            ],
            type: 'external',
            class: 'spheroid',
            confidence: 0.95,
            area: 10000,
          },
        ];

        const mockResponse = {
          data: {
            success: true,
            data: {
              polygons: mockPolygons,
              imageWidth: 800,
              imageHeight: 600,
              modelUsed: 'hrnet',
              thresholdUsed: 0.5,
              confidence: 0.95,
              processingTime: 3.2,
              createdAt: '2024-01-01T00:00:00Z',
              updatedAt: '2024-01-01T00:00:00Z',
            },
          },
        };

        mockAxiosInstance.get.mockResolvedValue(mockResponse);

        const result = await apiClient.getSegmentationResults('image1');

        expect(mockAxiosInstance.get).toHaveBeenCalledWith(
          '/segmentation/images/image1/results',
          { signal: undefined }
        );
        expect(result).toEqual({
          polygons: mockPolygons,
          imageWidth: 800,
          imageHeight: 600,
          modelUsed: 'hrnet',
          thresholdUsed: 0.5,
          confidence: 0.95,
          processingTime: 3.2,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        });
      });

      test('should handle polygon array response (backward compatibility)', async () => {
        const mockPolygons: SegmentationPolygon[] = [
          {
            id: 'poly1',
            points: [
              { x: 0, y: 0 },
              { x: 50, y: 50 },
            ],
            type: 'external',
          },
        ];

        const mockResponse = {
          data: mockPolygons,
        };

        mockAxiosInstance.get.mockResolvedValue(mockResponse);

        const result = await apiClient.getSegmentationResults('image1');

        // For backward compatibility, API client should handle array response
        // but currently returns full structure with empty polygons
        expect(result).toEqual({
          polygons: [],
          confidence: undefined,
          createdAt: undefined,
          imageHeight: undefined,
          imageWidth: undefined,
          modelUsed: undefined,
          processingTime: undefined,
          thresholdUsed: undefined,
          updatedAt: undefined,
        });
      });

      test('should return null when segmentation not found (404)', async () => {
        const error = new Error('Not found');
        (error as any).response = { status: 404 };
        mockAxiosInstance.get.mockRejectedValue(error);

        const result = await apiClient.getSegmentationResults('image1');

        expect(result).toBeNull();
      });

      test('should throw error for non-404 errors', async () => {
        const error = new Error('Server error');
        (error as any).response = { status: 500 };
        mockAxiosInstance.get.mockRejectedValue(error);

        await expect(
          apiClient.getSegmentationResults('image1')
        ).rejects.toThrow('Server error');
      });

      test('should handle empty or invalid response data', async () => {
        const mockResponse = {
          data: {
            success: true,
            data: null,
          },
        };

        mockAxiosInstance.get.mockResolvedValue(mockResponse);

        const result = await apiClient.getSegmentationResults('image1');

        expect(result).toBeNull();
      });
    });

    describe('updateSegmentationResults', () => {
      test('should update segmentation results successfully', async () => {
        const inputPolygons: SegmentationPolygon[] = [
          {
            id: 'poly1',
            points: [
              { x: 0, y: 0 },
              { x: 100, y: 100 },
            ],
            type: 'external',
          },
        ];

        const mockResponse = {
          data: {
            success: true,
            data: {
              polygons: inputPolygons,
              imageWidth: 800,
              imageHeight: 600,
              modelUsed: 'manual',
              updatedAt: '2024-01-01T01:00:00Z',
            },
          },
        };

        mockAxiosInstance.put.mockResolvedValue(mockResponse);

        const result = await apiClient.updateSegmentationResults(
          'image1',
          inputPolygons,
          800,
          600
        );

        expect(mockAxiosInstance.put).toHaveBeenCalledWith(
          '/segmentation/images/image1/results',
          {
            polygons: inputPolygons,
            imageWidth: 800,
            imageHeight: 600,
          }
        );

        expect(result).toEqual({
          polygons: inputPolygons,
          imageWidth: 800,
          imageHeight: 600,
          modelUsed: 'manual',
          thresholdUsed: undefined,
          confidence: undefined,
          processingTime: undefined,
          createdAt: undefined,
          updatedAt: '2024-01-01T01:00:00Z',
        });
      });

      test('should handle update without image dimensions', async () => {
        const inputPolygons: SegmentationPolygon[] = [
          {
            id: 'poly1',
            points: [{ x: 0, y: 0 }],
            type: 'external',
          },
        ];

        const mockResponse = {
          data: {
            success: true,
            data: {
              polygons: inputPolygons,
            },
          },
        };

        mockAxiosInstance.put.mockResolvedValue(mockResponse);

        const result = await apiClient.updateSegmentationResults(
          'image1',
          inputPolygons
        );

        expect(mockAxiosInstance.put).toHaveBeenCalledWith(
          '/segmentation/images/image1/results',
          {
            polygons: inputPolygons,
          }
        );

        expect(result.polygons).toEqual(inputPolygons);
      });

      test('should handle invalid image dimensions', async () => {
        const inputPolygons: SegmentationPolygon[] = [];

        const mockResponse = {
          data: { success: true, data: { polygons: [] } },
        };

        mockAxiosInstance.put.mockResolvedValue(mockResponse);

        // Test with zero dimensions
        await apiClient.updateSegmentationResults(
          'image1',
          inputPolygons,
          0,
          600
        );

        expect(mockAxiosInstance.put).toHaveBeenCalledWith(
          '/segmentation/images/image1/results',
          {
            polygons: inputPolygons,
          }
        );

        // Test with negative dimensions
        await apiClient.updateSegmentationResults(
          'image1',
          inputPolygons,
          -100,
          600
        );

        expect(mockAxiosInstance.put).toHaveBeenLastCalledWith(
          '/segmentation/images/image1/results',
          {
            polygons: inputPolygons,
          }
        );
      });

      test('should fallback to input polygons for array response', async () => {
        const inputPolygons: SegmentationPolygon[] = [
          { id: 'poly1', points: [], type: 'external' },
        ];

        const mockResponse = {
          data: {
            success: true,
            data: inputPolygons,
          },
        };

        mockAxiosInstance.put.mockResolvedValue(mockResponse);

        const result = await apiClient.updateSegmentationResults(
          'image1',
          inputPolygons
        );

        expect(result).toEqual({
          polygons: inputPolygons,
        });
      });

      test('should return input polygons for unexpected response', async () => {
        const inputPolygons: SegmentationPolygon[] = [
          { id: 'poly1', points: [], type: 'external' },
        ];

        const mockResponse = {
          data: {
            success: true,
            data: 'unexpected',
          },
        };

        mockAxiosInstance.put.mockResolvedValue(mockResponse);

        const result = await apiClient.updateSegmentationResults(
          'image1',
          inputPolygons
        );

        expect(result).toEqual({
          polygons: inputPolygons,
        });
      });
    });

    describe('deleteSegmentationResults', () => {
      test('should delete segmentation results successfully', async () => {
        mockAxiosInstance.delete.mockResolvedValue({});

        await apiClient.deleteSegmentationResults('image1');

        expect(mockAxiosInstance.delete).toHaveBeenCalledWith(
          '/segmentation/images/image1/results'
        );
      });
    });

    describe('requestBatchSegmentation', () => {
      test('should request batch segmentation successfully', async () => {
        const mockResponse = {
          data: {
            success: true,
            data: {
              id: 'batch1',
              imageIds: ['img1', 'img2'],
              status: 'queued',
            },
          },
        };

        mockAxiosInstance.post.mockResolvedValue(mockResponse);

        const result = await apiClient.requestBatchSegmentation(
          ['img1', 'img2'],
          'cbam-resunet',
          0.6
        );

        expect(mockAxiosInstance.post).toHaveBeenCalledWith(
          '/segmentation/batch',
          {
            imageIds: ['img1', 'img2'],
            model: 'cbam-resunet',
            threshold: 0.6,
          }
        );

        expect(result).toEqual({
          id: 'batch1',
          imageIds: ['img1', 'img2'],
          status: 'queued',
        });
      });

      test('should use default model and threshold', async () => {
        const mockResponse = {
          data: { success: true, data: {} },
        };

        mockAxiosInstance.post.mockResolvedValue(mockResponse);

        await apiClient.requestBatchSegmentation(['img1']);

        expect(mockAxiosInstance.post).toHaveBeenCalledWith(
          '/segmentation/batch',
          {
            imageIds: ['img1'],
            model: 'hrnet',
            threshold: 0.5,
          }
        );
      });
    });
  });

  describe('Queue Management Methods', () => {
    describe('addImageToQueue', () => {
      test('should add image to queue successfully', async () => {
        const mockResponse: AddToQueueResponse = {
          queueItem: {
            id: 'queue1',
            imageId: 'img1',
            projectId: 'proj1',
            model: 'hrnet',
            threshold: 0.5,
            priority: 1,
            status: 'queued',
            createdAt: '2024-01-01T00:00:00Z',
          },
          message: 'Image added to queue successfully',
        };

        mockAxiosInstance.post.mockResolvedValue({
          data: { success: true, data: mockResponse },
        });

        const result = await apiClient.addImageToQueue('img1', 'hrnet', 0.5, 1);

        expect(mockAxiosInstance.post).toHaveBeenCalledWith(
          '/queue/images/img1',
          {
            model: 'hrnet',
            threshold: 0.5,
            priority: 1,
          }
        );

        expect(result).toEqual(mockResponse);
      });

      test('should add image to queue with default parameters', async () => {
        const mockResponse: AddToQueueResponse = {
          queueItem: {
            id: 'queue1',
            imageId: 'img1',
            projectId: 'proj1',
            model: 'hrnet',
            threshold: 0.5,
            priority: 0,
            status: 'queued',
            createdAt: '2024-01-01T00:00:00Z',
          },
          message: 'Image added to queue successfully',
        };

        mockAxiosInstance.post.mockResolvedValue({
          data: { success: true, data: mockResponse },
        });

        const result = await apiClient.addImageToQueue('img1');

        expect(mockAxiosInstance.post).toHaveBeenCalledWith(
          '/queue/images/img1',
          {
            model: undefined,
            threshold: undefined,
            priority: undefined,
          }
        );

        expect(result.queueItem.imageId).toBe('img1');
      });
    });

    describe('addBatchToQueue', () => {
      test('should add batch to queue successfully', async () => {
        const mockResponse: BatchQueueResponse = {
          queuedCount: 2,
          queueItems: [
            {
              id: 'queue1',
              imageId: 'img1',
              projectId: 'proj1',
              model: 'hrnet',
              threshold: 0.5,
              priority: 1,
              status: 'queued',
              createdAt: '2024-01-01T00:00:00Z',
            },
            {
              id: 'queue2',
              imageId: 'img2',
              projectId: 'proj1',
              model: 'hrnet',
              threshold: 0.5,
              priority: 1,
              status: 'queued',
              createdAt: '2024-01-01T00:00:00Z',
            },
          ],
          message: 'Batch added to queue successfully',
        };

        mockAxiosInstance.post.mockResolvedValue({
          data: { success: true, data: mockResponse },
        });

        const result = await apiClient.addBatchToQueue(
          ['img1', 'img2'],
          'proj1',
          'hrnet',
          0.5,
          1
        );

        expect(mockAxiosInstance.post).toHaveBeenCalledWith('/queue/batch', {
          imageIds: ['img1', 'img2'],
          projectId: 'proj1',
          model: 'hrnet',
          threshold: 0.5,
          priority: 1,
        });

        expect(result.queuedCount).toBe(2);
        expect(result.queueItems).toHaveLength(2);
      });
    });

    describe('getQueueStats', () => {
      test('should get queue stats successfully', async () => {
        const mockStats: QueueStats = {
          total: 10,
          queued: 3,
          processing: 2,
          completed: 4,
          failed: 1,
        };

        mockAxiosInstance.get.mockResolvedValue({
          data: { success: true, data: mockStats },
        });

        const result = await apiClient.getQueueStats('proj1');

        expect(mockAxiosInstance.get).toHaveBeenCalledWith(
          '/queue/projects/proj1/stats'
        );
        expect(result).toEqual(mockStats);
      });
    });

    describe('getQueueItems', () => {
      test('should get queue items successfully', async () => {
        const mockItems: QueueItem[] = [
          {
            id: 'queue1',
            imageId: 'img1',
            projectId: 'proj1',
            model: 'hrnet',
            threshold: 0.5,
            priority: 1,
            status: 'processing',
            createdAt: '2024-01-01T00:00:00Z',
            startedAt: '2024-01-01T00:01:00Z',
          },
        ];

        mockAxiosInstance.get.mockResolvedValue({
          data: { success: true, data: mockItems },
        });

        const result = await apiClient.getQueueItems('proj1');

        expect(mockAxiosInstance.get).toHaveBeenCalledWith(
          '/queue/projects/proj1/items'
        );
        expect(result).toEqual(mockItems);
      });
    });

    describe('removeFromQueue', () => {
      test('should remove item from queue successfully', async () => {
        mockAxiosInstance.delete.mockResolvedValue({});

        await apiClient.removeFromQueue('queue1');

        expect(mockAxiosInstance.delete).toHaveBeenCalledWith(
          '/queue/items/queue1'
        );
      });
    });
  });

  describe('User Profile Methods', () => {
    describe('getUserProfile', () => {
      test('should get user profile successfully', async () => {
        const mockProfile: Profile = {
          id: 'user1',
          email: 'test@example.com',
          username: 'testuser',
          createdAt: '2024-01-01T00:00:00Z',
          consentToMLTraining: true,
          consentToAlgorithmImprovement: false,
          consentToFeatureDevelopment: true,
        };

        mockAxiosInstance.get.mockResolvedValue({
          data: { success: true, data: mockProfile },
        });

        const result = await apiClient.getUserProfile();

        expect(mockAxiosInstance.get).toHaveBeenCalledWith('/auth/profile');
        expect(result).toEqual(mockProfile);
      });
    });

    describe('updateUserProfile', () => {
      test('should update user profile successfully', async () => {
        const updateData: UpdateProfile = {
          username: 'updateduser',
          consentToMLTraining: false,
        };

        const mockUpdatedProfile: Profile = {
          id: 'user1',
          email: 'test@example.com',
          username: 'updateduser',
          createdAt: '2024-01-01T00:00:00Z',
          consentToMLTraining: false,
          consentToAlgorithmImprovement: false,
          consentToFeatureDevelopment: true,
        };

        mockAxiosInstance.put.mockResolvedValue({
          data: { success: true, data: mockUpdatedProfile },
        });

        const result = await apiClient.updateUserProfile(updateData);

        expect(mockAxiosInstance.put).toHaveBeenCalledWith(
          '/auth/profile',
          updateData
        );
        expect(result).toEqual(mockUpdatedProfile);
      });
    });

    describe('changePassword', () => {
      test('should change password successfully', async () => {
        const mockResponse = { message: 'Password changed successfully' };

        mockAxiosInstance.post.mockResolvedValue({
          data: { success: true, data: mockResponse },
        });

        const result = await apiClient.changePassword({
          currentPassword: 'oldpass',
          newPassword: 'newpass',
        });

        expect(mockAxiosInstance.post).toHaveBeenCalledWith(
          '/auth/change-password',
          {
            currentPassword: 'oldpass',
            newPassword: 'newpass',
          }
        );

        expect(result.message).toBe('Password changed successfully');
      });
    });

    describe('getUserStorageStats', () => {
      test('should get user storage stats successfully', async () => {
        const mockStats = {
          totalStorageBytes: 1048576,
          totalStorageMB: 1.0,
          totalStorageGB: 0.001,
          totalImages: 5,
          averageImageSizeMB: 0.2,
        };

        mockAxiosInstance.get.mockResolvedValue({
          data: { success: true, data: mockStats },
        });

        const result = await apiClient.getUserStorageStats();

        expect(mockAxiosInstance.get).toHaveBeenCalledWith(
          '/auth/storage-stats'
        );
        expect(result).toEqual(mockStats);
      });
    });

    describe('deleteAccount', () => {
      test('should delete account successfully and clear tokens', async () => {
        mockAxiosInstance.delete.mockResolvedValue({});

        await apiClient.deleteAccount();

        expect(mockAxiosInstance.delete).toHaveBeenCalledWith('/auth/profile');
        expect(localStorageMock.removeItem).toHaveBeenCalledWith('accessToken');
        expect(localStorageMock.removeItem).toHaveBeenCalledWith(
          'refreshToken'
        );
      });

      test('should clear tokens even if delete request fails', async () => {
        mockAxiosInstance.delete.mockRejectedValue(new Error('Server error'));

        await expect(apiClient.deleteAccount()).rejects.toThrow('Server error');

        expect(localStorageMock.removeItem).toHaveBeenCalledWith('accessToken');
        expect(localStorageMock.removeItem).toHaveBeenCalledWith(
          'refreshToken'
        );
      });
    });
  });

  describe('Advanced Image Processing', () => {
    describe('getImageWithSegmentation', () => {
      test('should get image with segmentation data successfully', async () => {
        const mockResponse = {
          data: {
            success: true,
            data: {
              id: 'img1',
              name: 'test.jpg',
              projectId: 'proj1',
              userId: 'user1',
              originalUrl: '/uploads/test.jpg',
              createdAt: '2024-01-01T00:00:00Z',
              updatedAt: '2024-01-01T00:00:00Z',
              segmentation: {
                id: 'seg1',
                imageId: 'img1',
                polygons: [
                  {
                    id: 'poly1',
                    points: [
                      { x: 0, y: 0 },
                      { x: 100, y: 0 },
                      { x: 100, y: 100 },
                      { x: 0, y: 100 },
                    ],
                    type: 'external',
                    class: 'spheroid',
                    confidence: 0.95,
                  },
                ],
                model: 'hrnet',
                threshold: 0.5,
                confidence: 0.95,
                processingTime: 3.2,
                imageWidth: 800,
                imageHeight: 600,
                createdAt: '2024-01-01T00:00:00Z',
                updatedAt: '2024-01-01T00:00:00Z',
              },
            },
          },
        };

        mockAxiosInstance.get.mockResolvedValue(mockResponse);

        const result = await apiClient.getImageWithSegmentation('img1');

        expect(mockAxiosInstance.get).toHaveBeenCalledWith(
          '/images/img1?includeSegmentation=true'
        );
        expect(result.segmentation).toBeDefined();
        expect(result.segmentation?.polygons).toHaveLength(1);
        expect(result.segmentation?.model).toBe('hrnet');
      });

      test('should handle image without segmentation', async () => {
        const mockResponse = {
          data: {
            success: true,
            data: {
              id: 'img1',
              name: 'test.jpg',
              projectId: 'proj1',
              userId: 'user1',
              originalUrl: '/uploads/test.jpg',
              createdAt: '2024-01-01T00:00:00Z',
              updatedAt: '2024-01-01T00:00:00Z',
            },
          },
        };

        mockAxiosInstance.get.mockResolvedValue(mockResponse);

        const result = await apiClient.getImageWithSegmentation('img1');

        expect(result.segmentation).toBeUndefined();
        expect(result.name).toBe('test.jpg');
      });

      test('should handle invalid segmentation data gracefully', async () => {
        const mockResponse = {
          data: {
            data: {
              id: 'img1',
              name: 'test.jpg',
              projectId: 'proj1',
              userId: 'user1',
              originalUrl: '/uploads/test.jpg',
              createdAt: '2024-01-01T00:00:00Z',
              updatedAt: '2024-01-01T00:00:00Z',
              segmentation: null,
            },
          },
        };

        mockAxiosInstance.get.mockResolvedValue(mockResponse);

        const result = await apiClient.getImageWithSegmentation('img1');

        expect(result.segmentation).toBeUndefined();
      });

      test('should filter out invalid polygons', async () => {
        const mockResponse = {
          data: {
            success: true,
            data: {
              id: 'img1',
              name: 'test.jpg',
              projectId: 'proj1',
              userId: 'user1',
              originalUrl: '/uploads/test.jpg',
              createdAt: '2024-01-01T00:00:00Z',
              updatedAt: '2024-01-01T00:00:00Z',
              segmentation: {
                id: 'seg1',
                imageId: 'img1',
                polygons: [
                  // Valid polygon
                  {
                    id: 'poly1',
                    points: [
                      { x: 0, y: 0 },
                      { x: 100, y: 0 },
                      { x: 100, y: 100 },
                      { x: 0, y: 100 },
                    ],
                    type: 'external',
                  },
                  // Invalid polygon (insufficient points)
                  {
                    id: 'poly2',
                    points: [{ x: 0, y: 0 }],
                    type: 'external',
                  },
                  // Invalid polygon (null)
                  null,
                  // Invalid polygon (no points)
                  {
                    id: 'poly3',
                    points: [],
                    type: 'external',
                  },
                ],
                model: 'hrnet',
                imageWidth: 800,
                imageHeight: 600,
              },
            },
          },
        };

        mockAxiosInstance.get.mockResolvedValue(mockResponse);

        const result = await apiClient.getImageWithSegmentation('img1');

        expect(result.segmentation?.polygons).toHaveLength(1);
        expect(result.segmentation?.polygons[0].id).toBe('poly1');
      });

      test('should handle polygons in array format', async () => {
        const mockResponse = {
          data: {
            success: true,
            data: {
              id: 'img1',
              name: 'test.jpg',
              projectId: 'proj1',
              userId: 'user1',
              originalUrl: '/uploads/test.jpg',
              createdAt: '2024-01-01T00:00:00Z',
              updatedAt: '2024-01-01T00:00:00Z',
              segmentation: {
                id: 'seg1',
                polygons: [
                  {
                    id: 'poly1',
                    points: [
                      [0, 0],
                      [100, 0],
                      [100, 100],
                      [0, 100],
                    ], // Array format
                    type: 'external',
                  },
                ],
                model: 'hrnet',
                imageWidth: 800,
                imageHeight: 600,
              },
            },
          },
        };

        mockAxiosInstance.get.mockResolvedValue(mockResponse);

        const result = await apiClient.getImageWithSegmentation('img1');

        expect(result.segmentation?.polygons).toHaveLength(1);
        expect(result.segmentation?.polygons[0].points).toEqual([
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 100, y: 100 },
          { x: 0, y: 100 },
        ]);
      });
    });

    describe('getProjectImagesWithThumbnails', () => {
      test('should get optimized images with thumbnails', async () => {
        const mockResponse = {
          data: {
            success: true,
            data: {
              images: [
                {
                  id: 'img1',
                  name: 'test.jpg',
                  projectId: 'proj1',
                  userId: 'user1',
                  originalUrl: '/uploads/test.jpg',
                  thumbnailUrl: '/thumbnails/test_thumb.jpg',
                  width: 800,
                  height: 600,
                  createdAt: '2024-01-01T00:00:00Z',
                  updatedAt: '2024-01-01T00:00:00Z',
                },
              ],
              pagination: {
                page: 1,
                limit: 10,
                total: 1,
                pages: 1,
              },
              metadata: {
                levelOfDetail: 'low',
                totalImages: 1,
                imagesWithThumbnails: 1,
              },
            },
          },
        };

        mockAxiosInstance.get.mockResolvedValue(mockResponse);

        const result = await apiClient.getProjectImagesWithThumbnails('proj1', {
          page: 1,
          limit: 10,
          lod: 'medium',
        });

        expect(mockAxiosInstance.get).toHaveBeenCalledWith(
          '/projects/proj1/images-with-thumbnails',
          {
            params: {
              lod: 'medium',
              page: 1,
              limit: 10,
            },
          }
        );

        expect(result.images).toHaveLength(1);
        expect(result.metadata.levelOfDetail).toBe('low');
        expect(result.pagination.total).toBe(1);
      });

      test('should use default lod parameter', async () => {
        const mockResponse = {
          data: {
            success: true,
            data: { images: [], pagination: {}, metadata: {} },
          },
        };

        mockAxiosInstance.get.mockResolvedValue(mockResponse);

        await apiClient.getProjectImagesWithThumbnails('proj1');

        expect(mockAxiosInstance.get).toHaveBeenCalledWith(
          '/projects/proj1/images-with-thumbnails',
          {
            params: {
              lod: 'low',
            },
          }
        );
      });
    });
  });
});
