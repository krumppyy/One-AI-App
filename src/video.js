/**
 * Video plumbing: object URLs, loading, probing, frame extraction, the
 * filmstrip, multi-segment stitching and frame-rate re-timing.
 *
 * `loadVideo` and `probe` repair a clip's broken duration at load time (see
 * `repairDuration` in src/encode.js), which is what makes a file labelled 81
 * minutes show its real length. Everything that encodes goes through
 * src/encode.js so the output timestamps are exact.
 */

import { durationIsSuspect, encodeFrames, recorderMime, repairDuration } from "./encode.js";

/** Create an element with attributes (offline.js builds its canvases this way). */
export function el(tag, attrs = {}) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "style" && v && typeof v === "object") Object.assign(node.style, v);
    else node.setAttribute(k, v);
  }
  return node;
}

/** Best recorder MIME this browser supports (re-exported for offline.js). */
export function videoMime() {
  return recorderMime();
}

/** Seconds → `m:ss`. */
export function fmtTime(sec) {
  let t = Number(sec);
  if (!Number.isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function release(video) {
  if (!video) return;
  try {
    video.pause();
  } catch {}
  try {
    video.removeAttribute("src");
    video.load?.();
  } catch {}
  if (video._objectUrl) {
    try {
      URL.revokeObjectURL(video._objectUrl);
    } catch {}
    video._objectUrl = "";
  }
}

/** How long a loaded video really is, preferring the value we were told. */
function realDuration(video, known) {
  const k = Number(known);
  if (k > 0 && !durationIsSuspect(k)) return k;
  const d = Number(video?.duration);
  return Number.isFinite(d) && d > 0 && d < 600 ? d : 0;
}

/**
 * Load a blob into a detached video element and wait for its metadata, then
 * repair the duration if the container lied. Callers own the element and must
 * hand it to `releaseVideo`/`probe` cleanup when done.
 */
export async function loadVideo(blob, { knownDuration = 0 } = {}) {
  const url = URL.createObjectURL(blob);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.crossOrigin = "anonymous";
  video._objectUrl = url;
  video.src = url;
  try {
    await new Promise((resolve, reject) => {
      let done = false;
      const ok = () => {
        if (done) return;
        done = true;
        clean();
        resolve();
      };
      const bad = () => {
        if (done) return;
        done = true;
        clean();
        reject(new Error("This browser cannot play that video file."));
      };
      const clean = () => {
        video.removeEventListener("loadedmetadata", ok);
        video.removeEventListener("loadeddata", ok);
        video.removeEventListener("error", bad);
      };
      video.addEventListener("loadedmetadata", ok);
      video.addEventListener("loadeddata", ok);
      video.addEventListener("error", bad);
      setTimeout(() => {
        if (done) return;
        if (video.videoWidth) ok();
        else bad();
      }, 20000);
    });
  } catch (e) {
    release(video);
    throw e;
  }
  if (durationIsSuspect(video.duration) || Number(knownDuration) > 0) {
    try {
      await repairDuration(video);
    } catch {}
  }
  return video;
}

/** Release a video loaded by `loadVideo`. */
export function releaseVideo(video) {
  release(video);
}

/** Size, length and MIME of a clip without keeping it around. */
export async function probe(blob) {
  const video = await loadVideo(blob);
  const info = {
    width: video.videoWidth || 0,
    height: video.videoHeight || 0,
    duration: video.duration,
    type: blob.type,
  };
  release(video);
  return info;
}

/** Seek a video and wait for the frame to actually be there. */
export function seekVideo(video, t) {
  return new Promise((resolve, reject) => {
    const dur = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
    const target = dur ? Math.max(0, Math.min(t, Math.max(0, dur - 0.001))) : Math.max(0, t);
    if (video.readyState >= 2 && Math.abs(video.currentTime - target) < 0.005) {
      resolve();
      return;
    }
    const done = () => {
      clean();
      resolve();
    };
    const bad = () => {
      clean();
      reject(new Error("Could not read a frame from that clip."));
    };
    const clean = () => {
      video.removeEventListener("seeked", done);
      video.removeEventListener("error", bad);
    };
    video.addEventListener("seeked", done);
    video.addEventListener("error", bad);
    try {
      video.currentTime = target;
    } catch (e) {
      clean();
      reject(e);
    }
  });
}

const EPS = 1 / 60;

/**
 * Pull a still out of a clip. `which` is `"first"`, `"last"`, a number of
 * seconds, or a 0–1 fraction. Returns a JPEG blob — used for the filmstrip, for
 * chaining (the last frame becomes the next segment's reference) and for
 * "Continue from last frame".
 */
export async function extractFrame(blob, which = "last") {
  const video = await loadVideo(blob);
  try {
    const dur = realDuration(video, video.duration);
    let t;
    if (which === "last") t = Math.max(0, dur - EPS * 3);
    else if (which === "first") t = 0;
    else if (typeof which === "number" && which > 1) t = which;
    else if (typeof which === "number") t = which * dur;
    else t = dur / 2;
    await seekVideo(video, t);
    const w = video.videoWidth || 640;
    const h = video.videoHeight || 360;
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    c.getContext("2d").drawImage(video, 0, 0, w, h);
    const out = await new Promise((res) => c.toBlob((b) => res(b), "image/jpeg", 0.93));
    if (!out) throw new Error("Could not encode that frame.");
    return out;
  } finally {
    release(video);
  }
}

/** `count` evenly-spaced thumbnails as data URLs, for the filmstrip. */
export async function filmstrip(blob, count = 8) {
  const video = await loadVideo(blob);
  const out = [];
  try {
    const dur = realDuration(video, video.duration) || 1;
    const h = 74;
    const w = Math.max(40, Math.round(((video.videoWidth || 160) / (video.videoHeight || 90)) * h));
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    for (let i = 0; i < count; i++) {
      await seekVideo(video, ((i + 0.5) / count) * dur);
      ctx.drawImage(video, 0, 0, w, h);
      out.push(c.toDataURL("image/jpeg", 0.68));
    }
  } finally {
    release(video);
  }
  return out;
}

/**
 * Everything the engine needs in order to judge one returned segment, measured
 * in a single pass over the file.
 *
 * Two failures used to stay invisible until the finished clip was watched: a
 * clip that does not move (a model that took the still and animated almost
 * nothing), and a clip that is not a picture of the shot it was handed — a
 * render that came back blown out, melted, or re-cast. Both are properties of
 * the file itself, so both are measured here, and the segment loop can act on
 * them instead of stitching them in and calling the run a success.
 *
 *   `motion` / `motionAll` / `motionMid` — the share of pixels that changed
 *     noticeably (luma delta over `threshold` of 255) between the sampled
 *     frames. A frozen clip reads ~0.000, a slow push-in a few thousandths, a
 *     shot with a person moving in it a few hundredths or more. Measured over
 *     the whole frame and over the central region (where the subject usually
 *     is); the larger of the two is returned so a small, fast-moving subject is
 *     never read as stillness.
 *   `detail` — mean edge energy of the sampled frames. A blank, melted or
 *     smeared frame reads far below a real photograph.
 *   `first` / `mean` — brightness (0–255), saturation (0–255) and edge energy
 *     of the opening frame and of all the sampled frames.
 *   `startDrift` — how far the opening frame has moved from `start` (the still
 *     the segment was asked to animate from), 0–1. A model that ignores its
 *     conditioning frame and invents its own shot reads high here — and so does
 *     a melted render, which is why one number catches both.
 *   `endDrift` — the same for the closing frame against `end`. That is how
 *     "did this beat actually arrive at the frame it was aiming for?" gets
 *     answered, which is the one question a video model cannot answer itself.
 *   `blown` — the opening frame is far brighter *and* far more saturated than
 *     the reference: an over-exposed or melted render.
 *   `flat` — the clip carries far less edge energy than the reference: a
 *     blurred, smeared, detail-free render.
 *
 * `ref` is the stats of the reference picture (`imageStats` in src/image.js).
 * Without one, `blown` and `flat` are always false and only `motion`,
 * `startDrift` and `endDrift` mean anything. Everything is sampled small (128
 * px) so this never competes with the renderer.
 */
export async function clipMetrics(blob, { samples = 6, threshold = 10, ref = null, start = null, end = null } = {}) {
  const n = Math.max(2, Math.min(12, Math.floor(samples) || 6));
  const video = await loadVideo(blob);
  try {
    const dur = realDuration(video, video.duration) || 1;
    const w = 128;
    const h = Math.max(48, Math.round(((video.videoHeight || 90) / (video.videoWidth || 160)) * w));
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    const frames = [];
    // The first sample is the true opening frame (t = 0) and the last is the
    // closing one, so `startDrift`/`endDrift` compare the real ends of the shot
    // rather than an interior frame near them.
    for (let i = 0; i < n; i++) {
      await seekVideo(video, (i / (n - 1)) * Math.max(0, dur - EPS));
      ctx.drawImage(video, 0, 0, w, h);
      frames.push(ctx.getImageData(0, 0, w, h).data);
    }
    const luma = (f, p) => f[p] * 0.299 + f[p + 1] * 0.587 + f[p + 2] * 0.114;
    const cx0 = Math.floor(w * 0.25);
    const cx1 = Math.ceil(w * 0.75);
    const cy0 = Math.floor(h * 0.2);
    const cy1 = Math.ceil(h * 0.8);
    let changedAll = 0;
    let totalAll = 0;
    let changedMid = 0;
    let totalMid = 0;
    for (let i = 1; i < frames.length; i++) {
      const a = frames[i - 1];
      const b = frames[i];
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const o = (y * w + x) * 4;
          const d = Math.abs(luma(a, o) - luma(b, o));
          totalAll += 1;
          if (d > threshold) changedAll += 1;
          if (x >= cx0 && x < cx1 && y >= cy0 && y < cy1) {
            totalMid += 1;
            if (d > threshold) changedMid += 1;
          }
        }
      }
    }
    const motionAll = totalAll ? changedAll / totalAll : 0;
    const motionMid = totalMid ? changedMid / totalMid : 0;
    const motion = Math.max(motionAll, motionMid);
    // Brightness, saturation and edge energy, per sampled frame.
    const stat = (f) => {
      let lum = 0;
      let sat = 0;
      for (let p = 0; p < w * h; p++) {
        const o = p * 4;
        lum += luma(f, o);
        const mx = Math.max(f[o], f[o + 1], f[o + 2]);
        const mn = Math.min(f[o], f[o + 1], f[o + 2]);
        sat += mx - mn;
      }
      let e = 0;
      for (let y = 0; y < h; y++) {
        for (let x = 1; x < w; x++) {
          const o = (y * w + x) * 4;
          e += Math.abs(luma(f, o) - luma(f, o - 4));
        }
      }
      return { lum: lum / (w * h), sat: sat / (w * h), detail: e / (w * h * 255) };
    };
    const stats = frames.map(stat);
    const first = stats[0];
    const mean = stats.reduce(
      (a, s) => ({ lum: a.lum + s.lum / stats.length, sat: a.sat + s.sat / stats.length, detail: a.detail + s.detail / stats.length }),
      { lum: 0, sat: 0, detail: 0 }
    );
    const driftTo = async (still, frame) => {
      if (!still || !frame) return null;
      const other = await boxPixels(still, w, h).catch(() => null);
      if (!other) return null;
      return diffShare(frame, other, w * h, threshold);
    };
    const startDrift = await driftTo(start, frames[0]);
    const endDrift = await driftTo(end, frames[frames.length - 1]);
    // Only meaningful against a reference: "far brighter and far more saturated
    // than the shot's own picture" and "far less detailed than it".
    let blown = false;
    let flat = false;
    let flatFrames = 0;
    if (ref && Number(ref.detail) > 0.004) {
      blown = first.lum - Number(ref.lum) > BLOWN_LUM && first.sat - Number(ref.sat) > BLOWN_SAT;
      const floor = Number(ref.detail) * FLAT_RATIO;
      flatFrames = stats.filter((s) => s.detail < floor).length;
      // The opening frame alone counts: a clip that begins on a melted frame is
      // a broken clip even when it recovers, because that is the frame the beat
      // before it hands on to (and the frame the viewer sees first).
      flat = first.detail < floor || flatFrames >= Math.ceil(stats.length / 2);
    }
    const r4 = (v) => Math.round(Number(v) * 10000) / 10000;
    return {
      motion: r4(motion),
      motionAll: r4(motionAll),
      motionMid: r4(motionMid),
      // `detail` stays the mean over the clip, for callers that only ask for it.
      detail: r4(mean.detail),
      first: { lum: r4(first.lum), sat: r4(first.sat), detail: r4(first.detail) },
      mean: { lum: r4(mean.lum), sat: r4(mean.sat), detail: r4(mean.detail) },
      last: (() => {
        const l = stats[stats.length - 1];
        return { lum: r4(l.lum), sat: r4(l.sat), detail: r4(l.detail) };
      })(),
      startDrift,
      endDrift,
      blown,
      flat,
      flatFrames,
      ref: ref ? { lum: Number(ref.lum), sat: Number(ref.sat), detail: Number(ref.detail) } : null,
      samples: frames.length,
    };
  } finally {
    release(video);
  }
}

/**
 * Motion and detail only — the shape callers had before `clipMetrics` existed.
 * The driver-clip check in src/engine.js only needs these two.
 */
export async function clipMotion(blob, { samples = 6, threshold = 10 } = {}) {
  const m = await clipMetrics(blob, { samples, threshold });
  return { motion: m.motion, motionAll: m.motionAll, motionMid: m.motionMid, detail: m.detail, samples: m.samples };
}

/** How much brighter/more saturated a render may be than the reference before
 * it is called blown out, and how far its edge energy may fall. Measured on the
 * clip that came back with a melted, over-exposed opening second — brightness
 * +95 and saturation +76 against the reference, at 35–52 % of its detail. */
const BLOWN_LUM = 55;
const BLOWN_SAT = 35;
const FLAT_RATIO = 0.55;

/** Draw an image (Blob or URL) into a `w × h` box and return its pixels. */
async function boxPixels(src, w, h) {
  const bmp = await createImageBitmap(src);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  return ctx.getImageData(0, 0, w, h).data;
}

/** Share of pixels that differ by more than `threshold` of 255 on any channel. */
function diffShare(a, b, px, threshold) {
  let changed = 0;
  for (let p = 0; p < px; p++) {
    const o = p * 4;
    const m = Math.max(Math.abs(a[o] - b[o]), Math.abs(a[o + 1] - b[o + 1]), Math.abs(a[o + 2] - b[o + 2]));
    if (m > threshold) changed += 1;
  }
  return Math.round((changed / px) * 10000) / 10000;
}

/** Draw a video into a canvas, cover-fitted and centred. */
function drawCover(ctx, video, w, h) {
  const vw = video.videoWidth || w;
  const vh = video.videoHeight || h;
  const s = Math.max(w / vw, h / vh);
  const dw = vw * s;
  const dh = vh * s;
  ctx.drawImage(video, (w - dw) / 2, (h - dh) / 2, dw, dh);
}

/**
 * Reframe a finished clip to the exact aspect ratio that was asked for.
 *
 * Pooled models render at their own shape: a 16:9 request routinely comes back
 * 1:1, and `stitch()` used to keep the biggest shape it saw — so the file the
 * user keeps was whatever the model felt like. This centre cover-crops the clip
 * to `ratio` at its own scale (never upscaled, never stretched, never
 * letterboxed) and re-encodes it. When the clip already matches within 1.5 %
 * the original bytes are returned untouched.
 */
export async function normalizeToAspect(blob, { ratio = 16 / 9, fps = 0, duration = 0, signal = null, onProgress = null } = {}) {
  const r = Number(ratio);
  if (!(r > 0)) return { blob, width: 0, height: 0, changed: false };
  const video = await loadVideo(blob, { knownDuration: duration });
  try {
    const vw = video.videoWidth || 0;
    const vh = video.videoHeight || 0;
    if (!vw || !vh) return { blob, width: vw, height: vh, changed: false };
    if (Math.abs(vw / vh - r) / r < 0.015) {
      return { blob, width: vw, height: vh, duration: realDuration(video, duration) || 0, changed: false };
    }
    const dur = realDuration(video, duration) || Number(duration) || 1;
    const rate = Number(fps) > 0 ? Number(fps) : 24;
    let cw, ch;
    if (vw / vh > r) {
      ch = vh - (vh % 2);
      cw = Math.round(ch * r) - (Math.round(ch * r) % 2);
    } else {
      cw = vw - (vw % 2);
      ch = Math.round(cw / r) - (Math.round(cw / r) % 2);
    }
    cw = Math.max(2, cw);
    ch = Math.max(2, ch);
    const canvas = document.createElement("canvas");
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext("2d");
    const total = Math.max(1, Math.round(dur * rate));
    const draw = async (t) => {
      await seekVideo(video, Math.min(t, Math.max(0, dur - EPS)));
      drawCover(ctx, video, cw, ch);
    };
    const res = await encodeFrames({ canvas, fps: rate, total, draw, signal, onProgress });
    return { blob: res.blob, width: cw, height: ch, duration: dur, fps: rate, encoder: res.encoder, changed: true };
  } finally {
    release(video);
  }
}

/**
 * Re-encode a clip at a different frame rate without changing its length: the
 * content is sampled on a `1/fps` grid and written out at that rate. This is
 * what makes a chosen frame rate real for a clip that came back from a model at
 * its own rate.
 *
 * `targetDuration` additionally cuts the clip to the length the run was asked
 * for (never stretches it — see `stitch`), which is how a single model's own
 * window, a little over or under the request, comes back at the requested
 * length.
 */
export async function retimeClip(blob, { fps, fromFps = 0, duration = 0, targetDuration = 0, signal = null, onProgress = null } = {}) {
  const video = await loadVideo(blob, { knownDuration: duration });
  try {
    const dur = realDuration(video, duration) || 1;
    const w = video.videoWidth || 640;
    const h = video.videoHeight || 360;
    const rate = Number(fps) > 0 ? Number(fps) : Number(fromFps) > 0 ? Number(fromFps) : 24;
    const target = Number(targetDuration) > 0 ? Number(targetDuration) : 0;
    const outDur = target ? Math.min(target, dur) : dur;
    const total = Math.max(1, Math.round(outDur * rate));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    const draw = async (t) => {
      await seekVideo(video, Math.min(t, Math.max(0, dur - EPS)));
      ctx.drawImage(video, 0, 0, w, h);
    };
    const res = await encodeFrames({ canvas, fps: rate, total, draw, signal, onProgress });
    return {
      blob: res.blob,
      width: w,
      height: h,
      duration: outDur,
      fps: rate,
      frames: res.frames,
      encoder: res.encoder,
      trimmed: !!target && target < dur,
    };
  } finally {
    release(video);
  }
}

/**
 * Composite several clips onto one timeline with a fixed crossfade and encode
 * the result. Each output frame is decoded once (by seeking), so the cost is
 * one seek per frame rather than a re-encode of every source.
 *
 * `targetDuration` is the length the run was asked for. A crossfade shortens the
 * timeline by one overlap per join, so a chain of real renders almost never adds
 * up to the request exactly — without this the finished file was as much as a
 * second and a half short of what the user set (measured: 5 s asked, 3.25 s
 * delivered, from three beats plus two 0.25 s crossfades). Passing the request
 * here makes it the timeline that is cut rather than the other way round: a
 * chain that over-ran is trimmed to exactly the requested length, and one that
 * genuinely came up short is left at its real length (a frozen tail would be a
 * worse lie than a short clip) with `short: true` so the caller can say so.
 */
export async function stitch(clips, { fps = 24, crossfade = 0.25, targetDuration = 0, signal = null, onProgress = null } = {}) {
  const parts = [];
  let skipped = 0;
  try {
    for (const blob of clips) {
      // A clip that will not decode cannot be composited — and it must not be
      // allowed to take the beats that *did* render down with it. The segment
      // loop rejects an unreadable clip the moment it arrives (see
      // `clipMetrics` in src/engine.js), so this is a second line of defence:
      // one corrupt download used to abort the whole finished run here, after
      // every beat had already been paid for, with "This browser cannot play
      // that video file."
      let video;
      try {
        video = await loadVideo(blob);
      } catch {
        skipped += 1;
        continue;
      }
      const dur = realDuration(video, video.duration) || 2;
      parts.push({ video, dur, w: video.videoWidth || 640, h: video.videoHeight || 360 });
    }
    if (!parts.length) throw new Error("None of the rendered clips could be read back.");
    const W = parts.reduce((m, p) => Math.max(m, p.w), 0);
    const H = parts.reduce((m, p) => Math.max(m, p.h), 0);
    const cw = W + (W % 2);
    const ch = H + (H % 2);
    const maxCf = Math.min(...parts.map((p) => p.dur * 0.45));
    const cf = Math.max(0, Math.min(Number(crossfade) || 0, maxCf));
    const starts = [];
    let acc = 0;
    for (const p of parts) {
      starts.push(acc);
      acc += p.dur - cf;
    }
    const timeline = acc + cf;
    const rate = Number(fps) > 0 ? Number(fps) : 24;
    const target = Number(targetDuration) > 0 ? Number(targetDuration) : 0;
    // Cut to the request, never stretched to it: an over-running chain is
    // trimmed, an under-running one keeps its real length and says so.
    const totalDur = target ? Math.min(target, timeline) : timeline;
    const total = Math.max(1, Math.round(totalDur * rate));
    // More than half a frame under what was asked for counts as short.
    const short = !!target && timeline < target - 0.5 / rate;

    const canvas = document.createElement("canvas");
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext("2d");

    const draw = async (t) => {
      let idx = 0;
      for (let i = 0; i < parts.length; i++) if (t >= starts[i] - 1e-6) idx = i;
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, cw, ch);
      const p = parts[idx];
      await seekVideo(p.video, Math.max(0, t - starts[idx]));
      drawCover(ctx, p.video, cw, ch);
      const next = parts[idx + 1];
      if (next && t >= starts[idx + 1]) {
        const a = cf > 0 ? Math.min(1, (t - starts[idx + 1]) / cf) : 1;
        await seekVideo(next.video, Math.max(0, t - starts[idx + 1]));
        ctx.save();
        ctx.globalAlpha = a;
        drawCover(ctx, next.video, cw, ch);
        ctx.restore();
      }
    };

    const res = await encodeFrames({ canvas, fps: rate, total, draw, signal, onProgress });
    return { blob: res.blob, width: cw, height: ch, duration: totalDur, fps: rate, encoder: res.encoder, timeline, short, skipped };
  } finally {
    for (const p of parts) release(p.video);
  }
}

/** Trigger a browser download of a blob. */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || "clip";
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 4000);
}

/**
 * Fetch a finished clip as a Blob. `superFetch` (Perchance's proxy) is the
 * preferred route — it is a different address, so a model's file server never
 * learns where the visitor is. `proxyOnly` refuses to fall back to this
 * connection, which is what strict-privacy mode wants.
 */
export async function blobFromUrl(url, superFetch = null, { proxyOnly = false } = {}) {
  let lastErr = null;
  if (typeof superFetch === "function") {
    try {
      const r = await superFetch(url);
      if (r && (r.ok === undefined || r.ok)) {
        const b = await r.blob();
        if (b && b.size) return b;
      }
      lastErr = new Error(`The proxy answered ${r?.status ?? "?"}.`);
    } catch (e) {
      lastErr = e;
    }
  }
  if (proxyOnly) throw lastErr || new Error("No relay could fetch that file.");
  const r = await fetch(url, { credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store" });
  if (!r.ok) throw new Error(`Could not download the clip (HTTP ${r.status}).`);
  return await r.blob();
}
