import { createAppDb, type NewQueueOp } from './idb/appDb';
import { flushQueue, MAX_RETRIES, type FlushDeps } from './flush';
import { getRecentlyDeleted } from './recentlyDeleted';
import type { WriteResult } from './remote';

let dbCount = 0;
type Script = Record<string, WriteResult | (() => never)>;

/** Fake remote: answers per "upsert:table:id" / "delete:table:id" / "storage:path" key; default ok. */
function setup(opts: { script?: Script; online?: boolean; localPhotos?: Record<string, string> } = {}) {
  const appDb = createAppDb({ name: `flush-test-${++dbCount}` });
  const calls: string[] = [];
  const answer = (key: string): WriteResult => {
    calls.push(key);
    const a = opts.script?.[key];
    if (typeof a === 'function') a();
    return (a as WriteResult) ?? { ok: true };
  };
  const notify = vi.fn();
  const resolvePhotoUrl = vi.fn(async (_d: string, id: string) => `https://cdn/${id}.jpg`);
  const deps: FlushDeps = {
    appDb,
    remote: {
      upsert: async (table, row) => answer(`upsert:${table}:${(row as { id: string }).id}`),
      remove: async (table, id) => answer(`delete:${table}:${id}`),
      removeStorage: async (path) => answer(`storage:${path}`),
    },
    getLocalPhoto: async (id) => opts.localPhotos?.[id] ?? null,
    resolvePhotoUrl,
    isOnline: () => opts.online ?? true,
    notify,
  };
  const enqueue = (...ops: NewQueueOp[]) => Promise.all(ops.map((op) => appDb.enqueue(op)));
  return { appDb, deps, calls, notify, resolvePhotoUrl, enqueue };
}

const upsert = (table: string, id: string, extra: Record<string, unknown> = {}): NewQueueOp => ({ t: 'upsert', table, row: { id, ...extra } });
const netErr: WriteResult = { ok: false, error: 'TypeError: Failed to fetch' };
const authErr: WriteResult = { ok: false, error: 'JWT expired (PGRST301)' };
const rlsErr: WriteResult = { ok: false, error: 'new row violates row-level security policy (42501)' };

it('does nothing offline', async () => {
  const s = setup({ online: false });
  await s.enqueue(upsert('wombats', 'w1'));
  expect(await flushQueue('u1', s.deps)).toEqual({ uploadedPhotoIds: new Set(), lostPhotoIds: new Set() });
  expect(s.calls).toEqual([]);
  expect(await s.appDb.getQueue()).toHaveLength(1);
});

it('replays parents before children before photos before storage deletes, keeping queue order within a level', async () => {
  const s = setup({ localPhotos: {} });
  await s.enqueue(
    { t: 'storage-delete', path: 'p9.jpg' },
    upsert('wombat_photos', 'p1', { data_url: 'https://x' }),
    upsert('treatments', 't1'),
    upsert('wombats', 'w1'),
    { t: 'delete', table: 'sightings', id: 's1' },
    upsert('burrows', 'b1'),
  );
  await flushQueue('u1', s.deps);
  expect(s.calls).toEqual(['upsert:wombats:w1', 'upsert:burrows:b1', 'upsert:treatments:t1', 'delete:sightings:s1', 'upsert:wombat_photos:p1', 'storage:p9.jpg']);
  expect(await s.appDb.getQueue()).toEqual([]);
});

it('success marks the local record synced, fills created_by, and records completed deletes', async () => {
  const s = setup();
  await s.appDb.saveAll('wombats', [{ id: 'w1', _sync: false }]);
  const upserts: unknown[] = [];
  const base = s.deps.remote.upsert;
  s.deps.remote.upsert = async (t, row) => (upserts.push(row), base(t, row));
  await s.enqueue(upsert('wombats', 'w1'), { t: 'delete', table: 'treatments', id: 't1' });
  await flushQueue('u1', s.deps);
  expect(upserts).toEqual([{ id: 'w1', created_by: 'u1' }]);
  expect(await s.appDb.getOne('wombats', 'w1')).toMatchObject({ _sync: true, _pushedAt: expect.any(Number) });
  expect(await getRecentlyDeleted(s.appDb)).toEqual(new Set(['t1']));
});

it('keeps an existing created_by', async () => {
  const s = setup();
  const seen: unknown[] = [];
  s.deps.remote.upsert = async (_t, row) => (seen.push(row), { ok: true });
  await s.enqueue(upsert('wombats', 'w1', { created_by: 'someone' }));
  await flushQueue('u1', s.deps);
  expect(seen).toEqual([{ id: 'w1', created_by: 'someone' }]);
});

it('a network error stops the flush without charging retries', async () => {
  const s = setup({ script: { 'upsert:wombats:w1': netErr } });
  await s.enqueue(upsert('wombats', 'w1'), upsert('treatments', 't1'));
  await flushQueue('u1', s.deps);
  expect(s.calls).toEqual(['upsert:wombats:w1']);
  expect((await s.appDb.getQueue()).map((o) => o._retries)).toEqual([0, 0]);
});

it('going offline mid-flush counts as a network error', async () => {
  let online = true;
  const s = setup({ script: { 'upsert:wombats:w1': rlsErr } });
  s.deps.isOnline = () => online;
  const base = s.deps.remote.upsert;
  s.deps.remote.upsert = async (t, r) => ((online = false), base(t, r));
  await s.enqueue(upsert('wombats', 'w1'));
  await flushQueue('u1', s.deps);
  expect((await s.appDb.getQueue())[0]!._retries).toBe(0);
});

it('an op that throws counts as a network error', async () => {
  const s = setup({ script: { 'storage:a.jpg': () => { throw new Error('boom'); } } });
  await s.enqueue({ t: 'storage-delete', path: 'a.jpg' }, { t: 'storage-delete', path: 'b.jpg' });
  await flushQueue('u1', s.deps);
  expect(s.calls).toEqual(['storage:a.jpg']);
  expect((await s.appDb.getQueue()).map((o) => o._retries)).toEqual([0, 0]);
});

it('an auth error stops the flush without charging retries', async () => {
  const s = setup({ script: { 'upsert:wombats:w1': authErr } });
  await s.enqueue(upsert('wombats', 'w1'), upsert('treatments', 't1'));
  await flushQueue('u1', s.deps);
  expect(s.calls).toEqual(['upsert:wombats:w1']);
  expect((await s.appDb.getQueue()).map((o) => o._retries)).toEqual([0, 0]);
});

it('a genuine error charges one retry and carries on with the next op', async () => {
  const s = setup({ script: { 'upsert:wombats:w1': rlsErr } });
  await s.enqueue(upsert('wombats', 'w1'), upsert('treatments', 't1'));
  await flushQueue('u1', s.deps);
  expect(s.calls).toEqual(['upsert:wombats:w1', 'upsert:treatments:t1']);
  expect(await s.appDb.getQueue()).toEqual([expect.objectContaining({ row: { id: 'w1' }, _retries: 1 })]);
});

describe('records the database keeps rejecting (bug #2)', () => {
  it(`are parked on the ${MAX_RETRIES}th genuine failure: kept on the device with the error, never deleted`, async () => {
    const s = setup({ script: { 'upsert:wombats:w1': rlsErr } });
    await s.appDb.enqueue({ ...upsert('wombats', 'w1'), _retries: MAX_RETRIES - 1 });
    await flushQueue('u1', s.deps);
    expect(await s.appDb.getQueue()).toEqual([
      expect.objectContaining({ row: { id: 'w1' }, _retries: MAX_RETRIES, _failed: true, _error: 'new row violates row-level security policy (42501)', _failedAt: expect.any(Number) }),
    ]);
    expect(s.notify).not.toHaveBeenCalled();
  });

  it('parked ops are skipped by later flushes and do not block the rest of the queue', async () => {
    const s = setup();
    await s.appDb.enqueue({ ...upsert('wombats', 'w1'), _retries: MAX_RETRIES, _failed: true } as never);
    await s.enqueue(upsert('treatments', 't1'));
    await flushQueue('u1', s.deps);
    expect(s.calls).toEqual(['upsert:treatments:t1']);
    expect(await s.appDb.getQueue()).toEqual([expect.objectContaining({ row: { id: 'w1' }, _failed: true })]);
  });

  it('parked ops are not counted as pending', async () => {
    const s = setup();
    await s.appDb.enqueue({ ...upsert('wombats', 'w1'), _failed: true } as never);
    await s.enqueue(upsert('treatments', 't1'));
    expect(await s.appDb.dataQueueCount()).toBe(1);
  });
});

describe('photos', () => {
  it('uploads base64 image data and sends the URL', async () => {
    const s = setup();
    const seen: unknown[] = [];
    s.deps.remote.upsert = async (_t, row) => (seen.push(row), { ok: true });
    await s.enqueue(upsert('wombat_photos', 'p1', { data_url: 'data:image/jpeg;base64,AA' }));
    const r = await flushQueue('u1', s.deps);
    expect(s.resolvePhotoUrl).toHaveBeenCalledWith('data:image/jpeg;base64,AA', 'p1', 'ww2_wombat_photos');
    expect(seen).toEqual([{ id: 'p1', data_url: 'https://cdn/p1.jpg', created_by: 'u1' }]);
    expect(r.uploadedPhotoIds).toEqual(new Set(['p1']));
  });

  it('uses on-device image data when the op has none', async () => {
    const s = setup({ localPhotos: { p2: 'data:image/jpeg;base64,BB' } });
    await s.enqueue(upsert('burrow_photos', 'p2', { data_url: null }));
    await flushQueue('u1', s.deps);
    expect(s.resolvePhotoUrl).toHaveBeenCalledWith('data:image/jpeg;base64,BB', 'p2', 'ww2_burrow_photos');
  });

  it('discards the op and reports the photo lost when no image data is left anywhere', async () => {
    const s = setup();
    await s.enqueue(upsert('wombat_photos', 'p3', { data_url: null }), upsert('wombats', 'w1'));
    const r = await flushQueue('u1', s.deps);
    expect(r.lostPhotoIds).toEqual(new Set(['p3']));
    expect(s.calls).toEqual(['upsert:wombats:w1']);
    expect(await s.appDb.getQueue()).toEqual([]);
  });

  it('leaves https URLs alone', async () => {
    const s = setup();
    await s.enqueue(upsert('wombat_photos', 'p4', { data_url: 'https://x/p4.jpg' }));
    await flushQueue('u1', s.deps);
    expect(s.resolvePhotoUrl).not.toHaveBeenCalled();
  });
});

it('a queue written by the legacy app flushes', async () => {
  const s = setup();
  // Legacy shape, including extra fields legacy ops may carry.
  await s.appDb.enqueue({ t: 'upsert', table: 'treatments', row: { id: 't1', wombat_id: 'w1', at: '2026-01-01' }, _retries: 2 } as never);
  await flushQueue('u1', s.deps);
  expect(s.calls).toEqual(['upsert:treatments:t1']);
  expect(await s.appDb.getQueue()).toEqual([]);
});
