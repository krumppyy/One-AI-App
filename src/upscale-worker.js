let pipe = null;

async function ensurePipe(report) {
  if (pipe) return pipe;
  const mod = await import("https://esm.sh/@huggingface/transformers@3.5.1");
  const ids = ["Xenova/swin2SR-classical-sr-x2-64", "Xenova/swin2SR-lightweight-x2-64"];
  let lastErr = null;
  for (const id of ids) {
    try {
      report({ type: "progress", p: 0.05 });
      pipe = await mod.pipeline("image-to-image", id, {
        progress_callback: (ev) => {
          if (ev && ev.status === "progress" && Number.isFinite(ev.progress)) {
            report({ type: "progress", p: 0.05 + 0.75 * Math.min(1, ev.progress / 100) });
          }
        },
      });
      pipe._upId = id;
      return pipe;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("ai model failed to load");
}

const TILE = 384;
const PAD = 16;
const SINGLE_LIMIT = 768;

function planTiles(w, h) {
  const tiles = [];
  for (let y = 0; y < h; y += TILE) {
    for (let x = 0; x < w; x += TILE) {
      const cx1 = Math.min(w, x + TILE);
      const cy1 = Math.min(h, y + TILE);
      const x0 = x > 0 ? x - PAD : x;
      const y0 = y > 0 ? y - PAD : y;
      const x1 = cx1 < w ? cx1 + PAD : cx1;
      const y1 = cy1 < h ? cy1 + PAD : cy1;
      tiles.push({ x0, y0, x1, y1, cx0: x, cy0: y, cx1, cy1 });
    }
  }
  return tiles;
}

async function outToBlob(out) {
  const first = Array.isArray(out) ? out[0] : out;
  const url = first?.url || out?.url;
  if (url) return await (await fetch(url)).blob();
  if (first && Number.isFinite(first.width) && Number.isFinite(first.height) && first.data) {
    const w = first.width, h = first.height;
    const raw = first.data;
    const rgba = new Uint8ClampedArray(w * h * 4);
    if (first.channels === 4) {
      rgba.set(raw.subarray ? raw.subarray(0, w * h * 4) : raw.slice(0, w * h * 4));
    } else {
      const ch = first.channels === 1 ? 1 : 3;
      for (let i = 0, j = 0; i < w * h; i++, j += 4) {
        rgba[j] = raw[i * ch];
        rgba[j + 1] = ch > 1 ? raw[i * ch + 1] : raw[i * ch];
        rgba[j + 2] = ch > 2 ? raw[i * ch + 2] : raw[i * ch];
        rgba[j + 3] = 255;
      }
    }
    const oc = new OffscreenCanvas(w, h);
    oc.getContext("2d").putImageData(new ImageData(rgba, w, h), 0, 0);
    return await oc.convertToBlob({ type: "image/png" });
  }
  if (first && typeof first.toDataURL === "function") {
    return await (await fetch(first.toDataURL("image/png"))).blob();
  }
  throw new Error("ai returned nothing usable");
}

async function runSingle(p, canvas, report) {
  report({ type: "progress", p: 0.85 });
  const out = await p(canvas);
  const blob = await outToBlob(out);
  if (!blob || !blob.size) throw new Error("ai returned an empty file");
  return blob;
}

async function runTiled(p, bmp, report) {
  const w = bmp.width, h = bmp.height;
  const tiles = planTiles(w, h);
  const full = new OffscreenCanvas(w * 2, h * 2);
  const fctx = full.getContext("2d");
  for (let i = 0; i < tiles.length; i++) {
    const t = tiles[i];
    const tw = t.x1 - t.x0, th = t.y1 - t.y0;
    const tc = new OffscreenCanvas(tw, th);
    tc.getContext("2d").drawImage(bmp, t.x0, t.y0, tw, th, 0, 0, tw, th);
    const out = await p(tc);
    const blob = await outToBlob(out);
    if (!blob || !blob.size) throw new Error("ai returned an empty file");
    const tb = await createImageBitmap(blob);
    try {
      const kx = tb.width / tw, ky = tb.height / th;
      const sx = (t.cx0 - t.x0) * kx, sy = (t.cy0 - t.y0) * ky;
      const sw = (t.cx1 - t.cx0) * kx, sh = (t.cy1 - t.cy0) * ky;
      fctx.drawImage(tb, sx, sy, sw, sh, t.cx0 * 2, t.cy0 * 2, (t.cx1 - t.cx0) * 2, (t.cy1 - t.cy0) * 2);
    } finally {
      tb.close?.();
    }
    report({ type: "progress", p: 0.8 + (0.17 * (i + 1)) / tiles.length });
  }
  return await full.convertToBlob({ type: "image/png" });
}

self.onmessage = async (e) => {
  const { id, dataUrl, ping } = e.data || {};
  if (ping) { self.postMessage({ job: id, type: "pong" }); return; }
  const report = (m) => self.postMessage({ job: id, ...m });
  try {
    const p = await ensurePipe(report);
    const bmp = await createImageBitmap(await (await fetch(dataUrl)).blob());
    let blob = null;
    try {
      if (Math.max(bmp.width, bmp.height) <= SINGLE_LIMIT) {
        const c = new OffscreenCanvas(bmp.width, bmp.height);
        c.getContext("2d").drawImage(bmp, 0, 0);
        blob = await runSingle(p, c, report);
      } else {
        blob = await runTiled(p, bmp, report);
      }
    } finally {
      bmp.close?.();
    }
    if (!blob || !blob.size) throw new Error("ai returned an empty file");
    report({ type: "progress", p: 0.97 });
    self.postMessage({ job: id, type: "done", blob });
  } catch (err) {
    self.postMessage({ job: id, type: "error", message: String((err && err.message) || err) });
  }
};
