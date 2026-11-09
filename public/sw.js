/* HP Fisioterapia — service worker (PWA dos portais do paciente e do fisio).
 * Regras de segurança e de frescor:
 *  - nunca guarda respostas de API, de autenticação nem de outra origem (dado de saúde não fica em cache do aparelho);
 *  - navegação: rede primeiro (o app novo sempre vence); se estiver sem rede, abre a página-casca já guardada;
 *  - arquivos /assets/ têm nome com hash: cache primeiro é seguro.
 * Notificações push: exibe o que o servidor enviar (título e texto) e abre o endereço informado. O ENVIO depende do servidor (ainda não configurado). */
const VERSION = "hp-pwa-v1";
const SHELL = "/";
const PRECACHE = [SHELL, "/icons/icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;                       // Supabase, Google etc.: sempre direto, nada em cache
  if (url.pathname.startsWith("/.netlify/") || url.pathname === "/version.json") return;

  if (req.mode === "navigate") {
    event.respondWith(fetch(req).catch(() => caches.match(SHELL).then((r) => r || Response.error())));
    return;
  }
  if (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(caches.open(VERSION).then(async (c) => {
      const hit = await c.match(req); if (hit) return hit;
      const res = await fetch(req); if (res.ok) c.put(req, res.clone()); return res;
    }));
  }
});

self.addEventListener("push", (event) => {
  let d = {}; try { d = event.data ? event.data.json() : {}; } catch { d = { title: "HP Fisioterapia", body: event.data ? event.data.text() : "" }; }
  event.waitUntil(self.registration.showNotification(d.title || "HP Fisioterapia", { body: d.body || "", icon: "/icons/icon-192.png", badge: "/icons/icon-192.png", data: { url: d.url || "/app" }, tag: d.tag || undefined }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const to = (event.notification.data && event.notification.data.url) || "/app";
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    for (const c of list) { if ("focus" in c) { c.navigate(to); return c.focus(); } }
    return self.clients.openWindow(to);
  }));
});
