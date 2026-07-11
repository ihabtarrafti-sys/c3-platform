/*
 * sw.js — C3 PWA service worker (Track B5). Makes C3 installable and gives it
 * an offline shell. Deliberately conservative:
 *   - It NEVER touches cross-origin requests (the API is api.staging.c3hq.org —
 *     a different origin — so auth/data always hit the network, never a cache).
 *   - Navigations are network-first, falling back to the cached app shell only
 *     when truly offline (so a fresh deploy is always served when online).
 *   - Same-origin static assets (the hashed JS/CSS, icons) are cache-first with
 *     a network fallback, and hashed filenames make staleness a non-issue.
 * Bumping CACHE evicts the previous version on activate.
 */
const CACHE = 'c3-shell-v1';
const SHELL = ['/', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // never cache mutations
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // cross-origin (the API) → untouched

  // App navigations: network-first, fall back to the cached shell when offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match('/').then((r) => r || Response.error())),
    );
    return;
  }

  // Same-origin static assets: cache-first, then network (and cache the result).
  event.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
