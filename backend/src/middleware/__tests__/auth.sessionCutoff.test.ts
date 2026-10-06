/**
 * "Sign out everywhere": a token issued before the user's `sessionsValidAfter`
 * is refused by the middleware, on every request.
 *
 * The cut-off rule itself is REAL here (auth/sessionCutoff is not mocked):
 * these tests are about the wiring - which fields reach it, and from where.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

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
  ResponseHelper: { unauthorized: vi.fn(), internalError: vi.fn() },
}));
vi.mock('../../utils/logger', () => ({
  __esModule: true,
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { prisma } from '../../db';
import { verifyAccessToken } from '../../auth/jwt';
import { ResponseHelper } from '../../utils/response';
import { authenticate, optionalAuthenticate } from '../auth';

const CUTOFF = new Date('2026-10-07T12:00:00.000Z');
const cutoffSeconds = CUTOFF.getTime() / 1000;

const USER = {
  id: 'user-1',
  email: 'user@example.com',
  emailVerified: true,
  isAdmin: false,
  profile: null,
};
const ADMIN = { id: 'admin-1', email: 'admin@example.com', isAdmin: true };

function run(
  middleware: typeof authenticate,
  payload: Record<string, unknown>,
  sessionsValidAfter: Date | null
) {
  vi.mocked(verifyAccessToken).mockReturnValue({
    userId: USER.id,
    email: USER.email,
    emailVerified: true,
    ...payload,
  } as never);
  vi.mocked(prisma.user.findUnique).mockImplementation((async (args: {
    where: { id: string };
  }) =>
    args.where.id === ADMIN.id
      ? ADMIN
      : { ...USER, sessionsValidAfter }) as never);

  const req = { cookies: { access_token: 'token' } } as unknown as Request;
  const next = vi.fn() as unknown as NextFunction;
  return middleware(req, {} as Response, next).then(() => ({ req, next }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('authenticate and the session cut-off', () => {
  it('reads the cut-off off the row it already loads', async () => {
    await run(authenticate, { iat: cutoffSeconds }, null);

    expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);
    expect(
      vi.mocked(prisma.user.findUnique).mock.calls[0][0].select
    ).toMatchObject({ sessionsValidAfter: true });
  });

  it('refuses a token issued before the cut-off, as an expired one', async () => {
    const { req, next } = await run(
      authenticate,
      { iat: cutoffSeconds - 1 },
      CUTOFF
    );

    expect(next).not.toHaveBeenCalled();
    expect(req.user).toBeUndefined();
    // The same answer as a naturally expired token, so the client's existing
    // "try a refresh, then sign out" path handles it.
    expect(ResponseHelper.unauthorized).toHaveBeenCalledWith(
      expect.anything(),
      'Token vypršel',
      'Auth'
    );
  });

  it('accepts a token issued in the very second of the cut-off - the replacement session', async () => {
    const { req, next } = await run(
      authenticate,
      { iat: cutoffSeconds },
      CUTOFF
    );

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user?.id).toBe(USER.id);
    expect(ResponseHelper.unauthorized).not.toHaveBeenCalled();
  });

  it('accepts any token when the user has never been cut off', async () => {
    const { next } = await run(authenticate, { iat: 1 }, null);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('exempts an impersonated session: it is the admin’s credential, not the user’s', async () => {
    const { req, next } = await run(
      authenticate,
      {
        iat: cutoffSeconds - 3600,
        impersonatorId: ADMIN.id,
        impersonationSessionId: 'imp-1',
      },
      CUTOFF
    );

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.impersonator?.id).toBe(ADMIN.id);
  });
});

describe('optionalAuthenticate and the session cut-off', () => {
  it('continues ANONYMOUSLY with a revoked token, rather than as the user', async () => {
    const { req, next } = await run(
      optionalAuthenticate,
      { iat: cutoffSeconds - 1 },
      CUTOFF
    );

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toBeUndefined();
  });

  it('still attaches the user for a token issued after the cut-off', async () => {
    const { req } = await run(
      optionalAuthenticate,
      { iat: cutoffSeconds + 5 },
      CUTOFF
    );

    expect(req.user?.id).toBe(USER.id);
  });
});
