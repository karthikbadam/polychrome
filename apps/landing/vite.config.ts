import { defineConfig } from 'vite';

const base = process.env.PC_PUBLISH_BASE ?? '/';

export default defineConfig({
  base,
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
