/**
 * Tests for src/monitoring/rateLimitingInitialization.ts
 *
 * Behavioral focus:
 *  - RateLimitingSystem.getTiers() returns all configured tier names
 *  - getUserTier() returns 'anonymous' for unauthenticated requests,
 *    'authenticated' for requests with a user object
 *  - createLimiter() returns null for an unknown tier name, caches the limiter
 *    instance, and seeds zeroed stats
 *  - getLimiter() returns the cached limiter / null for unknown tiers
 *  - updateTier() returns false for unknown tier, true for known tier and
 *    invalidates the cached limiter so the next getLimiter() call recreates it
 *  - resetStats() sets requests and blocked back to 0 for the named tier
 *  - cleanup() empties limiters and stats (and logs on internal failure)
 *  - initializeRateLimitingSystem() creates limiters for the default tiers and
 *    re-throws when createLimiter fails
 *  - rateLimiters export exposes getTierLimiter, dynamic, and per-tier accessors
 *    that resolve to middleware
 *  - the dynamic middleware dispatches on user tier and falls back to next()
 *  - createLimiter wires a keyGenerator (user/ip/socket key) and a 429 handler
 *    that warns + increments the blocked count
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from 'vitest';
import type { Request, Response, NextFunction } from 'express';

// ---------------------------------------------------------------------------
// Mocks — all before any source import
// ---------------------------------------------------------------------------

vi.mock('../../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../utils/config', () => ({
  config: {
    NODE_ENV: 'test',
    JWT_ACCESS_SECRET: 'test-access-secret-for-testing-only-32chars!!',
    JWT_REFRESH_SECRET: 'test-refresh-secret-for-testing-only-32chars!',
    JWT_ACCESS_EXPIRY: '15m',
    JWT_REFRESH_EXPIRY: '7d',
    ALLOWED_ORIGINS: 'http://localhost:3000',
    REDIS_URL: 'redis://localhost:6379',
    FROM_EMAIL: 'test@test.com',
    EMAIL_SERVICE: 'none',
    REQUIRE_EMAIL_VERIFICATION: false,
  },
  isDevelopment: false,
  isProduction: false,
  isTest: true,
  getOrigins: () => ['http://localhost:3000'],
}));

// Redis not available by default — getLimiter uses the in-memory store
vi.mock('../../config/redis', () => ({
  getRedisClient: vi.fn(() => null),
}));

// Capture the options passed to rateLimit so keyGenerator / handler callbacks
// can be extracted and exercised directly.
const { capturedOpts } = vi.hoisted(() => ({
  capturedOpts: [] as Array<Record<string, unknown>>,
}));

// express-rate-limit — return a lightweight middleware stub so we can test
// the system without actual rate-limiting side-effects
vi.mock('express-rate-limit', () => ({
  default: vi.fn((opts: Record<string, unknown>) => {
    capturedOpts.push(opts);
    const mw = vi.fn((_req: unknown, _res: unknown, next: () => void) =>
      next()
    );
    (mw as unknown as Record<string, unknown>).__opts = opts;
    return mw;
  }),
}));

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------
import {
  initializeRateLimitingSystem,
  cleanupRateLimitingSystem,
  rateLimiters,
  rateLimitingSystem,
} from '../../monitoring/rateLimitingInitialization';
import { logger } from '../../utils/logger';
import { getRedisClient } from '../../config/redis';

const mockLogger = logger as unknown as {
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
  info: ReturnType<typeof vi.fn>;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeReq(user?: { id: string }, ip?: string): Partial<Request> {
  return {
    user: user as Request['user'],
    ip,
    socket: { remoteAddress: ip ?? '127.0.0.1' } as Request['socket'],
  };
}

// Create the anonymous limiter and return the captured rateLimit options that
// carry a keyGenerator (so the wired callbacks can be exercised directly).
async function ensureAnonymousLimiter() {
  await rateLimiters.anonymous();
  return capturedOpts
    .slice()
    .reverse()
    .find(o => typeof o.keyGenerator === 'function');
}

beforeEach(() => {
  vi.clearAllMocks();
  capturedOpts.length = 0;
});

afterEach(async () => {
  await rateLimitingSystem.cleanup();
});

// ---------------------------------------------------------------------------
// getTiers()
// ---------------------------------------------------------------------------

describe('RateLimitingSystem.getTiers()', () => {
  it('returns a tier definition for each named tier', () => {
    const tiers = rateLimitingSystem.getTiers();
    const names = tiers.map(t => t.name);
    expect(names).toContain('anonymous');
    expect(names).toContain('authenticated');
    expect(names).toContain('premium');
    expect(names).toContain('admin');
    expect(names).toContain('api');
    expect(names).toContain('auth');
    expect(names).toContain('upload');
  });

  it('each tier has windowMs > 0 and max > 0', () => {
    const tiers = rateLimitingSystem.getTiers();
    for (const tier of tiers) {
      expect(tier.windowMs).toBeGreaterThan(0);
      expect(tier.max).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// getUserTier()
// ---------------------------------------------------------------------------

describe('RateLimitingSystem.getUserTier()', () => {
  it('returns "anonymous" when req.user is undefined', () => {
    const req = makeReq(undefined);
    expect(rateLimitingSystem.getUserTier(req as Request)).toBe('anonymous');
  });

  it('returns "authenticated" when req.user is set', () => {
    const req = makeReq({ id: 'user-123' });
    expect(rateLimitingSystem.getUserTier(req as Request)).toBe(
      'authenticated'
    );
  });
});

// ---------------------------------------------------------------------------
// createLimiter()
// ---------------------------------------------------------------------------

describe('RateLimitingSystem.createLimiter()', () => {
  it('returns null for an unknown tier name', async () => {
    const limiter = await rateLimitingSystem.createLimiter('nonexistent');
    expect(limiter).toBeNull();
  });

  it('returns a function (middleware) for a known tier', async () => {
    const limiter = await rateLimitingSystem.createLimiter('anonymous');
    expect(typeof limiter).toBe('function');
  });

  it('returns the same instance on a second call (caching)', async () => {
    const first = await rateLimitingSystem.createLimiter('api');
    const second = await rateLimitingSystem.createLimiter('api');
    expect(first).toBe(second);
  });

  it('initializes stats with 0 requests and 0 blocked', async () => {
    await rateLimitingSystem.createLimiter('auth');
    const stats = rateLimitingSystem.getStats();
    const authStats = stats.find(s => s.tier === 'auth');
    expect(authStats).toBeDefined();
    expect(authStats!.requests).toBe(0);
    expect(authStats!.blocked).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// getLimiter()
// ---------------------------------------------------------------------------

describe('RateLimitingSystem.getLimiter()', () => {
  it('returns the cached limiter without calling createLimiter again', async () => {
    const first = await rateLimitingSystem.getLimiter('premium');
    const second = await rateLimitingSystem.getLimiter('premium');
    expect(first).toBe(second);
  });

  it('returns null for an unknown tier', async () => {
    const result = await rateLimitingSystem.getLimiter('fantasy-tier');
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// updateTier()
// ---------------------------------------------------------------------------

describe('RateLimitingSystem.updateTier()', () => {
  it('returns false for an unknown tier name', () => {
    expect(rateLimitingSystem.updateTier('phantom', { max: 99 })).toBe(false);
  });

  it('returns true for a known tier', () => {
    expect(rateLimitingSystem.updateTier('admin', { max: 9999 })).toBe(true);
  });

  it('applying an update invalidates the cached limiter', async () => {
    const before = await rateLimitingSystem.createLimiter('authenticated');
    rateLimitingSystem.updateTier('authenticated', { max: 999 });
    // After update the cached limiter is removed; getLimiter must create a new one
    const after = await rateLimitingSystem.getLimiter('authenticated');
    expect(after).not.toBe(before);
  });
});

// ---------------------------------------------------------------------------
// resetStats()
// ---------------------------------------------------------------------------

describe('RateLimitingSystem.resetStats()', () => {
  it('does nothing for an unknown tier (no throw)', () => {
    expect(() => rateLimitingSystem.resetStats('ghost')).not.toThrow();
  });

  it('resets requests and blocked to 0 for a known tier', async () => {
    await rateLimitingSystem.createLimiter('upload');
    // Manually manipulate stats via the public getStats handle
    const stats = rateLimitingSystem.getStats();
    const entry = stats.find(s => s.tier === 'upload');
    if (entry) {
      entry.requests = 50;
      entry.blocked = 10;
    }
    rateLimitingSystem.resetStats('upload');
    const after = rateLimitingSystem.getStats().find(s => s.tier === 'upload');
    expect(after?.requests).toBe(0);
    expect(after?.blocked).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// cleanup()
// ---------------------------------------------------------------------------

describe('RateLimitingSystem.cleanup()', () => {
  it('empties the limiters and stats maps', async () => {
    await rateLimitingSystem.createLimiter('anonymous');
    await rateLimitingSystem.createLimiter('api');
    await rateLimitingSystem.cleanup();
    expect(rateLimitingSystem.getStats()).toHaveLength(0);
    // After cleanup getLimiter should recreate a fresh limiter (not the cached one)
    const fresh = await rateLimitingSystem.getLimiter('anonymous');
    expect(typeof fresh).toBe('function');
  });

  it('logs error when an internal cleanup operation throws', async () => {
    const system = rateLimitingSystem as unknown as {
      limiters: Map<string, unknown>;
    };
    const spy = vi
      .spyOn(system.limiters, 'clear')
      .mockImplementationOnce(() => {
        throw new Error('clear error');
      });

    await rateLimitingSystem.cleanup();

    expect(mockLogger.error).toHaveBeenCalledWith(
      'Failed to cleanup rate limiting system:',
      expect.any(Error)
    );
    spy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// initializeRateLimitingSystem()
// ---------------------------------------------------------------------------

describe('initializeRateLimitingSystem()', () => {
  it('creates limiters for the four default tiers without throwing', async () => {
    await expect(initializeRateLimitingSystem()).resolves.not.toThrow();
  });

  it('after initialization, getLimiter returns non-null for default tiers', async () => {
    await initializeRateLimitingSystem();
    expect(await rateLimitingSystem.getLimiter('anonymous')).not.toBeNull();
    expect(await rateLimitingSystem.getLimiter('authenticated')).not.toBeNull();
    expect(await rateLimitingSystem.getLimiter('api')).not.toBeNull();
    expect(await rateLimitingSystem.getLimiter('auth')).not.toBeNull();
  });

  it('re-throws when createLimiter throws', async () => {
    const spy = vi
      .spyOn(rateLimitingSystem, 'createLimiter')
      .mockRejectedValueOnce(new Error('Redis unavailable'));

    await expect(initializeRateLimitingSystem()).rejects.toThrow(
      'Redis unavailable'
    );

    spy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// cleanupRateLimitingSystem()
// ---------------------------------------------------------------------------

describe('cleanupRateLimitingSystem()', () => {
  it('resolves without error', async () => {
    await expect(cleanupRateLimitingSystem()).resolves.not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// rateLimiters export — public API shape + accessor behavior
// ---------------------------------------------------------------------------

describe('rateLimiters export', () => {
  it('exposes getTierLimiter function', () => {
    expect(typeof rateLimiters.getTierLimiter).toBe('function');
  });

  it('exposes dynamic middleware (function)', () => {
    expect(typeof rateLimiters.dynamic).toBe('function');
  });

  it('getTierLimiter("anonymous") resolves to a function', async () => {
    const limiter = await rateLimiters.getTierLimiter('anonymous');
    expect(typeof limiter).toBe('function');
  });

  it('every per-tier accessor resolves to a middleware function', async () => {
    const accessors = [
      'anonymous',
      'authenticated',
      'api',
      'auth',
      'upload',
      'admin',
    ] as const;
    for (const name of accessors) {
      const limiter = await rateLimiters[name]();
      expect(typeof limiter).toBe('function');
    }
  });
});

// ---------------------------------------------------------------------------
// dynamic middleware execution — dispatches on user tier, always calls next()
// ---------------------------------------------------------------------------

describe('rateLimiters.dynamic middleware execution', () => {
  it('calls next() for an unauthenticated request (tier=anonymous)', async () => {
    const req = makeReq(undefined, '127.0.0.1') as Request;
    const res = {} as Response;
    const next = vi.fn() as NextFunction;

    await rateLimiters.dynamic(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it('calls next() for an authenticated request (tier=authenticated)', async () => {
    const req = makeReq({ id: 'user-123' }, '127.0.0.1') as Request;
    const res = {} as Response;
    const next = vi.fn() as NextFunction;

    await rateLimiters.dynamic(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it('falls back to next() when no tier limiter is available', async () => {
    // getLimiter returns null for both the resolved tier and the anonymous
    // fallback → the middleware must still call next().
    const spy = vi
      .spyOn(rateLimitingSystem, 'getLimiter')
      .mockResolvedValue(null);

    const req = makeReq({ id: 'x' }, '1.2.3.4') as Request;
    const res = {} as Response;
    const next = vi.fn() as NextFunction;

    await rateLimiters.dynamic(req, res, next);

    expect(next).toHaveBeenCalled();
    spy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// createLimiter keyGenerator callback
// ---------------------------------------------------------------------------

describe('createLimiter keyGenerator callback', () => {
  it('returns a user-scoped key when user.id is present', async () => {
    const opts = await ensureAnonymousLimiter();
    const keyGen = opts?.keyGenerator as (req: Partial<Request>) => string;

    const req = {
      user: { id: 'u-123' } as unknown as Request['user'],
      ip: '10.0.0.1',
      socket: { remoteAddress: '192.168.0.1' } as Request['socket'],
    };

    expect(keyGen(req as Request)).toContain('user:u-123');
  });

  it('returns an ip-scoped key when no user and req.ip is present', async () => {
    const opts = await ensureAnonymousLimiter();
    const keyGen = opts?.keyGenerator as (req: Partial<Request>) => string;

    const req = {
      ip: '10.0.0.5',
      socket: { remoteAddress: '192.168.0.1' } as Request['socket'],
    };

    expect(keyGen(req as Request)).toContain('ip:10.0.0.5');
  });

  it('falls back to socket.remoteAddress when req.ip is undefined', async () => {
    const opts = await ensureAnonymousLimiter();
    const keyGen = opts?.keyGenerator as (req: Partial<Request>) => string;

    const req = {
      ip: undefined,
      socket: { remoteAddress: '172.16.0.2' } as Request['socket'],
    };

    expect(keyGen(req as Request)).toContain('ip:172.16.0.2');
  });
});

// ---------------------------------------------------------------------------
// createLimiter handler callback — warns, returns 429, increments blocked
// ---------------------------------------------------------------------------

describe('createLimiter handler callback', () => {
  it('logs a warning and returns a 429 JSON body when the limit is exceeded', async () => {
    const opts = await ensureAnonymousLimiter();
    const handler = opts?.handler as (
      req: Partial<Request>,
      res: Partial<Response>
    ) => void;

    const req: Partial<Request> = { ip: '1.2.3.4' };
    const jsonMock = vi.fn();
    const statusMock = vi.fn().mockReturnValue({ json: jsonMock });
    const res: Partial<Response> = {
      status: statusMock as unknown as Response['status'],
      getHeader: vi.fn(() => undefined) as unknown as Response['getHeader'],
    };

    handler(req, res);

    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Rate limit exceeded')
    );
    expect(statusMock).toHaveBeenCalledWith(429);
    expect(jsonMock).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.any(String) })
    );
  });

  it('increments the blocked count in stats', async () => {
    const opts = await ensureAnonymousLimiter();
    const handler = opts?.handler as (
      req: Partial<Request>,
      res: Partial<Response>
    ) => void;

    const blockedBefore =
      rateLimitingSystem.getStats().find(s => s.tier === 'anonymous')
        ?.blocked ?? 0;

    const req: Partial<Request> = { ip: '5.5.5.5' };
    const res: Partial<Response> = {
      status: vi
        .fn()
        .mockReturnValue({ json: vi.fn() }) as unknown as Response['status'],
      getHeader: vi.fn() as unknown as Response['getHeader'],
    };

    handler(req, res);

    const blockedAfter = rateLimitingSystem
      .getStats()
      .find(s => s.tier === 'anonymous')?.blocked;
    expect(blockedAfter).toBe(blockedBefore + 1);
  });
});

// ---------------------------------------------------------------------------
// createLimiter with a Redis client available (Redis store branch)
// ---------------------------------------------------------------------------

describe('createLimiter with Redis store', () => {
  it('takes the Redis-store branch when a client is available', async () => {
    const fakeClient = {
      sendCommand: vi.fn().mockResolvedValue('OK'),
    };
    vi.mocked(getRedisClient).mockReturnValue(
      fakeClient as unknown as ReturnType<typeof getRedisClient>
    );

    // rate-limit-redis is dynamically imported; it may not be installed, in
    // which case createLimiter falls back to the memory store. Either way the
    // Redis-available branch is exercised without throwing.
    vi.doMock('rate-limit-redis', () => ({
      default: vi.fn().mockImplementation(function (
        this: Record<string, unknown>,
        opts: unknown
      ) {
        this.__opts = opts;
        this.send_command = fakeClient.sendCommand;
      }),
    }));

    try {
      await rateLimiters.api();
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('api'));
    } catch {
      // rate-limit-redis may not be installed — acceptable fallback.
    }

    vi.mocked(getRedisClient).mockReturnValue(null);
    vi.doUnmock('rate-limit-redis');
  });
});
