import request from 'supertest';
import express from 'express';
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from 'vitest';
import type { MockedFunction } from 'vitest';
import sharingRoutes from '../sharingRoutes';
import { authenticate, optionalAuthenticate } from '../../../middleware/auth';
import { logger } from '../../../utils/logger';

// Mock config and jwt early to prevent process.exit during module loading
vi.mock('../../../utils/config', () => ({
  config: {
    NODE_ENV: 'test',
    PORT: 3001,
    JWT_ACCESS_SECRET: 'test-access-secret-for-testing-only-32-characters-long',
    JWT_REFRESH_SECRET: 'test-refresh-secret-for-testing-only-32-characters-long',
    JWT_ACCESS_EXPIRY: '15m',
    JWT_REFRESH_EXPIRY: '7d',
    ALLOWED_ORIGINS: 'http://localhost:3000',
    REDIS_URL: 'redis://localhost:6379',
    FROM_EMAIL: 'test@example.com',
    EMAIL_SERVICE: 'none',
    REQUIRE_EMAIL_VERIFICATION: false,
  },
  isDevelopment: false,
  isProduction: false,
  isTest: true,
  getOrigins: () => ['http://localhost:3000'],
}));
vi.mock('../../../auth/jwt');

// Mock dependencies before imports
vi.mock('../../../middleware/auth');
vi.mock('../../../middleware/validation', () => ({
  validateBody: () => (_req: any, _res: any, next: any) => next(),
  validateParams: () => (_req: any, _res: any, next: any) => next(),
}));
vi.mock('../../../utils/logger');
vi.mock('../../../services/sharingService');
vi.mock('../../../utils/response', () => ({
  ResponseHelper: {
    success: (res: any, data: any, message: any, statusCode: any) =>
      res.status(statusCode ?? 200).json({ success: true, data, message }),
    unauthorized: (res: any, message: any) =>
      res.status(401).json({ success: false, message }),
    notFound: (res: any, message: any) =>
      res.status(404).json({ success: false, message }),
    badRequest: (res: any, message: any) =>
      res.status(400).json({ success: false, message }),
    forbidden: (res: any, message: any) =>
      res.status(403).json({ success: false, message }),
    internalError: (res: any, _err: any, message: any) =>
      res.status(500).json({ success: false, message }),
  },
  asyncHandler: (fn: any) => async (req: any, res: any, next: any) => {
    try {
      await fn(req, res, next);
    } catch (err) {
      next(err);
    }
  },
}));

import * as SharingService from '../../../services/sharingService';

const mockedAuthenticate = authenticate as MockedFunction<
  typeof authenticate
>;
const mockedOptionalAuthenticate = optionalAuthenticate as MockedFunction<
  typeof optionalAuthenticate
>;
const mockedLogger = logger as Mocked<typeof logger>;
const mockedSharingService = SharingService as Mocked<
  typeof SharingService
>;

const mockUser = {
  id: 'user-id-123',
  email: 'owner@example.com',
  emailVerified: true,
};

const mockShare = {
  id: 'share-id-abc',
  email: 'recipient@example.com',
  status: 'pending',
  shareToken: 'tok-abc123',
  tokenExpiry: new Date('2026-04-30'),
  createdAt: new Date('2026-03-29'),
  updatedAt: new Date('2026-03-29'),
  projectId: 'project-id-xyz',
  sharedById: 'user-id-123',
  sharedWithId: null,
};

describe('Sharing Routes', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    vi.clearAllMocks();

    mockedLogger.info = vi.fn() as any;
    mockedLogger.error = vi.fn() as any;
    mockedLogger.warn = vi.fn() as any;
    mockedLogger.debug = vi.fn() as any;

    mockedAuthenticate.mockImplementation(
      ((req: any, _res: any, next: any) => {
        req.user = mockUser;
        next();
      }) as any
    );

    mockedOptionalAuthenticate.mockImplementation(
      ((req: any, _res: any, next: any) => {
        req.user = mockUser;
        next();
      }) as any
    );

    app.use('/api', sharingRoutes);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  describe('POST /api/projects/:id/share/email', () => {
    it('should share a project by email when user is authenticated and owns project', async () => {
      (mockedSharingService.hasProjectAccess as any) = jest
        .fn<any>()
        .mockResolvedValue({ hasAccess: true, isOwner: true });
      (mockedSharingService.shareProjectByEmail as any) = jest
        .fn<any>()
        .mockResolvedValue(mockShare);

      const response = await request(app)
        .post('/api/projects/project-id-xyz/share/email')
        .set('Authorization', 'Bearer valid-token')
        .send({ email: 'recipient@example.com', permission: 'view' })
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.email).toBe('recipient@example.com');
      expect(mockedAuthenticate).toHaveBeenCalled();
    });

    it('should return 401 when not authenticated', async () => {
      mockedAuthenticate.mockImplementation(
        ((_req: any, res: any) => {
          res
            .status(401)
            .json({ success: false, message: 'Chybí autentizační token' });
        }) as any
      );

      const response = await request(app)
        .post('/api/projects/project-id-xyz/share/email')
        .send({ email: 'recipient@example.com' })
        .expect(401);

      expect(response.body.success).toBe(false);
    });

    it('should return 403 when user does not own the project', async () => {
      (mockedSharingService.hasProjectAccess as any) = jest
        .fn<any>()
        .mockResolvedValue({ hasAccess: true, isOwner: false });

      const response = await request(app)
        .post('/api/projects/project-id-xyz/share/email')
        .set('Authorization', 'Bearer valid-token')
        .send({ email: 'recipient@example.com' })
        .expect(403);

      expect(response.body.success).toBe(false);
    });

    it('should return 404 when project does not exist', async () => {
      (mockedSharingService.hasProjectAccess as any) = jest
        .fn<any>()
        .mockResolvedValue({ hasAccess: false, isOwner: false });

      const response = await request(app)
        .post('/api/projects/missing-project/share/email')
        .set('Authorization', 'Bearer valid-token')
        .send({ email: 'recipient@example.com' })
        .expect(404);

      expect(response.body.success).toBe(false);
    });

    it('should return 400 when project already shared with that email', async () => {
      (mockedSharingService.hasProjectAccess as any) = jest
        .fn<any>()
        .mockResolvedValue({ hasAccess: true, isOwner: true });
      (mockedSharingService.shareProjectByEmail as any) = jest
        .fn<any>()
        .mockRejectedValue(
          new Error('Project is already shared with this user')
        );

      const response = await request(app)
        .post('/api/projects/project-id-xyz/share/email')
        .set('Authorization', 'Bearer valid-token')
        .send({ email: 'existing@example.com' })
        .expect(400);

      expect(response.body.success).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  describe('POST /api/projects/:id/share/link', () => {
    it('should generate a shareable link for an owned project', async () => {
      (mockedSharingService.hasProjectAccess as any) = jest
        .fn<any>()
        .mockResolvedValue({ hasAccess: true, isOwner: true });
      (mockedSharingService.shareProjectByLink as any) = jest
        .fn<any>()
        .mockResolvedValue(mockShare);

      const response = await request(app)
        .post('/api/projects/project-id-xyz/share/link')
        .set('Authorization', 'Bearer valid-token')
        .send({ permission: 'view' })
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('shareToken');
      expect(mockedAuthenticate).toHaveBeenCalled();
    });

    it('should return 401 without authentication', async () => {
      mockedAuthenticate.mockImplementation(
        ((_req: any, res: any) => {
          res
            .status(401)
            .json({ success: false, message: 'Chybí autentizační token' });
        }) as any
      );

      await request(app)
        .post('/api/projects/project-id-xyz/share/link')
        .send({ permission: 'view' })
        .expect(401);
    });

    it('should return 403 when user is not the owner', async () => {
      (mockedSharingService.hasProjectAccess as any) = jest
        .fn<any>()
        .mockResolvedValue({ hasAccess: true, isOwner: false });

      await request(app)
        .post('/api/projects/project-id-xyz/share/link')
        .set('Authorization', 'Bearer valid-token')
        .send({ permission: 'view' })
        .expect(403);
    });
  });

  // -------------------------------------------------------------------------
  describe('GET /api/projects/:id/shares', () => {
    it('should return list of shares when user has access', async () => {
      (mockedSharingService.hasProjectAccess as any) = jest
        .fn<any>()
        .mockResolvedValue({ hasAccess: true, isOwner: true });
      (mockedSharingService.getProjectShares as any) = jest
        .fn<any>()
        .mockResolvedValue([{ ...mockShare, sharedWith: null }]);

      const response = await request(app)
        .get('/api/projects/project-id-xyz/shares')
        .set('Authorization', 'Bearer valid-token')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    it('should return 401 when not authenticated', async () => {
      mockedAuthenticate.mockImplementation(
        ((_req: any, res: any) => {
          res
            .status(401)
            .json({ success: false, message: 'Chybí autentizační token' });
        }) as any
      );

      await request(app)
        .get('/api/projects/project-id-xyz/shares')
        .expect(401);
    });

    it('should return 404 when project not found', async () => {
      (mockedSharingService.hasProjectAccess as any) = jest
        .fn<any>()
        .mockResolvedValue({ hasAccess: false, isOwner: false });

      await request(app)
        .get('/api/projects/missing-project/shares')
        .set('Authorization', 'Bearer valid-token')
        .expect(404);
    });
  });

  // -------------------------------------------------------------------------
  describe('DELETE /api/projects/:id/shares/:shareId', () => {
    it('should revoke a share when user is authenticated', async () => {
      (mockedSharingService.revokeShare as any) = jest
        .fn<any>()
        .mockResolvedValue(undefined);

      const response = await request(app)
        .delete('/api/projects/project-id-xyz/shares/share-id-abc')
        .set('Authorization', 'Bearer valid-token')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(mockedSharingService.revokeShare).toHaveBeenCalledWith(
        'share-id-abc',
        mockUser.id
      );
    });

    it('should return 401 when not authenticated', async () => {
      mockedAuthenticate.mockImplementation(
        ((_req: any, res: any) => {
          res
            .status(401)
            .json({ success: false, message: 'Chybí autentizační token' });
        }) as any
      );

      await request(app)
        .delete('/api/projects/project-id-xyz/shares/share-id-abc')
        .expect(401);
    });

    it('should return 404 when share not found or access denied', async () => {
      (mockedSharingService.revokeShare as any) = jest
        .fn<any>()
        .mockRejectedValue(new Error('Share not found'));

      await request(app)
        .delete('/api/projects/project-id-xyz/shares/nonexistent-share')
        .set('Authorization', 'Bearer valid-token')
        .expect(404);
    });
  });

  // -------------------------------------------------------------------------
  describe('GET /api/shared/projects', () => {
    it('should return projects shared with the authenticated user', async () => {
      (mockedSharingService.getSharedProjects as any) = jest
        .fn<any>()
        .mockResolvedValue([]);

      const response = await request(app)
        .get('/api/shared/projects')
        .set('Authorization', 'Bearer valid-token')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    it('should return 401 without authentication', async () => {
      mockedAuthenticate.mockImplementation(
        ((_req: any, res: any) => {
          res
            .status(401)
            .json({ success: false, message: 'Chybí autentizační token' });
        }) as any
      );

      await request(app).get('/api/shared/projects').expect(401);
    });

    it('should return formatted project list when shares exist', async () => {
      const fullShare = {
        ...mockShare,
        project: {
          id: 'project-id-xyz',
          title: 'Test Project',
          description: 'A description',
          createdAt: new Date(),
          updatedAt: new Date(),
          userId: 'user-id-123',
          user: { id: 'user-id-123', email: 'owner@example.com' },
          _count: { images: 5 },
          images: [],
        },
        sharedBy: { id: 'user-id-123', email: 'owner@example.com' },
      };
      (mockedSharingService.getSharedProjects as any) = jest
        .fn<any>()
        .mockResolvedValue([fullShare]);

      const response = await request(app)
        .get('/api/shared/projects')
        .set('Authorization', 'Bearer valid-token')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.length).toBe(1);
      expect(response.body.data[0].project.title).toBe('Test Project');
    });
  });

  // -------------------------------------------------------------------------
  describe('GET /api/share/validate/:token', () => {
    it('should validate a share token without requiring authentication', async () => {
      mockedOptionalAuthenticate.mockImplementation(
        ((_req: any, _res: any, next: any) => {
          next();
        }) as any
      );
      (mockedSharingService.validateShareToken as any) = jest
        .fn<any>()
        .mockResolvedValue({
          id: 'share-id-abc',
          email: 'recipient@example.com',
          status: 'pending',
          shareToken: 'valid-token-xyz',
          tokenExpiry: new Date('2026-04-30'),
          sharedWithId: null,
          project: {
            id: 'project-id-xyz',
            title: 'Shared Project',
            description: null,
            user: { id: 'user-id-123', email: 'owner@example.com' },
          },
          sharedBy: { id: 'user-id-123', email: 'owner@example.com' },
        });

      const response = await request(app)
        .get('/api/share/validate/valid-token-xyz')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.project.title).toBe('Shared Project');
      expect(mockedAuthenticate).not.toHaveBeenCalled();
    });

    it('should return 404 for an invalid or expired token', async () => {
      mockedOptionalAuthenticate.mockImplementation(
        ((_req: any, _res: any, next: any) => {
          next();
        }) as any
      );
      (mockedSharingService.validateShareToken as any) = jest
        .fn<any>()
        .mockResolvedValue(null);

      await request(app).get('/api/share/validate/expired-token').expect(404);
    });

    it('should set needsLogin to true when user is not authenticated', async () => {
      mockedOptionalAuthenticate.mockImplementation(
        ((req: any, _res: any, next: any) => {
          req.user = undefined;
          next();
        }) as any
      );
      (mockedSharingService.validateShareToken as any) = jest
        .fn<any>()
        .mockResolvedValue({
          id: 'share-id-abc',
          email: 'recipient@example.com',
          status: 'pending',
          shareToken: 'valid-token-xyz',
          tokenExpiry: null,
          sharedWithId: null,
          project: {
            id: 'project-id-xyz',
            title: 'Shared Project',
            description: null,
            user: { id: 'user-id-123', email: 'owner@example.com' },
          },
          sharedBy: { id: 'user-id-123', email: 'owner@example.com' },
        });

      const response = await request(app)
        .get('/api/share/validate/valid-token-xyz')
        .expect(200);

      expect(response.body.data.needsLogin).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  describe('POST /api/share/accept/:token', () => {
    it('should accept a share invitation when authenticated', async () => {
      (mockedSharingService.acceptShareInvitation as any) = jest
        .fn<any>()
        .mockResolvedValue({
          needsLogin: false,
          share: {
            id: 'share-id-abc',
            email: 'recipient@example.com',
            status: 'accepted',
            shareToken: 'valid-token-xyz',
            tokenExpiry: null,
            sharedWithId: 'user-id-456',
            project: {
              id: 'project-id-xyz',
              title: 'Shared Project',
              description: null,
              user: { id: 'user-id-123', email: 'owner@example.com' },
            },
            sharedBy: { id: 'user-id-123', email: 'owner@example.com' },
          },
        });

      const response = await request(app)
        .post('/api/share/accept/valid-token-xyz')
        .set('Authorization', 'Bearer valid-token')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.accepted).toBe(true);
    });

    it('should indicate needsLogin when unauthenticated user tries to accept', async () => {
      mockedOptionalAuthenticate.mockImplementation(
        ((req: any, _res: any, next: any) => {
          req.user = undefined;
          next();
        }) as any
      );
      (mockedSharingService.acceptShareInvitation as any) = jest
        .fn<any>()
        .mockResolvedValue({
          needsLogin: true,
          share: {
            id: 'share-id-abc',
            email: 'recipient@example.com',
            status: 'pending',
            shareToken: 'valid-token-xyz',
            tokenExpiry: null,
            sharedWithId: null,
            project: {
              id: 'project-id-xyz',
              title: 'Shared Project',
              description: null,
              user: { id: 'user-id-123', email: 'owner@example.com' },
            },
            sharedBy: { id: 'user-id-123', email: 'owner@example.com' },
          },
        });

      const response = await request(app)
        .post('/api/share/accept/valid-token-xyz')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.needsLogin).toBe(true);
    });

    it('should return 404 for an invalid token', async () => {
      (mockedSharingService.acceptShareInvitation as any) = jest
        .fn<any>()
        .mockRejectedValue(new Error('Invalid share token'));

      await request(app)
        .post('/api/share/accept/bad-token')
        .set('Authorization', 'Bearer valid-token')
        .expect(404);
    });

    it('should return 400 when share email does not match authenticated user email', async () => {
      (mockedSharingService.acceptShareInvitation as any) = jest
        .fn<any>()
        .mockRejectedValue(new Error('Share was sent to a different email'));

      await request(app)
        .post('/api/share/accept/valid-token-xyz')
        .set('Authorization', 'Bearer valid-token')
        .expect(400);
    });
  });
});
