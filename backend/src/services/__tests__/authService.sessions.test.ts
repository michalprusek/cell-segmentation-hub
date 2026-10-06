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

describe('refreshToken and the session cut-off', () => {
  it('refuses a record written before the cut-off, deletes it, and does NOT rotate', async () => {
    sessionServiceMock.verifyRefreshToken.mockResolvedValue({
      userId: USER_ID,
      createdAt: before,
    });
    prismaMock.user.findUnique.mockResolvedValue(userRow(CUTOFF));

    await expect(
      authService.refreshToken({ refreshToken: 'old' })
    ).rejects.toMatchObject({ statusCode: 401 });

    // Rotating would write a fresh record dated now - and so launder the
    // very session the password change ended.
    expect(sessionServiceMock.rotateRefreshToken).not.toHaveBeenCalled();
    expect(sessionServiceMock.deleteRefreshToken).toHaveBeenCalledWith('old');
  });

  it('refuses a record with no creation time once the user has a cut-off', async () => {
    sessionServiceMock.verifyRefreshToken.mockResolvedValue({
      userId: USER_ID,
    });
    prismaMock.user.findUnique.mockResolvedValue(userRow(CUTOFF));

    await expect(
      authService.refreshToken({ refreshToken: 'legacy' })
    ).rejects.toMatchObject({ statusCode: 401 });
    expect(sessionServiceMock.rotateRefreshToken).not.toHaveBeenCalled();
  });

  it('withdraws the rotated token when the password changed BETWEEN the check and the rotation', async () => {
    // The race: the pre-check reads "no cut-off", a password change lands,
    // and the rotation then writes a successor dated now - newer than the
    // cut-off, so nothing would ever refuse it again.
    sessionServiceMock.verifyRefreshToken.mockResolvedValue({
      userId: USER_ID,
      createdAt: before,
    });
    prismaMock.user.findUnique
      .mockResolvedValueOnce({ sessionsValidAfter: null }) // pre-check
      .mockResolvedValueOnce(userRow(CUTOFF)); // after the rotation

    await expect(
      authService.refreshToken({ refreshToken: 'racing' })
    ).rejects.toMatchObject({ statusCode: 401 });

    expect(sessionServiceMock.rotateRefreshToken).toHaveBeenCalledWith(
      'racing'
    );
    // The successor, not the presented token (rotation already consumed it).
    expect(sessionServiceMock.deleteRefreshToken).toHaveBeenCalledWith(
      'rotated'
    );
  });

  it('rotates a record written after the cut-off', async () => {
    sessionServiceMock.verifyRefreshToken.mockResolvedValue({
      userId: USER_ID,
      createdAt: after,
    });
    prismaMock.user.findUnique.mockResolvedValue(userRow(CUTOFF));

    const result = await authService.refreshToken({ refreshToken: 'fresh' });

    expect(sessionServiceMock.rotateRefreshToken).toHaveBeenCalledWith('fresh');
    expect(sessionServiceMock.deleteRefreshToken).not.toHaveBeenCalled();
    expect(result.refreshToken).toBe('rotated');
  });

  it('leaves a legacy record alone while the user has no cut-off - a deploy signs nobody out', async () => {
    sessionServiceMock.verifyRefreshToken.mockResolvedValue({
      userId: USER_ID,
    });
    prismaMock.user.findUnique.mockResolvedValue(userRow(null));

    await authService.refreshToken({ refreshToken: 'legacy' });

    expect(sessionServiceMock.rotateRefreshToken).toHaveBeenCalledWith(
      'legacy'
    );
  });

  it('exempts an impersonated session from the target’s cut-off', async () => {
    sessionServiceMock.verifyRefreshToken.mockResolvedValue({
      userId: USER_ID,
      createdAt: before,
      impersonatorId: 'admin-1',
      impersonationSessionId: 'imp-1',
    });
    sessionServiceMock.rotateRefreshToken.mockResolvedValue({
      token: 'rotated',
      userId: USER_ID,
      rememberMe: true,
      impersonatorId: 'admin-1',
      impersonationSessionId: 'imp-1',
    });
    prismaMock.user.findUnique.mockImplementation(
      async (args: { where: { id: string } }) =>
        args.where.id === 'admin-1'
          ? { id: 'admin-1', isAdmin: true }
          : userRow(CUTOFF)
    );

    await authService.refreshToken({ refreshToken: 'impersonated' });

    expect(sessionServiceMock.rotateRefreshToken).toHaveBeenCalledWith(
      'impersonated'
    );
  });

  it('reports the session’s own rememberMe, which decides the cookie lifetime', async () => {
    sessionServiceMock.verifyRefreshToken.mockResolvedValue({
      userId: USER_ID,
      createdAt: after,
    });
    prismaMock.user.findUnique.mockResolvedValue(userRow(null));

    const result = await authService.refreshToken({ refreshToken: 'short' });

    // rotateRefreshToken is mocked to answer `false` above; a hard-coded
    // `true` - what the controller used to pass - fails here.
    expect(result.rememberMe).toBe(false);
  });
});
