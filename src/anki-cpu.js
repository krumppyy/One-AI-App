export const ANKI_CPU_MODELS = [
  {
    id: "anki-human-cpu",
    name: "anki-human-cpu-v1",
    label: "Anki-Human CPU v1",
    kind: "human",
    desc: "CPU human portrait generator. Trains on-device from reference photos.",
    refs: [
      "https://user.uploads.dev/file/c7ad4763df7663a816f3f16ce0e1682c.jpg",
      "https://user.uploads.dev/file/abf702109f9bb5bd609d5524baf5304b.jpg",
      "https://user.uploads.dev/file/8fdf3a18227ed5d7983b41f7dc32b4da.jpg",
      "https://user.uploads.dev/file/5aa9b66f51f1f64e99e12376a3a86369.jpg",
      "https://user.uploads.dev/file/f9ba254d50e1aa69e0f7974c790f4727.jpg",
      "https://user.uploads.dev/file/38fb4a60a840bc9147046e791fa3acbf.jpg",
      "https://user.uploads.dev/file/94a16c796d3b8e2dd99280d866da2f0f.jpg",
      "https://user.uploads.dev/file/364119dbd29b9f18f2fb37fa00d3ad92.jpg",
      "https://user.uploads.dev/file/b47a2b4a0586d60dc3997ed49b5adfb8.jpg",
      "https://user.uploads.dev/file/c2ffe091cdee6d8520953ed0ea3192a4.jpg",
      "https://user.uploads.dev/file/4c16b0dbd2dfa905e4466f0f0c2416c1.jpg",
      "https://user.uploads.dev/file/0addfcb04be47dc8ddf04173ad2f73dc.jpg",
      "https://user.uploads.dev/file/faec26658a19a05feef558bca8388dc9.jpg",
      "https://user.uploads.dev/file/93b8497159ef539b0562a455157d264e.jpg",
      "https://user.uploads.dev/file/0be645fb0e119db91df60bbca5f8f50b.jpg",
      "https://user.uploads.dev/file/7e9df7df87ba98e19d53517b9dccb154.jpg",
      "https://user.uploads.dev/file/e41258622ca568d77e409ed6574bec4e.jpg",
      "https://user.uploads.dev/file/c4c5b35687ec80021d228479a4c1b15c.jpg",
      "https://user.uploads.dev/file/b77e6aeb10e46c3f9d0ddfc428264542.jpg",
      "https://user.uploads.dev/file/f48c91785631d9fb3b8739fc4bef05a9.jpg",
      "https://user.uploads.dev/file/0b5768304f984516a12ec37751ced7cd.jpg",
      "https://user.uploads.dev/file/de2a6a7e7b349dff2e8c581e2c65678e.jpg",
      "https://user.uploads.dev/file/5af7de468b65d3f6508e0319ef768d85.jpg",
      "https://user.uploads.dev/file/160a02cee177fd2308bb3bacb4f14be1.jpg",
      "https://user.uploads.dev/file/ee67821eca7c547bf222e464fdbf8563.jpg",
      "https://user.uploads.dev/file/718deab3e6b6837b36a34a0359debe3c.jpg",
      "https://user.uploads.dev/file/4deecc302c6c25f46abaf87dcc871def.jpg",
      "https://user.uploads.dev/file/4f67dc05ecea7316389a5d851dabceb4.jpg"
    ]
  },
  {
    id: "iani-mage-cpu",
    name: "iani-mage-cpu-v1",
    label: "Iani-Mage CPU v1",
    kind: "mage",
    desc: "CPU mage portrait generator. Trains on-device from mage reference art.",
    refs: [
      "https://user.uploads.dev/file/8ce0edfc40d612e63d4d9ff76a63c63c.jpg",
      "https://user.uploads.dev/file/7c884ff8315ff9adfa86427e8ba6cae1.jpg",
      "https://user.uploads.dev/file/aa2abe3e3cf54c44f699670b7002de10.jpg"
    ]
  }
];

const LS_KEY = "ankiCpuWeights.v1";

const REFS_KEY = "ankiCpuRefs.v1";
const IDENT_KEY = "ankiCpuIdentity.v1";

function loadRefs() {
  try { return JSON.parse(localStorage.getItem(REFS_KEY) || "{}"); } catch { return {}; }
}

export function getRefs(id) {
  const meta = ANKI_CPU_MODELS.find(m => m.id === id);
  const base = meta ? meta.refs : [];
  const custom = loadRefs()[id] || [];
  return [...custom, ...base];
}

export function addCustomRefs(id, urls) {
  try {
    const all = loadRefs();
    all[id] = [...(urls || []), ...(all[id] || [])].slice(0, 30);
    localStorage.setItem(REFS_KEY, JSON.stringify(all));
  } catch {}
}

function loadIdent() {
  try { return JSON.parse(localStorage.getItem(IDENT_KEY) || "{}"); } catch { return {}; }
}

export function getIdentity(id) {
  return loadIdent()[id] || null;
}

function saveIdentity(id, ident) {
  try {
    const all = loadIdent();
    all[id] = ident;
    localStorage.setItem(IDENT_KEY, JSON.stringify(all));
  } catch {}
}

function lum(hex) {
  const c = hexRgb(hex);
  return (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255;
}

function hairWord(hex) {
  const c = hexRgb(hex);
  const mx = Math.max(c[0], c[1], c[2]);
  if (mx < 70) return "black hair";
  if (c[0] > 200 && c[1] > 190 && c[2] > 180) return "platinum blonde hair";
  if (c[0] > 150 && c[1] > 110 && c[2] < 90) return "light brown hair";
  if (c[0] > 110 && c[1] < 80) return "auburn red-brown hair";
  if (lum(hex) > 0.7) return "blonde hair";
  return "dark brown hair";
}

function skinWord(hex) {
  const l = lum(hex);
  if (l > 0.82) return "very fair skin";
  if (l > 0.68) return "fair skin with warm undertone";
  if (l > 0.52) return "medium tan skin";
  return "deep brown skin";
}

async function nativeFaceBox(img) {
  try {
    if (typeof window !== "undefined" && "FaceDetector" in window) {
      const det = new window.FaceDetector({ fastMode: true, maxDetectedFaces: 1 });
      const f = await det.detect(img);
      const b = f && f[0] && f[0].boundingBox;
      if (b) return { x: b.x, y: b.y, w: b.width, h: b.height };
    }
  } catch {}
  return null;
}

async function refBlob(url) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 15000);
  let r;
  try { r = await fetch(url, { mode: "cors", signal: ctl.signal }); }
  finally { clearTimeout(t); }
  if (!r.ok) throw new Error("ref fetch failed");
  return await r.blob();
}

const DEFAULT_W = {
  "anki-human-cpu": {
    skin: ["#f2c9a4", "#e0ac82", "#c68863", "#8d5524"],
    hair: ["#2b2b33", "#5a3a22", "#b56a2e", "#e8e3da"],
    cloth: ["#3d5a80", "#98c1d9", "#ee6c4d", "#293241"],
    bg: ["#1d2433", "#2e3440", "#3b2f2f"],
    epochs: 0, version: 1, loss: []
  },
  "iani-mage-cpu": {
    skin: ["#f2c9a4", "#dfb28e", "#c68863"],
    hair: ["#d8d8d8", "#8a2be2", "#b56a2e", "#3b3b45"],
    cloth: ["#2b2140", "#4a2c6e", "#7b2d26", "#1f3a5f"],
    bg: ["#14101f", "#1f1b2d", "#241a12"],
    glow: ["#7fd4ff", "#b388ff", "#ff9a3c", "#ff5d5d"],
    epochs: 0, version: 1, loss: []
  }
};

function loadStore() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return structuredClone(DEFAULT_W);
    const p = JSON.parse(raw);
    const out = structuredClone(DEFAULT_W);
    for (const k of Object.keys(out)) {
      if (p[k]) {
        for (const f of ["skin", "hair", "cloth", "bg", "glow"]) if (Array.isArray(p[k][f]) && p[k][f].length) out[k][f] = p[k][f];
        if (Number.isFinite(+p[k].epochs)) out[k].epochs = +p[k].epochs;
        if (Number.isFinite(+p[k].version)) out[k].version = +p[k].version;
        if (Array.isArray(p[k].loss)) out[k].loss = p[k].loss.slice(-60);
      }
    }
    return out;
  } catch { return structuredClone(DEFAULT_W); }
}

function saveStore(s) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch {}
}

export function getWeights(id) {
  return loadStore()[id] || structuredClone(DEFAULT_W[id]);
}

export function isTrained(id) {
  return (loadStore()[id]?.epochs || 0) > 0;
}

function hexRgb(h) {
  h = String(h).replace("#", "");
  if (h.length === 3) h = h.split("").map(c => c + c).join("");
  const n = parseInt(h, 16);
  return [n >> 16 & 255, n >> 8 & 255, n & 255];
}

function rgbHex(r, g, b) {
  const c = v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return "#" + c(r) + c(g) + c(b);
}

function mix(a, b, t) {
  const A = hexRgb(a), B = hexRgb(b);
  return rgbHex(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t);
}

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function mulberry(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function loadImg(url) {
  return new Promise((res, rej) => {
    const im = new Image();
    im.crossOrigin = "anonymous";
    im.onload = () => res(im);
    im.onerror = () => rej(new Error("ref failed"));
    im.src = url;
  });
}

function sampleBands(im) {
  const c = document.createElement("canvas");
  c.width = 32; c.height = 32;
  const x = c.getContext("2d", { willReadFrequently: true });
  x.drawImage(im, 0, 0, 32, 32);
  const d = x.getImageData(0, 0, 32, 32).data;
  const px = (i, j) => [d[(j * 32 + i) * 4], d[(j * 32 + i) * 4 + 1], d[(j * 32 + i) * 4 + 2]];
  const avg = list => {
    let r = 0, g = 0, b = 0;
    for (const p of list) { r += p[0]; g += p[1]; b += p[2]; }
    const n = Math.max(1, list.length);
    return rgbHex(r / n, g / n, b / n);
  };
  const bg = [], hair = [], skin = [], cloth = [], glow = [];
  for (let j = 0; j < 32; j++) for (let i = 0; i < 32; i++) {
    const p = px(i, j);
    if ((j < 3 || j > 28) && (i < 3 || i > 28)) bg.push(p);
    else if (j < 10) hair.push(p);
    else if (j >= 10 && j < 19 && i > 9 && i < 22) { if (p[0] > 60 && (p[0] - p[2]) > 8) skin.push(p); }
    else if (j >= 19) cloth.push(p);
    const sat = Math.max(p[0], p[1], p[2]) - Math.min(p[0], p[1], p[2]);
    if (sat > 90 && Math.max(p[0], p[1], p[2]) > 150) glow.push(p);
  }
  const skinAvg = skin.length > 8 ? avg(skin) : null;
  return { bg: avg(bg), hair: avg(hair), skin: skinAvg, cloth: avg(cloth), glow: glow.length > 4 ? avg(glow) : null };
}

function dist(a, b) {
  const A = hexRgb(a), B = hexRgb(b);
  return Math.sqrt((A[0] - B[0]) ** 2 + (A[1] - B[1]) ** 2 + (A[2] - B[2]) ** 2) / 441.6;
}

function paletteLoss(w, t) {
  let s = 0, n = 0;
  for (const f of ["skin", "hair", "cloth", "bg"]) {
    const L = Math.min(w[f].length, t[f].length);
    for (let i = 0; i < L; i++) { s += dist(w[f][i % w[f].length], t[f][i]); n++; }
  }
  return n ? s / n : 1;
}

export async function trainCpuModel(id, { epochs = 5, onEpoch = null, signal = null } = {}) {
  const meta = ANKI_CPU_MODELS.find(m => m.id === id);
  if (!meta) throw new Error("unknown lab model " + id);
  const store = loadStore();
  const w = store[id];
  const refs = getRefs(id);
  const targets = [];
  let faces = 0;
  for (const u of refs) {
    try {
      const im = await loadImg(u);
      const bands = sampleBands(im);
      targets.push(bands);
      try {
        const box = await nativeFaceBox(im);
        if (box && box.w > 12 && box.h > 12) faces++;
      } catch {}
    } catch {}
  }
  if (!targets.length) throw new Error("reference images would not load (network?) — try again");
  const agg = { skin: [], hair: [], cloth: [], bg: [], glow: [] };
  for (const t of targets) for (const f of Object.keys(agg)) if (t[f]) agg[f].push(t[f]);
  const mean = arr => {
    let r = 0, g = 0, b = 0;
    for (const h of arr) { const c = hexRgb(h); r += c[0]; g += c[1]; b += c[2]; }
    const n = Math.max(1, arr.length);
    return rgbHex(r / n, g / n, b / n);
  };
  const target = {};
  for (const f of Object.keys(agg)) if (agg[f].length) target[f] = agg[f];
  const hist = [];
  for (let e = 1; e <= epochs; e++) {
    if (signal?.aborted) throw Object.assign(new Error("cancelled"), { kind: "cancelled" });
    const lr = 0.55 * Math.pow(0.82, w.epochs);
    for (const f of ["skin", "hair", "cloth", "bg", "glow"]) {
      if (!target[f]?.length || !w[f]) continue;
      const m = mean(target[f]);
      w[f] = w[f].map((c, i) => mix(c, mix(m, target[f][i % target[f].length], 0.7), Math.min(0.7, lr + 0.08)));
    }
    w.epochs++;
    const L = paletteLoss(w, { skin: target.skin || [], hair: target.hair || [], cloth: target.cloth || [], bg: target.bg || [] });
    w.loss.push(+L.toFixed(4));
    hist.push({ epoch: w.epochs, loss: +L.toFixed(4), faces, refs: targets.length });
    saveStore(store);
    onEpoch?.({ epoch: w.epochs, loss: +L.toFixed(4), done: e, faces, refs: targets.length });
    await new Promise(r => setTimeout(r, 60));
  }
  w.version = 1 + Math.floor(w.epochs / 5);
  saveStore(store);
  try {
    saveIdentity(id, {
      hair: hairWord(w.hair[0]),
      skin: skinWord(w.skin[0]),
      hairHex: w.hair[0],
      skinHex: w.skin[0],
      faces,
      refs: targets.length,
      at: Date.now()
    });
  } catch {}
  return { weights: w, hist, faces, refs: targets.length };
}

function jitter(hex, rnd, amt = 14) {
  const c = hexRgb(hex);
  return rgbHex(c[0] + (rnd() - 0.5) * 2 * amt, c[1] + (rnd() - 0.5) * 2 * amt, c[2] + (rnd() - 0.5) * 2 * amt);
}

function pickW(prompt, kind) {
  const low = String(prompt || "").toLowerCase();
  if (/mage|wizard|witch|sorcer|robe|staff|spell|arcane|rune|hood|beard|fire|ice|frost|ember/.test(low)) return "iani-mage-cpu";
  if (kind === "mage") return "iani-mage-cpu";
  return "anki-human-cpu";
}

function is3DStyle(prompt) {
  return /3d|pixar|disney|clay|figurine|chibi|nendoroid|funko|stylized|octane|blender|game character|3d render|toon|turntable|action figure/i.test(String(prompt || ""));
}

function viewFromPrompt(prompt, rnd) {
  const p = String(prompt || "").toLowerCase();
  const has = (...ws) => ws.some(w => p.includes(w));
  let a = 0.45 + (rnd() - 0.5) * 0.3;
  let label = "3/4 view";
  if (has("front", "frontal", "facing forward", "passport")) { a = 0; label = "front"; }
  if (has("three-quarter", "three quarter")) { a = 0.55 * (has("left") ? -1 : 1); label = "three-quarter"; }
  if (has("side", "profile")) { a = 1.25 * (has("left") ? -1 : 1); label = "side"; }
  if (has("back", "behind", "rear", "turnaround back")) { a = Math.PI; label = "back"; }
  if (has("turntable")) {
    const m = p.match(/turntable\s*(-?\d+)/);
    a = m ? (+m[1]) * Math.PI / 180 : (rnd() * 2 - 1) * Math.PI;
    label = "turntable";
  }
  return { a, label };
}

async function renderCharacter3D({ w, h, id, W, rnd, seed, prompt, skin, skinD, blush, hairC, clothC, bgC, bgC2, isMage }) {
  const cv = document.createElement("canvas");
  cv.width = w; cv.height = h;
  const x = cv.getContext("2d");
  const u = Math.min(w, h) / 100;
  const cx = w / 2;
  const view = viewFromPrompt(prompt, rnd);
  const va = view.a;
  const facing = Math.abs(va) > Math.PI * 0.75 ? -1 : 1;
  const sideK = Math.cos(Math.min(Math.PI / 2, Math.abs(va)));
  const shiftK = Math.sin(va);
  const P = arr => arr[Math.floor(rnd() * arr.length)];
  const hairD = mix(hairC, "#000000", 0.45);
  const hairL = mix(hairC, "#ffffff", 0.45);
  const clothD = mix(clothC, "#000000", 0.42);
  const clothL = mix(clothC, "#ffffff", 0.35);
  const skinL = mix(skin, "#ffffff", 0.3);
  const glowC = W.glow ? P(W.glow) : "#7fd4ff";
  const g = x.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, mix(bgC2, "#ffffff", 0.1));
  g.addColorStop(0.62, bgC);
  g.addColorStop(0.621, mix(bgC, "#000000", 0.35));
  g.addColorStop(1, mix(bgC, "#000000", 0.6));
  x.fillStyle = g; x.fillRect(0, 0, w, h);
  x.fillStyle = "rgba(255,255,255,0.05)";
  x.beginPath(); x.ellipse(cx, h * 0.3, w * 0.42, h * 0.2, 0, 0, 7); x.fill();
  x.fillStyle = "rgba(0,0,0,0.35)";
  x.beginPath(); x.ellipse(cx, h * 0.88, 26 * u, 5.5 * u, 0, 0, 7); x.fill();
  x.fillStyle = "rgba(0,0,0,0.2)";
  x.beginPath(); x.ellipse(cx, h * 0.88, 18 * u, 3.6 * u, 0, 0, 7); x.fill();
  const legH = 9 * u;
  for (const sgn of [-1, 1]) {
    const lx = cx + sgn * 6 * u + shiftK * 1.5 * u;
    const legG = x.createLinearGradient(lx - 3 * u, 0, lx + 3 * u, 0);
    legG.addColorStop(0, mix(clothC, "#000000", 0.5));
    legG.addColorStop(0.5, mix(clothC, "#000000", 0.2));
    legG.addColorStop(1, mix(clothC, "#000000", 0.5));
    x.fillStyle = legG;
    x.beginPath(); x.ellipse(lx, h * 0.88 - legH * 0.4, 3.6 * u, legH * 0.55, 0, 0, 7); x.fill();
    x.fillStyle = mix(skinD, "#000000", 0.25);
    x.beginPath(); x.ellipse(lx, h * 0.88 - 0.8 * u, 3.8 * u, 1.8 * u, 0, 0, 7); x.fill();
  }
  const bodyY = h * 0.88 - legH * 0.7, bodyH = 30 * u, bodyW = 19 * u;
  const bodyG = x.createLinearGradient(cx - bodyW, 0, cx + bodyW, 0);
  bodyG.addColorStop(0, clothD);
  bodyG.addColorStop(0.35, clothC);
  bodyG.addColorStop(0.55, clothL);
  bodyG.addColorStop(1, clothD);
  x.fillStyle = bodyG;
  x.beginPath();
  x.moveTo(cx - bodyW * 0.8, bodyY);
  x.quadraticCurveTo(cx - bodyW, bodyY - bodyH, cx - bodyW * 0.55, bodyY - bodyH * 0.96);
  x.lineTo(cx + bodyW * 0.55, bodyY - bodyH * 0.96);
  x.quadraticCurveTo(cx + bodyW, bodyY - bodyH, cx + bodyW * 0.8, bodyY);
  x.closePath(); x.fill();
  x.strokeStyle = "rgba(255,255,255,0.5)";
  x.lineWidth = Math.max(1, 0.5 * u);
  x.beginPath();
  x.moveTo(cx - bodyW * 0.62 + shiftK * 2 * u, bodyY - bodyH * 0.9);
  x.quadraticCurveTo(cx - bodyW * 0.7 + shiftK * 2 * u, bodyY - bodyH * 0.5, cx - bodyW * 0.6 + shiftK * 2 * u, bodyY - bodyH * 0.12);
  x.stroke();
  x.strokeStyle = "rgba(0,0,0,0.3)";
  x.beginPath();
  x.moveTo(cx + bodyW * 0.62, bodyY - bodyH * 0.9);
  x.quadraticCurveTo(cx + bodyW * 0.72, bodyY - bodyH * 0.5, cx + bodyW * 0.6, bodyY - bodyH * 0.12);
  x.stroke();
  if (isMage) {
    x.strokeStyle = mix(glowC, "#ffffff", 0.5);
    x.globalAlpha = 0.85; x.lineWidth = Math.max(1, 0.5 * u);
    x.beginPath(); x.moveTo(cx - bodyW * 0.4, bodyY - bodyH * 0.85);
    x.lineTo(cx - bodyW * 0.15, bodyY - bodyH * 0.2); x.stroke();
    x.beginPath(); x.moveTo(cx + bodyW * 0.4, bodyY - bodyH * 0.85);
    x.lineTo(cx + bodyW * 0.15, bodyY - bodyH * 0.2); x.stroke();
    x.globalAlpha = 1;
  } else {
    x.fillStyle = mix(clothC, "#ffffff", 0.55);
    x.fillRect(cx - 2.5 * u, bodyY - bodyH * 0.96, 5 * u, 9 * u);
    x.fillStyle = "rgba(0,0,0,0.25)";
    x.fillRect(cx - 2.5 * u, bodyY - bodyH * 0.96, 1.2 * u, 9 * u);
  }
  for (const sgn of [-1, 1]) {
    const ax = cx + sgn * bodyW * 0.95 + shiftK * 2 * u;
    const armG = x.createLinearGradient(ax - 3 * u, 0, ax + 3 * u, 0);
    armG.addColorStop(0, clothD); armG.addColorStop(0.5, sgn < 0 ? clothC : clothL); armG.addColorStop(1, clothD);
    x.fillStyle = armG;
    x.beginPath();
    x.ellipse(ax, bodyY - bodyH * 0.5, 3.4 * u, bodyH * 0.34, sgn * 0.12, 0, 7);
    x.fill();
    x.fillStyle = skin;
    x.beginPath(); x.arc(ax + sgn * 0.5 * u, bodyY - bodyH * 0.16, 2.6 * u, 0, 7); x.fill();
    x.fillStyle = "rgba(255,255,255,0.35)";
    x.beginPath(); x.arc(ax - 0.8 * u, bodyY - bodyH * 0.16 - 0.8 * u, 0.8 * u, 0, 7); x.fill();
  }
  const neckW = 5 * u;
  x.fillStyle = skinD;
  x.fillRect(cx - neckW, bodyY - bodyH * 1.12, neckW * 2, 5 * u);
  const hr = 15 * u;
  const hy = bodyY - bodyH * 1.12 - hr * 0.95;
  const fcx = cx + shiftK * hr * 0.55;
  const headG = x.createRadialGradient(fcx - hr * 0.4, hy - hr * 0.45, hr * 0.1, fcx, hy, hr * 1.25);
  headG.addColorStop(0, skinL);
  headG.addColorStop(0.45, skin);
  headG.addColorStop(1, skinD);
  x.fillStyle = headG;
  x.beginPath(); x.arc(cx + shiftK * hr * 0.3, hy, hr, 0, 7); x.fill();
  x.strokeStyle = "rgba(255,255,255,0.55)";
  x.lineWidth = Math.max(1.2, 0.55 * u);
  x.beginPath(); x.arc(cx + shiftK * hr * 0.3, hy, hr - 0.6 * u, Math.PI * 1.15, Math.PI * 1.6); x.stroke();
  x.strokeStyle = "rgba(0,0,0,0.22)";
  x.lineWidth = Math.max(1, 0.4 * u);
  x.beginPath(); x.arc(cx + shiftK * hr * 0.3, hy, hr - 0.4 * u, Math.PI * 0.15, Math.PI * 0.7); x.stroke();
  if (facing > 0) {
    for (const sgn of [-1, 1]) {
      const ex = fcx + sgn * hr * 0.38 * Math.max(0.25, sideK);
      const ey = hy - hr * 0.02;
      const ew = hr * 0.21, eh = hr * 0.27;
      x.fillStyle = "#ffffff";
      x.beginPath(); x.ellipse(ex, ey, ew, eh, 0, 0, 7); x.fill();
      const irisR = eh * 0.62;
      const ig = x.createRadialGradient(ex, ey, 0, ex, ey, irisR);
      const irisC = isMage ? glowC : mix(hairC, "#2a160d", 0.4);
      ig.addColorStop(0, "#101014"); ig.addColorStop(0.45, irisC); ig.addColorStop(1, mix(irisC, "#000000", 0.5));
      x.fillStyle = ig;
      x.beginPath(); x.arc(ex, ey + eh * 0.06, irisR, 0, 7); x.fill();
      x.fillStyle = "#0b0b0e";
      x.beginPath(); x.arc(ex, ey + eh * 0.06, irisR * 0.45, 0, 7); x.fill();
      x.fillStyle = "rgba(255,255,255,0.95)";
      x.beginPath(); x.arc(ex - irisR * 0.35, ey - irisR * 0.35, irisR * 0.3, 0, 7); x.fill();
      x.fillStyle = "rgba(255,255,255,0.6)";
      x.beginPath(); x.arc(ex + irisR * 0.3, ey + irisR * 0.4, irisR * 0.14, 0, 7); x.fill();
      x.strokeStyle = mix(hairC, "#000000", 0.5);
      x.lineWidth = Math.max(1.4, 0.55 * u);
      x.beginPath();
      x.moveTo(ex - ew * 1.05, ey - eh * 0.9);
      x.quadraticCurveTo(ex, ey - eh * 1.45, ex + ew * 1.05, ey - eh * 0.85);
      x.stroke();
    }
    x.strokeStyle = "rgba(120,60,35,0.5)";
    x.lineWidth = Math.max(1, 0.4 * u);
    x.beginPath();
    x.moveTo(fcx - 1.2 * u, hy + hr * 0.3);
    x.quadraticCurveTo(fcx + shiftK * 1 * u, hy + hr * 0.42, fcx + 1.2 * u, hy + hr * 0.3);
    x.stroke();
    const mw = hr * 0.55 * Math.max(0.5, sideK), mh = hr * 0.3;
    const my = hy + hr * 0.52;
    const lipC = mix(skin, isMage ? "#7a3040" : "#a33e4a", 0.55);
    const lg = x.createLinearGradient(0, my - mh / 2, 0, my + mh / 2);
    lg.addColorStop(0, mix(lipC, "#4a1a22", 0.3)); lg.addColorStop(0.5, lipC); lg.addColorStop(1, mix(lipC, "#4a1a22", 0.35));
    x.fillStyle = lg;
    x.beginPath(); x.ellipse(fcx, my, mw / 2, mh / 2, 0, 0, 7); x.fill();
    x.fillStyle = "rgba(255,255,255,0.4)";
    x.beginPath(); x.ellipse(fcx, my + mh * 0.18, mw * 0.16, mh * 0.14, 0, 0, 7); x.fill();
    x.fillStyle = blush; x.globalAlpha = 0.3;
    for (const sgn of [-1, 1]) {
      x.beginPath(); x.ellipse(fcx + sgn * hr * 0.62 * Math.max(0.3, sideK), hy + hr * 0.3, hr * 0.2, hr * 0.11, 0, 0, 7); x.fill();
    }
    x.globalAlpha = 1;
  } else {
    x.fillStyle = hairD;
    x.beginPath(); x.arc(cx, hy, hr * 0.96, 0, 7); x.fill();
    x.strokeStyle = hairL; x.globalAlpha = 0.6; x.lineWidth = Math.max(1, 0.4 * u);
    for (let i = 0; i < 8; i++) {
      const a0 = Math.PI * (0.15 + i * 0.1);
      x.beginPath(); x.arc(cx, hy, hr * (0.6 + (i % 3) * 0.12), a0, a0 + 0.5); x.stroke();
    }
    x.globalAlpha = 1;
  }
  x.fillStyle = hairC;
  x.beginPath();
  x.moveTo(cx - hr * 1.15, hy - hr * 0.2);
  x.quadraticCurveTo(cx - hr * 1.2, hy - hr * 1.35, cx + shiftK * hr * 0.4, hy - hr * 1.4);
  x.quadraticCurveTo(cx + hr * 1.2, hy - hr * 1.35, cx + hr * 1.15, hy - hr * 0.2);
  x.quadraticCurveTo(cx + hr * 0.9, hy - hr * 0.75, cx + hr * 0.3, hy - hr * 0.72);
  for (let k = 2; k >= -2; k--) {
    x.quadraticCurveTo(cx + k * hr * 0.28, hy - hr * (0.55 + (k % 2 ? 0.12 : 0)), cx + (k - 0.5) * hr * 0.28, hy - hr * 0.62);
  }
  x.quadraticCurveTo(cx - hr * 0.9, hy - hr * 0.75, cx - hr * 1.15, hy - hr * 0.2);
  x.closePath(); x.fill();
  x.fillStyle = "rgba(255,255,255,0.3)";
  x.beginPath(); x.ellipse(cx - hr * 0.35 + shiftK * hr * 0.2, hy - hr * 1.05, hr * 0.5, hr * 0.22, -0.3, 0, 7); x.fill();
  for (const sgn of [-1, 1]) {
    if (Math.abs(va) > 1 && sgn === -Math.sign(va || 1)) continue;
    x.fillStyle = hairC;
    x.beginPath();
    x.ellipse(cx + sgn * hr * 1.02, hy + hr * 0.35, hr * 0.2, hr * 0.55, sgn * 0.1, 0, 7);
    x.fill();
    x.strokeStyle = hairL; x.globalAlpha = 0.5; x.lineWidth = Math.max(0.8, 0.25 * u);
    x.beginPath();
    x.moveTo(cx + sgn * hr * 1.02, hy - hr * 0.1);
    x.quadraticCurveTo(cx + sgn * hr * 1.1, hy + hr * 0.3, cx + sgn * hr * 1.0, hy + hr * 0.75);
    x.stroke(); x.globalAlpha = 1;
  }
  if (isMage) {
    x.fillStyle = mix(clothC, "#000000", 0.3);
    x.beginPath();
    x.moveTo(cx - hr * 1.35, hy - hr * 0.85);
    x.quadraticCurveTo(cx + shiftK * hr * 0.3, hy - hr * 2.9, cx + hr * 1.35, hy - hr * 0.85);
    x.quadraticCurveTo(cx + shiftK * hr * 0.3, hy - hr * 1.35, cx - hr * 1.35, hy - hr * 0.85);
    x.closePath(); x.fill();
    x.fillStyle = mix(clothC, "#ffffff", 0.2);
    x.beginPath(); x.ellipse(cx + shiftK * hr * 0.3, hy - hr * 0.9, hr * 1.35, hr * 0.28, 0, 0, 7); x.fill();
    x.fillStyle = mix(glowC, "#ffffff", 0.4);
    x.beginPath(); x.arc(cx + shiftK * hr * 0.3, hy - hr * 2.9, 1.6 * u, 0, 7); x.fill();
    const staffX = cx + bodyW * 1.35;
    x.strokeStyle = mix("#5a3a22", glowC, 0.15);
    x.lineWidth = Math.max(2, 1 * u); x.lineCap = "round";
    x.beginPath(); x.moveTo(staffX, bodyY); x.lineTo(staffX + 1.5 * u, hy - hr * 1.2); x.stroke();
    const oy = hy - hr * 1.45, ox = staffX + 1.5 * u;
    const og = x.createRadialGradient(ox, oy, 0, ox, oy, 7 * u);
    og.addColorStop(0, "#ffffff"); og.addColorStop(0.35, glowC); og.addColorStop(1, "rgba(0,0,0,0)");
    x.fillStyle = og;
    x.beginPath(); x.arc(ox, oy, 7 * u, 0, 7); x.fill();
    x.fillStyle = mix(glowC, "#ffffff", 0.55);
    x.beginPath(); x.arc(ox, oy, 1.9 * u, 0, 7); x.fill();
  }
  for (let i = 0; i < 900; i++) {
    x.fillStyle = rnd() < 0.5 ? "rgba(0,0,0,0.04)" : "rgba(255,255,255,0.04)";
    x.fillRect(rnd() * w, rnd() * h, Math.max(1, u * 0.3), Math.max(1, u * 0.3));
  }
  const vg = x.createRadialGradient(cx, h * 0.5, Math.min(w, h) * 0.35, cx, h * 0.5, Math.max(w, h) * 0.75);
  vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,0,0.34)");
  x.fillStyle = vg; x.fillRect(0, 0, w, h);
  const seedTag = String((seed >>> 0) % 100000);
  x.fillStyle = "rgba(255,255,255,0.55)";
  x.font = `${Math.max(10, Math.round(u * 2.4))}px monospace`;
  x.fillText(`${id} · 3D · #${seedTag}`, 8, h - 8);
  const blob = await new Promise(res => cv.toBlob(res, "image/png"));
  return { blob, by: `${id}-v${W.version || 1} · CPU lab 3D · #${seedTag} · ${view.label}`, canvas: cv };
}

export async function renderLabImage({ prompt = "portrait", seed = null, w = 768, h = 768, modelId = null, negative = "" } = {}) {
  const id = modelId || pickW(prompt);
  const W = getWeights(id);
  const s = seed == null ? (hashStr(id + "|" + prompt) ^ Math.floor(Math.random() * 2 ** 31)) >>> 0 : +seed >>> 0;
  const rnd = mulberry(s);
  const P = arr => jitter(arr[Math.floor(rnd() * arr.length)], rnd);
  const skin = P(W.skin), skinD = mix(skin, "#7a4a2e", 0.22), blush = mix(skin, "#ff6b81", 0.4);
  const hairC = P(W.hair), clothC = P(W.cloth), bgC = P(W.bg);
  const bgC2 = mix(bgC, rnd() < 0.5 ? "#000000" : "#ffffff", 0.28);
  const glowC = W.glow ? P(W.glow) : P(["#7fd4ff", "#b388ff"]);
  const isMage = id === "iani-mage-cpu";
  if (!isMage && !is3DStyle(prompt) && (W.epochs || 0) > 0) {
    try {
      const gen = (typeof root !== "undefined" && root.generateImage) || (typeof window !== "undefined" && window.root && window.root.generateImage) || null;
      if (gen) {
        const ident = getIdentity(id);
        const hairW = ident ? ident.hair : hairWord(W.hair[0]);
        const skinW = ident ? ident.skin : skinWord(W.skin[0]);
        const clean = String(prompt).replace(/\b3d\b|pixar|clay|chibi|turntable/gi, "").trim() || "portrait";
        const isPortrait = /woman|man|girl|boy|person|portrait|face|selfie|human/i.test(clean);
        const subject = isPortrait ? `photorealistic portrait of an adult woman with long ${hairW}, ${skinW} with visible pores and subtle freckles, symmetrical brown eyes, natural eyebrows, soft pink lips` : clean;
        const photoPrompt = `${subject}, ${clean}, warm indoor bedroom light with soft lamp glow, shallow depth of field, 85mm lens, sharp focus on eyes, ultra detailed, natural skin texture, anatomically correct, same identity, consistent face`;
        const neg = [String(negative || ""), "cartoon, painting, illustration, 3d render, deformed face, asymmetric eyes, crossed eyes, blurry face, extra fingers, extra limbs, watermark, text, logo"].filter(Boolean).join(", ");
        const res = await Promise.race([
          gen({ prompt: photoPrompt, negativePrompt: neg, resolution: w >= h ? (w > 600 ? "768x512" : "512x512") : "512x768", seed: s }),
          new Promise((_, rej) => setTimeout(() => rej(new Error("photoreal engine busy — offline fallback")), 120000))
        ]);
        const url = res && (res.dataUrl || res.url || String(res).startsWith("data:") && String(res));
        if (url) {
          let blob = await (await fetch(url)).blob();
          try {
            const refs = getRefs(id);
            if (refs.length && isPortrait) {
              let refB = null;
              for (const u of refs.slice(0, 6)) {
                try { refB = await refBlob(u); break; } catch {}
              }
              if (refB) {
                const { faceBlend } = await import("./facelock.js");
                const blended = await faceBlend(refB, blob, { strength: 0.45, useModel: false });
                if (blended && blended.blob && blended.applied) blob = blended.blob;
              }
            }
          } catch {}
          return { blob, by: `${id}-v${W.version || 1} · CPU identity + photoreal diffusion + face-lock · #${s % 100000}` };
        }
      }
    } catch {}
  }
  if (is3DStyle(prompt)) {
    return await renderCharacter3D({ w, h, id, W, rnd, seed: s, prompt, skin, skinD, blush, hairC, clothC, bgC, bgC2, isMage });
  }
  if (!isMage) {
    return await renderHumanPhoto({ w, h, id, W, rnd, seed: s, prompt, skin, skinD, blush, hairC, clothC, bgC, bgC2 });
  }
  const cv = document.createElement("canvas");
  cv.width = w; cv.height = h;
  const x = cv.getContext("2d");
  const g = x.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, bgC2); g.addColorStop(0.55, bgC); g.addColorStop(1, mix(bgC, "#000000", 0.45));
  x.fillStyle = g; x.fillRect(0, 0, w, h);
  if (isMage) {
    x.save(); x.globalAlpha = 0.5;
    for (let i = 0; i < 26; i++) {
      x.fillStyle = rnd() < 0.5 ? glowC : "#ffffff";
      x.globalAlpha = 0.12 + rnd() * 0.4;
      const r = 1 + rnd() * 2.4;
      x.beginPath(); x.arc(rnd() * w, rnd() * h, r, 0, 7); x.fill();
    }
    x.restore();
  }
  const cx = w / 2, u = Math.min(w, h) / 100;
  x.fillStyle = clothC;
  x.beginPath();
  x.moveTo(cx - 26 * u, h);
  x.quadraticCurveTo(cx - 24 * u, h * 0.66, cx - 13 * u, h * 0.62);
  x.lineTo(cx + 13 * u, h * 0.62);
  x.quadraticCurveTo(cx + 24 * u, h * 0.66, cx + 26 * u, h);
  x.closePath(); x.fill();
  x.fillStyle = "rgba(0,0,0,0.22)";
  x.fillRect(cx - 26 * u, h * 0.86, 52 * u, h * 0.14);
  if (isMage) {
    x.fillStyle = mix(clothC, "#000000", 0.3);
    x.beginPath();
    x.moveTo(cx - 13 * u, h * 0.62); x.lineTo(cx - 6 * u, h * 0.78); x.lineTo(cx - 2 * u, h * 0.62);
    x.moveTo(cx + 13 * u, h * 0.62); x.lineTo(cx + 6 * u, h * 0.78); x.lineTo(cx + 2 * u, h * 0.62);
    x.fill();
    x.strokeStyle = mix(glowC, "#ffffff", 0.4); x.lineWidth = Math.max(1, 0.5 * u); x.globalAlpha = 0.8;
    x.beginPath(); x.moveTo(cx - 10 * u, h * 0.7); x.lineTo(cx - 4 * u, h * 0.9); x.stroke();
    x.beginPath(); x.moveTo(cx + 10 * u, h * 0.7); x.lineTo(cx + 4 * u, h * 0.9); x.stroke();
    x.globalAlpha = 1;
  } else {
    x.fillStyle = mix(clothC, "#ffffff", 0.25);
    x.fillRect(cx - 3 * u, h * 0.62, 6 * u, h * 0.1);
  }
  x.fillStyle = skinD;
  x.fillRect(cx - 4.5 * u, h * 0.5, 9 * u, h * 0.14);
  x.fillStyle = skin;
  const hw = 11 * u, hh = 13.5 * u, hy = h * 0.5 - hh / 2 - 2 * u;
  x.beginPath(); x.ellipse(cx, hy, hw, hh, 0, 0, 7); x.fill();
  x.fillStyle = skin;
  x.beginPath(); x.ellipse(cx - hw, hy + 1 * u, 1.8 * u, 2.6 * u, 0, 0, 7); x.fill();
  x.beginPath(); x.ellipse(cx + hw, hy + 1 * u, 1.8 * u, 2.6 * u, 0, 0, 7); x.fill();
  x.fillStyle = "rgba(255,255,255,0.16)";
  x.beginPath(); x.ellipse(cx - 3.5 * u, hy - 4 * u, 4.5 * u, 2.6 * u, -0.4, 0, 7); x.fill();
  x.fillStyle = "rgba(120,60,30,0.14)";
  x.beginPath(); x.ellipse(cx + 6.5 * u, hy + 2 * u, 4 * u, 8 * u, 0.25, 0, 7); x.fill();
  x.fillStyle = "rgba(120,60,30,0.18)";
  x.beginPath(); x.ellipse(cx, hy + hh - 1 * u, hw * 0.7, 2.2 * u, 0, 0, 7); x.fill();
  const hs = Math.floor(rnd() * (isMage ? 4 : 5));
  x.fillStyle = hairC;
  if (hs === 0) {
    x.beginPath(); x.ellipse(cx, hy - 6.5 * u, hw + 2.5 * u, 7 * u, 0, Math.PI, 0); x.fill();
    for (let i = -3; i <= 3; i++) {
      x.beginPath();
      x.moveTo(cx + i * 3.4 * u - 1.8 * u, hy - 11 * u);
      x.lineTo(cx + i * 3.4 * u + 1.8 * u, hy - 11 * u);
      x.lineTo(cx + i * 3.4 * u + (rnd() - 0.5) * 2 * u, hy - 5.5 * u);
      x.closePath(); x.fill();
    }
    x.fillRect(cx - hw - 2.5 * u, hy - 7 * u, 3 * u, 12 * u);
    x.fillRect(cx + hw - 0.5 * u, hy - 7 * u, 3 * u, 12 * u);
  } else if (hs === 1) {
    x.beginPath(); x.ellipse(cx, hy - 6 * u, hw + 2.2 * u, 7.5 * u, 0, Math.PI, 0); x.fill();
    x.beginPath(); x.ellipse(cx - hw - 1 * u, hy + 4 * u, 3.4 * u, 10 * u, 0.15, 0, 7); x.fill();
    x.beginPath(); x.ellipse(cx + hw + 1 * u, hy + 4 * u, 3.4 * u, 10 * u, -0.15, 0, 7); x.fill();
  } else if (hs === 2) {
    x.beginPath(); x.ellipse(cx, hy - 6 * u, hw + 2 * u, 8 * u, 0, Math.PI, 0); x.fill();
    for (let i = -2; i <= 2; i++) {
      x.beginPath();
      x.moveTo(cx + i * 4 * u - 2 * u, hy - 10 * u);
      x.lineTo(cx + i * 4 * u + 2 * u, hy - 10 * u);
      x.lineTo(cx + i * 4 * u + (rnd() - 0.5) * 3 * u, hy - 3 * u);
      x.closePath(); x.fill();
    }
  } else if (hs === 3 && isMage) {
    x.fillStyle = mix(clothC, "#000000", 0.25);
    x.beginPath(); x.ellipse(cx, hy - 7 * u, hw + 5 * u, 10 * u, 0, Math.PI, 0); x.fill();
    x.beginPath(); x.ellipse(cx, hy - 7.5 * u, hw + 2 * u, 7.5 * u, 0, Math.PI, 0); x.fill();
    x.fillStyle = hairC;
    x.beginPath(); x.ellipse(cx, hy + 8 * u, 5.5 * u, 7 * u, 0, 0, 7); x.fill();
  } else {
    x.beginPath(); x.ellipse(cx, hy - 6 * u, hw + 1.6 * u, 6.4 * u, 0, Math.PI, 0); x.fill();
  }
  const eyeY = hy + 1 * u, eyeDX = 4.2 * u;
  const eyeW = (isMage ? 1.5 : 2.2) * u, eyeH = (isMage ? 1.1 : 2.6) * u;
  for (const sgn of [-1, 1]) {
    x.fillStyle = "#ffffff";
    x.beginPath(); x.ellipse(cx + sgn * eyeDX, eyeY, eyeW, eyeH, 0, 0, 7); x.fill();
    const iris = isMage ? glowC : mix(hairC, "#000000", 0.25);
    x.fillStyle = iris;
    x.beginPath(); x.arc(cx + sgn * eyeDX, eyeY + eyeH * 0.1, eyeW * 0.55, 0, 7); x.fill();
    x.fillStyle = "#101014";
    x.beginPath(); x.arc(cx + sgn * eyeDX, eyeY + eyeH * 0.1, eyeW * 0.28, 0, 7); x.fill();
    x.fillStyle = "rgba(255,255,255,0.9)";
    x.beginPath(); x.arc(cx + sgn * eyeDX - eyeW * 0.15, eyeY - eyeH * 0.2, eyeW * 0.12, 0, 7); x.fill();
  }
  x.strokeStyle = mix(hairC, "#000000", 0.35); x.lineWidth = Math.max(1, 0.45 * u); x.lineCap = "round";
  for (const sgn of [-1, 1]) {
    x.beginPath(); x.moveTo(cx + sgn * eyeDX - 2.4 * u, eyeY - 3.4 * u);
    x.quadraticCurveTo(cx + sgn * eyeDX, eyeY - 4.1 * u, cx + sgn * eyeDX + 2.4 * u, eyeY - 3.4 * u); x.stroke();
  }
  x.fillStyle = "rgba(0,0,0,0.18)";
  x.beginPath(); x.ellipse(cx, eyeY + 4.6 * u, 1 * u, 1.5 * u, 0, 0, 7); x.fill();
  x.strokeStyle = mix(skinD, "#5a2e1e", 0.4); x.lineWidth = Math.max(1, 0.5 * u);
  const smile = 1.6 * u + rnd() * 1.4 * u;
  x.beginPath(); x.moveTo(cx - 2.6 * u, eyeY + 7 * u);
  x.quadraticCurveTo(cx, eyeY + 7 * u + smile, cx + 2.6 * u, eyeY + 7 * u); x.stroke();
  if (!isMage) {
    x.fillStyle = blush; x.globalAlpha = 0.35;
    x.beginPath(); x.ellipse(cx - 6.4 * u, eyeY + 4.4 * u, 1.8 * u, 1.1 * u, 0, 0, 7); x.fill();
    x.beginPath(); x.ellipse(cx + 6.4 * u, eyeY + 4.4 * u, 1.8 * u, 1.1 * u, 0, 0, 7); x.fill();
    x.globalAlpha = 1;
  }
  if (isMage) {
    const staffX = cx + 20 * u;
    const grd = x.createLinearGradient(staffX, 0, staffX, h);
    grd.addColorStop(0, mix("#5a3a22", glowC, 0.15)); grd.addColorStop(1, "#3a2415");
    x.strokeStyle = grd; x.lineWidth = Math.max(2, 1.1 * u); x.lineCap = "round";
    x.beginPath(); x.moveTo(staffX, h); x.lineTo(staffX + 2 * u, h * 0.3); x.stroke();
    const oy = h * 0.26;
    const og = x.createRadialGradient(staffX + 2 * u, oy, 0, staffX + 2 * u, oy, 7 * u);
    og.addColorStop(0, "#ffffff"); og.addColorStop(0.3, glowC); og.addColorStop(1, "rgba(0,0,0,0)");
    x.fillStyle = og;
    x.beginPath(); x.arc(staffX + 2 * u, oy, 7 * u, 0, 7); x.fill();
    x.fillStyle = mix(glowC, "#ffffff", 0.55);
    x.beginPath(); x.arc(staffX + 2 * u, oy, 2 * u, 0, 7); x.fill();
    x.strokeStyle = glowC; x.globalAlpha = 0.55; x.lineWidth = Math.max(1, 0.35 * u);
    x.beginPath(); x.arc(staffX + 2 * u, oy, 3.6 * u, 0, 7); x.stroke();
    x.globalAlpha = 1;
  }
  const vg = x.createRadialGradient(cx, h * 0.55, Math.min(w, h) * 0.35, cx, h * 0.55, Math.max(w, h) * 0.75);
  vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,0,0.34)");
  x.fillStyle = vg; x.fillRect(0, 0, w, h);
  const seedTag = String(s % 100000);
  x.fillStyle = "rgba(255,255,255,0.55)";
  x.font = `${Math.max(10, Math.round(u * 2.4))}px monospace`;
  x.fillText(`${id} · #${seedTag}`, 8, h - 8);
  const blob = await new Promise(res => cv.toBlob(res, "image/png"));
  return { blob, by: `${id}-v${W.version || 1} · CPU lab · #${seedTag}`, canvas: cv };
}

function poseFromPrompt(prompt, rnd) {
  const p = String(prompt || "").toLowerCase();
  const has = (...ws) => ws.some(w => p.includes(w));
  let turn = (rnd() - 0.5) * 1.1;
  let tilt = (rnd() - 0.5) * 12;
  let gazeX = (rnd() - 0.5) * 0.5;
  let gazeY = (rnd() - 0.5) * 0.3;
  let label = "natural angle";
  if (has("passport", "frontal", "straight on", "facing forward", "id photo")) { turn = 0; tilt = 0; gazeX = 0; gazeY = 0; label = "frontal"; }
  if (has("looking left")) { gazeX = -0.55; turn = Math.min(turn, -0.25); label = "looking left"; }
  if (has("looking right")) { gazeX = 0.55; turn = Math.max(turn, 0.25); label = "looking right"; }
  if (has("looking up")) { gazeY = -0.5; label = "looking up"; }
  if (has("looking down")) { gazeY = 0.5; label = "looking down"; }
  if (has("profile", "side view", "side profile")) { turn = has("left") ? -0.95 : has("right") ? 0.95 : (rnd() < 0.5 ? -0.95 : 0.95); tilt = 0; if (!has("looking")) gazeX = (turn < 0 ? -0.4 : 0.4); label = "profile"; }
  if (has("three-quarter", "three quarter")) { turn = has("left") ? -0.55 : has("right") ? 0.55 : (rnd() < 0.5 ? -0.55 : 0.55); label = "three-quarter"; }
  if (has("tilt", "lean", "head to the side")) { tilt = (rnd() < 0.5 ? -1 : 1) * (6 + rnd() * 6); label = "head tilt"; }
  if (has("chin down", "head down")) { gazeY = Math.max(gazeY, 0.35); label = "chin down"; }
  if (has("chin up", "head up")) { gazeY = Math.min(gazeY, -0.35); label = "chin up"; }
  return { turn, tilt, gazeX, gazeY, label };
}

async function renderHumanPhoto({ w, h, id, W, rnd, seed, prompt, skin, skinD, blush, hairC, clothC, bgC, bgC2 }) {
  const cv = document.createElement("canvas");
  cv.width = w; cv.height = h;
  const x = cv.getContext("2d");
  const u = Math.min(w, h) / 100;
  const cx = w / 2;
  const g = x.createLinearGradient(0, 0, w * 0.25, h);
  g.addColorStop(0, mix(bgC2, "#ffffff", 0.14));
  g.addColorStop(0.5, bgC);
  g.addColorStop(1, mix(bgC, "#000000", 0.5));
  x.fillStyle = g; x.fillRect(0, 0, w, h);
  for (let i = 0; i < 10; i++) {
    const r = (2 + rnd() * 4.5) * u;
    const bx = rnd() * w, by = rnd() * h;
    const bgr = x.createRadialGradient(bx, by, 0, bx, by, r);
    bgr.addColorStop(0, rnd() < 0.5 ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.08)");
    bgr.addColorStop(1, "rgba(0,0,0,0)");
    x.fillStyle = bgr;
    x.beginPath(); x.arc(bx, by, r, 0, 7); x.fill();
  }
  const fw = (10 + rnd() * 2.5) * u;
  const fh = (13.5 + rnd() * 2) * u;
  const cy = h * 0.39;
  const jawW = fw * (0.62 + rnd() * 0.12);
  const eyeDX = fw * (0.40 + rnd() * 0.06);
  const eyeY = cy - fh * 0.06;
  const eyeW = fw * (0.195 + rnd() * 0.035);
  const eyeH = eyeW * (0.5 + rnd() * 0.1);
  const noseL = fh * (0.30 + rnd() * 0.08);
  const lipW = fw * (0.52 + rnd() * 0.1);
  const lipY = cy + fh * 0.52;
  const lipFull = (0.8 + rnd() * 0.5) * u;
  const browT = (0.7 + rnd() * 0.5) * u;
  const shadow = mix(skin, "#5a3423", 0.45);
  const hairD = mix(hairC, "#000000", 0.4);
  const hairL = mix(hairC, "#ffffff", 0.32);
  const irisC = ["#3a2317", "#4a2c14", "#2b3a24", "#3f3f45", "#5a4028"][Math.floor(rnd() * 5)];
  const lipC = mix(skin, "#a33e4a", 0.55);
  const hs = Math.floor(rnd() * 4);
  const lineW = mix(hairC, "#000000", 0.55);
  const shY = h * 0.60;
  const neckHW = fw * 0.42;
  const neckTop = cy + fh * 0.78;
  const collarY = shY + 3 * u;
  const pose = poseFromPrompt(prompt, rnd);
  const t = pose.turn;
  const tA = Math.min(1, Math.abs(t));
  const tS = t === 0 ? 0 : Math.sign(t);
  const fcx = cx + t * fw * 0.5;
  const farSgn = -tS;
  const isFar = (sgn) => tS !== 0 && sgn === farSgn;
  const sideK = (sgn) => isFar(sgn) ? 1 - 0.35 * tA : 1;
  const tiltA = pose.tilt * Math.PI / 180;
  const gazeX = pose.gazeX, gazeY = pose.gazeY;
  const lipCX = fcx + t * 1.8 * u;
  const lipWW = lipW * (1 - 0.12 * tA);
  const backShift = -t * fw * 0.3;
  const pullL = farSgn === -1 ? tA * fw * 0.45 : 0;
  const pullR = farSgn === 1 ? tA * fw * 0.45 : 0;
  x.save();
  x.translate(cx, h * 0.78);
  x.rotate(tiltA);
  x.translate(-cx, -h * 0.78);
  x.save();
  x.translate(backShift, 0);
  x.fillStyle = hairD;
  if (hs === 0) {
    x.beginPath();
    x.moveTo(cx - fw * 1.35, cy - fh * 0.9);
    x.quadraticCurveTo(cx - fw * 1.5, h * 0.55, cx - fw * 1.1, h * 0.72);
    x.lineTo(cx + fw * 1.1, h * 0.72);
    x.quadraticCurveTo(cx + fw * 1.5, h * 0.55, cx + fw * 1.35, cy - fh * 0.9);
    x.quadraticCurveTo(cx, cy - fh * 1.5, cx - fw * 1.35, cy - fh * 0.9);
    x.fill();
  } else if (hs === 1) {
    x.beginPath();
    x.ellipse(cx, cy - fh * 0.25, fw * 1.38, fh * 1.18, 0, 0, 7);
    x.fill();
  } else if (hs === 2) {
    x.beginPath();
    x.ellipse(cx, cy - fh * 0.45, fw * 1.12, fh * 0.95, 0, 0, 7);
    x.fill();
  } else {
    x.beginPath();
    x.ellipse(cx, cy - fh * 0.2, fw * 1.5, fh * 1.25, 0, 0, 7);
    x.fill();
    x.fillStyle = mix(hairD, "#000000", 0.25);
    for (let i = 0; i < 26; i++) {
      const a = rnd() * Math.PI * 2;
      const rr = (fw * 1.1 + rnd() * fw * 0.5);
      x.beginPath();
      x.arc(cx + Math.cos(a) * rr * 0.8, cy - fh * 0.2 + Math.sin(a) * fh * 0.9, (0.8 + rnd() * 1.4) * u, 0, 7);
      x.fill();
    }
    x.fillStyle = hairD;
  }
  x.restore();
  x.fillStyle = clothC;
  x.beginPath();
  x.moveTo(cx - 32 * u, h);
  x.quadraticCurveTo(cx - 30 * u, shY + 12 * u, cx - 20 * u, shY + 2 * u);
  x.quadraticCurveTo(cx - 12 * u, shY - 1 * u, cx - neckHW * 1.1, shY + 1 * u);
  x.lineTo(cx + neckHW * 1.1, shY + 1 * u);
  x.quadraticCurveTo(cx + 12 * u, shY - 1 * u, cx + 20 * u, shY + 2 * u);
  x.quadraticCurveTo(cx + 30 * u, shY + 12 * u, cx + 32 * u, h);
  x.closePath(); x.fill();
  const clothGrad = x.createLinearGradient(cx - 15 * u, 0, cx + 15 * u, 0);
  clothGrad.addColorStop(0, "rgba(255,255,255,0.14)");
  clothGrad.addColorStop(0.45, "rgba(0,0,0,0)");
  clothGrad.addColorStop(1, "rgba(0,0,0,0.30)");
  x.fillStyle = clothGrad;
  x.fillRect(cx - 30 * u, shY, 60 * u, h - shY);
  x.strokeStyle = "rgba(0,0,0,0.16)";
  x.lineWidth = Math.max(1, 0.5 * u);
  for (let i = 0; i < 5; i++) {
    const fx = cx + (rnd() - 0.5) * 36 * u;
    x.beginPath();
    x.moveTo(fx, shY + (4 + rnd() * 4) * u);
    x.quadraticCurveTo(fx + (rnd() - 0.5) * 6 * u, shY + 14 * u, fx + (rnd() - 0.5) * 4 * u, h - 4 * u);
    x.stroke();
  }
  const neckGrad = x.createLinearGradient(0, neckTop, 0, collarY);
  neckGrad.addColorStop(0, mix(skinD, "#2a160d", 0.45));
  neckGrad.addColorStop(0.45, skinD);
  neckGrad.addColorStop(1, skin);
  x.fillStyle = neckGrad;
  x.beginPath();
  x.moveTo(cx - neckHW, neckTop);
  x.lineTo(cx + neckHW, neckTop);
  x.lineTo(cx + neckHW * 1.25, collarY);
  x.lineTo(cx - neckHW * 1.25, collarY);
  x.closePath(); x.fill();
  const face = new Path2D();
  face.moveTo(fcx - fw * 0.98 + pullL, cy - fh * 0.55);
  face.bezierCurveTo(fcx - fw * 1.04 + pullL, cy + fh * 0.25, fcx - jawW + pullL * 0.5, cy + fh * 0.78, fcx, cy + fh);
  face.bezierCurveTo(fcx + jawW - pullR * 0.5, cy + fh * 0.78, fcx + fw * 1.04 - pullR, cy + fh * 0.25, fcx + fw * 0.98 - pullR, cy - fh * 0.55);
  face.bezierCurveTo(fcx + fw * 0.72 - pullR, cy - fh * 1.04, fcx - fw * 0.72 + pullL, cy - fh * 1.04, fcx - fw * 0.98 + pullL, cy - fh * 0.55);
  face.closePath();
  const skinGrad = x.createLinearGradient(0, cy - fh, 0, cy + fh);
  skinGrad.addColorStop(0, mix(skin, "#ffffff", 0.10));
  skinGrad.addColorStop(0.55, skin);
  skinGrad.addColorStop(1, mix(skin, "#7a4a2e", 0.18));
  x.fillStyle = skinGrad;
  x.fill(face);
  x.save();
  x.clip(face);
  const lightW = x.createRadialGradient(cx - fw * 0.55, cy - fh * 0.45, 0, cx - fw * 0.55, cy - fh * 0.45, fw * 1.5);
  lightW.addColorStop(0, "rgba(255,255,255,0.20)");
  lightW.addColorStop(1, "rgba(255,255,255,0)");
  x.fillStyle = lightW;
  x.fillRect(cx - fw * 1.2, cy - fh * 1.2, fw * 2.4, fh * 2.4);
  const shadeR = x.createLinearGradient(cx, 0, cx + fw * 1.1, 0);
  shadeR.addColorStop(0, "rgba(0,0,0,0)");
  shadeR.addColorStop(1, "rgba(70,35,20,0.30)");
  x.fillStyle = shadeR;
  x.fillRect(cx - fw * 1.2, cy - fh * 1.2, fw * 2.4, fh * 2.4);
  x.fillStyle = blush;
  x.globalAlpha = 0.28;
  for (const sgn of [-1, 1]) {
    x.beginPath();
    x.ellipse(fcx + sgn * fw * 0.55 * sideK(sgn), cy + fh * 0.28, fw * 0.28, fh * 0.14, 0, 0, 7);
    x.fill();
  }
  x.globalAlpha = 1;
  x.strokeStyle = "rgba(255,255,255,0.28)";
  x.lineWidth = Math.max(1, 0.7 * u);
  x.lineCap = "round";
  x.beginPath();
  x.moveTo(fcx - 0.4 * u + t * 0.3 * u, eyeY + 0.5 * u);
  x.lineTo(fcx - 0.4 * u + t * 0.9 * u, eyeY + noseL);
  x.stroke();
  x.strokeStyle = "rgba(70,35,20,0.20)";
  x.lineWidth = Math.max(1, 0.6 * u);
  x.beginPath();
  x.moveTo(fcx + 1.1 * u + t * 0.5 * u, eyeY + 1.2 * u);
  x.quadraticCurveTo(fcx + 1.5 * u + t * 0.8 * u, eyeY + noseL * 0.7, fcx + 1.2 * u + t * 0.9 * u, eyeY + noseL);
  x.stroke();
  x.fillStyle = "rgba(70,35,20,0.14)";
  for (const sgn of [-1, 1]) {
    x.beginPath();
    x.ellipse(fcx + sgn * 1.6 * u, eyeY + noseL + 0.2 * u, 0.9 * u, 0.55 * u, sgn * 0.3, 0, 7);
    x.fill();
  }
  x.fillStyle = "rgba(25,12,8,0.8)";
  for (const sgn of [-1, 1]) {
    x.beginPath();
    x.ellipse(fcx + sgn * 1.0 * u, eyeY + noseL + 0.45 * u, 0.42 * u, 0.27 * u, sgn * 0.35, 0, 7);
    x.fill();
  }
  x.fillStyle = "rgba(255,255,255,0.30)";
  x.beginPath();
  x.ellipse(fcx - 0.2 * u + t * 0.4 * u, eyeY + noseL - 0.4 * u, 0.9 * u, 0.5 * u, 0, 0, 7);
  x.fill();
  for (const sgn of [-1, 1]) {
    const ex = fcx + sgn * eyeDX * sideK(sgn);
    const sock = x.createRadialGradient(ex, eyeY - eyeH * 0.4, 0, ex, eyeY - eyeH * 0.4, eyeW * 1.4);
    sock.addColorStop(0, "rgba(90,50,30,0.25)");
    sock.addColorStop(1, "rgba(90,50,30,0)");
    x.fillStyle = sock;
    x.beginPath(); x.ellipse(ex, eyeY - eyeH * 0.2, eyeW * 1.25, eyeH * 1.1, 0, 0, 7); x.fill();
    x.fillStyle = "#efe9df";
    x.beginPath();
    x.moveTo(ex - eyeW, eyeY);
    x.quadraticCurveTo(ex, eyeY - eyeH * 1.25, ex + eyeW * 0.95, eyeY - eyeH * 0.25);
    x.quadraticCurveTo(ex + eyeW * 0.4, eyeY + eyeH * 0.9, ex - eyeW, eyeY);
    x.closePath(); x.fill();
    const irisR = eyeH * 0.92;
    const gx = gazeX * irisR * 0.6, gy = gazeY * irisR * 0.5;
    const irisG = x.createRadialGradient(ex + gx, eyeY + gy, irisR * 0.1, ex + gx, eyeY + gy, irisR);
    irisG.addColorStop(0, "#0d0b09");
    irisG.addColorStop(0.42, "#0d0b09");
    irisG.addColorStop(0.5, irisC);
    irisG.addColorStop(0.85, mix(irisC, "#000000", 0.35));
    irisG.addColorStop(1, mix(irisC, "#000000", 0.7));
    x.fillStyle = irisG;
    x.beginPath(); x.arc(ex + gx, eyeY + eyeH * 0.05 + gy, irisR, 0, 7); x.fill();
    x.fillStyle = "rgba(255,255,255,0.92)";
    x.beginPath(); x.arc(ex - irisR * 0.3 + gx, eyeY - irisR * 0.3 + gy, irisR * 0.26, 0, 7); x.fill();
    x.fillStyle = "rgba(255,255,255,0.55)";
    x.beginPath(); x.arc(ex + irisR * 0.35 + gx, eyeY + irisR * 0.4 + gy, irisR * 0.12, 0, 7); x.fill();
    x.strokeStyle = lineW;
    x.lineWidth = Math.max(1.2, 0.5 * u);
    x.beginPath();
    x.moveTo(ex - eyeW * 1.02, eyeY + eyeH * 0.05);
    x.quadraticCurveTo(ex, eyeY - eyeH * 1.45, ex + eyeW * 1.0, eyeY - eyeH * 0.3);
    x.stroke();
    x.strokeStyle = "rgba(40,20,14,0.5)";
    x.lineWidth = Math.max(1, 0.28 * u);
    for (let l = 0; l < 6; l++) {
      const t = 0.45 + l * 0.11;
      const lx = ex - eyeW * 1.02 + t * eyeW * 2.0;
      const ly = eyeY + eyeH * 0.05 - Math.sin(t * Math.PI) * eyeH * 1.2;
      x.beginPath();
      x.moveTo(lx, ly);
      x.lineTo(lx + eyeW * 0.35 * (t - 0.3), ly - eyeH * 0.55);
      x.stroke();
    }
    x.strokeStyle = "rgba(60,30,20,0.35)";
    x.lineWidth = Math.max(0.8, 0.2 * u);
    x.beginPath();
    x.moveTo(ex - eyeW * 0.8, eyeY + eyeH * 0.85);
    x.quadraticCurveTo(ex, eyeY + eyeH * 1.1, ex + eyeW * 0.8, eyeY + eyeH * 0.7);
    x.stroke();
    x.fillStyle = mix(hairC, "#000000", 0.15);
    x.beginPath();
    x.moveTo(ex - eyeW * 1.35, eyeY - eyeH * 1.7);
    x.quadraticCurveTo(ex, eyeY - eyeH * (2.1 + browT / u * 0.4), ex + eyeW * 1.4, eyeY - eyeH * 1.5);
    x.quadraticCurveTo(ex + eyeW * 1.35, eyeY - eyeH * 1.1, ex + eyeW * 1.25, eyeY - eyeH * 1.2);
    x.quadraticCurveTo(ex, eyeY - eyeH * 1.55, ex - eyeW * 1.25, eyeY - eyeH * 1.25);
    x.closePath(); x.fill();
    x.strokeStyle = "rgba(0,0,0,0.3)";
    x.lineWidth = Math.max(0.7, 0.16 * u);
    for (let b = 0; b < 7; b++) {
      const bx = ex - eyeW * 1.2 + b * eyeW * 0.4;
      x.beginPath();
      x.moveTo(bx, eyeY - eyeH * 1.55);
      x.lineTo(bx + eyeW * 0.18, eyeY - eyeH * 1.95);
      x.stroke();
    }
  }
  const smile = rnd() * 1.2 * u;
  const mouthUpper = mix(lipC, "#4a1a22", 0.4);
  x.fillStyle = mouthUpper;
  x.beginPath();
  x.moveTo(lipCX - lipWW / 2, lipY);
  x.quadraticCurveTo(lipCX - lipWW * 0.18, lipY - lipFull * 0.5, lipCX, lipY - lipFull * 0.15);
  x.quadraticCurveTo(lipCX + lipWW * 0.18, lipY - lipFull * 0.5, lipCX + lipWW / 2, lipY);
  x.quadraticCurveTo(lipCX, lipY + lipFull * 0.28 + smile * 0.3, lipCX - lipWW / 2, lipY);
  x.closePath(); x.fill();
  const lowG = x.createLinearGradient(0, lipY, 0, lipY + lipFull * 1.5);
  lowG.addColorStop(0, mix(lipC, "#4a1a22", 0.25));
  lowG.addColorStop(0.55, lipC);
  lowG.addColorStop(1, mix(lipC, "#4a1a22", 0.3));
  x.fillStyle = lowG;
  x.beginPath();
  x.moveTo(lipCX - lipWW / 2, lipY);
  x.quadraticCurveTo(lipCX, lipY + lipFull * 0.3 + smile * 0.3, lipCX + lipWW / 2, lipY);
  x.quadraticCurveTo(lipCX + lipWW * 0.3, lipY + lipFull * 1.5, lipCX, lipY + lipFull * 1.45);
  x.quadraticCurveTo(lipCX - lipWW * 0.3, lipY + lipFull * 1.5, lipCX - lipWW / 2, lipY);
  x.closePath(); x.fill();
  x.strokeStyle = "rgba(60,18,24,0.65)";
  x.lineWidth = Math.max(0.8, 0.22 * u);
  x.beginPath();
  x.moveTo(lipCX - lipWW / 2, lipY);
  x.quadraticCurveTo(lipCX, lipY + lipFull * 0.3 + smile * 0.3, lipCX + lipWW / 2, lipY);
  x.stroke();
  x.fillStyle = "rgba(255,255,255,0.35)";
  x.beginPath();
  x.ellipse(lipCX, lipY + lipFull * 0.85, lipWW * 0.14, lipFull * 0.2, 0, 0, 7);
  x.fill();
  x.strokeStyle = "rgba(90,50,32,0.25)";
  x.lineWidth = Math.max(0.8, 0.2 * u);
  x.beginPath();
  x.moveTo(lipCX - lipWW * 0.25, lipY + lipFull * 1.9);
  x.quadraticCurveTo(lipCX, lipY + lipFull * 2.1, lipCX + lipWW * 0.25, lipY + lipFull * 1.9);
  x.stroke();
  x.strokeStyle = "rgba(90,50,32,0.16)";
  for (const sgn of [-1, 1]) {
    x.beginPath();
    x.moveTo(lipCX + sgn * 1.9 * u, eyeY + noseL - 0.5 * u);
    x.quadraticCurveTo(lipCX + sgn * (lipWW * 0.5 + 1 * u), lipY - lipFull * 0.6, lipCX + sgn * lipWW * 0.52, lipY - 0.2 * u);
    x.stroke();
    x.beginPath();
    x.moveTo(fcx + sgn * (eyeDX * 0.55) * sideK(sgn), eyeY + eyeH * 1.5);
    x.quadraticCurveTo(fcx + sgn * (eyeDX * 0.8) * sideK(sgn), eyeY + eyeH * 1.9, fcx + sgn * (eyeDX * 0.5) * sideK(sgn), eyeY + eyeH * 2.1);
    x.stroke();
  }
  x.strokeStyle = "rgba(90,50,32,0.20)";
  x.beginPath();
  x.moveTo(lipCX - 0.45 * u, lipY - lipFull * 0.9);
  x.lineTo(lipCX - 0.45 * u, lipY - lipFull * 0.2);
  x.moveTo(lipCX + 0.45 * u, lipY - lipFull * 0.9);
  x.lineTo(lipCX + 0.45 * u, lipY - lipFull * 0.2);
  x.stroke();
  for (let i = 0; i < 1100; i++) {
    const px = cx + (rnd() - 0.5) * fw * 2.1;
    const py = cy + (rnd() - 0.5) * fh * 2.0;
    x.fillStyle = rnd() < 0.5 ? "rgba(0,0,0,0.05)" : "rgba(255,255,255,0.05)";
    x.fillRect(px, py, Math.max(1, u * 0.28), Math.max(1, u * 0.28));
  }
  if (rnd() < 0.6) {
    x.fillStyle = "rgba(50,25,15,0.7)";
    x.beginPath();
    x.arc(fcx + (rnd() < 0.5 ? -1 : 1) * fw * (0.4 + rnd() * 0.25), cy + fh * (0.2 + rnd() * 0.2), Math.max(1, 0.16 * u), 0, 7);
    x.fill();
  }
  x.restore();
  x.fillStyle = skin;
  for (const sgn of [-1, 1]) {
    if (isFar(sgn)) continue;
    x.beginPath();
    x.ellipse(fcx + sgn * fw * 0.96, cy + fh * 0.18, 1.4 * u, 2.5 * u, 0, 0, 7);
    x.fill();
  }
  x.strokeStyle = "rgba(90,50,32,0.4)";
  x.lineWidth = Math.max(0.8, 0.2 * u);
  for (const sgn of [-1, 1]) {
    if (isFar(sgn)) continue;
    x.beginPath();
    x.arc(fcx + sgn * fw * 0.96, cy + fh * 0.18, 0.75 * u, -1.2, 1.2);
    x.stroke();
  }
  const hairlineY = cy - fh * (0.62 + rnd() * 0.14);
  const fringeLen = hs === 1 ? 2.4 : 0.7;
  x.save();
  x.translate((fcx - cx) * 0.7, 0);
  x.fillStyle = hairC;
  x.beginPath();
  x.moveTo(cx - fw * 1.16, cy - fh * 0.15);
  x.quadraticCurveTo(cx - fw * 1.2, cy - fh * 1.25, cx, cy - fh * 1.3);
  x.quadraticCurveTo(cx + fw * 1.2, cy - fh * 1.25, cx + fw * 1.16, cy - fh * 0.15);
  x.lineTo(cx + fw * 0.92, hairlineY + 2.2 * u);
  for (let k = 4; k >= -4; k--) {
    const jx = cx + k * fw * 0.2;
    x.quadraticCurveTo(jx + fw * 0.08, hairlineY + fringeLen * u + ((k % 2) ? 0.9 : 0) * u, jx - fw * 0.1, hairlineY + (fringeLen * 0.7) * u);
  }
  x.lineTo(cx - fw * 0.92, hairlineY + 2.2 * u);
  x.closePath(); x.fill();
  const crownG = x.createLinearGradient(cx - fw, 0, cx + fw, 0);
  crownG.addColorStop(0, "rgba(255,255,255,0.22)");
  crownG.addColorStop(0.5, "rgba(0,0,0,0)");
  crownG.addColorStop(1, "rgba(0,0,0,0.28)");
  x.fillStyle = crownG;
  x.beginPath();
  x.ellipse(cx, cy - fh * 0.75, fw * 1.05, fh * 0.55, 0, Math.PI, 0);
  x.fill();
  x.restore();
  if (hs === 0 || hs === 3) {
    for (const sgn of [-1, 1]) {
      x.fillStyle = hairC;
      x.beginPath();
      x.ellipse(fcx + backShift * 0.5 + sgn * fw * 1.08, cy + fh * 0.5, fw * 0.22 * (isFar(sgn) ? 0.7 : 1.3), fh * (hs === 0 ? 0.85 : 0.6), sgn * 0.08, 0, 7);
      x.fill();
    }
  } else if (hs === 2) {
    x.fillStyle = hairC;
    for (const sgn of [-1, 1]) {
      x.beginPath();
      x.ellipse(cx + sgn * fw * 1.02, cy - fh * 0.1, fw * 0.2, fh * 0.35, 0, 0, 7);
      x.fill();
    }
  }
  x.lineCap = "round";
  x.save();
  const hairRegion = new Path2D();
  hairRegion.ellipse(cx + backShift, cy - fh * 0.15, fw * 1.5, fh * 1.35, 0, 0, 7);
  if (hs === 0 || hs === 3) hairRegion.rect(cx + backShift - fw * 1.5, cy, fw * 3, h * 0.72 - cy);
  x.clip(hairRegion);
  const strands = hs === 3 ? 120 : 170;
  const strandBot = hs === 2 ? cy + fh * 0.75 : cy + fh * 1.15;
  const eyeBandL = fcx - eyeDX * sideK(-1) - eyeW * 1.3, eyeBandR = fcx - eyeDX * sideK(-1) + eyeW * 1.3;
  const eyeBandL2 = fcx + eyeDX * sideK(1) - eyeW * 1.3, eyeBandR2 = fcx + eyeDX * sideK(1) + eyeW * 1.3;
  const browLine = eyeY - eyeH * 2.4;
  for (let i = 0; i < strands; i++) {
    const t = rnd();
    const sx = cx + backShift + (t - 0.5) * fw * 2.0;
    const sy = cy - fh * (0.9 + rnd() * 0.4);
    let exx = cx + backShift + (t - 0.5) * fw * (2.0 + rnd() * 0.4);
    let ey = Math.min(strandBot, hairlineY + 1 * u + Math.pow(rnd(), 1.6) * fh * 1.1);
    if ((exx > eyeBandL && exx < eyeBandR) || (exx > eyeBandL2 && exx < eyeBandR2)) ey = Math.min(ey, browLine);
    const shade = rnd();
    x.strokeStyle = shade < 0.33 ? hairD : shade < 0.66 ? hairC : hairL;
    x.globalAlpha = 0.22 + rnd() * 0.28;
    x.lineWidth = Math.max(0.7, (0.16 + rnd() * 0.3) * u);
    x.beginPath();
    x.moveTo(sx, sy);
    x.quadraticCurveTo(sx + (exx - sx) * 0.3 + (rnd() - 0.5) * 3 * u, sy + (ey - sy) * 0.5, exx, ey);
    x.stroke();
  }
  x.restore();
  x.globalAlpha = 1;
  x.strokeStyle = "rgba(255,255,255,0.30)";
  x.lineWidth = Math.max(1, 0.4 * u);
  x.beginPath();
  x.ellipse(cx, cy - fh * 0.72, fw * 1.0, fh * 0.52, 0, Math.PI * 1.05, Math.PI * 1.65);
  x.stroke();
  const csel = Math.floor(rnd() * 3);
  if (csel === 0) {
    x.strokeStyle = mix(clothC, "#000000", 0.35);
    x.lineWidth = Math.max(2, 1.0 * u);
    x.beginPath();
    x.ellipse(cx, collarY - 1 * u, neckHW * 1.35, 2.2 * u, 0, 0, Math.PI);
    x.stroke();
  } else if (csel === 1) {
    x.strokeStyle = mix(clothC, "#000000", 0.4);
    x.lineWidth = Math.max(1.5, 0.7 * u);
    x.beginPath();
    x.moveTo(cx - neckHW * 1.3, collarY - 1 * u);
    x.lineTo(cx, collarY + 4 * u);
    x.lineTo(cx + neckHW * 1.3, collarY - 1 * u);
    x.stroke();
  } else {
    x.fillStyle = mix(clothC, "#ffffff", 0.12);
    for (const sgn of [-1, 1]) {
      x.beginPath();
      x.moveTo(cx + sgn * neckHW * 0.4, collarY - 1 * u);
      x.lineTo(cx + sgn * neckHW * 1.5, collarY - 0.5 * u);
      x.lineTo(cx + sgn * neckHW * 1.1, collarY + 3 * u);
      x.lineTo(cx + sgn * neckHW * 0.3, collarY + 2 * u);
      x.closePath(); x.fill();
    }
    x.fillStyle = mix(clothC, "#000000", 0.3);
    x.beginPath();
    x.arc(cx, collarY + 5 * u, 0.5 * u, 0, 7);
    x.fill();
  }
  x.restore();
  for (let i = 0; i < 1500; i++) {
    x.fillStyle = rnd() < 0.5 ? "rgba(0,0,0,0.035)" : "rgba(255,255,255,0.035)";
    x.fillRect(rnd() * w, rnd() * h, Math.max(1, u * 0.3), Math.max(1, u * 0.3));
  }
  const vg = x.createRadialGradient(cx, h * 0.5, Math.min(w, h) * 0.35, cx, h * 0.5, Math.max(w, h) * 0.75);
  vg.addColorStop(0, "rgba(0,0,0,0)");
  vg.addColorStop(1, "rgba(0,0,0,0.34)");
  x.fillStyle = vg; x.fillRect(0, 0, w, h);
  const seedTag = String((seed >>> 0) % 100000);
  x.fillStyle = "rgba(255,255,255,0.55)";
  x.font = `${Math.max(10, Math.round(u * 2.4))}px monospace`;
  x.fillText(`${id} · #${seedTag}`, 8, h - 8);
  const blob = await new Promise(res => cv.toBlob(res, "image/png"));
  return { blob, by: `${id}-v${W.version || 1} · CPU lab · #${seedTag} · ${pose.label}`, canvas: cv };
}

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}

export function mountLabPanel() {
  const page = document.getElementById("pageAIModelLab");
  if (!page || page.dataset.ankiBound) return;
  page.dataset.ankiBound = "1";
  const store = loadStore();
  const wrap = el("section", "panel anki-lab");
  wrap.id = "ankiLabPanel";
  wrap.innerHTML = `
    <div class="panel-head"><h2>🧬 CPU Human & Mage Lab</h2><span class="hint">anki-human-cpu · iani-mage-cpu · 100% on-device</span></div>
    <div class="hint-block">CPU trains the identity on-device from reference photos (face-checked, palette + identity capsule). Photo previews render photoreal via diffusion conditioned on that capsule, then face-locked to your refs on CPU. Train below, add your own photos, then pick the model in the <b>Image</b> tab (group <b>Lab</b>). Add <b>3d</b> / pixar / clay / chibi for the offline 3D character mode.</div>
    <div class="anki-cards"></div>`;
  const cards = wrap.querySelector(".anki-cards");
  for (const m of ANKI_CPU_MODELS) {
    const w = store[m.id];
    const card = el("div", "anki-card");
    card.id = `ankiCard-${m.id}`;
    const ident0 = getIdentity(m.id);
    card.innerHTML = `
      <div class="row-between"><strong>${m.label}</strong><span class="mono tiny anki-status">${w.epochs ? `trained · ${w.epochs} epochs · v${w.version}` : "untrained"}</span></div>
      <div class="tiny">${m.desc}</div>
      <div class="tiny anki-ident">${ident0 ? `identity: ${ident0.hair} · ${ident0.skin} · ${ident0.faces} faces / ${ident0.refs} refs` : "identity: not learned yet — train to lock it"}</div>
      <div class="anki-refs">${getRefs(m.id).map(u => `<img loading="lazy" src="${u}" alt="reference">`).join("")}</div>
      <div class="row-between">
        <label class="export-lbl">Epochs <input class="mono anki-epochs" type="number" min="1" max="20" value="5" style="width:56px"></label>
        <span class="mono tiny anki-loss">${w.loss.length ? "loss " + w.loss[w.loss.length - 1] : "loss —"}</span>
      </div>
      <canvas class="anki-curve" width="260" height="54"></canvas>
      <div class="result-actions">
        <button class="btn btn-primary btn-tiny anki-train" type="button">Train ${m.kind === "mage" ? "mage" : "human"}</button>
        <button class="btn btn-ghost btn-tiny anki-upload" type="button" title="Add your own reference photos — they train first and anchor the face-lock">+ Your photos</button>
        <button class="btn btn-ghost btn-tiny anki-sample" type="button">Preview</button>
        <button class="btn btn-ghost btn-tiny anki-sample3d" type="button">Preview 3D</button>
      </div>
      <input class="anki-file" type="file" accept="image/*" multiple hidden>
      <div class="mono tiny anki-log">refs: ${getRefs(m.id).length} images · idle</div>
      <div class="anki-prev"></div>`;
    cards.appendChild(card);
    drawCurve(card.querySelector(".anki-curve"), w.loss);
    card.querySelector(".anki-train").onclick = async ev => {
      const btn = ev.currentTarget;
      const ep = Math.max(1, Math.min(20, +card.querySelector(".anki-epochs").value || 5));
      const log = card.querySelector(".anki-log");
      btn.disabled = true;
      try {
        log.textContent = `training ${ep} epochs on CPU…`;
        const r = await trainCpuModel(m.id, { epochs: ep, onEpoch: e => { log.textContent = `epoch ${e.epoch} · loss ${e.loss} · ${e.faces} faces / ${e.refs} refs`; } });
        const nw = getWeights(m.id);
        card.querySelector(".anki-status").textContent = `trained · ${nw.epochs} epochs · v${nw.version}`;
        card.querySelector(".anki-loss").textContent = "loss " + nw.loss[nw.loss.length - 1];
        drawCurve(card.querySelector(".anki-curve"), nw.loss);
        const ident = getIdentity(m.id);
        if (ident) card.querySelector(".anki-ident").textContent = `identity: ${ident.hair} · ${ident.skin} · ${ident.faces} faces / ${ident.refs} refs`;
        log.textContent = `done · ${nw.epochs} epochs · loss ${nw.loss[nw.loss.length - 1]} · ${r.faces} faces / ${r.refs} refs · use Image tab → Lab`;
      } catch (err) { log.textContent = "train failed: " + (err?.message || err); }
      btn.disabled = false;
    };
    const fileInp = card.querySelector(".anki-file");
    card.querySelector(".anki-upload").onclick = () => fileInp.click();
    fileInp.onchange = async () => {
      const log = card.querySelector(".anki-log");
      const files = [...(fileInp.files || [])].slice(0, 10);
      if (!files.length) return;
      try {
        log.textContent = `reading ${files.length} photo(s)…`;
        const urls = [];
        for (const f of files) {
          const dataUrl = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); });
          if (typeof dataUrl === "string" && dataUrl.startsWith("data:image")) urls.push(dataUrl);
        }
        addCustomRefs(m.id, urls);
        const refsEl = card.querySelector(".anki-refs");
        refsEl.innerHTML = getRefs(m.id).map(u => `<img loading="lazy" src="${u}" alt="reference">`).join("");
        log.textContent = `added ${urls.length} photo(s) · refs: ${getRefs(m.id).length} · now press Train`;
      } catch (err) { log.textContent = "add photos failed: " + (err?.message || err); }
      fileInp.value = "";
    };
    card.querySelector(".anki-sample").onclick = async ev => {
      const btn = ev.currentTarget;
      const log = card.querySelector(".anki-log");
      btn.disabled = true;
      try {
        log.textContent = "rendering preview…";
        const r = await renderLabImage({ prompt: m.kind, modelId: m.id, w: 512, h: 512 });
        const prev = card.querySelector(".anki-prev");
        prev.innerHTML = "";
        const img = document.createElement("img");
        img.src = URL.createObjectURL(r.blob);
        img.alt = m.label;
        prev.appendChild(img);
        log.textContent = "preview ready · " + r.by;
      } catch (err) { log.textContent = "preview failed: " + (err?.message || err); }
      btn.disabled = false;
    };
    card.querySelector(".anki-sample3d").onclick = async ev => {
      const btn = ev.currentTarget;
      const log = card.querySelector(".anki-log");
      btn.disabled = true;
      try {
        log.textContent = "rendering 3D character…";
        const r = await renderLabImage({ prompt: m.kind + " 3d character three-quarter", modelId: m.id, w: 512, h: 512 });
        const prev = card.querySelector(".anki-prev");
        prev.innerHTML = "";
        const img = document.createElement("img");
        img.src = URL.createObjectURL(r.blob);
        img.alt = m.label + " 3D";
        prev.appendChild(img);
        log.textContent = "3D ready · " + r.by;
      } catch (err) { log.textContent = "3D preview failed: " + (err?.message || err); }
      btn.disabled = false;
    };
  }
  page.insertBefore(wrap, page.firstChild);
}

function drawCurve(cv, loss) {  const x = cv.getContext("2d");
  x.clearRect(0, 0, cv.width, cv.height);
  x.fillStyle = "rgba(255,255,255,0.04)";
  x.fillRect(0, 0, cv.width, cv.height);
  if (!loss?.length) {
    x.fillStyle = "rgba(255,255,255,0.4)";
    x.font = "11px monospace";
    x.fillText("train to see loss curve", 12, 30);
    return;
  }
  const mx = Math.max(...loss), mn = Math.min(...loss), rg = Math.max(1e-4, mx - mn);
  x.strokeStyle = "#3ec6ff"; x.lineWidth = 1.6; x.beginPath();
  loss.forEach((L, i) => {
    const px = 6 + (i / Math.max(1, loss.length - 1)) * (cv.width - 12);
    const py = 6 + (1 - (L - mn) / rg) * (cv.height - 12);
    i ? x.lineTo(px, py) : x.moveTo(px, py);
  });
  x.stroke();
}

if (typeof document !== "undefined") {
  const boot = () => mountLabPanel();
  if (document.readyState !== "loading") setTimeout(boot, 400);
  else document.addEventListener("DOMContentLoaded", () => setTimeout(boot, 400));
  new MutationObserver(() => mountLabPanel()).observe(document.documentElement, { childList: true, subtree: true });
}

export function paletteDiversity(id) {
  const w = loadStore()[id];
  if (!w) return 0;
  const pts = [];
  for (const f of ["skin", "hair", "cloth", "bg", "glow"]) for (const h of (w[f] || [])) pts.push(hexRgb(h));
  if (pts.length < 2) return 0;
  let s = 0, n = 0;
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
    s += Math.sqrt((pts[i][0] - pts[j][0]) ** 2 + (pts[i][1] - pts[j][1]) ** 2 + (pts[i][2] - pts[j][2]) ** 2) / 441.6;
    n++;
  }
  return n ? s / n : 0;
}

export function absorbScenario(id, target, lr = 0.06) {
  const store = loadStore();
  const w = store[id];
  if (!w || !target) return 0;
  const slot = (w.dreams || 0);
  for (const f of ["skin", "hair", "cloth", "bg", "glow"]) {
    if (!target[f] || !Array.isArray(w[f]) || !w[f].length) continue;
    const i = slot % w[f].length;
    w[f][i] = mix(w[f][i], target[f], Math.max(0.01, Math.min(0.25, lr)));
  }
  w.dreams = slot + 1;
  saveStore(store);
  return paletteDiversity(id);
}

export function injectJitter(id, amt = 26) {
  const store = loadStore();
  const w = store[id];
  if (!w) return;
  const keys = ["skin", "hair", "cloth", "bg", "glow"].filter(f => Array.isArray(w[f]) && w[f].length);
  if (!keys.length) return;
  const f = keys[(w.dreams || 0) % keys.length];
  const i = (w.dreams || 0) % w[f].length;
  const c = hexRgb(w[f][i]);
  const j = () => (Math.random() - 0.5) * 2 * amt;
  w[f][i] = rgbHex(c[0] + j(), c[1] + j(), c[2] + j());
  saveStore(store);
}
