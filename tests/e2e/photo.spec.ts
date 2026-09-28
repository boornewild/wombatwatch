import { test, expect } from '@playwright/test';
import { signInToken, rest } from './supabase';

test('a photo added online is uploaded to Storage and its URL saved on the row', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const token = await signInToken('alice@test.local');
  const before = ((await rest(token, 'wombat_photos?select=id&wombat_id=eq.wombat-seed-1')) as { id: string }[]).map((p) => p.id);

  await page.goto('/');
  await page.getByPlaceholder('Email address').fill('alice@test.local');
  await page.getByPlaceholder('Password').fill('password123');
  await page.locator('button[type=submit]').click();
  await page.getByRole('button', { name: 'Wombats' }).click();
  await page.getByRole('button', { name: /Seed Wombat/ }).click();
  await page.getByText('Photos', { exact: true }).first().click();

  // A real image, so the app's compression (canvas decode) works.
  const png = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    c.getContext('2d')!.fillRect(0, 0, 16, 16);
    return c.toDataURL('image/png').split(',')[1]!;
  });
  await page.locator('label:has-text("Add Photo") input[type=file]').setInputFiles({ name: 'w.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });

  let added: { id: string; data_url: string | null } | undefined;
  await expect
    .poll(
      async () => {
        const rows = (await rest(token, 'wombat_photos?select=id,data_url&wombat_id=eq.wombat-seed-1')) as { id: string; data_url: string | null }[];
        added = rows.find((r) => !before.includes(r.id));
        return added?.data_url ?? null;
      },
      { timeout: 20_000 },
    )
    .toMatch(/^http.*\/storage\/v1\/object\/public\/photos\/.+\.jpg$/);
  // The file really exists in Storage.
  expect((await fetch(added!.data_url!)).ok).toBe(true);
  expect(errors).toEqual([]);

  await rest(token, `wombat_photos?id=eq.${added!.id}`, { method: 'DELETE' });
});
