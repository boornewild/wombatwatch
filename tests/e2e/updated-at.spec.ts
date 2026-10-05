import { test, expect } from '@playwright/test';
import { signInToken, rest } from './supabase';

// Incremental sync asks for rows with updated_at >= the last sync, so every table it reads must bump
// updated_at on UPDATE. wombats and burrows lacked the trigger (bug #11).
for (const [table, id] of [['wombats', 'wombat-seed-1'], ['burrows', 'burrow-seed-1']] as const) {
  test(`editing a row in ${table} moves its updated_at forward`, async () => {
    const token = await signInToken('alice@test.local');
    const [before] = (await rest(token, `${table}?select=updated_at,name&id=eq.${id}`)) as { updated_at: string; name: string }[];
    await new Promise((r) => setTimeout(r, 20));
    const headers = { Prefer: 'return=representation' };
    const [after] = (await rest(token, `${table}?id=eq.${id}`, { method: 'PATCH', headers, body: JSON.stringify({ name: before!.name }) })) as { updated_at: string }[];
    expect(Date.parse(after!.updated_at)).toBeGreaterThan(Date.parse(before!.updated_at));
  });
}
