/**
 * Tests for src/monitoring/rateLimitingInitialization.ts
 *
 * Behavioral focus:
 *  - RateLimitingSystem.getTiers() returns all configured tier names
 *  - getUserTier() returns 'anonymous' for unauthenticated requests,
 *    'authenticated' for requests with a user object
 *  - createLimiter() returns null for an unknown tier name
 *  - createLimiter() returns the same limiter instance on repeated calls
 *    (cached — does not recreate)
 *  - updateTier() returns false for unknown tier, true for known tier and
 *    invalidates the cached limiter so the next getLimiter() call recreates it
 *  - resetStats() sets requests and blocked back to 0 for the named tier
 *  - cleanup() empties limiters and stats
 *  - initializeRateLimitingSystem() creates limiters for the four default tiers
 *  - rateLimiters export exposes getTierLimiter, dynamic, anonymous, api, auth
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Request } from 'express';

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

// Redis not available — getLimiter will use memory store
vi.mock('../../config/redis', () => ({
  getRedisClient: vi.fn(() => null),
}));

// express-rate-limit — return a lightweight middleware stub so we can test
// the system without actual rate-limiting side-effects
vi.mock('express-rate-limit', () => ({
  default: vi.fn((opts: Record<string, unknown>) => {
    const mw = vi.fn((_req: unknown, _res: unknown, next: () => void) =>
      next()
    );
    (mw as unknown as Record<string, unknown>).__opts = opts;
    return mw;
  }),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------
import {
  initializeRateLimitingSystem,
  cleanupRateLimitingSystem,
  rateLimiters,
  rateLimitingSystem,
} from '../../monitoring/rateLimitingInitialization';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeReq(user?: { id: string }): Partial<Request> {
  return { user: user as Request['user'] };
}

// ---------------------------------------------------------------------------
// Tests
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

describe('RateLimitingSystem.createLimiter()', () => {
  afterEach(async () => {
    await rateLimitingSystem.cleanup();
  });

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

describe('RateLimitingSystem.getLimiter()', () => {
  afterEach(async () => {
    await rateLimitingSystem.cleanup();
  });

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

describe('RateLimitingSystem.updateTier()', () => {
  afterEach(async () => {
    await rateLimitingSystem.cleanup();
  });

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

describe('RateLimitingSystem.resetStats()', () => {
  afterEach(async () => {
    await rateLimitingSystem.cleanup();
  });

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
});

describe('initializeRateLimitingSystem()', () => {
  afterEach(async () => {
    await rateLimitingSystem.cleanup();
  });

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
});

describe('cleanupRateLimitingSystem()', () => {
  it('resolves without error', async () => {
    await expect(cleanupRateLimitingSystem()).resolves.not.toThrow();
  });
});

describe('rateLimiters export', () => {
  it('exposes getTierLimiter function', () => {
    expect(typeof rateLimiters.getTierLimiter).toBe('function');
  });

  it('exposes dynamic middleware (function)', () => {
    expect(typeof rateLimiters.dynamic).toBe('function');
  });

  it('exposes anonymous, authenticated, api, auth, upload, admin accessor fns', () => {
    expect(typeof rateLimiters.anonymous).toBe('function');
    expect(typeof rateLimiters.authenticated).toBe('function');
    expect(typeof rateLimiters.api).toBe('function');
    expect(typeof rateLimiters.auth).toBe('function');
    expect(typeof rateLimiters.upload).toBe('function');
    expect(typeof rateLimiters.admin).toBe('function');
  });

  it('getTierLimiter("anonymous") resolves to a function', async () => {
    const limiter = await rateLimiters.getTierLimiter('anonymous');
    expect(typeof limiter).toBe('function');
  });
});
