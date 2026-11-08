/* 앱 셸 캐시 — 오프라인 실행용. 데이터는 캐시하지 않는다(localStorage에만 있음). */
const CACHE = 'fridge-shell-v7';
const SHELL = [
  './', './index.html', './style.css', './data.js', './sync.js', './app.js', './menu.js', './manifest.json',
  './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* network-first: 배포로 갱신하면 바로 반영되고, 오프라인이면 캐시로 뜬다 */
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  // 시트 동기화(script.google.com) 같은 외부 요청은 건드리지 않는다.
  // 캐시에 남으면 오래된 시트 내용을 계속 돌려주게 된다.
  if (new URL(e.request.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('./index.html')))
  );
});
