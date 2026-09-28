import { ANKI_CPU_MODELS, renderLabImage, trainCpuModel, absorbScenario, paletteDiversity } from "./anki-cpu.js";

const LS = "devInsight.v1";
const CYCLE_MS = 5000;

const HUMAN_ROLES = ["street vendor", "mountain guide", "night-shift nurse", "retired sailor", "tea-shop owner", "marathon runner", "librarian", "fisherman", "street musician", "baker", "astronaut trainee", "gardener"];
const HUMAN_EXPR = ["soft smile", "loud laugh", "quiet gaze", "surprised look", "sleepy eyes", "determined stare", "shy glance", "joyful grin"];
const HUMAN_OUTFIT = ["denim jacket", "linen shirt", "wool sweater", "leather coat", "white tee", "floral dress", "hoodie", "uniform", "raincoat", "silk scarf"];
const HUMAN_LIGHT = ["golden hour", "neon night", "overcast noon", "candlelight", "harsh flash", "blue dawn"];
const HUMAN_BG = ["#2e3440", "#3b2f2f", "#1d2433", "#243324", "#33242e", "#242b33"];
const HUMAN_CLOTH = ["#3d5a80", "#ee6c4d", "#98c1d9", "#6a994e", "#9d4edd", "#e9c46a", "#f4a261", "#2a9d8f", "#e76f51", "#577590"];

const MAGE_SCHOOL = ["pyromancer", "cryomancer", "stormcaller", "necromancer", "druid", "chronomancer", "illusionist", "geomancer"];
const MAGE_ELEMENT = ["ember", "frost", "lightning", "shadow", "vine", "sand", "mist", "crystal"];
const MAGE_STAFF = ["gnarled oak staff", "crystal orb staff", "bone wand", "serpent rod", "lantern staff", "twin daggers"];
const MAGE_AURA = ["#ff9a3c", "#7fd4ff", "#ffe66d", "#9d4edd", "#80ff9d", "#ff5d5d"];
const MAGE_ROBE = ["#2b2140", "#4a2c6e", "#7b2d26", "#1f3a5f", "#14301e", "#3d1f2e"];
const MAGE_HAIR = ["#d8d8d8", "#8a2be2", "#b56a2e", "#3b3b45", "#e8e3da", "#5a3a22"];

function mulberry(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export function scenarioFor(modelId, cycle) {
  const r = mulberry((cycle * 2654435761 + hashStr(modelId)) >>> 0);
  const pick = a => a[Math.floor(r() * a.length)];
  if (modelId === "iani-mage-cpu") {
    const school = pick(MAGE_SCHOOL), element = pick(MAGE_ELEMENT), staff = pick(MAGE_STAFF);
    const aura = pick(MAGE_AURA), robe = pick(MAGE_ROBE), hair = pick(MAGE_HAIR);
    return {
      label: `${school} of ${element} · ${staff}`,
      prompt: `${school} portrait channeling ${element}, carrying ${staff}`,
      target: { cloth: robe, bg: "#14101f", glow: aura, hair }
    };
  }
  const role = pick(HUMAN_ROLES), expr = pick(HUMAN_EXPR), outfit = pick(HUMAN_OUTFIT), light = pick(HUMAN_LIGHT);
  return {
    label: `${role} · ${expr} · ${outfit} · ${light}`,
    prompt: `${role} portrait, ${expr}, wearing ${outfit}, ${light}`,
    target: { cloth: pick(HUMAN_CLOTH), bg: pick(HUMAN_BG) }
  };
}

function seedState() {
  return {
    summary: "Session 1: opened AI Model Lab Train, built two CPU portrait models (anki-human-cpu-v1, iani-mage-cpu-v1). Hunted 3 real portraits (randomuser.me) + generated 1 anime human and 3 mage refs. Trained 5 epochs each on-device (human loss 0.117→0.039, mage 0.145→0.082). Listed both in Image tab under group Lab. Session 2: added locked Dev Insight tab + endless scenario trainer.",
    task: "Awaiting owner verdict on v1 samples. Next: generate several human images in the Image tab with anki-human-cpu.",
    changes: [
      { t: Date.now(), by: "builder", text: "Created src/anki-cpu.js — CPU human + mage portrait models, training, renderer" },
      { t: Date.now(), by: "builder", text: "Listed anki-human-cpu + iani-mage-cpu in Image tab (group Lab) via src/img-engine.js" },
      { t: Date.now(), by: "builder", text: "Added CPU Human & Mage Lab panel to AI Model Lab page" },
      { t: Date.now(), by: "builder", text: "Trained both models 5 epochs, loss curves verified, samples rendered" },
      { t: Date.now(), by: "builder", text: "Created Dev Insight tab (owner-locked) + endless scenario trainer" }
    ],
    train: [
      { t: Date.now(), text: "anki-human-cpu: 5 epochs, loss 0.1172 → 0.0385" },
      { t: Date.now(), text: "iani-mage-cpu: 5 epochs, loss 0.1447 → 0.0819" }
    ],
    endless: { running: false, model: "anki-human-cpu", cycle: 0, seenLabels: [], lastScenario: "", lastThumb: "", div: [], consolidations: 0 },
    updatedAt: Date.now()
  };
}

let S = null;
try {
  const raw = localStorage.getItem(LS);
  S = raw ? JSON.parse(raw) : seedState();
  if (!S.endless) S = seedState();
} catch { S = seedState(); }

let kvTimer = 0;
function persist() {
  S.updatedAt = Date.now();
  try { localStorage.setItem(LS, JSON.stringify(S)); } catch {}
  clearTimeout(kvTimer);
  kvTimer = setTimeout(async () => {
    try {
      const kv = (typeof root !== "undefined" && root.kv) ? root.kv : null;
      if (kv) await kv.devInsight.set("state", S);
    } catch {}
  }, 2000);
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function fmtT(t) {
  try { return new Date(t).toLocaleString(); } catch { return ""; }
}

export function renderDevInsight() {
  const body = document.getElementById("devInsightBody");
  if (body) {
    const ch = [...S.changes].reverse().slice(0, 60);
    const tr = [...S.train].reverse().slice(0, 60);
    body.innerHTML = `
      <div class="field"><label class="lbl">Chat summary <span class="hint">auto-kept</span></label>
        <div class="model-note">${esc(S.summary)}</div></div>
      <div class="field"><label class="lbl">Doing right now</label>
        <div class="model-note"><b>${esc(S.task)}</b></div></div>
      <div class="field"><label class="lbl">Current changes <span class="hint">${S.changes.length} atomic commits</span></label>
        <div class="logbox mono dev-log">${ch.map(c => `<div>[${fmtT(c.t)}] <b>${esc(c.by)}</b> — ${esc(c.text)}</div>`).join("") || "<div>—</div>"}</div></div>
      <div class="field"><label class="lbl">Training ledger</label>
        <div class="logbox mono dev-log">${tr.map(c => `<div>[${fmtT(c.t)}] ${esc(c.text)}</div>`).join("") || "<div>—</div>"}</div></div>
      <div class="hint-block">Updated atomically · ${fmtT(S.updatedAt)} · mirrored to device kv</div>`;
  }
  const eb = document.getElementById("devEndlessBody");
  if (eb && !eb.dataset.bound) {
    eb.dataset.bound = "1";
    eb.innerHTML = `
      <div class="field"><label class="lbl">Model</label><select id="devEndlessModel">
        ${ANKI_CPU_MODELS.map(m => `<option value="${m.id}">${esc(m.label)}</option>`).join("")}
      </select></div>
      <div class="row-between"><span class="mono tiny" id="devEndlessStats">cycle 0 · 0 scenarios</span>
      <span class="mono tiny" id="devEndlessDiv">diversity —</span></div>
      <canvas id="devEndlessCurve" width="260" height="54" class="anki-curve"></canvas>
      <div class="result-actions">
        <button id="devEndlessBtn" class="btn btn-primary btn-tiny" type="button">Start endless</button>
        <button id="devEndlessStep" class="btn btn-ghost btn-tiny" type="button">1 cycle now</button>
      </div>
      <div class="mono tiny" id="devEndlessScenario">idle — scenarios are endless role/expression/outfit (human) and school/element/staff (mage) combos</div>
      <div class="anki-prev" id="devEndlessThumb"></div>
      <div class="logbox mono dev-log" id="devEndlessLog" style="max-height:150px"></div>`;
    document.getElementById("devEndlessModel").value = S.endless.model;
    document.getElementById("devEndlessModel").onchange = e => commit(s => { s.endless.model = e.target.value; });
    document.getElementById("devEndlessBtn").onclick = () => (S.endless.running ? stopEndless() : startEndless());
    document.getElementById("devEndlessStep").onclick = () => endlessCycle();
    syncEndlessUI();
  } else if (eb) syncEndlessUI();
  const st = document.getElementById("devEndlessState");
  if (st) st.textContent = S.endless.running ? `dreaming · cycle ${S.endless.cycle}` : "idle";
}

function syncEndlessUI() {
  const e = S.endless;
  const stats = document.getElementById("devEndlessStats");
  if (stats) stats.textContent = `cycle ${e.cycle} · ${e.seenLabels.length}+ scenarios · ${e.consolidations} consolidations`;
  const d = document.getElementById("devEndlessDiv");
  if (d && e.div.length) d.textContent = "diversity " + e.div[e.div.length - 1];
  const sc = document.getElementById("devEndlessScenario");
  if (sc && e.lastScenario) sc.textContent = "last: " + e.lastScenario;
  const btn = document.getElementById("devEndlessBtn");
  if (btn) btn.textContent = e.running ? "Pause endless" : "Start endless";
  const cv = document.getElementById("devEndlessCurve");
  if (cv && e.div.length > 1) {
    const x = cv.getContext("2d");
    x.clearRect(0, 0, cv.width, cv.height);
    const mx = Math.max(...e.div), mn = Math.min(...e.div), rg = Math.max(1e-4, mx - mn);
    x.strokeStyle = "#b388ff"; x.lineWidth = 1.6; x.beginPath();
    e.div.slice(-60).forEach((v, i, a) => {
      const px = 6 + (i / Math.max(1, a.length - 1)) * (cv.width - 12);
      const py = 6 + (1 - (v - mn) / rg) * (cv.height - 12);
      i ? x.lineTo(px, py) : x.moveTo(px, py);
    });
    x.stroke();
  }
}

export function commit(fn) {
  fn(S);
  persist();
  renderDevInsight();
  return S;
}

export function pushChange(by, text) {
  return commit(s => { s.changes.push({ t: Date.now(), by, text }); if (s.changes.length > 300) s.changes.splice(0, s.changes.length - 300); });
}

export function pushTrain(text) {
  return commit(s => { s.train.push({ t: Date.now(), text }); if (s.train.length > 300) s.train.splice(0, s.train.length - 300); });
}

export function setTask(t) { return commit(s => { s.task = t; }); }
export function setSummary(t) { return commit(s => { s.summary = t; }); }
export function snapshot() { return JSON.parse(JSON.stringify(S)); }

let timer = 0;
let cycling = false;

export function startEndless(modelId) {
  commit(s => {
    s.endless.running = true;
    if (modelId) s.endless.model = modelId;
  });
  const sel = document.getElementById("devEndlessModel");
  if (sel) sel.value = S.endless.model;
  clearInterval(timer);
  timer = setInterval(() => { endlessCycle(); }, CYCLE_MS);
  endlessCycle();
}

export function stopEndless() {
  clearInterval(timer);
  timer = 0;
  commit(s => { s.endless.running = false; });
  pushChange("trainer", `Endless paused at cycle ${S.endless.cycle} (${S.endless.model})`);
}

export async function endlessCycle() {
  if (cycling) return;
  cycling = true;
  try {
    const model = S.endless.model;
    const cycle = S.endless.cycle + 1;
    const sc = scenarioFor(model, cycle);
    const r = await renderLabImage({ prompt: sc.prompt, seed: hashStr(model + cycle) % 2 ** 31, w: 256, h: 256, modelId: model });
    absorbScenario(model, sc.target, 0.06);
    let div = +paletteDiversity(model).toFixed(4);
    if (div < 0.08) {
      const { injectJitter } = await import("./anki-cpu.js").catch(() => ({}));
      if (injectJitter) { injectJitter(model); div = +paletteDiversity(model).toFixed(4); }
    }
    let extra = "";
    if (cycle % 6 === 0) {
      const t = await trainCpuModel(model, { epochs: 1 });
      extra = ` · consolidated (loss ${t.weights.loss[t.weights.loss.length - 1]})`;
      pushTrain(`${model}: endless consolidation epoch ${t.weights.epochs}${extra}`);
    }
    const thumb = await new Promise(res => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement("canvas"); c.width = 128; c.height = 128;
        c.getContext("2d").drawImage(img, 0, 0, 128, 128);
        res(c.toDataURL("image/jpeg", 0.7));
      };
      img.onerror = () => res("");
      img.src = URL.createObjectURL(r.blob);
    });
    commit(s => {
      s.endless.cycle = cycle;
      s.endless.lastScenario = `#${cycle} ${sc.label}${extra}`;
      s.endless.lastThumb = thumb;
      s.endless.div.push(div);
      if (s.endless.div.length > 120) s.endless.div.shift();
      if (!s.endless.seenLabels.includes(sc.label)) {
        s.endless.seenLabels.push(sc.label);
        if (s.endless.seenLabels.length > 500) s.endless.seenLabels.shift();
      }
      if (cycle % 6 === 0) s.endless.consolidations++;
      s.train.push({ t: Date.now(), text: `dream #${cycle} [${model}]: ${sc.label} · div ${div}${extra}` });
      if (s.train.length > 300) s.train.splice(0, s.train.length - 300);
    });
    const th = document.getElementById("devEndlessThumb");
    if (th && thumb && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(thumb)) {
      th.textContent = "";
      const img = document.createElement("img");
      img.src = thumb;
      img.alt = "dream";
      th.appendChild(img);
    }
    const lg = document.getElementById("devEndlessLog");
    if (lg) {
      const d = document.createElement("div");
      d.textContent = `#${cycle} ${sc.label} · div ${div}${extra}`;
      lg.prepend(d);
      while (lg.children.length > 40) lg.lastChild.remove();
    }
  } catch (e) {
    pushTrain(`endless cycle failed: ${e?.message || e}`);
    if (!S.endless.running) { cycling = false; return; }
  }
  cycling = false;
}

function mount() {
  if (!document.getElementById("pageDevInsight")) return;
  renderDevInsight();
  window.DevInsight = { push: pushChange, train: pushTrain, setTask, setSummary, commit, snapshot, startEndless, stopEndless, endlessCycle, scenarioFor };
}

if (typeof document !== "undefined") {
  if (document.readyState !== "loading") setTimeout(mount, 400);
  else document.addEventListener("DOMContentLoaded", () => setTimeout(mount, 400));
  new MutationObserver(() => { if (!window.DevInsight) mount(); }).observe(document.documentElement, { childList: true, subtree: true });
}
