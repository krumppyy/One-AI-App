export const GRADE_PRESETS = [
  { id: "none", label: "None", sat: 1, bright: 1, exposure: 0, contrast: 1, gamma: 1, tint: "#ff9a3c", tintAlpha: 0 },
  { id: "warm", label: "Warm", sat: 1.12, bright: 1.03, exposure: 0.1, contrast: 1.05, gamma: 1, tint: "#ff9a3c", tintAlpha: 0.18 },
  { id: "cool", label: "Cool", sat: 1.05, bright: 1, exposure: 0, contrast: 1.06, gamma: 1, tint: "#3ca9ff", tintAlpha: 0.16 },
  { id: "cinematic", label: "Cinematic", sat: 1.15, bright: 0.98, exposure: 0.05, contrast: 1.18, gamma: 0.95, tint: "#2a4d8f", tintAlpha: 0.22 },
  { id: "noir", label: "Noir", sat: 0, bright: 1.02, exposure: 0, contrast: 1.25, gamma: 0.9, tint: "#000000", tintAlpha: 0 },
  { id: "vintage", label: "Vintage", sat: 0.85, bright: 1.04, exposure: 0, contrast: 0.92, gamma: 1.1, tint: "#c98a3c", tintAlpha: 0.25 },
  { id: "vibrant", label: "Vibrant", sat: 1.45, bright: 1.02, exposure: 0, contrast: 1.12, gamma: 1, tint: "#ff9a3c", tintAlpha: 0 },
  { id: "sunset", label: "Sunset", sat: 1.25, bright: 1, exposure: 0.15, contrast: 1.08, gamma: 1.05, tint: "#ff5a3c", tintAlpha: 0.22 },
  { id: "teal", label: "Teal", sat: 1.1, bright: 1, exposure: 0, contrast: 1.1, gamma: 1, tint: "#19d3c5", tintAlpha: 0.18 },
  { id: "grain", label: "Grain", sat: 1.02, bright: 1, exposure: 0, contrast: 1.04, gamma: 1, tint: "#ff9a3c", tintAlpha: 0, grain: 0.55 },
  { id: "realnoise", label: "Realistic Noise", sat: 0.96, bright: 1.01, exposure: 0, contrast: 1.1, gamma: 0.98, tint: "#ff9a3c", tintAlpha: 0, grain: 0.85 },
  { id: "lightleak", label: "Light Leak", sat: 1.18, bright: 1.06, exposure: 0.12, contrast: 1.02, gamma: 1.02, tint: "#ff5a2a", tintAlpha: 0.34, leak: 0.7 },
  { id: "add", label: "ADD Glow", sat: 1.08, bright: 1.12, exposure: 0.22, contrast: 0.96, gamma: 1.08, tint: "#ffd9a0", tintAlpha: 0.2 },
];

export function defaultGrade() {
  return { preset: "none", intensity: 1, sat: 1, bright: 1, exposure: 0, contrast: 1, gamma: 1, grain: 0, sharpen: 0, leak: 0, tint: "#ff9a3c", tintAlpha: 0 };
}

export function presetOf(id) {
  return GRADE_PRESETS.find((p) => p.id === id) || GRADE_PRESETS[0];
}

export function applyPreset(g, id) {
  const p = presetOf(id);
  g.preset = p.id;
  g.sat = p.sat;
  g.bright = p.bright;
  g.exposure = p.exposure;
  g.contrast = p.contrast;
  g.gamma = p.gamma;
  g.grain = p.grain || 0;
  g.leak = p.leak || 0;
  g.tint = p.tint;
  g.tintAlpha = p.tintAlpha;
  return g;
}

function eff(g) {
  const k = Math.min(1, Math.max(0, Number(g.intensity) || 0));
  const lerp = (v, n) => n + (Number(v) - n) * k;
  return {
    sat: lerp(g.sat, 1),
    bright: lerp(g.bright, 1),
    exposure: Number(g.exposure || 0) * k,
    contrast: lerp(g.contrast, 1),
    gamma: lerp(g.gamma, 1),
    grain: Number(g.grain || 0) * k,
    sharpen: Number(g.sharpen || 0) * k,
    leak: Number(g.leak || 0) * k,
    tint: g.tint || "#ff9a3c",
    tintAlpha: Number(g.tintAlpha || 0) * k,
  };
}

export function gradeActive(g) {
  if (!g) return false;
  const e = eff(g);
  return (
    Math.abs(e.sat - 1) > 0.001 ||
    Math.abs(e.bright - 1) > 0.001 ||
    Math.abs(e.exposure) > 0.001 ||
    Math.abs(e.contrast - 1) > 0.001 ||
    Math.abs(e.gamma - 1) > 0.001 ||
    e.grain > 0.001 ||
    e.sharpen > 0.001 ||
    e.leak > 0.001 ||
    e.tintAlpha > 0.001
  );
}

export function gammaFor(g) {
  return eff(g).gamma;
}

export function grainFor(g) {
  return eff(g).grain;
}

export function leakFor(g) {
  return eff(g).leak;
}

export function sharpenFor(g) {
  return eff(g).sharpen;
}

let _gammaSeq = 0;
const _gammaUrls = new Map();
function gammaSvgUrl(gamma) {
  const g = Math.min(3, Math.max(0.2, Number(gamma) || 1));
  if (Math.abs(g - 1) < 0.005) return "";
  const key = g.toFixed(3);
  if (_gammaUrls.has(key)) return _gammaUrls.get(key);
  const exp = (1 / g).toFixed(4);
  const svg = `<svg xmlns='http://www.w3.org/2000/svg'><filter id='gm'><feComponentTransfer><feFuncR type='gamma' amplitude='1' exponent='${exp}' offset='0'/><feFuncG type='gamma' amplitude='1' exponent='${exp}' offset='0'/><feFuncB type='gamma' amplitude='1' exponent='${exp}' offset='0'/></feComponentTransfer></filter></svg>#gm`;
  const url = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
  if (_gammaUrls.size > 24) _gammaUrls.clear();
  _gammaUrls.set(key, url);
  _gammaSeq += 1;
  return url;
}

export function cssFilterFor(g) {
  const e = eff(g);
  const b = Math.min(3, Math.max(0.1, e.bright * Math.pow(2, e.exposure)));
  const sh = e.sharpen > 0.01 ? Math.min(0.12, e.sharpen * 0.12) : 0;
  const c = Math.min(3, e.contrast + sh);
  let f = `brightness(${b.toFixed(3)}) contrast(${c.toFixed(3)}) saturate(${e.sat.toFixed(3)})`;
  const gm = gammaSvgUrl(e.gamma);
  if (gm) f += ` ${gm}`;
  return f;
}

export function tintCssFor(g) {
  const e = eff(g);
  if (e.tintAlpha <= 0.001) return "";
  return e.tint;
}

export function tintAlphaFor(g) {
  return eff(g).tintAlpha;
}

let _noise = null;
function noiseCanvas() {
  if (_noise) return _noise;
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext("2d");
  const img = ctx.createImageData(128, 128);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = (Math.random() * 255) | 0;
    img.data[i] = v;
    img.data[i + 1] = v;
    img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  _noise = c;
  return c;
}

function gammaLUT(gamma) {
  const lut = new Uint8Array(256);
  const g = Math.min(3, Math.max(0.2, Number(gamma) || 1));
  for (let i = 0; i < 256; i++) lut[i] = Math.max(0, Math.min(255, Math.round(255 * Math.pow(i / 255, 1 / g))));
  return lut;
}

function passGamma(ctx, w, h, gamma) {
  if (Math.abs(gamma - 1) < 0.005) return;
  const lut = gammaLUT(gamma);
  let img;
  try {
    img = ctx.getImageData(0, 0, w, h);
  } catch {
    return;
  }
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = lut[d[i]];
    d[i + 1] = lut[d[i + 1]];
    d[i + 2] = lut[d[i + 2]];
  }
  ctx.putImageData(img, 0, 0);
}

function passSharpen(ctx, w, h, amount) {
  if (amount <= 0.01) return;
  if (w * h > 9000000) amount *= 0.5;
  let img;
  try {
    img = ctx.getImageData(0, 0, w, h);
  } catch {
    return;
  }
  const d = img.data;
  const src = new Uint8ClampedArray(d);
  const at = (x, y, k) => src[(((y < 0 ? 0 : y >= h ? h - 1 : y) * w) + (x < 0 ? 0 : x >= w ? w - 1 : x)) * 4 + k];
  const k = Math.min(1, amount) * 0.6;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        const blur = (at(x - 1, y, c) + at(x + 1, y, c) + at(x, y - 1, c) + at(x, y + 1, c)) * 0.25;
        d[o + c] = Math.max(0, Math.min(255, d[o + c] + (d[o + c] - blur) * k));
      }
    }
  }
  ctx.putImageData(img, 0, 0);
}

function passTintGrain(ctx, w, h, tint, tintAlpha, grain, leak) {
  if (tintAlpha > 0.001 && tint) {
    ctx.save();
    ctx.globalAlpha = Math.min(0.85, tintAlpha);
    ctx.fillStyle = tint;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }
  if (leak > 0.001) {
    ctx.save();
    ctx.globalAlpha = Math.min(0.55, leak * 0.5);
    const gr = ctx.createLinearGradient(0, 0, w, h);
    gr.addColorStop(0, "rgba(255,120,40,0.9)");
    gr.addColorStop(0.35, "rgba(255,80,60,0.25)");
    gr.addColorStop(0.6, "rgba(255,80,60,0)");
    gr.addColorStop(1, "rgba(60,120,255,0.28)");
    ctx.fillStyle = gr;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }
  if (grain > 0.001) {
    ctx.save();
    ctx.globalAlpha = Math.min(0.5, grain * 0.4);
    ctx.globalCompositeOperation = "overlay";
    const n = noiseCanvas();
    const pat = ctx.createPattern(n, "repeat");
    if (pat) {
      ctx.fillStyle = pat;
      ctx.fillRect(0, 0, w, h);
    }
    ctx.restore();
  }
}

export function gradeCanvasInPlace(canvas, g) {
  if (!gradeActive(g)) return false;
  const e = eff(g);
  const w = canvas.width;
  const h = canvas.height;
  if (!w || !h) return false;
  const ctx = canvas.getContext("2d");
  const copy = document.createElement("canvas");
  copy.width = w;
  copy.height = h;
  copy.getContext("2d").drawImage(canvas, 0, 0);
  const b = Math.min(3, Math.max(0.1, e.bright * Math.pow(2, e.exposure)));
  ctx.save();
  try {
    ctx.filter = `brightness(${b}) contrast(${e.contrast}) saturate(${e.sat})`;
  } catch {}
  ctx.drawImage(copy, 0, 0, w, h);
  ctx.restore();
  passGamma(ctx, w, h, e.gamma);
  passTintGrain(ctx, w, h, e.tint, e.tintAlpha, e.grain, e.leak);
  passSharpen(ctx, w, h, e.sharpen);
  return true;
}

export function drawGradedVideoFrame(ctx, src, sx, sy, sw, sh, dx, dy, dw, dh, g) {
  if (!gradeActive(g)) {
    ctx.drawImage(src, sx, sy, sw, sh, dx, dy, dw, dh);
    return;
  }
  const e = eff(g);
  const b = Math.min(3, Math.max(0.1, e.bright * Math.pow(2, e.exposure)));
  ctx.save();
  try {
    ctx.filter = `brightness(${b}) contrast(${e.contrast}) saturate(${e.sat})`;
  } catch {}
  ctx.drawImage(src, sx, sy, sw, sh, dx, dy, dw, dh);
  ctx.restore();
  passGamma(ctx, ctx.canvas.width, ctx.canvas.height, e.gamma);
  passTintGrain(ctx, ctx.canvas.width, ctx.canvas.height, e.tint, e.tintAlpha, e.grain, e.leak);
  if (e.sharpen > 0.35) passSharpen(ctx, ctx.canvas.width, ctx.canvas.height, (e.sharpen - 0.35) * 0.5);
}

export function noiseDataUrl() {
  const n = noiseCanvas();
  try {
    return n.toDataURL("image/png");
  } catch {
    return "";
  }
}

export function paintLiveOverlays(host, g) {
  if (!host) return;
  const e = eff(g || {});
  let grain = host.querySelector(":scope > .grade-grain");
  if (!grain) {
    grain = document.createElement("div");
    grain.className = "grade-grain";
    grain.setAttribute("aria-hidden", "true");
    host.appendChild(grain);
  }
  let leak = host.querySelector(":scope > .grade-leak");
  if (!leak) {
    leak = document.createElement("div");
    leak.className = "grade-leak";
    leak.setAttribute("aria-hidden", "true");
    host.appendChild(leak);
  }
  if (!grain.dataset.url) {
    const url = noiseDataUrl();
    if (url) {
      grain.dataset.url = "1";
      grain.style.backgroundImage = `url("${url}")`;
    }
  }
  const on = gradeActive(g);
  grain.hidden = !(on && e.grain > 0.003);
  grain.style.opacity = String(Math.min(0.85, e.grain * 0.55));
  leak.hidden = !(on && e.leak > 0.003);
  leak.style.opacity = String(Math.min(1, 0.25 + e.leak * 0.75));
}
