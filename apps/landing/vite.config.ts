import { defineConfig } from 'vite';

export default defineConfig({
  // Relative-path build: assets resolve correctly under any URL prefix
  // (/polychrome/, /PolyChrome/, file://, etc.). Demo links use ./examples/X/
  // which also resolve relative to the page URL.
  base: './',
  /**
   * Pinned port so the dev-mode card-href rewrite in src/main.ts can
   * detect "running in landing dev" reliably and so `pnpm dev` always
   * lands the landing page at a known address.
   */
  server: {
    port: 5180,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
