/**
 * Behavioral unit tests for src/utils/config.ts
 *
 * Isolation strategy:
 * - config.ts calls parseConfig() at module evaluation time (module-load side effect).
 * - Each test calls importFreshConfig() which: (1) sets process.env to desired
 *   state, (2) re-installs the process.exit no-op spy so the failure path does
 *   not abort the process, (3) calls vi.resetModules() to bust the Vite module
 *   cache, (4) dynamically imports the module.
 * - vi.mock for the logger is hoisted to the top so it runs first; after
 *   resetModules() the logger mock may be cleared, but config.ts still calls
 *   the real logger (which is acceptable — the test cares about config values
 *   and exit behavior, not log output).
 * - The process.exit spy MUST be re-installed after every resetModules() call
 *   because resetModules() clears the spy state.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Silence logger for the initial module load
vi.mock('../logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock dotenv so that dotenv.config() is a no-op for all config imports.
// Without this, dotenv loads the .env file from the backend directory and
// repopulates env vars we deliberately deleted (SMTP_PORT, FROM_EMAIL, etc.).
vi.mock('dotenv', () => ({
  default: { config: vi.fn() },
  config: vi.fn(),
}));

// Install the initial exit spy so the file-level import (if any) doesn't crash.
vi.spyOn(process, 'exit').mockImplementation((() => {}) as (
  code?: number | string | null
) => never);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal valid env for test mode (matches vitest.env.ts). */
const BASE_ENV: Record<string, string> = {
  NODE_ENV: 'test',
  JWT_ACCESS_SECRET: 'test-access-secret-for-testing-only-32-characters-long',
  JWT_REFRESH_SECRET: 'test-refresh-secret-for-testing-only-32-characters-long',
  FROM_EMAIL: 'test@example.com',
  SEGMENTATION_SERVICE_URL: 'http://localhost:8000',
  EMAIL_SERVICE: 'smtp',
  SMTP_HOST: 'localhost',
  SMTP_PORT: '25',
  ALLOWED_ORIGINS: 'http://localhost:3000',
};

type EnvOverride = Record<string, string | undefined>;

function buildEnv(
  overrides: EnvOverride = {}
): Record<string, string | undefined> {
  return { ...BASE_ENV, ...overrides };
}

function applyEnv(vars: Record<string, string | undefined>): void {
  // First remove any keys that should be absent
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = v;
    }
  }
}

/** Returns the exitSpy after re-installing it (resetModules clears spy state). */
function reinstallExitSpy(): ReturnType<typeof vi.spyOn> {
  return vi
    .spyOn(process, 'exit')
    .mockImplementation((() => {}) as (code?: number | string | null) => never);
}

type ConfigModule = typeof import('../config');

/**
 * Builds a complete env snapshot from BASE_ENV + overrides, then:
 * 1. Saves current env
 * 2. Clears the entire env to just what's needed (prevents leakage from
 *    previous tests setting unexpected keys)
 * 3. Reinstalls the process.exit spy
 * 4. Resets the module registry
 * 5. Imports config.ts fresh — catches errors from isDevelopment/isProduction
 *    lines that crash when config is undefined (parse failure path)
 */
async function importFreshConfig(overrides: EnvOverride = {}): Promise<{
  mod: Partial<ConfigModule>;
  spy: ReturnType<typeof vi.spyOn>;
}> {
  const desiredEnv = buildEnv(overrides);

  // Clear ALL current env keys not in desired, then set desired values.
  // This prevents keys set by previous tests from leaking in.
  const keysToRemove = Object.keys(process.env).filter(
    k => !(k in desiredEnv) || desiredEnv[k] === undefined
  );
  for (const k of keysToRemove) {
    delete process.env[k];
  }
  applyEnv(desiredEnv);

  const spy = reinstallExitSpy();
  vi.resetModules();

  // config.ts crashes at lines 218-220 when parseConfig() returns undefined
  // (i.e. exit spy was called but the function didn't actually exit).
  // We wrap the import to gracefully handle this.
  let mod: Partial<ConfigModule> = {};
  try {
    mod = (await import('../config')) as ConfigModule;
  } catch {
    // config is undefined → isDevelopment/isProduction access crashed.
    // The important assertion is on the spy — return partial mod.
  }
  return { mod, spy };
}

let savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  savedEnv = { ...process.env } as Record<string, string | undefined>;
});

afterEach(() => {
  // Restore original env
  for (const key of Object.keys(process.env)) {
    if (!(key in savedEnv)) delete process.env[key];
  }
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Singleton config values (test environment)
// ---------------------------------------------------------------------------

describe('singleton config (test environment)', () => {
  it('NODE_ENV is "test"', async () => {
    const { mod } = await importFreshConfig();
    expect(mod.config.NODE_ENV).toBe('test');
  });

  it('PORT defaults to 3001 (number)', async () => {
    const { mod } = await importFreshConfig({ PORT: undefined });
    expect(mod.config.PORT).toBe(3001);
    expect(typeof mod.config.PORT).toBe('number');
  });

  it('HOST defaults to "localhost"', async () => {
    const { mod } = await importFreshConfig({ HOST: undefined });
    expect(mod.config.HOST).toBe('localhost');
  });

  it('JWT_ACCESS_EXPIRY defaults to "15m"', async () => {
    const { mod } = await importFreshConfig({ JWT_ACCESS_EXPIRY: undefined });
    expect(mod.config.JWT_ACCESS_EXPIRY).toBe('15m');
  });

  it('JWT_REFRESH_EXPIRY defaults to "7d"', async () => {
    const { mod } = await importFreshConfig({ JWT_REFRESH_EXPIRY: undefined });
    expect(mod.config.JWT_REFRESH_EXPIRY).toBe('7d');
  });

  it('JWT_REFRESH_EXPIRY_REMEMBER defaults to "30d"', async () => {
    const { mod } = await importFreshConfig({
      JWT_REFRESH_EXPIRY_REMEMBER: undefined,
    });
    expect(mod.config.JWT_REFRESH_EXPIRY_REMEMBER).toBe('30d');
  });

  it('STORAGE_TYPE defaults to "local"', async () => {
    const { mod } = await importFreshConfig({ STORAGE_TYPE: undefined });
    expect(mod.config.STORAGE_TYPE).toBe('local');
  });

  it('MAX_FILE_SIZE is a number (transformed from string default)', async () => {
    const { mod } = await importFreshConfig({ MAX_FILE_SIZE: undefined });
    expect(typeof mod.config.MAX_FILE_SIZE).toBe('number');
    expect(mod.config.MAX_FILE_SIZE).toBe(10485760);
  });

  it('RATE_LIMIT_ENABLED is a boolean', async () => {
    const { mod } = await importFreshConfig();
    expect(typeof mod.config.RATE_LIMIT_ENABLED).toBe('boolean');
  });

  it('RATE_LIMIT_WINDOW_MS is a number', async () => {
    const { mod } = await importFreshConfig();
    expect(typeof mod.config.RATE_LIMIT_WINDOW_MS).toBe('number');
  });
});

// ---------------------------------------------------------------------------
// isDevelopment / isProduction / isTest flags
// ---------------------------------------------------------------------------

describe('environment flag exports', () => {
  it('isTest is true when NODE_ENV=test', async () => {
    const { mod } = await importFreshConfig({ NODE_ENV: 'test' });
    expect(mod.isTest).toBe(true);
    expect(mod.isDevelopment).toBe(false);
    expect(mod.isProduction).toBe(false);
  });

  it('isDevelopment is true when NODE_ENV=development', async () => {
    const { mod } = await importFreshConfig({ NODE_ENV: 'development' });
    expect(mod.isDevelopment).toBe(true);
    expect(mod.isTest).toBe(false);
    expect(mod.isProduction).toBe(false);
  });

  it('isProduction is true when NODE_ENV=production with valid production env', async () => {
    const secret64 = 'a'.repeat(64);
    const { mod } = await importFreshConfig({
      NODE_ENV: 'production',
      JWT_ACCESS_SECRET: secret64,
      JWT_REFRESH_SECRET: secret64,
      DATABASE_URL: 'postgresql://localhost:5432/prod',
      SEGMENTATION_SERVICE_URL: 'http://ml:8000',
      ALLOWED_ORIGINS: 'https://app.example.com',
      EMAIL_SERVICE: 'sendgrid',
      SENDGRID_API_KEY: 'SG.prod-key-test-value',
      SMTP_HOST: undefined,
      SMTP_PORT: undefined,
    });
    expect(mod.isProduction).toBe(true);
    expect(mod.isDevelopment).toBe(false);
    expect(mod.isTest).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getOrigins helper
// ---------------------------------------------------------------------------

describe('getOrigins', () => {
  it('returns an array of trimmed origins', async () => {
    const { mod } = await importFreshConfig({
      ALLOWED_ORIGINS: 'http://localhost:3000',
    });
    const origins = mod.getOrigins();
    expect(Array.isArray(origins)).toBe(true);
    expect(origins.length).toBe(1);
    origins.forEach((o: string) => expect(o).toBe(o.trim()));
  });

  it('single origin returns one-element array', async () => {
    const { mod } = await importFreshConfig({
      ALLOWED_ORIGINS: 'http://localhost:3000',
    });
    expect(mod.getOrigins()).toEqual(['http://localhost:3000']);
  });

  it('splits comma-separated origins and trims whitespace', async () => {
    const { mod } = await importFreshConfig({
      ALLOWED_ORIGINS: 'http://a.com , http://b.com',
    });
    expect(mod.getOrigins()).toEqual(['http://a.com', 'http://b.com']);
  });

  it('three origins split correctly', async () => {
    const { mod } = await importFreshConfig({
      ALLOWED_ORIGINS: 'http://a.com,http://b.com,http://c.com',
    });
    expect(mod.getOrigins()).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// getEmailConfig helper
// ---------------------------------------------------------------------------

describe('getEmailConfig', () => {
  it('returns smtp config when EMAIL_SERVICE=smtp', async () => {
    const { mod } = await importFreshConfig();
    const emailCfg = mod.getEmailConfig();
    expect(emailCfg.service).toBe('smtp');
    expect(emailCfg).toHaveProperty('host');
    expect(emailCfg).toHaveProperty('port');
  });

  it('smtp host matches SMTP_HOST', async () => {
    const { mod } = await importFreshConfig({ SMTP_HOST: 'mail.example.com' });
    const emailCfg = mod.getEmailConfig();
    expect(emailCfg.host).toBe('mail.example.com');
  });

  it('smtp port is parsed correctly from SMTP_PORT env var', async () => {
    // SMTP_PORT=465 → config.SMTP_PORT=465 → getEmailConfig().port=465
    const { mod } = await importFreshConfig({ SMTP_PORT: '465' });
    const emailCfg = mod.getEmailConfig!();
    expect(emailCfg.port).toBe(465);
  });

  // Note: getEmailConfig returns `port: config.SMTP_PORT || 587` — the 587
  // fallback fires when SMTP_PORT is absent, but absence of SMTP_PORT when
  // EMAIL_SERVICE=smtp also fails the refine validation (exit called before
  // getEmailConfig can be called). The 587 fallback is only reachable when
  // SMTP_PORT is explicitly set to 0 or when EMAIL_SERVICE=sendgrid, which is
  // a contrived case. We skip that narrow path as untestable without
  // bypassing the validation refine.

  it('returns sendgrid config with apiKey when EMAIL_SERVICE=sendgrid', async () => {
    const { mod } = await importFreshConfig({
      EMAIL_SERVICE: 'sendgrid',
      SENDGRID_API_KEY: 'SG.test-key-for-unit-test',
      SMTP_HOST: undefined,
      SMTP_PORT: undefined,
    });
    const emailCfg = mod.getEmailConfig();
    expect(emailCfg.service).toBe('sendgrid');
    expect(emailCfg.apiKey).toBe('SG.test-key-for-unit-test');
  });
});

// ---------------------------------------------------------------------------
// getStorageConfig helper
// ---------------------------------------------------------------------------

describe('getStorageConfig', () => {
  it('returns local config when STORAGE_TYPE=local', async () => {
    const { mod } = await importFreshConfig({ STORAGE_TYPE: 'local' });
    const sc = mod.getStorageConfig();
    expect(sc.type).toBe('local');
    expect(sc).toHaveProperty('uploadDir');
    expect(sc).toHaveProperty('maxFileSize');
  });

  it('local maxFileSize matches config.MAX_FILE_SIZE', async () => {
    const { mod } = await importFreshConfig({ STORAGE_TYPE: 'local' });
    expect(mod.getStorageConfig().maxFileSize).toBe(mod.config.MAX_FILE_SIZE);
  });

  it('local uploadDir matches UPLOAD_DIR', async () => {
    const { mod } = await importFreshConfig({ UPLOAD_DIR: '/custom/uploads' });
    expect(mod.getStorageConfig().uploadDir).toBe('/custom/uploads');
  });

  it('returns s3 config when STORAGE_TYPE=s3', async () => {
    const { mod } = await importFreshConfig({
      STORAGE_TYPE: 's3',
      S3_ACCESS_KEY: 'AKIAIOSFODNN7EXAMPLE',
      S3_SECRET_KEY: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      S3_BUCKET: 'my-bucket',
      S3_REGION: 'us-east-1',
    });
    const sc = mod.getStorageConfig();
    expect(sc.type).toBe('s3');
    expect(sc.bucket).toBe('my-bucket');
    expect(sc.region).toBe('us-east-1');
  });

  it('s3 config does not include uploadDir', async () => {
    const { mod } = await importFreshConfig({
      STORAGE_TYPE: 's3',
      S3_ACCESS_KEY: 'key',
      S3_SECRET_KEY: 'secret',
      S3_BUCKET: 'bucket',
    });
    expect(mod.getStorageConfig()).not.toHaveProperty('uploadDir');
  });
});

// ---------------------------------------------------------------------------
// parseConfig failure path — process.exit is called on invalid env
// ---------------------------------------------------------------------------

describe('parseConfig failure path', () => {
  it('calls process.exit(1) when FROM_EMAIL is missing', async () => {
    const { spy } = await importFreshConfig({ FROM_EMAIL: undefined });
    expect(spy).toHaveBeenCalledWith(1);
  });

  it('calls process.exit(1) when JWT_ACCESS_SECRET is absent', async () => {
    const { spy } = await importFreshConfig({ JWT_ACCESS_SECRET: undefined });
    expect(spy).toHaveBeenCalledWith(1);
  });

  it('calls process.exit(1) when JWT_ACCESS_SECRET is too short', async () => {
    const { spy } = await importFreshConfig({ JWT_ACCESS_SECRET: 'short' });
    expect(spy).toHaveBeenCalledWith(1);
  });

  it('does NOT call process.exit when all required fields are present', async () => {
    const { spy } = await importFreshConfig();
    expect(spy).not.toHaveBeenCalled();
  });

  it('calls process.exit(1) when JWT_REFRESH_SECRET is too short', async () => {
    const { spy } = await importFreshConfig({ JWT_REFRESH_SECRET: 'tooshort' });
    expect(spy).toHaveBeenCalledWith(1);
  });
});

// ---------------------------------------------------------------------------
// Schema transformations
// ---------------------------------------------------------------------------

describe('schema transformations', () => {
  it('PORT string is transformed to a number', async () => {
    const { mod } = await importFreshConfig({ PORT: '4242' });
    expect(mod.config.PORT).toBe(4242);
    expect(typeof mod.config.PORT).toBe('number');
  });

  it('MAX_FILE_SIZE string is transformed to a number', async () => {
    const { mod } = await importFreshConfig({ MAX_FILE_SIZE: '5242880' });
    expect(mod.config.MAX_FILE_SIZE).toBe(5242880);
  });

  it('invalid MAX_FILE_SIZE triggers process.exit(1)', async () => {
    const { spy } = await importFreshConfig({ MAX_FILE_SIZE: 'not-a-number' });
    expect(spy).toHaveBeenCalledWith(1);
  });

  it('RATE_LIMIT_ENABLED="false" — z.coerce.boolean maps any non-empty string to true', async () => {
    // z.coerce.boolean() calls Boolean(val); Boolean("false") === true.
    // This is the actual schema behavior (not smart "false"→false parsing).
    const { mod } = await importFreshConfig({ RATE_LIMIT_ENABLED: 'false' });
    expect(mod.config.RATE_LIMIT_ENABLED).toBe(true);
  });

  it('RATE_LIMIT_ENABLED="" (empty string) coerces to false', async () => {
    const { mod } = await importFreshConfig({ RATE_LIMIT_ENABLED: '' });
    expect(mod.config.RATE_LIMIT_ENABLED).toBe(false);
  });

  it('RATE_LIMIT_ENABLED="1" coerces to boolean true', async () => {
    const { mod } = await importFreshConfig({ RATE_LIMIT_ENABLED: '1' });
    expect(mod.config.RATE_LIMIT_ENABLED).toBe(true);
  });

  it('RATE_LIMIT_MAX string is coerced to a number', async () => {
    const { mod } = await importFreshConfig({ RATE_LIMIT_MAX: '1000' });
    expect(mod.config.RATE_LIMIT_MAX).toBe(1000);
  });

  it('SMTP_PORT string is transformed to a number', async () => {
    const { mod } = await importFreshConfig({ SMTP_PORT: '465' });
    // config.SMTP_PORT is number | undefined
    expect(mod.config.SMTP_PORT).toBe(465);
  });
});

// ---------------------------------------------------------------------------
// Cross-field refine validation
// ---------------------------------------------------------------------------

describe('cross-field validation (refine)', () => {
  it('STORAGE_TYPE=s3 without S3_ACCESS_KEY triggers exit', async () => {
    const { spy } = await importFreshConfig({
      STORAGE_TYPE: 's3',
      S3_ACCESS_KEY: undefined,
      S3_SECRET_KEY: 'secret',
      S3_BUCKET: 'bucket',
    });
    expect(spy).toHaveBeenCalledWith(1);
  });

  it('STORAGE_TYPE=s3 without S3_SECRET_KEY triggers exit', async () => {
    const { spy } = await importFreshConfig({
      STORAGE_TYPE: 's3',
      S3_ACCESS_KEY: 'key',
      S3_SECRET_KEY: undefined,
      S3_BUCKET: 'bucket',
    });
    expect(spy).toHaveBeenCalledWith(1);
  });

  it('STORAGE_TYPE=s3 without S3_BUCKET triggers exit', async () => {
    const { spy } = await importFreshConfig({
      STORAGE_TYPE: 's3',
      S3_ACCESS_KEY: 'key',
      S3_SECRET_KEY: 'secret',
      S3_BUCKET: undefined,
    });
    expect(spy).toHaveBeenCalledWith(1);
  });

  it('EMAIL_SERVICE=sendgrid without SENDGRID_API_KEY triggers exit', async () => {
    const { spy } = await importFreshConfig({
      EMAIL_SERVICE: 'sendgrid',
      SENDGRID_API_KEY: undefined,
      SMTP_HOST: undefined,
      SMTP_PORT: undefined,
    });
    expect(spy).toHaveBeenCalledWith(1);
  });

  it('EMAIL_SERVICE=smtp without SMTP_HOST triggers exit', async () => {
    const { spy } = await importFreshConfig({
      EMAIL_SERVICE: 'smtp',
      SMTP_HOST: undefined,
      SMTP_PORT: '25',
    });
    expect(spy).toHaveBeenCalledWith(1);
  });

  it('EMAIL_SERVICE=smtp without SMTP_PORT triggers exit', async () => {
    const { spy } = await importFreshConfig({
      EMAIL_SERVICE: 'smtp',
      SMTP_HOST: 'localhost',
      SMTP_PORT: undefined,
    });
    expect(spy).toHaveBeenCalledWith(1);
  });

  it('valid STORAGE_TYPE=s3 with all keys does not trigger exit', async () => {
    const { spy } = await importFreshConfig({
      STORAGE_TYPE: 's3',
      S3_ACCESS_KEY: 'AKIAIOSFODNN7EXAMPLE',
      S3_SECRET_KEY: 'wJalrXUtnFEMI/K7MDENG',
      S3_BUCKET: 'my-bucket',
    });
    expect(spy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Production-specific JWT validation
// ---------------------------------------------------------------------------

describe('production JWT validation', () => {
  it('production env rejects non-hex JWT_ACCESS_SECRET', async () => {
    const { spy } = await importFreshConfig({
      NODE_ENV: 'production',
      JWT_ACCESS_SECRET: 'too-short-for-production',
      JWT_REFRESH_SECRET: 'a'.repeat(64),
      DATABASE_URL: 'postgresql://localhost:5432/prod',
      SEGMENTATION_SERVICE_URL: 'http://ml:8000',
      ALLOWED_ORIGINS: 'https://app.example.com',
      EMAIL_SERVICE: 'sendgrid',
      SENDGRID_API_KEY: 'SG.key',
      SMTP_HOST: undefined,
      SMTP_PORT: undefined,
    });
    expect(spy).toHaveBeenCalledWith(1);
  });

  it('production env accepts a valid 64-char hex secret', async () => {
    const secret64 = 'a'.repeat(64);
    const { spy } = await importFreshConfig({
      NODE_ENV: 'production',
      JWT_ACCESS_SECRET: secret64,
      JWT_REFRESH_SECRET: secret64,
      DATABASE_URL: 'postgresql://localhost:5432/prod',
      SEGMENTATION_SERVICE_URL: 'http://ml:8000',
      ALLOWED_ORIGINS: 'https://app.example.com',
      EMAIL_SERVICE: 'sendgrid',
      SENDGRID_API_KEY: 'SG.prod-key-test-value',
      SMTP_HOST: undefined,
      SMTP_PORT: undefined,
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it('dev/test env accepts a 32+ char non-hex secret', async () => {
    const { mod, spy } = await importFreshConfig({
      JWT_ACCESS_SECRET: 'a'.repeat(32),
    });
    expect(spy).not.toHaveBeenCalled();
    expect(mod.config.JWT_ACCESS_SECRET).toMatch(/.{32,}/);
  });

  it('production env rejects a secret shorter than 64 hex chars', async () => {
    const { spy } = await importFreshConfig({
      NODE_ENV: 'production',
      JWT_ACCESS_SECRET: 'a'.repeat(32), // 32 hex chars — valid dev but not prod
      JWT_REFRESH_SECRET: 'a'.repeat(64),
      DATABASE_URL: 'postgresql://localhost:5432/prod',
      SEGMENTATION_SERVICE_URL: 'http://ml:8000',
      ALLOWED_ORIGINS: 'https://app.example.com',
      EMAIL_SERVICE: 'sendgrid',
      SENDGRID_API_KEY: 'SG.key',
      SMTP_HOST: undefined,
      SMTP_PORT: undefined,
    });
    expect(spy).toHaveBeenCalledWith(1);
  });
});

// ---------------------------------------------------------------------------
// Production required-fields validation
// ---------------------------------------------------------------------------

describe('production required-fields validation', () => {
  it('production env with empty DATABASE_URL triggers exit', async () => {
    const secret64 = 'b'.repeat(64);
    const { spy } = await importFreshConfig({
      NODE_ENV: 'production',
      JWT_ACCESS_SECRET: secret64,
      JWT_REFRESH_SECRET: secret64,
      DATABASE_URL: '',
      SEGMENTATION_SERVICE_URL: 'http://ml:8000',
      ALLOWED_ORIGINS: 'https://app.example.com',
      EMAIL_SERVICE: 'sendgrid',
      SENDGRID_API_KEY: 'SG.key',
      SMTP_HOST: undefined,
      SMTP_PORT: undefined,
    });
    expect(spy).toHaveBeenCalledWith(1);
  });
});

// ---------------------------------------------------------------------------
// Default values
// ---------------------------------------------------------------------------

describe('default values', () => {
  it('UPLOAD_DIR defaults to ./uploads when not set', async () => {
    const { mod } = await importFreshConfig({ UPLOAD_DIR: undefined });
    expect(mod.config.UPLOAD_DIR).toBe('./uploads');
  });

  it('EXPORT_DIR defaults to ./exports when not set', async () => {
    const { mod } = await importFreshConfig({ EXPORT_DIR: undefined });
    expect(mod.config.EXPORT_DIR).toBe('./exports');
  });

  it('SEGMENTATION_SERVICE_URL defaults to http://localhost:8000 in test env', async () => {
    const { mod } = await importFreshConfig({
      SEGMENTATION_SERVICE_URL: undefined,
    });
    expect(mod.config.SEGMENTATION_SERVICE_URL).toBe('http://localhost:8000');
  });

  it('FROM_NAME defaults to "SpheroSeg"', async () => {
    const { mod } = await importFreshConfig({ FROM_NAME: undefined });
    expect(mod.config.FROM_NAME).toBe('SpheroSeg');
  });

  it('EMAIL_SERVICE defaults to "sendgrid" when not set (requires SENDGRID_API_KEY)', async () => {
    const { mod } = await importFreshConfig({
      EMAIL_SERVICE: undefined,
      SENDGRID_API_KEY: 'SG.test-key',
      SMTP_HOST: undefined,
      SMTP_PORT: undefined,
    });
    expect(mod.config.EMAIL_SERVICE).toBe('sendgrid');
  });

  it('PORT defaults to 3001', async () => {
    const { mod } = await importFreshConfig({ PORT: undefined });
    expect(mod.config.PORT).toBe(3001);
  });
});
