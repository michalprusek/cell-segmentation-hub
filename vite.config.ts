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
    rollupOptions: {
      output: {
        assetFileNames: assetInfo => {
          // Keep fonts in fonts directory
          if (
            assetInfo.name &&
            assetInfo.name.match(/\.(woff|woff2|ttf|otf)$/)
          ) {
            return 'fonts/[name][extname]';
          }
          return 'assets/[name]-[hash][extname]';
        },
      },
    },
  },
  publicDir: 'public',
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
  },
});
