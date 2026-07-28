var CACHE_NAME = 'encaixes-v14'; // Subir este número a cada publicação força a atualização

var urlsToCache = [
    './',
    './index.html',
    './manifest.json',
    './icon-192.png',
    './icon-512.png'
];

// Instala e faz cache de forma RESILIENTE (não quebra se faltar um arquivo)
self.addEventListener('install', function(event) {
    event.waitUntil(
        caches.open(CACHE_NAME).then(function(cache) {
            // Tentamos baixar cada arquivo individualmente. 
            // Se um falhar, os outros ainda são salvos e o SW funciona!
            return Promise.all(
                urlsToCache.map(function(url) {
                    return cache.add(url).catch(function(error) {
                        console.warn('Aviso: Falha ao cachear o arquivo (' + url + '). Verifique se ele existe no servidor.', error);
                    });
                })
            );
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

    // NÃO intercepta Firebase, Google APIs, CDNs externos
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
        return;
    }

    // O HTML (a "casca" do app) usa NETWORK FIRST.
    // Com cache-first o celular continuava rodando a versão antiga mesmo depois
    // de publicar uma nova — só atualizava se alguém trocasse o CACHE_NAME.
    // Agora ele sempre tenta baixar a versão nova; o cache vira só o plano B
    // para quando estiver sem internet.
    var isHTML =
        event.request.mode === 'navigate' ||
        url.indexOf('index.html') > -1 ||
        url.indexOf('historico.html') > -1 ||
        url.endsWith('/');

    if (isHTML) {
        event.respondWith(
            fetch(event.request).then(function(fetchResponse) {
                if (fetchResponse && fetchResponse.status === 200) {
                    var clone = fetchResponse.clone();
                    caches.open(CACHE_NAME).then(function(cache) {
                        cache.put(event.request, clone);
                    });
                }
                return fetchResponse;
            }).catch(function() {
                // Sem internet: usa a última versão salva
                return caches.match(event.request).then(function(r) {
                    return r || caches.match('./index.html');
                });
            })
        );
        return;
    }

    // Demais arquivos locais (ícones, manifest): cache first
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
