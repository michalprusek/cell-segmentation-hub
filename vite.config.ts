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
      react: path.resolve(__dirname, './node_modules/react'),
      'react-dom': path.resolve(__dirname, './node_modules/react-dom'),
      'react/jsx-runtime': path.resolve(
        __dirname,
        './node_modules/react/jsx-runtime'
      ),
    },
    dedupe: ['react', 'react-dom', 'react/jsx-runtime', 'scheduler'],
  },
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react/jsx-runtime',
      'scheduler',
      'react-router-dom',
      '@radix-ui/react-dialog',
      '@radix-ui/react-slot',
      'xlsx',
    ],
    exclude: [],
    esbuildOptions: {
      define: {
        global: 'globalThis',
      },
    },
  },
  build: {
    commonjsOptions: {
      include: [/node_modules/],
      transformMixedEsModules: true,
    },
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Handle node_modules packages
          if (!id.includes('node_modules')) {
            return; // Let Vite handle app code
          }

          // Excel libraries - separate due to size
          if (id.includes('exceljs') || id.includes('xlsx')) {
            return 'excel-vendor';
          }

          // Socket.io and related packages MUST be together
          if (
            id.includes('socket.io') ||
            id.includes('engine.io') ||
            id.includes('@socket.io') ||
            id.includes('xmlhttprequest') ||
            id.includes('ws') ||
            id.includes('parseuri') ||
            id.includes('parseqs') ||
            id.includes('yeast') ||
            id.includes('has-cors') ||
            id.includes('backo2') ||
            id.includes('component-emitter')
          ) {
            return 'network-vendor';
          }

          // CRITICAL: All React and React-dependent packages MUST be together
          // This ensures React is available when any React-dependent code runs
          if (
            // Core React - match more broadly
            (id.includes('react') && !id.includes('react-remove-scroll-bar')) ||
            id.includes('/scheduler/') ||
            // React Router - match ALL router packages
            id.includes('react-router') ||
            id.includes('@remix-run/router') ||
            // ALL Radix UI components (they ALL use React)
            id.includes('/@radix-ui/') ||
            // Lucide React - CRITICAL! This uses React.forwardRef
            id.includes('/lucide-react') ||
            // React-based libraries
            id.includes('/framer-motion') ||
            id.includes('/react-hook-form') ||
            id.includes('/@hookform/') ||
            id.includes('/react-dropzone') ||
            id.includes('/react-easy-crop') ||
            id.includes('/react-day-picker') ||
            id.includes('/react-resizable-panels') ||
            id.includes('/react-i18next') ||
            id.includes('/i18next-react') ||
            id.includes('/embla-carousel') ||
            id.includes('/recharts') ||
            id.includes('/@tanstack/') || // ALL Tanstack packages together
            id.includes('/next-themes') ||
            id.includes('/cmdk') ||
            id.includes('/sonner') ||
            id.includes('/vaul') ||
            id.includes('/input-otp') ||
            id.includes('/class-variance-authority') ||
            id.includes('/clsx') ||
            id.includes('/tailwind-merge') ||
            id.includes('/tailwindcss-animate') ||
            // Hook libraries
            id.includes('/use-') ||
            id.includes('/@use-') ||
            id.includes('/react-use')
          ) {
            return 'react-vendor';
          }

          // Utilities
          if (
            id.includes('/date-fns') ||
            id.includes('/uuid') ||
            id.includes('/zod') ||
            id.includes('/file-saver') ||
            id.includes('/jszip')
          ) {
            return 'utils-vendor';
          }

          // i18n libraries
          if (id.includes('/i18next') && !id.includes('react')) {
            return 'i18n-vendor';
          }

          // Floating UI and Popper (often used by UI libraries)
          if (
            id.includes('@floating-ui') ||
            id.includes('@popperjs') ||
            id.includes('dom-helpers') ||
            id.includes('react-remove-scroll') ||
            id.includes('react-style-singleton') ||
            id.includes('get-nonce') ||
            id.includes('use-callback-ref') ||
            id.includes('use-sidecar') ||
            id.includes('@babel/runtime') ||
            id.includes('react-is') ||
            id.includes('tabbable') ||
            id.includes('focus-trap') ||
            id.includes('aria-hidden') ||
            id.includes('react-clientside-effect') ||
            id.includes('warning') ||
            id.includes('invariant') ||
            id.includes('prop-types')
          ) {
            return 'react-vendor';
          }

          // Everything else
          return 'vendor';
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
