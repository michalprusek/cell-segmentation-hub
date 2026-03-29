/**
 * Project Routes Tests
 *
 * Uses direct controller imports and manually wired routes to avoid
 * the large dependency chain in projectRoutes.ts (cache, imageRoutes, etc.)
 * This follows the same pattern as projects.controller.test.ts.
 */
import request from 'supertest';
import express from 'express';
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from '@jest/globals';
import {
  createProject,
  getProjects,
  getProject,
  updateProject,
  deleteProject,
} from '../../controllers/projectController';
import * as projectService from '../../../services/projectService';
import { authenticate } from '../../../middleware/auth';
import { logger } from '../../../utils/logger';
import { ResponseHelper } from '../../../utils/response';

// Mock all dependencies
jest.mock('../../../services/projectService');
jest.mock('../../../middleware/auth');
jest.mock('../../../utils/logger');
jest.mock('../../../utils/response', () => ({
  asyncHandler: (fn: any) => fn,
  ResponseHelper: {
    success: jest.fn(),
    notFound: jest.fn(),
    unauthorized: jest.fn(),
    forbidden: jest.fn(),
    badRequest: jest.fn(),
    internalError: jest.fn(),
    validationError: jest.fn(),
    conflict: jest.fn(),
    rateLimit: jest.fn(),
    serviceUnavailable: jest.fn(),
    error: jest.fn(),
    paginated: jest.fn(),
  },
}));
jest.mock('../../../db');
jest.mock('../../../utils/config', () => ({
  config: {
    NODE_ENV: 'test',
    PORT: 3001,
    HOST: 'localhost',
    DATABASE_URL: 'file:./test.db',
    JWT_ACCESS_SECRET: 'test-secret-at-least-32-chars-long-for-test',
    JWT_REFRESH_SECRET: 'test-refresh-secret-at-least-32-chars-long',
    REDIS_URL: 'redis://localhost:6379',
    ML_SERVICE_URL: 'http://localhost:8000',
    SEGMENTATION_SERVICE_URL: 'http://localhost:8000',
    FROM_EMAIL: 'test@example.com',
    FROM_NAME: 'Test',
    UPLOAD_DIR: './uploads',
    EMAIL_SERVICE: 'none',
    ALLOWED_ORIGINS: 'http://localhost:3000',
    WS_ALLOWED_ORIGINS: 'http://localhost:3000',
  },
}));

const MockedProjectService = projectService as unknown as Record<string, jest.Mock<any>>;
const mockedAuthenticate = authenticate as jest.MockedFunction<typeof authenticate>;
const mockedLogger = logger as jest.Mocked<typeof logger>;

const mockUser = {
  id: 'test-user-id',
  email: 'test@example.com',
  emailVerified: true,
  firstName: 'Test',
  lastName: 'User',
};

const validProjectId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

const mockProject: any = {
  id: validProjectId,
  title: 'Test Project',
  name: 'Test Project',
  description: 'Test Description',
  userId: mockUser.id,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
  images: [],
  _count: { images: 0 },
};

describe('Project Routes', () => {
  let app: express.Application;

  beforeEach(() => {
    jest.clearAllMocks();

    app = express();
    app.use(express.json());

    // Default: auth passes with user injected
    mockedAuthenticate.mockImplementation(
      async (
        req: express.Request & { user?: Record<string, unknown> },
        _res: express.Response,
        next: express.NextFunction
      ) => {
        req.user = mockUser;
        next();
      }
    );

    // Install ResponseHelper mocks
    (ResponseHelper.success as jest.Mock).mockImplementation(
      (res: express.Response, data: unknown, message: string, statusCode: number = 200) => {
        return res.status(statusCode).json({ success: true, data, message });
      }
    );
    (ResponseHelper.paginated as jest.Mock).mockImplementation(
      (res: express.Response, data: unknown, pagination: unknown, message: string) => {
        return res.status(200).json({ success: true, data: { projects: data, pagination }, message });
      }
    );
    (ResponseHelper.notFound as jest.Mock).mockImplementation(
      (res: express.Response, message: string) => {
        return res.status(404).json({ success: false, message });
      }
    );
    (ResponseHelper.unauthorized as jest.Mock).mockImplementation(
      (res: express.Response, message: string) => {
        return res.status(401).json({ success: false, message });
      }
    );
    (ResponseHelper.forbidden as jest.Mock).mockImplementation(
      (res: express.Response, message: string) => {
        return res.status(403).json({ success: false, message });
      }
    );
    (ResponseHelper.badRequest as jest.Mock).mockImplementation(
      (res: express.Response, message: string) => {
        return res.status(400).json({ success: false, message });
      }
    );
    (ResponseHelper.internalError as jest.Mock).mockImplementation(
      (res: express.Response, _err: unknown, message: string) => {
        return res.status(500).json({ success: false, message });
      }
    );

    mockedLogger.info = jest.fn() as jest.MockedFunction<typeof logger.info>;
    mockedLogger.error = jest.fn() as jest.MockedFunction<typeof logger.error>;
    mockedLogger.debug = jest.fn() as jest.MockedFunction<typeof logger.debug>;

    // Register routes using controller functions directly (same pattern as reference test)
    app.get('/projects', mockedAuthenticate, getProjects);
    app.post('/projects', mockedAuthenticate, createProject);
    app.get('/projects/:id', mockedAuthenticate, getProject);
    app.put('/projects/:id', mockedAuthenticate, updateProject);
    app.delete('/projects/:id', mockedAuthenticate, deleteProject);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.resetAllMocks();
  });

  describe('POST /projects — create project', () => {
    it('should create project and return 201', async () => {
      MockedProjectService.createProject.mockResolvedValueOnce(mockProject);

      const response = await request(app)
        .post('/projects')
        .send({ name: 'New Project', description: 'Description' })
        .expect(201);

      expect(response.body.success).toBe(true);
      // Controller returns Czech message — just verify success
      expect(typeof response.body.message).toBe('string');
    });

    it('should require authentication', async () => {
      mockedAuthenticate.mockImplementationOnce(async (_req, res, _next) => {
        res.status(401).json({ success: false, message: 'Unauthorized' });
      });

      await request(app)
        .post('/projects')
        .send({ name: 'New Project' })
        .expect(401);
    });

    it('should return 500 when service throws', async () => {
      MockedProjectService.createProject.mockRejectedValueOnce(
        new Error('DB error')
      );

      const response = await request(app)
        .post('/projects')
        .send({ name: 'New Project' })
        .expect(500);

      expect(response.body.success).toBe(false);
    });

    it('should pass project data to service', async () => {
      MockedProjectService.createProject.mockResolvedValueOnce(mockProject);

      await request(app)
        .post('/projects')
        .send({ name: 'My Project', description: 'Desc' });

      expect(MockedProjectService.createProject).toHaveBeenCalledWith(
        mockUser.id,
        expect.objectContaining({ name: 'My Project' })
      );
    });
  });

  describe('GET /projects — list projects', () => {
    it('should return paginated project list', async () => {
      const mockPagination = {
        page: 1,
        limit: 10,
        totalPages: 1,
        hasNext: false,
        hasPrev: false,
      };
      MockedProjectService.getUserProjects.mockResolvedValueOnce({
        projects: [mockProject],
        totalCount: 1,
        pagination: mockPagination,
      });

      const response = await request(app)
        .get('/projects')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.projects).toHaveLength(1);
    });

    it('should require authentication', async () => {
      mockedAuthenticate.mockImplementationOnce(async (_req, res, _next) => {
        res.status(401).json({ success: false, message: 'Unauthorized' });
      });

      await request(app).get('/projects').expect(401);
    });

    it('should return empty list when user has no projects', async () => {
      MockedProjectService.getUserProjects.mockResolvedValueOnce({
        projects: [],
        totalCount: 0,
        pagination: { page: 1, limit: 10, totalPages: 0, hasNext: false, hasPrev: false },
      });

      const response = await request(app).get('/projects').expect(200);
      expect(response.body.data.projects).toEqual([]);
    });

    it('should pass page and limit query params to service', async () => {
      MockedProjectService.getUserProjects.mockResolvedValueOnce({
        projects: [],
        totalCount: 0,
        pagination: { page: 2, limit: 5, totalPages: 0, hasNext: false, hasPrev: false },
      });

      await request(app)
        .get('/projects?page=2&limit=5')
        .expect(200);

      expect(MockedProjectService.getUserProjects).toHaveBeenCalledWith(
        mockUser.id,
        expect.objectContaining({ page: 2, limit: 5 })
      );
    });
  });

  describe('GET /projects/:id — get by id', () => {
    it('should return project by id', async () => {
      MockedProjectService.getProjectById.mockResolvedValueOnce(mockProject);

      const response = await request(app)
        .get(`/projects/${validProjectId}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.id).toBe(validProjectId);
    });

    it('should require authentication', async () => {
      mockedAuthenticate.mockImplementationOnce(async (_req, res, _next) => {
        res.status(401).json({ success: false, message: 'Unauthorized' });
      });

      await request(app)
        .get(`/projects/${validProjectId}`)
        .expect(401);
    });

    it('should return 404 for non-existent project', async () => {
      MockedProjectService.getProjectById.mockResolvedValueOnce(null);

      const response = await request(app)
        .get(`/projects/${validProjectId}`)
        .expect(404);

      expect(response.body.success).toBe(false);
    });

    it('should return 500 on unexpected service error', async () => {
      MockedProjectService.getProjectById.mockRejectedValueOnce(
        new Error('Database connection failed')
      );

      const response = await request(app)
        .get(`/projects/${validProjectId}`)
        .expect(500);

      expect(response.body.success).toBe(false);
    });
  });

  describe('PUT /projects/:id — update project', () => {
    it('should update project successfully', async () => {
      const updatedProject = { ...mockProject, title: 'Updated Name', name: 'Updated Name' };
      MockedProjectService.updateProject.mockResolvedValueOnce(updatedProject);

      const response = await request(app)
        .put(`/projects/${validProjectId}`)
        .send({ name: 'Updated Name' })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(typeof response.body.message).toBe('string');
    });

    it('should require authentication', async () => {
      mockedAuthenticate.mockImplementationOnce(async (_req, res, _next) => {
        res.status(401).json({ success: false, message: 'Unauthorized' });
      });

      await request(app)
        .put(`/projects/${validProjectId}`)
        .send({ name: 'Updated' })
        .expect(401);
    });

    it('should return 404 for non-existent project', async () => {
      MockedProjectService.updateProject.mockResolvedValueOnce(null);

      const response = await request(app)
        .put(`/projects/${validProjectId}`)
        .send({ name: 'Updated' })
        .expect(404);

      expect(response.body.success).toBe(false);
    });

    it('should return 500 on service error', async () => {
      MockedProjectService.updateProject.mockRejectedValueOnce(
        new Error('DB error')
      );

      const response = await request(app)
        .put(`/projects/${validProjectId}`)
        .send({ name: 'Updated' })
        .expect(500);

      expect(response.body.success).toBe(false);
    });
  });

  describe('DELETE /projects/:id — delete project', () => {
    it('should delete project successfully', async () => {
      MockedProjectService.deleteProject.mockResolvedValueOnce(mockProject);

      const response = await request(app)
        .delete(`/projects/${validProjectId}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(typeof response.body.message).toBe('string');
    });

    it('should require authentication', async () => {
      mockedAuthenticate.mockImplementationOnce(async (_req, res, _next) => {
        res.status(401).json({ success: false, message: 'Unauthorized' });
      });

      await request(app)
        .delete(`/projects/${validProjectId}`)
        .expect(401);
    });

    it('should return 404 for non-existent project', async () => {
      MockedProjectService.deleteProject.mockResolvedValueOnce(null);

      const response = await request(app)
        .delete(`/projects/${validProjectId}`)
        .expect(404);

      expect(response.body.success).toBe(false);
    });

    it('should return 500 on service error', async () => {
      MockedProjectService.deleteProject.mockRejectedValueOnce(
        new Error('Cannot delete project with active processing')
      );

      const response = await request(app)
        .delete(`/projects/${validProjectId}`)
        .expect(500);

      expect(response.body.success).toBe(false);
    });
  });
});
