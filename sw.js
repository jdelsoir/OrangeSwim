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
  './install.js',
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

// Web Share Target (Android): the manifest posts images shared from other apps here.
// Park the image in its own cache (not orangeswim-*, so activate never wipes it),
// then open the Add form, which picks it up.
const SHARE_INBOX = 'share-inbox';

// Image type from the file's first bytes. Android apps often share without a
// MIME type, which then arrives as application/octet-stream.
function sniffImageType(bytes) {
  const b = new Uint8Array(bytes.slice(0, 12));
  const ascii = (from, to) => String.fromCharCode(...b.slice(from, to));
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg';
  if (b[0] === 0x89 && ascii(1, 4) === 'PNG') return 'image/png';
  if (ascii(0, 3) === 'GIF') return 'image/gif';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  if (ascii(4, 8) === 'ftyp') return 'image/heic';
  return '';
}

async function receiveShare(req) {
  // `status` travels to the app in ?shared=, so a failure on a phone says which step broke.
  let status = 'ok';
  try {
    const form = await req.formData();
    // Any file field counts; the bytes decide whether it is an image.
    const files = [...form.values()].filter((v) => v && typeof v !== 'string');
    if (!files.length) {
      status = `nofile-${[...form.keys()].join('.') || 'none'}`;
    } else {
      status = `type-${files[0].type || 'none'}`;
      for (const file of files) {
        // Read the bytes now: on Android the File is backed by the sharing app's
        // content URI, which may no longer be readable once this request ends.
        const bytes = await file.arrayBuffer();
        const type = /^image\//.test(file.type) ? file.type : sniffImageType(bytes);
        if (!bytes.byteLength || !type) continue;
        const headers = { 'Content-Type': type, 'X-Filename': encodeURIComponent(file.name || 'shared.jpg') };
        const cache = await caches.open(SHARE_INBOX);
        await cache.put('shared-photo', new Response(bytes, { headers }));
        status = 'ok';
        break;
      }
    }
  } catch (e) {
    status = `err-${(e && e.name) || 'unknown'}`;
  }
  const target = new URL('./', self.registration.scope);
  target.searchParams.set('shared', status.slice(0, 60));
  target.hash = 'add';
  return Response.redirect(target.href, 303);
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method === 'POST' && new URL(req.url).pathname.endsWith('/share-target')) {
    event.respondWith(receiveShare(req));
    return;
  }
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
