import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // bcryptjs (ren JS) @12 rounds er tregt; flere hash/verify per test
    // kan overskride default 5s på lastede CI-maskiner.
    testTimeout: 20000,
  },
});
