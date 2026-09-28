import { APP_DB_NAME, STORE_NAMES, appDb, createAppDb, type QueueOp } from './appDb';

let n = 0;
/** A fresh database per test, so tests never share state. */
const freshDb = () => createAppDb({ name: `appdb-test-${n++}` });

const memoryStorage = (data: Record<string, string>) => ({ getItem: (k: string) => data[k] ?? null });

it('keeps the legacy database name and store names', () => {
  expect(APP_DB_NAME).toBe('wombatwatch_v1');
  expect(STORE_NAMES).toEqual({
    w: 'wombats',
    b: 'burrows',
    t: 'treatments',
    s: 'sightings',
    bl: 'burrow_logs',
    wp: 'wombat_photos',
    bp: 'burrow_photos',
  });
  expect(appDb).toBeDefined();
});

it.each(Object.values(STORE_NAMES))('round-trips records in %s', async (store) => {
  const db = freshDb();
  const records = [
    { id: 'a', name: 'One', _sync: false },
    { id: 'b', name: 'Two', nested: { x: [1, 2] } },
  ];
  await db.saveAll(store, records);
  expect(await db.getAll(store)).toEqual(records);
  expect(await db.getOne(store, 'b')).toEqual(records[1]);
  expect(await db.getOne(store, 'missing')).toBeNull();
});

it('saveAll replaces the store contents', async () => {
  const db = freshDb();
  await db.saveAll('wombats', [{ id: 'a' }, { id: 'b' }]);
  await db.saveAll('wombats', [{ id: 'c' }]);
  expect(await db.getAll('wombats')).toEqual([{ id: 'c' }]);
  await db.saveAll('wombats', []);
  expect(await db.getAll('wombats')).toEqual([]);
});

it('markSynced sets _sync:true and _pushedAt, keeping other fields', async () => {
  const db = freshDb();
  await db.saveAll('treatments', [{ id: 't1', dose: 2, _sync: false }]);
  await db.markSynced('treatments', 't1', () => 1234);
  expect(await db.getOne('treatments', 't1')).toEqual({ id: 't1', dose: 2, _sync: true, _pushedAt: 1234 });
});

it('markSynced defaults to Date.now and ignores missing records and bad stores', async () => {
  const db = freshDb();
  vi.spyOn(Date, 'now').mockReturnValue(99);
  await db.saveAll('burrows', [{ id: 'b1' }]);
  await db.markSynced('burrows', 'b1');
  expect(await db.getOne('burrows', 'b1')).toEqual({ id: 'b1', _sync: true, _pushedAt: 99 });
  await expect(db.markSynced('burrows', 'nope')).resolves.toBeUndefined();
  await expect(db.markSynced('not_a_store', 'b1')).resolves.toBeUndefined();
  expect(await db.getAll('burrows')).toHaveLength(1);
  vi.restoreAllMocks();
});

it('the queue auto-assigns _qid and defaults _retries to 0', async () => {
  const db = freshDb();
  await db.enqueue({ t: 'upsert', table: 'wombats', row: { id: 'w1' } });
  await db.enqueue({ t: 'delete', table: 'burrows', id: 'b1', _retries: 3 });
  await db.enqueue({ t: 'storage-delete', path: 'x/y.jpg' });
  const q = await db.getQueue();
  expect(q).toEqual([
    { t: 'upsert', table: 'wombats', row: { id: 'w1' }, _qid: 1, _retries: 0 },
    { t: 'delete', table: 'burrows', id: 'b1', _qid: 2, _retries: 3 },
    { t: 'storage-delete', path: 'x/y.jpg', _qid: 3, _retries: 0 },
  ]);
});

it('updateQueueOp rewrites in place and dequeue removes by _qid', async () => {
  const db = freshDb();
  await db.enqueue({ t: 'upsert', table: 'wombats', row: { id: 'w1' } });
  await db.enqueue({ t: 'upsert', table: 'wombats', row: { id: 'w2' } });
  const [first] = await db.getQueue();
  await db.updateQueueOp({ ...(first as QueueOp), _retries: 2 });
  await db.dequeue(2);
  expect(await db.getQueue()).toEqual([
    { t: 'upsert', table: 'wombats', row: { id: 'w1' }, _qid: 1, _retries: 2 },
  ]);
});

it('Characterisation: enqueue keeps a supplied _qid and rejects when that _qid already exists', async () => {
  const db = freshDb();
  await db.enqueue({ t: 'upsert', table: 'wombats', row: { id: 'w1' } });
  const op = { t: 'upsert', table: 'wombats', row: { id: 'w1' }, _qid: 1 } as const;
  await expect(db.enqueue(op)).rejects.toMatchObject({ name: 'ConstraintError' });
});

it('Characterisation: getAll rejects (not []) when the store does not exist; only a failed open gives []', async () => {
  const db = freshDb();
  await expect(db.getAll('not_a_store')).rejects.toMatchObject({ name: 'NotFoundError' });
  const broken = createAppDb({ idb: { open: () => { throw new Error('no idb'); } } as unknown as IDBFactory });
  expect(await broken.getAll('wombats')).toEqual([]);
  expect(await broken.getOne('wombats', 'a')).toBeNull();
  expect(await broken.metaGet('migrated')).toBeNull();
  expect(await broken.dataQueueCount()).toBe(0);
  await expect(broken.saveAll('wombats', [])).resolves.toBeUndefined();
  await expect(broken.dequeue(1)).resolves.toBeUndefined();
  await expect(broken.enqueue({ t: 'storage-delete', path: 'p' })).rejects.toThrow('no idb');
});

it('dataQueueCount excludes photo tables and storage-delete ops', async () => {
  const db = freshDb();
  for (const table of ['wombats', 'burrows', 'treatments', 'burrow_logs', 'sightings'])
    await db.enqueue({ t: 'upsert', table, row: { id: table } });
  await db.enqueue({ t: 'delete', table: 'wombats', id: 'w9' });
  await db.enqueue({ t: 'upsert', table: 'wombat_photos', row: { id: 'p1' } });
  await db.enqueue({ t: 'upsert', table: 'burrow_photos', row: { id: 'p2' } });
  await db.enqueue({ t: 'storage-delete', path: 'wombat/p1.jpg' });
  expect(await db.dataQueueCount()).toBe(6);
});

it('meta round-trips and reads missing or nullish values as null', async () => {
  const db = freshDb();
  expect(await db.metaGet('missing')).toBeNull();
  await db.metaSet('recently_deleted', [{ id: 'a', ts: 1 }]);
  expect(await db.metaGet('recently_deleted')).toEqual([{ id: 'a', ts: 1 }]);
  await db.metaSet('flag', false);
  expect(await db.metaGet('flag')).toBe(false);
  await db.metaSet('flag', undefined);
  expect(await db.metaGet('flag')).toBeNull();
});

describe('migrateFromLocalStorage', () => {
  const legacyStorage = () =>
    memoryStorage({
      ww2_wombats: JSON.stringify([{ id: 'w1', name: 'Seed' }]),
      ww2_burrows: JSON.stringify([{ id: 'b1' }]),
      ww2_treatments: JSON.stringify([{ id: 't1' }]),
      ww2_sightings: JSON.stringify([{ id: 's1' }]),
      ww2_burrow_logs: JSON.stringify([{ id: 'l1' }]),
      ww2_wombat_photos: JSON.stringify([{ id: 'wp1' }]),
      ww2_burrow_photos: JSON.stringify([{ id: 'bp1' }]),
      ww_sync_queue: JSON.stringify([
        { t: 'upsert', table: 'wombats', row: { id: 'w1' } },
        { t: 'delete', table: 'burrows', id: 'b2', _retries: 2 },
      ]),
      ww_sync_deleted: JSON.stringify({ b2: 111, w3: 222 }),
    });

  it('copies ww2_* collections, the sync queue and the recently-deleted cache', async () => {
    const db = freshDb();
    await db.migrateFromLocalStorage(legacyStorage());
    expect(await db.getAll('wombats')).toEqual([{ id: 'w1', name: 'Seed' }]);
    for (const [store, id] of [
      ['burrows', 'b1'],
      ['treatments', 't1'],
      ['sightings', 's1'],
      ['burrow_logs', 'l1'],
      ['wombat_photos', 'wp1'],
      ['burrow_photos', 'bp1'],
    ] as const)
      expect(await db.getAll(store)).toEqual([{ id }]);
    expect(await db.getQueue()).toEqual([
      { t: 'upsert', table: 'wombats', row: { id: 'w1' }, _qid: 1, _retries: 0 },
      { t: 'delete', table: 'burrows', id: 'b2', _qid: 2, _retries: 2 },
    ]);
    expect(await db.metaGet('recently_deleted')).toEqual([
      { id: 'b2', ts: 111 },
      { id: 'w3', ts: 222 },
    ]);
    expect(await db.metaGet('migrated')).toBe(true);
  });

  it('runs only once', async () => {
    const db = freshDb();
    await db.migrateFromLocalStorage(legacyStorage());
    await db.saveAll('wombats', [{ id: 'changed' }]);
    await db.migrateFromLocalStorage(legacyStorage());
    expect(await db.getAll('wombats')).toEqual([{ id: 'changed' }]);
    expect(await db.getQueue()).toHaveLength(2);
  });

  it('Characterisation: a corrupt key is skipped and the migration is still marked done', async () => {
    const db = freshDb();
    await db.migrateFromLocalStorage(
      memoryStorage({ ww2_wombats: '{not json', ww2_burrows: JSON.stringify([{ id: 'b1' }]) }),
    );
    expect(await db.getAll('wombats')).toEqual([]);
    expect(await db.getAll('burrows')).toEqual([{ id: 'b1' }]);
    expect(await db.metaGet('migrated')).toBe(true);
  });
});

describe('read-compat with a database created by the legacy app', () => {
  /** Verbatim upgrade logic from legacy openAppDb, so this proves on-disk compatibility, not self-consistency. */
  const LEGACY_STORE = STORE_NAMES;
  const openLegacy = (name: string) =>
    new Promise<IDBDatabase>((res, rej) => {
      const req = indexedDB.open(name, 1);
      req.onupgradeneeded = (e) => {
        const db = (e.target as IDBOpenDBRequest).result;
        Object.values(LEGACY_STORE).forEach((s) => {
          if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' });
        });
        if (!db.objectStoreNames.contains('queue'))
          db.createObjectStore('queue', { keyPath: '_qid', autoIncrement: true });
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
      };
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });

  it('reads legacy records, queue ops and meta', async () => {
    const name = `legacy-created-${n++}`;
    const legacy = await openLegacy(name);
    const wombat = { id: 'w1', name: 'Seed Wombat', _sync: false, _createdBy: 'alice' };
    const photo = { id: 'wp1', wombatId: 'w1', dataUrl: null, _sync: true, _pushedAt: 5 };
    const ops = [
      { t: 'upsert', table: 'treatments', row: { id: 't1', wombat_id: 'w1', dose: '2' }, _retries: 0 },
      { t: 'delete', table: 'burrows', id: 'b1', _retries: 4 },
      { t: 'storage-delete', path: 'wombat/wp1.jpg', _retries: 0 },
      { t: 'upsert', table: 'wombat_photos', row: { id: 'wp2' }, _retries: 1 },
    ];
    await new Promise((res, rej) => {
      const tx = legacy.transaction(['wombats', 'wombat_photos', 'queue', 'meta'], 'readwrite');
      tx.objectStore('wombats').put(wombat);
      tx.objectStore('wombat_photos').put(photo);
      ops.forEach((op) => tx.objectStore('queue').add(op));
      tx.objectStore('meta').put({ key: 'migrated', value: true });
      tx.objectStore('meta').put({ key: 'recently_deleted', value: [{ id: 'b1', ts: 7 }] });
      tx.oncomplete = res;
      tx.onerror = () => rej(tx.error);
    });
    legacy.close();

    const db = createAppDb({ name });
    expect(await db.getAll('wombats')).toEqual([wombat]);
    expect(await db.getOne('wombat_photos', 'wp1')).toEqual(photo);
    expect(await db.getQueue()).toEqual(ops.map((op, i) => ({ ...op, _qid: i + 1 })));
    expect(await db.dataQueueCount()).toBe(2);
    expect(await db.metaGet('recently_deleted')).toEqual([{ id: 'b1', ts: 7 }]);

    // Already migrated in the legacy app: the new code must not re-import localStorage.
    await db.migrateFromLocalStorage(memoryStorage({ ww2_wombats: JSON.stringify([{ id: 'old' }]) }));
    expect(await db.getAll('wombats')).toEqual([wombat]);

    // New ops continue the legacy autoIncrement sequence.
    await db.enqueue({ t: 'upsert', table: 'wombats', row: { id: 'w1' } });
    expect((await db.getQueue()).at(-1)?._qid).toBe(5);
  });
});
