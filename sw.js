// OrangeSwim service worker.
// __CACHE_VERSION__ is replaced at deploy time by scripts/stamp_cache_version.py with
// a content hash, so each deploy uses a fresh cache and old caches get deleted.
//
// Rules:
//   * Only same-origin GET requests are handled. Cross-origin requests (Supabase API
//     and Storage, the jsDelivr CDN) are never intercepted or cached.
//   * Navigations: network first, then the cached page, then offline.html.
//   * Other same-origin assets: stale-while-revalidate.
const CACHE = 'orangeswim-__CACHE_VERSION__';

const PRECACHE = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './logic.js',
  './db.js',
  './config.js',
  './manifest.webmanifest',
  './offline.html',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png',
];

self.addEventListener('install', (event) => {
  // No skipWaiting here: an update waits until the page asks for it (Reload banner)
  // or every tab is closed, so a running page never mixes old and new files.
  // cache: 'reload' skips the HTTP cache so a fresh deploy never precaches stale files.
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE.map((url) => new Request(url, { cache: 'reload' })))));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('orangeswim-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

function putInCache(request, response) {
  if (response && response.status === 200 && response.type === 'basic') {
    const copy = response.clone();
    caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Supabase, CDN: straight to network

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => putInCache(req, res))
        .catch(async () => {
          const cache = await caches.open(CACHE);
          return (
            (await cache.match(req, { ignoreSearch: true })) ||
            (await cache.match('./index.html')) ||
            (await cache.match('./offline.html')) ||
            Response.error()
          );
        }),
    );
    return;
  }

  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(req);
      const network = fetch(req)
        .then((res) => putInCache(req, res))
        .catch(() => cached || Response.error());
      if (cached) {
        event.waitUntil(network.catch(() => {}));
        return cached;
      }
      return network;
    }),
  );
});
