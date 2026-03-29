import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// Capture the factory function so we can control what executeRedisCommand does per test
let executeRedisCommandImpl: ((client: any) => Promise<unknown>) | null = null;

const mockExecuteRedisCommand = jest.fn(async (fn: (client: any) => Promise<unknown>) => {
  if (executeRedisCommandImpl) {
    return executeRedisCommandImpl(fn);
  }
  return fn({
    get: jest.fn(),
    setEx: jest.fn(),
    del: jest.fn(),
    exists: jest.fn(),
    incrBy: jest.fn(),
    expire: jest.fn(),
    ttl: jest.fn(),
    scan: jest.fn(),
    unlink: jest.fn(),
    dbSize: jest.fn(),
  });
}) as any;

const mockRedisClient = {
  ping: jest.fn() as any,
  info: jest.fn() as any,
};

jest.mock('../../config/redis', () => ({
  executeRedisCommand: mockExecuteRedisCommand,
  redisClient: mockRedisClient,
}));
jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), debug: jest.fn(), warn: jest.fn() },
}));

import { CacheService, cacheService as _cacheService } from '../cacheService';

describe('CacheService', () => {
  let service: CacheService;

  beforeEach(() => {
    jest.clearAllMocks();
    executeRedisCommandImpl = null;
    service = new CacheService();
  });

  describe('get', () => {
    it('returns parsed cached value on hit', async () => {
      const cachedEntry = JSON.stringify({
        data: { userId: '123', name: 'Alice' },
        timestamp: Date.now(),
        ttl: 3600,
      });

      mockExecuteRedisCommand.mockImplementationOnce(async (fn: any) =>
        fn({ get: async () => cachedEntry })
      );

      const result = await service.get<{ userId: string; name: string }>('user:123');

      expect(result).toEqual({ userId: '123', name: 'Alice' });
    });

    it('returns null on cache miss', async () => {
      mockExecuteRedisCommand.mockImplementationOnce(async (fn: any) =>
        fn({ get: async () => null })
      );

      const result = await service.get('nonexistent-key');

      expect(result).toBeNull();
    });

    it('returns null and deletes expired entry', async () => {
      const expiredEntry = JSON.stringify({
        data: { value: 'stale' },
        timestamp: Date.now() - 7200 * 1000, // 2 hours ago
        ttl: 3600, // 1 hour TTL → already expired
      });

      mockExecuteRedisCommand
        .mockImplementationOnce(async (fn: any) =>
          fn({ get: async () => expiredEntry })
        )
        .mockImplementationOnce(async (fn: any) =>
          fn({ del: async () => 1 })
        );

      const result = await service.get('stale-key');

      expect(result).toBeNull();
    });

    it('returns null and does not throw when Redis is unavailable', async () => {
      mockExecuteRedisCommand.mockRejectedValueOnce(new Error('Redis ECONNREFUSED') as any);

      const result = await service.get('any-key');

      expect(result).toBeNull();
    });
  });

  describe('set', () => {
    it('stores serialized entry with TTL and returns true', async () => {
      mockExecuteRedisCommand.mockImplementationOnce(async (fn: any) =>
        fn({ setEx: async () => 'OK' })
      );

      const result = await service.set('user:profile:1', { name: 'Bob' }, { ttl: 600 });

      expect(result).toBe(true);
    });

    it('uses default TTL when none specified', async () => {
      const capturedArgs: any[] = [];
      mockExecuteRedisCommand.mockImplementationOnce(async (fn: any) =>
        fn({
          setEx: async (key: string, ttl: number, val: string) => {
            capturedArgs.push({ key, ttl, val });
            return 'OK';
          },
        })
      );

      await service.set('my-key', 'my-value');

      expect(capturedArgs[0].ttl).toBe(CacheService.TTL_PRESETS.MEDIUM);
    });

    it('returns false when Redis set fails', async () => {
      mockExecuteRedisCommand.mockRejectedValueOnce(new Error('write failed') as any);

      const result = await service.set('fail-key', 'value');

      expect(result).toBe(false);
    });
  });

  describe('delete', () => {
    it('removes key and returns true', async () => {
      mockExecuteRedisCommand.mockImplementationOnce(async (fn: any) =>
        fn({ del: async () => 1 })
      );

      const result = await service.delete('user:session:abc');

      expect(result).toBe(true);
    });

    it('returns false when key did not exist', async () => {
      mockExecuteRedisCommand.mockImplementationOnce(async (fn: any) =>
        fn({ del: async () => 0 })
      );

      const result = await service.delete('nonexistent');

      expect(result).toBe(false);
    });
  });

  describe('getOrSet', () => {
    it('returns cached value on hit without calling factory', async () => {
      const cachedEntry = JSON.stringify({
        data: 'cached-result',
        timestamp: Date.now(),
        ttl: 600,
      });
      mockExecuteRedisCommand.mockImplementationOnce(async (fn: any) =>
        fn({ get: async () => cachedEntry })
      );
      const factory = jest.fn(async () => 'factory-result');

      const result = await service.getOrSet('existing-key', factory);

      expect(result).toBe('cached-result');
      expect(factory).not.toHaveBeenCalled();
    });

    it('calls factory and caches result on miss', async () => {
      // First call: cache miss
      mockExecuteRedisCommand
        .mockImplementationOnce(async (fn: any) =>
          fn({ get: async () => null })
        )
        // Second call: set value
        .mockImplementationOnce(async (fn: any) =>
          fn({ setEx: async () => 'OK' })
        );

      const factory = jest.fn(async () => 'computed-value');

      const result = await service.getOrSet('new-key', factory, { ttl: 300 });

      expect(result).toBe('computed-value');
      expect(factory).toHaveBeenCalledTimes(1);
    });
  });

  describe('invalidatePattern', () => {
    it('deletes matching keys and returns count', async () => {
      mockExecuteRedisCommand.mockImplementationOnce(async (fn: any) =>
        fn({
          scan: async () => ({ cursor: 0, keys: ['cache:user:1', 'cache:user:2'] }),
          unlink: async () => 2,
        })
      );

      const deletedCount = await service.invalidatePattern('user:*');

      expect(deletedCount).toBe(2);
    });

    it('returns 0 when no keys match pattern', async () => {
      mockExecuteRedisCommand.mockImplementationOnce(async (fn: any) =>
        fn({
          scan: async () => ({ cursor: 0, keys: [] }),
          unlink: async () => 0,
        })
      );

      const deletedCount = await service.invalidatePattern('nonexistent:*');

      expect(deletedCount).toBe(0);
    });

    it('handles Redis error gracefully and returns 0', async () => {
      mockExecuteRedisCommand.mockRejectedValueOnce(new Error('scan error') as any);

      const deletedCount = await service.invalidatePattern('any:*');

      expect(deletedCount).toBe(0);
    });
  });

  describe('getStats', () => {
    it('returns hits, misses, and hitRate after operations', async () => {
      // Simulate a hit
      const cachedEntry = JSON.stringify({ data: 'x', timestamp: Date.now(), ttl: 600 });
      mockExecuteRedisCommand
        .mockImplementationOnce(async (fn: any) =>
          fn({ get: async () => cachedEntry })
        )
        // Simulate a miss
        .mockImplementationOnce(async (fn: any) =>
          fn({ get: async () => null })
        );

      await service.get('hit-key');
      await service.get('miss-key');

      const stats = service.getStats();

      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
      expect(stats.hitRate).toBe(50);
    });

    it('returns zero stats for a fresh service instance', () => {
      const freshService = new CacheService();
      const stats = freshService.getStats();

      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      expect(stats.hitRate).toBe(0);
    });
  });
});
