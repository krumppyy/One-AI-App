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

/**
 * Draws realistic teeth, tongue, and lip deformation into the oral cavity.
 */
function drawOralInterior(ctx, mx, myy, mw, mh, o) {
  // 1. Oral cavity deep backdrop (dark maroon/black)
  ctx.fillStyle = "#1e0608";
  ctx.beginPath();
  ctx.ellipse(mx, myy, mw * 0.95, mh * 1.1, 0, 0, Math.PI * 2);
  ctx.fill();

  // 2. Tongue (soft pinkish pad sitting at the base of the cavity)
  if (o > 0.12) {
    const tongueY = myy + mh * 0.45;
    const tongueW = mw * 0.65;
    const tongueH = mh * 0.45;
    const tGrad = ctx.createRadialGradient(mx, tongueY, 2, mx, tongueY, tongueW);
    tGrad.addColorStop(0, "#e87985");
    tGrad.addColorStop(0.7, "#be525e");
    tGrad.addColorStop(1, "#8e2c36");
    ctx.fillStyle = tGrad;
    ctx.beginPath();
    ctx.ellipse(mx, tongueY, tongueW, tongueH, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // 3. Upper Dental Arch / Teeth Row (enamel with soft dividers)
  if (o > 0.06) {
    const teethTopY = myy - mh * 0.72;
    const teethH = Math.min(mh * 0.65, 8 + o * 10);
    const teethW = mw * 0.78;

    // Enamel base
    const teethGrad = ctx.createLinearGradient(0, teethTopY, 0, teethTopY + teethH);
    teethGrad.addColorStop(0, "#ffffff");
    teethGrad.addColorStop(0.7, "#f1f5f9");
    teethGrad.addColorStop(1, "#cbd5e1");
    ctx.fillStyle = teethGrad;

    ctx.beginPath();
    ctx.roundRect
      ? ctx.roundRect(mx - teethW * 0.5, teethTopY, teethW, teethH, [1, 1, 3, 3])
      : ctx.rect(mx - teethW * 0.5, teethTopY, teethW, teethH);
    ctx.fill();

    // Subtle interdental vertical separations (central & lateral incisors)
    ctx.strokeStyle = "rgba(100, 116, 139, 0.35)";
    ctx.lineWidth = 1;
    const numSeparators = 5;
    const step = teethW / (numSeparators + 1);
    for (let i = 1; i <= numSeparators; i++) {
      const sx = mx - teethW * 0.5 + i * step;
      ctx.beginPath();
      ctx.moveTo(sx, teethTopY + 1);
      ctx.lineTo(sx, teethTopY + teethH - 1);
      ctx.stroke();
    }
  }

  // 4. Lower Dental Arch / Teeth Row (visible on wider openings)
  if (o > 0.42) {
    const lowTeethH = Math.min(mh * 0.4, 6 + o * 5);
    const lowTeethY = myy + mh * 0.65 - lowTeethH;
    const lowTeethW = mw * 0.62;

    const lowTeethGrad = ctx.createLinearGradient(0, lowTeethY, 0, lowTeethY + lowTeethH);
    lowTeethGrad.addColorStop(0, "#e2e8f0");
    lowTeethGrad.addColorStop(1, "#ffffff");
    ctx.fillStyle = lowTeethGrad;

    ctx.beginPath();
    ctx.roundRect
      ? ctx.roundRect(mx - lowTeethW * 0.5, lowTeethY, lowTeethW, lowTeethH, [3, 3, 1, 1])
      : ctx.rect(mx - lowTeethW * 0.5, lowTeethY, lowTeethW, lowTeethH);
    ctx.fill();

    ctx.strokeStyle = "rgba(100, 116, 139, 0.3)";
    ctx.lineWidth = 0.8;
    const step = lowTeethW / 5;
    for (let i = 1; i <= 4; i++) {
      const sx = mx - lowTeethW * 0.5 + i * step;
      ctx.beginPath();
      ctx.moveTo(sx, lowTeethY + 1);
      ctx.lineTo(sx, lowTeethY + lowTeethH - 1);
      ctx.stroke();
    }
  }
}

/**
 * Draws facial micro-expressions (natural eye blink + eyebrow emphasis lift).
 */
function drawFacialExpressions(ctx, W, H, dx, dy, dw, dh, mouth, o, t) {
  // Periodic natural eye blinking (every 3.6 seconds, lasts ~150ms)
  const blinkCycle = 3.6;
  const blinkPhase = t % blinkCycle;
  let blinkProgress = 0;
  if (blinkPhase < 0.16) {
    blinkProgress = Math.sin((blinkPhase / 0.16) * Math.PI);
  }

  // Eye locations relative to mouth position (approx 0.3 * faceHeight above mouth)
  const eyeY = dy + (mouth.y - 0.22) * dh;
  const eyeDistance = (mouth.w || 60) * (dw / W) * 0.95;
  const eyeW = Math.max(12, eyeDistance * 0.45);
  const eyeH = Math.max(6, eyeW * 0.5);

  if (blinkProgress > 0.05) {
    const midX = dx + mouth.x * dw;
    [-eyeDistance, eyeDistance].forEach((offset) => {
      const ex = midX + offset;
      ctx.save();
      // Natural flesh-toned eyelid closure
      ctx.fillStyle = "rgba(180, 120, 95, " + (0.75 * blinkProgress).toFixed(2) + ")";
      ctx.beginPath();
      ctx.ellipse(ex, eyeY, eyeW, eyeH * blinkProgress, 0, 0, Math.PI * 2);
      ctx.fill();

      // Delicate eyelash line
      ctx.strokeStyle = "rgba(30, 20, 20, " + (0.85 * blinkProgress).toFixed(2) + ")";
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(ex - eyeW * 0.9, eyeY);
      ctx.quadraticCurveTo(ex, eyeY + 2 * blinkProgress, ex + eyeW * 0.9, eyeY);
      ctx.stroke();
      ctx.restore();
    });
  }

  // Eyebrow lift on vocal peak/emphasis (o > 0.4)
  if (o > 0.38) {
    const browLift = Math.min(4.5, (o - 0.38) * 8);
    const browY = eyeY - eyeH * 1.6;
    const midX = dx + mouth.x * dw;
    [-eyeDistance, eyeDistance].forEach((offset) => {
      const bx = midX + offset;
      ctx.save();
      ctx.fillStyle = "rgba(255, 255, 255, 0.06)";
      ctx.beginPath();
      ctx.ellipse(bx, browY - browLift, eyeW * 1.1, eyeH * 0.7, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
  }
}

export function drawTalking(ctx, bmp, W, H, open01, mouth, zoom, time = 0) {
  const dw = W * zoom, dh = H * zoom;
  const dx = (W - dw) / 2, dy = (H - dh) / 2;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
  ctx.drawImage(bmp, dx, dy, dw, dh);

  // Apply facial expression mimicking (natural eye blink + vocal eyebrow movement)
  drawFacialExpressions(ctx, W, H, dx, dy, dw, dh, mouth, open01, time);

  const o = Math.max(0, Math.min(1, open01));
  if (o < 0.035) return;

  const scale = dw / (bmp.width || dw);
  const mw = Math.max(8, (mouth.w || 60) * scale * 0.52);
  const mh = Math.max(3, mw * (0.16 + o * 0.88));
  const mx = dx + mouth.x * dw;
  const myy = dy + mouth.y * dh;

  if (!_tmp) _tmp = document.createElement("canvas");
  const sw = Math.ceil(mw * 2.5), sh = Math.ceil(Math.max(6, mh * 1.8));
  _tmp.width = sw; _tmp.height = sh;
  const tc = _tmp.getContext("2d");
  tc.clearRect(0, 0, sw, sh);

  try {
    tc.drawImage(ctx.canvas, mx - mw * 1.25, myy - mh * 0.85, sw, sh, 0, 0, sw, sh);
  } catch {
    return;
  }

  const drop = mh * 1.65;

  ctx.save();
  // 1. Lower lip / jaw drop masking with smooth blend
  ctx.beginPath();
  ctx.ellipse(mx, myy + drop * 0.32, mw * 1.18, mh * 1.35, 0, 0, Math.PI * 2);
  ctx.clip();
  ctx.drawImage(_tmp, 0, 0, sw, sh, mx - mw * 1.25, myy - mh * 0.85 + drop, sw, sh);

  // 2. Realistic Oral Cavity with Teeth and Tongue
  drawOralInterior(ctx, mx, myy + drop * 0.45, mw * 0.88, mh * 0.82, o);

  // 3. Lip Vermilion contour highlight & ambient occlusion
  ctx.strokeStyle = "rgba(190, 75, 80, " + (0.35 + o * 0.4).toFixed(2) + ")";
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.ellipse(mx, myy + drop * 0.45, mw * 0.92, mh * 0.86, 0, 0, Math.PI * 2);
  ctx.stroke();

  ctx.restore();
}

/**
 * Lipsync and facial animation on video frames.
 */
export function drawTalkingVideoFrame(ctx, video, W, H, open01, mouth, time = 0) {
  if (!video) return;
  const iw = video.videoWidth || W, ih = video.videoHeight || H;
  const s = Math.max(W / iw, H / ih);
  const dw = iw * s, dh = ih * s;
  const dx = (W - dw) / 2, dy = (H - dh) / 2;

  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
  ctx.drawImage(video, dx, dy, dw, dh);

  // Facial expression mimicking on video frame
  drawFacialExpressions(ctx, W, H, dx, dy, dw, dh, mouth, open01, time);

  const o = Math.max(0, Math.min(1, open01));
  if (o < 0.04) return;

  const scale = dw / iw;
  const mw = Math.max(8, (mouth.w || 60) * scale * 0.52);
  const mh = Math.max(3, mw * (0.16 + o * 0.88));
  const mx = dx + mouth.x * dw;
  const myy = dy + mouth.y * dh;

  if (!_tmp) _tmp = document.createElement("canvas");
  const sw = Math.ceil(mw * 2.5), sh = Math.ceil(Math.max(6, mh * 1.8));
  _tmp.width = sw; _tmp.height = sh;
  const tc = _tmp.getContext("2d");
  tc.clearRect(0, 0, sw, sh);

  try {
    tc.drawImage(ctx.canvas, mx - mw * 1.25, myy - mh * 0.85, sw, sh, 0, 0, sw, sh);
  } catch {
    return;
  }

  const drop = mh * 1.65;
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(mx, myy + drop * 0.32, mw * 1.18, mh * 1.35, 0, 0, Math.PI * 2);
  ctx.clip();
  ctx.drawImage(_tmp, 0, 0, sw, sh, mx - mw * 1.25, myy - mh * 0.85 + drop, sw, sh);

  drawOralInterior(ctx, mx, myy + drop * 0.45, mw * 0.88, mh * 0.82, o);

  ctx.strokeStyle = "rgba(190, 75, 80, " + (0.35 + o * 0.4).toFixed(2) + ")";
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.ellipse(mx, myy + drop * 0.45, mw * 0.92, mh * 0.86, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}
