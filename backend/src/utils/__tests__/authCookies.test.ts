import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Response } from 'express';

// Mutable config mock so we can flip NODE_ENV to assert the Secure flag.
const mockConfig = {
  NODE_ENV: 'test',
  JWT_ACCESS_EXPIRY: '15m',
  JWT_REFRESH_EXPIRY: '7d',
  JWT_REFRESH_EXPIRY_REMEMBER: '30d',
};

vi.mock('../config', () => ({
  __esModule: true,
  get config() {
    return mockConfig;
  },
}));

import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  durationToMs,
  setAuthCookies,
  clearAuthCookies,
  getAccessTokenFromCookieHeader,
} from '../authCookies';

const makeRes = () =>
  ({
    cookie: vi.fn(),
    clearCookie: vi.fn(),
  }) as unknown as Response & {
    cookie: ReturnType<typeof vi.fn>;
    clearCookie: ReturnType<typeof vi.fn>;
  };

describe('authCookies', () => {
  beforeEach(() => {
    mockConfig.NODE_ENV = 'test';
    vi.clearAllMocks();
  });

  describe('durationToMs', () => {
    it.each<[string, number]>([
      ['15m', 15 * 60 * 1000],
      ['7d', 7 * 24 * 60 * 60 * 1000],
      ['30d', 30 * 24 * 60 * 60 * 1000],
      ['12h', 12 * 60 * 60 * 1000],
      ['3600s', 3600 * 1000],
      ['900', 900 * 1000], // bare number → seconds
      ['  45m  ', 45 * 60 * 1000], // surrounding whitespace tolerated
    ])('converts %s to %d ms', (input, expected) => {
      expect(durationToMs(input)).toBe(expected);
    });

    it('throws on an unsupported format', () => {
      expect(() => durationToMs('15 weeks')).toThrow(/Unsupported duration/);
      expect(() => durationToMs('abc')).toThrow(/Unsupported duration/);
    });
  });

  describe('setAuthCookies', () => {
    it('sets the access cookie at Path=/ with the access-token Max-Age', () => {
      const res = makeRes();
      setAuthCookies(res, 'access-jwt', 'refresh-tok');

      const accessCall = res.cookie.mock.calls.find(
        c => c[0] === ACCESS_TOKEN_COOKIE
      );
      expect(accessCall).toBeDefined();
      expect(accessCall![1]).toBe('access-jwt');
      expect(accessCall![2]).toMatchObject({
        httpOnly: true,
        sameSite: 'strict',
        path: '/',
        maxAge: 15 * 60 * 1000,
      });
    });

    it('scopes the refresh cookie to /api/auth with the 7d Max-Age by default', () => {
      const res = makeRes();
      setAuthCookies(res, 'access-jwt', 'refresh-tok');

      const refreshCall = res.cookie.mock.calls.find(
        c => c[0] === REFRESH_TOKEN_COOKIE
      );
      expect(refreshCall![1]).toBe('refresh-tok');
      expect(refreshCall![2]).toMatchObject({
        httpOnly: true,
        sameSite: 'strict',
        path: '/api/auth',
        maxAge: 7 * 24 * 60 * 60 * 1000,
      });
    });

    it('uses the 30d Max-Age for the refresh cookie when rememberMe is true', () => {
      const res = makeRes();
      setAuthCookies(res, 'access-jwt', 'refresh-tok', { rememberMe: true });

      const refreshCall = res.cookie.mock.calls.find(
        c => c[0] === REFRESH_TOKEN_COOKIE
      );
      expect(refreshCall![2].maxAge).toBe(30 * 24 * 60 * 60 * 1000);
    });

    it('omits Secure outside production', () => {
      const res = makeRes();
      setAuthCookies(res, 'a', 'r');
      for (const call of res.cookie.mock.calls) {
        expect(call[2].secure).toBe(false);
      }
    });

    it('sets Secure in production', () => {
      mockConfig.NODE_ENV = 'production';
      const res = makeRes();
      setAuthCookies(res, 'a', 'r');
      for (const call of res.cookie.mock.calls) {
        expect(call[2].secure).toBe(true);
      }
    });
  });

  describe('clearAuthCookies', () => {
    it('clears both cookies with matching paths', () => {
      const res = makeRes();
      clearAuthCookies(res);

      const accessClear = res.clearCookie.mock.calls.find(
        c => c[0] === ACCESS_TOKEN_COOKIE
      );
      const refreshClear = res.clearCookie.mock.calls.find(
        c => c[0] === REFRESH_TOKEN_COOKIE
      );
      expect(accessClear![1]).toMatchObject({ path: '/' });
      expect(refreshClear![1]).toMatchObject({ path: '/api/auth' });
    });
  });

  describe('getAccessTokenFromCookieHeader', () => {
    it('extracts the access token from a multi-cookie header', () => {
      const header = `other=1; ${ACCESS_TOKEN_COOKIE}=the-jwt; ${REFRESH_TOKEN_COOKIE}=rt`;
      expect(getAccessTokenFromCookieHeader(header)).toBe('the-jwt');
    });

    it('url-decodes the cookie value', () => {
      const header = `${ACCESS_TOKEN_COOKIE}=a%20b`;
      expect(getAccessTokenFromCookieHeader(header)).toBe('a b');
    });

    it('returns null when the header is undefined or the cookie is absent', () => {
      expect(getAccessTokenFromCookieHeader(undefined)).toBeNull();
      expect(getAccessTokenFromCookieHeader('foo=bar; baz=qux')).toBeNull();
    });

    it('returns null when the access cookie is present but empty', () => {
      expect(
        getAccessTokenFromCookieHeader(`${ACCESS_TOKEN_COOKIE}=`)
      ).toBeNull();
    });
  });
});
