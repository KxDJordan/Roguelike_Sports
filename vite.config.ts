/// <reference types="vitest" />
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  test: {
    testTimeout: 180000,
  },
});
