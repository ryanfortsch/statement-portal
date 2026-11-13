/**
 * The guest app's service worker: an offline copy of the home guide.
 *
 * The moment the Wi-Fi drops is the moment a guest needs the page that has
 * the router and the text-us line on it, so each guide page the phone has
 * opened is kept and served when the network is not there. Network first,
 * always: a fact fixed on the property page reaches the guest the next time
 * they are online, and the cached copy is only the fallback.
 *
 * A stay link (/h/s/<token>) is kept the same way. Its HTML holds no door
 * code (the code comes from a POST to /h/s/<token>/code, and this worker
 * passes every non-GET straight through), so the offline copy never does.
 *
 * Scope is /h/ (the Service-Worker-Allowed header below), so it never
 * touches a Helm page. It caches Next's hashed static files for the same
 * pages, which are immutable by name.
 */
const SCRIPT = `
const CACHE = 'sca-guest-app-v1';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('sca-guest-app-') && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const isGuide = req.mode === 'navigate' && /^\\/h\\/(?:s\\/[a-f0-9]{32}|[a-f0-9]{16,64})\\/?$/.test(url.pathname);
  const isStatic = url.pathname.startsWith('/helm-assets/_next/static/') || url.pathname.startsWith('/_next/static/') || url.pathname === '/h/app-icon';
  if (isGuide) {
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(url.pathname, copy));
        }
        return res;
      } catch (e) {
        const hit = await caches.match(url.pathname);
        if (hit) return hit;
        throw e;
      }
    })());
    return;
  }
  if (isStatic) {
    event.respondWith((async () => {
      const hit = await caches.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
      }
      return res;
    })());
  }
});
`;

export const dynamic = 'force-static';

export function GET() {
  return new Response(SCRIPT, {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Service-Worker-Allowed': '/h/',
      'Cache-Control': 'no-cache',
    },
  });
}
