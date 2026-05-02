var CACHE_NAME = 'encaixes-v1';
var urlsToCache = [
    './',
    './index.html',
    './manifest.json',
    'https://cdn.sheetjs.com/xlsx-0.20.0/package/dist/xlsx.full.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'
];

// Instalar
self.addEventListener('install', function(event) {
    event.waitUntil(
        caches.open(CACHE_NAME).then(function(cache) {
            console.log('Cache aberto');
            return cache.addAll(urlsToCache);
        })
    );
    self.skipWaiting();
});

// Ativar
self.addEventListener('activate', function(event) {
    event.waitUntil(
        caches.keys().then(function(cacheNames) {
            return Promise.all(
                cacheNames.map(function(cacheName) {
                    if (cacheName !== CACHE_NAME) {
                        console.log('Cache antigo removido:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
    self.clients.claim();
});

// Fetch - Network first, fallback to cache
self.addEventListener('fetch', function(event) {
    event.respondWith(
        fetch(event.request)
            .then(function(response) {
                // Se conseguiu da rede, salva no cache
                if (response.status === 200) {
                    var responseClone = response.clone();
                    caches.open(CACHE_NAME).then(function(cache) {
                        cache.put(event.request, responseClone);
                    });
                }
                return response;
            })
            .catch(function() {
                // Se falhou a rede, busca no cache
                return caches.match(event.request).then(function(response) {
                    return response || new Response('Offline', {
                        status: 503,
                        statusText: 'Offline'
                    });
                });
            })
    );
});