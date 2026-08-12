/* ══════════════════════════════════════════════════════════════
   sw.js — NΞXA
   ضع هذا الملف بجذر الموقع، جنب index.html بالضبط.

   إذا عندك sw.js من قبل: بدّله بهذا كامل — هذا يشمل كل شي
   (إشعارات الرسائل، إشعارات المكالمات، وزر التحديث).
   ══════════════════════════════════════════════════════════════ */

const SUPABASE_URL  = 'https://gygjpwmcuiqjelmpgxtp.supabase.co';
const SUPABASE_ANON = 'ضع هنا نفس المفتاح العلني الموجود بـ index.html';
/*  ↑ المفتاح العلني بس (اللي يبدي بـ sb_publishable_).
    لا تحط service_role هنا أبداً — هذا الملف ينزل لجهاز أي زائر. */

const APP_NAME = 'NΞXA';
const ICON     = './icon-192.png';
const BADGE    = './badge-96.png';


/* ───── التنصيب: نشتغل فوراً بلا ما ننتظر إغلاق كل التبويبات ───── */
self.addEventListener('install',  () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

/* زر «تحديث» بالتطبيق يحتاج هذا */
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});


/* ───── استقبال الإشعارات ───── */
self.addEventListener('push', event => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) {}

  /* ═══ مكالمة واردة ═══ */
  if (d.type === 'call') {
    event.waitUntil((async () => {
      await self.registration.showNotification(d.title || 'مكالمة واردة', {
        body: d.body || 'مكالمة واردة',
        icon: d.icon || ICON,
        badge: d.badge || BADGE,
        image: d.icon || ICON,
        tag: 'call-' + d.callId,       /* نفس الوسم = ما يتكرر الإشعار */
        renotify: true,
        requireInteraction: true,      /* يبقى بالشاشة لين يتصرف */
        vibrate: [400, 200, 400, 200, 400, 200, 400],
        silent: false,
        data: { type: 'call', callId: d.callId, url: d.url || './' },
        actions: [
          { action: 'accept',  title: 'رد' },
          { action: 'decline', title: 'رفض' }
        ]
      });
      /* يختفي وحده بعد ٤٥ ثانية — نفس مدة الرنين بالتطبيق */
      await new Promise(r => setTimeout(r, 45000));
      const list = await self.registration.getNotifications({ tag: 'call-' + d.callId });
      list.forEach(n => n.close());
    })());
    return;
  }

  /* ═══ رسالة جديدة ═══ */
  event.waitUntil(
    self.registration.showNotification(d.title || APP_NAME, {
      body: d.body || 'رسالة جديدة',
      icon: d.icon || ICON,
      badge: d.badge || BADGE,
      tag: d.tag || 'msg',
      renotify: true,
      vibrate: [180, 80, 180],
      data: { type: 'message', url: d.url || './' },
      actions: [{ action: 'open', title: 'فتح المحادثة' }]
    })
  );
});


/* ───── الضغط على الإشعار أو على أزراره ───── */
self.addEventListener('notificationclick', event => {
  const d = event.notification.data || {};
  const action = event.action;
  event.notification.close();

  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({
      type: 'window',
      includeUncontrolled: true
    });

    /* التطبيق مفتوح ومكالمة → نبلّغه بالقرار مباشرة */
    if (d.type === 'call' && clients.length) {
      const c = clients[0];
      c.postMessage({ type: 'call-action', action: action || 'accept', callId: d.callId });
      try { await c.focus(); } catch (e) {}
      return;
    }

    /* رفض والتطبيق مسكّر → نعلّمها مرفوضة بلا ما نفتح شي */
    if (d.type === 'call' && action === 'decline') {
      try {
        await fetch(SUPABASE_URL + '/rest/v1/calls?id=eq.' + d.callId, {
          method: 'PATCH',
          headers: {
            apikey: SUPABASE_ANON,
            Authorization: 'Bearer ' + SUPABASE_ANON,
            'Content-Type': 'application/json',
            Prefer: 'return=minimal'
          },
          body: JSON.stringify({ status: 'declined', ended_at: new Date().toISOString() })
        });
      } catch (e) {}
      return;
    }

    /* غير هيك: نفتح التطبيق على الرابط المطلوب */
    const url = d.url || './';
    for (const c of clients) {
      if ('focus' in c) {
        try { await c.navigate(url); } catch (e) {}
        return c.focus();
      }
    }
    return self.clients.openWindow(url);
  })());
});
