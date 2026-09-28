import { reducer } from './reducer';
import type { AppData } from '../domain/types';

/** Deep-freezes so any mutation of the input state throws. */
const freeze = <T,>(o: T): T => {
  if (o && typeof o === 'object') {
    Object.values(o).forEach(freeze);
    Object.freeze(o);
  }
  return o;
};

const base = (): AppData =>
  freeze({
    wombats: [
      { id: 'w1', name: 'Bruce', code: 'W0001', status: 'under_treatment', burrowIds: ['b1'], assignees: [{ userId: 'u1', name: 'Al' }], _sync: true },
      { id: 'w2', name: 'Sheila', code: null, burrowIds: [], _sync: true },
    ],
    burrows: [
      { id: 'b1', name: 'Creek', code: 'B0001', status: 'active', wombatIds: ['w1'], habitat: { soil: 'sand' }, _createdAt: '2026-02-01', _sync: true },
      { id: 'b2', name: 'Hill', code: null, status: 'active', wombatIds: [], habitat: {}, _createdAt: '2026-01-01', _sync: true },
    ],
    treatments: [{ id: 't1', wombatId: 'w1', at: '2026-02-01', _sync: true }],
    sightings: [{ id: 's1', wombatId: 'w1', at: '2026-02-01', _sync: true }],
    burrowLogs: [
      { id: 'l1', burrowId: 'b1', at: '2026-01-01', status: 'inactive', _sync: true },
      { id: 'l2', burrowId: 'b1', at: '2026-02-01', status: 'damaged', _sync: true },
    ],
    wombatPhotos: [
      { id: 'p1', wombatId: 'w1', isProfile: true, dataUrl: null, _sync: true },
      { id: 'p2', wombatId: 'w1', isProfile: false, dataUrl: null, _sync: true },
    ],
    burrowPhotos: [{ id: 'p3', burrowId: 'b1', isProfile: false, dataUrl: null, _sync: true }],
  });

const w = (s: AppData, id: string) => s.wombats.find((x) => x.id === id)!;
const b = (s: AppData, id: string) => s.burrows.find((x) => x.id === id)!;

describe('wombats', () => {
  it('ADD_WOMBAT appends as unsynced', () => {
    expect(w(reducer(base(), { type: 'ADD_WOMBAT', wombat: { id: 'w3', name: 'New', _sync: true } }), 'w3')._sync).toBe(false);
  });
  it('UPDATE_WOMBAT patches and marks unsynced', () => {
    expect(w(reducer(base(), { type: 'UPDATE_WOMBAT', id: 'w1', patch: { name: 'B2' } }), 'w1')).toMatchObject({ name: 'B2', code: 'W0001', _sync: false });
  });
  it('ASSIGN_WOMBAT replaces an existing assignment for the same user', () => {
    const s = reducer(base(), { type: 'ASSIGN_WOMBAT', wombatId: 'w1', userId: 'u1', name: 'Alice' });
    expect(w(s, 'w1').assignees).toEqual([{ userId: 'u1', name: 'Alice' }]);
  });
  it('UNASSIGN_WOMBAT removes the user', () => {
    expect(w(reducer(base(), { type: 'UNASSIGN_WOMBAT', wombatId: 'w1', userId: 'u1' }), 'w1').assignees).toEqual([]);
  });
  it('MARK_WOMBAT_INACTIVE records cause and notes', () => {
    const s = reducer(base(), { type: 'MARK_WOMBAT_INACTIVE', id: 'w1', status: 'deceased', inactiveAt: '2026-03-01', inactiveCause: 'road' });
    expect(w(s, 'w1')).toMatchObject({ status: 'deceased', inactiveAt: '2026-03-01', inactiveCause: 'road', inactiveNotes: null, _sync: false });
  });
  it('MARK_WOMBAT_ACTIVE clears inactive fields', () => {
    const dead = reducer(base(), { type: 'MARK_WOMBAT_INACTIVE', id: 'w1', status: 'deceased', inactiveAt: '2026-03-01' });
    expect(w(reducer(dead, { type: 'MARK_WOMBAT_ACTIVE', id: 'w1', status: 'healthy' }), 'w1')).toMatchObject({ status: 'healthy', inactiveAt: null, inactiveCause: null });
  });
  it('ARCHIVE_WOMBAT sets archived', () => expect(w(reducer(base(), { type: 'ARCHIVE_WOMBAT', id: 'w1' }), 'w1').status).toBe('archived'));
  it('IMPORT_WOMBATS appends as given (no _sync change)', () => {
    expect(reducer(base(), { type: 'IMPORT_WOMBATS', wombats: [{ id: 'w9', name: 'I' }] }).wombats.at(-1)).toEqual({ id: 'w9', name: 'I' });
  });
  it('DELETE_WOMBAT cascades to children and unlinks burrows', () => {
    const s = reducer(base(), { type: 'DELETE_WOMBAT', id: 'w1' });
    expect(s.wombats.map((x) => x.id)).toEqual(['w2']);
    expect(s.treatments).toEqual([]);
    expect(s.sightings).toEqual([]);
    expect(s.wombatPhotos).toEqual([]);
    expect(b(s, 'b1')).toMatchObject({ wombatIds: [], _sync: false });
    expect(b(s, 'b2')._sync).toBe(true);
  });
});

describe('burrows', () => {
  it('ADD_BURROW appends as unsynced', () => {
    expect(b(reducer(base(), { type: 'ADD_BURROW', burrow: { id: 'b3', name: 'N' } }), 'b3')._sync).toBe(false);
  });
  it('ASSIGN_MISSING_CODES fills only missing codes', () => {
    const s = reducer(base(), { type: 'ASSIGN_MISSING_CODES' });
    expect(b(s, 'b2').code).toBe('B0002');
    expect(w(s, 'w2').code).toBe('W0002');
    expect(b(s, 'b1')._sync).toBe(true);
  });
  it('RENUMBER_BURROWS numbers oldest first', () => {
    const s = reducer(base(), { type: 'RENUMBER_BURROWS' });
    expect(b(s, 'b2').code).toBe('B0001');
    expect(b(s, 'b1').code).toBe('B0002');
  });
  it('IMPORT_BURROWS gives code-less imports the next free codes', () => {
    const s = reducer(base(), { type: 'IMPORT_BURROWS', burrows: [{ id: 'i1', name: 'x' }, { id: 'i2', name: 'y' }] });
    expect(s.burrows.slice(-2).map((x) => x.code)).toEqual(['B0002', 'B0003']);
  });
  it('UPDATE_BURROW patches and marks unsynced', () => {
    expect(b(reducer(base(), { type: 'UPDATE_BURROW', id: 'b1', patch: { name: 'C2' } }), 'b1')).toMatchObject({ name: 'C2', _sync: false });
  });
  it('DELETE_BURROW cascades to logs and photos and unlinks wombats', () => {
    const s = reducer(base(), { type: 'DELETE_BURROW', id: 'b1' });
    expect(s.burrowLogs).toEqual([]);
    expect(s.burrowPhotos).toEqual([]);
    expect(w(s, 'w1')).toMatchObject({ burrowIds: [], _sync: false });
  });
});

describe('treatments and sightings', () => {
  it('ADD_TREATMENT', () => expect(reducer(base(), { type: 'ADD_TREATMENT', treatment: { id: 't2', wombatId: 'w1', at: 'x' } }).treatments.at(-1)!._sync).toBe(false));
  it('EDIT_TREATMENT replaces the whole record', () => {
    const s = reducer(base(), { type: 'EDIT_TREATMENT', treatment: { id: 't1', wombatId: 'w1', at: '2026-03-01', note: 'n' } });
    expect(s.treatments[0]).toEqual({ id: 't1', wombatId: 'w1', at: '2026-03-01', note: 'n', _sync: false });
  });
  it('DELETE_TREATMENT', () => expect(reducer(base(), { type: 'DELETE_TREATMENT', treatmentId: 't1' }).treatments).toEqual([]));
  it('ADD_SIGHTING', () => expect(reducer(base(), { type: 'ADD_SIGHTING', sighting: { id: 's2', wombatId: 'w1', at: 'x' } }).sightings).toHaveLength(2));
  it('DELETE_SIGHTING', () => expect(reducer(base(), { type: 'DELETE_SIGHTING', sightingId: 's1' }).sightings).toEqual([]));
});

describe('photos', () => {
  it('ADD_WOMBAT_PHOTO', () => expect(reducer(base(), { type: 'ADD_WOMBAT_PHOTO', photo: { id: 'p9', wombatId: 'w1' } }).wombatPhotos).toHaveLength(3));
  it('SET_PROFILE_PHOTO leaves exactly one profile photo for the wombat', () => {
    const s = reducer(base(), { type: 'SET_PROFILE_PHOTO', wombatId: 'w1', photoId: 'p2' });
    expect(s.wombatPhotos.map((p) => [p.id, p.isProfile, p._sync])).toEqual([['p1', false, false], ['p2', true, false]]);
  });
  it('DELETE_WOMBAT_PHOTO', () => expect(reducer(base(), { type: 'DELETE_WOMBAT_PHOTO', photoId: 'p1' }).wombatPhotos).toHaveLength(1));
  it('ADD_BURROW_PHOTO', () => expect(reducer(base(), { type: 'ADD_BURROW_PHOTO', photo: { id: 'p8', burrowId: 'b1' } }).burrowPhotos).toHaveLength(2));
  it('SET_BURROW_PROFILE_PHOTO', () => {
    expect(reducer(base(), { type: 'SET_BURROW_PROFILE_PHOTO', burrowId: 'b1', photoId: 'p3' }).burrowPhotos[0]).toMatchObject({ isProfile: true, _sync: false });
  });
  it('DELETE_BURROW_PHOTO', () => expect(reducer(base(), { type: 'DELETE_BURROW_PHOTO', photoId: 'p3' }).burrowPhotos).toEqual([]));
  it('HYDRATE_PHOTO_DATA fills image data for known ids only', () => {
    const s = reducer(base(), { type: 'HYDRATE_PHOTO_DATA', map: { p1: 'data:a', p3: 'data:c', zz: 'data:z' } });
    expect(s.wombatPhotos.map((p) => p.dataUrl)).toEqual(['data:a', null]);
    expect(s.burrowPhotos[0]!.dataUrl).toBe('data:c');
  });
});

describe('burrow logs', () => {
  it('ADD_BURROW_LOG copies recorded fields onto the burrow and merges habitat', () => {
    const s = reducer(base(), {
      type: 'ADD_BURROW_LOG',
      log: { id: 'l3', burrowId: 'b1', at: '2026-03-01', status: 'active', heightCm: 30, widthCm: '', substrate: 'clay', trailCamera: false },
    });
    expect(b(s, 'b1')).toMatchObject({ status: 'active', lastChecked: '2026-03-01', entranceHeightCm: 30, habitat: { soil: 'sand', substrate: 'clay', trailCamera: false }, _sync: false });
    expect(b(s, 'b1')).not.toHaveProperty('entranceWidthCm');
  });
  it('DELETE_BURROW_LOG reverts the burrow to the latest remaining log', () => {
    const s = reducer(base(), { type: 'DELETE_BURROW_LOG', logId: 'l2', burrowId: 'b1' });
    expect(b(s, 'b1')).toMatchObject({ status: 'inactive', lastChecked: '2026-01-01', _sync: false });
  });
  it('DELETE_BURROW_LOG keeps burrow values when no logs remain', () => {
    const s1 = reducer(base(), { type: 'DELETE_BURROW_LOG', logId: 'l2', burrowId: 'b1' });
    const s2 = reducer(s1, { type: 'DELETE_BURROW_LOG', logId: 'l1', burrowId: 'b1' });
    expect(b(s2, 'b1').status).toBe('inactive');
  });
});

describe('links', () => {
  it('LINK_WOMBAT_BURROW is bidirectional and idempotent', () => {
    const once = reducer(base(), { type: 'LINK_WOMBAT_BURROW', wombatId: 'w2', burrowId: 'b2' });
    const twice = reducer(once, { type: 'LINK_WOMBAT_BURROW', wombatId: 'w2', burrowId: 'b2' });
    expect(w(twice, 'w2').burrowIds).toEqual(['b2']);
    expect(b(twice, 'b2').wombatIds).toEqual(['w2']);
  });
  it('UNLINK_WOMBAT_BURROW removes both sides', () => {
    const s = reducer(base(), { type: 'UNLINK_WOMBAT_BURROW', wombatId: 'w1', burrowId: 'b1' });
    expect(w(s, 'w1').burrowIds).toEqual([]);
    expect(b(s, 'b1').wombatIds).toEqual([]);
  });
});

describe('sync', () => {
  it('PATCH_RECORDS applies server changes but keeps unsynced local edits', () => {
    const edited = reducer(base(), { type: 'UPDATE_WOMBAT', id: 'w1', patch: { name: 'Local' } });
    const s = reducer(edited, {
      type: 'PATCH_RECORDS',
      data: { wombats: [{ id: 'w1', name: 'Server', _sync: true }, { id: 'w2', name: 'Server2', _sync: true }, { id: 'w5', name: 'New', _sync: true }] },
    });
    expect(s.wombats.map((x) => x.name)).toEqual(['Local', 'Server2', 'New']);
  });
  it('PATCH_RECORDS with nothing changed keeps the same arrays', () => {
    const s0 = base();
    expect(reducer(s0, { type: 'PATCH_RECORDS', data: {} }).treatments).toBe(s0.treatments);
  });
  it('REPLACE_ALL swaps every collection', () => {
    const empty: AppData = { wombats: [], burrows: [], treatments: [], sightings: [], burrowLogs: [], wombatPhotos: [], burrowPhotos: [] };
    expect(reducer(base(), { type: 'REPLACE_ALL', data: empty })).toEqual(empty);
  });
});

it('unknown actions return the same state', () => {
  const s = base();
  expect(reducer(s, { type: 'NOPE' } as never)).toBe(s);
});
