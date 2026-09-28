/** Every change to AppData goes through one of these actions. */
import type { AppData, Burrow, BurrowLog, BurrowPhoto, Sighting, Treatment, Wombat, WombatPhoto } from '../domain/types';

export type Action =
  // Wombats
  | { type: 'ADD_WOMBAT'; wombat: Wombat; linkedBurrowId?: string | null }
  | { type: 'UPDATE_WOMBAT'; id: string; patch: Partial<Wombat> }
  | { type: 'ASSIGN_WOMBAT'; wombatId: string; userId: string; name?: string }
  | { type: 'UNASSIGN_WOMBAT'; wombatId: string; userId: string }
  | { type: 'MARK_WOMBAT_INACTIVE'; id: string; status: string; inactiveAt: string | null; inactiveCause?: string | null; inactiveNotes?: string | null }
  | { type: 'MARK_WOMBAT_ACTIVE'; id: string; status: string }
  | { type: 'ARCHIVE_WOMBAT'; id: string }
  | { type: 'IMPORT_WOMBATS'; wombats: Wombat[] }
  // Child ids are captured at dispatch time, before the reducer removes them, so sync can delete them remotely.
  | { type: 'DELETE_WOMBAT'; id: string; burrowIds?: string[]; treatmentIds?: string[]; wombatPhotoIds?: string[] }
  // Burrows
  | { type: 'ADD_BURROW'; burrow: Burrow }
  | { type: 'ASSIGN_MISSING_CODES' }
  | { type: 'RENUMBER_BURROWS' }
  | { type: 'IMPORT_BURROWS'; burrows: Burrow[] }
  | { type: 'UPDATE_BURROW'; id: string; patch: Partial<Burrow> }
  | { type: 'DELETE_BURROW'; id: string; wombatIds?: string[]; burrowLogIds?: string[]; burrowPhotoIds?: string[] }
  // Treatments and sightings
  | { type: 'ADD_TREATMENT'; treatment: Treatment }
  | { type: 'EDIT_TREATMENT'; treatment: Treatment }
  | { type: 'DELETE_TREATMENT'; treatmentId: string }
  | { type: 'ADD_SIGHTING'; sighting: Sighting }
  | { type: 'DELETE_SIGHTING'; sightingId: string }
  // Photos
  | { type: 'ADD_WOMBAT_PHOTO'; photo: WombatPhoto }
  | { type: 'SET_PROFILE_PHOTO'; wombatId: string; photoId: string }
  | { type: 'DELETE_WOMBAT_PHOTO'; photoId: string }
  | { type: 'ADD_BURROW_PHOTO'; photo: BurrowPhoto }
  | { type: 'SET_BURROW_PROFILE_PHOTO'; burrowId: string; photoId: string }
  | { type: 'DELETE_BURROW_PHOTO'; photoId: string }
  | { type: 'HYDRATE_PHOTO_DATA'; map: Record<string, string> }
  // Burrow logs
  | { type: 'ADD_BURROW_LOG'; log: BurrowLog }
  | { type: 'DELETE_BURROW_LOG'; logId: string; burrowId: string }
  // Links
  | { type: 'LINK_WOMBAT_BURROW'; wombatId: string; burrowId: string }
  | { type: 'UNLINK_WOMBAT_BURROW'; wombatId: string; burrowId: string }
  // Sync
  | { type: 'PATCH_RECORDS'; data: Partial<AppData> }
  | { type: 'REPLACE_ALL'; data: AppData };

export type ActionType = Action['type'];
