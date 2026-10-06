/**
 * Key management, mounted with the REAL `authenticate`, the real router,
 * validation, controller and key service. Only the database and the logger
 * are doubles — the claims are about who may reach these routes and what
 * crosses the wire, and a mocked auth middleware could not falsify either.
 */

import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import { describe, it, expect, beforeEach, vi } from 'vitest';

// `src/test/setup.ts` blanket-mocks jsonwebtoken; these tests need a real
// signed session cookie.
vi.unmock('jsonwebtoken');

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
    UPLOAD_DIR: './test-uploads',
    STORAGE_TYPE: 'local',
  },
  isDevelopment: false,
  isProduction: false,
  isTest: true,
  getOrigins: () => ['http://localhost:3000'],
}));

vi.mock('../../../db', () => ({
  __esModule: true,
  prisma: {
    user: { findUnique: vi.fn() },
    apiKey: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
    },
    $executeRaw: vi.fn(async () => 1),
    // Runs the callback against the same double, as `tx`.
    $transaction: vi.fn(async (run: (tx: unknown) => unknown) =>
      run((await import('../../../db')).prisma)
    ),
  },
}));

vi.mock('../../../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import apiKeyRoutes from '../apiKeyRoutes';
import { prisma } from '../../../db';
import { generateAccessToken } from '../../../auth/jwt';
import {
  MAX_API_KEYS_PER_USER,
  generateApiKey,
  hashApiKey,
  isWellFormedApiKey,
} from '../../../services/apiKeyService';

const USER = {
  id: 'user-1',
  email: 'user@example.com',
  emailVerified: true,
  isAdmin: false,
  profile: null,
};
const ADMIN = {
  id: 'admin-1',
  email: 'admin@admin.com',
  emailVerified: true,
  isAdmin: true,
  profile: null,
};
const KEY_ID = '7f1c1f0e-3a55-4d5e-9d0a-0c6f3f1f8a11';

const db = prisma.apiKey as unknown as Record<
  'findUnique' | 'findMany' | 'count' | 'create' | 'deleteMany',
  ReturnType<typeof vi.fn>
>;

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/api-keys', apiKeyRoutes);
  return app;
};

const cookieFor = (
  user: typeof USER,
  impersonation?: { impersonatorId: string; impersonationSessionId: string }
) => [
  `access_token=${generateAccessToken({
    userId: user.id,
    email: user.email,
    emailVerified: user.emailVerified,
    ...(impersonation ?? {}),
  })}`,
];

const AS_ADMIN_ACTING_AS_USER = () =>
  cookieFor(USER, {
    impersonatorId: ADMIN.id,
    impersonationSessionId: 'session-1',
  });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.user.findUnique).mockImplementation((async (args: {
    where: { id: string };
  }) => [USER, ADMIN].find(u => u.id === args.where.id) ?? null) as never);
  db.count.mockResolvedValue(0);
  db.findMany.mockResolvedValue([]);
  db.create.mockImplementation(async ({ data }) => ({
    id: KEY_ID,
    name: data.name,
    prefix: data.prefix,
    createdAt: new Date('2026-10-06T12:00:00Z'),
    lastUsedAt: null,
    expiresAt: data.expiresAt,
  }));
});

describe('who may manage keys', () => {
  it.each([
    ['GET', '/api/api-keys'],
    ['POST', '/api/api-keys'],
    ['DELETE', `/api/api-keys/${KEY_ID}`],
  ] as const)('401s an unauthenticated %s %s', async (method, path) => {
    const res = await request(buildApp())[
      method.toLowerCase() as 'get' | 'post' | 'delete'
    ](path).send({ name: 'x' });
    expect(res.status).toBe(401);
    expect(db.create).not.toHaveBeenCalled();
    expect(db.deleteMany).not.toHaveBeenCalled();
  });

  it('cannot be reached with an API key: a leaked key must not mint more', async () => {
    const res = await request(buildApp())
      .post('/api/api-keys')
      .set('Authorization', `Bearer ${generateApiKey()}`)
      .send({ name: 'self-replicating' });
    expect(res.status).toBe(401);
    expect(db.findUnique).not.toHaveBeenCalled();
    expect(db.create).not.toHaveBeenCalled();
  });

  it('refuses to mint a key for an impersonated account', async () => {
    const res = await request(buildApp())
      .post('/api/api-keys')
      .set('Cookie', AS_ADMIN_ACTING_AS_USER())
      .send({ name: 'left behind' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('API_KEY_IMPERSONATION_FORBIDDEN');
    expect(db.create).not.toHaveBeenCalled();
  });

  it('refuses to revoke a key of an impersonated account', async () => {
    const res = await request(buildApp())
      .delete(`/api/api-keys/${KEY_ID}`)
      .set('Cookie', AS_ADMIN_ACTING_AS_USER());
    expect(res.status).toBe(403);
    expect(db.deleteMany).not.toHaveBeenCalled();
  });

  it('still lets an impersonating admin SEE the keys', async () => {
    const res = await request(buildApp())
      .get('/api/api-keys')
      .set('Cookie', AS_ADMIN_ACTING_AS_USER());
    expect(res.status).toBe(200);
    expect(db.findMany.mock.calls[0][0].where).toEqual({ userId: USER.id });
  });
});

describe('creating a key', () => {
  it('returns the key exactly once, and stores only its hash', async () => {
    const res = await request(buildApp())
      .post('/api/api-keys')
      .set('Cookie', cookieFor(USER))
      .send({ name: '  my pipeline  ' });

    expect(res.status).toBe(201);
    expect(res.headers['cache-control']).toBe('no-store');
    const { key, ...summary } = res.body.data;
    expect(isWellFormedApiKey(key)).toBe(true);
    expect(summary).toEqual({
      id: KEY_ID,
      name: 'my pipeline',
      prefix: key.slice(0, 9),
      createdAt: '2026-10-06T12:00:00.000Z',
      lastUsedAt: null,
      expiresAt: null,
    });

    const { data } = db.create.mock.calls[0][0];
    expect(data.userId).toBe(USER.id);
    expect(data.keyHash).toBe(hashApiKey(key));
    expect(JSON.stringify(data)).not.toContain(key);
  });

  it('turns expiresInDays into an expiry date', async () => {
    const before = Date.now();
    const res = await request(buildApp())
      .post('/api/api-keys')
      .set('Cookie', cookieFor(USER))
      .send({ name: 'short-lived', expiresInDays: 30 });

    expect(res.status).toBe(201);
    const expiresAt = new Date(res.body.data.expiresAt).getTime();
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;
    expect(expiresAt).toBeGreaterThanOrEqual(before + thirtyDays);
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + thirtyDays);
  });

  it.each([
    [{}],
    [{ name: '' }],
    [{ name: '   ' }],
    [{ name: 'x'.repeat(65) }],
    [{ name: 'ok', expiresInDays: 0 }],
    [{ name: 'ok', expiresInDays: 366 }],
    [{ name: 'ok', expiresInDays: 1.5 }],
  ])('rejects the body %j', async body => {
    const res = await request(buildApp())
      .post('/api/api-keys')
      .set('Cookie', cookieFor(USER))
      .send(body);
    expect(res.status).toBe(400);
    expect(db.create).not.toHaveBeenCalled();
  });

  it('409s at the per-account maximum', async () => {
    db.count.mockResolvedValue(MAX_API_KEYS_PER_USER);
    const res = await request(buildApp())
      .post('/api/api-keys')
      .set('Cookie', cookieFor(USER))
      .send({ name: 'one too many' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('API_KEY_LIMIT_REACHED');
    expect(db.create).not.toHaveBeenCalled();
  });
});

describe('listing and revoking', () => {
  it('lists only the caller\'s keys and never a hash', async () => {
    db.findMany.mockResolvedValue([
      {
        id: KEY_ID,
        name: 'pipeline',
        prefix: 'sseg_abcd',
        createdAt: new Date('2026-10-01T00:00:00Z'),
        lastUsedAt: null,
        expiresAt: null,
      },
    ]);
    const res = await request(buildApp())
      .get('/api/api-keys')
      .set('Cookie', cookieFor(USER));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    const query = db.findMany.mock.calls[0][0];
    expect(query.where).toEqual({ userId: USER.id });
    expect(query.select.keyHash).toBeUndefined();
  });

  it('revokes the caller\'s own key', async () => {
    db.deleteMany.mockResolvedValue({ count: 1 });
    const res = await request(buildApp())
      .delete(`/api/api-keys/${KEY_ID}`)
      .set('Cookie', cookieFor(USER));
    expect(res.status).toBe(200);
    expect(db.deleteMany).toHaveBeenCalledWith({
      where: { id: KEY_ID, userId: USER.id },
    });
  });

  it('404s for a key that is not the caller\'s', async () => {
    db.deleteMany.mockResolvedValue({ count: 0 });
    const res = await request(buildApp())
      .delete(`/api/api-keys/${KEY_ID}`)
      .set('Cookie', cookieFor(USER));
    expect(res.status).toBe(404);
  });

  it('400s a malformed id without touching the database', async () => {
    const res = await request(buildApp())
      .delete('/api/api-keys/not-a-uuid')
      .set('Cookie', cookieFor(USER));
    expect(res.status).toBe(400);
    expect(db.deleteMany).not.toHaveBeenCalled();
  });
});
