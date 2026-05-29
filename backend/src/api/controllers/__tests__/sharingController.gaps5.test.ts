/**
 * sharingController.gaps5.test.ts
 *
 * Covers branches still uncovered after sharingController.test.ts.
 * Uses direct function invocation with mocked req/res (no supertest/express).
 *
 *  A. shareProjectByEmail: missing projectId, error with 'not found'
 *  B. shareProjectByLink: missing projectId, hasAccess=false, error paths
 *  C. getProjectShares: missing projectId, error paths
 *  D. revokeProjectShare: missing shareId, error paths
 *  E. validateShareToken: missing token, null shareData, missing fields, error
 *  F. acceptShareInvitation: missing token, missing fields, specific error types
 */

import { describe, it, beforeEach, vi, expect } from 'vitest';

vi.mock('../../../services/sharingService');
vi.mock('../../../middleware/auth');
vi.mock('../../../utils/logger');
vi.mock('../../../utils/response', () => ({
  asyncHandler: (fn: unknown) => fn,
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
    SEGMENTATION_SERVICE_URL: 'http://localhost:8000',
    FRONTEND_URL: 'http://localhost:3000',
    JWT_ACCESS_SECRET: 'test-secret-at-least-32-chars-long-for-test',
    JWT_REFRESH_SECRET: 'test-refresh-secret-at-least-32-chars-long',
    ALLOWED_ORIGINS: 'http://localhost:3000',
    WS_ALLOWED_ORIGINS: 'http://localhost:3000',
    UPLOAD_DIR: './uploads',
    EMAIL_SERVICE: 'none',
    FROM_EMAIL: 'test@test.com',
    FROM_NAME: 'Test',
  },
}));

import * as SharingService from '../../../services/sharingService';
import { ResponseHelper } from '../../../utils/response';
import {
  shareProjectByEmail,
  shareProjectByLink,
  getProjectShares,
  revokeProjectShare,
  validateShareToken,
  acceptShareInvitation,
} from '../sharingController';

const MockedSS = SharingService as unknown as Record<
  string,
  ReturnType<typeof vi.fn>
>;
const RH = ResponseHelper as unknown as Record<
  string,
  ReturnType<typeof vi.fn>
>;

const projectId = 'proj-uuid-1234';
const mockUser = { id: 'user-1', email: 'u@test.com', emailVerified: true };

function makeReqRes(
  params: Record<string, string> = {},
  body: Record<string, unknown> = {},
  user: unknown = mockUser
) {
  const res = {
    json: vi.fn(),
    status: vi.fn().mockReturnThis(),
    set: vi.fn(),
    send: vi.fn(),
  };
  const req = {
    params,
    body,
    user,
    query: {},
  };
  return { req, res };
}

beforeEach(() => {
  vi.clearAllMocks();
  MockedSS.hasProjectAccess = vi
    .fn()
    .mockResolvedValue({ hasAccess: true, isOwner: true });
});

// ─── A. shareProjectByEmail ───────────────────────────────────────────────────

describe('shareProjectByEmail', () => {
  it('returns 400 when projectId is missing', async () => {
    const { req, res } = makeReqRes({}, { email: 'target@test.com' });
    await (shareProjectByEmail as Function)(req, res);
    expect(RH.badRequest).toHaveBeenCalledWith(res, 'Project ID is required');
  });

  it('returns 404 when service error contains "not found"', async () => {
    MockedSS.shareProjectByEmail = vi
      .fn()
      .mockRejectedValue(new Error('Project not found'));
    const { req, res } = makeReqRes({ id: projectId }, { email: 'x@test.com' });
    await (shareProjectByEmail as Function)(req, res);
    expect(RH.notFound).toHaveBeenCalled();
  });

  it('returns 500 on generic error', async () => {
    MockedSS.shareProjectByEmail = vi
      .fn()
      .mockRejectedValue(new Error('DB timeout'));
    const { req, res } = makeReqRes({ id: projectId }, { email: 'x@test.com' });
    await (shareProjectByEmail as Function)(req, res);
    expect(RH.internalError).toHaveBeenCalled();
  });
});

// ─── B. shareProjectByLink ────────────────────────────────────────────────────

describe('shareProjectByLink', () => {
  it('returns 400 when projectId is missing', async () => {
    const { req, res } = makeReqRes({}, {});
    await (shareProjectByLink as Function)(req, res);
    expect(RH.badRequest).toHaveBeenCalledWith(res, 'Project ID is required');
  });

  it('returns 404 when hasAccess=false', async () => {
    MockedSS.hasProjectAccess = vi
      .fn()
      .mockResolvedValue({ hasAccess: false, isOwner: false });
    const { req, res } = makeReqRes({ id: projectId }, {});
    await (shareProjectByLink as Function)(req, res);
    expect(RH.notFound).toHaveBeenCalledWith(res, 'Project not found');
  });

  it('returns 403 when user is not owner', async () => {
    MockedSS.hasProjectAccess = vi
      .fn()
      .mockResolvedValue({ hasAccess: true, isOwner: false });
    const { req, res } = makeReqRes({ id: projectId }, {});
    await (shareProjectByLink as Function)(req, res);
    expect(RH.forbidden).toHaveBeenCalled();
  });

  it('returns 404 when error message contains "not found"', async () => {
    MockedSS.shareProjectByLink = vi
      .fn()
      .mockRejectedValue(new Error('access denied - project not found'));
    const { req, res } = makeReqRes({ id: projectId }, {});
    await (shareProjectByLink as Function)(req, res);
    expect(RH.notFound).toHaveBeenCalled();
  });

  it('returns 500 on generic error', async () => {
    MockedSS.shareProjectByLink = vi
      .fn()
      .mockRejectedValue(new Error('Network issue'));
    const { req, res } = makeReqRes({ id: projectId }, {});
    await (shareProjectByLink as Function)(req, res);
    expect(RH.internalError).toHaveBeenCalled();
  });
});

// ─── C. getProjectShares ──────────────────────────────────────────────────────

describe('getProjectShares', () => {
  it('returns 400 when projectId is missing', async () => {
    const { req, res } = makeReqRes({});
    await (getProjectShares as Function)(req, res);
    expect(RH.badRequest).toHaveBeenCalledWith(res, 'Project ID is required');
  });

  it('returns 404 when error contains "not found"', async () => {
    MockedSS.getProjectShares = vi
      .fn()
      .mockRejectedValue(new Error('Project not found'));
    const { req, res } = makeReqRes({ id: projectId });
    await (getProjectShares as Function)(req, res);
    expect(RH.notFound).toHaveBeenCalled();
  });

  it('returns 500 on generic error', async () => {
    MockedSS.getProjectShares = vi
      .fn()
      .mockRejectedValue(new Error('DB error'));
    const { req, res } = makeReqRes({ id: projectId });
    await (getProjectShares as Function)(req, res);
    expect(RH.internalError).toHaveBeenCalled();
  });
});

// ─── D. revokeProjectShare ────────────────────────────────────────────────────

describe('revokeProjectShare', () => {
  it('returns 400 when shareId is missing', async () => {
    const { req, res } = makeReqRes({});
    await (revokeProjectShare as Function)(req, res);
    expect(RH.badRequest).toHaveBeenCalledWith(res, 'Share ID is required');
  });

  it('returns 404 when error contains "not found"', async () => {
    MockedSS.revokeShare = vi
      .fn()
      .mockRejectedValue(new Error('Share not found'));
    const { req, res } = makeReqRes({ shareId: 'share-abc' });
    await (revokeProjectShare as Function)(req, res);
    expect(RH.notFound).toHaveBeenCalled();
  });

  it('returns 500 on generic error', async () => {
    MockedSS.revokeShare = vi.fn().mockRejectedValue(new Error('DB timeout'));
    const { req, res } = makeReqRes({ shareId: 'share-abc' });
    await (revokeProjectShare as Function)(req, res);
    expect(RH.internalError).toHaveBeenCalled();
  });
});

// ─── E. validateShareToken ────────────────────────────────────────────────────

describe('validateShareToken', () => {
  it('returns 400 when token is missing', async () => {
    const { req, res } = makeReqRes({});
    await (validateShareToken as Function)(req, res);
    expect(RH.badRequest).toHaveBeenCalledWith(res, 'Token is required');
  });

  it('returns 404 when shareData is null', async () => {
    MockedSS.validateShareToken = vi.fn().mockResolvedValue(null);
    const { req, res } = makeReqRes({ token: 'tok-xyz' });
    await (validateShareToken as Function)(req, res);
    expect(RH.notFound).toHaveBeenCalledWith(
      res,
      'Invalid or expired share link'
    );
  });

  it('returns 404 when project or sharedBy is missing', async () => {
    MockedSS.validateShareToken = vi.fn().mockResolvedValue({
      project: null,
      sharedBy: null,
      status: 'pending',
      email: 'x@y.com',
    });
    const { req, res } = makeReqRes({ token: 'tok-xyz' });
    await (validateShareToken as Function)(req, res);
    expect(RH.notFound).toHaveBeenCalledWith(res, 'Invalid share data');
  });

  it('returns 500 on generic error', async () => {
    MockedSS.validateShareToken = vi
      .fn()
      .mockRejectedValue(new Error('DB timeout'));
    const { req, res } = makeReqRes({ token: 'tok-xyz' });
    await (validateShareToken as Function)(req, res);
    expect(RH.internalError).toHaveBeenCalled();
  });
});

// ─── F. acceptShareInvitation ─────────────────────────────────────────────────

describe('acceptShareInvitation', () => {
  it('returns 400 when token is missing', async () => {
    const { req, res } = makeReqRes({});
    await (acceptShareInvitation as Function)(req, res);
    expect(RH.badRequest).toHaveBeenCalledWith(res, 'Token is required');
  });

  it('returns 404 when share has no project or sharedBy', async () => {
    MockedSS.acceptShareInvitation = vi.fn().mockResolvedValue({
      share: { id: 's1', project: null, sharedBy: null },
      needsLogin: false,
    });
    const { req, res } = makeReqRes({ token: 'tok-abc' });
    await (acceptShareInvitation as Function)(req, res);
    expect(RH.notFound).toHaveBeenCalledWith(res, 'Invalid share data');
  });

  it('returns 400 when error contains "different email"', async () => {
    MockedSS.acceptShareInvitation = vi
      .fn()
      .mockRejectedValue(
        new Error('Invitation sent to a different email address')
      );
    const { req, res } = makeReqRes({ token: 'tok-abc' });
    await (acceptShareInvitation as Function)(req, res);
    expect(RH.badRequest).toHaveBeenCalled();
  });

  it('returns 404 when error contains "Invalid"', async () => {
    MockedSS.acceptShareInvitation = vi
      .fn()
      .mockRejectedValue(new Error('Invalid or expired token'));
    const { req, res } = makeReqRes({ token: 'tok-abc' });
    await (acceptShareInvitation as Function)(req, res);
    expect(RH.notFound).toHaveBeenCalled();
  });

  it('returns 500 on generic error', async () => {
    MockedSS.acceptShareInvitation = vi
      .fn()
      .mockRejectedValue(new Error('DB connection lost'));
    const { req, res } = makeReqRes({ token: 'tok-abc' });
    await (acceptShareInvitation as Function)(req, res);
    expect(RH.internalError).toHaveBeenCalled();
  });
});
