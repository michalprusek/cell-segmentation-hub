/**
 * jwt.behavior.test.ts
 *
 * Behavioral tests for src/auth/jwt.ts covering the remaining 73 % of
 * uncovered lines.  Uses real jsonwebtoken with the test secrets that
 * vitest.env.ts configures, so the sign/verify round-trip is genuine.
 *
 * Skipped: anything that requires a live database (no Prisma calls in jwt.ts).
 */

import { describe, it, expect, vi } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────────────
// src/test/setup.ts calls `vi.mock('jsonwebtoken')` globally (auto-mocks it).
// We override that here so the real jsonwebtoken is used for round-trip tests.
vi.mock('jsonwebtoken', async () => {
  const real =
    await vi.importActual<typeof import('jsonwebtoken')>('jsonwebtoken');
  return { ...real, default: real };
});

// config is mocked to avoid the real zod validation calling process.exit(1)
// when optional env vars are absent in the test process.
vi.mock('../../utils/config', () => ({
  config: {
    JWT_ACCESS_SECRET: 'test-access-secret-for-testing-only-32-characters-long',
    JWT_REFRESH_SECRET:
      'test-refresh-secret-for-testing-only-32-characters-long',
    JWT_ACCESS_EXPIRY: '15m',
    JWT_REFRESH_EXPIRY: '7d',
    JWT_REFRESH_EXPIRY_REMEMBER: '30d',
  },
}));

vi.mock('../../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ── Import after mocks ────────────────────────────────────────────────────────
import {
  generateAccessToken,
  generateRefreshToken,
  generateTokenPair,
  verifyAccessToken,
  verifyRefreshToken,
  getTokenExpiration,
  isTokenExpired,
  JwtPayload,
} from '../jwt';
import { config } from '../../utils/config';
import jwt from 'jsonwebtoken';

// ── Helpers ───────────────────────────────────────────────────────────────────
const PAYLOAD: JwtPayload = {
  userId: 'user-abc-123',
  email: 'test@spheroseg.com',
  emailVerified: true,
};

// ── generateAccessToken ───────────────────────────────────────────────────────

describe('generateAccessToken', () => {
  it('returns a non-empty JWT string', () => {
    const token = generateAccessToken(PAYLOAD);
    expect(typeof token).toBe('string');
    expect(token.split('.').length).toBe(3); // header.payload.signature
  });

  it('encodes the payload fields correctly', () => {
    const token = generateAccessToken(PAYLOAD);
    const decoded = jwt.decode(token) as jwt.JwtPayload;
    expect(decoded.userId).toBe(PAYLOAD.userId);
    expect(decoded.email).toBe(PAYLOAD.email);
    expect(decoded.emailVerified).toBe(true);
  });

  it('sets issuer to cell-segmentation-api', () => {
    const token = generateAccessToken(PAYLOAD);
    const decoded = jwt.decode(token) as jwt.JwtPayload;
    expect(decoded.iss).toBe('cell-segmentation-api');
  });

  it('sets audience to cell-segmentation-app', () => {
    const token = generateAccessToken(PAYLOAD);
    const decoded = jwt.decode(token) as jwt.JwtPayload;
    expect(decoded.aud).toBe('cell-segmentation-app');
  });

  it('throws "Token generation failed" when JWT_ACCESS_SECRET is missing', () => {
    const savedSecret = (config as Record<string, unknown>).JWT_ACCESS_SECRET;
    (config as Record<string, unknown>).JWT_ACCESS_SECRET = undefined;
    try {
      expect(() => generateAccessToken(PAYLOAD)).toThrow(
        'Token generation failed'
      );
    } finally {
      (config as Record<string, unknown>).JWT_ACCESS_SECRET = savedSecret;
    }
  });
});

// ── generateRefreshToken ──────────────────────────────────────────────────────

describe('generateRefreshToken', () => {
  it('returns a valid JWT string', () => {
    const token = generateRefreshToken(PAYLOAD);
    expect(token.split('.').length).toBe(3);
  });

  it('uses JWT_REFRESH_EXPIRY when rememberMe=false', () => {
    const token = generateRefreshToken(PAYLOAD, false);
    const decoded = jwt.decode(token) as jwt.JwtPayload;
    // 7d expiry ≈ now + 7*86400 s
    const sevenDays = 7 * 24 * 60 * 60;
    const diff = decoded.exp! - Math.floor(Date.now() / 1000);
    expect(diff).toBeGreaterThan(sevenDays - 60);
    expect(diff).toBeLessThanOrEqual(sevenDays + 10);
  });

  it('uses JWT_REFRESH_EXPIRY_REMEMBER when rememberMe=true', () => {
    const token = generateRefreshToken(PAYLOAD, true);
    const decoded = jwt.decode(token) as jwt.JwtPayload;
    // 30d > 7d
    const thirtyDays = 30 * 24 * 60 * 60;
    const diff = decoded.exp! - Math.floor(Date.now() / 1000);
    expect(diff).toBeGreaterThan(thirtyDays - 60);
  });

  it('falls back to JWT_REFRESH_EXPIRY when REMEMBER is not configured', () => {
    const savedRemember = (config as Record<string, unknown>)
      .JWT_REFRESH_EXPIRY_REMEMBER;
    (config as Record<string, unknown>).JWT_REFRESH_EXPIRY_REMEMBER = undefined;
    try {
      const token = generateRefreshToken(PAYLOAD, true);
      expect(token.split('.').length).toBe(3);
    } finally {
      (config as Record<string, unknown>).JWT_REFRESH_EXPIRY_REMEMBER =
        savedRemember;
    }
  });

  it('throws when JWT_REFRESH_SECRET is missing', () => {
    const savedSecret = (config as Record<string, unknown>).JWT_REFRESH_SECRET;
    (config as Record<string, unknown>).JWT_REFRESH_SECRET = undefined;
    try {
      expect(() => generateRefreshToken(PAYLOAD)).toThrow(
        'Token generation failed'
      );
    } finally {
      (config as Record<string, unknown>).JWT_REFRESH_SECRET = savedSecret;
    }
  });

  it('throws when both EXPIRY values are missing', () => {
    const savedExpiry = (config as Record<string, unknown>).JWT_REFRESH_EXPIRY;
    const savedRemember = (config as Record<string, unknown>)
      .JWT_REFRESH_EXPIRY_REMEMBER;
    (config as Record<string, unknown>).JWT_REFRESH_EXPIRY = undefined;
    (config as Record<string, unknown>).JWT_REFRESH_EXPIRY_REMEMBER = undefined;
    try {
      expect(() => generateRefreshToken(PAYLOAD)).toThrow(
        'Token generation failed'
      );
    } finally {
      (config as Record<string, unknown>).JWT_REFRESH_EXPIRY = savedExpiry;
      (config as Record<string, unknown>).JWT_REFRESH_EXPIRY_REMEMBER =
        savedRemember;
    }
  });
});

// ── generateTokenPair ─────────────────────────────────────────────────────────

describe('generateTokenPair', () => {
  it('returns both accessToken and refreshToken', () => {
    const pair = generateTokenPair(PAYLOAD);
    expect(typeof pair.accessToken).toBe('string');
    expect(typeof pair.refreshToken).toBe('string');
  });

  it('access and refresh tokens are distinct', () => {
    const pair = generateTokenPair(PAYLOAD);
    expect(pair.accessToken).not.toBe(pair.refreshToken);
  });

  it('rememberMe=true produces a refresh token with longer expiry than default', () => {
    const regular = generateTokenPair(PAYLOAD, false);
    const remembered = generateTokenPair(PAYLOAD, true);
    const regDecoded = jwt.decode(regular.refreshToken) as jwt.JwtPayload;
    const remDecoded = jwt.decode(remembered.refreshToken) as jwt.JwtPayload;
    expect(remDecoded.exp!).toBeGreaterThan(regDecoded.exp!);
  });
});

// ── verifyAccessToken ─────────────────────────────────────────────────────────

describe('verifyAccessToken', () => {
  it('returns the payload for a valid access token', () => {
    const token = generateAccessToken(PAYLOAD);
    const result = verifyAccessToken(token);
    expect(result.userId).toBe(PAYLOAD.userId);
    expect(result.email).toBe(PAYLOAD.email);
    expect(result.emailVerified).toBe(PAYLOAD.emailVerified);
  });

  it('throws "Invalid access token" for a malformed token', () => {
    expect(() => verifyAccessToken('not.a.token')).toThrow(
      'Invalid access token'
    );
  });

  it('throws "Access token expired" for an expired token', () => {
    // Sign a token that expired 1 second ago using the real secret
    const expired = jwt.sign(
      {
        ...PAYLOAD,
        iss: 'cell-segmentation-api',
        aud: 'cell-segmentation-app',
      },
      'test-access-secret-for-testing-only-32-characters-long',
      { expiresIn: -1 } as jwt.SignOptions
    );
    expect(() => verifyAccessToken(expired)).toThrow('Access token expired');
  });

  it('throws "Invalid access token" when signed with a wrong secret', () => {
    const wrongSecret = jwt.sign(PAYLOAD, 'completely-different-secret-xyz');
    expect(() => verifyAccessToken(wrongSecret)).toThrow(
      'Invalid access token'
    );
  });

  it('throws when JWT_ACCESS_SECRET is not configured', () => {
    const savedSecret = (config as Record<string, unknown>).JWT_ACCESS_SECRET;
    (config as Record<string, unknown>).JWT_ACCESS_SECRET = undefined;
    const token = jwt.sign(PAYLOAD, 'some-secret');
    try {
      expect(() => verifyAccessToken(token)).toThrow();
    } finally {
      (config as Record<string, unknown>).JWT_ACCESS_SECRET = savedSecret;
    }
  });
});

// ── verifyRefreshToken ────────────────────────────────────────────────────────

describe('verifyRefreshToken', () => {
  it('returns the payload for a valid refresh token', () => {
    const token = generateRefreshToken(PAYLOAD);
    const result = verifyRefreshToken(token);
    expect(result.userId).toBe(PAYLOAD.userId);
    expect(result.email).toBe(PAYLOAD.email);
  });

  it('throws "Invalid refresh token" for a malformed token', () => {
    expect(() => verifyRefreshToken('bad.token.value')).toThrow(
      'Invalid refresh token'
    );
  });

  it('throws "Refresh token expired" for a past-expiry token', () => {
    const expired = jwt.sign(
      {
        ...PAYLOAD,
        iss: 'cell-segmentation-api',
        aud: 'cell-segmentation-app',
      },
      'test-refresh-secret-for-testing-only-32-characters-long',
      { expiresIn: -1 } as jwt.SignOptions
    );
    expect(() => verifyRefreshToken(expired)).toThrow('Refresh token expired');
  });

  it('throws "Invalid refresh token" when signed with wrong secret', () => {
    const wrongSecret = jwt.sign(PAYLOAD, 'wrong-refresh-secret-here-12345');
    expect(() => verifyRefreshToken(wrongSecret)).toThrow(
      'Invalid refresh token'
    );
  });

  it('rejects an access token when used as a refresh token (different secrets)', () => {
    // Access token signed with ACCESS_SECRET — refresh verify uses REFRESH_SECRET
    const accessToken = generateAccessToken(PAYLOAD);
    expect(() => verifyRefreshToken(accessToken)).toThrow(
      'Invalid refresh token'
    );
  });

  it('throws when JWT_REFRESH_SECRET is not configured', () => {
    const savedSecret = (config as Record<string, unknown>).JWT_REFRESH_SECRET;
    (config as Record<string, unknown>).JWT_REFRESH_SECRET = undefined;
    const token = jwt.sign(PAYLOAD, 'some-secret');
    try {
      expect(() => verifyRefreshToken(token)).toThrow();
    } finally {
      (config as Record<string, unknown>).JWT_REFRESH_SECRET = savedSecret;
    }
  });
});

// ── getTokenExpiration ────────────────────────────────────────────────────────

describe('getTokenExpiration', () => {
  it('returns a Date for a token that has an exp claim', () => {
    const token = generateAccessToken(PAYLOAD);
    const expDate = getTokenExpiration(token);
    expect(expDate).toBeInstanceOf(Date);
    expect(expDate!.getTime()).toBeGreaterThan(Date.now());
  });

  it('returns null for a malformed token', () => {
    expect(getTokenExpiration('not-a-jwt')).toBeNull();
  });

  it('returns null for a token without an exp claim', () => {
    // Sign without expiresIn → no exp
    const noExp = jwt.sign({ userId: 'x' }, 'secret-no-exp-xyz-12345678');
    expect(getTokenExpiration(noExp)).toBeNull();
  });
});

// ── isTokenExpired ────────────────────────────────────────────────────────────

describe('isTokenExpired', () => {
  it('returns false for a freshly generated (future-expiry) token', () => {
    const token = generateAccessToken(PAYLOAD);
    expect(isTokenExpired(token)).toBe(false);
  });

  it('returns true for a token whose exp is in the past', () => {
    // jwt.sign with expiresIn: -1 produces exp = now - 1s
    const expired = jwt.sign(
      { userId: 'x', exp: Math.floor(Date.now() / 1000) - 10 },
      'arbitrary-secret-for-expiry-test'
    );
    expect(isTokenExpired(expired)).toBe(true);
  });

  it('returns true for a malformed token (no exp → treated as expired)', () => {
    expect(isTokenExpired('garbage.token.here')).toBe(true);
  });
});
