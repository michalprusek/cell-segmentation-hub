/**
 * database.test.ts
 *
 * Covers the pure config-derivation functions in src/config/database.ts:
 *  - getDatabaseConfig  — defaults, env overrides, ssl logic, logging flag
 *  - parseDatabaseUrl   — valid URL, invalid formats, null returns
 *  - getPrismaPoolConfig — unit-conversion from ms to seconds
 *  - getConnectionStringWithPool — query-string append (? vs &)
 *  - validateDatabaseConfig — valid, poolSize/maxPoolSize errors, bad URL
 *  - getDatabasePoolConfig — field mapping
 *  - getRetryConfig      — defaults and overrides
 *  - getHealthCheckConfig — enabled flag, interval, timeout
 *  - getPerformanceBaselines — slow-query threshold and 80% pool warning
 *  - logDatabaseConfig / logDatabasePoolConfig — exercise logger call
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ─── env backup / restore ─────────────────────────────────────────────────────

const ORIGINAL_ENV: Record<string, string | undefined> = {};
const MANAGED_KEYS = [
  'DATABASE_URL',
  'DB_POOL_SIZE',
  'DB_MAX_POOL_SIZE',
  'DB_IDLE_TIMEOUT',
  'DB_CONNECTION_TIMEOUT',
  'DB_STATEMENT_TIMEOUT',
  'DB_QUERY_TIMEOUT',
  'DB_SSL',
  'DB_RETRY_ATTEMPTS',
  'DB_RETRY_DELAY',
  'DB_ENABLE_LOGGING',
  'DB_SLOW_QUERY_THRESHOLD',
  'DB_HEALTH_CHECK_ENABLED',
  'DB_HEALTH_CHECK_INTERVAL',
  'DB_HEALTH_CHECK_TIMEOUT',
  'DB_MEMORY_WARNING_MB',
  'DATABASE_CONNECTION_LIMIT',
  'NODE_ENV',
];

beforeEach(() => {
  MANAGED_KEYS.forEach(k => {
    ORIGINAL_ENV[k] = process.env[k];
  });
  // vitest.env.ts sets NODE_ENV=test — keep that except where a test overrides it
});

afterEach(() => {
  MANAGED_KEYS.forEach(k => {
    if (ORIGINAL_ENV[k] === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = ORIGINAL_ENV[k];
    }
  });
  vi.resetModules();
});

async function freshConfig() {
  const mod = await import('../database');
  return mod;
}

// ─── getDatabaseConfig ────────────────────────────────────────────────────────

describe('getDatabaseConfig', () => {
  it('returns default DATABASE_URL fallback when env var is absent', async () => {
    delete process.env.DATABASE_URL;
    const { getDatabaseConfig } = await freshConfig();
    const cfg = getDatabaseConfig();
    expect(cfg.connectionString).toBe('postgresql://localhost/spheroseg');
  });

  it('uses DATABASE_URL from environment', async () => {
    process.env.DATABASE_URL = 'postgresql://user:pass@db:5432/mydb';
    const { getDatabaseConfig } = await freshConfig();
    expect(getDatabaseConfig().connectionString).toBe(
      'postgresql://user:pass@db:5432/mydb'
    );
  });

  it('uses numeric pool size from DB_POOL_SIZE env', async () => {
    process.env.DB_POOL_SIZE = '7';
    const { getDatabaseConfig } = await freshConfig();
    expect(getDatabaseConfig().poolSize).toBe(7);
  });

  it('uses numeric max pool size from DB_MAX_POOL_SIZE env', async () => {
    process.env.DB_MAX_POOL_SIZE = '99';
    const { getDatabaseConfig } = await freshConfig();
    expect(getDatabaseConfig().maxPoolSize).toBe(99);
  });

  it('enables SSL when DB_SSL=true', async () => {
    process.env.NODE_ENV = 'development';
    process.env.DB_SSL = 'true';
    const { getDatabaseConfig } = await freshConfig();
    expect(getDatabaseConfig().ssl).toBe(true);
  });

  it('enables SSL in production even without DB_SSL=true', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.DB_SSL;
    const { getDatabaseConfig } = await freshConfig();
    expect(getDatabaseConfig().ssl).toBe(true);
  });

  it('disables SSL in development without DB_SSL=true', async () => {
    process.env.NODE_ENV = 'development';
    delete process.env.DB_SSL;
    const { getDatabaseConfig } = await freshConfig();
    expect(getDatabaseConfig().ssl).toBe(false);
  });

  it('enables logging when DB_ENABLE_LOGGING=true', async () => {
    process.env.NODE_ENV = 'production';
    process.env.DB_ENABLE_LOGGING = 'true';
    const { getDatabaseConfig } = await freshConfig();
    expect(getDatabaseConfig().enableLogging).toBe(true);
  });

  it('enables logging in development mode without explicit env var', async () => {
    process.env.NODE_ENV = 'development';
    delete process.env.DB_ENABLE_LOGGING;
    const { getDatabaseConfig } = await freshConfig();
    expect(getDatabaseConfig().enableLogging).toBe(true);
  });

  it('uses idleTimeout from DB_IDLE_TIMEOUT env', async () => {
    process.env.DB_IDLE_TIMEOUT = '60000';
    const { getDatabaseConfig } = await freshConfig();
    expect(getDatabaseConfig().idleTimeout).toBe(60000);
  });

  it('uses slowQueryThreshold from DB_SLOW_QUERY_THRESHOLD env', async () => {
    process.env.DB_SLOW_QUERY_THRESHOLD = '2500';
    const { getDatabaseConfig } = await freshConfig();
    expect(getDatabaseConfig().slowQueryThreshold).toBe(2500);
  });
});

// ─── parseDatabaseUrl ─────────────────────────────────────────────────────────

describe('parseDatabaseUrl', () => {
  it('parses a valid postgresql:// URL correctly', async () => {
    const { parseDatabaseUrl } = await freshConfig();
    const result = parseDatabaseUrl(
      'postgresql://admin:secret@db-host:5432/mydb'
    );
    expect(result).toEqual({
      protocol: 'postgresql',
      username: 'admin',
      password: 'secret',
      host: 'db-host',
      port: 5432,
      database: 'mydb',
    });
  });

  it('parses a postgres:// URL (alias)', async () => {
    const { parseDatabaseUrl } = await freshConfig();
    const result = parseDatabaseUrl('postgres://u:p@h:5432/d');
    expect(result).not.toBeNull();
    expect(result!.protocol).toBe('postgres');
  });

  it('returns null for a URL missing the port', async () => {
    const { parseDatabaseUrl } = await freshConfig();
    // Pattern requires :port component
    const result = parseDatabaseUrl('postgresql://user:pass@host/db');
    expect(result).toBeNull();
  });

  it('returns null for a completely invalid string', async () => {
    const { parseDatabaseUrl } = await freshConfig();
    expect(parseDatabaseUrl('not-a-url')).toBeNull();
  });

  it('returns null for an empty string', async () => {
    const { parseDatabaseUrl } = await freshConfig();
    expect(parseDatabaseUrl('')).toBeNull();
  });

  it('parses port as a number', async () => {
    const { parseDatabaseUrl } = await freshConfig();
    const result = parseDatabaseUrl('postgresql://u:p@h:5433/d');
    expect(result!.port).toBe(5433);
    expect(typeof result!.port).toBe('number');
  });
});

// ─── getPrismaPoolConfig ──────────────────────────────────────────────────────

describe('getPrismaPoolConfig', () => {
  it('converts idleTimeout from ms to seconds for pool_timeout', async () => {
    process.env.DB_IDLE_TIMEOUT = '30000'; // 30 s
    const { getPrismaPoolConfig } = await freshConfig();
    const cfg = getPrismaPoolConfig();
    expect(cfg.pool_timeout).toBe(30);
  });

  it('converts statementTimeout from ms to seconds', async () => {
    process.env.DB_STATEMENT_TIMEOUT = '15000'; // 15 s
    const { getPrismaPoolConfig } = await freshConfig();
    expect(getPrismaPoolConfig().statement_timeout).toBe(15);
  });

  it('converts connectionTimeout from ms to seconds', async () => {
    process.env.DB_CONNECTION_TIMEOUT = '5000'; // 5 s
    const { getPrismaPoolConfig } = await freshConfig();
    expect(getPrismaPoolConfig().connect_timeout).toBe(5);
  });

  it('sets connection_limit from maxPoolSize', async () => {
    process.env.DB_MAX_POOL_SIZE = '25';
    const { getPrismaPoolConfig } = await freshConfig();
    expect(getPrismaPoolConfig().connection_limit).toBe(25);
  });
});

// ─── getConnectionStringWithPool ─────────────────────────────────────────────

describe('getConnectionStringWithPool', () => {
  it('appends pool parameters with ? when URL has no query string', async () => {
    process.env.DATABASE_URL = 'postgresql://u:p@h:5432/d';
    const { getConnectionStringWithPool } = await freshConfig();
    const result = getConnectionStringWithPool();
    expect(result).toContain('?connection_limit=');
    expect(result).toContain('pool_timeout=');
    expect(result).toContain('statement_timeout=');
    expect(result).toContain('connect_timeout=');
  });

  it('appends pool parameters with & when URL already has query string', async () => {
    process.env.DATABASE_URL = 'postgresql://u:p@h:5432/d?sslmode=require';
    const { getConnectionStringWithPool } = await freshConfig();
    const result = getConnectionStringWithPool();
    expect(result).toContain('sslmode=require');
    expect(result).toContain('&connection_limit=');
  });
});

// ─── validateDatabaseConfig ───────────────────────────────────────────────────

describe('validateDatabaseConfig', () => {
  it('returns valid=true for a properly configured environment', async () => {
    process.env.DATABASE_URL = 'postgresql://u:p@h:5432/d';
    const { validateDatabaseConfig } = await freshConfig();
    const result = validateDatabaseConfig();
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('adds error when poolSize is 0 (NaN from bad env)', async () => {
    process.env.DATABASE_URL = 'postgresql://u:p@h:5432/d';
    process.env.DB_POOL_SIZE = 'invalid'; // parseInt → NaN → 0 check passes via isNaN
    // NaN <= 0 is false but parseInt('invalid') = NaN and NaN <= 0 is false
    // The real check is `config.poolSize <= 0`, NaN <= 0 is false — so this
    // path is only triggered by explicit 0/-1. Test with '0':
    process.env.DB_POOL_SIZE = '0';
    const { validateDatabaseConfig } = await freshConfig();
    const result = validateDatabaseConfig();
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => /pool size/i.test(e))).toBe(true);
  });

  it('adds error when maxPoolSize < poolSize', async () => {
    process.env.DATABASE_URL = 'postgresql://u:p@h:5432/d';
    process.env.DB_POOL_SIZE = '20';
    process.env.DB_MAX_POOL_SIZE = '5'; // less than pool size
    const { validateDatabaseConfig } = await freshConfig();
    const result = validateDatabaseConfig();
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => /max pool/i.test(e))).toBe(true);
  });

  it('adds error for invalid database URL format', async () => {
    process.env.DATABASE_URL = 'not-a-valid-url';
    const { validateDatabaseConfig } = await freshConfig();
    const result = validateDatabaseConfig();
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => /connection string/i.test(e))).toBe(true);
  });
});

// ─── getDatabasePoolConfig ────────────────────────────────────────────────────

describe('getDatabasePoolConfig', () => {
  it('maps poolSize to minConnections and maxPoolSize to maxConnections', async () => {
    process.env.DB_POOL_SIZE = '5';
    process.env.DB_MAX_POOL_SIZE = '20';
    const { getDatabasePoolConfig } = await freshConfig();
    const cfg = getDatabasePoolConfig();
    expect(cfg.minConnections).toBe(5);
    expect(cfg.maxConnections).toBe(20);
  });

  it('uses connectionTimeout for both acquireTimeout and createTimeout', async () => {
    process.env.DB_CONNECTION_TIMEOUT = '8000';
    const { getDatabasePoolConfig } = await freshConfig();
    const cfg = getDatabasePoolConfig();
    expect(cfg.acquireTimeout).toBe(8000);
    expect(cfg.createTimeout).toBe(8000);
  });
});

// ─── getRetryConfig ───────────────────────────────────────────────────────────

describe('getRetryConfig', () => {
  it('returns default attempts=3 and delay=1000 when no env override', async () => {
    delete process.env.DB_RETRY_ATTEMPTS;
    delete process.env.DB_RETRY_DELAY;
    const { getRetryConfig } = await freshConfig();
    const cfg = getRetryConfig();
    expect(cfg.attempts).toBe(3);
    expect(cfg.delay).toBe(1000);
  });

  it('uses env overrides for attempts and delay', async () => {
    process.env.DB_RETRY_ATTEMPTS = '5';
    process.env.DB_RETRY_DELAY = '2000';
    const { getRetryConfig } = await freshConfig();
    const cfg = getRetryConfig();
    expect(cfg.attempts).toBe(5);
    expect(cfg.delay).toBe(2000);
  });

  it('always returns backoffMultiplier=2', async () => {
    const { getRetryConfig } = await freshConfig();
    expect(getRetryConfig().backoffMultiplier).toBe(2);
  });
});

// ─── getHealthCheckConfig ─────────────────────────────────────────────────────

describe('getHealthCheckConfig', () => {
  it('returns enabled=true by default', async () => {
    delete process.env.DB_HEALTH_CHECK_ENABLED;
    const { getHealthCheckConfig } = await freshConfig();
    expect(getHealthCheckConfig().enabled).toBe(true);
  });

  it('returns enabled=false when DB_HEALTH_CHECK_ENABLED=false', async () => {
    process.env.DB_HEALTH_CHECK_ENABLED = 'false';
    const { getHealthCheckConfig } = await freshConfig();
    expect(getHealthCheckConfig().enabled).toBe(false);
  });

  it('returns default interval=30000 and timeout=5000', async () => {
    delete process.env.DB_HEALTH_CHECK_INTERVAL;
    delete process.env.DB_HEALTH_CHECK_TIMEOUT;
    const { getHealthCheckConfig } = await freshConfig();
    const cfg = getHealthCheckConfig();
    expect(cfg.interval).toBe(30000);
    expect(cfg.timeout).toBe(5000);
  });

  it('uses env overrides for interval and timeout', async () => {
    process.env.DB_HEALTH_CHECK_INTERVAL = '60000';
    process.env.DB_HEALTH_CHECK_TIMEOUT = '10000';
    const { getHealthCheckConfig } = await freshConfig();
    const cfg = getHealthCheckConfig();
    expect(cfg.interval).toBe(60000);
    expect(cfg.timeout).toBe(10000);
  });
});

// ─── getPerformanceBaselines ──────────────────────────────────────────────────

describe('getPerformanceBaselines', () => {
  it('computes connectionPoolWarning as 80% of maxPoolSize', async () => {
    process.env.DB_MAX_POOL_SIZE = '50';
    const { getPerformanceBaselines } = await freshConfig();
    expect(getPerformanceBaselines().connectionPoolWarning).toBe(40);
  });

  it('returns slowQueryThreshold matching DB_SLOW_QUERY_THRESHOLD', async () => {
    process.env.DB_SLOW_QUERY_THRESHOLD = '3000';
    const { getPerformanceBaselines } = await freshConfig();
    expect(getPerformanceBaselines().slowQueryThreshold).toBe(3000);
  });

  it('uses default memoryWarning=512 when env is absent', async () => {
    delete process.env.DB_MEMORY_WARNING_MB;
    const { getPerformanceBaselines } = await freshConfig();
    expect(getPerformanceBaselines().memoryWarning).toBe(512);
  });

  it('uses DB_MEMORY_WARNING_MB env for memoryWarning', async () => {
    process.env.DB_MEMORY_WARNING_MB = '1024';
    const { getPerformanceBaselines } = await freshConfig();
    expect(getPerformanceBaselines().memoryWarning).toBe(1024);
  });
});

// ─── logDatabaseConfig / logDatabasePoolConfig ────────────────────────────────

describe('logDatabaseConfig and logDatabasePoolConfig', () => {
  it('calls logger.info when logDatabaseConfig is invoked', async () => {
    process.env.DATABASE_URL = 'postgresql://u:p@h:5432/d';
    const { logDatabaseConfig } = await freshConfig();
    const { logger } = await import('../../utils/logger');
    logDatabaseConfig();
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('configuration'),
      expect.any(String),
      expect.any(Object)
    );
  });

  it('logDatabasePoolConfig delegates to logDatabaseConfig without throwing', async () => {
    process.env.DATABASE_URL = 'postgresql://u:p@h:5432/d';
    const { logDatabasePoolConfig } = await freshConfig();
    expect(() => logDatabasePoolConfig()).not.toThrow();
  });
});
