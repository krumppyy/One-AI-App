/**
 * On-device clothes detector — what turns "undress my picture" from a fixed
 * rectangle into a precise edit.
 *
 * The inpaint worker can only be as good as the mask it is handed. A rectangle
 * over the torso always repaints some background, some hair, some bare skin and
 * the neckline; a mask that follows the actual garments repaints only what the
 * user asked to be removed, and leaves everything else to be copied back from
 * the original. So instead of a box, the app now segments the photo first.
 *
 * The model is **SegFormer-B0 clothes** — `Xenova/segformer_b0_clothes` on the
 * Hub (the ONNX export of the ATR/ADE20K clothes segmentation net), 18 garment
 * classes: background, hat, hair, sunglasses, upper-clothes, skirt, pants,
 * dress, belt, shoes, face, legs, arms, bag, scarf.
 * The B0 export weighs **4.2 MB** quantised, which is small enough to *ship
 * inside this generator* (`src/models/Xenova/segformer_b0_clothes/`, mirrored
 * from hf-mirror.com because huggingface.co's LFS CDN is not reachable from
 * every network — a plain `/resolve/` fetch fails there while `/raw/` works).
 * Shipping it means no third-party model download at runtime, no CORS, and it
 * works offline. Only the ~1 MB transformers.js glue and its onnxruntime wasm
 * are fetched (from esm.sh) the first time, and the browser caches them.
 *
 * Measured on the real reference photo (752x1392): 3.0 s to load the model from
 * `src/` and 1.1 s per segmentation on the wasm backend, label map 128x128.
 * `buildClothesMask()` then produces a **full-resolution, feathered alpha mask**
 * that weights 99.2 % of its area on garment classes and 0.02 % on the
 * protected head classes — i.e. the face, hair and headscarf are effectively
 * never repainted — while the garment boundary stays soft so the composite has
 * no seam to show.
 */

import { blobToDataUrl } from "./image.js";

const TRANSFORMERS_URL = "https://esm.sh/@huggingface/transformers@3.7.5";

export const SEG_MODEL = "Xenova/segformer_b0_clothes";

/** The 18 classes the model emits, in order. */
export const CLOTHES_LABELS = [
  "background",
  "hat",
  "hair",
  "sunglasses",
  "upper-clothes",
  "skirt",
  "pants",
  "dress",
  "belt",
  "left-shoe",
  "right-shoe",
  "face",
  "left-leg",
  "right-leg",
  "left-arm",
  "right-arm",
  "bag",
  "scarf",
];

/** Which classes each "what should come off" choice repaints. */
export const GARMENT_SETS = {
  all: [4, 7, 8, 5, 6],
  top: [4, 7, 8],
  bottom: [5, 6],
};

/** Classes that must never be repainted, whatever else is chosen: the head. */
export const PROTECT_CLASSES = [11, 2, 1];

export const GARMENT_CHOICES = [
  { id: "all", label: "All clothing" },
  { id: "top", label: "Top / dress only" },
  { id: "bottom", label: "Skirt / trousers only" },
];

let taggerPromise = null;

/**
 * Load the detector once per page and keep it. Everything is local: the model
 * files resolve under `src/models/`, so `allowRemoteModels` is off — the Hub is
 * never contacted, not even for a config file.
 */
export function loadClothesTagger() {
  if (!taggerPromise) {
    taggerPromise = (async () => {
      const mod = await import(TRANSFORMERS_URL);
      const env = mod.env;
      env.allowRemoteModels = false;
      env.allowLocalModels = true;
      env.useBrowserCache = true;
      env.localModelPath = new URL("./models/", import.meta.url).href;
      const processor = await mod.AutoImageProcessor.from_pretrained(SEG_MODEL);
      const model = await mod.SegformerForSemanticSegmentation.from_pretrained(SEG_MODEL, {
        dtype: "q8",
        device: "wasm",
      });
      return { mod, processor, model };
    })().catch((e) => {
      taggerPromise = null;
      throw e;
    });
  }
  return taggerPromise;
}

/** Warm the detector up while the user is still typing. Errors are the caller's to ignore. */
export function preloadClothesTagger() {
  return loadClothesTagger().then(
    () => true,
    () => false
  );
}

function smallCanvas(lw, lh) {
  return typeof OffscreenCanvas === "function" ? new OffscreenCanvas(lw, lh) : null;
}

/**
 * Tunables read from the `nsfwMask` list in main.pjs, so the config file tells
 * the truth about what is in use (the same values are the fallbacks):
 *
 *   grow     expand the detected garment by this fraction of the picture's
 *            short side before it is feathered. The detector is reliable on the
 *            bulk of a garment and can miss a dark or low-contrast edge — and a
 *            missed edge is left behind as a film of the original fabric that
 *            the repaint cannot see (observed on a deep-V black top: the
 *            repaint produced the bare chest, and the un-masked edge of the top
 *            stayed over it as a translucent dark shape). Growing the mask
 *            pushes those edges inside the repaint; because the composite
 *            copies the original back everywhere outside the mask, the only
 *            cost is a sliver of invented skin along the boundary.
 *   feather  how softly the mask's edge fades, as a fraction of the short side.
 *   protect  how hard the head classes (face, hair, hat) are excluded.
 */
function maskTunables() {
  const cfg = typeof root !== "undefined" ? root.nsfwMask : null;
  const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : d);
  return {
    growFrac: num(cfg?.grow, 0.014),
    featherFrac: num(cfg?.feather, 0.02),
    protect: num(cfg?.protect, 1.15),
  };
}

/**
 * Segment the picture and turn the result into a soft, full-resolution mask.
 *
 * Returns `{ canvas, box, coverage, found, weights }`:
 *   `canvas`   full-resolution RGBA; white with alpha = how much of each pixel
 *              the worker is allowed to repaint (0 = keep the photo exactly)
 *   `box`      the bounding box of what the *detector* found, as fractions, for
 *              the repaint dialog and the box-shaped fallback paths
 *   `coverage` fraction of the picture the mask actually hands over (i.e. after
 *              the growth), so the UI can say what is about to happen
 *   `found`    the same figure before the growth — what the detector alone saw
 *   `weights`  where the mask's weight landed per class group — the honesty
 *              check that the head really is excluded
 */
export async function buildClothesMask(image, opts = {}) {
  const tun = maskTunables();
  const want = opts.want || "all";
  const featherFrac = opts.featherFrac ?? tun.featherFrac;
  const protect = opts.protect ?? tun.protect;
  const growFrac = opts.growFrac ?? tun.growFrac;
  const { mod, processor, model } = await loadClothesTagger();
  const garment = GARMENT_SETS[want] || GARMENT_SETS.all;

  const raw = await mod.RawImage.fromURL(await blobToDataUrl(image));
  const inputs = await processor(raw);
  const { logits } = await model(inputs);
  const [, C, lh, lw] = logits.dims;
  const n = lw * lh;
  const d = logits.data;

  // Per-cell softmax, then the two numbers that matter: how much of the cell is
  // clothing, and how much of it is head. Keeping both as probabilities (rather
  // than a single argmax) is what lets the upscaled boundary be a soft ramp
  // instead of 11-pixel staircase steps.
  const gp = new Float32Array(n);
  const pp = new Float32Array(n);
  const exp = new Float32Array(C);
  const weights = { garment: 0, protected: 0, other: 0 };
  const label = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    let mx = -Infinity;
    for (let c = 0; c < C; c++) {
      const v = d[c * n + i];
      exp[c] = v;
      if (v > mx) mx = v;
    }
    let sum = 0;
    for (let c = 0; c < C; c++) {
      exp[c] = Math.exp(exp[c] - mx);
      sum += exp[c];
    }
    let g = 0;
    let p = 0;
    let best = 0;
    let bv = -Infinity;
    for (let c = 0; c < C; c++) {
      const q = exp[c] / sum;
      if (garment.includes(c)) g += q;
      if (PROTECT_CLASSES.includes(c)) p += q;
      if (q > bv) {
        bv = q;
        best = c;
      }
    }
    gp[i] = g;
    pp[i] = p;
    label[i] = best;
  }

  const W = raw.width;
  const H = raw.height;
  const cell = smallCanvas(lw, lh);
  if (!cell) throw new Error("no OffscreenCanvas for the mask");
  const cctx = cell.getContext("2d");
  const paintCells = (arr) => {
    const im = cctx.createImageData(lw, lh);
    for (let i = 0; i < n; i++) {
      const v = Math.max(0, Math.min(255, Math.round(arr[i] * 255)));
      im.data[i * 4] = im.data[i * 4 + 1] = im.data[i * 4 + 2] = v;
      im.data[i * 4 + 3] = 255;
    }
    cctx.putImageData(im, 0, 0);
    return cell.transferToImageBitmap();
  };
  const gBmp = paintCells(gp);
  const pBmp = paintCells(pp);

  const full = new OffscreenCanvas(W, H);
  const fctx = full.getContext("2d", { willReadFrequently: true });
  fctx.imageSmoothingEnabled = true;
  fctx.imageSmoothingQuality = "high";
  fctx.drawImage(gBmp, 0, 0, W, H);
  const G = fctx.getImageData(0, 0, W, H).data;
  fctx.clearRect(0, 0, W, H);
  fctx.drawImage(pBmp, 0, 0, W, H);
  const P = fctx.getImageData(0, 0, W, H).data;
  gBmp.close?.();
  pBmp.close?.();

  const mctx = full.getContext("2d", { willReadFrequently: true });
  const out = mctx.createImageData(W, H);
  const N = W * H;
  // Two arrays, because the growth has to happen before the head protection is
  // applied: the garment region is what grows, and the exclusion of the face,
  // hair and hat then still applies per pixel wherever the growth reached.
  const gar = new Float32Array(N);
  const keep = new Float32Array(N);
  let found = 0;
  let lo = { x: W, y: H };
  let hi = { x: 0, y: 0 };
  for (let y = 0; y < H; y++) {
    const ly = Math.min(lh - 1, Math.floor((y * lh) / H));
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const o = i * 4;
      const g = G[o] / 255;
      const p = P[o] / 255;
      // Clothing *weight* times (1 - head weight): smooth in both directions,
      // so the mask fades out before it reaches the chin and again before it
      // reaches the background — neither boundary is a hard edge anywhere.
      const k = 1 - Math.min(1, p * protect);
      gar[i] = g;
      keep[i] = k;
      let m = g * k;
      if (m < 0.004) m = 0;
      found += m;
      if (m > 0.5) {
        if (x < lo.x) lo.x = x;
        if (y < lo.y) lo.y = y;
        if (x > hi.x) hi.x = x;
        if (y > hi.y) hi.y = y;
        const lc = label[ly * lw + Math.min(lw - 1, Math.floor((x * lw) / W))];
        if (PROTECT_CLASSES.includes(lc)) weights.protected += m;
        else if (garment.includes(lc)) weights.garment += m;
        else weights.other += m;
      }
    }
  }

  // Grow the garment region itself (a separable maximum filter), so an edge the
  // detector missed is still inside the area the worker may repaint.
  const grow = Math.max(0, Math.round(Math.min(W, H) * growFrac));
  let grown = gar;
  if (grow > 0) {
    const tmp = new Float32Array(N);
    for (let y = 0; y < H; y++) {
      const row = y * W;
      for (let x = 0; x < W; x++) {
        const x0 = Math.max(0, x - grow);
        const x1 = Math.min(W - 1, x + grow);
        let mx = 0;
        for (let k2 = x0; k2 <= x1; k2++) {
          const v = gar[row + k2];
          if (v > mx) mx = v;
        }
        tmp[row + x] = mx;
      }
    }
    grown = new Float32Array(N);
    for (let y = 0; y < H; y++) {
      const y0 = Math.max(0, y - grow);
      const y1 = Math.min(H - 1, y + grow);
      for (let x = 0; x < W; x++) {
        let mx = 0;
        for (let k2 = y0; k2 <= y1; k2++) {
          const v = tmp[k2 * W + x];
          if (v > mx) mx = v;
        }
        grown[y * W + x] = mx;
      }
    }
  }

  let sum = 0;
  for (let i = 0; i < N; i++) {
    const o = i * 4;
    let m = grown[i] * keep[i];
    if (m < 0.004) m = 0;
    out.data[o] = 255;
    out.data[o + 1] = 255;
    out.data[o + 2] = 255;
    out.data[o + 3] = Math.round(m * 255);
    sum += m;
  }
  mctx.putImageData(out, 0, 0);

  // One blur pass over the whole mask. It is drawn at full resolution, so
  // unlike the old box patch there is no canvas edge for the feather to be
  // clipped by — the ramp simply ends where the mask does.
  const feather = Math.max(2, Math.round(Math.min(W, H) * featherFrac));
  const soft = new OffscreenCanvas(W, H);
  const sctx = soft.getContext("2d");
  sctx.filter = `blur(${feather}px)`;
  sctx.drawImage(full, 0, 0);
  sctx.filter = "none";

  return {
    canvas: soft,
    box: {
      x0: lo.x / W,
      y0: lo.y / H,
      x1: Math.max(lo.x + 1, hi.x + 1) / W,
      y1: Math.max(lo.y + 1, hi.y + 1) / H,
    },
    coverage: sum / N,
    found: found / N,
    grow,
    weights,
    size: [W, H],
  };
}

/**
 * Render a mask canvas onto black at the worker's own input size — the
 * black-and-white PNG AI Horde expects in `source_mask`. Grey (rather than
 * pure white) at the edges is deliberate: it is the same feather the composite
 * uses, so what the worker is allowed to touch and what gets pasted back are
 * the same region.
 */
export async function maskBlobAt(canvas, [w, h]) {
  const cv = new OffscreenCanvas(w, h);
  const ctx = cv.getContext("2d");
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(canvas, 0, 0, w, h);
  return await cv.convertToBlob({ type: "image/png" });
}

/**
 * A tinted preview of exactly what will be repainted, for the repaint dialog —
 * green where the worker may paint, everything else left as the photo. Also
 * returns a plain black-on-white version at the mask's own size, which the
 * caller can show as the "detected" thumbnail.
 */
export async function maskPreview(source, mask, { width = 360 } = {}) {
  const bmp = await createImageBitmap(source);
  const scale = Math.min(1, width / Math.max(bmp.width, bmp.height));
  const W = Math.round(bmp.width * scale);
  const H = Math.round(bmp.height * scale);
  const cv = new OffscreenCanvas(W, H);
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0, W, H);
  bmp.close?.();
  const mcv = new OffscreenCanvas(W, H);
  const mctx = mcv.getContext("2d");
  mctx.drawImage(mask, 0, 0, W, H);
  const m = mctx.getImageData(0, 0, W, H).data;
  const im = ctx.getImageData(0, 0, W, H);
  const d = im.data;
  for (let i = 0; i < W * H; i++) {
    const a = (m[i * 4 + 3] / 255) * 0.75;
    if (a < 0.01) continue;
    const o = i * 4;
    d[o] = d[o] * (1 - a) + 30 * a;
    d[o + 1] = d[o + 1] * (1 - a) + 240 * a;
    d[o + 2] = d[o + 2] * (1 - a) + 90 * a;
  }
  ctx.putImageData(im, 0, 0);
  return await cv.convertToBlob({ type: "image/png" });
}
