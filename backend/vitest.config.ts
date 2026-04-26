import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',

    // Match Jest's global behavior — test files don't need to import
    // `describe`/`it`/`expect`/`beforeEach` etc. The bulk migration script
    // didn't add explicit imports to every test file, and Jest's API was
    // global by default. Files that DO import explicitly still work.
    globals: true,

    // Match the existing Jest discovery patterns.
    include: ['src/**/__tests__/**/*.ts', 'src/**/*.{test,spec}.ts'],
    exclude: [
      'node_modules',
      'dist',
      'build',
      // Integration suites have their own runner / DB setup.
      'src/test/integration/**',
    ],

    // Bring up env vars + global setup (mirrors jest.env.js + jest.setup.js
    // + src/test/setup.ts).
    setupFiles: ['./vitest.env.ts', './vitest.setup.ts', './src/test/setup.ts'],

    testTimeout: 30000,

    // Match Jest's reset/restore semantics.
    clearMocks: true,
    restoreMocks: true,

    // Forks pool — each test file in its own process. Slower but matches
    // Jest's isolation and prevents cross-test global-state leaks
    // (singleton services, env mutations, etc.).
    pool: 'forks',

    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      reportsDirectory: 'coverage',
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.d.ts',
        'src/server.ts',
        'src/db/seed.ts',
        'src/**/*.test.ts',
        'src/**/*.spec.ts',
        'src/test/**',
      ],
      thresholds: {
        lines: 75,
        functions: 75,
        branches: 75,
        statements: 75,
      },
    },
  },

  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
