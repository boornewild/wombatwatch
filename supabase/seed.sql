-- Local/staging seed data. Runs after migrations on `supabase db reset`.
-- Never run against production.
--
-- Users (password for all: password123)
--   alice@test.local  admin of "Test Squad"
--   carol@test.local  member of "Test Squad"
--   bob@test.local    signed up, in no squad (the "invited but can't see anything" case)
--
-- Invite tokens for "Test Squad"
--   test-invite-token      valid, unlimited uses
--   expired-invite-token   expired yesterday
--   used-up-invite-token   max_uses reached

-- ── Users ────────────────────────────────────────────────────────────────────
-- auth.users token columns must be '' not NULL, or GoTrue fails to sign in.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
select
  '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email,
  extensions.crypt('password123', extensions.gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}', jsonb_build_object('display_name', u.name),
  now(), now(), '', '', '', ''
from (values
  ('00000000-0000-0000-0000-00000000000a'::uuid, 'alice@test.local', 'Alice'),
  ('00000000-0000-0000-0000-00000000000b'::uuid, 'bob@test.local',   'Bob'),
  ('00000000-0000-0000-0000-00000000000c'::uuid, 'carol@test.local', 'Carol')
) as u(id, email, name);

insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), u.id, u.id::text, jsonb_build_object('sub', u.id::text, 'email', u.email), 'email', now(), now(), now()
from auth.users u
where u.email like '%@test.local';

-- profiles rows are created by the on_auth_user_created trigger.

-- ── Squad ────────────────────────────────────────────────────────────────────
insert into public.squads (id, name, created_by, bounds_sw_lat, bounds_sw_lng, bounds_ne_lat, bounds_ne_lng)
values ('11111111-1111-1111-1111-111111111111', 'Test Squad', '00000000-0000-0000-0000-00000000000a',
        -33.33, 150.93, -33.25, 151.01);

insert into public.squad_members (squad_id, user_id, role) values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-00000000000a', 'admin'),
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-00000000000c', 'member');

insert into public.squad_invites (squad_id, token, created_by, expires_at, max_uses, use_count) values
  ('11111111-1111-1111-1111-111111111111', 'test-invite-token',    '00000000-0000-0000-0000-00000000000a', null,                        null, 0),
  ('11111111-1111-1111-1111-111111111111', 'expired-invite-token', '00000000-0000-0000-0000-00000000000a', now() - interval '1 day',   null, 0),
  ('11111111-1111-1111-1111-111111111111', 'used-up-invite-token', '00000000-0000-0000-0000-00000000000a', null,                        1,    1);

-- ── Records ──────────────────────────────────────────────────────────────────
insert into public.burrows (id, created_by, squad_id, name, code, status, lat, lng, wombat_ids)
values ('burrow-seed-1', '00000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111',
        'Creek Burrow', 'B0001', 'active', -33.2900, 150.9700, '{wombat-seed-1}');

insert into public.wombats (id, created_by, squad_id, name, code, status, lat, lng, burrow_ids, first_seen)
values
  ('wombat-seed-1', '00000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111',
   'Seed Wombat', 'W0001', 'under_treatment', -33.2901, 150.9702, '{burrow-seed-1}', current_date - 30),
  -- No squad: invisible to everyone under RLS. Mirrors pre-squad records in production.
  ('wombat-orphan-1', '00000000-0000-0000-0000-00000000000a', null,
   'Orphan Wombat', 'W0002', 'healthy', -33.2950, 150.9750, '{}', current_date - 60);

insert into public.treatments (id, wombat_id, created_by, at, by_name, product, dose, method, severity)
values ('treatment-seed-1', 'wombat-seed-1', '00000000-0000-0000-0000-00000000000a',
        current_date - 7, 'Alice', 'cydectin', '2ml', 'burrow_flap', 3);
