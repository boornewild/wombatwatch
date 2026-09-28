import { defineConfig, devices } from '@playwright/test';

// Runs against `npm run dev` + local Supabase (`npx supabase start`), seeded by supabase/seed.sql.
// E2E_PORT lets a second checkout (e.g. a git worktree) run its own dev server instead of
// silently reusing another checkout's server on the default port.
const port = Number(process.env.E2E_PORT ?? 5173);
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  // The specs share one local Supabase and its seed records (offline.spec renames Seed Wombat),
  // so running spec files in parallel would let one observe another's temporary edits.
  workers: 1,
  use: { baseURL, trace: 'retain-on-failure' },
  projects: [{ name: 'mobile-chrome', use: { ...devices['Pixel 7'] } }],
  webServer: { command: `npm run dev -- --port ${port} --strictPort`, url: baseURL, reuseExistingServer: true },
});
