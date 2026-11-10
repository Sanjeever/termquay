import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config.ts';

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      projects: [
        {
          extends: true,
          test: { name: 'unit', environment: 'node', include: ['src/**/*.test.ts'] },
        },
        {
          extends: true,
          test: {
            name: 'components',
            environment: 'jsdom',
            include: ['src/**/*.test.tsx'],
            setupFiles: ['./src/test/setup.ts'],
          },
        },
      ],
    },
  }),
);
