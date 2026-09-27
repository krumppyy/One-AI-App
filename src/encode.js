/**
 * Deterministic encoding, frame rate and duration repair.
 *
 * The old renderer used `MediaRecorder`, whose WebM output carries no duration
 * of its own — so the browser guessed one from the last cluster timestamp and a
 * 5-second clip displayed as 81:16, or as 1 h 21 min. Here a canvas clip is
 * muxed frame-by-frame with WebCodecs + a real muxer at exact timestamps, so the
 * file's length is right to the millisecond and any frame rate is honoured with
 * genuinely distinct frames. `MediaRecorder` survives only as the fallback for a
 * browser without WebCodecs, and even then the duration is repaired at load
 * (see `repairDuration`).
 *
 * The same primitives back the Stage: a single pooled clip that came back at
 * the model's own rate is re-timed (`retimeClip`), and multi-segment runs are
 * composited onto one timeline (`stitch` in src/video.js) before being encoded
 * here.
 */

const MP4_MUXER = "https://esm.sh/mp4-muxer@5.2.2";
const WEBM_MUXER = "https://esm.sh/webm-muxer@5.1.4";

/** The frame rates the UI offers, low to high. */
export const FPS_LADDER = [8, 12, 16, 24, 30, 48, 60];

/**
 * What each model family really renders at. Asking a Wan for 60 fps does not
 * give you 60 fps — it gives you mush — so the ladder snaps the request to what
 * the chosen model can actually produce and the UI says when it snapped.
 */
export const NATIVE_FPS = {
  wan: 16,
  wan22: 16,
  wan21: 16,
  ltx: 24,
  svd: 7,
  cogvideo: 8,
  i2vgen: 8,
  zeroscope: 16,
  offline: 30,
  server: 16,
};

/** The rate to attribute to a provider: its own `fps`, else its family. */
export function nativeFpsFor(provider) {
  if (!provider) return NATIVE_FPS.default;
  if (Number(provider.fps) > 0) return Number(provider.fps);
  const id = String(provider.id || "").toLowerCase();
  for (const key of Object.keys(NATIVE_FPS)) if (id.includes(key)) return NATIVE_FPS[key];
  if (provider.kind === "offline") return NATIVE_FPS.offline;
  return NATIVE_FPS.default;
}

/**
 * Snap a requested rate onto the ladder. `0`/blank means "whatever the model
 * does"; a number off the ladder snaps to the nearest rung so the label and the
 * file always agree.
 */
export function snapFps(requested, native = 24) {
  const nat = Number(native) > 0 ? Number(native) : 24;
  const req = Number(requested) || 0;
  if (!req) return nat;
  if (FPS_LADDER.includes(req)) return req;
  let best = FPS_LADDER[0];
  let bestD = Infinity;
  for (const f of FPS_LADDER) {
    const d = Math.abs(f - req);
    if (d < bestD) {
      bestD = d;
      best = f;
    }
  }
  return best;
}

/** A sane bitrate for a canvas of this size at this rate. */
export function bitrateFor(w, h, fps) {
  const px = Math.max(1, w) * Math.max(1, h);
  const raw = px * (Number(fps) || 24) * 0.14;
  return Math.max(2_500_000, Math.min(40_000_000, Math.round(raw / 1000) * 1000));
}

let _hasEncoder;
/** True if this browser can encode frames deterministically (WebCodecs). */
export function hasVideoEncoder() {
  if (_hasEncoder !== undefined) return _hasEncoder;
  _hasEncoder = typeof VideoEncoder === "function" && typeof VideoFrame === "function";
  return _hasEncoder;
}

let _mime;
/** The best recording MIME this browser supports (MediaRecorder fallback). */
export function recorderMime() {
  if (_mime !== undefined) return _mime;
  _mime = "";
  try {
    if (typeof MediaRecorder !== "undefined" && typeof MediaRecorder.isTypeSupported === "function") {
      for (const m of [
        "video/mp4;codecs=avc1.42E01f",
        "video/mp4",
        "video/webm;codecs=vp9",
        "video/webm;codecs=vp8",
        "video/webm",
      ]) {
        if (MediaRecorder.isTypeSupported(m)) {
          _mime = m;
          break;
        }
      }
    }
  } catch {}
  return _mime;
}

/**
 * Is this duration obviously wrong? A container the app just produced is at
 * most 15 s; anything past five minutes is a broken header, not a long movie.
 */
export function durationIsSuspect(sec) {
  const d = Number(sec);
  return !Number.isFinite(d) || d <= 0 || d > 300;
}

const nextTick = () => new Promise((r) => setTimeout(r, 0));
const abortError = () => new DOMException("The run was stopped.", "AbortError");

/**
 * Ask a video element for its real length. A media file whose header has no
 * duration reports `Infinity` (or a wild guess) until the browser is pushed
 * past the end, at which point it computes the true value from the last cluster.
 * Used by the Stage at load time, so even a file from another provider shows the
 * length it really is.
 */
export async function repairDuration(video) {
  if (!video) return 0;
  const read = () => {
    const d = Number(video.duration);
    return Number.isFinite(d) && d > 0 && d < 1e6 ? d : 0;
  };
  const first = read();
  if (first > 0 && !durationIsSuspect(first)) return first;
  const found = await new Promise((resolve) => {
    let done = false;
    const onChange = () => {
      const v = read();
      if (v > 0) finish(v);
    };
    const finish = (v) => {
      if (done) return;
      done = true;
      video.removeEventListener("durationchange", onChange);
      video.removeEventListener("timeupdate", onChange);
      video.removeEventListener("seeked", onChange);
      resolve(v || 0);
    };
    video.addEventListener("durationchange", onChange);
    video.addEventListener("timeupdate", onChange);
    video.addEventListener("seeked", onChange);
    try {
      video.currentTime = 1e101;
    } catch {
      finish(read());
    }
    setTimeout(() => finish(read()), 2200);
  });
  try {
    video.currentTime = 0;
  } catch {}
  return found;
}

/* --------------------------------------------------------------- encoders */

/** The muxer/codec plans, best playback compatibility first. */
function muxPlans(mimeType = "") {
  const want = String(mimeType).toLowerCase();
  const plans = [];
  if (!want.includes("webm")) plans.push({ mux: "mp4", codec: "avc1.42E01f", vcodec: "avc" });
  if (!want.includes("mp4")) {
    plans.push({ mux: "webm", codec: "vp09.00.10.08", vcodec: "V_VP9" });
    plans.push({ mux: "webm", codec: "vp8", vcodec: "V_VP8" });
  }
  return plans;
}

/**
 * Encode `total` frames at `fps` by calling `draw(t, i, total)` before each one.
 * `draw` may be synchronous or return a promise (the stitcher has to seek).
 *
 * The frame is copied through a 2D canvas on the way in. That is deliberate: a
 * WebGL canvas (the on-device rig) has no `preserveDrawingBuffer`, and reading
 * it *after* the frame has been presented comes back blank. A synchronous blit
 * inside the same task reads the pixels while they are still there.
 */
export async function encodeFrames(o) {
  const { canvas } = o;
  const rate = snapFps(o.fps, 30);
  const total = Math.max(1, Math.round(Number(o.total) || 1));
  if (hasVideoEncoder()) {
    let lastErr = null;
    for (const plan of muxPlans(o.mimeType)) {
      try {
        return await encodeWebCodecs({ ...o, fps: rate, total, plan });
      } catch (e) {
        if (e?.name === "AbortError") throw e;
        lastErr = e;
      }
    }
    if (o.onProgress) o.onProgress(0, `WebCodecs unavailable (${lastErr?.message || "codec refused"}) — using the recorder`);
  }
  return await recordCanvasRealtime({ ...o, fps: rate, total });
}

async function encodeWebCodecs({ canvas, draw, fps, total, signal, onProgress, plan }) {
  const w = canvas.width;
  const h = canvas.height;
  if (!w || !h) throw new Error("The canvas has no size.");
  const bitrate = bitrateFor(w, h, fps);
  const support = await VideoEncoder.isConfigSupported({ codec: plan.codec, width: w, height: h, bitrate, framerate: fps }).catch(() => null);
  if (!support?.supported) throw new Error(`This browser cannot encode ${plan.codec}.`);

  const mod = plan.mux === "mp4" ? await import(MP4_MUXER) : await import(WEBM_MUXER);
  const target = new mod.ArrayBufferTarget();
  const muxer = new mod.Muxer({
    target,
    video: { codec: plan.vcodec, width: w, height: h, frameRate: fps },
    ...(plan.mux === "mp4" ? { fastStart: "in-memory" } : {}),
  });

  const copier = document.createElement("canvas");
  copier.width = w;
  copier.height = h;
  const cctx = copier.getContext("2d", { alpha: false });

  let encError = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => {
      encError = e;
    },
  });
  encoder.configure({ codec: plan.codec, width: w, height: h, bitrate, framerate: fps });

  const durUs = 1e6 / fps;
  const keyEvery = Math.max(1, Math.round(fps * 2));
  const step = Math.max(1, Math.round(total / 40));
  try {
    for (let i = 0; i < total; i++) {
      if (signal?.aborted) throw abortError();
      if (encError) throw encError;
      await draw((i / fps), i, total);
      cctx.drawImage(canvas, 0, 0, w, h);
      const frame = new VideoFrame(copier, { timestamp: Math.round(i * durUs), duration: Math.round(durUs) });
      encoder.encode(frame, { keyFrame: i % keyEvery === 0 });
      frame.close();
      if (encoder.encodeQueueSize > 8) await nextTick();
      if (onProgress && (i % step === 0 || i === total - 1)) onProgress(i / Math.max(1, total - 1));
    }
    await encoder.flush();
  } finally {
    try {
      encoder.close();
    } catch {}
  }
  if (encError) throw encError;
  muxer.finalize();

  const blob = new Blob([target.buffer], { type: plan.mux === "mp4" ? "video/mp4" : "video/webm" });
  return { blob, duration: total / fps, fps, frames: total, encoder: `WebCodecs ${plan.mux}/${plan.vcodec}` };
}

/**
 * The real-time recorder — the fallback for a browser without WebCodecs. It
 * draws every frame, so the motion is real, but the pacing is wall-clock and the
 * file may need its duration repaired at load (see `repairDuration`).
 */
export async function recordCanvasRealtime({ canvas, draw, fps, total, mimeType, signal, onProgress }) {
  if (typeof MediaRecorder === "undefined" || typeof canvas.captureStream !== "function") {
    throw new Error("This browser cannot record video from a canvas.");
  }
  const mime = mimeType || recorderMime();
  const stream = canvas.captureStream(fps);
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const parts = [];
  rec.ondataavailable = (e) => {
    if (e.data && e.data.size) parts.push(e.data);
  };
  const stopped = new Promise((res) => {
    rec.onstop = res;
  });
  rec.start();
  const dt = 1000 / fps;
  const t0 = performance.now();
  try {
    for (let i = 0; i < total; i++) {
      if (signal?.aborted) throw abortError();
      await draw(i / fps, i, total);
      // Pace against the clock so a slow draw does not turn a 5 s clip into 20.
      const target = t0 + (i + 1) * dt;
      const wait = target - performance.now();
      await new Promise((r) => setTimeout(r, Math.max(0, wait)));
      if (onProgress && i % Math.max(1, Math.round(total / 40)) === 0) onProgress(i / Math.max(1, total - 1));
    }
  } finally {
    try {
      rec.stop();
    } catch {}
    await stopped.catch(() => {});
    try {
      stream.getTracks().forEach((t) => t.stop());
    } catch {}
  }
  const out = new Blob(parts, { type: mime || "video/webm" });
  onProgress?.(1);
  return { blob: out, duration: total / fps, fps, frames: total, encoder: "MediaRecorder" };
}

/**
 * Encode a canvas animation: exactly `duration x fps` frames at exact
 * timestamps, with `draw(t)` called before each. Returns the clip and what
 * encoded it, so the result note can say which encoder ran.
 */
export async function encodeCanvasClip(o) {
  const fps = snapFps(o.fps, 30);
  const duration = Math.max(0.1, Number(o.duration) || 0.1);
  const total = Math.max(1, Math.round(duration * fps));
  return await encodeFrames({ ...o, fps, total });
}

export { encodeFrames as encodeCanvasFrames };
