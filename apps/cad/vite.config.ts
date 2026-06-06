/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig, type UserConfig } from 'vite';

// `test` is contributed by the vitest/config type augmentation referenced above.
const config: UserConfig & { test?: Record<string, unknown> } = {
  plugins: [react()],
  server: { port: 3230, host: true, strictPort: true },
  preview: { port: 3230, host: true, strictPort: true },
  // NOTE on konva: `vite build` applies konva's `browser` field automatically,
  // so the production bundle uses konva's DOM build (no native `canvas`). The
  // App render smoke test stubs react-konva (jsdom never mounts the Stage), so
  // no test-side konva alias is needed.
  test: {
    // jsdom: the App render smoke test needs a DOM; pure-logic tests run fine in it too.
    environment: 'jsdom',
    globals: true,
    include: ['test/**/*.test.{ts,tsx}'],
  },
};

export default defineConfig(config);
