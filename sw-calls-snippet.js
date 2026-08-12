/* ══════════════════════════════════════════════════════════════
   أضف هذا الكود إلى ملف sw.js الموجود بجذر موقعك.

   إذا عندك مستمع push أو notificationclick من قبل، بدّله بهذا —
   هو يتعامل مع إشعارات الرسائل والمكالمات سوا.
   ══════════════════════════════════════════════════════════════ */


/* ───── زر «تحديث» بالتطبيق يحتاج هذا السطر ───── */
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});


/* ───── استقبال الإشعارات ───── */
self.addEventListener('push', event => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) {}

  if (d.type === 'call') {
    const opts = {
      body: d.body || 'مكالمة واردة',
      icon: d.icon || '/icon-192.png',
      badge: '/icon-192.png',
      tag: 'call-' + d.callId,        /* نفس الوسم = ما يتكرر الإشعار */
      renotify: true,
      requireInteraction: true,       /* يبقى بالشاشة لين يتصرف المستخدم */
      vibrate: [400, 200, 400, 200, 400],
      data: { type: 'call', callId: d.callId, url: d.url || '/' },
      actions: [
        { action: 'accept',  title: 'رد' },
        { action: 'decline', title: 'رفض' }
      ]
    };
    event.waitUntil(
      self.registration.showNotification(d.title || 'مكالمة واردة', opts)
        .then(() => {
          /* الإشعار يختفي وحده بعد ٤٥ ثانية — مدة الرنين بالتطبيق */
          return new Promise(r => setTimeout(r, 45000)).then(() =>
            self.registration.getNotifications({ tag: 'call-' + d.callId })
              .then(list => list.forEach(n => n.close()))
          );
        })
    );
    return;
  }

  /* إشعار رسالة عادي */
  event.waitUntil(
    self.registration.showNotification(d.title || 'NΞXA', {
      body: d.body || '',
      icon: d.icon || '/icon-192.png',
      badge: '/icon-192.png',
      tag: d.tag || 'msg',
      data: { url: d.url || '/' }
    })
  );
});


/* ───── الضغط على الإشعار أو على أزراره ───── */
self.addEventListener('notificationclick', event => {
  const d = event.notification.data || {};
  const action = event.action;
  event.notification.close();

  event.waitUntil((async () => {
    const clientList = await self.clients.matchAll({
      type: 'window',
      includeUncontrolled: true
    });

    /* التطبيق مفتوح → نبلّغه بالقرار مباشرة بلا ما نعيد التحميل */
    if (d.type === 'call' && clientList.length) {
      const c = clientList[0];
      c.postMessage({ type: 'call-action', action: action || 'accept', callId: d.callId });
      try { await c.focus(); } catch (e) {}
      return;
    }

    /* رفض والتطبيق مسكّر → نعلّم المكالمة مرفوضة بلا ما نفتح شي */
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
    const url = d.url || '/';
    for (const c of clientList) {
      if ('focus' in c) { try { await c.navigate(url); } catch (e) {} return c.focus(); }
    }
    return self.clients.openWindow(url);
  })());
});


/* ───── حط قيمهم فوق بأول ملف sw.js ─────
   لازم تكون بأعلى الملف قبل أي مستمع:

const SUPABASE_URL  = 'https://gygjpwmcuiqjelmpgxtp.supabase.co';
const SUPABASE_ANON = 'ضع هنا نفس المفتاح العلني الموجود بـ index.html';

   المفتاح العلني بس — لا تحط service_role هنا أبداً،
   لأن ملف sw.js ينزل لجهاز أي زائر مثل بقية ملفات الموقع.
*/
