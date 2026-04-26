import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Root config used when vitest is run from the monorepo root directly.
    // Turborepo dispatches to each package's own vitest.config.ts via `pnpm test`.
    include: [],
  },
});
