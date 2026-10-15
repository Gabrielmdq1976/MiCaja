/* ============================================================
   MiCaja — Service Worker
   Guarda la app en caché para que cargue al instante y
   funcione aunque se corte internet.
   ============================================================ */

const CACHE = 'micaja-v2';

const SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png',
];

/* Instalación: guardar la estructura de la app */
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

/* Activación: limpiar cachés viejas */
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* Estrategia: caché primero, red de respaldo.
   Además, lo que entra de internet (p. ej. Chart.js) se guarda
   para usarlo offline la próxima vez. */
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;

  e.respondWith(
    caches.match(e.request).then((cached) => {
      const fromNet = fetch(e.request)
        .then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, clone));
          }
          return res;
        })
        .catch(() => cached);
      return cached || fromNet;
    })
  );
});
