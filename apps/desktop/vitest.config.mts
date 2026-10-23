import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // e2e/*.spec.ts belong to Playwright.
    include: ['src/**/*.test.ts'],
  },
});
