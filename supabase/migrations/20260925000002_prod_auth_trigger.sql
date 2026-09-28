-- Signup trigger as it exists in production on 2026-09-25 (dumped from the auth schema).
-- Creates a profiles row for every new auth user via public.handle_new_user().
CREATE OR REPLACE TRIGGER "on_auth_user_created"
  AFTER INSERT ON "auth"."users"
  FOR EACH ROW EXECUTE FUNCTION "public"."handle_new_user"();
