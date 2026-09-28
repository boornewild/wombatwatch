/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { parseEnv } from './src/config/env';

export default defineConfig(({ command, mode }) => {
  // Fail the build, not the volunteer's phone, when Supabase settings are missing.
  if (command === 'build') parseEnv(loadEnv(mode, process.cwd(), 'VITE_'));

  return {
    // GitHub Pages serves production from /wombatwatch/; previews and local dev serve from /
    base: mode === 'production' ? '/wombatwatch/' : '/',
    plugins: [
      react(),
      VitePWA({
        strategies: 'injectManifest',
        srcDir: 'src',
        filename: 'sw.ts', // emitted as sw.js — same URL as the old worker, so installed apps upgrade in place
        injectRegister: false, // registered in main.tsx
        manifest: false, // public/manifest.json is used as-is
        injectManifest: { globPatterns: ['**/*.{js,css,html,png,json}'] },
      }),
    ],
    // Temporary HTTPS tunnels for testing staging builds on a phone (npm run preview:phone)
    preview: { allowedHosts: ['.trycloudflare.com'] },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./vitest.setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
    },
  };
});
