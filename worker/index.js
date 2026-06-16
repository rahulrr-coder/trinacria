/* ============================================================ *
 *  Trinacria token proxy — a tiny Cloudflare Worker.
 *
 *  Holds the real secrets (GitHub token, AI keys) server-side so
 *  they NEVER reach the browser. The static app calls these
 *  endpoints instead of api.github.com / the AI provider directly.
 *
 *  Endpoints:
 *    GET  /api/health
 *    POST /api/ai            { provider, model, system, user }
 *    POST /api/sync/create   <snapshot json>            -> { id }
 *    GET  /api/sync?gist=ID                             -> snapshot json
 *    PUT  /api/sync?gist=ID  <snapshot json>            -> { ok: true }
 *
 *  Secrets (set via `wrangler secret put …`, never committed):
 *    GH_TOKEN, GROQ_KEY, SAMBANOVA_KEY (optional), APP_SECRET (optional)
 *  Vars (wrangler.toml): ALLOWED_ORIGINS (comma-separated)
 * ============================================================ */

const PROVIDERS = {
  groq: { url: "https://api.groq.com/openai/v1/chat/completions", keyVar: "GROQ_KEY" },
  sambanova: { url: "https://api.sambanova.ai/v1/chat/completions", keyVar: "SAMBANOVA_KEY" },
};
const GH = "https://api.github.com";
const GIST_FILE = "trinacria.json";

function corsHeaders(origin, env) {
  const allow = (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const ok = !allow.length || (origin && allow.includes(origin));
  return {
    "Access-Control-Allow-Origin": ok && origin ? origin : (allow[0] || "*"),
    "Access-Control-Allow-Methods": "GET,PUT,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,X-App-Secret",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}
const json = (obj, status, headers) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", ...headers } });

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const origin = req.headers.get("Origin") || "";
    const ch = corsHeaders(origin, env);

    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: ch });

    // Guards: optional origin allow-list + optional shared secret.
    const allow = (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
    if (allow.length && origin && !allow.includes(origin)) return json({ error: "origin not allowed" }, 403, ch);
    if (env.APP_SECRET && req.headers.get("X-App-Secret") !== env.APP_SECRET) return json({ error: "unauthorized" }, 401, ch);

    const ghHeaders = {
      Authorization: `Bearer ${env.GH_TOKEN}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "User-Agent": "trinacria-proxy",
    };

    try {
      if (url.pathname === "/api/health") return json({ ok: true }, 200, ch);

      if (url.pathname === "/api/ai" && req.method === "POST") {
        const { provider, model, system, user } = await req.json();
        const p = PROVIDERS[provider];
        if (!p) return json({ error: "unknown provider" }, 400, ch);
        const key = env[p.keyVar];
        if (!key) return json({ error: `no key configured for ${provider}` }, 500, ch);
        const r = await fetch(p.url, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
          body: JSON.stringify({
            model,
            messages: [{ role: "system", content: system }, { role: "user", content: user }],
            temperature: 0.6, max_tokens: 800,
          }),
        });
        // pass the provider response straight through (client parses it as before)
        return new Response(await r.text(), { status: r.status, headers: { "Content-Type": "application/json", ...ch } });
      }

      if (url.pathname === "/api/sync/create" && req.method === "POST") {
        const snapshot = await req.json().catch(() => ({}));
        const r = await fetch(`${GH}/gists`, {
          method: "POST", headers: ghHeaders,
          body: JSON.stringify({ description: "Trinacria — sync store.", public: false, files: { [GIST_FILE]: { content: JSON.stringify(snapshot, null, 2) } } }),
        });
        if (!r.ok) return json({ error: (await r.text()).slice(0, 200) }, r.status, ch);
        return json({ id: (await r.json()).id }, 200, ch);
      }

      if (url.pathname === "/api/sync") {
        const gist = url.searchParams.get("gist");
        if (!gist) return json({ error: "missing gist id" }, 400, ch);
        if (req.method === "GET") {
          const r = await fetch(`${GH}/gists/${gist}`, { headers: ghHeaders });
          if (!r.ok) return json({ error: (await r.text()).slice(0, 200) }, r.status, ch);
          const d = await r.json();
          const f = d.files?.[GIST_FILE];
          const content = f?.truncated && f.raw_url ? await (await fetch(f.raw_url)).text() : f?.content;
          return new Response(content || "{}", { status: 200, headers: { "Content-Type": "application/json", ...ch } });
        }
        if (req.method === "PUT") {
          const body = await req.text();
          const r = await fetch(`${GH}/gists/${gist}`, { method: "PATCH", headers: ghHeaders, body: JSON.stringify({ files: { [GIST_FILE]: { content: body } } }) });
          if (!r.ok) return json({ error: (await r.text()).slice(0, 200) }, r.status, ch);
          return json({ ok: true }, 200, ch);
        }
      }

      return json({ error: "not found" }, 404, ch);
    } catch (e) {
      return json({ error: String(e?.message || e) }, 500, ch);
    }
  },
};
