/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { parseEnv } from './src/config/env';

export default defineConfig(({ command, mode }) => {
  // Fail the build, not the volunteer's phone, when Supabase settings are missing.
  if (command === 'build') parseEnv(loadEnv(mode, process.cwd(), 'VITE_'));

  return {
    // GitHub Pages serves production from /wombatwatch/; previews and local dev serve from /
    base: mode === 'production' ? '/wombatwatch/' : '/',
    plugins: [react()],
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./vitest.setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
    },
  };
});
