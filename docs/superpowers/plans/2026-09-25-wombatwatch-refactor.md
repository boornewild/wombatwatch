# WombatWatch Refactor — Roadmap + Phase 0–2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the single 8,215-line `index.html` into a typed, tested, multi-file React + TypeScript web app with a safe dev → staging → production pipeline, without losing any volunteer's data along the way.

**Architecture:** Incremental migration (the "strangler" approach). Phase 1 moves the existing app, unchanged, into a Vite build as one legacy file. Each later phase pulls one responsibility out of that file (domain rules → data mappers → sync → squads → features) into a typed module with tests, until the legacy file is empty. Every phase ends in a deployable app used by real volunteers.

**Tech Stack:** Vite, React 18, TypeScript (strict), Vitest + Testing Library, `fake-indexeddb`, Playwright, Supabase CLI (local Docker + migrations), Zod, `vite-plugin-pwa` (injectManifest), GitHub Actions, Cloudflare Pages (PR previews).

**Spec:** This conversation's analysis (2026-09-24/25). Key findings are summarised in "Current State" below so this document stands alone.

---

## Current State (why we're doing this)

| Area | Today | Problem |
|---|---|---|
| Code | One `index.html`, 8,215 lines: 67 components, 187 `useState`s, one 33-action reducer (`index.html:6713`), `App` is 860 lines (`index.html:7345`) | Nothing can be changed or tested in isolation |
| Build | `@babel/standalone` compiles JSX in the phone's browser on every load; loads **React development build** (`index.html:16`) | Slow on phones; `sw.js:27` caches the *production* build that's never used |
| Database | `wombatwatch-supabase-schema.sql` is missing `squad_members`, `squad_invites` and 7 RPCs the app calls | Production is the only source of truth for access rules; hand-edited fixes are unrecorded |
| Deploy | GitHub Pages from `main` root (`boornewild.github.io/wombatwatch`); commits are "Add files via upload" | Every upload goes live instantly to 20–30 users with no review |
| Environments | One Supabase project (`xzfccubfoavpaqphofht`) | Any local testing writes to production data |
| Tests | None | Regressions are found by volunteers in the field |

**Known squad bug candidates (to confirm in Phase 4):**
1. `loadSquad()` is not awaited before `supaFullSync()` (`index.html:7727-7732`) — a new invitee's first sync can run before they're a squad member.
2. The URL invite join ignores errors (`index.html:7695`) — an expired/used token fails silently.
3. `flushQueue` drops a queued write after 5 "genuine" failures (`SQ_MAX_RETRIES`, `index.html:1261`) — an RLS rejection is a genuine failure, so records created by a user not yet in a squad can be silently deleted from the queue.

## Target Structure

```
supabase/
  migrations/          versioned schema; prod dump is the first migration
  seed.sql             test squad + 2 test users for local/staging
  tests/               pgTAP tests for RLS (who can see what)
src/
  app/                 App.tsx, providers, screen routing  (< 300 lines)
  config/              env.ts — per-environment Supabase URL/key
  domain/              pure rules: codes, statuses, streaks, CSV  (no React, no network)
  data/                supabase client, generated DB types, mappers, repos
  sync/                IndexedDB stores, offline queue, flush, full/incremental sync
  features/
    auth/  squads/  wombats/  burrows/  treatments/  map/  dashboard/  export/
  ui/                  shared components + theme tokens
  legacy/              LegacyApp.jsx — shrinks every phase, deleted in Phase 6
  sw.ts                service worker (keeps the existing Background Sync handler)
tests/e2e/             Playwright: sign-in → join squad → see wombats → log treatment offline
```

Rule: no file over 400 lines. `domain/` never imports from `data/`, `sync/` or React.

## Environments

| Env | Frontend | Supabase | Who uses it |
|---|---|---|---|
| Local | `npm run dev` (localhost:5173) | `supabase start` (Docker, seeded) | Developers |
| Preview | Cloudflare Pages, one URL per PR | `wombatwatch-staging` (`hmctmtqzdbleojvhctkr`, seeded; DB password in macOS Keychain `supabase-db-password`) | Reviewer + your friend, on their phone |
| Production | GitHub Pages (`boornewild.github.io/wombatwatch`) | `xzfccubfoavpaqphofht` | Volunteers |

Schema changes flow one way only: `supabase/migrations/` → local → staging → production (`supabase db push`). Nobody edits production tables in the dashboard again.

## Global Constraints

- Production (checked 2026-09-28): 4 user accounts, 2 squads, 44 wombats, 523 burrows, 0 records without a squad; some use it offline in the field. **No release may lose a queued offline write.**
- Keep IndexedDB database names and schemas unchanged: `wombatwatch_v1` (stores `wombats, burrows, treatments, sightings, burrow_logs, wombat_photos, burrow_photos, queue, meta`) and `ww_photo_data`.
- Keep all `localStorage` keys unchanged: `ww_all_squads_cache ww_auth_cache ww_last_full_sync_date ww_last_sync_ts ww_photo_data ww_profile_cache ww_signed_in ww_squad_cache ww_streak ww_sync_deleted ww_sync_queue ww_theme ww_user_name ww_vol_count ww_weather_cache ww_wombat_order`.
- Keep the Background Sync tag `ww-queue-flush` and the SW → page message `{type:'WW_FLUSH_QUEUE'}`.
- Keep the Supabase Storage bucket `photos` and its `{userId}/...` path convention.
- Keep the `?join=TOKEN` invite URL format (links already sent must still work).
- Vite `base` is `/wombatwatch/` for production (GitHub Pages sub-path).
- TypeScript `strict: true` for all new files; `src/legacy/` is excluded from type checking.
- Every PR: `npm run lint && npm run typecheck && npm test` green, and a preview URL tested on a phone.

## Review Focus

1. **A volunteer with pending offline writes from the old app opens the new build** → the queue in `wombatwatch_v1.queue` is flushed, not lost. Test: Task 3.2 (queue read-compat test).
2. **A brand-new invitee opens a `?join=` link, signs up, lands in the app** → sees the squad's wombats on the first load, no refresh needed. Test: Task 4.3 (Playwright) + Task 4.1 (pgTAP).
3. **A phone with the old `v6` service worker cache** → gets the new build on next launch instead of a stale `index.html`. Test: Task 1.4 manual upgrade check.
4. **A queued write rejected by RLS** → is kept in a visible "failed" list, never silently dropped. Test: Task 3.3.
5. **An expired or used invite token in the URL** → user sees a clear message. Test: Task 4.2.

---

## Phase Roadmap

| Phase | Outcome | Est. (part-time) | Blocked on |
|---|---|---|---|
| 0. Safety net | Prod schema in git, staging project, local Supabase, backups, protected `main` | 1–2 days | Friend inviting you to Supabase + GitHub admin |
| 1. Build pipeline | Same app, built by Vite, prod React, CI, PR previews | 3–4 days | Phase 0 |
| 2. Domain + data types | Pure rules + mappers + reducer in TS, ~60 unit tests | 3–4 days | Phase 1 |
| 3. Sync layer | IndexedDB, queue, flush, merge in `src/sync/`, tested with fake IDB; failed-write list | 1–2 weeks | Phase 2 |
| 4. Squads + auth fix | RLS tests, root-cause fix for "can't see group", e2e test | 3–5 days | Phase 0 + 3 |
| 5. Feature extraction | Components moved to `features/*` as TSX, one feature per PR | 2–3 weeks | Phase 2 |
| 6. Cleanup | Delete `legacy/`, remove DOM monkey-patch if safe, base64 photos → Storage | 2–3 days | Phase 5 |

Phases 0–2 are fully specified below. Phases 3–6 are scoped here and each gets its own detailed plan (same format) when it starts, because their exact steps depend on what the production schema dump in Phase 0 reveals.

---

## Phase 0 — Safety Net (no app code changes)

### Task 0.1: Get access and snapshot production

**Files:**
- Create: `supabase/config.toml` (via CLI)
- Create: `supabase/migrations/20260925000000_prod_baseline.sql`
- Delete: `wombatwatch-supabase-schema.sql` (superseded; keep in git history)
- Modify: `.gitignore`

**Interfaces:**
- Produces: `supabase/migrations/` as the single source of truth for schema.

- [ ] **Step 1: Friend grants access** — Supabase dashboard → Organization → Team → Invite (role: Developer). GitHub repo → Settings → Collaborators → add you as Admin. Friend also shares the DB password via a password manager (not chat).

- [ ] **Step 2: Install and link the CLI**

```bash
brew install supabase/tap/supabase
supabase login
supabase init
supabase link --project-ref xzfccubfoavpaqphofht
```

- [ ] **Step 3: Dump schema (tables, RLS, functions, triggers) as the baseline migration**

```bash
supabase db dump --schema public,storage -f supabase/migrations/20260925000000_prod_baseline.sql
```

Expected: file contains `CREATE TABLE ... squad_members`, `squad_invites`, and `CREATE FUNCTION ... get_all_my_squads`, `join_squad_by_invite`. If it doesn't, stop and investigate.

- [ ] **Step 4: Take a private data backup (never committed)**

```bash
mkdir -p ~/wombatwatch-backups
supabase db dump --data-only -f ~/wombatwatch-backups/prod-data-2026-09-25.sql
```

- [ ] **Step 5: Ignore local artefacts**

Append to `.gitignore`:
```
node_modules/
dist/
.env*.local
supabase/.branches
supabase/.temp
```

- [ ] **Step 6: Commit**

```bash
git checkout -b chore/prod-schema-baseline
git rm wombatwatch-supabase-schema.sql
git add .gitignore supabase/
git commit -m "chore: capture production schema as baseline migration"
```

### Task 0.2: Local Supabase with seed data

**Files:**
- Create: `supabase/seed.sql`

**Interfaces:**
- Consumes: baseline migration from Task 0.1.
- Produces: two local users `alice@test.local` (squad admin) and `bob@test.local` (no squad), both password `password123`; squad `Test Squad` with one wombat `W0001`; invite token `test-invite-token`.

- [ ] **Step 1: Write the seed.** Column names for `squads`, `squad_members`, `squad_invites` must be copied from the baseline dump — read it first. Skeleton:

```sql
-- Users (local only — auth.users is writable in local Supabase)
insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, aud, role)
values
  ('00000000-0000-0000-0000-00000000000a', 'alice@test.local', crypt('password123', gen_salt('bf')), now(), '{"display_name":"Alice"}', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000000b', 'bob@test.local',   crypt('password123', gen_salt('bf')), now(), '{"display_name":"Bob"}',   'authenticated', 'authenticated');

-- Squad, membership, invite: use the exact columns from the baseline migration
-- insert into squads (...) values (...);
-- insert into squad_members (squad_id, user_id, role) values (..., '...0a', 'admin');
-- insert into squad_invites (..., token, ...) values (..., 'test-invite-token', ...);

insert into wombats (id, created_by, squad_id, name, code, status)
values ('wombat-seed-1', '00000000-0000-0000-0000-00000000000a', /* squad id */ null, 'Seed Wombat', 'W0001', 'under_treatment');
```

- [ ] **Step 2: Run it**

```bash
supabase start
supabase db reset
```

Expected: completes without error; Studio at `http://localhost:54323` shows both users and the wombat.

- [ ] **Step 3: Commit** — `git add supabase/seed.sql && git commit -m "chore: add local seed data"`

### Task 0.3: Staging project + branch protection

- [ ] **Step 1:** Create a new free Supabase project `wombatwatch-staging` (same region as prod). Create the `photos` bucket (public).
- [ ] **Step 2:** `supabase link --project-ref <staging-ref> && supabase db push` — expected: baseline applied. Re-link to prod afterwards is **not** needed; use `--project-ref` explicitly from now on.
- [ ] **Step 3:** Protect `main` (requires admin):

```bash
gh api -X PUT repos/boornewild/wombatwatch/branches/main/protection \
  -f required_status_checks='{"strict":true,"contexts":["ci"]}' \
  -F enforce_admins=false \
  -f required_pull_request_reviews='{"required_approving_review_count":1}' \
  -F restrictions=null
```

(Run after Task 1.5 creates the `ci` check, otherwise PRs can't merge.)

- [ ] **Step 4:** Open PR for Phase 0; friend reviews and merges.

---

## Phase 1 — Build Pipeline (same app, new plumbing)

### Task 1.1: Scaffold Vite + TypeScript + Vitest

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.setup.ts`, `eslint.config.js`, `src/smoke.test.ts`

- [ ] **Step 1: Install**

```bash
npm init -y
npm i react@18.3.1 react-dom@18.3.1 @supabase/supabase-js@2 leaflet@1.9.4 jszip@3.10.1 zod
npm i -D vite @vitejs/plugin-react typescript @types/react @types/react-dom @types/leaflet \
  vitest jsdom @testing-library/react @testing-library/jest-dom fake-indexeddb \
  eslint typescript-eslint eslint-plugin-react-hooks prettier vite-plugin-pwa workbox-precaching
```

- [ ] **Step 2: `package.json` scripts**

```json
"scripts": {
  "dev": "vite",
  "build": "tsc --noEmit && vite build",
  "preview": "vite preview",
  "test": "vitest run",
  "test:watch": "vitest",
  "typecheck": "tsc --noEmit",
  "lint": "eslint src"
}
```

- [ ] **Step 3: `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2020", "module": "ESNext", "moduleResolution": "Bundler",
    "jsx": "react-jsx", "strict": true, "noUncheckedIndexedAccess": true,
    "allowJs": true, "checkJs": false, "skipLibCheck": true,
    "types": ["vite/client", "vitest/globals"]
  },
  "include": ["src", "vitest.setup.ts"],
  "exclude": ["src/legacy"]
}
```

- [ ] **Step 4: `vite.config.ts`**

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => ({
  base: mode === 'production' ? '/wombatwatch/' : '/',
  plugins: [react()],
  test: { environment: 'jsdom', globals: true, setupFiles: ['./vitest.setup.ts'] },
}));
```

`vitest.setup.ts`:
```ts
import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
```

- [ ] **Step 5: Smoke test** — `src/smoke.test.ts`:

```ts
it('runs tests with IndexedDB available', () => {
  expect(typeof indexedDB.open).toBe('function');
});
```

Run: `npm test` — Expected: 1 passed.

- [ ] **Step 6: Commit** — `git commit -am "chore: scaffold vite, typescript, vitest"`

### Task 1.2: Environment config

**Files:**
- Create: `src/config/env.ts`, `src/config/env.test.ts`, `.env.example`, `.env.development.local` (ignored)

**Interfaces:**
- Produces: `parseEnv(raw: Record<string, unknown>): { supabaseUrl: string; supabaseAnonKey: string }` and `env` (parsed `import.meta.env`).

- [ ] **Step 1: Failing test**

```ts
import { parseEnv } from './env';

it('parses valid env', () => {
  expect(parseEnv({ VITE_SUPABASE_URL: 'http://localhost:54321', VITE_SUPABASE_ANON_KEY: 'k' }))
    .toEqual({ supabaseUrl: 'http://localhost:54321', supabaseAnonKey: 'k' });
});

it('throws a readable error when a variable is missing', () => {
  expect(() => parseEnv({ VITE_SUPABASE_URL: 'http://x' })).toThrow(/VITE_SUPABASE_ANON_KEY/);
});
```

Run: `npx vitest run src/config` — Expected: FAIL, module not found.

- [ ] **Step 2: Implement**

```ts
import { z } from 'zod';

const schema = z.object({
  VITE_SUPABASE_URL: z.string().url(),
  VITE_SUPABASE_ANON_KEY: z.string().min(1),
});

export function parseEnv(raw: Record<string, unknown>) {
  const r = schema.safeParse(raw);
  if (!r.success) {
    const missing = r.error.issues.map(i => i.path.join('.')).join(', ');
    throw new Error(`Invalid environment config: ${missing}`);
  }
  return { supabaseUrl: r.data.VITE_SUPABASE_URL, supabaseAnonKey: r.data.VITE_SUPABASE_ANON_KEY };
}

export const env = parseEnv(import.meta.env);
```

`.env.example`:
```
VITE_SUPABASE_URL=http://localhost:54321
VITE_SUPABASE_ANON_KEY=<from `supabase status`>
```

- [ ] **Step 3:** Run `npx vitest run src/config` — Expected: 2 passed.
- [ ] **Step 4: Commit** — `git commit -am "feat: validated per-environment supabase config"`

### Task 1.3: Port the app into Vite as `LegacyApp.jsx` (no behaviour change)

**Files:**
- Create: `src/legacy/LegacyApp.jsx` (the contents of `index.html` lines 137–8197, the Babel script body minus the `ReactDOM.createRoot` block)
- Create: `src/legacy/domGuard.js` (lines 88–113), `src/legacy/errorOverlay.js` (lines 116–134), `src/legacy/styles.css` (lines 22–82)
- Create: `src/data/supabaseClient.ts`, `src/main.tsx`
- Modify: `index.html` (becomes a ~20-line shell)
- Move: `manifest.json`, `icon-*.png`, `apple-touch-icon.png` → `public/`
- Test: `tests/e2e/smoke.spec.ts`

**Interfaces:**
- Produces: `supa` (exported Supabase client) from `src/data/supabaseClient.ts`; `LegacyApp` default export.

- [ ] **Step 1: Extract with line ranges (verify each range with `sed -n` first — line numbers drift if the file changed)**

```bash
mkdir -p src/legacy public
sed -n '22,82p'   index.html > src/legacy/styles.css
sed -n '88,113p'  index.html > src/legacy/domGuard.js
sed -n '116,134p' index.html > src/legacy/errorOverlay.js
sed -n '137,8197p' index.html > src/legacy/LegacyApp.jsx
git mv manifest.json icon-192.png icon-512.png apple-touch-icon.png public/
```

- [ ] **Step 2: Replace globals with imports.** At the top of `LegacyApp.jsx`, replace `const {useState,useEffect,useRef}=React;` with:

```js
import React, { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import JSZip from 'jszip';
import { supa } from '../data/supabaseClient';
```

Delete the `SUPA_URL`, `SUPA_ANON` and `const supa=window.supabase.createClient(...)` lines (`index.html:1081-1083`). At the bottom add `export default App;`. Check `JSZip` and `L` have no `window.` prefix: `grep -n "window\.\(L\|JSZip\|supabase\)" src/legacy/LegacyApp.jsx` — expected: no output.

- [ ] **Step 3: `src/data/supabaseClient.ts`**

```ts
import { createClient } from '@supabase/supabase-js';
import { env } from '../config/env';

export const supa = createClient(env.supabaseUrl, env.supabaseAnonKey);
```

- [ ] **Step 4: `src/main.tsx`**

```tsx
import './legacy/domGuard.js';
import './legacy/errorOverlay.js';
import './legacy/styles.css';
import { createRoot } from 'react-dom/client';
import LegacyApp from './legacy/LegacyApp.jsx';

createRoot(document.getElementById('root')!).render(<LegacyApp />);
```

- [ ] **Step 5: New `index.html`** — keep lines 1–13 (meta, title, manifest, icons), drop every `<script src=unpkg/cdn>` and the Leaflet `<link>`, then:

```html
<body>
<div id="root" translate="no"></div>
<script type="module" src="/src/main.tsx"></script>
</body>
</html>
```

- [ ] **Step 6: E2E smoke test** — `npm i -D @playwright/test && npx playwright install chromium`. `tests/e2e/smoke.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test('app boots to the sign-in screen with no crash overlay', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://localhost:5173/');
  await expect(page.getByText(/sign in/i).first()).toBeVisible();
  await expect(page.getByText('WombatWatch crash')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('seeded user signs in and sees seeded wombat', async ({ page }) => {
  await page.goto('http://localhost:5173/');
  await page.getByPlaceholder(/email/i).fill('alice@test.local');
  await page.getByPlaceholder(/password/i).fill('password123');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.getByText(/wombats/i).first().click();
  await expect(page.getByText('Seed Wombat')).toBeVisible();
});
```

Run: `supabase start && npm run dev` (second terminal) then `npx playwright test` — Expected: 2 passed. Adjust selectors to the real sign-in form labels if they differ; do not change app code to fit the test.

- [ ] **Step 7: Manual parity check on a phone** via `npm run dev -- --host` on the same Wi-Fi: map loads, add wombat, go offline (airplane mode), log treatment, go online, record appears in local Studio.

- [ ] **Step 8: Commit** — `git commit -am "refactor: move app into vite build as LegacyApp (no behaviour change)"`

### Task 1.4: Service worker via vite-plugin-pwa (keep sync handler, clear v6 caches)

**Files:**
- Create: `src/sw.ts` (port of `sw.js`)
- Delete: `sw.js`
- Modify: `vite.config.ts`, `src/main.tsx`

- [ ] **Step 1: `src/sw.ts`** — Workbox precaches the built assets (replaces the hand-listed `SHELL_URLS`); keep the tile strategy and the `ww-queue-flush` handler verbatim from `sw.js:108-121` and `sw.js:124-138`:

```ts
/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';
declare const self: ServiceWorkerGlobalScope;

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

const TILE_CACHE = 'wombatwatch-tiles-v6'; // unchanged name: keeps volunteers' downloaded offline maps
const TILE_HOSTS = ['tile.openstreetmap.org','a.tile.openstreetmap.org','b.tile.openstreetmap.org',
  'c.tile.openstreetmap.org','basemaps.cartocdn.com','server.arcgisonline.com'];

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    // Remove the old hand-rolled shell cache so no stale index.html is served
    for (const k of await caches.keys()) if (k.startsWith('wombatwatch-shell-')) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.hostname.endsWith('.supabase.co')) return;
  if (TILE_HOSTS.includes(url.hostname)) event.respondWith(networkFirstTile(event.request));
});

self.addEventListener('sync', (event: any) => {
  if (event.tag === 'ww-queue-flush') {
    event.waitUntil(self.clients.matchAll({ includeUncontrolled: true, type: 'window' })
      .then(cs => cs.forEach(c => c.postMessage({ type: 'WW_FLUSH_QUEUE' }))));
  }
});

async function networkFirstTile(request: Request) {
  try {
    const res = await fetch(request);
    if (res.ok) (await caches.open(TILE_CACHE)).put(request, res.clone());
    return res;
  } catch {
    return (await caches.match(request)) || new Response('Tile unavailable offline', { status: 503 });
  }
}
```

Also check the map page's offline-download code writes to the same `wombatwatch-tiles-v6` name: `grep -n "wombatwatch-tiles" src/legacy/LegacyApp.jsx`.

- [ ] **Step 2: `vite.config.ts`** — add:

```ts
import { VitePWA } from 'vite-plugin-pwa';
// plugins: [react(), VitePWA({ strategies: 'injectManifest', srcDir: 'src', filename: 'sw.ts',
//   registerType: 'autoUpdate', manifest: false, injectRegister: 'auto' })]
```

`manifest: false` keeps `public/manifest.json` as is.

- [ ] **Step 3: Verify build** — `npm run build && ls dist` — Expected: `sw.js`, `index.html`, `assets/`, `manifest.json`.
- [ ] **Step 4: Manual upgrade test (Review Focus #3)** — on a phone with the current live app installed, deploy the build to the Phase 1 preview URL is *not* enough (different origin). Instead, after production deploy in Task 1.5: open installed app, close, reopen → DevTools (remote debugging) shows no `wombatwatch-shell-v6` cache and the new asset hashes. Check `wombatwatch_v1.queue` in the Application tab is untouched.
- [ ] **Step 5: Commit** — `git commit -am "refactor: workbox service worker, keep tile cache and background sync"`

### Task 1.5: CI, production deploy, PR previews

**Files:**
- Create: `.github/workflows/ci.yml`, `.github/workflows/deploy.yml`

- [ ] **Step 1: `ci.yml`**

```yaml
name: ci
on: [pull_request]
jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm test
```

- [ ] **Step 2: `deploy.yml`** (production, on merge to `main`)

```yaml
name: deploy
on:
  push: { branches: [main] }
permissions: { contents: read, pages: write, id-token: write }
jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: github-pages
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci && npm run build
        env:
          VITE_SUPABASE_URL: ${{ vars.PROD_SUPABASE_URL }}
          VITE_SUPABASE_ANON_KEY: ${{ vars.PROD_SUPABASE_ANON_KEY }}
      - uses: actions/upload-pages-artifact@v3
        with: { path: dist }
      - uses: actions/deploy-pages@v4
```

- [ ] **Step 3: Switch Pages source** (currently "legacy, main /"):

```bash
gh api -X PUT repos/boornewild/wombatwatch/pages -f build_type=workflow
gh variable set PROD_SUPABASE_URL --body https://xzfccubfoavpaqphofht.supabase.co
gh variable set PROD_SUPABASE_ANON_KEY --body <anon key from index.html:1082>
```

- [ ] **Step 4: PR previews** — Cloudflare Pages → Connect GitHub repo → build `npm run build -- --mode staging`, output `dist`, env vars `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` = **staging** project. Add `staging` mode base `/` (already covered: only `production` uses `/wombatwatch/`).
- [ ] **Step 5: Release** — merge at a quiet time (evening, not a field day). Tell volunteers to open the app while online once. Run Task 1.4 Step 4.
- [ ] **Step 6: Enable branch protection** (Task 0.3 Step 3).

---

## Phase 2 — Domain Rules + Data Mappers in TypeScript

Pattern for every task: **characterisation test first** (pin today's behaviour, including quirks), then move the code into a `.ts` file, then `import` it back into `LegacyApp.jsx` and delete the original. Behaviour changes are separate, later PRs.

### Task 2.1: Record codes

**Files:**
- Create: `src/domain/codes.ts`, `src/domain/codes.test.ts`
- Modify: `src/legacy/LegacyApp.jsx` (delete `nextWombatCode`, `nextBurrowCode`, `deduplicateCodes`; import them)

**Interfaces:**
- Produces:
  - `nextCode(records: { code?: string | null }[], prefix: 'W' | 'B'): string`
  - `nextWombatCode = (ws) => nextCode(ws, 'W')`, `nextBurrowCode = (bs) => nextCode(bs, 'B')`
  - `deduplicateCodes<T extends { code?: string | null; createdAt?: string | null }>(records: T[], prefix: 'W' | 'B'): { records: T[]; changed: T[] }`

- [ ] **Step 1: Failing tests**

```ts
import { nextWombatCode, nextBurrowCode, deduplicateCodes } from './codes';

describe('nextWombatCode', () => {
  it('starts at W0001', () => expect(nextWombatCode([])).toBe('W0001'));
  it('fills the lowest gap', () =>
    expect(nextWombatCode([{ code: 'W0001' }, { code: 'W0003' }])).toBe('W0002'));
  it('ignores missing codes', () => expect(nextWombatCode([{ code: null }, {}])).toBe('W0001'));
});

it('nextBurrowCode uses B prefix', () => expect(nextBurrowCode([{ code: 'B0001' }])).toBe('B0002'));

describe('deduplicateCodes', () => {
  it('earliest record keeps the code, later one is renumbered', () => {
    const a = { id: 'a', code: 'W0001', createdAt: '2026-01-01' };
    const b = { id: 'b', code: 'W0001', createdAt: '2026-02-01' };
    const r = deduplicateCodes([b, a], 'W');
    expect(r.records.find(x => x.id === 'a')!.code).toBe('W0001');
    expect(r.records.find(x => x.id === 'b')!.code).toBe('W0002');
    expect(r.changed.map(x => x.id)).toEqual(['b']);
  });
  it('assigns codes to records with none', () => {
    const r = deduplicateCodes([{ id: 'a', code: '' }], 'B');
    expect(r.records[0]!.code).toBe('B0001');
  });
});
```

Run: `npx vitest run src/domain/codes` — Expected: FAIL, module not found.

- [ ] **Step 2: Implement** (logic copied from `index.html:268-289`, typed):

```ts
type Coded = { code?: string | null };
const num = (code?: string | null) => parseInt((code || '').slice(1) || '0', 10);
const fmt = (prefix: string, n: number) => prefix + String(n).padStart(4, '0');

export function nextCode(records: Coded[], prefix: 'W' | 'B'): string {
  const used = new Set(records.map(r => num(r.code)).filter(n => n > 0));
  let n = 1;
  while (used.has(n)) n++;
  return fmt(prefix, n);
}
export const nextWombatCode = (ws: Coded[]) => nextCode(ws, 'W');
export const nextBurrowCode = (bs: Coded[]) => nextCode(bs, 'B');

export function deduplicateCodes<T extends Coded & { createdAt?: string | null }>(records: T[], prefix: 'W' | 'B') {
  const seen = new Set<string>();
  const changed: T[] = [];
  const sorted = [...records].sort((a, b) => +new Date(a.createdAt || 0) - +new Date(b.createdAt || 0));
  const nums = sorted.map(r => num(r.code)).filter(n => n > 0);
  let next = (nums.length ? Math.max(...nums) : 0) + 1;
  const out = sorted.map(r => {
    const c = r.code || '';
    if (c && !seen.has(c)) { seen.add(c); return r; }
    const updated = { ...r, code: fmt(prefix, next++) };
    seen.add(updated.code);
    changed.push(updated);
    return updated;
  });
  return { records: out, changed };
}
```

- [ ] **Step 3:** Run tests — Expected: 6 passed.
- [ ] **Step 4:** In `LegacyApp.jsx` delete the three original definitions and add `import { nextWombatCode, nextBurrowCode, deduplicateCodes } from '../domain/codes';`. Run `npm run build && npx playwright test` — Expected: green.
- [ ] **Step 5: Commit** — `git commit -am "refactor: extract record code rules to domain/codes with tests"`

### Task 2.2: Generated DB types + typed mappers

**Files:**
- Create: `src/data/database.types.ts` (generated), `src/data/mappers.ts`, `src/data/mappers.test.ts`
- Modify: `src/legacy/LegacyApp.jsx` (delete `index.html:1098-1112` mappers, import them)

**Interfaces:**
- Produces: `wombatToDb(w, uid)`, `dbToWombat(row)`, and the same pair for `burrow`, `treatment`, `sighting`, `burrowLog`, `wombatPhoto`, `burrowPhoto`. Row types come from `Database['public']['Tables'][T]['Row' | 'Insert']`.

- [ ] **Step 1:** `supabase gen types typescript --local > src/data/database.types.ts` and add `"db:types": "supabase gen types typescript --local > src/data/database.types.ts"` to scripts.
- [ ] **Step 2: Failing round-trip tests** (one per entity; wombat shown — repeat the structure for all seven with each entity's fields from `index.html:1099-1112`):

```ts
import { wombatToDb, dbToWombat } from './mappers';

const wombat = {
  id: 'w1', name: 'Bruce', sex: 'M', ageClass: 'adult', status: 'under_treatment',
  severity: { head: 2 }, burrowIds: ['b1'], firstSeen: '2026-01-01', location: 'St Albans',
  lat: -33.29, lng: 150.97, notes: 'n', code: 'W0001', locationLabel: 'Creek',
  inactiveAt: null, inactiveCause: null, inactiveNotes: null, squadId: 's1', assignees: [],
};

it('wombat round-trips through the DB shape', () => {
  const row = wombatToDb(wombat, 'u1');
  expect(row.created_by).toBe('u1');
  expect(row.squad_id).toBe('s1');
  expect(dbToWombat({ ...row, created_at: 'x', updated_at: 'x' } as any)).toMatchObject(wombat);
});

it('legacy status "mange" is read as under_treatment', () => {
  expect(dbToWombat({ ...wombatToDb(wombat, 'u1'), status: 'mange' } as any).status).toBe('under_treatment');
});

it('marks server records as synced', () => {
  expect(dbToWombat(wombatToDb(wombat, 'u1') as any)._sync).toBe(true);
});
```

- [ ] **Step 3:** Port the 14 mapper functions verbatim into `mappers.ts`, typing parameters with the generated `Row`/`Insert` types and a `Wombat` etc. domain type in `src/domain/types.ts`. Fix any type error by widening the domain type, not by changing behaviour.
- [ ] **Step 4:** Tests pass; replace in `LegacyApp.jsx`; `npm run build && npx playwright test` green.
- [ ] **Step 5: Commit** — `git commit -am "refactor: typed DB mappers generated from schema"`

### Task 2.3: Streaks, formatting, CSV

**Files:**
- Create: `src/domain/streak.ts` (+test) from `index.html:995-1047`; `src/domain/format.ts` (+test) for `fmtDate`, `fmtDateTime`, `timeAgo`, `statusLabel`, `burrowStatusLabel`, `statusTone`, `burrowTone`; `src/domain/csv.ts` (+test) for `toCSV`, `parseCSV`.

Same five-step cycle as Task 2.1. Required test cases:
- `getWeekKey`: Sunday 23:59 and Monday 00:00 land in different weeks; `weekGap` across a year boundary.
- `toCSV`: values with commas, quotes and newlines are quoted; `null` → empty; rows joined with `\r\n`.
- `parseCSV(toCSV(h, rows))` returns the original rows (round-trip).
- `fmtDate('')` → `'—'`; `fmtDate('garbage')` → `'—'`; `timeAgo` of 30 min ago → `'Just now'`.

Streak functions touch `localStorage`; pass a `Storage`-like object in as a parameter (`loadStreak(store = localStorage)`) so tests use an in-memory stub.

### Task 2.4: Reducer

**Files:**
- Create: `src/state/reducer.ts`, `src/state/reducer.test.ts`, `src/state/actions.ts`
- Modify: `src/legacy/LegacyApp.jsx` (delete `function reducer` at old `index.html:6713-6953`)

**Interfaces:**
- Produces: `type Action` (discriminated union of the 33 action types: `ADD_BURROW ADD_BURROW_LOG ADD_BURROW_PHOTO ADD_SIGHTING ADD_TREATMENT ADD_WOMBAT ADD_WOMBAT_PHOTO ARCHIVE_WOMBAT ASSIGN_MISSING_CODES ASSIGN_WOMBAT DELETE_BURROW DELETE_BURROW_LOG DELETE_BURROW_PHOTO DELETE_SIGHTING DELETE_TREATMENT DELETE_WOMBAT DELETE_WOMBAT_PHOTO EDIT_TREATMENT HYDRATE_PHOTO_DATA IMPORT_BURROWS IMPORT_WOMBATS LINK_WOMBAT_BURROW MARK_WOMBAT_ACTIVE MARK_WOMBAT_INACTIVE PATCH_RECORDS RENUMBER_BURROWS REPLACE_ALL SET_BURROW_PROFILE_PHOTO SET_PROFILE_PHOTO UNASSIGN_WOMBAT UNLINK_WOMBAT_BURROW UPDATE_BURROW UPDATE_WOMBAT`); `reducer(state: AppData, action: Action): AppData`.

- [ ] **Step 1:** Read the reducer; list which cases perform side effects (the comment at old `index.html:6714` says photos are saved via `noB64`, i.e. the reducer calls `save()`). Side effects stay in LegacyApp for now: split into a **pure** `reducer` and a `persist(state)` called from a `useEffect` in `App`. Write this split as its own commit before tests.
- [ ] **Step 2:** One test per action (33 tests). Minimum assertions: record added/removed/updated; `DELETE_WOMBAT` also removes that wombat's treatments, sightings and photos and unlinks it from burrows; `LINK_WOMBAT_BURROW` updates both `wombat.burrowIds` and `burrow.wombatIds`; the input state object is not mutated (`Object.freeze` the input).
- [ ] **Step 3:** Port, run tests, replace, run e2e, commit.

**Phase 2 done when:** `src/domain`, `src/data/mappers.ts`, `src/state/reducer.ts` have ≥ 60 passing tests and `LegacyApp.jsx` is ~1,000 lines shorter.

---

## Phases 3–6 — Scope (each gets its own detailed plan when started)

### Phase 3: Sync layer → `src/sync/`
- **3.1** `idb.ts`: `openAppDb`, `openPhotoIdb` and the 13 `idb*` helpers, same DB names and versions. Tests with `fake-indexeddb`.
- **3.2** Queue read-compat test (Review Focus #1): write a queue record exactly as today's code shapes it (`{t, table, row, ...}` — copy real shape from `queueOp` callers), run the new `flushQueue` against a mocked Supabase client, assert upsert called and queue empty.
- **3.3** Replace "drop after 5 retries" with a `failed` store + a banner "3 records couldn't sync — tap to retry/view" (Review Focus #4). Requires an IDB version bump `wombatwatch_v1` 1 → 2 that only *adds* a store.
- **3.4** `fullSync.ts` / `incrementalSync.ts` / `merge.ts`: pure merge function `(local, server, queuedIds, squadId) → merged` extracted from `supaFullSync` and tested with table-driven cases (offline edit vs server edit, server-deleted, empty-server-response guard at old `index.html:1760`).
- **Decision point:** after 3.4, compare remaining hand-rolled sync complexity against adopting PowerSync. Record the decision in `docs/adr/0001-sync-engine.md`.

### Phase 4: Squads + auth root-cause fix
- **4.1** pgTAP tests in `supabase/tests/squads.test.sql`: member sees squad wombats; non-member sees none; invitee after `join_squad_by_invite('test-invite-token')` sees them; expired/max-used token returns the right `error`.
- **4.2** Fix: `await loadSquad()` before `supaFullSync()`; surface `join_squad_by_invite` errors from the URL flow in the UI.
- **4.3** Playwright: `bob@test.local` opens `/?join=test-invite-token`, signs in, sees `Seed Wombat` with no refresh (Review Focus #2).
- **4.4** Audit production for records with `squad_id IS NULL` and users with no `squad_members` row (the likely residue of earlier manual fixes). Backfill via a migration, not by hand.

### Phase 5: Feature extraction
One PR per feature folder, in this order (least → most coupled): `ui/` primitives (Pill, Card, FormField, ModalWrap, Swipe*) → `features/export` → `features/burrows` → `features/wombats` + `treatments` → `features/map` (Leaflet; 425 lines) → `features/squads` (SquadModal is 345 lines — split) → `features/auth` → `app/App.tsx`. Replace `window`-level mutable `_currentSquadId` with React context. Each component gets a Testing Library test for its main interaction.

### Phase 6: Cleanup
Delete `src/legacy/`. Re-test whether `domGuard.js` is still needed (production React + `translate="no"` may be enough) before removing it. Migrate remaining base64 `data_url` photo rows to Storage with a one-off script run against staging first.

---

## Wishlist — GPS accuracy (after Phase 5, each goes through discover → question → plan)

Goal: burrow pins within ~5 m under dense canopy. Current behaviour: GPS heater keeps the best fix from the last 3 min (`startGpsHeater`, old `index.html:8053`); save warns above ±25 m (old `index.html:6341`, `6545`).

1. **GPS averaging** — "Stand still" mode: collect `watchPosition` fixes for 30–60 s, drop outliers, save the accuracy-weighted mean plus its spread. Pure averaging logic lives in `src/domain/gps.ts` and is unit-tested.
2. **Drag-to-correct pin on satellite view** — after capture, show Esri imagery (already a tile host in the SW) with a draggable pin; store both `gps_lat/lng` and `adjusted_lat/lng` so raw data is never lost (additive migration).
3. **Precise Location check** — detect coarse fixes (accuracy > 500 m repeatedly) and show a how-to for iOS Settings → Privacy → Location Services → Safari Websites → Precise Location. Add to FAQ.
4. **External GPS receiver support** — no code needed on iOS (MFi receivers feed system location); write a field guide page, and record accuracy per fix so we can compare phone vs receiver.

Open question for all four: what ±m does the app currently report when saving burrows in dense bush?

## Rollback

Every production release is a merged PR. To roll back: `git revert <merge-sha> && git push` → the deploy workflow republishes the previous build in ~2 minutes. Database migrations must be additive (add columns/tables, never drop/rename in the same release as the code change) so a code rollback never meets an incompatible schema.
