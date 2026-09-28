/**
 * IndexedDB store for photo image data (base64 `data:` URLs), keyed by photo id (legacy `ww_photo_data`).
 * Kept apart from the app DB so large images never ride along with record reads, and out of localStorage's
 * 5 MB quota. Failure semantics match legacy: reads fall back to {} / null, `remove` never throws, `put` throws.
 */

export const PHOTO_DB_NAME = 'ww_photo_data';
const PHOTO_DB_VERSION = 1;
const STORE = 'p';

/** iOS Safari closes idle IndexedDB connections silently; these are the errors a stale connection raises. */
const STALE_CONNECTION_ERRORS = new Set(['InvalidStateError', 'DatabaseClosedError']);

type RequestLike = { error: DOMException | null };
const targetError = (e: Event) => (e.target as unknown as RequestLike | null)?.error;

export interface PhotoStoreOptions {
  name?: string;
  /** Read lazily, so a missing IndexedDB behaves like a failed open instead of throwing on import. */
  idb?: IDBFactory;
}

export function createPhotoStore({ name = PHOTO_DB_NAME, idb }: PhotoStoreOptions = {}) {
  let cached: IDBDatabase | null = null;

  function open(): Promise<IDBDatabase> {
    if (cached) return Promise.resolve(cached);
    return new Promise((res, rej) => {
      const req = (idb ?? indexedDB).open(name, PHOTO_DB_VERSION);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => {
        cached = req.result;
        res(cached);
      };
      req.onerror = () => rej(req.error);
    });
  }

  /** Saves image data. Retries once with a fresh connection if the cached one went stale; otherwise throws. */
  async function put(id: string, dataUrl: string): Promise<void> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const db = await open();
        await new Promise<void>((res, rej) => {
          const tx = db.transaction(STORE, 'readwrite');
          tx.objectStore(STORE).put(dataUrl, id);
          tx.oncomplete = () => res();
          tx.onerror = (e) => rej(targetError(e) || new Error('IDB tx error'));
          tx.onabort = (e) => rej(targetError(e) || new Error('IDB tx aborted'));
        });
        return;
      } catch (e) {
        const errName = (e as { name?: string } | null)?.name;
        if (attempt === 0 && errName && STALE_CONNECTION_ERRORS.has(errName)) {
          console.warn('[IDB] Stale connection, retrying idbPutPhoto for', id);
          cached = null;
          continue;
        }
        throw e;
      }
    }
  }

  /** Every stored image as `{ [photoId]: dataUrl }`. Never throws. */
  async function getAll(): Promise<Record<string, string>> {
    try {
      const db = await open();
      return new Promise((res) => {
        const tx = db.transaction(STORE, 'readonly');
        const map: Record<string, string> = {};
        tx.objectStore(STORE).openCursor().onsuccess = (e) => {
          const c = (e.target as IDBRequest<IDBCursorWithValue | null>).result;
          if (c) {
            map[c.key as string] = c.value;
            c.continue();
          } else res(map);
        };
        tx.onerror = () => res({});
      });
    } catch {
      return {};
    }
  }

  /** Missing and empty-string images both read as null. */
  async function get(id: string): Promise<string | null> {
    try {
      const db = await open();
      return new Promise((res) => {
        const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(id);
        req.onsuccess = () => res(req.result || null);
        req.onerror = () => res(null);
      });
    } catch {
      return null;
    }
  }

  /** Best effort: a leftover image only wastes space, so failures are logged, not thrown. */
  async function remove(id: string): Promise<void> {
    try {
      const db = await open();
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(id);
      await new Promise((res, rej) => {
        tx.oncomplete = res;
        tx.onerror = (e) => rej(targetError(e));
      });
    } catch (e) {
      console.warn('[IDB] delete photo failed:', id, e);
    }
  }

  return { put, getAll, get, remove };
}

export type PhotoStore = ReturnType<typeof createPhotoStore>;

/** The app's shared instance, on the legacy database name. */
export const photoStore = createPhotoStore();
