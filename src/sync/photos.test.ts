import { cacheRemotePhotos, recoverBlankPhotos, resolvePhotoUrl, uploadPhotoToStorage, type PhotoDeps } from './photos';
import type { UploadResult, DownloadResult } from './remote';

function setup(o: { upload?: UploadResult; download?: DownloadResult; fetchOk?: (url: string) => boolean; rowDataUrl?: string | null; existing?: Record<string, string>; online?: boolean; stored?: unknown[] } = {}) {
  const calls: unknown[][] = [];
  const store: Record<string, string> = { ww2_wombat_photos: JSON.stringify([{ id: 'p1', dataUrl: null }, { id: 'p2', dataUrl: null }]) };
  const deps: PhotoDeps = {
    remote: {
      uploadPhoto: async () => o.upload ?? { ok: true, publicUrl: 'https://cdn/p1.jpg' },
      publicPhotoUrl: (id) => `https://cdn/${id}.jpg`,
      downloadPhoto: async () => o.download ?? { ok: false, error: 'nf' },
      setPhotoUrl: (t, id, url) => void calls.push(['setPhotoUrl', t, id, url]),
      fetchPhotoDataUrl: async () => o.rowDataUrl ?? null,
    },
    photoStore: { put: async (id, d) => void calls.push(['put', id, d]), getAll: async () => o.existing ?? {} },
    appDb: {
      getOne: async (_s, id) => ({ id }) as never,
      getAll: async () => (o.stored ?? [{ id: 'p1', dataUrl: null }]) as never,
      saveAll: async (s, recs) => void calls.push(['saveAll', s, recs]),
    },
    storage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => void (store[k] = v) },
    fetch: (async (url: string) => ({ ok: o.fetchOk?.(url) ?? false, blob: async () => new Blob(['x']) })) as never,
    blobToDataUrl: async () => 'data:fetched',
    isOnline: () => o.online ?? true,
  };
  const dispatch = vi.fn();
  return { deps, calls, store, dispatch };
}
beforeEach(() => { for (const m of ['warn', 'info'] as const) vi.spyOn(console, m).mockImplementation(() => {}); });

describe('upload', () => {
  it('success: keeps the image on the device, puts the URL on the row and in the local list', async () => {
    const s = setup();
    expect(await uploadPhotoToStorage('data:a', 'p1', 'ww2_wombat_photos', s.deps)).toBe('https://cdn/p1.jpg');
    expect(s.calls).toEqual([['put', 'p1', 'data:a'], ['setPhotoUrl', 'wombat_photos', 'p1', 'https://cdn/p1.jpg']]);
    expect(JSON.parse(s.store.ww2_wombat_photos!)[0]).toEqual({ id: 'p1', dataUrl: 'https://cdn/p1.jpg' });
  });
  it('bucket rejected: still keeps the image on the device; returns null', async () => {
    const s = setup({ upload: { ok: false, error: 'denied', failure: 'rejected' } });
    expect(await uploadPhotoToStorage('data:a', 'p1', 'ww2_wombat_photos', s.deps)).toBeNull();
    expect(s.calls).toEqual([['put', 'p1', 'data:a']]);
  });
  it('bad image data: nothing stored', async () => {
    const s = setup({ upload: { ok: false, error: 'x', failure: 'invalid-data' } });
    expect(await uploadPhotoToStorage('data:a', 'p1', null, s.deps)).toBeNull();
    expect(s.calls).toEqual([]);
  });
  it('resolvePhotoUrl passes URLs/null through and falls back to the base64 when upload fails', async () => {
    const s = setup({ upload: { ok: false, error: 'x', failure: 'threw' } });
    expect(await resolvePhotoUrl('https://x', 'p1', null, s.deps)).toBe('https://x');
    expect(await resolvePhotoUrl(null, 'p1', null, s.deps)).toBeNull();
    expect(await resolvePhotoUrl('data:a', 'p1', null, s.deps)).toBe('data:a');
  });
});

describe('cacheRemotePhotos', () => {
  it('skips photos already on the device unless forced', async () => {
    const s = setup({ existing: { p1: 'data:old' }, download: { ok: true, blob: new Blob(['x']) } });
    await cacheRemotePhotos([{ id: 'p1', wombatId: 'w1', dataUrl: null }], [], s.dispatch, s.deps);
    expect(s.dispatch).not.toHaveBeenCalled();
    await cacheRemotePhotos([{ id: 'p1', wombatId: 'w1', dataUrl: null }], [], s.dispatch, s.deps, new Set(['p1']));
    expect(s.dispatch).toHaveBeenCalledWith({ type: 'HYDRATE_PHOTO_DATA', map: { p1: 'data:fetched' } });
  });
  it('saves base64 that came back in the row without any request', async () => {
    const s = setup();
    await cacheRemotePhotos([{ id: 'p1', wombatId: 'w1', dataUrl: 'data:inline' }], [], s.dispatch, s.deps);
    expect(s.calls).toEqual([['put', 'p1', 'data:inline']]);
  });
  it('falls back to the public URL by convention and writes that URL back to the row', async () => {
    const s = setup({ fetchOk: (u) => u === 'https://cdn/p2.jpg' });
    await cacheRemotePhotos([], [{ id: 'p2', burrowId: 'b1', dataUrl: null }], s.dispatch, s.deps);
    expect(s.calls).toEqual([['put', 'p2', 'data:fetched'], ['setPhotoUrl', 'burrow_photos', 'p2', 'https://cdn/p2.jpg']]);
  });
  it('last resort: base64 stored in the DB row', async () => {
    const s = setup({ rowDataUrl: 'data:row' });
    await cacheRemotePhotos([{ id: 'p1', wombatId: 'w1', dataUrl: null }], [], s.dispatch, s.deps);
    expect(s.calls).toEqual([['put', 'p1', 'data:row']]);
  });
});

describe('recoverBlankPhotos', () => {
  it('does nothing offline', async () => {
    const s = setup({ online: false, fetchOk: () => true });
    await recoverBlankPhotos([{ id: 'p1', wombatId: 'w1', dataUrl: null }], [], s.dispatch, s.deps);
    expect(s.calls).toEqual([]);
  });
  it('recovers a blank photo that still exists in Storage and restores its URL everywhere', async () => {
    const s = setup({ fetchOk: () => true });
    await recoverBlankPhotos([{ id: 'p1', wombatId: 'w1', dataUrl: null }, { id: 'p9', wombatId: 'w1', dataUrl: 'https://x' }], [], s.dispatch, s.deps);
    expect(s.calls).toEqual([
      ['put', 'p1', 'data:fetched'],
      ['setPhotoUrl', 'wombat_photos', 'p1', 'https://cdn/p1.jpg'],
      ['saveAll', 'wombat_photos', [{ id: 'p1', dataUrl: 'https://cdn/p1.jpg', _sync: true }]],
    ]);
    expect(s.dispatch).toHaveBeenCalledWith({ type: 'HYDRATE_PHOTO_DATA', map: { p1: 'data:fetched' } });
  });
});
