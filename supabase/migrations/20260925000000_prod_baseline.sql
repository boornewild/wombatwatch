


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."assign_wombat"("p_wombat_id" "uuid") RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
declare
  v_user_id   uuid := auth.uid();
  v_name      text;
  v_squad_id  uuid;
  v_wombat_sq uuid;
  v_already   boolean;
begin
  if v_user_id is null then
    return json_build_object('error', 'not_authenticated');
  end if;

  -- Get the user's display name
  select display_name into v_name
  from public.profiles where id = v_user_id;

  -- Get the user's squad
  select squad_id into v_squad_id
  from public.squad_members where user_id = v_user_id;

  if v_squad_id is null then
    return json_build_object('error', 'not_in_squad');
  end if;

  -- Confirm the wombat belongs to the same squad
  select squad_id into v_wombat_sq
  from public.wombats where id = p_wombat_id;

  if v_wombat_sq is null or v_wombat_sq != v_squad_id then
    return json_build_object('error', 'wrong_squad');
  end if;

  -- Check not already assigned (idempotent)
  select exists(
    select 1 from jsonb_array_elements(
      (select assignees from public.wombats where id = p_wombat_id)
    ) elem where elem->>'userId' = v_user_id::text
  ) into v_already;

  if not v_already then
    update public.wombats
    set assignees = assignees || jsonb_build_array(
      jsonb_build_object('userId', v_user_id::text, 'name', coalesce(v_name, 'Volunteer'))
    )
    where id = p_wombat_id;
  end if;

  return json_build_object('ok', true);
end;
$$;


ALTER FUNCTION "public"."assign_wombat"("p_wombat_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_squad"("p_name" "text", "p_description" "text" DEFAULT NULL::"text") RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
declare
  v_user_id  uuid := auth.uid();
  v_squad_id uuid;
begin
  if v_user_id is null then
    return json_build_object('error', 'not_authenticated');
  end if;

  insert into public.squads(name, description, created_by)
  values (p_name, p_description, v_user_id)
  returning id into v_squad_id;

  insert into public.squad_members(squad_id, user_id, role)
  values (v_squad_id, v_user_id, 'admin');

  return json_build_object('ok', true, 'squad_id', v_squad_id);
end;
$$;


ALTER FUNCTION "public"."create_squad"("p_name" "text", "p_description" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_squad_invite"("p_squad_id" "uuid", "p_expires_at" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_max_uses" integer DEFAULT NULL::integer) RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
declare
  v_user_id uuid := auth.uid();
  v_token   text;
  v_id      uuid;
begin
  if v_user_id is null then
    return json_build_object('error', 'not_authenticated');
  end if;

  if not public.is_squad_admin(p_squad_id) then
    return json_build_object('error', 'not_admin');
  end if;

  insert into public.squad_invites(squad_id, created_by, expires_at, max_uses)
  values (p_squad_id, v_user_id, p_expires_at, p_max_uses)
  returning id, token into v_id, v_token;

  return json_build_object('ok', true, 'token', v_token, 'invite_id', v_id);
end;
$$;


ALTER FUNCTION "public"."create_squad_invite"("p_squad_id" "uuid", "p_expires_at" timestamp with time zone, "p_max_uses" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_all_my_squads"() RETURNS TABLE("role" "text", "squad_id" "uuid", "squad_name" "text", "bounds_sw_lat" double precision, "bounds_sw_lng" double precision, "bounds_ne_lat" double precision, "bounds_ne_lng" double precision, "emergency_contacts" "jsonb")
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT
    sm.role,
    s.id,
    s.name,
    s.bounds_sw_lat,
    s.bounds_sw_lng,
    s.bounds_ne_lat,
    s.bounds_ne_lng,
    s.emergency_contacts
  FROM public.squad_members sm
  JOIN public.squads s ON s.id = sm.squad_id
  WHERE sm.user_id = auth.uid()
  ORDER BY s.name;
$$;


ALTER FUNCTION "public"."get_all_my_squads"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_my_squad"() RETURNS TABLE("role" "text", "squad_id" "uuid", "squad_name" "text", "bounds_sw_lat" double precision, "bounds_sw_lng" double precision, "bounds_ne_lat" double precision, "bounds_ne_lng" double precision, "emergency_contacts" "jsonb")
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT
    sm.role,
    s.id,
    s.name,
    s.bounds_sw_lat,
    s.bounds_sw_lng,
    s.bounds_ne_lat,
    s.bounds_ne_lng,
    s.emergency_contacts
  FROM public.squad_members sm
  JOIN public.squads s ON s.id = sm.squad_id
  WHERE sm.user_id = auth.uid()
  LIMIT 1;
$$;


ALTER FUNCTION "public"."get_my_squad"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_my_squad_ids"() RETURNS SETOF "uuid"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT squad_id FROM public.squad_members WHERE user_id = auth.uid();
$$;


ALTER FUNCTION "public"."get_my_squad_ids"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  INSERT INTO profiles (id, display_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1))
  );
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_admin"() RETURNS boolean
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'
  );
$$;


ALTER FUNCTION "public"."is_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_squad_admin"("p_squad_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  select exists (
    select 1 from public.squad_members
    where squad_id = p_squad_id
      and user_id  = auth.uid()
      and role     = 'admin'
  );
$$;


ALTER FUNCTION "public"."is_squad_admin"("p_squad_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_squad_member"("p_squad_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  select exists (
    select 1 from public.squad_members
    where squad_id = p_squad_id
      and user_id  = auth.uid()
  );
$$;


ALTER FUNCTION "public"."is_squad_member"("p_squad_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."join_squad_by_invite"("p_token" "text") RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
declare
  v_user_id uuid := auth.uid();
  v_invite  public.squad_invites%rowtype;
  v_squad   public.squads%rowtype;
begin
  if v_user_id is null then
    return json_build_object('error', 'not_authenticated');
  end if;

  -- Lock the invite row to prevent race conditions on use_count
  select * into v_invite
  from public.squad_invites
  where token = p_token
  for update;

  if not found then
    return json_build_object('error', 'invalid_token');
  end if;

  if v_invite.expires_at is not null and v_invite.expires_at < now() then
    return json_build_object('error', 'expired');
  end if;

  if v_invite.max_uses is not null and v_invite.use_count >= v_invite.max_uses then
    return json_build_object('error', 'max_uses_reached');
  end if;

  select * into v_squad from public.squads where id = v_invite.squad_id;

  -- Add member — silently ignore if already a member
  insert into public.squad_members(squad_id, user_id, role)
  values (v_invite.squad_id, v_user_id, 'member')
  on conflict (squad_id, user_id) do nothing;

  -- Increment use count
  update public.squad_invites
  set use_count = use_count + 1
  where id = v_invite.id;

  return json_build_object(
    'ok',         true,
    'squad_id',   v_invite.squad_id,
    'squad_name', v_squad.name
  );
end;
$$;


ALTER FUNCTION "public"."join_squad_by_invite"("p_token" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."unassign_wombat"("p_wombat_id" "uuid", "p_user_id" "uuid") RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
declare
  v_caller_id uuid := auth.uid();
  v_squad_id  uuid;
begin
  if v_caller_id is null then
    return json_build_object('error', 'not_authenticated');
  end if;

  -- If removing someone else, must be admin
  if v_caller_id != p_user_id then
    select squad_id into v_squad_id
    from public.squad_members where user_id = v_caller_id;

    if not public.is_squad_admin(v_squad_id) then
      return json_build_object('error', 'not_admin');
    end if;
  end if;

  -- Remove the entry matching p_user_id from the array
  update public.wombats
  set assignees = (
    select coalesce(jsonb_agg(elem), '[]'::jsonb)
    from jsonb_array_elements(assignees) elem
    where elem->>'userId' != p_user_id::text
  )
  where id = p_wombat_id;

  return json_build_object('ok', true);
end;
$$;


ALTER FUNCTION "public"."unassign_wombat"("p_wombat_id" "uuid", "p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_squad_bounds"("p_squad_id" "uuid", "p_sw_lat" double precision, "p_sw_lng" double precision, "p_ne_lat" double precision, "p_ne_lng" double precision) RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    return json_build_object('error', 'not_authenticated');
  end if;

  if not public.is_squad_admin(p_squad_id) then
    return json_build_object('error', 'not_admin');
  end if;

  update public.squads
  set bounds_sw_lat = p_sw_lat,
      bounds_sw_lng = p_sw_lng,
      bounds_ne_lat = p_ne_lat,
      bounds_ne_lng = p_ne_lng
  where id = p_squad_id;

  return json_build_object('ok', true);
end;
$$;


ALTER FUNCTION "public"."update_squad_bounds"("p_squad_id" "uuid", "p_sw_lat" double precision, "p_sw_lng" double precision, "p_ne_lat" double precision, "p_ne_lng" double precision) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_squad_emergency_contacts"("p_squad_id" "uuid", "p_contacts" "jsonb") RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    return json_build_object('error', 'not_authenticated');
  end if;

  if not public.is_squad_admin(p_squad_id) then
    return json_build_object('error', 'not_admin');
  end if;

  update public.squads
  set emergency_contacts = p_contacts
  where id = p_squad_id;

  return json_build_object('ok', true);
end;
$$;


ALTER FUNCTION "public"."update_squad_emergency_contacts"("p_squad_id" "uuid", "p_contacts" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."volunteer_count"() RETURNS bigint
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT COUNT(*) FROM profiles;
$$;


ALTER FUNCTION "public"."volunteer_count"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."burrow_logs" (
    "id" "text" NOT NULL,
    "burrow_id" "text" NOT NULL,
    "created_by" "uuid",
    "at" "date" NOT NULL,
    "status" "text",
    "condition" "text",
    "occupants" numeric,
    "height_cm" numeric,
    "width_cm" numeric,
    "orientation" "text",
    "substrate" "text",
    "vegetation" "text",
    "note" "text",
    "by_name" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."burrow_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."burrow_photos" (
    "id" "text" NOT NULL,
    "burrow_id" "text" NOT NULL,
    "created_by" "uuid",
    "is_profile" boolean DEFAULT false NOT NULL,
    "data_url" "text",
    "at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."burrow_photos" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."burrows" (
    "id" "text" NOT NULL,
    "created_by" "uuid",
    "name" "text" NOT NULL,
    "status" "text",
    "location" "text",
    "lat" double precision,
    "lng" double precision,
    "habitat" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "wombat_ids" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "last_checked" "date",
    "next_check" "date",
    "entrance_height_cm" numeric,
    "entrance_width_cm" numeric,
    "orientation" "text",
    "code" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "squad_id" "uuid"
);


ALTER TABLE "public"."burrows" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "display_name" "text",
    "role" "text" DEFAULT 'volunteer'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "wombat_order" "jsonb",
    "streak_count" integer DEFAULT 0 NOT NULL,
    "streak_week_key" "text" DEFAULT ''::"text" NOT NULL,
    CONSTRAINT "profiles_role_check" CHECK (("role" = ANY (ARRAY['volunteer'::"text", 'admin'::"text"])))
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sightings" (
    "id" "text" NOT NULL,
    "wombat_id" "text" NOT NULL,
    "created_by" "uuid",
    "at" timestamp with time zone NOT NULL,
    "lat" double precision,
    "lng" double precision,
    "note" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."sightings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."squad_invites" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "squad_id" "uuid" NOT NULL,
    "token" "text" DEFAULT "encode"("extensions"."gen_random_bytes"(18), 'base64'::"text") NOT NULL,
    "created_by" "uuid",
    "expires_at" timestamp with time zone,
    "max_uses" integer,
    "use_count" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."squad_invites" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."squad_members" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "squad_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "text" DEFAULT 'member'::"text" NOT NULL,
    "joined_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "squad_members_role_check" CHECK (("role" = ANY (ARRAY['admin'::"text", 'member'::"text"])))
);


ALTER TABLE "public"."squad_members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."squads" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "emergency_contacts" "jsonb" DEFAULT '[]'::"jsonb",
    "bounds_sw_lat" double precision,
    "bounds_sw_lng" double precision,
    "bounds_ne_lat" double precision,
    "bounds_ne_lng" double precision
);


ALTER TABLE "public"."squads" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."treatments" (
    "id" "text" NOT NULL,
    "wombat_id" "text" NOT NULL,
    "created_by" "uuid",
    "at" "date" NOT NULL,
    "by_name" "text",
    "product" "text",
    "dose" "text",
    "method" "text",
    "severity" numeric,
    "regions" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "note" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "linked_burrow_id" "text",
    "marked_recovered" boolean DEFAULT false,
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."treatments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."wombat_photos" (
    "id" "text" NOT NULL,
    "wombat_id" "text" NOT NULL,
    "created_by" "uuid",
    "is_profile" boolean DEFAULT false NOT NULL,
    "data_url" "text",
    "at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."wombat_photos" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."wombats" (
    "id" "text" NOT NULL,
    "created_by" "uuid",
    "name" "text" NOT NULL,
    "sex" "text",
    "age_class" "text",
    "status" "text",
    "severity" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "burrow_ids" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "first_seen" "date",
    "location" "text",
    "lat" double precision,
    "lng" double precision,
    "notes" "text",
    "code" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "location_label" "text",
    "inactive_at" "date",
    "inactive_cause" "text",
    "inactive_notes" "text",
    "squad_id" "uuid",
    "assignees" "jsonb" DEFAULT '[]'::"jsonb"
);


ALTER TABLE "public"."wombats" OWNER TO "postgres";


ALTER TABLE ONLY "public"."burrow_logs"
    ADD CONSTRAINT "burrow_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."burrow_photos"
    ADD CONSTRAINT "burrow_photos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."burrows"
    ADD CONSTRAINT "burrows_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sightings"
    ADD CONSTRAINT "sightings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."squad_invites"
    ADD CONSTRAINT "squad_invites_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."squad_invites"
    ADD CONSTRAINT "squad_invites_token_key" UNIQUE ("token");



ALTER TABLE ONLY "public"."squad_members"
    ADD CONSTRAINT "squad_members_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."squad_members"
    ADD CONSTRAINT "squad_members_squad_id_user_id_key" UNIQUE ("squad_id", "user_id");



ALTER TABLE ONLY "public"."squads"
    ADD CONSTRAINT "squads_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."treatments"
    ADD CONSTRAINT "treatments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."wombat_photos"
    ADD CONSTRAINT "wombat_photos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."wombats"
    ADD CONSTRAINT "wombats_pkey" PRIMARY KEY ("id");



CREATE INDEX "idx_burrows_squad_id" ON "public"."burrows" USING "btree" ("squad_id");



CREATE INDEX "idx_squad_invites_token" ON "public"."squad_invites" USING "btree" ("token");



CREATE INDEX "idx_squad_members_squad_id" ON "public"."squad_members" USING "btree" ("squad_id");



CREATE INDEX "idx_squad_members_user_id" ON "public"."squad_members" USING "btree" ("user_id");



CREATE INDEX "idx_wombats_squad_id" ON "public"."wombats" USING "btree" ("squad_id");



CREATE UNIQUE INDEX "squads_name_unique" ON "public"."squads" USING "btree" ("lower"("name"));



CREATE OR REPLACE TRIGGER "trg_burrow_logs_updated_at" BEFORE UPDATE ON "public"."burrow_logs" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_burrow_photos_updated_at" BEFORE UPDATE ON "public"."burrow_photos" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_sightings_updated_at" BEFORE UPDATE ON "public"."sightings" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_treatments_updated_at" BEFORE UPDATE ON "public"."treatments" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_wombat_photos_updated_at" BEFORE UPDATE ON "public"."wombat_photos" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



ALTER TABLE ONLY "public"."burrow_logs"
    ADD CONSTRAINT "burrow_logs_burrow_id_fkey" FOREIGN KEY ("burrow_id") REFERENCES "public"."burrows"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."burrow_logs"
    ADD CONSTRAINT "burrow_logs_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."burrow_photos"
    ADD CONSTRAINT "burrow_photos_burrow_id_fkey" FOREIGN KEY ("burrow_id") REFERENCES "public"."burrows"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."burrow_photos"
    ADD CONSTRAINT "burrow_photos_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."burrows"
    ADD CONSTRAINT "burrows_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."burrows"
    ADD CONSTRAINT "burrows_squad_id_fkey" FOREIGN KEY ("squad_id") REFERENCES "public"."squads"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sightings"
    ADD CONSTRAINT "sightings_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."sightings"
    ADD CONSTRAINT "sightings_wombat_id_fkey" FOREIGN KEY ("wombat_id") REFERENCES "public"."wombats"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."squad_invites"
    ADD CONSTRAINT "squad_invites_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."squad_invites"
    ADD CONSTRAINT "squad_invites_squad_id_fkey" FOREIGN KEY ("squad_id") REFERENCES "public"."squads"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."squad_members"
    ADD CONSTRAINT "squad_members_squad_id_fkey" FOREIGN KEY ("squad_id") REFERENCES "public"."squads"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."squad_members"
    ADD CONSTRAINT "squad_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."squads"
    ADD CONSTRAINT "squads_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."treatments"
    ADD CONSTRAINT "treatments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."treatments"
    ADD CONSTRAINT "treatments_linked_burrow_id_fkey" FOREIGN KEY ("linked_burrow_id") REFERENCES "public"."burrows"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."treatments"
    ADD CONSTRAINT "treatments_wombat_id_fkey" FOREIGN KEY ("wombat_id") REFERENCES "public"."wombats"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."wombat_photos"
    ADD CONSTRAINT "wombat_photos_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."wombat_photos"
    ADD CONSTRAINT "wombat_photos_wombat_id_fkey" FOREIGN KEY ("wombat_id") REFERENCES "public"."wombats"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."wombats"
    ADD CONSTRAINT "wombats_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."wombats"
    ADD CONSTRAINT "wombats_squad_id_fkey" FOREIGN KEY ("squad_id") REFERENCES "public"."squads"("id") ON DELETE SET NULL;



ALTER TABLE "public"."burrow_logs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "burrow_logs_squad_delete" ON "public"."burrow_logs" FOR DELETE TO "authenticated" USING (("burrow_id" IN ( SELECT "burrows"."id"
   FROM "public"."burrows"
  WHERE ("burrows"."squad_id" IN ( SELECT "squad_members"."squad_id"
           FROM "public"."squad_members"
          WHERE ("squad_members"."user_id" = "auth"."uid"()))))));



CREATE POLICY "burrow_logs_squad_insert" ON "public"."burrow_logs" FOR INSERT TO "authenticated" WITH CHECK (("burrow_id" IN ( SELECT "burrows"."id"
   FROM "public"."burrows"
  WHERE ("burrows"."squad_id" IN ( SELECT "squad_members"."squad_id"
           FROM "public"."squad_members"
          WHERE ("squad_members"."user_id" = "auth"."uid"()))))));



CREATE POLICY "burrow_logs_squad_select" ON "public"."burrow_logs" FOR SELECT TO "authenticated" USING (("burrow_id" IN ( SELECT "burrows"."id"
   FROM "public"."burrows"
  WHERE ("burrows"."squad_id" IN ( SELECT "squad_members"."squad_id"
           FROM "public"."squad_members"
          WHERE ("squad_members"."user_id" = "auth"."uid"()))))));



CREATE POLICY "burrow_logs_squad_update" ON "public"."burrow_logs" FOR UPDATE TO "authenticated" USING (("burrow_id" IN ( SELECT "burrows"."id"
   FROM "public"."burrows"
  WHERE ("burrows"."squad_id" IN ( SELECT "squad_members"."squad_id"
           FROM "public"."squad_members"
          WHERE ("squad_members"."user_id" = "auth"."uid"()))))));



ALTER TABLE "public"."burrow_photos" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "burrow_photos_squad_delete" ON "public"."burrow_photos" FOR DELETE TO "authenticated" USING (("burrow_id" IN ( SELECT "burrows"."id"
   FROM "public"."burrows"
  WHERE ("burrows"."squad_id" IN ( SELECT "squad_members"."squad_id"
           FROM "public"."squad_members"
          WHERE ("squad_members"."user_id" = "auth"."uid"()))))));



CREATE POLICY "burrow_photos_squad_insert" ON "public"."burrow_photos" FOR INSERT TO "authenticated" WITH CHECK (("burrow_id" IN ( SELECT "burrows"."id"
   FROM "public"."burrows"
  WHERE ("burrows"."squad_id" IN ( SELECT "squad_members"."squad_id"
           FROM "public"."squad_members"
          WHERE ("squad_members"."user_id" = "auth"."uid"()))))));



CREATE POLICY "burrow_photos_squad_select" ON "public"."burrow_photos" FOR SELECT TO "authenticated" USING (("burrow_id" IN ( SELECT "burrows"."id"
   FROM "public"."burrows"
  WHERE ("burrows"."squad_id" IN ( SELECT "squad_members"."squad_id"
           FROM "public"."squad_members"
          WHERE ("squad_members"."user_id" = "auth"."uid"()))))));



CREATE POLICY "burrow_photos_squad_update" ON "public"."burrow_photos" FOR UPDATE TO "authenticated" USING (("burrow_id" IN ( SELECT "burrows"."id"
   FROM "public"."burrows"
  WHERE ("burrows"."squad_id" IN ( SELECT "squad_members"."squad_id"
           FROM "public"."squad_members"
          WHERE ("squad_members"."user_id" = "auth"."uid"()))))));



ALTER TABLE "public"."burrows" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "burrows_squad_delete" ON "public"."burrows" FOR DELETE TO "authenticated" USING (("squad_id" IN ( SELECT "squad_members"."squad_id"
   FROM "public"."squad_members"
  WHERE (("squad_members"."user_id" = "auth"."uid"()) AND ("squad_members"."role" = 'admin'::"text")))));



CREATE POLICY "burrows_squad_insert" ON "public"."burrows" FOR INSERT TO "authenticated" WITH CHECK (("squad_id" IN ( SELECT "squad_members"."squad_id"
   FROM "public"."squad_members"
  WHERE ("squad_members"."user_id" = "auth"."uid"()))));



CREATE POLICY "burrows_squad_select" ON "public"."burrows" FOR SELECT TO "authenticated" USING (("squad_id" IN ( SELECT "squad_members"."squad_id"
   FROM "public"."squad_members"
  WHERE ("squad_members"."user_id" = "auth"."uid"()))));



CREATE POLICY "burrows_squad_update" ON "public"."burrows" FOR UPDATE TO "authenticated" USING (("squad_id" IN ( SELECT "squad_members"."squad_id"
   FROM "public"."squad_members"
  WHERE ("squad_members"."user_id" = "auth"."uid"())))) WITH CHECK (("squad_id" IN ( SELECT "squad_members"."squad_id"
   FROM "public"."squad_members"
  WHERE ("squad_members"."user_id" = "auth"."uid"()))));



ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "profiles_own_select" ON "public"."profiles" FOR SELECT USING (("id" = "auth"."uid"()));



CREATE POLICY "profiles_own_update" ON "public"."profiles" FOR UPDATE USING (("id" = "auth"."uid"()));



CREATE POLICY "profiles_squad_select" ON "public"."profiles" FOR SELECT USING (("id" IN ( SELECT "squad_members"."user_id"
   FROM "public"."squad_members"
  WHERE ("squad_members"."squad_id" IN ( SELECT "squad_members_1"."squad_id"
           FROM "public"."squad_members" "squad_members_1"
          WHERE ("squad_members_1"."user_id" = "auth"."uid"()))))));



ALTER TABLE "public"."sightings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "sightings_squad_delete" ON "public"."sightings" FOR DELETE TO "authenticated" USING (("wombat_id" IN ( SELECT "wombats"."id"
   FROM "public"."wombats"
  WHERE ("wombats"."squad_id" IN ( SELECT "squad_members"."squad_id"
           FROM "public"."squad_members"
          WHERE ("squad_members"."user_id" = "auth"."uid"()))))));



CREATE POLICY "sightings_squad_insert" ON "public"."sightings" FOR INSERT TO "authenticated" WITH CHECK (("wombat_id" IN ( SELECT "wombats"."id"
   FROM "public"."wombats"
  WHERE ("wombats"."squad_id" IN ( SELECT "squad_members"."squad_id"
           FROM "public"."squad_members"
          WHERE ("squad_members"."user_id" = "auth"."uid"()))))));



CREATE POLICY "sightings_squad_select" ON "public"."sightings" FOR SELECT TO "authenticated" USING (("wombat_id" IN ( SELECT "wombats"."id"
   FROM "public"."wombats"
  WHERE ("wombats"."squad_id" IN ( SELECT "squad_members"."squad_id"
           FROM "public"."squad_members"
          WHERE ("squad_members"."user_id" = "auth"."uid"()))))));



CREATE POLICY "sightings_squad_update" ON "public"."sightings" FOR UPDATE TO "authenticated" USING (("wombat_id" IN ( SELECT "wombats"."id"
   FROM "public"."wombats"
  WHERE ("wombats"."squad_id" IN ( SELECT "squad_members"."squad_id"
           FROM "public"."squad_members"
          WHERE ("squad_members"."user_id" = "auth"."uid"()))))));



ALTER TABLE "public"."squad_invites" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "squad_invites: admins can manage" ON "public"."squad_invites" USING ("public"."is_squad_admin"("squad_id")) WITH CHECK ("public"."is_squad_admin"("squad_id"));



CREATE POLICY "squad_invites: members can read own squad invites" ON "public"."squad_invites" FOR SELECT TO "authenticated" USING (("squad_id" IN ( SELECT "squad_members"."squad_id"
   FROM "public"."squad_members"
  WHERE ("squad_members"."user_id" = "auth"."uid"()))));



ALTER TABLE "public"."squad_members" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "squad_members_delete" ON "public"."squad_members" FOR DELETE USING (("squad_id" IN ( SELECT "squad_members_1"."squad_id"
   FROM "public"."squad_members" "squad_members_1"
  WHERE (("squad_members_1"."user_id" = "auth"."uid"()) AND ("squad_members_1"."role" = 'admin'::"text")))));



CREATE POLICY "squad_members_insert" ON "public"."squad_members" FOR INSERT WITH CHECK (("squad_id" IN ( SELECT "squad_members_1"."squad_id"
   FROM "public"."squad_members" "squad_members_1"
  WHERE (("squad_members_1"."user_id" = "auth"."uid"()) AND ("squad_members_1"."role" = 'admin'::"text")))));



CREATE POLICY "squad_members_own_select" ON "public"."squad_members" FOR SELECT USING (("user_id" = "auth"."uid"()));



CREATE POLICY "squad_members_squadmates_select" ON "public"."squad_members" FOR SELECT USING (("squad_id" IN ( SELECT "public"."get_my_squad_ids"() AS "get_my_squad_ids")));



ALTER TABLE "public"."squads" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "squads_admin_update" ON "public"."squads" FOR UPDATE USING (("id" IN ( SELECT "squad_members"."squad_id"
   FROM "public"."squad_members"
  WHERE (("squad_members"."user_id" = "auth"."uid"()) AND ("squad_members"."role" = 'admin'::"text")))));



CREATE POLICY "squads_member_select" ON "public"."squads" FOR SELECT USING (("id" IN ( SELECT "squad_members"."squad_id"
   FROM "public"."squad_members"
  WHERE ("squad_members"."user_id" = "auth"."uid"()))));



ALTER TABLE "public"."treatments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "treatments_squad_delete" ON "public"."treatments" FOR DELETE TO "authenticated" USING (("wombat_id" IN ( SELECT "wombats"."id"
   FROM "public"."wombats"
  WHERE ("wombats"."squad_id" IN ( SELECT "squad_members"."squad_id"
           FROM "public"."squad_members"
          WHERE ("squad_members"."user_id" = "auth"."uid"()))))));



CREATE POLICY "treatments_squad_insert" ON "public"."treatments" FOR INSERT TO "authenticated" WITH CHECK (("wombat_id" IN ( SELECT "wombats"."id"
   FROM "public"."wombats"
  WHERE ("wombats"."squad_id" IN ( SELECT "squad_members"."squad_id"
           FROM "public"."squad_members"
          WHERE ("squad_members"."user_id" = "auth"."uid"()))))));



CREATE POLICY "treatments_squad_select" ON "public"."treatments" FOR SELECT TO "authenticated" USING (("wombat_id" IN ( SELECT "wombats"."id"
   FROM "public"."wombats"
  WHERE ("wombats"."squad_id" IN ( SELECT "squad_members"."squad_id"
           FROM "public"."squad_members"
          WHERE ("squad_members"."user_id" = "auth"."uid"()))))));



CREATE POLICY "treatments_squad_update" ON "public"."treatments" FOR UPDATE TO "authenticated" USING (("wombat_id" IN ( SELECT "wombats"."id"
   FROM "public"."wombats"
  WHERE ("wombats"."squad_id" IN ( SELECT "squad_members"."squad_id"
           FROM "public"."squad_members"
          WHERE ("squad_members"."user_id" = "auth"."uid"()))))));



ALTER TABLE "public"."wombat_photos" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "wombat_photos_squad_delete" ON "public"."wombat_photos" FOR DELETE TO "authenticated" USING (("wombat_id" IN ( SELECT "wombats"."id"
   FROM "public"."wombats"
  WHERE ("wombats"."squad_id" IN ( SELECT "squad_members"."squad_id"
           FROM "public"."squad_members"
          WHERE ("squad_members"."user_id" = "auth"."uid"()))))));



CREATE POLICY "wombat_photos_squad_insert" ON "public"."wombat_photos" FOR INSERT TO "authenticated" WITH CHECK (("wombat_id" IN ( SELECT "wombats"."id"
   FROM "public"."wombats"
  WHERE ("wombats"."squad_id" IN ( SELECT "squad_members"."squad_id"
           FROM "public"."squad_members"
          WHERE ("squad_members"."user_id" = "auth"."uid"()))))));



CREATE POLICY "wombat_photos_squad_select" ON "public"."wombat_photos" FOR SELECT TO "authenticated" USING (("wombat_id" IN ( SELECT "wombats"."id"
   FROM "public"."wombats"
  WHERE ("wombats"."squad_id" IN ( SELECT "squad_members"."squad_id"
           FROM "public"."squad_members"
          WHERE ("squad_members"."user_id" = "auth"."uid"()))))));



CREATE POLICY "wombat_photos_squad_update" ON "public"."wombat_photos" FOR UPDATE TO "authenticated" USING (("wombat_id" IN ( SELECT "wombats"."id"
   FROM "public"."wombats"
  WHERE ("wombats"."squad_id" IN ( SELECT "squad_members"."squad_id"
           FROM "public"."squad_members"
          WHERE ("squad_members"."user_id" = "auth"."uid"()))))));



ALTER TABLE "public"."wombats" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "wombats_squad_delete" ON "public"."wombats" FOR DELETE TO "authenticated" USING (("squad_id" IN ( SELECT "squad_members"."squad_id"
   FROM "public"."squad_members"
  WHERE (("squad_members"."user_id" = "auth"."uid"()) AND ("squad_members"."role" = 'admin'::"text")))));



CREATE POLICY "wombats_squad_insert" ON "public"."wombats" FOR INSERT TO "authenticated" WITH CHECK (("squad_id" IN ( SELECT "squad_members"."squad_id"
   FROM "public"."squad_members"
  WHERE ("squad_members"."user_id" = "auth"."uid"()))));



CREATE POLICY "wombats_squad_select" ON "public"."wombats" FOR SELECT TO "authenticated" USING (("squad_id" IN ( SELECT "squad_members"."squad_id"
   FROM "public"."squad_members"
  WHERE ("squad_members"."user_id" = "auth"."uid"()))));



CREATE POLICY "wombats_squad_update" ON "public"."wombats" FOR UPDATE TO "authenticated" USING (("squad_id" IN ( SELECT "squad_members"."squad_id"
   FROM "public"."squad_members"
  WHERE ("squad_members"."user_id" = "auth"."uid"())))) WITH CHECK (("squad_id" IN ( SELECT "squad_members"."squad_id"
   FROM "public"."squad_members"
  WHERE ("squad_members"."user_id" = "auth"."uid"()))));





ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";






















































































































































GRANT ALL ON FUNCTION "public"."assign_wombat"("p_wombat_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."assign_wombat"("p_wombat_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."assign_wombat"("p_wombat_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."create_squad"("p_name" "text", "p_description" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."create_squad"("p_name" "text", "p_description" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_squad"("p_name" "text", "p_description" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."create_squad_invite"("p_squad_id" "uuid", "p_expires_at" timestamp with time zone, "p_max_uses" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."create_squad_invite"("p_squad_id" "uuid", "p_expires_at" timestamp with time zone, "p_max_uses" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_squad_invite"("p_squad_id" "uuid", "p_expires_at" timestamp with time zone, "p_max_uses" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_all_my_squads"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_all_my_squads"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_all_my_squads"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_my_squad"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_my_squad"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_my_squad"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_my_squad_ids"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_my_squad_ids"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_my_squad_ids"() TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."is_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "service_role";



GRANT ALL ON FUNCTION "public"."is_squad_admin"("p_squad_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_squad_admin"("p_squad_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_squad_admin"("p_squad_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_squad_member"("p_squad_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_squad_member"("p_squad_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_squad_member"("p_squad_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."join_squad_by_invite"("p_token" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."join_squad_by_invite"("p_token" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."join_squad_by_invite"("p_token" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."unassign_wombat"("p_wombat_id" "uuid", "p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."unassign_wombat"("p_wombat_id" "uuid", "p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."unassign_wombat"("p_wombat_id" "uuid", "p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."update_squad_bounds"("p_squad_id" "uuid", "p_sw_lat" double precision, "p_sw_lng" double precision, "p_ne_lat" double precision, "p_ne_lng" double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."update_squad_bounds"("p_squad_id" "uuid", "p_sw_lat" double precision, "p_sw_lng" double precision, "p_ne_lat" double precision, "p_ne_lng" double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_squad_bounds"("p_squad_id" "uuid", "p_sw_lat" double precision, "p_sw_lng" double precision, "p_ne_lat" double precision, "p_ne_lng" double precision) TO "service_role";



GRANT ALL ON FUNCTION "public"."update_squad_emergency_contacts"("p_squad_id" "uuid", "p_contacts" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."update_squad_emergency_contacts"("p_squad_id" "uuid", "p_contacts" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_squad_emergency_contacts"("p_squad_id" "uuid", "p_contacts" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."volunteer_count"() TO "anon";
GRANT ALL ON FUNCTION "public"."volunteer_count"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."volunteer_count"() TO "service_role";


















GRANT ALL ON TABLE "public"."burrow_logs" TO "anon";
GRANT ALL ON TABLE "public"."burrow_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."burrow_logs" TO "service_role";



GRANT ALL ON TABLE "public"."burrow_photos" TO "anon";
GRANT ALL ON TABLE "public"."burrow_photos" TO "authenticated";
GRANT ALL ON TABLE "public"."burrow_photos" TO "service_role";



GRANT ALL ON TABLE "public"."burrows" TO "anon";
GRANT ALL ON TABLE "public"."burrows" TO "authenticated";
GRANT ALL ON TABLE "public"."burrows" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."sightings" TO "anon";
GRANT ALL ON TABLE "public"."sightings" TO "authenticated";
GRANT ALL ON TABLE "public"."sightings" TO "service_role";



GRANT ALL ON TABLE "public"."squad_invites" TO "anon";
GRANT ALL ON TABLE "public"."squad_invites" TO "authenticated";
GRANT ALL ON TABLE "public"."squad_invites" TO "service_role";



GRANT ALL ON TABLE "public"."squad_members" TO "anon";
GRANT ALL ON TABLE "public"."squad_members" TO "authenticated";
GRANT ALL ON TABLE "public"."squad_members" TO "service_role";



GRANT ALL ON TABLE "public"."squads" TO "anon";
GRANT ALL ON TABLE "public"."squads" TO "authenticated";
GRANT ALL ON TABLE "public"."squads" TO "service_role";



GRANT ALL ON TABLE "public"."treatments" TO "anon";
GRANT ALL ON TABLE "public"."treatments" TO "authenticated";
GRANT ALL ON TABLE "public"."treatments" TO "service_role";



GRANT ALL ON TABLE "public"."wombat_photos" TO "anon";
GRANT ALL ON TABLE "public"."wombat_photos" TO "authenticated";
GRANT ALL ON TABLE "public"."wombat_photos" TO "service_role";



GRANT ALL ON TABLE "public"."wombats" TO "anon";
GRANT ALL ON TABLE "public"."wombats" TO "authenticated";
GRANT ALL ON TABLE "public"."wombats" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































