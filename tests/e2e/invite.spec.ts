import { test, expect, type Page } from '@playwright/test';
import { execSync } from 'node:child_process';

// The invited-volunteer journeys behind bug #1: a volunteer who joins must see the squad's data
// straight away, not after the 5-minute background sync or a reload.
const BOB = '00000000-0000-0000-0000-00000000000b';
const resetBob = () =>
  execSync(`npx supabase db query --local "delete from squad_members where user_id='${BOB}'"`, { stdio: 'ignore' });

test.describe.configure({ mode: 'serial' });
test.beforeEach(resetBob);
test.afterAll(resetBob);

async function signIn(page: Page, email: string) {
  await page.getByPlaceholder('Email address').fill(email);
  await page.getByPlaceholder('Password').fill('password123');
  await page.locator('button[type=submit]').click();
}

async function expectSeedWombat(page: Page) {
  await page.getByRole('button', { name: 'Wombats' }).click();
  await expect(page.getByRole('button', { name: /Seed Wombat/ })).toBeVisible({ timeout: 10_000 });
}

test('invite link → sign in → the squad’s wombats are there, no refresh', async ({ page }) => {
  await page.goto('/?join=test-invite-token');
  await signIn(page, 'bob@test.local');
  await expectSeedWombat(page);
});

test('join from the setup screen → the squad’s wombats are there, no refresh', async ({ page }) => {
  await page.goto('/');
  await signIn(page, 'bob@test.local');
  await page.getByText('Join with invite link').click();
  await page.getByPlaceholder(/join=/).fill('test-invite-token');
  await page.getByRole('button', { name: 'Join Squad' }).click();
  await expectSeedWombat(page);
});

test('a volunteer already in a squad who opens an expired invite sees why it did nothing', async ({ page }) => {
  await page.goto('/?join=expired-invite-token');
  await signIn(page, 'alice@test.local');
  const banner = page.getByRole('status').filter({ hasText: /invite link has expired/ });
  await expect(banner).toBeVisible({ timeout: 10_000 });
  await banner.getByRole('button', { name: 'Dismiss' }).click();
  await expect(banner).toHaveCount(0);
});
