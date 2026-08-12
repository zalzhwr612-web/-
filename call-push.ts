// Supabase Edge Function — call-push
//
// Sends a Web Push notification when a call row is inserted.
// The VAPID private key stays here on the server and never reaches the browser.
//
// Deploy from the Supabase dashboard: Edge Functions -> Deploy via Editor
// Name it exactly: call-push
//
// Secrets to set (Edge Functions -> Manage secrets):
//   VAPID_PUBLIC_KEY   the key already in index.html
//   VAPID_PRIVATE_KEY  the private half from your Termux keygen
//   VAPID_SUBJECT      mailto:zalzhwr612@gmail.com
//   SERVICE_ROLE_KEY   Project Settings -> API -> service_role
//   SUPABASE_URL       https://gygjpwmcuiqjelmpgxtp.supabase.co
//
// Then wire the trigger: Database -> Webhooks -> Create
//   table: calls, events: INSERT, type: Supabase Edge Function, function: call-push

import webpush from "https://esm.sh/web-push@3.6.7";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SERVICE_ROLE_KEY")!;

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

Deno.serve(async (req) => {
  try {
    const body = await req.json();
    const call = body.record ?? body;

    if (!call?.id || !call?.callee) {
      return new Response("ignored", { status: 200 });
    }
    if (call.status && !["calling", "ringing"].includes(call.status)) {
      return new Response("not ringing", { status: 200 });
    }

    // Caller identity for the notification body
    const profiles = await db(
      `user_profiles?select=name,username,avatar&phone=eq.${encodeURIComponent(call.caller)}&limit=1`,
    );
    const caller = profiles[0] ?? {};
    const callerName = caller.name || caller.username || call.caller;

    // Every device the callee has registered
    const subs = await db(
      `push_subs?select=id,endpoint,p256dh,auth&phone=eq.${encodeURIComponent(call.callee)}`,
    );
    if (!subs.length) {
      return new Response(JSON.stringify({ sent: 0, reason: "no-subscription" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    const payload = JSON.stringify({
      type: "call",
      callId: call.id,
      isVideo: !!call.is_video,
      title: callerName,
      body: call.is_video ? "مكالمة فيديو واردة" : "مكالمة صوتية واردة",
      icon: caller.avatar || "/icon-192.png",
      url: `/#call=${call.id}`,
    });

    let sent = 0;
    const dead: string[] = [];

    await Promise.all(subs.map(async (s: any) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload,
          { TTL: 45, urgency: "high" },   // a call is worthless if it arrives late
        );
        sent++;
      } catch (err: any) {
        // 404/410 mean the browser dropped this subscription for good
        if (err?.statusCode === 404 || err?.statusCode === 410) dead.push(s.id);
      }
    }));

    if (dead.length) {
      await fetch(
        `${SUPABASE_URL}/rest/v1/push_subs?id=in.(${dead.join(",")})`,
        {
          method: "DELETE",
          headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
        },
      );
    }

    return new Response(JSON.stringify({ sent, cleaned: dead.length }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("call-push", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
