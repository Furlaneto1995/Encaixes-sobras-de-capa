var CACHE_NAME = 'encaixes-v3';
var urlsToCache = [
    './',
    './index.html',
    './manifest.json',
    './icon-192.png'
];

// Instala e faz cache dos arquivos estáticos
self.addEventListener('install', function(event) {
    event.waitUntil(
        caches.open(CACHE_NAME).then(function(cache) {
            return cache.addAll(urlsToCache);
        })
    );
    self.skipWaiting();
});

// Ativa e limpa caches antigos
self.addEventListener('activate', function(event) {
    event.waitUntil(
        caches.keys().then(function(cacheNames) {
            return Promise.all(
                cacheNames.filter(function(name) {
                    return name !== CACHE_NAME;
                }).map(function(name) {
                    return caches.delete(name);
                })
            );
        })
    );
    self.clients.claim();
});

// Intercepta requisições
self.addEventListener('fetch', function(event) {
    var url = event.request.url;

    // ✅ NÃO intercepta Firebase, Google APIs, CDNs externos
    if (
        url.indexOf('firestore.googleapis.com') > -1 ||
        url.indexOf('firebase') > -1 ||
        url.indexOf('googleapis.com') > -1 ||
        url.indexOf('gstatic.com') > -1 ||
        url.indexOf('cdnjs.cloudflare.com') > -1 ||
        url.indexOf('cdn.sheetjs.com') > -1 ||
        url.indexOf('unpkg.com') > -1 ||
        event.request.method !== 'GET'
    ) {
        return; // deixa passar sem cache
    }

    // Para arquivos locais: cache first
    event.respondWith(
        caches.match(event.request).then(function(response) {
            if (response) return response;
            return fetch(event.request).then(function(fetchResponse) {
                if (!fetchResponse || fetchResponse.status !== 200) {
                    return fetchResponse;
                }
                var responseClone = fetchResponse.clone();
                caches.open(CACHE_NAME).then(function(cache) {
                    cache.put(event.request, responseClone);
                });
                return fetchResponse;
            });
        })
    );
});
