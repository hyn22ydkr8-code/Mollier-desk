/* Mollier Desk offline cache. Bump VERSION to force every device to refresh its copy. */
const VERSION = 'mollier-v6';
const CORE = ['./', 'index.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];
const HEAVY = ['coolprop.js', 'coolprop.wasm'];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSION);
    await Promise.all(CORE.map(u => c.add(u).catch(() => { /* skip missing */ })));
    await Promise.all(HEAVY.map(u => c.add(u).catch(() => { /* CoolProp files optional */ })));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VERSION) await caches.delete(k);
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

  /* CoolProp files: cache first (large, rarely change; change VERSION when you replace them). */
  if (same && /coolprop\.(js|wasm)$/.test(url.pathname)) {
    e.respondWith((async () => {
      const c = await caches.open(VERSION);
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

  /* The page itself and other site files: network first (so updates arrive), cache when offline or slow. */
  e.respondWith((async () => {
    const c = await caches.open(VERSION);
    try {
      const r = await Promise.race([fetch(req), timeout(3500)]);
      if (r.ok) c.put(req, r.clone());
      return r;
    } catch (err) {
      const hit = (await c.match(req, { ignoreSearch: true })) || (req.mode === 'navigate' ? await c.match('index.html') || await c.match('./') : null);
      if (hit) return hit;
      return fetch(req);
    }
  })());
});
