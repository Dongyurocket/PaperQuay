/**
 * 加载项离线壳 Service Worker（渐进增强；只在支持 SW 的内核里运行，不需要 ES5）。
 *
 *  - 预缓存加载项自己的页面与脚本；HTML 走网络优先（升级后立即用新版本），网络失败才回退缓存；
 *  - 静态资源走缓存优先 + 后台更新；
 *  - **永不缓存 /api/***（数据必须实时）；也不缓存 CDN 上的 office.js（离线场景是 PaperQuay 没开，不是断网）。
 */
/// <reference lib="webworker" />
export {};

declare const self: ServiceWorkerGlobalScope;

const CACHE = 'paperquay-word-addin-v0.4.0';
const SHELL = [
  '/taskpane.html',
  '/taskpane.css',
  '/dialog.html',
  '/commands.html',
  '/dist/taskpane.js',
  '/dist/dialog.js',
  '/assets/icon-16.png',
  '/assets/icon-32.png',
  '/assets/icon-80.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  const isPage = request.mode === 'navigate' || url.pathname.endsWith('.html');
  if (isPage) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          void caches.open(CACHE).then((cache) => cache.put(url.pathname, copy));
          return response;
        })
        .catch(() => caches.match(url.pathname).then((cached) => cached || Response.error())),
    );
    return;
  }

  event.respondWith(
    caches.match(url.pathname).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            void caches.open(CACHE).then((cache) => cache.put(url.pathname, copy));
          }
          return response;
        })
        .catch(() => cached || Response.error());
      return cached || network;
    }),
  );
});
