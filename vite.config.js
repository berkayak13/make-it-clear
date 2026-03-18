import { defineConfig } from 'vite';

// We build only the offscreen entry; everything else stays as static extension files.
export default defineConfig({
  build: {
    outDir: 'build',
    emptyOutDir: false,
    rollupOptions: {
      input: {
        offscreen: 'src/offscreen-entry.js'
      },
      output: {
        entryFileNames: '[name]-entry.js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]'
      }
    }
  }
});
