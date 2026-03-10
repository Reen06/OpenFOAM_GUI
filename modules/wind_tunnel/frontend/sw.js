const CACHE_NAME = 'openfoam-gui-v4';
const STATIC_ASSETS = [
    '/windtunnel/',
    '/windtunnel/static/css/styles.css',
    '/windtunnel/static/js/app.js',
    '/windtunnel/static/js/api.js',
    '/windtunnel/static/js/websocket.js',
    '/windtunnel/manifest.json',
    '/windtunnel/static/icons/icon.svg'
];

// Install event: cache static assets
self.addEventListener('install', (event) => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            // Use addAll but don't let a single failure block installation
            return Promise.allSettled(
                STATIC_ASSETS.map(url => cache.add(url).catch(err => {
                    console.warn('SW: Failed to cache', url, err);
                }))
            );
        })
    );
});

// Activate event: clean up old caches
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cache) => {
                    if (cache !== CACHE_NAME) {
                        return caches.delete(cache);
                    }
                })
            );
        })
    );
    self.clients.claim();
});

// Fetch event: network-first for HTML, cache-first for static, bypass for API
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // Bypass Service Worker entirely for WebSocket and API requests
    if (url.pathname.includes('/api/') || url.pathname.includes('/ws/') || event.request.method !== 'GET') {
        return; 
    }

    event.respondWith(
        caches.match(event.request).then((cachedResponse) => {
            if (cachedResponse) {
                // Return cached version but fetch update in background (Stale-While-Revalidate)
                fetch(event.request).then((networkResponse) => {
                    if (networkResponse && networkResponse.status === 200) {
                        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, networkResponse.clone()));
                    }
                }).catch(() => {});
                return cachedResponse;
            }

            // Fallback to network
            return fetch(event.request).then((networkResponse) => {
                return networkResponse;
            }).catch(() => {
                // If network fails (offline), return cached root
                if (event.request.mode === 'navigate') {
                    return caches.match('/windtunnel/');
                }
            });
        })
    );
});

// Message handler: show notification from the client
// iOS PWAs require notifications via registration.showNotification(),
// not new Notification(). The client sends a message to this SW to trigger it.
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SHOW_NOTIFICATION') {
        const { title, body, icon, tag } = event.data;
        self.registration.showNotification(title, {
            body: body || '',
            icon: icon || '/windtunnel/static/icons/icon.svg',
            tag: tag || 'openfoam-gui',
            badge: '/windtunnel/static/icons/icon.svg'
        });
    }
});

// Notification click: focus the app window
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
            if (clients.length > 0) {
                return clients[0].focus();
            }
            return self.clients.openWindow('/windtunnel/');
        })
    );
});
