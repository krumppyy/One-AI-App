import { generateImages } from "./img-engine.js";
import { faceScore } from "./facelock.js";
import { imageChange } from "./image.js";
import { compileEditPrompt, lockCandidate } from "./sdxl-edit.js";

const BEAUTY_TOKENS = "flawless glowing skin, natural makeup, defined eyes, soft flattering light on her face, sharp focus on eyes";

const BODY_MAP = [
  [/big\s*(boobs|breasts|tits)|busty|increase\w*\s*(bust|breast)|enhance\w*\s*(bust|breast|chest)/, "fuller bust, flattering neckline"],
  [/cleavage|deep\s*neckline|plunging/, "deep flattering neckline, enhanced natural cleavage"],
  [/curvy|hourglass|sexy|hot/, "feminine curves, confident pose"],
  [/slim|thin\s*waist|flat\s*(stomach|tummy)/, "slim waist, toned figure"],
  [/tan|tanned/, "sun-kissed tan"],
  [/muscular|fit|athletic/, "fit toned physique"],
];

export function analyzePrompt(basePrompt) {
  const base = String(basePrompt || "");
  const low = base.toLowerCase();
  const beauty = /(look\s*good|beautiful|pretty|gorgeous|stunning|glow|makeup|handsome|hotter)/.test(low);
  const body = [];
  for (const [re, tok] of BODY_MAP) if (re.test(low)) body.push(tok);
  const extras = [beauty ? BEAUTY_TOKENS : "", ...body].filter(Boolean).join(", ");
  return { beauty, body, prompt: [base.trim(), extras].filter(Boolean).join(", ") };
}

const memStats = {};

async function loadStats() {
  try {
    const kv = typeof root !== "undefined" ? root.kv : null;
    const saved = await kv?.["sdxl-ai"]?.get("routes");
    if (saved && typeof saved === "object") return saved;
  } catch {}
  return { ...memStats };
}

async function saveStats(s) {
  Object.assign(memStats, s);
  try {
    const kv = typeof root !== "undefined" ? root.kv : null;
    await kv?.["sdxl-ai"]?.set("routes", s);
  } catch {}
}

function orderRoutes(model, nsfw, stats) {
  const m = String(model || "auto");
  const x = m.endsWith("-nsfw") || nsfw;
  const pool = (m !== "auto" && !m.startsWith("sdxl-")) ? [m]
    : x ? ["explicit-sdxl", "horde-xl", "qwen-21"] : ["horde-xl", "qwen-21"];
  const score = (id) => {
    const st = stats?.[id];
    if (!st || !st.n) return 0.5;
    const okRate = st.ok / st.n;
    const face = (st.face / Math.max(1, st.ok)) / 100;
    const speed = Math.min(1, 120000 / Math.max(30000, st.ms / Math.max(1, st.n)));
    return okRate * 0.5 + face * 0.3 + speed * 0.2;
  };
  return [...pool].sort((a, b) => score(b) - score(a));
}

const ROUTE_TIMEOUT = 7 * 60 * 1000;
const HEDGE_DELAY = 20000;
const ACCEPT_FACE = 60;

export async function aiEdit({
  refBlob, basePrompt = "", preset,
  aspect = "original", sizeId = "S", model = "auto", nsfw = false,
  seed = null, key = "", signal = null, onStage = null,
}) {
  const analyzed = analyzePrompt(basePrompt);
  const { prompt, negative, intent, sceneLock } = compileEditPrompt(analyzed.prompt, preset);
  const stats = await loadStats();
  const routes = orderRoutes(model, nsfw, stats);
  const base = seed != null && Number.isFinite(Number(seed)) ? Math.floor(Number(seed)) : Math.floor(Math.random() * 2 ** 31);
  const want = (await import("./sdxl-edit.js")).INTENTS[intent] || { strength: 0.55 };
  const strength = preset?.strength ?? want.strength;
  let won = null;
  const cands = [];
  const notes = [];
  const ctrls = routes.map(() => new AbortController());
  const stopAll = () => ctrls.forEach((c) => { try { c.abort(); } catch {} });
  if (signal?.aborted) throw Object.assign(new Error("cancelled"), { kind: "cancelled" });
  const onAbort = () => stopAll();
  signal?.addEventListener?.("abort", onAbort);
  const runRoute = async (route, idx) => {
    const ctl = ctrls[idx];
    const t0 = Date.now();
    const s = (base + idx * 104729) % 2 ** 31;
    try {
      onStage?.(route, 0, `strength ${strength.toFixed(2)}`);
      const out = await Promise.race([
        generateImages({
          prompt, negative, mode: "edit", inputBlob: refBlob,
          aspect, sizeId, model: route, count: 1, strength,
          lora: "none", control: "none", seed: s, nsfw, key, signal: ctl.signal, sceneLock,
        }),
        new Promise((_, rej) => setTimeout(() => rej(new Error("route timeout")), ROUTE_TIMEOUT)),
      ]);
      if (won) return null;
      const gen = out.items[0];
      const [fs, ch] = await Promise.all([
        faceScore(refBlob, gen.blob).catch(() => null),
        imageChange(refBlob, gen.blob).catch(() => null),
      ]);
      const score = fs?.score ?? 0;
      const changed = ch?.changed ?? 1;
      const ms = Date.now() - t0;
      const st = stats[route] || (stats[route] = { n: 0, ok: 0, face: 0, ms: 0 });
      st.n++; st.ms += ms;
      const pass = score >= ACCEPT_FACE && (intent !== "relocate" || changed >= 0.02);
      notes.push(`${route}: face ${score}% in ${Math.round(ms / 1000)}s${pass ? " ✓" : ""}`);
      const cand = { gen, score, changed, strength, route, seed: s };
      cands.push(cand);
      if (pass) {
        st.ok++; st.face += score;
        if (!won) {
          won = cand;
          stopAll();
          onStage?.(route, 0, `accepted · face ${score}%`);
        }
      }
      return cand;
    } catch (e) {
      if (ctl.signal.aborted && won) return null;
      notes.push(`${route}: ${e?.message || e}`);
      return null;
    }
  };
  try {
    await Promise.all(routes.map((route, idx) =>
      (idx === 0 ? Promise.resolve() : new Promise((r) => setTimeout(r, HEDGE_DELAY * idx)))
        .then(() => (won || signal?.aborted ? null : runRoute(route, idx)))
    ));
  } finally {
    signal?.removeEventListener?.("abort", onAbort);
  }
  const pick = won || cands.sort((a, b) => b.score - a.score)[0];
  if (!pick) throw new Error(notes[0] || "no SDXL route delivered");
  await saveStats(stats).catch(() => {});
  return await lockCandidate(refBlob, pick, preset, intent, notes);
}
