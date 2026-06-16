import { useState, useEffect, useRef } from "react";
import { createGist, pullGist, pushGist, mergeState } from "./sync.js";
import "./trinacria.css";

/* Optional secure proxy (a Cloudflare Worker holding the real secrets).
 * When VITE_PROXY_URL is set at build time, AI + sync route through it and
 * no token/key ever lives in the browser. Unset → direct calls (default). */
const PROXY = (import.meta.env?.VITE_PROXY_URL || "").replace(/\/$/, "");
const PROXY_SECRET = import.meta.env?.VITE_PROXY_SECRET || "";
const useProxy = !!PROXY;

/* ============================================================ *
 *  TRINACRIA — your day in three movements.
 *  IITM (morning) · Maersk (day) · DeckView (night).
 *  Sicilian maiolica, gilded triskele, Il Consigliere (AI).
 * ============================================================ */

const CATS = {
  iitm:     { name: "IITM",     color: "#E0A500" }, // saffron / Sicilian lemon
  maersk:   { name: "Maersk",   color: "#1F5FA6" }, // Mediterranean cobalt (the sea)
  dsa:      { name: "DSA",      color: "#C8472B", dashed: true }, // blood orange
  deckview: { name: "DeckView", color: "#2E7D55" }, // ceramic emerald (growth)
  rest:     { name: "Rest",     color: "#8A7E6B" }, // warm stone
  reading:  { name: "Reading",  color: "#B85C38" }, // terracotta
  social:   { name: "Social",   color: "#BF5B6B" }, // dusty rose
  custom:   { name: "Other",    color: "#9C8A5E" },
};
const STREAM_OF = { iitm: "IITM", maersk: "Maersk", dsa: "Maersk", deckview: "DeckView" };
const uid = () => Math.random().toString(36).slice(2, 9);

const DEFAULT_WEEKDAY = [
  { id: "w1", time: "06:00–06:30", label: "Wake — no phone", cat: "rest", note: "Get ready. Phone stays off." },
  { id: "w2", time: "06:30–09:00", label: "IITM — videos + assignments", cat: "iitm", note: "This week's topics. Decided last night." },
  { id: "w3", time: "09:00–18:00", label: "Maersk — deep work", cat: "maersk", note: "Your fixed work calendar. Full focus." },
  { id: "w4", time: "dead-time", label: "DSA — one problem", cat: "dsa", note: "Slot into a boring meeting or lag. ~30 min, not extra hours. Log the problem + pattern below." },
  { id: "w5", time: "18:00–19:00", label: "Decompress + dinner (~7pm)", cat: "rest", note: "Eat with parents ~7. Phone, not PC, if watching. One set thing, done by ~7:45." },
  { id: "w6", time: "19:00–21:30", label: "Free / buffer", cat: "rest", note: "Rest or light overflow. Not a third grind." },
  { id: "w7", time: "21:30–23:30", label: "DeckView — build", cat: "deckview", note: "Creative peak. Entry point pre-loaded last night." },
  { id: "w8", time: "23:30–00:00", label: "Pre-load tomorrow + wind down", cat: "rest", note: "Write tomorrow's first IITM + DeckView task. Then sleep." },
];
const DEFAULT_WEEKEND = [
  { id: "e1", time: "slow morning", label: "Coffee + reading", cat: "reading", note: "Off screens. Read by mood — no page targets." },
  { id: "e2", time: "one block", label: "DeckView — build or sell", cat: "deckview", note: "Sat: heads-down build. Or value-driven outreach (X, r/consulting, r/freelance). Pick one mode." },
  { id: "e3", time: "one thing", label: "People / output you own", cat: "social", note: "Meetup, hackathon, friends, or write + publish. The good kind of weekend." },
  { id: "e4", time: "deliberate", label: "Genuine rest", cat: "rest", note: "Alternate weekends, actually empty. Rest at the trough is recovery, not laziness." },
  { id: "e5", time: "wind-down", label: "Reading wind-down", cat: "reading", note: "Replaces the late-night scroll." },
];

/* ---------- carta del giorno — a daily opening line (offline) ---------- */
const CARTE = [
  { it: "Un giorno, tre movimenti.", en: "One day, three movements — hold the order." },
  { it: "L’ordine regge; l’intensità si piega.", en: "The order holds; the intensity bends." },
  { it: "Comincia in silenzio — il telefono dopo.", en: "Begin in silence; the phone comes later." },
  { it: "Una cosa vera basta.", en: "One true thing is enough." },
  { it: "A mezzogiorno, il mare è profondo.", en: "Go deep at midday — that is the work." },
  { it: "La sera è per ciò che costruisci.", en: "The evening belongs to what you build." },
  { it: "Un problema al giorno, nel tempo morto.", en: "One problem a day, slipped into the dead-time." },
  { it: "Carica il domani, stanotte.", en: "Pre-load tomorrow tonight." },
  { it: "Riposare nel trogolo è recupero.", en: "Rest at the trough is recovery, not idleness." },
  { it: "Non un terzo lavoro — respira.", en: "Not a third grind — breathe." },
  { it: "Mostra il lavoro; il resto segue.", en: "Show the work; the rest follows." },
  { it: "Piano, ma senza fermarti.", en: "Slowly — but without stopping." },
];
const cartaOf = (key) => {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return CARTE[h % CARTE.length];
};

/* ---------- date + time ---------- */
const pad = (n) => String(n).padStart(2, "0");
const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const isWeekend = (d) => d.getDay() === 0 || d.getDay() === 6;
const sameDay = (a, b) => keyOf(a) === keyOf(b);
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const dayLabel = (d) => d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
function blockSpan(t) {
  const m = /^(\d{2}):(\d{2})–(\d{2}):(\d{2})$/.exec(t);
  if (!m) return null;
  const s = +m[1] * 60 + +m[2]; let e = +m[3] * 60 + +m[4];
  if (e === 0) e = 1440; return [s, e];
}

/* ---------- weekly stats + streak ---------- */
function dayStats(logs, templates, date) {
  const k = keyOf(date);
  const l = logs[k];
  const tpl = isWeekend(date) ? templates.weekend : templates.weekday;
  const total = tpl.length || 1;
  const done = l ? Object.values(l.done || {}).filter(Boolean).length : 0;
  return { key: k, date, done, total, pct: Math.round((done / total) * 100) };
}
function computeStreak(logs, templates, today) {
  let streak = 0;
  let d = new Date(today);
  if (dayStats(logs, templates, d).done === 0) d = addDays(d, -1); // today may be in progress
  while (dayStats(logs, templates, d).done > 0) { streak++; d = addDays(d, -1); }
  return streak;
}

/* ---------- storage (browser localStorage) ---------- */
const K_T = "trinacria_templates_v1";
const K_L = "trinacria_logs_v1";
const K_AI = "trinacria_ai_v1";
const K_KEY = "trinacria_aikey_v1";
const K_GH = "trinacria_gh_v1";

/* a single portable snapshot of everything worth keeping — used by
 * both file export/import and gist sync, so they never drift apart. */
const snapshotOf = (s) => ({
  app: "trinacria", version: 1, exportedAt: new Date().toISOString(),
  templates: s.templates, logs: s.logs,
  aiCfg: { provider: s.aiCfg?.provider, model: s.aiCfg?.model },
});
async function sGet(k) { try { const r = localStorage.getItem(k); return r ? JSON.parse(r) : null; } catch { return null; } }
async function sSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full or unavailable */ return false; } }
async function sDel(k) { try { localStorage.removeItem(k); } catch { /* storage unavailable */ return false; } }

/* ---------- AI providers ---------- */
const PROVIDERS = {
  groq: {
    name: "Groq", url: "https://api.groq.com/openai/v1/chat/completions",
    models: ["llama-3.3-70b-versatile", "openai/gpt-oss-120b", "llama-3.1-8b-instant"],
    keyHint: "gsk_…", console: "console.groq.com/keys",
  },
  sambanova: {
    name: "SambaNova", url: "https://api.sambanova.ai/v1/chat/completions",
    models: ["Meta-Llama-3.3-70B-Instruct", "Llama-3.1-8B-Instruct", "DeepSeek-V3-0324"],
    keyHint: "your SambaNova key", console: "cloud.sambanova.ai",
  },
};
async function askAI({ provider, apiKey, model, system, user }) {
  const res = useProxy
    ? await fetch(`${PROXY}/api/ai`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(PROXY_SECRET ? { "X-App-Secret": PROXY_SECRET } : {}) },
        body: JSON.stringify({ provider, model, system, user }),
      })
    : await fetch(PROVIDERS[provider].url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, messages: [{ role: "system", content: system }, { role: "user", content: user }], temperature: 0.6, max_tokens: 800 }),
      });
  if (!res.ok) { const t = await res.text().catch(() => ""); throw new Error(`${res.status} · ${t.slice(0, 140) || res.statusText}`); }
  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() || "(no reply)";
}

/* ============================================================ */
export default function Trinacria() {
  const [loaded, setLoaded] = useState(false);
  const [templates, setTemplates] = useState({ weekday: DEFAULT_WEEKDAY, weekend: DEFAULT_WEEKEND });
  const [logs, setLogs] = useState({});
  const [tab, setTab] = useState("today");
  const [planSel, setPlanSel] = useState("weekday");
  const [viewDate, setViewDate] = useState(new Date());
  const [now, setNow] = useState(new Date());
  const [openNote, setOpenNote] = useState(null);

  // AI state
  const [aiCfg, setAiCfg] = useState({ provider: "groq", model: PROVIDERS.groq.models[0], remember: false, theme: "auto" });
  const [apiKey, setApiKey] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [aiInput, setAiInput] = useState("");
  const [aiOut, setAiOut] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiErr, setAiErr] = useState("");
  const [dataMsg, setDataMsg] = useState("");
  const [cartaBusy, setCartaBusy] = useState(false);
  const importRef = useRef(null);

  // Sync (GitHub Gist) state
  const [gh, setGh] = useState({ token: "", gistId: "", lastSync: 0 });
  const [ghToken, setGhToken] = useState("");            // controlled input before connecting
  const [syncState, setSyncState] = useState("idle");    // idle | syncing | synced | error
  const [syncErr, setSyncErr] = useState("");
  // always-current snapshot, so debounced/async sync never reads stale state
  const stateRef = useRef({ templates, logs, aiCfg });
  useEffect(() => { stateRef.current = { templates, logs, aiCfg }; }, [templates, logs, aiCfg]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [t, l, a, k, g] = await Promise.all([sGet(K_T), sGet(K_L), sGet(K_AI), sGet(K_KEY), sGet(K_GH)]);
      if (!alive) return;
      if (t?.weekday && t?.weekend) setTemplates(t);
      if (l) setLogs(l);
      if (a) setAiCfg((p) => ({ ...p, ...a }));
      if (a?.remember && k?.key) setApiKey(k.key);
      if (g?.token && g?.gistId) { setGh(g); setGhToken(g.token); }
      setLoaded(true);
    })();
    return () => { alive = false; };
  }, []);
  useEffect(() => { if (loaded) sSet(K_T, templates); }, [templates, loaded]);
  useEffect(() => { if (loaded) sSet(K_L, logs); }, [logs, loaded]);
  useEffect(() => { if (loaded) sSet(K_AI, aiCfg); }, [aiCfg, loaded]);
  useEffect(() => { const id = setInterval(() => setNow(new Date()), 60000); return () => clearInterval(id); }, []);
  useEffect(() => { if (loaded && aiCfg.remember && apiKey.trim()) sSet(K_KEY, { key: apiKey.trim() }); }, [apiKey, aiCfg.remember, loaded]);
  useEffect(() => { if (loaded) sSet(K_GH, gh); }, [gh, loaded]);

  const weekendView = isWeekend(viewDate);
  const tpl = weekendView ? templates.weekend : templates.weekday;
  const dKey = keyOf(viewDate);
  const log = logs[dKey] || { done: {}, note: {}, reflection: "" };
  const onToday = sameDay(viewDate, now);

  let currentId = null;
  if (onToday) {
    const m = now.getHours() * 60 + now.getMinutes();
    for (const b of tpl) { const sp = blockSpan(b.time); if (sp && m >= sp[0] && m < sp[1]) { currentId = b.id; break; } }
  }
  const activeStream = currentId ? STREAM_OF[tpl.find((b) => b.id === currentId)?.cat] : null;
  const doneCount = tpl.filter((b) => log.done[b.id]).length;
  const pct = tpl.length ? Math.round((doneCount / tpl.length) * 100) : 0;

  // per-stream completion for the triskele dial (this viewed day)
  const streamProg = { IITM: [0, 0], Maersk: [0, 0], DeckView: [0, 0] };
  tpl.forEach((b) => { const s = STREAM_OF[b.cat]; if (s && streamProg[s]) { streamProg[s][1]++; if (log.done[b.id]) streamProg[s][0]++; } });
  const streamPct = Object.fromEntries(Object.entries(streamProg).map(([k, [d, t]]) => [k, t ? d / t : 0]));

  // time-of-day theming: phase from the device clock, with a manual override
  const themeMode = aiCfg.theme || "auto"; // auto | light | notte
  const hr = now.getHours();
  const phase = hr < 5 ? "notte" : hr < 11 ? "alba" : hr < 17 ? "giorno" : hr < 21 ? "sera" : "notte";
  const appearance = themeMode === "notte" ? "dark" : themeMode === "light" ? "light" : (phase === "notte" ? "dark" : "light");
  const tintPhase = (appearance === "light" && phase === "notte") ? "sera" : phase;
  useEffect(() => {
    document.body.style.background = appearance === "dark" ? "#0F0B06" : "#FAF3E4";
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", appearance === "dark" ? "#16110A" : "#FAF3E4");
  }, [appearance]);
  useEffect(() => {
    if (!settingsOpen) return;
    const onKey = (e) => { if (e.key === "Escape") { setSettingsOpen(false); setDataMsg(""); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [settingsOpen]);

  const patchLog = (patch) => setLogs((prev) => { const cur = prev[dKey] || { done: {}, note: {}, reflection: "" }; return { ...prev, [dKey]: { ...cur, ...patch, updatedAt: Date.now() } }; });
  const toggleDone = (id) => patchLog({ done: { ...log.done, [id]: !log.done[id] } });
  const setNote = (id, v) => patchLog({ note: { ...log.note, [id]: v } });
  const setReflection = (v) => patchLog({ reflection: v });

  const setList = (w, list) => setTemplates((p) => ({ ...p, [w]: list, [`${w}UpdatedAt`]: Date.now() }));
  const editBlock = (w, id, patch) => setList(w, templates[w].map((b) => (b.id === id ? { ...b, ...patch } : b)));
  const removeBlock = (w, id) => setList(w, templates[w].filter((b) => b.id !== id));
  const addBlock = (w) => setList(w, [...templates[w], { id: uid(), time: "anytime", label: "New block", cat: "custom", note: "" }]);
  const moveBlock = (w, from, to) => { if (to < 0 || to >= templates[w].length) return; const list = [...templates[w]]; const [x] = list.splice(from, 1); list.splice(to, 0, x); setList(w, list); };
  const resetTemplate = (w) => setList(w, (w === "weekday" ? DEFAULT_WEEKDAY : DEFAULT_WEEKEND).map((b) => ({ ...b })));

  const wins = tpl.filter((b) => log.done[b.id]);

  /* ---- weekly stats (sidebar) — last 7 days ending today ---- */
  const week = [];
  for (let i = 6; i >= 0; i--) week.push(dayStats(logs, templates, addDays(now, -i)));
  const streak = computeStreak(logs, templates, now);

  /* ---- backup: export / import ---- */
  const exportData = () => {
    const blob = new Blob([JSON.stringify(snapshotOf({ templates, logs, aiCfg }), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `trinacria-backup-${keyOf(new Date())}.json`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    setDataMsg("Backup downloaded.");
  };
  const importData = (file) => {
    if (!file) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const d = JSON.parse(String(r.result));
        if (d.templates?.weekday && d.templates?.weekend) setTemplates(d.templates);
        if (d.logs && typeof d.logs === "object") setLogs(d.logs);
        if (d.aiCfg) setAiCfg((p) => ({ ...p, ...d.aiCfg }));
        setDataMsg("Restored from backup.");
      } catch { setDataMsg("That file isn’t a Trinacria backup."); }
    };
    r.readAsText(file);
  };

  /* ---- multi-device sync (proxy or direct gist) ---- */
  const connOf = (token) => ({ token, proxy: PROXY, secret: PROXY_SECRET });
  const canSync = (token, gistId) => !!gistId && (useProxy || !!token);
  const syncNow = async () => {
    const { token, gistId } = gh;
    if (!canSync(token, gistId)) return;
    setSyncState("syncing"); setSyncErr("");
    try {
      const remote = await pullGist(connOf(token), gistId);
      const merged = mergeState(snapshotOf(stateRef.current), remote);
      setTemplates(merged.templates);
      setLogs(merged.logs);
      await pushGist(connOf(token), gistId, merged);
      setGh((p) => ({ ...p, lastSync: Date.now() }));
      setSyncState("synced");
    } catch (e) { setSyncErr(String(e.message || e)); setSyncState("error"); }
  };
  // keep a stable handle so the debounce effect needn't depend on syncNow
  const syncRef = useRef(syncNow);
  useEffect(() => { syncRef.current = syncNow; });

  const connectGist = async () => {
    const token = ghToken.trim();
    if (!useProxy && !token) { setSyncErr("Paste a token first."); setSyncState("error"); return; }
    setSyncState("syncing"); setSyncErr("");
    try {
      let gistId = gh.gistId;
      if (!gistId) gistId = await createGist(connOf(token), snapshotOf(stateRef.current));
      setGh({ token: useProxy ? "" : token, gistId, lastSync: Date.now() });
      setSyncState("synced");
    } catch (e) { setSyncErr(String(e.message || e)); setSyncState("error"); }
  };
  const disconnectGist = () => {
    setGh({ token: "", gistId: "", lastSync: 0 });
    setGhToken(""); setSyncState("idle"); setSyncErr("");
  };

  // pull + merge once we're connected (covers boot and the moment of connecting)
  useEffect(() => {
    if (loaded && canSync(gh.token, gh.gistId)) syncRef.current();
  }, [loaded, gh.token, gh.gistId]);
  // debounced push whenever data changes while connected
  useEffect(() => {
    if (!loaded || !canSync(gh.token, gh.gistId)) return;
    const id = setTimeout(() => syncRef.current(), 4000);
    return () => clearTimeout(id);
  }, [templates, logs, loaded, gh.token, gh.gistId]);
  const syncLabel = syncState === "syncing" ? "syncing…"
    : syncState === "error" ? "sync error"
    : gh.gistId ? (gh.lastSync ? `synced ${new Date(gh.lastSync).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "connected")
    : "not connected";

  /* ---- reminders: nudge when a block becomes "now" (app open) ---- */
  const notify = !!aiCfg.notify;
  const toggleNotify = async (on) => {
    if (on && typeof Notification !== "undefined" && Notification.permission !== "granted") {
      const res = await Notification.requestPermission().catch(() => "denied");
      if (res !== "granted") { setDataMsg("Browser blocked notifications — enable them for this site."); return; }
    }
    setAiCfg((p) => ({ ...p, notify: on }));
  };
  const prevNowRef = useRef(null);
  useEffect(() => {
    if (!loaded) return;
    const prev = prevNowRef.current;
    prevNowRef.current = currentId;
    if (!notify || !onToday || !currentId || currentId === prev) return;
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    const b = tpl.find((x) => x.id === currentId);
    if (b) { try { new Notification("Trinacria · ora", { body: `${b.time} — ${b.label}`, tag: "trinacria-now" }); } catch { /* ignore */ } }
  }, [currentId, loaded, notify, onToday, tpl]);

  /* ---- AI plumbing ---- */
  const buildContext = () => {
    const lines = tpl.map((b) => {
      const d = log.done[b.id] ? "[done]" : "[ ]";
      const n = log.note[b.id] ? ` — did: ${log.note[b.id]}` : "";
      return `${d} ${b.time} · ${b.label} (${CATS[b.cat]?.name})${n}`;
    }).join("\n");
    return `Day: ${onToday ? "today" : dayLabel(viewDate)} (${weekendView ? "weekend" : "weekday"}).\nPlan:\n${lines}\nReflection so far: ${log.reflection || "(none)"}`;
  };
  const SYSTEM = "You are Il Consigliere, Rahul's trusted advisor inside his daily planner. His model: a sliding window of three streams in fixed order — IITM (study, morning), Maersk (work, day), DeckView (his SaaS, night) — with intensity that flexes. DSA is one problem a day inside Maersk dead-time. Be direct, warm, brief. No flattery, no hedging. Use short clear sections with bold subheadings only when it genuinely helps. Push back when his plan is unrealistic. Keep it under ~180 words unless asked for more.";

  const runAI = async (userMsg) => {
    if (!useProxy && !apiKey.trim()) { setSettingsOpen(true); setAiErr("Add a key to wake your consigliere."); return; }
    setAiBusy(true); setAiErr(""); setAiOut("");
    try {
      const out = await askAI({ provider: aiCfg.provider, apiKey: apiKey.trim(), model: aiCfg.model, system: SYSTEM, user: `${userMsg}\n\n---\n${buildContext()}` });
      setAiOut(out);
    } catch (e) {
      setAiErr(String(e.message || e).includes("Failed to fetch") ? "Couldn't reach the provider — it may block browser requests, or the key/network is off." : `Error: ${e.message || e}`);
    } finally { setAiBusy(false); }
  };
  const saveKeyToggle = async (remember) => {
    setAiCfg((p) => ({ ...p, remember }));
    if (remember && apiKey.trim()) await sSet(K_KEY, { key: apiKey.trim() });
    if (!remember) await sDel(K_KEY);
  };

  /* ---- carta del giorno: a curated line by default; the Consigliere can
   * author today's if a key is connected. Stored on the day so it syncs. ---- */
  const carta = log.carta || cartaOf(dKey);
  const drawCarta = async () => {
    if ((!useProxy && !apiKey.trim()) || cartaBusy) return;
    setCartaBusy(true);
    try {
      const out = await askAI({
        provider: aiCfg.provider, apiKey: apiKey.trim(), model: aiCfg.model,
        system: "You are Il Consigliere. Write ONE short opening line for Rahul's day — a single sentence under 14 words, a focused intention in your warm, direct voice. No quotes, no preamble, no emoji.",
        user: buildContext(),
      });
      const line = out.split("\n")[0].replace(/^["“'']+|["”'']+$/g, "").trim();
      if (line) patchLog({ carta: { it: line, en: "" } });
    } catch { /* keep the curated line */ }
    finally { setCartaBusy(false); }
  };

  const THEME_CYCLE = { auto: "light", light: "notte", notte: "auto" };
  const THEME_ICON = { auto: "◐", light: "☀", notte: "☾" };
  const THEME_NAME = { auto: "Auto — follows the day", light: "Light", notte: "Notte (dark)" };

  return (
    <div className="tr-root" data-phase={tintPhase} data-appearance={appearance}>
      <div className="tr-aura" aria-hidden="true" />

      {/* ---------------- HEADER ---------------- */}
      <header className="tr-head">
        <Emblem activeStream={weekendView ? null : activeStream} progress={streamPct} />
        <div className="tr-headtext">
          <p className="tr-eyebrow">La giornata in tre movimenti</p>
          <h1 className="tr-title">Trinacria</h1>
          <p className="tr-sub">Your day in three movements — study, work, the thing you’re building. The order holds; the intensity bends.</p>
        </div>
        <div className="tr-headbtns">
          <button className="tr-theme" onClick={() => setAiCfg((p) => ({ ...p, theme: THEME_CYCLE[themeMode] }))}
            aria-label="Cycle appearance" title={`Appearance: ${THEME_NAME[themeMode]}`}>{THEME_ICON[themeMode]}</button>
          <button className="tr-gear" onClick={() => setSettingsOpen((v) => !v)} aria-label="AI settings" title="Consigliere settings">✦</button>
        </div>
      </header>

      {/* stream ribbon */}
      {weekendView ? (
        <div className="tr-ribbon loose">
          {["Read", "Build · Sell", "People", "Rest"].map((s) => <span key={s} className="tr-rpill loose">{s}</span>)}
          <span className="tr-loosehint">flessibile — one real thing is enough</span>
        </div>
      ) : (
        <div className="tr-ribbon">
          {["IITM", "Maersk", "DeckView"].map((s, i) => {
            const on = activeStream === s;
            const col = s === "IITM" ? CATS.iitm.color : s === "Maersk" ? CATS.maersk.color : CATS.deckview.color;
            return (
              <span className="tr-rgroup" key={s}>
                <span className={`tr-rpill ${on ? "on" : ""}`} style={on ? { borderColor: col, color: col } : {}}>
                  {s}{on && <em className="tr-ora">ora</em>}
                </span>
                {i < 2 && <span className="tr-orn">❧</span>}
              </span>
            );
          })}
        </div>
      )}

      {/* ---------------- SETTINGS DRAWER ---------------- */}
      {settingsOpen && (
        <div className="tr-modal" onClick={(e) => { if (e.target === e.currentTarget) { setSettingsOpen(false); setDataMsg(""); } }}>
          <div className="tr-modalcard" role="dialog" aria-modal="true" aria-label="Settings">
            <div className="tr-modalhead">
              <h2 className="tr-modaltitle">Impostazioni</h2>
              <button className="tr-modalclose" onClick={() => { setSettingsOpen(false); setDataMsg(""); }} aria-label="Close settings">✕</button>
            </div>
            <div className="tr-modalbody">

              <section className="tr-section">
                <h3 className="tr-sectitle">Appearance</h3>
                <div className="tr-setrow">
                  <span className="tr-setlabel">Theme</span>
                  <div className="tr-provsel">
                    {["auto", "light", "notte"].map((m) => (
                      <button key={m} className={`tr-prov ${themeMode === m ? "on" : ""}`}
                        onClick={() => setAiCfg((p) => ({ ...p, theme: m }))}>{m[0].toUpperCase() + m.slice(1)}</button>
                    ))}
                  </div>
                </div>
                <p className="tr-setnote">Auto follows your device clock — saffron at dawn, cobalt by day, candle-lit at night.</p>
                <label className="tr-remember">
                  <input type="checkbox" checked={notify} onChange={(e) => toggleNotify(e.target.checked)} />
                  <span>Nudge me when a block begins (while open)</span>
                </label>
              </section>

              <section className="tr-section">
                <h3 className="tr-sectitle">Il Consigliere · AI</h3>
                <div className="tr-setrow">
                  <span className="tr-setlabel">Provider</span>
                  <div className="tr-provsel">
                    {Object.keys(PROVIDERS).map((k) => (
                      <button key={k} className={`tr-prov ${aiCfg.provider === k ? "on" : ""}`}
                        onClick={() => setAiCfg((p) => ({ ...p, provider: k, model: PROVIDERS[k].models[0] }))}>{PROVIDERS[k].name}</button>
                    ))}
                  </div>
                </div>
                <div className="tr-setrow">
                  <span className="tr-setlabel">Model</span>
                  <select className="tr-modelsel" value={aiCfg.model} onChange={(e) => setAiCfg((p) => ({ ...p, model: e.target.value }))}>
                    {PROVIDERS[aiCfg.provider].models.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                {useProxy ? (
                  <p className="tr-setnote">🔒 Keys are held by your secure proxy — nothing to enter here.</p>
                ) : (
                  <>
                    <div className="tr-setrow">
                      <span className="tr-setlabel">API key</span>
                      <input className="tr-keyinput" type="password" value={apiKey} placeholder={PROVIDERS[aiCfg.provider].keyHint}
                        onChange={(e) => setApiKey(e.target.value)} />
                    </div>
                    <label className="tr-remember">
                      <input type="checkbox" checked={aiCfg.remember} onChange={(e) => saveKeyToggle(e.target.checked)} />
                      <span>Save key on this device</span>
                    </label>
                    <p className="tr-setnote">Stored only here, for you. Get a key at <b>{PROVIDERS[aiCfg.provider].console}</b>.</p>
                  </>
                )}
              </section>

              <section className="tr-section">
                <h3 className="tr-sectitle">Sync · across devices</h3>
                {useProxy ? (
                  <p className="tr-setnote">🔒 Synced through your secure proxy — no token needed. Just turn it on.</p>
                ) : (
                  <>
                    <p className="tr-setnote">Keep your day in step on phone and laptop through a <b>private GitHub gist</b>. Use a token with <b>only the gist scope</b>.</p>
                    <div className="tr-setrow">
                      <span className="tr-setlabel">Token</span>
                      <input className="tr-keyinput" type="password" value={ghToken} placeholder="github_pat_… / ghp_…"
                        onChange={(e) => setGhToken(e.target.value)} />
                    </div>
                  </>
                )}
                {gh.gistId ? (
                  <div className="tr-syncrow">
                    <span className={`tr-syncstat is-${syncState}`}><i className="tr-syncdot" />{syncLabel}</span>
                    <button className="tr-databtn" onClick={syncNow} disabled={syncState === "syncing"}>Sync now</button>
                    <button className="tr-databtn" onClick={disconnectGist}>Disconnect</button>
                  </div>
                ) : (
                  <button className="tr-connect" onClick={connectGist} disabled={syncState === "syncing"}>
                    {syncState === "syncing" ? "Connecting…" : useProxy ? "Turn on sync" : "Connect & sync"}
                  </button>
                )}
                {syncErr && <p className="tr-datamsg tr-syncerr">{syncErr}</p>}
                {gh.gistId && <p className="tr-setnote">Linked gist <b>{gh.gistId.slice(0, 8)}…</b>{useProxy ? " · via your proxy." : " · token stays only in this browser."}</p>}
              </section>

              <section className="tr-section">
                <h3 className="tr-sectitle">Your data</h3>
                <p className="tr-setnote">Everything lives in this browser. Download a backup to keep it safe — or carry it to another device.</p>
                <div className="tr-databtns">
                  <button className="tr-databtn" onClick={exportData}>⤓ Export backup</button>
                  <button className="tr-databtn" onClick={() => importRef.current?.click()}>⤒ Import backup</button>
                  <input ref={importRef} type="file" accept="application/json,.json" hidden
                    onChange={(e) => { importData(e.target.files?.[0]); e.target.value = ""; }} />
                </div>
                {dataMsg && <p className="tr-datamsg">{dataMsg}</p>}
              </section>

            </div>
            <div className="tr-modalfoot">
              <button className="tr-setdone" onClick={() => { setSettingsOpen(false); setDataMsg(""); }}>Done</button>
            </div>
          </div>
        </div>
      )}

      {/* ---------------- TABS ---------------- */}
      <nav className="tr-tabs">
        <button className={`tr-tab ${tab === "today" ? "on" : ""}`} onClick={() => setTab("today")}>Today</button>
        <button className={`tr-tab ${tab === "plan" ? "on" : ""}`} onClick={() => setTab("plan")}>Plan</button>
      </nav>

      {tab === "today" ? (
        <section className="tr-panel" key="today">
         <div className="tr-layout">
          <div className="tr-main">
          {/* date nav */}
          <div className="tr-daynav">
            <button className="tr-arrow" onClick={() => setViewDate(addDays(viewDate, -1))} aria-label="Previous day">‹</button>
            <div className="tr-dayinfo">
              <span className="tr-dayname">{onToday ? <>Today <i>· oggi</i></> : dayLabel(viewDate)}</span>
              <span className="tr-daymeta">{onToday ? dayLabel(viewDate) + " · " : ""}{weekendView ? "Weekend" : "Weekday"}</span>
            </div>
            {!onToday && <button className="tr-todaybtn" onClick={() => setViewDate(new Date())}>Today</button>}
            <button className="tr-arrow" onClick={() => setViewDate(addDays(viewDate, 1))} aria-label="Next day">›</button>
          </div>

          {/* progress */}
          <div className="tr-progress">
            <div className="tr-pbar"><span style={{ width: `${pct}%` }} className={pct === 100 ? "full" : ""} /></div>
            <span className="tr-ptext">{doneCount} / {tpl.length}</span>
          </div>

          {/* rail */}
          <ol className="tr-rail">
            {tpl.map((b, i) => {
              const cat = CATS[b.cat] || CATS.custom;
              const done = !!log.done[b.id];
              const isNow = b.id === currentId;
              const noteOpen = openNote === b.id;
              const today = log.note[b.id] || "";
              return (
                <li key={b.id} className={`tr-block ${done ? "done" : ""} ${isNow ? "now" : ""}`}>
                  <div className="tr-railcol">
                    {i > 0 && <span className="tr-line" />}
                    <span className={`tr-node ${done ? "done" : ""} ${isNow ? "pulse" : ""}`}
                      style={{ "--c": cat.color, borderStyle: cat.dashed ? "dashed" : "solid" }} />
                    {i < tpl.length - 1 && <span className="tr-line" />}
                  </div>

                  <div className="tr-tile" style={{ "--c": cat.color }}>
                    <button className={`tr-check ${done ? "on" : ""}`} role="checkbox" aria-checked={done}
                      onClick={() => toggleDone(b.id)}
                      onKeyDown={(e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); toggleDone(b.id); } }}>
                      <span className="tr-tick">✓</span>
                    </button>
                    <div className="tr-tilebody">
                      <div className="tr-tiletop">
                        <span className="tr-time">{b.time}</span>
                        <span className="tr-tag">{cat.name}</span>
                        {isNow && <span className="tr-live" />}
                      </div>
                      <p className="tr-label">{b.label}</p>
                      {b.note && <p className="tr-note">{b.note}</p>}
                      <button className="tr-notebtn" onClick={() => setOpenNote(noteOpen ? null : b.id)}>
                        {today ? "edit what you did" : "add what you did"}
                      </button>
                      {noteOpen && (
                        <textarea className="tr-noteinput" autoFocus rows={2} value={today}
                          placeholder={b.cat === "dsa" ? "today’s problem + pattern — e.g. ‘Two Sum — hashmap’" : "what actually happened here?"}
                          onChange={(e) => setNote(b.id, e.target.value)} />
                      )}
                      {!noteOpen && today && <p className="tr-donenote">{today}</p>}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
          </div>{/* /tr-main */}

          <aside className="tr-side">

          {/* ---------------- CARTA DEL GIORNO ---------------- */}
          <div className="tr-carta">
            <div className="tr-cartatop">
              <span className="tr-cartamark">❦</span>
              <span className="tr-cartalabel">Carta del giorno</span>
            </div>
            <p className="tr-cartait">{carta.it}</p>
            {carta.en && <p className="tr-cartaen">{carta.en}</p>}
            {(apiKey || useProxy) && (
              <button className="tr-cartadraw" onClick={drawCarta} disabled={cartaBusy}>
                {cartaBusy ? "il consigliere scrive…" : "✦ let il consigliere write today’s"}
              </button>
            )}
          </div>

          {/* ---------------- THE WEEK / STREAK ---------------- */}
          <div className="tr-stats">
            <div className="tr-statshead">
              <h2 className="tr-statstitle">La settimana</h2>
              <span className="tr-streak" title="Consecutive days with at least one block done">
                <span className="tr-flame">♛</span>{streak} day{streak === 1 ? "" : "s"}
              </span>
            </div>
            <div className="tr-week">
              {week.map((d) => {
                const isToday = sameDay(d.date, now);
                const isView = sameDay(d.date, viewDate);
                return (
                  <button key={d.key} className={`tr-wcol ${isView ? "view" : ""}`}
                    title={`${dayLabel(d.date)} — ${d.done}/${d.total}`}
                    onClick={() => { setViewDate(new Date(d.date)); }}>
                    <span className="tr-wtrack">
                      <span className={`tr-wfill ${d.pct === 100 ? "full" : ""}`} style={{ height: `${Math.max(d.pct, d.done ? 8 : 0)}%` }} />
                    </span>
                    <span className={`tr-wday ${isToday ? "on" : ""}`}>
                      {d.date.toLocaleDateString(undefined, { weekday: "narrow" })}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* ---------------- IL CONSIGLIERE ---------------- */}
          <div className="tr-consig">
            <div className="tr-consighead">
              <span className="tr-consigmark">✦</span>
              <div>
                <h2 className="tr-consigtitle">Il Consigliere</h2>
                <p className="tr-consigsub">your advisor — he can see today’s plan</p>
              </div>
            </div>

            <div className="tr-chips">
              <button className="tr-chip" onClick={() => runAI("Sequence my day and name the one thing to protect today.")}>Plan today</button>
              <button className="tr-chip" onClick={() => runAI("Based on today, what exactly should I pre-load tonight for tomorrow’s first IITM and DeckView blocks?")}>Pre-load tonight</button>
              <button className="tr-chip" onClick={() => runAI("Here’s what I did today. Give me one honest, useful reflection — no flattery.")}>Reflect</button>
            </div>

            <div className="tr-askrow">
              <input className="tr-ask" value={aiInput} placeholder="ask your consigliere…"
                onChange={(e) => setAiInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && aiInput.trim()) { runAI(aiInput.trim()); setAiInput(""); } }} />
              <button className="tr-asksend" disabled={!aiInput.trim() || aiBusy} onClick={() => { runAI(aiInput.trim()); setAiInput(""); }}>Ask</button>
            </div>

            {aiBusy && <p className="tr-thinking"><i className="tr-tdot" /> il consigliere riflette…</p>}
            {aiErr && <p className="tr-aierr">{aiErr}</p>}
            {aiOut && !aiBusy && <div className="tr-aiout">{aiOut}</div>}
            {!apiKey && !useProxy && !aiBusy && !aiOut && !aiErr && (
              <p className="tr-aihint">Connect <b>Groq</b> or <b>SambaNova</b> (the ✦ up top) to wake him.</p>
            )}
          </div>

          {/* end of day */}
          <div className="tr-eod">
            <h2 className="tr-eodtitle">End of day</h2>
            {wins.length ? (
              <ul className="tr-wins">{wins.map((b) => (
                <li key={b.id}><span className="tr-wdot" style={{ background: (CATS[b.cat] || CATS.custom).color }} />{b.label}{log.note[b.id] ? <span className="tr-wnote"> — {log.note[b.id]}</span> : ""}</li>
              ))}</ul>
            ) : <p className="tr-empty">Nothing checked yet. Tick blocks as you finish — this becomes your record for the day.</p>}
            <textarea className="tr-reflect" rows={2} value={log.reflection}
              placeholder="one honest line about today — what worked, what slipped, what to pre-load."
              onChange={(e) => setReflection(e.target.value)} />
          </div>

          </aside>{/* /tr-side */}
         </div>{/* /tr-layout */}
        </section>
      ) : (
        <section className="tr-panel" key="plan">
          <div className="tr-plantoggle">
            <button className={`tr-seg ${planSel === "weekday" ? "on" : ""}`} onClick={() => setPlanSel("weekday")}>Weekday</button>
            <button className={`tr-seg ${planSel === "weekend" ? "on" : ""}`} onClick={() => setPlanSel("weekend")}>Weekend</button>
          </div>
          <p className="tr-planhint">Drag the handle to reorder, or use the arrows. Edit times, labels and colour. This is the template — your daily ticks live in <b>Today</b>.</p>
          <PlanList which={planSel} list={templates[planSel]} onEdit={editBlock} onRemove={removeBlock} onMove={moveBlock} />
          <div className="tr-planactions">
            <button className="tr-add" onClick={() => addBlock(planSel)}>+ Add block</button>
            <button className="tr-resetbtn" onClick={() => { if (confirm(`Reset the ${planSel} plan to defaults? Your daily logs stay untouched.`)) resetTemplate(planSel); }}>Reset</button>
          </div>
        </section>
      )}

      <footer className="tr-foot">Saved on this device · Maersk calendar lives in Outlook — this is your layer beside it</footer>
    </div>
  );
}

/* ---------------- Gilded triskele emblem ---------------- */
function Emblem({ activeStream, progress = {} }) {
  const arms = [
    { ang: 90, stream: "IITM", c: CATS.iitm.color },
    { ang: 330, stream: "Maersk", c: CATS.maersk.color },
    { ang: 210, stream: "DeckView", c: CATS.deckview.color },
  ];
  const cx = 50, cy = 50, r = 30, curl = 24;
  const path = (deg) => {
    const a = (deg * Math.PI) / 180;
    const ex = cx + r * Math.cos(a), ey = cy - r * Math.sin(a);
    const mx = cx + r * 0.5 * Math.cos(a), my = cy - r * 0.5 * Math.sin(a);
    const pa = a + Math.PI / 2;
    const ccx = mx + curl * Math.cos(pa), ccy = my - curl * Math.sin(pa);
    return { d: `M${cx} ${cy} Q ${ccx.toFixed(1)} ${ccy.toFixed(1)} ${ex.toFixed(1)} ${ey.toFixed(1)}`, ex, ey };
  };
  return (
    <svg className="tr-emblem" viewBox="0 0 100 100" width="64" height="64" aria-hidden="true">
      <defs>
        <radialGradient id="gold" cx="40%" cy="35%" r="75%">
          <stop offset="0%" stopColor="#F0D67A" /><stop offset="55%" stopColor="#C9A227" /><stop offset="100%" stopColor="#8C6D1F" />
        </radialGradient>
      </defs>
      <circle cx="50" cy="50" r="46" fill="none" stroke="url(#gold)" strokeWidth="1.4" opacity="0.55" />
      <circle cx="50" cy="50" r="40" fill="none" stroke="url(#gold)" strokeWidth="0.7" opacity="0.4" />
      {arms.map((arm) => {
        const p = path(arm.ang);
        const live = activeStream === arm.stream;
        const prog = Math.max(0, Math.min(1, progress[arm.stream] || 0));
        return (
          <g key={arm.stream} className={live ? "tr-armlive" : ""} style={live ? { color: arm.c } : undefined}>
            {/* faint gold base — the unlit arm */}
            <path d={p.d} fill="none" stroke="url(#gold)" strokeWidth="3.4" strokeLinecap="round" opacity="0.45" />
            {/* coloured overlay reveals as that stream's blocks get done */}
            <path d={p.d} fill="none" stroke={arm.c} strokeWidth="3.4" strokeLinecap="round"
              pathLength="1" style={{ strokeDasharray: 1, strokeDashoffset: 1 - prog, transition: "stroke-dashoffset .6s ease" }} />
            <circle cx={p.ex} cy={p.ey} r={live ? 7.5 : 6} fill={arm.c} fillOpacity={0.3 + 0.7 * prog}
              stroke="url(#gold)" strokeWidth="1.6" />
            {live && <circle cx={p.ex} cy={p.ey} r="6" fill="none" stroke={arm.c} strokeWidth="1.4" className="tr-armring" />}
          </g>
        );
      })}
      <circle cx="50" cy="50" r="6.5" fill="url(#gold)" stroke="#8C6D1F" strokeWidth="0.8" />
      <circle cx="48" cy="48" r="2" fill="#FBEFC2" opacity="0.8" />
    </svg>
  );
}

/* ---------------- Plan list (drag reorder) ---------------- */
function PlanList({ which, list, onEdit, onRemove, onMove }) {
  const dragIndex = useRef(null);
  const [over, setOver] = useState(null);
  return (
    <ul className="tr-planlist">
      {list.map((b, i) => {
        const cat = CATS[b.cat] || CATS.custom;
        return (
          <li key={b.id} className={`tr-editrow ${over === i ? "over" : ""}`}
            onDragOver={(e) => { e.preventDefault(); setOver(i); }}
            onDrop={(e) => { e.preventDefault(); const f = dragIndex.current; if (f != null && f !== i) onMove(which, f, i); dragIndex.current = null; setOver(null); }}>
            <span className="tr-handle" draggable onDragStart={(e) => { dragIndex.current = i; e.dataTransfer.effectAllowed = "move"; }}
              onDragEnd={() => { dragIndex.current = null; setOver(null); }} title="Drag to reorder">⠿</span>
            <span className="tr-swatch" style={{ background: cat.color }} />
            <div className="tr-editfields">
              <div className="tr-fieldrow">
                <input className="tr-input tr-itime" value={b.time} onChange={(e) => onEdit(which, b.id, { time: e.target.value })} placeholder="06:30–09:00 / anytime" />
                <select className="tr-input tr-icat" value={b.cat} onChange={(e) => onEdit(which, b.id, { cat: e.target.value })}>
                  {Object.keys(CATS).map((k) => <option key={k} value={k}>{CATS[k].name}</option>)}
                </select>
              </div>
              <input className="tr-input" value={b.label} onChange={(e) => onEdit(which, b.id, { label: e.target.value })} placeholder="Block label" />
              <textarea className="tr-input tr-inote" rows={1} value={b.note} onChange={(e) => onEdit(which, b.id, { note: e.target.value })} placeholder="note / reminder (optional)" />
            </div>
            <div className="tr-editbtns">
              <button className="tr-mini" onClick={() => onMove(which, i, i - 1)} disabled={i === 0} aria-label="Up">↑</button>
              <button className="tr-mini" onClick={() => onMove(which, i, i + 1)} disabled={i === list.length - 1} aria-label="Down">↓</button>
              <button className="tr-mini tr-del" onClick={() => onRemove(which, b.id)} aria-label="Delete">✕</button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/* ============================= STYLES ============================= */
