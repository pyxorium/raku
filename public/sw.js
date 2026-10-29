// Raku's service worker (stage 9, claude/raku-stage9-plan.md). Registered only when Raku runs installed.
//
// One job: when there's no connection, open Raku's own "Raku needs the internet" page instead of the
// browser's error page (S1, B). That page is the only thing it keeps.
//
// The ground rule: it answers only navigations to Raku's own address (opening Raku, a reload, coming back
// from a sign-in), and even those go to the network first, asking for a fresh copy so an installed Raku
// starts on the newest version. Every other request is left alone: no respondWith, so the browser fetches it
// as if there were no worker. Tiles run on the loading server's own addresses, which this worker can't see;
// account servers, Bluesky, plc.directory, appmosphe.re, typeahead, the hide list and Raku's own files and
// version.json pass straight through; relays are WebSockets, which service workers never see.

const CACHE = 'raku-offline-v1';
const OFFLINE = '/offline.html';

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.add(new Request(OFFLINE, { cache: 'reload' }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Older offline pages of Raku's own go; nothing else is touched.
    for (const key of await caches.keys()) if (key.startsWith('raku-') && key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.mode !== 'navigate' || req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    try {
      return await fetch(req, { cache: 'no-cache' });
    } catch {
      const page = await caches.match(OFFLINE, { cacheName: CACHE });
      return page || Response.error();
    }
  })());
});
