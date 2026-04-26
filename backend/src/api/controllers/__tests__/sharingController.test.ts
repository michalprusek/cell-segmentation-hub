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
import {
  shareProjectByEmail,
  shareProjectByLink,
  getProjectShares,
  revokeProjectShare,
  getSharedProjects,
  acceptShareInvitation,
} from '../sharingController';
import * as SharingService from '../../../services/sharingService';
import { authenticate } from '../../../middleware/auth';
import { logger } from '../../../utils/logger';
import { ResponseHelper } from '../../../utils/response';

// Mock all dependencies
vi.mock('../../../services/sharingService');
vi.mock('../../../middleware/auth');
vi.mock('../../../utils/logger');
vi.mock('../../../utils/response', () => ({
  asyncHandler: (fn: any) => fn,
  ResponseHelper: {
    success: vi.fn(),
    notFound: vi.fn(),
    unauthorized: vi.fn(),
    forbidden: vi.fn(),
    badRequest: vi.fn(),
    internalError: vi.fn(),
    validationError: vi.fn(),
    conflict: vi.fn(),
    rateLimit: vi.fn(),
    serviceUnavailable: vi.fn(),
    error: vi.fn(),
    paginated: vi.fn(),
  },
}));
vi.mock('../../../utils/config', () => ({
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
    FRONTEND_URL: 'http://localhost:3000',
    ALLOWED_ORIGINS: 'http://localhost:3000',
    WS_ALLOWED_ORIGINS: 'http://localhost:3000',
  },
}));

// Double-cast via unknown to avoid both `never` inference and TS overlap errors
const MockedSharingService = SharingService as unknown as Record<string, Mock<any>>;
const mockAuthMiddleware = authenticate as MockedFunction<typeof authenticate>;
const MockedResponseHelper = ResponseHelper as Mocked<typeof ResponseHelper>;
const mockedLogger = logger as Mocked<typeof logger>;

describe('SharingController', () => {
  let app: express.Application;

  const mockUser = {
    id: 'user-id',
    email: 'test@example.com',
    emailVerified: true,
  };

  const projectId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
  const shareId = 'c3d4e5f6-a7b8-9012-cdef-123456789012';
  const shareToken = 'token-abc123';

  const mockShare = {
    id: shareId,
    projectId,
    email: 'recipient@example.com',
    status: 'pending',
    shareToken,
    tokenExpiry: new Date('2025-01-01'),
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    sharedById: mockUser.id,
    sharedWithId: null,
  };

  function installResponseMocks() {
    (MockedResponseHelper.success as Mock).mockImplementation(
      (res: express.Response, data: unknown, message: string, statusCode: number = 200) => {
        return res.status(statusCode).json({ success: true, data, message });
      }
    );
    (MockedResponseHelper.notFound as Mock).mockImplementation(
      (res: express.Response, message: string) => {
        return res.status(404).json({ success: false, error: message });
      }
    );
    (MockedResponseHelper.unauthorized as Mock).mockImplementation(
      (res: express.Response, message: string) => {
        return res.status(401).json({ success: false, error: message });
      }
    );
    (MockedResponseHelper.forbidden as Mock).mockImplementation(
      (res: express.Response, message: string) => {
        return res.status(403).json({ success: false, error: message });
      }
    );
    (MockedResponseHelper.badRequest as Mock).mockImplementation(
      (res: express.Response, message: string) => {
        return res.status(400).json({ success: false, error: message });
      }
    );
    (MockedResponseHelper.internalError as Mock).mockImplementation(
      (res: express.Response, _err: unknown, message: string) => {
        return res.status(500).json({ success: false, error: message });
      }
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();
    installResponseMocks();

    app = express();
    app.use(express.json());

    // Auth injects user by default
    mockAuthMiddleware.mockImplementation(
      async (
        req: express.Request & { user?: Record<string, unknown> },
        _res: express.Response,
        next: express.NextFunction
      ) => {
        req.user = mockUser;
        next();
      }
    );

    mockedLogger.info = vi.fn() as MockedFunction<typeof logger.info>;
    mockedLogger.error = vi.fn() as MockedFunction<typeof logger.error>;
    mockedLogger.debug = vi.fn() as MockedFunction<typeof logger.debug>;

    // Register routes
    app.post('/projects/:id/share/email', mockAuthMiddleware, shareProjectByEmail);
    app.post('/projects/:id/share/link', mockAuthMiddleware, shareProjectByLink);
    app.get('/projects/:id/shares', mockAuthMiddleware, getProjectShares);
    app.delete('/projects/:id/shares/:shareId', mockAuthMiddleware, revokeProjectShare);
    app.get('/projects/shared', mockAuthMiddleware, getSharedProjects);
    app.post('/share/accept/:token', acceptShareInvitation);
    app.post('/share/accept-auth/:token', mockAuthMiddleware, acceptShareInvitation);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetAllMocks();
  });

  describe('shareProjectByEmail', () => {
    it('should share project and return share details', async () => {
      (MockedSharingService.hasProjectAccess as Mock<any>).mockResolvedValueOnce({
        hasAccess: true,
        isOwner: true,
      });
      (MockedSharingService.shareProjectByEmail as Mock<any>).mockResolvedValueOnce(mockShare);
      installResponseMocks();

      const response = await request(app)
        .post(`/projects/${projectId}/share/email`)
        .send({ email: 'recipient@example.com' })
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toMatchObject({ email: 'recipient@example.com' });
    });

    it('should return 401 when not authenticated', async () => {
      mockAuthMiddleware.mockImplementationOnce(
        async (
          req: express.Request & { user?: Record<string, unknown> },
          _res: express.Response,
          next: express.NextFunction
        ) => {
          req.user = undefined;
          next();
        }
      );

      const response = await request(app)
        .post(`/projects/${projectId}/share/email`)
        .send({ email: 'recipient@example.com' })
        .expect(401);

      expect(response.body.success).toBe(false);
    });

    it('should return 404 when project not found', async () => {
      (MockedSharingService.hasProjectAccess as Mock<any>).mockResolvedValueOnce({
        hasAccess: false,
        isOwner: false,
      });
      installResponseMocks();

      const response = await request(app)
        .post(`/projects/${projectId}/share/email`)
        .send({ email: 'recipient@example.com' })
        .expect(404);

      expect(response.body.success).toBe(false);
    });

    it('should return 403 when user is not the project owner', async () => {
      (MockedSharingService.hasProjectAccess as Mock<any>).mockResolvedValueOnce({
        hasAccess: true,
        isOwner: false,
      });
      installResponseMocks();

      const response = await request(app)
        .post(`/projects/${projectId}/share/email`)
        .send({ email: 'recipient@example.com' })
        .expect(403);

      expect(response.body.success).toBe(false);
    });

    it('should return 400 when project already shared with user', async () => {
      (MockedSharingService.hasProjectAccess as Mock<any>).mockResolvedValueOnce({
        hasAccess: true,
        isOwner: true,
      });
      (MockedSharingService.shareProjectByEmail as Mock<any>).mockRejectedValueOnce(
        new Error('Project is already shared with this user')
      );
      installResponseMocks();

      const response = await request(app)
        .post(`/projects/${projectId}/share/email`)
        .send({ email: 'recipient@example.com' })
        .expect(400);

      expect(response.body.success).toBe(false);
    });

    it('should return 500 on unexpected service error', async () => {
      (MockedSharingService.hasProjectAccess as Mock<any>).mockResolvedValueOnce({
        hasAccess: true,
        isOwner: true,
      });
      (MockedSharingService.shareProjectByEmail as Mock<any>).mockRejectedValueOnce(
        new Error('Unexpected DB failure')
      );
      installResponseMocks();

      const response = await request(app)
        .post(`/projects/${projectId}/share/email`)
        .send({ email: 'recipient@example.com' })
        .expect(500);

      expect(response.body.success).toBe(false);
    });
  });

  describe('shareProjectByLink', () => {
    it('should generate shareable link successfully', async () => {
      (MockedSharingService.hasProjectAccess as Mock<any>).mockResolvedValueOnce({
        hasAccess: true,
        isOwner: true,
      });
      (MockedSharingService.shareProjectByLink as Mock<any>).mockResolvedValueOnce({
        ...mockShare,
        shareToken,
        tokenExpiry: new Date('2025-01-01'),
      });
      installResponseMocks();

      const response = await request(app)
        .post(`/projects/${projectId}/share/link`)
        .send({})
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('shareToken');
    });

    it('should return 401 when not authenticated', async () => {
      mockAuthMiddleware.mockImplementationOnce(
        async (
          req: express.Request & { user?: Record<string, unknown> },
          _res: express.Response,
          next: express.NextFunction
        ) => {
          req.user = undefined;
          next();
        }
      );

      const response = await request(app)
        .post(`/projects/${projectId}/share/link`)
        .send({})
        .expect(401);

      expect(response.body.success).toBe(false);
    });

    it('should return 403 when user is not owner', async () => {
      (MockedSharingService.hasProjectAccess as Mock<any>).mockResolvedValueOnce({
        hasAccess: true,
        isOwner: false,
      });
      installResponseMocks();

      const response = await request(app)
        .post(`/projects/${projectId}/share/link`)
        .send({})
        .expect(403);

      expect(response.body.success).toBe(false);
    });
  });

  describe('getProjectShares', () => {
    it('should return list of shares for a project', async () => {
      (MockedSharingService.hasProjectAccess as Mock<any>).mockResolvedValueOnce({
        hasAccess: true,
        isOwner: true,
      });
      (MockedSharingService.getProjectShares as Mock<any>).mockResolvedValueOnce([
        { ...mockShare, sharedWith: null },
      ]);
      installResponseMocks();

      const response = await request(app)
        .get(`/projects/${projectId}/shares`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    it('should return 401 when not authenticated', async () => {
      mockAuthMiddleware.mockImplementationOnce(
        async (
          req: express.Request & { user?: Record<string, unknown> },
          _res: express.Response,
          next: express.NextFunction
        ) => {
          req.user = undefined;
          next();
        }
      );

      const response = await request(app)
        .get(`/projects/${projectId}/shares`)
        .expect(401);

      expect(response.body.success).toBe(false);
    });

    it('should return 404 when project not found', async () => {
      (MockedSharingService.hasProjectAccess as Mock<any>).mockResolvedValueOnce({
        hasAccess: false,
        isOwner: false,
      });
      installResponseMocks();

      const response = await request(app)
        .get(`/projects/${projectId}/shares`)
        .expect(404);

      expect(response.body.success).toBe(false);
    });
  });

  describe('revokeProjectShare', () => {
    it('should revoke share successfully', async () => {
      (MockedSharingService.revokeShare as Mock<any>).mockResolvedValueOnce(undefined);
      installResponseMocks();

      const response = await request(app)
        .delete(`/projects/${projectId}/shares/${shareId}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(MockedSharingService.revokeShare).toHaveBeenCalledWith(
        shareId,
        mockUser.id
      );
    });

    it('should return 401 when not authenticated', async () => {
      mockAuthMiddleware.mockImplementationOnce(
        async (
          req: express.Request & { user?: Record<string, unknown> },
          _res: express.Response,
          next: express.NextFunction
        ) => {
          req.user = undefined;
          next();
        }
      );

      const response = await request(app)
        .delete(`/projects/${projectId}/shares/${shareId}`)
        .expect(401);

      expect(response.body.success).toBe(false);
    });

    it('should return 404 when share not found', async () => {
      (MockedSharingService.revokeShare as Mock<any>).mockRejectedValueOnce(
        new Error('Share not found')
      );
      installResponseMocks();

      const response = await request(app)
        .delete(`/projects/${projectId}/shares/${shareId}`)
        .expect(404);

      expect(response.body.success).toBe(false);
    });
  });

  describe('acceptShareInvitation', () => {
    it('should accept share invitation when user is logged in', async () => {
      const acceptedShare = {
        share: {
          id: shareId,
          project: {
            id: projectId,
            title: 'Test Project',
            description: null,
            user: { id: 'owner-id', email: 'owner@example.com' },
          },
          sharedBy: { id: mockUser.id, email: mockUser.email },
          status: 'accepted',
          shareToken,
          sharedWithId: 'new-user-id',
        },
        needsLogin: false,
      };
      (MockedSharingService.acceptShareInvitation as Mock<any>).mockResolvedValueOnce(acceptedShare);
      installResponseMocks();

      const response = await request(app)
        .post(`/share/accept-auth/${shareToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.accepted).toBe(true);
    });

    it('should return needsLogin when user is not authenticated', async () => {
      const pendingResult = {
        share: {
          id: shareId,
          project: {
            id: projectId,
            title: 'Test Project',
            description: null,
            user: { id: 'owner-id', email: 'owner@example.com' },
          },
          sharedBy: { id: mockUser.id, email: mockUser.email },
          status: 'pending',
          shareToken,
          sharedWithId: null,
        },
        needsLogin: true,
      };
      (MockedSharingService.acceptShareInvitation as Mock<any>).mockResolvedValueOnce(pendingResult);
      installResponseMocks();

      const response = await request(app)
        .post(`/share/accept/${shareToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.needsLogin).toBe(true);
    });

    it('should return 404 for invalid or expired token', async () => {
      (MockedSharingService.acceptShareInvitation as Mock<any>).mockRejectedValueOnce(
        new Error('Invalid or expired share token')
      );
      installResponseMocks();

      const response = await request(app)
        .post('/share/accept/invalid-token')
        .expect(404);

      expect(response.body.success).toBe(false);
    });

    it('should return 400 when invitation email does not match', async () => {
      (MockedSharingService.acceptShareInvitation as Mock<any>).mockRejectedValueOnce(
        new Error('Invitation sent to a different email')
      );
      installResponseMocks();

      const response = await request(app)
        .post(`/share/accept/${shareToken}`)
        .expect(400);

      expect(response.body.success).toBe(false);
    });
  });

  describe('getSharedProjects', () => {
    it('should return projects shared with the current user', async () => {
      const mockSharedProjects = [
        {
          id: shareId,
          projectId,
          project: {
            id: projectId,
            title: 'Shared Project',
            description: null,
            createdAt: new Date('2024-01-01'),
            updatedAt: new Date('2024-01-01'),
            user: { id: 'owner-id', email: 'owner@example.com' },
            _count: { images: 5 },
            images: [],
          },
          sharedBy: { id: 'owner-id', email: 'owner@example.com' },
          status: 'accepted',
          createdAt: new Date('2024-01-01'),
        },
      ];
      (MockedSharingService.getSharedProjects as Mock<any>).mockResolvedValueOnce(mockSharedProjects);
      installResponseMocks();

      const response = await request(app)
        .get('/projects/shared')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    it('should return empty array when no shared projects', async () => {
      (MockedSharingService.getSharedProjects as Mock<any>).mockResolvedValueOnce([]);
      installResponseMocks();

      const response = await request(app)
        .get('/projects/shared')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual([]);
    });

    it('should return 401 when not authenticated', async () => {
      mockAuthMiddleware.mockImplementationOnce(
        async (
          req: express.Request & { user?: Record<string, unknown> },
          _res: express.Response,
          next: express.NextFunction
        ) => {
          req.user = undefined;
          next();
        }
      );

      const response = await request(app)
        .get('/projects/shared')
        .expect(401);

      expect(response.body.success).toBe(false);
    });

    it('should return 500 on service error', async () => {
      (MockedSharingService.getSharedProjects as Mock<any>).mockRejectedValueOnce(
        new Error('DB connection lost')
      );
      installResponseMocks();

      const response = await request(app)
        .get('/projects/shared')
        .expect(500);

      expect(response.body.success).toBe(false);
    });
  });
});
