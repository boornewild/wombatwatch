import { supaFullSync, supaIncrementalSync, LAST_SYNC_TS_KEY, LAST_FULL_SYNC_DATE_KEY, type PullDeps } from './pull';
import { createSyncSession } from './session';

type Answer = { data: unknown[] | null; error: { message: string } | null } | 'reject';
const TABLES = ['wombats', 'burrows', 'treatments', 'sightings', 'burrow_logs', 'wombat_photos', 'burrow_photos'];
const row = (id: string, extra: Record<string, unknown> = {}) => ({ id, name: 'n', squad_id: 'sq', wombat_id: 'w1', burrow_id: 'b1', at: '2026', ...extra });

function setup(opts: { answers?: Partial<Record<string, Answer>>; local?: Record<string, unknown[]>; queue?: unknown[]; storage?: Record<string, string>; squad?: string | null; during?: (s: ReturnType<typeof createSyncSession>) => void } = {}) {
  const session = createSyncSession();
  session.currentSquadId = opts.squad === undefined ? 'sq' : opts.squad;
  const store: Record<string, string> = { ...opts.storage };
  const fetched: unknown[] = [];
  const deps: PullDeps = {
    session,
    fetchTable: ((table: string, cols: string, since?: string) => {
      fetched.push([table, cols, since]);
      if (fetched.length === 7) opts.during?.(session);
      const a = opts.answers?.[table] ?? { data: [], error: null };
      return a === 'reject' ? Promise.reject(new Error('net')) : Promise.resolve(a);
    }) as never,
    appDb: { getQueue: async () => (opts.queue ?? []) as never, getAll: async (s: string) => (opts.local?.[s] ?? []) as never },
    getRecentlyDeleted: async () => new Set(),
    storage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => void (store[k] = v) },
    now: () => new Date('2026-09-28T01:00:00Z'),
  };
  return { deps, session, store, fetched };
}
const allFail = Object.fromEntries(TABLES.map((t) => [t, 'reject' as const]));

beforeEach(() => {
  for (const m of ['warn', 'info'] as const) vi.spyOn(console, m).mockImplementation(() => {});
});

describe('supaFullSync', () => {
  it('returns undefined when every query fails (offline) and writes no timestamps', async () => {
    const s = setup({ answers: allFail });
    expect(await supaFullSync(s.deps)).toBeUndefined();
    expect(s.store).toEqual({});
  });
  it('returns null for a genuinely new user (nothing anywhere)', async () => {
    expect(await supaFullSync(setup().deps)).toBeNull();
  });
  it('is not a new user when there are pending offline writes', async () => {
    const s = setup({ queue: [{ t: 'upsert', row: { id: 'w9' } }], local: { wombats: [{ id: 'w9', name: 'x', squadId: 'sq', _sync: false }] } });
    expect((await supaFullSync(s.deps))!.wombats.map((w) => w.id)).toEqual(['w9']);
  });
  it('merges, filters to the squad, stamps _fetchStart and records both timestamps', async () => {
    const s = setup({ answers: { wombats: { data: [row('w1'), row('w2', { squad_id: 'other' })], error: null } } });
    const r = await supaFullSync(s.deps);
    expect(r!.wombats.map((w) => w.id)).toEqual(['w1']);
    expect(r!._fetchStart).toBe(Date.parse('2026-09-28T01:00:00Z'));
    expect(s.store).toEqual({ [LAST_SYNC_TS_KEY]: '2026-09-28T01:00:00.000Z', [LAST_FULL_SYNC_DATE_KEY]: new Date('2026-09-28T01:00:00Z').toDateString() });
  });
  it('never pulls photo image data in bulk', async () => {
    const s = setup({ answers: { wombats: { data: [row('w1')], error: null } } });
    await supaFullSync(s.deps);
    expect(s.fetched).toContainEqual(['wombat_photos', 'id,wombat_id,is_profile,at,created_by', undefined]);
  });
  it('discards the result if the squad changes mid-flight', async () => {
    const s = setup({ answers: { wombats: { data: [row('w1')], error: null } }, during: (x) => (x.currentSquadId = 'other') });
    expect(await supaFullSync(s.deps)).toBeUndefined();
    expect(s.store).toEqual({});
  });
  it('discards the result if a newer sync started mid-flight', async () => {
    const s = setup({ answers: { wombats: { data: [row('w1')], error: null } }, during: (x) => x.nextSeq() });
    expect(await supaFullSync(s.deps)).toBeUndefined();
  });
  it('a failed table keeps its local records', async () => {
    const local = { treatments: [{ id: 't1', wombatId: 'w1', _sync: true }] };
    const s = setup({ answers: { wombats: { data: [row('w1')], error: null }, treatments: { data: null, error: { message: 'rls' } } }, local });
    expect((await supaFullSync(s.deps))!.treatments.map((t) => t.id)).toEqual(['t1']);
  });
});

describe('supaIncrementalSync', () => {
  it('needs a baseline timestamp', async () => {
    expect(await supaIncrementalSync(setup().deps)).toBeNull();
  });
  it('asks only for rows updated since the baseline, then advances it', async () => {
    const s = setup({ storage: { [LAST_SYNC_TS_KEY]: '2026-09-27T00:00:00.000Z' }, answers: { treatments: { data: [{ id: 't1', wombat_id: 'w1', at: 'x' }], error: null }, wombats: { data: [row('w1')], error: null } } });
    const r = await supaIncrementalSync(s.deps);
    expect(s.fetched[0]).toEqual(['wombats', '*', '2026-09-27T00:00:00.000Z']);
    expect(r!.treatments.map((t) => t.id)).toEqual(['t1']);
    expect(s.store[LAST_SYNC_TS_KEY]).toBe('2026-09-28T01:00:00.000Z');
  });
  it('all failures: null and the baseline stays', async () => {
    const s = setup({ storage: { [LAST_SYNC_TS_KEY]: 'T0' }, answers: allFail });
    expect(await supaIncrementalSync(s.deps)).toBeNull();
    expect(s.store[LAST_SYNC_TS_KEY]).toBe('T0');
  });
  it('stale when a newer sync started', async () => {
    const s = setup({ storage: { [LAST_SYNC_TS_KEY]: 'T0' }, during: (x) => x.nextSeq() });
    expect(await supaIncrementalSync(s.deps)).toBeUndefined();
  });
});
