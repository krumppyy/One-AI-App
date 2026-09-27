export function autoRetouchCanvas(cv, gp, { erase = 0.55, clone = 0.7, tone = 0.5 } = {}) {
  try {
    const W = cv.width, H = cv.height;
    if (!gp || gp.w < 20 || gp.h < 20) return false;
    const pad = 0.6;
    const x0 = Math.max(0, Math.floor(gp.x - gp.w * pad));
    const y0 = Math.max(0, Math.floor(gp.y - gp.h * pad));
    const x1 = Math.min(W, Math.ceil(gp.x + gp.w * (1 + pad)));
    const y1 = Math.min(H, Math.ceil(gp.y + gp.h * (1 + pad)));
    const ww = x1 - x0, hh = y1 - y0;
    if (ww < 24 || hh < 24) return false;
    const cx = cv.getContext("2d", { willReadFrequently: true });
    const roi = document.createElement("canvas");
    roi.width = ww; roi.height = hh;
    const rx = roi.getContext("2d", { willReadFrequently: true });
    rx.drawImage(cv, x0, y0, ww, hh, 0, 0, ww, hh);
    const id = rx.getImageData(0, 0, ww, hh);
    const d = id.data, N = ww * hh;
    const ex = gp.x + gp.w / 2 - x0, ey = gp.y + gp.h / 2 - y0;
    const erx = Math.max(8, gp.w * 0.5), ery = Math.max(8, gp.h * 0.5);
    const isSkin = (o) => {
      const r = d[o], g = d[o + 1], b = d[o + 2];
      const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
      const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
      return cb > 77 && cb < 127 && cr > 133 && cr < 173 && r > 60;
    };
    const norm = (i) => {
      const px = i % ww, py = (i / ww) | 0;
      const dx = (px - ex) / erx, dy = (py - ey) / ery;
      return Math.sqrt(dx * dx + dy * dy);
    };
    const blurC = document.createElement("canvas");
    blurC.width = ww; blurC.height = hh;
    const bx = blurC.getContext("2d");
    bx.filter = "blur(5px)";
    bx.drawImage(roi, 0, 0);
    bx.filter = "none";
    const bd = bx.getImageData(0, 0, ww, hh).data;
    const mask = new Float32Array(N);
    let mCount = 0;
    for (let i = 0; i < N; i++) {
      const o = i * 4, nd = norm(i);
      let a = 0;
      if (nd > 0.72 && nd < 1.2) a = Math.max(a, 0.5 * erase);
      const hf = (Math.abs(d[o] - bd[o]) + Math.abs(d[o + 1] - bd[o + 1]) + Math.abs(d[o + 2] - bd[o + 2])) / 3;
      if (hf > 34 && nd < 0.85 && isSkin(o)) a = Math.max(a, Math.min(0.9, (hf - 34) / 30 + 0.4));
      if (a > 0.01) mCount++;
      mask[i] = a;
    }
    if (!mCount) return false;
    const skinIdx = [];
    for (let i = 0; i < N; i += 2) {
      const o = i * 4, nd = norm(i);
      if (nd > 1.0 && nd < 1.6 && isSkin(o)) skinIdx.push(i);
    }
    const donorOk = (j) => j >= 0 && j < N && mask[j] < 0.05 && isSkin(j * 4);
    for (let i = 0; i < N; i++) {
      const a = mask[i];
      if (a < 0.03) continue;
      const o = i * 4, px = i % ww, py = (i / ww) | 0;
      let done = false;
      const mx = Math.round(2 * ex - px);
      if (mx >= 0 && mx < ww) {
        const j = py * ww + mx;
        if (donorOk(j)) {
          const q = j * 4, k = clone * a;
          d[o] += (d[q] - d[o]) * k;
          d[o + 1] += (d[q + 1] - d[o + 1]) * k;
          d[o + 2] += (d[q + 2] - d[o + 2]) * k;
          done = true;
        }
      }
      if (!done) {
        const sy = Math.max(0, py - Math.round(ery * 0.5));
        const j = sy * ww + px;
        if (donorOk(j)) {
          const q = j * 4, k = clone * a * 0.8;
          d[o] += (d[q] - d[o]) * k;
          d[o + 1] += (d[q + 1] - d[o + 1]) * k;
          d[o + 2] += (d[q + 2] - d[o + 2]) * k;
        } else {
          const k = erase * a * 0.7;
          d[o] += (bd[o] - d[o]) * k;
          d[o + 1] += (bd[o + 1] - d[o + 1]) * k;
          d[o + 2] += (bd[o + 2] - d[o + 2]) * k;
        }
      }
    }
    if (skinIdx.length > 40 && tone > 0) {
      let mr = 0, mg = 0, mb = 0;
      for (const i of skinIdx) { const o = i * 4; mr += d[o]; mg += d[o + 1]; mb += d[o + 2]; }
      mr /= skinIdx.length; mg /= skinIdx.length; mb /= skinIdx.length;
      let sr = 0, sg = 0, sb = 0;
      for (const i of skinIdx) { const o = i * 4; sr += (d[o] - mr) ** 2; sg += (d[o + 1] - mg) ** 2; sb += (d[o + 2] - mb) ** 2; }
      sr = Math.sqrt(sr / skinIdx.length); sg = Math.sqrt(sg / skinIdx.length); sb = Math.sqrt(sb / skinIdx.length);
      let tr = 0, tg = 0, tb = 0, tn = 0;
      for (let i = 0; i < N; i++) {
        if (mask[i] < 0.1) continue;
        const o = i * 4; tr += d[o]; tg += d[o + 1]; tb += d[o + 2]; tn++;
      }
      if (tn > 10) {
        tr /= tn; tg /= tn; tb /= tn;
        let qr = 0, qg = 0, qb = 0;
        for (let i = 0; i < N; i++) {
          if (mask[i] < 0.1) continue;
          const o = i * 4; qr += (d[o] - tr) ** 2; qg += (d[o + 1] - tg) ** 2; qb += (d[o + 2] - tb) ** 2;
        }
        qr = Math.sqrt(qr / tn); qg = Math.sqrt(qg / tn); qb = Math.sqrt(qb / tn);
        const gr = Math.min(1.6, Math.max(0.6, sr / Math.max(6, qr)));
        const gg = Math.min(1.6, Math.max(0.6, sg / Math.max(6, qg)));
        const gb = Math.min(1.6, Math.max(0.6, sb / Math.max(6, qb)));
        for (let i = 0; i < N; i++) {
          const a = mask[i];
          if (a < 0.1) continue;
          const o = i * 4, k = tone * a;
          d[o] += ((d[o] - tr) * gr + mr - d[o]) * k;
          d[o + 1] += ((d[o + 1] - tg) * gg + mg - d[o + 1]) * k;
          d[o + 2] += ((d[o + 2] - tb) * gb + mb - d[o + 2]) * k;
        }
      }
    }
    let nz = 0, nn = 0;
    for (const i of skinIdx) {
      if (nn >= 400) break;
      const o = i * 4;
      nz += Math.abs(d[o] - bd[o]) + Math.abs(d[o + 1] - bd[o + 1]) + Math.abs(d[o + 2] - bd[o + 2]);
      nn++;
    }
    const grain = nn ? Math.min(2.4, Math.max(0.5, (nz / nn / 3) * 0.35)) : 1;
    const sharpC = document.createElement("canvas");
    sharpC.width = ww; sharpC.height = hh;
    const sx = sharpC.getContext("2d");
    rx.putImageData(id, 0, 0);
    sx.filter = "blur(2px)";
    sx.drawImage(roi, 0, 0);
    sx.filter = "none";
    const sd = sx.getImageData(0, 0, ww, hh).data;
    const cur = rx.getImageData(0, 0, ww, hh);
    const cd = cur.data;
    for (let i = 0; i < N; i++) {
      if (mask[i] < 0.03) continue;
      const o = i * 4, k = Math.min(1, mask[i] + 0.25);
      for (let c = 0; c < 3; c++) {
        const sharp = cd[o + c] + (cd[o + c] - sd[o + c]) * 0.18;
        cd[o + c] = cd[o + c] + (sharp - cd[o + c]) * k + (Math.random() - 0.5) * 2 * grain * k * 0.6;
      }
    }
    rx.putImageData(cur, 0, 0);
    cx.drawImage(roi, 0, 0, ww, hh, x0, y0, ww, hh);
    return true;
  } catch {
    return false;
  }
}

export function autoGradeCanvas(cv, gp, { expose = 1, color = 1 } = {}) {
  try {
    const W = cv.width, H = cv.height;
    if (!W || !H) return false;
    const cx = cv.getContext("2d", { willReadFrequently: true });
    const id = cx.getImageData(0, 0, W, H);
    const d = id.data, N = W * H;
    let mr = 0, mg = 0, mb = 0, lum = 0, sat = 0;
    const st = 16;
    let n = 0;
    for (let i = 0; i < N; i += st) {
      const o = i * 4;
      const r = d[o], g = d[o + 1], b = d[o + 2];
      mr += r; mg += g; mb += b;
      lum += r * 0.299 + g * 0.587 + b * 0.114;
      sat += Math.max(r, g, b) - Math.min(r, g, b);
      n++;
    }
    if (!n) return false;
    mr /= n; mg /= n; mb /= n; lum /= n; sat /= n;
    const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
    const eg = clamp(120 / Math.max(40, lum), 0.92, 1.08);
    const t = clamp((1.05 - mr / Math.max(1, mb)) * 0.5, -0.05, 0.05) * color;
    const ti = clamp((0.98 - mg / Math.max(1, (mr + mb) / 2)) * 0.4, -0.03, 0.03) * color;
    const gr = eg * (1 + t), gg = eg * (1 + ti), gb = eg * (1 - t);
    const satTrim = sat > 72 ? Math.min(0.14, (sat - 72) / 300) : 0;
    for (let i = 0; i < N; i++) {
      const o = i * 4;
      let r = d[o] * gr, g = d[o + 1] * gg, b = d[o + 2] * gb;
      const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
      const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
      const skin = cb > 77 && cb < 127 && cr > 133 && cr < 173 && r > 60;
      if (skin) {
        const ncb = cb + (100 - cb) * 0.08 * color;
        const ncr = cr + (152 - cr) * 0.08 * color;
        const y = r * 0.299 + g * 0.587 + b * 0.114;
        r = y + 1.402 * (ncr - 128);
        g = y - 0.344136 * (ncb - 128) - 0.714136 * (ncr - 128);
        b = y + 1.772 * (ncb - 128);
        if (satTrim > 0) {
          const l = r * 0.299 + g * 0.587 + b * 0.114;
          r += (l - r) * satTrim; g += (l - g) * satTrim; b += (l - b) * satTrim;
        }
      }
      d[o] = r < 0 ? 0 : r > 255 ? 255 : r;
      d[o + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
      d[o + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
    }
    cx.putImageData(id, 0, 0);
    return true;
  } catch {
    return false;
  }
}
