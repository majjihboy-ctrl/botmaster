// Minimal service worker - exists mainly to satisfy PWA installability
// criteria (Chrome/Edge require an active fetch handler to show the
// install prompt). Deliberately conservative: this is a live trading site
// where WebSocket ticks and account/balance data must always be fresh, so
// almost nothing is cached. Only genuinely static, versioned-by-filename
// assets (icons, fonts) are cached; everything else always goes to the
// network untouched.

const CACHE_NAME = 'botmaster-static-v1';
const STATIC_CACHE_PATTERNS = [/\/icons\//, /\.(?:png|jpg|jpeg|svg|webp|woff2?|ttf)$/];

self.addEventListener('install', event => {
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

self.addEventListener('fetch', event => {
    const { request } = event;

    // Only ever handle simple same-origin GETs for static assets. Everything
    // else (HTML, JS/CSS bundles, WebSocket upgrades, any API-style call,
    // cross-origin requests to Deriv's domains) passes straight through to
    // the network exactly as if no service worker existed.
    if (request.method !== 'GET') return;

    let url;
    try {
        url = new URL(request.url);
    } catch {
        return;
    }
    if (url.origin !== self.location.origin) return;
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
