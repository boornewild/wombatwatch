import { PHOTO_DB_NAME, createPhotoStore, photoStore } from './photoStore';

let n = 0;
const uniqueName = () => `photo-test-${n++}`;

/** Wraps the real factory to count opens and optionally close each connection as soon as it opens. */
const trackingFactory = (closeOnOpen: (openIndex: number) => boolean) => {
  let opens = 0;
  const factory = {
    open: (name: string, version?: number) => {
      const index = opens++;
      const req = indexedDB.open(name, version);
      req.addEventListener('success', () => {
        if (closeOnOpen(index)) req.result.close();
      });
      return req;
    },
  } as unknown as IDBFactory;
  return { factory, opens: () => opens };
};

it('keeps the legacy database name', () => {
  expect(PHOTO_DB_NAME).toBe('ww_photo_data');
  expect(photoStore).toBeDefined();
});

it('round-trips photos by id', async () => {
  const store = createPhotoStore({ name: uniqueName() });
  await store.put('p1', 'data:image/jpeg;base64,AAA');
  await store.put('p2', 'data:image/jpeg;base64,BBB');
  expect(await store.get('p1')).toBe('data:image/jpeg;base64,AAA');
  expect(await store.getAll()).toEqual({ p1: 'data:image/jpeg;base64,AAA', p2: 'data:image/jpeg;base64,BBB' });
  await store.remove('p1');
  expect(await store.get('p1')).toBeNull();
  expect(await store.getAll()).toEqual({ p2: 'data:image/jpeg;base64,BBB' });
});

it('Characterisation: an empty-string image reads back as null from get but "" from getAll', async () => {
  const store = createPhotoStore({ name: uniqueName() });
  await store.put('p1', '');
  expect(await store.get('p1')).toBeNull();
  expect(await store.getAll()).toEqual({ p1: '' });
});

it('reads fall back and remove never throws when IndexedDB cannot open', async () => {
  const broken = createPhotoStore({
    idb: { open: () => { throw new Error('no idb'); } } as unknown as IDBFactory,
  });
  expect(await broken.getAll()).toEqual({});
  expect(await broken.get('p1')).toBeNull();
  await expect(broken.remove('p1')).resolves.toBeUndefined();
  await expect(broken.put('p1', 'x')).rejects.toThrow('no idb');
});

it('put retries only once, then throws the stale-connection error', async () => {
  const { factory, opens } = trackingFactory(() => true);
  const store = createPhotoStore({ name: uniqueName(), idb: factory });
  await expect(store.put('p1', 'a')).rejects.toMatchObject({ name: 'InvalidStateError' });
  expect(opens()).toBe(2);
});

it('put recovers when only the first connection is stale', async () => {
  const name = uniqueName();
  const { factory, opens } = trackingFactory((i) => i === 0);
  const store = createPhotoStore({ name, idb: factory });
  await store.put('p1', 'a');
  expect(opens()).toBe(2);
  expect(await store.get('p1')).toBe('a');
});
