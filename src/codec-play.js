import { decodeAnkanSoma, dataUrlToBlob } from "./ankan-soma.js";

export const CODEC_EXT = /\.(soma|ankan)$/i;

export async function sniffCodec(file) {
  const nm = String(file?.name || "");
  if (CODEC_EXT.test(nm)) return nm.toLowerCase().endsWith(".ankan") ? "ankan" : "soma";
  try {
    const head = await (file.slice ? file.slice(0, 64).text() : "");
    const m = head.match(/"magic"\s*:\s*"(ANKAN|SOMA)"/);
    if (m) return m[1] === "ANKAN" ? "ankan" : "soma";
  } catch {}
  return null;
}

const loadImage = (src) => new Promise((res, rej) => {
  const img = new Image();
  img.onload = () => res(img);
  img.onerror = rej;
  img.src = src;
});

export async function decodeKeys(blob, maxSide = 1920) {
  const text = await blob.text();
  const doc = decodeAnkanSoma(JSON.parse(text));
  const keys = [];
  for (const k of doc.keys) {
    const raw = await dataUrlToBlob(k.image);
    const img = await loadImage(URL.createObjectURL(raw));
    const iw = img.naturalWidth || 1280;
    const ih = img.naturalHeight || 720;
    const s = Math.min(1, maxSide / Math.max(iw, ih));
    const cv = document.createElement("canvas");
    cv.width = Math.max(2, Math.round(iw * s));
    cv.height = Math.max(2, Math.round(ih * s));
    const cx = cv.getContext("2d");
    cx.imageSmoothingEnabled = true;
    cx.imageSmoothingQuality = "high";
    cx.drawImage(img, 0, 0, cv.width, cv.height);
    URL.revokeObjectURL(img.src);
    keys.push({ name: k.name, hold: k.hold, canvas: cv, analysis: k.analysis });
  }
  return { magic: doc.magic, params: doc.params || {}, keys };
}

export function timelineTotalOf(keys, transition = 0.8) {
  if (!keys.length) return 6;
  void transition;
  return keys.reduce((n, k) => n + Math.max(0.5, Number(k.hold) || 3), 0);
}

export function slotAt(keys, t, loop, transition = 0.8) {
  if (!keys.length) return { a: null, b: null, mix: 0 };
  if (keys.length === 1) return { a: keys[0], b: null, mix: 0 };
  const total = timelineTotalOf(keys);
  const tt = loop ? t % total : Math.min(t, total - 0.001);
  let acc = 0;
  for (let i = 0; i < keys.length; i++) {
    const hold = Math.max(0.5, Number(keys[i].hold) || 3);
    if (tt < acc + hold || i === keys.length - 1) {
      const local = tt - acc;
      const tr = Math.min(transition, hold * 0.5);
      if (local > hold - tr && i < keys.length - 1) {
        return { a: keys[i], b: keys[i + 1], mix: (local - (hold - tr)) / tr };
      }
      return { a: keys[i], b: null, mix: 0 };
    }
    acc += hold;
  }
  return { a: keys[keys.length - 1], b: null, mix: 0 };
}

const DEF_P = { flowVelocity: 1, exposurePulse: 30, cameraParallax: 25, morphTurbulence: 35, colorWarp: 15, transition: 0.8 };

function drawScene(ctx, W, H, t, total, img, analysis, P, camX, zoom, expShift, gate) {
  const k = W / 1280;
  const pts = (analysis && analysis.particles) || [];
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.globalAlpha = Math.max(0, Math.min(1, gate));
  ctx.translate(W / 2 + camX * k, H / 2);
  ctx.scale(zoom, zoom);
  ctx.translate(-W / 2, -H / 2);
  const brightness = Math.max(0.4, 1.0 + expShift);
  const satBoost = 1 + ((P.colorWarp || 0) / 100) * 0.18;
  ctx.filter = `brightness(${brightness}) saturate(${satBoost})`;
  ctx.drawImage(img, 0, 0, W, H);
  ctx.filter = "none";
  ctx.restore();
}

export function renderCodecFrame(ctx, W, H, t, keys, params = {}, loop = true) {
  const P = { ...DEF_P, ...(params || {}) };
  ctx.clearRect(0, 0, W, H);
  if (!keys.length) { ctx.fillStyle = "#0c101d"; ctx.fillRect(0, 0, W, H); return; }
  const total = timelineTotalOf(keys);
  const progress = total ? t / total : 0;
  const expOsc = Math.sin(progress * Math.PI * 4) * ((P.exposurePulse || 0) / 100) * 0.3;
  const camX = Math.sin(progress * Math.PI * 2) * ((P.cameraParallax || 0) * 0.8);
  const zoom = 1.0 + (Math.sin(progress * Math.PI * 2) * ((P.cameraParallax || 0) / 100) * 0.08);
  const slot = slotAt(keys, t, loop, P.transition);
  drawScene(ctx, W, H, t, total, slot.a.canvas, slot.a.analysis, P, camX, zoom, expOsc, 1);
  if (slot.b) drawScene(ctx, W, H, t, total, slot.b.canvas, slot.b.analysis, P, camX, zoom, expOsc, slot.mix);
}

export function attachLiverun(canvas, keys, params = {}, { loop = true } = {}) {
  const ctx = canvas.getContext("2d");
  let live = true;
  let t = 0;
  let last = 0;
  const step = (ts) => {
    if (!live) return;
    if (!last) last = ts;
    t += Math.min(0.1, (ts - last) / 1000);
    last = ts;
    renderCodecFrame(ctx, canvas.width, canvas.height, t, keys, params, loop);
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  return () => { live = false; };
}

const transcodeCache = new Map();

export async function renderKeysToVideo(keys, params = {}, { container = "mp4", height = 720, fps = 30, onProgress = null } = {}) {
  const { encodeCanvasClip } = await import("./encode.js");
  const W = height >= 2000 ? 3840 : height >= 1000 ? 1920 : 1280;
  const H = height >= 2000 ? 2160 : height >= 1000 ? 1080 : 720;
  const total = timelineTotalOf(keys);
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d");
  const wantWebm = container === "webm" || container === "mkv";
  const enc = await encodeCanvasClip({
    canvas: cv, fps, duration: total,
    mimeType: wantWebm ? "video/webm" : "video/mp4",
    draw: (t) => renderCodecFrame(ctx, W, H, t, keys, params, false),
    onProgress,
  });
  let out = enc.blob;
  let ext = out.type.includes("mp4") ? "mp4" : "webm";
  if (container === "mkv") { out = new Blob([out], { type: "video/x-matroska" }); ext = "mkv"; }
  else if (container === "mov") { out = new Blob([out], { type: "video/mp4" }); ext = "mov"; }
  return { blob: out, ext, encoder: enc.encoder, duration: enc.duration, fps: enc.fps, frames: enc.frames };
}

export async function somaToVideoBlob(blob, opts = {}) {
  const { keys, params } = await decodeKeys(blob);
  return renderKeysToVideo(keys, params, opts);
}

export function stillCanvasFor(keys, params = {}, t = 0.5, W = 1280) {
  const H = Math.round((W * 9) / 16);
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  renderCodecFrame(cv.getContext("2d"), W, H, t, keys, params, false);
  return cv;
}

export async function normalizeMediaInput(file, want = "auto") {
  if (!file) return { files: [], converted: false };
  const kind = await sniffCodec(file);
  if (!kind) return { files: [file], converted: false, kind: String(file.type || "").startsWith("video/") ? "video" : "image" };
  const base = String(file.name || "codec").replace(/\.(soma|ankan)$/i, "");
  if (kind === "ankan") {
    const { keys } = await decodeKeys(file);
    const cv = stillCanvasFor(keys, {}, 0.5);
    const blob = await new Promise((r) => cv.toBlob(r, "image/png"));
    const out = new File([blob], base + ".png", { type: "image/png" });
    if (want === "video") {
      const v = await somaToVideoBlob(file, { container: "mp4" });
      return { files: [new File([v.blob], base + ".mp4", { type: "video/mp4" })], converted: true, kind: "video", label: "ankan→mp4" };
    }
    return { files: [out], converted: true, kind: "image", label: "ankan→png" };
  }
  if (want === "image") {
    const { keys } = await decodeKeys(file);
    const outs = [];
    for (let i = 0; i < keys.length; i++) {
      const cv = stillCanvasFor([keys[i]], {}, 0.5);
      const blob = await new Promise((r) => cv.toBlob(r, "image/jpeg", 0.92));
      outs.push(new File([blob], `${base}-key${i + 1}.jpg`, { type: "image/jpeg" }));
    }
    return { files: outs, converted: true, kind: "image", label: `soma→${outs.length} stills` };
  }
  const key = `${file.name}-${file.size}`;
  if (!transcodeCache.has(key)) {
    if (transcodeCache.size > 7) transcodeCache.delete(transcodeCache.keys().next().value);
    transcodeCache.set(key, somaToVideoBlob(file, { container: "mp4" }));
  }
  const v = await transcodeCache.get(key);
  return { files: [new File([v.blob], base + ".mp4", { type: v.blob.type || "video/mp4" })], converted: true, kind: "video", label: "soma→mp4" };
}

export function emitOpenCodec(blob, name) {
  window.dispatchEvent(new CustomEvent("open-codec-file", { detail: { blob, name: name || "codec-file" } }));
}

if (typeof window !== "undefined") window.CodecPlay = { sniffCodec, decodeKeys, renderCodecFrame, attachLiverun, somaToVideoBlob, stillCanvasFor, normalizeMediaInput, emitOpenCodec };
