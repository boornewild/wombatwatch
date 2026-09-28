import { readFileSync } from 'node:fs';

/** Direct access to the local Supabase the dev server uses (values from .env.development.local). */
const env = Object.fromEntries(
  readFileSync(new URL('../../.env.development.local', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
);
const URL_ = env.VITE_SUPABASE_URL!;
const KEY = env.VITE_SUPABASE_ANON_KEY!;

export async function signInToken(email: string): Promise<string> {
  const res = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'password123' }),
  });
  return (await res.json()).access_token;
}

export async function rest(token: string, path: string, init: RequestInit = {}) {
  const res = await fetch(`${URL_}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...init.headers },
  });
  return res.status === 204 ? null : res.json();
}
