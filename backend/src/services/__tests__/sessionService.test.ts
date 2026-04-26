import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock Redis before imports — declared inside `vi.hoisted` so the
// top-level `vi.mock(...)` factories below (which Vitest hoists above
// all other statements) can reference them.
const {
  mockSetEx,
  mockGet,
  mockDel,
  mockSAdd,
  mockSRem,
  mockSMembers,
  mockExpire,
  mockExecuteRedisCommand,
  mockGetRedisClient,
} = vi.hoisted(() => {
  const mockSetEx = vi.fn() as any;
  const mockGet = vi.fn() as any;
  const mockDel = vi.fn() as any;
  const mockSAdd = vi.fn() as any;
  const mockSRem = vi.fn() as any;
  const mockSMembers = vi.fn() as any;
  const mockExpire = vi.fn() as any;

  const mockExecuteRedisCommand = vi.fn(
    async (fn: (client: any) => Promise<unknown>) => {
      return fn({
        setEx: mockSetEx,
        get: mockGet,
        del: mockDel,
        sAdd: mockSAdd,
        sRem: mockSRem,
        sMembers: mockSMembers,
        expire: mockExpire,
      });
    }
  ) as any;

  const mockGetRedisClient = vi.fn(() => null) as any;

  return {
    mockSetEx,
    mockGet,
    mockDel,
    mockSAdd,
    mockSRem,
    mockSMembers,
    mockExpire,
    mockExecuteRedisCommand,
    mockGetRedisClient,
  };
});

vi.mock('../../config/redis', () => ({
  executeRedisCommand: mockExecuteRedisCommand,
  getRedisClient: mockGetRedisClient,
}));
vi.mock('../../utils/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() },
}));
vi.mock('crypto', async () => {
  const actual = (await vi.importActual('crypto')) as typeof import('crypto');
  const mocked = {
    ...actual,
    // randomBytes must return a Buffer-like object where .toString('hex') returns a plain string
    randomBytes: vi.fn((size: number) => {
      const buf = Buffer.alloc(size, 0xaa);
      return buf;
    }),
  };
  return { ...mocked, default: mocked };
});

import { sessionService } from '../sessionService';
import crypto from 'crypto';

const mockRandomBytes = crypto.randomBytes as ReturnType<typeof vi.fn>;

describe('SessionService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // resetMocks:true clears all vi.fn() implementations — re-establish
    mockRandomBytes.mockImplementation((size: number) => Buffer.alloc(size, 0xaa));
    mockSetEx.mockResolvedValue('OK');
    mockGet.mockResolvedValue(null);
    mockDel.mockResolvedValue(1);
    mockSAdd.mockResolvedValue(1);
    mockSRem.mockResolvedValue(1);
    mockSMembers.mockResolvedValue([]);
    mockExpire.mockResolvedValue(true);
  });

  describe('createSession', () => {
    it('stores session in Redis with TTL and returns session id', async () => {
      mockSetEx.mockResolvedValue('OK');
      mockSAdd.mockResolvedValue(1);
      mockExpire.mockResolvedValue(true);
      // executeRedisCommand must resolve to truthy for sessionId to be returned
      mockExecuteRedisCommand.mockImplementationOnce(async (fn: any) => {
        await fn({
          setEx: mockSetEx,
          sAdd: mockSAdd,
          expire: mockExpire,
        });
        return true; // source checks `if (result)` to return sessionId
      });

      const sessionId = await sessionService.createSession(42, 'user@example.com');

      expect(typeof sessionId).toBe('string');
      expect(sessionId).not.toBeNull();
      expect(mockSetEx).toHaveBeenCalled();
      expect(mockSAdd).toHaveBeenCalled();
    });

    it('returns null on Redis failure', async () => {
      mockExecuteRedisCommand.mockRejectedValueOnce(new Error('Redis down') as any);

      const sessionId = await sessionService.createSession(1, 'user@example.com');

      expect(sessionId).toBeNull();
    });
  });

  describe('getSession', () => {
    it('retrieves and parses session data for existing session', async () => {
      const sessionData = {
        userId: 7,
        email: 'user@example.com',
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 86400 * 1000).toISOString(),
        metadata: { ip: '127.0.0.1' },
      };

      mockExecuteRedisCommand.mockImplementationOnce(async (fn: any) =>
        fn({ get: async () => JSON.stringify(sessionData) })
      );

      const result = await sessionService.getSession('session-abc');

      expect(result).not.toBeNull();
      expect(result!.userId).toBe(7);
      expect(result!.email).toBe('user@example.com');
    });

    it('returns null for non-existent session', async () => {
      mockExecuteRedisCommand.mockImplementationOnce(async (fn: any) =>
        fn({ get: async () => null })
      );

      const result = await sessionService.getSession('ghost-session');

      expect(result).toBeNull();
    });

    it('returns null and cleans up expired session', async () => {
      const expiredSession = {
        userId: 3,
        email: 'expired@example.com',
        createdAt: new Date(Date.now() - 2 * 86400 * 1000).toISOString(),
        expiresAt: new Date(Date.now() - 86400 * 1000).toISOString(), // past
      };

      // getSession → get (returns expired data)
      mockExecuteRedisCommand
        .mockImplementationOnce(async (fn: any) =>
          fn({ get: async () => JSON.stringify(expiredSession) })
        )
        // deleteSession calls getSession again → returns same expired data
        .mockImplementationOnce(async (fn: any) =>
          fn({ get: async () => JSON.stringify(expiredSession) })
        )
        // deleteSession → del + sRem
        .mockImplementationOnce(async (fn: any) =>
          fn({ del: mockDel, sRem: mockSRem })
        );

      const result = await sessionService.getSession('expired-session');

      expect(result).toBeNull();
    });
  });

  describe('destroySession (deleteSession)', () => {
    it('removes session from Redis', async () => {
      const sessionData = {
        userId: 5,
        email: 'user@example.com',
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 86400 * 1000).toISOString(),
      };

      // First call: getSession inside deleteSession
      mockExecuteRedisCommand
        .mockImplementationOnce(async (fn: any) =>
          fn({ get: async () => JSON.stringify(sessionData) })
        )
        // Second call: del + sRem
        .mockImplementationOnce(async (fn: any) =>
          fn({ del: mockDel, sRem: mockSRem })
        );

      const result = await sessionService.deleteSession('active-session');

      expect(result).toBe(true);
      expect(mockDel).toHaveBeenCalled();
      expect(mockSRem).toHaveBeenCalled();
    });
  });

  describe('getUserSessions', () => {
    it('returns all session IDs for a user', async () => {
      const sessionIds = ['session-1', 'session-2', 'session-3'];
      mockExecuteRedisCommand.mockImplementationOnce(async (fn: any) =>
        fn({ sMembers: async () => sessionIds })
      );

      const result = await sessionService.getUserSessions(10);

      expect(result).toEqual(sessionIds);
    });

    it('returns empty array when user has no sessions', async () => {
      mockExecuteRedisCommand.mockImplementationOnce(async (fn: any) =>
        fn({ sMembers: async () => [] })
      );

      const result = await sessionService.getUserSessions(99);

      expect(result).toEqual([]);
    });
  });

  describe('refreshSession (touchSession)', () => {
    it('extends TTL for existing session and returns true', async () => {
      mockExecuteRedisCommand.mockImplementationOnce(async (fn: any) =>
        fn({ expire: async () => true })
      );

      const result = await sessionService.touchSession('session-abc');

      expect(result).toBe(true);
    });

    it('returns false on Redis error', async () => {
      mockExecuteRedisCommand.mockRejectedValueOnce(new Error('expire error') as any);

      const result = await sessionService.touchSession('session-abc');

      expect(result).toBe(false);
    });
  });

  describe('createRefreshToken (storeRefreshToken)', () => {
    it('stores refresh token with TTL in Redis', async () => {
      mockSetEx.mockResolvedValue('OK');
      // Return true so source's `if (result)` branch is taken
      mockExecuteRedisCommand.mockImplementationOnce(async (fn: any) => {
        await fn({ setEx: mockSetEx });
        return true;
      });

      const result = await sessionService.storeRefreshToken(1, 'refresh-token-xyz');

      expect(result).toBe(true);
      expect(mockSetEx).toHaveBeenCalled();
    });

    it('returns false on storage failure', async () => {
      mockExecuteRedisCommand.mockRejectedValueOnce(new Error('storage error') as any);

      const result = await sessionService.storeRefreshToken(1, 'bad-token');

      expect(result).toBe(false);
    });
  });

  describe('validateRefreshToken (verifyRefreshToken)', () => {
    it('returns token data for valid non-expired token', async () => {
      const tokenData = {
        userId: 1,
        token: 'valid-refresh-token',
        expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
        family: 'family-abc',
      };

      mockExecuteRedisCommand.mockImplementationOnce(async (fn: any) =>
        fn({ get: async () => JSON.stringify(tokenData) })
      );

      const result = await sessionService.verifyRefreshToken('valid-refresh-token');

      expect(result).not.toBeNull();
      expect(result!.userId).toBe(1);
      expect(result!.token).toBe('valid-refresh-token');
    });

    it('returns null for non-existent token', async () => {
      mockExecuteRedisCommand.mockImplementationOnce(async (fn: any) =>
        fn({ get: async () => null })
      );

      const result = await sessionService.verifyRefreshToken('ghost-token');

      expect(result).toBeNull();
    });

    it('returns null and cleans up expired refresh token', async () => {
      const expiredToken = {
        userId: 2,
        token: 'expired-token',
        expiresAt: new Date(Date.now() - 1000).toISOString(), // past
        family: 'fam-xyz',
      };

      mockExecuteRedisCommand
        .mockImplementationOnce(async (fn: any) =>
          fn({ get: async () => JSON.stringify(expiredToken) })
        )
        // deleteRefreshToken
        .mockImplementationOnce(async (fn: any) =>
          fn({ del: async () => 1 })
        );

      const result = await sessionService.verifyRefreshToken('expired-token');

      expect(result).toBeNull();
    });
  });
});
