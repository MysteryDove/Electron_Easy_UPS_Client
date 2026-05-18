import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    environment: 'node',
    setupFiles: ['src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      thresholds: {
        'src/shared/upsStatus/statusModel.ts': {
          lines: 90,
          branches: 90,
        },
        'src/renderer/components/UpsStatusBanner.tsx': {
          lines: 90,
          branches: 90,
        },
      },
    },
  },
});
