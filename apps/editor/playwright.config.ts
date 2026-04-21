import { defineConfig, devices } from '@playwright/test'

/**
 * HaloFire Studio editor — Playwright smoke tests.
 *
 * Boots the production `next start` on port 3002 and runs the UI
 * smoke suite against it. Matches the launch.json preview config so
 * Claude Code preview and Playwright share one server.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:3002',
    headless: true,
    ignoreHTTPSErrors: true,
    actionTimeout: 10_000,
    navigationTimeout: 20_000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    {
      name: 'halofire-schema',
      testDir: '../../packages/halofire-schema/tests',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'hf-core',
      testDir: '../../packages/hf-core/tests',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'bun run start -- -p 3002',
    url: 'http://localhost:3002',
    timeout: 60_000,
    reuseExistingServer: true,
    cwd: '.',
  },
})
