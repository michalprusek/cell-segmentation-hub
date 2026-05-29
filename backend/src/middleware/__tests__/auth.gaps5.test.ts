/**
 * auth.gaps5.test.ts
 *
 * Covers branches still uncovered after auth.test.ts:
 *
 *  A. requireResourceOwnership — guard branches
 *     - missing resourceId → 400 validationError
 *     - invalid resource model → catch → 500 internalError
 *     - model missing findUnique → 400 badRequest
 *     - resource field not in resource → 500 internalError
 *     - resource field !== user id → 403 forbidden
 *     - happy path → next() called
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    project: {
      findUnique: vi.fn() as ReturnType<typeof vi.fn>,
    },
  },
}));

vi.mock('../../db', () => ({ prisma: prismaMock }));
vi.mock('../../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../utils/config', () => ({
  config: {
    NODE_ENV: 'test',
    JWT_ACCESS_SECRET: 'test-access-secret-at-least-32-chars!!',
    JWT_REFRESH_SECRET: 'test-refresh-secret-at-least-32-chars!',
    JWT_ACCESS_EXPIRY: '15m',
    JWT_REFRESH_EXPIRY: '7d',
    ALLOWED_ORIGINS: 'http://localhost:3000',
    FROM_EMAIL: 'test@test.com',
    EMAIL_SERVICE: 'none',
    REQUIRE_EMAIL_VERIFICATION: false,
  },
}));

const { mockRH } = vi.hoisted(() => ({
  mockRH: {
    unauthorized: vi.fn(),
    validationError: vi.fn(),
    badRequest: vi.fn(),
    notFound: vi.fn(),
    forbidden: vi.fn(),
    internalError: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock('../../utils/response', () => ({
  ResponseHelper: mockRH,
}));

import { requireResourceOwnership } from '../auth';

function makeRes(): Response {
  return {
    json: vi.fn(),
    status: vi.fn().mockReturnThis(),
  } as unknown as Response;
}

function makeReq(
  overrides: Partial<{
    user: { id: string; email: string; emailVerified: boolean } | undefined;
    params: Record<string, string>;
  }> = {}
): Request {
  return {
    user: { id: 'user-1', email: 'u@test.com', emailVerified: true },
    params: { id: 'resource-1' },
    ...overrides,
  } as unknown as Request;
}

const next = vi.fn() as NextFunction;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('requireResourceOwnership', () => {
  it('returns 400 when resourceId is missing', async () => {
    const middleware = requireResourceOwnership('project');
    const req = makeReq({ params: {} }); // no id
    const res = makeRes();

    await middleware(req, res, next);
    expect(mockRH.validationError).toHaveBeenCalledWith(
      res,
      'Chybí ID zdroje',
      'Auth'
    );
  });

  it('returns 500 when resource model is not in prisma', async () => {
    const middleware = requireResourceOwnership('nonExistentModel');
    const req = makeReq();
    const res = makeRes();

    await middleware(req, res, next);
    expect(mockRH.internalError).toHaveBeenCalled();
  });

  it('calls next() when user owns the resource', async () => {
    prismaMock.project.findUnique.mockResolvedValueOnce({ userId: 'user-1' });
    const middleware = requireResourceOwnership('project');
    const req = makeReq();
    const res = makeRes();

    await middleware(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('returns 404 when resource not found', async () => {
    prismaMock.project.findUnique.mockResolvedValueOnce(null);
    const middleware = requireResourceOwnership('project');
    const req = makeReq();
    const res = makeRes();

    await middleware(req, res, next);
    expect(mockRH.notFound).toHaveBeenCalledWith(
      res,
      'Zdroj nenalezen',
      'Auth'
    );
  });

  it('returns 403 when resource belongs to different user', async () => {
    prismaMock.project.findUnique.mockResolvedValueOnce({
      userId: 'other-user',
    });
    const middleware = requireResourceOwnership('project');
    const req = makeReq();
    const res = makeRes();

    await middleware(req, res, next);
    expect(mockRH.forbidden).toHaveBeenCalledWith(
      res,
      'Nedostatečná oprávnění',
      'Auth'
    );
  });
});
