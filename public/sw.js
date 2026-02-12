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

// Helper: rebuild a non-redirected Response (for iOS Safari/PWA)
async function stripRedirect(res) {
  // iOS Safari can refuse navigation responses served from SW if the cached Response
  // is marked as redirected (even if it ultimately renders fine when online).
  // Rebuilding a fresh Response removes the redirected flag.
  if (!res) return res;

  // Only bother if it looks like a redirect or a redirected response.
  const isRedirectStatus = [301, 302, 303, 307, 308].includes(res.status);
  if (!res.redirected && !isRedirectStatus) return res;

  const buf = await res.clone().arrayBuffer();
  return new Response(buf, {
    status: 200,
    statusText: 'OK',
    headers: res.headers,
  });
}

// Allow the client page to trigger immediate activation of a waiting SW.
self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || typeof data !== 'object') return;

  // Client can call: reg.waiting.postMessage({ type: 'SKIP_WAITING' })
  if (data.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }

  // Optional: allow manual cleanup if you decide to "disable" SW behavior.
  // Client can call: navigator.serviceWorker.controller?.postMessage({ type: 'CLEAR_CACHES' })
  if (data.type === 'CLEAR_CACHES') {
    event.waitUntil(
      (async () => {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      })()
    );
  }
});

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(APP_SHELL_CACHE);

      // Manually precache to avoid storing redirected Responses for navigations.
      for (const path of APP_SHELL_ASSETS) {
        try {
          const req = new Request(path, {
            cache: 'reload',
            // follow redirects so we end up with the real document
            redirect: 'follow',
          });

          const res = await fetch(req);
          if (!res || !res.ok) continue;

          const clean = await stripRedirect(res);
          await cache.put(req, clean.clone());
        } catch {
          // Skip missing assets; do not fail the whole SW install.
        }
      }

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

          // If this navigation involved redirects, rebuild a clean Response.
          const cleanNetworkRes = await stripRedirect(networkRes);

          if (isSameOrigin(url) && cleanNetworkRes && cleanNetworkRes.ok) {
            await cache.put(req, cleanNetworkRes.clone());
          }

          return cleanNetworkRes;
        } catch (e) {
          // Prefer an exact cached match for this route.
          const cachedExact = await cache.match(req);
          if (cachedExact) return await stripRedirect(cachedExact);

          const cachedHome = await cache.match('/');
          if (cachedHome) return await stripRedirect(cachedHome);

          const cachedOffline = await cache.match('/offline');
          if (cachedOffline) return await stripRedirect(cachedOffline);

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
