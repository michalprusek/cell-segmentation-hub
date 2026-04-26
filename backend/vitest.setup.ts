// Vitest setup — mirrors jest.setup.js. Sets a few additional env vars and
// silences console output during tests to keep output focused on test
// results rather than incidental log spew.

import { vi } from 'vitest';

// Migration compat shim: tests still using `jest.fn()` / `jest.spyOn()` etc.
// (notably multi-line `jest\n.fn()` constructs missed by the bulk sed) keep
// working by aliasing `jest` to `vi` globally. New tests should use `vi`
// directly — this exists only to keep the migration cost-bounded.
(globalThis as { jest?: typeof vi }).jest = vi;

process.env.EMAIL_SERVICE = 'smtp';
process.env.REQUIRE_EMAIL_VERIFICATION = 'false';
process.env.PORT = '3001';
process.env.HOST = 'localhost';

if (process.env.NODE_ENV === 'test') {
  // Suppress noisy console output from production code under test.
  // Tests that need to assert on console behavior should restore via
  // vi.spyOn(console, ...) per-test.
  globalThis.console = {
    ...console,
    error: () => {},
    warn: () => {},
    log: () => {},
  };
}
