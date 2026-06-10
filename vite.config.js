import { defineConfig } from 'vite';

// Vite is only used for the MV3 service worker bundle and .env injection.
export default defineConfig({
  test: {
    // Keep vitest out of .claude/ session worktrees — they duplicate the
    // whole suite and may carry their own (unrelated) test files.
    exclude: ['**/node_modules/**', '**/build/**', '.claude/**'],
  },
  build: {
    outDir: 'build',
    emptyOutDir: true,
    modulePreload: false,
    rollupOptions: {
      input: {
        background: 'src/background/main.js'
      },
      output: {
        entryFileNames: '[name]-entry.js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]'
      }
    }
  }
});
