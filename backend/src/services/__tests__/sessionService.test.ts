import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock executeRedisCommand and logger before importing sessionService.
const { mockSetEx, mockGet, mockDel, mockExecuteRedisCommand } =
  vi.hoisted(() => {
    const mockSetEx = vi.fn() as any;
    const mockGet = vi.fn() as any;
    const mockDel = vi.fn() as any;
    const mockExecuteRedisCommand = vi.fn(
      async (fn: (client: any) => Promise<unknown>) => {
        return fn({
          setEx: mockSetEx,
          get: mockGet,
          del: mockDel,
        });
      }
    ) as any;
    return { mockSetEx, mockGet, mockDel, mockExecuteRedisCommand };
  });

// The successor of a rotated token is an HMAC under this secret, so the
// tests can compute the token they expect.
const TEST_REFRESH_SECRET =
  'test-refresh-secret-for-testing-only-32-characters-long';
vi.mock('../../utils/config', () => ({
  config: {
    NODE_ENV: 'test',
    JWT_REFRESH_SECRET:
      'test-refresh-secret-for-testing-only-32-characters-long',
  },
}));

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
        fn({
          setEx: mockSetEx,
          get: mockGet,
          del: mockDel,
        })
    );
  });

  // Every write, by the kind of key it went to. A stored session is its
  // record (`refresh:<sha256>`) and nothing else; an impersonated one adds
  // `impersonation:<sessionId>`; a rotation first writes a
  // `refresh-used:<old key>` marker; a detected reuse writes
  // `refresh-revoked:<family>`.
  const writes = (prefix: string) =>
    (mockSetEx.mock.calls as Array<[string, number, string]>)
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, ttl, value]) => ({ key, ttl, value }));
  const sha256 = (v: string) =>
    crypto.createHash('sha256').update(v).digest('hex');
  const keyOf = (token: string) => `refresh:${sha256(token)}`;
  const successorOf = (token: string) =>
    crypto
      .createHmac('sha256', TEST_REFRESH_SECRET)
      .update(`rotate:${token}`)
      .digest('hex');

  describe('storeRefreshToken', () => {
    it('persists the UUID userId as-is (regression test for parseInt bug)', async () => {
      // The pre-fix code did parseInt(user.id, 10) which truncated this
      // UUID to the integer 8. The new code must round-trip the full
      // string into Redis verbatim — otherwise refresh-token lookup
      // hits prisma.user.findUnique({ id: "8" }) which returns null
      // and forces a 15-min auto-logout.
      await sessionService.storeRefreshToken(TEST_UUID, 'rt_abc');

      const [record] = writes('refresh:');
      expect(record).toBeDefined();
      const parsed = JSON.parse(record.value);
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
      const { key, ttl, value } = writes('refresh:')[call];
      return { key, ttl, record: JSON.parse(value) };
    };

    it('writes the record and nothing else', async () => {
      await sessionService.storeRefreshToken(TEST_UUID, 'rt_abc', {
        family: 'fam_given',
        rememberMe: false,
      });

      expect(mockSetEx).toHaveBeenCalledTimes(1);
      expect(stored().key).toBe(keyOf('rt_abc'));
    });

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

      const { key, ttl, record } = stored();
      expect(ttl).toBe(DAY);
      expect(record).toMatchObject(IMPERSONATION);
      // The record and the impersonation index, on the same bound.
      expect(mockSetEx).toHaveBeenCalledTimes(2);
      expect(writes('impersonation:')).toEqual([
        { key: 'impersonation:imp-session-1', ttl: DAY, value: key },
      ]);
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

    const live = (family: string) =>
      JSON.stringify({
        userId: TEST_UUID,
        expiresAt: new Date(Date.now() + 86400_000).toISOString(),
        family,
      });

    it('returns null and deletes the record when its family has been revoked', async () => {
      // A reuse was detected somewhere in this session's chain: every token
      // of the family is dead, whichever one is presented.
      mockGet
        .mockResolvedValueOnce(live('fam_xyz')) // the record
        .mockResolvedValueOnce('1759838400000'); // refresh-revoked:fam_xyz

      const got = await sessionService.verifyRefreshToken('rt_abc');

      expect(got).toBeNull();
      expect(mockGet).toHaveBeenNthCalledWith(2, 'refresh-revoked:fam_xyz');
      expect(mockDel).toHaveBeenCalledTimes(1);
      expect(mockDel).toHaveBeenCalledWith(keyOf('rt_abc'));
    });

    it('asks about the family of THIS record, and keeps a record whose family is not revoked', async () => {
      mockGet.mockResolvedValueOnce(live('fam_other')); // then null: no flag

      const got = await sessionService.verifyRefreshToken('rt_abc');

      expect(got).toMatchObject({ userId: TEST_UUID, family: 'fam_other' });
      expect(mockGet).toHaveBeenNthCalledWith(2, 'refresh-revoked:fam_other');
      expect(mockDel).not.toHaveBeenCalled();
    });
  });

  describe('rotateRefreshToken', () => {
    const liveRecord = (extra: Record<string, unknown> = {}) =>
      JSON.stringify({
        userId: TEST_UUID,
        expiresAt: new Date(Date.now() + 86400_000).toISOString(),
        family: 'fam_xyz',
        createdAt: '2026-01-01T00:00:00.000Z',
        ...extra,
      });
    const usedKeyOf = (token: string) => `refresh-used:${keyOf(token)}`;
    // What a successful rotation writes: the "used" marker for the old
    // token, then the successor's record (plus, for an impersonated session,
    // its index entry).
    const rotatedWrite = (impersonated = false) => {
      expect(mockSetEx).toHaveBeenCalledTimes(impersonated ? 3 : 2);
      const records = writes('refresh:');
      expect(records).toHaveLength(1);
      const [{ key, ttl, value }] = records;
      return { key, ttl, record: JSON.parse(value) };
    };
    const usedMarker = () => {
      const markers = writes('refresh-used:');
      expect(markers).toHaveLength(1);
      return markers[0];
    };

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

    it('derives the successor from the old token and the server secret', async () => {
      // Deterministic, so two concurrent rotations of one token agree on it.
      mockGet.mockResolvedValueOnce(liveRecord());

      const result = await sessionService.rotateRefreshToken('rt_old');

      expect(result!.token).toBe(successorOf('rt_old'));
      expect(result!.token).toMatch(/^[0-9a-f]{64}$/);
      // ...and that is the token the new record is keyed on.
      expect(rotatedWrite().key).toBe(keyOf(successorOf('rt_old')));
    });

    it('reports when the PRESENTED record was written', async () => {
      mockGet.mockResolvedValueOnce(liveRecord());

      const result = await sessionService.rotateRefreshToken('rt_old');

      expect(result!.presentedCreatedAt).toBe('2026-01-01T00:00:00.000Z');
    });

    it('marks the old token as used — who, when, which family; never the token', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      try {
        vi.setSystemTime(new Date('2026-10-07T12:00:00.750Z'));
        mockGet.mockResolvedValueOnce(liveRecord({ rememberMe: false }));

        await sessionService.rotateRefreshToken('rt_old');

        const { key, value } = usedMarker();
        expect(key).toBe(usedKeyOf('rt_old'));
        expect(JSON.parse(value)).toEqual({
          family: 'fam_xyz',
          userId: TEST_UUID,
          rotatedAt: Date.parse('2026-10-07T12:00:00.750Z'),
          rememberMe: false,
          createdAt: '2026-01-01T00:00:00.000Z',
        });
        expect(value).not.toContain('rt_old');
      } finally {
        vi.useRealTimers();
      }
    });

    it.each([
      ['a rememberMe session: 30 days', { rememberMe: true }, 2592000],
      ['a legacy record without the field: 30 days', {}, 2592000],
      ['a session without rememberMe: 7 days', { rememberMe: false }, 604800],
      [
        'an impersonated session: 24 hours',
        {
          rememberMe: true,
          impersonatorId: 'admin-1',
          impersonationSessionId: 'imp-session-1',
        },
        86400,
      ],
    ])(
      'remembers a used token for as long as its session lives — %s',
      async (_label, extra, seconds) => {
        // A fixed day would let a token of a 30-day session be replayed on
        // day two as merely "unknown" rather than as reuse.
        mockGet.mockResolvedValueOnce(liveRecord(extra));

        await sessionService.rotateRefreshToken('rt_old');

        expect(usedMarker().ttl).toBe(seconds);
        // The marker never outlives or undercuts the session it describes.
        expect(writes('refresh:')[0].ttl).toBe(seconds);
      }
    );

    it('marks first, stores the successor second, deletes the old record last', async () => {
      mockGet.mockResolvedValueOnce(liveRecord());

      await sessionService.rotateRefreshToken('rt_old');

      // The marker is there before the successor exists, so a second request
      // arriving in between waits for the successor instead of getting a 401.
      const prefixes = (mockSetEx.mock.calls as Array<[string]>).map(([k]) =>
        k.slice(0, k.indexOf(':') + 1)
      );
      expect(prefixes).toEqual(['refresh-used:', 'refresh:']);
      // The old record goes only once its successor is safely stored - and it
      // is the only thing deleted.
      expect(mockDel).toHaveBeenCalledTimes(1);
      expect(mockDel).toHaveBeenCalledWith(keyOf('rt_old'));
      expect(mockSetEx.mock.invocationCallOrder.at(-1)!).toBeLessThan(
        mockDel.mock.invocationCallOrder[0]
      );
    });

    it('returns null when the old token does not exist', async () => {
      mockGet.mockResolvedValueOnce(null);
      const result = await sessionService.rotateRefreshToken('rt_unknown');
      expect(result).toBeNull();
      // Unknown, and never rotated either: it is looked up among the used
      // tokens, and then nothing is marked, written or revoked.
      expect(mockGet).toHaveBeenLastCalledWith(usedKeyOf('rt_unknown'));
      expect(mockSetEx).not.toHaveBeenCalled();
      expect(mockDel).not.toHaveBeenCalled();
    });

    it('deletes an expired record and writes no successor', async () => {
      mockGet.mockResolvedValueOnce(
        liveRecord({ expiresAt: new Date(Date.now() - 1000).toISOString() })
      );

      const result = await sessionService.rotateRefreshToken('rt_old');

      expect(result).toBeNull();
      expect(mockDel).toHaveBeenCalledWith(keyOf('rt_old'));
      expect(mockSetEx).not.toHaveBeenCalled();
    });

    it('refuses a record whose family has been revoked: deletes it, stores nothing', async () => {
      mockGet
        .mockResolvedValueOnce(liveRecord()) // the old record
        .mockResolvedValueOnce('1759838400000'); // refresh-revoked:fam_xyz

      const result = await sessionService.rotateRefreshToken('rt_old');

      expect(result).toBeNull();
      expect(mockGet).toHaveBeenNthCalledWith(2, 'refresh-revoked:fam_xyz');
      expect(mockDel).toHaveBeenCalledTimes(1);
      expect(mockDel).toHaveBeenCalledWith(keyOf('rt_old'));
      // No marker, no successor.
      expect(mockSetEx).not.toHaveBeenCalled();
    });

    it('revokes the whole family when a used token comes back after the grace period', async () => {
      // A token used twice, more than 30 s apart, has two holders. Which of
      // them is the thief cannot be known, so the session ends for both.
      vi.useFakeTimers({ toFake: ['Date'] });
      try {
        const now = Date.parse('2026-10-07T12:00:00.000Z');
        vi.setSystemTime(new Date(now));
        mockGet
          .mockResolvedValueOnce(null) // the record is gone: already rotated
          .mockResolvedValueOnce(
            JSON.stringify({
              family: 'fam_xyz',
              userId: TEST_UUID,
              rotatedAt: now - 30_001,
              rememberMe: true,
            })
          );

        const result = await sessionService.rotateRefreshToken('rt_old');

        expect(result).toBeNull();
        expect(mockGet).toHaveBeenNthCalledWith(2, usedKeyOf('rt_old'));
        // A flag, for as long as any token of the family could still live -
        // not a hunt for the current token.
        expect(mockSetEx.mock.calls).toEqual([
          ['refresh-revoked:fam_xyz', 2592000, String(now)],
        ]);
        expect(mockDel).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

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
      const { ttl, record } = rotatedWrite(true);
      expect(ttl).toBe(60 * 60 * 24);
      expect(record).toMatchObject({ ...impersonation, family: 'fam_xyz' });
      // The marker carries it too, so a replay within the grace period is
      // still an impersonated session.
      expect(JSON.parse(usedMarker().value)).toMatchObject(impersonation);
    });

    it('dates the new record now, not when the old one was written', async () => {
      mockGet.mockResolvedValueOnce(liveRecord());

      await sessionService.rotateRefreshToken('rt_old');

      expect(rotatedWrite().record.createdAt).not.toBe(
        '2026-01-01T00:00:00.000Z'
      );
    });

    it('leaves the old record alone when the successor cannot be stored', async () => {
      // A Redis blip must not sign the user out. The old record is deleted
      // only after a successful store, so there is nothing to put back.
      mockGet.mockResolvedValueOnce(liveRecord({ rememberMe: false }));
      mockSetEx
        .mockResolvedValueOnce('OK') // the "used" marker
        .mockRejectedValueOnce(new Error('redis write failed')); // the successor

      const result = await sessionService.rotateRefreshToken('rt_old');

      expect(result).toBeNull();
      // Nothing is deleted - not the old record, and not the marker either.
      // Leaving the marker is intended: the old record still exists, so the
      // next attempt with this token takes the normal path (it never reaches
      // the replay branch) and simply overwrites the marker.
      expect(mockDel).not.toHaveBeenCalled();
      expect(usedMarker().key).toBe(usedKeyOf('rt_old'));
      // The marker and the one failed write.
      expect(mockSetEx).toHaveBeenCalledTimes(2);
    });
  });
  describe('the raw token never reaches Redis', () => {
    // Until 2026-08-31 the raw JWT was the Redis KEY and was stored a second
    // time inside the value. 235 were live when that was found, on a Redis
    // with no password. These tests pin both halves of the fix; they fail if
    // either the key or the value starts carrying the token again.
    const TOKEN = 'rt_super_secret_value_that_must_not_be_stored';
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

      const [{ key: keyA }, { key: keyB }] = writes('refresh:');
      expect(keyA).not.toBe(keyB);
    });
  });
});
