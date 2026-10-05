import { syncAction, type SyncActionDeps } from './syncAction';
import type { Action } from '../state/actions';

type World = { online?: boolean; records?: Record<string, Record<string, unknown>>; upsertOk?: boolean; upsertThrows?: boolean };

function setup(world: World = {}) {
  const calls: unknown[][] = [];
  const log = (...c: unknown[]) => calls.push(c);
  const deps: SyncActionDeps = {
    isOnline: () => world.online ?? true,
    getRecord: async (store, id) => (world.records?.[`${store}:${id}`] as never) ?? null,
    getAllRecords: async (store) =>
      Object.entries(world.records || {}).filter(([k]) => k.startsWith(store + ':')).map(([, v]) => v) as never,
    remote: {
      upsert: async (t, row) => {
        log('upsert', t, row);
        if (world.upsertThrows) throw new Error('boom');
        return { ok: world.upsertOk ?? true };
      },
      remove: async (t, id) => (log('remove', t, id), { ok: true }),
      removeStorage: async (p) => (log('removeStorage', p), { ok: true }),
      upsertBatch: async (t, rows) => (log('upsertBatch', t, rows.length), { ok: true }),
    },
    queueOp: async (op) => void log('queue', op),
    markSynced: async (s, id) => void log('synced', s, id),
    markRecentlyDeleted: async (id) => void log('recentlyDeleted', id),
    putLocalPhoto: async (id) => void log('putLocalPhoto', id),
    getLocalPhoto: async () => null,
    resolvePhotoUrl: async (d, id) => (d?.startsWith('data:') ? `https://cdn/${id}.jpg` : d),
  };
  const run = (a: Action) => syncAction(a, 'u1', deps);
  const kinds = () => calls.map((c) => c[0]);
  return { calls, run, kinds, deps };
}

const treatment = { type: 'ADD_TREATMENT', treatment: { id: 't1', wombatId: 'w1', at: '2026-01-01' } } as const;

describe('push', () => {
  it('online success upserts with created_by and marks the record synced', async () => {
    const s = setup();
    await s.run(treatment);
    expect(s.calls).toEqual([
      ['upsert', 'treatments', expect.objectContaining({ id: 't1', created_by: 'u1' })],
      ['synced', 'treatments', 't1'],
    ]);
  });
  it('offline queues without calling Supabase', async () => {
    const s = setup({ online: false });
    await s.run(treatment);
    expect(s.kinds()).toEqual(['queue']);
  });
  it('a failed upsert is queued', async () => {
    const s = setup({ upsertOk: false });
    await s.run(treatment);
    expect(s.kinds()).toEqual(['upsert', 'queue']);
  });
  it('a thrown upsert is queued', async () => {
    const s = setup({ upsertThrows: true });
    await s.run(treatment);
    expect(s.kinds()).toEqual(['upsert', 'queue']);
  });
});

it('UPDATE_WOMBAT pushes the stored record with the patch applied, and skips unknown wombats', async () => {
  const s = setup({ records: { 'wombats:w1': { id: 'w1', name: 'Old', code: 'W0001' } } });
  await s.run({ type: 'UPDATE_WOMBAT', id: 'w1', patch: { name: 'New' } });
  await s.run({ type: 'UPDATE_WOMBAT', id: 'nope', patch: { name: 'x' } });
  expect(s.calls[0]).toEqual(['upsert', 'wombats', expect.objectContaining({ name: 'New', code: 'W0001' })]);
  expect(s.kinds()).toEqual(['upsert', 'synced']);
});

it('DELETE_WOMBAT deletes children explicitly and re-pushes linked burrows', async () => {
  const s = setup({ records: { 'burrows:b1': { id: 'b1', name: 'B', wombatIds: [] } } });
  await s.run({ type: 'DELETE_WOMBAT', id: 'w1', treatmentIds: ['t1'], wombatPhotoIds: ['p1'], burrowIds: ['b1'] });
  expect(s.calls.filter((c) => c[0] === 'remove')).toEqual([
    ['remove', 'wombats', 'w1'],
    ['remove', 'treatments', 't1'],
    ['remove', 'wombat_photos', 'p1'],
  ]);
  expect(s.calls).toContainEqual(['upsert', 'burrows', expect.objectContaining({ id: 'b1' })]);
  expect(s.calls).toContainEqual(['recentlyDeleted', 'w1']);
});

it('LINK_WOMBAT_BURROW pushes both sides with the link applied', async () => {
  const s = setup({ records: { 'wombats:w1': { id: 'w1', name: 'W', burrowIds: [] }, 'burrows:b1': { id: 'b1', name: 'B', wombatIds: [] } } });
  await s.run({ type: 'LINK_WOMBAT_BURROW', wombatId: 'w1', burrowId: 'b1' });
  expect(s.calls.filter((c) => c[0] === 'upsert')).toEqual([
    ['upsert', 'wombats', expect.objectContaining({ burrow_ids: ['b1'] })],
    ['upsert', 'burrows', expect.objectContaining({ wombat_ids: ['w1'] })],
  ]);
});

describe('photos', () => {
  const photo = { type: 'ADD_WOMBAT_PHOTO', photo: { id: 'p1', wombatId: 'w1', dataUrl: 'data:image/jpeg;base64,AA' } } as const;
  it('online: uploads and sends the URL', async () => {
    const s = setup();
    await s.run(photo);
    expect(s.calls[0]).toEqual(['upsert', 'wombat_photos', expect.objectContaining({ data_url: 'https://cdn/p1.jpg' })]);
  });
  it('offline: keeps the image on the device and queues the base64 so it survives eviction', async () => {
    const s = setup({ online: false });
    await s.run(photo);
    expect(s.calls).toEqual([
      ['putLocalPhoto', 'p1'],
      ['queue', { t: 'upsert', table: 'wombat_photos', row: expect.objectContaining({ data_url: 'data:image/jpeg;base64,AA' }) }],
    ]);
  });
  it('delete removes the Storage file online, or queues it offline', async () => {
    const on = setup();
    await on.run({ type: 'DELETE_WOMBAT_PHOTO', photoId: 'p1' });
    expect(on.calls).toContainEqual(['removeStorage', 'p1.jpg']);
    const off = setup({ online: false });
    await off.run({ type: 'DELETE_WOMBAT_PHOTO', photoId: 'p1' });
    expect(off.calls).toEqual([
      ['queue', { t: 'delete', table: 'wombat_photos', id: 'p1' }],
      ['queue', { t: 'storage-delete', path: 'p1.jpg' }],
    ]);
  });
});

describe('RENUMBER_BURROWS (bug #12)', () => {
  const burrows = { 'burrows:b1': { id: 'b1', name: 'B', code: 'B0001' }, 'burrows:b2': { id: 'b2', name: 'C', code: 'B0002' } };
  it('online: sends one batch, then marks every burrow synced', async () => {
    const s = setup({ records: burrows });
    await s.run({ type: 'RENUMBER_BURROWS' });
    expect(s.calls).toEqual([['upsertBatch', 'burrows', 2], ['synced', 'burrows', 'b1'], ['synced', 'burrows', 'b2']]);
  });
  it('offline: queues every burrow instead of losing the renumbering', async () => {
    const s = setup({ online: false, records: burrows });
    await s.run({ type: 'RENUMBER_BURROWS' });
    expect(s.calls).toEqual([
      ['queue', { t: 'upsert', table: 'burrows', row: expect.objectContaining({ id: 'b1', code: 'B0001' }) }],
      ['queue', { t: 'upsert', table: 'burrows', row: expect.objectContaining({ id: 'b2', code: 'B0002' }) }],
    ]);
  });
  it('a failed or thrown batch queues its rows', async () => {
    for (const fail of [{ ok: false }, 'throw'] as const) {
      const s = setup({ records: burrows });
      s.deps.remote.upsertBatch = async () => { if (fail === 'throw') throw new Error('net'); return fail; };
      await s.run({ type: 'RENUMBER_BURROWS' });
      expect(s.kinds()).toEqual(['queue', 'queue']);
    }
  });
});

// Characterisation: the reducer replaces the name of an existing assignment; sync keeps the old one.
it('ASSIGN_WOMBAT keeps an existing assignment unchanged', async () => {
  const s = setup({ records: { 'wombats:w1': { id: 'w1', name: 'W', assignees: [{ userId: 'u9', name: 'Old' }] } } });
  await s.run({ type: 'ASSIGN_WOMBAT', wombatId: 'w1', userId: 'u9', name: 'New' });
  expect(s.calls[0]).toEqual(['upsert', 'wombats', expect.objectContaining({ assignees: [{ userId: 'u9', name: 'Old' }] })]);
});

it('sync-only actions send nothing', async () => {
  const s = setup();
  await s.run({ type: 'HYDRATE_PHOTO_DATA', map: {} });
  expect(s.calls).toEqual([]);
});
