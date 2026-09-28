/**
 * Saves the collections an action changed. Wraps the pure reducer so saving happens at the same moment it
 * did in the legacy reducer. Photo image data (base64 `data:` URLs) is stripped before saving; the
 * images themselves live in the IndexedDB photo store.
 */
import type { AppData } from '../domain/types';
import type { Action } from './actions';

/** Legacy storage keys (SK/STORE in LegacyApp) for each collection. */
export const COLLECTION_KEYS = {
  wombats: 'w',
  burrows: 'b',
  treatments: 't',
  sightings: 's',
  burrowLogs: 'bl',
  wombatPhotos: 'wp',
  burrowPhotos: 'bp',
} as const satisfies Record<keyof AppData, string>;

export type CollectionKey = (typeof COLLECTION_KEYS)[keyof typeof COLLECTION_KEYS];
export type SaveCollection = (key: CollectionKey, records: unknown[]) => void;

const PHOTO_COLLECTIONS = new Set<keyof AppData>(['wombatPhotos', 'burrowPhotos']);
/** Actions that only change what's in memory. */
const MEMORY_ONLY = new Set<Action['type']>(['HYDRATE_PHOTO_DATA']);
/**
 * Legacy behaviour kept exactly: incremental sync re-saves every collection, even unchanged ones.
 * Known bug (pinned in tests): re-saving photos after HYDRATE_PHOTO_DATA replaces a saved https URL with null.
 */
const SAVES_EVERY_COLLECTION = new Set<Action['type']>(['PATCH_RECORDS']);

export const stripImageData = <T extends { dataUrl?: string | null }>(p: T): T =>
  p.dataUrl?.startsWith('data:') ? { ...p, dataUrl: null } : p;

export function persistChanges(prev: AppData, next: AppData, action: Action, save: SaveCollection): void {
  if (MEMORY_ONLY.has(action.type)) return;
  for (const name of Object.keys(COLLECTION_KEYS) as (keyof AppData)[]) {
    if (prev[name] === next[name] && !SAVES_EVERY_COLLECTION.has(action.type)) continue;
    const records = next[name] as Array<{ dataUrl?: string | null }>;
    save(COLLECTION_KEYS[name], PHOTO_COLLECTIONS.has(name) ? records.map(stripImageData) : records);
  }
}

export const withPersistence =
  (reduce: (state: AppData, action: Action) => AppData, save: SaveCollection) =>
  (state: AppData, action: Action): AppData => {
    const next = reduce(state, action);
    persistChanges(state, next, action, save);
    return next;
  };
