/**
 * IndexedDB store for app records, the offline sync queue and small metadata (legacy `openAppDb` + `idb*`).
 * Records live here rather than in localStorage because iOS Safari evicts localStorage under storage pressure.
 *
 * Failure semantics are copied from legacy on purpose, and differ per method. Most methods `return` the
 * request promise without awaiting it inside their `try`, so only a failed *open* falls back to the default
 * ([] / null / undefined); a failed request still rejects. Callers depend on this split, so keep it.
 */

/** Legacy `STORE`: state collection key → object store name. */
export const STORE_NAMES = {
  w: 'wombats',
  b: 'burrows',
  t: 'treatments',
  s: 'sightings',
  bl: 'burrow_logs',
  wp: 'wombat_photos',
  bp: 'burrow_photos',
} as const;

export type RecordStoreName = (typeof STORE_NAMES)[keyof typeof STORE_NAMES];
export type IdbRecord = { id: string; [key: string]: unknown };

export const APP_DB_NAME = 'wombatwatch_v1';
const APP_DB_VERSION = 1;
const QUEUE = 'queue';
const META = 'meta';

/** Ops written by the legacy app and the new one share this shape; old queues must still flush. */
export type NewQueueOp =
  | { t: 'upsert'; table: string; row: Record<string, unknown> }
  | { t: 'delete'; table: string; id: string }
  | { t: 'storage-delete'; path: string };
/**
 * `_failed`: the database rejected this op MAX_RETRIES times. It stays on the device (never deleted
 * automatically), is skipped by the flush, and is shown to the volunteer to retry or discard.
 */
export type QueueOp = NewQueueOp & { _qid: number; _retries: number; _failed?: boolean; _error?: string; _failedAt?: number };

/** Only core data counts towards the "N pending" badge; photo blobs and storage deletes are noise there. */
const DATA_TABLES = new Set(['wombats', 'burrows', 'treatments', 'burrow_logs', 'sightings']);

/** localStorage keys the pre-IndexedDB app wrote, keyed like STORE_NAMES. */
const LEGACY_LS_KEYS: Record<keyof typeof STORE_NAMES, string> = {
  w: 'ww2_wombats',
  b: 'ww2_burrows',
  t: 'ww2_treatments',
  s: 'ww2_sightings',
  bl: 'ww2_burrow_logs',
  wp: 'ww2_wombat_photos',
  bp: 'ww2_burrow_photos',
};

type RequestLike = { error: DOMException | null };
const targetError = (e: Event) => (e.target as unknown as RequestLike).error;

export interface AppDbOptions {
  name?: string;
  /** Read lazily, so a missing IndexedDB behaves like a failed open (legacy fallback) instead of throwing on import. */
  idb?: IDBFactory;
}

export function createAppDb({ name = APP_DB_NAME, idb }: AppDbOptions = {}) {
  // Cached connection. Not reset on close, matching legacy (only the photo store retries).
  let cached: IDBDatabase | null = null;

  function open(): Promise<IDBDatabase> {
    if (cached) return Promise.resolve(cached);
    return new Promise((res, rej) => {
      const req = (idb ?? indexedDB).open(name, APP_DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        Object.values(STORE_NAMES).forEach((s) => {
          if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' });
        });
        if (!db.objectStoreNames.contains(QUEUE))
          db.createObjectStore(QUEUE, { keyPath: '_qid', autoIncrement: true });
        if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: 'key' });
      };
      req.onsuccess = () => {
        cached = req.result;
        res(cached);
      };
      req.onerror = () => rej(req.error);
    });
  }

  /** Replaces a store's contents. Resolves undefined on open failure; rejects on a bad store or record. */
  async function saveAll(store: string, records: readonly unknown[]): Promise<void> {
    try {
      const db = await open();
      return new Promise<void>((res, rej) => {
        const tx = db.transaction(store, 'readwrite');
        const s = tx.objectStore(store);
        s.clear();
        records.forEach((r) => s.put(r));
        tx.oncomplete = () => res();
        tx.onerror = (e) => rej(targetError(e));
      });
    } catch (e) {
      console.error('[IDB] idbSaveAll failed:', store, e);
    }
  }

  async function getAll<T = IdbRecord>(store: string): Promise<T[]> {
    try {
      const db = await open();
      return new Promise<T[]>((res, rej) => {
        const req = db.transaction(store, 'readonly').objectStore(store).getAll();
        req.onsuccess = () => res(req.result || []);
        req.onerror = () => rej(req.error);
      });
    } catch {
      return [];
    }
  }

  async function getOne<T = IdbRecord>(store: string, id: IDBValidKey): Promise<T | null> {
    try {
      const db = await open();
      return new Promise<T | null>((res, rej) => {
        const req = db.transaction(store, 'readonly').objectStore(store).get(id);
        req.onsuccess = () => res(req.result || null);
        req.onerror = () => rej(req.error);
      });
    } catch {
      return null;
    }
  }

  /**
   * Flags one record as pushed: a single put instead of a full saveAll. `_pushedAt` lets a full sync keep
   * edits made while it was in flight. Never throws; a missed flag only means one extra push later.
   */
  async function markSynced(store: string, id: IDBValidKey, now: () => number = Date.now): Promise<void> {
    try {
      const db = await open();
      const rec = await new Promise<Record<string, unknown> | null>((res, rej) => {
        const req = db.transaction(store, 'readonly').objectStore(store).get(id);
        req.onsuccess = () => res(req.result || null);
        req.onerror = () => rej(req.error);
      });
      if (!rec) return;
      await new Promise<void>((res, rej) => {
        const tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).put({ ...rec, _sync: true, _pushedAt: now() });
        tx.oncomplete = () => res();
        tx.onerror = (e) => rej(targetError(e));
      });
    } catch {
      // Swallowed like legacy.
    }
  }

  /** Adds an op; IndexedDB assigns `_qid`. Throws on any failure so the caller knows the edit wasn't saved. */
  async function enqueue(op: NewQueueOp & { _retries?: number }): Promise<void> {
    const db = await open();
    return new Promise<void>((res, rej) => {
      const tx = db.transaction(QUEUE, 'readwrite');
      tx.objectStore(QUEUE).add({ ...op, _retries: op._retries || 0 });
      tx.oncomplete = () => res();
      tx.onerror = (e) => rej(targetError(e));
    });
  }

  async function getQueue(): Promise<QueueOp[]> {
    return getAll<QueueOp>(QUEUE);
  }

  async function dequeue(qid: number): Promise<void> {
    try {
      const db = await open();
      return new Promise<void>((res, rej) => {
        const tx = db.transaction(QUEUE, 'readwrite');
        tx.objectStore(QUEUE).delete(qid);
        tx.oncomplete = () => res();
        tx.onerror = (e) => rej(targetError(e));
      });
    } catch {
      // Open failure only; request errors reject (see file comment).
    }
  }

  /** Rewrites an op in place (keyed by its `_qid`), e.g. to bump `_retries`. */
  async function updateQueueOp(op: QueueOp): Promise<void> {
    try {
      const db = await open();
      return new Promise<void>((res, rej) => {
        const tx = db.transaction(QUEUE, 'readwrite');
        tx.objectStore(QUEUE).put(op);
        tx.oncomplete = () => res();
        tx.onerror = (e) => rej(targetError(e));
      });
    } catch {
      // Open failure only; request errors reject (see file comment).
    }
  }

  /** Pending ops for core data tables, excluding parked (failed) ones. Never throws: the badge just shows 0. */
  async function dataQueueCount(): Promise<number> {
    try {
      const db = await open();
      const all = await new Promise<Array<{ table?: string; _failed?: boolean }>>((res, rej) => {
        const req = db.transaction(QUEUE, 'readonly').objectStore(QUEUE).getAll();
        req.onsuccess = () => res(req.result || []);
        req.onerror = () => rej(req.error);
      });
      return all.filter((op) => DATA_TABLES.has(op.table as string) && !op._failed).length;
    } catch {
      return 0;
    }
  }

  /** Missing keys and stored `undefined`/`null` all read as null. */
  async function metaGet<T = unknown>(key: string): Promise<T | null> {
    try {
      const db = await open();
      return new Promise<T | null>((res, rej) => {
        const req = db.transaction(META, 'readonly').objectStore(META).get(key);
        req.onsuccess = () => res(req.result?.value ?? null);
        req.onerror = () => rej(req.error);
      });
    } catch {
      return null;
    }
  }

  async function metaSet(key: string, value: unknown): Promise<void> {
    try {
      const db = await open();
      return new Promise<void>((res, rej) => {
        const tx = db.transaction(META, 'readwrite');
        tx.objectStore(META).put({ key, value });
        tx.oncomplete = () => res();
        tx.onerror = (e) => rej(targetError(e));
      });
    } catch {
      // Open failure only; request errors reject (see file comment).
    }
  }

  /**
   * One-time copy of pre-IndexedDB localStorage data, so upgrading users keep their records and unsynced
   * edits. Safe on every startup: once the `migrated` flag is set it costs one read. Each part fails on its
   * own and the flag is still set, so a corrupt key can't block startup forever.
   */
  async function migrateFromLocalStorage(storage: Pick<Storage, 'getItem'>): Promise<void> {
    try {
      const done = await metaGet('migrated');
      if (done) return;
      for (const [k, lsKey] of Object.entries(LEGACY_LS_KEYS)) {
        try {
          const d = JSON.parse(storage.getItem(lsKey) || '[]');
          if (d.length) await saveAll(STORE_NAMES[k as keyof typeof STORE_NAMES], d);
        } catch {
          // Skip this collection.
        }
      }
      try {
        const q = JSON.parse(storage.getItem('ww_sync_queue') || '[]');
        if (q.length) {
          const db = await open();
          const tx = db.transaction(QUEUE, 'readwrite');
          const s = tx.objectStore(QUEUE);
          q.forEach((op: { _retries?: number }) => s.add({ ...op, _retries: op._retries || 0 }));
          await new Promise((res, rej) => {
            tx.oncomplete = res;
            tx.onerror = (e) => rej(targetError(e));
          });
        }
      } catch {
        // Skip the queue.
      }
      try {
        const m = JSON.parse(storage.getItem('ww_sync_deleted') || '{}');
        const entries = Object.entries(m).map(([id, ts]) => ({ id, ts }));
        if (entries.length) await metaSet('recently_deleted', entries);
      } catch {
        // Skip the recently-deleted cache.
      }
      await metaSet('migrated', true);
      console.log('[IDB] Migration from localStorage complete');
    } catch (e) {
      console.warn('[IDB] Migration failed:', e);
    }
  }

  return {
    saveAll,
    getAll,
    getOne,
    markSynced,
    enqueue,
    getQueue,
    dequeue,
    updateQueueOp,
    dataQueueCount,
    metaGet,
    metaSet,
    migrateFromLocalStorage,
  };
}

export type AppDb = ReturnType<typeof createAppDb>;

/** The app's shared instance, on the legacy database name. */
export const appDb = createAppDb();
