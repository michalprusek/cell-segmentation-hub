/**
 * projectController.gaps.test.ts
 *
 * Covers branches NOT tested by projects.controller.test.ts:
 *  - getProjectStats: success, not-found (null), service error, no-auth
 *  - getProjects: invalid page param, invalid limit param (>100, <1, non-integer),
 *    invalid sortOrder, folderId query forwarding, Cache-Control headers
 *  - createProject / getProject / updateProject / deleteProject: no-auth paths
 *  - deleteProject: null result (project not found → 404)
 *  - updateProject: null result (project not found → 404)
 */

import request from 'supertest';
import express from 'express';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('../../../utils/config', () => ({
  config: {
    NODE_ENV: 'test',
    PORT: 3001,
    HOST: 'localhost',
    DATABASE_URL: 'file:./test.db',
    JWT_ACCESS_SECRET: 'test-access-secret-for-testing-only-32-characters-long',
    JWT_REFRESH_SECRET:
      'test-refresh-secret-for-testing-only-32-characters-long',
    JWT_ACCESS_EXPIRY: '15m',
    JWT_REFRESH_EXPIRY: '7d',
    JWT_REFRESH_EXPIRY_REMEMBER: '30d',
    ALLOWED_ORIGINS: 'http://localhost:3000',
    WS_ALLOWED_ORIGINS: 'http://localhost:3000',
  },
}));

vi.mock('../../../services/projectService');
vi.mock('../../../middleware/auth');
vi.mock('../../../utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// ── Imports ───────────────────────────────────────────────────────────────────

import * as projectService from '../../../services/projectService';
import { authenticate } from '../../../middleware/auth';
import {
  createProject,
  getProjects,
  getProject,
  updateProject,
  deleteProject,
  getProjectStats,
} from '../projectController';

const MockProjectService = projectService as Mocked<typeof projectService>;
const mockAuth = authenticate as ReturnType<typeof vi.fn>;

// ── Fixtures ──────────────────────────────────────────────────────────────────

const mockUser = {
  id: 'user-123',
  email: 'u@test.com',
  emailVerified: true,
};

const mockProject = {
  id: 'proj-abc',
  title: 'My Project',
  userId: 'user-123',
  _count: { images: 3 },
};

// ── Setup ─────────────────────────────────────────────────────────────────────

function makeApp(injectUser = true) {
  const app = express();
  app.use(express.json());

  if (injectUser) {
    mockAuth.mockImplementation(async (req: express.Request, _res, next) => {
      (req as any).user = mockUser;
      next();
    });
  } else {
    // Simulate auth middleware that does NOT populate req.user (missing JWT etc.)
    // The controller checks req.user itself — we just call next() without setting it.
    mockAuth.mockImplementation(async (_req, _res, next) => {
      next();
    });
  }

  app.get('/projects', mockAuth, getProjects);
  app.post('/projects', mockAuth, createProject);
  app.get('/projects/:id', mockAuth, getProject);
  app.put('/projects/:id', mockAuth, updateProject);
  app.delete('/projects/:id', mockAuth, deleteProject);
  app.get('/projects/:id/stats', mockAuth, getProjectStats);

  return app;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('projectController — uncovered branches', () => {
  let app: express.Application;

  beforeEach(() => {
    vi.clearAllMocks();
    app = makeApp(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // getProjectStats
  // =========================================================================
  describe('GET /projects/:id/stats', () => {
    it('returns 200 with stats when project exists', async () => {
      const stats = { totalImages: 5, segmentedImages: 3, pendingImages: 2 };
      MockProjectService.getProjectStats.mockResolvedValueOnce(stats as any);

      const res = await request(app)
        .get(`/projects/${mockProject.id}/stats`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toMatchObject({ totalImages: 5 });
      expect(MockProjectService.getProjectStats).toHaveBeenCalledWith(
        mockProject.id,
        mockUser.id
      );
    });

    it('returns 404 when getProjectStats returns null', async () => {
      MockProjectService.getProjectStats.mockResolvedValueOnce(null as any);

      const res = await request(app)
        .get('/projects/missing-id/stats')
        .expect(404);

      expect(res.body.success).toBe(false);
    });

    it('returns 500 when getProjectStats throws', async () => {
      MockProjectService.getProjectStats.mockRejectedValueOnce(
        new Error('DB error')
      );

      const res = await request(app)
        .get(`/projects/${mockProject.id}/stats`)
        .expect(500);

      expect(res.body.success).toBe(false);
    });

    it('returns 401 when req.user is absent', async () => {
      const noAuthApp = makeApp(false);

      const res = await request(noAuthApp)
        .get('/projects/any-id/stats')
        .expect(401);

      expect(res.body.success).toBe(false);
      expect(MockProjectService.getProjectStats).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // getProjects — query parameter validation
  // =========================================================================
  describe('GET /projects — query parameter validation', () => {
    it('returns 400 when page is 0 (below 1)', async () => {
      const res = await request(app).get('/projects?page=0').expect(400);
      expect(res.body.success).toBe(false);
    });

    it('returns 400 when page is -5', async () => {
      const res = await request(app).get('/projects?page=-5').expect(400);
      expect(res.body.success).toBe(false);
    });

    it('returns 400 when page is 1.5 (non-integer)', async () => {
      const res = await request(app).get('/projects?page=1.5').expect(400);
      expect(res.body.success).toBe(false);
    });

    it('returns 400 when limit is 0', async () => {
      const res = await request(app).get('/projects?limit=0').expect(400);
      expect(res.body.success).toBe(false);
    });

    it('returns 400 when limit is 101 (above 100)', async () => {
      const res = await request(app).get('/projects?limit=101').expect(400);
      expect(res.body.success).toBe(false);
    });

    it('returns 400 when limit is 2.7 (non-integer)', async () => {
      const res = await request(app).get('/projects?limit=2.7').expect(400);
      expect(res.body.success).toBe(false);
    });

    it('returns 400 when sortOrder is "INVALID"', async () => {
      const res = await request(app)
        .get('/projects?sortOrder=INVALID')
        .expect(400);
      expect(res.body.success).toBe(false);
    });

    it('returns 400 when sortOrder is "ascending" (not asc/desc)', async () => {
      const res = await request(app)
        .get('/projects?sortOrder=ascending')
        .expect(400);
      expect(res.body.success).toBe(false);
    });

    it('accepts sortOrder=asc and forwards it to service', async () => {
      MockProjectService.getUserProjects.mockResolvedValueOnce({
        projects: [],
        pagination: { page: 1, limit: 10, total: 0, totalPages: 0 },
      } as any);

      await request(app).get('/projects?sortOrder=asc').expect(200);

      expect(MockProjectService.getUserProjects).toHaveBeenCalledWith(
        mockUser.id,
        expect.objectContaining({ sortOrder: 'asc' })
      );
    });

    it('accepts sortOrder=desc and forwards it to service', async () => {
      MockProjectService.getUserProjects.mockResolvedValueOnce({
        projects: [],
        pagination: { page: 1, limit: 10, total: 0, totalPages: 0 },
      } as any);

      await request(app).get('/projects?sortOrder=desc').expect(200);

      expect(MockProjectService.getUserProjects).toHaveBeenCalledWith(
        mockUser.id,
        expect.objectContaining({ sortOrder: 'desc' })
      );
    });

    it('forwards folderId query param to service', async () => {
      MockProjectService.getUserProjects.mockResolvedValueOnce({
        projects: [],
        pagination: { page: 1, limit: 10, total: 0, totalPages: 0 },
      } as any);

      await request(app).get('/projects?folderId=folder-xyz').expect(200);

      expect(MockProjectService.getUserProjects).toHaveBeenCalledWith(
        mockUser.id,
        expect.objectContaining({ folderId: 'folder-xyz' })
      );
    });

    it('sets Cache-Control no-cache headers on successful list response', async () => {
      MockProjectService.getUserProjects.mockResolvedValueOnce({
        projects: [],
        pagination: { page: 1, limit: 10, total: 0, totalPages: 0 },
      } as any);

      const res = await request(app).get('/projects').expect(200);

      expect(res.headers['cache-control']).toMatch(/no-cache/);
    });

    it('returns 401 when req.user absent on GET /projects', async () => {
      const noAuthApp = makeApp(false);
      const res = await request(noAuthApp).get('/projects').expect(401);
      expect(res.body.success).toBe(false);
      expect(MockProjectService.getUserProjects).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // createProject — no-auth guard
  // =========================================================================
  describe('POST /projects — no-auth guard', () => {
    it('returns 401 when req.user is absent', async () => {
      const noAuthApp = makeApp(false);
      const res = await request(noAuthApp)
        .post('/projects')
        .send({ title: 'X' })
        .expect(401);
      expect(res.body.success).toBe(false);
      expect(MockProjectService.createProject).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // getProject — no-auth guard
  // =========================================================================
  describe('GET /projects/:id — no-auth guard', () => {
    it('returns 401 when req.user is absent', async () => {
      const noAuthApp = makeApp(false);
      const res = await request(noAuthApp).get('/projects/some-id').expect(401);
      expect(res.body.success).toBe(false);
      expect(MockProjectService.getProjectById).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // updateProject — null result (not found) + no-auth
  // =========================================================================
  describe('PUT /projects/:id', () => {
    it('returns 404 when updateProject returns null', async () => {
      MockProjectService.updateProject.mockResolvedValueOnce(null);

      const res = await request(app)
        .put('/projects/ghost-id')
        .send({ title: 'New Title' })
        .expect(404);

      expect(res.body.success).toBe(false);
    });

    it('returns 401 when req.user is absent', async () => {
      const noAuthApp = makeApp(false);
      const res = await request(noAuthApp)
        .put('/projects/some-id')
        .send({ title: 'X' })
        .expect(401);
      expect(res.body.success).toBe(false);
      expect(MockProjectService.updateProject).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // deleteProject — null result (not found) + no-auth
  // =========================================================================
  describe('DELETE /projects/:id', () => {
    it('returns 404 when deleteProject returns null', async () => {
      MockProjectService.deleteProject.mockResolvedValueOnce(null);

      const res = await request(app).delete('/projects/ghost-id').expect(404);

      expect(res.body.success).toBe(false);
    });

    it('returns 401 when req.user is absent', async () => {
      const noAuthApp = makeApp(false);
      const res = await request(noAuthApp)
        .delete('/projects/some-id')
        .expect(401);
      expect(res.body.success).toBe(false);
      expect(MockProjectService.deleteProject).not.toHaveBeenCalled();
    });

    it('returns the deletedImagesCount from _count.images in the response', async () => {
      MockProjectService.deleteProject.mockResolvedValueOnce({
        id: 'proj-abc',
        title: 'Gone Project',
        _count: { images: 7 },
      } as any);

      const res = await request(app).delete('/projects/proj-abc').expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toMatchObject({
        id: 'proj-abc',
        title: 'Gone Project',
        deletedImagesCount: 7,
      });
    });
  });
});
