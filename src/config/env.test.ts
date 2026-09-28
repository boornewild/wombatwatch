import { parseEnv } from './env';

it('parses valid env', () => {
  expect(parseEnv({ VITE_SUPABASE_URL: 'http://localhost:54321', VITE_SUPABASE_ANON_KEY: 'k' })).toEqual({
    supabaseUrl: 'http://localhost:54321',
    supabaseAnonKey: 'k',
  });
});

it('throws a readable error naming the missing variable', () => {
  expect(() => parseEnv({ VITE_SUPABASE_URL: 'http://x' })).toThrow(/VITE_SUPABASE_ANON_KEY/);
});

it('rejects a URL that is not a URL', () => {
  expect(() => parseEnv({ VITE_SUPABASE_URL: 'not a url', VITE_SUPABASE_ANON_KEY: 'k' })).toThrow(
    /VITE_SUPABASE_URL/,
  );
});
