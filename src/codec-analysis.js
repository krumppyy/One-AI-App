export function analyzeImage(srcCanvas, density = "standard", W = 0, H = 0) {
  const sw = srcCanvas.width;
  const sh = srcCanvas.height;
  if (!sw || !sh) return null;
  const outW = W || sw;
  const outH = H || sh;
  const sampleW = 160;
  const sampleH = 90;
  const off = document.createElement("canvas");
  off.width = sampleW;
  off.height = sampleH;
  const octx = off.getContext("2d", { willReadFrequently: true });
  octx.drawImage(srcCanvas, 0, 0, sampleW, sampleH);
  const imgData = octx.getImageData(0, 0, sampleW, sampleH);
  const d = imgData.data;
  let totalLuma = 0;
  let minLuma = 255;
  let maxLuma = 0;
  const colorBins = {};
  const pixelCount = sampleW * sampleH;
  const lumaGrid = new Float32Array(pixelCount);
  for (let i = 0, px = 0; i < d.length; i += 4, px++) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const luma = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    lumaGrid[px] = luma;
    totalLuma += luma;
    if (luma < minLuma) minLuma = luma;
    if (luma > maxLuma) maxLuma = luma;
    const qr = (r >> 3) << 3;
    const qg = (g >> 3) << 3;
    const qb = (b >> 3) << 3;
    const key = `${qr},${qg},${qb}`;
    colorBins[key] = (colorBins[key] || 0) + 1;
  }
  const cents = Object.entries(colorBins).sort((a, b) => b[1] - a[1]).slice(0, 16)
    .map(([k]) => { const v = k.split(",").map(Number); return [v[0] + 4, v[1] + 4, v[2] + 4]; });
  while (cents.length < 16) cents.push([128, 128, 128]);
  const counts = new Array(16).fill(0);
  for (let pass = 0; pass < 3; pass++) {
    const acc = cents.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      let bi = 0, bd = Infinity;
      for (let c = 0; c < 16; c++) {
        const dr = r - cents[c][0], dg = g - cents[c][1], db = b - cents[c][2];
        const dist = dr * dr + dg * dg + db * db;
        if (dist < bd) { bd = dist; bi = c; }
      }
      acc[bi][0] += r; acc[bi][1] += g; acc[bi][2] += b; acc[bi][3]++;
    }
    for (let c = 0; c < 16; c++) if (acc[c][3]) {
      cents[c] = [acc[c][0] / acc[c][3], acc[c][1] / acc[c][3], acc[c][2] / acc[c][3]];
      if (pass === 2) counts[c] = acc[c][3];
    }
  }
  const order = cents.map((c, i) => i).sort((a, b) => counts[b] - counts[a]);
  const paletteRGB = order.map((i) => cents[i].map(Math.round));
  const palette = paletteRGB.map(([r, g, b]) => `rgb(${r},${g},${b})`);
  const nearestCentroid = (r, g, b) => {
    let bi = 0, bd = Infinity;
    for (let c = 0; c < 16; c++) {
      const dr = r - paletteRGB[c][0], dg = g - paletteRGB[c][1], db = b - paletteRGB[c][2];
      const dist = dr * dr + dg * dg + db * db;
      if (dist < bd) { bd = dist; bi = c; }
    }
    return bi;
  };
  const edgeAt = (x, y) => {
    const xm = Math.max(0, x - 1), xp = Math.min(sampleW - 1, x + 1);
    const ym = Math.max(0, y - 1), yp = Math.min(sampleH - 1, y + 1);
    const gx = lumaGrid[y * sampleW + xp] - lumaGrid[y * sampleW + xm];
    const gy = lumaGrid[yp * sampleW + x] - lumaGrid[ym * sampleW + x];
    return Math.min(1, Math.sqrt(gx * gx + gy * gy) / 128);
  };
  const hash01 = (n) => {
    let x = (Math.imul(n, 2654435761) + 40503) >>> 0;
    x ^= x >> 15; x = Math.imul(x, 2246822519) >>> 0; x ^= x >> 13;
    return (x >>> 0) / 4294967296;
  };
  const particleTarget = density === "eco" ? 1000 : density === "ultra" ? 7500 : 3200;
  const particles = [];
  const cols = Math.ceil(Math.sqrt((particleTarget * sampleW) / sampleH));
  const rows = Math.ceil(particleTarget / cols);
  const cells = cols * rows;
  const inkScale = Math.max(0.3, Math.min(1, 3200 / particleTarget));
  for (let i = 0; i < particleTarget; i++) {
    const cell = (Math.imul(i, 2654435761) + 40503) % cells;
    const gx = cell % cols, gy = Math.floor(cell / cols);
    const jx = (hash01(i * 2 + 1) - 0.5) * 0.8;
    const jy = (hash01(i * 2 + 2) - 0.5) * 0.8;
    const sx = Math.max(0, Math.min(sampleW - 1, Math.floor(((gx + 0.5 + jx) * sampleW) / cols)));
    const sy = Math.max(0, Math.min(sampleH - 1, Math.floor(((gy + 0.5 + jy) * sampleH) / rows)));
    const idx = (sy * sampleW + sx) * 4;
    const r = d[idx], g = d[idx + 1], b = d[idx + 2];
    const luma = lumaGrid[sy * sampleW + sx] / 255;
    const edge = edgeAt(sx, sy);
    const ci = nearestCentroid(r, g, b);
    const cc = paletteRGB[ci];
    const angle = (luma * Math.PI * 2) + ((sx / sampleW) * Math.PI);
    const speed = (0.5 + luma * 1.5);
    particles.push({
      x: (sx / sampleW) * outW,
      y: (sy / sampleH) * outH,
      originX: (sx / sampleW) * outW,
      originY: (sy / sampleH) * outH,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      ci,
      r: cc[0], g: cc[1], b: cc[2],
      radius: 0.8 + hash01(i * 2 + 7) * 0.9 + edge * 0.7,
      alpha: (0.10 + edge * 0.22) * inkScale,
      phase: hash01(i * 2 + 13) * Math.PI * 2,
    });
  }
  const avg = Math.round(totalLuma / pixelCount);
  return {
    palette, particles,
    averageLuma: avg,
    exposureLevel: Math.round((avg / 255) * 100),
    toneShadow: Math.round((minLuma / 255) * 100),
    toneHighlight: Math.round((maxLuma / 255) * 100),
    signalKB: 0,
  };
}
if (typeof window !== "undefined") window.CodecAnalysis = { analyzeImage };
