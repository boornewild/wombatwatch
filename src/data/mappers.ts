/**
 * Convert between app records (camelCase, src/domain/types.ts) and Supabase rows (snake_case,
 * generated in database.types.ts). Ported unchanged from the legacy app, including its quirks
 * (see mappers.test.ts). If a column is added to the DB, `npm run db:types` then update both directions here.
 */
import type { Database } from './database.types';
import type { Burrow, BurrowLog, BurrowPhoto, Sighting, Treatment, Wombat, WombatPhoto } from '../domain/types';

type Tables = Database['public']['Tables'];
type Row<T extends keyof Tables> = Tables[T]['Row'];
type Insert<T extends keyof Tables> = Tables[T]['Insert'];
type UserId = string | null | undefined;

// ── Wombats ───────────────────────────────────────────────────────────────────
export const wombatToDb = (w: Wombat, uid: UserId): Insert<'wombats'> => ({
  id: w.id,
  created_by: uid || null,
  squad_id: w.squadId || null,
  name: w.name,
  sex: w.sex || null,
  age_class: w.ageClass || null,
  status: w.status || null,
  severity: w.severity || {},
  burrow_ids: w.burrowIds || [],
  first_seen: w.firstSeen || null,
  location: w.location || null,
  lat: w.lat || null,
  lng: w.lng || null,
  notes: w.notes || null,
  code: w.code || null,
  location_label: w.locationLabel || null,
  inactive_at: w.inactiveAt || null,
  inactive_cause: w.inactiveCause || null,
  inactive_notes: w.inactiveNotes || null,
  assignees: w.assignees || [],
});

export const dbToWombat = (r: Row<'wombats'>): Wombat => ({
  id: r.id,
  name: r.name,
  sex: r.sex,
  ageClass: r.age_class,
  // 'mange' was renamed to 'under_treatment'; old rows may still carry it.
  status: r.status === 'mange' ? 'under_treatment' : r.status,
  severity: r.severity || {},
  burrowIds: r.burrow_ids || [],
  firstSeen: r.first_seen,
  location: r.location,
  lat: r.lat,
  lng: r.lng,
  notes: r.notes,
  code: r.code,
  locationLabel: r.location_label || null,
  inactiveAt: r.inactive_at || null,
  inactiveCause: r.inactive_cause || null,
  inactiveNotes: r.inactive_notes || null,
  squadId: r.squad_id || null,
  assignees: r.assignees || [],
  _createdBy: r.created_by,
  _sync: true,
});

// ── Burrows ───────────────────────────────────────────────────────────────────
export const burrowToDb = (b: Burrow, uid: UserId): Insert<'burrows'> => ({
  id: b.id,
  created_by: uid || null,
  squad_id: b.squadId || null,
  name: b.name,
  status: b.status || null,
  location: b.location || null,
  lat: b.lat || null,
  lng: b.lng || null,
  habitat: b.habitat || {},
  wombat_ids: b.wombatIds || [],
  last_checked: b.lastChecked || null,
  next_check: b.nextCheck || null,
  entrance_height_cm: b.entranceHeightCm || null,
  entrance_width_cm: b.entranceWidthCm || null,
  orientation: b.orientation || null,
  code: b.code || null,
});

export const dbToBurrow = (r: Row<'burrows'>): Burrow => ({
  id: r.id,
  name: r.name,
  status: r.status,
  location: r.location,
  lat: r.lat,
  lng: r.lng,
  habitat: r.habitat || {},
  wombatIds: r.wombat_ids || [],
  lastChecked: r.last_checked,
  nextCheck: r.next_check,
  entranceHeightCm: r.entrance_height_cm,
  entranceWidthCm: r.entrance_width_cm,
  orientation: r.orientation,
  code: r.code,
  squadId: r.squad_id || null,
  _createdBy: r.created_by,
  _createdAt: r.created_at || null,
  _sync: true,
});

// ── Treatments ────────────────────────────────────────────────────────────────
export const treatmentToDb = (t: Treatment, uid: UserId): Insert<'treatments'> => ({
  id: t.id,
  wombat_id: t.wombatId,
  created_by: uid || null,
  at: t.at,
  by_name: t.by || null,
  product: t.product || null,
  dose: t.dose || null,
  method: t.method || null,
  severity: t.severity || null,
  regions: t.regions || {},
  note: t.note || null,
  linked_burrow_id: t.linkedBurrowId || null,
  marked_recovered: t.markedRecovered || false,
});

export const dbToTreatment = (r: Row<'treatments'>): Treatment => ({
  id: r.id,
  wombatId: r.wombat_id,
  at: r.at,
  by: r.by_name,
  product: r.product,
  dose: r.dose,
  method: r.method,
  severity: r.severity,
  regions: r.regions || {},
  note: r.note,
  linkedBurrowId: r.linked_burrow_id || null,
  markedRecovered: r.marked_recovered || false,
  _createdBy: r.created_by,
  _sync: true,
});

// ── Sightings ─────────────────────────────────────────────────────────────────
export const sightingToDb = (s: Sighting, uid: UserId): Insert<'sightings'> => ({
  id: s.id,
  wombat_id: s.wombatId,
  created_by: uid || null,
  at: s.at,
  lat: s.lat || null,
  lng: s.lng || null,
  note: s.note || null,
});

export const dbToSighting = (r: Row<'sightings'>): Sighting => ({
  id: r.id,
  wombatId: r.wombat_id,
  at: r.at,
  lat: r.lat,
  lng: r.lng,
  note: r.note,
  _createdBy: r.created_by,
  _sync: true,
});

// ── Burrow logs ───────────────────────────────────────────────────────────────
export const burrowLogToDb = (l: BurrowLog, uid: UserId): Insert<'burrow_logs'> => ({
  id: l.id,
  burrow_id: l.burrowId,
  created_by: uid || null,
  at: l.at,
  status: l.status || null,
  condition: l.condition || null,
  occupants: l.occupants || null,
  height_cm: l.heightCm || null,
  width_cm: l.widthCm || null,
  orientation: l.orientation || null,
  substrate: l.substrate || null,
  vegetation: l.vegetation || null,
  note: l.note || null,
  by_name: l.by || null,
});

export const dbToBurrowLog = (r: Row<'burrow_logs'>): BurrowLog => ({
  id: r.id,
  burrowId: r.burrow_id,
  at: r.at,
  status: r.status,
  condition: r.condition,
  occupants: r.occupants,
  heightCm: r.height_cm,
  widthCm: r.width_cm,
  orientation: r.orientation,
  substrate: r.substrate,
  vegetation: r.vegetation,
  note: r.note,
  by: r.by_name,
  _createdBy: r.created_by,
  _sync: true,
});

// ── Photos ────────────────────────────────────────────────────────────────────
export const wombatPhotoToDb = (p: WombatPhoto, uid: UserId): Insert<'wombat_photos'> => ({
  id: p.id,
  wombat_id: p.wombatId,
  created_by: uid || null,
  is_profile: p.isProfile || false,
  data_url: p.dataUrl || null,
  at: p.at || new Date().toISOString(),
});

export const dbToWombatPhoto = (r: Row<'wombat_photos'>): WombatPhoto => ({
  id: r.id,
  wombatId: r.wombat_id,
  isProfile: r.is_profile,
  dataUrl: r.data_url,
  at: r.at,
  _createdBy: r.created_by,
  _sync: true,
});

export const burrowPhotoToDb = (p: BurrowPhoto, uid: UserId): Insert<'burrow_photos'> => ({
  id: p.id,
  burrow_id: p.burrowId,
  created_by: uid || null,
  is_profile: p.isProfile || false,
  data_url: p.dataUrl || null,
  at: p.at || new Date().toISOString(),
});

export const dbToBurrowPhoto = (r: Row<'burrow_photos'>): BurrowPhoto => ({
  id: r.id,
  burrowId: r.burrow_id,
  isProfile: r.is_profile,
  dataUrl: r.data_url,
  at: r.at,
  _createdBy: r.created_by,
  _sync: true,
});
