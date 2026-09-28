import { test, expect, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';

const HERE = import.meta.dirname;
const ROOT = path.resolve(HERE, '../..');
const SERVE = path.join(tmpdir(), 'wombatwatch-upgrade-site');
const APP = path.join(SERVE, 'wombatwatch'); // mirrors GitHub Pages: /wombatwatch/
const APP_URL = '/wombatwatch/';

let server: ChildProcess;

function deployOld() {
  rmSync(SERVE, { recursive: true, force: true });
  mkdirSync(APP, { recursive: true });
  cpSync(path.join(HERE, 'fixtures/legacy-index.html'), path.join(APP, 'index.html'));
  cpSync(path.join(HERE, 'fixtures/legacy-sw-v6.js'), path.join(APP, 'sw.js'));
}

function deployNew() {
  rmSync(APP, { recursive: true, force: true });
  cpSync(path.join(ROOT, 'dist'), APP, { recursive: true });
}

test.beforeAll(async () => {
  deployOld();
  server = spawn('python3', ['-m', 'http.server', '4179', '--directory', SERVE], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 1000));
});
test.afterAll(() => server?.kill());

const cacheNames = (page: Page) => page.evaluate(() => caches.keys());

test('old v6 install upgrades to the new build without losing queue or offline maps', async ({ page, context }) => {
  // 1. Phone on the old app: v6 worker active, a downloaded map tile, a queued offline write.
  await page.goto(APP_URL);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.evaluate(async () => {
    const tiles = await caches.open('wombatwatch-tiles-v6');
    await tiles.put('https://a.tile.openstreetmap.org/10/1/1.png', new Response('tile'));
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('wombatwatch_v1', 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const s of ['wombats', 'burrows', 'treatments', 'sightings', 'burrow_logs', 'wombat_photos', 'burrow_photos'])
          db.createObjectStore(s, { keyPath: 'id' });
        db.createObjectStore('queue', { keyPath: '_qid', autoIncrement: true });
        db.createObjectStore('meta', { keyPath: 'key' });
      };
      req.onsuccess = () => {
        const tx = req.result.transaction('queue', 'readwrite');
        tx.objectStore('queue').add({ t: 'upsert', table: 'treatments', row: { id: 'queued-before-upgrade' } });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });
  });
  expect(await cacheNames(page)).toContain('wombatwatch-shell-v6');
  await expect(page.getByText('legacy-app')).toBeVisible();

  // 2. Deploy the new build to the same URL. The volunteer opens the app again.
  deployNew();
  await page.reload();
  await expect
    .poll(() => cacheNames(page), { timeout: 30_000 })
    .not.toContain('wombatwatch-shell-v6');

  // 3. Next launch shows the new app, and nothing the volunteer had is gone.
  await page.reload();
  await expect(page.getByText('Sign in to continue')).toBeVisible({ timeout: 20_000 });
  const names = await cacheNames(page);
  expect(names).toContain('wombatwatch-tiles-v6');
  const tile = await page.evaluate(async () =>
    (await (await caches.open('wombatwatch-tiles-v6')).match('https://a.tile.openstreetmap.org/10/1/1.png'))?.text(),
  );
  expect(tile).toBe('tile');
  const queued = await page.evaluate(
    () =>
      new Promise<unknown[]>((resolve) => {
        const req = indexedDB.open('wombatwatch_v1');
        req.onsuccess = () => {
          const all = req.result.transaction('queue').objectStore('queue').getAll();
          all.onsuccess = () => resolve(all.result);
        };
      }),
  );
  expect(queued).toEqual([expect.objectContaining({ row: { id: 'queued-before-upgrade' } })]);

  // 4. Offline launch still opens the app from the precache.
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByText('Sign in to continue')).toBeVisible({ timeout: 20_000 });
  await context.setOffline(false);
});
