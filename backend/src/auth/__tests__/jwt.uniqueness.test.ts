/**
 * Two sessions must never hold the same refresh token.
 *
 * Real jsonwebtoken, frozen clock: the collision only exists when two tokens
 * are signed in the same second, which a test without a frozen clock hits by
 * luck or not at all.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// The global setup mocks jsonwebtoken; this suite is about what the real
// library puts in a token.
vi.unmock('jsonwebtoken');

vi.mock('../../utils/config', () => ({
  config: {
    JWT_ACCESS_SECRET: 'access-secret-for-tests-0123456789abcdef',
    JWT_REFRESH_SECRET: 'refresh-secret-for-tests-0123456789abcdef',
    JWT_ACCESS_EXPIRY: '15m',
    JWT_REFRESH_EXPIRY: '7d',
    JWT_REFRESH_EXPIRY_REMEMBER: '30d',
  },
}));
vi.mock('../../utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { generateTokenPair, verifyAccessToken } from '../jwt';

const PAYLOAD = {
  userId: 'user-1',
  email: 'user@example.com',
  emailVerified: true,
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-07T12:00:00.250Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

describe('refresh tokens', () => {
  it('differ for the same user, lifetime and instant', () => {
    const a = generateTokenPair(PAYLOAD, false).refreshToken;
    const b = generateTokenPair(PAYLOAD, false).refreshToken;

    // Identical strings share ONE session record: one browser logging out
    // signs the other out, and the session a password change re-issues can
    // be the very token of a session that change was ending.
    expect(a).not.toBe(b);
  });
});

describe('access tokens', () => {
  it('carry the millisecond they were issued at', () => {
    const { accessToken } = generateTokenPair(PAYLOAD, false);

    const claims = verifyAccessToken(accessToken);

    expect(claims.iatMs).toBe(Date.parse('2026-10-07T12:00:00.250Z'));
    // The standard claim is still there, in whole seconds.
    expect(claims.iat).toBe(Math.floor(claims.iatMs! / 1000));
  });
});
