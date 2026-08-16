/* Service worker: cache-first app shell so the tracker works with no signal.
   Bump CACHE_VERSION whenever shell assets change. */

const CACHE_VERSION = 'ppt-v3';

/* Build identity is written at deploy time and must never be served stale, or
   the app would report the wrong version after an update. */
const NETWORK_FIRST = ['/commit_hash.txt', '/build_date.txt'];

/* Relative URLs so the worker behaves correctly from a GitHub Pages subpath. */
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/styles.css',
  './css/themes.css',
  './js/app.js',
  './js/db.js',
  './js/schema.js',
  './js/theme.js',
  './js/ui.js',
  './js/menu.js',
  './js/photos.js',
  './js/quick-bowl.js',
  './js/install.js',
  './js/stats.js',
  './js/charts.js',
  './js/transfer.js',
  './js/views/dashboard.js',
  './js/views/visits.js',
  './js/views/log.js',
  './js/views/visit-form.js',
  './js/views/visit-detail.js',
  './js/views/people.js',
  './js/views/locations.js',
  './js/views/combos.js',
  './js/views/stats-view.js',
  './js/views/settings.js',
  './icons/favicon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION);
    // addAll fails the whole install if any single asset 404s, so add
    // individually and tolerate misses.
    await Promise.all(SHELL.map(async (url) => {
      try { await cache.add(new Request(url, { cache: 'reload' })); } catch { /* skip */ }
    }));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Navigations: try the network, fall back to the cached shell when offline.
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        return await fetch(request);
      } catch {
        const cache = await caches.open(CACHE_VERSION);
        return (await cache.match('./index.html'))
          || (await cache.match('./'))
          || Response.error();
      }
    })());
    return;
  }

  // Assets: cache first, refreshing in the background.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_VERSION);

    // Build identity must reflect the deployment actually being served.
    if (NETWORK_FIRST.some((suffix) => url.pathname.endsWith(suffix))) {
      try {
        const res = await fetch(request);
        if (res && res.ok) cache.put(request, res.clone());
        return res;
      } catch {
        return (await cache.match(request)) || Response.error();
      }
    }

    const cached = await cache.match(request);
    if (cached) {
      fetch(request).then((res) => {
        if (res && res.ok) cache.put(request, res.clone());
      }).catch(() => { /* stay on the cached copy */ });
      return cached;
    }
    try {
      const res = await fetch(request);
      if (res && res.ok) cache.put(request, res.clone());
      return res;
    } catch {
      return Response.error();
    }
  })());
});
