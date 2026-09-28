/**
 * Mutable sync state shared by the sync engines and the App (replaces the legacy module globals
 * `_currentSquadId`, `_squadCenter` and `_syncSeq`). Fields are plain properties because App sets the squad
 * eagerly at specific moments (before a sync starts, or when reverting a failed switch).
 */
export type LatLng = { lat: number; lng: number };
type SquadBounds = {
  id?: string | null;
  boundsSwLat?: number | null;
  boundsSwLng?: number | null;
  boundsNeLat?: number | null;
  boundsNeLng?: number | null;
};

/** Midpoint of a squad's area: the default map centre for pickers without coordinates. */
export const squadCenter = (sq: SquadBounds | null | undefined): LatLng | null =>
  sq?.boundsSwLat != null && sq?.boundsNeLat != null
    ? { lat: (sq.boundsSwLat + sq.boundsNeLat) / 2, lng: ((sq.boundsSwLng as number) + (sq.boundsNeLng as number)) / 2 }
    : null;

export function createSyncSession() {
  return {
    /** Active squad; syncs filter to it and discard results if it changes mid-flight. */
    currentSquadId: null as string | null,
    squadCenter: null as LatLng | null,
    /** Incremented by every full/incremental sync; a sync whose number is no longer latest is stale. */
    seq: 0,
    setSquad(sq: SquadBounds | null | undefined) {
      this.currentSquadId = sq?.id || null;
      this.squadCenter = squadCenter(sq);
    },
    nextSeq(): number {
      return ++this.seq;
    },
    isLatest(n: number): boolean {
      return n === this.seq;
    },
  };
}

export type SyncSession = ReturnType<typeof createSyncSession>;
