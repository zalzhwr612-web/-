/* ═══════════════════════════════════════════════════
   Service Worker — إشعارات الرسائل والمكالمات
   لازم يكون بجذر الموقع (نفس مكان index.html)
   ═══════════════════════════════════════════════════ */
const SW_VER = 'ha-sw-v1';

self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

/* ───── وصول إشعار من السيرفر ───── */
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { body: (e.data && e.data.text()) || '' }; }

  const isCall = d.type === 'call';
  const title = d.title || (isCall ? 'مكالمة واردة' : 'رسالة جديدة');

  const opts = {
    body: d.body || '',
    icon: d.icon || './icon-192.png',
    badge: './icon-192.png',
    dir: 'rtl',
    lang: 'ar',
    tag: isCall ? 'call-' + (d.callId || 'x') : 'msg-' + (d.conv || 'x'),
    renotify: true,
    requireInteraction: isCall,          /* إشعار المكالمة يبقى لحد ما تتفاعل */
    silent: false,
    vibrate: isCall ? [500, 250, 500, 250, 500, 250, 500] : [200, 100, 200],
    timestamp: Date.now(),
    data: d,
    actions: isCall
      ? [{ action: 'answer', title: '✅ رد' }, { action: 'decline', title: '❌ رفض' }]
      : [{ action: 'open', title: 'فتح المحادثة' }]
  };

  e.waitUntil(
    self.registration.showNotification(title, opts).then(() => {
      /* إذا الصفحة مفتوحة بالخلفية — نخبرها حتى ترنّ داخل التطبيق */
      return self.clients.matchAll({ type: 'window', includeUncontrolled: true })
        .then(list => list.forEach(c => c.postMessage({ type: 'push', payload: d })));
    })
  );
});

/* ───── ضغط على الإشعار ───── */
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const d = e.notification.data || {};
  const act = e.action;

  /* رفض المكالمة بدون فتح الموقع */
  if (act === 'decline' && d.callId && d.rejectUrl && d.rejectKey) {
    e.waitUntil(fetch(d.rejectUrl, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        apikey: d.rejectKey,
        Authorization: 'Bearer ' + d.rejectKey,
        Prefer: 'return=minimal'
      },
      body: JSON.stringify({ status: 'declined' })
    }).catch(() => {}));
    return;
  }

  const base = new URL('./', self.registration.scope).href;
  let url = base;
  if (d.type === 'call') url = base + '#call=' + (d.callId || '');
  else if (d.conv) url = base + '#chat=' + encodeURIComponent(d.from || '');

  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if ('focus' in c) {
          c.postMessage({ type: 'notif-click', action: act, data: d });
          return c.focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});

self.addEventListener('notificationclose', e => {
  /* مكالمة انصرفت بدون رد — ما نسوي شي، الموقع يتكفّل بالمهلة */
});
const CACHE = "ha-v1";
self.addEventListener("fetch", e => {
  const r = e.request;
  if (r.method !== "GET" || !r.url.startsWith("http")) return;
  e.respondWith(
    fetch(r).then(res => {
      if (res && res.ok && res.type === "basic") {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(r, copy)).catch(()=>{});
      }
      return res;
    }).catch(() => caches.match(r).then(m => m || caches.match("./")))
  );
});
