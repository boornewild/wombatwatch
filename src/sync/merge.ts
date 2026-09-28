/**
 * Pure merge logic for a full sync: how the server's rows and the device's IndexedDB records combine.
 * Ported from legacy `filterSyncToSquad`, `supaFullSync` (merge part) and `resolveWithCurrentQueue`.
 * No I/O: the caller reads IndexedDB and the queue, and passes the active squad in (it used to be the
 * `_currentSquadId` module global). Behaviour, including quirks, matches legacy exactly (see merge.test.ts).
 */
import type { AppData } from '../domain/types';
import { COLLECTION_KEYS, type CollectionKey } from '../state/persistence';

/** The fields merge reads on any record. `_pushedAt` is set by markSynced after a successful push. */
export type SyncRecord = {
  id: string;
  squadId?: string | null;
  _sync?: boolean;
  _pushedAt?: number;
  dataUrl?: string | null;
};

/** Just enough of a queue op for merging; the full shape belongs to the queue module. */
export type QueueOpLike = { t: string; id?: string | null; row?: { id?: string | null } | null };

export type IdSet = ReadonlySet<string>;

/** Local IndexedDB contents keyed by the legacy store keys (w, b, t, s, bl, wp, bp). */
export type LocalStores = Partial<Record<CollectionKey, SyncRecord[]>>;

type SquadScoped = { squadId?: string | null };

/**
 * A god-mode admin fetches every squad they belong to (RLS allows it); keep only the active squad.
 * Children are kept when their parent is in the squad. No squad means return `data` itself, unfiltered.
 */
export function filterToSquad<D extends AppData>(data: D, squadId: string | null | undefined): D {
  if (!squadId) return data;
  const wombats = data.wombats.filter((w) => w.squadId === squadId);
  const burrows = data.burrows.filter((b) => b.squadId === squadId);
  const wIds = new Set(wombats.map((w) => w.id));
  const bIds = new Set(burrows.map((b) => b.id));
  return {
    ...data,
    wombats,
    burrows,
    treatments: data.treatments.filter((t) => wIds.has(t.wombatId)),
    sightings: data.sightings.filter((s) => wIds.has(s.wombatId)),
    burrowLogs: data.burrowLogs.filter((l) => bIds.has(l.burrowId)),
    wombatPhotos: data.wombatPhotos.filter((p) => wIds.has(p.wombatId)),
    burrowPhotos: data.burrowPhotos.filter((p) => bIds.has(p.burrowId)),
  };
}

/** Ids with a pending upsert (local must win) or pending delete (must not reappear), from the offline queue. */
export function pendingSets(queue: readonly QueueOpLike[]): {
  queuedIds: Set<string>;
  deletedIds: Set<string>;
  hasPendingUpserts: boolean;
} {
  const queuedIds = new Set<string>();
  const deletedIds = new Set<string>();
  for (const op of queue) {
    if (op.t === 'upsert' && op.row && op.row.id) queuedIds.add(op.row.id);
    if (op.t === 'delete' && op.id) deletedIds.add(op.id);
  }
  // Counts upserts even without a row id: any offline write means this isn't an empty new account.
  return { queuedIds, deletedIds, hasPendingUpserts: queue.some((op) => op.t === 'upsert') };
}

/**
 * True only when the server has no wombats or burrows AND the device has nothing to lose.
 * The caller then clears local data, so pending upserts or local data must veto it.
 */
export function isConfirmedNewUser(args: {
  remoteWombats: readonly unknown[] | null | undefined;
  remoteBurrows: readonly unknown[] | null | undefined;
  hasPendingUpserts: boolean;
  localHasData: boolean;
}): boolean {
  const { remoteWombats, remoteBurrows, hasPendingUpserts, localHasData } = args;
  return (
    !(remoteWombats?.length || 0) && !(remoteBurrows?.length || 0) && !hasPendingUpserts && !localHasData
  );
}

const inSquad = (r: SquadScoped, currentSquadId: string | null | undefined): boolean =>
  !r.squadId || !currentSquadId || r.squadId === currentSquadId;

/**
 * Merge one table's server rows with its local records.
 * - `remote === null` (query failed): keep local untouched.
 * - Empty remote while synced local records exist: treat as a bad response (expired token, RLS edge case)
 *   and keep local minus deletes, so a 0-row reply never wipes synced data.
 * - Otherwise the server wins, except unsynced or queued local records from the active squad.
 * Output order follows object key order (integer-like ids first), exactly as legacy did.
 */
export function mergeTable<R extends { id: string }, T extends SyncRecord>(args: {
  remote: readonly R[] | null;
  local: readonly T[] | null | undefined;
  queuedIds: IdSet;
  deletedIds: IdSet;
  recentlyDeleted: IdSet;
  currentSquadId: string | null | undefined;
  fromDb: (row: R) => T;
}): T[] {
  const { remote, queuedIds, deletedIds, recentlyDeleted, currentSquadId, fromDb } = args;
  const local = (args.local || []) as T[];
  if (remote === null) return local;
  const isDeleted = (r: T) => deletedIds.has(r.id) || recentlyDeleted.has(r.id);
  const syncedLocalCount = local.filter((r) => r._sync && !isDeleted(r)).length;
  // Deliberately skips the squad filter below (legacy quirk, pinned in tests).
  if (remote.length === 0 && syncedLocalCount > 0) return local.filter((r) => !isDeleted(r));
  // A plain object, not a Map, to keep legacy ordering and last-write-wins on duplicate ids.
  const byId: Record<string, T> = Object.fromEntries(remote.map((r) => [r.id, fromDb(r)]));
  local
    .filter((r) => (!r._sync || queuedIds.has(r.id)) && inSquad(r, currentSquadId))
    .forEach((r) => {
      byId[r.id] = r;
    });
  return Object.values(byId).filter((r) => !isDeleted(r));
}

/** Tables merged by a full sync, in the order legacy returned them. */
const TABLES = Object.keys(COLLECTION_KEYS) as (keyof AppData)[];

/**
 * Re-apply the live queue and local store to a merged result just before REPLACE_ALL, because the user may
 * have edited while the fetch was in flight. Local wins when it has a queued op, is unsynced, or was pushed
 * after `fetchStart` (so the server reply is older than it). New local records made during the fetch are
 * appended. Returns only the seven tables (extra keys on `merged`, such as `_fetchStart`, are dropped).
 */
export function resolveWithQueue(args: {
  merged: AppData;
  local: LocalStores;
  queue: readonly QueueOpLike[];
  fetchStart: number | null | undefined;
  currentSquadId: string | null | undefined;
}): AppData {
  const { merged, local, queue, fetchStart, currentSquadId } = args;
  const { queuedIds, deletedIds } = pendingSets(queue);

  const localWins = (loc: SyncRecord | undefined, id: string): loc is SyncRecord => {
    if (!loc) return false;
    if (queuedIds.has(id)) return true;
    if (loc._sync === false) return true;
    return !!(loc._pushedAt && fetchStart && loc._pushedAt > fetchStart);
  };

  const fix = (items: readonly SyncRecord[], key: CollectionKey): SyncRecord[] => {
    const localRecords = local[key] || [];
    const localById: Record<string, SyncRecord> = Object.fromEntries(localRecords.map((r) => [r.id, r]));
    const out = items
      .map((r) => {
        const loc = localById[r.id];
        if (!localWins(loc, r.id)) return r;
        // Local image data may have been stripped to null; never blank a photo the server has a URL for.
        return loc.dataUrl == null && r.dataUrl ? { ...loc, dataUrl: r.dataUrl } : loc;
      })
      .filter((r) => !deletedIds.has(r.id));
    const outIds = new Set(out.map((r) => r.id));
    localRecords
      .filter(
        (r) =>
          (queuedIds.has(r.id) || !r._sync) &&
          !outIds.has(r.id) &&
          !deletedIds.has(r.id) &&
          inSquad(r, currentSquadId),
      )
      .forEach((r) => out.push(r));
    return out;
  };

  const result = {} as Record<keyof AppData, SyncRecord[]>;
  for (const table of TABLES) result[table] = fix(merged[table], COLLECTION_KEYS[table]);
  return result as unknown as AppData;
}
