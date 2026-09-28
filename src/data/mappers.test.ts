import * as m from './mappers';

const UID = 'user-1';
// DB rows also carry server-managed columns; add them so mapped-back records see a realistic row.
/** Insert shape + server columns = a full row; the cast keeps these tests short. */
const asRow = (x: object) => x as never;
const serverCols = { created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', created_by: UID };

const wombat = {
  id: 'w1', name: 'Bruce', sex: 'M', ageClass: 'adult', status: 'under_treatment', severity: { head: 2 },
  burrowIds: ['b1'], firstSeen: '2026-01-01', location: 'St Albans', lat: -33.29, lng: 150.97, notes: 'n',
  code: 'W0001', locationLabel: 'Creek', inactiveAt: null, inactiveCause: null, inactiveNotes: null,
  squadId: 's1', assignees: [],
};
const burrow = {
  id: 'b1', name: 'Creek', status: 'active', location: 'St Albans', lat: -33.29, lng: 150.97, habitat: { soil: 'sand' },
  wombatIds: ['w1'], lastChecked: '2026-02-01', nextCheck: '2026-03-01', entranceHeightCm: 30, entranceWidthCm: 40,
  orientation: 'N', code: 'B0001', squadId: 's1',
};
const treatment = {
  id: 't1', wombatId: 'w1', at: '2026-02-01', by: 'Alice', product: 'cydectin', dose: '2ml', method: 'burrow_flap',
  severity: 3, regions: { head: 2 }, note: 'n', linkedBurrowId: 'b1', markedRecovered: false,
};
const sighting = { id: 's1', wombatId: 'w1', at: '2026-02-01T10:00:00Z', lat: -33.29, lng: 150.97, note: 'n' };
const burrowLog = {
  id: 'l1', burrowId: 'b1', at: '2026-02-01', status: 'active', condition: 'good', occupants: 1, heightCm: 30,
  widthCm: 40, orientation: 'N', substrate: 'sand', vegetation: 'grass', note: 'n', by: 'Alice',
};
const wombatPhoto = { id: 'p1', wombatId: 'w1', isProfile: true, dataUrl: 'https://x/p1.jpg', at: '2026-02-01T10:00:00Z' };
const burrowPhoto = { id: 'p2', burrowId: 'b1', isProfile: false, dataUrl: 'https://x/p2.jpg', at: '2026-02-01T10:00:00Z' };

describe('round trips: app record → DB row → app record', () => {
  it.each([
    ['wombat', wombat, m.wombatToDb, m.dbToWombat],
    ['burrow', burrow, m.burrowToDb, m.dbToBurrow],
    ['treatment', treatment, m.treatmentToDb, m.dbToTreatment],
    ['sighting', sighting, m.sightingToDb, m.dbToSighting],
    ['burrowLog', burrowLog, m.burrowLogToDb, m.dbToBurrowLog],
    ['wombatPhoto', wombatPhoto, m.wombatPhotoToDb, m.dbToWombatPhoto],
    ['burrowPhoto', burrowPhoto, m.burrowPhotoToDb, m.dbToBurrowPhoto],
  ] as const)('%s', (_name, record, toDb, fromDb) => {
    const row = (toDb as (r: unknown, uid: string) => Record<string, unknown>)(record, UID);
    expect(row.created_by).toBe(UID);
    const back = (fromDb as (r: unknown) => Record<string, unknown>)({ ...row, ...serverCols });
    expect(back).toMatchObject(record);
    expect(back._sync).toBe(true);
    expect(back._createdBy).toBe(UID);
  });
});

describe('quirks pinned from the legacy mappers', () => {
  it('reads the old status "mange" as under_treatment', () => {
    expect(m.dbToWombat(asRow({ ...m.wombatToDb(wombat, UID), ...serverCols, status: 'mange' })).status).toBe('under_treatment');
  });

  it('only burrows keep the server created_at (as _createdAt)', () => {
    expect(m.dbToBurrow(asRow({ ...m.burrowToDb(burrow, UID), ...serverCols }))._createdAt).toBe(serverCols.created_at);
    expect(m.dbToWombat(asRow({ ...m.wombatToDb(wombat, UID), ...serverCols }))).not.toHaveProperty('_createdAt');
  });

  it('turns falsy optional values into null, including 0 (lat 0, severity 0)', () => {
    expect(m.wombatToDb({ ...wombat, lat: 0, notes: '' }, UID)).toMatchObject({ lat: null, notes: null });
    expect(m.treatmentToDb({ ...treatment, severity: 0 }, UID).severity).toBeNull();
  });

  it('sends created_by null when there is no signed-in user', () => {
    expect(m.wombatToDb(wombat, undefined).created_by).toBeNull();
  });

  it('defaults empty collections', () => {
    const row = m.wombatToDb({ id: 'w2', name: 'X' }, UID);
    expect(row).toMatchObject({ severity: {}, burrow_ids: [], assignees: [], squad_id: null });
  });

  it('stamps photos with the current time when they have none', () => {
    const before = Date.now();
    const at = m.wombatPhotoToDb({ ...wombatPhoto, at: undefined }, UID).at;
    expect(Date.parse(at!)).toBeGreaterThanOrEqual(before);
  });
});
