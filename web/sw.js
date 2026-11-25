/* Lex Calendário (versão web) — funciona sem internet depois da primeira abertura. */
const VERSION = "__VERSION__";
const BASE = "__BASE__";
const FILES = __FILES__;
const CACHE = `lex-web-${VERSION}`;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then(async (cache) => {
      // Um arquivo que falhe não impede a instalação: ele entra no cache na primeira vez que for usado
      await Promise.all(FILES.map((f) => cache.add(new Request(BASE + f, { cache: "reload" })).catch(() => undefined)));
      await self.skipWaiting();
    }),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("lex-web-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || !url.pathname.startsWith(BASE)) return;

  // Páginas: tenta a versão mais nova; sem internet, usa a guardada
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok) void caches.open(CACHE).then((c) => c.put(url.pathname, res.clone()));
          return res.ok ? res : caches.match(url.pathname, { ignoreSearch: true }).then((hit) => hit ?? res);
        })
        .catch(() => caches.match(url.pathname, { ignoreSearch: true }).then((hit) => hit ?? caches.match(`${BASE}/calendario/`))),
    );
    return;
  }

  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then(
      (hit) =>
        hit ??
        fetch(request).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            void caches.open(CACHE).then((c) => c.put(request, copy));
          }
          return res;
        }),
    ),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow(`${BASE}/calendario/`));
});
