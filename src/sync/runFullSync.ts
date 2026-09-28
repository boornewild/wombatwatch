/**
 * The one full-sync routine used everywhere a full sync runs (sign-in, reconnect before and after the upload,
 * the daily background sync, switching squad). Before Phase 3.7 there were five hand-copied versions that had
 * drifted; this is the sign-in version, which was the most complete.
 *
 *   'synced'   merged server + local data replaced state; photos refreshed; duplicate codes fixed everywhere
 *   'new-user' the server has nothing for this user and the device has nothing to lose: state cleared
 *   'skipped'  offline, or superseded by a newer sync / squad switch: state untouched
 *
 * Flushing the upload queue is left to callers, because reconnect flushes *between* two syncs.
 */
import { deduplicateCodes } from '../domain/codes';
import type { AppData, BurrowPhoto, WombatPhoto } from '../domain/types';
import type { Action } from '../state/actions';
import { filterToSquad } from './merge';
import type { FullSyncResult } from './pull';
import type { SyncSession } from './session';

export type FullSyncOutcome = 'synced' | 'new-user' | 'skipped';

export interface RunFullSyncDeps {
  session: SyncSession;
  fullSync: () => Promise<FullSyncResult | null | undefined>;
  /** Re-applies edits made while the fetch was in flight (legacy resolveWithCurrentQueue). */
  resolveWithQueue: (merged: FullSyncResult) => Promise<AppData>;
  dispatch: (action: Action) => void;
  getAllLocalPhotos: () => Promise<Record<string, string>>;
  cacheRemotePhotos: (wp: WombatPhoto[], bp: BurrowPhoto[], dispatch: (a: Action) => void, forced?: Set<string>) => Promise<void>;
  recoverBlankPhotos: (wp: WombatPhoto[], bp: BurrowPhoto[], dispatch: (a: Action) => void) => Promise<void>;
  /** Writes a renumbered code to Supabase (fire-and-forget). */
  patchCode: (table: 'wombats' | 'burrows', id: string, code: string) => void;
  /** Fills in missing suburb names for records created offline (fire-and-forget). */
  geocodeBackfill: (data: AppData, dispatch: (a: Action) => void) => void;
}

const EMPTY: AppData = { wombats: [], burrows: [], treatments: [], sightings: [], burrowLogs: [], wombatPhotos: [], burrowPhotos: [] };

export async function runFullSync(deps: RunFullSyncDeps, opts: { forcedPhotoIds?: Set<string> } = {}): Promise<FullSyncOutcome> {
  const { dispatch } = deps;
  const merged = await deps.fullSync();
  if (merged === undefined) return 'skipped';
  if (merged === null) {
    dispatch({ type: 'REPLACE_ALL', data: { ...EMPTY } });
    return 'new-user';
  }
  const fresh = await deps.resolveWithQueue(merged);
  // Two volunteers offline can both get the same W/B number; renumber duplicates and tell the server.
  const { records: wombats, changed: changedW } = deduplicateCodes(fresh.wombats, 'W');
  const { records: burrows, changed: changedB } = deduplicateCodes(fresh.burrows, 'B');
  const synced = filterToSquad({ ...fresh, wombats, burrows }, deps.session.currentSquadId);
  dispatch({ type: 'REPLACE_ALL', data: synced });

  // Everything below is best effort and must never fail the sync.
  // REPLACE_ALL carries records without image data; put on-device images back.
  deps
    .getAllLocalPhotos()
    .then((map) => {
      if (Object.keys(map).length) dispatch({ type: 'HYDRATE_PHOTO_DATA', map });
    })
    .catch(() => {});
  const quietly = (f: () => Promise<void> | void) => {
    try {
      Promise.resolve(f()).catch(() => {});
    } catch {
      // Ignored.
    }
  };
  quietly(() => deps.cacheRemotePhotos(synced.wombatPhotos, synced.burrowPhotos, dispatch, opts.forcedPhotoIds));
  quietly(() => deps.recoverBlankPhotos(synced.wombatPhotos, synced.burrowPhotos, dispatch));
  changedW.forEach((w) => quietly(() => deps.patchCode('wombats', w.id, w.code as string)));
  changedB.forEach((b) => quietly(() => deps.patchCode('burrows', b.id, b.code as string)));
  quietly(() => deps.geocodeBackfill(synced, dispatch));
  return 'synced';
}
