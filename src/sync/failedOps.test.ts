import { createAppDb } from './idb/appDb';
import { listFailed, retryFailed, retryAllFailed, discardFailed, describeFailedOp } from './failedOps';

let n = 0;
async function setup() {
  const appDb = createAppDb({ name: `failed-ops-${++n}` });
  await appDb.enqueue({ t: 'upsert', table: 'treatments', row: { id: 't1', wombat_id: 'w1' }, _retries: 5, _failed: true, _error: 'denied (42501)', _failedAt: 1 } as never);
  await appDb.enqueue({ t: 'upsert', table: 'wombats', row: { id: 'w2' } });
  await appDb.enqueue({ t: 'delete', table: 'burrows', id: 'b1', _retries: 5, _failed: true, _error: 'x', _failedAt: 2 } as never);
  return appDb;
}

it('lists only parked ops', async () => {
  const db = await setup();
  expect((await listFailed(db)).map((o) => o._qid)).toEqual([1, 3]);
});

it('retry gives one op a fresh set of tries and makes it pending again', async () => {
  const db = await setup();
  await retryFailed(db, 1);
  const op = (await db.getQueue()).find((o) => o._qid === 1)!;
  expect(op).toEqual({ t: 'upsert', table: 'treatments', row: { id: 't1', wombat_id: 'w1' }, _qid: 1, _retries: 0 });
  expect(await db.dataQueueCount()).toBe(2);
});

it('retryAll un-parks every parked op and reports how many', async () => {
  const db = await setup();
  expect(await retryAllFailed(db)).toBe(2);
  expect(await listFailed(db)).toEqual([]);
  expect(await retryAllFailed(db)).toBe(0);
});

it('discard removes only that op', async () => {
  const db = await setup();
  await discardFailed(db, 3);
  expect((await db.getQueue()).map((o) => o._qid)).toEqual([1, 2]);
});

it('retry/discard ignore ops that are not parked', async () => {
  const db = await setup();
  await discardFailed(db, 2);
  await retryFailed(db, 2);
  expect((await db.getQueue()).map((o) => o._qid)).toEqual([1, 2, 3]);
});

describe('describeFailedOp', () => {
  const lookup = { wombats: { w1: 'Seed Wombat' }, burrows: { b1: 'Creek Burrow' } };
  it('names the record by itself or its parent', () => {
    expect(describeFailedOp({ t: 'upsert', table: 'treatments', row: { id: 't1', wombat_id: 'w1' } } as never, lookup)).toEqual({ kind: 'Treatment', name: 'Seed Wombat', action: 'save' });
    expect(describeFailedOp({ t: 'upsert', table: 'wombats', row: { id: 'w9', name: 'New one' } } as never, lookup)).toEqual({ kind: 'Wombat', name: 'New one', action: 'save' });
    expect(describeFailedOp({ t: 'delete', table: 'burrows', id: 'b1' } as never, lookup)).toEqual({ kind: 'Burrow', name: 'Creek Burrow', action: 'delete' });
    expect(describeFailedOp({ t: 'storage-delete', path: 'p1.jpg' } as never, lookup)).toEqual({ kind: 'Photo file', name: 'p1.jpg', action: 'delete' });
  });
});
