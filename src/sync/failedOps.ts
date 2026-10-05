/**
 * Writes the database kept rejecting (bug #2). The flush parks them (`_failed`) instead of deleting them, so a
 * volunteer's record is never lost from the device. They are retried automatically when the account or squad
 * changes (the usual cause is a write made before the volunteer was in a squad), or by hand from the app.
 */
import type { AppDb, QueueOp } from './idb/appDb';

type Db = Pick<AppDb, 'getQueue' | 'updateQueueOp' | 'dequeue'>;

export const listFailed = async (db: Pick<AppDb, 'getQueue'>): Promise<QueueOp[]> => (await db.getQueue()).filter((op) => op._failed);

const unpark = (op: QueueOp): QueueOp => {
  const next = { ...op, _retries: 0 };
  delete next._failed;
  delete next._error;
  delete next._failedAt;
  return next;
};

/** Gives one parked op a fresh set of tries. The caller should flush afterwards. */
export async function retryFailed(db: Db, qid: number): Promise<void> {
  const op = (await db.getQueue()).find((o) => o._qid === qid && o._failed);
  if (op) await db.updateQueueOp(unpark(op));
}

/** Un-parks every parked op; returns how many. The caller should flush afterwards. */
export async function retryAllFailed(db: Db): Promise<number> {
  const failed = await listFailed(db);
  for (const op of failed) await db.updateQueueOp(unpark(op));
  return failed.length;
}

/** Removes a parked op from the device for good (the volunteer confirmed). */
export async function discardFailed(db: Db, qid: number): Promise<void> {
  const op = (await db.getQueue()).find((o) => o._qid === qid && o._failed);
  if (op) await db.dequeue(op._qid);
}

const KINDS: Record<string, string> = {
  wombats: 'Wombat',
  burrows: 'Burrow',
  treatments: 'Treatment',
  sightings: 'Sighting',
  burrow_logs: 'Burrow check',
  wombat_photos: 'Wombat photo',
  burrow_photos: 'Burrow photo',
};

/** Names keyed by id, so a parked op can be shown as "Treatment · Seed Wombat". */
export type NameLookup = { wombats: Record<string, string>; burrows: Record<string, string> };

export function describeFailedOp(op: QueueOp, names: NameLookup): { kind: string; name: string; action: 'save' | 'delete' } {
  if (op.t === 'storage-delete') return { kind: 'Photo file', name: op.path, action: 'delete' };
  const kind = KINDS[op.table] ?? op.table;
  if (op.t === 'delete') {
    const own = names.wombats[op.id] ?? names.burrows[op.id];
    return { kind, name: own ?? op.id, action: 'delete' };
  }
  const row = op.row as { id?: string; name?: string; wombat_id?: string; burrow_id?: string };
  const name =
    row.name ??
    (row.wombat_id ? names.wombats[row.wombat_id] : undefined) ??
    (row.burrow_id ? names.burrows[row.burrow_id] : undefined) ??
    names.wombats[row.id ?? ''] ??
    names.burrows[row.id ?? ''] ??
    row.id ??
    'Unknown record';
  return { kind, name, action: 'save' };
}
