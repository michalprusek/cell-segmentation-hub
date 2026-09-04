/**
 * `requireAdmin` and the impersonation half of `authenticate`, at unit level.
 *
 * The route-level counterparts live in api/routes/__tests__/adminRoutes.test.ts
 * and mount the real chain; these cover the branches that are awkward to reach
 * through a router (a handler that set `req.user` itself, a missing session id)
 * and pin the exact refusal each one produces.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Request, Response, NextFunction } from 'express';

vi.mock('../../db', () => ({
  __esModule: true,
  prisma: { user: { findUnique: vi.fn() } },
}));

vi.mock('../../auth/jwt', () => ({
  __esModule: true,
  verifyAccessToken: vi.fn(),
}));

vi.mock('../../utils/authCookies', () => ({
  __esModule: true,
  ACCESS_TOKEN_COOKIE: 'access_token',
}));

vi.mock('../../utils/response', () => ({
  __esModule: true,
  ResponseHelper: {
    unauthorized: vi.fn(),
    forbidden: vi.fn(),
    notFound: vi.fn(),
    validationError: vi.fn(),
    badRequest: vi.fn(),
    internalError: vi.fn(),
  },
}));

vi.mock('../../utils/logger', () => ({
  __esModule: true,
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { prisma } from '../../db';
import { verifyAccessToken } from '../../auth/jwt';
import { ResponseHelper } from '../../utils/response';
import { authenticate, requireAdmin } from '../auth';

const findUnique = prisma.user.findUnique as ReturnType<typeof vi.fn>;
const verify = verifyAccessToken as ReturnType<typeof vi.fn>;

const makeRes = () => ({}) as Response;

describe('requireAdmin', () => {
  let next: NextFunction;

  beforeEach(() => {
    vi.clearAllMocks();
    next = vi.fn();
  });

  it('passes an admin through', () => {
    const req = {
      user: { id: 'a', email: 'a@x', emailVerified: true, isAdmin: true },
    } as unknown as Request;

    requireAdmin(req, makeRes(), next);

    expect(next).toHaveBeenCalled();
    expect(ResponseHelper.forbidden).not.toHaveBeenCalled();
  });

  it('403s a non-admin', () => {
    const req = {
      user: { id: 'u', email: 'u@x', emailVerified: true, isAdmin: false },
    } as unknown as Request;

    requireAdmin(req, makeRes(), next);

    expect(next).not.toHaveBeenCalled();
    expect(ResponseHelper.forbidden).toHaveBeenCalledWith(
      expect.anything(),
      'Vyžadována práva administrátora',
      'Auth'
    );
  });

  it('401s when nothing authenticated the request', () => {
    requireAdmin({} as Request, makeRes(), next);

    expect(next).not.toHaveBeenCalled();
    expect(ResponseHelper.unauthorized).toHaveBeenCalled();
  });

  it('403s an impersonated session even when the TARGET is itself an admin', () => {
    // The case a naive `req.user.isAdmin` check waves straight through: the
    // flag being read belongs to the impersonated account, not the actor.
    const req = {
      user: { id: 'a2', email: 'a2@x', emailVerified: true, isAdmin: true },
      impersonator: { id: 'a1', email: 'a1@x', sessionId: 's1' },
    } as unknown as Request;

    requireAdmin(req, makeRes(), next);

    expect(next).not.toHaveBeenCalled();
    expect(ResponseHelper.forbidden).toHaveBeenCalledWith(
      expect.anything(),
      'Během impersonace nejsou administrátorské akce povoleny',
      'Auth'
    );
  });
});

describe('authenticate — impersonation claims', () => {
  let next: NextFunction;

  beforeEach(() => {
    vi.clearAllMocks();
    next = vi.fn();
  });

  const req = (): Request =>
    ({ cookies: { access_token: 'tok' } }) as unknown as Request;

  it('leaves req.impersonator unset on an ordinary token', async () => {
    verify.mockReturnValue({
      userId: 'u',
      email: 'u@x',
      emailVerified: true,
    });
    findUnique.mockResolvedValue({
      id: 'u',
      email: 'u@x',
      emailVerified: true,
      isAdmin: false,
      profile: null,
    });

    const r = req();
    await authenticate(r, makeRes(), next);

    expect(next).toHaveBeenCalled();
    expect(r.impersonator).toBeUndefined();
    expect(r.user?.isAdmin).toBe(false);
    // One lookup only: the extra round-trip is paid solely by impersonated
    // sessions, which are rare.
    expect(findUnique).toHaveBeenCalledTimes(1);
  });

  it('resolves the real actor onto req.impersonator', async () => {
    verify.mockReturnValue({
      userId: 'u',
      email: 'u@x',
      emailVerified: true,
      impersonatorId: 'a',
      impersonationSessionId: 'sess-1',
    });
    findUnique.mockImplementation(async (args: { where: { id: string } }) =>
      args.where.id === 'u'
        ? {
            id: 'u',
            email: 'u@x',
            emailVerified: true,
            isAdmin: false,
            profile: null,
          }
        : { id: 'a', email: 'admin@x', isAdmin: true }
    );

    const r = req();
    await authenticate(r, makeRes(), next);

    expect(next).toHaveBeenCalled();
    // req.user stays the TARGET — that is what makes ownership checks work.
    expect(r.user?.id).toBe('u');
    expect(r.impersonator).toEqual({
      id: 'a',
      email: 'admin@x',
      sessionId: 'sess-1',
    });
  });

  it('401s when the impersonator no longer carries the admin flag', async () => {
    verify.mockReturnValue({
      userId: 'u',
      email: 'u@x',
      emailVerified: true,
      impersonatorId: 'a',
      impersonationSessionId: 'sess-1',
    });
    findUnique.mockImplementation(async (args: { where: { id: string } }) =>
      args.where.id === 'u'
        ? {
            id: 'u',
            email: 'u@x',
            emailVerified: true,
            isAdmin: false,
            profile: null,
          }
        : { id: 'a', email: 'admin@x', isAdmin: false }
    );

    const r = req();
    await authenticate(r, makeRes(), next);

    expect(next).not.toHaveBeenCalled();
    expect(ResponseHelper.unauthorized).toHaveBeenCalledWith(
      expect.anything(),
      'Impersonace byla ukončena: účet již nemá práva administrátora',
      'Auth'
    );
  });

  it('401s when the impersonator account is gone entirely', async () => {
    verify.mockReturnValue({
      userId: 'u',
      email: 'u@x',
      emailVerified: true,
      impersonatorId: 'ghost',
      impersonationSessionId: 'sess-1',
    });
    findUnique.mockImplementation(async (args: { where: { id: string } }) =>
      args.where.id === 'u'
        ? {
            id: 'u',
            email: 'u@x',
            emailVerified: true,
            isAdmin: false,
            profile: null,
          }
        : null
    );

    await authenticate(req(), makeRes(), next);

    expect(next).not.toHaveBeenCalled();
    expect(ResponseHelper.unauthorized).toHaveBeenCalled();
  });
});
