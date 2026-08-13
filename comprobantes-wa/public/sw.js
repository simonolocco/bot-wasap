const CACHE_NAME = 'comprobantes-wa-shell-v2';
const APP_SHELL = ['/', '/styles.css', '/app.js', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];

// The UI shell is cached, but data and documents always require the live server.
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  if (request.url.includes('/api/') || request.url.includes('/media/')) return;
  event.respondWith(fetch(request).catch(() => caches.match(request).then(cached => cached || caches.match('/'))));
});
