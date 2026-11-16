/**
 * sw.js — Service Worker della PWA "Mini-Foglio di Calcolo".
 * ---------------------------------------------------------------------------
 * Strategie:
 *   - install : precache dell'application shell + di tutti i file prodotti
 *               dal build (l'elenco viene iniettato dal plugin Vite
 *               `sw-precache-manifest` nel momento della build);
 *   - navigate: network-first con fallback sulla shell in cache (cosi' si
 *               vedono subito gli aggiornamenti online, ma l'app resta
 *               utilizzabile offline);
 *   - risorse statiche: cache-first con aggiornamento in background
 *               (stale-while-revalidate).
 *
 * Nota: tutti i percorsi sono RELATIVI allo scope del service worker, cosi'
 * l'app funziona sia in "/" (Vercel) sia in "/<repo>/" (GitHub Pages).
 */

/* eslint-env serviceworker */

const CACHE_NAME = 'mini-sheet-__CACHE_VERSION__';

// L'elenco dei file da mettere in precache viene sostituito al build time.
// In sviluppo (senza build) il placeholder non e' un JSON valido: si
// continua comunque a funzionare, precaricando solo l'application shell.
const PRECACHE_MANIFEST = (() => {
  try {
    const parsed = JSON.parse('__PRECACHE_MANIFEST__');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
})();

const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/favicon.svg',
];

/** Elenco effettivo delle risorse da precaricare. */
function precacheList() {
  const list = [];
  for (const item of CORE_ASSETS) list.push(item);
  if (Array.isArray(PRECACHE_MANIFEST)) {
    for (const item of PRECACHE_MANIFEST) list.push(item);
  }
  return [...new Set(list)];
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const urls = precacheList();
      const failures = [];

      // I file vengono messi in cache uno alla volta: il download parallelo
      // puo' superare il limite di connessioni per host del browser (6 per
      // HTTP/1.1) e i download in coda possono venir interrotti.
      for (const url of urls) {
        try {
          await cache.add(new Request(url, { cache: 'reload' }));
        } catch (error) {
          failures.push({ url, error: String(error) });
        }
      }

      if (failures.length) {
        console.warn('[sw] precache parziale:', failures);
        // traccia diagnostica consultabile dalla pagina (solo in caso di errore)
        await cache.put(
          './__precache-errors',
          new Response(JSON.stringify(failures), {
            headers: { 'Content-Type': 'application/json' },
          })
        );
      }
      // marcatore: la precache e' completata
      await cache.put(
        './__precache-done',
        new Response(new Date().toISOString(), {
          headers: { 'Content-Type': 'text/plain' },
        })
      );
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // risorse esterne: non intercettate

  // --- Navigazioni: network first, fallback offline sullo shell -----------
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        const shell =
          (await cache.match('./index.html')) ||
          (await cache.match('./')) ||
          new Response(
            '<!doctype html><meta charset="utf-8"><title>Offline</title>' +
              '<p style="font-family:system-ui;padding:2rem">Applicazione non disponibile offline.</p>',
            { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
          );
        try {
          const fresh = await fetch(request);
          // Se il server risponde ma con un errore (es. 502 perche' il sito non
          // e' raggiungibile) si preferisce comunque la copia in cache.
          if (fresh && fresh.ok) {
            cache.put('./index.html', fresh.clone());
            return fresh;
          }
        } catch (err) {
          // rete non disponibile: si usa la copia in cache
        }
        return shell;
      })()
    );
    return;
  }

  // --- Altre risorse: cache first + aggiornamento in background ----------
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(request);
      const network = fetch(request)
        .then((response) => {
          if (response && response.status === 200 && response.type === 'basic') {
            cache.put(request, response.clone());
          }
          return response;
        })
        .catch(() => null);
      return cached || (await network) || Response.error();
    })()
  );
});
