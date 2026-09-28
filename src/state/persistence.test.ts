import { persistChanges, stripImageData, withPersistence } from './persistence';
import { reducer } from './reducer';
import type { AppData } from '../domain/types';

const empty = (): AppData => ({ wombats: [], burrows: [], treatments: [], sightings: [], burrowLogs: [], wombatPhotos: [], burrowPhotos: [] });

it('saves only the collections the action changed, under the legacy keys', () => {
  const save = vi.fn();
  const s = empty();
  const next = reducer(s, { type: 'ADD_TREATMENT', treatment: { id: 't', wombatId: 'w', at: 'x' } });
  persistChanges(s, next, { type: 'ADD_TREATMENT', treatment: { id: 't', wombatId: 'w', at: 'x' } }, save);
  expect(save).toHaveBeenCalledTimes(1);
  expect(save).toHaveBeenCalledWith('t', next.treatments);
});

it('strips base64 image data from photos but keeps URLs', () => {
  const save = vi.fn();
  const reduceAndSave = withPersistence(reducer, save);
  reduceAndSave(empty(), { type: 'ADD_WOMBAT_PHOTO', photo: { id: 'p', wombatId: 'w', dataUrl: 'data:image/jpeg;base64,AAA' } });
  expect(save).toHaveBeenCalledWith('wp', [{ id: 'p', wombatId: 'w', dataUrl: null, _sync: false }]);
  expect(stripImageData({ dataUrl: 'https://x/p.jpg' }).dataUrl).toBe('https://x/p.jpg');
});

it('never saves after HYDRATE_PHOTO_DATA', () => {
  const save = vi.fn();
  const s = { ...empty(), wombatPhotos: [{ id: 'p', wombatId: 'w', dataUrl: null }] };
  withPersistence(reducer, save)(s, { type: 'HYDRATE_PHOTO_DATA', map: { p: 'data:x' } });
  expect(save).not.toHaveBeenCalled();
});

it('DELETE_WOMBAT saves every collection it touched', () => {
  const save = vi.fn();
  const s = { ...empty(), wombats: [{ id: 'w', name: 'x' }], treatments: [{ id: 't', wombatId: 'w', at: 'x' }] };
  withPersistence(reducer, save)(s, { type: 'DELETE_WOMBAT', id: 'w' });
  expect(save.mock.calls.map((c) => c[0]).sort()).toEqual(['b', 's', 't', 'w', 'wp']);
});

// Characterisation of a legacy bug, kept until fixed deliberately: after photos are hydrated from the
// on-device store, an incremental sync re-saves them with image data stripped, losing the saved https URL.
it('PATCH_RECORDS re-saves hydrated photos with their URL replaced by null (known bug)', () => {
  const save = vi.fn();
  const reduceAndSave = withPersistence(reducer, save);
  const s0 = { ...empty(), wombatPhotos: [{ id: 'p', wombatId: 'w', dataUrl: 'https://x/p.jpg' }] };
  const hydrated = reduceAndSave(s0, { type: 'HYDRATE_PHOTO_DATA', map: { p: 'data:image/jpeg;base64,AAA' } });
  reduceAndSave(hydrated, { type: 'PATCH_RECORDS', data: {} });
  expect(save).toHaveBeenCalledWith('wp', [{ id: 'p', wombatId: 'w', dataUrl: null }]);
  expect(save).toHaveBeenCalledTimes(7);
});
