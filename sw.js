/* Service worker：程式離線可開、看過的地圖圖磚離線可看 */
const VERSION = 'v1.15.1';
const SHELL = 'shell-' + VERSION;
const TILES = 'tiles-v1';
const MAX_TILES = 3000;
const ASSETS = ['./', 'index.html', 'css/app.css', 'js/icons.js', 'js/core.js', 'js/services.js', 'js/sync.js', 'js/mapstyle.js', 'js/ticket.js', 'js/app.js',
  'vendor/leaflet/leaflet.js', 'vendor/leaflet/leaflet.css', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon.svg', 'icons/apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith('shell-') && k !== SHELL).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

async function trimTiles() {
  const c = await caches.open(TILES);
  const keys = await c.keys();
  if (keys.length > MAX_TILES) for (const k of keys.slice(0, keys.length - MAX_TILES)) await c.delete(k);
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // 地圖圖磚：先用快取，背景更新
  if (/tile\.openstreetmap\.org|basemaps\.cartocdn\.com|upload\.wikimedia\.org|tiles\.openfreemap\.org/.test(url.hostname)) {
    e.respondWith(caches.open(TILES).then(async (c) => {
      const hit = await c.match(e.request);
      const net = fetch(e.request).then((r) => { if (r.ok || r.type === 'opaque') { c.put(e.request, r.clone()); trimTiles(); } return r; }).catch(() => hit);
      return hit || net;
    }));
    return;
  }
  // 自己的檔案：網路優先（拿到新版），離線時用快取
  if (url.origin === self.location.origin) {
    // 一律向伺服器確認（cache: 'no-cache'），避免瀏覽器快取讓新版晚 10 分鐘才出現
    e.respondWith(fetch(new Request(url.href, { cache: 'no-cache', credentials: 'same-origin' })).then((r) => {
      if (r.ok) { const cp = r.clone(); caches.open(SHELL).then((c) => c.put(e.request, cp)); }
      return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('index.html'))));
  }
});
