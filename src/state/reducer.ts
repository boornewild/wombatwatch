/**
 * Pure state transitions for AppData. Persistence happens separately (persistence.ts).
 *
 * `_sync: false` marks a record as edited locally and not yet confirmed by Supabase. The sync merge
 * keeps local `_sync: false` records over server copies, so an edit survives a server pull that
 * lands before the upload finishes.
 */
import { nextBurrowCode, nextWombatCode } from '../domain/codes';
import type { AppData, Burrow, Wombat } from '../domain/types';
import type { Action } from './actions';

type Keyed = { id: string; _sync?: boolean };

/** Incremental sync: apply server changes, but never overwrite a record with unsaved local edits. */
function patchKeepingLocalEdits<T extends Keyed>(existing: T[], changed?: T[]): T[] {
  if (!changed || !changed.length) return existing;
  const byId = new Map(existing.map((r) => [r.id, r]));
  changed.forEach((r) => {
    const local = byId.get(r.id);
    if (!local || local._sync !== false) byId.set(r.id, r);
  });
  return [...byId.values()];
}

const withoutId = (ids: string[] | undefined, id: string) => (ids || []).filter((x) => x !== id);

export function reducer(state: AppData, action: Action): AppData {
  switch (action.type) {
    // ── Wombats ──────────────────────────────────────────────────
    case 'ADD_WOMBAT':
      return { ...state, wombats: [...state.wombats, { ...action.wombat, _sync: false }] };
    case 'UPDATE_WOMBAT':
      return { ...state, wombats: state.wombats.map((w) => (w.id === action.id ? { ...w, ...action.patch, _sync: false } : w)) };
    // Assignment UI is hidden pending rollout; reducer and sync are live.
    case 'ASSIGN_WOMBAT':
      return {
        ...state,
        wombats: state.wombats.map((w) =>
          w.id === action.wombatId
            ? { ...w, assignees: [...(w.assignees || []).filter((a) => a.userId !== action.userId), { userId: action.userId, name: action.name }], _sync: false }
            : w,
        ),
      };
    case 'UNASSIGN_WOMBAT':
      return {
        ...state,
        wombats: state.wombats.map((w) =>
          w.id === action.wombatId ? { ...w, assignees: (w.assignees || []).filter((a) => a.userId !== action.userId), _sync: false } : w,
        ),
      };
    case 'MARK_WOMBAT_INACTIVE':
      return {
        ...state,
        wombats: state.wombats.map((w) =>
          w.id === action.id
            ? { ...w, status: action.status, inactiveAt: action.inactiveAt, inactiveCause: action.inactiveCause || null, inactiveNotes: action.inactiveNotes || null, _sync: false }
            : w,
        ),
      };
    case 'MARK_WOMBAT_ACTIVE':
      return {
        ...state,
        wombats: state.wombats.map((w) =>
          w.id === action.id ? { ...w, status: action.status, inactiveAt: null, inactiveCause: null, inactiveNotes: null, _sync: false } : w,
        ),
      };
    case 'ARCHIVE_WOMBAT':
      return { ...state, wombats: state.wombats.map((w) => (w.id === action.id ? { ...w, status: 'archived', _sync: false } : w)) };
    case 'IMPORT_WOMBATS':
      return { ...state, wombats: [...state.wombats, ...action.wombats] };
    case 'DELETE_WOMBAT':
      // Mirrors Supabase's ON DELETE CASCADE locally. Burrows that referenced the wombat are marked
      // unsynced so the corrected wombatIds win over the server copy until uploaded.
      return {
        ...state,
        wombats: state.wombats.filter((w) => w.id !== action.id),
        treatments: state.treatments.filter((t) => t.wombatId !== action.id),
        sightings: state.sightings.filter((s) => s.wombatId !== action.id),
        wombatPhotos: state.wombatPhotos.filter((p) => p.wombatId !== action.id),
        burrows: state.burrows.map((b) =>
          b.wombatIds?.includes(action.id) ? { ...b, wombatIds: withoutId(b.wombatIds, action.id), _sync: false } : b,
        ),
      };

    // ── Burrows ──────────────────────────────────────────────────
    case 'ADD_BURROW':
      return { ...state, burrows: [...state.burrows, { ...action.burrow, _sync: false }] };
    case 'ASSIGN_MISSING_CODES': {
      const burrowsSoFar: Burrow[] = state.burrows.filter((b) => b.code);
      const burrows = state.burrows.map((b) => {
        if (b.code) return b;
        const code = nextBurrowCode(burrowsSoFar);
        burrowsSoFar.push({ ...b, code });
        return { ...b, code, _sync: false };
      });
      const wombatsSoFar: Wombat[] = state.wombats.filter((w) => w.code);
      const wombats = state.wombats.map((w) => {
        if (w.code) return w;
        const code = nextWombatCode(wombatsSoFar);
        wombatsSoFar.push({ ...w, code });
        return { ...w, code, _sync: false };
      });
      return { ...state, burrows, wombats };
    }
    case 'RENUMBER_BURROWS': {
      // Oldest first; burrows without a creation time go last.
      const sorted = [...state.burrows].sort(
        (a, b) => new Date(a._createdAt || '2099').getTime() - new Date(b._createdAt || '2099').getTime(),
      );
      const codeById = new Map(sorted.map((b, i) => [b.id, 'B' + String(i + 1).padStart(4, '0')]));
      return { ...state, burrows: state.burrows.map((b) => ({ ...b, code: codeById.get(b.id) || b.code, _sync: false })) };
    }
    case 'IMPORT_BURROWS': {
      const burrowsSoFar: Burrow[] = [...state.burrows];
      const withCodes = action.burrows.map((b) => {
        if (b.code) return b;
        const code = nextBurrowCode(burrowsSoFar);
        burrowsSoFar.push({ ...b, code });
        return { ...b, code };
      });
      return { ...state, burrows: [...state.burrows, ...withCodes] };
    }
    case 'UPDATE_BURROW':
      return { ...state, burrows: state.burrows.map((b) => (b.id === action.id ? { ...b, ...action.patch, _sync: false } : b)) };
    case 'DELETE_BURROW':
      return {
        ...state,
        burrows: state.burrows.filter((b) => b.id !== action.id),
        burrowLogs: state.burrowLogs.filter((l) => l.burrowId !== action.id),
        burrowPhotos: state.burrowPhotos.filter((p) => p.burrowId !== action.id),
        wombats: state.wombats.map((w) =>
          w.burrowIds?.includes(action.id) ? { ...w, burrowIds: withoutId(w.burrowIds, action.id), _sync: false } : w,
        ),
      };

    // ── Treatments & sightings ───────────────────────────────────
    case 'ADD_TREATMENT':
      return { ...state, treatments: [...state.treatments, { ...action.treatment, _sync: false }] };
    case 'EDIT_TREATMENT':
      return { ...state, treatments: state.treatments.map((t) => (t.id === action.treatment.id ? { ...action.treatment, _sync: false } : t)) };
    case 'DELETE_TREATMENT':
      return { ...state, treatments: state.treatments.filter((t) => t.id !== action.treatmentId) };
    // Sightings are not an active UI feature, but existing data must still persist.
    case 'ADD_SIGHTING':
      return { ...state, sightings: [...state.sightings, { ...action.sighting, _sync: false }] };
    case 'DELETE_SIGHTING':
      return { ...state, sightings: state.sightings.filter((s) => s.id !== action.sightingId) };

    // ── Photos ───────────────────────────────────────────────────
    case 'ADD_WOMBAT_PHOTO':
      return { ...state, wombatPhotos: [...state.wombatPhotos, { ...action.photo, _sync: false }] };
    case 'SET_PROFILE_PHOTO':
      // One profile photo per wombat; every photo of that wombat is marked unsynced.
      return {
        ...state,
        wombatPhotos: state.wombatPhotos.map((p) => (p.wombatId === action.wombatId ? { ...p, isProfile: p.id === action.photoId, _sync: false } : p)),
      };
    case 'DELETE_WOMBAT_PHOTO':
      return { ...state, wombatPhotos: state.wombatPhotos.filter((p) => p.id !== action.photoId) };
    case 'ADD_BURROW_PHOTO':
      return { ...state, burrowPhotos: [...state.burrowPhotos, { ...action.photo, _sync: false }] };
    case 'SET_BURROW_PROFILE_PHOTO':
      return {
        ...state,
        burrowPhotos: state.burrowPhotos.map((p) => (p.burrowId === action.burrowId ? { ...p, isProfile: p.id === action.photoId, _sync: false } : p)),
      };
    case 'DELETE_BURROW_PHOTO':
      return { ...state, burrowPhotos: state.burrowPhotos.filter((p) => p.id !== action.photoId) };
    case 'HYDRATE_PHOTO_DATA': {
      // Puts image data from the IndexedDB photo store back into memory so photos render. Never persisted.
      const m = action.map;
      return {
        ...state,
        wombatPhotos: (state.wombatPhotos || []).map((p) => (m[p.id] ? { ...p, dataUrl: m[p.id] } : p)),
        burrowPhotos: (state.burrowPhotos || []).map((p) => (m[p.id] ? { ...p, dataUrl: m[p.id] } : p)),
      };
    }

    // ── Burrow logs ──────────────────────────────────────────────
    case 'DELETE_BURROW_LOG': {
      // Burrow status/lastChecked fall back to the most recent remaining log (unchanged if none remain).
      const burrowLogs = state.burrowLogs.filter((l) => l.id !== action.logId);
      const latest = burrowLogs
        .filter((l) => l.burrowId === action.burrowId)
        .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())[0];
      const burrows = state.burrows.map((b) =>
        b.id === action.burrowId ? { ...b, status: latest?.status || b.status, lastChecked: latest?.at || b.lastChecked, _sync: false } : b,
      );
      return { ...state, burrowLogs, burrows };
    }
    case 'ADD_BURROW_LOG': {
      // Copies what the log recorded onto its burrow; fields the log left empty are not touched.
      const { log } = action;
      const patch: Partial<Burrow> = { status: log.status, lastChecked: log.at };
      if (log.heightCm != null && log.heightCm !== '') patch.entranceHeightCm = log.heightCm as number;
      if (log.widthCm != null && log.widthCm !== '') patch.entranceWidthCm = log.widthCm as number;
      if (log.orientation) patch.orientation = log.orientation;
      const burrows = state.burrows.map((b) => {
        if (b.id !== log.burrowId) return b;
        const habitat: Record<string, unknown> = {};
        if (log.substrate) habitat.substrate = log.substrate;
        if (log.vegetation) habitat.vegetation = log.vegetation;
        if (log.trailCamera !== undefined) habitat.trailCamera = log.trailCamera;
        return { ...b, ...patch, habitat: { ...b.habitat, ...habitat }, _sync: false };
      });
      return { ...state, burrowLogs: [...state.burrowLogs, { ...log, _sync: false }], burrows };
    }

    // ── Links (always bidirectional; dispatching twice is safe) ──
    case 'LINK_WOMBAT_BURROW': {
      const { wombatId, burrowId } = action;
      return {
        ...state,
        wombats: state.wombats.map((w) => (w.id === wombatId ? { ...w, burrowIds: [...withoutId(w.burrowIds, burrowId), burrowId], _sync: false } : w)),
        burrows: state.burrows.map((b) => (b.id === burrowId ? { ...b, wombatIds: [...withoutId(b.wombatIds, wombatId), wombatId], _sync: false } : b)),
      };
    }
    case 'UNLINK_WOMBAT_BURROW': {
      const { wombatId, burrowId } = action;
      return {
        ...state,
        wombats: state.wombats.map((w) => (w.id === wombatId ? { ...w, burrowIds: withoutId(w.burrowIds, burrowId), _sync: false } : w)),
        burrows: state.burrows.map((b) => (b.id === burrowId ? { ...b, wombatIds: withoutId(b.wombatIds, wombatId), _sync: false } : b)),
      };
    }

    // ── Sync ─────────────────────────────────────────────────────
    case 'PATCH_RECORDS': {
      // Deletions are not handled here; the daily full sync (REPLACE_ALL) covers them.
      const d = action.data;
      return {
        ...state,
        burrows: patchKeepingLocalEdits(state.burrows, d.burrows),
        wombats: patchKeepingLocalEdits(state.wombats, d.wombats),
        treatments: patchKeepingLocalEdits(state.treatments, d.treatments),
        sightings: patchKeepingLocalEdits(state.sightings, d.sightings),
        burrowLogs: patchKeepingLocalEdits(state.burrowLogs, d.burrowLogs),
        wombatPhotos: patchKeepingLocalEdits(state.wombatPhotos, d.wombatPhotos),
        burrowPhotos: patchKeepingLocalEdits(state.burrowPhotos, d.burrowPhotos),
      };
    }
    case 'REPLACE_ALL': {
      // action.data is already merged with pending local edits by the full sync.
      const { wombats, burrows, treatments, sightings, burrowLogs, wombatPhotos, burrowPhotos } = action.data;
      return { ...state, wombats, burrows, treatments, sightings, burrowLogs, wombatPhotos, burrowPhotos };
    }

    default:
      return state;
  }
}
