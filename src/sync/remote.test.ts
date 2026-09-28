import { createClient } from '@supabase/supabase-js';
import { createRemote, dataUrlToBlob, formatSupaError, type SupabaseLike } from './remote';

type Err = { message: string; code?: string; status?: number } | null;
type Outcome = { error: Err } | 'throw';

/** Hand-written fake: records every call and replays the configured outcome. */
type FakeOptions = { table?: Outcome; storage?: Outcome; download?: { data: unknown; error: Err } | 'throw' };
function fakeSupa(opts: FakeOptions = {}) {
  const calls: unknown[][] = [];
  const settle = <T>(o: T | 'throw' | undefined, fallback: T): Promise<T> =>
    o === 'throw' ? Promise.reject(new TypeError('Failed to fetch')) : Promise.resolve(o ?? fallback);
  const ok = { error: null };
  const supa = {
    from: (table: string) => ({
      upsert: (row: unknown, o: unknown) => (calls.push(['upsert', table, row, o]), settle(opts.table, ok)),
      delete: () => ({ eq: (c: string, v: unknown) => (calls.push(['delete', table, c, v]), settle(opts.table, ok)) }),
    }),
    storage: {
      from: (bucket: string) => ({
        upload: (p: string, b: Blob, o: unknown) => (calls.push(['upload', bucket, p, b, o]), settle(opts.storage, ok)),
        remove: (paths: string[]) => (calls.push(['remove', bucket, paths]), settle(opts.storage, ok)),
        getPublicUrl: (p: string) => ({ data: { publicUrl: `https://cdn.test/${bucket}/${p}` } }),
        download: (p: string) => (calls.push(['download', bucket, p]), settle(opts.download, { data: null, error: null })),
      }),
    },
  };
  return { supa: supa as unknown as SupabaseLike, calls };
}

const JPEG_URL = 'data:image/jpeg;base64,' + btoa('\xff\xd8\xff\xe0jpeg');

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'debug').mockImplementation(() => {});
});

it('the real Supabase client satisfies SupabaseLike', () => {
  // Assigned via a variable: annotating createClient's result directly sends tsc into deep generic inference.
  const client = createClient('http://127.0.0.1:1', 'anon', { auth: { persistSession: false } });
  const real: SupabaseLike = client;
  expect(typeof createRemote(real).upsert).toBe('function');
});

describe('upsert / remove', () => {
  it('upsert sends onConflict id and reports ok', async () => {
    const { supa, calls } = fakeSupa();
    expect(await createRemote(supa).upsert('wombats', { id: 'w1' })).toEqual({ ok: true });
    expect(calls).toEqual([['upsert', 'wombats', { id: 'w1' }, { onConflict: 'id' }]]);
  });

  it('remove deletes by id', async () => {
    const { supa, calls } = fakeSupa();
    expect(await createRemote(supa).remove('burrows', 'b1')).toEqual({ ok: true });
    expect(calls).toEqual([['delete', 'burrows', 'id', 'b1']]);
  });

  it('formats errors as "message (code)", or just the message without a code', async () => {
    const withCode = fakeSupa({ table: { error: { message: 'duplicate key', code: '23505' } } }).supa;
    const noCode = fakeSupa({ table: { error: { message: 'boom' } } }).supa;
    expect(await createRemote(withCode).upsert('t', { id: 1 })).toEqual({ ok: false, error: 'duplicate key (23505)' });
    expect(await createRemote(noCode).remove('t', 1)).toEqual({ ok: false, error: 'boom' });
  });

  it('an exception becomes String(e)', async () => {
    const { supa } = fakeSupa({ table: 'throw' });
    expect(await createRemote(supa).upsert('t', { id: 1 })).toEqual({ ok: false, error: 'TypeError: Failed to fetch' });
    expect(await createRemote(supa).remove('t', 1)).toEqual({ ok: false, error: 'TypeError: Failed to fetch' });
  });

  it.each([
    [{ message: 'Unauthorized', status: 401 }],
    [{ message: 'x', code: 'PGRST301' }],
    [{ message: 'JWT expired' }],
  ])('fires onAuthError on %j', async (error) => {
    const onAuthError = vi.fn();
    const remote = createRemote(fakeSupa({ table: { error } }).supa, { onAuthError });
    await remote.upsert('t', { id: 1 });
    await remote.remove('t', 1);
    expect(onAuthError).toHaveBeenCalledTimes(2);
  });

  it('does not fire onAuthError on other errors, exceptions or success', async () => {
    const onAuthError = vi.fn();
    await createRemote(fakeSupa({ table: { error: { message: 'dup', code: '23505' } } }).supa, { onAuthError }).upsert('t', {});
    await createRemote(fakeSupa({ table: 'throw' }).supa, { onAuthError }).upsert('t', {});
    await createRemote(fakeSupa().supa, { onAuthError }).upsert('t', {});
    expect(onAuthError).not.toHaveBeenCalled();
  });

  it('works with no onAuthError hook set yet', async () => {
    const remote = createRemote(fakeSupa({ table: { error: { message: 'jwt expired' } } }).supa);
    expect(await remote.upsert('t', {})).toEqual({ ok: false, error: 'jwt expired' });
  });

  it('Characterisation: if onAuthError throws, its exception replaces the Supabase error', async () => {
    const remote = createRemote(fakeSupa({ table: { error: { message: 'jwt expired' } } }).supa, {
      onAuthError: () => {
        throw new Error('signOut failed');
      },
    });
    expect(await remote.upsert('t', {})).toEqual({ ok: false, error: 'Error: signOut failed' });
  });
});

describe('removeStorage', () => {
  it('removes the path from the photos bucket', async () => {
    const { supa, calls } = fakeSupa();
    expect(await createRemote(supa).removeStorage('p1.jpg')).toEqual({ ok: true });
    expect(calls).toEqual([['remove', 'photos', ['p1.jpg']]]);
  });

  it('Characterisation: an auth error does NOT fire onAuthError', async () => {
    const onAuthError = vi.fn();
    const { supa } = fakeSupa({ storage: { error: { message: 'jwt expired', status: 401 } } });
    expect(await createRemote(supa, { onAuthError }).removeStorage('p.jpg')).toEqual({ ok: false, error: 'jwt expired' });
    expect(onAuthError).not.toHaveBeenCalled();
  });

  it('Characterisation: exceptions propagate (flushQueue treats a throw as a network error)', async () => {
    await expect(createRemote(fakeSupa({ storage: 'throw' }).supa).removeStorage('p.jpg')).rejects.toThrow('Failed to fetch');
  });
});

describe('uploadPhoto', () => {
  it('uploads a data URL to photos/{id}.jpg as image/jpeg and returns the public URL', async () => {
    const { supa, calls } = fakeSupa();
    const result = await createRemote(supa).uploadPhoto(JPEG_URL, 'p1');
    expect(result).toEqual({ ok: true, publicUrl: 'https://cdn.test/photos/p1.jpg' });
    const [, bucket, path, blob, options] = calls[0]!;
    expect([bucket, path, options]).toEqual(['photos', 'p1.jpg', { upsert: true, contentType: 'image/jpeg' }]);
    expect((blob as Blob).size).toBe(8);
  });

  it('accepts a Blob as-is', async () => {
    const { supa, calls } = fakeSupa();
    const blob = new Blob(['x'], { type: 'image/png' });
    await createRemote(supa).uploadPhoto(blob, 'p2');
    expect(calls[0]![3]).toBe(blob);
  });

  it('reports each failure kind so the caller can apply the legacy IDB fallback', async () => {
    const rejected = fakeSupa({ storage: { error: { message: 'Bucket not found', code: '404' } } }).supa;
    expect(await createRemote(rejected).uploadPhoto(JPEG_URL, 'p')).toEqual({
      ok: false,
      error: 'Bucket not found (404)',
      failure: 'rejected',
    });
    expect(await createRemote(fakeSupa({ storage: 'throw' }).supa).uploadPhoto(JPEG_URL, 'p')).toEqual({
      ok: false,
      error: 'TypeError: Failed to fetch',
      failure: 'threw',
    });
    const { supa, calls } = fakeSupa();
    expect(await createRemote(supa).uploadPhoto('not a data url', 'p')).toMatchObject({ ok: false, failure: 'invalid-data' });
    expect(calls).toEqual([]);
  });

  it('never fires onAuthError', async () => {
    const onAuthError = vi.fn();
    const { supa } = fakeSupa({ storage: { error: { message: 'jwt expired', status: 401 } } });
    await createRemote(supa, { onAuthError }).uploadPhoto(JPEG_URL, 'p');
    expect(onAuthError).not.toHaveBeenCalled();
  });
});

describe('publicPhotoUrl / downloadPhoto', () => {
  it('publicPhotoUrl uses the {id}.jpg convention', () => {
    expect(createRemote(fakeSupa().supa).publicPhotoUrl('abc')).toBe('https://cdn.test/photos/abc.jpg');
  });

  it('downloadPhoto returns the blob on success', async () => {
    const blob = new Blob(['x']);
    const { supa, calls } = fakeSupa({ download: { data: blob, error: null } });
    expect(await createRemote(supa).downloadPhoto('abc')).toEqual({ ok: true, blob });
    expect(calls).toEqual([['download', 'photos', 'abc.jpg']]);
  });

  it('downloadPhoto fails on error, non-Blob body or exception', async () => {
    const dl = (download: FakeOptions['download']) => createRemote(fakeSupa({ download }).supa).downloadPhoto('a');
    expect(await dl({ data: null, error: { message: 'Object not found' } })).toEqual({ ok: false, error: 'Object not found' });
    expect(await dl({ data: 'text', error: null })).toEqual({ ok: false, error: 'no blob' });
    expect(await dl('throw')).toEqual({ ok: false, error: 'TypeError: Failed to fetch' });
  });
});

describe('dataUrlToBlob', () => {
  it('decodes bytes and keeps the MIME type from the header', async () => {
    const blob = dataUrlToBlob('data:image/png;base64,' + btoa('\x00\x01\xff'))!;
    expect(blob.type).toBe('image/png');
    expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual([0, 1, 255]);
  });

  it('defaults the MIME type to image/jpeg when the header has none', () => {
    expect(dataUrlToBlob('data:,' + btoa('hi'))!.type).toBe('image/jpeg');
  });

  it('returns null for undecodable input', () => {
    expect(dataUrlToBlob(null)).toBeNull();
    expect(dataUrlToBlob(undefined)).toBeNull();
    expect(dataUrlToBlob('data:image/jpeg;base64,***')).toBeNull();
    expect(dataUrlToBlob('no comma at all')).toBeNull();
  });

  it('Characterisation: an empty payload gives an empty Blob, not null', () => {
    expect(dataUrlToBlob('data:image/jpeg;base64,')!.size).toBe(0);
  });
});

it('formatSupaError omits an empty code', () => {
  expect(formatSupaError({ message: 'm', code: '' })).toBe('m');
});
