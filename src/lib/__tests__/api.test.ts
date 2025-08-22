import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';

// Import types
import type {
  AuthResponse,
  Project,
  ProjectImage,
  SegmentationResult,
  SegmentationPolygon,
  SegmentationResultData,
  QueueItem,
  QueueStats,
  AddToQueueResponse,
  BatchQueueResponse,
} from '../api';

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

// Mock the API module but allow us to test it
vi.mock('@/lib/api', async importOriginal => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    // Keep the actual exports but we'll mock axios
  };
});

describe('API Client', () => {
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
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('Initial State', () => {
    test('should have correct initial authentication state', () => {
      expect(apiClient.isAuthenticated()).toBe(false);
      expect(apiClient.getAccessToken()).toBeNull();
    });

    test('should have axios instance configured', () => {
      expect((apiClient as any).instance).toBeDefined();
    });
  });

  describe('Authentication Methods', () => {
    describe('login', () => {
      test('should login successfully and store tokens', async () => {
        const mockResponse = {
          data: {
            success: true,
            data: {
              accessToken: 'new-access-token',
              refreshToken: 'new-refresh-token',
              user: {
                id: '1',
                email: 'test@example.com',
                username: 'testuser',
              },
            },
          },
        };

        mockAxiosInstance.post.mockResolvedValue(mockResponse);

        const result = await apiClient.login('test@example.com', 'password123');

        expect(mockAxiosInstance.post).toHaveBeenCalledWith('/auth/login', {
          email: 'test@example.com',
          password: 'password123',
          rememberMe: true,
        });

        expect(result).toEqual({
          accessToken: 'new-access-token',
          refreshToken: 'new-refresh-token',
          user: { id: '1', email: 'test@example.com', username: 'testuser' },
        });

        expect(localStorageMock.setItem).toHaveBeenCalledWith(
          'accessToken',
          'new-access-token'
        );
        expect(localStorageMock.setItem).toHaveBeenCalledWith(
          'refreshToken',
          'new-refresh-token'
        );
      });

      test('should handle remember me false and use sessionStorage', async () => {
        const mockResponse = {
          data: {
            success: true,
            data: {
              accessToken: 'access-token',
              refreshToken: 'refresh-token',
              user: { id: '1', email: 'test@example.com' },
            },
          },
        };

        mockAxiosInstance.post.mockResolvedValue(mockResponse);

        await apiClient.login('test@example.com', 'password123', false);

        expect(sessionStorageMock.setItem).toHaveBeenCalledWith(
          'accessToken',
          'access-token'
        );
        expect(sessionStorageMock.setItem).toHaveBeenCalledWith(
          'refreshToken',
          'refresh-token'
        );
      });

      test('should handle direct data response format', async () => {
        const mockResponse = {
          data: {
            accessToken: 'direct-access-token',
            refreshToken: 'direct-refresh-token',
            user: { id: '1', email: 'test@example.com' },
          },
        };

        mockAxiosInstance.post.mockResolvedValue(mockResponse);

        const result = await apiClient.login('test@example.com', 'password123');

        expect(result.accessToken).toBe('direct-access-token');
        expect(result.refreshToken).toBe('direct-refresh-token');
      });

      test('should handle login errors', async () => {
        const mockError = new Error('Invalid credentials');
        mockAxiosInstance.post.mockRejectedValue(mockError);

        await expect(
          apiClient.login('test@example.com', 'wrong')
        ).rejects.toThrow('Invalid credentials');
      });
    });

    describe('register', () => {
      test('should register successfully', async () => {
        const mockResponse = {
          data: {
            success: true,
            data: {
              accessToken: 'reg-access-token',
              refreshToken: 'reg-refresh-token',
              user: { id: '1', email: 'new@example.com', username: 'newuser' },
            },
          },
        };

        mockAxiosInstance.post.mockResolvedValue(mockResponse);

        const result = await apiClient.register(
          'new@example.com',
          'password123',
          'newuser',
          {
            consentToMLTraining: true,
            consentToAlgorithmImprovement: false,
            consentToFeatureDevelopment: true,
          }
        );

        expect(mockAxiosInstance.post).toHaveBeenCalledWith('/auth/register', {
          email: 'new@example.com',
          password: 'password123',
          username: 'newuser',
          consentToMLTraining: true,
          consentToAlgorithmImprovement: false,
          consentToFeatureDevelopment: true,
        });

        expect(result).toEqual({
          accessToken: 'reg-access-token',
          refreshToken: 'reg-refresh-token',
          user: { id: '1', email: 'new@example.com', username: 'newuser' },
        });
      });

      test('should register without optional parameters', async () => {
        const mockResponse = {
          data: {
            data: {
              accessToken: 'access-token',
              refreshToken: 'refresh-token',
              user: { id: '1', email: 'simple@example.com' },
            },
          },
        };

        mockAxiosInstance.post.mockResolvedValue(mockResponse);

        await apiClient.register('simple@example.com', 'password123');

        expect(mockAxiosInstance.post).toHaveBeenCalledWith('/auth/register', {
          email: 'simple@example.com',
          password: 'password123',
          username: undefined,
        });
      });
    });

    describe('logout', () => {
      test('should logout and clear tokens', async () => {
        mockAxiosInstance.post.mockResolvedValue({});

        // Set up client with tokens
        (apiClient as any).refreshToken = 'test-refresh-token';

        await apiClient.logout();

        expect(mockAxiosInstance.post).toHaveBeenCalledWith('/auth/logout', {
          refreshToken: 'test-refresh-token',
        });

        expect(localStorageMock.removeItem).toHaveBeenCalledWith('accessToken');
        expect(localStorageMock.removeItem).toHaveBeenCalledWith(
          'refreshToken'
        );
        expect(sessionStorageMock.removeItem).toHaveBeenCalledWith(
          'accessToken'
        );
        expect(sessionStorageMock.removeItem).toHaveBeenCalledWith(
          'refreshToken'
        );
      });

      test('should clear tokens even if logout request fails', async () => {
        mockAxiosInstance.post.mockRejectedValue(new Error('Network error'));

        (apiClient as any).refreshToken = 'test-refresh-token';

        await apiClient.logout();

        expect(localStorageMock.removeItem).toHaveBeenCalledWith('accessToken');
        expect(localStorageMock.removeItem).toHaveBeenCalledWith(
          'refreshToken'
        );
      });

      test('should handle logout without refresh token', async () => {
        (apiClient as any).refreshToken = null;

        await apiClient.logout();

        expect(mockAxiosInstance.post).not.toHaveBeenCalled();
        expect(localStorageMock.removeItem).toHaveBeenCalled();
      });
    });

    describe('refreshAccessToken', () => {
      test('should refresh access token successfully', async () => {
        const mockResponse = {
          data: {
            success: true,
            data: { accessToken: 'new-access-token' },
          },
        };

        mockAxiosInstance.post.mockResolvedValue(mockResponse);
        (apiClient as any).refreshToken = 'valid-refresh-token';

        await apiClient.refreshAccessToken();

        expect(mockAxiosInstance.post).toHaveBeenCalledWith('/auth/refresh', {
          refreshToken: 'valid-refresh-token',
        });
      });

      test('should throw error when no refresh token available', async () => {
        (apiClient as any).refreshToken = null;

        await expect(apiClient.refreshAccessToken()).rejects.toThrow(
          'No refresh token available'
        );
      });

      test('should handle refresh token failure', async () => {
        mockAxiosInstance.post.mockRejectedValue(
          new Error('Invalid refresh token')
        );
        (apiClient as any).refreshToken = 'invalid-refresh-token';

        await expect(apiClient.refreshAccessToken()).rejects.toThrow(
          'Invalid refresh token'
        );
      });
    });
  });

  describe('Project Methods', () => {
    beforeEach(() => {
      (apiClient as any).accessToken = 'valid-access-token';
    });

    describe('getProjects', () => {
      test('should get projects successfully', async () => {
        const mockResponse = {
          data: {
            success: true,
            data: [
              {
                id: '1',
                title: 'Project 1', // Backend uses title
                description: 'Test project',
                createdAt: '2024-01-01T00:00:00Z',
                updatedAt: '2024-01-01T00:00:00Z',
                userId: 'user1',
                _count: { images: 5 },
              },
            ],
            pagination: {
              total: 1,
              page: 1,
              totalPages: 1,
            },
          },
        };

        mockAxiosInstance.get.mockResolvedValue(mockResponse);

        const result = await apiClient.getProjects({ page: 1, limit: 10 });

        expect(mockAxiosInstance.get).toHaveBeenCalledWith('/projects', {
          params: { page: 1, limit: 10 },
        });

        expect(result).toEqual({
          projects: [
            {
              id: '1',
              name: 'Project 1', // Mapped from title to name
              description: 'Test project',
              created_at: '2024-01-01T00:00:00Z',
              updated_at: '2024-01-01T00:00:00Z',
              user_id: 'user1',
              image_count: 5,
            },
          ],
          total: 1,
          page: 1,
          totalPages: 1,
        });
      });

      test('should handle fallback response format', async () => {
        const mockResponse = {
          data: {
            projects: [
              {
                id: '1',
                name: 'Direct Project',
                created_at: '2024-01-01T00:00:00Z',
                updated_at: '2024-01-01T00:00:00Z',
                user_id: 'user1',
              },
            ],
            total: 1,
          },
        };

        mockAxiosInstance.get.mockResolvedValue(mockResponse);

        const result = await apiClient.getProjects();

        expect(result.projects).toHaveLength(1);
        expect(result.projects[0].name).toBe('Direct Project');
      });
    });

    describe('createProject', () => {
      test('should create project successfully', async () => {
        const mockResponse = {
          data: {
            success: true,
            data: {
              id: '1',
              title: 'New Project',
              description: 'Test description',
              createdAt: '2024-01-01T00:00:00Z',
              updatedAt: '2024-01-01T00:00:00Z',
              userId: 'user1',
            },
          },
        };

        mockAxiosInstance.post.mockResolvedValue(mockResponse);

        const result = await apiClient.createProject({
          name: 'New Project',
          description: 'Test description',
        });

        expect(mockAxiosInstance.post).toHaveBeenCalledWith('/projects', {
          title: 'New Project', // Converted to title for backend
          description: 'Test description',
        });

        expect(result.name).toBe('New Project');
        expect(result.description).toBe('Test description');
      });

      test('should create project without description', async () => {
        const mockResponse = {
          data: {
            success: true,
            data: {
              id: '1',
              title: 'Simple Project',
              createdAt: '2024-01-01T00:00:00Z',
              updatedAt: '2024-01-01T00:00:00Z',
              userId: 'user1',
            },
          },
        };

        mockAxiosInstance.post.mockResolvedValue(mockResponse);

        const result = await apiClient.createProject({
          name: 'Simple Project',
        });

        expect(result.name).toBe('Simple Project');
        expect(result.description).toBeUndefined();
      });
    });

    describe('updateProject', () => {
      test('should update project successfully', async () => {
        const mockResponse = {
          data: {
            success: true,
            data: {
              id: '1',
              title: 'Updated Project',
              description: 'Updated description',
              createdAt: '2024-01-01T00:00:00Z',
              updatedAt: '2024-01-01T01:00:00Z',
              userId: 'user1',
            },
          },
        };

        mockAxiosInstance.put.mockResolvedValue(mockResponse);

        const result = await apiClient.updateProject('1', {
          name: 'Updated Project',
          description: 'Updated description',
        });

        expect(mockAxiosInstance.put).toHaveBeenCalledWith('/projects/1', {
          name: undefined, // Remove name to avoid backend confusion
          description: 'Updated description',
          title: 'Updated Project', // Converted to title
        });

        expect(result.name).toBe('Updated Project');
      });
    });

    describe('getProject', () => {
      test('should get single project successfully', async () => {
        const mockResponse = {
          data: {
            success: true,
            data: {
              id: '1',
              title: 'Single Project',
              createdAt: '2024-01-01T00:00:00Z',
              updatedAt: '2024-01-01T00:00:00Z',
              userId: 'user1',
            },
          },
        };

        mockAxiosInstance.get.mockResolvedValue(mockResponse);

        const result = await apiClient.getProject('1');

        expect(mockAxiosInstance.get).toHaveBeenCalledWith('/projects/1');
        expect(result.name).toBe('Single Project');
      });
    });

    describe('deleteProject', () => {
      test('should delete project successfully', async () => {
        mockAxiosInstance.delete.mockResolvedValue({});

        await apiClient.deleteProject('1');

        expect(mockAxiosInstance.delete).toHaveBeenCalledWith('/projects/1');
      });
    });
  });

  describe('Image Methods', () => {
    beforeEach(() => {
      (apiClient as any).accessToken = 'valid-access-token';
    });

    describe('getProjectImages', () => {
      test('should get project images successfully', async () => {
        const mockResponse = {
          data: {
            success: true,
            data: {
              images: [
                {
                  id: '1',
                  name: 'test.jpg',
                  projectId: 'project1',
                  userId: 'user1',
                  originalUrl: '/uploads/image1.jpg',
                  thumbnailUrl: '/thumbnails/image1_thumb.jpg',
                  width: 800,
                  height: 600,
                  segmentationStatus: 'completed',
                  createdAt: '2024-01-01T00:00:00Z',
                  updatedAt: '2024-01-01T00:00:00Z',
                },
              ],
              pagination: {
                total: 1,
                page: 1,
                totalPages: 1,
              },
            },
          },
        };

        mockAxiosInstance.get.mockResolvedValue(mockResponse);

        const result = await apiClient.getProjectImages('project1', {
          page: 1,
          limit: 10,
        });

        expect(mockAxiosInstance.get).toHaveBeenCalledWith(
          '/projects/project1/images',
          {
            params: { page: 1, limit: 10 },
          }
        );

        expect(result.images).toHaveLength(1);
        expect(result.images[0]).toMatchObject({
          id: '1',
          name: 'test.jpg',
          project_id: 'project1',
          user_id: 'user1',
          segmentation_status: 'completed',
        });
      });

      test('should handle empty images response', async () => {
        const mockResponse = {
          data: {
            data: {
              images: null,
              pagination: {
                total: 0,
                page: 1,
                totalPages: 1,
              },
            },
          },
        };

        mockAxiosInstance.get.mockResolvedValue(mockResponse);

        const result = await apiClient.getProjectImages('project1');

        expect(result).toEqual({
          images: [],
          total: 0,
          page: 1,
          totalPages: 1,
        });
      });
    });

    describe('uploadImages', () => {
      test('should upload images successfully', async () => {
        const mockResponse = {
          data: {
            success: true,
            data: {
              images: [
                {
                  id: '1',
                  name: 'uploaded.jpg',
                  projectId: 'project1',
                  userId: 'user1',
                  originalUrl: '/uploads/uploaded.jpg',
                  createdAt: '2024-01-01T00:00:00Z',
                  updatedAt: '2024-01-01T00:00:00Z',
                },
              ],
              count: 1,
            },
          },
        };

        mockAxiosInstance.post.mockResolvedValue(mockResponse);

        const mockFile = new File(['test'], 'test.jpg', { type: 'image/jpeg' });
        const mockProgressCallback = vi.fn();

        const result = await apiClient.uploadImages(
          'project1',
          [mockFile],
          mockProgressCallback
        );

        expect(mockAxiosInstance.post).toHaveBeenCalledWith(
          '/projects/project1/images',
          expect.any(FormData),
          expect.objectContaining({
            headers: { 'Content-Type': 'multipart/form-data' },
            timeout: 60000,
            onUploadProgress: expect.any(Function),
          })
        );

        expect(result).toHaveLength(1);
        expect(result[0].name).toBe('uploaded.jpg');
      });

      test('should handle upload progress callback', async () => {
        const mockResponse = { data: { data: { images: [], count: 0 } } };
        mockAxiosInstance.post.mockImplementation((url, data, config) => {
          // Simulate progress event
          if (config?.onUploadProgress) {
            config.onUploadProgress({ loaded: 50, total: 100 });
          }
          return Promise.resolve(mockResponse);
        });

        const mockFile = new File(['test'], 'test.jpg');
        const mockProgressCallback = vi.fn();

        await apiClient.uploadImages(
          'project1',
          [mockFile],
          mockProgressCallback
        );

        expect(mockProgressCallback).toHaveBeenCalledWith(50);
      });
    });

    describe('getImage', () => {
      test('should get single image successfully', async () => {
        const mockResponse = {
          data: {
            success: true,
            data: {
              image: {
                id: '1',
                name: 'single.jpg',
                projectId: 'project1',
                userId: 'user1',
                originalUrl: '/uploads/single.jpg',
                createdAt: '2024-01-01T00:00:00Z',
                updatedAt: '2024-01-01T00:00:00Z',
              },
            },
          },
        };

        mockAxiosInstance.get.mockResolvedValue(mockResponse);

        const result = await apiClient.getImage('project1', '1');

        expect(mockAxiosInstance.get).toHaveBeenCalledWith(
          '/projects/project1/images/1'
        );
        expect(result.name).toBe('single.jpg');
      });

      test('should handle direct image data response', async () => {
        const mockResponse = {
          data: {
            success: true,
            data: {
              id: '1',
              name: 'direct.jpg',
              projectId: 'project1',
              userId: 'user1',
              originalUrl: '/uploads/direct.jpg',
              createdAt: '2024-01-01T00:00:00Z',
              updatedAt: '2024-01-01T00:00:00Z',
            },
          },
        };

        mockAxiosInstance.get.mockResolvedValue(mockResponse);

        const result = await apiClient.getImage('project1', '1');

        expect(result.name).toBe('direct.jpg');
      });
    });

    describe('deleteImage', () => {
      test('should delete image successfully', async () => {
        mockAxiosInstance.delete.mockResolvedValue({});

        await apiClient.deleteImage('project1', '1');

        expect(mockAxiosInstance.delete).toHaveBeenCalledWith(
          '/projects/project1/images/1'
        );
      });
    });
  });

  describe('Utility Methods', () => {
    test('isAuthenticated should return true when access token exists', () => {
      (apiClient as any).accessToken = 'valid-token';

      expect(apiClient.isAuthenticated()).toBe(true);
    });

    test('isAuthenticated should return false when no access token', () => {
      (apiClient as any).accessToken = null;

      expect(apiClient.isAuthenticated()).toBe(false);
    });

    test('getAccessToken should return current access token', () => {
      (apiClient as any).accessToken = 'current-token';

      expect(apiClient.getAccessToken()).toBe('current-token');
    });

    test('getAccessToken should return null when no token', () => {
      (apiClient as any).accessToken = null;

      expect(apiClient.getAccessToken()).toBeNull();
    });
  });

  describe('Generic HTTP Methods', () => {
    beforeEach(() => {
      (apiClient as any).accessToken = 'valid-access-token';
    });

    test('should call post method correctly', async () => {
      const mockResponse = { data: { result: 'success' } };
      mockAxiosInstance.post.mockResolvedValue(mockResponse);

      const result = await apiClient.post('/test', { data: 'test' });

      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        '/test',
        { data: 'test' },
        undefined
      );
      expect(result).toEqual(mockResponse);
    });

    test('should call get method correctly', async () => {
      const mockResponse = { data: { result: 'success' } };
      mockAxiosInstance.get.mockResolvedValue(mockResponse);

      const result = await apiClient.get('/test', { params: { id: 1 } });

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/test', {
        params: { id: 1 },
      });
      expect(result).toEqual(mockResponse);
    });

    test('should call put method correctly', async () => {
      const mockResponse = { data: { result: 'updated' } };
      mockAxiosInstance.put.mockResolvedValue(mockResponse);

      const result = await apiClient.put('/test', { data: 'updated' });

      expect(mockAxiosInstance.put).toHaveBeenCalledWith(
        '/test',
        { data: 'updated' },
        undefined
      );
      expect(result).toEqual(mockResponse);
    });

    test('should call delete method correctly', async () => {
      const mockResponse = { data: { result: 'deleted' } };
      mockAxiosInstance.delete.mockResolvedValue(mockResponse);

      const result = await apiClient.delete('/test');

      expect(mockAxiosInstance.delete).toHaveBeenCalledWith('/test', undefined);
      expect(result).toEqual(mockResponse);
    });
  });

  describe('Error Handling and Edge Cases', () => {
    test('should handle network errors gracefully', async () => {
      const networkError = new Error('Network Error');
      mockAxiosInstance.get.mockRejectedValue(networkError);

      await expect(apiClient.getProjects()).rejects.toThrow('Network Error');
    });

    test('should handle malformed response data', async () => {
      const malformedResponse = {
        data: null,
      };
      mockAxiosInstance.get.mockResolvedValue(malformedResponse);

      const result = await apiClient.getProjects();

      // Should return safe defaults
      expect(result).toMatchObject({
        projects: [],
        total: 0,
        page: 1,
        totalPages: 1,
      });
    });

    test('should handle undefined response data', async () => {
      const undefinedResponse = {
        data: undefined,
      };
      mockAxiosInstance.get.mockResolvedValue(undefinedResponse);

      const result = await apiClient.getProjects();

      expect(result).toMatchObject({
        projects: [],
        total: 0,
        page: 1,
        totalPages: 1,
      });
    });
  });

  describe('Field Mapping', () => {
    test('should map backend project fields to frontend format', async () => {
      const mockResponse = {
        data: {
          success: true,
          data: [
            {
              id: '1',
              title: 'Backend Title',
              description: 'Backend Description',
              createdAt: '2024-01-01T00:00:00Z',
              updatedAt: '2024-01-01T01:00:00Z',
              userId: 'backend-user-id',
              imageCount: 10,
            },
          ],
          pagination: { total: 1, page: 1, totalPages: 1 },
        },
      };

      mockAxiosInstance.get.mockResolvedValue(mockResponse);

      const result = await apiClient.getProjects();

      expect(result.projects[0]).toMatchObject({
        id: '1',
        name: 'Backend Title', // title -> name
        description: 'Backend Description',
        created_at: '2024-01-01T00:00:00Z', // createdAt -> created_at
        updated_at: '2024-01-01T01:00:00Z', // updatedAt -> updated_at
        user_id: 'backend-user-id', // userId -> user_id
        image_count: 10, // imageCount -> image_count
      });
    });

    test('should map backend image fields to frontend format', async () => {
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
                originalUrl: 'http://backend/image.jpg',
                thumbnailUrl: 'http://backend/thumb.jpg',
                width: 800,
                height: 600,
                segmentationStatus: 'no_segmentation',
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

      expect(result.images[0]).toMatchObject({
        id: '1',
        name: 'test.jpg',
        project_id: 'proj1', // projectId -> project_id
        user_id: 'user1', // userId -> user_id
        image_url: 'http://backend/image.jpg', // originalUrl -> image_url
        thumbnail_url: 'http://backend/thumb.jpg', // thumbnailUrl -> thumbnail_url
        segmentation_status: 'pending', // no_segmentation -> pending
        created_at: '2024-01-01T00:00:00Z', // createdAt -> created_at
        updated_at: '2024-01-01T00:00:00Z', // updatedAt -> updated_at
      });
    });

    test('should map segmentation status values correctly through getImage', async () => {
      // Test segmentation status mapping by verifying the mapped results through public API
      const testCases = [
        { input: 'no_segmentation', expected: 'pending' },
        { input: 'queued', expected: 'pending' },
        { input: 'segmented', expected: 'completed' },
        { input: 'completed', expected: 'completed' },
      ];

      for (const { input, expected } of testCases) {
        const mockImage = {
          id: '1',
          name: 'test.jpg',
          projectId: 'proj1',
          userId: 'user1',
          originalUrl: '/test.jpg',
          segmentationStatus: input,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        };

        mockAxiosInstance.get.mockResolvedValue({
          data: {
            success: true,
            data: { image: mockImage },
          },
        });

        const result = await apiClient.getImage('proj1', '1');
        expect(result.segmentation_status).toBe(expected);
      }
    });
  });
});
