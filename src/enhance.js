/**
 * The quality boost: what the app does to a clip *after* a model produced it.
 *
 * Why it exists — the numbers. Every free image-to-video Space in the pool runs
 * a 480p Wan build, and a 480p Wan build returns 81 frames at 16 fps. The mp4
 * the Space hands back is H.264 at around 700 kbps for 480x832, which is roughly
 * a twentieth of what that picture needs, and 16 fps is a slideshow cadence for
 * anything with a person in it. Nothing about that can be fixed upstream for
 * free: the model, the size and the frame rate are what the free GPU gives.
 *
 * What *can* be fixed is the delivery. This pass re-renders the finished clip on
 * this device (no allowance, no upload, no model): resample up, sharpen, add a
 * whisper of grain to break up codec banding, draw the frames that were never
 * generated so 16 fps plays at 32, and re-encode at a bitrate that does not
 * throw the detail away. A 455 KB clip comes out around 6-10 MB and looks like
 * a different video, and it costs the user a few seconds of their own GPU
 * instead of the free pool's allowance.
 *
 * It is deliberately paranoid: any missing API, any decode failure, any encode
 * refusal returns `null` and the caller keeps the clip it had. `report` on the
 * result describes what actually happened, because the app prints it.
 */

import { createLab, webglLabSupport } from "./videoflow.js";

/** The boost is a bonus, never a requirement — but a silent skip is unhelpful, so say why. */
function warn(why) {
  try {
    console.warn(`[quality boost] skipped: ${why}`);
  } catch {}
}

const MUXER_URL = "https://esm.sh/mp4-muxer@5.1.5";

/* ------------------------------------------------------------------ parsing */

function fourcc(view, off) {
  return String.fromCharCode(view.getUint8(off), view.getUint8(off + 1), view.getUint8(off + 2), view.getUint8(off + 3));
}

/**
 * Read the frame timing straight out of the MP4 boxes.
 *
 * The alternative — playing the clip and counting the frames that come out — is
 * both slower and lossier: browsers drop frames when the compositor is busy, so
 * a 16 fps source can come back as 15.7 fps and the boost would then draw its
 * in-between frames at the wrong spacing. `stts` says exactly what the encoder
 * wrote, so the in-between frames land exactly halfway.
 */
export function parseMp4(buffer) {
  try {
    const view = new DataView(buffer);
    let moov = null;
    let p = 0;
    while (p + 8 <= buffer.byteLength) {
      let size = view.getUint32(p);
      const type = fourcc(view, p + 4);
      let head = 8;
      if (size === 1) {
        size = Number(view.getBigUint64(p + 8));
        head = 16;
      } else if (size === 0) size = buffer.byteLength - p;
      if (size < head || p + size > buffer.byteLength) break;
      if (type === "moov") moov = { start: p + head, end: p + size };
      p += size;
    }
    if (!moov) return null;
    const tracks = [];
    const walk = (start, end, depth) => {
      let o = start;
      while (o + 8 <= end) {
        let size = view.getUint32(o);
        const type = fourcc(view, o + 4);
        let head = 8;
        if (size === 1) {
          size = Number(view.getBigUint64(o + 8));
          head = 16;
        } else if (size === 0) size = end - o;
        if (size < head || o + size > end) return;
        if (type === "trak" && depth === 0) tracks.push({});
        const cur = tracks[tracks.length - 1];
        if (cur) {
          if (type === "mdhd") {
            const ver = view.getUint8(o + head);
            if (ver === 0) {
              cur.timescale = view.getUint32(o + head + 12);
              cur.mdhdDur = view.getUint32(o + head + 16);
            } else {
              cur.timescale = view.getUint32(o + head + 20);
              cur.mdhdDur = Number(view.getBigUint64(o + head + 24));
            }
          } else if (type === "hdlr") {
            cur.handler = fourcc(view, o + head + 8);
          } else if (type === "stts") {
            cur.sttsEntries = view.getUint32(o + head + 4);
            cur.sttsSamples = view.getUint32(o + head + 8);
            cur.sttsDelta = view.getUint32(o + head + 12);
          } else if (type === "stsd") {
            const eo = o + head + 8;
            cur.codec = fourcc(view, eo + 4);
            cur.width = view.getUint16(eo + 32);
            cur.height = view.getUint16(eo + 34);
          }
        }
        const container = ["trak", "mdia", "minf", "stbl", "edts", "mvex"];
        if (container.includes(type)) walk(o + head, o + size, type === "trak" ? 0 : depth + 1);
        o += size;
      }
    };
    walk(moov.start, moov.end, 0);
    const video = tracks.find((t) => t.handler === "vide" || (t.width && t.sttsSamples));
    const audio = tracks.find((t) => t.handler === "soun");
    if (!video || !video.timescale || !video.sttsDelta) return null;
    const fps = video.timescale / video.sttsDelta;
    return {
      width: video.width || 0,
      height: video.height || 0,
      codec: video.codec || "",
      fps: Math.round(fps * 1000) / 1000,
      frames: video.sttsSamples || 0,
      delta: video.sttsDelta,
      timescale: video.timescale,
      duration: (video.mdhdDur || video.sttsSamples * video.sttsDelta) / video.timescale,
      hasAudio: !!audio,
    };
  } catch {
    return null;
  }
}

/** MP4 when the boxes say so, otherwise let the browser decide. */
export async function inspectClip(blob) {
  let info = null;
  try {
    const buf = await blob.arrayBuffer();
    info = parseMp4(buf);
  } catch {}
  if (info && info.fps > 0 && info.frames > 1) return { ...info, source: "boxes" };
  const probed = await probeDuration(blob);
  if (!probed) return null;
  const fps = 24;
  return {
    width: probed.width,
    height: probed.height,
    codec: "",
    fps,
    frames: Math.max(2, Math.round(probed.duration * fps)),
    delta: 0,
    timescale: 0,
    duration: probed.duration,
    hasAudio: false,
    source: "probe",
  };
}

function probeDuration(blob) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const v = document.createElement("video");
    v.muted = true;
    v.playsInline = true;
    v.preload = "metadata";
    const done = (val) => {
      URL.revokeObjectURL(url);
      v.removeAttribute("src");
      resolve(val);
    };
    v.onloadedmetadata = () => done({ width: v.videoWidth, height: v.videoHeight, duration: v.duration });
    v.onerror = () => done(null);
    setTimeout(() => done(v.videoWidth ? { width: v.videoWidth, height: v.videoHeight, duration: v.duration } : null), 8000);
    v.src = url;
  });
}

/* ---------------------------------------------------------------- decoding */

async function openVideo(blob) {
  const url = URL.createObjectURL(blob);
  const v = document.createElement("video");
  v.muted = true;
  v.playsInline = true;
  v.preload = "auto";
  v.crossOrigin = "anonymous";
  document.body.appendChild(v);
  v.style.cssText = "position:fixed;left:-9999px;top:0;width:2px;height:2px;opacity:0";
  v.src = url;
  const ok = await new Promise((resolve) => {
    v.onloadeddata = () => resolve(true);
    v.onerror = () => resolve(false);
    setTimeout(() => resolve(v.readyState >= 2), 15000);
  });
  if (!ok) {
    URL.revokeObjectURL(url);
    v.remove();
    return null;
  }
  const close = () => {
    try {
      v.pause();
      v.removeAttribute("src");
      v.load();
    } catch {}
    URL.revokeObjectURL(url);
    v.remove();
  };
  return { v, close };
}

function seekTo(video, t) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      video.removeEventListener("seeked", finish);
      resolve();
    };
    video.addEventListener("seeked", finish);
    try {
      video.currentTime = t;
    } catch {
      finish();
    }
    setTimeout(finish, 4000);
  });
}

/* ---------------------------------------------------------------- encoding */

function bitrateFor(w, h, fps) {
  const px = w * h;
  const perPixel = px > 1_600_000 ? 0.09 : 0.13;
  return Math.max(2_500_000, Math.min(22_000_000, Math.round(px * fps * perPixel)));
}

/** mp4-muxer's name for the codec a WebCodecs config describes, or null if it cannot be muxed. */
function muxCodecFor(codec) {
  if (/^avc/.test(codec)) return "avc";
  if (/^hvc|^hev/.test(codec)) return "hevc";
  if (/^vp0?9/.test(codec)) return "vp9";
  if (/^av01/.test(codec)) return "av1";
  return null;
}

async function makeMuxer(w, h, fps, codecName) {
  try {
    const mod = await import(MUXER_URL);
    const Muxer = mod.Muxer || mod.default?.Muxer;
    const ArrayBufferTarget = mod.ArrayBufferTarget || mod.default?.ArrayBufferTarget;
    if (!Muxer || !ArrayBufferTarget) return null;
    return new (class {
      constructor() {
        this.muxer = new Muxer({
          target: new ArrayBufferTarget(),
          fastStart: "in-memory",
          video: { codec: codecName, width: w, height: h, frameRate: fps },
        });
      }
      add(chunk, meta) {
        this.muxer.addVideoChunk(chunk, meta);
      }
      finish() {
        this.muxer.finalize();
        return new Blob([this.muxer.target.buffer], { type: "video/mp4" });
      }
    })();
  } catch {
    return null;
  }
}

async function encoderSupport(w, h, fps) {
  if (typeof VideoEncoder === "undefined" || typeof VideoFrame === "undefined") return null;
  const configs = [
    { codec: "avc1.640033", width: w, height: h, bitrate: bitrateFor(w, h, fps), framerate: fps, avc: { format: "avc" } },
    { codec: "avc1.640028", width: w, height: h, bitrate: bitrateFor(w, h, fps), framerate: fps, avc: { format: "avc" } },
    { codec: "avc1.4D401F", width: w, height: h, bitrate: bitrateFor(w, h, fps), framerate: fps },
    { codec: "vp09.00.10.08", width: w, height: h, bitrate: bitrateFor(w, h, fps), framerate: fps },
  ];
  for (const cfg of configs) {
    try {
      const s = await VideoEncoder.isConfigSupported(cfg);
      if (s?.supported) return s.config || cfg;
    } catch {}
  }
  return null;
}

/* --------------------------------------------------------------- fallback */

/**
 * Last resort: draw the sharpened frames onto the canvas and let MediaRecorder
 * capture them, paced in real time. Only used when WebCodecs is missing — the
 * bitrate is still set high, so it is a real improvement over the source, just
 * without the drawn in-between frames.
 */
async function recordFallback(lab, frames, outFps, draw, signal) {
  const mime = ["video/mp4", "video/webm;codecs=vp9", "video/webm"].find((m) => {
    try {
      return MediaRecorder.isTypeSupported(m);
    } catch {
      return false;
    }
  });
  if (!mime) return null;
  const stream = lab.canvas.captureStream(0);
  const track = stream.getVideoTracks()[0];
  const manual = typeof track?.requestFrame === "function";
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: bitrateFor(lab.outW, lab.outH, outFps) });
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise((r) => (rec.onstop = r));
  const interval = 1000 / outFps;
  let next = performance.now();
  rec.start();
  for (let i = 0; i < frames; i++) {
    if (signal?.aborted) throw new Error("Cancelled");
    await draw(i);
    if (manual) track.requestFrame();
    next += interval;
    const wait = next - performance.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }
  rec.stop();
  await stopped;
  try {
    track.stop();
  } catch {}
  return new Blob(chunks, { type: rec.mimeType || mime });
}

/* ------------------------------------------------------------------ public */

export function boostSupport() {
  return {
    webgl: webglLabSupport(),
    webcodecs: typeof VideoEncoder !== "undefined" && typeof VideoFrame !== "undefined",
    video: typeof document !== "undefined" && !!document.createElement("video").canPlayType,
  };
}

/**
 * Re-render a finished clip bigger, smoother and at a sane bitrate.
 *
 * opts:
 *   scale       1-2.5      how far past the source resolution to resample
 *   fps         0 | 24-60  output frame rate; 0 or <= source means "keep"
 *   interpolate bool       draw the missing frames (needs a motion field pass)
 *   sharpen     0-1.2      unsharp amount
 *   maxPixels   number     hard ceiling on the output pixel count
 *   onProgress  (frac, label)
 *   signal      AbortSignal
 *
 * Returns `{ blob, ext, meta, report }`, or `null` when the boost cannot run
 * (older browser, undecodable clip, encoder refusal) — callers must treat null
 * as "keep what you have", never as an error.
 */
export async function boostClip(blob, opts = {}) {
  const {
    scale: wantScale = 2,
    fps: wantFps = 32,
    interpolate = true,
    sharpen = 0.62,
    grain = 0.013,
    maxPixels = 2_350_000,
    onProgress = null,
    signal = null,
  } = opts;

  if (!webglLabSupport()) {
    warn("WebGL2 is not available here");
    return null;
  }
  const info = await inspectClip(blob);
  if (!info || !info.width || !info.height) {
    warn("the clip could not be read");
    return null;
  }
  if (info.hasAudio && opts.keepAudio) {
    warn("the clip has audio and 'keep audio' is on");
    return null;
  }

  const srcFps = info.fps > 0 ? info.fps : 24;
  let factor = 1;
  if (interpolate && wantFps > srcFps * 1.25) factor = Math.min(3, Math.max(2, Math.round(wantFps / srcFps)));
  const outFps = factor > 1 ? Math.round(srcFps * factor) : Math.max(1, Math.round(srcFps));

  let outScale = Math.max(1, Math.min(2.5, wantScale));
  const limit = Math.sqrt(maxPixels / (info.width * info.height));
  outScale = Math.min(outScale, Math.max(1, limit));
  const even = (n) => Math.max(2, Math.round(n / 2) * 2);
  let outW = even(info.width * outScale);
  let outH = even(info.height * outScale);

  const opened = await openVideo(blob);
  if (!opened) {
    warn("this browser would not decode the clip");
    return null;
  }
  const { v, close } = opened;

  const started = performance.now();
  let lab = createLab({ srcW: info.width, srcH: info.height, outW, outH, sharpen, grain });
  if (!lab) {
    warn("could not build the WebGL lab");
    close();
    return null;
  }

  const frames = info.frames || Math.max(2, Math.round(info.duration * srcFps));
  const step = info.timescale ? info.delta / info.timescale : 1 / srcFps;
  const outCount = factor > 1 ? frames * factor - (factor - 1) : frames;

  const config = await encoderSupport(outW, outH, outFps);
  const codecName = config ? muxCodecFor(config.codec || "") : null;
  const mux = config && codecName ? await makeMuxer(outW, outH, outFps, codecName) : null;
  let encoder = null;
  let encodeError = null;
  if (config && mux) {
    encoder = new VideoEncoder({
      output: (chunk, meta) => {
        try {
          mux.add(chunk, meta);
        } catch (e) {
          encodeError = String(e?.message || e);
        }
      },
      error: (e) => {
        encodeError = String(e?.message || e);
      },
    });
    try {
      encoder.configure(config);
    } catch (e) {
      encodeError = String(e?.message || e);
      encoder = null;
    }
  }

  let drawn = 0;
  const us = (i) => Math.round((i * 1e6) / outFps);
  const emitFrame = async () => {
    if (!encoder || encodeError) return;
    const frame = new VideoFrame(lab.canvas, { timestamp: us(drawn), duration: Math.round(1e6 / outFps) });
    try {
      encoder.encode(frame, { keyFrame: drawn % outFps === 0 });
    } catch (e) {
      encodeError = String(e?.message || e);
    }
    frame.close();
    drawn += 1;
  };

  let report = null;
  try {
    if (encoder && mux) {
      // Prime the frame: the first source frame is a real frame, then every
      // later one is preceded by the in-between frame of its pair.
      await seekTo(v, step * 0.5);
      lab.upload(v);
      lab.enhance(0);
      lab.present({ slot: 0, alpha: 1 });
      await emitFrame();
      for (let k = 1; k < frames; k++) {
        if (signal?.aborted) throw new Error("Cancelled");
        await seekTo(v, step * (k + 0.5));
        lab.upload(v);
        lab.enhance(k % 2);
        if (factor > 1) {
          const flowTex = lab.measureFlow((k - 1) % 2, k % 2);
          for (let j = 0; j < factor - 1; j++) {
            lab.present({ slot: k % 2, other: (k - 1) % 2, flowTex, alpha: (j + 1) / factor });
            await emitFrame();
          }
        }
        lab.present({ slot: k % 2, other: (k - 1) % 2, alpha: 1 });
        await emitFrame();
        if (onProgress) onProgress(k / frames, "boosting");
      }
      if (encodeError) throw new Error(encodeError);
      await encoder.flush();
      encoder.close();
      const out = mux.finish();
      report = {
        device: true,
        srcFps,
        srcFrames: frames,
        fps: outFps,
        factor,
        srcWidth: info.width,
        srcHeight: info.height,
        width: outW,
        height: outH,
        kbps: Math.round((out.size * 8) / Math.max(0.1, outCount / outFps) / 1000),
        srcKbps: Math.round((blob.size * 8) / Math.max(0.1, info.duration) / 1000),
        ms: Math.round(performance.now() - started),
        codec: config?.codec || "avc1",
      };
      close();
      return { blob: out, ext: "mp4", meta: { width: outW, height: outH, duration: outCount / outFps }, report };
    }

    // No WebCodecs: still re-render, just without the drawn in-between frames.
    const total = frames;
    const out = await recordFallback(
      lab,
      total,
      Math.max(1, Math.round(srcFps)),
      async (i) => {
        await seekTo(v, step * (i + 0.5));
        lab.upload(v);
        lab.enhance(i % 2);
        lab.present({ slot: i % 2, alpha: 1 });
        if (onProgress) onProgress(i / total, "boosting");
      },
      signal
    );
    if (!out) {
      warn("this browser has no usable encoder");
      close();
      lab.dispose();
      return null;
    }
    report = {
      device: true,
      fallback: true,
      srcFps,
      srcFrames: frames,
      fps: Math.max(1, Math.round(srcFps)),
      factor: 1,
      srcWidth: info.width,
      srcHeight: info.height,
      width: outW,
      height: outH,
      ms: Math.round(performance.now() - started),
    };
    close();
    return { blob: out, ext: out.type.includes("mp4") ? "mp4" : "webm", meta: { width: outW, height: outH, duration: total / Math.max(1, srcFps) }, report };
  } catch (e) {
    try {
      encoder?.close();
    } catch {}
    close();
    lab.dispose();
    if (e?.message === "Cancelled") throw e;
    warn(`the boost stopped part-way: ${e?.message || e}`);
    return null;
  }
}
