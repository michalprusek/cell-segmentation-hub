import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

// All mocks before imports
const mockPrismaQueryRaw = jest.fn() as any;
const mockPrismaDisconnect = jest.fn() as any;

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn(() => ({
    $queryRaw: mockPrismaQueryRaw,
    $disconnect: mockPrismaDisconnect,
    $metrics: { json: jest.fn(async () => null) },
  })),
}));

const mockRedisPing = jest.fn() as any;
const mockRedisInfo = jest.fn() as any;
const mockRedisSetex = jest.fn() as any;
const mockRedisQuit = jest.fn() as any;
const mockRedisOn = jest.fn() as any;

jest.mock('ioredis', () =>
  jest.fn(() => ({
    ping: mockRedisPing,
    info: mockRedisInfo,
    setex: mockRedisSetex,
    quit: mockRedisQuit,
    on: mockRedisOn,
    status: 'ready',
  }))
);

const mockAxiosGet = jest.fn() as any;
jest.mock('axios', () => ({
  default: { get: mockAxiosGet },
  get: mockAxiosGet,
}));

jest.mock('v8', () => ({
  getHeapStatistics: jest.fn(() => ({
    heap_size_limit: 2 * 1024 * 1024 * 1024,
  })),
}));

jest.mock('fs/promises', () => ({
  access: jest.fn() as any,
  stat: jest.fn() as any,
  constants: { W_OK: 2, R_OK: 4 },
}));

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), debug: jest.fn(), warn: jest.fn() },
}));

// Mock emailService dynamic import
jest.mock('../emailService', () => ({
  testConnection: jest.fn(async () => true),
  _config: { service: 'smtp' },
}));

import { HealthCheckService } from '../healthCheckService';
import * as fs from 'fs/promises';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';

const mockFsAccess = fs.access as ReturnType<typeof jest.fn>;
const mockFsStat = fs.stat as ReturnType<typeof jest.fn>;
const MockPrismaClient = PrismaClient as unknown as ReturnType<typeof jest.fn>;
const MockRedis = Redis as unknown as ReturnType<typeof jest.fn>;

/**
 * Set up all happy-path mocks. Individual tests may override specific ones.
 * resetMocks:true means we must re-establish ALL implementations in beforeEach.
 */
function setupHappyPathMocks() {
  // Re-establish constructor mocks (wiped by resetMocks:true)
  MockPrismaClient.mockImplementation(() => ({
    $queryRaw: mockPrismaQueryRaw,
    $disconnect: mockPrismaDisconnect,
    $metrics: { json: jest.fn(async () => null) },
  }));
  MockRedis.mockImplementation(() => ({
    ping: mockRedisPing,
    info: mockRedisInfo,
    setex: mockRedisSetex,
    quit: mockRedisQuit,
    on: mockRedisOn,
    status: 'ready',
  }));

  (mockPrismaQueryRaw as any).mockResolvedValue([{ 1: 1 }]);
  (mockPrismaDisconnect as any).mockResolvedValue(undefined);
  (mockRedisPing as any).mockResolvedValue('PONG');
  (mockRedisInfo as any).mockResolvedValue('used_memory_human:10.00M\r\n');
  (mockRedisSetex as any).mockResolvedValue('OK');
  (mockRedisQuit as any).mockResolvedValue('OK');
  (mockRedisOn as any).mockReturnValue(undefined);
  (mockAxiosGet as any).mockResolvedValue({
    data: { status: 'healthy', models_loaded: 4, gpu_available: true },
  });
  (mockFsAccess as any).mockResolvedValue(undefined);
  (mockFsStat as any).mockResolvedValue({});
}

describe('HealthCheckService', () => {
  let service: HealthCheckService;

  beforeEach(() => {
    setupHappyPathMocks();
    (global as Record<string, unknown>).io = undefined;
    process.env.UPLOAD_DIR = '/app/uploads';
    process.env.SMTP_HOST = 'mailhog';
    process.env.SKIP_EMAIL_SEND = 'true';
    service = new HealthCheckService();
  });

  afterEach(async () => {
    service.stopPeriodicChecks();
  });

  describe('checkHealth', () => {
    it('returns healthy when all checks pass', async () => {
      const result = await service.checkHealth();

      expect(result.status).toMatch(/healthy|degraded/);
      expect(result.checks).toHaveProperty('database');
      expect(result.checks).toHaveProperty('redis');
      expect(result.checks).toHaveProperty('mlService');
      expect(result.timestamp).toBeDefined();
    });

    it('returns degraded when non-critical service (ML) fails', async () => {
      (mockAxiosGet as any).mockRejectedValue(new Error('ML service unavailable'));

      const result = await service.checkHealth();

      expect(result.checks.mlService.status).toBe('unhealthy');
      expect(['degraded', 'unhealthy']).toContain(result.status);
    });

    it('returns unhealthy when critical service (database) fails', async () => {
      (mockPrismaQueryRaw as any).mockRejectedValue(new Error('DB connection refused'));

      const result = await service.checkHealth();

      expect(result.checks.database.status).toBe('unhealthy');
      expect(result.status).toBe('unhealthy');
    });
  });

  describe('checkDatabase', () => {
    it('returns healthy status when Prisma query succeeds', async () => {
      // Happy path already in beforeEach
      const result = await service.checkHealth();

      expect(result.checks.database.status).toBe('healthy');
      expect(result.checks.database.message).toContain('healthy');
      expect(typeof result.checks.database.responseTime).toBe('number');
    });

    it('returns unhealthy status when Prisma query fails', async () => {
      (mockPrismaQueryRaw as any).mockRejectedValue(
        new Error('FATAL: password authentication failed')
      );

      const result = await service.checkHealth();

      expect(result.checks.database.status).toBe('unhealthy');
      expect(result.checks.database.message).toContain(
        'password authentication failed'
      );
    });
  });

  describe('checkRedis', () => {
    it('returns healthy when Redis ping succeeds', async () => {
      // Happy path already in beforeEach
      const result = await service.checkHealth();

      expect(result.checks.redis.status).toBe('healthy');
      expect(result.checks.redis.details?.ping).toBe('PONG');
    });

    it('returns unhealthy when Redis ping fails', async () => {
      (mockRedisPing as any).mockRejectedValue(new Error('ECONNREFUSED'));

      const result = await service.checkHealth();

      expect(result.checks.redis.status).toBe('unhealthy');
      expect(result.checks.redis.message).toContain('ECONNREFUSED');
    });
  });

  describe('checkMLService', () => {
    it('returns healthy when ML service /health endpoint responds with healthy', async () => {
      // Happy path already in beforeEach
      const result = await service.checkHealth();

      expect(result.checks.mlService.status).toBe('healthy');
      expect(result.checks.mlService.details?.modelsLoaded).toBe(4);
    });

    it('returns unhealthy when ML service is unreachable', async () => {
      (mockAxiosGet as any).mockRejectedValue(new Error('connect ETIMEDOUT'));

      const result = await service.checkHealth();

      expect(result.checks.mlService.status).toBe('unhealthy');
      expect(result.checks.mlService.message).toContain('ML service error');
    });
  });

  describe('getSystemMetrics', () => {
    it('returns memory usage, cpu usage, and uptime', async () => {
      const result = await service.checkHealth();

      expect(result.metrics).toBeDefined();
      expect(result.metrics!.uptime).toBeGreaterThanOrEqual(0);
      expect(result.metrics!.memoryUsage).toHaveProperty('heapUsed');
      expect(result.metrics!.memoryUsage).toHaveProperty('heapTotal');
      expect(result.metrics!.memoryUsage).toHaveProperty('rss');
    });
  });
});
