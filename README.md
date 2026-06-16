# Trinacria

A personal daily planner / tracker — your day in three movements (IITM · Maersk · DeckView),
with an AI advisor ("Il Consigliere"). Built with React + Vite, deployed to GitHub Pages.

**Live:** https://rahulrr-coder.github.io/trinacria/

## Run locally

```bash
npm install
npm run dev      # http://localhost:5173/trinacria/
```

## Build

```bash
npm run build    # outputs to dist/
npm run preview  # serve the production build locally
```

## Deploy

Pushing to `main` triggers `.github/workflows/deploy.yml`, which builds the app and
publishes `dist/` to GitHub Pages. In the repo: **Settings → Pages → Build and deployment →
Source = GitHub Actions** (one-time setup).

The site is served from a sub-path (`/trinacria/`), set via `base` in `vite.config.js`.
If you rename the repo, update `base` to match.

## Data & persistence

All your data — plan templates, daily ticks, notes, reflections — is stored in your
browser's **`localStorage`**. It lives only on the device/browser you use; nothing is sent
to a server. Clearing site data wipes it, and it does not sync across machines.

## AI advisor (optional)

"Il Consigliere" calls **Groq** or **SambaNova** directly from your browser. Open the ✦
settings (top-right), pick a provider/model, and paste an API key.

**Important caveats:**
- The API key is stored only in your browser's `localStorage`. Anyone with access to your
  device/browser could read it. Don't enable "Save key" on a shared machine.
- Because the key sits in front-end code, it is **not** safe for a public multi-user app.
  For that, route AI calls through a serverless proxy that holds the key server-side.
- Some providers block browser (CORS) requests. If you see "Couldn't reach the provider",
  that's the provider's CORS policy, not your key. Groq generally allows browser calls.

Get a key:
- Groq — https://console.groq.com/keys
- SambaNova — https://cloud.sambanova.ai
