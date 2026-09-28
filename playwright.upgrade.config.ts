import { defineConfig, devices } from '@playwright/test';

// Upgrade test: a phone running the old v6 service worker receives the new build.
// Run with `npm run test:upgrade` (builds production first). Needs local Supabase running.
export default defineConfig({
  testDir: './tests/upgrade',
  timeout: 90_000,
  use: { baseURL: 'http://localhost:4179', trace: 'retain-on-failure' },
  projects: [{ name: 'mobile-chrome', use: { ...devices['Pixel 7'] } }],
});
