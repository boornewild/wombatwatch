-- Bug #15: the squad_members INSERT/DELETE policies queried squad_members from inside a squad_members policy,
-- so Postgres rejected every insert/delete with "infinite recursion detected in policy". is_squad_admin() is
-- SECURITY DEFINER, so it reads squad_members without re-entering these policies.
DROP POLICY IF EXISTS "squad_members_insert" ON "public"."squad_members";
CREATE POLICY "squad_members_insert" ON "public"."squad_members"
  FOR INSERT TO "authenticated" WITH CHECK ("public"."is_squad_admin"("squad_id"));

DROP POLICY IF EXISTS "squad_members_delete" ON "public"."squad_members";
CREATE POLICY "squad_members_delete" ON "public"."squad_members"
  FOR DELETE TO "authenticated" USING ("public"."is_squad_admin"("squad_id"));

-- Bug #3: the photos bucket had no UPDATE or DELETE policy, so deleted photos left their files behind and
-- replacing a photo (upload with upsert) failed. Files are named {photoId}.jpg with no squad in the path, so
-- the rule is: the volunteer who uploaded the file, or an app admin (profiles.role = 'admin').
DROP POLICY IF EXISTS "photos: uploader or admin can replace" ON "storage"."objects";
CREATE POLICY "photos: uploader or admin can replace" ON "storage"."objects"
  FOR UPDATE TO "authenticated"
  USING ("bucket_id" = 'photos' AND ("owner_id" = (auth.uid())::text OR "public"."is_admin"()))
  WITH CHECK ("bucket_id" = 'photos');

DROP POLICY IF EXISTS "photos: uploader or admin can delete" ON "storage"."objects";
CREATE POLICY "photos: uploader or admin can delete" ON "storage"."objects"
  FOR DELETE TO "authenticated"
  USING ("bucket_id" = 'photos' AND ("owner_id" = (auth.uid())::text OR "public"."is_admin"()));
