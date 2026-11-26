/*
 * Service worker de Maquinaria Oroite.
 *
 * - Guarda la página y los íconos en el celular para que la app abra SIN señal.
 * - Estrategia: se muestra al instante lo guardado y, si hay señal, se baja la versión nueva
 *   en segundo plano. Si cambió, avisa a la app para que ofrezca "Actualizar".
 * - NUNCA toca los pedidos a Google (otro origen): los envíos de registros van directo.
 *
 * Todas las rutas son RELATIVAS a este archivo, así funciona igual en
 * https://usuario.github.io/maquinaria-oroite/ (subdirectorio) que en la raíz de un dominio.
 * El alcance (scope) es la carpeta donde está este archivo.
 *
 * Para publicar una versión nueva: cambiar VERSION (así se renueva lo guardado en los celulares).
 */
'use strict';

const VERSION = 'v0.4.1';
const CACHE = 'oroite-' + VERSION;
const PAGINA = './index.html';
const ARCHIVOS = [
  './',
  PAGINA,
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', evento => {
  evento.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // "reload": saltea la memoria del navegador y baja lo último del servidor
    await Promise.all(ARCHIVOS.map(async url => {
      const resp = await fetch(new Request(url, { cache: 'reload' }));
      if (!resp.ok) throw new Error('No se pudo guardar ' + url + ' (' + resp.status + ')');
      await cache.put(url, resp);
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', evento => {
  evento.waitUntil((async () => {
    const nombres = await caches.keys();
    await Promise.all(nombres.filter(n => n.indexOf('oroite-') === 0 && n !== CACHE).map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', evento => {
  const pedido = evento.request;
  if (pedido.method !== 'GET') return;
  const url = new URL(pedido.url);
  if (url.origin !== self.location.origin) return;          // Google Apps Script y cualquier otro sitio: no se toca
  evento.respondWith(responder(evento, pedido));
});

async function responder(evento, pedido) {
  const cache = await caches.open(CACHE);
  const esPagina = pedido.mode === 'navigate';
  // Toda navegación dentro del alcance muestra la app (es de una sola página)
  const guardado = esPagina ? await cache.match(PAGINA) : await cache.match(pedido, { ignoreSearch: true });

  if (guardado) {
    evento.waitUntil(actualizar(cache, esPagina ? PAGINA : pedido, esPagina));
    return guardado;
  }
  try {
    return await fetch(pedido);
  } catch (e) {
    if (esPagina) { const p = await cache.match(PAGINA); if (p) return p; }
    return Response.error();
  }
}

/** Baja la versión nueva en segundo plano. Si la página cambió, avisa a la app. */
async function actualizar(cache, destino, esPagina) {
  try {
    const resp = await fetch(destino instanceof Request ? destino : new Request(destino, { cache: 'reload' }));
    if (!resp || !resp.ok || resp.type !== 'basic') return;
    if (esPagina) {
      // La copia guardada se vuelve a leer del caché: la que se le entregó a la página ya la consumió el navegador
      const previo = await cache.match(PAGINA);
      const [textoNuevo, textoViejo] = await Promise.all([resp.clone().text(), previo ? previo.text() : Promise.resolve('')]);
      await cache.put(PAGINA, resp.clone());
      await cache.put('./', resp.clone());
      if (textoNuevo !== textoViejo) {
        const clientes = await self.clients.matchAll({ type: 'window' });
        clientes.forEach(c => c.postMessage({ tipo: 'version-nueva' }));
      }
    } else if (ARCHIVOS.some(a => new URL(a, self.location.href).href === new URL(resp.url).href)) {
      await cache.put(destino, resp.clone());
    }
  } catch (e) {
    /* sin señal: se sigue con lo guardado */
  }
}
