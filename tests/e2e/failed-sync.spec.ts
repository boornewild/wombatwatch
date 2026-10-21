import { test, expect, type Page } from '@playwright/test';
import { execSync } from 'node:child_process';
import { signInToken, rest } from './supabase';

/** Puts an op straight into the app's offline queue, as the flush would have left it. */
async function enqueue(page: Page, op: Record<string, unknown>) {
  await page.evaluate(
    (o) =>
      new Promise<void>((resolve, reject) => {
        const req = indexedDB.open('wombatwatch_v1');
        req.onsuccess = () => {
          const tx = req.result.transaction('queue', 'readwrite');
          tx.objectStore('queue').add(o);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        };
        req.onerror = () => reject(req.error);
      }),
    op,
  );
}

async function signIn(page: Page, email: string) {
  await page.getByPlaceholder('Email address').fill(email);
  await page.getByPlaceholder('Password').fill('password123');
  await page.locator('button[type=submit]').click();
}

test('a write the server keeps refusing is parked, shown, and can be discarded', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await signIn(page, 'alice@test.local');
  await expect(page.getByText('All synced')).toBeVisible();
  // A wombat in a squad Alice isn't in: RLS refuses it every time. One try left before parking.
  await enqueue(page, {
    t: 'upsert',
    table: 'wombats',
    row: {
      id: `e2e-forbidden-${Date.now()}`,
      name: 'Forbidden',
      squad_id: '99999999-9999-9999-9999-999999999999',
    },
    _retries: 4,
  });
  await context.setOffline(true);
  await context.setOffline(false); // reconnect triggers a flush

  const chip = page.getByRole('button', { name: /1 couldn't sync/ });
  await expect(chip).toBeVisible({ timeout: 20_000 });
  await chip.click();
  await expect(page.getByText('Wombat · Forbidden')).toBeVisible();
  await expect(page.getByText(/row-level security/)).toBeVisible();

  await page.getByRole('button', { name: 'Discard' }).click();
  await page.getByRole('button', { name: 'Discard' }).last().click(); // confirm
  await expect(chip).toHaveCount(0, { timeout: 10_000 });
});

/** Removes Bob from every squad straight in the local DB, so each test starts with him in no squad. */
const resetBob = () =>
  execSync(
    `npx supabase db query --local "delete from squad_members where user_id='00000000-0000-0000-0000-00000000000b'"`,
    { stdio: 'ignore' },
  );

test.describe('invited volunteer', () => {
  test.beforeEach(resetBob);
  test.afterEach(resetBob);

  test('joining a squad retries a parked write and uploads it (the invited-volunteer case)', async ({
    page,
  }) => {
    const note = `e2e parked ${Date.now()}`;
    const bob = '00000000-0000-0000-0000-00000000000b';
    await page.goto('/');
    await signIn(page, 'bob@test.local');
    await expect(page.getByText('Join or create your monitoring squad')).toBeVisible();
    // Bob logged a treatment before he was in a squad; the server refused it 5 times and it was parked.
    await enqueue(page, {
      t: 'upsert',
      table: 'treatments',
      row: { id: `e2e-t-${Date.now()}`, wombat_id: 'wombat-seed-1', at: '2026-10-05', note, created_by: bob },
      _retries: 5,
      _failed: true,
      _error: 'new row violates row-level security policy (42501)',
      _failedAt: 1,
    });

    await page.getByText('Join with invite link').click();
    await page.getByPlaceholder(/join=/).fill('test-invite-token');
    await page.getByRole('button', { name: 'Join Squad' }).click();

    const token = await signInToken('bob@test.local');
    await expect
      .poll(
        async () =>
          ((await rest(token, `treatments?select=note&note=eq.${encodeURIComponent(note)}`)) as unknown[])
            .length,
        { timeout: 20_000 },
      )
      .toBe(1);

    const alice = await signInToken('alice@test.local');
    await rest(alice, `treatments?note=eq.${encodeURIComponent(note)}`, { method: 'DELETE' });
  });
});
