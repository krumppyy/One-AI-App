export const UPSCALE_FACTORS = [
  { id: "1", label: "1x", factor: 1 },
  { id: "2", label: "2x", factor: 2 },
  { id: "3", label: "3x", factor: 3 },
  { id: "4", label: "4x", factor: 4 },
  { id: "480p", label: "480p", height: 480 },
  { id: "720p", label: "720p", height: 720 },
  { id: "1080p", label: "1080p", height: 1080 },
];

export const UPSCALE_MODES = [
  { id: "fast", label: "Fast" },
  { id: "quality", label: "Quality" },
  { id: "ai", label: "AI" },
];

export function upscaleFactorOf(id) {
  const f = UPSCALE_FACTORS.find((x) => x.id === String(id));
  return f ? f.factor : 1;
}

const MAX_OUT_PX = 24_000_000;

function drawCover(ctx, src, w, h) {
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, 0, 0, w, h);
}

async function decode(blob) {
  const bmp = await createImageBitmap(blob).catch(() => null);
  if (bmp) return { src: bmp, w: bmp.width, h: bmp.height, close: () => bmp.close?.() };
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise((res, rej) => {
      const el = new Image();
      el.onload = () => res(el);
      el.onerror = rej;
      el.src = url;
    });
    return { src: img, w: img.naturalWidth || 1, h: img.naturalHeight || 1, close: () => {} };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function stepCanvas(src, sw, sh, dw, dh) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, dw);
  c.height = Math.max(1, dh);
  drawCover(c.getContext("2d"), src, c.width, c.height);
  return c;
}

function stepUpscale(src, w, h, factor) {
  let cur = src;
  let cw = w;
  let ch = h;
  let targetW = Math.round(w * factor);
  let targetH = Math.round(h * factor);
  while (cw * 2 <= targetW && ch * 2 <= targetH) {
    cur = stepCanvas(cur, cw, ch, cw * 2, ch * 2);
    cw *= 2;
    ch *= 2;
  }
  if (cw !== targetW || ch !== targetH) cur = stepCanvas(cur, cw, ch, targetW, targetH);
  return { canvas: cur, w: targetW, h: targetH };
}

async function unsharp(canvas, amount = 0.55, radius = 1, signal = null) {
  const w = canvas.width;
  const h = canvas.height;
  if (w * h > 12_000_000) amount *= 0.6;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  let img;
  try {
    img = ctx.getImageData(0, 0, w, h);
  } catch {
    return;
  }
  const d = img.data;
  const src = new Uint8ClampedArray(d);
  const lum = (o) => src[o] * 0.299 + src[o + 1] * 0.587 + src[o + 2] * 0.114;
  const r = Math.max(1, Math.round(radius));
  for (let y = 0; y < h; y++) {
    if ((y & 63) === 0) {
      if (signal?.aborted) throw new DOMException("Stopped.", "AbortError");
      await new Promise((rr) => setTimeout(rr, 0));
    }
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      let sum = 0;
      let n = 0;
      for (let ky = -r; ky <= r; ky += r) {
        for (let kx = -r; kx <= r; kx += r) {
          if (!kx && !ky) continue;
          const nx = Math.min(w - 1, Math.max(0, x + kx));
          const ny = Math.min(h - 1, Math.max(0, y + ky));
          sum += lum((ny * w + nx) * 4);
          n++;
        }
      }
      const blur = sum / n;
      const orig = lum(o);
      const diff = orig - blur;
      if (Math.abs(diff) < 1.5) continue;
      const boost = 1 + amount * Math.min(1, Math.abs(diff) / 24) * Math.sign(diff || 1);
      for (let k = 0; k < 3; k++) {
        const v = d[o + k] * (1 + amount * 0.35 * Math.sign(diff || 1) * Math.min(1, Math.abs(diff) / 32)) + diff * amount * 0.5;
        d[o + k] = Math.max(0, Math.min(255, v));
      }
      void boost;
    }
  }
  ctx.putImageData(img, 0, 0);
}

let _aiPipe = null;
let _aiFailed = false;
let _aiWorker = null;
let _aiJob = 0;
const _aiPending = new Map();

let _aiWorkerSrc = null;

async function aiWorkerAsync() {
  if (_aiWorker) return _aiWorker;
  if (!_aiWorkerSrc) {
    const urls = [];
    try { urls.push(new URL("./upscale-worker.js", import.meta.url).href); } catch {}
    try { urls.push(new URL("src/upscale-worker.js", document.baseURI).href); } catch {}
    let text = null;
    for (const u of urls) {
      try {
        const r = await fetch(u);
        if (r.ok) { text = await r.text(); if (text.includes("ensurePipe")) break; else text = null; }
      } catch {}
    }
    if (!text) throw new Error("ai worker source unreachable");
    _aiWorkerSrc = text;
  }
  const w = new Worker(URL.createObjectURL(new Blob([_aiWorkerSrc], { type: "text/javascript" })), { type: "module" });
  w.onmessage = (e) => {
    const { job, type } = e.data || {};
    const pend = _aiPending.get(job);
    if (!pend) return;
    pend.beat = Date.now();
    if (type === "done") {
      _aiPending.delete(job);
      pend.resolve(e.data.blob);
    } else if (type === "error") {
      _aiPending.delete(job);
      pend.reject(new Error(e.data.message || "ai worker failed"));
    } else if (type === "progress") {
      pend.progress?.(e.data.p || 0);
    }
  };
  w.onerror = () => {
    for (const [, pend] of _aiPending) {
      try { pend.reject(new Error("ai worker crashed")); } catch {}
    }
    _aiPending.clear();
    _aiWorker = null;
  };
  _aiWorker = w;
  return w;
}

function aiViaWorker(dataUrl, onProgress, signal) {
  return new Promise((resolve, reject) => {
    let job = 0;
    let settled = false;
    const watch = setInterval(() => {
      const pend = job ? _aiPending.get(job) : null;
      if (job && pend && Date.now() - (pend.beat || Date.now()) > 240000) {
        clearInterval(watch);
        finish(reject, new Error("ai upscale stalled — falling back"));
      }
    }, 15000);
    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      clearInterval(watch);
      if (job) _aiPending.delete(job);
      signal?.removeEventListener?.("abort", onAbort);
      fn(arg);
    };
    const onAbort = () => finish(reject, new DOMException("Stopped.", "AbortError"));
    if (signal?.aborted) { finish(reject, new DOMException("Stopped.", "AbortError")); return; }
    (async () => {
      try {
        const w = await aiWorkerAsync();
        job = ++_aiJob;
        _aiPending.set(job, { resolve: (b) => finish(resolve, b), reject: (e) => finish(reject, e), progress: onProgress, beat: Date.now() });
        signal?.addEventListener?.("abort", onAbort, { once: true });
        w.postMessage({ id: job, dataUrl });
      } catch (e) {
        finish(reject, e);
      }
    })();
  });
}

async function aiUpscaleCanvas(canvas, onProgress = null, signal = null) {
  if (_aiFailed) throw new Error("ai unavailable");
  let blob = null;
  try {
    const dataUrl = canvas.toDataURL("image/png");
    blob = await aiViaWorker(dataUrl, (p) => onProgress?.(p), signal);
  } catch (e) {
    if (e && e.name === "AbortError") throw e;
    try {
      const mod = await import("https://esm.sh/@huggingface/transformers@3.5.1");
      const ids = ["Xenova/swin2SR-classical-sr-x2-64", "Xenova/swin2SR-lightweight-x2-64"];
      let lastErr = null;
      for (const id of ids) {
        try {
          onProgress?.(0.2);
          _aiPipe = await mod.pipeline("image-to-image", id, {
            progress_callback: (ev) => {
              if (ev && ev.status === "progress" && Number.isFinite(ev.progress)) onProgress?.(0.2 + 0.6 * Math.min(1, ev.progress / 100));
            },
          });
          _aiPipe._upId = id;
          break;
        } catch (err2) {
          lastErr = err2;
        }
      }
      if (!_aiPipe) throw lastErr || e;
      onProgress?.(0.85);
      const out = await _aiPipe(canvas.toDataURL("image/png"));
      onProgress?.(0.95);
      const url = out?.[0]?.url || out?.url;
      if (!url) throw new Error("ai returned nothing");
      blob = await (await fetch(url)).blob();
    } catch (e2) {
      if (e2 && e2.name === "AbortError") throw e2;
      _aiFailed = true;
      throw e2;
    }
  }
  if (!blob || !blob.size) throw new Error("ai returned an empty file");
  const dec = await decode(blob);
  const c = document.createElement("canvas");
  c.width = dec.w;
  c.height = dec.h;
  c.getContext("2d").drawImage(dec.src, 0, 0);
  dec.close();
  return c;
}

async function aiCascade(src, sw, sh, tw, th, onProgress, signal) {
  const f = tw / Math.max(1, sw);
  let passes = 0;
  if (f >= 3.5) passes = 2;
  else if (f >= 1.9) passes = 1;
  else passes = 1;
  let cur = document.createElement("canvas");
  cur.width = sw;
  cur.height = sh;
  drawCover(cur.getContext("2d"), src, sw, sh);
  let aiOk = false;
  for (let p = 0; p < passes; p++) {
    if (signal?.aborted) throw new DOMException("Stopped.", "AbortError");
    if (cur.width * 2 * (cur.height * 2) > MAX_OUT_PX * 2) break;
    try {
      const next = await aiUpscaleCanvas(cur, (q) => onProgress?.(0.15 + 0.4 * ((p + q) / passes)), signal);
      cur = next;
      aiOk = true;
    } catch (e) {
      if (e && e.name === "AbortError") throw e;
      break;
    }
  }
  if (signal?.aborted) throw new DOMException("Stopped.", "AbortError");
  if (cur.width !== tw || cur.height !== th) {
    const effF = tw / cur.width;
    if (Math.abs(effF - 1) < 0.001) return cur;
    if (effF > 1) {
      const up = stepUpscale(cur, cur.width, cur.height, effF);
      cur = up.canvas;
    } else {
      const fix = document.createElement("canvas");
      fix.width = tw;
      fix.height = th;
      drawCover(fix.getContext("2d"), cur, tw, th);
      cur = fix;
    }
  }
  try {
    await unsharp(cur, aiOk ? 0.35 : 0.55, 1, signal);
  } catch (e) {
    if (e && e.name === "AbortError") throw e;
  }
  if (!aiOk) {
    const up = stepUpscale(cur, cur.width, cur.height, 1);
    void up;
  }
  cur._aiOk = aiOk;
  return cur;
}

export async function upscaleImage(blob, { factor = 1, mode = "fast", signal = null, onProgress = null } = {}) {
  let f = factor;
  if (typeof f === "string" && /^\d+\s*p$/i.test(f)) {
    const dec0 = await decode(blob);
    const targetH = Math.max(2, parseInt(f, 10));
    f = targetH / Math.max(1, dec0.h);
    dec0.close();
  }
  f = Math.max(0.1, Math.min(4, Number(f) || 1));
  if (signal?.aborted) throw new DOMException("Stopped.", "AbortError");
  const dec = await decode(blob);
  try {
    let tw = Math.round(dec.w * f);
    let th = Math.round(dec.h * f);
    const isDown = f < 1;
    const px = tw * th;
    if (!isDown && px > MAX_OUT_PX) {
      const k = Math.sqrt(MAX_OUT_PX / px);
      tw = Math.max(dec.w, Math.floor(tw * k));
      th = Math.max(dec.h, Math.floor(th * k));
    }
    tw = Math.max(2, tw - (tw % 2 === 0 ? 0 : 1));
    th = Math.max(2, th - (th % 2 === 0 ? 0 : 1));
    const effF = tw / dec.w;
    onProgress?.(0.15);
    let canvas;
    if (isDown || Math.abs(effF - 1) < 0.001) {
      canvas = document.createElement("canvas");
      canvas.width = tw;
      canvas.height = th;
      drawCover(canvas.getContext("2d"), dec.src, tw, th);
    } else if (mode === "ai" && !isDown && effF > 1.01) {
      canvas = await aiCascade(dec.src, dec.w, dec.h, tw, th, onProgress, signal);
    } else {
      let up = stepUpscale(dec.src, dec.w, dec.h, effF);
      canvas = up.canvas;
    }
    if (signal?.aborted) throw new DOMException("Stopped.", "AbortError");
    onProgress?.(0.55);
    const aiDone = mode === "ai" && !isDown && effF > 1.01;
    let method = isDown ? "bicubic-resize" : aiDone ? (canvas._aiOk === false ? "bicubic-sharpened (ai fallback)" : "swin2sr-ai") : "bicubic-step";
    if (!aiDone && !isDown && effF > 1 && mode === "quality") {
      try {
        await unsharp(canvas, 0.55, 1, signal);
        method = "bicubic-sharpened";
      } catch (stopErr) {
        if (stopErr && stopErr.name === "AbortError") throw stopErr;
        method = "bicubic-sharpened";
      }
    }
    onProgress?.(1);
    return { canvas, w: tw, h: th, method, capped: tw * th < Math.round(dec.w * f) * Math.round(dec.h * f) };
  } finally {
    dec.close();
  }
}

export function canvasToBlob(canvas, mime, quality) {
  return new Promise((res, rej) => {
    try {
      if (mime === "image/png") canvas.toBlob((b) => (b ? res(b) : rej(new Error("encode refused"))), mime);
      else canvas.toBlob((b) => (b ? res(b) : rej(new Error("encode refused"))), mime, quality);
    } catch (e) {
      rej(e);
    }
  });
}
