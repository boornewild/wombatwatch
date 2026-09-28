import { runFullSync, type RunFullSyncDeps } from './runFullSync';
import { createSyncSession } from './session';
import type { AppData } from '../domain/types';

const empty = (): AppData => ({ wombats: [], burrows: [], treatments: [], sightings: [], burrowLogs: [], wombatPhotos: [], burrowPhotos: [] });

function setup(pulled: unknown) {
  const calls: unknown[][] = [];
  const session = createSyncSession();
  session.currentSquadId = 'sq';
  const deps: RunFullSyncDeps = {
    session,
    fullSync: async () => pulled as never,
    resolveWithQueue: async (m) => (calls.push(['resolve']), m as AppData),
    dispatch: (a) => void calls.push(['dispatch', a.type]),
    getAllLocalPhotos: async () => (calls.push(['localPhotos']), { p1: 'data:x' }),
    cacheRemotePhotos: async (_w, _b, _d, forced) => void calls.push(['cache', forced ? [...forced] : undefined]),
    recoverBlankPhotos: async () => void calls.push(['recover']),
    patchCode: (table, id, code) => void calls.push(['patchCode', table, id, code]),
    geocodeBackfill: () => void calls.push(['geocode']),
  };
  return { deps, calls };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

it('synced: resolve, dedupe codes, filter to squad, replace, then photos, code write-back and geocoding', async () => {
  const data = {
    ...empty(),
    _fetchStart: 1,
    wombats: [
      { id: 'a', name: 'A', code: 'W0001', squadId: 'sq' },
      { id: 'b', name: 'B', code: 'W0001', squadId: 'sq' },
      { id: 'c', name: 'C', code: 'W0001', squadId: 'other' },
    ],
  };
  const s = setup(data);
  expect(await runFullSync(s.deps, { forcedPhotoIds: new Set(['p9']) })).toBe('synced');
  await flush();
  expect(s.calls).toEqual([
    ['resolve'],
    ['dispatch', 'REPLACE_ALL'],
    ['localPhotos'],
    ['cache', ['p9']],
    ['recover'],
    ['patchCode', 'wombats', 'b', 'W0002'],
    ['patchCode', 'wombats', 'c', 'W0003'],
    ['geocode'],
    ['dispatch', 'HYDRATE_PHOTO_DATA'],
  ]);
});

it('only the active squad reaches state', async () => {
  let replaced: AppData | undefined;
  const s = setup({ ...empty(), wombats: [{ id: 'a', name: 'A', code: 'W0001', squadId: 'sq' }, { id: 'c', name: 'C', code: 'W0002', squadId: 'other' }] });
  s.deps.dispatch = (a) => { if (a.type === 'REPLACE_ALL') replaced = a.data; };
  await runFullSync(s.deps);
  expect(replaced!.wombats.map((w) => w.id)).toEqual(['a']);
});

it('new user: clears local data and does nothing else', async () => {
  const s = setup(null);
  expect(await runFullSync(s.deps)).toBe('new-user');
  expect(s.calls).toEqual([['dispatch', 'REPLACE_ALL']]);
});

it('offline or stale: leaves local state untouched', async () => {
  const s = setup(undefined);
  expect(await runFullSync(s.deps)).toBe('skipped');
  expect(s.calls).toEqual([]);
});

it('a failing code write-back or photo step does not fail the sync', async () => {
  const s = setup({ ...empty(), wombats: [{ id: 'a', code: 'W0001' }, { id: 'b', code: 'W0001' }] });
  s.deps.patchCode = () => { throw new Error('x'); };
  s.deps.cacheRemotePhotos = () => Promise.reject(new Error('x'));
  s.deps.getAllLocalPhotos = () => Promise.reject(new Error('x'));
  await expect(runFullSync(s.deps)).resolves.toBe('synced');
});
