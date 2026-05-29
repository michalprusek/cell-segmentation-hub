/**
 * src/redis/__tests__/client.test.ts
 *
 * Behavioral tests for src/redis/client.ts — the thin Redis wrapper class.
 *
 * Covered behaviors:
 *  - When REDIS_URL is absent, the constructor skips client creation
 *    and all operations are no-ops (get→null, set/del/disconnect resolve).
 *  - When REDIS_URL is present the wrapper:
 *    · calls createClient and registers an 'error' event handler
 *    · connect() resolves and marks the client connected
 *    · get() delegates to the underlying client
 *    · set() without TTL calls client.set()
 *    · set() with TTL calls client.setEx()
 *    · del() calls client.del()
 *    · disconnect() calls client.disconnect()
 *  - Error paths:
 *    · connect() failure is caught and logged (constructor does not throw)
 *    · get() client throw → returns null
 *    · set() client throw → swallowed (no propagation)
 *    · del() client throw → swallowed
 *
 * The `redis` package is fully mocked — no network I/O.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoist mock factories — must happen before any source import
// ---------------------------------------------------------------------------

const {
  mockConnect,
  mockGet,
  mockSet,
  mockSetEx,
  mockDel,
  mockDisconnect,
  mockOn,
  mockCreateClient,
} = vi.hoisted(() => {
  const mockConnect = vi.fn().mockResolvedValue(undefined);
  const mockGet = vi.fn().mockResolvedValue(null);
  const mockSet = vi.fn().mockResolvedValue('OK');
  const mockSetEx = vi.fn().mockResolvedValue('OK');
  const mockDel = vi.fn().mockResolvedValue(1);
  const mockDisconnect = vi.fn().mockResolvedValue(undefined);
  // on() is called synchronously in the constructor; capture the handler
  const mockOn = vi.fn();

  const mockCreateClient = vi.fn(() => ({
    connect: mockConnect,
    get: mockGet,
    set: mockSet,
    setEx: mockSetEx,
    del: mockDel,
    disconnect: mockDisconnect,
    on: mockOn,
  }));

  return {
    mockConnect,
    mockGet,
    mockSet,
    mockSetEx,
    mockDel,
    mockDisconnect,
    mockOn,
    mockCreateClient,
  };
});

vi.mock('redis', () => ({ createClient: mockCreateClient }));

vi.mock('../../utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../utils/config', () => ({
  config: { NODE_ENV: 'test' },
  isDevelopment: false,
  isProduction: false,
  isTest: true,
}));

// The global test setup (src/test/setup.ts) mocks '../redis/client' (relative
// to that file) which resolves to this exact module. Unmock it so we can test
// the real implementation.
vi.unmock('../client');

// ---------------------------------------------------------------------------
// Import after mocks — the module is loaded once per test file (forks pool)
// ---------------------------------------------------------------------------
import { RedisClient } from '../client';

// ---------------------------------------------------------------------------
// Helper: build a RedisClient with a specific REDIS_URL env state
// ---------------------------------------------------------------------------
function makeClient(redisUrl: string | undefined): RedisClient {
  const prev = process.env.REDIS_URL;
  if (redisUrl !== undefined) {
    process.env.REDIS_URL = redisUrl;
  } else {
    delete process.env.REDIS_URL;
  }
  const rc = new RedisClient();
  // restore
  if (prev !== undefined) {
    process.env.REDIS_URL = prev;
  } else {
    delete process.env.REDIS_URL;
  }
  return rc;
}

// ---------------------------------------------------------------------------
// Reset mocks between tests
// ---------------------------------------------------------------------------
beforeEach(() => {
  mockConnect.mockReset().mockResolvedValue(undefined);
  mockGet.mockReset().mockResolvedValue(null);
  mockSet.mockReset().mockResolvedValue('OK');
  mockSetEx.mockReset().mockResolvedValue('OK');
  mockDel.mockReset().mockResolvedValue(1);
  mockDisconnect.mockReset().mockResolvedValue(undefined);
  mockOn.mockReset();
  mockCreateClient.mockClear();
});

// ---------------------------------------------------------------------------
// No REDIS_URL — all no-ops
// ---------------------------------------------------------------------------

describe('RedisClient — no REDIS_URL', () => {
  it('does not call createClient', () => {
    makeClient(undefined);
    expect(mockCreateClient).not.toHaveBeenCalled();
  });

  it('get() returns null without touching the underlying client', async () => {
    const rc = makeClient(undefined);
    const result = await rc.get('any-key');
    expect(result).toBeNull();
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('set() without TTL is a no-op and does not throw', async () => {
    const rc = makeClient(undefined);
    await expect(rc.set('k', 'v')).resolves.toBeUndefined();
    expect(mockSet).not.toHaveBeenCalled();
  });

  it('set() with TTL is a no-op and does not throw', async () => {
    const rc = makeClient(undefined);
    await expect(rc.set('k', 'v', 60)).resolves.toBeUndefined();
    expect(mockSetEx).not.toHaveBeenCalled();
  });

  it('del() is a no-op and does not throw', async () => {
    const rc = makeClient(undefined);
    await expect(rc.del('k')).resolves.toBeUndefined();
    expect(mockDel).not.toHaveBeenCalled();
  });

  it('disconnect() is a no-op and does not throw', async () => {
    const rc = makeClient(undefined);
    await expect(rc.disconnect()).resolves.toBeUndefined();
    expect(mockDisconnect).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// REDIS_URL present — happy paths
// ---------------------------------------------------------------------------

describe('RedisClient — with REDIS_URL, happy paths', () => {
  it('calls createClient and registers an error listener', () => {
    makeClient('redis://localhost:6379');
    expect(mockCreateClient).toHaveBeenCalledTimes(1);
    expect(mockOn).toHaveBeenCalledWith('error', expect.any(Function));
  });

  it('get() returns the value from the underlying client after connect', async () => {
    mockGet.mockResolvedValueOnce('cached-value');
    const rc = makeClient('redis://localhost:6379');
    // Let the async connect() micro-task resolve
    await new Promise(r => setTimeout(r, 0));
    const result = await rc.get('test-key');
    expect(result).toBe('cached-value');
    expect(mockGet).toHaveBeenCalledWith('test-key');
  });

  it('set() without TTL calls client.set(key, value)', async () => {
    const rc = makeClient('redis://localhost:6379');
    await new Promise(r => setTimeout(r, 0));
    await rc.set('my-key', 'my-value');
    expect(mockSet).toHaveBeenCalledWith('my-key', 'my-value');
    expect(mockSetEx).not.toHaveBeenCalled();
  });

  it('set() with TTL calls client.setEx(key, ttl, value)', async () => {
    const rc = makeClient('redis://localhost:6379');
    await new Promise(r => setTimeout(r, 0));
    await rc.set('ttl-key', 'ttl-val', 120);
    expect(mockSetEx).toHaveBeenCalledWith('ttl-key', 120, 'ttl-val');
    expect(mockSet).not.toHaveBeenCalled();
  });

  it('del() calls client.del(key)', async () => {
    const rc = makeClient('redis://localhost:6379');
    await new Promise(r => setTimeout(r, 0));
    await rc.del('del-key');
    expect(mockDel).toHaveBeenCalledWith('del-key');
  });

  it('disconnect() calls client.disconnect()', async () => {
    const rc = makeClient('redis://localhost:6379');
    await new Promise(r => setTimeout(r, 0));
    await rc.disconnect();
    expect(mockDisconnect).toHaveBeenCalledTimes(1);
  });

  it('get() returns null when the underlying client returns null', async () => {
    mockGet.mockResolvedValueOnce(null);
    const rc = makeClient('redis://localhost:6379');
    await new Promise(r => setTimeout(r, 0));
    const result = await rc.get('missing');
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Error paths
// ---------------------------------------------------------------------------

describe('RedisClient — error handling', () => {
  it('connect() failure is caught — client is constructed without throwing', async () => {
    mockConnect.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    // Constructor spawns async connect() — must not propagate
    const rc = makeClient('redis://localhost:6379');
    await new Promise(r => setTimeout(r, 0));
    // The instance is still created (connected=false internally)
    expect(rc).toBeDefined();
  });

  it('get() throws internally → returns null, does not propagate', async () => {
    mockGet.mockRejectedValueOnce(new Error('Redis read error'));
    const rc = makeClient('redis://localhost:6379');
    await new Promise(r => setTimeout(r, 0));
    const result = await rc.get('k');
    expect(result).toBeNull();
  });

  it('set() throws internally → swallowed, does not propagate', async () => {
    mockSet.mockRejectedValueOnce(new Error('Redis write fail'));
    const rc = makeClient('redis://localhost:6379');
    await new Promise(r => setTimeout(r, 0));
    await expect(rc.set('k', 'v')).resolves.toBeUndefined();
  });

  it('set() with TTL throws internally → swallowed', async () => {
    mockSetEx.mockRejectedValueOnce(new Error('Redis setEx fail'));
    const rc = makeClient('redis://localhost:6379');
    await new Promise(r => setTimeout(r, 0));
    await expect(rc.set('k', 'v', 60)).resolves.toBeUndefined();
  });

  it('del() throws internally → swallowed, does not propagate', async () => {
    mockDel.mockRejectedValueOnce(new Error('Redis del fail'));
    const rc = makeClient('redis://localhost:6379');
    await new Promise(r => setTimeout(r, 0));
    await expect(rc.del('k')).resolves.toBeUndefined();
  });

  it('the error event handler calls logger.error with the error', async () => {
    const { logger } = await import('../../utils/logger');
    const rc = makeClient('redis://localhost:6379');
    await new Promise(r => setTimeout(r, 0));

    // Find the registered error handler and invoke it directly
    const onCall = mockOn.mock.calls.find((c: unknown[]) => c[0] === 'error');
    expect(onCall).toBeDefined();
    const handler = onCall![1] as (err: Error) => void;
    const fakeErr = new Error('Redis Client Error test');
    handler(fakeErr);

    expect(vi.mocked(logger.error)).toHaveBeenCalled();
    void rc; // satisfy no-unused-vars
  });
});
