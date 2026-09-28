import { queueOp, QUEUE_WRITE_FAILED_MESSAGE } from './queue';
import { getRecentlyDeleted, markRecentlyDeleted, RECENTLY_DELETED_TTL_MS } from './recentlyDeleted';
import { createAppDb } from './idb/appDb';

it('queueOp saves the op and asks for a background sync', async () => {
  const appDb = createAppDb({ name: 'queue-test-1' });
  const deps = { appDb, notify: vi.fn(), registerBackgroundSync: vi.fn() };
  await queueOp({ t: 'delete', table: 'wombats', id: 'w1' }, deps);
  expect(await appDb.getQueue()).toEqual([{ t: 'delete', table: 'wombats', id: 'w1', _qid: 1, _retries: 0 }]);
  expect(deps.registerBackgroundSync).toHaveBeenCalled();
  expect(deps.notify).not.toHaveBeenCalled();
});

it('queueOp tells the volunteer when the device cannot store the op, and still never throws', async () => {
  const deps = {
    appDb: { enqueue: vi.fn().mockRejectedValue(new Error('QuotaExceededError')) },
    notify: vi.fn(),
    registerBackgroundSync: vi.fn(() => { throw new Error('unsupported'); }),
  };
  await expect(queueOp({ t: 'storage-delete', path: 'a.jpg' }, deps)).resolves.toBeUndefined();
  expect(deps.notify).toHaveBeenCalledWith(QUEUE_WRITE_FAILED_MESSAGE);
});

it('recently deleted ids expire after the TTL', async () => {
  const appDb = createAppDb({ name: 'queue-test-2' });
  let now = 1_000_000;
  await markRecentlyDeleted('old', appDb, () => now);
  now += RECENTLY_DELETED_TTL_MS - 1;
  await markRecentlyDeleted('new', appDb, () => now);
  expect(await getRecentlyDeleted(appDb, () => now)).toEqual(new Set(['old', 'new']));
  now += 1;
  expect(await getRecentlyDeleted(appDb, () => now)).toEqual(new Set(['new']));
});
