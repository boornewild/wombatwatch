/// <reference lib="webworker" />
/**
 * WombatWatch service worker (built by vite-plugin-pwa, injectManifest).
 *
 *  - App shell: Workbox precaches the hashed build output, so every deploy updates automatically.
 *  - Map tiles: network-first, cached for offline use. The cache name is shared with the map's
 *    "download offline area" feature (TILE_CACHE_NAME in the app) — never rename it, or
 *    volunteers lose their downloaded maps.
 *  - Supabase: never intercepted.
 *  - Background Sync: tells open tabs to flush the offline queue (Android/Chrome only).
 */
import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

declare const self: ServiceWorkerGlobalScope;

const TILE_CACHE = 'wombatwatch-tiles-v6';
const TILE_HOSTS = [
  'tile.openstreetmap.org',
  'a.tile.openstreetmap.org',
  'b.tile.openstreetmap.org',
  'c.tile.openstreetmap.org',
  'basemaps.cartocdn.com',
  'server.arcgisonline.com', // Esri World Imagery — satellite overlay
];
// Caches created by the pre-Vite hand-written sw.js (v1–v6). Removing them stops a stale index.html being served.
const LEGACY_SHELL_CACHE_PREFIX = 'wombatwatch-shell-';

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
// Offline: any in-app navigation gets the precached app shell.
registerRoute(new NavigationRoute(createHandlerBoundToURL(`${import.meta.env.BASE_URL}index.html`)));

self.addEventListener('install', () => {
  void self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith(LEGACY_SHELL_CACHE_PREFIX)).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

registerRoute(
  ({ url, request }) => request.method === 'GET' && TILE_HOSTS.includes(url.hostname),
  ({ request }) => networkFirstTile(request),
);

async function networkFirstTile(request: Request): Promise<Response> {
  try {
    const response = await fetch(request);
    if (response.ok) await (await caches.open(TILE_CACHE)).put(request, response.clone());
    return response;
  } catch {
    const cached = await caches.match(request);
    return cached ?? new Response('Tile unavailable offline', { status: 503 });
  }
}

// The SW has no Supabase credentials, so it asks open tabs to flush. If none are open,
// the app's 'online' listener flushes next time it's opened.
type SyncEvent = ExtendableEvent & { tag: string };
self.addEventListener('sync', (event) => {
  const syncEvent = event as SyncEvent;
  if (syncEvent.tag !== 'ww-queue-flush') return;
  syncEvent.waitUntil(
    self.clients
      .matchAll({ includeUncontrolled: true, type: 'window' })
      .then((clients) => clients.forEach((c) => c.postMessage({ type: 'WW_FLUSH_QUEUE' }))),
  );
});
