import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig({
  server: {
    host: '::',
    port: 5173,
    allowedHosts: ['localhost', '127.0.0.1', 'spherosegapp.utia.cas.cz'],
  },
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  optimizeDeps: {
    include: ['xlsx'],
  },
  build: {
    commonjsOptions: {
      include: [/xlsx/, /node_modules/],
    },
    chunkSizeWarningLimit: 1000, // Increase warning limit to 1MB for now
    rollupOptions: {
      output: {
        manualChunks: id => {
          // Handle specific large libraries
          if (id.includes('exceljs') || id.includes('xlsx')) {
            return 'excel-vendor';
          }

          // Core React - keep together for caching
          if (
            id.includes('react') ||
            id.includes('react-dom') ||
            id.includes('react-router')
          ) {
            return 'react-vendor';
          }

          // UI libraries - separate from core functionality
          if (
            id.includes('@radix-ui') ||
            id.includes('framer-motion') ||
            id.includes('class-variance-authority')
          ) {
            return 'ui-vendor';
          }

          // Chart libraries - loaded only when needed
          if (id.includes('recharts')) {
            return 'chart-vendor';
          }

          // Form handling
          if (
            id.includes('react-hook-form') ||
            id.includes('hookform') ||
            id.includes('zod')
          ) {
            return 'form-vendor';
          }

          // Data fetching
          if (id.includes('tanstack') || id.includes('axios')) {
            return 'data-vendor';
          }

          // File utilities
          if (
            id.includes('file-saver') ||
            id.includes('jszip') ||
            id.includes('react-dropzone') ||
            id.includes('react-easy-crop')
          ) {
            return 'file-vendor';
          }

          // Image processing
          if (id.includes('react-easy-crop')) {
            return 'image-vendor';
          }

          // Utilities
          if (
            id.includes('date-fns') ||
            id.includes('uuid') ||
            id.includes('socket.io')
          ) {
            return 'utils-vendor';
          }

          // Other libraries
          if (
            id.includes('cmdk') ||
            id.includes('sonner') ||
            id.includes('vaul') ||
            id.includes('input-otp') ||
            id.includes('next-themes')
          ) {
            return 'misc-vendor';
          }

          // Keep vendor node_modules separate from app code
          if (id.includes('node_modules')) {
            return 'vendor';
          }

          // Default chunking for app code
          return null;
        },
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    coverage: {
      enabled:
        process.env.CI === 'true' ||
        process.env.VITE_ENABLE_COVERAGE === 'true',
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      reportsDirectory: './coverage',
      exclude: [
        'node_modules/',
        'dist/',
        'tests/',
        '*.config.*',
        '**/*.d.ts',
        '**/*.test.*',
        '**/*.spec.*',
        '**/test-utils/**',
        '**/mocks/**',
        '**/fixtures/**',
        'src/main.tsx',
        'src/vite-env.d.ts',
      ],
      include: ['src/**/*.{ts,tsx}'],
      thresholds: {
        statements: process.env.CI === 'true' ? 80 : 50,
        branches: process.env.CI === 'true' ? 70 : 40,
        functions: process.env.CI === 'true' ? 80 : 50,
        lines: process.env.CI === 'true' ? 80 : 50,
        perFile: false,
        autoUpdate: false,
        '100': false,
      },
      watermarks: {
        statements: [50, 80],
        branches: [40, 70],
        functions: [50, 80],
        lines: [50, 80],
      },
      clean: true,
      cleanOnRerun: true,
      skipFull: false,
      all: true,
    },
    testTimeout: 30000,
    hookTimeout: 30000,
    teardownTimeout: 10000,
    watchExclude: ['**/node_modules/**', '**/dist/**', '**/coverage/**'],
    maxConcurrency: 5,
    bail: 0,
    allowOnly: false,
    dangerouslyIgnoreUnhandledErrors: false,
    passWithNoTests: false,
  },
});
