-- ─────────────────────────────────────────────────────────────────────────────
-- WombatWatch — Supabase Schema
-- Run this entire script in:
--   Supabase Dashboard → SQL Editor → New query → Run
-- ─────────────────────────────────────────────────────────────────────────────


-- ── 1. Profiles ──────────────────────────────────────────────────────────────
-- One row per auth user. Extends auth.users with a display name and role.

CREATE TABLE IF NOT EXISTS profiles (
  id           UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  role         TEXT        NOT NULL DEFAULT 'volunteer'
                           CHECK (role IN ('volunteer', 'admin')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles: anyone authenticated can read"
  ON profiles FOR SELECT TO authenticated USING (true);

CREATE POLICY "profiles: own insert"
  ON profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

CREATE POLICY "profiles: own update"
  ON profiles FOR UPDATE TO authenticated USING (auth.uid() = id);

-- Auto-create a profile row whenever a new user signs up
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  INSERT INTO profiles (id, display_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1))
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE handle_new_user();

-- Helper: returns true if the current user has the 'admin' role
CREATE OR REPLACE FUNCTION is_admin()
RETURNS boolean LANGUAGE sql SECURITY DEFINER
SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'
  );
$$;


-- ── 2. Wombats ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS wombats (
  id          TEXT        PRIMARY KEY,
  created_by  UUID        REFERENCES auth.users(id),
  name        TEXT        NOT NULL,
  sex         TEXT,
  age_class   TEXT,
  status      TEXT,
  severity    JSONB       NOT NULL DEFAULT '{}',
  burrow_ids  TEXT[]      NOT NULL DEFAULT '{}',
  first_seen  DATE,
  location    TEXT,
  lat         DOUBLE PRECISION,
  lng         DOUBLE PRECISION,
  notes       TEXT,
  code        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE wombats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "wombats: read all"   ON wombats FOR SELECT TO authenticated USING (true);
CREATE POLICY "wombats: insert own" ON wombats FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by);
CREATE POLICY "wombats: update own" ON wombats FOR UPDATE TO authenticated USING (auth.uid() = created_by OR is_admin());
CREATE POLICY "wombats: delete own" ON wombats FOR DELETE TO authenticated USING (auth.uid() = created_by OR is_admin());


-- ── 3. Burrows ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS burrows (
  id                 TEXT        PRIMARY KEY,
  created_by         UUID        REFERENCES auth.users(id),
  name               TEXT        NOT NULL,
  status             TEXT,
  location           TEXT,
  lat                DOUBLE PRECISION,
  lng                DOUBLE PRECISION,
  habitat            JSONB       NOT NULL DEFAULT '{}',
  wombat_ids         TEXT[]      NOT NULL DEFAULT '{}',
  last_checked       DATE,
  next_check         DATE,
  entrance_height_cm NUMERIC,
  entrance_width_cm  NUMERIC,
  orientation        TEXT,
  code               TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE burrows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "burrows: read all"   ON burrows FOR SELECT TO authenticated USING (true);
CREATE POLICY "burrows: insert own" ON burrows FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by);
CREATE POLICY "burrows: update own" ON burrows FOR UPDATE TO authenticated USING (auth.uid() = created_by OR is_admin());
CREATE POLICY "burrows: delete own" ON burrows FOR DELETE TO authenticated USING (auth.uid() = created_by OR is_admin());


-- ── 4. Treatments ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS treatments (
  id         TEXT        PRIMARY KEY,
  wombat_id  TEXT        NOT NULL REFERENCES wombats(id) ON DELETE CASCADE,
  created_by UUID        REFERENCES auth.users(id),
  at         DATE        NOT NULL,
  by_name    TEXT,
  product    TEXT,
  dose       TEXT,
  method     TEXT,
  severity   NUMERIC,
  regions    JSONB       NOT NULL DEFAULT '{}',
  note       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE treatments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "treatments: read all"   ON treatments FOR SELECT TO authenticated USING (true);
CREATE POLICY "treatments: insert own" ON treatments FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by);
CREATE POLICY "treatments: update own" ON treatments FOR UPDATE TO authenticated USING (auth.uid() = created_by OR is_admin());
CREATE POLICY "treatments: delete own" ON treatments FOR DELETE TO authenticated USING (auth.uid() = created_by OR is_admin());


-- ── 5. Sightings ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sightings (
  id         TEXT        PRIMARY KEY,
  wombat_id  TEXT        NOT NULL REFERENCES wombats(id) ON DELETE CASCADE,
  created_by UUID        REFERENCES auth.users(id),
  at         TIMESTAMPTZ NOT NULL,
  lat        DOUBLE PRECISION,
  lng        DOUBLE PRECISION,
  note       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE sightings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sightings: read all"   ON sightings FOR SELECT TO authenticated USING (true);
CREATE POLICY "sightings: insert own" ON sightings FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by);
CREATE POLICY "sightings: update own" ON sightings FOR UPDATE TO authenticated USING (auth.uid() = created_by OR is_admin());
CREATE POLICY "sightings: delete own" ON sightings FOR DELETE TO authenticated USING (auth.uid() = created_by OR is_admin());


-- ── 6. Burrow Logs ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS burrow_logs (
  id          TEXT        PRIMARY KEY,
  burrow_id   TEXT        NOT NULL REFERENCES burrows(id) ON DELETE CASCADE,
  created_by  UUID        REFERENCES auth.users(id),
  at          DATE        NOT NULL,
  status      TEXT,
  condition   TEXT,
  occupants   NUMERIC,
  height_cm   NUMERIC,
  width_cm    NUMERIC,
  orientation TEXT,
  substrate   TEXT,
  vegetation  TEXT,
  note        TEXT,
  by_name     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE burrow_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "burrow_logs: read all"   ON burrow_logs FOR SELECT TO authenticated USING (true);
CREATE POLICY "burrow_logs: insert own" ON burrow_logs FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by);
CREATE POLICY "burrow_logs: update own" ON burrow_logs FOR UPDATE TO authenticated USING (auth.uid() = created_by OR is_admin());
CREATE POLICY "burrow_logs: delete own" ON burrow_logs FOR DELETE TO authenticated USING (auth.uid() = created_by OR is_admin());


-- ── 7. Wombat Photos ─────────────────────────────────────────────────────────
-- Photos stored as base64 data URLs (TEXT). Migrate to Supabase Storage later.

CREATE TABLE IF NOT EXISTS wombat_photos (
  id         TEXT        PRIMARY KEY,
  wombat_id  TEXT        NOT NULL REFERENCES wombats(id) ON DELETE CASCADE,
  created_by UUID        REFERENCES auth.users(id),
  is_profile BOOLEAN     NOT NULL DEFAULT false,
  data_url   TEXT,
  at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE wombat_photos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "wombat_photos: read all"   ON wombat_photos FOR SELECT TO authenticated USING (true);
CREATE POLICY "wombat_photos: insert own" ON wombat_photos FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by);
CREATE POLICY "wombat_photos: update own" ON wombat_photos FOR UPDATE TO authenticated USING (auth.uid() = created_by OR is_admin());
CREATE POLICY "wombat_photos: delete own" ON wombat_photos FOR DELETE TO authenticated USING (auth.uid() = created_by OR is_admin());


-- ── 8. Burrow Photos ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS burrow_photos (
  id         TEXT        PRIMARY KEY,
  burrow_id  TEXT        NOT NULL REFERENCES burrows(id) ON DELETE CASCADE,
  created_by UUID        REFERENCES auth.users(id),
  is_profile BOOLEAN     NOT NULL DEFAULT false,
  data_url   TEXT,
  at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE burrow_photos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "burrow_photos: read all"   ON burrow_photos FOR SELECT TO authenticated USING (true);
CREATE POLICY "burrow_photos: insert own" ON burrow_photos FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by);
CREATE POLICY "burrow_photos: update own" ON burrow_photos FOR UPDATE TO authenticated USING (auth.uid() = created_by OR is_admin());
CREATE POLICY "burrow_photos: delete own" ON burrow_photos FOR DELETE TO authenticated USING (auth.uid() = created_by OR is_admin());


-- ── 9. Public volunteer count ─────────────────────────────────────────────────
-- Returns the total number of signed-up accounts to anyone, including
-- unauthenticated visitors. No profile data is exposed — only the count.

CREATE OR REPLACE FUNCTION volunteer_count()
RETURNS bigint
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*) FROM profiles;
$$;

-- Allow the anonymous (not-signed-in) role to call this function
GRANT EXECUTE ON FUNCTION volunteer_count() TO anon;


-- ── 10. Photo Storage ────────────────────────────────────────────────────────
-- Photos are uploaded to Supabase Storage (not stored as base64 in the DB).
-- The 'photos' bucket must be created BEFORE running these policies.
--
-- Step 1: Create the bucket in the Supabase Dashboard:
--   Storage → New bucket → Name: "photos" → Public: ON → Save
--   (Public ON means photo URLs work without auth tokens, which lets the
--    app display photos even when a token is being refreshed.)
--
-- Step 2: Run the RLS policies below. The SQL Editor will error on these if
--   the bucket doesn't exist yet, so create the bucket first.

-- Allow any authenticated user to upload photos
CREATE POLICY "photos: upload"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'photos');

-- Allow any authenticated user to read photos (bucket is public so this
-- mainly covers the Storage API path; public URL access needs no policy)
CREATE POLICY "photos: read"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'photos');

-- Allow the uploader (or an admin) to delete their own photos
CREATE POLICY "photos: delete own"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'photos'
    AND (
      auth.uid()::text = (storage.foldername(name))[1]
      OR is_admin()
    )
  );

-- Allow the uploader to overwrite (re-upload) their own photos
CREATE POLICY "photos: update own"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'photos')
  WITH CHECK (bucket_id = 'photos');


-- ── 11. Migrations ───────────────────────────────────────────────────────────
-- Run these if you set up the schema before these columns were added.

-- Adds the burrow linked during a treatment log (used to display the burrow
-- pill on treatment cards and navigate to the burrow profile).
ALTER TABLE treatments
  ADD COLUMN IF NOT EXISTS linked_burrow_id TEXT REFERENCES burrows(id) ON DELETE SET NULL;


-- ─────────────────────────────────────────────────────────────────────────────
-- Done! All tables have Row Level Security enabled.
--
-- Permissions summary:
--   SELECT  → any signed-in user can read all records
--   INSERT  → any signed-in user can add records (they become created_by)
--   UPDATE  → own records only, OR users with role = 'admin'
--   DELETE  → own records only, OR users with role = 'admin'
--
-- To grant admin to a user, run:
--   UPDATE profiles SET role = 'admin' WHERE id = '<user-uuid>';
--
-- Storage (photos bucket):
--   Public bucket — URLs work without auth tokens
--   INSERT  → any signed-in user
--   SELECT  → any signed-in user
--   UPDATE  → any signed-in user (upsert on re-upload)
--   DELETE  → uploader only, OR admin
-- ─────────────────────────────────────────────────────────────────────────────
