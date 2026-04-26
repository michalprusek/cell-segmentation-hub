import request from 'supertest';
import express from 'express';
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from 'vitest';
import healthRoutes from '../healthRoutes';
import { logger } from '../../../utils/logger';

// Mock config and jwt early to prevent process.exit during module loading
vi.mock('../../../utils/config', () => ({
  config: {
    NODE_ENV: 'test',
    PORT: 3001,
    JWT_ACCESS_SECRET: 'test-access-secret-for-testing-only-32-characters-long',
    JWT_REFRESH_SECRET: 'test-refresh-secret-for-testing-only-32-characters-long',
    JWT_ACCESS_EXPIRY: '15m',
    JWT_REFRESH_EXPIRY: '7d',
    ALLOWED_ORIGINS: 'http://localhost:3000',
    REDIS_URL: 'redis://localhost:6379',
    FROM_EMAIL: 'test@example.com',
    EMAIL_SERVICE: 'none',
    REQUIRE_EMAIL_VERIFICATION: false,
  },
  isDevelopment: false,
  isProduction: false,
  isTest: true,
  getOrigins: () => ['http://localhost:3000'],
}));
vi.mock('../../../auth/jwt');

// Mock dependencies before any imports — use factory for healthCheckService to
// prevent PrismaClient instantiation at module load time
vi.mock('../../../utils/logger');
vi.mock('../../../db');
vi.mock('../../../services/healthCheckService', () => ({
  healthCheckService: {
    checkHealth: vi.fn(),
    isReadyForDeployment: vi.fn(),
    getHealthHistory: vi.fn(),
    startPeriodicChecks: vi.fn(),
    stopPeriodicChecks: vi.fn(),
  },
}));

import { healthCheckService } from '../../../services/healthCheckService';

const mockedLogger = logger as Mocked<typeof logger>;
const mockedHealthCheckService = healthCheckService as Mocked<
  typeof healthCheckService
>;

const mockHealthyStatus = {
  status: 'healthy' as const,
  timestamp: new Date().toISOString(),
  version: '1.0.0',
  environment: 'test',
  checks: {
    database: {
      status: 'healthy' as const,
      message: 'Database connected',
      responseTime: 5,
      lastCheck: new Date(),
    },
    redis: {
      status: 'healthy' as const,
      message: 'Redis connected',
      responseTime: 2,
      lastCheck: new Date(),
    },
  },
  metrics: {
    uptime: 12345,
    memoryUsage: process.memoryUsage(),
  },
};

const mockDegradedStatus = {
  ...mockHealthyStatus,
  status: 'degraded' as const,
  checks: {
    ...mockHealthyStatus.checks,
    redis: {
      status: 'degraded' as const,
      message: 'Redis connection slow',
      responseTime: 800,
      lastCheck: new Date(),
    },
  },
};

const mockUnhealthyStatus = {
  ...mockHealthyStatus,
  status: 'unhealthy' as const,
  checks: {
    database: {
      status: 'unhealthy' as const,
      message: 'Database connection failed',
      responseTime: 0,
      lastCheck: new Date(),
    },
  },
};

describe('Health Routes', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    vi.clearAllMocks();

    mockedLogger.info = vi.fn() as any;
    mockedLogger.error = vi.fn() as any;
    mockedLogger.warn = vi.fn() as any;

    app.use('/health', healthRoutes);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  describe('GET /health', () => {
    it('should return 200 and healthy status when all services are up', async () => {
      (mockedHealthCheckService.checkHealth as any) = jest
        .fn<any>()
        .mockResolvedValue(mockHealthyStatus);

      const response = await request(app).get('/health').expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.status).toBe('healthy');
      expect(response.body.message).toBe('Server is healthy');
    });

    it('should return 200 for degraded status (service still responding)', async () => {
      (mockedHealthCheckService.checkHealth as any) = jest
        .fn<any>()
        .mockResolvedValue(mockDegradedStatus);

      const response = await request(app).get('/health').expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.status).toBe('degraded');
      expect(response.body.message).toBe('Server is degraded');
    });

    it('should return 503 when the server is unhealthy', async () => {
      (mockedHealthCheckService.checkHealth as any) = jest
        .fn<any>()
        .mockResolvedValue(mockUnhealthyStatus);

      const response = await request(app).get('/health').expect(503);

      expect(response.body.success).toBe(false);
      expect(response.body.data.status).toBe('unhealthy');
    });

    it('should return 503 and error detail when healthCheckService throws', async () => {
      (mockedHealthCheckService.checkHealth as any) = jest
        .fn<any>()
        .mockRejectedValue(new Error('DB is down'));

      const response = await request(app).get('/health').expect(503);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Health check failed');
      expect(response.body.message).toBe('DB is down');
      expect(mockedLogger.error).toHaveBeenCalledWith(
        'Health check failed:',
        expect.any(Error)
      );
    });

    it('should not require authentication', async () => {
      (mockedHealthCheckService.checkHealth as any) = jest
        .fn<any>()
        .mockResolvedValue(mockHealthyStatus);

      const response = await request(app).get('/health').expect(200);

      expect(response.body.success).toBe(true);
    });

    it('should include component check details in the response', async () => {
      (mockedHealthCheckService.checkHealth as any) = jest
        .fn<any>()
        .mockResolvedValue(mockHealthyStatus);

      const response = await request(app).get('/health').expect(200);

      expect(response.body.data.checks).toBeDefined();
      expect(response.body.data.checks.database).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  describe('GET /health/live', () => {
    it('should always return 200 with alive status', async () => {
      const response = await request(app).get('/health/live').expect(200);

      expect(response.body.status).toBe('alive');
      expect(response.body.timestamp).toBeDefined();
    });

    it('should return ISO timestamp', async () => {
      const response = await request(app).get('/health/live').expect(200);

      expect(() => new Date(response.body.timestamp)).not.toThrow();
      expect(new Date(response.body.timestamp).toISOString()).toBe(
        response.body.timestamp
      );
    });

    it('should respond even when healthCheckService is unavailable', async () => {
      (mockedHealthCheckService.checkHealth as any) = jest
        .fn<any>()
        .mockRejectedValue(new Error('Service error'));

      const response = await request(app).get('/health/live').expect(200);

      expect(response.body.status).toBe('alive');
    });

    it('should not require authentication', async () => {
      const response = await request(app).get('/health/live').expect(200);

      expect(response.body.status).toBe('alive');
    });
  });

  // -------------------------------------------------------------------------
  describe('GET /health/ready', () => {
    it('should return 200 when service is ready for deployment', async () => {
      (mockedHealthCheckService.isReadyForDeployment as any) = jest
        .fn<any>()
        .mockResolvedValue({ ready: true, issues: [] });

      const response = await request(app).get('/health/ready').expect(200);

      expect(response.body.ready).toBe(true);
      expect(response.body.timestamp).toBeDefined();
    });

    it('should return 503 when service is not ready', async () => {
      (mockedHealthCheckService.isReadyForDeployment as any) = jest
        .fn<any>()
        .mockResolvedValue({
          ready: false,
          issues: ['Database migration pending', 'Redis not connected'],
        });

      const response = await request(app).get('/health/ready').expect(503);

      expect(response.body.ready).toBe(false);
      expect(response.body.issues).toContain('Database migration pending');
    });

    it('should return 503 when isReadyForDeployment throws', async () => {
      (mockedHealthCheckService.isReadyForDeployment as any) = jest
        .fn<any>()
        .mockRejectedValue(new Error('Readiness check failed'));

      const response = await request(app).get('/health/ready').expect(503);

      expect(response.body.ready).toBe(false);
      expect(response.body.error).toBe('Readiness check failed');
    });

    it('should include a timestamp in all responses', async () => {
      (mockedHealthCheckService.isReadyForDeployment as any) = jest
        .fn<any>()
        .mockResolvedValue({ ready: true, issues: [] });

      const response = await request(app).get('/health/ready').expect(200);

      expect(response.body.timestamp).toBeDefined();
    });

    it('should not require authentication', async () => {
      (mockedHealthCheckService.isReadyForDeployment as any) = jest
        .fn<any>()
        .mockResolvedValue({ ready: true, issues: [] });

      const response = await request(app).get('/health/ready').expect(200);

      expect(response.body.ready).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  describe('GET /health/detailed', () => {
    it('should return current health and history statistics', async () => {
      (mockedHealthCheckService.checkHealth as any) = jest
        .fn<any>()
        .mockResolvedValue(mockHealthyStatus);
      (mockedHealthCheckService.getHealthHistory as any) = jest
        .fn<any>()
        .mockReturnValue([
          mockHealthyStatus,
          mockDegradedStatus,
          mockHealthyStatus,
        ]);

      const response = await request(app).get('/health/detailed').expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.current).toBeDefined();
      expect(response.body.history).toBeDefined();
      expect(response.body.statistics.totalChecks).toBe(3);
      expect(response.body.statistics.healthyChecks).toBe(2);
      expect(response.body.statistics.degradedChecks).toBe(1);
    });

    it('should return 500 when detailed check fails', async () => {
      (mockedHealthCheckService.checkHealth as any) = jest
        .fn<any>()
        .mockRejectedValue(new Error('Check service unavailable'));

      const response = await request(app).get('/health/detailed').expect(500);

      expect(response.body.success).toBe(false);
      expect(mockedLogger.error).toHaveBeenCalledWith(
        'Detailed health check failed:',
        expect.any(Error)
      );
    });
  });

  // -------------------------------------------------------------------------
  describe('GET /health/components/:component', () => {
    it('should return health for a known component', async () => {
      (mockedHealthCheckService.checkHealth as any) = jest
        .fn<any>()
        .mockResolvedValue(mockHealthyStatus);

      const response = await request(app)
        .get('/health/components/database')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.component).toBe('database');
      expect(response.body.health).toBeDefined();
    });

    it('should return 404 for an unknown component', async () => {
      (mockedHealthCheckService.checkHealth as any) = jest
        .fn<any>()
        .mockResolvedValue(mockHealthyStatus);

      const response = await request(app)
        .get('/health/components/nonexistent')
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.availableComponents).toContain('database');
    });
  });

  // -------------------------------------------------------------------------
  describe('POST /health/check', () => {
    it('should trigger a manual health check and return result', async () => {
      (mockedHealthCheckService.checkHealth as any) = jest
        .fn<any>()
        .mockResolvedValue(mockHealthyStatus);

      const response = await request(app).post('/health/check').expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Health check completed');
      expect(response.body.data.status).toBe('healthy');
    });

    it('should return 500 when manual check fails', async () => {
      (mockedHealthCheckService.checkHealth as any) = jest
        .fn<any>()
        .mockRejectedValue(new Error('Manual check failed'));

      const response = await request(app).post('/health/check').expect(500);

      expect(response.body.success).toBe(false);
    });
  });
});
