import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig({
  server: {
    host: '::',
    port: 5173,
    allowedHosts: ['localhost', '127.0.0.1', 'spherosegapp.utia.cas.cz'],
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        secure: false,
      },
      '/socket.io': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        ws: true,
      },
    },
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
    chunkSizeWarningLimit: 500, // Warn for chunks over 500KB
    rollupOptions: {
      output: {
        // Fix for dynamic imports in production - use consistent naming
        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]',
        manualChunks: {
          // Core React libraries
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],

          // UI components and styling
          'ui-vendor': [
            '@radix-ui/react-dialog',
            '@radix-ui/react-dropdown-menu',
            '@radix-ui/react-popover',
            '@radix-ui/react-select',
            '@radix-ui/react-tabs',
            '@radix-ui/react-toast',
            '@radix-ui/react-tooltip',
            '@radix-ui/react-accordion',
            '@radix-ui/react-alert-dialog',
            '@radix-ui/react-avatar',
            '@radix-ui/react-checkbox',
            '@radix-ui/react-label',
            '@radix-ui/react-progress',
            '@radix-ui/react-separator',
            '@radix-ui/react-switch',
            'framer-motion',
            'class-variance-authority',
            'clsx',
            'tailwind-merge',
          ],

          // Heavy chart libraries
          'chart-vendor': ['recharts'],

          // Form handling
          'form-vendor': ['react-hook-form', '@hookform/resolvers', 'zod'],

          // Data fetching and state management
          'data-vendor': ['@tanstack/react-query', 'axios'],

          // Excel export (heavy library - loaded only when needed)
          'excel-vendor': ['exceljs'],

          // File processing and utilities
          'file-vendor': ['file-saver', 'jszip', 'react-dropzone'],

          // Date and image utilities
          'utils-vendor': ['date-fns', 'uuid', 'socket.io-client'],

          // Image processing
          'image-vendor': ['react-easy-crop'],

          // Other utilities
          'misc-vendor': ['cmdk', 'sonner', 'vaul', 'input-otp', 'next-themes'],
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
