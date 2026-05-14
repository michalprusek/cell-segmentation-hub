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
      mockSetEx.mockImplementation(async (_k: string, _ttl: number, v: string) => {
        storedPayload = v;
        return 'OK';
      });

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
  });
});
