/**
 * Replays the offline queue against Supabase. Ported from legacy `flushQueue` with identical behaviour.
 *
 * Per op, one of:
 * - success: dequeue, mark the local record synced, remember uploaded photo ids / completed deletes
 * - photo whose image data is gone everywhere: dequeue and report it as lost
 * - network failure (or offline, or the op threw): stop the whole flush, retry budget untouched
 * - auth failure: stop the whole flush until the user signs in again, retry budget untouched
 * - any other failure: charge one retry; at MAX_RETRIES the op is parked (`_failed`), kept on the device
 *   and shown to the volunteer to retry or discard (see failedOps.ts). Parked ops are skipped here.
 */
import { isAuthErrorStr, isNetworkError } from './classify';
import type { AppDb, QueueOp } from './idb/appDb';
import { markRecentlyDeleted } from './recentlyDeleted';
import { sortQueue } from './queue';
import type { Remote } from './remote';

export const MAX_RETRIES = 5;

const PHOTO_TABLES = new Set(['wombat_photos', 'burrow_photos']);
/** localStorage keys the photo upload patches with the new URL (legacy SK.wp / SK.bp). */
const PHOTO_LOCAL_STORAGE_KEYS: Record<string, string> = {
  wombat_photos: 'ww2_wombat_photos',
  burrow_photos: 'ww2_burrow_photos',
};

export interface FlushDeps {
  appDb: Pick<AppDb, 'getQueue' | 'dequeue' | 'updateQueueOp' | 'markSynced' | 'metaGet' | 'metaSet'>;
  remote: Pick<Remote, 'upsert' | 'remove' | 'removeStorage'>;
  /** Image data kept on the device for a photo, or null. */
  getLocalPhoto: (photoId: string) => Promise<string | null>;
  /** Uploads base64 image data to Storage and returns its URL; passes URLs through; falls back to the base64. */
  resolvePhotoUrl: (dataUrl: string, photoId: string, localStorageKey: string) => Promise<string | null>;
  isOnline: () => boolean;
  /** Unused since bug #2 (parked ops are shown in the app instead of an alert); kept for callers. */
  notify?: (message: string) => void;
  now?: () => number;
}

export interface FlushResult {
  /** Photos uploaded in this flush; callers force-refresh their cached image data. */
  uploadedPhotoIds: Set<string>;
  /** Photo ops discarded because no image data was left to upload. */
  lostPhotoIds: Set<string>;
}

type Outcome = { ok: boolean; skip: boolean; error: string };

async function runOp(op: QueueOp, userId: string, deps: FlushDeps): Promise<Outcome> {
  if (op.t === 'upsert') {
    let row: Record<string, unknown> = { ...op.row, created_by: op.row.created_by || userId };
    if (PHOTO_TABLES.has(op.table)) {
      const lsKey = PHOTO_LOCAL_STORAGE_KEYS[op.table]!;
      const dataUrl = row.data_url as string | null | undefined;
      if (dataUrl && dataUrl.startsWith('data:')) {
        row = { ...row, data_url: await deps.resolvePhotoUrl(dataUrl, row.id as string, lsKey) };
        // Legacy then tried to write the URL into the stored photo record, but looked the store up by the
        // localStorage key, so it never ran (bug #13). Intentionally not reproduced as a write.
      } else if (!dataUrl) {
        const local = await deps.getLocalPhoto(row.id as string);
        if (!local) {
          console.warn('[Queue] Photo blob missing from IDB, discarding op:', row.id);
          return { ok: false, skip: true, error: '' };
        }
        row = { ...row, data_url: await deps.resolvePhotoUrl(local, row.id as string, lsKey) };
      }
    }
    const r = await deps.remote.upsert(op.table, row);
    return { ok: r.ok, skip: false, error: r.error ?? '' };
  }
  if (op.t === 'delete') {
    const r = await deps.remote.remove(op.table, op.id);
    return { ok: r.ok, skip: false, error: r.error ?? '' };
  }
  const r = await deps.remote.removeStorage(op.path);
  return { ok: r.ok, skip: false, error: r.error ?? '' };
}

export async function flushQueue(userId: string, deps: FlushDeps): Promise<FlushResult> {
  const result: FlushResult = { uploadedPhotoIds: new Set(), lostPhotoIds: new Set() };
  // Offline: don't burn an op on a guaranteed network error.
  if (!deps.isOnline()) return result;
  try {
    const queue = await deps.appDb.getQueue();
    if (!queue.length) return result;
    for (const op of sortQueue(queue.filter((op) => !op._failed))) {
      let outcome: Outcome;
      let networkError = false;
      try {
        outcome = await runOp(op, userId, deps);
        if (!outcome.ok && !outcome.skip) networkError = isNetworkError(outcome.error, deps.isOnline());
      } catch (e) {
        console.warn('[Queue] op threw:', op.t, 'table' in op ? op.table : op.path, e);
        // Uncaught exceptions are almost always the network.
        outcome = { ok: false, skip: false, error: '' };
        networkError = true;
      }

      if (outcome.skip) {
        if (op.t === 'upsert') result.lostPhotoIds.add(op.row?.id as string);
        await deps.appDb.dequeue(op._qid);
      } else if (outcome.ok) {
        // Marking synced lets later full syncs treat the server copy as authoritative again.
        await deps.appDb.dequeue(op._qid);
        if (op.t === 'upsert' && op.row?.id) {
          await deps.appDb.markSynced(op.table, op.row.id as string);
          if (PHOTO_TABLES.has(op.table)) result.uploadedPhotoIds.add(op.row.id as string);
        } else if (op.t === 'delete' && op.id) {
          await markRecentlyDeleted(op.id, deps.appDb);
        }
      } else if (networkError) {
        console.warn('[Queue] Network error — pausing flush, will retry on reconnect:', op.t);
        break;
      } else if (isAuthErrorStr(outcome.error)) {
        console.warn('[Queue] Auth error — pausing flush until re-auth:', op.t);
        break;
      } else {
        const retries = (op._retries || 0) + 1;
        if (retries >= MAX_RETRIES) {
          console.warn('[Queue] Parking op after', retries, 'failures:', op.t, outcome.error);
          await deps.appDb.updateQueueOp({ ...op, _retries: retries, _failed: true, _error: outcome.error, _failedAt: (deps.now ?? Date.now)() });
        } else {
          await deps.appDb.updateQueueOp({ ...op, _retries: retries });
        }
      }
    }
  } catch (e) {
    console.warn('[Queue] flush error', e);
  }
  return result;
}
