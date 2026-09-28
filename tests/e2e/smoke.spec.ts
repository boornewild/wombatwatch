import { test, expect, type Page } from '@playwright/test';

/** Reads every record from one store of the app's IndexedDB (wombatwatch_v1). */
async function readStore(page: Page, store: string): Promise<Array<Record<string, unknown>>> {
  return page.evaluate(
    (name) =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open('wombatwatch_v1');
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(name)) return resolve([]);
          const all = db.transaction(name).objectStore(name).getAll();
          all.onsuccess = () => resolve(all.result);
          all.onerror = () => reject(all.error);
        };
      }),
    store,
  );
}

async function signIn(page: Page, email: string) {
  await page.getByPlaceholder('Email address').fill(email);
  await page.getByPlaceholder('Password').fill('password123');
  await page.locator('button[type=submit]').click();
}

test('app boots to the sign-in screen with no crash overlay', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByText('Sign in to continue')).toBeVisible();
  await expect(page.getByText(/WombatWatch (crash|unhandled rejection|render error)/)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('squad member signs in and their squad wombats sync to the device', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await signIn(page, 'alice@test.local');

  await expect
    .poll(async () => (await readStore(page, 'wombats')).map((w) => w.name), { timeout: 20_000 })
    .toContain('Seed Wombat');
  // RLS: a wombat with no squad must never reach any device.
  expect((await readStore(page, 'wombats')).map((w) => w.name)).not.toContain('Orphan Wombat');
  await expect(page.getByText(/WombatWatch (crash|unhandled rejection|render error)/)).toHaveCount(0);
  expect(errors).toEqual([]);
});
