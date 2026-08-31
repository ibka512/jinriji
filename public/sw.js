const CACHE_NAME = "jinriji-v0.9.0";
const BUILD_ASSETS = [];
const APP_SHELL = [
  "./", "./index.html", "./manifest.webmanifest", "./favicon.ico",
  "./icons/favicon-16.png", "./icons/favicon-32.png", "./icons/favicon-48.png",
  "./icons/apple-touch-icon.png", "./icons/app-192.png", "./icons/app-512.png",
  "./fonts/noto-serif-sc/noto-serif-sc.css", ...BUILD_ASSETS,
  "./third-party-licenses.txt",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith("jinriji-") && key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || new URL(event.request.url).origin !== self.location.origin) return;

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).then((response) => {
        const copy = response.clone();
        event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put("./index.html", copy)));
        return response;
      }).catch(async () => (await caches.match("./index.html")) || Response.error())
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)));
        }
        return response;
      });
    })
  );
});
