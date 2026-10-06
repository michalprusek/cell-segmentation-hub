import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock executeRedisCommand and logger before importing sessionService.
const { mockSetEx, mockGet, mockDel, mockExecuteRedisCommand } = vi.hoisted(
  () => {
    const mockSetEx = vi.fn() as any;
    const mockGet = vi.fn() as any;
    const mockDel = vi.fn() as any;
    const mockExecuteRedisCommand = vi.fn(
      async (fn: (client: any) => Promise<unknown>) => {
        return fn({ setEx: mockSetEx, get: mockGet, del: mockDel });
      }
    ) as any;
    return { mockSetEx, mockGet, mockDel, mockExecuteRedisCommand };
  }
);

vi.mock('../../config/redis', () => ({
  executeRedisCommand: mockExecuteRedisCommand,
  getRedisClient: vi.fn(() => null),
}));
vi.mock('../../utils/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() },
}));

import crypto from 'crypto';

import { sessionService } from '../sessionService';
import { ApiError } from '../../middleware/error';

const TEST_UUID = '8de596d0-853a-4a6a-9f65-ad499aeeec94';

describe('SessionService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSetEx.mockResolvedValue('OK');
    mockGet.mockResolvedValue(null);
    mockDel.mockResolvedValue(1);
    mockExecuteRedisCommand.mockImplementation(
      async (fn: (client: any) => Promise<unknown>) =>
        fn({ setEx: mockSetEx, get: mockGet, del: mockDel })
    );
  });

  describe('storeRefreshToken', () => {
    it('persists the UUID userId as-is (regression test for parseInt bug)', async () => {
      // The pre-fix code did parseInt(user.id, 10) which truncated this
      // UUID to the integer 8. The new code must round-trip the full
      // string into Redis verbatim — otherwise refresh-token lookup
      // hits prisma.user.findUnique({ id: "8" }) which returns null
      // and forces a 15-min auto-logout.
      let storedPayload: string | undefined;
      mockSetEx.mockImplementation(
        async (_k: string, _ttl: number, v: string) => {
          storedPayload = v;
          return 'OK';
        }
      );

      await sessionService.storeRefreshToken(TEST_UUID, 'rt_abc');

      expect(storedPayload).toBeDefined();
      const parsed = JSON.parse(storedPayload!);
      expect(parsed.userId).toBe(TEST_UUID);
      expect(typeof parsed.userId).toBe('string');
    });

    it('throws ApiError.serviceUnavailable when Redis write fails', async () => {
      // Pre-fix code returned false silently — user got a usable access
      // token that could never be refreshed. We must now propagate so
      // login surfaces 503 instead of issuing a doomed session.
      mockExecuteRedisCommand.mockResolvedValueOnce(undefined);

      await expect(
        sessionService.storeRefreshToken(TEST_UUID, 'rt_abc')
      ).rejects.toBeInstanceOf(ApiError);
    });
  });

  describe('storeRefreshToken — the options object', () => {
    const DAY = 60 * 60 * 24;
    const IMPERSONATION = {
      impersonatorId: 'admin-1',
      impersonationSessionId: 'imp-session-1',
    };
    const stored = (call = 0) => {
      const [key, ttl, value] = mockSetEx.mock.calls[call];
      return { key, ttl, record: JSON.parse(value as string) };
    };

    it('defaults to a rememberMe record on the 30-day TTL', async () => {
      await sessionService.storeRefreshToken(TEST_UUID, 'rt_abc');

      const { ttl, record } = stored();
      expect(ttl).toBe(30 * DAY);
      expect(record.rememberMe).toBe(true);
    });

    it('keeps a rememberMe=true session for 30 days', async () => {
      await sessionService.storeRefreshToken(TEST_UUID, 'rt_abc', {
        rememberMe: true,
      });

      const { ttl, record } = stored();
      expect(ttl).toBe(30 * DAY);
      expect(record.rememberMe).toBe(true);
    });

    it('keeps a rememberMe=false session for 7 days, and records it', async () => {
      await sessionService.storeRefreshToken(TEST_UUID, 'rt_abc', {
        rememberMe: false,
      });

      const { ttl, record } = stored();
      expect(ttl).toBe(7 * DAY);
      expect(record.rememberMe).toBe(false);
    });

    it('bounds an impersonated session at 24 hours whatever rememberMe says', async () => {
      await sessionService.storeRefreshToken(TEST_UUID, 'rt_abc', {
        impersonation: IMPERSONATION,
        rememberMe: true,
      });

      const { ttl, record } = stored();
      expect(ttl).toBe(DAY);
      expect(record).toMatchObject(IMPERSONATION);
    });

    it('stamps the record with the moment it was written, and expires it one TTL later', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      try {
        vi.setSystemTime(new Date('2026-10-06T12:00:00.789Z'));

        await sessionService.storeRefreshToken(TEST_UUID, 'rt_abc', {
          rememberMe: false,
        });

        const { record } = stored();
        expect(record.createdAt).toBe('2026-10-06T12:00:00.789Z');
        expect(record.expiresAt).toBe('2026-10-13T12:00:00.789Z');
      } finally {
        vi.useRealTimers();
      }
    });

    it('uses the family it is given, and invents one otherwise', async () => {
      await sessionService.storeRefreshToken(TEST_UUID, 'rt_a', {
        family: 'fam_given',
      });
      await sessionService.storeRefreshToken(TEST_UUID, 'rt_b');

      expect(stored(0).record.family).toBe('fam_given');
      expect(stored(1).record.family).toMatch(/^[0-9a-f]{32}$/);
    });
  });

  describe('verifyRefreshToken', () => {
    it('returns the original UUID userId after JSON round-trip', async () => {
      // Round-trip through JSON.stringify/parse must preserve the
      // string — earlier number type would have been silently coerced
      // by JSON.parse(JSON.stringify(NaN)) → null.
      const tokenData = {
        userId: TEST_UUID,
        token: 'rt_abc',
        expiresAt: new Date(Date.now() + 86400_000).toISOString(),
        family: 'fam_xyz',
      };
      mockGet.mockResolvedValueOnce(JSON.stringify(tokenData));

      const got = await sessionService.verifyRefreshToken('rt_abc');

      expect(got).not.toBeNull();
      expect(got!.userId).toBe(TEST_UUID);
    });

    it('returns null for expired token', async () => {
      const tokenData = {
        userId: TEST_UUID,
        token: 'rt_abc',
        expiresAt: new Date(Date.now() - 1000).toISOString(),
        family: 'fam_xyz',
      };
      mockGet.mockResolvedValueOnce(JSON.stringify(tokenData));

      const got = await sessionService.verifyRefreshToken('rt_abc');
      expect(got).toBeNull();
    });

    it('returns null for missing token', async () => {
      mockGet.mockResolvedValueOnce(null);
      const got = await sessionService.verifyRefreshToken('rt_nope');
      expect(got).toBeNull();
    });
  });

  describe('rotateRefreshToken', () => {
    it('returns new token + UUID userId carried through from the old token', async () => {
      const oldData = {
        userId: TEST_UUID,
        token: 'rt_old',
        expiresAt: new Date(Date.now() + 86400_000).toISOString(),
        family: 'fam_xyz',
      };
      mockGet.mockResolvedValueOnce(JSON.stringify(oldData));

      const result = await sessionService.rotateRefreshToken('rt_old');

      expect(result).not.toBeNull();
      expect(result!.userId).toBe(TEST_UUID);
      expect(typeof result!.token).toBe('string');
      expect(result!.token).not.toBe('rt_old');
    });

    it('returns null when the old token does not exist', async () => {
      mockGet.mockResolvedValueOnce(null);
      const result = await sessionService.rotateRefreshToken('rt_unknown');
      expect(result).toBeNull();
    });

    const liveRecord = (extra: Record<string, unknown> = {}) =>
      JSON.stringify({
        userId: TEST_UUID,
        expiresAt: new Date(Date.now() + 86400_000).toISOString(),
        family: 'fam_xyz',
        createdAt: '2026-01-01T00:00:00.000Z',
        ...extra,
      });
    const rotatedWrite = (writes = 1) => {
      // The only write of a successful rotation is the new record (plus,
      // for an impersonated session, its index entry).
      expect(mockSetEx).toHaveBeenCalledTimes(writes);
      const [, ttl, value] = mockSetEx.mock.calls[0];
      return { ttl, record: JSON.parse(value as string) };
    };

    it('carries rememberMe=false to the new record, on the 7-day TTL', async () => {
      // The refresh endpoint used to promote every session to 30 days at its
      // first rotation, 13 minutes after login.
      mockGet.mockResolvedValueOnce(liveRecord({ rememberMe: false }));

      const result = await sessionService.rotateRefreshToken('rt_old');

      expect(result!.rememberMe).toBe(false);
      const { ttl, record } = rotatedWrite();
      expect(ttl).toBe(60 * 60 * 24 * 7);
      expect(record.rememberMe).toBe(false);
      expect(record.family).toBe('fam_xyz');
    });

    it('carries rememberMe=true to the new record, on the 30-day TTL', async () => {
      mockGet.mockResolvedValueOnce(liveRecord({ rememberMe: true }));

      const result = await sessionService.rotateRefreshToken('rt_old');

      expect(result!.rememberMe).toBe(true);
      const { ttl, record } = rotatedWrite();
      expect(ttl).toBe(60 * 60 * 24 * 30);
      expect(record.rememberMe).toBe(true);
    });

    it('treats a record from before the field existed as a 30-day one', async () => {
      mockGet.mockResolvedValueOnce(liveRecord());

      const result = await sessionService.rotateRefreshToken('rt_old');

      expect(result!.rememberMe).toBe(true);
      expect(rotatedWrite().ttl).toBe(60 * 60 * 24 * 30);
    });

    it('carries the impersonation to the new record and the result', async () => {
      const impersonation = {
        impersonatorId: 'admin-1',
        impersonationSessionId: 'imp-session-1',
      };
      mockGet.mockResolvedValueOnce(liveRecord(impersonation));

      const result = await sessionService.rotateRefreshToken('rt_old');

      expect(result).toMatchObject(impersonation);
      const { ttl, record } = rotatedWrite(2);
      expect(ttl).toBe(60 * 60 * 24);
      expect(record).toMatchObject({ ...impersonation, family: 'fam_xyz' });
    });

    it('dates the new record now, not when the old one was written', async () => {
      mockGet.mockResolvedValueOnce(liveRecord());

      await sessionService.rotateRefreshToken('rt_old');

      expect(rotatedWrite().record.createdAt).not.toBe(
        '2026-01-01T00:00:00.000Z'
      );
    });
  });
  describe('the raw token never reaches Redis', () => {
    // Until 2026-08-31 the raw JWT was the Redis KEY and was stored a second
    // time inside the value. 235 were live when that was found, on a Redis
    // with no password. These tests pin both halves of the fix; they fail if
    // either the key or the value starts carrying the token again.
    const TOKEN = 'rt_super_secret_value_that_must_not_be_stored';
    const sha256 = (v: string) =>
      crypto.createHash('sha256').update(v).digest('hex');

    it('keys on the SHA-256 of the token, not the token', async () => {
      await sessionService.storeRefreshToken(TEST_UUID, TOKEN);

      const [key] = mockSetEx.mock.calls[0];
      expect(key).toBe(`refresh:${sha256(TOKEN)}`);
      expect(key).not.toContain(TOKEN);
    });

    it('does not write the token into the stored value', async () => {
      await sessionService.storeRefreshToken(TEST_UUID, TOKEN);

      const [, , value] = mockSetEx.mock.calls[0];
      expect(value).not.toContain(TOKEN);
      expect(JSON.parse(value as string)).not.toHaveProperty('token');
    });

    it('reads and deletes under the same hashed key', async () => {
      const expected = `refresh:${sha256(TOKEN)}`;

      mockGet.mockResolvedValueOnce(
        JSON.stringify({
          userId: TEST_UUID,
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          family: 'fam',
        })
      );
      await sessionService.verifyRefreshToken(TOKEN);
      expect(mockGet.mock.calls[0][0]).toBe(expected);

      await sessionService.deleteRefreshToken(TOKEN);
      expect(mockDel.mock.calls[0][0]).toBe(expected);
    });

    it('gives two different tokens two different keys', async () => {
      await sessionService.storeRefreshToken(TEST_UUID, 'rt_a');
      await sessionService.storeRefreshToken(TEST_UUID, 'rt_b');

      const [keyA] = mockSetEx.mock.calls[0];
      const [keyB] = mockSetEx.mock.calls[1];
      expect(keyA).not.toBe(keyB);
    });
  });
});
