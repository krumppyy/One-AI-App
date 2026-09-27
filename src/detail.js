import { boxOf, landmarksOf } from "./facelock.js";

function ctx2d(cv) {
  return cv.getContext("2d", { willReadFrequently: true });
}

function bitmapOf(blob) {
  return createImageBitmap(blob);
}

function skinAt(d, o) {
  const r = d[o], g = d[o + 1], b = d[o + 2];
  const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
  const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
  return cb > 77 && cb < 127 && cr > 133 && cr < 173 && r > 60;
}

function gradEnergy(d, ww, x0, y0, w, h) {
  let sum = 0, n = 0;
  for (let y = y0 + 1; y < y0 + h - 1; y++) {
    for (let x = x0 + 1; x < x0 + w - 1; x++) {
      const o = (y * ww + x) * 4;
      const gx = Math.abs(d[o] - d[o + 4]) + Math.abs(d[o] - d[o - 4]);
      const gy = Math.abs(d[o] - d[o + ww * 4]) + Math.abs(d[o] - d[o - ww * 4]);
      sum += gx + gy; n++;
    }
  }
  return n ? sum / n / 3 : 0;
}

export async function eyeMetrics(blob) {
  let bm;
  try { bm = await bitmapOf(blob); } catch { return null; }
  try {
    const lm = await landmarksOf(bm, true);
    if (!lm) { bm.close?.(); return null; }
    const S = 96;
    const cv = document.createElement("canvas");
    cv.width = S * 2; cv.height = S;
    const cx = ctx2d(cv);
    const dEye = Math.max(8, Math.hypot(lm.rightEye.x - lm.leftEye.x, lm.rightEye.y - lm.leftEye.y));
    const draw = (ex, ey, dx) => {
      const s = dEye * 1.1;
      cx.drawImage(bm, ex - s / 2, ey - s / 2, s, s, dx, 0, S, S);
    };
    draw(lm.leftEye.x, lm.leftEye.y, 0);
    draw(lm.rightEye.x, lm.rightEye.y, S);
    const id = cx.getImageData(0, 0, S * 2, S).data;
    const l = gradEnergy(id, S * 2, 4, 4, S - 8, S - 8);
    const r = gradEnergy(id, S * 2, S + 4, 4, S - 8, S - 8);
    let bl = 0, br = 0;
    for (let i = 0; i < S * S; i++) { bl += id[i * 4]; br += id[(S * S + i) * 4]; }
    bl /= S * S; br /= S * S;
    return {
      sharp: Math.round(((l + r) / 2) * 10) / 10,
      sym: Math.round((1 - Math.abs(l - r) / Math.max(1, l + r)) * 100) / 100,
      tone: Math.round((1 - Math.abs(bl - br) / Math.max(1, bl + br)) * 100) / 100,
    };
  } catch { return null; }
  finally { try { bm.close?.(); } catch {} }
}

export async function detailPass(blob, { eyes = true, nose = true, limbs = true } = {}) {
  let bm;
  try { bm = await bitmapOf(blob); } catch { return { blob, applied: false }; }
  try {
    const W = bm.width, H = bm.height;
    const cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    const cx = ctx2d(cv);
    cx.drawImage(bm, 0, 0);
    const box = await boxOf(bm, { useModel: true }).catch(() => null);
    const lm = await landmarksOf(bm, true).catch(() => null);
    bm.close?.();
    const sharpBox = (x, y, w, h, amt) => {
      x = Math.max(0, Math.floor(x)); y = Math.max(0, Math.floor(y));
      w = Math.min(W - x, Math.ceil(w)); h = Math.min(H - y, Math.ceil(h));
      if (w < 6 || h < 6) return;
      const tmp = document.createElement("canvas");
      tmp.width = w; tmp.height = h;
      const tx = tmp.getContext("2d");
      tx.drawImage(cv, x, y, w, h, 0, 0, w, h);
      tx.filter = `blur(${Math.max(1, Math.round(w * 0.02))}px)`;
      tx.drawImage(tmp, 0, 0);
      tx.filter = "none";
      const soft = tx.getImageData(0, 0, w, h).data;
      const id = cx.getImageData(x, y, w, h);
      const d = id.data;
      for (let i = 0; i < d.length; i += 4) {
        for (let c = 0; c < 3; c++) d[i + c] += (d[i + c] - soft[i + c]) * amt;
      }
      cx.putImageData(id, x, y);
    };
    if (lm && box) {
      const fw = Math.max(20, box.w);
      if (eyes) {
        const s = fw * 0.42;
        sharpBox(lm.leftEye.x - s / 2, lm.leftEye.y - s / 2, s, s, 0.28);
        sharpBox(lm.rightEye.x - s / 2, lm.rightEye.y - s / 2, s, s, 0.28);
      }
      if (nose && lm.nose) {
        const nw = fw * 0.3, nh = fw * 0.5;
        sharpBox(lm.nose.x - nw / 2, lm.nose.y - nh * 0.25, nw, nh, 0.18);
      }
    }
    if (limbs) {
      const id = cx.getImageData(0, 0, W, H);
      const d = id.data, N = W * H;
      const bl = document.createElement("canvas");
      bl.width = W; bl.height = H;
      const bx = bl.getContext("2d");
      bx.filter = "blur(6px)";
      bx.drawImage(cv, 0, 0);
      bx.filter = "none";
      const bd = bx.getImageData(0, 0, W, H).data;
      const inFace = (x, y) => {
        if (!box) return false;
        const dx = (x - (box.x + box.w / 2)) / (box.w * 0.75);
        const dy = (y - (box.y + box.h / 2)) / (box.h * 0.75);
        return dx * dx + dy * dy < 1;
      };
      for (let i = 0; i < N; i += 1) {
        const o = i * 4;
        if (!skinAt(d, o)) continue;
        const x = i % W, y = (i / W) | 0;
        if (inFace(x, y)) continue;
        const hf = (Math.abs(d[o] - bd[o]) + Math.abs(d[o + 1] - bd[o + 1]) + Math.abs(d[o + 2] - bd[o + 2])) / 3;
        if (hf > 42) {
          const k = Math.min(0.7, (hf - 42) / 60 + 0.3);
          d[o] += (bd[o] - d[o]) * k;
          d[o + 1] += (bd[o + 1] - d[o + 1]) * k;
          d[o + 2] += (bd[o + 2] - d[o + 2]) * k;
        }
      }
      cx.putImageData(id, 0, 0);
    }
    const out = await new Promise((res) => { try { cv.toBlob((b) => res(b), "image/jpeg", 0.94); } catch { res(null); } });
    if (!out || !out.size) return { blob, applied: false };
    return { blob: out, applied: true };
  } catch { try { bm?.close?.(); } catch {} return { blob, applied: false }; }
}

export async function buildFaceProtectMask(refBlob, { grow = 0.35, feather = 10 } = {}) {
  let bm;
  try { bm = await bitmapOf(refBlob); } catch { return null; }
  try {
    const box = await boxOf(bm, { useModel: true });
    if (!box) { bm.close?.(); return null; }
    const W = bm.width, H = bm.height;
    bm.close?.();
    const cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    const cx = cv.getContext("2d");
    cx.fillStyle = "#fff";
    cx.fillRect(0, 0, W, H);
    cx.fillStyle = "#000";
    cx.beginPath();
    cx.ellipse(box.x + box.w / 2, box.y + box.h / 2,
      (box.w * (1 + grow)) / 2, (box.h * (1 + grow)) / 2, 0, 0, Math.PI * 2);
    cx.fill();
    if (feather > 0) {
      const soft = document.createElement("canvas");
      soft.width = W; soft.height = H;
      const sx = soft.getContext("2d");
      sx.filter = `blur(${feather}px)`;
      sx.drawImage(cv, 0, 0);
      sx.filter = "none";
      const out = await new Promise((res) => { try { soft.toBlob((b) => res(b), "image/png"); } catch { res(null); } });
      return out || await new Promise((res) => { try { cv.toBlob((b) => res(b), "image/png"); } catch { res(null); } });
    }
    return await new Promise((res) => { try { cv.toBlob((b) => res(b), "image/png"); } catch { res(null); } });
  } catch { try { bm?.close?.(); } catch {} return null; }
}

export async function surfacePass(blob, { smooth = 0.6, defringe = true } = {}) {
  let bm;
  try { bm = await bitmapOf(blob); } catch { return { blob, applied: false }; }
  try {
    const W = bm.width, H = bm.height;
    const cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    const cx = ctx2d(cv);
    cx.drawImage(bm, 0, 0);
    bm.close?.();
    const id = cx.getImageData(0, 0, W, H);
    const d = id.data, N = W * H;
    const mkBlur = (r) => {
      const c = document.createElement("canvas");
      c.width = W; c.height = H;
      const x = c.getContext("2d");
      x.filter = `blur(${r}px)`;
      x.drawImage(cv, 0, 0);
      x.filter = "none";
      return x.getImageData(0, 0, W, H).data;
    };
    const bEdge = mkBlur(1.5), bSoft = mkBlur(6);
    const lum = (o) => d[o] * 0.299 + d[o + 1] * 0.587 + d[o + 2] * 0.114;
    for (let i = 0; i < N; i++) {
      const o = i * 4;
      const l = lum(o);
      const edge = Math.abs(l - (bEdge[o] * 0.299 + bEdge[o + 1] * 0.587 + bEdge[o + 2] * 0.114));
      const hf = (Math.abs(d[o] - bSoft[o]) + Math.abs(d[o + 1] - bSoft[o + 1]) + Math.abs(d[o + 2] - bSoft[o + 2])) / 3;
      const k = smooth * Math.min(1, Math.max(0, (hf - 16) / 44)) * Math.min(1, Math.max(0, 1 - edge / 90));
      if (k > 0.02) {
        d[o] += (bSoft[o] - d[o]) * k;
        d[o + 1] += (bSoft[o + 1] - d[o + 1]) * k;
        d[o + 2] += (bSoft[o + 2] - d[o + 2]) * k;
      }
      if (defringe && edge > 50) {
        const k2 = Math.min(0.55, (edge - 50) / 120);
        const cb = 128 - 0.168736 * d[o] - 0.331264 * d[o + 1] + 0.5 * d[o + 2];
        const cr = 128 + 0.5 * d[o] - 0.418688 * d[o + 1] - 0.081312 * d[o + 2];
        const cb0 = 128 - 0.168736 * bEdge[o] - 0.331264 * bEdge[o + 1] + 0.5 * bEdge[o + 2];
        const cr0 = 128 + 0.5 * bEdge[o] - 0.418688 * bEdge[o + 1] - 0.081312 * bEdge[o + 2];
        const ncb = cb + (cb0 - cb) * k2, ncr = cr + (cr0 - cr) * k2;
        const y = l;
        d[o] = y + 1.402 * (ncr - 128);
        d[o + 1] = y - 0.344136 * (ncb - 128) - 0.714136 * (ncr - 128);
        d[o + 2] = y + 1.772 * (ncb - 128);
      }
    }
    cx.putImageData(id, 0, 0);
    const out = await new Promise((res) => { try { cv.toBlob((b) => res(b), "image/jpeg", 0.94); } catch { res(null); } });
    if (!out || !out.size) return { blob, applied: false };
    return { blob: out, applied: true };
  } catch { try { bm?.close?.(); } catch {} return { blob, applied: false }; }
}
