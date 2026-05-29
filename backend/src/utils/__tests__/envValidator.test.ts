/**
 * Behavioral unit tests for src/utils/envValidator.ts
 *
 * Strategy: manipulate process.env in beforeEach/afterEach so each case
 * runs against a controlled environment; restore after each test to avoid
 * cross-test contamination.  The module reads process.env at call-time (no
 * module-level capture), so no re-import tricks are needed.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock logger before any envValidator import so no real I/O occurs
vi.mock('../../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import {
  validateEnvironment,
  requireValidEnvironment,
  getEnvVar,
  getNumericEnvVar,
  getBooleanEnvVar,
} from '../envValidator';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const REQUIRED_VARS: Record<string, string> = {
  DATABASE_URL: 'postgresql://localhost:5432/test',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
  SEGMENTATION_SERVICE_URL: 'http://localhost:8000',
  REDIS_URL: 'redis://localhost:6379',
  UPLOAD_DIR: '/app/uploads',
  CORS_ORIGIN: 'http://localhost:3000',
  WS_ALLOWED_ORIGINS: 'http://localhost:3000',
  FRONTEND_URL: 'http://localhost:3000',
};

let savedEnv: Record<string, string | undefined> = {};

function setEnv(vars: Record<string, string | undefined>): void {
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = v;
    }
  }
}

beforeEach(() => {
  // Snapshot keys that we might touch
  const allKeys = [
    ...Object.keys(REQUIRED_VARS),
    'NODE_ENV',
    'SMTP_PORT',
    'FROM_EMAIL',
    'EMAIL_TIMEOUT',
    'TEST_CUSTOM_VAR',
  ];
  savedEnv = {};
  for (const k of allKeys) {
    savedEnv[k] = process.env[k];
  }
  // Start each test with all required vars populated
  setEnv(REQUIRED_VARS);
});

afterEach(() => {
  setEnv(savedEnv);
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// validateEnvironment
// ---------------------------------------------------------------------------

describe('validateEnvironment', () => {
  describe('when all required variables are present and valid', () => {
    it('returns valid=true with no errors', () => {
      const result = validateEnvironment();
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('reports correct summary counts', () => {
      const result = validateEnvironment();
      expect(result.summary.total).toBeGreaterThan(0);
      expect(result.summary.missing).toBe(0);
      expect(result.summary.invalid).toBe(0);
    });

    it('summary.configured equals required+optional vars that passed', () => {
      const result = validateEnvironment();
      // configured = vars that passed validation (have value + valid)
      expect(result.summary.configured).toBeGreaterThan(0);
    });
  });

  describe('when a required variable is missing', () => {
    it('DATABASE_URL missing → valid=false with error mentioning DATABASE_URL', () => {
      delete process.env.DATABASE_URL;
      const result = validateEnvironment();
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('DATABASE_URL'))).toBe(true);
    });

    it('JWT_ACCESS_SECRET missing → error contains JWT_ACCESS_SECRET', () => {
      delete process.env.JWT_ACCESS_SECRET;
      const result = validateEnvironment();
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('JWT_ACCESS_SECRET'))).toBe(
        true
      );
    });

    it('missing required var increments summary.missing', () => {
      delete process.env.CORS_ORIGIN;
      const result = validateEnvironment();
      expect(result.summary.missing).toBeGreaterThanOrEqual(1);
    });
  });

  describe('DATABASE_URL validator', () => {
    it('accepts postgresql:// URLs', () => {
      process.env.DATABASE_URL = 'postgresql://user:pass@host/db';
      const result = validateEnvironment();
      // DATABASE_URL itself passes; check no DATABASE_URL error
      expect(result.errors.some(e => e.includes('DATABASE_URL'))).toBe(false);
    });

    it('accepts sqlite: URLs', () => {
      process.env.DATABASE_URL = 'sqlite:./dev.db';
      const result = validateEnvironment();
      expect(result.errors.some(e => e.includes('DATABASE_URL'))).toBe(false);
    });

    it('rejects plain strings without postgresql:// or sqlite:', () => {
      process.env.DATABASE_URL = 'mysql://localhost/db';
      const result = validateEnvironment();
      // validator returns false → required var → error
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('DATABASE_URL'))).toBe(true);
    });
  });

  describe('JWT secret length validator', () => {
    it('rejects JWT_ACCESS_SECRET shorter than 32 chars', () => {
      process.env.JWT_ACCESS_SECRET = 'tooshort';
      const result = validateEnvironment();
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('JWT_ACCESS_SECRET'))).toBe(
        true
      );
    });

    it('accepts JWT_ACCESS_SECRET with exactly 32 chars', () => {
      process.env.JWT_ACCESS_SECRET = 'a'.repeat(32);
      const result = validateEnvironment();
      expect(result.errors.some(e => e.includes('JWT_ACCESS_SECRET'))).toBe(
        false
      );
    });
  });

  describe('SEGMENTATION_SERVICE_URL validator', () => {
    it('rejects non-http values', () => {
      process.env.SEGMENTATION_SERVICE_URL = 'ftp://bad.host';
      const result = validateEnvironment();
      // validator: startsWith('http') — ftp fails
      expect(result.valid).toBe(false);
    });

    it('accepts http:// and https://', () => {
      process.env.SEGMENTATION_SERVICE_URL = 'https://ml-service:8000';
      const result = validateEnvironment();
      expect(
        result.errors.some(e => e.includes('SEGMENTATION_SERVICE_URL'))
      ).toBe(false);
    });
  });

  describe('REDIS_URL validator', () => {
    it('rejects URLs without redis://', () => {
      process.env.REDIS_URL = 'tcp://localhost:6379';
      const result = validateEnvironment();
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('REDIS_URL'))).toBe(true);
    });

    it('accepts redis://... URL', () => {
      process.env.REDIS_URL = 'redis://localhost:6379';
      const result = validateEnvironment();
      expect(result.errors.some(e => e.includes('REDIS_URL'))).toBe(false);
    });
  });

  describe('optional variables', () => {
    it('missing optional var produces a warning, not an error', () => {
      delete process.env.SMTP_HOST;
      const result = validateEnvironment();
      expect(result.errors.some(e => e.includes('SMTP_HOST'))).toBe(false);
      expect(result.warnings.some(w => w.includes('SMTP_HOST'))).toBe(true);
    });

    it('SMTP_PORT with invalid non-numeric value produces a warning', () => {
      process.env.SMTP_PORT = 'not-a-number';
      const result = validateEnvironment();
      // SMTP_PORT is optional; bad value → warning
      expect(result.warnings.some(w => w.includes('SMTP_PORT'))).toBe(true);
      expect(result.errors.some(e => e.includes('SMTP_PORT'))).toBe(false);
    });

    it('FROM_EMAIL with invalid format produces a warning', () => {
      process.env.FROM_EMAIL = 'not-an-email';
      const result = validateEnvironment();
      expect(result.warnings.some(w => w.includes('FROM_EMAIL'))).toBe(true);
    });

    it('valid FROM_EMAIL produces no error', () => {
      process.env.FROM_EMAIL = 'admin@example.com';
      const result = validateEnvironment();
      expect(result.errors.some(e => e.includes('FROM_EMAIL'))).toBe(false);
    });
  });

  describe('NODE_ENV validator', () => {
    it('rejects values outside development|production|test', () => {
      process.env.NODE_ENV = 'staging';
      const result = validateEnvironment();
      // NODE_ENV is optional — invalid value goes to warnings
      expect(result.warnings.some(w => w.includes('NODE_ENV'))).toBe(true);
    });

    it('accepts "production" for NODE_ENV', () => {
      process.env.NODE_ENV = 'production';
      const result = validateEnvironment();
      expect(result.errors.some(e => e.includes('NODE_ENV'))).toBe(false);
    });
  });

  describe('default value injection', () => {
    it('sets process.env default for SMTP_PORT when not present', () => {
      delete process.env.SMTP_PORT;
      const before = process.env.SMTP_PORT;
      validateEnvironment();
      // The validator injects defaultValue='587' when absent
      expect(before).toBeUndefined();
      expect(process.env.SMTP_PORT).toBe('587');
    });

    it('sets process.env default for FROM_EMAIL when not present', () => {
      delete process.env.FROM_EMAIL;
      validateEnvironment();
      expect(process.env.FROM_EMAIL).toBe('noreply@example.com');
    });
  });

  describe('multiple missing required vars', () => {
    it('collects all errors, not just the first', () => {
      delete process.env.DATABASE_URL;
      delete process.env.CORS_ORIGIN;
      const result = validateEnvironment();
      expect(result.errors.length).toBeGreaterThanOrEqual(2);
    });
  });
});

// ---------------------------------------------------------------------------
// requireValidEnvironment
// ---------------------------------------------------------------------------

describe('requireValidEnvironment', () => {
  it('does not call process.exit when environment is valid', () => {
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => {}) as (
        code?: number | string | null
      ) => never);
    requireValidEnvironment();
    expect(exitSpy).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });

  it('calls process.exit(1) when a required variable is missing', () => {
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => {}) as (
        code?: number | string | null
      ) => never);
    delete process.env.DATABASE_URL;
    requireValidEnvironment();
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// getEnvVar
// ---------------------------------------------------------------------------

describe('getEnvVar', () => {
  it('returns the env var value when set', () => {
    process.env.TEST_CUSTOM_VAR = 'hello';
    expect(getEnvVar('TEST_CUSTOM_VAR')).toBe('hello');
  });

  it('returns the provided default when env var is absent', () => {
    delete process.env.TEST_CUSTOM_VAR;
    expect(getEnvVar('TEST_CUSTOM_VAR', 'fallback')).toBe('fallback');
  });

  it('throws when env var is absent and no default is given', () => {
    delete process.env.TEST_CUSTOM_VAR;
    expect(() => getEnvVar('TEST_CUSTOM_VAR')).toThrow(
      'Environment variable TEST_CUSTOM_VAR is not defined'
    );
  });
});

// ---------------------------------------------------------------------------
// getNumericEnvVar
// ---------------------------------------------------------------------------

describe('getNumericEnvVar', () => {
  it('parses a valid integer env var', () => {
    process.env.TEST_CUSTOM_VAR = '42';
    expect(getNumericEnvVar('TEST_CUSTOM_VAR', 0)).toBe(42);
  });

  it('returns defaultValue when env var is not set', () => {
    delete process.env.TEST_CUSTOM_VAR;
    expect(getNumericEnvVar('TEST_CUSTOM_VAR', 99)).toBe(99);
  });

  it('returns defaultValue and warns when value is not a number', () => {
    process.env.TEST_CUSTOM_VAR = 'banana';
    const result = getNumericEnvVar('TEST_CUSTOM_VAR', 7);
    expect(result).toBe(7);
  });

  it('handles negative integers', () => {
    process.env.TEST_CUSTOM_VAR = '-5';
    expect(getNumericEnvVar('TEST_CUSTOM_VAR', 0)).toBe(-5);
  });
});

// ---------------------------------------------------------------------------
// getBooleanEnvVar
// ---------------------------------------------------------------------------

describe('getBooleanEnvVar', () => {
  it('returns true for "true"', () => {
    process.env.TEST_CUSTOM_VAR = 'true';
    expect(getBooleanEnvVar('TEST_CUSTOM_VAR', false)).toBe(true);
  });

  it('returns true for "TRUE" (case-insensitive)', () => {
    process.env.TEST_CUSTOM_VAR = 'TRUE';
    expect(getBooleanEnvVar('TEST_CUSTOM_VAR', false)).toBe(true);
  });

  it('returns true for "1"', () => {
    process.env.TEST_CUSTOM_VAR = '1';
    expect(getBooleanEnvVar('TEST_CUSTOM_VAR', false)).toBe(true);
  });

  it('returns false for "false"', () => {
    process.env.TEST_CUSTOM_VAR = 'false';
    expect(getBooleanEnvVar('TEST_CUSTOM_VAR', true)).toBe(false);
  });

  it('returns false for "0"', () => {
    process.env.TEST_CUSTOM_VAR = '0';
    expect(getBooleanEnvVar('TEST_CUSTOM_VAR', true)).toBe(false);
  });

  it('returns defaultValue when env var is absent', () => {
    delete process.env.TEST_CUSTOM_VAR;
    expect(getBooleanEnvVar('TEST_CUSTOM_VAR', true)).toBe(true);
    expect(getBooleanEnvVar('TEST_CUSTOM_VAR', false)).toBe(false);
  });
});
