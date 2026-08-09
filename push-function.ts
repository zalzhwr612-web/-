// supabase/functions/push/index.ts
// يُنشر بـ:  supabase functions deploy push --no-verify-jwt
import webpush from "npm:web-push@3.6.7";

const VAPID_PUB  = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIV = Deno.env.get("VAPID_PRIVATE_KEY")!;
const SB_URL     = Deno.env.get("SUPABASE_URL")!;
const SB_KEY     = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CONTACT    = Deno.env.get("VAPID_CONTACT") ?? "mailto:admin@example.com";

webpush.setVapidDetails(CONTACT, VAPID_PUB, VAPID_PRIV);

const H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` };
const q = async (path: string) => {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: H });
  return r.ok ? await r.json() : [];
};

Deno.serve(async (req) => {
  let payload: any = {};
  try { payload = await req.json(); } catch { return new Response("bad json", { status: 400 }); }

  const table = payload.table ?? "";
  const rec   = payload.record ?? {};
  let target = "", title = "رسالة جديدة", body = "", data: any = {};

  if (table === "messages") {
    // نلقى الطرف الآخر من المحادثة
    const convs = await q(`conversations?select=user1,user2&id=eq.${rec.conv_id}&limit=1`);
    const c = convs[0];
    if (!c) return new Response("no conv", { status: 200 });
    target = c.user1 === rec.sender ? c.user2 : c.user1;

    const profs = await q(`user_profiles?select=name,username,avatar&phone=eq.${encodeURIComponent(rec.sender)}&limit=1`);
    title = profs[0]?.name || profs[0]?.username || rec.sender;
    body  = rec.voice ? "🎤 رسالة صوتية" : rec.img ? "📷 صورة" : (rec.body || "").slice(0, 90);
    data  = { type: "message", conv: rec.conv_id, from: rec.sender, name: title, avatar: profs[0]?.avatar || "" };

  } else if (table === "calls") {
    if (rec.status !== "ringing") return new Response("skip", { status: 200 });
    target = rec.callee;

    const profs = await q(`user_profiles?select=name,username,avatar&phone=eq.${encodeURIComponent(rec.caller)}&limit=1`);
    const who = profs[0]?.name || profs[0]?.username || rec.caller;
    title = who;
    body  = rec.is_video ? "📹 مكالمة فيديو واردة" : "📞 مكالمة صوتية واردة";
    data  = {
      type: "call", callId: rec.id, from: rec.caller, name: who, avatar: profs[0]?.avatar || "",
      // تسمح بزر "رفض" من الإشعار نفسه بدون فتح الموقع
      rejectUrl: `${SB_URL}/rest/v1/calls?id=eq.${rec.id}`,
      rejectKey: Deno.env.get("SUPABASE_ANON_KEY") ?? ""
    };
  } else {
    return new Response("ignored", { status: 200 });
  }

  const subs = await q(`push_subs?select=*&phone=eq.${encodeURIComponent(target)}`);
  if (!subs.length) return new Response("no subs", { status: 200 });

  const msg = JSON.stringify({ title, body, ...data });
  const dead: string[] = [];

  await Promise.all(subs.map(async (s: any) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        msg,
        { TTL: data.type === "call" ? 30 : 3600, urgency: "high" }
      );
    } catch (e: any) {
      // 404/410 = الاشتراك مات → ننظّفه
      if (e?.statusCode === 404 || e?.statusCode === 410) dead.push(s.endpoint);
    }
  }));

  if (dead.length) {
    const list = dead.map(e => `"${e}"`).join(",");
    await fetch(`${SB_URL}/rest/v1/push_subs?endpoint=in.(${encodeURIComponent(list)})`,
      { method: "DELETE", headers: H });
  }

  return new Response(JSON.stringify({ sent: subs.length - dead.length }), {
    headers: { "Content-Type": "application/json" }
  });
});
