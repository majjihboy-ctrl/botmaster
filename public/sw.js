// Minimal service worker - exists mainly to satisfy PWA installability.
// Live trading data must stay fresh, so almost nothing is cached.
// HTML / JS / CSS are never intercepted — only static image/font assets.

const CACHE_NAME = 'botmaster-static-v2';
const STATIC_CACHE_PATTERNS = [/\/icons\//, /\.(?:png|jpg|jpeg|svg|webp|woff2?|ttf)$/];

self.addEventListener('install', event => {
    // Activate updated SW immediately so deploys are not stuck behind an old worker.
    self.skipWaiting();
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches
            .keys()
            .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('message', event => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});

self.addEventListener('fetch', event => {
    const { request } = event;

    if (request.method !== 'GET') return;

    let url;
    try {
        url = new URL(request.url);
    } catch {
        return;
    }
    if (url.origin !== self.location.origin) return;

    // Never cache HTML, JS, CSS, or the service worker itself — always network.
    if (
        url.pathname === '/' ||
        url.pathname === '/index.html' ||
        url.pathname === '/sw.js' ||
        url.pathname.endsWith('.js') ||
        url.pathname.endsWith('.css') ||
        url.pathname.endsWith('.html') ||
        url.pathname.endsWith('.json') ||
        url.pathname.endsWith('.map')
    ) {
        return;
    }

    if (!STATIC_CACHE_PATTERNS.some(pattern => pattern.test(url.pathname))) return;

    event.respondWith(
        caches.open(CACHE_NAME).then(async cache => {
            const cached = await cache.match(request);
            if (cached) return cached;
            try {
                const response = await fetch(request);
                if (response.ok) cache.put(request, response.clone());
                return response;
            } catch (err) {
                if (cached) return cached;
                throw err;
            }
        })
    );
});
