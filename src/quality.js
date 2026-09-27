export function thumbStats(src, W = 160, H = 90) {
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const x = c.getContext("2d", { willReadFrequently: true });
  x.imageSmoothingEnabled = true;
  x.imageSmoothingQuality = "high";
  x.drawImage(src, 0, 0, W, H);
  let im;
  try { im = x.getImageData(0, 0, W, H); } catch { return null; }
  const d = im.data;
  const n = W * H;
  const lum = new Float32Array(n);
  let sum = 0, sumSat = 0;
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const l = 0.299 * r + 0.587 * g + 0.114 * b;
    lum[p] = l;
    sum += l;
    sumSat += Math.max(r, g, b) - Math.min(r, g, b);
  }
  let e = 0;
  for (let y = 1; y < H - 1; y++) for (let xx = 1; xx < W - 1; xx++) {
    const gx = lum[y * W + xx + 1] - lum[y * W + xx - 1];
    const gy = lum[(y + 1) * W + xx] - lum[(y - 1) * W + xx];
    e += Math.abs(gx) + Math.abs(gy);
  }
  return { edge: e / n, luma: sum / n, sat: sumSat / n, lum };
}
export function edgeEnergyOf(src) {
  const s = thumbStats(src);
  return s ? s.edge : 0;
}
export function scoreEdit(original, output, outputBlob = null) {
  const a = thumbStats(original);
  const b = thumbStats(output);
  if (!a || !b) return { score: 0, parts: {} };
  const edgeRatio = a.edge > 0.001 ? b.edge / a.edge : 1;
  const edgePts = edgeRatio >= 0.995 ? 40 : Math.max(0, Math.min(40, edgeRatio * 40));
  const inPx = (original.width || 1) * (original.height || 1);
  const outPx = (output.width || 1) * (output.height || 1);
  const resRatio = Math.min(1, outPx / Math.max(inPx, 512 * 512));
  const resPts = Math.round(resRatio * 25);
  const lumaDrift = Math.abs(a.luma - b.luma);
  const satDrift = Math.abs(a.sat - b.sat);
  const drift = lumaDrift / 255 + satDrift / 255;
  const colorPts = Math.max(0, Math.round(20 - Math.min(20, drift * 60)));
  let compPts = 13;
  if (outputBlob && outputBlob.size) {
    const mp = outPx / 1e6;
    const kbPerMp = (outputBlob.size / 1024) / Math.max(0.05, mp);
    if (kbPerMp >= 380) compPts = 15;
    else if (kbPerMp >= 220) compPts = 14;
    else if (kbPerMp >= 120) compPts = 13;
    else if (kbPerMp >= 60) compPts = 10;
    else compPts = 6;
  }
  const score = Math.max(0, Math.min(100, Math.round(edgePts + resPts + colorPts + compPts)));
  return {
    score,
    parts: {
      edge: Math.round(edgePts),
      res: resPts,
      color: colorPts,
      comp: compPts,
      edgeRatio: Math.round(edgeRatio * 1000) / 1000,
      lumaDrift: Math.round(lumaDrift * 10) / 10,
      satDrift: Math.round(satDrift * 10) / 10,
    },
  };
}
export function detailCanvas(w = 768, h = 512, seed = 7) {
  let rnd = seed >>> 0 || 1;
  const rand = () => ((rnd = (rnd * 1664525 + 1013904223) >>> 0) / 4294967296);
  const cv = document.createElement("canvas");
  cv.width = w; cv.height = h;
  const ctx = cv.getContext("2d");
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, "#2b3a55");
  g.addColorStop(0.5, "#5a4a63");
  g.addColorStop(1, "#243428");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 900; i++) {
    ctx.fillStyle = `hsla(${(rand() * 360) | 0},55%,${25 + rand() * 45}%,0.5)`;
    ctx.fillRect(rand() * w, rand() * h, 1 + rand() * 3, 1 + rand() * 3);
  }
  for (let y = 0; y < h; y += 4) {
    ctx.fillStyle = y % 8 ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.08)";
    ctx.fillRect(0, y, w, 1);
  }
  ctx.fillStyle = "#c8966e";
  ctx.beginPath();
  ctx.arc(w * 0.5, h * 0.44, Math.min(w, h) * 0.2, 0, 7);
  ctx.fill();
  ctx.fillStyle = "#3a2418";
  ctx.beginPath();
  ctx.arc(w * 0.44, h * 0.42, Math.min(w, h) * 0.022, 0, 7);
  ctx.arc(w * 0.56, h * 0.42, Math.min(w, h) * 0.022, 0, 7);
  ctx.fill();
  ctx.strokeStyle = "rgba(20,10,8,0.9)";
  ctx.lineWidth = Math.max(2, w / 256);
  ctx.beginPath();
  ctx.arc(w * 0.5, h * 0.5, Math.min(w, h) * 0.07, 0.3, Math.PI - 0.3);
  ctx.stroke();
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.font = `700 ${Math.round(h * 0.09)}px system-ui,sans-serif`;
  ctx.fillText("Detail 0123456789 AaBbCc", w * 0.06, h * 0.88);
  ctx.strokeStyle = "rgba(255,255,255,0.5)";
  for (let i = 0; i < 5; i++) {
    ctx.lineWidth = 1;
    ctx.strokeRect(w * 0.06 + i * w * 0.17, h * 0.62, w * 0.13, h * 0.12);
  }
  return cv;
}
if (typeof window !== "undefined") window.Quality = { thumbStats, edgeEnergyOf, scoreEdit, detailCanvas };
