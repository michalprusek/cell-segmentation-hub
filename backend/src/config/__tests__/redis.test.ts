/**
 * Behavioral unit tests for src/config/redis.ts
 *
 * The module uses module-level mutable state (redisClient, isRedisConnected).
 * Because Vitest forks each file in its own process we get isolation for free.
 * Within the file we reset state between tests by calling closeRedis() and
 * re-importing via the already-loaded module reference (no re-require needed).
 *
 * The 'redis' package is mocked so no network I/O occurs.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoist mock factories (vi.mock is hoisted before variable declarations)
// ---------------------------------------------------------------------------

const {
  mockOn,
  mockConnect,
  mockPing,
  mockInfo,
  mockQuit,
  mockDisconnect,
  mockCreateClient,
  createMockClient,
} = vi.hoisted(() => {
  const mockOn = vi.fn();
  const mockConnect = vi.fn().mockResolvedValue(undefined);
  const mockPing = vi.fn().mockResolvedValue('PONG');
  const mockInfo = vi.fn().mockResolvedValue('used_memory_human:1.23M\r\n');
  const mockQuit = vi.fn().mockResolvedValue(undefined);
  const mockDisconnect = vi.fn().mockResolvedValue(undefined);

  const createMockClient = () => ({
    on: mockOn,
    connect: mockConnect,
    ping: mockPing,
    info: mockInfo,
    quit: mockQuit,
    disconnect: mockDisconnect,
  });

  const mockCreateClient = vi.fn(() => createMockClient());

  return {
    mockOn,
    mockConnect,
    mockPing,
    mockInfo,
    mockQuit,
    mockDisconnect,
    mockCreateClient,
    createMockClient,
  };
});

vi.mock('redis', () => ({
  createClient: mockCreateClient,
}));

vi.mock('../../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import {
  initializeRedis,
  getRedisClient,
  redisHealthCheck,
  closeRedis,
  isRedisHealthy,
  executeRedisCommand,
} from '../redis';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Simulate firing the 'connect' and 'ready' events so isRedisConnected becomes true.
 * mockOn captures (event, handler) pairs; we replay them here.
 */
function fireEvent(event: string): void {
  for (const call of mockOn.mock.calls) {
    const [evName, handler] = call as [string, () => void];
    if (evName === event) {
      handler();
    }
  }
}

beforeEach(async () => {
  vi.clearAllMocks();

  // Reset the mock to return a fresh client shape each time
  mockCreateClient.mockImplementation(() => createMockClient());
  mockConnect.mockResolvedValue(undefined);
  mockPing.mockResolvedValue('PONG');
  mockInfo.mockResolvedValue('used_memory_human:1.23M\r\n');
  mockQuit.mockResolvedValue(undefined);
  mockDisconnect.mockResolvedValue(undefined);

  // Ensure module state is clean
  await closeRedis().catch(() => {});
  vi.clearAllMocks(); // clear after closeRedis noise
});

afterEach(async () => {
  await closeRedis().catch(() => {});
});

// ---------------------------------------------------------------------------
// initializeRedis
// ---------------------------------------------------------------------------

describe('initializeRedis', () => {
  it('calls createClient exactly once', async () => {
    await initializeRedis();
    expect(mockCreateClient).toHaveBeenCalledTimes(1);
  });

  it('calls connect() and ping() on the created client', async () => {
    await initializeRedis();
    expect(mockConnect).toHaveBeenCalledTimes(1);
    expect(mockPing).toHaveBeenCalledTimes(1);
  });

  it('registers event handlers: error, connect, ready, end, reconnecting', async () => {
    await initializeRedis();
    const registeredEvents = (mockOn.mock.calls as [string, unknown][]).map(
      ([ev]) => ev
    );
    expect(registeredEvents).toContain('error');
    expect(registeredEvents).toContain('connect');
    expect(registeredEvents).toContain('ready');
    expect(registeredEvents).toContain('end');
    expect(registeredEvents).toContain('reconnecting');
  });

  it('does not throw when connect() rejects (graceful degradation)', async () => {
    mockConnect.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await expect(initializeRedis()).resolves.toBeUndefined();
  });

  it('second call is a no-op and warns "already initialized"', async () => {
    const { logger } = await import('../../utils/logger');
    await initializeRedis();
    await initializeRedis(); // second call

    expect(mockCreateClient).toHaveBeenCalledTimes(1); // still just once
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('already initialized')
    );
  });

  it('sets isRedisHealthy() to false when connect fails', async () => {
    mockConnect.mockRejectedValueOnce(new Error('no server'));
    await initializeRedis();
    expect(isRedisHealthy()).toBe(false);
  });

  it('the connect event handler sets isRedisConnected to true', async () => {
    await initializeRedis();
    fireEvent('connect');
    // After 'connect' event fires, isRedisHealthy() should be true
    expect(isRedisHealthy()).toBe(true);
  });

  it('the error event handler sets isRedisConnected to false', async () => {
    await initializeRedis();
    fireEvent('connect'); // connected
    expect(isRedisHealthy()).toBe(true);

    fireEvent('error'); // drops connection
    expect(isRedisHealthy()).toBe(false);
  });

  it('the end event handler sets isRedisConnected to false', async () => {
    await initializeRedis();
    fireEvent('connect');
    fireEvent('end');
    expect(isRedisHealthy()).toBe(false);
  });

  it('the reconnecting event handler sets isRedisConnected to false', async () => {
    await initializeRedis();
    fireEvent('connect');
    fireEvent('reconnecting');
    expect(isRedisHealthy()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getRedisClient
// ---------------------------------------------------------------------------

describe('getRedisClient', () => {
  it('returns null and warns when not initialized', () => {
    // closeRedis was called in beforeEach, so client is null
    const client = getRedisClient();
    expect(client).toBeNull();
  });

  it('returns null when initialized but not connected', async () => {
    // initializeRedis fails silently → isRedisConnected stays false
    mockConnect.mockRejectedValueOnce(new Error('fail'));
    await initializeRedis();

    const client = getRedisClient();
    expect(client).toBeNull();
  });

  it('returns the client when connected', async () => {
    await initializeRedis();
    fireEvent('connect');

    const client = getRedisClient();
    expect(client).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// redisHealthCheck
// ---------------------------------------------------------------------------

describe('redisHealthCheck', () => {
  it('returns unhealthy when client not initialized', async () => {
    const hc = await redisHealthCheck();
    expect(hc.status).toBe('unhealthy');
    expect(hc.message).toBe('Redis client not initialized');
  });

  it('returns unhealthy when client exists but not connected', async () => {
    mockConnect.mockRejectedValueOnce(new Error('fail'));
    await initializeRedis();

    const hc = await redisHealthCheck();
    expect(hc.status).toBe('unhealthy');
    expect(hc.message).toBe('Redis client not connected');
  });

  it('returns healthy with ping and memory details when connected', async () => {
    await initializeRedis();
    fireEvent('connect');

    const hc = await redisHealthCheck();
    expect(hc.status).toBe('healthy');
    expect(hc.message).toBe('Redis is operational');
    expect(hc.details?.ping).toBe('PONG');
    expect(hc.details?.connected).toBe(true);
    expect(hc.details?.usedMemory).toBe('1.23M');
  });

  it('parses used_memory_human from info response', async () => {
    mockInfo.mockResolvedValue(
      'used_memory_human:512.00K\r\nother_field:value\r\n'
    );
    await initializeRedis();
    fireEvent('connect');

    const hc = await redisHealthCheck();
    expect(hc.details?.usedMemory).toBe('512.00K');
  });

  it('returns unhealthy when ping throws', async () => {
    await initializeRedis();
    fireEvent('connect');
    mockPing.mockRejectedValueOnce(new Error('ping failed'));

    const hc = await redisHealthCheck();
    expect(hc.status).toBe('unhealthy');
    expect(hc.details?.error).toBe('ping failed');
  });

  it('includes the REDIS_URL in healthy response details', async () => {
    process.env.REDIS_URL = 'redis://test-host:6379';
    await initializeRedis();
    fireEvent('connect');

    const hc = await redisHealthCheck();
    expect(hc.details?.url).toBe('redis://test-host:6379');
  });
});

// ---------------------------------------------------------------------------
// closeRedis
// ---------------------------------------------------------------------------

describe('closeRedis', () => {
  it('calls quit() on the client', async () => {
    await initializeRedis();
    fireEvent('connect');

    await closeRedis();
    expect(mockQuit).toHaveBeenCalledTimes(1);
  });

  it('sets client to null after closing (getRedisClient returns null)', async () => {
    await initializeRedis();
    fireEvent('connect');

    await closeRedis();
    expect(getRedisClient()).toBeNull();
    expect(isRedisHealthy()).toBe(false);
  });

  it('is a no-op when client is already null', async () => {
    // client is null from beforeEach
    await expect(closeRedis()).resolves.toBeUndefined();
    expect(mockQuit).not.toHaveBeenCalled();
  });

  it('falls back to disconnect() when quit() throws', async () => {
    mockQuit.mockRejectedValueOnce(new Error('quit failed'));
    await initializeRedis();
    fireEvent('connect');

    await closeRedis();
    expect(mockDisconnect).toHaveBeenCalledTimes(1);
    expect(isRedisHealthy()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isRedisHealthy
// ---------------------------------------------------------------------------

describe('isRedisHealthy', () => {
  it('returns false initially', () => {
    expect(isRedisHealthy()).toBe(false);
  });

  it('returns true after successful init + connect event', async () => {
    await initializeRedis();
    fireEvent('connect');
    expect(isRedisHealthy()).toBe(true);
  });

  it('returns false after closeRedis', async () => {
    await initializeRedis();
    fireEvent('connect');
    await closeRedis();
    expect(isRedisHealthy()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// executeRedisCommand
// ---------------------------------------------------------------------------

describe('executeRedisCommand', () => {
  it('returns fallback when client is unavailable', async () => {
    const result = await executeRedisCommand(
      () => Promise.resolve('value'),
      'fallback'
    );
    expect(result).toBe('fallback');
  });

  it('returns undefined (no fallback) when client is unavailable and no fallback given', async () => {
    const result = await executeRedisCommand(() => Promise.resolve('value'));
    expect(result).toBeUndefined();
  });

  it('executes the command against the client when connected', async () => {
    await initializeRedis();
    fireEvent('connect');

    const result = await executeRedisCommand(
      async () => 'command-result',
      'fallback'
    );
    expect(result).toBe('command-result');
  });

  it('returns fallback when the command throws', async () => {
    await initializeRedis();
    fireEvent('connect');

    const result = await executeRedisCommand(async () => {
      throw new Error('cmd failed');
    }, 'safe-fallback');
    expect(result).toBe('safe-fallback');
  });

  it('works with typed generic (numeric result)', async () => {
    await initializeRedis();
    fireEvent('connect');

    const result = await executeRedisCommand<number>(async () => 42, 0);
    expect(result).toBe(42);
  });
});
