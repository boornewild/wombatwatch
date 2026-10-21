import { test, expect } from '@playwright/test';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { signInToken, rest } from './supabase';

// Access rules (RLS + Storage policies), checked through the real API as each seeded user.
const env = Object.fromEntries(
  readFileSync(new URL('../../.env.development.local', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
);
const URL_ = env.VITE_SUPABASE_URL!;
const KEY = env.VITE_SUPABASE_ANON_KEY!;
const SQUAD = '11111111-1111-1111-1111-111111111111';
const BOB = '00000000-0000-0000-0000-00000000000b';
const sql = (q: string) => execSync(`npx supabase db query --local "${q}"`, { stdio: 'ignore' });
const resetBob = () => sql(`delete from squad_members where user_id='${BOB}'`);

test.describe.configure({ mode: 'serial' });
test.beforeEach(resetBob);
test.afterAll(resetBob);

test('members see their squad; non-members see nothing', async () => {
  const names = async (email: string) => ((await rest(await signInToken(email), 'wombats?select=name')) as { name: string }[]).map((w) => w.name);
  expect(await names('alice@test.local')).toEqual(['Seed Wombat']);
  expect(await names('carol@test.local')).toEqual(['Seed Wombat']);
  expect(await names('bob@test.local')).toEqual([]);
});

test('invites: expired and used-up are refused, a valid one joins', async () => {
  const bob = await signInToken('bob@test.local');
  const join = (t: string) => rest(bob, 'rpc/join_squad_by_invite', { method: 'POST', body: JSON.stringify({ p_token: t }) });
  expect(await join('expired-invite-token')).toEqual({ error: 'expired' });
  expect(await join('used-up-invite-token')).toEqual({ error: 'max_uses_reached' });
  expect(await join('nope')).toEqual({ error: 'invalid_token' });
  expect(await join('test-invite-token')).toMatchObject({ ok: true, squad_id: SQUAD });
});

test('a squad admin can add and remove members (bug #15)', async () => {
  const alice = await signInToken('alice@test.local');
  const added = await rest(alice, 'squad_members', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ squad_id: SQUAD, user_id: BOB, role: 'member' }) });
  expect(added).toEqual([expect.objectContaining({ user_id: BOB })]);
  const removed = await rest(alice, `squad_members?user_id=eq.${BOB}&squad_id=eq.${SQUAD}`, { method: 'DELETE', headers: { Prefer: 'return=representation' } });
  expect(removed).toEqual([expect.objectContaining({ user_id: BOB })]);
});

test('a plain member cannot add or remove members', async () => {
  const carol = await signInToken('carol@test.local');
  const add = await rest(carol, 'squad_members', { method: 'POST', body: JSON.stringify({ squad_id: SQUAD, user_id: BOB, role: 'member' }) });
  expect(add).toMatchObject({ code: '42501' });
  const removed = await rest(carol, `squad_members?user_id=eq.00000000-0000-0000-0000-00000000000a`, { method: 'DELETE', headers: { Prefer: 'return=representation' } });
  expect(removed).toEqual([]);
});

/** Uploads, deletes and checks photo files through the Storage API. */
const storage = (token: string) => ({
  upload: (path: string, body: string, upsert = false) =>
    fetch(`${URL_}/storage/v1/object/photos/${path}`, {
      method: 'POST',
      headers: { apikey: KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'image/jpeg', 'x-upsert': String(upsert) },
      body,
    }),
  remove: (path: string) =>
    fetch(`${URL_}/storage/v1/object/photos`, {
      method: 'DELETE',
      headers: { apikey: KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefixes: [path] }),
    }).then((r) => r.json() as Promise<unknown[]>),
  exists: (path: string) => fetch(`${URL_}/storage/v1/object/public/photos/${path}`).then((r) => r.ok),
});

test('photo files: the uploader can replace and delete their own; another volunteer cannot (bug #3)', async () => {
  const alice = storage(await signInToken('alice@test.local'));
  const carol = storage(await signInToken('carol@test.local'));
  const path = `rls-test-${Date.now()}.jpg`;
  expect((await alice.upload(path, 'v1')).ok).toBe(true);

  expect((await carol.upload(path, 'carol', true)).ok).toBe(false);
  expect(await carol.remove(path)).toEqual([]);
  expect(await alice.exists(path)).toBe(true);

  expect((await alice.upload(path, 'v2', true)).ok).toBe(true);
  expect(await alice.remove(path)).toHaveLength(1);
  expect(await alice.exists(path)).toBe(false);
});
