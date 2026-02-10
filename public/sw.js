// public/sw.js
const CACHE_VERSION = 'v1';
const APP_SHELL_CACHE = `app-shell-${CACHE_VERSION}`;

const APP_SHELL_ASSETS = [
  '/', // 首頁
  '/uploadPage', // 入口頁 1
  '/pdfViewerPage', // 入口頁 2
  '/manifest.json',
  // 你的 icon
  '/pwa/favicon-96x96.png',
  '/pwa/web-app-manifest-192x192.png',
  '/pwa/web-app-manifest-512x512.png',
  // 如果你有 offline 頁面就加：
  // '/offline'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// 只攔截 /tiles/<jobId>/... 的請求
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (!url.pathname.startsWith('/tiles/')) return;

  event.respondWith(
    (async () => {
      // 你的 cache name 會是 tiles-<jobId>
      // 從 /tiles/<jobId>/... 抽出 jobId
      const parts = url.pathname.split('/');
      // const jobId = parts[2]; // ['', 'tiles', '<jobId>', ...]
      // const cacheName = `tiles-${jobId}`;
      const cacheName = `tiles`;

      const cache = await caches.open(cacheName);
      const cached = await cache.match(event.request);
      if (cached) return cached;

      // 沒命中：這裡通常可以 fallback 到網路
      // 但你是「只有前端」，沒有真正的 tiles server，所以直接回 404
      return new Response('Tile not found in cache', { status: 404 });
    })()
  );
});
