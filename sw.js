const CACHE_NAME = 'nse-rsi-v3';
const ASSETS = [
  '/',
  '/index.html',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  // Only intercept GET requests
  if (e.request.method !== 'GET') {
    return;
  }

  const url = new URL(e.request.url);

  // Bypass API calls entirely - do not cache dynamic backend quotes data!
  if (url.pathname.includes('/api/')) {
    return;
  }

  // Network-First for root/HTML, Cache-First for static fonts/assets
  if (url.pathname === '/' || url.pathname.endsWith('.html')) {
    e.respondWith(
      fetch(e.request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
          return response;
        })
        .catch(() => caches.match(e.request))
    );
  } else {
    // Cache-First fallback for static fonts or static assets
    e.respondWith(
      caches.match(e.request).then((cachedResponse) => {
        return cachedResponse || fetch(e.request).then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
          return response;
        });
      })
    );
  }
});
