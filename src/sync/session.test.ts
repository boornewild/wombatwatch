import { createSyncSession, squadCenter } from './session';

it('squadCenter is the midpoint of the bounds, or null without them', () => {
  expect(squadCenter({ boundsSwLat: -34, boundsSwLng: 150, boundsNeLat: -33, boundsNeLng: 151 })).toEqual({ lat: -33.5, lng: 150.5 });
  expect(squadCenter({ boundsSwLat: 0, boundsSwLng: 0, boundsNeLat: 0, boundsNeLng: 0 })).toEqual({ lat: 0, lng: 0 });
  expect(squadCenter({ boundsSwLat: null, boundsNeLat: -33 })).toBeNull();
  expect(squadCenter(null)).toBeNull();
});

it('setSquad sets id and centre; null clears both', () => {
  const s = createSyncSession();
  s.setSquad({ id: 'sq', boundsSwLat: 1, boundsSwLng: 1, boundsNeLat: 3, boundsNeLng: 3 });
  expect([s.currentSquadId, s.squadCenter]).toEqual(['sq', { lat: 2, lng: 2 }]);
  s.setSquad(null);
  expect([s.currentSquadId, s.squadCenter]).toEqual([null, null]);
});

it('only the most recent sequence number is latest', () => {
  const s = createSyncSession();
  const a = s.nextSeq();
  const b = s.nextSeq();
  expect([s.isLatest(a), s.isLatest(b)]).toEqual([false, true]);
});
