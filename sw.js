// Offline support: precache the whole game, serve cache-first, refresh in the background.
const VERSION = 'oth-v1';
const FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './js/main.js',
  './js/game.js',
  './js/render.js',
  './js/sprites.js',
  './js/sim.js',
  './js/plan.js',
  './js/level.js',
  './js/levels.js',
  './js/geom.js',
  './js/fx.js',
  './js/audio.js',
  './js/save.js',
  './js/backdrop.js',
  './js/brief-art.js',
  './assets/fonts/big-shoulders-display.woff2',
  './assets/fonts/barlow-sc-500.woff2',
  './assets/fonts/barlow-sc-600.woff2',
  './assets/fonts/barlow-sc-700.woff2',
  './assets/fonts/special-elite.woff2',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/icon-maskable-512.png',
  './assets/icons/apple-touch-icon.png',
  './assets/icons/favicon-32.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    caches.open(VERSION).then(async (cache) => {
      const key = req.mode === 'navigate' ? './index.html' : req;
      const hit = await cache.match(key, { ignoreSearch: req.mode === 'navigate' });
      const fresh = fetch(req).then((res) => {
        if (res && res.ok && res.type === 'basic') cache.put(req.mode === 'navigate' ? './index.html' : req, res.clone());
        return res;
      }).catch(() => null);
      if (hit) { e.waitUntil(fresh); return hit; }
      return (await fresh) || new Response('Offline', { status: 503 });
    }),
  );
});
