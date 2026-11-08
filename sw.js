/* 앱 셸 캐시 — 오프라인 실행용. 데이터는 캐시하지 않는다(localStorage에만 있음). */
const CACHE = 'fridge-shell-v9';
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
  /* cache:'no-cache' = 브라우저 HTTP 캐시를 믿지 말고 서버에 매번 확인한다.
     GitHub Pages가 max-age=600을 붙여서, 이게 없으면 배포 후 최대 10분 동안
     폰이 옛 app.js·style.css를 그대로 쓴다 (2026-11-08 팬트리 배치 변경이 안 보였던 원인).
     URL로 새로 만드는 이유: 화면 이동(navigate) 요청은 옵션을 붙여 다시 쓰면 오류가 난다. */
  e.respondWith(
    fetch(e.request.url, { cache: 'no-cache', credentials: 'same-origin' })
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('./index.html')))
  );
});
