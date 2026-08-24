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

    // Bring up env vars + global setup. vitest.env.ts is the single source of
    // truth for test env vars (loaded first, before any module evaluates).
    // ABSOLUTE, not relative. Vitest resolved these against the repository
    // root rather than this directory, so it loaded the FRONTEND's
    // `vitest.setup.ts` and `src/test/setup.ts` — files of the same name one
    // level up. The first thing the frontend setup does is stub `window`,
    // which does not exist under `environment: 'node'`, so setup threw and
    // vitest reported every backend file as a failed suite with "no tests".
    // The whole backend suite was unrunnable. Vitest's own error message
    // recommends exactly this: "Use absolute paths instead."
    setupFiles: [
      path.resolve(__dirname, './vitest.env.ts'),
      path.resolve(__dirname, './vitest.setup.ts'),
      path.resolve(__dirname, './src/test/setup.ts'),
    ],

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
