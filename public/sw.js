const CACHE_NAME = 'rcellfest-app-v1';

self.addEventListener('install', (event) => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(clients.claim());
});

self.addEventListener('fetch', (event) => {
    // Biarkan semua request berjalan normal, fokus kita hanya agar web bisa diinstal
    event.respondWith(fetch(event.request));
});
