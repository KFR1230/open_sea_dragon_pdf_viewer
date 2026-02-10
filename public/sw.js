// public/sw.js
// iOS Safari / PWA offline essentials:
// 1) Pre-cache an App Shell so the app can OPEN offline.
// 2) Handle navigation (req.mode === 'navigate') with an offline fallback.
// 3) Cache tiles with cache-first so your OSD viewer can work offline.

const CACHE_VERSION = 'v2';
const APP_SHELL_CACHE = `app-shell-${CACHE_VERSION}`;
const NEXT_STATIC_CACHE = `next-static-${CACHE_VERSION}`;
const TILES_CACHE_PREFIX = `tiles`;

// App Shell: keep this SMALL. Only what you need to boot.
const APP_SHELL_ASSETS = [
  '/',
  '/uploadPage',
  '/pdfViewerPage',
  '/manifest.json',
  '/pwa/favicon-96x96.png',
  '/pwa/web-app-manifest-192x192.png',
  '/pwa/web-app-manifest-512x512.png',
  // If you create an offline page route, add it here too:
  // '/offline'
];

function isSameOrigin(url) {
  return url.origin === self.location.origin;
}

function isTileRequest(url) {
  // Your current tiles path pattern
  return url.pathname.startsWith('/tiles/');
}

function isNextStaticAsset(url) {
  // Next.js build assets: CSS/JS/chunks that must exist offline for styles to render
  return url.pathname.startsWith('/_next/static/');
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(APP_SHELL_CACHE);
      // addAll will fail the whole install if any asset 404s.
      // Keep this list accurate.
      await cache.addAll(APP_SHELL_ASSETS);
      self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Cleanup old caches
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => {
            // keep current version caches
            if (k === APP_SHELL_CACHE) return false;
            if (k === NEXT_STATIC_CACHE) return false;
            if (k.startsWith(TILES_CACHE_PREFIX)) return false;
            // delete everything else
            return true;
          })
          .map((k) => caches.delete(k))
      );

      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // 1) Navigation requests (HTML pages): network-first, fallback to cached '/'
  // This is the part that prevents Safari from showing "not connected".
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        const cache = await caches.open(APP_SHELL_CACHE);

        try {
          // Try network first so updates work when online
          const networkRes = await fetch(req);
          // Optionally cache the navigated page too (same-origin only)
          if (isSameOrigin(url) && networkRes.ok) {
            cache.put(req, networkRes.clone());
          }
          return networkRes;
        } catch (e) {
          // Offline fallback
          const cachedHome = await cache.match('/');
          if (cachedHome) return cachedHome;

          // If you have '/offline' route, prefer it
          const cachedOffline = await cache.match('/offline');
          if (cachedOffline) return cachedOffline;

          return new Response('Offline', {
            status: 503,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          });
        }
      })()
    );
    return;
  }

  // 2) Next.js build assets (CSS/JS/chunks): cache-first so offline pages keep styles
  if (isSameOrigin(url) && isNextStaticAsset(url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(NEXT_STATIC_CACHE);
        const hit = await cache.match(req);
        if (hit) return hit;

        try {
          const res = await fetch(req);
          if (res.ok) cache.put(req, res.clone());
          return res;
        } catch {
          // No cached asset available; fail hard (better than returning a 503 text body for CSS/JS)
          return Response.error();
        }
      })()
    );
    return;
  }

  // 3) Tiles: cache-first (offline-first)
  if (isSameOrigin(url) && isTileRequest(url)) {
    event.respondWith(
      (async () => {
        // Option A: single tiles cache
        const cacheName = `${TILES_CACHE_PREFIX}`;

        // Option B (future): per jobId cache
        // const parts = url.pathname.split('/');
        // const jobId = parts[2]; // ['', 'tiles', '<jobId>', ...]
        // const cacheName = `${TILES_CACHE_PREFIX}-${jobId}`;

        const cache = await caches.open(cacheName);
        const hit = await cache.match(req);
        if (hit) return hit;

        // If you sometimes have network tiles, try network and cache.
        // If you are strictly offline-only tiles, this will just fail and we return 404.
        try {
          const res = await fetch(req);
          if (res.ok) {
            cache.put(req, res.clone());
          }
          return res;
        } catch (e) {
          return new Response('Tile not found in cache', { status: 404 });
        }
      })()
    );
    return;
  }

  // 4) Same-origin static assets: stale-while-revalidate (optional)
  // Keeps app snappy while still updating.
  if (isSameOrigin(url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(APP_SHELL_CACHE);
        const cached = await cache.match(req);

        const fetchPromise = fetch(req)
          .then((res) => {
            if (res && res.ok) cache.put(req, res.clone());
            return res;
          })
          .catch(() => null);

        // Return cached immediately if present, otherwise wait for network.
        return (
          cached ||
          (await fetchPromise) ||
          new Response('Offline', { status: 503 })
        );
      })()
    );
  }
});
