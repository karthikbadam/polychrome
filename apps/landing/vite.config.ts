import { defineConfig } from 'vite';

export default defineConfig({
  // Relative-path build: assets resolve correctly under any URL prefix
  // (/polychrome/, /PolyChrome/, file://, etc.). Demo links use ./examples/X/
  // which also resolve relative to the page URL.
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
