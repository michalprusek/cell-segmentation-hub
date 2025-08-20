import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig({
  server: {
    host: '::',
    port: 8082,
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
  },
});
