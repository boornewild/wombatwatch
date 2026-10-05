/**
 * Sends one dispatched action to Supabase (legacy `syncAction`, same behaviour).
 *
 * Each write goes through `push`/`del`: offline, a failed write, or a write that throws is queued for the
 * flush engine, so an edit is never silently lost. Records are re-read from IndexedDB and the action's change
 * is applied again, because the reducer's IndexedDB save is fire-and-forget and may not have landed yet.
 */
import {
  burrowPhotoToDb,
  burrowToDb,
  burrowLogToDb,
  sightingToDb,
  treatmentToDb,
  wombatPhotoToDb,
  wombatToDb,
} from '../data/mappers';
import type { Burrow, BurrowPhoto, Habitat, Wombat, WombatPhoto } from '../domain/types';
import type { Action } from '../state/actions';
import type { NewQueueOp, RecordStoreName } from './idb/appDb';
import type { Remote } from './remote';

export interface SyncActionDeps {
  isOnline: () => boolean;
  /** Latest local copy of a record, or null (never throws). */
  getRecord: <T>(store: RecordStoreName, id: string) => Promise<T | null>;
  getAllRecords: <T>(store: RecordStoreName) => Promise<T[]>;
  remote: Pick<Remote, 'upsert' | 'remove' | 'removeStorage' | 'upsertBatch'>;
  queueOp: (op: NewQueueOp) => Promise<void>;
  markSynced: (store: string, id: string) => Promise<void>;
  markRecentlyDeleted: (id: string) => Promise<void>;
  putLocalPhoto: (photoId: string, dataUrl: string) => Promise<void>;
  getLocalPhoto: (photoId: string) => Promise<string | null>;
  resolvePhotoUrl: (dataUrl: string | null | undefined, photoId: string, localStorageKey: string) => Promise<string | null | undefined>;
}

const WOMBAT_PHOTOS_LS_KEY = 'ww2_wombat_photos';
const BURROW_PHOTOS_LS_KEY = 'ww2_burrow_photos';
const RENUMBER_CHUNK = 200;
const photoPath = (photoId: string) => `${photoId}.jpg`;
const withoutId = (ids: string[] | undefined, id: string) => (ids || []).filter((x) => x !== id);

export async function syncAction(action: Action, userId: string, deps: SyncActionDeps): Promise<void> {
  const { isOnline, remote } = deps;

  const push = async (table: string, row: object) => {
    const base = row as { id?: string; created_by?: string | null };
    const r: Record<string, unknown> & { id?: string } = { ...base, created_by: base.created_by || userId };
    if (!isOnline()) return deps.queueOp({ t: 'upsert', table, row: r });
    try {
      const { ok } = await remote.upsert(table, r);
      if (!ok) return deps.queueOp({ t: 'upsert', table, row: r });
      // Confirms the push, and `_pushedAt` lets a full sync already in flight keep this version.
      if (r.id) await deps.markSynced(table, r.id as string);
    } catch (e) {
      console.warn('[Supa] push threw, queuing for retry:', table, e);
      await deps.queueOp({ t: 'upsert', table, row: r });
    }
  };

  const del = async (table: string, id: string) => {
    if (!isOnline()) return deps.queueOp({ t: 'delete', table, id });
    try {
      const { ok } = await remote.remove(table, id);
      // Remembered so a full sync already in flight can't bring the record back.
      if (ok) await deps.markRecentlyDeleted(id);
      else await deps.queueOp({ t: 'delete', table, id });
    } catch (e) {
      console.warn('[Supa] del threw, queuing for retry:', table, id, e);
      await deps.queueOp({ t: 'delete', table, id });
    }
  };

  const wombat = (id: string) => deps.getRecord<Wombat>('wombats', id);
  const burrow = (id: string) => deps.getRecord<Burrow>('burrows', id);
  const pushWombat = (w: Wombat) => push('wombats', wombatToDb(w, userId));
  const pushBurrow = (b: Burrow) => push('burrows', burrowToDb(b, userId));

  /** Deleting a photo also removes its Storage file: now if online (not awaited), else via the queue. */
  const removePhotoFile = async (photoId: string) => {
    if (isOnline()) remote.removeStorage(photoPath(photoId)).catch(() => {});
    else await deps.queueOp({ t: 'storage-delete', path: photoPath(photoId) });
  };

  /** Offline, the image is kept on the device and sent as base64 in the queued op, so it survives eviction. */
  const pushNewPhoto = async (photo: WombatPhoto | BurrowPhoto, lsKey: string, table: string) => {
    if (!isOnline() && photo.dataUrl?.startsWith('data:')) await deps.putLocalPhoto(photo.id, photo.dataUrl).catch(() => {});
    const url = isOnline() ? await deps.resolvePhotoUrl(photo.dataUrl, photo.id, lsKey) : photo.dataUrl;
    const row =
      table === 'wombat_photos'
        ? wombatPhotoToDb({ ...(photo as WombatPhoto), dataUrl: url }, userId)
        : burrowPhotoToDb({ ...(photo as BurrowPhoto), dataUrl: url }, userId);
    await push(table, row);
  };

  /** Re-sends every photo of the owner with the new profile flag, filling stripped image data from the device. */
  const pushProfileFlags = async <P extends WombatPhoto | BurrowPhoto>(
    photos: P[],
    photoId: string,
    lsKey: string,
    table: string,
  ) => {
    for (const p of photos) {
      let dataUrl = p.dataUrl;
      if (!dataUrl) dataUrl = (await deps.getLocalPhoto(p.id)) || null;
      const url = isOnline() ? await deps.resolvePhotoUrl(dataUrl, p.id, lsKey) : dataUrl;
      const next = { ...p, isProfile: p.id === photoId, dataUrl: url };
      await push(table, table === 'wombat_photos' ? wombatPhotoToDb(next as WombatPhoto, userId) : burrowPhotoToDb(next as BurrowPhoto, userId));
    }
  };

  try {
    switch (action.type) {
      // ── Wombats ──
      case 'ADD_WOMBAT':
        // Always pushed, even when LINK_WOMBAT_BURROW follows: the link's upsert simply wins (same id).
        await pushWombat(action.wombat);
        break;
      case 'UPDATE_WOMBAT': {
        const w = await wombat(action.id);
        if (w) await pushWombat({ ...w, ...action.patch });
        break;
      }
      case 'MARK_WOMBAT_INACTIVE': {
        const w = await wombat(action.id);
        if (w)
          await pushWombat({
            ...w,
            status: action.status,
            inactiveAt: action.inactiveAt,
            inactiveCause: action.inactiveCause || null,
            inactiveNotes: action.inactiveNotes || null,
          });
        break;
      }
      case 'MARK_WOMBAT_ACTIVE': {
        const w = await wombat(action.id);
        if (w) await pushWombat({ ...w, status: action.status, inactiveAt: null, inactiveCause: null, inactiveNotes: null });
        break;
      }
      case 'ARCHIVE_WOMBAT': {
        const w = await wombat(action.id);
        if (w) await pushWombat({ ...w, status: 'archived' });
        break;
      }
      case 'IMPORT_WOMBATS':
        for (const w of action.wombats || []) await pushWombat(w);
        break;
      case 'ASSIGN_WOMBAT': {
        const w = await wombat(action.wombatId);
        if (w) {
          const current = w.assignees || [];
          // Characterisation: an existing assignment keeps its old name (the reducer replaces it).
          const assignees = current.some((a) => a.userId === action.userId) ? current : [...current, { userId: action.userId, name: action.name }];
          await pushWombat({ ...w, assignees });
        }
        break;
      }
      case 'UNASSIGN_WOMBAT': {
        const w = await wombat(action.wombatId);
        if (w) await pushWombat({ ...w, assignees: (w.assignees || []).filter((a) => a.userId !== action.userId) });
        break;
      }
      case 'DELETE_WOMBAT': {
        await del('wombats', action.id);
        // Children deleted explicitly rather than trusting ON DELETE CASCADE.
        for (const id of action.treatmentIds || []) await del('treatments', id);
        for (const id of action.wombatPhotoIds || []) await del('wombat_photos', id);
        // Burrows still list the deleted wombat on the server until re-pushed.
        for (const id of action.burrowIds || []) {
          const b = await burrow(id);
          if (b) await pushBurrow(b);
        }
        break;
      }

      // ── Burrows ──
      case 'ADD_BURROW':
        // IndexedDB copy may already include links made right after adding; fall back to the action.
        await pushBurrow((await burrow(action.burrow.id)) || action.burrow);
        break;
      case 'UPDATE_BURROW': {
        const b = await burrow(action.id);
        if (b) await pushBurrow({ ...b, ...action.patch });
        break;
      }
      case 'IMPORT_BURROWS':
        for (const b of action.burrows || []) await pushBurrow(b);
        break;
      case 'ASSIGN_MISSING_CODES': {
        for (const b of (await deps.getAllRecords<Burrow>('burrows')).filter((x) => x.code)) await pushBurrow(b);
        for (const w of (await deps.getAllRecords<Wombat>('wombats')).filter((x) => x.code)) await pushWombat(w);
        break;
      }
      case 'RENUMBER_BURROWS': {
        // Every burrow changes, so rows go in batches when online. Offline, or if a batch fails, each row is
        // queued like any other edit so the new numbers still reach the server.
        const rows = (await deps.getAllRecords<Burrow>('burrows')).map((b) => burrowToDb(b, userId));
        const queueRows = async (chunk: typeof rows) => {
          for (const row of chunk) await deps.queueOp({ t: 'upsert', table: 'burrows', row });
        };
        for (let i = 0; i < rows.length; i += RENUMBER_CHUNK) {
          const chunk = rows.slice(i, i + RENUMBER_CHUNK);
          if (!isOnline()) {
            await queueRows(chunk);
            continue;
          }
          let ok = false;
          try {
            ok = (await remote.upsertBatch('burrows', chunk)).ok;
          } catch (e) {
            console.warn('[Supa] renumber batch threw, queuing for retry:', e);
          }
          // Confirmed rows must be marked synced, or the local copy would keep overriding the server forever.
          if (ok) for (const row of chunk) await deps.markSynced('burrows', row.id);
          else await queueRows(chunk);
        }
        break;
      }
      case 'DELETE_BURROW': {
        await del('burrows', action.id);
        for (const id of action.burrowLogIds || []) await del('burrow_logs', id);
        for (const id of action.burrowPhotoIds || []) await del('burrow_photos', id);
        for (const id of action.wombatIds || []) {
          const w = await wombat(id);
          if (w) await pushWombat(w);
        }
        break;
      }

      // ── Treatments & sightings ──
      case 'ADD_TREATMENT':
      case 'EDIT_TREATMENT':
        await push('treatments', treatmentToDb(action.treatment, userId));
        break;
      case 'DELETE_TREATMENT':
        await del('treatments', action.treatmentId);
        break;
      case 'ADD_SIGHTING':
        await push('sightings', sightingToDb(action.sighting, userId));
        break;
      case 'DELETE_SIGHTING':
        await del('sightings', action.sightingId);
        break;

      // ── Burrow logs ──
      case 'ADD_BURROW_LOG': {
        const { log } = action;
        await push('burrow_logs', burrowLogToDb(log, userId));
        // Same burrow update the reducer applies (see state/reducer.ts ADD_BURROW_LOG).
        const b = await burrow(log.burrowId);
        if (b) {
          const patch: Partial<Burrow> = { status: log.status, lastChecked: log.at };
          if (log.heightCm != null && log.heightCm !== '') patch.entranceHeightCm = log.heightCm as number;
          if (log.widthCm != null && log.widthCm !== '') patch.entranceWidthCm = log.widthCm as number;
          if (log.orientation) patch.orientation = log.orientation;
          const habitat: Habitat = {};
          if (log.substrate) habitat.substrate = log.substrate;
          if (log.vegetation) habitat.vegetation = log.vegetation;
          if (log.trailCamera !== undefined) habitat.trailCamera = log.trailCamera;
          await pushBurrow({ ...b, ...patch, habitat: { ...b.habitat, ...habitat } });
        }
        break;
      }
      case 'DELETE_BURROW_LOG': {
        await del('burrow_logs', action.logId);
        const b = await burrow(action.burrowId);
        if (b) await pushBurrow(b);
        break;
      }

      // ── Photos ──
      case 'ADD_WOMBAT_PHOTO':
        await pushNewPhoto(action.photo, WOMBAT_PHOTOS_LS_KEY, 'wombat_photos');
        break;
      case 'ADD_BURROW_PHOTO':
        await pushNewPhoto(action.photo, BURROW_PHOTOS_LS_KEY, 'burrow_photos');
        break;
      case 'DELETE_WOMBAT_PHOTO':
        await del('wombat_photos', action.photoId);
        await removePhotoFile(action.photoId);
        break;
      case 'DELETE_BURROW_PHOTO':
        await del('burrow_photos', action.photoId);
        await removePhotoFile(action.photoId);
        break;
      case 'SET_PROFILE_PHOTO': {
        const photos = (await deps.getAllRecords<WombatPhoto>('wombat_photos')).filter((p) => p.wombatId === action.wombatId);
        await pushProfileFlags(photos, action.photoId, WOMBAT_PHOTOS_LS_KEY, 'wombat_photos');
        break;
      }
      case 'SET_BURROW_PROFILE_PHOTO': {
        const photos = (await deps.getAllRecords<BurrowPhoto>('burrow_photos')).filter((p) => p.burrowId === action.burrowId);
        await pushProfileFlags(photos, action.photoId, BURROW_PHOTOS_LS_KEY, 'burrow_photos');
        break;
      }

      // ── Links (both sides pushed with the change applied) ──
      case 'LINK_WOMBAT_BURROW': {
        const w = await wombat(action.wombatId);
        if (w) await pushWombat({ ...w, burrowIds: [...withoutId(w.burrowIds, action.burrowId), action.burrowId] });
        const b = await burrow(action.burrowId);
        if (b) await pushBurrow({ ...b, wombatIds: [...withoutId(b.wombatIds, action.wombatId), action.wombatId] });
        break;
      }
      case 'UNLINK_WOMBAT_BURROW': {
        const w = await wombat(action.wombatId);
        if (w) await pushWombat({ ...w, burrowIds: withoutId(w.burrowIds, action.burrowId) });
        const b = await burrow(action.burrowId);
        if (b) await pushBurrow({ ...b, wombatIds: withoutId(b.wombatIds, action.wombatId) });
        break;
      }

      // HYDRATE_PHOTO_DATA, PATCH_RECORDS and REPLACE_ALL come from sync itself; nothing to send.
      default:
        break;
    }
  } catch (e) {
    console.warn('[Supa] syncAction error', e);
  }
}
