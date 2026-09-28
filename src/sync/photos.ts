/**
 * Photo sync: uploading image data to Storage, caching remote photos on the device for offline viewing, and
 * recovering photos whose image data went missing. Ported from legacy `uploadPhotoToStorage`,
 * `resolvePhotoUrl`, `cacheRemotePhotosToIdb` and `recoverBlankPhotos` with the same steps and fallbacks.
 *
 * Image data (base64 data: URLs) lives in the on-device photo store; photo records hold either an https
 * Storage URL or null (base64 is stripped before records are saved).
 */
import type { WombatPhoto, BurrowPhoto } from '../domain/types';
import type { Action } from '../state/actions';
import type { AppDb } from './idb/appDb';
import type { PhotoStore } from './idb/photoStore';
import type { Remote } from './remote';

type Photo = (WombatPhoto | BurrowPhoto) & { wombatId?: string; burrowId?: string };

export interface PhotoDeps {
  remote: Pick<Remote, 'uploadPhoto' | 'publicPhotoUrl' | 'downloadPhoto' | 'setPhotoUrl' | 'fetchPhotoDataUrl'>;
  photoStore: Pick<PhotoStore, 'put' | 'getAll'>;
  appDb: Pick<AppDb, 'getOne' | 'getAll' | 'saveAll'>;
  /** localStorage: the record lists patched with a new URL after upload. */
  storage: Pick<Storage, 'getItem' | 'setItem'>;
  fetch: typeof fetch;
  blobToDataUrl: (blob: Blob) => Promise<string>;
  isOnline: () => boolean;
}

/** Legacy localStorage keys of the photo lists (SK.wp / SK.bp). */
export const WOMBAT_PHOTOS_LS_KEY = 'ww2_wombat_photos';
const tableForPhoto = (p: Photo) => (p.wombatId ? 'wombat_photos' : 'burrow_photos');

/**
 * Uploads base64 image data; returns the public URL, or null if the upload failed. On success the image is
 * also kept on the device, the DB row gets the URL (so later syncs return it), and the localStorage list is
 * patched. When the bucket rejects the upload the image is still kept on the device so offline viewing works.
 */
export async function uploadPhotoToStorage(
  dataUrl: string,
  photoId: string,
  localStorageKey: string | null | undefined,
  deps: PhotoDeps,
): Promise<string | null> {
  try {
    console.info('[Photo] uploadPhotoToStorage: uploading', photoId, 'dataUrl len=' + dataUrl?.length);
    const up = await deps.remote.uploadPhoto(dataUrl, photoId);
    if (!up.ok) {
      if (up.failure === 'rejected') {
        await deps.photoStore.put(photoId, dataUrl).catch((e) => console.warn('[Photo] idbPutPhoto FAILED (storage-fallback)', photoId, e));
      }
      return null;
    }
    // Awaited so the photo is viewable offline immediately, before the next sync caches it.
    await deps.photoStore.put(photoId, dataUrl).catch((e) => console.warn('[Photo] idbPutPhoto FAILED for', photoId, e));
    if (localStorageKey) {
      deps.remote.setPhotoUrl(localStorageKey === WOMBAT_PHOTOS_LS_KEY ? 'wombat_photos' : 'burrow_photos', photoId, up.publicUrl);
      try {
        const list = JSON.parse(deps.storage.getItem(localStorageKey) || '[]') as Photo[];
        deps.storage.setItem(localStorageKey, JSON.stringify(list.map((p) => (p.id === photoId ? { ...p, dataUrl: up.publicUrl } : p))));
      } catch {
        // The next sync brings the URL back anyway.
      }
    }
    return up.publicUrl;
  } catch (e) {
    console.warn('[Storage] exception', e);
    return null;
  }
}

/** URL to store for a photo: uploads base64 data, passes URLs/null through, falls back to the base64 if upload fails. */
export async function resolvePhotoUrl<T extends string | null | undefined>(
  dataUrl: T,
  photoId: string,
  localStorageKey: string | null | undefined,
  deps: PhotoDeps,
): Promise<T | string> {
  if (!dataUrl || !dataUrl.startsWith('data:')) return dataUrl;
  const url = await uploadPhotoToStorage(dataUrl, photoId, localStorageKey, deps);
  return url || dataUrl;
}

/**
 * Downloads photos that aren't on the device yet (plus `forcedIds`, just uploaded) so they render offline.
 * Four fallbacks per photo: Storage SDK → stored https URL → public URL by naming convention → base64 in the
 * DB row. Dispatches HYDRATE_PHOTO_DATA for whatever it cached.
 */
export async function cacheRemotePhotos(
  wombatPhotos: Photo[] | null | undefined,
  burrowPhotos: Photo[] | null | undefined,
  dispatch: ((a: Action) => void) | null | undefined,
  deps: PhotoDeps,
  forcedIds: Set<string> = new Set(),
): Promise<void> {
  try {
    const existing = await deps.photoStore.getAll();
    const all = [...(wombatPhotos || []), ...(burrowPhotos || [])];
    const toFetch = all.filter((p) => p.id && (forcedIds.has(p.id) || !existing[p.id]) && (p.dataUrl?.startsWith('https://') || !p.dataUrl));
    // Base64 that came back in the row itself (Storage not configured): save it, no request needed.
    const toSaveDirect = all.filter((p) => p.id && !existing[p.id] && p.dataUrl?.startsWith('data:'));
    if (forcedIds.size) console.info('[Photo] cacheRemotePhotosToIdb: forced re-cache for', forcedIds.size, 'IDs, toFetch=' + toFetch.length);
    if (!toFetch.length && !toSaveDirect.length) return;
    const newMap: Record<string, string> = {};
    const keep = async (id: string, dataUrl: string) => {
      await deps.photoStore.put(id, dataUrl);
      newMap[id] = dataUrl;
    };

    for (const p of toSaveDirect) {
      try {
        await keep(p.id, p.dataUrl as string);
      } catch (e) {
        console.warn('[Photo] cacheRemote: direct-save failed for', p.id, (e as Error)?.message);
      }
    }

    await Promise.allSettled(
      toFetch.map(async (p) => {
        // 1. Storage SDK (auth-aware, CORS-safe).
        try {
          const dl = await deps.remote.downloadPhoto(p.id);
          if (dl.ok) {
            await keep(p.id, await deps.blobToDataUrl(dl.blob));
            return;
          }
        } catch {
          // Next attempt.
        }
        // 2. The https URL stored on the record.
        if (p.dataUrl?.startsWith('https://')) {
          try {
            const res = await deps.fetch(p.dataUrl);
            if (res.ok) {
              await keep(p.id, await deps.blobToDataUrl(await res.blob()));
              return;
            }
          } catch {
            // Next attempt.
          }
        }
        // 3. Public URL from the {id}.jpg convention (covers records whose URL was stripped to null).
        try {
          const publicUrl = deps.remote.publicPhotoUrl(p.id);
          const res = await deps.fetch(publicUrl);
          if (res.ok) {
            await keep(p.id, await deps.blobToDataUrl(await res.blob()));
            deps.remote.setPhotoUrl(tableForPhoto(p), p.id, publicUrl);
            return;
          }
        } catch {
          // Next attempt.
        }
        // 4. Base64 in the DB row (photos saved before Storage existed). Bulk syncs skip data_url, so fetch it here.
        try {
          const dataUrl = await deps.remote.fetchPhotoDataUrl(tableForPhoto(p), p.id);
          if (dataUrl?.startsWith('data:')) await keep(p.id, dataUrl);
        } catch {
          // Out of options for this photo.
        }
      }),
    );
    const cached = Object.keys(newMap).length;
    console.info('[Photo] cacheRemotePhotosToIdb: cached', cached, 'blob(s) into ww_photo_data');
    if (cached && dispatch) dispatch({ type: 'HYDRATE_PHOTO_DATA', map: newMap });
  } catch {
    // Best effort.
  }
}

/**
 * Photos in state with no image data ("grey box"): if Storage still has the file, cache it on the device, put
 * the URL back on the DB row and the local record, and show it. Photos with data are never touched.
 */
export async function recoverBlankPhotos(
  wombatPhotos: Photo[] | null | undefined,
  burrowPhotos: Photo[] | null | undefined,
  dispatch: (a: Action) => void,
  deps: PhotoDeps,
): Promise<void> {
  if (!deps.isOnline()) return;
  try {
    const all = [
      ...(wombatPhotos || []).map((p) => ({ ...p, _table: 'wombat_photos' })),
      ...(burrowPhotos || []).map((p) => ({ ...p, _table: 'burrow_photos' })),
    ];
    const blanks = all.filter((p) => !p.dataUrl);
    if (!blanks.length) return;
    const recovered: Record<string, string> = {};
    for (const p of blanks) {
      try {
        const publicUrl = deps.remote.publicPhotoUrl(p.id);
        const res = await deps.fetch(publicUrl);
        if (!res.ok) continue;
        const dataUrl = await deps.blobToDataUrl(await res.blob());
        await deps.photoStore.put(p.id, dataUrl);
        recovered[p.id] = dataUrl;
        deps.remote.setPhotoUrl(p._table, p.id, publicUrl);
        try {
          const rec = await deps.appDb.getOne(p._table, p.id);
          if (rec) {
            const records = await deps.appDb.getAll<Photo>(p._table);
            await deps.appDb.saveAll(p._table, records.map((r) => (r.id === p.id ? { ...r, dataUrl: publicUrl, _sync: true } : r)));
          }
        } catch {
          // The URL is on the DB row; the next sync restores it.
        }
      } catch (e) {
        console.info('[Recovery] Error for', p.id, (e as Error)?.message);
      }
    }
    if (Object.keys(recovered).length) dispatch({ type: 'HYDRATE_PHOTO_DATA', map: recovered });
  } catch {
    // Best effort.
  }
}
