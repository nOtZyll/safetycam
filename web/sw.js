// Service worker: the site opens without internet after the first visit, and the 19 MB model
// plus the 22 MB onnxruntime files are downloaded once instead of on every visit.
//
// Page files (HTML, CSS, JS, JSON) are network-first, so edits show up as soon as you are online.
// Heavy files (model, runtime, fonts, images) are cache-first. VERSION carries a hash of
// model/best.onnx and is rewritten by training/export.py, so a new model replaces the cached one.
// After replacing files in vendor/ by hand, change VERSION yourself.
const VERSION = 'model-0586f64ebb';
const CACHE = `safetycam-${VERSION}`;

// Files needed to open the page offline (about 1 MB with the images). The model and runtime
// are cached the first time they load, which the page starts as soon as the demo is near.
const SHELL = [
  './',
  'index.html',
  'manifest.json',
  'css/fonts.css',
  'css/style.css',
  'js/app.js',
  'js/compliance.js',
  'js/detector.js',
  'js/draw.js',
  'js/labels.js',
  'js/postprocess.js',
  'js/store.js',
  'js/tracker.js',
  'model/classes.json',
  'model/thresholds.json',
  'model/worker_rules.json',
  'model/metrics.json',
  'vendor/ort/ort.webgpu.min.js',
  // images, so samples and lazy-loaded sections work offline even if never scrolled to
  'assets/besi-beton.jpg',
  'assets/gerbang-proyek.jpg',
  'assets/helm-rompi.jpg',
  'assets/lapangan.jpg',
  'assets/pekerja-bata.jpg',
  'assets/pekerja-proyek.jpg',
  'assets/pekerja-rompi.jpg',
  'assets/logos/ftmm.webp',
  'assets/logos/iris.webp',
  'assets/logos/unair.webp',
  'assets/icons/icon-192.png',
  'assets/icons/icon-512.png',
  'assets/icons/maskable-512.png',
];
const HEAVY = /\.(onnx|wasm|mjs|woff2|jpe?g|png|webp)$/;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('safetycam-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) cache.put(request, res.clone());
  return res;
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    // no-cache: always revalidate with the server (a cheap 304 when unchanged). Without it the
    // HTTP cache may hand back an old draw.js next to a new app.js and the modules don't match.
    const res = await fetch(request, { cache: 'no-cache' });
    if (res.ok) cache.put(request, res.clone());
    return res;
  } catch (err) {
    // ignoreSearch so "/?v=2" still finds the cached page
    const hit = await cache.match(request, { ignoreSearch: request.mode === 'navigate' });
    if (hit) return hit;
    throw err;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  event.respondWith(HEAVY.test(url.pathname) ? cacheFirst(request) : networkFirst(request));
});
