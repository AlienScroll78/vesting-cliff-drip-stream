/**
 * Service Worker — VestingStream
 *
 * Strategy summary:
 *  - install  : cache the app shell (HTML, CSS, JS) from the precache manifest
 *  - activate : delete stale caches from previous SW versions
 *  - fetch    :
 *      • /api/* and Horizon endpoints  → network-first, fall back to cache
 *      • navigation requests           → network-first, fall back to offline.html
 *      • all other assets              → cache-first
 *
 * SW_VERSION is replaced at build time by Vite's define plugin so every
 * production build gets a unique cache key (format: "v<timestamp>").
 */

/* global __SW_VERSION__ */

// ---------------------------------------------------------------------------
// Cache names — keyed by SW version so old caches are pruned on activate
// ---------------------------------------------------------------------------
const VERSION        = typeof __SW_VERSION__ !== 'undefined' ? __SW_VERSION__ : 'dev';
const SHELL_CACHE    = `shell-${VERSION}`;
const RUNTIME_CACHE  = `runtime-${VERSION}`;
const API_CACHE      = `api-${VERSION}`;

// App-shell assets that are pre-cached on install.
// Vite injects hashed filenames; we cache the entry points and let
// the browser follow imports for the rest.
const APP_SHELL = [
  '/',
  '/offline.html',
  '/index.html',
];

// Patterns whose fetch responses are treated with a network-first strategy
const API_PATTERNS = [
  /\/api\//,
  /horizon(?:-testnet)?\.stellar\.org/,
];

// ---------------------------------------------------------------------------
// Install — pre-cache app shell
// ---------------------------------------------------------------------------
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

// ---------------------------------------------------------------------------
// Activate — prune caches from previous versions
// ---------------------------------------------------------------------------
self.addEventListener('activate', (event) => {
  const currentCaches = new Set([SHELL_CACHE, RUNTIME_CACHE, API_CACHE]);

  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => !currentCaches.has(key))
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

// ---------------------------------------------------------------------------
// Fetch — routing logic
// ---------------------------------------------------------------------------
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle http(s) requests; skip chrome-extension etc.
  if (!url.protocol.startsWith('http')) return;

  // ── API / Horizon: network-first → cache fallback ───────────────────────
  if (API_PATTERNS.some((p) => p.test(request.url))) {
    event.respondWith(networkFirstApi(request));
    return;
  }

  // ── Navigation: network-first → offline.html fallback ───────────────────
  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigate(request));
    return;
  }

  // ── Static assets: cache-first → network fallback ───────────────────────
  event.respondWith(cacheFirst(request));
});

// ---------------------------------------------------------------------------
// Strategy helpers
// ---------------------------------------------------------------------------

/**
 * Network-first for API calls.
 * On success the response is cloned into the API cache.
 * On network failure a cached copy (if any) is returned.
 */
async function networkFirstApi(request) {
  const cache = await caches.open(API_CACHE);
  try {
    const networkResponse = await fetch(request.clone());
    if (networkResponse.ok) {
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch {
    const cached = await cache.match(request);
    return cached ?? new Response(
      JSON.stringify({ error: 'offline', message: 'No cached data available.' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

/**
 * Network-first for page navigations.
 * Falls back to /offline.html when the network is completely unavailable.
 */
async function networkFirstNavigate(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const networkResponse = await fetch(request);
    cache.put(request, networkResponse.clone());
    return networkResponse;
  } catch {
    // Try the cached version of this exact URL first
    const cachedPage = await cache.match(request);
    if (cachedPage) return cachedPage;

    // Fall back to cached offline page
    const offlinePage = await cache.match('/offline.html');
    return offlinePage ?? new Response('Offline', { status: 503 });
  }
}

/**
 * Cache-first for static assets (JS, CSS, images, fonts).
 * Falls back to the network and stores successful responses in the runtime cache.
 */
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  const cache = await caches.open(RUNTIME_CACHE);
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch {
    return new Response('Asset unavailable offline', { status: 503 });
  }
}
