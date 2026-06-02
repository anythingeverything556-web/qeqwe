// ══════════════════════════════════════════════════════════════════════
// CHATGBT Audio Cache Service Worker — Feature 31
// Strategy: Cache-first for sounds, network-first for TTS API
// Cache versioning: Updates clear old caches automatically
// Reports cache count to app via postMessage
// ══════════════════════════════════════════════════════════════════════

const CACHE_VERSION = 2;
const CACHE_NAME = `chatgbt-audio-cache-v${CACHE_VERSION}`;
const APP_SHELL_CACHE = `chatgbt-shell-v${CACHE_VERSION}`;
const MAX_CACHE_SIZE = 150;

// Audio file extensions to cache
const AUDIO_EXTENSIONS = ['.mp3', '.wav', '.ogg', '.flac', '.webm'];

// App shell resources to pre-cache on install
const APP_SHELL = [
  '/',
  '/index.html',
];

function isAudioRequest(url) {
  const path = new URL(url).pathname.toLowerCase();
  return AUDIO_EXTENSIONS.some(ext => path.endsWith(ext));
}

function isSoundProxyRequest(url) {
  const u = new URL(url);
  return u.pathname.includes('/api/sound-proxy');
}

function isTTSApiRequest(url) {
  const u = new URL(url);
  return u.pathname.includes('/api/tts') || u.pathname.includes('/api/speak');
}

function isAudioContentType(headers) {
  const ct = headers.get('content-type') || '';
  return ct.startsWith('audio/') || ct.includes('mpeg') || ct.includes('wav') || ct.includes('ogg');
}

// LRU eviction: remove oldest entries if cache exceeds limit
async function trimCache() {
  const cache = await caches.open(CACHE_NAME);
  const keys = await cache.keys();
  if (keys.length > MAX_CACHE_SIZE) {
    const deleteCount = keys.length - MAX_CACHE_SIZE;
    for (let i = 0; i < deleteCount; i++) {
      await cache.delete(keys[i]);
    }
  }
}

// Report cache count to all clients
async function reportCacheCount() {
  const cache = await caches.open(CACHE_NAME);
  const keys = await cache.keys();
  const count = keys.length;
  const clients = await self.clients.matchAll();
  clients.forEach(client => {
    client.postMessage({ type: 'CACHE_COUNT', count });
  });
}

// Install: pre-cache app shell, then activate immediately
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_SHELL_CACHE).then((cache) => {
      return cache.addAll(APP_SHELL).catch(() => {
        // Non-critical: some resources may not be available offline
      });
    }).then(() => self.skipWaiting())
  );
});

// Activate: clean up old caches, then claim clients and report count
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((name) => name !== CACHE_NAME && name !== APP_SHELL_CACHE)
          .map((name) => caches.delete(name))
      )
    ).then(() => self.clients.claim())
      .then(() => reportCacheCount())
  );
});

// Listen for messages from the app
self.addEventListener('message', (event) => {
  if (event.data?.type === 'REQUEST_CACHE_COUNT') {
    reportCacheCount();
  }
});

// Fetch: cache-first for audio, network-first for TTS API, pass-through for everything else
self.addEventListener('fetch', (event) => {
  const url = event.request.url;

  // Cache-first for audio files and sound proxy
  if (isAudioRequest(url) || isSoundProxyRequest(url)) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(event.request);
        if (cached) {
          // Update cache in background (stale-while-revalidate)
          fetch(event.request).then((response) => {
            if (response && response.ok) {
              cache.put(event.request, response.clone());
            }
          }).catch(() => {});
          return cached;
        }

        try {
          const response = await fetch(event.request);
          if (response.ok) {
            cache.put(event.request, response.clone());
            trimCache().then(() => reportCacheCount());
          }
          return response;
        } catch (err) {
          return new Response('Network error', { status: 503 });
        }
      })
    );
    return;
  }

  // Network-first for TTS API (audio responses get cached)
  if (isTTSApiRequest(url)) {
    event.respondWith(
      fetch(event.request).then(async (response) => {
        // If the TTS API returns audio, cache it
        if (response.ok && isAudioContentType(response.headers)) {
          const cache = await caches.open(CACHE_NAME);
          cache.put(event.request, response.clone());
          trimCache().then(() => reportCacheCount());
        }
        return response;
      }).catch(async () => {
        // Fallback to cache if offline
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match(event.request);
        return cached || new Response('Network error', { status: 503 });
      })
    );
    return;
  }

  // Network-first for app shell / navigation
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(async () => {
        const cache = await caches.open(APP_SHELL_CACHE);
        return (await cache.match('/index.html')) || new Response('Offline', { status: 503 });
      })
    );
    return;
  }

  // Default: network-first for everything else
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
