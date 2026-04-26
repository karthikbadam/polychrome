import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.json';

export default defineConfig({
  plugins: [
    crx({ manifest }),
  ],
  build: {
    // Chrome MV3 minimum target
    target: 'chrome110',
    minify: false,
    sourcemap: true,
  },
});
