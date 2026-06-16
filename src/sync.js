/* ============================================================ *
 *  Trinacria sync — a private GitHub Gist as a JSON store.
 *
 *  Two modes, chosen by the `conn` descriptor:
 *   • proxy  — calls a Cloudflare Worker that holds the GitHub token
 *              server-side (conn.proxy set). No token in the browser.
 *   • direct — calls api.github.com with a fine-grained token the user
 *              entered (conn.token). Token lives only in localStorage.
 *
 *  conn = { token?, proxy?, secret? }
 * ============================================================ */

const GIST_FILE = "trinacria.json";
const API = "https://api.github.com";

const ghHeaders = (token) => ({
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "Content-Type": "application/json",
  "X-GitHub-Api-Version": "2022-11-28",
});
const proxyHeaders = (conn) => ({
  "Content-Type": "application/json",
  ...(conn.secret ? { "X-App-Secret": conn.secret } : {}),
});

async function ok(res) {
  if (res.ok) return res;
  const t = await res.text().catch(() => "");
  let msg = t.slice(0, 160) || res.statusText;
  if (res.status === 401) msg = "Unauthorized (401) — check the token / proxy secret.";
  if (res.status === 404) msg = "Not found (404) — the gist may have been deleted.";
  throw new Error(`${res.status} · ${msg}`);
}

/* Create a new private gist seeded with the snapshot; returns its id. */
export async function createGist(conn, snapshot) {
  if (conn.proxy) {
    const res = await ok(await fetch(`${conn.proxy}/api/sync/create`, {
      method: "POST", headers: proxyHeaders(conn), body: JSON.stringify(snapshot),
    }));
    return (await res.json()).id;
  }
  const res = await ok(await fetch(`${API}/gists`, {
    method: "POST", headers: ghHeaders(conn.token),
    body: JSON.stringify({
      description: "Trinacria — your day in three movements (sync store).",
      public: false, files: { [GIST_FILE]: { content: JSON.stringify(snapshot, null, 2) } },
    }),
  }));
  return (await res.json()).id;
}

/* Read the snapshot back out of a gist. */
export async function pullGist(conn, gistId) {
  if (conn.proxy) {
    const res = await ok(await fetch(`${conn.proxy}/api/sync?gist=${encodeURIComponent(gistId)}`, { headers: proxyHeaders(conn) }));
    try { return JSON.parse(await res.text()); } catch { throw new Error("Proxy returned invalid JSON."); }
  }
  const res = await ok(await fetch(`${API}/gists/${gistId}`, { headers: ghHeaders(conn.token) }));
  const data = await res.json();
  const file = data.files?.[GIST_FILE];
  if (!file) throw new Error("That gist has no trinacria.json file.");
  const content = file.truncated && file.raw_url ? await fetch(file.raw_url).then((r) => r.text()) : file.content;
  try { return JSON.parse(content); }
  catch { throw new Error("Gist content wasn't valid Trinacria JSON."); }
}

/* Overwrite the gist with a new snapshot. */
export async function pushGist(conn, gistId, snapshot) {
  if (conn.proxy) {
    await ok(await fetch(`${conn.proxy}/api/sync?gist=${encodeURIComponent(gistId)}`, {
      method: "PUT", headers: proxyHeaders(conn), body: JSON.stringify(snapshot),
    }));
    return;
  }
  await ok(await fetch(`${API}/gists/${gistId}`, {
    method: "PATCH", headers: ghHeaders(conn.token),
    body: JSON.stringify({ files: { [GIST_FILE]: { content: JSON.stringify(snapshot, null, 2) } } }),
  }));
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
    weekday: wd.list, weekend: we.list,
    weekdayUpdatedAt: wd.stamp, weekendUpdatedAt: we.stamp,
  };

  return { ...local, logs, templates, aiCfg: local.aiCfg || remote.aiCfg };
}
