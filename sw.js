/**
 * WombatWatch Service Worker
 *
 * Strategy:
 *  - App shell (HTML, CDN scripts/styles) → cache-first, updated in background
 *  - Map tiles (OpenStreetMap / CartoDB) → network-first, cache as fallback
 *  - Everything else → network-first
 *
 * Bump CACHE_VERSION whenever you deploy a new build so stale caches
 * are cleared automatically on the next launch.
 */

const CACHE_VERSION = 'v3';
const SHELL_CACHE   = `wombatwatch-shell-${CACHE_VERSION}`;
const TILE_CACHE    = `wombatwatch-tiles-${CACHE_VERSION}`;

/** Resources that make up the app shell — cached on install */
const SHELL_URLS = [
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
  // CDN dependencies
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://unpkg.com/react@18.3.1/umd/react.production.min.js',
  'https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js',
];

/** Hostnames whose responses should be treated as map tiles */
const TILE_HOSTS = [
  'tile.openstreetmap.org',
  'a.tile.openstreetmap.org',
  'b.tile.openstreetmap.org',
  'c.tile.openstreetmap.org',
  'basemaps.cartocdn.com',
];

// ── Install: pre-cache the app shell ────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(async cache => {
        // Cache each resource individually so one failure doesn't break the whole install
        await Promise.allSettled(
          SHELL_URLS.map(url =>
            cache.add(url).catch(err => console.warn('[SW] Failed to cache:', url, err))
          )
        );
      }).then(() => self.skipWaiting())
  );
});

// ── Activate: delete caches from previous versions ───────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys =>
        Promise.all(
          keys
            .filter(k => k !== SHELL_CACHE && k !== TILE_CACHE)
            .map(k => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())  // take control of all open tabs immediately
  );
});

// ── Fetch: route requests to the right strategy ──────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle GET requests
  if (request.method !== 'GET') return;

  // Never intercept Supabase API / auth / storage calls — always network
  if (url.hostname.endsWith('.supabase.co')) return;

  // Map tiles — network first, fall back to cached tile
  if (TILE_HOSTS.includes(url.hostname)) {
    event.respondWith(networkFirstTile(request));
    return;
  }

  // App shell & CDN — cache first, fall back to network
  event.respondWith(cacheFirst(request));
});

// ── Strategy: cache-first ────────────────────────────────────────────────────
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(SHELL_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    // Offline and not in cache — nothing we can do
    return new Response('Offline — resource not cached', { status: 503 });
  }
}

// ── Strategy: network-first for map tiles ────────────────────────────────────
async function networkFirstTile(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(TILE_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    return cached || new Response('Tile unavailable offline', { status: 503 });
  }
}
