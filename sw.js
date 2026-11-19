const CACHE = "safra-v5";
const SHELL = ["./", "index.html", "manifest.json", "logo.png", "favicon.png", "apple-touch-icon.png", "icon-192.png", "icon-512.png"];

// allSettled: غياب أي أيقونة لا يُفشل تثبيت الـ Service Worker
self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.allSettled(SHELL.map(u => c.add(u)))));
  self.skipWaiting();
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
  );
  self.clients.claim();
});

// الشبكة أولاً، ثم النسخة المحفوظة عند انقطاع الإنترنت (لملفات الموقع فقط)
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then(r => { if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); } return r; })
      .catch(() => caches.match(e.request).then(r => r || caches.match("index.html")))
  );
});
