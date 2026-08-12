// Supabase Edge Function — nexa-push
//
// Sends a Web Push notification when a message OR a call row is inserted.
// This is the piece that makes notifications arrive while the site is closed.
// The VAPID private key lives here on the server and never reaches any browser.
//
// ── Deploy ──
// Supabase dashboard -> Edge Functions -> Deploy a new function
// Name it exactly: nexa-push
//
// ── Secrets (Edge Functions -> Secrets) ──
//   SUPABASE_URL       https://gygjpwmcuiqjelmpgxtp.supabase.co
//   SERVICE_ROLE_KEY   Project Settings -> API -> service_role
//   VAPID_PUBLIC_KEY   the same key that is in index.html
//   VAPID_PRIVATE_KEY  the private half from your keygen
//   VAPID_SUBJECT      mailto:zalzhwr612@gmail.com
//   SITE_URL           https://12-web.github.io
//
// ── Triggers (Database -> Webhooks -> Create a new hook) ──
//   hook 1: table = messages, event = INSERT, type = Edge Function, name = nexa-push
//   hook 2: table = calls,    event = INSERT, type = Edge Function, name = nexa-push
//   hook 3: table = follows,  event = INSERT, type = Edge Function, name = nexa-push

import webpush from "https://esm.sh/web-push@3.6.7";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SERVICE_ROLE_KEY")!;
const SITE_URL     = Deno.env.get("SITE_URL") ?? "";

const ICON  = `${SITE_URL}/icon-192.png`;
const BADGE = `${SITE_URL}/badge-96.png`;
const APP   = "NΞXA";

webpush.setVapidDetails(
  Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@example.com",
  Deno.env.get("VAPID_PUBLIC_KEY")!,
  Deno.env.get("VAPID_PRIVATE_KEY")!,
);

async function db(path: string) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  return r.ok ? await r.json() : [];
}

async function senderName(phone: string) {
  const rows = await db(
    `user_profiles?select=name,username&phone=eq.${encodeURIComponent(phone)}&limit=1`,
  );
  const p = rows[0] ?? {};
  return p.name || p.username || phone;
}

// A one-line preview that never leaks more than it should
function preview(m: any) {
  if (m.body && String(m.body).trim()) return String(m.body).slice(0, 120);
  if (m.img)  return "📷 صورة";
  if (m.file) return "📎 ملف";
  return "رسالة جديدة";
}

async function send(callee: string, payload: Record<string, unknown>, ttl: number) {
  const subs = await db(
    `push_subs?select=id,endpoint,p256dh,auth&phone=eq.${encodeURIComponent(callee)}`,
  );
  if (!subs.length) return { sent: 0, cleaned: 0, reason: "no-subscription" };

  const text = JSON.stringify(payload);
  let sent = 0;
  const dead: string[] = [];

  await Promise.all(subs.map(async (s: any) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        text,
        { TTL: ttl, urgency: "high" },
      );
      sent++;
    } catch (err: any) {
      // 404 and 410 mean the browser threw this subscription away for good
      if (err?.statusCode === 404 || err?.statusCode === 410) dead.push(s.id);
    }
  }));

  if (dead.length) {
    await fetch(`${SUPABASE_URL}/rest/v1/push_subs?id=in.(${dead.join(",")})`, {
      method: "DELETE",
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    });
  }
  return { sent, cleaned: dead.length };
}

Deno.serve(async (req) => {
  try {
    const hook = await req.json();
    const row   = hook.record ?? hook;
    const table = hook.table ?? (row.callee ? "calls" : "messages");

    // ─────────── incoming call ───────────
    if (table === "calls") {
      if (!row?.id || !row?.callee) return new Response("skip", { status: 200 });
      if (row.status && !["calling", "ringing"].includes(row.status)) {
        return new Response("not ringing", { status: 200 });
      }
      const name = await senderName(row.caller);
      const out = await send(row.callee, {
        type: "call",
        callId: row.id,
        isVideo: !!row.is_video,
        app: APP,
        title: name,
        body: row.is_video ? "مكالمة فيديو واردة" : "مكالمة صوتية واردة",
        icon: ICON,
        badge: BADGE,
        url: `${SITE_URL}/#call=${row.id}`,
      }, 45);   // a call is worthless if it arrives late
      return Response.json(out);
    }

    // ─────────── new message ───────────
    if (table === "messages") {
      if (!row?.id || !row?.conv_id || !row?.sender) {
        return new Response("skip", { status: 200 });
      }

      // Work out who should receive it from the conversation row
      const convs = await db(
        `conversations?select=user1,user2&id=eq.${encodeURIComponent(row.conv_id)}&limit=1`,
      );
      const conv = convs[0];
      if (!conv) return new Response("no conversation", { status: 200 });

      const to = conv.user1 === row.sender ? conv.user2 : conv.user1;
      if (!to || to === row.sender) return new Response("skip", { status: 200 });

      const name = await senderName(row.sender);
      const out = await send(to, {
        type: "message",
        app: APP,
        title: name,
        body: preview(row),
        icon: ICON,
        badge: BADGE,
        tag: `conv-${row.conv_id}`,      // new messages replace the old bubble
        url: `${SITE_URL}/#chat=${row.conv_id}`,
      }, 3600);
      return Response.json(out);
    }

    // ─────────── new follower ───────────
    if (table === "follows") {
      if (!row?.follower || !row?.following) return new Response("skip", { status: 200 });
      if (row.follower === row.following) return new Response("skip", { status: 200 });

      const name = await senderName(row.follower);
      const out = await send(row.following, {
        type: "follow",
        app: APP,
        title: APP,
        body: `${name} صار يتابعك`,
        icon: ICON,
        badge: BADGE,
        tag: `follow-${row.follower}`,
        url: `${SITE_URL}/#u=${encodeURIComponent(row.follower)}`,
      }, 86400);
      return Response.json(out);
    }

    return new Response("ignored", { status: 200 });
  } catch (err) {
    console.error("nexa-push", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
