import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  // Pinned port so the landing's dev-mode demo cards know where to send
  // the user. See apps/landing/src/main.ts.
  server: { port: 5184, strictPort: true },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
