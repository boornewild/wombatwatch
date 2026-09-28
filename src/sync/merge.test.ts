import {
  filterToSquad,
  isConfirmedNewUser,
  mergeTable,
  pendingSets,
  resolveWithQueue,
  type SyncRecord,
} from './merge';
import { dbToWombat } from '../data/mappers';
import type { AppData, Wombat } from '../domain/types';

const empty = (): AppData => ({
  wombats: [],
  burrows: [],
  treatments: [],
  sightings: [],
  burrowLogs: [],
  wombatPhotos: [],
  burrowPhotos: [],
});
const none = new Set<string>();
type Rec = SyncRecord & { v?: string };
const fromDb = (r: Rec): Rec => ({ ...r, v: 'server', _sync: true });
const merge = (over: Partial<Parameters<typeof mergeTable<Rec, Rec>>[0]>) =>
  mergeTable<Rec, Rec>({
    remote: [],
    local: [],
    queuedIds: none,
    deletedIds: none,
    recentlyDeleted: none,
    currentSquadId: 'sq1',
    fromDb,
    ...over,
  });

describe('filterToSquad', () => {
  const data = {
    ...empty(),
    _fetchStart: 5,
    wombats: [
      { id: 'w1', name: 'a', squadId: 'sq1' },
      { id: 'w2', name: 'b', squadId: 'sq2' },
      { id: 'w3', name: 'c' },
    ],
    burrows: [
      { id: 'b1', name: 'a', squadId: 'sq1' },
      { id: 'b2', name: 'b', squadId: 'sq2' },
    ],
    treatments: [
      { id: 't1', wombatId: 'w1', at: 'x' },
      { id: 't2', wombatId: 'w2', at: 'x' },
    ],
    sightings: [{ id: 's1', wombatId: 'w2', at: 'x' }],
    burrowLogs: [
      { id: 'l1', burrowId: 'b1', at: 'x' },
      { id: 'l2', burrowId: 'b2', at: 'x' },
    ],
    wombatPhotos: [{ id: 'p1', wombatId: 'w1' }],
    burrowPhotos: [{ id: 'p2', burrowId: 'b2' }],
  };

  it('keeps the active squad and children of its parents, and extra keys', () => {
    const out = filterToSquad(data, 'sq1');
    expect(out.wombats.map((w) => w.id)).toEqual(['w1']);
    expect(out.burrows.map((b) => b.id)).toEqual(['b1']);
    expect(out.treatments.map((t) => t.id)).toEqual(['t1']);
    expect(out.sightings).toEqual([]);
    expect(out.burrowLogs.map((l) => l.id)).toEqual(['l1']);
    expect(out.wombatPhotos.map((p) => p.id)).toEqual(['p1']);
    expect(out.burrowPhotos).toEqual([]);
    expect(out._fetchStart).toBe(5);
  });

  // Characterisation: here a wombat with no squadId is dropped, unlike in mergeTable where it is kept.
  it('drops parents with no squadId', () => {
    expect(filterToSquad(data, 'sq1').wombats.some((w) => w.id === 'w3')).toBe(false);
  });

  // Characterisation: with no squad the very same object comes back, unfiltered.
  it.each([null, undefined, ''])('returns the input unchanged for squadId %j', (sq) => {
    expect(filterToSquad(data, sq)).toBe(data);
  });
});

describe('pendingSets', () => {
  it('collects upsert row ids and delete ids', () => {
    const r = pendingSets([
      { t: 'upsert', row: { id: 'a' } },
      { t: 'delete', id: 'b' },
      { t: 'storage-delete' },
      { t: 'upsert', row: null },
      { t: 'delete', id: '' },
    ]);
    expect([...r.queuedIds]).toEqual(['a']);
    expect([...r.deletedIds]).toEqual(['b']);
    expect(r.hasPendingUpserts).toBe(true);
  });

  // Characterisation: an upsert with no row still counts as a pending upsert.
  it('counts an upsert with no row id as pending', () => {
    expect(pendingSets([{ t: 'upsert' }]).hasPendingUpserts).toBe(true);
    expect(pendingSets([{ t: 'delete', id: 'x' }]).hasPendingUpserts).toBe(false);
  });
});

describe('isConfirmedNewUser', () => {
  const base = { remoteWombats: [], remoteBurrows: [], hasPendingUpserts: false, localHasData: false };
  it.each([
    ['empty everywhere', {}, true],
    ['failed queries (null) count as empty', { remoteWombats: null, remoteBurrows: null }, true],
    ['remote wombats', { remoteWombats: [{}] }, false],
    ['remote burrows', { remoteBurrows: [{}] }, false],
    ['pending upserts', { hasPendingUpserts: true }, false],
    ['local data', { localHasData: true }, false],
  ])('%s', (_, over, expected) => {
    expect(isConfirmedNewUser({ ...base, ...over })).toBe(expected);
  });
});

describe('mergeTable', () => {
  it('remote === null keeps local as-is (same array, other squads included)', () => {
    const local = [{ id: 'a', _sync: true, squadId: 'sq2' }];
    expect(merge({ remote: null, local })).toBe(local);
  });

  it('empty remote with synced local keeps local minus deletes', () => {
    const local = [
      { id: 'a', _sync: true },
      { id: 'b', _sync: true },
      { id: 'c', _sync: false },
      { id: 'd', _sync: true },
    ];
    const out = merge({ remote: [], local, deletedIds: new Set(['b']), recentlyDeleted: new Set(['d']) });
    expect(out.map((r) => r.id)).toEqual(['a', 'c']);
  });

  // Characterisation: the empty-remote protection path skips the squad filter.
  it('empty remote protection keeps other-squad local records', () => {
    const out = merge({ remote: [], local: [{ id: 'a', _sync: true, squadId: 'sq2' }] });
    expect(out.map((r) => r.id)).toEqual(['a']);
  });

  it('empty remote with only unsynced local keeps the unsynced records', () => {
    expect(
      merge({
        remote: [],
        local: [
          { id: 'a', _sync: false },
          { id: 'b', _sync: true },
        ],
        deletedIds: new Set(['b']),
      }),
    ).toEqual([{ id: 'a', _sync: false }]);
  });

  it.each<[string, Rec, Partial<Parameters<typeof merge>[0]>, string]>([
    ['unsynced local wins', { id: 'a', v: 'local', _sync: false }, {}, 'local'],
    ['missing _sync counts as unsynced', { id: 'a', v: 'local' }, {}, 'local'],
    [
      'queued upsert wins even when synced',
      { id: 'a', v: 'local', _sync: true },
      { queuedIds: new Set(['a']) },
      'local',
    ],
    ['synced local loses to server', { id: 'a', v: 'local', _sync: true }, {}, 'server'],
    ['other-squad unsynced local loses', { id: 'a', v: 'local', _sync: false, squadId: 'sq2' }, {}, 'server'],
    ['same-squad unsynced local wins', { id: 'a', v: 'local', _sync: false, squadId: 'sq1' }, {}, 'local'],
    [
      'other-squad local wins when no current squad',
      { id: 'a', v: 'local', _sync: false, squadId: 'sq2' },
      { currentSquadId: null },
      'local',
    ],
  ])('%s', (_, loc, over, winner) => {
    const out = merge({ remote: [{ id: 'a' }], local: [loc], ...over });
    expect(out).toHaveLength(1);
    expect(out[0]?.v).toBe(winner);
  });

  it('adds new unsynced local records, excluding other squads but keeping ones with no squadId', () => {
    const local = [
      { id: 'mine', _sync: false, squadId: 'sq1' },
      { id: 'theirs', _sync: false, squadId: 'sq2' },
      { id: 'nosquad', _sync: false },
      { id: 'gone', _sync: true },
    ];
    expect(merge({ remote: [{ id: 'r' }], local }).map((r) => r.id)).toEqual(['r', 'mine', 'nosquad']);
  });

  it('removes pending deletes and recently deleted ids from remote and local', () => {
    const out = merge({
      remote: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      local: [
        { id: 'x', _sync: false },
        { id: 'y', _sync: false },
      ],
      deletedIds: new Set(['a', 'x']),
      recentlyDeleted: new Set(['b', 'y']),
    });
    expect(out.map((r) => r.id)).toEqual(['c']);
  });

  // Characterisation: records are keyed on a plain object, so integer-like ids sort first.
  it('orders integer-like ids first', () => {
    expect(merge({ remote: [{ id: 'z' }, { id: '10' }, { id: '2' }] }).map((r) => r.id)).toEqual([
      '2',
      '10',
      'z',
    ]);
  });

  it('converts remote rows with the given mapper', () => {
    const row = { id: 'w', name: 'N', squad_id: 'sq1' } as Parameters<typeof dbToWombat>[0];
    const out = mergeTable<typeof row, Wombat>({
      remote: [row],
      local: undefined,
      queuedIds: none,
      deletedIds: none,
      recentlyDeleted: none,
      currentSquadId: 'sq1',
      fromDb: dbToWombat,
    });
    expect(out[0]).toMatchObject({ id: 'w', name: 'N', squadId: 'sq1', _sync: true });
  });
});

describe('resolveWithQueue', () => {
  const resolve = (
    items: SyncRecord[],
    local: SyncRecord[],
    over: Partial<Parameters<typeof resolveWithQueue>[0]> = {},
  ) =>
    resolveWithQueue({
      merged: { ...empty(), wombats: items as Wombat[] },
      local: { w: local },
      queue: [],
      fetchStart: 1000,
      currentSquadId: 'sq1',
      ...over,
    }).wombats as (SyncRecord & { v?: string })[];

  it.each<[string, SyncRecord & { v?: string }, Partial<Parameters<typeof resolveWithQueue>[0]>, string]>([
    [
      'queued local wins',
      { id: 'a', v: 'local', _sync: true },
      { queue: [{ t: 'upsert', row: { id: 'a' } }] },
      'local',
    ],
    ['unsynced local wins', { id: 'a', v: 'local', _sync: false }, {}, 'local'],
    ['pushed after fetchStart wins', { id: 'a', v: 'local', _sync: true, _pushedAt: 1001 }, {}, 'local'],
    ['pushed at fetchStart loses', { id: 'a', v: 'local', _sync: true, _pushedAt: 1000 }, {}, 'server'],
    [
      '_pushedAt ignored with no fetchStart',
      { id: 'a', v: 'local', _sync: true, _pushedAt: 5 },
      { fetchStart: 0 },
      'server',
    ],
    // Characterisation: only an explicit _sync:false wins here, unlike mergeTable where a missing _sync wins.
    ['missing _sync does not win', { id: 'a', v: 'local' }, {}, 'server'],
  ])('%s', (_, loc, over, winner) => {
    expect(resolve([{ id: 'a', v: 'server' } as SyncRecord], [loc], over)[0]?.v).toBe(winner);
  });

  it('a winning local with null dataUrl takes the server URL', () => {
    const out = resolve(
      [{ id: 'a', dataUrl: 'https://s/a.jpg' }],
      [{ id: 'a', _sync: false, dataUrl: null }],
    );
    expect(out[0]).toEqual({ id: 'a', _sync: false, dataUrl: 'https://s/a.jpg' });
  });

  it('a winning local with image data keeps it', () => {
    const out = resolve(
      [{ id: 'a', dataUrl: 'https://s/a.jpg' }],
      [{ id: 'a', _sync: false, dataUrl: 'data:x' }],
    );
    expect(out[0]?.dataUrl).toBe('data:x');
  });

  it('appends new local records created during the fetch, skipping other squads', () => {
    const local = [
      { id: 'new', _sync: false, squadId: 'sq1' },
      { id: 'queued', _sync: true },
      { id: 'other', _sync: false, squadId: 'sq2' },
      { id: 'nosquad' },
      { id: 'synced', _sync: true },
    ];
    const out = resolve([{ id: 'r' }], local, { queue: [{ t: 'upsert', row: { id: 'queued' } }] });
    expect(out.map((r) => r.id)).toEqual(['r', 'new', 'queued', 'nosquad']);
  });

  it('removes pending deletes from server items and local additions', () => {
    const out = resolve([{ id: 'a' }, { id: 'b' }], [{ id: 'c', _sync: false }], {
      queue: [
        { t: 'delete', id: 'a' },
        { t: 'delete', id: 'c' },
      ],
    });
    expect(out.map((r) => r.id)).toEqual(['b']);
  });

  it('returns only the seven tables, with missing local stores treated as empty', () => {
    const merged = { ...empty(), _fetchStart: 1, treatments: [{ id: 't', wombatId: 'w', at: 'x' }] };
    const out = resolveWithQueue({ merged, local: {}, queue: [], fetchStart: 1, currentSquadId: null });
    expect(Object.keys(out)).toEqual([
      'wombats',
      'burrows',
      'treatments',
      'sightings',
      'burrowLogs',
      'wombatPhotos',
      'burrowPhotos',
    ]);
    expect(out.treatments).toEqual(merged.treatments);
  });
});
