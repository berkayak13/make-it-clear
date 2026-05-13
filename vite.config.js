import { defineConfig } from 'vite';

// Vite is only used for the MV3 service worker bundle and .env injection.
export default defineConfig({
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
