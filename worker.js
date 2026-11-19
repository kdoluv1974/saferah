/* Cloudflare Worker: وسيط آمن لـ API-Sports (المفتاح يُخزَّن كسرّ ولا يظهر في الموقع)
   الإعداد:  wrangler secret put API_KEY      (مفتاح api-sports.io)
   المسارات: /fixtures?date=YYYY-MM-DD   /fixtures?id=   /standings?league=&season=      ← كرة القدم
             /{sport}/games?date=YYYY-MM-DD                                               ← بقية الرياضات
   sport: basketball | volleyball | handball | hockey | baseball | americanfootball | rugby */
const HOSTS = {
  football: "v3.football.api-sports.io",
  basketball: "v1.basketball.api-sports.io",
  volleyball: "v1.volleyball.api-sports.io",
  handball: "v1.handball.api-sports.io",
  hockey: "v1.hockey.api-sports.io",
  baseball: "v1.baseball.api-sports.io",
  americanfootball: "v1.american-football.api-sports.io",
  rugby: "v1.rugby.api-sports.io",
};

export default {
  async fetch(req, env, ctx) {
    const cors = { "access-control-allow-origin": env.ALLOW_ORIGIN || "*", "access-control-allow-methods": "GET,OPTIONS" };
    if (req.method === "OPTIONS") return new Response(null, { headers: cors });
    const u = new URL(req.url), p = u.pathname.split("/").filter(Boolean);
    const sport = HOSTS[p[0]] && p[0] !== "football" ? p[0] : "football";
    const path = sport === "football" ? p[0] : p[1];
    const allowed = sport === "football" ? ["fixtures", "standings"] : ["games", "standings"];
    if (!allowed.includes(path)) return new Response("Not found", { status: 404, headers: cors });

    const api = `https://${HOSTS[sport]}/${path}${u.search}`;
    const key = new Request(api), cache = caches.default;
    let res = await cache.match(key);
    if (!res) {
      const r = await fetch(api, { headers: { "x-apisports-key": env.API_KEY } });
      res = new Response(r.body, r);
      if (r.ok) {
        // تخزين مؤقت لتوفير حصة الطلبات: ساعة للترتيب، دقيقة لبقية البيانات
        res.headers.set("Cache-Control", "public, max-age=" + (path === "standings" ? 3600 : 60));
        ctx.waitUntil(cache.put(key, res.clone()));
      }
    }
    res = new Response(res.body, res);
    Object.entries(cors).forEach(([k, v]) => res.headers.set(k, v));
    return res;
  },
};
