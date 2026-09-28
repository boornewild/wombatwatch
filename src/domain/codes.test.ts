import { nextWombatCode, nextBurrowCode, deduplicateCodes } from './codes';

describe('nextWombatCode', () => {
  it('starts at W0001', () => expect(nextWombatCode([])).toBe('W0001'));
  it('fills the lowest gap', () => expect(nextWombatCode([{ code: 'W0001' }, { code: 'W0003' }])).toBe('W0002'));
  it('ignores missing or empty codes', () => expect(nextWombatCode([{ code: null }, {}, { code: '' }])).toBe('W0001'));
  it('goes past 9999 without padding', () => {
    const all = Array.from({ length: 9999 }, (_, i) => ({ code: 'W' + String(i + 1).padStart(4, '0') }));
    expect(nextWombatCode(all)).toBe('W10000');
  });
});

it('nextBurrowCode uses the B prefix', () => expect(nextBurrowCode([{ code: 'B0001' }])).toBe('B0002'));

describe('deduplicateCodes', () => {
  it('earliest record keeps the code; the later duplicate gets the next number after the max', () => {
    const a = { id: 'a', code: 'W0001', createdAt: '2026-01-01' };
    const b = { id: 'b', code: 'W0001', createdAt: '2026-02-01' };
    const c = { id: 'c', code: 'W0005', createdAt: '2026-03-01' };
    const r = deduplicateCodes([b, c, a], 'W');
    expect(r.records.find((x) => x.id === 'a')!.code).toBe('W0001');
    expect(r.records.find((x) => x.id === 'b')!.code).toBe('W0006');
    expect(r.changed.map((x) => x.id)).toEqual(['b']);
  });

  // Characterisation: records from the DB mappers carry no `createdAt` (burrows have `_createdAt`,
  // wombats have nothing), so in production input order decides who keeps a duplicated code.
  // Pinned here so the move to TypeScript can't change it silently; fixing it is a separate change.
  it('without createdAt, the first record in the input keeps the code', () => {
    const r = deduplicateCodes([{ id: 'later', code: 'W0001' }, { id: 'earlier', code: 'W0001' }], 'W');
    expect(r.records.find((x) => x.id === 'later')!.code).toBe('W0001');
    expect(r.changed.map((x) => x.id)).toEqual(['earlier']);
  });

  it('assigns codes to records that have none', () => {
    const r = deduplicateCodes([{ id: 'a', code: '' }], 'B');
    expect(r.records[0]!.code).toBe('B0001');
    expect(r.changed).toHaveLength(1);
  });

  it('changes nothing when codes are unique', () => {
    const r = deduplicateCodes([{ id: 'a', code: 'W0001' }, { id: 'b', code: 'W0002' }], 'W');
    expect(r.changed).toEqual([]);
  });

  it('does not mutate the input records', () => {
    const input = [Object.freeze({ id: 'a', code: 'W0001', createdAt: '2026-01-01' }), Object.freeze({ id: 'b', code: 'W0001', createdAt: '2026-02-01' })];
    expect(() => deduplicateCodes(input, 'W')).not.toThrow();
    expect(input[1]!.code).toBe('W0001');
  });
});
