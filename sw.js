// Service worker: lets the app open offline and load instantly.
// App files are served from the cache and updated in the background ("stale-while-revalidate"),
// so a new version shows up the next time you open the app.
// Requests to the Apps Script API are never cached here — the app keeps its own copy of your data.

const CACHE = 'expense-tracker-v9';
const APP_FILES = [
  './',
  './index.html',
  './css/styles.css',
  './js/app.js',
  './js/calc.js',
  './js/demo.js',
  './js/entry.js',
  './js/ui.js',
  './js/charts.js',
  './js/budgets.js',
  './js/goals.js',
  './js/balance.js',
  './js/cards.js',
  './js/wallets.js',
  './js/payday.js',
  './js/filters.js',
  './fonts/poppins-400.woff2',
  './fonts/poppins-500.woff2',
  './fonts/poppins-600.woff2',
  './fonts/poppins-700.woff2',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(APP_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return; // API calls go straight to the network

  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      // "?demo" and other query strings load the same files
      const cached = await cache.match(event.request, { ignoreSearch: true });
      const network = fetch(event.request)
        .then((response) => {
          if (response.ok) cache.put(event.request, response.clone());
          return response;
        })
        .catch(() => cached);
      if (cached) {
        event.waitUntil(network); // keep the background update alive after we've answered
        return cached;
      }
      return network;
    }),
  );
});
