const CACHE = "safra-v9";
/* عنوان الخادم الوسيط: يجب أن يطابق CONFIG.API_BASE في index.html */
const API = "https://saferah-api.hardwaregypt.workers.dev";
const SHELL = ["./", "index.html", "manifest.json", "logo.png", "favicon.png", "apple-touch-icon.png", "icon-192.png", "icon-512.png"];

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

// إشعار خلفي: الدفعة فارغة، فنسأل الخادم عن الأحداث الجديدة للمباريات المتابَعة
self.addEventListener("push", e => {
  e.waitUntil((async () => {
    let list = [];
    try {
      const sub = await self.registration.pushManager.getSubscription();
      const r = await fetch(API + "/inbox", { method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify({ endpoint: sub.endpoint }) });
      list = await r.json();
    } catch (_) {}
    if (!list.length) list = [{ t: "صافرة", b: "تحديث جديد في مباراة تتابعها", g: "gen" }];
    await Promise.all(list.map(n => self.registration.showNotification(n.t, {
      body: n.b, icon: "icon-192.png", badge: "favicon.png", tag: n.g, dir: "rtl", lang: "ar", data: { url: "./?tab=live" }
    })));
  })());
});

self.addEventListener("notificationclick", e => {
  e.notification.close();
  e.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then(cs =>
    cs.length ? cs[0].focus() : clients.openWindow((e.notification.data && e.notification.data.url) || "./")));
});
