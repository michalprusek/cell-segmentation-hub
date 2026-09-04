/**
 * Route-level tests for the admin surface, deliberately mounted with the REAL
 * middleware chain.
 *
 * Every other route test in this directory does `vi.mock('../../../middleware/auth')`,
 * which is fine when the thing under test is a controller — but it would make
 * this file worthless. The claims here ARE the middleware: that a non-admin
 * cannot reach `/admin/users`, that an impersonated session cannot climb back
 * up to it, and that the one route which must stay reachable from inside an
 * impersonated session does. So `authenticate`, `requireAdmin`, the real
 * router, the real cookie parser, the real JWT signer and the real rate
 * limiters are all in play; only the database, Redis and the logger are
 * doubles.
 */

import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import { describe, it, expect, beforeEach, vi } from 'vitest';

// `src/test/setup.ts` applies a blanket `vi.mock('jsonwebtoken')` to every
// backend test file. That would make this suite vacuous — a mocked signer
// returns undefined, so "the claim survived the refresh" could not fail. The
// point here is the REAL sign/verify round-trip, so opt out for this file.
vi.unmock('jsonwebtoken');

// Config must be mocked before anything imports it — the real module calls
// process.exit on a missing test env.
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
    user: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
    impersonationLog: {
      create: vi.fn(),
    },
  },
}));

// Redis-backed; the token mechanics get their own test file.
vi.mock('../../../services/sessionService', () => ({
  sessionService: {
    storeRefreshToken: vi.fn(async () => undefined),
    revokeImpersonatedSession: vi.fn(async () => true),
  },
}));

vi.mock('../../../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import adminRoutes from '../adminRoutes';
import { prisma } from '../../../db';
import { generateAccessToken } from '../../../auth/jwt';
import { sessionService } from '../../../services/sessionService';

const ADMIN = {
  id: 'admin-1',
  email: 'admin@admin.com',
  emailVerified: true,
  isAdmin: true,
  profile: null,
};

const USER = {
  id: 'user-1',
  email: 'user@example.com',
  emailVerified: true,
  isAdmin: false,
  profile: null,
};

const OTHER_ADMIN = {
  id: 'admin-2',
  email: 'second@admin.com',
  emailVerified: true,
  isAdmin: true,
  profile: null,
};

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/admin', adminRoutes);
  return app;
};

/** Everything the DB is asked for in these tests is a user by id. */
const usersById = (...rows: Array<Record<string, unknown>>) => {
  vi.mocked(prisma.user.findUnique).mockImplementation((async (args: {
    where: { id: string };
  }) => rows.find(r => r.id === args.where.id) ?? null) as never);
};

const tokenFor = (
  user: { id: string; email: string; emailVerified: boolean },
  impersonation?: { impersonatorId: string; impersonationSessionId: string }
) =>
  generateAccessToken({
    userId: user.id,
    email: user.email,
    emailVerified: user.emailVerified,
    ...(impersonation ?? {}),
  });

/** Let the fire-and-forget audit write land before asserting on it. */
const flushAudit = () => new Promise(resolve => setImmediate(resolve));

describe('admin routes — the real middleware chain', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = buildApp();
    vi.mocked(prisma.impersonationLog.create).mockResolvedValue({} as never);
    vi.mocked(sessionService.storeRefreshToken).mockResolvedValue(undefined);
    vi.mocked(sessionService.revokeImpersonatedSession).mockResolvedValue(true);
  });

  describe('authorisation', () => {
    it('401s an unauthenticated request to the user list', async () => {
      usersById();
      const res = await request(app).get('/api/admin/users');
      expect(res.status).toBe(401);
      expect(prisma.user.findMany).not.toHaveBeenCalled();
    });

    it('403s a signed-in NON-admin on the user list', async () => {
      usersById(USER);
      const res = await request(app)
        .get('/api/admin/users')
        .set('Cookie', [`access_token=${tokenFor(USER)}`]);

      expect(res.status).toBe(403);
      // The gate must stop the request BEFORE it reads the user table —
      // otherwise a 403 that leaked the row count would still be a leak.
      expect(prisma.user.findMany).not.toHaveBeenCalled();
    });

    it('403s a non-admin trying to impersonate someone', async () => {
      usersById(USER, OTHER_ADMIN);
      const res = await request(app)
        .post('/api/admin/impersonate/admin-2')
        .set('Cookie', [`access_token=${tokenFor(USER)}`]);

      expect(res.status).toBe(403);
      expect(sessionService.storeRefreshToken).not.toHaveBeenCalled();
    });

    it('lets an admin read the user list', async () => {
      usersById(ADMIN);
      vi.mocked(prisma.user.count).mockResolvedValue(1 as never);
      vi.mocked(prisma.user.findMany).mockResolvedValue([
        {
          id: USER.id,
          email: USER.email,
          emailVerified: true,
          isAdmin: false,
          createdAt: new Date('2026-01-02T03:04:05Z'),
          profile: { username: 'someone' },
          _count: { projects: 3 },
        },
      ] as never);

      const res = await request(app)
        .get('/api/admin/users')
        .set('Cookie', [`access_token=${tokenFor(ADMIN)}`]);

      expect(res.status).toBe(200);
      expect(res.body.data.users).toHaveLength(1);
      expect(res.body.data.users[0]).toMatchObject({
        id: USER.id,
        email: USER.email,
        username: 'someone',
        projectCount: 3,
        isAdmin: false,
      });
      expect(res.body.data.total).toBe(1);
    });

    it('re-reads the admin flag per request, so a revoked admin is refused with an unexpired token', async () => {
      // Same token throughout; only the database row changes. This is the
      // whole reason `authenticate` hits the DB on every request.
      const token = tokenFor(ADMIN);
      usersById(ADMIN);
      vi.mocked(prisma.user.count).mockResolvedValue(0 as never);
      vi.mocked(prisma.user.findMany).mockResolvedValue([] as never);

      const before = await request(app)
        .get('/api/admin/users')
        .set('Cookie', [`access_token=${token}`]);
      expect(before.status).toBe(200);

      usersById({ ...ADMIN, isAdmin: false });
      const after = await request(app)
        .get('/api/admin/users')
        .set('Cookie', [`access_token=${token}`]);
      expect(after.status).toBe(403);
    });
  });

  describe('starting an impersonation', () => {
    it('sets the target’s auth cookies and records a start row', async () => {
      usersById(ADMIN, USER);

      const res = await request(app)
        .post('/api/admin/impersonate/user-1')
        .set('Cookie', [`access_token=${tokenFor(ADMIN)}`])
        .set('User-Agent', 'vitest-ua')
        .set('X-Real-IP', '10.1.2.3');

      expect(res.status).toBe(200);
      expect(res.body.data.user.id).toBe(USER.id);
      expect(res.body.data.impersonatedBy.email).toBe(ADMIN.email);

      // The response body must never carry a token — cookies only, exactly
      // like /auth/login.
      expect(JSON.stringify(res.body)).not.toContain('accessToken');

      const cookies = res.headers['set-cookie'] as unknown as string[];
      const access = cookies.find(c => c.startsWith('access_token='));
      expect(access).toBeDefined();
      expect(access).toContain('HttpOnly');
      expect(
        cookies.find(c => c.startsWith('refresh_token='))
      ).toContain('Path=/api/auth');

      await flushAudit();
      expect(prisma.impersonationLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            event: 'start',
            adminId: ADMIN.id,
            targetId: USER.id,
            ip: '10.1.2.3',
            userAgent: 'vitest-ua',
          }),
        })
      );
    });

    it('mints a session whose token carries the impersonator, and stores it in Redis too', async () => {
      usersById(ADMIN, USER);

      await request(app)
        .post('/api/admin/impersonate/user-1')
        .set('Cookie', [`access_token=${tokenFor(ADMIN)}`]);

      // The durable copy is what survives the 13-minute refresh; without it
      // the admin is silently stranded in the target's account.
      const call = vi.mocked(sessionService.storeRefreshToken).mock.calls[0];
      expect(call[0]).toBe(USER.id);
      expect(call[3]).toMatchObject({ impersonatorId: ADMIN.id });
      expect(call[3]?.impersonationSessionId).toEqual(expect.any(String));
    });

    it('refuses to impersonate another administrator, and records the refusal', async () => {
      usersById(ADMIN, OTHER_ADMIN);

      const res = await request(app)
        .post('/api/admin/impersonate/admin-2')
        .set('Cookie', [`access_token=${tokenFor(ADMIN)}`]);

      expect(res.status).toBe(403);
      expect(sessionService.storeRefreshToken).not.toHaveBeenCalled();

      await flushAudit();
      expect(prisma.impersonationLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            event: 'denied',
            detail: 'target-is-admin',
          }),
        })
      );
    });

    it('404s an unknown target and records the refusal with a NULL targetId', async () => {
      usersById(ADMIN);

      const res = await request(app)
        .post('/api/admin/impersonate/nope')
        .set('Cookie', [`access_token=${tokenFor(ADMIN)}`]);

      expect(res.status).toBe(404);
      await flushAudit();

      // `impersonation_logs.targetId` has an FK to users(id). Writing the
      // probed id there raises P2003, which the audit service swallows by
      // design — losing the whole row, and this is precisely the row the log
      // exists for. The id goes in `detail` as free text instead.
      const { data } = vi.mocked(prisma.impersonationLog.create).mock
        .calls[0][0] as { data: Record<string, unknown> };
      expect(data.event).toBe('denied');
      expect(data.targetId).toBeNull();
      expect(data.detail).toBe('target-not-found: nope');
    });

    it('refuses self-impersonation', async () => {
      usersById(ADMIN);
      const res = await request(app)
        .post('/api/admin/impersonate/admin-1')
        .set('Cookie', [`access_token=${tokenFor(ADMIN)}`]);
      expect(res.status).toBe(400);
    });
  });

  describe('an impersonated session', () => {
    const IMPERSONATED = {
      impersonatorId: ADMIN.id,
      impersonationSessionId: 'sess-42',
    };

    it('cannot reach the user list — the admin flag it would pass is the TARGET’s', async () => {
      // The target here is itself an admin row, which is the case a naive
      // `req.user.isAdmin` check would wave straight through.
      usersById(OTHER_ADMIN, ADMIN);

      const res = await request(app)
        .get('/api/admin/users')
        .set('Cookie', [
          `access_token=${tokenFor(OTHER_ADMIN, IMPERSONATED)}`,
        ]);

      expect(res.status).toBe(403);
      expect(prisma.user.findMany).not.toHaveBeenCalled();
    });

    it('cannot start a further impersonation', async () => {
      usersById(USER, ADMIN, OTHER_ADMIN);
      const res = await request(app)
        .post('/api/admin/impersonate/admin-2')
        .set('Cookie', [`access_token=${tokenFor(USER, IMPERSONATED)}`]);

      expect(res.status).toBe(403);
      expect(sessionService.storeRefreshToken).not.toHaveBeenCalled();
    });

    it('CAN stop, getting the admin’s cookies back and a stop row', async () => {
      usersById(USER, ADMIN);

      const res = await request(app)
        .post('/api/admin/impersonate/stop')
        .set('Cookie', [`access_token=${tokenFor(USER, IMPERSONATED)}`]);

      expect(res.status).toBe(200);
      expect(res.body.data.user.email).toBe(ADMIN.email);
      expect(sessionService.storeRefreshToken).toHaveBeenCalledWith(
        ADMIN.id,
        expect.any(String)
      );
      // The impersonated refresh token is revoked server-side, not merely
      // replaced in the browser.
      expect(sessionService.revokeImpersonatedSession).toHaveBeenCalledWith(
        'sess-42'
      );

      await flushAudit();
      expect(prisma.impersonationLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            event: 'stop',
            adminId: ADMIN.id,
            targetId: USER.id,
            sessionId: 'sess-42',
          }),
        })
      );
    });

    it('is refused outright once the impersonator loses the admin flag', async () => {
      usersById(USER, { ...ADMIN, isAdmin: false });

      const res = await request(app)
        .post('/api/admin/impersonate/stop')
        .set('Cookie', [`access_token=${tokenFor(USER, IMPERSONATED)}`]);

      // 401 from `authenticate`: a de-admined operator must not keep acting
      // as someone else, and must not be quietly downgraded to the target's
      // own session either.
      expect(res.status).toBe(401);
    });
  });

  it('rejects a stop from a session that was never impersonated', async () => {
    usersById(USER);
    const res = await request(app)
      .post('/api/admin/impersonate/stop')
      .set('Cookie', [`access_token=${tokenFor(USER)}`]);

    expect(res.status).toBe(400);
    expect(sessionService.storeRefreshToken).not.toHaveBeenCalled();
  });

  it('rejects an impersonation token that carries no session id', async () => {
    // The two claims are minted together. A token with only `impersonatorId`
    // would produce a session that `revokeImpersonatedSession` cannot address
    // and whose audit rows cannot be correlated — live, but untraceable.
    usersById(USER, ADMIN);
    const token = generateAccessToken({
      userId: USER.id,
      email: USER.email,
      emailVerified: true,
      impersonatorId: ADMIN.id,
    });

    const res = await request(app)
      .post('/api/admin/impersonate/stop')
      .set('Cookie', [`access_token=${token}`]);

    expect(res.status).toBe(401);
    expect(sessionService.revokeImpersonatedSession).not.toHaveBeenCalled();
  });

  it('spends the impersonation budget on REFUSED requests too', async () => {
    // The limiter sits in front of `requireAdmin` on purpose: throttling only
    // callers who already passed the gate leaves an ordinary compromised
    // account free to walk user ids one 403 at a time.
    const prober = {
      id: 'prober-1',
      email: 'prober@example.com',
      emailVerified: true,
      isAdmin: false,
      profile: null,
    };
    usersById(prober);
    const cookie = [`access_token=${tokenFor(prober)}`];

    const statuses: number[] = [];
    for (let i = 0; i < 21; i++) {
      const res = await request(app)
        .post('/api/admin/impersonate/some-id')
        .set('Cookie', cookie);
      statuses.push(res.status);
    }

    expect(statuses[0]).toBe(403);
    expect(statuses.at(-1)).toBe(429);
  });

  it('routes /impersonate/stop to the stop handler, not to :userId', async () => {
    // `POST /impersonate/:userId` matches the literal path "/impersonate/stop"
    // with userId === "stop", so declaration order in adminRoutes.ts is
    // load-bearing. If it regresses, an admin clicking "return" would try to
    // impersonate a user called "stop".
    usersById(ADMIN);

    const res = await request(app)
      .post('/api/admin/impersonate/stop')
      .set('Cookie', [`access_token=${tokenFor(ADMIN)}`]);

    // Reached the stop handler (400 "not an impersonation"), NOT the start
    // handler (which would 404 on the missing user "stop").
    expect(res.status).toBe(400);
  });
});
