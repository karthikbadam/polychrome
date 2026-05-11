import { resolve } from 'node:path';

import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'es2022',
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'PolyChrome',
      // ESM build
      formats: ['es', 'iife'],
      fileName: (format) => {
        if (format === 'iife') return 'polychrome.iife.js';
        return 'sdk.js';
      },
    },
    rollupOptions: {
      // Keep @polychrome/protocol external for ESM (bundled for IIFE)
      external: (id: string) => {
        if (id === '@polychrome/protocol') return true;
        return false;
      },
      output: {
        // For IIFE, inline dependencies so it's truly standalone
        globals: {
          '@polychrome/protocol': 'PolyChromeProcotol',
        },
      },
    },
    minify: false,
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
  },
});
