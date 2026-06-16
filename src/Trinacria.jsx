import { useState, useEffect, useRef } from "react";
import { createGist, pullGist, pushGist, mergeState } from "./sync.js";

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
  const p = PROVIDERS[provider];
  const res = await fetch(p.url, {
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
  useEffect(() => { document.body.style.background = appearance === "dark" ? "#0F0B06" : "#FAF3E4"; }, [appearance]);

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

  /* ---- multi-device sync via a private GitHub gist ---- */
  const syncNow = async () => {
    const { token, gistId } = gh;
    if (!token || !gistId) return;
    setSyncState("syncing"); setSyncErr("");
    try {
      const remote = await pullGist(token, gistId);
      const merged = mergeState(snapshotOf(stateRef.current), remote);
      setTemplates(merged.templates);
      setLogs(merged.logs);
      await pushGist(token, gistId, merged);
      setGh((p) => ({ ...p, lastSync: Date.now() }));
      setSyncState("synced");
    } catch (e) { setSyncErr(String(e.message || e)); setSyncState("error"); }
  };
  // keep a stable handle so the debounce effect needn't depend on syncNow
  const syncRef = useRef(syncNow);
  useEffect(() => { syncRef.current = syncNow; });

  const connectGist = async () => {
    const token = ghToken.trim();
    if (!token) { setSyncErr("Paste a token first."); setSyncState("error"); return; }
    setSyncState("syncing"); setSyncErr("");
    try {
      let gistId = gh.gistId;
      if (!gistId) gistId = await createGist(token, snapshotOf(stateRef.current));
      setGh({ token, gistId, lastSync: Date.now() });
      setSyncState("synced");
    } catch (e) { setSyncErr(String(e.message || e)); setSyncState("error"); }
  };
  const disconnectGist = () => {
    setGh({ token: "", gistId: "", lastSync: 0 });
    setGhToken(""); setSyncState("idle"); setSyncErr("");
  };

  // pull + merge once we're connected (covers boot and the moment of connecting)
  useEffect(() => {
    if (loaded && gh.token && gh.gistId) syncRef.current();
  }, [loaded, gh.token, gh.gistId]);
  // debounced push whenever data changes while connected
  useEffect(() => {
    if (!loaded || !gh.token || !gh.gistId) return;
    const id = setTimeout(() => syncRef.current(), 4000);
    return () => clearTimeout(id);
  }, [templates, logs, loaded, gh.token, gh.gistId]);
  const syncLabel = syncState === "syncing" ? "syncing…"
    : syncState === "error" ? "sync error"
    : gh.gistId ? (gh.lastSync ? `synced ${new Date(gh.lastSync).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "connected")
    : "not connected";

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
    if (!apiKey.trim()) { setSettingsOpen(true); setAiErr("Add a key to wake your consigliere."); return; }
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

  const THEME_CYCLE = { auto: "light", light: "notte", notte: "auto" };
  const THEME_ICON = { auto: "◐", light: "☀", notte: "☾" };
  const THEME_NAME = { auto: "Auto — follows the day", light: "Light", notte: "Notte (dark)" };

  return (
    <div className="tr-root" data-phase={tintPhase} data-appearance={appearance}>
      <style>{CSS}</style>
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
        <div className="tr-settings">
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
          <div className="tr-setdivider"><span>Consigliere · AI</span></div>
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
          <div className="tr-setrow">
            <span className="tr-setlabel">API key</span>
            <input className="tr-keyinput" type="password" value={apiKey} placeholder={PROVIDERS[aiCfg.provider].keyHint}
              onChange={(e) => setApiKey(e.target.value)} />
          </div>
          <label className="tr-remember">
            <input type="checkbox" checked={aiCfg.remember} onChange={(e) => saveKeyToggle(e.target.checked)} />
            <span>Save key on this device</span>
          </label>
          <p className="tr-setnote">Stored only here, for you. Get a key at <b>{PROVIDERS[aiCfg.provider].console}</b>. Browser calls can fail on CORS — if so, that’s the provider, not the key.</p>

          <div className="tr-setdivider"><span>Your data</span></div>
          <p className="tr-setnote">Everything lives in this browser only. Download a backup to keep it safe — or move it to another device.</p>
          <div className="tr-databtns">
            <button className="tr-databtn" onClick={exportData}>⤓ Export backup</button>
            <button className="tr-databtn" onClick={() => importRef.current?.click()}>⤒ Import backup</button>
            <input ref={importRef} type="file" accept="application/json,.json" hidden
              onChange={(e) => { importData(e.target.files?.[0]); e.target.value = ""; }} />
          </div>
          {dataMsg && <p className="tr-datamsg">{dataMsg}</p>}

          <div className="tr-setdivider"><span>Sync · across devices</span></div>
          <p className="tr-setnote">Keep your day in step on phone and laptop through a <b>private GitHub gist</b>. Create a token with <b>only the gist scope</b> at <b>github.com/settings/tokens</b>.</p>
          <div className="tr-setrow">
            <span className="tr-setlabel">Token</span>
            <input className="tr-keyinput" type="password" value={ghToken} placeholder="github_pat_… / ghp_…"
              onChange={(e) => setGhToken(e.target.value)} />
          </div>
          {gh.gistId ? (
            <div className="tr-syncrow">
              <span className={`tr-syncstat is-${syncState}`}><i className="tr-syncdot" />{syncLabel}</span>
              <button className="tr-databtn" onClick={syncNow} disabled={syncState === "syncing"}>Sync now</button>
              <button className="tr-databtn" onClick={disconnectGist}>Disconnect</button>
            </div>
          ) : (
            <button className="tr-connect" onClick={connectGist} disabled={syncState === "syncing"}>
              {syncState === "syncing" ? "Connecting…" : "Connect & sync"}
            </button>
          )}
          {syncErr && <p className="tr-datamsg tr-syncerr">{syncErr}</p>}
          {gh.gistId && <p className="tr-setnote">Linked gist <b>{gh.gistId.slice(0, 8)}…</b> · token stays only in this browser. Use a dedicated gist-only token; don’t connect on a shared machine.</p>}

          <button className="tr-setdone" onClick={() => { setSettingsOpen(false); setDataMsg(""); }}>Done</button>
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
            {!apiKey && !aiBusy && !aiOut && !aiErr && (
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
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,500;0,9..144,600;0,9..144,900;1,9..144,500;1,9..144,600&family=Hanken+Grotesk:wght@400;500;600;700&display=swap');

.tr-root{
  --ivory:#FAF3E4; --cream:#FFFCF4; --ink:#33271A; --soft:#7A6A52; --faint:#A89878;
  --border:#EADFC6; --line:#E2D4B6; --gold:#B8912F; --goldlite:#D4AF37; --golddeep:#8C6D1F;
  --shadow:rgba(120,90,40,.13);
  max-width:1180px; margin:26px auto; padding:40px 48px 48px;
  border-radius:22px;
  border:1px solid var(--line);
  box-shadow:0 24px 70px rgba(120,90,40,.18), 0 2px 0 #fff inset;
  background:
    radial-gradient(120% 50% at 50% -6%, #FFF8E9 0%, rgba(255,248,233,0) 55%),
    radial-gradient(60% 40% at 100% 0%, #FBF1D8 0%, rgba(251,241,216,0) 60%),
    var(--ivory);
  color:var(--ink); font-family:"Hanken Grotesk",system-ui,sans-serif;
  -webkit-font-smoothing:antialiased; position:relative;
}
/* gilded inner hairline — the manuscript frame */
.tr-root::before{
  content:""; position:absolute; inset:13px; border-radius:15px; pointer-events:none;
  border:1px solid var(--gold); opacity:.32;
}
.tr-root::after{
  content:""; position:absolute; inset:13px; border-radius:15px; pointer-events:none;
  box-shadow:0 0 0 4px rgba(255,255,255,.35) inset; opacity:.6;
}
.tr-root>*{position:relative;z-index:1;}
.tr-root *{box-sizing:border-box;}
.tr-root ::selection{background:#F0D67A88;}

/* ---- time-of-day phases: an --accent per phase + a morning aura ---- */
.tr-root{--accent:#C9A227;transition:background 1.2s ease,border-color .6s ease;}
.tr-root[data-phase="alba"]{--accent:#E0A500;}
.tr-root[data-phase="giorno"]{--accent:#1F5FA6;}
.tr-root[data-phase="sera"]{--accent:#B85C38;}
.tr-root[data-phase="notte"]{--accent:#D4AF37;}
.tr-aura{position:absolute;inset:0;border-radius:inherit;pointer-events:none;z-index:0;opacity:0;
  background:radial-gradient(58% 38% at 50% 0%, var(--accent), transparent 70%);
  transition:opacity 1.2s ease;}
.tr-root[data-phase="alba"] .tr-aura{opacity:.16;animation:aura 7s ease-in-out infinite;}
.tr-root[data-phase="giorno"] .tr-aura{opacity:.07;}
.tr-root[data-phase="sera"] .tr-aura{opacity:.12;}
.tr-root[data-phase="notte"] .tr-aura{opacity:.10;}
@keyframes aura{0%,100%{opacity:.12;}50%{opacity:.22;}}

/* ---- Notte: a candle-lit dark theme (manual, or auto at night) ---- */
.tr-root[data-appearance="dark"]{
  --ivory:#16110A; --cream:#201A11; --ink:#F2E7CF; --soft:#C9B68E; --faint:#917F60;
  --border:#322817; --line:#3E3220; --shadow:rgba(0,0,0,.55);
  border-color:#3E3220; box-shadow:0 24px 70px rgba(0,0,0,.5);
  background:
    radial-gradient(120% 50% at 50% -6%, #2A2113 0%, rgba(42,33,19,0) 55%),
    radial-gradient(60% 40% at 100% 0%, #241C10 0%, rgba(36,28,16,0) 60%),
    #16110A;
}
.tr-root[data-appearance="dark"]::after{box-shadow:0 0 0 4px rgba(0,0,0,.22) inset;}
.tr-root[data-appearance="dark"] .tr-title{background:linear-gradient(180deg,#F0D67A,#C9A227);
  -webkit-background-clip:text;background-clip:text;}
.tr-root[data-appearance="dark"] .tr-tile{background:var(--cream);}
.tr-root[data-appearance="dark"] .tr-ribbon{background:linear-gradient(180deg,#241C10,#1B1408);}
.tr-root[data-appearance="dark"] .tr-rpill.on{background:#2A2012;}
.tr-root[data-appearance="dark"] .tr-tabs,
.tr-root[data-appearance="dark"] .tr-plantoggle{background:#1B1408;}
.tr-root[data-appearance="dark"] .tr-pbar,
.tr-root[data-appearance="dark"] .tr-wtrack{background:#2A2113;}
.tr-root[data-appearance="dark"] .tr-donenote,
.tr-root[data-appearance="dark"] .tr-streak{background:#2A2012;}
.tr-root[data-appearance="dark"] .tr-stats,
.tr-root[data-appearance="dark"] .tr-consig{background:linear-gradient(160deg,#241C10,#1E1710);}

/* header */
.tr-head{display:flex;align-items:flex-start;gap:16px;margin-bottom:18px;position:relative;}
.tr-emblem{flex:0 0 64px;filter:drop-shadow(0 2px 5px var(--shadow));animation:embin 1s cubic-bezier(.2,.8,.2,1) both;}
@keyframes embin{from{opacity:0;transform:rotate(-40deg) scale(.7);}to{opacity:1;transform:none;}}
.tr-armlive{filter:drop-shadow(0 0 5px currentColor);}
.tr-armring{animation:ring 2.2s ease-out infinite;transform-origin:center;transform-box:fill-box;}
@keyframes ring{0%{opacity:.9;transform:scale(1);}70%{opacity:0;transform:scale(2.4);}100%{opacity:0;}}
.tr-headtext{flex:1;min-width:0;}
.tr-eyebrow{margin:2px 0 0;font-family:"Fraunces",serif;font-style:italic;font-weight:500;
  font-size:13px;letter-spacing:.02em;color:var(--gold);}
.tr-title{margin:1px 0 0;font-family:"Fraunces",serif;font-weight:900;font-size:42px;
  line-height:.95;letter-spacing:-.02em;color:var(--ink);
  background:linear-gradient(180deg,#3a2c1c,#5a4426);-webkit-background-clip:text;background-clip:text;
  animation:rise .8s ease .1s both;}
@keyframes rise{from{opacity:0;transform:translateY(8px);}to{opacity:1;transform:none;}}
.tr-sub{margin:7px 0 0;font-size:13px;line-height:1.5;color:var(--soft);max-width:46ch;}
.tr-headbtns{display:flex;gap:8px;flex:0 0 auto;align-items:center;}
.tr-gear,.tr-theme{width:38px;height:38px;border-radius:50%;
  border:1px solid var(--line);background:var(--cream);color:var(--gold);font-size:16px;
  cursor:pointer;transition:.2s;box-shadow:0 1px 3px var(--shadow);display:flex;align-items:center;justify-content:center;}
.tr-gear:hover{transform:rotate(90deg);border-color:var(--gold);background:#FFF8E4;}
.tr-theme{font-size:17px;}
.tr-theme:hover{border-color:var(--gold);background:#FFF8E4;transform:scale(1.08);}
.tr-root[data-appearance="dark"] .tr-gear:hover,
.tr-root[data-appearance="dark"] .tr-theme:hover{background:#2A2012;}

/* ribbon */
.tr-ribbon{display:flex;flex-wrap:wrap;align-items:center;gap:7px;margin-bottom:20px;
  padding:11px 14px;background:linear-gradient(180deg,#FFFCF2,#FBF4E2);
  border:1px solid var(--line);border-radius:14px;box-shadow:0 1px 3px var(--shadow);
  position:relative;}
.tr-ribbon::before,.tr-ribbon::after{content:"";position:absolute;left:14px;right:14px;height:1px;
  background:linear-gradient(90deg,transparent,var(--gold),transparent);opacity:.4;}
.tr-ribbon::before{top:4px;}.tr-ribbon::after{bottom:4px;}
.tr-rgroup{display:inline-flex;align-items:center;gap:7px;}
.tr-rpill{display:inline-flex;align-items:center;gap:6px;padding:5px 13px;border-radius:999px;
  border:1px solid var(--line);background:var(--cream);font-family:"Fraunces",serif;
  font-weight:600;font-size:14px;color:var(--soft);transition:.22s;letter-spacing:.01em;}
.tr-rpill.on{box-shadow:0 0 0 3px #F0D67A33,0 2px 8px var(--shadow);transform:translateY(-1px);background:#FFF9E8;}
.tr-ora{font-family:"Hanken Grotesk";font-style:normal;font-size:8.5px;font-weight:700;
  text-transform:uppercase;letter-spacing:.12em;opacity:.85;}
.tr-orn{color:var(--gold);font-size:13px;opacity:.7;}
.tr-rpill.loose{font-size:13px;}
.tr-loosehint{font-family:"Fraunces",serif;font-style:italic;color:var(--gold);font-size:12.5px;margin-left:3px;}

/* settings */
.tr-settings{background:var(--cream);border:1px solid var(--gold);border-radius:14px;
  padding:16px 17px;margin-bottom:18px;box-shadow:0 6px 20px var(--shadow);animation:drop .25s ease;}
@keyframes drop{from{opacity:0;transform:translateY(-6px);}to{opacity:1;transform:none;}}
.tr-setrow{display:flex;align-items:center;gap:12px;margin-bottom:11px;}
.tr-setlabel{flex:0 0 78px;font-size:12px;font-weight:600;color:var(--soft);text-transform:uppercase;letter-spacing:.06em;}
.tr-provsel{display:flex;gap:6px;}
.tr-prov{padding:7px 14px;border:1px solid var(--line);background:var(--ivory);border-radius:9px;
  font-size:13px;font-weight:600;color:var(--soft);cursor:pointer;transition:.15s;}
.tr-prov.on{background:var(--ink);color:var(--cream);border-color:var(--ink);}
.tr-modelsel,.tr-keyinput{flex:1;padding:9px 11px;border:1px solid var(--line);border-radius:9px;
  background:var(--ivory);color:var(--ink);font-size:13px;font-family:inherit;}
.tr-remember{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--soft);margin:4px 0 8px;cursor:pointer;}
.tr-remember input{accent-color:var(--gold);width:15px;height:15px;}
.tr-setnote{font-size:11.5px;color:var(--faint);line-height:1.5;margin:0 0 12px;}
.tr-setnote b{color:var(--soft);}
.tr-setdone{padding:9px 18px;background:var(--gold);color:#fff;border:0;border-radius:9px;
  font-size:13px;font-weight:700;cursor:pointer;}
.tr-setdone:hover{background:var(--golddeep);}

/* tabs */
.tr-tabs{display:flex;gap:5px;background:#F3E9D2;border:1px solid var(--line);
  border-radius:12px;padding:5px;margin-bottom:18px;}
.tr-tab{flex:1;padding:10px;border:0;background:transparent;border-radius:8px;cursor:pointer;
  font-family:"Fraunces",serif;font-weight:600;font-size:15px;color:var(--soft);transition:.18s;}
.tr-tab.on{background:var(--cream);color:var(--ink);box-shadow:0 1px 4px var(--shadow);}
.tr-tab:hover:not(.on){color:var(--ink);}

.tr-panel{animation:fade .3s ease;}
@keyframes fade{from{opacity:0;transform:translateY(5px);}to{opacity:1;transform:none;}}

/* ---- two-column sprawl: timeline + consigliere rail ---- */
.tr-layout{display:grid;grid-template-columns:minmax(0,1fr) 384px;gap:30px;align-items:start;}
.tr-main{min-width:0;}
.tr-side{position:sticky;top:24px;display:flex;flex-direction:column;gap:20px;min-width:0;}
.tr-side .tr-consig,.tr-side .tr-eod{margin-top:0;}

/* week / streak */
.tr-stats{padding:16px 18px;border-radius:16px;background:linear-gradient(160deg,#FFFCF2,#F7EFD9);
  border:1px solid var(--line);box-shadow:0 1px 3px var(--shadow);}
.tr-statshead{display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin-bottom:13px;}
.tr-statstitle{margin:0;font-family:"Fraunces",serif;font-style:italic;font-weight:600;font-size:17px;color:var(--ink);letter-spacing:-.01em;}
.tr-streak{display:inline-flex;align-items:center;gap:5px;font-family:"Fraunces",serif;font-weight:600;
  font-size:13px;color:var(--golddeep);background:#FFF6DF;border:1px solid var(--line);
  padding:3px 10px;border-radius:999px;white-space:nowrap;}
.tr-flame{color:var(--gold);font-size:13px;}
.tr-week{display:flex;gap:8px;align-items:end;}
.tr-wcol{flex:1;display:flex;flex-direction:column;align-items:center;gap:6px;background:transparent;
  border:0;cursor:pointer;padding:0;}
.tr-wtrack{width:100%;height:64px;border-radius:8px;background:#EFE3CB;
  box-shadow:inset 0 1px 2px rgba(120,90,40,.12);display:flex;align-items:end;overflow:hidden;}
.tr-wfill{width:100%;border-radius:8px;background:linear-gradient(180deg,var(--goldlite),var(--gold));
  transition:height .5s cubic-bezier(.2,.8,.2,1);min-height:0;}
.tr-wfill.full{background:linear-gradient(180deg,#3A8F63,#2E7D55);}
.tr-wcol.view .tr-wtrack{box-shadow:inset 0 1px 2px rgba(120,90,40,.12),0 0 0 2px var(--gold);}
.tr-wday{font-size:11px;font-weight:700;color:var(--faint);text-transform:uppercase;letter-spacing:.04em;}
.tr-wday.on{color:var(--gold);}
.tr-wcol:hover .tr-wtrack{box-shadow:inset 0 1px 2px rgba(120,90,40,.12),0 0 0 2px color-mix(in srgb,var(--gold) 50%,transparent);}

/* settings: data backup */
.tr-setdivider{display:flex;align-items:center;gap:10px;margin:14px 0 10px;
  font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--faint);}
.tr-setdivider::before,.tr-setdivider::after{content:"";flex:1;height:1px;
  background:linear-gradient(90deg,transparent,var(--line),transparent);}
.tr-databtns{display:flex;gap:8px;margin:0 0 4px;}
.tr-databtn{flex:1;padding:10px;border:1px solid var(--line);background:var(--ivory);color:var(--ink);
  border-radius:9px;font-size:12.5px;font-weight:600;cursor:pointer;transition:.15s;font-family:inherit;}
.tr-databtn:hover{border-color:var(--gold);background:#FFF8E4;}
.tr-datamsg{margin:8px 0 4px;font-size:12px;color:var(--golddeep);font-style:italic;font-family:"Fraunces",serif;}
.tr-syncrow{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:4px 0;}
.tr-syncstat{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;font-weight:600;color:var(--soft);margin-right:auto;}
.tr-syncdot{width:8px;height:8px;border-radius:50%;background:var(--faint);flex:0 0 8px;}
.tr-syncstat.is-syncing .tr-syncdot{background:var(--gold);animation:tdot 1s infinite;}
.tr-syncstat.is-synced .tr-syncdot{background:#2E7D55;}
.tr-syncstat.is-error .tr-syncdot{background:#C8472B;}
.tr-connect{width:100%;padding:11px;border:0;border-radius:9px;background:var(--gold);color:#fff;
  font-size:13px;font-weight:700;cursor:pointer;transition:.15s;font-family:inherit;}
.tr-connect:hover:not(:disabled){background:var(--golddeep);}
.tr-connect:disabled{opacity:.5;cursor:default;}
.tr-syncerr{color:#A53B27;font-style:normal;}

/* date nav */
.tr-daynav{display:flex;align-items:center;gap:10px;margin-bottom:16px;}
.tr-arrow{width:36px;height:36px;border:1px solid var(--line);background:var(--cream);
  color:var(--ink);border-radius:10px;font-size:19px;cursor:pointer;transition:.15s;box-shadow:0 1px 2px var(--shadow);}
.tr-arrow:hover{background:#FFF8E4;border-color:var(--gold);}
.tr-dayinfo{flex:1;display:flex;flex-direction:column;}
.tr-dayname{font-family:"Fraunces",serif;font-weight:600;font-size:21px;letter-spacing:-.01em;line-height:1.1;}
.tr-dayname i{font-weight:500;font-size:15px;color:var(--gold);}
.tr-daymeta{font-size:11.5px;color:var(--faint);text-transform:uppercase;letter-spacing:.07em;margin-top:1px;}
.tr-todaybtn{padding:7px 13px;border:1px solid var(--line);background:var(--cream);color:var(--soft);
  border-radius:9px;font-size:12px;font-weight:600;cursor:pointer;}
.tr-todaybtn:hover{border-color:var(--gold);color:var(--ink);}

/* progress */
.tr-progress{display:flex;align-items:center;gap:13px;margin-bottom:22px;}
.tr-pbar{flex:1;height:7px;background:#EFE3CB;border-radius:999px;overflow:hidden;
  box-shadow:inset 0 1px 2px rgba(120,90,40,.12);}
.tr-pbar span{display:block;height:100%;border-radius:999px;transition:width .5s cubic-bezier(.2,.8,.2,1);
  background:linear-gradient(90deg,var(--goldlite),var(--gold));position:relative;overflow:hidden;}
.tr-pbar span::after{content:"";position:absolute;inset:0;
  background:linear-gradient(90deg,transparent,#fff8,transparent);transform:translateX(-100%);
  animation:sheen 2.6s ease-in-out infinite;}
@keyframes sheen{0%{transform:translateX(-100%);}55%,100%{transform:translateX(220%);}}
.tr-pbar span.full{background:linear-gradient(90deg,#3A8F63,#2E7D55);}
.tr-ptext{font-family:"Fraunces",serif;font-weight:600;font-size:14px;color:var(--soft);white-space:nowrap;}

/* rail */
.tr-rail{list-style:none;margin:0;padding:0;}
.tr-block{display:flex;gap:14px;animation:blkin .45s ease both;}
.tr-block:nth-child(1){animation-delay:.02s}.tr-block:nth-child(2){animation-delay:.06s}
.tr-block:nth-child(3){animation-delay:.10s}.tr-block:nth-child(4){animation-delay:.14s}
.tr-block:nth-child(5){animation-delay:.18s}.tr-block:nth-child(6){animation-delay:.22s}
.tr-block:nth-child(7){animation-delay:.26s}.tr-block:nth-child(8){animation-delay:.30s}
@keyframes blkin{from{opacity:0;transform:translateX(-8px);}to{opacity:1;transform:none;}}
.tr-railcol{display:flex;flex-direction:column;align-items:center;width:18px;flex:0 0 18px;}
.tr-line{width:2px;flex:1;min-height:9px;background:linear-gradient(var(--line),var(--line));}
.tr-node{width:15px;height:15px;border:2.5px solid var(--c);border-radius:50%;flex:0 0 15px;
  background:var(--cream);transition:.25s;position:relative;}
.tr-node.done{background:var(--c);animation:pop .45s cubic-bezier(.2,1.4,.4,1);}
.tr-node.done::after{content:"";position:absolute;inset:-4px;border-radius:50%;
  border:2px solid var(--c);animation:burst .55s ease-out;}
@keyframes pop{0%{transform:scale(.7);}55%{transform:scale(1.25);}100%{transform:scale(1);}}
@keyframes burst{0%{opacity:.7;transform:scale(.6);}100%{opacity:0;transform:scale(2);}}
.tr-node.pulse{box-shadow:0 0 0 0 var(--c);animation:npulse 2.2s infinite;}
@keyframes npulse{0%{box-shadow:0 0 0 0 color-mix(in srgb,var(--c) 55%,transparent);}70%{box-shadow:0 0 0 9px transparent;}100%{box-shadow:0 0 0 0 transparent;}}

.tr-tile{flex:1;display:flex;gap:13px;padding:14px 15px;margin-bottom:11px;border-radius:14px;
  background:linear-gradient(180deg,var(--cream),#FFFAEF);
  border:1px solid var(--border);border-left:4px solid var(--c);
  box-shadow:0 1px 3px var(--shadow);transition:transform .2s,box-shadow .2s,border-color .2s;}
.tr-tile:hover{transform:translateY(-2px);box-shadow:0 6px 16px var(--shadow);border-left-width:6px;}
.tr-block.done .tr-tile{opacity:.66;}
.tr-block.done .tr-label{text-decoration:line-through;text-decoration-color:var(--faint);}
.tr-block.now .tr-tile{border-color:color-mix(in srgb,var(--c) 45%,var(--border));
  box-shadow:0 0 0 1px color-mix(in srgb,var(--c) 30%,transparent),0 4px 14px var(--shadow);}

.tr-check{flex:0 0 24px;width:24px;height:24px;border:2px solid var(--line);border-radius:8px;
  background:var(--ivory);cursor:pointer;display:flex;align-items:center;justify-content:center;
  margin-top:1px;transition:.18s;}
.tr-check:hover{border-color:var(--c);}
.tr-check.on{background:var(--c);border-color:var(--c);}
.tr-tick{color:#fff;font-size:14px;font-weight:800;line-height:1;opacity:0;transform:scale(.4);transition:.2s;}
.tr-check.on .tr-tick{opacity:1;transform:scale(1);}

.tr-tilebody{flex:1;min-width:0;}
.tr-tiletop{display:flex;align-items:center;gap:9px;margin-bottom:4px;flex-wrap:wrap;}
.tr-time{font-family:"Fraunces",serif;font-weight:600;font-size:13px;color:var(--soft);font-variant-numeric:tabular-nums;}
.tr-tag{font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.09em;
  color:var(--c);padding:2px 8px;border:1px solid color-mix(in srgb,var(--c) 40%,transparent);border-radius:5px;}
.tr-live{width:7px;height:7px;border-radius:50%;background:var(--c);animation:blink 1.5s infinite;}
@keyframes blink{0%,100%{opacity:1;}50%{opacity:.25;}}
.tr-label{margin:0;font-family:"Fraunces",serif;font-weight:600;font-size:17px;line-height:1.3;color:var(--ink);letter-spacing:-.005em;}
.tr-note{margin:5px 0 0;font-size:12.5px;color:var(--soft);line-height:1.5;}
.tr-notebtn{margin-top:9px;background:transparent;border:0;color:var(--gold);font-size:11.5px;
  font-weight:600;cursor:pointer;padding:0;letter-spacing:.02em;border-bottom:1px solid transparent;transition:.15s;}
.tr-notebtn:hover{border-bottom-color:var(--gold);}
.tr-noteinput,.tr-reflect,.tr-ask{width:100%;background:var(--ivory);border:1px solid var(--line);
  border-radius:10px;color:var(--ink);padding:10px 12px;font-size:13px;font-family:inherit;line-height:1.5;resize:vertical;}
.tr-noteinput{margin-top:9px;}
.tr-noteinput:focus,.tr-reflect:focus,.tr-ask:focus,.tr-input:focus{outline:none;border-color:var(--gold);box-shadow:0 0 0 3px #F0D67A33;}
.tr-donenote{margin:8px 0 0;font-size:12.5px;color:var(--ink);background:#FFF6DF;
  border-left:2px solid var(--gold);border-radius:0 7px 7px 0;padding:8px 11px;line-height:1.5;}

/* consigliere */
.tr-consig{margin-top:24px;padding:18px 18px 16px;border-radius:16px;position:relative;
  background:linear-gradient(160deg,#FCF6E6,#F7EFD9);border:1px solid var(--gold);
  box-shadow:0 4px 18px var(--shadow);overflow:hidden;}
.tr-consig::before{content:"";position:absolute;inset:0;pointer-events:none;
  background:radial-gradient(80% 50% at 90% -10%, #F0D67A22, transparent 60%);}
.tr-consighead{display:flex;align-items:center;gap:12px;margin-bottom:13px;}
.tr-consigmark{width:38px;height:38px;flex:0 0 38px;border-radius:50%;display:flex;align-items:center;justify-content:center;
  background:radial-gradient(circle at 38% 32%,#F0D67A,#C9A227 60%,#8C6D1F);color:#fff;font-size:17px;
  box-shadow:0 2px 6px var(--shadow);}
.tr-consigtitle{margin:0;font-family:"Fraunces",serif;font-weight:600;font-size:19px;color:var(--ink);letter-spacing:-.01em;}
.tr-consigsub{margin:1px 0 0;font-family:"Fraunces",serif;font-style:italic;font-size:12.5px;color:var(--gold);}
.tr-chips{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:11px;}
.tr-chip{padding:8px 14px;border:1px solid var(--line);background:var(--cream);border-radius:999px;
  font-size:12.5px;font-weight:600;color:var(--ink);cursor:pointer;transition:.18s;}
.tr-chip:hover{background:var(--ink);color:var(--cream);border-color:var(--ink);transform:translateY(-1px);}
.tr-askrow{display:flex;gap:8px;}
.tr-ask{flex:1;}
.tr-asksend{padding:0 18px;border:0;border-radius:10px;background:var(--gold);color:#fff;
  font-weight:700;font-size:13px;cursor:pointer;transition:.15s;}
.tr-asksend:hover:not(:disabled){background:var(--golddeep);}
.tr-asksend:disabled{opacity:.4;cursor:default;}
.tr-thinking{margin:13px 0 0;font-family:"Fraunces",serif;font-style:italic;font-size:13.5px;color:var(--gold);display:flex;align-items:center;gap:8px;}
.tr-tdot{width:8px;height:8px;border-radius:50%;background:var(--gold);animation:tdot 1s infinite;}
@keyframes tdot{0%,100%{opacity:.3;transform:scale(.8);}50%{opacity:1;transform:scale(1.2);}}
.tr-aierr{margin:13px 0 0;font-size:12.5px;color:#A53B27;background:#FBE9E2;border:1px solid #E8C4B8;
  border-radius:9px;padding:9px 11px;line-height:1.5;}
.tr-aiout{margin:13px 0 0;font-size:13.5px;line-height:1.65;color:var(--ink);white-space:pre-wrap;
  background:var(--cream);border:1px solid var(--line);border-radius:11px;padding:13px 15px;
  position:relative;animation:fade .3s ease;}
.tr-aihint{margin:11px 0 0;font-size:12.5px;color:var(--soft);line-height:1.5;}

/* end of day */
.tr-eod{margin-top:22px;padding:17px 18px;border-radius:15px;background:var(--cream);
  border:1px solid var(--border);box-shadow:0 1px 3px var(--shadow);}
.tr-eodtitle{margin:0 0 12px;font-family:"Fraunces",serif;font-weight:600;font-size:18px;letter-spacing:-.01em;}
.tr-wins{list-style:none;margin:0 0 13px;padding:0;}
.tr-wins li{display:flex;align-items:baseline;gap:9px;font-size:13.5px;padding:5px 0;line-height:1.45;}
.tr-wdot{width:7px;height:7px;border-radius:50%;flex:0 0 7px;transform:translateY(-1px);}
.tr-wnote{color:var(--soft);}
.tr-empty{margin:0 0 13px;font-size:13px;color:var(--soft);line-height:1.55;}

/* plan editor */
.tr-plantoggle{display:flex;gap:5px;background:#F3E9D2;border:1px solid var(--line);
  border-radius:11px;padding:5px;margin-bottom:13px;max-width:250px;}
.tr-seg{flex:1;padding:9px;border:0;background:transparent;border-radius:8px;cursor:pointer;
  font-family:"Fraunces",serif;font-weight:600;font-size:14px;color:var(--soft);}
.tr-seg.on{background:var(--cream);color:var(--ink);box-shadow:0 1px 3px var(--shadow);}
.tr-planhint{font-size:12.5px;color:var(--soft);line-height:1.55;margin:0 0 16px;}
.tr-planlist{list-style:none;margin:0;padding:0;}
.tr-editrow{display:flex;align-items:flex-start;gap:10px;background:var(--cream);
  border:1px solid var(--border);border-radius:13px;padding:12px;margin-bottom:10px;transition:.15s;position:relative;}
.tr-editrow.over{border-color:var(--gold);box-shadow:0 -2px 0 var(--gold);}
.tr-handle{cursor:grab;color:var(--faint);font-size:17px;line-height:1.5;user-select:none;padding:0 2px;}
.tr-handle:active{cursor:grabbing;}
.tr-swatch{width:4px;align-self:stretch;border-radius:3px;flex:0 0 4px;margin-top:2px;}
.tr-editfields{flex:1;display:flex;flex-direction:column;gap:7px;min-width:0;}
.tr-fieldrow{display:flex;gap:7px;}
.tr-input{background:var(--ivory);border:1px solid var(--line);border-radius:9px;color:var(--ink);
  padding:9px 11px;font-size:13px;font-family:inherit;width:100%;}
.tr-itime{flex:1;}.tr-icat{flex:0 0 110px;cursor:pointer;}.tr-inote{resize:vertical;line-height:1.45;}
.tr-editbtns{display:flex;flex-direction:column;gap:5px;}
.tr-mini{width:30px;height:30px;border:1px solid var(--line);background:var(--ivory);color:var(--soft);
  border-radius:8px;font-size:13px;cursor:pointer;transition:.12s;}
.tr-mini:hover:not(:disabled){background:#FFF8E4;color:var(--ink);border-color:var(--gold);}
.tr-mini:disabled{opacity:.3;cursor:default;}
.tr-del:hover{color:#C8472B;border-color:#C8472B66;}
.tr-planactions{display:flex;gap:10px;margin-top:14px;}
.tr-add{flex:1;padding:12px;border:1px dashed var(--gold);background:transparent;color:var(--gold);
  border-radius:11px;font-family:"Fraunces",serif;font-weight:600;font-size:14px;cursor:pointer;transition:.15s;}
.tr-add:hover{background:#FFF8E4;}
.tr-resetbtn{padding:12px 16px;border:1px solid var(--line);background:var(--cream);color:var(--soft);
  border-radius:11px;font-size:12.5px;font-weight:600;cursor:pointer;}
.tr-resetbtn:hover{color:var(--ink);}

.tr-foot{margin-top:28px;font-family:"Fraunces",serif;font-style:italic;font-size:12px;
  color:var(--faint);text-align:center;line-height:1.6;}

/* tabs: a centered jewel rather than a stretched bar */
.tr-tabs{max-width:480px;margin-left:auto;margin-right:auto;}

/* plan editor uses the width too — two columns on desktop */
.tr-planlist{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:11px;}
.tr-editrow{margin-bottom:0;}
.tr-planhint,.tr-plantoggle{max-width:680px;}

/* grandeur on wide screens */
@media (min-width:1000px){
  .tr-title{font-size:50px;}
  .tr-sub{font-size:14px;}
}

/* collapse the sprawl back to one column */
@media (max-width:900px){
  .tr-root{max-width:680px;padding:30px 24px 44px;}
  .tr-layout{grid-template-columns:1fr;gap:24px;}
  .tr-side{position:static;}
  .tr-planlist{grid-template-columns:1fr;}
}

@media (max-width:560px){
  .tr-root{padding:20px 14px 38px;margin:10px auto;border-radius:16px;}
  .tr-root::before,.tr-root::after{inset:8px;}
  .tr-title{font-size:34px;}
  .tr-emblem{flex-basis:54px;width:54px;height:54px;}
  .tr-icat{flex-basis:92px;}
  .tr-gear{width:34px;height:34px;}
  .tr-databtns{flex-direction:column;}
}
@media (prefers-reduced-motion:reduce){
  .tr-emblem,.tr-armring,.tr-node,.tr-block,.tr-pbar span::after,.tr-live,.tr-tdot,.tr-title,.tr-panel,.tr-node.done::after,.tr-aura{animation:none!important;}
  .tr-tile{transition:none;}
}
`;
