/* Mollier Desk offline cache. Bump VERSION when index.html changes; CoolProp has its own cache (CP_CACHE below). */
const VERSION = 'mollier-v13';
const CORE = ['./', 'index.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];
const HEAVY = ['coolprop.js', 'coolprop.wasm'];
/* CoolProp (about 9 MB) lives in its own cache, so a page update does not download it again.
   Change CP_CACHE only when you replace coolprop.js / coolprop.wasm. */
const CP_CACHE = 'mollier-coolprop-1';

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSION);
    await Promise.all(CORE.map(u => c.add(new Request(u, { cache: 'reload' })).catch(() => { /* skip missing */ })));   /* bypass the browser's own HTTP cache */
    const cp = await caches.open(CP_CACHE);
    await Promise.all(HEAVY.map(async u => { if (!(await cp.match(u))) await cp.add(u).catch(() => { /* CoolProp files optional */ }); }));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VERSION && k !== CP_CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

const timeout = (ms) => new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms));

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const same = url.origin === self.location.origin;
  const isFont = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (!same && !isFont) return;

  /* CoolProp files: cache first (large, rarely change; change CP_CACHE when you replace them). */
  if (same && /coolprop\.(js|wasm)$/.test(url.pathname)) {
    e.respondWith((async () => {
      const c = await caches.open(CP_CACHE);
      const hit = await c.match(req, { ignoreSearch: true });
      if (hit) return hit;
      const r = await fetch(req);
      if (r.ok) c.put(req, r.clone());
      return r;
    })());
    return;
  }

  /* Fonts: show the cached copy at once, refresh in the background. */
  if (isFont) {
    e.respondWith((async () => {
      const c = await caches.open(VERSION);
      const hit = await c.match(req);
      const net = fetch(req).then(r => { if (r.ok || r.type === 'opaque') c.put(req, r.clone()); return r; }).catch(() => null);
      return hit || (await net) || Response.error();
    })());
    return;
  }

  /* The page itself and other site files: network first (so updates arrive), cached copy when offline or slow.
     A network reply that arrives after the cached copy was shown is still saved, so the next launch is up to date. */
  e.respondWith((async () => {
    const c = await caches.open(VERSION);
    const net = (req.mode === 'navigate' ? fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' }) : fetch(req, { cache: 'no-cache' }))
      .then(r => { if (r.ok) c.put(req, r.clone()); return r; });
    e.waitUntil(net.then(() => {}, () => {}));
    try {
      return await Promise.race([net, timeout(3500)]);
    } catch (err) {
      const hit = (await c.match(req, { ignoreSearch: true })) || (req.mode === 'navigate' ? await c.match('index.html') || await c.match('./') : null);
      if (hit) return hit;
      return net;
    }
  })());
});
