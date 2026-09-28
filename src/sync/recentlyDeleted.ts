/**
 * IDs whose delete already reached Supabase. A full sync that was in flight when the delete landed still
 * returns the record, and its queue op is gone by then, so without this list the record reappears.
 * Entries expire after 30 minutes: long enough to outlast a slow flush after reconnecting.
 */
import type { AppDb } from './idb/appDb';

export const RECENTLY_DELETED_TTL_MS = 30 * 60 * 1000;
const KEY = 'recently_deleted';
type Entry = { id: string; ts: number };
type MetaStore = Pick<AppDb, 'metaGet' | 'metaSet'>;

export async function markRecentlyDeleted(id: string, db: MetaStore, now: () => number = Date.now): Promise<void> {
  try {
    const existing = (await db.metaGet<Entry[]>(KEY)) || [];
    const t = now();
    const pruned = existing.filter((e) => t - e.ts < RECENTLY_DELETED_TTL_MS);
    pruned.push({ id, ts: t });
    await db.metaSet(KEY, pruned);
  } catch {
    // Best effort: worst case a deleted record flashes back until the next sync.
  }
}

export async function getRecentlyDeleted(db: MetaStore, now: () => number = Date.now): Promise<Set<string>> {
  try {
    const entries = (await db.metaGet<Entry[]>(KEY)) || [];
    const t = now();
    return new Set(entries.filter((e) => t - e.ts < RECENTLY_DELETED_TTL_MS).map((e) => e.id));
  } catch {
    return new Set();
  }
}
