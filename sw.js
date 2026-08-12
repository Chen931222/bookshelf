/* 離線快取。速查的搜尋本來就不連網，但沒有這支的話，
   沒訊號時打開只會看到白屏——而「走在路上突然想到」正是最容易沒訊號的場景。

   策略分兩種：
   - 資料檔（books/cards/deep）：先回快取、背景更新（stale-while-revalidate）。
     開得快，而且離線一定有東西；下次進來就是新的。
   - 其他（HTML、封面圖）：先打網路，失敗才回快取。
   兩者都只在成功時才寫快取，避免把 404 頁面存起來。 */
const CACHE = 'shelf-v1';
const CORE = [
  './',
  './index.html',
  './books.json',
  './cards.json',
  './deep/lit-046.json',
  './deep/lit-049.json',
  './deep/money-048.json',
  './deep/money-051.json',
  './deep/money-054.json',
  './deep/money-066.json',
];

self.addEventListener('install', e => {
  // 個別抓，其中一支掛掉不要讓整個安裝失敗
  e.waitUntil(caches.open(CACHE)
    .then(c => Promise.all(CORE.map(u => c.add(u).catch(() => {}))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // 字型等外部資源交給瀏覽器自己處理
  if (url.pathname.startsWith('/api/')) return;      // 問書櫃要即時的，不快取

  const isData = /\.json$/.test(url.pathname);

  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req, { ignoreSearch: true });

    if (isData && hit) {
      // 先給快取，同時背景更新
      e.waitUntil(fetch(req).then(r => { if (r.ok) cache.put(req, r.clone()); }).catch(() => {}));
      return hit;
    }
    try {
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch (_) {
      // 沒網路：有快取就給快取，導覽請求退回首頁（至少不是白屏）
      return hit || (req.mode === 'navigate' ? cache.match('./index.html') : Response.error());
    }
  })());
});
