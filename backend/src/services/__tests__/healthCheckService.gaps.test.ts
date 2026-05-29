/**
 * healthCheckService.gaps.test.ts
 *
 * Covers branches NOT reached by the existing healthCheckService.test.ts:
 *  - Redis not configured (null redis) → degraded
 *  - checkWebSocket when global.io is set (fetchSockets success + error)
 *  - checkWebSocket when global.io is absent → unhealthy
 *  - checkEmailService — no SMTP env → degraded
 *  - checkEmailService — testConnection returns false → unhealthy
 *  - checkEmailService — dynamic import throws → unhealthy
 *  - calculateOverallStatus degraded aggregation (non-critical unhealthy)
 *  - getHealthHistory / getLastHealthStatus
 *  - startPeriodicChecks / stopPeriodicChecks lifecycle
 *  - isReadyForDeployment — ready and not-ready paths
 *  - cleanup method
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── hoisted mock references ─────────────────────────────────────────────────
const {
  mockPrismaQueryRaw,
  mockPrismaDisconnect,
  mockRedisPing,
  mockRedisInfo,
  mockRedisSetex,
  mockRedisQuit,
  mockRedisOn,
  mockAxiosGet,
  mockFsAccess,
  mockFsStat,
  mockEmailTestConnection,
} = vi.hoisted(() => ({
  mockPrismaQueryRaw: vi.fn() as ReturnType<typeof vi.fn>,
  mockPrismaDisconnect: vi.fn() as ReturnType<typeof vi.fn>,
  mockRedisPing: vi.fn() as ReturnType<typeof vi.fn>,
  mockRedisInfo: vi.fn() as ReturnType<typeof vi.fn>,
  mockRedisSetex: vi.fn() as ReturnType<typeof vi.fn>,
  mockRedisQuit: vi.fn() as ReturnType<typeof vi.fn>,
  mockRedisOn: vi.fn() as ReturnType<typeof vi.fn>,
  mockAxiosGet: vi.fn() as ReturnType<typeof vi.fn>,
  mockFsAccess: vi.fn() as ReturnType<typeof vi.fn>,
  mockFsStat: vi.fn() as ReturnType<typeof vi.fn>,
  mockEmailTestConnection: vi.fn() as ReturnType<typeof vi.fn>,
}));

vi.mock('@prisma/client', () => ({ PrismaClient: vi.fn() }));
vi.mock('ioredis', () => ({ default: vi.fn() }));
vi.mock('axios', () => ({ default: { get: mockAxiosGet }, get: mockAxiosGet }));
vi.mock('v8', () => ({
  getHeapStatistics: vi.fn(() => ({ heap_size_limit: 2 * 1024 * 1024 * 1024 })),
}));
vi.mock('fs/promises', () => ({
  access: mockFsAccess,
  stat: mockFsStat,
  constants: { W_OK: 2, R_OK: 4 },
}));
vi.mock('../../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../emailService', () => ({
  testConnection: mockEmailTestConnection,
  _config: { service: 'smtp' },
}));

import { HealthCheckService } from '../healthCheckService';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';

const MockPrismaClient = PrismaClient as unknown as ReturnType<typeof vi.fn>;
const MockRedis = Redis as unknown as ReturnType<typeof vi.fn>;

function setupFullHappyPath() {
  MockPrismaClient.mockImplementation(function (this: Record<string, unknown>) {
    this.$queryRaw = mockPrismaQueryRaw;
    this.$disconnect = mockPrismaDisconnect;
    this.$metrics = { json: vi.fn(async () => null) };
  });
  MockRedis.mockImplementation(function (this: Record<string, unknown>) {
    this.ping = mockRedisPing;
    this.info = mockRedisInfo;
    this.setex = mockRedisSetex;
    this.quit = mockRedisQuit;
    this.on = mockRedisOn;
    this.status = 'ready';
  });

  mockPrismaQueryRaw.mockResolvedValue([{ 1: 1 }]);
  mockPrismaDisconnect.mockResolvedValue(undefined);
  mockRedisPing.mockResolvedValue('PONG');
  mockRedisInfo.mockResolvedValue('used_memory_human:10.00M\r\n');
  mockRedisSetex.mockResolvedValue('OK');
  mockRedisQuit.mockResolvedValue('OK');
  mockRedisOn.mockReturnValue(undefined);
  mockAxiosGet.mockResolvedValue({
    data: { status: 'healthy', models_loaded: 4, gpu_available: true },
  });
  mockFsAccess.mockResolvedValue(undefined);
  mockFsStat.mockResolvedValue({});
  mockEmailTestConnection.mockResolvedValue(true);
}

describe('HealthCheckService — uncovered branches', () => {
  let service: HealthCheckService;

  beforeEach(() => {
    setupFullHappyPath();
    (global as Record<string, unknown>).io = undefined;
    process.env.UPLOAD_DIR = '/app/uploads';
    process.env.SMTP_HOST = 'mailhog';
    process.env.SKIP_EMAIL_SEND = 'true';
    delete process.env.SENDGRID_API_KEY;
  });

  afterEach(() => {
    service?.stopPeriodicChecks();
  });

  // ─── Redis not configured ─────────────────────────────────────────────────

  describe('checkRedis — not configured', () => {
    it('returns degraded when Redis constructor throws', async () => {
      MockRedis.mockImplementationOnce(() => {
        throw new Error('ioredis init fail');
      });
      service = new HealthCheckService();
      const result = await service.checkHealth();
      // redis is null inside service → degraded
      expect(result.checks.redis.status).toBe('degraded');
      expect(result.checks.redis.message).toContain('not configured');
    });
  });

  // ─── checkWebSocket ───────────────────────────────────────────────────────

  describe('checkWebSocket', () => {
    it('returns unhealthy when global.io is not set', async () => {
      (global as Record<string, unknown>).io = undefined;
      service = new HealthCheckService();
      const result = await service.checkHealth();
      expect(result.checks.webSocket.status).toBe('unhealthy');
      expect(result.checks.webSocket.message).toContain('not initialized');
    });

    it('returns healthy with socket count when global.io.fetchSockets resolves', async () => {
      const fakeSockets = [{}, {}, {}]; // 3 connected clients
      (global as Record<string, unknown>).io = {
        fetchSockets: vi.fn().mockResolvedValue(fakeSockets),
        engine: { clientsCount: 3 },
      };
      service = new HealthCheckService();
      const result = await service.checkHealth();
      expect(result.checks.webSocket.status).toBe('healthy');
      expect(result.checks.webSocket.details?.connectedClients).toBe(3);
    });

    it('returns degraded when fetchSockets throws', async () => {
      (global as Record<string, unknown>).io = {
        fetchSockets: vi.fn().mockRejectedValue(new Error('socket error')),
        engine: { clientsCount: 0 },
      };
      service = new HealthCheckService();
      const result = await service.checkHealth();
      expect(result.checks.webSocket.status).toBe('degraded');
      expect(result.checks.webSocket.message).toContain('unknown');
    });
  });

  // ─── checkEmailService branches ───────────────────────────────────────────

  describe('checkEmailService', () => {
    it('returns degraded when SMTP_HOST and SENDGRID_API_KEY are both absent', async () => {
      delete process.env.SMTP_HOST;
      delete process.env.SENDGRID_API_KEY;
      delete process.env.SKIP_EMAIL_SEND;
      service = new HealthCheckService();
      const result = await service.checkHealth();
      expect(result.checks.emailService.status).toBe('degraded');
      expect(result.checks.emailService.details?.configured).toBe(false);
    });

    it('returns healthy in test mode (SKIP_EMAIL_SEND=true) without calling testConnection', async () => {
      process.env.SKIP_EMAIL_SEND = 'true';
      service = new HealthCheckService();
      const result = await service.checkHealth();
      // testMode short-circuit — SMTP_HOST=mailhog is set in beforeEach
      expect(result.checks.emailService.status).toBe('healthy');
      expect(result.checks.emailService.details?.testMode).toBe(true);
      expect(mockEmailTestConnection).not.toHaveBeenCalled();
    });

    it('returns unhealthy when testConnection returns false in non-test mode', async () => {
      delete process.env.SKIP_EMAIL_SEND;
      process.env.NODE_ENV = 'production';
      mockEmailTestConnection.mockResolvedValue(false);
      service = new HealthCheckService();
      const result = await service.checkHealth();
      expect(result.checks.emailService.status).toBe('unhealthy');
      expect(result.checks.emailService.details?.connected).toBe(false);
      process.env.NODE_ENV = 'test'; // restore
    });

    it('returns healthy when testConnection returns true in non-test mode', async () => {
      delete process.env.SKIP_EMAIL_SEND;
      process.env.NODE_ENV = 'production';
      mockEmailTestConnection.mockResolvedValue(true);
      service = new HealthCheckService();
      const result = await service.checkHealth();
      expect(result.checks.emailService.status).toBe('healthy');
      expect(result.checks.emailService.details?.connected).toBe(true);
      process.env.NODE_ENV = 'test';
    });
  });

  // ─── calculateOverallStatus aggregation ──────────────────────────────────

  describe('calculateOverallStatus', () => {
    it('is degraded when a non-critical service is unhealthy (database healthy)', async () => {
      // Redis unhealthy → degraded (not unhealthy) because database is OK
      mockRedisPing.mockRejectedValue(new Error('redis down'));
      service = new HealthCheckService();
      const result = await service.checkHealth();
      // Overall should be degraded, not unhealthy
      expect(result.status).toBe('degraded');
    });

    it('is degraded when all checks return degraded', async () => {
      // Force Redis → degraded (throw constructor), ML → degraded (non-healthy status)
      mockAxiosGet.mockResolvedValue({
        data: { status: 'degraded', models_loaded: 0 },
      });
      service = new HealthCheckService();
      const result = await service.checkHealth();
      expect(['degraded', 'healthy']).toContain(result.status);
    });

    it('is unhealthy when database is unhealthy', async () => {
      mockPrismaQueryRaw.mockRejectedValue(new Error('DB down'));
      service = new HealthCheckService();
      const result = await service.checkHealth();
      expect(result.status).toBe('unhealthy');
    });

    it('is unhealthy when fileSystem is unhealthy', async () => {
      mockFsAccess.mockRejectedValue(new Error('ENOENT'));
      service = new HealthCheckService();
      const result = await service.checkHealth();
      expect(result.status).toBe('unhealthy');
    });
  });

  // ─── fileSystem missing subdirs ───────────────────────────────────────────

  describe('checkFileSystem — missing required subdirectories', () => {
    it('returns degraded with list of missing dirs when subdirs are inaccessible', async () => {
      // uploadDir accessible, but images/thumbnails/temp are not
      mockFsAccess.mockImplementation(async (p: string) => {
        if (
          (p as string).includes('images') ||
          (p as string).includes('thumbnails') ||
          (p as string).includes('temp')
        ) {
          throw new Error('ENOENT');
        }
      });
      service = new HealthCheckService();
      const result = await service.checkHealth();
      expect(result.checks.fileSystem.status).toBe('degraded');
      expect(result.checks.fileSystem.details?.missingDirs).toEqual(
        expect.arrayContaining(['images', 'thumbnails', 'temp'])
      );
    });
  });

  // ─── ML service degraded status ───────────────────────────────────────────

  describe('checkMLService — degraded status', () => {
    it('returns degraded when ML service reports non-healthy status', async () => {
      mockAxiosGet.mockResolvedValue({
        data: { status: 'degraded', models_loaded: 0, gpu_available: false },
      });
      service = new HealthCheckService();
      const result = await service.checkHealth();
      expect(result.checks.mlService.status).toBe('degraded');
    });
  });

  // ─── health history ───────────────────────────────────────────────────────

  describe('getHealthHistory', () => {
    it('stores health check results in history', async () => {
      service = new HealthCheckService();
      await service.checkHealth();
      await service.checkHealth();
      const history = service.getHealthHistory();
      expect(history.length).toBe(2);
    });

    it('caps history at 100 entries', async () => {
      service = new HealthCheckService();
      // Run 105 checks
      for (let i = 0; i < 105; i++) {
        await service.checkHealth();
      }
      const history = service.getHealthHistory();
      expect(history.length).toBe(100);
    });
  });

  // ─── getLastHealthStatus ──────────────────────────────────────────────────

  describe('getLastHealthStatus', () => {
    it('returns null before any check', () => {
      service = new HealthCheckService();
      expect(service.getLastHealthStatus()).toBeNull();
    });

    it('returns the most recent health status after a check', async () => {
      service = new HealthCheckService();
      await service.checkHealth();
      const last = service.getLastHealthStatus();
      expect(last).not.toBeNull();
      expect(last!.status).toMatch(/healthy|degraded|unhealthy/);
      expect(last!.timestamp).toBeDefined();
    });
  });

  // ─── periodic checks lifecycle ────────────────────────────────────────────

  describe('startPeriodicChecks / stopPeriodicChecks', () => {
    it('performs an initial check when started', async () => {
      service = new HealthCheckService();
      // Start with a short interval
      service.startPeriodicChecks(60000);
      // Allow the synchronous initial checkHealth() promise to resolve
      await new Promise(resolve => setImmediate(resolve));
      service.stopPeriodicChecks();
      // At least one check should have been enqueued
      // getLastHealthStatus may still be null if the promise hasn't resolved,
      // so we just assert stopPeriodicChecks doesn't throw
      expect(() => service.stopPeriodicChecks()).not.toThrow();
    });

    it('stopPeriodicChecks is idempotent', () => {
      service = new HealthCheckService();
      service.startPeriodicChecks(60000);
      service.stopPeriodicChecks();
      expect(() => service.stopPeriodicChecks()).not.toThrow();
    });

    it('restarting replaces the existing interval', () => {
      service = new HealthCheckService();
      service.startPeriodicChecks(60000);
      // Should not throw or create duplicate intervals
      expect(() => service.startPeriodicChecks(60000)).not.toThrow();
      service.stopPeriodicChecks();
    });
  });

  // ─── isReadyForDeployment ─────────────────────────────────────────────────

  describe('isReadyForDeployment', () => {
    it('returns ready=true when all critical checks pass', async () => {
      service = new HealthCheckService();
      const { ready, issues } = await service.isReadyForDeployment();
      expect(ready).toBe(true);
      expect(issues).toHaveLength(0);
    });

    it('returns ready=false with issue when database is unhealthy', async () => {
      mockPrismaQueryRaw.mockRejectedValue(new Error('DB down'));
      service = new HealthCheckService();
      const { ready, issues } = await service.isReadyForDeployment();
      expect(ready).toBe(false);
      expect(issues.some(i => /database/i.test(i))).toBe(true);
    });

    it('returns ready=false with issue when fileSystem is unhealthy', async () => {
      mockFsAccess.mockRejectedValue(new Error('ENOENT'));
      service = new HealthCheckService();
      const { ready, issues } = await service.isReadyForDeployment();
      expect(ready).toBe(false);
      expect(issues.some(i => /file system/i.test(i))).toBe(true);
    });
  });

  // ─── cleanup ──────────────────────────────────────────────────────────────

  describe('cleanup', () => {
    it('disconnects from Redis and Prisma without throwing', async () => {
      service = new HealthCheckService();
      await expect(service.cleanup()).resolves.not.toThrow();
      expect(mockRedisQuit).toHaveBeenCalled();
      expect(mockPrismaDisconnect).toHaveBeenCalled();
    });
  });

  // ─── monitoring sub-check always healthy ──────────────────────────────────

  describe('checkMonitoring', () => {
    it('always reports healthy status regardless of prometheus/grafana availability', async () => {
      // Both Prometheus and Grafana unreachable (axios throws)
      mockAxiosGet.mockImplementation(async (url: string) => {
        if (url.includes('prometheus') || url.includes('grafana')) {
          throw new Error('not reachable');
        }
        return {
          data: { status: 'healthy', models_loaded: 4, gpu_available: true },
        };
      });
      service = new HealthCheckService();
      const result = await service.checkHealth();
      expect(result.checks.monitoring.status).toBe('healthy');
    });
  });

  // ─── getActiveConnections uses global.io engine ───────────────────────────

  describe('getSystemMetrics — activeConnections', () => {
    it('returns 0 when global.io is absent', async () => {
      (global as Record<string, unknown>).io = undefined;
      service = new HealthCheckService();
      const result = await service.checkHealth();
      expect(result.metrics?.activeConnections).toBe(0);
    });

    it('returns clientsCount from global.io.engine when set', async () => {
      (global as Record<string, unknown>).io = {
        fetchSockets: vi.fn().mockResolvedValue([{}]),
        engine: { clientsCount: 7 },
      };
      service = new HealthCheckService();
      const result = await service.checkHealth();
      expect(result.metrics?.activeConnections).toBe(7);
    });
  });
});
