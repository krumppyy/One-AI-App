import { encodeSoma } from "./ankan-soma.js";
import { analyzeImage } from "./codec-analysis.js";
import { defaultGrade, applyPreset, gradeCanvasInPlace } from "./grade.js";
import { scoreEdit } from "./quality.js";
export function promptGradeId(prompt) {
  const s = String(prompt || "").toLowerCase();
  if (/black.?and.?white|monochrome|\bnoir\b/.test(s)) return "noir";
  if (/sunset|golden hour/.test(s)) return "sunset";
  if (/\bteal\b|underwater|\bocean\b/.test(s)) return "teal";
  if (/vintage|retro|\bfilm\b/.test(s)) return "vintage";
  if (/\bcool\b|moonlit|\bnight\b|\bblue\b/.test(s)) return "cool";
  if (/\bwarm\b|cozy|amber/.test(s)) return "warm";
  if (/vibrant|neon|vivid/.test(s)) return "vibrant";
  if (/gritty|\bgrain\b|grunge/.test(s)) return "grain";
  return "cinematic";
}
const loadImage = (url) => new Promise((res, rej) => {
  const img = new Image();
  img.onload = () => res(img);
  img.onerror = rej;
  img.src = url;
});
function drawHigh(ctx, src, sx, sy, sw, sh, dx, dy, dw, dh) {
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, sx, sy, sw, sh, dx, dy, dw, dh);
}
function shrinkHigh(src, tw, th) {
  let cur = src;
  let cw = src.width || tw;
  let ch = src.height || th;
  while (cw * 0.5 >= tw && ch * 0.5 >= th && (cw > tw * 1.5 || ch > th * 1.5)) {
    const step = document.createElement("canvas");
    step.width = Math.max(tw, Math.round(cw * 0.5));
    step.height = Math.max(th, Math.round(ch * 0.5));
    const sx = step.getContext("2d");
    drawHigh(sx, cur, 0, 0, cw, ch, 0, 0, step.width, step.height);
    cur = step;
    cw = step.width;
    ch = step.height;
  }
  if (cw !== tw || ch !== th) {
    const fin = document.createElement("canvas");
    fin.width = tw;
    fin.height = th;
    drawHigh(fin.getContext("2d"), cur, 0, 0, cw, ch, 0, 0, tw, th);
    return fin;
  }
  return cur;
}
export async function blobToCanvas(blob, w, h, cover = true) {
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImage(url);
    const iw = img.naturalWidth || w;
    const ih = img.naturalHeight || h;
    if (cover) {
      const s = Math.max(w / iw, h / ih);
      const dw = Math.max(1, Math.round(iw * s));
      const dh = Math.max(1, Math.round(ih * s));
      let big;
      if (dw * dh > iw * ih * 1.2) {
        big = document.createElement("canvas");
        big.width = dw;
        big.height = dh;
        drawHigh(big.getContext("2d"), img, 0, 0, iw, ih, 0, 0, dw, dh);
      } else {
        big = document.createElement("canvas");
        big.width = dw;
        big.height = dh;
        const bx = big.getContext("2d");
        bx.imageSmoothingEnabled = true;
        bx.imageSmoothingQuality = "high";
        bx.drawImage(img, 0, 0, dw, dh);
      }
      const cv = document.createElement("canvas");
      cv.width = w; cv.height = h;
      cv.getContext("2d").drawImage(big, (w - dw) / 2, (h - dh) / 2);
      return cv;
    } else {
      const s = Math.min(w / iw, h / ih);
      const dw = Math.max(1, Math.round(iw * s));
      const dh = Math.max(1, Math.round(ih * s));
      const tmp = document.createElement("canvas");
      tmp.width = iw; tmp.height = ih;
      tmp.getContext("2d").drawImage(img, 0, 0);
      return shrinkHigh(tmp, dw, dh);
    }
  } finally {
    URL.revokeObjectURL(url);
  }
}
function promptHue(prompt, seed = 0) {
  let hue = seed % 360;
  for (const ch of String(prompt || "")) hue = (hue * 31 + ch.charCodeAt(0)) % 360;
  return hue;
}
function paintPromptCanvas(w, h, prompt, seed) {
  let rnd = (seed >>> 0) || 1;
  const rand = () => ((rnd = (rnd * 1664525 + 1013904223) >>> 0) / 4294967296);
  const hue = promptHue(prompt, seed);
  const cv = document.createElement("canvas");
  cv.width = w; cv.height = h;
  const ctx = cv.getContext("2d");
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, `hsl(${hue},45%,16%)`);
  g.addColorStop(0.5, `hsl(${(hue + 50) % 360},50%,28%)`);
  g.addColorStop(1, `hsl(${(hue + 110) % 360},45%,14%)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 260; i++) {
    ctx.fillStyle = `hsla(${(hue + rand() * 80) % 360},60%,${30 + rand() * 40}%,0.08)`;
    const r = 4 + rand() * Math.min(w, h) * 0.12;
    ctx.beginPath();
    ctx.arc(rand() * w, rand() * h, r, 0, 7);
    ctx.fill();
  }
  return cv;
}
const canvasToJpeg = (cv, q = 0.99) => new Promise((res, rej) => {
  cv.toBlob((b) => (b ? res(b) : rej(new Error("device render failed"))), "image/jpeg", q);
});
const fitCopy = (cv) => {
  const c = document.createElement("canvas");
  c.width = cv.width; c.height = cv.height;
  const cx = c.getContext("2d");
  cx.imageSmoothingEnabled = true;
  cx.imageSmoothingQuality = "high";
  cx.drawImage(cv, 0, 0);
  return c;
};
export function fitGradeToImage(cv, original, g) {
  const W = 160, H = 90;
  const small = (src) => {
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const x = c.getContext("2d", { willReadFrequently: true });
    x.imageSmoothingEnabled = true;
    x.imageSmoothingQuality = "high";
    x.drawImage(src, 0, 0, W, H);
    return x.getImageData(0, 0, W, H);
  };
  const energy = (im) => {
    const d = im.data;
    const lum = new Float32Array(W * H);
    for (let i = 0, p = 0; i < d.length; i += 4, p++) lum[p] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    let s = 0;
    for (let y = 1; y < H - 1; y++) for (let x0 = 1; x0 < W - 1; x0++) {
      const gx = lum[y * W + x0 + 1] - lum[y * W + x0 - 1];
      const gy = lum[(y + 1) * W + x0] - lum[(y - 1) * W + x0];
      s += Math.abs(gx) + Math.abs(gy);
    }
    return s / (W * H);
  };
  const e0 = energy(small(original));
  gradeCanvasInPlace(cv, g);
  const e1 = energy(small(cv));
  let alpha = 0;
  if (e1 < e0 * 0.985 && e0 > 0.01) {
    alpha = Math.min(0.6, Math.max(0.2, ((e0 - e1) / e0) * 2.2));
    const ctx = cv.getContext("2d");
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = "overlay";
    drawHigh(ctx, original, 0, 0, original.width, original.height, 0, 0, cv.width, cv.height);
    ctx.restore();
  }
  const e2 = energy(small(cv));
  return { edgeBefore: Math.round(e0 * 100) / 100, edgeGraded: Math.round(e1 * 100) / 100, edgeAfter: Math.round(e2 * 100) / 100, overlayAlpha: Math.round(alpha * 100) / 100 };
}
function naturalTarget(inputBlob, w, h) {
  return { W: Math.max(64, Math.min(1920, Math.round(w) || 768)), H: Math.max(64, Math.min(1920, Math.round(h) || 768)) };
}
export async function codecImageEdit({ prompt, inputBlob, w, h, seed = 1, strength = 0.6 }) {
  const { W, H } = naturalTarget(inputBlob, w, h);
  const cv = inputBlob
    ? await blobToCanvas(inputBlob, W, H, true)
    : paintPromptCanvas(W, H, prompt, seed);
  const base = fitCopy(cv);
  const gid = promptGradeId(prompt);
  const s01 = Math.min(1, Math.max(0, strength ?? 0.6));
  const intensities = inputBlob ? [0.22 + 0.25 * s01, 0.15, 0.08, 0] : [0.8, 0.5, 0.25];
  let best = null;
  let bestScore = -1;
  let bestCanvas = null;
  let bestFit = null;
  let bestG = null;
  for (const inten of intensities) {
    const trial = fitCopy(base);
    const g = applyPreset(defaultGrade(), gid);
    g.intensity = inten;
    if (inputBlob) g.sharpen = 0.55;
    else g.sharpen = 0;
    const fit = fitGradeToImage(trial, base, g);
    const sc = scoreEdit(base, trial, null);
    const total = sc.score + (fit.edgeAfter >= fit.edgeBefore * 0.985 ? 0 : -8);
    if (total > bestScore) {
      bestScore = total;
      best = sc;
      bestCanvas = trial;
      bestFit = fit;
      bestG = { preset: gid, intensity: inten };
    }
  }
  cv.width = bestCanvas.width;
  cv.height = bestCanvas.height;
  cv.getContext("2d").drawImage(bestCanvas, 0, 0);
  const blob = await canvasToJpeg(cv, 0.99);
  return { blob, by: "Qwen-Image + codec · CPU-native HD", fit: bestFit, quality: best, grade: bestG };
}
const BRIDGE_FOR = { wan: "./wan-bridge.js", ltx: "./ltx-bridge.js", hunyuan: "./hunyuan-bridge.js", qwen: "./qwen-bridge.js" };
export async function codecVideoClip({ imageBlob, prompt = "", family = "wan", duration = 4, fps = 12, height = 1080 } = {}) {
  if (!imageBlob) throw new Error("Import a starter image first — the CPU-native codec run animates your still.");
  const W = 1280, H = 720;
  const base = await blobToCanvas(imageBlob, W, H, true);
  const zoomed = document.createElement("canvas");
  zoomed.width = W; zoomed.height = H;
  const zx = zoomed.getContext("2d");
  zx.imageSmoothingEnabled = true;
  zx.imageSmoothingQuality = "high";
  zx.drawImage(base, -Math.round(W * 0.02), -Math.round(H * 0.02), Math.round(W * 1.04), Math.round(H * 1.04));
  const g = applyPreset(defaultGrade(), promptGradeId(prompt));
  g.intensity = 0.28;
  g.sharpen = 0.15;
  gradeCanvasInPlace(zoomed, g);
  const half = Math.max(0.5, Number(duration) / 2 || 2);
  const doc = encodeSoma([
    { name: "k1", hold: half, canvas: base, analysis: analyzeImage(base, "standard", 1280, 720) },
    { name: "k2", hold: half, canvas: zoomed, analysis: analyzeImage(zoomed, "standard", 1280, 720) },
  ], { flowVelocity: 1, transition: 0.8 });
  const mod = await import(BRIDGE_FOR[family] || BRIDGE_FOR.wan);
  const fn = mod.somaToWanJob || mod.somaToLtxJob || mod.somaToHunyuanJob || mod.somaToQwenJob;
  const job = fn(JSON.parse(JSON.stringify(doc)), prompt);
  const play = await import("./codec-play.js");
  const { keys, params } = await play.decodeKeys(new Blob([JSON.stringify(doc)], { type: "application/json" }));
  const v = await play.renderKeysToVideo(keys, params, { container: "mp4", height, fps: Math.max(4, Math.min(24, fps || 12)) });
  return {
    blob: v.blob,
    meta: {
      codec: family,
      numFrames: job.numFrames ?? job.totalSec,
      guidance: job.guidance ?? null,
      encoder: v.encoder,
      fps: v.fps,
      frames: v.frames,
      docKB: Math.round(JSON.stringify(doc).length / 1024),
    },
  };
}
if (typeof window !== "undefined") window.CodecGenerate = { promptGradeId, blobToCanvas, codecImageEdit, codecVideoClip };
