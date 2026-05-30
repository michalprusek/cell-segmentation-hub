import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { apiClient } from '@/lib/api';

// ===== MOCK SETUP =====
// Use vi.hoisted so mockAxiosInstance is available inside vi.mock('axios') factory
const mockAxiosInstance = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
  patch: vi.fn(),
  interceptors: {
    request: { use: vi.fn() },
    response: { use: vi.fn() },
  },
}));

// Mock axios so ApiClient uses our mock instance
vi.mock('axios', () => ({
  default: {
    create: vi.fn(() => mockAxiosInstance),
  },
}));

// Override the global setup.ts mock for @/lib/api so we get the real singleton
vi.mock('@/lib/api', async importOriginal => {
  const actual = (await importOriginal()) as any;
  return { ...actual };
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
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('API Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Point singleton's axios instance to our mock
    (apiClient as any).instance = mockAxiosInstance;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Authentication Flow', () => {
    it('should handle complete login flow', async () => {
      const loginData = {
        email: 'test@example.com',
        password: 'password123',
      };

      const response = {
        user: {
          id: '1',
          email: 'test@example.com',
          name: 'Test User',
        },
        accessToken: 'access-token-123',
        refreshToken: 'refresh-token-123',
      };

      mockAxiosInstance.post.mockResolvedValue({
        data: { success: true, data: response },
      });

      const result = await apiClient.login(loginData.email, loginData.password);

      // login() always includes rememberMe (default true)
      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/auth/login', {
        ...loginData,
        rememberMe: true,
      });
      // Tokens are set as httpOnly cookies server-side; only the user is returned.
      expect(result).toEqual({ user: response.user });
    });

    it('should handle registration with validation', async () => {
      // register(email, password, username?, consentOptions?)
      const email = 'newuser@example.com';
      const password = 'SecurePass123!';
      const username = 'newuser';

      const response = {
        user: {
          id: '2',
          email,
          name: username,
        },
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
      };

      mockAxiosInstance.post.mockResolvedValue({
        data: { success: true, data: response },
      });

      const result = await apiClient.register(email, password, username);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/auth/register', {
        email,
        password,
        username,
      });
      // Tokens are set as httpOnly cookies server-side; only the user is returned.
      expect(result).toEqual({ user: response.user });
    });

    it('should handle login errors gracefully', async () => {
      const error = new Error('Invalid credentials');
      (error as any).response = {
        status: 401,
        data: { error: 'Invalid credentials' },
      };
      mockAxiosInstance.post.mockRejectedValue(error);

      await expect(
        apiClient.login('wrong@example.com', 'wrongpass')
      ).rejects.toThrow();
    });

    it('should handle network errors', async () => {
      const networkError = new Error('Network Error');
      mockAxiosInstance.post.mockRejectedValue(networkError);

      await expect(
        apiClient.login('test@example.com', 'password')
      ).rejects.toThrow();
    });

    it('should handle timeout errors', async () => {
      const timeoutError = new Error('timeout of 30000ms exceeded');
      (timeoutError as any).code = 'ECONNABORTED';
      mockAxiosInstance.post.mockRejectedValue(timeoutError);

      await expect(
        apiClient.login('test@example.com', 'password')
      ).rejects.toThrow();
    });
  });

  describe('Project Management', () => {
    beforeEach(() => {
      // Auth is via httpOnly cookies — no client-side token fields to set.
    });

    it('should fetch projects list', async () => {
      const projects = [
        { id: '1', title: 'Project 1', description: 'Test project 1' },
        { id: '2', title: 'Project 2', description: 'Test project 2' },
      ];

      mockAxiosInstance.get.mockResolvedValue({
        data: {
          success: true,
          data: { projects, total: 2, page: 1, totalPages: 1 },
        },
      });

      const result = await apiClient.getProjects();

      // getProjects() with no args passes params: undefined
      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/projects', {
        params: undefined,
      });
      expect(result.projects).toHaveLength(2);
      expect(result.total).toBe(2);
    });

    it('should create a new project', async () => {
      const newProject = {
        name: 'New Project',
        description: 'A new test project',
      };

      const response = {
        id: '3',
        title: newProject.name,
        description: newProject.description,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        userId: 'user-1',
      };

      mockAxiosInstance.post.mockResolvedValue({
        data: { success: true, data: response },
      });

      const result = await apiClient.createProject(newProject);

      // createProject converts 'name' -> 'title' to match backend schema
      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/projects', {
        title: newProject.name,
        description: newProject.description,
      });
      expect(result).toMatchObject({
        id: '3',
        name: 'New Project',
      });
    });

    it('should update an existing project', async () => {
      const projectId = '1';
      const updates = {
        name: 'Updated Project Name',
        description: 'Updated description',
      };

      const response = {
        id: projectId,
        title: updates.name,
        description: updates.description,
        updatedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        userId: 'user-1',
      };

      mockAxiosInstance.put.mockResolvedValue({
        data: { success: true, data: response },
      });

      const result = await apiClient.updateProject(projectId, updates);

      // updateProject converts 'name' -> 'title' and removes 'name' from the request
      expect(mockAxiosInstance.put).toHaveBeenCalledWith(
        `/projects/${projectId}`,
        {
          name: undefined,
          description: updates.description,
          title: updates.name,
        }
      );
      expect(result).toMatchObject({
        id: projectId,
        name: 'Updated Project Name',
      });
    });

    it('should delete a project', async () => {
      const projectId = '1';

      mockAxiosInstance.delete.mockResolvedValue({
        data: { success: true },
      });

      await expect(apiClient.deleteProject(projectId)).resolves.toBeUndefined();
      expect(mockAxiosInstance.delete).toHaveBeenCalledWith(
        `/projects/${projectId}`
      );
    });

    it('should handle unauthorized access', async () => {
      const error = new Error('Unauthorized');
      (error as any).response = {
        status: 401,
        data: { error: 'Unauthorized' },
      };
      mockAxiosInstance.get.mockRejectedValue(error);

      await expect(apiClient.getProjects()).rejects.toThrow();
    });
  });

  describe('Image Upload', () => {
    beforeEach(() => {
      // Auth is via httpOnly cookies — no client-side token fields to set.
    });

    it('should upload an image successfully', async () => {
      const projectId = '1';
      const file = new File(['image content'], 'test.jpg', {
        type: 'image/jpeg',
      });

      const response = {
        images: [
          {
            id: 'img-1',
            file_name: 'test.jpg',
            url: '/uploads/test.jpg',
            projectId,
            userId: 'user-1',
            segmentationStatus: 'pending',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
        count: 1,
      };

      mockAxiosInstance.post.mockResolvedValue({
        data: { success: true, data: response },
      });

      const result = await apiClient.uploadImages(projectId, [file]);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        `/projects/${projectId}/images`,
        expect.any(FormData),
        expect.objectContaining({
          headers: { 'Content-Type': 'multipart/form-data' },
          timeout: 300000,
        })
      );
      expect(result).toHaveLength(1);
    });

    it('should handle upload progress', async () => {
      const projectId = '1';
      const file = new File(['image content'], 'test.jpg', {
        type: 'image/jpeg',
      });
      const progressCallback = vi.fn();

      mockAxiosInstance.post.mockImplementation((_url, _data, config) => {
        // Simulate progress event
        if (config?.onUploadProgress) {
          config.onUploadProgress({ loaded: 50, total: 100 });
        }
        return Promise.resolve({
          data: {
            success: true,
            data: {
              images: [{ id: 'img-1', file_name: 'test.jpg' }],
              count: 1,
            },
          },
        });
      });

      await apiClient.uploadImages(projectId, [file], progressCallback);

      // Progress callback should have been called with ~50%
      expect(progressCallback).toHaveBeenCalledWith(50);
    });

    it('should handle large file rejection', async () => {
      const projectId = '1';
      const largeFile = new File(['x'.repeat(1024)], 'large.jpg', {
        type: 'image/jpeg',
      });

      const error = new Error('Payload Too Large');
      (error as any).response = {
        status: 413,
        data: { error: 'File too large' },
      };
      mockAxiosInstance.post.mockRejectedValue(error);

      await expect(
        apiClient.uploadImages(projectId, [largeFile])
      ).rejects.toThrow();
    });
  });

  describe('Segmentation', () => {
    beforeEach(() => {
      // Auth is via httpOnly cookies — no client-side token fields to set.
    });

    it('should request batch segmentation', async () => {
      // requestBatchSegmentation(imageIds, model?, threshold?, detectHoles?)
      const imageIds = ['img-1', 'img-2'];

      const response = {
        batchId: 'batch-1',
        queued: 2,
        message: 'Segmentation queued',
      };

      mockAxiosInstance.post.mockResolvedValue({
        data: { success: true, data: response },
      });

      const result = await apiClient.requestBatchSegmentation(imageIds);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        '/segmentation/batch',
        {
          imageIds,
          model: 'hrnet', // default
          threshold: 0.5, // default
          detectHoles: undefined,
        }
      );
      expect(result).toEqual(response);
    });

    it('should fetch segmentation results', async () => {
      const imageId = 'img-1';
      const results = {
        polygons: [
          {
            id: 'poly-1',
            points: [
              { x: 0, y: 0 },
              { x: 100, y: 0 },
              { x: 100, y: 100 },
              { x: 0, y: 100 },
            ],
            type: 'external',
          },
        ],
        imageWidth: 800,
        imageHeight: 600,
        modelUsed: 'hrnet',
        thresholdUsed: 0.5,
        confidence: 0.95,
        processingTime: 1.5,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      mockAxiosInstance.get.mockResolvedValue({
        data: { success: true, data: results },
      });

      const result = await apiClient.getSegmentationResults(imageId);

      expect(mockAxiosInstance.get).toHaveBeenCalledWith(
        `/segmentation/images/${imageId}/results`,
        expect.any(Object)
      );
      expect(result).toMatchObject({
        polygons: expect.arrayContaining([
          expect.objectContaining({ id: 'poly-1' }),
        ]),
      });
    });

    it('should handle segmentation queue status', async () => {
      const queueStatus = {
        total: 10,
        queued: 3,
        processing: 2,
        completed: 4,
        failed: 1,
      };

      mockAxiosInstance.get.mockResolvedValue({
        data: { success: true, data: queueStatus },
      });

      const result = await apiClient.getQueueStats('project-1');

      expect(result).toEqual(queueStatus);
    });

    it('should cancel/remove segmentation from queue', async () => {
      const queueId = 'queue-1';

      mockAxiosInstance.delete.mockResolvedValue({
        data: { success: true },
      });

      await expect(apiClient.removeFromQueue(queueId)).resolves.toBeUndefined();
      expect(mockAxiosInstance.delete).toHaveBeenCalledWith(
        expect.stringContaining(queueId)
      );
    });
  });

  describe('Error Recovery', () => {
    it('should surface server errors to the caller', async () => {
      // The ApiClient does not implement automatic retry — retries are done
      // by the response interceptor for specific status codes (429 rate limiting).
      // For generic 500 errors the error is re-thrown immediately.
      const serverError = new Error('Server error');
      (serverError as any).response = {
        status: 500,
        data: { error: 'Internal server error' },
      };
      mockAxiosInstance.get.mockRejectedValue(serverError);

      await expect(apiClient.getProjects()).rejects.toThrow('Server error');
    });

    it('should complete token refresh without error (cookie rotation is server-side)', async () => {
      // Tokens are httpOnly cookies; the client posts to /auth/refresh-token with
      // no body and reads nothing from the response — the server rotates the cookies.
      mockAxiosInstance.post.mockResolvedValue({
        data: { success: true },
      });

      await expect(apiClient.refreshAccessToken()).resolves.toBeUndefined();
      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        '/auth/refresh-token'
      );
    });

    it('should call /auth/logout on logout (server clears cookies)', async () => {
      mockAxiosInstance.post.mockResolvedValue({
        data: { success: true },
      });

      await apiClient.logout();

      // The server clears the httpOnly auth cookies via Set-Cookie.
      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/auth/logout');
    });
  });
});
