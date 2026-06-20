/* AlianHub PWA service worker (SEC-03).
 * Conservative + safe:
 *  - API / socket requests are NEVER cached (always network).
 *  - Navigations are network-first with an offline fallback to the cached shell.
 *  - Hashed build assets are cache-first (then network, and cached).
 * Bump CACHE on shape changes; old caches are purged on activate. */
const CACHE = 'alianhub-pwa-v1';
const SHELL = ['/', '/index.html'];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL).catch(() => {})));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return;            // skip cross-origin (fonts, IdP, CDNs)
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/socket')) return; // never cache API/sockets

  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.match('/')));
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req).then((res) => {
      if (res && res.status === 200 && res.type === 'basic') {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
      }
      return res;
    }).catch(() => cached))
  );
});
