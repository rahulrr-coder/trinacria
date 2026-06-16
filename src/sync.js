/* ============================================================ *
 *  Trinacria sync — a private GitHub Gist as a JSON store.
 *
 *  No server: the browser talks to api.github.com directly with
 *  a fine-grained token (gist scope only). Same security model as
 *  the AI key — the token lives only in this browser's localStorage.
 *  api.github.com allows authenticated CORS requests, so this works
 *  from a static GitHub Pages site.
 * ============================================================ */

const GIST_FILE = "trinacria.json";
const API = "https://api.github.com";

const headers = (token) => ({
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "Content-Type": "application/json",
  "X-GitHub-Api-Version": "2022-11-28",
});

async function ghFetch(url, opts) {
  const res = await fetch(url, opts);
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    let msg = t.slice(0, 160) || res.statusText;
    if (res.status === 401) msg = "Token rejected (401) — check it has the gist scope.";
    if (res.status === 404) msg = "Gist not found (404) — it may have been deleted.";
    throw new Error(`${res.status} · ${msg}`);
  }
  return res.json();
}

/* Create a new private gist seeded with the current snapshot; returns its id. */
export async function createGist(token, snapshot) {
  const data = await ghFetch(`${API}/gists`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify({
      description: "Trinacria — your day in three movements (sync store).",
      public: false,
      files: { [GIST_FILE]: { content: JSON.stringify(snapshot, null, 2) } },
    }),
  });
  return data.id;
}

/* Read the snapshot back out of a gist. */
export async function pullGist(token, gistId) {
  const data = await ghFetch(`${API}/gists/${gistId}`, { headers: headers(token) });
  const file = data.files?.[GIST_FILE];
  if (!file) throw new Error("That gist has no trinacria.json file.");
  // Large files arrive truncated with a raw_url to fetch in full.
  const content = file.truncated && file.raw_url
    ? await fetch(file.raw_url).then((r) => r.text())
    : file.content;
  try { return JSON.parse(content); }
  catch { throw new Error("Gist content wasn't valid Trinacria JSON."); }
}

/* Overwrite the gist with a new snapshot. */
export async function pushGist(token, gistId, snapshot) {
  await ghFetch(`${API}/gists/${gistId}`, {
    method: "PATCH",
    headers: headers(token),
    body: JSON.stringify({ files: { [GIST_FILE]: { content: JSON.stringify(snapshot, null, 2) } } }),
  });
}

/* ---------- last-write-wins merge, per record ----------
 * logs:      union of day keys; for shared keys keep the larger updatedAt.
 * templates: per list (weekday/weekend) keep the larger *UpdatedAt.
 * aiCfg:     keep local (provider/model is a device-local preference).
 */
export function mergeState(local, remote) {
  if (!remote) return local;
  if (!local) return remote;

  const logs = { ...(local.logs || {}) };
  for (const [k, rv] of Object.entries(remote.logs || {})) {
    const lv = logs[k];
    if (!lv || (rv?.updatedAt || 0) > (lv?.updatedAt || 0)) logs[k] = rv;
  }

  const lt = local.templates || {};
  const rt = remote.templates || {};
  const pick = (key) => {
    const stamp = `${key}UpdatedAt`;
    const remoteNewer = (rt[stamp] || 0) > (lt[stamp] || 0);
    return remoteNewer
      ? { list: rt[key] || lt[key], stamp: rt[stamp] || 0 }
      : { list: lt[key] || rt[key], stamp: lt[stamp] || 0 };
  };
  const wd = pick("weekday");
  const we = pick("weekend");
  const templates = {
    weekday: wd.list,
    weekend: we.list,
    weekdayUpdatedAt: wd.stamp,
    weekendUpdatedAt: we.stamp,
  };

  return { ...local, logs, templates, aiCfg: local.aiCfg || remote.aiCfg };
}
