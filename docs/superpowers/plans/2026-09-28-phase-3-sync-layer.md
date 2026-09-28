# Phase 3 — Sync Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the offline sync engine (legacy `LegacyApp.jsx` lines ~391–1687 plus the sync orchestration in `App`) into `src/sync/` as typed, dependency-injected, tested modules, with identical behaviour. Bugs are fixed afterwards in separate branches.

**Architecture:** Split along what each piece touches.
- **Pure logic** (no I/O): squad filtering, the full-sync merge, late queue resolution, failure classification, queue ordering. Table-driven tests, plus randomised comparisons against the legacy functions.
- **Storage adapters:** IndexedDB app store and photo store. Tested with `fake-indexeddb`.
- **Remote adapter:** a thin wrapper over the Supabase client that returns `{ ok, error }` instead of writing to the `_lastSupaError` global.
- **Engines:** flush, per-action sync, full/incremental sync and photo caching. They take their dependencies as arguments, so tests pass fakes.
- **Session object:** replaces the module globals `_currentSquadId`, `_syncSeq` and `onAuthError`.

**Tech Stack:** TypeScript, Vitest, fake-indexeddb, Playwright (offline e2e via `context.setOffline`).

**Parent plan:** `2026-09-25-wombatwatch-refactor.md`. Branching: each task on `refactor/sync-<task>` off `refactor/major-overhaul`, merged `--no-ff` after all checks pass.

## Decisions (user, 2026-09-28)

1. Restructure first with identical behaviour; fix bugs #2, #11 and #12 afterwards as separate branches.
2. Keep the hand-written sync engine (no PowerSync). Prod is small: 4 users, 44 wombats, 523 burrows.
3. Merge the 5 copies of the full-sync sequence in `App` into one function that behaves like the **sign-in** copy. This is the one intended behaviour change in Phase 3, and it gets its own task (3.7).

## Global Constraints

- IndexedDB names, versions and stores are unchanged: `wombatwatch_v1` v1 (`wombats burrows treatments sightings burrow_logs wombat_photos burrow_photos queue meta`) and `ww_photo_data` v1 (store `p`).
- Queue op shapes are unchanged: `{t:'upsert',table,row,_qid,_retries}`, `{t:'delete',table,id,...}`, `{t:'storage-delete',path,...}`.
- Meta keys are unchanged: `migrated`, `recently_deleted`. localStorage keys `ww_last_sync_ts` and `ww_last_full_sync_date` are unchanged.
- Background Sync tag `ww-queue-flush` is unchanged.
- No file in `src/sync/` over 400 lines. `src/sync/merge.ts` and `src/sync/classify.ts` import nothing with I/O.
- Every task: lint, typecheck, unit, e2e and upgrade tests all pass before merging.

## Review Focus

1. **A queue written by the old app is flushed by the new code.** Task 3.1 and 3.4 tests build queue records in the exact legacy shape.
2. **Going offline, logging a treatment, then reconnecting uploads it.** Task 3.0 e2e.
3. **An edit made while a full sync is in flight is not overwritten by the stale server response.** Task 3.2 tests (`_pushedAt > fetchStart`, pending queue op, `_sync:false`).
4. **A server response with 0 rows for a table never wipes local synced records.** Task 3.2 test.
5. **A network drop mid-flush neither burns retry budget nor reorders the queue.** Task 3.4 tests.

---

## Task 3.0: Offline safety-net e2e (before touching any code)

**Files:** Create `tests/e2e/offline.spec.ts`

- [ ] Test A: sign in as alice → `context.setOffline(true)` → log a treatment (dose `2`, unique note) → assert IndexedDB `queue` has 1 upsert for `treatments` → `setOffline(false)` → poll Supabase until the treatment exists → assert queue empty.
- [ ] Test B: offline, edit Seed Wombat's name via the profile → reconnect → Supabase row has the new name.
- [ ] Both pass on the current code before any Phase 3 change. Commit.

## Task 3.1: IndexedDB adapters

**Files:** Create `src/sync/idb/appDb.ts`, `src/sync/idb/photoStore.ts` and their tests.

**Produces:**
- `appDb`: `saveAll(store, records)`, `getAll(store)`, `getOne(store, id)`, `markSynced(store, id, now?)`, `enqueue(op)`, `getQueue()`, `dequeue(qid)`, `updateQueueOp(op)`, `dataQueueCount()`, `metaGet(key)`, `metaSet(key, value)`, `migrateFromLocalStorage(storage)`.
- `photoStore`: `put(id, dataUrl)` (retries once on `InvalidStateError`/`DatabaseClosedError`), `getAll()`, `get(id)`, `remove(id)`.
- `STORE_NAMES` map (`w → wombats`, …).

Tests:
- Round trip per store.
- `saveAll` replaces the store's contents.
- `markSynced` sets `_sync:true` and `_pushedAt`.
- The queue auto-assigns `_qid` and defaults `_retries` to 0.
- `dataQueueCount` excludes photo and storage-delete ops.
- The migration copies the `ww2_*` keys, `ww_sync_queue` and `ww_sync_deleted`, and runs only once.
- **Read-compat:** a DB created exactly as the legacy `openAppDb` creates it is read correctly.

Swap into legacy by replacing the function bodies with imports under the same names.

## Task 3.2: Pure merge logic

**Files:** Create `src/sync/merge.ts` and `src/sync/merge.test.ts`.

**Produces:**
- `filterToSquad(data, squadId)`
- `mergeTable({ remote, local, queuedIds, deletedIds, recentlyDeleted, currentSquadId, fromDb })`: the legacy inner `merge`.
- `pendingSets(queue)` → `{ queuedIds, deletedIds, hasPendingUpserts }`
- `isConfirmedNewUser({ remoteWombats, remoteBurrows, hasPendingUpserts, localHasData })`
- `resolveWithQueue({ merged, local, queue, fetchStart, currentSquadId })`: the legacy `resolveWithCurrentQueue`, pure.

Table-driven tests:
- `remote === null` keeps local.
- Empty remote with synced local keeps local (minus deletes).
- Unsynced local wins.
- A queued upsert wins.
- Pending deletes and recently deleted records are removed.
- Another squad's local records are excluded.
- `_pushedAt > fetchStart` wins.
- A local null `dataUrl` takes the server URL.
- New local records created during the fetch are added.

Then the randomised comparison against the legacy functions (harness file, deleted after).

## Task 3.3: Remote adapter + failure classification

**Files:** Create `src/sync/remote.ts`, `src/sync/classify.ts` and their tests.

**Produces:**
- `createRemote(supa, { onAuthError })` → `upsert(table,row)`, `remove(table,id)`, `removeStorage(path)`, `uploadPhoto(dataUrl, id)`, `publicPhotoUrl(id)`, `downloadPhoto(id)`, `fetchTable(table, columns, since?)`. Every method returns `{ ok: boolean; error?: string }` or data.
- `classifyFailure(error, online)` → `'network' | 'auth' | 'genuine'`. Same regexes as the legacy `isNetworkError` and `isAuthErrorStr`.
- `dataUrlToBlob`.

Tests:
- Every legacy error string is classified the same way.
- `onAuthError` fires on 401, PGRST301 and jwt messages.

## Task 3.4: Queue + flush engine

**Files:** Create `src/sync/queue.ts`, `src/sync/flush.ts` and their tests.

**Produces:**
- `queueOp(op, { appDb, notify, registerBackgroundSync })`
- `flushQueue(userId, deps)` → `{ uploadedPhotoIds, lostPhotoIds }`. The legacy early return of `new Set()` becomes an empty result object; the callers already read `r?.lostPhotoIds`.
- `sortQueue(ops)`: parents before children before photos before storage-deletes.

Tests, using a fake remote and fake-indexeddb:
- Priority order.
- Success dequeues, marks synced and records photo IDs.
- A network error stops the flush with the retry count unchanged.
- An auth error stops the flush.
- A genuine error increments `_retries`, and the op is dropped with `notify` called at 5 (pinned; changed later by fix #2).
- A photo op with no image data anywhere is discarded into `lostPhotoIds`.
- A base64 photo is uploaded and its URL written back to the stored record.
- A successful delete lands in `recently_deleted`.

## Task 3.5: Per-action sync

**Files:** Create `src/sync/syncAction.ts` and its test.

**Produces:** `syncAction(action, userId, deps)` covering all 33 actions, including the dispatch-time extra fields (`treatmentIds`, `wombatPhotoIds`, `burrowIds`, `burrowLogIds`, `burrowPhotoIds`). Add these to the `Action` type as optional fields.

Tests per action group:
- Online success pushes and marks synced.
- Offline queues.
- A failed push queues.
- A thrown push queues.
- Deletes cascade to their children.
- Link actions push both sides.
- Photo actions upload when online and store the image locally when offline.

Pinned quirks:
- `RENUMBER_BURROWS` pushes directly with no queue fallback (bug #12).
- `ASSIGN_WOMBAT` keeps the existing name when the user is already assigned.

## Task 3.6: Full/incremental sync, photos, session

**Files:** Create `src/sync/session.ts`, `src/sync/fullSync.ts`, `src/sync/incrementalSync.ts` and `src/sync/photos.ts`, with tests.

**Produces:**
- `createSyncSession()` → `{ currentSquadId, setSquad(squad), nextSeq(), isLatest(seq) }`. This replaces `_currentSquadId`, `_squadCenter` and `_syncSeq`. Legacy reads switch to `session.currentSquadId`.
- `supaFullSync(deps)`, `supaIncrementalSync(deps)`, `cacheRemotePhotos(...)`, `recoverBlankPhotos(...)`, with the same return contract: `undefined` means stale or offline, `null` means new user or no baseline.

Tests:
- A stale sequence is discarded.
- A squad change mid-flight is discarded.
- All tables failing gives `undefined`.
- Timestamps are written only on success.
- Photos use the 4-step fallback chain in order.

## Task 3.7: One full-sync routine (intended behaviour change)

**Files:** Create `src/sync/runFullSync.ts` and its test. Modify `App` in `LegacyApp.jsx`.

**Produces:** `runFullSync({ dispatch, session, deps, userId })`. Sign-in behaviour, in order:
1. Merge.
2. Resolve with the queue.
3. De-duplicate codes.
4. Filter to the squad.
5. `REPLACE_ALL`.
6. Hydrate photos.
7. Cache remote photos.
8. Recover blank photos.
9. Write changed codes back.
10. Geocode backfill.
11. `null` means clear the data.
12. Flush the queue.

Replace all 5 call sites.

Tests: step order and each branch (merged, `null`, `undefined`). The commit message lists what changed at the 4 non-sign-in call sites.

---

## After Phase 3: bug-fix branches (each tested, each its own merge)

- **fix/failed-writes-list (#2):** keep rejected ops in a visible "couldn't sync" list instead of dropping them, and replace `alert()`.
- **fix/updated-at-triggers (#11):** add a migration with `set_updated_at` triggers on `wombats` and `burrows`, tested on local and staging first.
- **fix/renumber-offline (#12):** route `RENUMBER_BURROWS` through `push`/queue.
