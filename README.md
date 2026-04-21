# WombatWatch

A field app for tracking and treating mange-affected wombats. Built for volunteer rangers operating in remote areas with limited connectivity.

---

## Features

- **Wombat profiles** — record health status, treatments, sightings, photos, and field notes for each individual
- **Burrow mapping** — track burrow locations, entrance measurements, habitat data, trail cameras, and status history
- **Treatment logging** — log Cydectin/Bravecto applications with dose, method, severity scoring, and linked burrow
- **Offline-first** — all data is cached locally and syncs to the cloud automatically when connectivity is restored
- **Interactive map** — view wombats and burrows on a live map; long-press to add records at a specific location
- **Activity feed** — chronological log of all treatments, sightings, and burrow checks across the program
- **Weekly streaks** — gamified logging streaks to keep volunteers engaged
- **Recovery celebrations** — celebration screen when a wombat is marked healthy after treatment
- **Admin controls** — role-based permissions for deleting records
- **Dark mode** — full light/dark theme support
- **PWA** — installable on iOS and Android directly from the browser

---

## Getting Started

### Prerequisites

- A [Supabase](https://supabase.com) account (free tier is sufficient)
- A GitHub account for hosting via GitHub Pages

### 1. Set up Supabase

1. Create a new Supabase project
2. In the Supabase dashboard, go to **SQL Editor → New query**
3. Paste the contents of `wombatwatch-supabase-schema.sql` and run it
4. Go to **Storage → New bucket**, create a bucket named `photos` with **Public** set to ON
5. Run the storage policy section at the bottom of the schema file

### 2. Configure the app

Open `index.html` and find the Supabase configuration near the top of the script section. Replace the placeholder values with your project's URL and anon key (found in **Settings → API** in your Supabase dashboard):

```javascript
const SUPA_URL = 'https://your-project.supabase.co';
const SUPA_ANON = 'your-anon-key';
```

### 3. Deploy to GitHub Pages

1. Create a new GitHub repository
2. Upload all files to the repository root:
   - `index.html`
   - `manifest.json`
   - `icon-192.png`
   - `icon-512.png`
   - `apple-touch-icon.png`
3. Go to **Settings → Pages → Source** and select your main branch
4. Your app will be live at `yourusername.github.io/repository-name`

---

## Installing on a Phone

Once deployed, volunteers can install WombatWatch as a native-feeling app:

**iPhone:** Open the URL in Safari → tap the Share button → tap **Add to Home Screen**

**Android:** Open the URL in Chrome → tap the three-dot menu → tap **Add to Home Screen**

---

## Adding an Admin

By default all new accounts are created as volunteers. To grant admin access to a user, run the following in your Supabase SQL Editor:

```sql
UPDATE profiles SET role = 'admin' WHERE id = '<user-uuid>';
```

Admins can delete wombat and burrow records. All other permissions are the same.

---

## Offline Behaviour

WombatWatch works fully offline. Any records added without a connection are queued locally and automatically synced to Supabase the next time the device is online. The sync status is visible in the dashboard header.

---

## Tech Stack

- **Frontend** — React 18 (Babel standalone, no build step)
- **Database** — Supabase (PostgreSQL + Row Level Security)
- **Photo storage** — Supabase Storage
- **Maps** — Leaflet.js
- **Hosting** — GitHub Pages

---

## Schema Migrations

If you set up the database before a schema update was added, run the migration queries in the **Migrations** section at the bottom of `wombatwatch-supabase-schema.sql`.

---

## Acknowledgement

WombatWatch was built to support mange treatment programs in the Macdonald Valley, NSW. We acknowledge the Traditional Custodians of the land on which this work takes place.
