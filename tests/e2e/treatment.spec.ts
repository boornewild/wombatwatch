import { test, expect } from '@playwright/test';
import { signInToken, rest } from './supabase';

test('volunteer logs a treatment and it reaches Supabase', async ({ page }) => {
  const note = `e2e treatment ${Date.now()}`;
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/');
  await page.getByPlaceholder('Email address').fill('alice@test.local');
  await page.getByPlaceholder('Password').fill('password123');
  await page.locator('button[type=submit]').click();

  await page.getByRole('button', { name: 'Wombats' }).click();
  await page.getByRole('button', { name: /Seed Wombat/ }).click();
  await page.getByRole('button', { name: 'Add Treatment' }).click();
  await page.getByPlaceholder('e.g. 5').fill('2'); // dose is required
  await page.getByPlaceholder('Observations, any changes noticed…').fill(note);
  await page.getByRole('button', { name: 'Save', exact: true }).click();

  const token = await signInToken('alice@test.local');
  await expect
    .poll(async () => (await rest(token, `treatments?select=note,wombat_id,created_by,product,dose&note=eq.${encodeURIComponent(note)}`)) as unknown[], {
      timeout: 20_000,
    })
    .toEqual([{ note, wombat_id: 'wombat-seed-1', created_by: '00000000-0000-0000-0000-00000000000a', product: 'cydectin', dose: expect.stringContaining('2') }]);
  expect(errors).toEqual([]);

  await rest(token, `treatments?note=eq.${encodeURIComponent(note)}`, { method: 'DELETE' });
});
