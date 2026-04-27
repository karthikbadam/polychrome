import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    passWithNoTests: true,
    // Default is node; tests that need DOM opt in via the
    // `// @vitest-environment jsdom` docblock at the top of the file
    // (see src/main-world/__tests__/cursors.test.ts).
  },
});
