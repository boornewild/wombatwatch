/**
 * App-side record shapes (camelCase), as held in React state and IndexedDB.
 * Fields prefixed `_` are local bookkeeping and never sent to Supabase.
 * Optional fields reflect what the legacy code actually tolerates; tighten them as features move out of legacy.
 */
import type { Json } from '../data/database.types';

type SyncMeta = { _createdBy?: string | null; _sync?: boolean };

export type Assignee = { userId: string; name?: string };
/** Burrow habitat is free-form JSON in the DB; these are the keys the app writes. */
export type Habitat = { substrate?: string; vegetation?: string; trailCamera?: unknown; [key: string]: unknown };

export type Wombat = SyncMeta & {
  id: string;
  name: string;
  sex?: string | null;
  ageClass?: string | null;
  status?: string | null;
  severity?: Json;
  burrowIds?: string[];
  firstSeen?: string | null;
  location?: string | null;
  lat?: number | null;
  lng?: number | null;
  notes?: string | null;
  code?: string | null;
  locationLabel?: string | null;
  inactiveAt?: string | null;
  inactiveCause?: string | null;
  inactiveNotes?: string | null;
  squadId?: string | null;
  assignees?: Assignee[];
};

export type Burrow = SyncMeta & {
  id: string;
  name: string;
  status?: string | null;
  location?: string | null;
  lat?: number | null;
  lng?: number | null;
  habitat?: Habitat;
  wombatIds?: string[];
  lastChecked?: string | null;
  nextCheck?: string | null;
  entranceHeightCm?: number | null;
  entranceWidthCm?: number | null;
  orientation?: string | null;
  code?: string | null;
  squadId?: string | null;
  _createdAt?: string | null;
};

export type Treatment = SyncMeta & {
  id: string;
  wombatId: string;
  at: string;
  by?: string | null;
  product?: string | null;
  dose?: string | null;
  method?: string | null;
  severity?: number | null;
  regions?: Json;
  note?: string | null;
  linkedBurrowId?: string | null;
  markedRecovered?: boolean;
};

export type Sighting = SyncMeta & {
  id: string;
  wombatId: string;
  at: string;
  lat?: number | null;
  lng?: number | null;
  note?: string | null;
};

export type BurrowLog = SyncMeta & {
  id: string;
  burrowId: string;
  at: string;
  status?: string | null;
  condition?: string | null;
  occupants?: number | null;
  // Form inputs may hand over '' for an empty measurement.
  heightCm?: number | string | null;
  widthCm?: number | string | null;
  orientation?: string | null;
  substrate?: string | null;
  vegetation?: string | null;
  note?: string | null;
  by?: string | null;
  /** Not stored on the log row; copied onto the burrow's habitat. */
  trailCamera?: unknown;
};

type PhotoBase = SyncMeta & { id: string; isProfile?: boolean; dataUrl?: string | null; at?: string };
export type WombatPhoto = PhotoBase & { wombatId: string };
export type BurrowPhoto = PhotoBase & { burrowId: string };

/** Everything the app holds in memory; one array per Supabase table. */
export type AppData = {
  wombats: Wombat[];
  burrows: Burrow[];
  treatments: Treatment[];
  sightings: Sighting[];
  burrowLogs: BurrowLog[];
  wombatPhotos: WombatPhoto[];
  burrowPhotos: BurrowPhoto[];
};
