import { test, expect, type Page, type Locator } from '@playwright/test';
import { signInToken, rest } from './supabase';

/**
 * Offline safety net for the Phase 3 sync refactor: edits made with no network must land in the
 * IndexedDB queue and reach Supabase once the device reconnects. Written against the legacy
 * engine first so every later sync change is checked against the same behaviour.
 */

const ALICE = 'alice@test.local';
const SEED_WOMBAT_ID = 'wombat-seed-1';
const SEED_WOMBAT_NAME = 'Seed Wombat';

type Row = Record<string, unknown>;

/** Reads every record from one store of the app's IndexedDB (wombatwatch_v1). */
async function readStore(page: Page, store: string): Promise<Row[]> {
  return page.evaluate(
    (name) =>
      new Promise<Row[]>((resolve, reject) => {
        const req = indexedDB.open('wombatwatch_v1');
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(name)) return resolve([]);
          const all = db.transaction(name).objectStore(name).getAll();
          all.onsuccess = () => resolve(all.result as Row[]);
          all.onerror = () => reject(all.error);
        };
      }),
    store,
  );
}

/**
 * Signs in and waits until the first full sync has stored Seed Wombat locally, so going
 * offline afterwards cannot race the initial download.
 */
async function signInAndSync(page: Page) {
  await page.goto('/');
  await page.getByPlaceholder('Email address').fill(ALICE);
  await page.getByPlaceholder('Password').fill('password123');
  await page.locator('button[type=submit]').click();
  await expect
    .poll(async () => (await readStore(page, 'wombats')).map((w) => w.id), { timeout: 20_000 })
    .toContain(SEED_WOMBAT_ID);
}

/**
 * Swipes a list tile left with real touch events. The Edit/Delete buttons sit off-screen in
 * SwipeActions until the tile is dragged, so a plain click cannot reach them.
 */
async function swipeLeft(page: Page, tile: Locator) {
  const box = await tile.boundingBox();
  if (!box) throw new Error('tile is not visible');
  const y = box.y + box.height / 2;
  const startX = box.x + box.width - 20;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: startX, y }] });
  for (let dx = 20; dx <= 200; dx += 20) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: startX - dx, y }] });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

function trackPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

test('a treatment logged offline is queued, then uploaded on reconnect', async ({ page, context }) => {
  const note = `e2e offline treatment ${Date.now()}`;
  const errors = trackPageErrors(page);
  const token = await signInToken(ALICE);
  const treatmentsWithNote = () =>
    rest(token, `treatments?select=note,wombat_id,created_by,dose&note=eq.${encodeURIComponent(note)}`) as Promise<Row[]>;

  try {
    await signInAndSync(page);
    await context.setOffline(true);

    await page.getByRole('button', { name: 'Wombats' }).click();
    await page.getByRole('button', { name: /Seed Wombat/ }).click();
    await page.getByRole('button', { name: 'Add Treatment' }).click();
    await page.getByPlaceholder('e.g. 5').fill('2'); // dose is required
    await page.getByPlaceholder('Observations, any changes noticed…').fill(note);
    await page.getByRole('button', { name: 'Save', exact: true }).click();

    const queuedForNote = async () =>
      (await readStore(page, 'queue')).filter(
        (op) => op.t === 'upsert' && op.table === 'treatments' && (op.row as Row | undefined)?.note === note,
      );
    await expect.poll(async () => (await queuedForNote()).length, { timeout: 10_000 }).toBe(1);
    expect(await treatmentsWithNote()).toEqual([]); // nothing left the device while offline

    await context.setOffline(false);

    await expect
      .poll(treatmentsWithNote, { timeout: 30_000 })
      .toEqual([{ note, wombat_id: SEED_WOMBAT_ID, created_by: '00000000-0000-0000-0000-00000000000a', dose: expect.stringContaining('2') }]);
    await expect.poll(async () => (await readStore(page, 'queue')).length, { timeout: 20_000 }).toBe(0);
    expect(errors).toEqual([]);
  } finally {
    await rest(token, `treatments?note=eq.${encodeURIComponent(note)}`, { method: 'DELETE' });
  }
});

test('a wombat renamed offline reaches Supabase on reconnect', async ({ page, context }) => {
  const newName = `Renamed ${Date.now()}`;
  const errors = trackPageErrors(page);
  const token = await signInToken(ALICE);
  const seedRow = async () => ((await rest(token, `wombats?select=*&id=eq.${SEED_WOMBAT_ID}`)) as Row[])[0];
  // The edit form saves every field, so snapshot the whole row to restore it afterwards.
  const original = Object.fromEntries(
    Object.entries((await seedRow())!).filter(([k]) => !['id', 'created_at', 'updated_at'].includes(k)),
  );

  try {
    await signInAndSync(page);
    await context.setOffline(true);

    await page.getByRole('button', { name: 'Wombats' }).click();
    await swipeLeft(page, page.getByRole('button', { name: /Seed Wombat/ }));
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.getByPlaceholder('e.g. Walter').fill(newName);
    await page.getByRole('button', { name: 'Save Changes' }).click();

    await expect
      .poll(async () =>
        (await readStore(page, 'queue')).some(
          (op) => op.t === 'upsert' && op.table === 'wombats' && (op.row as Row | undefined)?.name === newName,
        ),
      )
      .toBe(true);
    expect((await seedRow())?.name).not.toBe(newName); // nothing left the device while offline

    await context.setOffline(false);

    await expect.poll(async () => (await seedRow())?.name, { timeout: 30_000 }).toBe(newName);
    await expect.poll(async () => (await readStore(page, 'queue')).length, { timeout: 20_000 }).toBe(0);
    expect(errors).toEqual([]);
  } finally {
    await rest(token, `wombats?id=eq.${SEED_WOMBAT_ID}`, {
      method: 'PATCH',
      body: JSON.stringify({ ...original, name: SEED_WOMBAT_NAME }),
    });
  }
});
