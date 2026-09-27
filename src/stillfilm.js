/**
 * A clip built out of stills, for when no video model can animate them.
 *
 * WHY THIS EXISTS
 * ---------------
 * On an undress run the undress does not happen in the video model — it happens
 * in the *stills*. The storyboard draws her one garment further along, one step
 * at a time (src/storyboard.js), and the video model's only job is the motion
 * between two of those stills. So when every video route refuses the job (the
 * free pool meters GPU-seconds per address and a 14B Wan clip spends a lot of
 * them), the run used to end with nothing at all — even though a set of real,
 * explicit pictures of her had already been drawn and paid for.
 *
 * This renders those stills into a clip: each one is held, then cross-dissolved
 * into the next, over a slow push-in, encoded at exactly the length and frame
 * rate that was asked for. It is not generated motion and it does not pretend to
 * be — the result card says so plainly — but it *is* her, undressing, and it
 * costs no GPU at all.
 *
 * The alternative was an error message, which is what this replaces.
 */

import { encodeFrames } from "./encode.js";

/**
 * How much of each step is a hold before the dissolve starts. A still that
 * immediately starts fading reads as a slideshow; holding it first and then
 * dissolving reads as a change happening.
 */
const HOLD = 0.55;

/** How far the shot pushes in across the whole clip (a dead-still slideshow
 * looks broken; a slow push reads as a camera). */
const PUSH = 0.055;

/**
 * @param {object} o
 * @param {Blob[]} o.frames   the stills, in order (the drawn storyboard frames)
 * @param {number}  o.duration seconds to fill
 * @param {number}  o.fps      output frame rate
 * @returns {Promise<{blob: Blob, width: number, height: number, duration: number, fps: number, frames: number, encoder: string}>}
 */
export async function renderStillFilm({ frames = [], duration = 5, fps = 16, signal = null, onProgress = null } = {}) {
  const list = (frames || []).filter(Boolean);
  if (list.length < 2) throw new Error("a still film needs at least two frames");
  const bitmaps = [];
  for (const b of list) {
    const bmp = await createImageBitmap(b).catch(() => null);
    if (bmp) bitmaps.push(bmp);
  }
  if (bitmaps.length < 2) throw new Error("those stills could not be decoded in this browser");

  const W = bitmaps[0].width || 512;
  const H = bitmaps[0].height || 512;
  const cw = W + (W % 2);
  const ch = H + (H % 2);
  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext("2d");

  const rate = Math.max(1, Math.round(Number(fps) || 16));
  const dur = Math.max(0.4, Number(duration) || 0);
  const total = Math.max(1, Math.round(dur * rate));
  // The time between one still and the next. The last still is reached exactly
  // at the end of the clip, so "nude by the end" stays true.
  const span = dur / (bitmaps.length - 1);
  const ease = (x) => x * x * (3 - 2 * x);

  const draw = (t) => {
    const g = dur > 0 ? Math.min(1, Math.max(0, t / dur)) : 1;
    const scale = 1 + PUSH * g;
    const idx = Math.min(bitmaps.length - 2, Math.floor(Math.max(0, t) / span));
    const frac = Math.min(1, Math.max(0, (t - idx * span) / span));
    const alpha = frac <= HOLD ? 0 : ease((frac - HOLD) / (1 - HOLD));
    const dw = cw * scale;
    const dh = ch * scale;
    const x = (cw - dw) / 2;
    const y = (ch - dh) / 2;
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, cw, ch);
    ctx.drawImage(bitmaps[idx], x, y, dw, dh);
    if (alpha > 0.002) {
      ctx.globalAlpha = alpha;
      ctx.drawImage(bitmaps[Math.min(idx + 1, bitmaps.length - 1)], x, y, dw, dh);
      ctx.globalAlpha = 1;
    }
  };

  try {
    const res = await encodeFrames({ canvas, fps: rate, total, draw, signal, onProgress });
    return {
      blob: res.blob,
      width: cw,
      height: ch,
      duration: dur,
      fps: rate,
      frames: res.frames,
      encoder: res.encoder,
      stills: bitmaps.length,
    };
  } finally {
    for (const b of bitmaps) {
      try {
        b.close?.();
      } catch {}
    }
  }
}
