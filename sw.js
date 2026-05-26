// ── Quran Reader Service Worker ──────────────────────────────────────────
// Strategy:
//   • App shell (HTML, manifest, icons) → Cache-first, network fallback
//   • Surah JSON files (data/*.json)    → Cache-first, network fallback
//   • Everything else                  → Network-first, cache fallback

const VERSION    = 'v1';
const SHELL_CACHE = `quran-shell-${VERSION}`;
const DATA_CACHE  = `quran-data-${VERSION}`;

// Files that must be cached immediately on install
const SHELL_FILES = [
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

// ── Install: pre-cache the app shell ─────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(cache => {
      return cache.addAll(SHELL_FILES);
    }).then(() => self.skipWaiting())
  );
});

// ── Activate: delete old caches ───────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== SHELL_CACHE && k !== DATA_CACHE)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: serve from cache, fall back to network ─────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle same-origin GET requests
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  // Surah JSON data → Cache-first, then network + cache for next time
  if (url.pathname.includes('/data/') && url.pathname.endsWith('.json')) {
    event.respondWith(cacheFirst(request, DATA_CACHE));
    return;
  }

  // App shell → Cache-first
  if (
    url.pathname.endsWith('.html') ||
    url.pathname.endsWith('.json') ||    // manifest
    url.pathname.endsWith('.png')  ||
    url.pathname === '/'
  ) {
    event.respondWith(cacheFirst(request, SHELL_CACHE));
    return;
  }

  // External fonts (Google Fonts) → Network-first, cache fallback
  if (url.hostname.includes('fonts.')) {
    event.respondWith(networkFirst(request, SHELL_CACHE));
    return;
  }
});

// ── Helpers ────────────────────────────────────────────────────────────────
async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    // Offline and not in cache — return a friendly offline page for HTML
    if (request.destination === 'document') {
      const fallback = await caches.match('./index.html');
      if (fallback) return fallback;
    }
    return new Response('Offline', { status: 503 });
  }
}

async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    return cached || new Response('Offline', { status: 503 });
  }
}