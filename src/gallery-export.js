/**
 * Gallery view modes + media export, shared by the image and video studios.
 *
 * View modes: small · medium · large · xl · grid. They only change how big
 * the thumbnails render — every image keeps its own ratio except in `grid`,
 * where tiles are cropped to uniform squares. Applied by setting
 * `data-view` on the gallery root; the sizes live in src/styles.css.
 *
 * Export: images transcode to JPEG / PNG / WEBP at a chosen quality, video
 * to MP4 / WEBM (re-muxed live when the container differs), plus a poster
 * frame export for clips. TTF is a font format, not a raster/video codec,
 * so it is deliberately not offered here.
 */

export const GALLERY_VIEWS = [
  { id: "small", label: "S" },
  { id: "medium", label: "M" },
  { id: "large", label: "L" },
  { id: "xl", label: "XL" },
  { id: "grid", label: "Grid" },
];

export const LIBRARY_VIEWS = [
  { id: "tiles", label: "Tiles" },
  { id: "small", label: "S" },
  { id: "medium", label: "M" },
  { id: "large", label: "L" },
  { id: "icon", label: "Icons" },
  { id: "details", label: "Details" },
];

export function applyGalleryView(root, view) {
  if (!root) return;
  const ok = GALLERY_VIEWS.some((v) => v.id === view) || LIBRARY_VIEWS.some((v) => v.id === view);
  const id = ok ? view : "medium";
  root.dataset.view = id;
}

export const IMAGE_FORMATS = [
  { id: "jpeg", label: "JPEG", mime: "image/jpeg", ext: "jpg" },
  { id: "png", label: "PNG", mime: "image/png", ext: "png", lossless: true },
  { id: "webp", label: "WEBP", mime: "image/webp", ext: "webp" },
  { id: "avif", label: "AVIF", mime: "image/avif", ext: "avif" },
  { id: "bmp", label: "BMP", mime: "image/bmp", ext: "bmp", lossless: true, manual: true },
  { id: "gif", label: "GIF", mime: "image/gif", ext: "gif", lossless: true, manual: true },
];

export const VIDEO_FORMATS = [
  { id: "match", label: "Match source" },
  { id: "mp4", label: "MP4 · H.264", mime: "video/mp4", ext: "mp4" },
  { id: "webm", label: "WEBM · VP9/VP8", mime: "video/webm", ext: "webm" },
  { id: "mov", label: "MOV · H.264", mime: "video/mp4", ext: "mov" },
  { id: "mkv", label: "MKV · VP9", mime: "video/x-matroska", ext: "mkv" },
  { id: "gif", label: "GIF · animated", mime: "image/gif", ext: "gif" },
  { id: "apng", label: "APNG · animated", mime: "image/png", ext: "png" },
];

export const VIDEO_UPSCALE_OPTIONS = [
  { id: "1", label: "1x" },
  { id: "2", label: "2x" },
  { id: "3", label: "3x" },
  { id: "4", label: "4x" },
  { id: "480p", label: "480p" },
  { id: "720p", label: "720p" },
  { id: "1080p", label: "1080p" },
];

export const IMAGE_UPSCALE_OPTIONS = [
  { id: "1", label: "1x" },
  { id: "2", label: "2x" },
  { id: "3", label: "3x" },
  { id: "4", label: "4x" },
  { id: "480p", label: "480p" },
  { id: "720p", label: "720p" },
  { id: "1080p", label: "1080p" },
];

/** Resolve a scale id ("1"/"2"/"4"/"480p"/...) to an output size for a WxH source. */
export function resolveScaleTarget(w, h, scaleId) {
  const id = String(scaleId || "1").toLowerCase();
  const m = id.match(/^(\d+)\s*p$/);
  if (m) {
    const targetH = Math.max(2, Number(m[1]));
    const k = targetH / Math.max(1, h);
    let ow = Math.max(2, Math.round(w * k));
    let oh = targetH;
    ow -= ow % 2;
    oh -= oh % 2;
    return { w: ow, h: oh, factor: ow / Math.max(1, w), heightTarget: targetH };
  }
  const f = Math.max(0.1, Math.min(4, Number(id) || 1));
  let ow = Math.max(2, Math.round(w * f));
  let oh = Math.max(2, Math.round(h * f));
  ow -= ow % 2;
  oh -= oh % 2;
  return { w: ow, h: oh, factor: ow / Math.max(1, w), heightTarget: 0 };
}

export function scaleLabel(scaleId) {
  const id = String(scaleId || "1");
  return /p$/i.test(id) ? id.toLowerCase() : `${Number(id) || 1}x`;
}

export function imageFormatOf(id) {
  return IMAGE_FORMATS.find((f) => f.id === id) || IMAGE_FORMATS[0];
}

function decodeToImage(blob) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => res({ img, url });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      rej(new Error("could not decode the image"));
    };
    img.src = url;
  });
}

/**
 * Re-encode an image blob to `format` at `quality` (0.1–1, JPEG/WEBP only —
 * PNG is lossless so the slider does not apply). Returns a new Blob.
 */
export async function exportImage(blob, { format = "jpeg", quality = 0.92, scale = 1, upscaleMode = "fast", grade = null, stickers = null, frame = "none", signal = null, onProgress = null } = {}) {
  const fmt = imageFormatOf(format);
  const q = Math.min(1, Math.max(0.1, Number(quality) || 0.92));
  const scaleId = String(scale ?? "1");
  const isHeight = /^\d+\s*p$/i.test(scaleId);
  const f = isHeight ? NaN : Math.max(0.1, Math.min(4, Number(scaleId) || 1));
  const needScale = isHeight || f !== 1;
  let canvas;
  let w;
  let h;
  let upMethod = scaleLabel(scaleId);
  if (needScale) {
    const { upscaleImage } = await import("./upscale.js");
    const up = await upscaleImage(blob, { factor: isHeight ? scaleId : f, mode: upscaleMode, signal, onProgress });
    canvas = up.canvas;
    w = up.w;
    h = up.h;
    upMethod = up.method;
  } else {
    const { img, url } = await decodeToImage(blob);
    try {
      w = img.naturalWidth || 1;
      h = img.naturalHeight || 1;
      canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (fmt.id === "jpeg") {
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, w, h);
      }
      ctx.drawImage(img, 0, 0, w, h);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  let graded = false;
  if (grade) {
    const { gradeCanvasInPlace } = await import("./grade.js");
    graded = gradeCanvasInPlace(canvas, grade);
  }
  if ((stickers && stickers.length) || (frame && frame !== "none")) {
    const { drawStickersOn, drawFrameOn } = await import("./stickers.js");
    drawStickersOn(canvas.getContext("2d"), canvas.width, canvas.height, stickers);
    drawFrameOn(canvas.getContext("2d"), canvas.width, canvas.height, frame);
  }
  onProgress?.(0.9);
  if (fmt.id === "bmp") {
    const out = encodeBMP(canvas);
    return { blob: out, ext: fmt.ext, mime: fmt.mime, quality: null, w, h, upMethod, graded };
  }
  if (fmt.id === "gif") {
    const out = encodeGIFSingle(canvas);
    return { blob: out, ext: fmt.ext, mime: fmt.mime, quality: null, w, h, upMethod, graded };
  }
  const mime = fmt.mime;
  const supported = await canvasEncodeSupported(mime);
  if (!supported) {
    const out = await new Promise((res, rej) => {
      try {
        canvas.toBlob((b) => (b && b.size ? res(b) : rej(new Error("encode refused"))), "image/png");
      } catch (e) {
        rej(e);
      }
    });
    return { blob: out, ext: "png", mime: "image/png", quality: null, w, h, upMethod, fallback: fmt.id, graded };
  }
  const out = await new Promise((res, rej) => {
    try {
      if (fmt.lossless) canvas.toBlob((b) => (b && b.size ? res(b) : rej(new Error("encode refused"))), mime);
      else canvas.toBlob((b) => (b && b.size ? res(b) : rej(new Error("encode refused"))), mime, q);
    } catch (e) {
      rej(e);
    }
  });
  if (fmt.id === "avif" && out && out.type && out.type !== "image/avif") {
    return { blob: out, ext: "png", mime: "image/png", quality: null, w, h, upMethod, fallback: "avif", graded };
  }
  return { blob: out, ext: fmt.ext, mime: fmt.mime, quality: fmt.lossless ? null : q, w, h, upMethod, graded };
}

function canvasEncodeSupported(mime) {
  if (mime === "image/jpeg" || mime === "image/png" || mime === "image/webp") return Promise.resolve(true);
  return new Promise((res) => {
    try {
      const c = document.createElement("canvas");
      c.width = 2;
      c.height = 2;
      c.toBlob((b) => res(!!(b && b.size)), mime);
    } catch {
      res(false);
    }
  });
}

function encodeBMP(canvas) {
  const w = canvas.width;
  const h = canvas.height;
  const ctx = canvas.getContext("2d");
  const px = ctx.getImageData(0, 0, w, h).data;
  const rowSize = Math.floor((24 * w + 31) / 32) * 4;
  const dataSize = rowSize * h;
  const buf = new ArrayBuffer(54 + dataSize);
  const dv = new DataView(buf);
  dv.setUint16(0, 0x4d42, true);
  dv.setUint32(2, 54 + dataSize, true);
  dv.setUint32(10, 54, true);
  dv.setUint32(14, 40, true);
  dv.setInt32(18, w, true);
  dv.setInt32(22, h, true);
  dv.setUint16(26, 1, true);
  dv.setUint16(28, 24, true);
  const u8 = new Uint8Array(buf);
  for (let y = 0; y < h; y++) {
    const srcY = h - 1 - y;
    let off = 54 + y * rowSize;
    for (let x = 0; x < w; x++) {
      const o = (srcY * w + x) * 4;
      u8[off++] = px[o + 2];
      u8[off++] = px[o + 1];
      u8[off++] = px[o];
    }
  }
  return new Blob([buf], { type: "image/bmp" });
}

function quantize256(px, w, h) {
  const pal = [];
  const seen = new Map();
  const step = Math.max(1, Math.floor((w * h) / 20000));
  for (let i = 0; i < w * h; i += step) {
    const o = i * 4;
    const key = ((px[o] >> 4) << 8) | ((px[o + 1] >> 4) << 4) | (px[o + 2] >> 4);
    if (!seen.has(key)) {
      seen.set(key, pal.length);
      pal.push([px[o], px[o + 1], px[o + 2]]);
      if (pal.length >= 256) break;
    }
  }
  while (pal.length < 2) pal.push([0, 0, 0]);
  const idx = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    let best = 0;
    let bd = Infinity;
    for (let p = 0; p < pal.length; p++) {
      const dr = px[o] - pal[p][0];
      const dg = px[o + 1] - pal[p][1];
      const db = px[o + 2] - pal[p][2];
      const d = dr * dr + dg * dg + db * db;
      if (d < bd) {
        bd = d;
        best = p;
        if (!d) break;
      }
    }
    idx[i] = best;
  }
  return { pal, idx };
}

function lzwEncode(minCode, idx) {
  const clear = 1 << minCode;
  const eoi = clear + 1;
  let codeSize = minCode + 1;
  const out = [];
  let acc = 0;
  let bits = 0;
  const emit = (code) => {
    acc |= code << bits;
    bits += codeSize;
    while (bits >= 8) {
      out.push(acc & 255);
      acc >>= 8;
      bits -= 8;
    }
  };
  let dict = new Map();
  const reset = () => {
    dict = new Map();
    for (let i = 0; i < clear; i++) dict.set(String(i), i);
    codeSize = minCode + 1;
  };
  reset();
  emit(clear);
  let prev = String(idx[0]);
  let next = clear + 2;
  for (let i = 1; i < idx.length; i++) {
    const cur = prev + "," + idx[i];
    if (dict.has(cur)) {
      prev = cur;
    } else {
      emit(dict.get(prev));
      dict.set(cur, next++);
      if (next === (1 << codeSize) + 1 && codeSize < 12) codeSize++;
      if (next > 4096) {
        emit(clear);
        reset();
        next = clear + 2;
      }
      prev = String(idx[i]);
    }
  }
  emit(dict.get(prev));
  emit(eoi);
  if (bits) out.push(acc & 255);
  return out;
}

function gifBytes(w, h, pal, idx, delayCs = 0, animated = false) {
  const bytes = [];
  const pushStr = (s) => {
    for (const c of s) bytes.push(c.charCodeAt(0));
  };
  pushStr("GIF89a");
  const push16 = (v) => {
    bytes.push(v & 255, (v >> 8) & 255);
  };
  push16(w);
  push16(h);
  const gctSize = Math.max(1, Math.ceil(Math.log2(Math.max(2, pal.length))) - 1);
  bytes.push(0x80 | 0x70 | gctSize);
  bytes.push(0);
  bytes.push(0);
  const gct = 1 << (gctSize + 1);
  for (let i = 0; i < gct; i++) {
    const p = pal[i] || [0, 0, 0];
    bytes.push(p[0], p[1], p[2]);
  }
  if (animated) bytes.push(0x21, 0xff, 0x0b, ...[...("NETSCAPE2.0")].map((c) => c.charCodeAt(0)), 3, 1, 0, 0, 0);
  return { bytes, push16, pushStr };
}

function encodeGIFSingle(canvas) {
  const w = canvas.width;
  const h = canvas.height;
  const px = canvas.getContext("2d").getImageData(0, 0, w, h).data;
  const { pal, idx } = quantize256(px, w, h);
  const minCode = Math.max(2, Math.ceil(Math.log2(Math.max(2, pal.length))));
  const g = gifBytes(w, h, pal, idx);
  const { bytes, push16 } = g;
  bytes.push(0x21, 0xf9, 4, 4, 0, 0, 0, 0);
  bytes.push(0x2c, 0, 0, 0, 0);
  push16(w);
  push16(h);
  bytes.push(0);
  bytes.push(minCode);
  const lzw = lzwEncode(minCode, idx);
  for (let i = 0; i < lzw.length; i += 255) {
    const n = Math.min(255, lzw.length - i);
    bytes.push(n);
    for (let j = 0; j < n; j++) bytes.push(lzw[i + j]);
  }
  bytes.push(0, 0x3b);
  return new Blob([new Uint8Array(bytes)], { type: "image/gif" });
}

export function encodeGIFFrames(frames, w, h, fps = 10) {
  const delay = Math.max(2, Math.round(100 / Math.max(1, fps)));
  let header = null;
  const parts = [];
  frames.forEach((fr, fi) => {
    const { pal, idx } = quantize256(fr, w, h);
    const minCode = Math.max(2, Math.ceil(Math.log2(Math.max(2, pal.length))));
    if (fi === 0) {
      const g = gifBytes(w, h, pal, idx, delay, true);
      header = g.bytes;
      parts.push(header);
    }
    const b = [];
    b.push(0x21, 0xf9, 4, 4, delay & 255, (delay >> 8) & 255, 0, 0);
    b.push(0x2c, 0, 0, 0, 0);
    b.push(w & 255, (w >> 8) & 255, h & 255, (h >> 8) & 255);
    if (fi === 0) {
      b.push(0);
    } else {
      const gctSize = Math.max(1, Math.ceil(Math.log2(Math.max(2, pal.length))) - 1);
      b.push(0x80 | gctSize);
      const gct = 1 << (gctSize + 1);
      for (let i = 0; i < gct; i++) {
        const p = pal[i] || [0, 0, 0];
        b.push(p[0], p[1], p[2]);
      }
    }
    b.push(minCode);
    const lzw = lzwEncode(minCode, idx);
    for (let i = 0; i < lzw.length; i += 255) {
      const n = Math.min(255, lzw.length - i);
      b.push(n);
      for (let j = 0; j < n; j++) b.push(lzw[i + j]);
    }
    b.push(0);
    parts.push(b);
  });
  parts.push([0x3b]);
  const total = parts.reduce((a, p) => a + p.length, 0);
  const u8 = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    u8.set(p, off);
    off += p.length;
  }
  return new Blob([u8], { type: "image/gif" });
}

/** Bitrate for a video re-mux, scaled by the quality slider. */
export function videoBitrateFor(w, h, quality = 0.8) {
  const q = Math.min(1, Math.max(0.1, Number(quality) || 0.8));
  const px = Math.max(1, w) * Math.max(1, h);
  return Math.max(500_000, Math.min(20_000_000, Math.round(((px * 24 * 0.09) * (0.35 + q * 0.9)) / 1000) * 1000));
}

function recorderMimeFor(container) {
  try {
    if (typeof MediaRecorder === "undefined" || !MediaRecorder.isTypeSupported) return "";
    const cands =
      container === "mp4"
        ? ["video/mp4;codecs=avc1.42E01f", "video/mp4"]
        : ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
    for (const m of cands) if (MediaRecorder.isTypeSupported(m)) return m;
  } catch {}
  return "";
}

/**
 * Re-container a clip by replaying it through a canvas into a MediaRecorder.
 * Used only when the requested container differs from the source — otherwise
 * the original bytes are kept untouched. Quality scales the bitrate.
 */
export async function exportVideo(blob, { container = "match", quality = 0.8, scale = 1, upscaleMode = "fast", grade = null, stickers = null, frame = "none", signal = null, onProgress = null } = {}) {
  const want0 = String(container || "match").toLowerCase();
  const scaleId = String(scale ?? "1");
  const needScale = !/^(1(\.0+)?)$/.test(scaleId.trim());
  const needStk = (stickers && stickers.length) || (frame && frame !== "none");
  let graded = false;
  if (grade) {
    try {
      const { gradeActive } = await import("./grade.js");
      graded = gradeActive(grade);
    } catch {}
  }
  if ((want0 === "gif" || want0 === "apng") || needScale || graded || needStk) {
    return await transcodeClip(blob, { container: want0, quality, scale: scaleId, upscaleMode, grade: graded ? grade : null, stickers, frame, signal, onProgress });
  }
  const want = want0 === "mp4" ? "mp4" : want0 === "webm" ? "webm" : want0 === "mov" ? "mov" : want0 === "mkv" ? "mkv" : "";
  if (!want) {
    const t = String(blob?.type || "");
    return { blob, ext: t.includes("webm") ? "webm" : "mp4", passthrough: true };
  }
  const srcType = String(blob?.type || "");
  const baseWant = want === "mov" ? "mp4" : want === "mkv" ? "webm" : want;
  const srcIs = srcType.includes("mp4") ? "mp4" : srcType.includes("webm") ? "webm" : "";
  if (baseWant === srcIs) {
    return { blob, ext: want, passthrough: want === "mov" || want === "mkv" ? false : true, remuxedExt: want };
  }
  return await transcodeClip(blob, { container: want, quality, scale: 1, upscaleMode, signal, onProgress });
}

async function transcodeClip(blob, { container, quality, scale, upscaleMode, grade = null, stickers = null, frame = "none", signal, onProgress }) {
  const { loadVideo, releaseVideo, seekVideo } = await import("./video.js");
  const { encodeFrames } = await import("./encode.js");
  const { upscaleImage } = await import("./upscale.js");
  let want = String(container || "mp4").toLowerCase();
  if (want === "match" || !want) want = String(blob?.type || "").includes("webm") ? "webm" : "mp4";
  let gradeOn = false;
  if (grade) {
    try {
      const { gradeActive } = await import("./grade.js");
      gradeOn = gradeActive(grade);
    } catch {}
    if (!gradeOn) grade = null;
  }
  const video = await loadVideo(blob);
  try {
    const vw = video.videoWidth || 640;
    const vh = video.videoHeight || 360;
    const dur = Number(video.duration);
    if (!Number.isFinite(dur) || dur <= 0) throw new Error("could not read that clip's duration");
    const tgt = resolveScaleTarget(vw, vh, scale);
    let ow = tgt.w;
    let oh = tgt.h;
    const f = tgt.factor;
    const isHeightPreset = tgt.heightTarget > 0;
    if (want === "gif" && !isHeightPreset) {
      const cap = f > 1 ? 720 : 480;
      const k = Math.min(1, cap / Math.max(ow, oh));
      ow = Math.max(2, Math.round(ow * k));
      oh = Math.max(2, Math.round(oh * k));
    }
    ow -= ow % 2;
    oh -= oh % 2;
    if (want === "gif" || want === "apng") {
      const fps = want === "gif" ? 10 : 12;
      const total = Math.max(1, Math.min(150, Math.round(dur * fps)));
      const work = document.createElement("canvas");
      work.width = vw;
      work.height = vh;
      const wctx = work.getContext("2d");
      const out = document.createElement("canvas");
      out.width = ow;
      out.height = oh;
      const octx = out.getContext("2d");
      const frames = [];
      const { gradeCanvasInPlace } = grade ? await import("./grade.js") : {};
      const stk = (stickers && stickers.length) || (frame && frame !== "none") ? await import("./stickers.js").catch(() => null) : null;
      for (let i = 0; i < total; i++) {
        if (signal?.aborted) throw new DOMException("Stopped.", "AbortError");
        await seekVideo(video, Math.min((i / total) * dur, Math.max(0, dur - 0.02)));
        wctx.drawImage(video, 0, 0, vw, vh);
        const fr = await upscaleImage(await new Promise((res) => work.toBlob((b) => res(b), "image/png")), { factor: ow / vw, mode: upscaleMode || "fast", signal }).catch(() => null);
        if (fr) octx.drawImage(fr.canvas, 0, 0, ow, oh);
        else {
          octx.imageSmoothingQuality = "high";
          octx.drawImage(video, 0, 0, ow, oh);
        }
        if (grade && gradeCanvasInPlace) gradeCanvasInPlace(out, grade);
        if (stk) {
          stk.drawStickersOn(octx, ow, oh, stickers);
          stk.drawFrameOn(octx, ow, oh, frame);
        }
        frames.push(octx.getImageData(0, 0, ow, oh).data.slice(0));
        onProgress?.(i / total * 0.9);
      }
      if (want === "gif") {
        const out2 = encodeGIFFrames(frames, ow, oh, fps);
        onProgress?.(1);
        return { blob: out2, ext: "gif", passthrough: false, w: ow, h: oh, upscaled: ow !== vw || oh !== vh, graded: gradeOn };
      }
      const apng = await encodeAPNG(frames, ow, oh, fps);
      onProgress?.(1);
      return { blob: apng, ext: "png", mime: "image/png", passthrough: false, w: ow, h: oh, upscaled: ow !== vw || oh !== vh, graded: gradeOn };
    }
    const rate = 24;
    const total = Math.max(1, Math.round(dur * rate));
    const src = document.createElement("canvas");
    src.width = ow;
    src.height = oh;
    const sctx = src.getContext("2d");
    const { drawGradedVideoFrame } = grade ? await import("./grade.js") : {};
    const resized = ow !== vw || oh !== vh;
    const useFrameAI = resized && (upscaleMode === "quality" || upscaleMode === "ai");
    const needStkDraw = (stickers && stickers.length) || (frame && frame !== "none");
    const stkDraw = needStkDraw ? await import("./stickers.js").catch(() => null) : null;
    const work = useFrameAI ? document.createElement("canvas") : null;
    if (work) { work.width = vw; work.height = vh; }
    const wctx = work ? work.getContext("2d") : null;
    let frameMethod = "bicubic";
    const temporalAI = useFrameAI && upscaleMode === "ai";
    const prev = temporalAI ? document.createElement("canvas") : null;
    if (prev) { prev.width = ow; prev.height = oh; }
    const pctx = prev ? prev.getContext("2d") : null;
    let havePrev = false;
    const draw = async (t) => {
      if (signal?.aborted) throw new DOMException("Stopped.", "AbortError");
      await seekVideo(video, Math.min(t, Math.max(0, dur - 0.02)));
      sctx.imageSmoothingEnabled = true;
      sctx.imageSmoothingQuality = "high";
      if (!useFrameAI) {
        if (grade && drawGradedVideoFrame) drawGradedVideoFrame(sctx, video, 0, 0, vw, vh, 0, 0, ow, oh, grade);
        else sctx.drawImage(video, 0, 0, ow, oh);
        if (stkDraw) {
          stkDraw.drawStickersOn(sctx, ow, oh, stickers);
          stkDraw.drawFrameOn(sctx, ow, oh, frame);
        }
        return;
      }
      if (grade && drawGradedVideoFrame) drawGradedVideoFrame(wctx, video, 0, 0, vw, vh, 0, 0, vw, vh, grade);
      else wctx.drawImage(video, 0, 0, vw, vh);
      const frameBlob = await new Promise((res, rej) => work.toBlob((b) => (b ? res(b) : rej(new Error("frame encode failed"))), "image/png"));
      const up = await upscaleImage(frameBlob, { factor: ow / vw, mode: upscaleMode, signal });
      frameMethod = up.method || upscaleMode;
      sctx.drawImage(up.canvas, 0, 0, ow, oh);
      if (stkDraw) {
        stkDraw.drawStickersOn(sctx, ow, oh, stickers);
        stkDraw.drawFrameOn(sctx, ow, oh, frame);
      }
      if (temporalAI) {
        if (havePrev) {
          sctx.globalAlpha = 0.12;
          sctx.drawImage(prev, 0, 0);
          sctx.globalAlpha = 1;
        }
        pctx.drawImage(src, 0, 0);
        havePrev = true;
      }
    };
    const res = await encodeFrames({ canvas: src, fps: rate, total, draw, signal, onProgress, mimeType: want === "mkv" ? "webm" : want });
    const ext = want === "mov" ? "mov" : want === "mkv" ? "mkv" : want === "mp4" ? "mp4" : "webm";
    const fixed = want === "mov" ? new Blob([res.blob], { type: "video/mp4" }) : want === "mkv" ? new Blob([res.blob], { type: "video/x-matroska" }) : res.blob;
    return { blob: fixed, ext, passthrough: false, w: ow, h: oh, upscaled: resized, graded: gradeOn, encoder: res.encoder, method: resized ? (useFrameAI ? frameMethod : "bicubic") : null };
  } finally {
    releaseVideo(video);
  }
}

async function encodeAPNG(frames, w, h, fps = 12) {
  const enc = (c) => new Promise((res, rej) => c.toBlob((b) => (b && b.size ? res(b) : rej(new Error("frame encode failed"))), "image/png"));
  const pngs = [];
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  for (const px of frames) {
    const img = new ImageData(px, w, h);
    ctx.putImageData(img, 0, 0);
    pngs.push(new Uint8Array(await (await enc(c)).arrayBuffer()));
  }
  const readChunks = (u8) => {
    const chunks = [];
    let off = 8;
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    while (off + 8 <= u8.length) {
      const len = dv.getUint32(off);
      const type = String.fromCharCode(u8[off + 4], u8[off + 5], u8[off + 6], u8[off + 7]);
      chunks.push({ type, data: u8.slice(off + 8, off + 8 + len), crc: u8.slice(off + 8 + len, off + 8 + len + 4) });
      off += 12 + len;
      if (type === "IEND") break;
    }
    return chunks;
  };
  const crcTable = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c2 = n;
      for (let k = 0; k < 8; k++) c2 = c2 & 1 ? 0xedb88320 ^ (c2 >>> 1) : c2 >>> 1;
      t[n] = c2;
    }
    return t;
  })();
  const crc = (type, data) => {
    let c2 = 0xffffffff;
    const upd = (b) => {
      c2 = crcTable[(c2 ^ b) & 255] ^ (c2 >>> 8);
    };
    for (let i = 0; i < 4; i++) upd(type.charCodeAt(i));
    for (const b of data) upd(b);
    const v = (c2 ^ 0xffffffff) >>> 0;
    return new Uint8Array([v >>> 24, (v >> 16) & 255, (v >> 8) & 255, v & 255]);
  };
  const chunk = (type, data) => {
    const len = new Uint8Array([(data.length >>> 24) & 255, (data.length >> 16) & 255, (data.length >> 8) & 255, data.length & 255]);
    const tb = new TextEncoder().encode(type);
    const full = new Uint8Array(12 + data.length);
    full.set(len, 0);
    full.set(tb, 4);
    full.set(data, 8);
    full.set(crc(type, data), 8 + data.length);
    return full;
  };
  const first = readChunks(pngs[0]);
  const ihdr = first.find((x) => x.type === "IHDR").data;
  const idat0 = first.filter((x) => x.type === "IDAT").map((x) => x.data);
  const rest = pngs.slice(1).map(readChunks);
  const out = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])];
  out.push(chunk("IHDR", ihdr));
  const numPlays = new Uint8Array(6);
  new DataView(numPlays.buffer).setUint32(0, frames.length);
  new DataView(numPlays.buffer).setUint16(4, 0);
  out.push(chunk("acTL", numPlays));
  const seq = { v: 0 };
  const fctl = (w2, h2, delayN, delayD) => {
    const b = new Uint8Array(26);
    const dv = new DataView(b.buffer);
    dv.setUint32(0, seq.v++);
    dv.setUint32(4, w2);
    dv.setUint32(8, h2);
    dv.setUint32(12, 0);
    dv.setUint32(16, 0);
    dv.setUint16(20, delayN);
    dv.setUint16(22, delayD);
    b[24] = 1;
    b[25] = 0;
    return chunk("fcTL", b);
  };
  const fdat = (data) => {
    const b = new Uint8Array(4 + data.length);
    new DataView(b.buffer).setUint32(0, seq.v++);
    b.set(data, 4);
    return chunk("fdAT", b);
  };
  const dN = 100;
  const dD = Math.max(1, Math.round(fps)) * 10;
  out.push(fctl(w, h, Math.round((dN / dD) * 1000) || 8, 1000));
  for (const d of idat0) out.push(chunk("IDAT", d));
  rest.forEach((chunks) => {
    const idats = chunks.filter((x) => x.type === "IDAT").map((x) => x.data);
    const joined = new Uint8Array(idats.reduce((a, x) => a + x.length, 0));
    let off = 0;
    for (const d of idats) {
      joined.set(d, off);
      off += d.length;
    }
    out.push(fctl(w, h, Math.round((dN / dD) * 1000) || 8, 1000));
    out.push(fdat(joined));
  });
  out.push(chunk("IEND", new Uint8Array(0)));
  const total = out.reduce((a, x) => a + x.length, 0);
  const u8 = new Uint8Array(total);
  let off = 0;
  for (const p of out) {
    u8.set(p, off);
    off += p.length;
  }
  return new Blob([u8], { type: "image/png" });
}
