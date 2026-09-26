const CACHE_NAME = "redaxa-shell-v6";
const APP_SHELL = ["/", "/index.html", "/dashboard.html", "/github.html", "/manifest.webmanifest", "/outputs/redaxa-mark.svg", "/outputs/redaxa-inter.woff2", "/themes.css", "/dist/themes.js", "/auth.css", "/brand-system.css", "/repository.css", "/dist/dashboard.js", "/dist/auth.js", "/dist/desktop.js", "/dist/pwa.js", "/dist/repository-ui.js", "/dist/repository-report.js"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith('redaxa-shell-') && key !== CACHE_NAME).map((key) => caches.delete(key)))));
  self.clients.claim();
});

// Network-first: the point of the cache is to keep the app usable offline, not to
// let a stale build outlive a rebuild. A cache-first version of this shipped
// earlier and kept serving an old dashboard.js forever, invisibly, until the cache
// was cleared by hand.
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  // Cache only known static shell assets. Account/session responses, reports,
  // authorization headers and URL query data must never enter offline storage.
  if (!APP_SHELL.includes(url.pathname) || url.search || event.request.headers.has('Authorization')) return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) caches.open(CACHE_NAME).then((cache) => cache.put(event.request, response.clone()));
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached ?? Response.error()))
  );
});
