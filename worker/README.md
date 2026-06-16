# Trinacria token proxy (Cloudflare Worker)

A ~90-line Worker that holds your **GitHub token** and **AI keys** server-side, so they
never ship inside the browser bundle. The app calls this Worker instead of
`api.github.com` / the AI provider directly.

## Why
Trinacria is a static site. Any secret the browser uses is otherwise either typed in by
hand (localStorage) or baked into public JavaScript (readable by anyone). This Worker is
the only way to keep the real tokens off the client.

## Deploy (one time)

```bash
npm i -g wrangler         # or: npx wrangler ...
cd worker
wrangler login            # opens browser, authorises your Cloudflare account

# set the secrets (prompts for each value — nothing is committed)
wrangler secret put GH_TOKEN        # GitHub PAT, gist scope only
wrangler secret put GROQ_KEY        # Groq API key
wrangler secret put SAMBANOVA_KEY   # optional
wrangler secret put APP_SECRET      # optional; see note below

wrangler deploy
```

Deploy prints a URL like `https://trinacria-proxy.<your-subdomain>.workers.dev`.

## Point the app at it

The app reads the proxy URL from a **build-time** env var (not a secret — it's just a URL):

- Local dev — create `.env.local` (already git-ignored):
  ```
  VITE_PROXY_URL=https://trinacria-proxy.<your-subdomain>.workers.dev
  VITE_PROXY_SECRET=the-same-APP_SECRET-if-you-set-one
  ```
- Deployed (GitHub Pages build) — add the same vars to the build step (a committed
  `.env.production`, or as env in `.github/workflows/deploy.yml`).

When `VITE_PROXY_URL` is set, the app routes AI + sync through the Worker and **hides the
token/key fields entirely** — no secrets in the browser. When it's unset, the app falls
back to the existing type-once-and-remember fields, so nothing breaks without the proxy.

## Notes / limitations
- `ALLOWED_ORIGINS` (in `wrangler.toml`) blocks browser calls from other sites. Update it
  if your Pages URL changes.
- `APP_SECRET` is sent by the app as `X-App-Secret`. Because the app is client-side, that
  value is visible in the bundle — it deters trivial scripted abuse but isn't a true
  secret. The real protection is that **GH_TOKEN / GROQ_KEY never leave the Worker**. For a
  personal app this is fine; add Cloudflare rate-limiting if you want more.
