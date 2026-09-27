/**
 * Image helpers: everything that has to happen to a picture *before* it is
 * handed to a model.
 *
 * The one that matters for privacy is `shrinkToFit`: a reference frame has to
 * be re-encoded small enough for the relay to carry it, so that the upload goes
 * out from the relay's address instead of the visitor's. Keeping the upload
 * under the cap is what lets "never contact a model directly" hold with no
 * relay of your own configured.
 */

const MAX_DIM = 1280;
const MIN_QUALITY = 0.45;

function loadBitmap(blob) {
  if (typeof createImageBitmap === "function") return createImageBitmap(blob).catch(() => null);
  return Promise.resolve(null);
}

function toJpeg(canvas, quality) {
  return new Promise((res) => {
    try {
      canvas.toBlob((b) => res(b), "image/jpeg", quality);
    } catch {
      res(null);
    }
  });
}

/**
 * Re-encode `blob` as JPEG until it fits in `maxBytes`.
 *
 * Drops quality first (which preserves resolution, and therefore the detail the
 * model actually conditions on), then resolution. Returns the original blob
 * untouched if it is already small enough, or if this browser cannot decode it
 * (`createImageBitmap` unavailable) — the caller decides what to do then.
 */
export async function shrinkToFit(blob, maxBytes = 8_000_000, { maxDim = MAX_DIM } = {}) {
  if (!blob || !maxBytes || blob.size <= maxBytes) return blob;
  const bmp = await loadBitmap(blob);
  if (!bmp) return blob;
  const scale = Math.min(1, maxDim / Math.max(bmp.width || 1, bmp.height || 1));
  const draw = (w, h) => {
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(bmp, 0, 0, c.width, c.height);
    return c;
  };
  let canvas = draw((bmp.width || 1) * scale, (bmp.height || 1) * scale);
  let out = null;
  for (let q = 0.92; q >= MIN_QUALITY - 0.001; q -= 0.12) {
    const b = await toJpeg(canvas, q);
    if (b && b.size <= maxBytes) {
      out = b;
      break;
    }
    out = b || out;
  }
  if (!out || out.size > maxBytes) {
    for (const f of [0.7, 0.5]) {
      canvas = draw(canvas.width * f, canvas.height * f);
      const b = await toJpeg(canvas, 0.7);
      if (b) out = b;
      if (b && b.size <= maxBytes) break;
    }
  }
  if (bmp.close) {
    try {
      bmp.close();
    } catch {}
  }
  // A re-encode is only worth using if it is genuinely smaller than what we
  // started with.
  if (!out) return blob;
  return out.size < blob.size ? out : blob;
}

/** `blob` as a bare base64 string (no `data:` prefix). */
export function blobToBase64(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(",", 2)[1] || "");
    r.onerror = () => rej(new Error("could not read the image"));
    r.readAsDataURL(blob);
  });
}

export function blobToDataUrl(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(new Error("could not read the image"));
    r.readAsDataURL(blob);
  });
}

/**
 * The brightness, saturation and edge energy of a picture, measured on the same
 * 128 px box `clipMetrics` uses — so a returned clip can be compared with the
 * still the run started from and the difference means something.
 *
 *   `lum` / `sat` — mean luma and mean max-minus-min channel spread, 0–255.
 *   `detail` — mean |pixel − left neighbour| over luma, divided by 255.
 *
 * `detail` is what makes "the model returned mush" measurable: a photograph with
 * texture in it reads around 0.037 on the user's own reference, and a melted or
 * smeared render reads under half that. Returns null if the picture cannot be
 * decoded in this browser.
 */
export async function imageStats(blob, { size = 128 } = {}) {
  const bmp = await loadBitmap(blob);
  if (!bmp) return null;
  try {
    const w = Math.max(8, Math.round(size));
    const h = Math.max(8, Math.round((size * (bmp.height || 1)) / (bmp.width || 1)));
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h).data;
    const L = (p) => d[p] * 0.299 + d[p + 1] * 0.587 + d[p + 2] * 0.114;
    let lum = 0;
    let sat = 0;
    for (let p = 0; p < w * h; p++) {
      const o = p * 4;
      lum += L(o);
      sat += Math.max(d[o], d[o + 1], d[o + 2]) - Math.min(d[o], d[o + 1], d[o + 2]);
    }
    let e = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 1; x < w; x++) {
        const o = (y * w + x) * 4;
        e += Math.abs(L(o) - L(o - 4));
      }
    }
    const r4 = (v) => Math.round(v * 10000) / 10000;
    return { lum: r4(lum / (w * h)), sat: r4(sat / (w * h)), detail: r4(e / (w * h * 255)) };
  } finally {
    bmp.close?.();
  }
}

/**
 * How much two pictures differ, as `{changed, mean}`.
 *
 * `changed` is the share of pixels that differ by more than `threshold` of 255
 * on any channel after both are drawn to the same 128 px box; `mean` is the
 * mean absolute channel difference. The storyboard uses this to notice that a
 * step which was *supposed* to take a garment off produced the picture it
 * started from — a worker that refused the content, or a mask that covered
 * nothing — and re-draw it rather than building the clip around a step that
 * never happened.
 */
export async function imageChange(a, b, { size = 128, threshold = 12 } = {}) {
  const [ba, bb] = await Promise.all([loadBitmap(a), loadBitmap(b)]);
  if (!ba || !bb) return null;
  try {
    const w = size;
    const h = size;
    const draw = (bmp) => {
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(bmp, 0, 0, w, h);
      return ctx.getImageData(0, 0, w, h).data;
    };
    const A = draw(ba);
    const B = draw(bb);
    const px = w * h;
    let changed = 0;
    let sum = 0;
    for (let p = 0; p < px; p++) {
      const o = p * 4;
      const d0 = Math.abs(A[o] - B[o]);
      const d1 = Math.abs(A[o + 1] - B[o + 1]);
      const d2 = Math.abs(A[o + 2] - B[o + 2]);
      const m = Math.max(d0, d1, d2);
      sum += d0 + d1 + d2;
      if (m > threshold) changed += 1;
    }
    return {
      changed: Math.round((changed / px) * 10000) / 10000,
      mean: Math.round((sum / (px * 3)) * 10000) / 10000,
    };
  } finally {
    ba.close?.();
    bb.close?.();
  }
}

/** Decode a blob with an <img>, the one path every browser has. */
function loadImageEl(blob) {
  return new Promise((res) => {
    try {
      const img = new Image();
      const url = URL.createObjectURL(blob);
      img.onload = () => {
        URL.revokeObjectURL(url);
        res(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        res(null);
      };
      img.src = url;
    } catch {
      res(null);
    }
  });
}

/**
 * Re-encode a picture so it carries pixels and nothing else.
 *
 * A photo straight off a phone or a camera is not just a picture: it is a file
 * with an EXIF block listing the camera, the lens, the exact timestamp, often
 * the GPS coordinates, and the software that wrote it. Handing that to a model
 * (or to a relay in front of it) hands over a lot more than the picture.
 *
 * Drawing the pixels to a canvas and encoding that canvas again produces a file
 * with no metadata at all — browsers write a bare JPEG, never the source's EXIF
 * or XMP. Any browser that cannot decode the blob gets it back untouched, since
 * dropping the picture would be worse than carrying its tag.
 */
export async function stripMetadata(blob, { maxDim = MAX_DIM } = {}) {
  if (!blob) return blob;
  const src = (await loadBitmap(blob)) || (await loadImageEl(blob));
  if (!src) return blob;
  try {
    const sw = src.width || src.naturalWidth || 1;
    const sh = src.height || src.naturalHeight || 1;
    const scale = Math.min(1, maxDim / Math.max(sw, sh));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(sw * scale));
    c.height = Math.max(1, Math.round(sh * scale));
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(src, 0, 0, c.width, c.height);
    const out = await toJpeg(c, 0.94);
    return out && out.size ? out : blob;
  } catch {
    return blob;
  } finally {
    src.close?.();
  }
}
