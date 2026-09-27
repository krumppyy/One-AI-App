import { editorAPI, FILTERS, TRANSITIONS } from "./editor.js";
import { GRADE_PRESETS } from "./grade.js";

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const uid = () => "a" + Math.random().toString(36).slice(2, 9);

const FILTER_IDS = FILTERS.map((f) => f[0]);
const GRADE_IDS = GRADE_PRESETS.map((g) => g.id);
const TR_IDS = TRANSITIONS.map((t) => t[0]).filter((t) => t !== "none");

function log(m) {
  const el = $("edAgentLog");
  if (!el) return;
  el.textContent = new Date().toLocaleTimeString() + "  " + m + "\n" + el.textContent.slice(0, 4000);
}

function busy(on, label) {
  const run = $("edAgentRun"), stop = $("edAgentStop"), enh = $("edAgentEnhance");
  if (run) { run.disabled = on; if (label) run.textContent = label; else run.textContent = "▶ Run agent"; }
  if (stop) stop.hidden = !on;
  if (enh) enh.disabled = on;
}

function chosenPrompt() {
  const use = (document.querySelector('input[name="edAgentUse"]:checked') || {}).value || "original";
  const orig = ($("edAgentPrompt") || {}).value || "";
  const enh = ($("edAgentEnhanced") || {}).value || "";
  if (use === "enhanced" && enh.trim()) return enh.trim();
  if (use === "original" && orig.trim()) return orig.trim();
  return (orig.trim() || enh.trim());
}

function resolveTargets(mode) {
  const S = editorAPI.state;
  if (mode === "all") return [...S.clips];
  if (mode === "videos") return S.clips.filter((c) => c.track === "V1" || c.track === "V2");
  const sel = editorAPI.selClip();
  if (!sel) return [];
  if (mode === "track") return S.clips.filter((c) => c.track === sel.track);
  return [sel];
}

async function enhancePrompt() {
  const src = (($("edAgentPrompt") || {}).value || "").trim();
  if (!src) { log("write your prompt first, then enhance."); return; }
  const gen = root.generateText;
  if (typeof gen !== "function") { log("AI is unavailable — run the original prompt as-is."); return; }
  const btn = $("edAgentEnhance");
  const prev = btn ? btn.textContent : "";
  if (btn) { btn.disabled = true; btn.textContent = "Enhancing…"; }
  let out = "";
  try {
    await gen({
      instruction: `Rewrite this plain-language video-edit request into 2-4 precise edit directives for a timeline editor. Keep the user's intent, name concrete settings (filter, look/grade, speed, volume, transitions, caption text + position). Plain text, no JSON, under 120 words. Request: ${src}`,
      onChunk: (d) => { out += d.textChunk || ""; const t = $("edAgentEnhanced"); if (t) t.value = out; },
    });
    if (!out.trim()) {
      const r = await gen(`Rewrite this video-edit request into precise edit directives, under 120 words. Request: ${src}`);
      out = String((r && r.text) || r || "");
      const t = $("edAgentEnhanced");
      if (t) t.value = out.trim();
    }
    const useEnh = document.querySelector('input[name="edAgentUse"][value="enhanced"]');
    if (useEnh && out.trim()) useEnh.checked = true;
    log("enhanced prompt ready — edit it if you like, then run.");
  } catch (e) {
    log("enhance failed: " + ((e && e.message) || e));
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = prev || "✨ Enhance prompt"; }
  }
}

async function planViaAI(prompt) {
  const gen = root.generateText;
  if (typeof gen !== "function") throw new Error("no AI");
  const vocab = `Filters: ${FILTER_IDS.join(", ")}. Grades: ${GRADE_IDS.join(", ")}. Transitions: ${TR_IDS.join(", ")}.`;
  const raw = await gen(`You drive a timeline video editor. Reply ONLY with JSON, no other text.
${vocab}
Allowed action kinds and shapes:
{"kind":"filter","value":"<one filter id>"}
{"kind":"grade","value":"<one grade id>","strength":0-1}
{"kind":"speed","value":0.25-4}
{"kind":"volume","value":0-1}
{"kind":"transition","value":"<one transition id>","dur":0.1-3}
{"kind":"pip","value":"full|pip"}
{"kind":"addText","text":"caption words","pos":"top|center|bottom"}
{"kind":"trim","edge":"in|out"}
{"kind":"split"}
Return {"actions":[...]} with at most 6 actions. Unknown words become nothing — never invent other kinds.
Request: ${prompt}`);
  const text = String((raw && raw.text) || raw || "");
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("no JSON");
  const obj = JSON.parse(m[0]);
  const acts = Array.isArray(obj.actions) ? obj.actions : [];
  return sanitize(acts).slice(0, 6);
}

function sanitize(acts) {
  const out = [];
  for (const a of acts) {
    if (!a || typeof a !== "object") continue;
    if (a.kind === "filter" && FILTER_IDS.includes(a.value)) out.push({ kind: "filter", value: a.value });
    else if (a.kind === "grade" && GRADE_IDS.includes(a.value)) out.push({ kind: "grade", value: a.value, strength: clamp(Number(a.strength) || 1, 0, 1) });
    else if (a.kind === "speed") { const v = Number(a.value); if (v >= 0.25 && v <= 4) out.push({ kind: "speed", value: v }); }
    else if (a.kind === "volume") { const v = Number(a.value); if (v >= 0 && v <= 1) out.push({ kind: "volume", value: v }); }
    else if (a.kind === "transition" && TR_IDS.includes(a.value)) out.push({ kind: "transition", value: a.value, dur: clamp(Number(a.dur) || 0.4, 0.1, 3) });
    else if (a.kind === "pip" && (a.value === "full" || a.value === "pip")) out.push({ kind: "pip", value: a.value });
    else if (a.kind === "addText" && String(a.text || "").trim()) out.push({ kind: "addText", text: String(a.text).slice(0, 140), pos: ["top", "center", "bottom"].includes(a.pos) ? a.pos : "bottom" });
    else if (a.kind === "trim" && (a.edge === "in" || a.edge === "out")) out.push({ kind: "trim", edge: a.edge });
    else if (a.kind === "split") out.push({ kind: "split" });
  }
  return out;
}

function localPlan(prompt) {
  const t = " " + String(prompt || "").toLowerCase() + " ";
  const acts = [];
  const has = (...ws) => ws.some((w) => t.includes(w));
  const filterMap = [["bw", ["black and white", "b&w", "black-and-white", "grayscale"]], ["noir", ["noir"]], ["sepia", ["sepia"]], ["vintage", ["vintage"]], ["warm", ["warm filter"]], ["cool", ["cool filter"]], ["vivid", ["vivid", "punchy", "saturated"]], ["soft", ["soft glow", "soften", "dreamy"]]];
  for (const [id, words] of filterMap) if (has(...words)) { acts.push({ kind: "filter", value: id }); break; }
  const gradeMap = [["cinematic", ["cinematic"]], ["noir", ["noir grade", "film noir"]], ["vintage", ["vintage look", "retro"]], ["vibrant", ["vibrant"]], ["sunset", ["sunset", "golden hour"]], ["teal", ["teal"]], ["warm", ["warm look", "warmer"]], ["cool", ["cooler", "cool look"]]];
  for (const [id, words] of gradeMap) if (has(...words)) { acts.push({ kind: "grade", value: id, strength: 0.85 }); break; }
  let m = t.match(/(\d+(?:\.\d+)?)\s*x(?:\s*speed)?/);
  if (m) acts.push({ kind: "speed", value: clamp(Number(m[1]), 0.25, 4) });
  else if (has("slow motion", "slow it down", "slower", "slow down")) acts.push({ kind: "speed", value: 0.5 });
  else if (has("speed up", "faster", "timelapse", "time-lapse")) acts.push({ kind: "speed", value: 2 });
  if (has("mute", "silence")) acts.push({ kind: "volume", value: 0 });
  else if (has("quieter", "fade the audio", "lower the volume", "turn it down")) acts.push({ kind: "volume", value: 0.4 });
  else if (has("louder", "turn it up")) acts.push({ kind: "volume", value: 1 });
  if (has("fade in and out", "fade both", "fade in/out")) acts.push({ kind: "transition", value: "fade", dur: 0.5 });
  else { if (has("fade in")) acts.push({ kind: "transition", value: "fade", dur: 0.5 }); if (has("fade out")) acts.push({ kind: "transition", value: "fade", dur: 0.5 }); }
  if (has("wipe")) acts.push({ kind: "transition", value: "wipe", dur: 0.5 });
  if (has("zoom transition")) acts.push({ kind: "transition", value: "zoom", dur: 0.5 });
  if (has("picture-in-picture", "picture in picture", "pip")) acts.push({ kind: "pip", value: "pip" });
  else if (has("fullscreen", "full screen", "full frame")) acts.push({ kind: "pip", value: "full" });
  const q = String(prompt || "").match(/["“]([^"”]{1,140})["”]/);
  if (has("caption", "title", "subtitle", "text overlay", "add text") || q) {
    acts.push({ kind: "addText", text: (q && q[1].trim()) || "Your caption", pos: has("top") ? "top" : has("center", "middle") ? "center" : "bottom" });
  }
  if (has("trim the start", "trim start", "cut the start", "start at the playhead", "trim in")) acts.push({ kind: "trim", edge: "in" });
  if (has("trim the end", "trim end", "cut the end", "end at the playhead", "trim out")) acts.push({ kind: "trim", edge: "out" });
  if (has("split", "cut here", "cut the clip")) acts.push({ kind: "split" });
  return acts.slice(0, 6);
}

function applyAction(c, a, S) {
  switch (a.kind) {
    case "filter": c.filter = a.value; return `filter → ${a.value}`;
    case "grade": c.grade = a.value; c.gk = a.strength; return `look → ${a.value} @ ${a.strength.toFixed(2)}`;
    case "speed": c.speed = a.value; return `speed → ${a.value}x`;
    case "volume": c.vol = a.value; return `volume → ${a.value}`;
    case "transition": c.trIn = a.value; c.trOut = a.value; c.trDur = a.dur; return `transition → ${a.value} ${a.dur}s`;
    case "pip": c.pip = a.value; return `overlay → ${a.value}`;
    case "trim": {
      if (a.edge === "in") {
        if (S.t <= c.start || S.t >= c.start + c.dur) return "trim-in skipped (playhead outside clip)";
        const d = S.t - c.start; c.in += d * c.speed; c.start = S.t; c.dur -= d;
        return `trimmed start to playhead`;
      }
      if (S.t <= c.start || S.t >= c.start + c.dur) return "trim-out skipped (playhead outside clip)";
      c.dur = S.t - c.start;
      return `trimmed end to playhead`;
    }
    default: return "";
  }
}

async function runAgent(signal) {
  const prompt = chosenPrompt();
  if (!prompt) { log("type a prompt first."); return; }
  const S = editorAPI.state;
  if (!S.clips.length) { log("timeline is empty — add a clip first."); return; }
  const targets = resolveTargets(($("edAgentTarget") || {}).value || "selected");
  if (!targets.length) { log("nothing to edit — select a timeline clip first."); return; }
  busy(true, "Planning…");
  log(`planning for ${targets.length} clip${targets.length === 1 ? "" : "s"}…`);
  let actions = [];
  try {
    actions = await planViaAI(prompt);
    if (!actions.length) throw new Error("empty plan");
    log(`AI planned ${actions.length} action${actions.length === 1 ? "" : "s"}.`);
  } catch {
    if (signal.aborted) return;
    actions = localPlan(prompt);
    log(actions.length ? `understood ${actions.length} action${actions.length === 1 ? "" : "s"} from keywords.` : "couldn't map that to an edit — try words like: warm, cinematic, fade, slow down, caption.");
  }
  if (!actions.length || signal.aborted) { busy(false); return; }
  busy(true, "Applying…");
  let applied = 0;
  for (const a of actions) {
    if (signal.aborted) { log("stopped."); break; }
    if (a.kind === "split") {
      const before = S.clips.length;
      editorAPI.splitAt(S.t);
      if (S.clips.length > before) { applied++; log(`split at playhead.`); }
      else log(`split skipped (playhead outside a clip).`);
      continue;
    }
    if (a.kind === "addText") {
      const c = editorAPI.defaultClip("TXT", null);
      c.text = a.text; c.pos = a.pos; c.start = S.t;
      S.clips.push(c); S.sel = c.id; applied++;
      log(`caption added: “${a.text}” (${a.pos}).`);
      continue;
    }
    for (const c of targets) {
      if (signal.aborted) break;
      const msg = applyAction(c, a, S);
      if (msg && !msg.endsWith("(playhead outside clip)")) applied++;
      log(`${c.track} · ${c.name}: ${msg}`);
    }
  }
  editorAPI.afterEdit(`AI agent: ${applied} change${applied === 1 ? "" : "s"} (${targets.length} clip${targets.length === 1 ? "" : "s"})`);
  log(`done — ${applied} change${applied === 1 ? "" : "s"} on ${targets.length} clip${targets.length === 1 ? "" : "s"}.`);
  busy(false);
}

function init() {
  if ($("edAgentBtn") && !$("edAgentBtn").dataset.bound) {
    $("edAgentBtn").dataset.bound = "1";
    $("edAgentBtn").onclick = () => { const o = $("edAgentOverlay"); if (o) o.hidden = false; };
  }
  if ($("edAgentClose") && !$("edAgentClose").dataset.bound) {
    $("edAgentClose").dataset.bound = "1";
    $("edAgentClose").onclick = () => { $("edAgentOverlay").hidden = true; };
  }
  const ov = $("edAgentOverlay");
  if (ov && !ov.dataset.bound) {
    ov.dataset.bound = "1";
    ov.addEventListener("pointerdown", (e) => { if (e.target === ov) ov.hidden = true; });
  }
  if ($("edAgentEnhance") && !$("edAgentEnhance").dataset.bound) {
    $("edAgentEnhance").dataset.bound = "1";
    $("edAgentEnhance").onclick = enhancePrompt;
  }
  if ($("edAgentRun") && !$("edAgentRun").dataset.bound) {
    $("edAgentRun").dataset.bound = "1";
    let ctrl = null;
    $("edAgentRun").onclick = () => { ctrl = new AbortController(); runAgent(ctrl.signal).catch((e) => log("run failed: " + ((e && e.message) || e))).finally(() => busy(false)); };
    $("edAgentStop").onclick = () => { try { ctrl && ctrl.abort(); } catch {} busy(false); log("stopped."); };
  }
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
else init();
