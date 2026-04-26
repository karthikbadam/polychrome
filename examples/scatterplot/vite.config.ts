import { defineConfig } from 'vite';

export default defineConfig({
  // Relative-path build ('./'): works under any URL prefix (e.g. /polychrome/,
  // /PolyChrome/, or even file://). Robust to repo renames and CDN routing.
  base: './',
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
