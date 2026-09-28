/** Adding writes to the offline queue (IndexedDB `queue` store), and the order the flush replays them in. */
import type { AppDb, NewQueueOp, QueueOp } from './idb/appDb';

export const BACKGROUND_SYNC_TAG = 'ww-queue-flush';

export const QUEUE_WRITE_FAILED_MESSAGE =
  '⚠️ Could not save this record for offline sync.\n\n' +
  'Your device storage may be full. Please free up space and check ' +
  'that your data was saved before closing the app.';

export interface QueueDeps {
  appDb: Pick<AppDb, 'enqueue'>;
  /** Tells the volunteer something went wrong (legacy: window.alert). */
  notify: (message: string) => void;
  /** Asks the browser to wake the service worker once connectivity is stable. No-op where unsupported (iOS). */
  registerBackgroundSync: () => void;
}

/** Saves an op for later upload. Never throws: a failed write is reported to the volunteer instead. */
export async function queueOp(op: NewQueueOp, deps: QueueDeps): Promise<void> {
  try {
    await deps.appDb.enqueue(op);
  } catch (e) {
    const where = 'table' in op ? op.table : op.path;
    console.error('[Queue] IDB write failed — record may be lost:', op.t, where, e);
    try {
      deps.notify(QUEUE_WRITE_FAILED_MESSAGE);
    } catch {
      // Nothing more we can do.
    }
  }
  try {
    deps.registerBackgroundSync();
  } catch {
    // Unsupported browser.
  }
}

/** Browser implementation of QueueDeps.registerBackgroundSync. */
export function registerBrowserBackgroundSync(): void {
  type SyncRegistration = ServiceWorkerRegistration & { sync?: { register(tag: string): Promise<void> } };
  navigator.serviceWorker?.ready
    .then((r) => (r as SyncRegistration).sync?.register(BACKGROUND_SYNC_TAG))
    .catch(() => {});
}

/** Parents before children so foreign keys hold: wombats/burrows → treatments/sightings/logs → photos → storage deletes. */
const TABLE_PRIORITY: Record<string, number> = {
  wombats: 0,
  burrows: 0,
  treatments: 1,
  sightings: 1,
  burrow_logs: 1,
  wombat_photos: 2,
  burrow_photos: 2,
};
const priority = (op: QueueOp) => (op.t === 'storage-delete' ? 3 : (TABLE_PRIORITY[op.table] ?? 1));

/** Stable sort (queue order kept within a priority). Returns a new array. */
export const sortQueue = (ops: readonly QueueOp[]): QueueOp[] => [...ops].sort((a, b) => priority(a) - priority(b));
