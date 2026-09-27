// Codec Analysis Engine — Low-End CPU Signal Decomposition
export function analyzeImage(srcCanvas, density = "balanced", W = 0, H = 0) {
  const sw = srcCanvas.width;
  const sh = srcCanvas.height;
  if (!sw || !sh) return null;

  const outW = W || sw;
  const outH = H || sh;

  // Downsample to 160x90 for sub-millisecond execution on any low-end CPU
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

  // Extract 16 dominant color centroids
  const cents = Object.entries(colorBins)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 16)
    .map(([k]) => {
      const v = k.split(",").map(Number);
      return [v[0] + 4, v[1] + 4, v[2] + 4];
    });

  while (cents.length < 16) cents.push([128, 128, 128]);

  const palette = cents.map((c) => `rgb(${c[0]},${c[1]},${c[2]})`);
  const averageLuma = Math.round(totalLuma / pixelCount);
  const exposureLevel = Math.round((averageLuma / 255) * 100);
  const toneShadow = Math.round((minLuma / 255) * 100);
  const toneHighlight = Math.round((maxLuma / 255) * 100);

  // Lagrangian particle count based on density mode
  const targetCount = density === "eco" ? 1000 : density === "ultra" ? 7500 : 3200;
  const particles = [];

  for (let i = 0; i < targetCount; i++) {
    const sx = Math.floor(Math.random() * sampleW);
    const sy = Math.floor(Math.random() * sampleH);
    const pidx = sy * sampleW + sx;
    const idx = pidx * 4;
    const r = d[idx], g = d[idx + 1], b = d[idx + 2], a = d[idx + 3];
    const luma = lumaGrid[pidx] / 255;

    // Optical gradient flow angle
    const angle = (luma * Math.PI * 2) + ((sx / sampleW) * Math.PI);
    const speed = 0.5 + luma * 1.5;

    particles.push({
      originX: (sx / sampleW) * outW,
      originY: (sy / sampleH) * outH,
      x: (sx / sampleW) * outW,
      y: (sy / sampleH) * outH,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      r, g, b,
      radius: Math.max(1.5, Math.random() * 3.5 + luma * 2.0),
      alpha: Math.max(0.3, (a / 255) * 0.9),
      phase: Math.random() * Math.PI * 2,
      ci: i % 16,
    });
  }

  const signalKB = ((16 * 3 + targetCount * 12) / 1024).toFixed(1);

  return {
    palette,
    exposureLevel,
    toneShadow,
    toneHighlight,
    averageLuma,
    particles,
    signalKB,
  };
}
