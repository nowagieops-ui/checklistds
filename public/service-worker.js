// Exists mainly so Chrome considers this site "installable" (Android's PWA
// install prompt requires an active service worker with a fetch handler).
// Only caches genuinely static assets — never HTML pages — so marketers
// always see live checklist/session state, never something stale or cached
// from a different login on a shared device.
const CACHE_NAME = 'dashspid-static-v1';
const STATIC_PATHS = ['/style.css', '/favicon.svg', '/manifest.json'];

function isCacheableStatic(pathname) {
  return STATIC_PATHS.includes(pathname) || pathname.startsWith('/icons/');
}

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (!isCacheableStatic(url.pathname)) return;

  event.respondWith(
    caches.open(CACHE_NAME).then((cache) =>
      cache.match(url.pathname).then((cached) => {
        const fetchPromise = fetch(event.request)
          .then((response) => {
            cache.put(url.pathname, response.clone());
            return response;
          })
          .catch(() => cached);
        return cached || fetchPromise;
      })
    )
  );
});
