/* AlianHub service worker — DISABLED (kill-switch).
 *
 * The SEC-03 PWA service worker was withdrawn: its cache-first asset strategy
 * fought the dev server's HMR (non-hashed dev bundles were served stale), which
 * produced a full-page reload loop. Because a registered service worker
 * persists in the browser across deploys, simply deleting the file is not
 * enough — already-affected browsers would keep running the old looping worker.
 *
 * This stub takes over from any previously-installed AlianHub worker, drops its
 * caches, and unregisters itself. Crucially it has NO fetch handler, so the
 * instant it activates the browser stops serving stale cached assets and the
 * loop ends. The browser auto-checks this script on navigation, so affected
 * clients self-heal with no user action.
 *
 * A production-only PWA worker (registered only on https + non-localhost, and
 * aware of hashed build assets) can be reintroduced later. */

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try { await self.clients.claim(); } catch (e) { /* noop */ }
    try {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith('alianhub-pwa')).map((k) => caches.delete(k)));
    } catch (e) { /* noop */ }
    try { await self.registration.unregister(); } catch (e) { /* noop */ }
  })());
});

// No 'fetch' listener — every request goes straight to the network.
