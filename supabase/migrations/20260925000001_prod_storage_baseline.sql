-- Storage setup as it exists in production on 2026-09-25 (dumped from the storage schema).
-- The storage schema itself is managed by Supabase; only our bucket and policies live here.
-- Note: production has no DELETE or UPDATE policy on photos, so deletes and re-uploads are rejected.

INSERT INTO storage.buckets (id, name, public)
VALUES ('photos', 'photos', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "authenticated users can read photos" ON "storage"."objects"
  FOR SELECT TO "authenticated" USING (("bucket_id" = 'photos'::"text"));

CREATE POLICY "authenticated users can upload photos" ON "storage"."objects"
  FOR INSERT TO "authenticated" WITH CHECK (("bucket_id" = 'photos'::"text"));
