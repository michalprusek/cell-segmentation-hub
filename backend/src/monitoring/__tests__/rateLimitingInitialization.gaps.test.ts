/**
 * rateLimitingInitialization.gaps.test.ts
 *
 * Covers branches NOT exercised by rateLimitingInitialization.test.ts:
 *
 *  1. rateLimiters.anonymous/authenticated/api/auth/upload/admin() accessor
 *     functions — each just calls getLimiter and returns a function.
 *  2. createDynamicLimiter() — the returned middleware is invoked:
 *     a. with an unauthenticated request (tier='anonymous') → calls the
 *        anonymous limiter middleware
 *     b. with an authenticated request (tier='authenticated') → calls the
 *        authenticated limiter middleware
 *  3. initializeRateLimitingSystem() error path — createLimiter throws
 *     → the error is re-thrown (lines 341-342).
 *
 * Deliberately skipped (infra-bound):
 *  - Real Redis connection (we mock getRedisClient → null throughout)
 *  - rate-limit-redis dynamic import (never triggered without Redis)
 *  - The rate-limit handler/keyGenerator callbacks (they are inside the
 *    express-rate-limit mock; asserting they're passed is sufficient)
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { Request, Response, NextFunction } from 'express';

// ---------------------------------------------------------------------------
// Mocks — identical to the sibling test file so the singleton module is shared
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

vi.mock('../../config/redis', () => ({
  getRedisClient: vi.fn(() => null),
}));

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
// Imports after mocks
// ---------------------------------------------------------------------------
import {
  rateLimiters,
  rateLimitingSystem,
  initializeRateLimitingSystem,
} from '../rateLimitingInitialization';

afterEach(async () => {
  await rateLimitingSystem.cleanup();
});

// ---------------------------------------------------------------------------
// rateLimiters accessor functions
// ---------------------------------------------------------------------------

describe('rateLimiters accessor functions resolve to middleware', () => {
  it('anonymous() resolves to a function', async () => {
    const l = await rateLimiters.anonymous();
    expect(typeof l).toBe('function');
  });

  it('authenticated() resolves to a function', async () => {
    const l = await rateLimiters.authenticated();
    expect(typeof l).toBe('function');
  });

  it('api() resolves to a function', async () => {
    const l = await rateLimiters.api();
    expect(typeof l).toBe('function');
  });

  it('auth() resolves to a function', async () => {
    const l = await rateLimiters.auth();
    expect(typeof l).toBe('function');
  });

  it('upload() resolves to a function', async () => {
    const l = await rateLimiters.upload();
    expect(typeof l).toBe('function');
  });

  it('admin() resolves to a function', async () => {
    const l = await rateLimiters.admin();
    expect(typeof l).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// createDynamicLimiter / dynamic middleware execution
// ---------------------------------------------------------------------------

describe('rateLimiters.dynamic middleware execution', () => {
  function makeReq(user?: { id: string }): Partial<Request> {
    return {
      user: user as Request['user'],
      ip: '127.0.0.1',
      socket: { remoteAddress: '127.0.0.1' } as any,
    };
  }

  it('calls next() for an unauthenticated request (tier=anonymous)', async () => {
    const req = makeReq(undefined) as Request;
    const res = {} as Response;
    const next = vi.fn() as NextFunction;

    await rateLimiters.dynamic(req, res, next);

    // The stub middleware calls next(); verify the request was processed
    expect(next).toHaveBeenCalled();
  });

  it('calls next() for an authenticated request (tier=authenticated)', async () => {
    const req = makeReq({ id: 'user-123' }) as Request;
    const res = {} as Response;
    const next = vi.fn() as NextFunction;

    await rateLimiters.dynamic(req, res, next);

    expect(next).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// initializeRateLimitingSystem error path
// ---------------------------------------------------------------------------

describe('initializeRateLimitingSystem — error path', () => {
  it('re-throws when createLimiter throws', async () => {
    // Spy on createLimiter to throw once
    const spy = vi
      .spyOn(rateLimitingSystem, 'createLimiter')
      .mockRejectedValueOnce(new Error('Redis unavailable'));

    await expect(initializeRateLimitingSystem()).rejects.toThrow(
      'Redis unavailable'
    );

    spy.mockRestore();
  });
});
