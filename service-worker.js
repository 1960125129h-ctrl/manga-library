const CACHE_VERSION = "manga-library-v2-20261021b";  // 改前端后一定要升这里: /src/* 走 stale-while-revalidate, 不升版本第一刷还是旧文件
const APP_PREFIX = "/src/";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(["/"]))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

function isSameOriginGet(request) {
  try {
    const url = new URL(request.url);
    return request.method === "GET" && url.origin === self.location.origin;
  } catch (e) {
    return false;
  }
}

function networkFirst(request) {
  return fetch(request)
    .then((response) => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
      }
      return response;
    })
    .catch(() => caches.match(request));
}

function staleWhileRevalidate(request) {
  return caches.match(request).then((cached) => {
    const network = fetch(request).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
      }
      return response;
    }).catch(() => cached);
    return cached || network;
  });
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (!isSameOriginGet(request)) return;
  const url = new URL(request.url);

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request).then((r) => r || caches.match("/src/index.html")));
    return;
  }

  if (url.pathname.startsWith(APP_PREFIX) || url.pathname.startsWith("/icons/")) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  if (url.pathname === "/_manifest.json" || url.pathname.startsWith("/_thumbs/") || url.pathname.startsWith("/漫画/")) {
    event.respondWith(networkFirst(request));
  }
});
