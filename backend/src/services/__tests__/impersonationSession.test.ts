/**
 * The impersonation session across a token refresh.
 *
 * This is the one property the whole feature rests on and the one that is
 * easiest to get wrong: `authService.refreshToken` rebuilds the access-token
 * payload FROM THE DATABASE ROW, and the frontend refreshes proactively every
 * 13 minutes. So an `impersonatorId` that lives only in the JWT is silently
 * dropped within a quarter of an hour, leaving the admin logged in as someone
 * else with no banner and no way back — and nothing about that failure looks
 * like a bug at the moment it happens.
 *
 * Everything on the path is therefore REAL here: the real `sessionService`
 * against an in-memory Redis double, the real `jwt` signer/verifier, and the
 * real `authService.refreshToken`. Only Redis, Prisma, the mailer and the
 * storage layer are stand-ins.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// `src/test/setup.ts` applies a blanket `vi.mock('jsonwebtoken')` to every
// backend test file. That would make this suite vacuous — a mocked signer
// returns undefined, so "the claim survived the refresh" could not fail. The
// point here is the REAL sign/verify round-trip, so opt out for this file.
vi.unmock('jsonwebtoken');

vi.mock('../../utils/config', () => ({
  config: {
    NODE_ENV: 'test',
    JWT_ACCESS_SECRET: 'test-access-secret-for-testing-only-32-characters-long',
    JWT_REFRESH_SECRET:
      'test-refresh-secret-for-testing-only-32-characters-long',
    JWT_ACCESS_EXPIRY: '15m',
    JWT_REFRESH_EXPIRY: '7d',
    JWT_REFRESH_EXPIRY_REMEMBER: '30d',
    STORAGE_TYPE: 'local',
    UPLOAD_DIR: './test-uploads',
    EMAIL_SERVICE: 'none',
  },
  isDevelopment: false,
  isProduction: false,
  isTest: true,
  getOrigins: () => ['http://localhost:3000'],
}));

// In-memory Redis. `executeRedisCommand` swallows errors and returns its
// fallback, so the double must behave like the real client for the code under
// test to mean anything.
const { store, mockExecuteRedisCommand } = vi.hoisted(() => {
  const store = new Map<string, string>();
  const client = {
    setEx: async (k: string, _ttl: number, v: string) => {
      store.set(k, v);
      return 'OK';
    },
    get: async (k: string) => store.get(k) ?? null,
    del: async (k: string) => (store.delete(k) ? 1 : 0),
  };
  const mockExecuteRedisCommand = vi.fn(
    async (fn: (c: typeof client) => Promise<unknown>) => fn(client)
  );
  return { store, mockExecuteRedisCommand };
});

vi.mock('../../config/redis', () => ({
  executeRedisCommand: mockExecuteRedisCommand,
  getRedisClient: vi.fn(() => null),
}));

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    user: { findUnique: vi.fn() as ReturnType<typeof vi.fn> },
    impersonationLog: { create: vi.fn() as ReturnType<typeof vi.fn> },
  },
}));

vi.mock('../../db', () => ({ prisma: prismaMock }));
vi.mock('../../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../services/emailService', () => ({
  sendVerificationEmail: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
}));
vi.mock('../../storage/index', () => ({
  getStorageProvider: vi.fn(() => ({
    upload: vi.fn(),
    getUrl: vi.fn(),
    delete: vi.fn(),
  })),
}));
vi.mock('sharp', () => ({ default: vi.fn() }));

import * as authService from '../authService';
import * as adminService from '../adminService';
import { sessionService } from '../sessionService';
import { verifyAccessToken } from '../../auth/jwt';
import { ApiError } from '../../middleware/error';

const ADMIN = {
  id: 'admin-1',
  email: 'admin@admin.com',
  emailVerified: true,
  isAdmin: true,
};
const TARGET = {
  id: 'user-1',
  email: 'user@example.com',
  emailVerified: true,
  isAdmin: false,
};

const rows = (...users: Array<Record<string, unknown>>) => {
  prismaMock.user.findUnique.mockImplementation(
    async (args: { where: { id: string } }) =>
      users.find(u => u.id === args.where.id) ?? null
  );
};

describe('an impersonated session survives token rotation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.clear();
    prismaMock.impersonationLog.create.mockResolvedValue({});
  });

  it('carries the impersonator through refresh — the 13-minute trap', async () => {
    rows(ADMIN, TARGET);

    const started = await adminService.startImpersonation(
      { id: ADMIN.id, email: ADMIN.email },
      TARGET.id
    );

    // Sanity: the freshly minted token names both parties.
    const initial = verifyAccessToken(started.accessToken);
    expect(initial.userId).toBe(TARGET.id);
    expect(initial.impersonatorId).toBe(ADMIN.id);

    // ...and now the thing that actually breaks: a refresh, which rebuilds
    // the payload from the DB row and knows nothing about the old token.
    const refreshed = await authService.refreshToken({
      refreshToken: started.refreshToken,
    });

    const after = verifyAccessToken(refreshed.accessToken);
    expect(after.userId).toBe(TARGET.id);
    expect(after.impersonatorId).toBe(ADMIN.id);
    expect(after.impersonationSessionId).toBe(started.sessionId);
  });

  it('still carries it after several consecutive refreshes', async () => {
    rows(ADMIN, TARGET);

    const started = await adminService.startImpersonation(
      { id: ADMIN.id, email: ADMIN.email },
      TARGET.id
    );

    let refreshToken = started.refreshToken;
    for (let i = 0; i < 3; i++) {
      const result = await authService.refreshToken({ refreshToken });
      refreshToken = result.refreshToken;
      expect(verifyAccessToken(result.accessToken).impersonatorId).toBe(
        ADMIN.id
      );
    }
  });

  it('leaves an ordinary session with no impersonator claim at all', async () => {
    rows(TARGET);
    await sessionService.storeRefreshToken(TARGET.id, 'plain-token');

    const refreshed = await authService.refreshToken({
      refreshToken: 'plain-token',
    });

    const payload = verifyAccessToken(refreshed.accessToken);
    expect(payload.userId).toBe(TARGET.id);
    expect(payload.impersonatorId).toBeUndefined();
  });

  it('ends the session on refresh once the impersonator loses the admin flag', async () => {
    rows(ADMIN, TARGET);
    const started = await adminService.startImpersonation(
      { id: ADMIN.id, email: ADMIN.email },
      TARGET.id
    );

    // Same tokens, revoked privilege.
    rows({ ...ADMIN, isAdmin: false }, TARGET);

    await expect(
      authService.refreshToken({ refreshToken: started.refreshToken })
    ).rejects.toThrow(ApiError);

    // And the rotated token is dead, so retrying does not get a second bite.
    await expect(
      authService.refreshToken({ refreshToken: started.refreshToken })
    ).rejects.toThrow();
  });
});

describe('revoking an impersonated session without holding its token', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.clear();
    prismaMock.impersonationLog.create.mockResolvedValue({});
  });

  it('kills the refresh token that the stop endpoint never receives', async () => {
    rows(ADMIN, TARGET);
    const started = await adminService.startImpersonation(
      { id: ADMIN.id, email: ADMIN.email },
      TARGET.id
    );

    await adminService.stopImpersonation(
      { id: ADMIN.id, sessionId: started.sessionId },
      { id: TARGET.id, email: TARGET.email }
    );

    // The browser's cookie is replaced either way; what matters is that a
    // leaked copy of the impersonated refresh token stops working.
    expect(
      await sessionService.verifyRefreshToken(started.refreshToken)
    ).toBeNull();
  });

  it('follows the token through rotation, so a stop after a refresh still revokes', async () => {
    rows(ADMIN, TARGET);
    const started = await adminService.startImpersonation(
      { id: ADMIN.id, email: ADMIN.email },
      TARGET.id
    );

    const refreshed = await authService.refreshToken({
      refreshToken: started.refreshToken,
    });

    await adminService.stopImpersonation(
      { id: ADMIN.id, sessionId: started.sessionId },
      { id: TARGET.id, email: TARGET.email }
    );

    // The index must have been rewritten by the rotation; if it still pointed
    // at the original key this would come back non-null.
    expect(
      await sessionService.verifyRefreshToken(refreshed.refreshToken)
    ).toBeNull();
  });

  it('leaves no dangling index entry behind', async () => {
    rows(ADMIN, TARGET);
    const started = await adminService.startImpersonation(
      { id: ADMIN.id, email: ADMIN.email },
      TARGET.id
    );

    expect([...store.keys()].some(k => k.startsWith('impersonation:'))).toBe(
      true
    );

    await adminService.stopImpersonation(
      { id: ADMIN.id, sessionId: started.sessionId },
      { id: TARGET.id, email: TARGET.email }
    );

    expect([...store.keys()].some(k => k.startsWith('impersonation:'))).toBe(
      false
    );
  });

  it('never stores the refresh token itself in the index', async () => {
    rows(ADMIN, TARGET);
    const started = await adminService.startImpersonation(
      { id: ADMIN.id, email: ADMIN.email },
      TARGET.id
    );

    // The index holds a SHA-256 key, not a credential — the property
    // `sessionService.keyFor`'s docstring exists to protect.
    const values = [...store.entries()]
      .filter(([k]) => k.startsWith('impersonation:'))
      .map(([, v]) => v);
    expect(values).toHaveLength(1);
    expect(values[0]).not.toContain(started.refreshToken);
    expect(values[0]).toMatch(/^refresh:[0-9a-f]{64}$/);
  });
});
