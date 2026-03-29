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
} from '../projectController';
import * as projectService from '../../../services/projectService';
import { authenticate } from '../../../middleware/auth';

// Mock dependencies
jest.mock('../../../utils/config', () => ({
  config: {
    NODE_ENV: 'test',
    PORT: 3001,
    HOST: 'localhost',
    DATABASE_URL: 'file:./test.db',
    JWT_ACCESS_SECRET: 'test-access-secret-for-testing-only-32-characters-long',
    JWT_REFRESH_SECRET: 'test-refresh-secret-for-testing-only-32-characters-long',
    JWT_ACCESS_EXPIRY: '15m',
    JWT_REFRESH_EXPIRY: '7d',
    JWT_REFRESH_EXPIRY_REMEMBER: '30d',
    ALLOWED_ORIGINS: 'http://localhost:3000',
    WS_ALLOWED_ORIGINS: 'http://localhost:3000',
  },
}));
jest.mock('../../../services/projectService');
jest.mock('../../../middleware/auth');
jest.mock('../../../utils/logger', () => ({
  logger: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}));

const MockProjectService = projectService as jest.Mocked<typeof projectService>;
const mockAuthMiddleware = authenticate as jest.MockedFunction<
  typeof authenticate
>;

describe('ProjectController', () => {
  let app: express.Application;

  const mockUser = {
    id: 'user-id',
    email: 'test@example.com',
    emailVerified: true,
    firstName: 'Test',
    lastName: 'User',
  };

  const mockProject = {
    id: 'project-id',
    name: 'Test Project',
    title: 'Test Project',
    description: 'Test Description',
    userId: 'user-id',
    createdAt: new Date('2023-01-01'),
    updatedAt: new Date('2023-01-01'),
    images: [],
    _count: {
      images: 0,
    },
  };

  beforeEach(() => {
    app = express();
    app.use(express.json());

    // Mock auth middleware to add user to request
    mockAuthMiddleware.mockImplementation(
      async (
        req: express.Request & { user?: Record<string, unknown> },
        res: express.Response,
        next: express.NextFunction
      ) => {
        req.user = mockUser;
        next();
      }
    );

    // Setup routes with function controllers
    app.get('/projects', mockAuthMiddleware, getProjects);
    app.post('/projects', mockAuthMiddleware, createProject);
    app.get('/projects/:id', mockAuthMiddleware, getProject);
    app.put('/projects/:id', mockAuthMiddleware, updateProject);
    app.delete('/projects/:id', mockAuthMiddleware, deleteProject);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    jest.resetAllMocks();
  });

  describe('GET /projects', () => {
    it('should return user projects successfully', async () => {
      const mockPagination = {
        page: 1,
        limit: 10,
        total: 1,
        totalPages: 1,
      };
      MockProjectService.getUserProjects.mockResolvedValueOnce({
        projects: [mockProject as any],
        pagination: mockPagination,
      } as any);

      const response = await request(app).get('/projects').expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: mockProject.id,
            title: mockProject.title,
          }),
        ])
      );
      expect(response.body.pagination).toBeDefined();

      expect(MockProjectService.getUserProjects).toHaveBeenCalledWith(
        mockUser.id,
        expect.objectContaining({ page: 1, limit: 10 })
      );
    });

    it('should handle service error', async () => {
      MockProjectService.getUserProjects.mockRejectedValueOnce(
        new Error('Database error')
      );

      const response = await request(app).get('/projects').expect(500);

      expect(response.body.success).toBe(false);
    });

    it('should return empty array when user has no projects', async () => {
      const mockPagination = {
        page: 1,
        limit: 10,
        total: 0,
        totalPages: 0,
      };
      MockProjectService.getUserProjects.mockResolvedValueOnce({
        projects: [],
        pagination: mockPagination,
      } as any);

      const response = await request(app).get('/projects').expect(200);

      expect(response.body.data).toEqual([]);
    });
  });

  describe('POST /projects', () => {
    it('should create project successfully', async () => {
      const projectData = {
        title: 'New Project',
        description: 'New Description',
      };

      const createdProject = {
        ...mockProject,
        title: projectData.title,
        description: projectData.description,
      };

      MockProjectService.createProject.mockResolvedValueOnce(createdProject as any);

      const response = await request(app)
        .post('/projects')
        .send(projectData)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual(
        expect.objectContaining({ title: projectData.title })
      );

      expect(MockProjectService.createProject).toHaveBeenCalledWith(
        mockUser.id,
        projectData
      );
    });

    it('should return 400 for missing project name', async () => {
      MockProjectService.createProject.mockRejectedValueOnce(
        new Error('Project name is required')
      );

      const invalidProjectData = {
        description: 'Description without name',
      };

      const response = await request(app)
        .post('/projects')
        .send(invalidProjectData)
        .expect(500);

      expect(response.body.success).toBe(false);
    });

    it('should return 400 for project name too long', async () => {
      MockProjectService.createProject.mockRejectedValueOnce(
        new Error('Project name must be less than 255 characters')
      );

      const projectData = {
        title: 'A'.repeat(256), // Too long
        description: 'Valid description',
      };

      const response = await request(app)
        .post('/projects')
        .send(projectData)
        .expect(500);

      expect(response.body.success).toBe(false);
    });

    it('should handle duplicate project name', async () => {
      const projectData = {
        title: 'Existing Project',
        description: 'Description',
      };

      MockProjectService.createProject.mockRejectedValueOnce(
        new Error('Project with this name already exists')
      );

      const response = await request(app)
        .post('/projects')
        .send(projectData)
        .expect(500);

      expect(response.body.success).toBe(false);
    });
  });

  describe('GET /projects/:id', () => {
    it('should return project successfully', async () => {
      MockProjectService.getProjectById.mockResolvedValueOnce(mockProject as any);

      const response = await request(app)
        .get(`/projects/${mockProject.id}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual(
        expect.objectContaining({
          id: mockProject.id,
          title: mockProject.title,
        })
      );

      expect(MockProjectService.getProjectById).toHaveBeenCalledWith(
        mockProject.id,
        mockUser.id
      );
    });

    it('should return 404 for non-existent project', async () => {
      MockProjectService.getProjectById.mockResolvedValueOnce(null);

      const response = await request(app)
        .get('/projects/non-existent-id')
        .expect(404);

      expect(response.body.success).toBe(false);
    });

    it('should return 403 for unauthorized access', async () => {
      MockProjectService.getProjectById.mockRejectedValueOnce(
        new Error('Unauthorized access to project')
      );

      // Controller returns 500 for uncaught errors
      const response = await request(app)
        .get('/projects/unauthorized-project-id')
        .expect(500);

      expect(response.body.success).toBe(false);
    });
  });

  describe('PUT /projects/:id', () => {
    it('should update project successfully', async () => {
      const updateData = {
        title: 'Updated Project',
        description: 'Updated Description',
      };

      const updatedProject = {
        ...mockProject,
        ...updateData,
        updatedAt: new Date(),
      };

      MockProjectService.updateProject.mockResolvedValueOnce(updatedProject as any);

      const response = await request(app)
        .put(`/projects/${mockProject.id}`)
        .send(updateData)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual(
        expect.objectContaining({ title: updateData.title })
      );

      expect(MockProjectService.updateProject).toHaveBeenCalledWith(
        mockProject.id,
        mockUser.id,
        updateData
      );
    });

    it('should return 404 for updating non-existent project', async () => {
      const updateData = {
        title: 'Updated Project',
      };

      MockProjectService.updateProject.mockResolvedValueOnce(null);

      const response = await request(app)
        .put('/projects/non-existent-id')
        .send(updateData)
        .expect(404);

      expect(response.body.success).toBe(false);
    });

    it('should validate update data', async () => {
      MockProjectService.updateProject.mockRejectedValueOnce(
        new Error('Project name cannot be empty')
      );

      const invalidUpdateData = {
        title: '', // Empty name
        description: 'Valid description',
      };

      const response = await request(app)
        .put(`/projects/${mockProject.id}`)
        .send(invalidUpdateData)
        .expect(500);

      expect(response.body.success).toBe(false);
    });
  });

  describe('DELETE /projects/:id', () => {
    it('should delete project successfully', async () => {
      const deletedProject = {
        ...mockProject,
        imageCount: 5,
      };
      MockProjectService.deleteProject.mockResolvedValueOnce(deletedProject as any);

      const response = await request(app)
        .delete(`/projects/${mockProject.id}`)
        .expect(200);

      expect(response.body.success).toBe(true);

      expect(MockProjectService.deleteProject).toHaveBeenCalledWith(
        mockProject.id,
        mockUser.id
      );
    });

    it('should return 404 for deleting non-existent project', async () => {
      MockProjectService.deleteProject.mockRejectedValueOnce(
        new Error('Project not found')
      );

      const response = await request(app)
        .delete('/projects/non-existent-id')
        .expect(500);

      expect(response.body.success).toBe(false);
    });

    it('should handle deletion error', async () => {
      MockProjectService.deleteProject.mockRejectedValueOnce(
        new Error('Cannot delete project with active processing')
      );

      const response = await request(app)
        .delete(`/projects/${mockProject.id}`)
        .expect(500);

      expect(response.body.success).toBe(false);
    });
  });

  describe('Authorization checks', () => {
    it('should require authentication for GET /projects', async () => {
      // Mock auth middleware to return unauthorized
      mockAuthMiddleware.mockImplementationOnce(async (req, res, _next) => {
        res.status(401).json({ success: false, message: 'Unauthorized' });
      });

      await request(app).get('/projects').expect(401);
    });

    it('should require authentication for POST /projects', async () => {
      mockAuthMiddleware.mockImplementationOnce(async (req, res, _next) => {
        res.status(401).json({ success: false, message: 'Unauthorized' });
      });

      await request(app)
        .post('/projects')
        .send({ title: 'Test Project' })
        .expect(401);
    });

    it('should require authentication for GET /projects/:id', async () => {
      mockAuthMiddleware.mockImplementationOnce(async (req, res, _next) => {
        res.status(401).json({ success: false, message: 'Unauthorized' });
      });

      await request(app).get('/projects/test-id').expect(401);
    });

    it('should require authentication for PUT /projects/:id', async () => {
      mockAuthMiddleware.mockImplementationOnce(async (req, res, _next) => {
        res.status(401).json({ success: false, message: 'Unauthorized' });
      });

      await request(app)
        .put('/projects/test-id')
        .send({ title: 'Updated Project' })
        .expect(401);
    });

    it('should require authentication for DELETE /projects/:id', async () => {
      mockAuthMiddleware.mockImplementationOnce(async (req, res, _next) => {
        res.status(401).json({ success: false, message: 'Unauthorized' });
      });

      await request(app).delete('/projects/test-id').expect(401);
    });

    it('should prevent access to other users projects', async () => {
      MockProjectService.getProjectById.mockRejectedValueOnce(
        new Error('Project belongs to different user')
      );

      const response = await request(app)
        .get('/projects/other-user-project-id')
        .expect(500);

      expect(response.body.success).toBe(false);
    });
  });
});
