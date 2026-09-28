import { z } from 'zod';

export type Env = { supabaseUrl: string; supabaseAnonKey: string };

const schema = z.object({
  VITE_SUPABASE_URL: z.string().url(),
  VITE_SUPABASE_ANON_KEY: z.string().min(1),
});

export function parseEnv(raw: Record<string, unknown>): Env {
  const result = schema.safeParse(raw);
  if (!result.success) {
    const names = result.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`Invalid environment config: ${names}. Copy .env.example to .env.development.local.`);
  }
  return { supabaseUrl: result.data.VITE_SUPABASE_URL, supabaseAnonKey: result.data.VITE_SUPABASE_ANON_KEY };
}

let cached: Env | undefined;

/** Validated config for the current build (local, staging or production). */
export function getEnv(): Env {
  cached ??= parseEnv(import.meta.env);
  return cached;
}
