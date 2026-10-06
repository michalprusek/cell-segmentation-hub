/**
 * The refresh path and the session cut-off.
 *
 * A password change ends every other session. For the 15-minute access token
 * that is the middleware's job (auth.sessionCutoff.test.ts); here it is the
 * refresh token's, which would otherwise mint new access tokens for 30 days.
 *
 * `auth/sessionCutoff` is real. `sessionService` is mocked: its own behaviour
 * has its own suite.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { prismaMock, sessionServiceMock } = vi.hoisted(() => ({
  prismaMock: {
    user: { findUnique: vi.fn(), update: vi.fn() },
  },
  sessionServiceMock: {
    storeRefreshToken: vi.fn(),
    rotateRefreshToken: vi.fn(),
    verifyRefreshToken: vi.fn(),
    deleteRefreshToken: vi.fn(),
  },
}));

vi.mock('../../utils/config', () => ({ config: { UPLOAD_DIR: './x' } }));
vi.mock('../../db', () => ({ prisma: prismaMock }));
vi.mock('../../auth/password');
vi.mock('../../auth/jwt', () => ({
  generateTokenPair: vi.fn(() => ({
    accessToken: 'new-access',
    refreshToken: 'unused-jwt-refresh',
  })),
}));
vi.mock('../../utils/logger');
vi.mock('../../services/emailService');
vi.mock('../../services/sessionService', () => ({
  sessionService: sessionServiceMock,
}));
vi.mock('../liveConnections', () => ({
  disconnectUserSockets: vi.fn(),
}));
vi.mock('../accountFiles', () => ({
  collectUserFiles: vi.fn(),
  deleteUserFiles: vi.fn(),
}));
vi.mock('../../storage/index', () => ({ getStorageProvider: vi.fn() }));
vi.mock('sharp', () => ({ default: vi.fn() }));

import * as authService from '../authService';

const USER_ID = 'user-1';
const CUTOFF = new Date('2026-10-07T12:00:00.000Z');
const before = new Date(CUTOFF.getTime() - 60_000).toISOString();
const after = new Date(CUTOFF.getTime() + 60_000).toISOString();

const userRow = (sessionsValidAfter: Date | null) => ({
  id: USER_ID,
  email: 'user@example.com',
  emailVerified: true,
  sessionsValidAfter,
});

beforeEach(() => {
  vi.clearAllMocks();
  sessionServiceMock.rotateRefreshToken.mockResolvedValue({
    token: 'rotated',
    userId: USER_ID,
    rememberMe: false,
  });
  sessionServiceMock.deleteRefreshToken.mockResolvedValue(true);
});

/** What `rotateRefreshToken` hands back for a record written at `createdAt`. */
const rotatedFrom = (
  presentedCreatedAt: string | undefined,
  extra: Record<string, unknown> = {}
) => ({
  token: 'rotated',
  userId: USER_ID,
  rememberMe: false,
  ...(presentedCreatedAt ? { presentedCreatedAt } : {}),
  ...extra,
});

describe('refreshToken and the session cut-off', () => {
  it('withdraws the successor of a record written before the cut-off', async () => {
    sessionServiceMock.rotateRefreshToken.mockResolvedValue(
      rotatedFrom(before)
    );
    prismaMock.user.findUnique.mockResolvedValue(userRow(CUTOFF));

    await expect(
      authService.refreshToken({ refreshToken: 'old' })
    ).rejects.toMatchObject({ statusCode: 401 });

    // The successor - the presented token was consumed by the rotation.
    expect(sessionServiceMock.deleteRefreshToken).toHaveBeenCalledWith(
      'rotated'
    );
  });

  it('judges against the user row read AFTER the rotation - there is no earlier check to race', async () => {
    const order: string[] = [];
    sessionServiceMock.rotateRefreshToken.mockImplementation(async () => {
      order.push('rotate');
      return rotatedFrom(before);
    });
    prismaMock.user.findUnique.mockImplementation(async () => {
      order.push('read user');
      return userRow(CUTOFF);
    });

    await expect(
      authService.refreshToken({ refreshToken: 'racing' })
    ).rejects.toMatchObject({ statusCode: 401 });

    // A cut-off read before the rotation can be stale by the time the
    // successor is written; then nothing would ever refuse that successor.
    expect(order).toEqual(['rotate', 'read user']);
    expect(sessionServiceMock.verifyRefreshToken).not.toHaveBeenCalled();
  });

  it('refuses a record with no creation time once the user has a cut-off', async () => {
    sessionServiceMock.rotateRefreshToken.mockResolvedValue(
      rotatedFrom(undefined)
    );
    prismaMock.user.findUnique.mockResolvedValue(userRow(CUTOFF));

    await expect(
      authService.refreshToken({ refreshToken: 'legacy' })
    ).rejects.toMatchObject({ statusCode: 401 });
    expect(sessionServiceMock.deleteRefreshToken).toHaveBeenCalledWith(
      'rotated'
    );
  });

  it('keeps a record written after the cut-off', async () => {
    sessionServiceMock.rotateRefreshToken.mockResolvedValue(rotatedFrom(after));
    prismaMock.user.findUnique.mockResolvedValue(userRow(CUTOFF));

    const result = await authService.refreshToken({ refreshToken: 'fresh' });

    expect(sessionServiceMock.deleteRefreshToken).not.toHaveBeenCalled();
    expect(result.refreshToken).toBe('rotated');
  });

  it('leaves a legacy record alone while the user has no cut-off - a deploy signs nobody out', async () => {
    sessionServiceMock.rotateRefreshToken.mockResolvedValue(
      rotatedFrom(undefined)
    );
    prismaMock.user.findUnique.mockResolvedValue(userRow(null));

    const result = await authService.refreshToken({ refreshToken: 'legacy' });

    expect(result.refreshToken).toBe('rotated');
    expect(sessionServiceMock.deleteRefreshToken).not.toHaveBeenCalled();
  });

  it('exempts an impersonated session from the target’s cut-off', async () => {
    sessionServiceMock.rotateRefreshToken.mockResolvedValue(
      rotatedFrom(before, {
        rememberMe: true,
        impersonatorId: 'admin-1',
        impersonationSessionId: 'imp-1',
      })
    );
    prismaMock.user.findUnique.mockImplementation(
      async (args: { where: { id: string } }) =>
        args.where.id === 'admin-1'
          ? { id: 'admin-1', isAdmin: true }
          : userRow(CUTOFF)
    );

    const result = await authService.refreshToken({
      refreshToken: 'impersonated',
    });

    expect(result.refreshToken).toBe('rotated');
    expect(sessionServiceMock.deleteRefreshToken).not.toHaveBeenCalled();
  });

  it('reports the session’s own rememberMe, which decides the cookie lifetime', async () => {
    sessionServiceMock.rotateRefreshToken.mockResolvedValue(rotatedFrom(after));
    prismaMock.user.findUnique.mockResolvedValue(userRow(null));

    const result = await authService.refreshToken({ refreshToken: 'short' });

    // A hard-coded `true` - what the controller used to pass - fails here.
    expect(result.rememberMe).toBe(false);
  });
});
