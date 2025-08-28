/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: process.env.CI
        ? ['json', 'lcov'] // Minimal reporters for CI to prevent hanging
        : ['text', 'json', 'html', 'lcov'], // Full reporters for local development
      exclude: [
        'node_modules/',
        'src/test/',
        '**/*.d.ts',
        '**/*.config.*',
        'dist/',
        'build/',
        'coverage/',
        '**/*.test.*',
        '**/*.spec.*',
      ],
      thresholds: {
        global: {
          branches: 80,
          functions: 80,
          lines: 80,
          statements: 80,
        },
      },
      // CI optimizations
      reportsDirectory: './coverage',
      clean: true,
    },
    css: true,
    include: ['src/**/*.{test,spec}.{js,ts,jsx,tsx}'],
    exclude: ['node_modules', 'dist', '.idea', '.git', '.cache'],
    testTimeout: process.env.CI ? 10000 : 15000, // Shorter timeout in CI
    hookTimeout: process.env.CI ? 10000 : 15000,
    // CI-specific optimizations
    ...(process.env.CI && {
      pool: 'threads',
      poolOptions: {
        threads: {
          minThreads: 1,
          maxThreads: 2,
        },
      },
      silent: true, // Reduce output in CI
      logHeapUsage: false,
      allowOnly: false,
    }),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
