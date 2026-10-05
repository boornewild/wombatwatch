-- Bug #11: wombats and burrows had no updated_at trigger, so editing one never changed updated_at and
-- incremental sync (updated_at >= last sync) never delivered other volunteers' edits until the daily full sync.
-- Same trigger the other synced tables already use. Additive and safe to re-run.
CREATE OR REPLACE TRIGGER "trg_wombats_updated_at" BEFORE UPDATE ON "public"."wombats"
  FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();

CREATE OR REPLACE TRIGGER "trg_burrows_updated_at" BEFORE UPDATE ON "public"."burrows"
  FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();
