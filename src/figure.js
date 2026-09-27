/**
 * Is this picture a whole, properly drawn figure?
 *
 * This is the on-device check behind "the figure is not properly drawn". A
 * video model animates whatever it is handed, and a character-animation model
 * copies a driving performance onto whatever it is handed, so a still that is
 * cropped at the knees, half out of frame, or with a melted torso becomes a
 * *clip* that is cropped at the knees with a melted torso. The only place that
 * can be caught cheaply is the still, before a single frame is rendered — so
 * this module judges a still, and the callers re-draw until one passes.
 *
 * It is a pixel check rather than a pose model on purpose: it runs over a
 * handful of candidates, it needs no model download, and it works on a
 * portrait figure with no face detector available. The subject is segmented
 * from the flat studio backdrop its corner patches measure, so a picture with a
 * busy background is passed through unchecked (`checked: false`) rather than
 * guessed at — a false rejection costs a whole re-draw.
 */

/** The words to append when a drawn figure has to be asked for again. */
export const FULL_FIGURE_HINT =
  "full length wide shot of one standing person, the whole figure from the top of the head to the bare feet inside the frame, generous space above the head and below the feet, standing well back from the camera, correct human anatomy, the figure is not cropped";

function canvasOf(w, h) {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

async function downscale(blob, maxSide = 160) {
  const bmp = await createImageBitmap(blob);
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const w = Math.max(16, Math.round(bmp.width * scale));
  const h = Math.max(16, Math.round(bmp.height * scale));
  const c = canvasOf(w, h);
  const g = c.getContext("2d", { willReadFrequently: true });
  g.drawImage(bmp, 0, 0, w, h);
  if (bmp.close) bmp.close();
  return { px: g.getImageData(0, 0, w, h).data, w, h };
}

/**
 * Returns `{ ok, score, checked, reason, topGap, bottomGap, heightRatio,
 * centered, fill }`. `ok` is the pass/fail; `score` (0..1) ranks candidates
 * when none of them passes, so the best of a bad batch can still be used.
 */
export async function analyzeFigure(blob) {
  if (!blob || !blob.size) return { ok: false, score: 0, checked: false, reason: "no picture" };
  let shot;
  try {
    shot = await downscale(blob, 160);
  } catch {
    return { ok: false, score: 0, checked: false, reason: "unreadable picture" };
  }
  const { px: data, w, h } = shot;
  const at = (x, y) => {
    const i = (y * w + x) * 4;
    return [data[i], data[i + 1], data[i + 2]];
  };
  const patch = (x0, y0) => {
    let r = 0,
      g = 0,
      b = 0,
      n = 0;
    for (let y = y0; y < Math.min(h, y0 + 4); y++)
      for (let x = x0; x < Math.min(w, x0 + 4); x++) {
        const p = at(x, y);
        r += p[0];
        g += p[1];
        b += p[2];
        n++;
      }
    return [r / n, g / n, b / n];
  };
  const corners = [patch(0, 0), patch(w - 4, 0), patch(0, h - 4), patch(w - 4, h - 4)];
  const bg = [0, 1, 2].map((k) => corners.reduce((s, c) => s + c[k], 0) / 4);
  const spread = Math.max(...corners.map((c) => Math.hypot(c[0] - bg[0], c[1] - bg[1], c[2] - bg[2])));
  // A background that is not one flat colour cannot be segmented from four
  // corner samples, so it is passed rather than guessed at.
  if (spread > 46) return { ok: true, score: 0.6, checked: false, reason: "" };

  const rowCount = new Array(h).fill(0);
  const colCount = new Array(w).fill(0);
  const T = 48;
  let fg = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const p = at(x, y);
      if (Math.hypot(p[0] - bg[0], p[1] - bg[1], p[2] - bg[2]) > T) {
        rowCount[y]++;
        colCount[x]++;
        fg++;
      }
    }
  const rowMin = Math.max(2, w * 0.03);
  const colMin = Math.max(2, h * 0.03);
  let y0 = -1,
    y1 = -1,
    x0 = -1,
    x1 = -1;
  for (let y = 0; y < h; y++)
    if (rowCount[y] > rowMin) {
      if (y0 < 0) y0 = y;
      y1 = y;
    }
  for (let x = 0; x < w; x++)
    if (colCount[x] > colMin) {
      if (x0 < 0) x0 = x;
      x1 = x;
    }
  if (y0 < 0 || x0 < 0) return { ok: false, score: 0.1, checked: true, reason: "there is no figure in it" };
  const bw = x1 - x0 + 1;
  const bh = y1 - y0 + 1;
  const topGap = y0 / h;
  const bottomGap = 1 - (y1 + 1) / h;
  const heightRatio = bh / bw;
  const heightFrac = bh / h;
  const centered = 1 - Math.abs((x0 + x1) / 2 - w / 2) / (w / 2);
  const fill = fg / (w * h);
  // How wide the figure is at each height is what tells a whole person from a
  // crop of one: a standing person is narrow at the head, widest across the
  // shoulders/hips, and narrow again at the feet. A picture whose *bottom* is
  // as wide as its widest part is a body sliced off by the frame, however
  // neatly it reaches the bottom edge — which is the failure a plain
  // "does the subject touch the bottom?" test happily accepts.
  const bandAvg = (a, b) => {
    let sum = 0;
    let n = 0;
    for (let y = Math.round(y0 + a * bh); y <= Math.round(y0 + b * bh); y++) {
      sum += rowCount[y] || 0;
      n++;
    }
    return n ? sum / n : 0;
  };
  const maxBand = Math.max(...rowCount.slice(Math.max(0, y0), Math.min(h, y1 + 1)), 1);
  const headNarrow = bandAvg(0.02, 0.12) / maxBand;
  const footNarrow = bandAvg(0.88, 1) / maxBand;
  // Reaching the bottom edge is normal (a full-length photo often has the feet
  // at the very bottom), but reaching it *wide* means the frame sliced a body:
  // a real figure's feet are much narrower than its widest part.
  const edgeCut = bottomGap < 0.02 && footNarrow > 0.75;
  const ok =
    topGap < 0.2 &&
    headNarrow < 0.62 &&
    footNarrow < 0.9 &&
    !edgeCut &&
    heightRatio > 1.2 &&
    heightFrac > 0.5 &&
    centered > 0.25 &&
    fill > 0.03;
  const reason = ok
    ? ""
    : heightFrac <= 0.5 || fill <= 0.03 || (topGap >= 0.2 && bottomGap >= 0.15)
    ? "the figure is too small in the frame"
    : edgeCut || footNarrow >= 0.9
    ? "her legs are cut off at the bottom"
    : topGap >= 0.2
    ? "her head is cut off at the top"
    : heightRatio <= 1.2
    ? "it is not a full-length figure"
    : "it is not framed as a whole person";
  const score =
    0.18 * (1 - Math.min(1, topGap / 0.25)) +
    0.2 * (1 - Math.max(0, Math.min(1, (footNarrow - 0.55) / 0.45))) +
    0.18 * Math.min(1, heightFrac / 0.9) +
    0.14 * Math.min(1, Math.max(0, centered / 0.7)) +
    0.16 * Math.min(1, Math.max(0, (heightRatio - 1) / 0.6)) +
    0.14 * (1 - Math.max(0, Math.min(1, (headNarrow - 0.5) / 0.5)));
  return {
    ok,
    score: Math.round(score * 1000) / 1000,
    checked: true,
    reason,
    topGap,
    bottomGap,
    heightRatio,
    heightFrac,
    headNarrow,
    footNarrow,
    edgeCut,
    centered,
    fill,
  };
}
