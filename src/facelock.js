import { autoRetouchCanvas, autoGradeCanvas } from "./retouch.js";

let det = null;
let detChecked = false;
let modelPromise = null;
function loadModel() {
  if (!modelPromise) {
    modelPromise = (async () => {
      const [bzmod, tfmod] = await Promise.all([
        import("https://esm.sh/@tensorflow-models/blazeface@0.0.7"),
        import("https://esm.sh/@tensorflow/tfjs@4.22.0"),
      ]);
      const blazeface = bzmod.default || bzmod;
      const tf = tfmod.default || tfmod;
      await tf?.ready?.();
      return (await blazeface.load()) || null;
    })().catch(() => null);
  }
  return modelPromise;
}
function native() {
  if (!detChecked) {
    detChecked = true;
    try {
      if (typeof window !== "undefined" && "FaceDetector" in window) det = new window.FaceDetector({ fastMode: true, maxDetectedFaces: 1 });
    } catch { det = null; }
  }
  return det;
}
export async function boxOf(img, { useModel = true } = {}) {
  const d = native();
  if (d) {
    try {
      const f = await d.detect(img);
      const b = f?.[0]?.boundingBox;
      if (b) return { x: b.x, y: b.y, w: b.width, h: b.height };
    } catch {}
  }
  if (!useModel) return null;
  try {
    const model = await loadModel();
    if (!model) return null;
    const faces = await model.estimateFaces(img, false);
    const num = (p) => (Array.isArray(p) ? +p[0] : +p);
    const f = (faces || []).slice().sort((a, b) => num(b?.probability ?? 0) - num(a?.probability ?? 0))[0];
    if (!f || !(num(f.probability ?? 1) >= 0.5)) return null;
    const tl = f.topLeft || [0, 0], br = f.bottomRight || [0, 0];
    return { x: +tl[0], y: +tl[1], w: +br[0] - +tl[0], h: +br[1] - +tl[1] };
  } catch { return null; }
}
function bmp(blob) {
  return createImageBitmap(blob);
}
export async function landmarksOf(img, useModel) {
  if (!useModel) return null;
  try {
    const model = await loadModel();
    if (!model) return null;
    const faces = await model.estimateFaces(img, false);
    const num = (p) => (Array.isArray(p) ? +p[0] : +p);
    const f = (faces || []).slice().sort((a, b) => num(b?.probability ?? 0) - num(a?.probability ?? 0))[0];
    if (!f || !(num(f.probability ?? 1) >= 0.5) || !Array.isArray(f.landmarks) || f.landmarks.length < 4) return null;
    const P = (l) => ({ x: +l[0], y: +l[1] });
    return { rightEye: P(f.landmarks[0]), leftEye: P(f.landmarks[1]), nose: P(f.landmarks[2]), mouth: P(f.landmarks[3]), imgW: img.width, imgH: img.height };
  } catch { return null; }
}
function padBox(b, W, H, pad = 0.2) {
  const x0 = Math.max(0, b.x - b.w * pad), y0 = Math.max(0, b.y - b.h * pad);
  const x1 = Math.min(W, b.x + b.w * (1 + pad * 2)), y1 = Math.min(H, b.y + b.h * (1 + pad * 2));
  return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
}
function eyeCrop(lm) {
  const mx = (lm.rightEye.x + lm.leftEye.x) / 2, my = (lm.rightEye.y + lm.leftEye.y) / 2;
  const d = Math.hypot(lm.rightEye.x - lm.leftEye.x, lm.rightEye.y - lm.leftEye.y);
  if (!(d > 4)) return null;
  const s = d * 2.6;
  return { x: mx - s / 2, y: my - s * 0.42, s };
}
export async function faceScore(refBlob, outBlob, opts = {}) {
  try {
    const [rb, ob] = await Promise.all([bmp(refBlob), bmp(outBlob)]);
    try {
      const S = 64;
      const rc = document.createElement("canvas"), oc = document.createElement("canvas");
      rc.width = S; rc.height = S; oc.width = S; oc.height = S;
      const r = rc.getContext("2d", { willReadFrequently: true }), o = oc.getContext("2d", { willReadFrequently: true });
      const useModel = opts.useModel !== false;
      const [rl, ol] = await Promise.all([landmarksOf(rb, useModel), landmarksOf(ob, useModel)]);
      const re = rl && eyeCrop(rl), oe = ol && eyeCrop(ol);
      let faceFound;
      if (re && oe) {
        const draw = (ctx2, img, c) => {
          const sx = Math.max(0, c.x), sy = Math.max(0, c.y);
          ctx2.drawImage(img, sx, sy, Math.min(c.s, img.width - sx), Math.min(c.s, img.height - sy), 0, 0, S, S);
        };
        draw(r, rb, re); draw(o, ob, oe);
        faceFound = "eyes";
      } else {
        const ri = await boxOf(rb, opts), oi = await boxOf(ob, opts);
        if (ri && oi) {
          const rp = padBox(ri, rb.width, rb.height), op = padBox(oi, ob.width, ob.height);
          r.drawImage(rb, rp.x, rp.y, rp.w, rp.h, 0, 0, S, S);
          o.drawImage(ob, op.x, op.y, op.w, op.h, 0, 0, S, S);
        } else {
          r.drawImage(rb, 0, 0, rb.width, rb.height, 0, 0, S, S);
          o.drawImage(ob, 0, 0, ob.width, ob.height, 0, 0, S, S);
        }
        faceFound = !!(ri && oi);
      }
      const A = r.getImageData(0, 0, S, S).data, B = o.getImageData(0, 0, S, S).data;
      const ga = new Float32Array(S * S), gb = new Float32Array(S * S);
      let ma = 0, mb = 0;
      for (let i = 0; i < S * S; i++) {
        const p = i * 4;
        ga[i] = A[p] * 0.299 + A[p + 1] * 0.587 + A[p + 2] * 0.114;
        gb[i] = B[p] * 0.299 + B[p + 1] * 0.587 + B[p + 2] * 0.114;
        ma += ga[i]; mb += gb[i];
      }
      ma /= S * S; mb /= S * S;
      let cov = 0, va = 0, vb = 0;
      for (let i = 0; i < S * S; i++) {
        const da = ga[i] - ma, db = gb[i] - mb;
        cov += da * db; va += da * da; vb += db * db;
      }
      const rho = cov / Math.max(1e-9, Math.sqrt(va * vb));
      const score = Math.max(0, Math.min(100, Math.round(((rho - 0.65) / 0.35) * 100)));
      return { score, mean: Math.round(rho * 1000) / 1000, faceFound };
    } finally { rb.close?.(); ob.close?.(); }
  } catch { return null; }
}
function concealRing(cv, gp) {
  const W = cv.width, H = cv.height;
  const cx0 = gp.x + gp.w / 2, cy0 = gp.y + gp.h / 2;
  const base = Math.max(gp.w, gp.h);
  const rIn = base * 0.32, rOut = base * 0.6;
  const ring = document.createElement("canvas");
  ring.width = W; ring.height = H;
  const rx = ring.getContext("2d");
  const gg = rx.createRadialGradient(cx0, cy0, rIn, cx0, cy0, rOut);
  gg.addColorStop(0, "rgba(0,0,0,0)");
  gg.addColorStop(0.55, "rgba(0,0,0,0)");
  gg.addColorStop(0.78, "rgba(255,255,255,1)");
  gg.addColorStop(1, "rgba(0,0,0,0)");
  rx.fillStyle = gg;
  rx.beginPath(); rx.ellipse(cx0, cy0, rOut, rOut * (gp.h / Math.max(1, gp.w)), 0, 0, Math.PI * 2); rx.fill();
  const soft = document.createElement("canvas");
  soft.width = W; soft.height = H;
  const sx = soft.getContext("2d");
  sx.filter = "blur(" + Math.max(2, Math.round(gp.w * 0.022)) + "px)";
  sx.drawImage(cv, 0, 0);
  sx.filter = "none";
  sx.globalCompositeOperation = "destination-in";
  sx.drawImage(ring, 0, 0);
  sx.globalCompositeOperation = "source-over";
  const cx = cv.getContext("2d");
  cx.drawImage(soft, 0, 0);
  try {
    const x0 = Math.max(0, Math.floor(cx0 - rOut)), y0 = Math.max(0, Math.floor(cy0 - rOut));
    const ww = Math.min(W - x0, Math.ceil(rOut * 2)), hh = Math.min(H - y0, Math.ceil(rOut * 2));
    if (ww > 8 && hh > 8) {
      const id = cx.getImageData(x0, y0, ww, hh);
      const d = id.data;
      let v = 0;
      for (let i = 0; i < d.length; i += 16) v += Math.abs(d[i] - d[i + 1]) + Math.abs(d[i + 1] - d[i + 2]);
      const spread = v / (d.length / 16) / 255;
      const amt = Math.min(1.6, Math.max(0.4, spread * 10));
      const ex = gp.x + gp.w / 2, ey = gp.y + gp.h / 2;
      for (let y = 0; y < hh; y++) {
        for (let x = 0; x < ww; x++) {
          const dx = (x0 + x - ex) / Math.max(1, gp.w * 0.5), dy = (y0 + y - ey) / Math.max(1, gp.h * 0.5);
          if (dx * dx + dy * dy < 0.6) continue;
          const o = (y * ww + x) * 4;
          const n = (Math.random() - 0.5) * 2 * amt;
          d[o] += n; d[o + 1] += n; d[o + 2] += n;
        }
      }
      cx.putImageData(id, x0, y0);
    }
  } catch {}
}
export async function fixSeam(blob) {
  let bm;
  try { bm = await bmp(blob); }
  catch { return { blob, applied: false }; }
  try {
    const rr = await boxOf(bm, { useModel: true });
    if (!rr) { bm.close?.(); return { blob, applied: false, reason: "no-face" }; }
    const gp = padBox(rr, bm.width, bm.height, 0.25);
    const cv = document.createElement("canvas");
    cv.width = bm.width; cv.height = bm.height;
    cv.getContext("2d").drawImage(bm, 0, 0);
    bm.close?.();
    concealRing(cv, gp);
    try { autoRetouchCanvas(cv, gp); } catch {}
    const out = await new Promise((res) => { try { cv.toBlob((b) => res(b), "image/jpeg", 0.94); } catch { res(null); } });
    if (!out || !out.size) return { blob, applied: false };
    return { blob: out, applied: true };
  } catch { try { bm?.close?.(); } catch {} return { blob, applied: false }; }
}
export async function faceBlend(refBlob, genBlob, { strength = 0.85, feather = 15, useModel = true, seamFix = true } = {}) {
  const before = await faceScore(refBlob, genBlob);
  let rb, gb;
  try { [rb, gb] = await Promise.all([bmp(refBlob), bmp(genBlob)]); }
  catch { return { blob: genBlob, ...before, applied: false }; }
  try {
    const W = gb.width, H = gb.height;
    const rr = await boxOf(rb, { useModel }), gr = await boxOf(gb, { useModel });
    if (!rr || !gr) { rb.close?.(); gb.close?.(); return { blob: genBlob, ...before, applied: false, reason: "no-face" }; }
    const rp = padBox(rr, rb.width, rb.height, 0.15), gp = padBox(gr, W, H, 0.18);
    const cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    const cx = cv.getContext("2d");
    cx.drawImage(gb, 0, 0);
    const face = document.createElement("canvas");
    face.width = Math.max(1, Math.round(gp.w)); face.height = Math.max(1, Math.round(gp.h));
    const fx = face.getContext("2d", { willReadFrequently: true });
    fx.drawImage(rb, rp.x, rp.y, rp.w, rp.h, 0, 0, face.width, face.height);
    try {
      const tone = document.createElement("canvas");
      tone.width = face.width; tone.height = face.height;
      const tx2 = tone.getContext("2d", { willReadFrequently: true });
      tx2.drawImage(gb, gp.x, gp.y, gp.w, gp.h, 0, 0, face.width, face.height);
      const stats = (ctx2) => {
        const x0 = Math.floor(face.width * 0.2), y0 = Math.floor(face.height * 0.2);
        const ww = Math.ceil(face.width * 0.6), hh = Math.ceil(face.height * 0.6);
        const d = ctx2.getImageData(x0, y0, ww, hh).data;
        const n = ww * hh;
        let mr = 0, mg = 0, mb = 0;
        for (let i = 0; i < d.length; i += 4) { mr += d[i]; mg += d[i + 1]; mb += d[i + 2]; }
        mr /= n; mg /= n; mb /= n;
        let sr = 0, sg = 0, sb = 0;
        for (let i = 0; i < d.length; i += 4) { sr += (d[i] - mr) ** 2; sg += (d[i + 1] - mg) ** 2; sb += (d[i + 2] - mb) ** 2; }
        return { m: [mr, mg, mb], s: [Math.sqrt(sr / n), Math.sqrt(sg / n), Math.sqrt(sb / n)] };
      };
      const T = stats(tx2), F = stats(fx);
      const gain = [0, 1, 2].map((k) => {
        const g = T.s[k] / Math.max(6, F.s[k]);
        return Math.min(2, Math.max(0.45, g));
      });
      const id = fx.getImageData(0, 0, face.width, face.height);
      const dd = id.data;
      for (let i = 0; i < dd.length; i += 4) {
        dd[i] = (dd[i] - F.m[0]) * gain[0] + T.m[0];
        dd[i + 1] = (dd[i + 1] - F.m[1]) * gain[1] + T.m[1];
        dd[i + 2] = (dd[i + 2] - F.m[2]) * gain[2] + T.m[2];
      }
      fx.putImageData(id, 0, 0);
    } catch {}
    const mask = document.createElement("canvas");
    mask.width = face.width; mask.height = face.height;
    const mx = mask.getContext("2d");
    const g = mx.createRadialGradient(face.width / 2, face.height / 2, Math.min(face.width, face.height) * 0.28, face.width / 2, face.height / 2, Math.max(face.width, face.height) * 0.52);
    g.addColorStop(0, "rgba(0,0,0,1)"); g.addColorStop(0.78, "rgba(0,0,0,1)"); g.addColorStop(1, "rgba(0,0,0,0)");
    mx.fillStyle = g;
    mx.beginPath(); mx.ellipse(face.width / 2, face.height / 2, face.width * 0.43, face.height * 0.43, 0, 0, Math.PI * 2); mx.fill();
    const tmp = document.createElement("canvas");
    tmp.width = face.width; tmp.height = face.height;
    const tx = tmp.getContext("2d");
    tx.drawImage(face, 0, 0);
    tx.globalCompositeOperation = "destination-in";
    tx.drawImage(mask, 0, 0);
    cx.save();
    cx.globalAlpha = Math.min(1, Math.max(0, strength));
    cx.drawImage(tmp, gp.x, gp.y, gp.w, gp.h);
    cx.restore();
    cx.save();
    cx.beginPath(); cx.ellipse(gp.x + gp.w / 2, gp.y + gp.h / 2, gp.w * 0.18, gp.h * 0.19, 0, 0, Math.PI * 2); cx.clip();
    cx.globalAlpha = Math.min(1, Math.max(0, strength));
    cx.drawImage(face, face.width * 0.24, face.height * 0.22, face.width * 0.52, face.height * 0.56, gp.x + gp.w * 0.24, gp.y + gp.h * 0.22, gp.w * 0.52, gp.h * 0.56);
    cx.restore();
    if (seamFix !== false) {
      try { concealRing(cv, gp); } catch {}
      try { autoRetouchCanvas(cv, gp); } catch {}
    }

    const blob = await new Promise((res) => { try { cv.toBlob((b) => res(b), "image/jpeg", 0.94); } catch { res(null); } });
    rb.close?.(); gb.close?.();
    if (!blob || !blob.size) return { blob: genBlob, ...before, applied: false };
    const after = await faceScore(refBlob, blob);
    return { blob, before: before?.score ?? null, score: after?.score ?? null, mean: after?.mean ?? null, applied: true, faceFound: true };
  } catch { try { rb?.close?.(); gb?.close?.(); } catch {} return { blob: genBlob, ...before, applied: false }; }
}
