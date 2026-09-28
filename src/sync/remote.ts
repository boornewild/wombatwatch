/**
 * Thin wrapper over the Supabase client for the sync engine. Each write returns
 * `{ ok, error }` instead of writing the legacy `_lastSupaError` global, and the
 * client plus the sign-out hook are injected so tests use a hand-written fake.
 */
import { isAuthError, type ErrorLike } from './classify';

type SupaError = ErrorLike & { message: string };
type ErrorResult = PromiseLike<{ error: SupaError | null }>;

/** The slice of SupabaseClient this module uses; the real client satisfies it. */
export interface SupabaseLike {
  from(table: string): {
    upsert(row: never, options: { onConflict: string }): ErrorResult;
    delete(): { eq(column: string, value: never): ErrorResult };
  };
  storage: {
    from(bucket: string): {
      upload(path: string, body: Blob, options: { upsert: boolean; contentType: string }): Promise<{ error: SupaError | null }>;
      remove(paths: string[]): Promise<{ error: SupaError | null }>;
      getPublicUrl(path: string): { data: { publicUrl: string } };
      download(path: string): Promise<{ data: Blob | null; error: SupaError | null }>;
    };
  };
}

export interface RemoteOptions {
  /** Called when a table write fails with an auth error. Null until the App mounts. */
  onAuthError?: (() => void) | null;
}

export interface WriteResult {
  ok: boolean;
  error?: string;
}

/**
 * Why an upload failed matters to the caller: legacy caches the base64 in IndexedDB
 * only when the bucket rejected the upload, not when the data URL was bad or it threw.
 */
export type UploadResult =
  | { ok: true; publicUrl: string }
  | { ok: false; error: string; failure: 'invalid-data' | 'rejected' | 'threw' };

export type DownloadResult = { ok: true; blob: Blob } | { ok: false; error: string };

const BUCKET = 'photos';
/** Every photo lives at `{id}.jpg`; the display and cache code rely on this convention. */
export const photoPath = (photoId: string) => `${photoId}.jpg`;

/** Same text legacy put in `_lastSupaError`, which the dropped-record alert shows. */
export const formatSupaError = (error: SupaError) => `${error.message}${error.code ? ' (' + error.code + ')' : ''}`;

/**
 * Converts a data URL to a Blob without fetch(): Safari iOS can't fetch data: URLs,
 * which used to make uploads fail silently. Returns null for anything undecodable.
 */
export function dataUrlToBlob(dataUrl: string | null | undefined): Blob | null {
  try {
    const [header, b64] = (dataUrl as string).split(',');
    const mime = ((header as string).match(/:(.*?);/) || [])[1] || 'image/jpeg';
    const binary = atob(b64 as string);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  } catch (e) {
    console.warn('[Photo] dataUrlToBlob failed', e);
    return null;
  }
}

export function createRemote(supa: SupabaseLike, { onAuthError = null }: RemoteOptions = {}) {
  const photos = () => supa.storage.from(BUCKET);

  // One try around everything, as legacy had: if onAuthError throws, that becomes the error.
  async function write(run: () => ErrorResult, label: string, table: string, id: unknown): Promise<WriteResult> {
    try {
      const { error } = await run();
      if (error) {
        const message = formatSupaError(error);
        console.warn(`[Supa] ${label} FAILED`, table, id, error.message, error.code);
        if (isAuthError(error) && onAuthError) onAuthError();
        return { ok: false, error: message };
      }
      console.debug(`[Supa] ${label} ok`, table, id);
      return { ok: true };
    } catch (e) {
      console.warn(`[Supa] ${label} exception`, table, e);
      return { ok: false, error: String(e) };
    }
  }

  return {
    upsert(table: string, row: { id?: unknown }): Promise<WriteResult> {
      return write(() => supa.from(table).upsert(row as never, { onConflict: 'id' }), 'upsert', table, row?.id);
    },

    /**
     * Many rows in one request (burrow renumbering). Legacy behaviour kept: no auth-error sign-out,
     * and exceptions propagate to the caller.
     */
    async upsertBatch(table: string, rows: unknown[]): Promise<WriteResult> {
      const { error } = await supa.from(table).upsert(rows as never, { onConflict: 'id' });
      if (error) {
        console.warn('[Supa] renumber chunk failed:', error);
        return { ok: false, error: formatSupaError(error) };
      }
      return { ok: true };
    },

    remove(table: string, id: unknown): Promise<WriteResult> {
      return write(() => supa.from(table).delete().eq('id', id as never), 'delete', table, id);
    },

    /**
     * Unlike the table writes this never calls onAuthError and lets exceptions
     * propagate: flushQueue treats a thrown storage delete as a network failure.
     */
    async removeStorage(path: string): Promise<WriteResult> {
      const { error } = await photos().remove([path]);
      if (error) {
        console.warn('[Queue] Storage delete failed:', path, error.message);
        return { ok: false, error: formatSupaError(error) };
      }
      return { ok: true };
    },

    /**
     * Only the network half of legacy uploadPhotoToStorage. Caching the image in
     * IndexedDB, patching the DB row's data_url and the localStorage copy are
     * composed by the photo engine (Task 3.6). Legacy never fed this error into
     * `_lastSupaError`, so callers must not classify it as a write failure.
     */
    async uploadPhoto(image: Blob | string, photoId: string): Promise<UploadResult> {
      try {
        const blob = typeof image === 'string' ? dataUrlToBlob(image) : image;
        if (!blob) {
          console.warn('[Photo] dataUrlToBlob returned null for', photoId);
          return { ok: false, error: 'invalid data URL', failure: 'invalid-data' };
        }
        const path = photoPath(photoId);
        const { error } = await photos().upload(path, blob, { upsert: true, contentType: 'image/jpeg' });
        if (error) {
          console.warn('[Storage] upload failed (' + error.message + ')');
          return { ok: false, error: formatSupaError(error), failure: 'rejected' };
        }
        const {
          data: { publicUrl },
        } = photos().getPublicUrl(path);
        return { ok: true, publicUrl };
      } catch (e) {
        console.warn('[Storage] exception', e);
        return { ok: false, error: String(e), failure: 'threw' };
      }
    },

    /** Builds the URL locally; no request is made. */
    publicPhotoUrl(photoId: string): string {
      return photos().getPublicUrl(photoPath(photoId)).data.publicUrl;
    },

    /**
     * Uses the SDK (auth-aware, CORS-safe). Every legacy caller treats an error, a
     * non-Blob body and an exception the same way (fall back to fetch), so all three
     * come back as `ok: false`.
     */
    async downloadPhoto(photoId: string): Promise<DownloadResult> {
      try {
        const { data, error } = await photos().download(photoPath(photoId));
        if (!error && data instanceof Blob) return { ok: true, blob: data };
        return { ok: false, error: error?.message || 'no blob' };
      } catch (e) {
        return { ok: false, error: String(e) };
      }
    },
  };
}

export type Remote = ReturnType<typeof createRemote>;
