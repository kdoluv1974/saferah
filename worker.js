/* Cloudflare Worker لموقع صافرة: بيانات المباريات + إشعارات الأحداث الخلفية (Web Push)
   ── الإعداد ──
   Secrets:    API_KEY (مفتاح api-sports.io)   VAPID_PRIVATE (JWK من gen-vapid.mjs)
   Variables:  VAPID_PUBLIC   VAPID_SUBJECT (مثل mailto:you@example.com)   ALLOW_ORIGIN (اختياري)
   KV:         اربط مساحة KV باسم KV
   Cron:       * * * * *   (كل دقيقة)
   المسارات:   GET /fixtures  /standings  /{sport}/games   |  POST /subscribe  /inbox */
const HOSTS = {
  football: "v3.football.api-sports.io", basketball: "v1.basketball.api-sports.io", volleyball: "v1.volleyball.api-sports.io",
  handball: "v1.handball.api-sports.io", hockey: "v1.hockey.api-sports.io", baseball: "v1.baseball.api-sports.io",
  americanfootball: "v1.american-football.api-sports.io", rugby: "v1.rugby.api-sports.io",
};
const LIVE_S = ["1H", "HT", "2H", "ET", "BT", "P", "LIVE", "INT"], DONE_S = ["FT", "AET", "PEN"];
const enc = new TextEncoder();
const b64u = b => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const sid = async ep => b64u(await crypto.subtle.digest("SHA-256", enc.encode(ep))).slice(0, 22);
const kvj = async (env, k, d) => JSON.parse((await env.KV.get(k)) || d);

/* ── Web Push بدون حمولة: توقيع VAPID فقط ── */
async function vapidJwt(env, aud) {
  const key = await crypto.subtle.importKey("jwk", JSON.parse(env.VAPID_PRIVATE), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const h = b64u(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const p = b64u(enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 43200, sub: env.VAPID_SUBJECT || "mailto:admin@example.com" })));
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(h + "." + p));
  return h + "." + p + "." + b64u(sig);
}
async function ping(env, endpoint) {
  const jwt = await vapidJwt(env, new URL(endpoint).origin);
  return fetch(endpoint, { method: "POST", headers: { Authorization: `vapid t=${jwt}, k=${env.VAPID_PUBLIC}`, TTL: "300", Urgency: "high" } });
}

/* ── كشف الأحداث للمباريات المتابَعة (كل دقيقة) ── */
const total = s => String(s).split("-").reduce((a, b) => a + (+b || 0), 0);
async function tick(env) {
  const subs = await kvj(env, "subs", "{}");
  const ids = [...new Set(Object.values(subs).flatMap(s => s.f || []))];
  const rawSnap = (await env.KV.get("snap")) || "{}", snap = JSON.parse(rawSnap);
  Object.keys(snap).forEach(k => { if (!ids.includes(+k)) delete snap[k]; });
  const todo = ids.filter(i => !(snap[i] && snap[i].d)).slice(0, 100), ev = [];
  for (let i = 0; i < todo.length; i += 20) {
    const r = await fetch(`https://${HOSTS.football}/fixtures?ids=${todo.slice(i, i + 20).join("-")}`, { headers: { "x-apisports-key": env.API_KEY } });
    if (!r.ok) continue;
    for (const x of (await r.json()).response || []) {
      const id = x.fixture.id, s = x.fixture.status.short, g = (x.goals.home || 0) + "-" + (x.goals.away || 0), p = snap[id];
      const live = LIVE_S.includes(s), done = DONE_S.includes(s), line = `${x.teams.home.name} ${g.replace("-", " - ")} ${x.teams.away.name}`;
      if (p) {
        if (p.s === "NS" && live) ev.push({ fid: id, k: "ko", t: "بدأت المباراة", b: `${x.teams.home.name} × ${x.teams.away.name}`, g: `f${id}:k` });
        if ((live || done) && total(g) > total(p.g)) ev.push({ fid: id, k: "gl", t: "⚽ هدف!", b: line, g: `f${id}:g:${g}` });
        if (done && !p.d) ev.push({ fid: id, k: "ft", t: "نهاية المباراة", b: line, g: `f${id}:f` });
      }
      snap[id] = { s: live ? "L" : done ? "D" : "NS", g, d: done };
    }
  }
  const out = JSON.stringify(snap);
  if (out !== rawSnap) await env.KV.put("snap", out);   // الكتابة فقط عند التغيّر لتوفير حصة KV
  if (!ev.length) return;
  const now = Date.now(), old = (await kvj(env, "ev", "[]")).filter(e => now - e.ts < 600000);
  await env.KV.put("ev", JSON.stringify(old.concat(ev.map(e => ({ ...e, ts: now })))));
  const dead = [];
  await Promise.all(Object.entries(subs).map(async ([id, s]) => {
    if (!ev.some(e => (s.f || []).includes(e.fid) && (s.o || {})[e.k])) return;
    const r = await ping(env, s.e).catch(() => null);
    if (r && (r.status === 404 || r.status === 410)) dead.push(id);
  }));
  if (dead.length) { dead.forEach(d => delete subs[d]); await env.KV.put("subs", JSON.stringify(subs)); }
}

export default {
  async scheduled(_e, env, ctx) { ctx.waitUntil(tick(env)); },

  async fetch(req, env, ctx) {
    const cors = { "access-control-allow-origin": env.ALLOW_ORIGIN || "*", "access-control-allow-methods": "GET,POST,OPTIONS", "access-control-allow-headers": "content-type" };
    const json = (o, st = 200) => new Response(JSON.stringify(o), { status: st, headers: { ...cors, "content-type": "application/json" } });
    if (req.method === "OPTIONS") return new Response(null, { headers: cors });
    const u = new URL(req.url), p = u.pathname.split("/").filter(Boolean);

    if (req.method === "POST" && (p[0] === "subscribe" || p[0] === "inbox")) {
      let b; try { b = JSON.parse(await req.text()); } catch { return json({ error: "bad json" }, 400); }
      if (typeof b.endpoint !== "string" || !b.endpoint.startsWith("https://")) return json({ error: "bad endpoint" }, 400);
      const id = await sid(b.endpoint), subs = await kvj(env, "subs", "{}");
      if (p[0] === "subscribe") {
        const f = (Array.isArray(b.f) ? b.f : []).filter(Number.isInteger).slice(0, 50), o = b.o || {};
        if (f.length) subs[id] = { e: b.endpoint, f, o: { ko: !!o.ko, gl: !!o.gl, ft: !!o.ft } }; else delete subs[id];
        await env.KV.put("subs", JSON.stringify(subs));
        return json({ ok: true });
      }
      const s = subs[id]; if (!s) return json([]);
      const now = Date.now();
      return json((await kvj(env, "ev", "[]")).filter(e => now - e.ts < 180000 && s.f.includes(e.fid) && s.o[e.k]).map(e => ({ t: e.t, b: e.b, g: e.g })));
    }

    const sport = HOSTS[p[0]] && p[0] !== "football" ? p[0] : "football";
    const path = sport === "football" ? p[0] : p[1];
    if (req.method !== "GET" || !(sport === "football" ? ["fixtures", "standings"] : ["games", "standings"]).includes(path)) return new Response("Not found", { status: 404, headers: cors });
    const api = `https://${HOSTS[sport]}/${path}${u.search}`, key = new Request(api), cache = caches.default;
    let res = await cache.match(key);
    if (!res) {
      const r = await fetch(api, { headers: { "x-apisports-key": env.API_KEY } });
      res = new Response(r.body, r);
      if (r.ok) { res.headers.set("Cache-Control", "public, max-age=" + (path === "standings" ? 3600 : 60)); ctx.waitUntil(cache.put(key, res.clone())); }
    }
    res = new Response(res.body, res);
    Object.entries(cors).forEach(([k, v]) => res.headers.set(k, v));
    return res;
  },
};
