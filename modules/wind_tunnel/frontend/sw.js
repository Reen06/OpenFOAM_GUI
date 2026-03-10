// Minimal service worker — satisfies Chrome's PWA install requirement.
// Network-first: always fetch from server, no caching.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
    // Pass everything through to the network (no caching)
    event.respondWith(fetch(event.request));
});

// Handle notification messages from the app
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SHOW_NOTIFICATION') {
        self.registration.showNotification(event.data.title, {
            body: event.data.body || '',
            icon: event.data.icon || '/windtunnel/static/icons/icon.svg',
            tag: event.data.tag || 'openfoam-gui',
        });
    }
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    event.waitUntil(
        self.clients.matchAll({ type: 'window' }).then((clients) => {
            if (clients.length > 0) return clients[0].focus();
            return self.clients.openWindow('/windtunnel/');
        })
    );
});
