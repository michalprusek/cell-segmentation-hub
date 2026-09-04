import { describe, it, expect } from 'vitest';
import config, { apiBaseUrl, mlServiceUrl, wsUrl } from '@/lib/config';

// The test environment sets the following via setup.ts / vitest env config:
//   VITE_API_URL    = 'http://localhost:3001/api'   (no VITE_API_BASE_URL)
//   VITE_ML_SERVICE_URL = 'http://localhost:8000'
//   VITE_WS_URL     = 'ws://localhost:3001'

describe('config', () => {
  describe('default export shape', () => {
    it('has apiBaseUrl, mlServiceUrl and wsUrl properties', () => {
      expect(config).toHaveProperty('apiBaseUrl');
      expect(config).toHaveProperty('mlServiceUrl');
      expect(config).toHaveProperty('wsUrl');
    });

    it('all config values are strings', () => {
      expect(typeof config.apiBaseUrl).toBe('string');
      expect(typeof config.mlServiceUrl).toBe('string');
      expect(typeof config.wsUrl).toBe('string');
    });
  });

  describe('named exports match default export', () => {
    it('apiBaseUrl named export equals config.apiBaseUrl', () => {
      expect(apiBaseUrl).toBe(config.apiBaseUrl);
    });

    it('mlServiceUrl named export equals config.mlServiceUrl', () => {
      expect(mlServiceUrl).toBe(config.mlServiceUrl);
    });

    it('wsUrl named export equals config.wsUrl', () => {
      expect(wsUrl).toBe(config.wsUrl);
    });
  });

  describe('apiBaseUrl', () => {
    it('is a non-empty string', () => {
      expect(apiBaseUrl.length).toBeGreaterThan(0);
    });

    it('does not contain trailing whitespace', () => {
      expect(apiBaseUrl).toBe(apiBaseUrl.trim());
    });

    it('contains a path or host indicating an API endpoint', () => {
      // Should include "api" somewhere since VITE_API_URL is used and /api is appended
      expect(apiBaseUrl.toLowerCase()).toMatch(/api/);
    });
  });

  describe('mlServiceUrl', () => {
    it('is a non-empty string', () => {
      expect(mlServiceUrl.length).toBeGreaterThan(0);
    });

    it('is a valid URL format', () => {
      expect(() => new URL(mlServiceUrl)).not.toThrow();
    });

    it('does not contain trailing whitespace', () => {
      expect(mlServiceUrl).toBe(mlServiceUrl.trim());
    });
  });

  describe('wsUrl', () => {
    it('is a string (may be empty for relative connections)', () => {
      expect(typeof wsUrl).toBe('string');
    });

    // These two guarded their assertion behind `if (wsUrl.length > 0)`. That
    // holds today (VITE_WS_URL is set in the vitest env, so wsUrl is
    // 'ws://localhost:3001'), but the guard means that the day the env stops
    // setting it these tests go on reporting green having asserted nothing.
    // Assert the precondition instead, so the test fails loudly rather than
    // quietly turning into a no-op.
    it('uses ws:// or wss:// protocol', () => {
      expect(
        wsUrl,
        'VITE_WS_URL must be set for this test to mean anything'
      ).not.toBe('');
      expect(wsUrl).toMatch(/^wss?:\/\//);
    });

    it('is a valid URL', () => {
      expect(
        wsUrl,
        'VITE_WS_URL must be set for this test to mean anything'
      ).not.toBe('');
      expect(() => new URL(wsUrl)).not.toThrow();
    });

    it('never uses http:// or https:// protocol', () => {
      expect(wsUrl).not.toMatch(/^https?:\/\//);
    });
  });
});
