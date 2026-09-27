import { generateImages } from "./img-engine.js";

const MP_VERSION = "0.10.14";
const MP_WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/wasm`;
const SELFIE_MODEL = "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite";

let segmenterPromise = null;

async function loadSegmenter() {
  if (!segmenterPromise) {
    segmenterPromise = (async () => {
      const mp = await import(`https://esm.sh/@mediapipe/tasks-vision@${MP_VERSION}`);
      const vision = await mp.FilesetResolver.forVisionTasks(MP_WASM);
      try {
        return await mp.ImageSegmenter.createFromOptions(vision, {
          baseOptions: { modelAssetPath: SELFIE_MODEL, delegate: "GPU" },
          outputCategoryMask: true,
          outputConfidenceMasks: false,
        });
      } catch {
        return await mp.ImageSegmenter.createFromOptions(vision, {
          baseOptions: { modelAssetPath: SELFIE_MODEL, delegate: "CPU" },
          outputCategoryMask: true,
          outputConfidenceMasks: false,
        });
      }
    })().catch((e) => { segmenterPromise = null; throw e; });
  }
  return segmenterPromise;
}

function loadImageEl(blob) {
  return new Promise((res) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    img.onload = () => { URL.revokeObjectURL(url); res(img); };
    img.onerror = () => { URL.revokeObjectURL(url); res(null); };
    img.src = url;
  });
}

export async function cutoutPerson(blob, { feather = 2 } = {}) {
  const seg = await loadSegmenter();
  const img = await loadImageEl(blob);
  if (!img) throw new Error("could not read image");
  const W = img.naturalWidth, H = img.naturalHeight;
  const res = seg.segment(img);
  const cat = res?.categoryMask;
  if (!cat) throw new Error("segmenter returned no mask");
  let raw = null;
  try { raw = cat.getAsUint8Array?.() ?? cat.getAsFloat32Array?.(); } catch {}
  if (!raw) throw new Error("unreadable segment mask");
  const mw = cat.width, mh = cat.height;
  try { cat.close?.(); } catch {}
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const cx = cv.getContext("2d");
  cx.drawImage(img, 0, 0);
  const person = new Uint8ClampedArray(mw * mh);
  for (let i = 0; i < person.length; i++) person[i] = raw[i] > 0 ? 255 : 0;
  try {
    const { boxOf } = await import("./facelock.js");
    const bmp = await createImageBitmap(blob);
    let box = null;
    try { box = await boxOf(bmp, { useModel: false }); } catch {}
    try { if (!box) box = await boxOf(bmp, { useModel: true }); } catch {}
    try { bmp.close?.(); } catch {}
    if (box) {
      const ex = (box.x + box.w / 2) * mw / W, ey = (box.y + box.h / 2) * mh / H;
      const rx = Math.max(2, box.w * mw / W * 0.4), ry = Math.max(2, box.h * mh / H * 0.4);
      let pin = 0, tot = 0;
      for (let y = Math.max(0, Math.floor(ey - ry)); y < Math.min(mh, ey + ry); y++) {
        for (let x = Math.max(0, Math.floor(ex - rx)); x < Math.min(mw, ex + rx); x++) {
          const dx = (x - ex) / rx, dy = (y - ey) / ry;
          if (dx * dx + dy * dy > 1) continue;
          tot++;
          if (person[y * mw + x]) pin++;
        }
      }
      if (tot > 10 && pin / tot < 0.5) {
        for (let i = 0; i < person.length; i++) person[i] = person[i] ? 0 : 255;
      }
    }
  } catch {}
  const mcv = document.createElement("canvas");
  mcv.width = mw; mcv.height = mh;
  const mxx = mcv.getContext("2d");
  const mid = mxx.createImageData(mw, mh);
  for (let i = 0; i < person.length; i++) {
    mid.data[i * 4] = 255; mid.data[i * 4 + 1] = 255; mid.data[i * 4 + 2] = 255;
    mid.data[i * 4 + 3] = person[i];
  }
  mxx.putImageData(mid, 0, 0);
  const msoft = document.createElement("canvas");
  msoft.width = W; msoft.height = H;
  const msx = msoft.getContext("2d");
  msx.filter = `blur(${Math.max(1, feather)}px)`;
  msx.drawImage(mcv, 0, 0, W, H);
  msx.filter = "none";
  cx.globalCompositeOperation = "destination-in";
  cx.drawImage(msoft, 0, 0);
  cx.globalCompositeOperation = "source-over";
  const cut = await new Promise((res2) => { try { cv.toBlob((b) => res2(b), "image/png"); } catch { res2(null); } });
  if (!cut) throw new Error("cutout encode failed");
  let cover = 0;
  for (let i = 0; i < person.length; i += 7) if (person[i]) cover++;
  return { blob: cut, coverage: cover / (person.length / 7) };
};

export async function generateScene(scenePrompt, { w = 768, h = 1024, seed = null, signal = null, onStage = null } = {}) {
  const sizeId = Math.max(w, h) > 900 ? "L" : "M";
  const base = seed != null && Number.isFinite(Number(seed)) ? Math.floor(Number(seed)) : Math.floor(Math.random() * 2 ** 31);
  let last = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const out = await generateImages({
      prompt: `${scenePrompt}, photorealistic, completely empty unpopulated scene with open space for a person to stand, no people, no person, no face, no body, no limbs, no text, no watermark`,
      negative: "person, people, human, face, body, limbs, hands, feet, text, watermark, logo",
      mode: "t2i", aspect: "original", sizeId, model: "auto", count: 1,
      seed: (base + attempt * 15485863) % 2 ** 31, signal,
      onStage: (i, m, msg) => onStage?.(msg),
    });
    last = out.items[0];
    try {
      const bmp = await createImageBitmap(last.blob);
      const c = document.createElement("canvas");
      const sw = 96, sh = Math.max(1, Math.round(96 * bmp.height / Math.max(1, bmp.width)));
      c.width = sw; c.height = sh;
      const x = c.getContext("2d", { willReadFrequently: true });
      x.drawImage(bmp, 0, 0, sw, sh);
      bmp.close?.();
      const dd = x.getImageData(0, 0, sw, sh).data;
      let skin = 0, n = 0;
      for (let i = 0; i < dd.length; i += 16) {
        const r = dd[i], g = dd[i + 1], b = dd[i + 2];
        const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
        const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
        if (cb > 77 && cb < 127 && cr > 133 && cr < 173 && r > 60) skin++;
        n++;
      }
      if (skin / Math.max(1, n) < 0.03) {
        try {
          const seg = await loadSegmenter();
          const simg = await loadImageEl(last.blob);
          let person = 1;
          if (simg) {
            try {
              const r2 = seg.segment(simg);
              const cat2 = r2?.categoryMask;
              const raw2 = cat2?.getAsUint8Array?.() ?? cat2?.getAsFloat32Array?.();
              if (raw2) {
                let p = 0;
                for (let i = 0; i < raw2.length; i += 13) if (!raw2[i]) p++;
                person = p / (raw2.length / 13);
              }
              try { cat2?.close?.(); } catch {}
            } catch {}
          }
          if (person < 0.04) return last;
          onStage?.(`scene had people (${Math.round(person * 100)}%) — regenerating`);
        } catch { return last; }
      } else onStage?.("scene had people — regenerating");
    } catch { return last; }
  }
  return last;
}

function statsOf(d, stride = 9) {
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < d.length; i += 4 * stride) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
  return n ? { r: r / n, g: g / n, b: b / n } : { r: 128, g: 128, b: 128 };
}

export async function compositeSubject(sceneBlob, subjectRgbaBlob, {
  subjectScale = 0, dx = 0, shadow = -1, wrap = 0.25, grain = 1,
} = {}) {
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const [scene, subj] = await Promise.all([loadImageEl(sceneBlob), loadImageEl(subjectRgbaBlob)]);
  if (!scene || !subj) throw new Error("could not read layers");
  const W = scene.naturalWidth, H = scene.naturalHeight;
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const cx = cv.getContext("2d", { willReadFrequently: true });
  cx.drawImage(scene, 0, 0);
  const base = cx.getImageData(0, 0, W, H);
  const bd = base.data;
  const lumAt = (o) => bd[o] * 0.299 + bd[o + 1] * 0.587 + bd[o + 2] * 0.114;
  const zone = (x0, y0, x1, y1) => {
    let r = 0, g = 0, b = 0, l = 0, n = 0;
    const xs = Math.max(4, ((x1 - x0) / 48) | 0), ys = Math.max(4, ((y1 - y0) / 48) | 0);
    for (let y = y0 | 0; y < y1; y += ys) {
      for (let x = x0 | 0; x < x1; x += xs) {
        const o = (y * W + x) * 4;
        r += bd[o]; g += bd[o + 1]; b += bd[o + 2]; l += lumAt(o); n++;
      }
    }
    if (!n) return { r: 128, g: 128, b: 128, lum: 128, sd: 30 };
    r /= n; g /= n; b /= n; l /= n;
    let v = 0;
    for (let y = y0 | 0; y < y1; y += ys * 2) {
      for (let x = x0 | 0; x < x1; x += xs * 2) {
        const dl = lumAt((y * W + x) * 4) - l;
        v += dl * dl;
      }
    }
    return { r, g, b, lum: l, sd: Math.sqrt(v / Math.max(1, (n / 4))) };
  };
  const leftV = zone(0, H * 0.15, W * 0.36, H * 0.95);
  const rightV = zone(W * 0.64, H * 0.15, W, H * 0.95);
  const placeDx = dx || (leftV.sd <= rightV.sd ? 0.38 : 0.62);
  const ar = subj.naturalWidth / Math.max(1, subj.naturalHeight);
  let sh = Math.round(H * (subjectScale || 0.88));
  let sw = Math.round(sh * ar);
  if (sw > W * 0.92) { sw = Math.round(W * 0.92); sh = Math.round(sw / ar); }
  const px = Math.round(W * placeDx - sw / 2), py = H - sh;
  const layer = document.createElement("canvas");
  layer.width = sw; layer.height = sh;
  const lx = layer.getContext("2d", { willReadFrequently: true });
  lx.drawImage(subj, 0, 0, sw, sh);
  const lid = lx.getImageData(0, 0, sw, sh);
  const ld = lid.data;
  let brow = 0, btot = 0;
  for (let x = 0; x < sw; x += 2) if (ld[((sh - 1) * sw + x) * 4 + 3] > 128) brow++;
  btot = Math.ceil(sw / 2);
  const bustCrop = brow / Math.max(1, btot) > 0.5;
  const zx0 = Math.max(0, px), zy0 = Math.max(0, py);
  const zx1 = Math.min(W, px + sw), zy1 = Math.min(H, py + sh);
  const z = zone(zx0, zy0, zx1, zy1);
  let sr = 0, sg = 0, sb = 0, sl = 0, sn = 0;
  for (let i = 0; i < ld.length; i += 20) {
    if (ld[i + 3] < 128) continue;
    sr += ld[i]; sg += ld[i + 1]; sb += ld[i + 2];
    sl += ld[i] * 0.299 + ld[i + 1] * 0.587 + ld[i + 2] * 0.114;
    sn++;
  }
  sr /= Math.max(1, sn); sg /= Math.max(1, sn); sb /= Math.max(1, sn); sl /= Math.max(1, sn);
  let sv = 0;
  for (let i = 0; i < ld.length; i += 80) {
    if (ld[i + 3] < 128) continue;
    const dl = (ld[i] * 0.299 + ld[i + 1] * 0.587 + ld[i + 2] * 0.114) - sl;
    sv += dl * dl;
  }
  const ssd = Math.sqrt(sv / Math.max(1, sn / 4));
  const gain = clamp((z.lum + 40) / (sl + 40), 0.75, 1.3);
  const cratio = clamp(z.sd / Math.max(8, ssd), 0.6, 1.5);
  const t = clamp(((z.r - z.b) - (sr - sb)) / 512, -0.06, 0.06);
  for (let i = 0; i < ld.length; i += 4) {
    if (ld[i + 3] < 8) continue;
    const l = ld[i] * 0.299 + ld[i + 1] * 0.587 + ld[i + 2] * 0.114;
    const dodge = (1 - l / 255) * (z.lum - sl) / 255 * 0.4;
    const burn = (l / 255) * (sl - z.lum) / 255 * 0.25;
    ld[i] = (((ld[i] - sr) * cratio + sr) * gain + (z.r - sr) * 0.15 + (dodge - burn) * 255) * (1 + t);
    ld[i + 1] = ((ld[i + 1] - sg) * cratio + sg) * gain + (z.g - sg) * 0.15 + (dodge - burn) * 255;
    ld[i + 2] = (((ld[i + 2] - sb) * cratio + sb) * gain + (z.b - sb) * 0.15 + (dodge - burn) * 255) * (1 - t);
  }
  lx.putImageData(lid, 0, 0);
  const sharp = document.createElement("canvas");
  sharp.width = sw; sharp.height = sh;
  const hx = sharp.getContext("2d");
  hx.filter = "blur(1.5px)";
  hx.drawImage(layer, 0, 0);
  hx.filter = "none";
  const hd = hx.getImageData(0, 0, sw, sh).data;
  const cur = lx.getImageData(0, 0, sw, sh);
  const cd = cur.data;
  for (let i = 0; i < cd.length; i += 4) {
    if (cd[i + 3] < 8) continue;
    for (let c = 0; c < 3; c++) cd[i + c] += (cd[i + c] - hd[i + c]) * 0.2;
  }
  lx.putImageData(cur, 0, 0);
  let bg = 0, bd2 = 255, bbx = 0.5, bby = 0;
  for (let gy = 0; gy < 6; gy++) {
    for (let gx = 0; gx < 8; gx++) {
      const o = ((((gy * H / 6) | 0) * W) + ((gx * W / 8) | 0)) * 4;
      const l = lumAt(o);
      if (l > bg) { bg = l; bbx = gx / 7; bby = gy / 5; }
      if (l < bd2) bd2 = l;
    }
  }
  const contrast = (bg - bd2) / 255;
  const autoShadow = shadow < 0 ? clamp(0.12 + contrast * 0.5, 0.12, 0.45) * (bustCrop ? 0.6 : 1) : shadow;
  if (autoShadow > 0.01) {
    const ox = Math.round((0.5 - bbx) * sw * 0.3);
    const shw = document.createElement("canvas");
    shw.width = W; shw.height = H;
    const shx = shw.getContext("2d");
    shx.fillStyle = `rgba(0,0,0,${autoShadow})`;
    shx.beginPath();
    shx.ellipse(px + sw / 2 + ox, py + sh - sh * 0.015, sw * 0.3, Math.max(4, sh * 0.03), 0, 0, Math.PI * 2);
    shx.fill();
    shx.filter = "blur(14px)";
    shx.drawImage(shw, 0, 0);
    shx.filter = "none";
    cx.drawImage(shw, 0, 0);
  }
  cx.drawImage(layer, px, py, sw, sh);
  if (wrap > 0) {
    const ring = document.createElement("canvas");
    ring.width = W; ring.height = H;
    const gx = ring.getContext("2d");
    gx.drawImage(layer, px, py, sw, sh);
    gx.globalCompositeOperation = "destination-out";
    gx.drawImage(layer, px + 3, py + 3, sw - 6, sh - 6);
    gx.globalCompositeOperation = "source-over";
    gx.globalAlpha = wrap * 0.5;
    gx.fillStyle = `rgb(${z.r | 0},${z.g | 0},${z.b | 0})`;
    gx.globalCompositeOperation = "source-atop";
    gx.fillRect(0, 0, W, H);
    gx.globalCompositeOperation = "source-over";
    gx.globalAlpha = 1;
    cx.drawImage(ring, 0, 0);
  }
  if (grain > 0) {
    const id2 = cx.getImageData(0, 0, W, H);
    const dd = id2.data;
    for (let i = 0; i < dd.length; i += 4) {
      const n = (Math.random() - 0.5) * 2 * grain;
      dd[i] += n; dd[i + 1] += n; dd[i + 2] += n;
    }
    cx.putImageData(id2, 0, 0);
  }
  const out = await new Promise((res) => { try { cv.toBlob((b) => res(b), "image/jpeg", 0.93); } catch { res(null); } });
  if (!out) throw new Error("composite encode failed");
  return { blob: out, url: URL.createObjectURL(out), w: W, h: H, placeDx, bustCrop, shadow: autoShadow };
};

export async function blendJob({
  refBlob, preset = null, basePrompt = "upper body portrait",
  scenePrompt = "green park, trees softly blurred, natural daylight",
  model = "auto", nsfw = false, sizeId = "S", seed = null, signal = null, onStage = null,
}) {
  const { aiEdit } = await import("./sdxl-ai.js");
  const { surfacePass } = await import("./detail.js");
  onStage?.("look", "generating new pose and outfit");
  const look = await aiEdit({
    refBlob, basePrompt, preset: preset || { id: "custom", prompt: "new pose, new dress", strength: 0.7, env: "same" },
    aspect: "original", sizeId, model, nsfw, seed, signal,
    onStage: (r, a, m) => onStage?.("look", `${r} ${m}`),
  });
  onStage?.("cutout", "cutting out subject");
  const cut = await cutoutPerson(look.blob);
  onStage?.("scene", "generating scene");
  const scene = await generateScene(scenePrompt, { seed: (Number(seed) || 0) + 17, signal, onStage: (m) => onStage?.("scene", m) });
  onStage?.("blend", "burn, dodge, shadow, grain");
  const comp = await compositeSubject(scene.blob, cut.blob, {});
  let finalBlob = comp.blob;
  try {
    const sur = await surfacePass(comp.blob);
    if (sur.applied && sur.blob) finalBlob = sur.blob;
  } catch {}
  return {
    blob: finalBlob, url: URL.createObjectURL(finalBlob),
    w: comp.w, h: comp.h,
    by: `${look.by} → composite · subject ${(cut.coverage * 100) | 0}%`,
    look, scene: { url: scene.url, by: scene.by },
  };
}
