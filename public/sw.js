// public/sw.js
// iOS Safari / PWA offline essentials:
// 1) Pre-cache an App Shell so the app can OPEN offline.
// 2) Handle navigation (req.mode === 'navigate') with an offline fallback.
// 3) Cache Next.js static assets so the app still has JS/CSS offline.
// 4) Cache tiles with cache-first so your OSD viewer can work offline.
//
// NOTE: Response.body is a one-time stream.
// If you both cache.put() and return/respondWith() the same Response,
// you MUST use res.clone() for the cache write, or you'll get:
// "a Response whose body is locked" -> net::ERR_FAILED

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
  return url.pathname.startsWith('/tiles/');
}

function isTileConfigRequest(url) {
  // Your config is /tiles/osd_config.json
  return url.pathname.startsWith('/tiles/') && url.pathname.endsWith('.json');
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
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => {
            // Keep current version caches
            if (k === APP_SHELL_CACHE) return false;
            if (k === NEXT_STATIC_CACHE) return false;
            if (k === TILES_CACHE_PREFIX) return false;
            if (k.startsWith(`${TILES_CACHE_PREFIX}/`)) return false;
            // Delete everything else
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

  // 1) Navigation requests (HTML pages): network-first, fallback to cached '/' (app shell)
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        const cache = await caches.open(APP_SHELL_CACHE);
        try {
          const networkRes = await fetch(req);
          if (isSameOrigin(url) && networkRes && networkRes.ok) {
            // cache navigations if you want
            await cache.put(req, networkRes.clone());
          }
          return networkRes;
        } catch (e) {
          const cachedHome = await cache.match('/');
          if (cachedHome) return cachedHome;

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

  // 2) Next.js build assets (CSS/JS/chunks): cache-first
  if (isSameOrigin(url) && isNextStaticAsset(url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(NEXT_STATIC_CACHE);
        const hit = await cache.match(req);
        if (hit) return hit;

        try {
          const res = await fetch(req);
          if (res && res.ok) await cache.put(req, res.clone());
          return res;
        } catch (e) {
          // No cached asset available
          return Response.error();
        }
      })()
    );
    return;
  }

  // 3) Tiles + config: cache-first (offline-first)
  if (isSameOrigin(url) && isTileRequest(url)) {
    event.respondWith(
      (async () => {
        // A) Tile config JSON
        if (isTileConfigRequest(url)) {
          const cache = await caches.open(TILES_CACHE_PREFIX);
          const cached = await cache.match(req);
          if (cached) return cached;

          // Optional network fallback
          try {
            const res = await fetch(req);

            if (res && res.ok) await cache.put(req, res.clone());

            return res;
          } catch (e) {
            return new Response('Tile config not found in cache', {
              status: 404,
              headers: { 'Content-Type': 'text/plain; charset=utf-8' },
            });
          }
        }
        // B) tiles
        const cacheName = TILES_CACHE_PREFIX;
        const cache = await caches.open(cacheName);
        const hit = await cache.match(req);

        if (hit) return hit;

        // Optional network fallback (keep if you sometimes fetch tiles online)
        try {
          const res = await fetch(req);
          if (res && res.ok) await cache.put(req, res.clone());
          return res;
        } catch (e) {
          return new Response('Tile not found in cache', {
            status: 404,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          });
        }
      })()
    );
    return;
  }

  // 4) Same-origin static assets: stale-while-revalidate (optional)
  if (isSameOrigin(url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(APP_SHELL_CACHE);
        const cached = await cache.match(req);

        const fetchPromise = fetch(req)
          .then(async (res) => {
            if (res && res.ok) await cache.put(req, res.clone());
            return res;
          })
          .catch(() => null);

        return (
          cached ||
          (await fetchPromise) ||
          new Response('Offline', { status: 503 })
        );
      })()
    );
  }
});
