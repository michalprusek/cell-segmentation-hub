import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import MockAdapter from 'axios-mock-adapter';
import { api, setAuthToken, clearAuthToken, refreshAccessToken } from '../api';

// Create axios mock adapter
const mock = new MockAdapter(axios);

describe('API Integration Tests', () => {
  beforeEach(() => {
    // Clear any existing tokens
    clearAuthToken();
    mock.reset();
  });

  afterEach(() => {
    mock.reset();
    clearAuthToken();
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

      mock.onPost('/api/auth/login').reply(200, response);

      const result = await api.post('/auth/login', loginData);

      expect(result.data).toEqual(response);
      expect(mock.history.post[0].data).toBe(JSON.stringify(loginData));
    });

    it('should handle registration with validation', async () => {
      const registerData = {
        name: 'New User',
        email: 'newuser@example.com',
        password: 'SecurePass123!',
      };

      const response = {
        user: {
          id: '2',
          email: 'newuser@example.com',
          name: 'New User',
        },
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
      };

      mock.onPost('/api/auth/register').reply(201, response);

      const result = await api.post('/auth/register', registerData);

      expect(result.data).toEqual(response);
      expect(result.status).toBe(201);
    });

    it('should handle token refresh automatically', async () => {
      // Set initial token
      setAuthToken('expired-token');

      // First request fails with 401
      mock.onGet('/api/projects').replyOnce(401, {
        error: 'Token expired',
      });

      // Token refresh succeeds
      mock.onPost('/api/auth/refresh').replyOnce(200, {
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
      });

      // Retry original request succeeds
      mock.onGet('/api/projects').replyOnce(200, {
        projects: [],
      });

      const result = await api.get('/projects');

      expect(result.data).toEqual({ projects: [] });
      expect(mock.history.get).toHaveLength(2); // Original + retry
      expect(mock.history.post).toHaveLength(1); // Refresh token
    });

    it('should handle logout correctly', async () => {
      setAuthToken('active-token');

      mock.onPost('/api/auth/logout').reply(200, {
        message: 'Logged out successfully',
      });

      const result = await api.post('/auth/logout');

      expect(result.data.message).toBe('Logged out successfully');
      // Token should be cleared after logout
      expect(api.defaults.headers.common['Authorization']).toBeUndefined();
    });
  });

  describe('Project Management', () => {
    beforeEach(() => {
      setAuthToken('test-token');
    });

    it('should create a new project', async () => {
      const projectData = {
        name: 'Test Project',
        description: 'A test project',
      };

      const response = {
        id: 'project-1',
        ...projectData,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      };

      mock.onPost('/api/projects').reply(201, response);

      const result = await api.post('/projects', projectData);

      expect(result.data).toEqual(response);
      expect(result.status).toBe(201);
    });

    it('should fetch projects with pagination', async () => {
      const response = {
        projects: [
          { id: '1', name: 'Project 1' },
          { id: '2', name: 'Project 2' },
        ],
        total: 10,
        page: 1,
        limit: 2,
      };

      mock.onGet('/api/projects?page=1&limit=2').reply(200, response);

      const result = await api.get('/projects', {
        params: { page: 1, limit: 2 },
      });

      expect(result.data).toEqual(response);
      expect(result.data.projects).toHaveLength(2);
    });

    it('should update project details', async () => {
      const updateData = {
        name: 'Updated Project Name',
        description: 'Updated description',
      };

      const response = {
        id: 'project-1',
        ...updateData,
        updatedAt: '2024-01-02T00:00:00Z',
      };

      mock.onPut('/api/projects/project-1').reply(200, response);

      const result = await api.put('/projects/project-1', updateData);

      expect(result.data).toEqual(response);
    });

    it('should delete a project', async () => {
      mock.onDelete('/api/projects/project-1').reply(204);

      const result = await api.delete('/projects/project-1');

      expect(result.status).toBe(204);
    });

    it('should handle project search', async () => {
      const searchResults = {
        projects: [
          { id: '1', name: 'Cell Project', match: 'name' },
          {
            id: '2',
            name: 'Test',
            description: 'Cell analysis',
            match: 'description',
          },
        ],
      };

      mock.onGet('/api/projects/search?q=cell').reply(200, searchResults);

      const result = await api.get('/projects/search', {
        params: { q: 'cell' },
      });

      expect(result.data.projects).toHaveLength(2);
    });
  });

  describe('Image Management', () => {
    beforeEach(() => {
      setAuthToken('test-token');
    });

    it('should upload image with progress tracking', async () => {
      const formData = new FormData();
      formData.append('image', new Blob(['image data']), 'test.jpg');
      formData.append('projectId', 'project-1');

      const response = {
        id: 'image-1',
        filename: 'test.jpg',
        url: '/uploads/test.jpg',
        thumbnailUrl: '/uploads/thumbnails/test.jpg',
      };

      mock.onPost('/api/images/upload').reply(200, response);

      const onUploadProgress = vi.fn();

      const result = await api.post('/images/upload', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        onUploadProgress,
      });

      expect(result.data).toEqual(response);
    });

    it('should handle batch image operations', async () => {
      const imageIds = ['image-1', 'image-2', 'image-3'];

      mock.onPost('/api/images/batch/delete').reply(200, {
        deleted: imageIds,
        failed: [],
      });

      const result = await api.post('/images/batch/delete', { ids: imageIds });

      expect(result.data.deleted).toEqual(imageIds);
      expect(result.data.failed).toHaveLength(0);
    });

    it('should fetch image metadata', async () => {
      const metadata = {
        id: 'image-1',
        width: 1920,
        height: 1080,
        format: 'JPEG',
        size: 2048000,
        createdAt: '2024-01-01T00:00:00Z',
      };

      mock.onGet('/api/images/image-1/metadata').reply(200, metadata);

      const result = await api.get('/images/image-1/metadata');

      expect(result.data).toEqual(metadata);
    });
  });

  describe('Segmentation Operations', () => {
    beforeEach(() => {
      setAuthToken('test-token');
    });

    it('should start segmentation task', async () => {
      const segmentationRequest = {
        imageId: 'image-1',
        modelId: 'hrnet',
        parameters: {
          threshold: 0.5,
          minArea: 100,
        },
      };

      const response = {
        taskId: 'task-1',
        status: 'queued',
        queuePosition: 5,
        estimatedTime: 300,
      };

      mock.onPost('/api/segmentation/start').reply(202, response);

      const result = await api.post('/segmentation/start', segmentationRequest);

      expect(result.status).toBe(202);
      expect(result.data.taskId).toBe('task-1');
      expect(result.data.status).toBe('queued');
    });

    it('should poll segmentation status', async () => {
      const statusResponses = [
        { status: 'processing', progress: 25 },
        { status: 'processing', progress: 75 },
        { status: 'completed', result: { polygons: [] } },
      ];

      let callCount = 0;
      mock.onGet('/api/segmentation/status/task-1').reply(() => {
        const response = statusResponses[callCount];
        callCount++;
        return [200, response];
      });

      // Simulate polling
      for (let i = 0; i < 3; i++) {
        const result = await api.get('/segmentation/status/task-1');
        expect(result.data).toEqual(statusResponses[i]);
      }
    });

    it('should fetch segmentation results', async () => {
      const results = {
        id: 'result-1',
        imageId: 'image-1',
        modelId: 'hrnet',
        polygons: [
          {
            id: 'poly-1',
            points: [
              [0, 0],
              [100, 0],
              [100, 100],
              [0, 100],
            ],
            confidence: 0.95,
          },
        ],
        metadata: {
          processingTime: 5.2,
          polygonCount: 1,
          totalArea: 10000,
        },
      };

      mock.onGet('/api/segmentation/results/result-1').reply(200, results);

      const result = await api.get('/segmentation/results/result-1');

      expect(result.data).toEqual(results);
      expect(result.data.polygons).toHaveLength(1);
    });

    it('should save edited polygons', async () => {
      const editedPolygons = {
        resultId: 'result-1',
        polygons: [
          {
            id: 'poly-1',
            points: [
              [0, 0],
              [110, 0],
              [110, 110],
              [0, 110],
            ],
            modified: true,
          },
        ],
      };

      mock.onPut('/api/segmentation/results/result-1').reply(200, {
        success: true,
        savedAt: '2024-01-01T12:00:00Z',
      });

      const result = await api.put(
        '/segmentation/results/result-1',
        editedPolygons
      );

      expect(result.data.success).toBe(true);
    });
  });

  describe('Error Handling', () => {
    beforeEach(() => {
      setAuthToken('test-token');
    });

    it('should handle 400 validation errors', async () => {
      mock.onPost('/api/projects').reply(400, {
        error: 'Validation failed',
        details: {
          name: 'Project name is required',
        },
      });

      try {
        await api.post('/projects', {});
        expect.fail('Should have thrown an error');
      } catch (error: any) {
        expect(error.response.status).toBe(400);
        expect(error.response.data.error).toBe('Validation failed');
        expect(error.response.data.details).toBeDefined();
      }
    });

    it('should handle 404 not found errors', async () => {
      mock.onGet('/api/projects/non-existent').reply(404, {
        error: 'Project not found',
      });

      try {
        await api.get('/projects/non-existent');
        expect.fail('Should have thrown an error');
      } catch (error: any) {
        expect(error.response.status).toBe(404);
        expect(error.response.data.error).toBe('Project not found');
      }
    });

    it('should handle 500 server errors', async () => {
      mock.onGet('/api/projects').reply(500, {
        error: 'Internal server error',
        message: 'Database connection failed',
      });

      try {
        await api.get('/projects');
        expect.fail('Should have thrown an error');
      } catch (error: any) {
        expect(error.response.status).toBe(500);
        expect(error.response.data.error).toBe('Internal server error');
      }
    });

    it('should handle network timeouts', async () => {
      mock.onGet('/api/projects').timeout();

      try {
        await api.get('/projects');
        expect.fail('Should have thrown an error');
      } catch (error: any) {
        expect(error.code).toBe('ECONNABORTED');
        expect(error.message).toContain('timeout');
      }
    });

    it('should handle rate limiting', async () => {
      mock.onGet('/api/projects').reply(429, {
        error: 'Too many requests',
        retryAfter: 60,
      });

      try {
        await api.get('/projects');
        expect.fail('Should have thrown an error');
      } catch (error: any) {
        expect(error.response.status).toBe(429);
        expect(error.response.data.retryAfter).toBe(60);
      }
    });
  });

  describe('Export and Import', () => {
    beforeEach(() => {
      setAuthToken('test-token');
    });

    it('should export data in COCO format', async () => {
      const exportRequest = {
        projectId: 'project-1',
        format: 'coco',
        includeImages: true,
      };

      const response = {
        downloadUrl: '/api/export/download/export-1',
        expiresAt: '2024-01-02T00:00:00Z',
        size: 1048576,
      };

      mock.onPost('/api/export/coco').reply(200, response);

      const result = await api.post('/export/coco', exportRequest);

      expect(result.data.downloadUrl).toBeDefined();
      expect(result.data.size).toBe(1048576);
    });

    it('should handle export download', async () => {
      const blobData = new Blob(['export data'], { type: 'application/json' });

      mock.onGet('/api/export/download/export-1').reply(200, blobData, {
        'Content-Type': 'application/json',
        'Content-Disposition': 'attachment; filename="export.json"',
      });

      const result = await api.get('/export/download/export-1', {
        responseType: 'blob',
      });

      expect(result.data).toBeInstanceOf(Blob);
      expect(result.headers['content-type']).toBe('application/json');
    });

    it('should import COCO dataset', async () => {
      const formData = new FormData();
      formData.append('file', new Blob(['import data']), 'import.json');
      formData.append('projectId', 'project-1');

      const response = {
        imported: {
          images: 10,
          annotations: 150,
        },
        errors: [],
      };

      mock.onPost('/api/import/coco').reply(200, response);

      const result = await api.post('/import/coco', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });

      expect(result.data.imported.images).toBe(10);
      expect(result.data.imported.annotations).toBe(150);
      expect(result.data.errors).toHaveLength(0);
    });
  });

  describe('User Management', () => {
    beforeEach(() => {
      setAuthToken('test-token');
    });

    it('should fetch user profile', async () => {
      const profile = {
        id: 'user-1',
        email: 'user@example.com',
        name: 'Test User',
        role: 'user',
        createdAt: '2024-01-01T00:00:00Z',
        storage: {
          used: 52428800,
          limit: 1073741824,
        },
      };

      mock.onGet('/api/users/profile').reply(200, profile);

      const result = await api.get('/users/profile');

      expect(result.data).toEqual(profile);
      expect(result.data.storage.used).toBe(52428800);
    });

    it('should update user profile', async () => {
      const updates = {
        name: 'Updated Name',
        email: 'newemail@example.com',
      };

      mock.onPut('/api/users/profile').reply(200, {
        ...updates,
        id: 'user-1',
        updatedAt: '2024-01-02T00:00:00Z',
      });

      const result = await api.put('/users/profile', updates);

      expect(result.data.name).toBe('Updated Name');
      expect(result.data.email).toBe('newemail@example.com');
    });

    it('should change password', async () => {
      const passwordData = {
        currentPassword: 'oldPassword123',
        newPassword: 'newPassword456!',
      };

      mock.onPost('/api/users/change-password').reply(200, {
        message: 'Password changed successfully',
      });

      const result = await api.post('/users/change-password', passwordData);

      expect(result.data.message).toBe('Password changed successfully');
    });

    it('should handle password reset flow', async () => {
      // Request reset
      mock.onPost('/api/auth/reset-password-request').reply(200, {
        message: 'Reset email sent',
      });

      const requestResult = await api.post('/auth/reset-password-request', {
        email: 'user@example.com',
      });

      expect(requestResult.data.message).toBe('Reset email sent');

      // Complete reset
      mock.onPost('/api/auth/reset-password').reply(200, {
        message: 'Password reset successfully',
      });

      const resetResult = await api.post('/auth/reset-password', {
        token: 'reset-token',
        newPassword: 'newPassword789!',
      });

      expect(resetResult.data.message).toBe('Password reset successfully');
    });
  });

  describe('Statistics and Analytics', () => {
    beforeEach(() => {
      setAuthToken('test-token');
    });

    it('should fetch dashboard statistics', async () => {
      const stats = {
        projects: 10,
        images: 150,
        segmentations: 120,
        storageUsed: 524288000,
        recentActivity: [
          {
            type: 'segmentation_completed',
            timestamp: '2024-01-01T10:00:00Z',
            details: { projectId: 'project-1', imageId: 'image-1' },
          },
        ],
      };

      mock.onGet('/api/stats/dashboard').reply(200, stats);

      const result = await api.get('/stats/dashboard');

      expect(result.data).toEqual(stats);
      expect(result.data.projects).toBe(10);
      expect(result.data.recentActivity).toHaveLength(1);
    });

    it('should fetch project statistics', async () => {
      const projectStats = {
        projectId: 'project-1',
        imageCount: 25,
        segmentationCount: 20,
        averagePolygonsPerImage: 15.5,
        totalProcessingTime: 300,
        modelUsage: {
          hrnet: 15,
          resnet: 5,
        },
      };

      mock.onGet('/api/stats/projects/project-1').reply(200, projectStats);

      const result = await api.get('/stats/projects/project-1');

      expect(result.data).toEqual(projectStats);
      expect(result.data.averagePolygonsPerImage).toBe(15.5);
    });
  });

  describe('WebSocket Integration', () => {
    it('should handle WebSocket connection headers', async () => {
      setAuthToken('ws-token');

      // Mock WebSocket upgrade request
      mock.onGet('/api/ws').reply(101, null, {
        Upgrade: 'websocket',
        Connection: 'Upgrade',
      });

      const result = await api.get('/ws', {
        headers: {
          Upgrade: 'websocket',
          Connection: 'Upgrade',
        },
      });

      expect(result.status).toBe(101);
      expect(result.headers['upgrade']).toBe('websocket');
    });
  });

  describe('Request Interceptors', () => {
    it('should add auth token to requests automatically', async () => {
      setAuthToken('auto-token');

      mock.onGet('/api/test').reply(200, { success: true });

      await api.get('/test');

      expect(mock.history.get[0].headers?.Authorization).toBe(
        'Bearer auto-token'
      );
    });

    it('should handle request transformation', async () => {
      const data = {
        name: 'Test',
        createdAt: new Date('2024-01-01'),
      };

      mock.onPost('/api/test').reply(config => {
        const parsed = JSON.parse(config.data);
        expect(parsed.createdAt).toBe('2024-01-01T00:00:00.000Z');
        return [200, { success: true }];
      });

      await api.post('/test', data);
    });
  });
});
