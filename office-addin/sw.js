// 由 scripts/build-office-addin.mjs 生成，请勿手改；源文件：office-addin/src/sw.ts
"use strict";
(() => {
  // office-addin/src/sw.ts
  var CACHE = "paperquay-word-addin-v0.4.0";
  var SHELL = [
    "/taskpane.html",
    "/taskpane.css",
    "/dialog.html",
    "/commands.html",
    "/dist/taskpane.js",
    "/dist/dialog.js",
    "/assets/icon-16.png",
    "/assets/icon-32.png",
    "/assets/icon-80.png"
  ];
  self.addEventListener("install", (event) => {
    event.waitUntil(
      caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
    );
  });
  self.addEventListener("activate", (event) => {
    event.waitUntil(
      caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim())
    );
  });
  self.addEventListener("fetch", (event) => {
    const request = event.request;
    const url = new URL(request.url);
    if (request.method !== "GET" || url.origin !== self.location.origin) return;
    if (url.pathname.startsWith("/api/")) return;
    const isPage = request.mode === "navigate" || url.pathname.endsWith(".html");
    if (isPage) {
      event.respondWith(
        fetch(request).then((response) => {
          const copy = response.clone();
          void caches.open(CACHE).then((cache) => cache.put(url.pathname, copy));
          return response;
        }).catch(() => caches.match(url.pathname).then((cached) => cached || Response.error()))
      );
      return;
    }
    event.respondWith(
      caches.match(url.pathname).then((cached) => {
        const network = fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            void caches.open(CACHE).then((cache) => cache.put(url.pathname, copy));
          }
          return response;
        }).catch(() => cached || Response.error());
        return cached || network;
      })
    );
  });
})();
