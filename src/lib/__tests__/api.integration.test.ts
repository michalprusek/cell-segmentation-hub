import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import MockAdapter from 'axios-mock-adapter';
import apiClient from '../api';

// Create axios mock adapter
const mock = new MockAdapter(axios);

describe('API Integration Tests', () => {
  beforeEach(() => {
    // Clear any existing tokens
    if (typeof (apiClient as any).clearAuthToken === 'function') {
      (apiClient as any).clearAuthToken();
    }
    mock.reset();
  });

  afterEach(() => {
    mock.reset();
    if (typeof (apiClient as any).clearAuthToken === 'function') {
      (apiClient as any).clearAuthToken();
    }
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

      const result = await apiClient.login(loginData.email, loginData.password);

      expect(result).toEqual(response);
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
          email: registerData.email,
          name: registerData.name,
        },
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
      };

      mock.onPost('/api/auth/register').reply(201, response);

      const result = await apiClient.register(
        registerData.name,
        registerData.email,
        registerData.password
      );

      expect(result).toEqual(response);
    });

    it('should handle login errors gracefully', async () => {
      mock.onPost('/api/auth/login').reply(401, {
        error: 'Invalid credentials',
      });

      await expect(
        apiClient.login('wrong@example.com', 'wrongpass')
      ).rejects.toThrow();
    });

    it('should handle network errors', async () => {
      mock.onPost('/api/auth/login').networkError();

      await expect(
        apiClient.login('test@example.com', 'password')
      ).rejects.toThrow();
    });

    it('should handle timeout errors', async () => {
      mock.onPost('/api/auth/login').timeout();

      await expect(
        apiClient.login('test@example.com', 'password')
      ).rejects.toThrow();
    });
  });

  describe('Project Management', () => {
    beforeEach(() => {
      // Set auth token for authenticated requests
      if (typeof (apiClient as any).setAuthToken === 'function') {
        (apiClient as any).setAuthToken(
          'test-access-token',
          'test-refresh-token'
        );
      }
    });

    it('should fetch projects list', async () => {
      const projects = [
        { id: '1', name: 'Project 1', description: 'Test project 1' },
        { id: '2', name: 'Project 2', description: 'Test project 2' },
      ];

      mock.onGet('/api/projects').reply(200, projects);

      const result = await apiClient.getProjects();

      expect(result).toEqual(projects);
    });

    it('should create a new project', async () => {
      const newProject = {
        name: 'New Project',
        description: 'A new test project',
      };

      const response = {
        id: '3',
        ...newProject,
        createdAt: new Date().toISOString(),
      };

      mock.onPost('/api/projects').reply(201, response);

      const result = await apiClient.createProject(newProject);

      expect(result).toEqual(response);
    });

    it('should update an existing project', async () => {
      const projectId = '1';
      const updates = {
        name: 'Updated Project Name',
        description: 'Updated description',
      };

      const response = {
        id: projectId,
        ...updates,
      };

      mock.onPut(`/api/projects/${projectId}`).reply(200, response);

      const result = await apiClient.updateProject(projectId, updates);

      expect(result).toEqual(response);
    });

    it('should delete a project', async () => {
      const projectId = '1';

      mock.onDelete(`/api/projects/${projectId}`).reply(204);

      await expect(apiClient.deleteProject(projectId)).resolves.toBeUndefined();
    });

    it('should handle unauthorized access', async () => {
      // Clear auth token
      if (typeof (apiClient as any).clearAuthToken === 'function') {
        (apiClient as any).clearAuthToken();
      }

      mock.onGet('/api/projects').reply(401, {
        error: 'Unauthorized',
      });

      await expect(apiClient.getProjects()).rejects.toThrow();
    });
  });

  describe('Image Upload', () => {
    beforeEach(() => {
      if (typeof (apiClient as any).setAuthToken === 'function') {
        (apiClient as any).setAuthToken(
          'test-access-token',
          'test-refresh-token'
        );
      }
    });

    it('should upload an image successfully', async () => {
      const projectId = '1';
      const file = new File(['image content'], 'test.jpg', {
        type: 'image/jpeg',
      });

      const response = {
        id: 'img-1',
        fileName: 'test.jpg',
        url: '/uploads/test.jpg',
      };

      mock.onPost(`/api/projects/${projectId}/images`).reply(201, response);

      const formData = new FormData();
      formData.append('file', file);

      const result = await apiClient.uploadImage(projectId, file);

      expect(result).toEqual(response);
    });

    it('should handle upload progress', async () => {
      const projectId = '1';
      const file = new File(['image content'], 'test.jpg', {
        type: 'image/jpeg',
      });
      const progressCallback = vi.fn();

      mock.onPost(`/api/projects/${projectId}/images`).reply(201, {
        id: 'img-1',
        fileName: 'test.jpg',
      });

      await apiClient.uploadImage(projectId, file, progressCallback);

      // Progress callback should have been called
      expect(progressCallback).toHaveBeenCalled();
    });

    it('should handle large file rejection', async () => {
      const projectId = '1';
      const largeFile = new File(['x'.repeat(10 * 1024 * 1024)], 'large.jpg', {
        type: 'image/jpeg',
      });

      mock.onPost(`/api/projects/${projectId}/images`).reply(413, {
        error: 'File too large',
      });

      await expect(
        apiClient.uploadImage(projectId, largeFile)
      ).rejects.toThrow();
    });
  });

  describe('Segmentation', () => {
    beforeEach(() => {
      if (typeof (apiClient as any).setAuthToken === 'function') {
        (apiClient as any).setAuthToken(
          'test-access-token',
          'test-refresh-token'
        );
      }
    });

    it('should request segmentation', async () => {
      const request = {
        projectId: '1',
        imageId: 'img-1',
        modelId: 'model-1',
      };

      const response = {
        queueId: 'queue-1',
        position: 5,
        estimatedTime: 120,
      };

      mock.onPost('/api/segmentation/process').reply(202, response);

      const result = await apiClient.requestSegmentation(request);

      expect(result).toEqual(response);
    });

    it('should fetch segmentation results', async () => {
      const resultId = 'result-1';
      const results = {
        id: resultId,
        status: 'completed',
        polygons: [
          {
            id: 'poly-1',
            points: [
              [0, 0],
              [100, 0],
              [100, 100],
              [0, 100],
            ],
          },
        ],
      };

      mock.onGet(`/api/segmentation/results/${resultId}`).reply(200, results);

      const result = await apiClient.getSegmentationResult(resultId);

      expect(result).toEqual(results);
    });

    it('should handle segmentation queue status', async () => {
      const queueId = 'queue-1';
      const status = {
        position: 2,
        estimatedTime: 45,
        status: 'processing',
      };

      mock.onGet(`/api/segmentation/queue/${queueId}`).reply(200, status);

      const result = await apiClient.getQueueStats(queueId);

      expect(result).toEqual(status);
    });

    it('should cancel segmentation request', async () => {
      const queueId = 'queue-1';

      mock.onDelete(`/api/segmentation/queue/${queueId}`).reply(204);

      await expect(apiClient.removeFromQueue(queueId)).resolves.toBeUndefined();
    });
  });

  describe('Error Recovery', () => {
    it('should retry failed requests with exponential backoff', async () => {
      let attempts = 0;

      mock.onGet('/api/projects').reply(() => {
        attempts++;
        if (attempts < 3) {
          return [500, { error: 'Server error' }];
        }
        return [200, []];
      });

      const result = await apiClient.getProjects();

      expect(attempts).toBe(3);
      expect(result).toEqual([]);
    });

    it('should handle token refresh on 401', async () => {
      const refreshResponse = {
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
      };

      mock
        .onGet('/api/projects')
        .replyOnce(401, { error: 'Token expired' })
        .onGet('/api/projects')
        .reply(200, []);

      mock.onPost('/api/auth/refresh').reply(200, refreshResponse);

      const result = await apiClient.getProjects();

      expect(result).toEqual([]);
    });

    it('should handle concurrent requests during token refresh', async () => {
      const refreshResponse = {
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
      };

      // All requests initially fail with 401
      mock
        .onGet(/\/api\/projects.*/)
        .replyOnce(401)
        .onGet(/\/api\/projects.*/)
        .reply(200, []);
      mock.onPost('/api/auth/refresh').reply(200, refreshResponse);

      // Make concurrent requests
      const promises = [
        apiClient.getProjects(),
        apiClient.projects.getById('1'),
        apiClient.projects.getById('2'),
      ];

      const results = await Promise.all(promises);

      // All should succeed after token refresh
      expect(results).toHaveLength(3);

      // Verify refresh endpoint was called only once (de-duplication)
      const refreshCalls = mock.history.post.filter(
        call => call.url === '/api/auth/refresh'
      );
      expect(refreshCalls).toHaveLength(1);
    });
  });
});
