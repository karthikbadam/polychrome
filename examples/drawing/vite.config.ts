import { defineConfig } from 'vite';

export default defineConfig({
  // Relative-path build ('./'): works under any URL prefix.
  base: './',
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
