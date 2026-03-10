const CACHE_NAME = 'openfoam-landing-v1';

// Install: just activate immediately  
self.addEventListener('install', () => self.skipWaiting());

// Activate: claim clients
self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

// Fetch: network-first, no caching (landing page is lightweight)
self.addEventListener('fetch', (event) => {
    // Don't intercept API, WebSocket, or non-GET requests
    const url = new URL(event.request.url);
    if (url.pathname.includes('/api/') || url.pathname.includes('/ws/') || event.request.method !== 'GET') {
        return;
    }
    // Network-first for everything else
    event.respondWith(
        fetch(event.request).catch(() => caches.match(event.request))
    );
});

// Message handler for notifications
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SHOW_NOTIFICATION') {
        const { title, body, icon, tag } = event.data;
        self.registration.showNotification(title, {
            body: body || '',
            icon: icon || '/windtunnel/static/icons/icon.svg',
            tag: tag || 'openfoam-gui',
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
            return self.clients.openWindow('/');
        })
    );
});
