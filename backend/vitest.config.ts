import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/__tests__/**/*.ts'],
    exclude: ['node_modules'],
    timeout: 30000
  },
  resolve: {
    alias: {
      '@': '/app/src'
    }
  }
});