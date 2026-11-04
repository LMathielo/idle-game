import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // require() of a PNG (the art registry) resolves to its path, like an asset id in the app.
    setupFiles: ['tests/setup/pngRequire.ts'],
  },
});
