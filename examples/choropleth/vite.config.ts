import { defineConfig } from 'vite';

export default defineConfig({
  base: process.env['PC_PUBLISH_BASE'] ?? '/',
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
