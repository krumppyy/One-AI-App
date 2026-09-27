export function envelopeFor(audioBuf, fps, total) {
  const ch0 = audioBuf.getChannelData(0);
  const sr = audioBuf.sampleRate;
  const n = Math.max(1, Math.ceil(total * fps));
  const out = new Float32Array(n);
  const win = Math.max(64, Math.floor(sr / fps));
  for (let i = 0; i < n; i++) {
    const s = i * win;
    let sum = 0, c = 0;
    for (let k = s; k < Math.min(s + win, ch0.length); k += 7) { const v = ch0[k]; sum += v * v; c++; }
    out[i] = c ? Math.sqrt(sum / c) : 0;
  }
  let peak = 0.0001;
  for (let i = 0; i < n; i++) if (out[i] > peak) peak = out[i];
  let prev = 0;
  for (let i = 0; i < n; i++) {
    let v = Math.min(1, out[i] / (peak * 0.7));
    v = Math.pow(v, 0.7);
    prev = Math.max(v, prev * 0.82);
    out[i] = prev;
  }
  return out;
}
function skinMouth(bmp) {
  const W = 96, H = Math.max(1, Math.round(W * (bmp.height || 1) / (bmp.width || 1)));
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0, W, H);
  let d;
  try { d = ctx.getImageData(0, 0, W, H).data; }
  catch { return null; }
  const skin = (o) => {
    const r = d[o], g = d[o + 1], b = d[o + 2];
    return r > 95 && g > 40 && b > 20 && r > g && r > b && (Math.max(r, g, b) - Math.min(r, g, b)) > 15 && Math.abs(r - g) > 15;
  };
  const seen = new Uint8Array(W * H);
  let best = null;
  const lim = Math.floor(H * 0.78);
  for (let y = 0; y < lim; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (seen[i] || !skin(i * 4)) continue;
      let x0 = x, x1 = x, y0 = y, y1 = y, n = 0;
      const st = [i];
      seen[i] = 1;
      while (st.length) {
        const p = st.pop();
        const px = p % W, py = (p / W) | 0;
        n++;
        if (px < x0) x0 = px; if (px > x1) x1 = px;
        if (py < y0) y0 = py; if (py > y1) y1 = py;
        if (px > 0 && !seen[p - 1] && py < lim && skin((p - 1) * 4)) { seen[p - 1] = 1; st.push(p - 1); }
        if (px < W - 1 && !seen[p + 1] && py < lim && skin((p + 1) * 4)) { seen[p + 1] = 1; st.push(p + 1); }
        if (py > 0 && !seen[p - W] && skin((p - W) * 4)) { seen[p - W] = 1; st.push(p - W); }
        if (py < H - 1 && !seen[p + W] && (py + 1) < lim && skin((p + W) * 4)) { seen[p + W] = 1; st.push(p + W); }
      }
      const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
      if (n > 120 && bw >= 8 && bh >= 10 && bw < W * 0.7 && y0 < H * 0.55) {
        if (!best || y0 < best.y0 - 2 || (Math.abs(y0 - best.y0) <= 2 && n > best.n)) best = { y0, n, cx: (x0 + x1) / 2 / W, bottom: y1 / H, wpx: bw };
      }
    }
  }
  if (!best) return null;
  return { x: best.cx, y: Math.min(0.9, best.bottom + 0.035), w: Math.max(28, best.wpx * (bmp.width / W) * 0.42) };
}
export async function findMouth(bmp) {
  try {
    if ("FaceDetector" in window) {
      const det = new FaceDetector({ fastMode: true, maxDetectedFaces: 1 });
      const faces = await det.detect(bmp);
      const b = faces && faces[0] && faces[0].boundingBox;
      if (b && bmp.width) return { x: (b.x + b.width * 0.5) / bmp.width, y: (b.y + b.height * 0.8) / bmp.height, w: b.width * 0.3 };
    }
  } catch {}
  try {
    const s = skinMouth(bmp);
    if (s) return s;
  } catch {}
  return { x: 0.5, y: 0.6, w: 60 };
}
let _tmp = null;
export function drawTalking(ctx, bmp, W, H, open01, mouth, zoom) {
  const dw = W * zoom, dh = H * zoom;
  const dx = (W - dw) / 2, dy = (H - dh) / 2;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
  ctx.drawImage(bmp, dx, dy, dw, dh);
  const o = Math.max(0, Math.min(1, open01));
  if (o < 0.04) return;
  const scale = dw / (bmp.width || dw);
  const mw = Math.max(6, (mouth.w || 60) * scale * 0.5);
  const mh = Math.max(2, mw * (0.15 + o * 0.9));
  const mx = dx + mouth.x * dw;
  const myy = dy + mouth.y * dh;
  if (!_tmp) _tmp = document.createElement("canvas");
  const sw = Math.ceil(mw * 2.4), sh = Math.ceil(Math.max(4, mh * 1.6));
  _tmp.width = sw; _tmp.height = sh;
  const tc = _tmp.getContext("2d");
  tc.clearRect(0, 0, sw, sh);
  try { tc.drawImage(ctx.canvas, mx - mw * 1.2, myy - mh * 0.8, sw, sh, 0, 0, sw, sh); } catch { return; }
  const drop = mh * 1.7;
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(mx, myy + drop * 0.3, mw * 1.15, mh * 1.35, 0, 0, Math.PI * 2);
  ctx.clip();
  ctx.drawImage(_tmp, 0, 0, sw, sh, mx - mw * 1.2, myy - mh * 0.8 + drop, sw, sh);
  ctx.fillStyle = "rgba(58,12,14," + (0.3 + o * 0.5).toFixed(2) + ")";
  ctx.beginPath();
  ctx.ellipse(mx, myy + drop * 0.55, mw * 0.62, mh * 0.72, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
