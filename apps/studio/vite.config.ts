/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig, type UserConfig } from 'vite';

// `test` is contributed by the vitest/config type augmentation referenced above.
const config: UserConfig & { test?: Record<string, unknown> } = {
  plugins: [react()],
  server: { port: 3220, host: true, strictPort: true },
  preview: { port: 3220, host: true, strictPort: true },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
};

export default defineConfig(config);
