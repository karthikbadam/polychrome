import { defineConfig } from 'vite';

export default defineConfig({
  // Relative-path build ('./'): works under any URL prefix (e.g. /polychrome/,
  // /PolyChrome/, or even file://). Robust to repo renames and CDN routing.
  base: './',
  // Pinned port so the landing's dev-mode demo cards know where to send
  // the user. See apps/landing/src/main.ts.
  server: { port: 5182, strictPort: true },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
