/**
 * Pulling server data: full sync (every row, merged with local state) and incremental sync (rows updated since
 * the last sync). Ported from legacy `supaFullSync` / `supaIncrementalSync` with the same return contract:
 *   full:        merged data | null (confirmed new user) | undefined (offline, or stale: a newer sync or a squad
 *                switch happened mid-flight — leave local state alone)
 *   incremental: changed rows | null (no baseline, or every query failed) | undefined (stale)
 */
import {
  dbToBurrow,
  dbToBurrowLog,
  dbToBurrowPhoto,
  dbToSighting,
  dbToTreatment,
  dbToWombat,
  dbToWombatPhoto,
} from '../data/mappers';
import type { AppData } from '../domain/types';
import type { AppDb } from './idb/appDb';
import { STORE_NAMES } from './idb/appDb';
import { filterToSquad, isConfirmedNewUser, mergeTable, pendingSets, type SyncRecord } from './merge';
import type { Remote } from './remote';
import type { SyncSession } from './session';

export const LAST_SYNC_TS_KEY = 'ww_last_sync_ts';
export const LAST_FULL_SYNC_DATE_KEY = 'ww_last_full_sync_date';

/** Photo image data is not pulled in bulk (it can be megabytes of base64); photos.ts fetches it per photo. */
const TABLES = [
  ['wombats', '*'],
  ['burrows', '*'],
  ['treatments', '*'],
  ['sightings', '*'],
  ['burrow_logs', '*'],
  ['wombat_photos', 'id,wombat_id,is_profile,at,created_by'],
  ['burrow_photos', 'id,burrow_id,is_profile,at,created_by'],
] as const;

export interface PullDeps {
  session: SyncSession;
  fetchTable: Remote['fetchTable'];
  appDb: Pick<AppDb, 'getQueue' | 'getAll'>;
  getRecentlyDeleted: () => Promise<Set<string>>;
  storage: Pick<Storage, 'getItem' | 'setItem'>;
  now?: () => Date;
}

export type FullSyncResult = AppData & { _fetchStart: number };
type Settled = PromiseSettledResult<{ data: unknown[] | null; error: { message: string } | null }>;

const fetchAll = (deps: PullDeps, since?: string) =>
  Promise.allSettled(TABLES.map(([table, cols]) => Promise.resolve(deps.fetchTable(table, cols, since)))) as Promise<Settled[]>;

const succeeded = (r: Settled) => r.status === 'fulfilled' && !r.value?.error;

export async function supaFullSync(deps: PullDeps): Promise<FullSyncResult | null | undefined> {
  const { session } = deps;
  const now = deps.now ?? (() => new Date());
  const seq = session.nextSeq();
  const squadAtStart = session.currentSquadId;
  // Edits pushed after this moment beat the (older) server reply; see resolveWithQueue.
  const fetchStart = now().getTime();
  const results = await fetchAll(deps);
  const rows = results.map((r, i) => {
    const table = TABLES[i]![0];
    if (r.status === 'rejected') {
      console.warn('[Supa] sync failed for', table, r.reason);
      return null;
    }
    if (r.value?.error) {
      console.warn('[Supa] sync error for', table, r.value.error.message);
      return null;
    }
    return r.value?.data || null;
  });
  // Every query failed: almost certainly offline.
  if (!results.some(succeeded)) return undefined;

  let pendingOps: Awaited<ReturnType<AppDb['getQueue']>> = [];
  try {
    pendingOps = await deps.appDb.getQueue();
  } catch {
    // Treat as empty.
  }
  const { queuedIds, deletedIds, hasPendingUpserts } = pendingSets(pendingOps);
  const local: Record<string, SyncRecord[]> = {};
  await Promise.all(
    Object.entries(STORE_NAMES).map(async ([k, store]) => {
      try {
        local[k] = await deps.appDb.getAll(store);
      } catch {
        local[k] = [];
      }
    }),
  );
  const [w, b, t, s, bl, wp, bp] = rows as (Record<string, unknown>[] | null)[];
  const localHasData = local.w!.length > 0 || local.b!.length > 0;
  if (isConfirmedNewUser({ remoteWombats: w, remoteBurrows: b, hasPendingUpserts, localHasData })) return null;
  const recentlyDeleted = await deps.getRecentlyDeleted();
  const merge = (remote: Record<string, unknown>[] | null, key: string, fromDb: (r: never) => unknown) =>
    mergeTable({
      remote: remote as { id: string }[] | null,
      local: local[key],
      queuedIds,
      deletedIds,
      recentlyDeleted,
      currentSquadId: session.currentSquadId,
      fromDb: fromDb as (r: { id: string }) => SyncRecord,
    });

  // A null start only means the sync began before the squad loaded; use whatever is current now.
  const filterSquadId = squadAtStart || session.currentSquadId;
  if (squadAtStart && session.currentSquadId && squadAtStart !== session.currentSquadId) {
    console.info('[Squad] supaFullSync discarding stale result — squad changed mid-flight');
    return undefined;
  }
  if (!session.isLatest(seq)) {
    console.info('[Sync] supaFullSync discarding stale result — newer sync in progress');
    return undefined;
  }
  // Baseline for incremental syncs, and the date the background timer checks for its daily full sync.
  deps.storage.setItem(LAST_SYNC_TS_KEY, now().toISOString());
  deps.storage.setItem(LAST_FULL_SYNC_DATE_KEY, now().toDateString());
  return filterToSquad(
    {
      _fetchStart: fetchStart,
      wombats: merge(w!, 'w', dbToWombat),
      burrows: merge(b!, 'b', dbToBurrow),
      treatments: merge(t!, 't', dbToTreatment),
      sightings: merge(s!, 's', dbToSighting),
      burrowLogs: merge(bl!, 'bl', dbToBurrowLog),
      wombatPhotos: merge(wp!, 'wp', dbToWombatPhoto),
      burrowPhotos: merge(bp!, 'bp', dbToBurrowPhoto),
    } as unknown as FullSyncResult,
    filterSquadId,
  );
}

/**
 * Rows changed since the last sync. Relies on every synced table bumping updated_at on UPDATE (wombats and
 * burrows got their triggers in migration 20261005000000). Does not see deletions; the daily full sync does.
 */
export async function supaIncrementalSync(deps: PullDeps): Promise<AppData | null | undefined> {
  const { session } = deps;
  const now = deps.now ?? (() => new Date());
  const lastTs = deps.storage.getItem(LAST_SYNC_TS_KEY);
  if (!lastTs) return null;
  const squadAtStart = session.currentSquadId;
  const seq = session.nextSeq();
  const syncStart = now().toISOString();
  try {
    const results = await fetchAll(deps, lastTs);
    if (!session.isLatest(seq)) return undefined;
    if (squadAtStart && session.currentSquadId && squadAtStart !== session.currentSquadId) return undefined;
    // All failed: offline or error; don't advance the baseline.
    if (!results.some(succeeded)) return null;
    const rows = (i: number) => (succeeded(results[i]!) ? ((results[i] as PromiseFulfilledResult<{ data: never[] | null }>).value?.data || []) : []);
    const data = filterToSquad(
      {
        wombats: rows(0).map(dbToWombat),
        burrows: rows(1).map(dbToBurrow),
        treatments: rows(2).map(dbToTreatment),
        sightings: rows(3).map(dbToSighting),
        burrowLogs: rows(4).map(dbToBurrowLog),
        wombatPhotos: rows(5).map(dbToWombatPhoto),
        burrowPhotos: rows(6).map(dbToBurrowPhoto),
      },
      session.currentSquadId,
    );
    deps.storage.setItem(LAST_SYNC_TS_KEY, syncStart);
    return data;
  } catch (e) {
    console.warn('[Sync] incremental failed:', e);
    return null;
  }
}
