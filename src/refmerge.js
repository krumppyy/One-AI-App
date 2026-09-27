export async function blobToImage(blob) {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = "sync";
    img.src = url;
    await img.decode();
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
}

async function detectFaces(img) {
  try {
    if ("FaceDetector" in window) {
      const det = new FaceDetector({ fastMode: true });
      const faces = await det.detect(img);
      return (faces || []).map((f) => ({ x: f.boundingBox.x, y: f.boundingBox.y, w: f.boundingBox.width, h: f.boundingBox.height }));
    }
  } catch {}
  return [];
}

function avgSkin(cx, x, y, w, h) {
  try {
    const d = cx.getImageData(Math.max(0, x | 0), Math.max(0, y | 0), Math.max(1, w | 0), Math.max(1, h | 0)).data;
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < d.length; i += 16) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
    if (!n) return null;
    return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
  } catch { return null; }
}

function coverDraw(cx, img, W, H) {
  const bw = img.naturalWidth || img.width, bh = img.naturalHeight || img.height;
  const cover = Math.max(W / bw, H / bh);
  const dw = bw * cover, dh = bh * cover;
  cx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
}

function ellipsePaste(cx, img, sx, sy, sw, sh, dx, dy, dw, dh, feather = 12) {
  cx.save();
  if (feather > 0) cx.filter = `blur(${feather}px)`;
  cx.beginPath();
  cx.ellipse(dx + dw / 2, dy + dh / 2, dw / 2, dh / 2, 0, 0, Math.PI * 2);
  cx.clip();
  cx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
  cx.restore();
  cx.filter = "none";
  cx.save();
  cx.beginPath();
  cx.ellipse(dx + dw / 2, dy + dh / 2, dw / 2 * 0.92, dh / 2 * 0.92, 0, 0, Math.PI * 2);
  cx.clip();
  cx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
  cx.restore();
}

export async function fuseFaceOntoBody(faceBlob, bodyBlob, outW = 768, outH = 1365) {
  const r = await fuseAllRefs(bodyBlob, [{ slot: "face", blob: faceBlob }], outW, outH);
  return r.blob;
}

export function pickFuseRoles(starterBlob, extras) {
  const by = (s) => (extras || []).find((e) => e.slot === s && e.blob);
  const face = by("face"), body = by("body") || by("outfit");
  const char1 = by("char1"), char2 = by("char2"), scene = by("scene"), style = by("style");
  const parts = [];
  if (face && body) parts.push("Face + Body/outfit");
  else if (face && starterBlob) parts.push("Face onto starter");
  if (char1) parts.push("Character 1");
  if (char2) parts.push("Character 2");
  if (scene) parts.push("Scene bg");
  if (style) parts.push("Style/pose prompt-only");
  if (!parts.length) return null;
  return {
    faceBlob: face?.blob || null, bodyBlob: body?.blob || null,
    char1Blob: char1?.blob || null, char2Blob: char2?.blob || null,
    sceneBlob: scene?.blob || null, styleHint: style ? (style.hint || "art style and pose") : null,
    why: parts.join(" · "),
  };
}

export async function fuseAllRefs(starterBlob, extras, outW = 768, outH = 1365) {
  const list = Array.isArray(extras) ? extras.filter((e) => e && e.blob) : [];
  const by = (s) => list.find((e) => e.slot === s);
  const faceE = by("face"), bodyE = by("body") || by("outfit");
  const char1E = by("char1"), char2E = by("char2"), sceneE = by("scene"), styleE = by("style");
  const steps = [];
  const promptHints = [];
  const cv = document.createElement("canvas");
  cv.width = outW; cv.height = outH;
  const cx = cv.getContext("2d");
  cx.fillStyle = "#000";
  cx.fillRect(0, 0, outW, outH);

  const baseBlob = bodyE?.blob || starterBlob;
  if (!baseBlob) throw new Error("no base image to fuse onto");
  const baseImg = await blobToImage(baseBlob);

  if (sceneE?.blob) {
    const sceneImg = await blobToImage(sceneE.blob);
    cx.save();
    cx.filter = "blur(18px)";
    coverDraw(cx, sceneImg, outW, outH);
    cx.restore();
    const bw = baseImg.naturalWidth || baseImg.width, bh = baseImg.naturalHeight || baseImg.height;
    const fit = Math.min((outW * 0.94) / bw, (outH * 0.94) / bh);
    const dw = bw * fit, dh = bh * fit;
    cx.drawImage(baseImg, (outW - dw) / 2, (outH - dh) / 2, dw, dh);
    steps.push("scene: blurred scene plate behind subject (edges show place, subject pixels untouched)");
    promptHints.push("the background and setting from the Scene reference image");
  } else {
    coverDraw(cx, baseImg, outW, outH);
    steps.push(`base: ${(bodyE ? "Body/outfit" : "starter")} cover-drawn`);
  }

  if (char1E?.blob || char2E?.blob) {
    const secondBlob = char1E?.blob || char2E?.blob;
    const secondImg = await blobToImage(secondBlob);
    const bw2 = secondImg.naturalWidth || secondImg.width, bh2 = secondImg.naturalHeight || secondImg.height;
    const cover = Math.max((outW / 2) / bw2, outH / bh2);
    const dw = bw2 * cover, dh = bh2 * cover;
    const grad = cx.createLinearGradient(outW * 0.42, 0, outW * 0.58, 0);
    grad.addColorStop(0, "rgba(0,0,0,0)");
    grad.addColorStop(0.5, "rgba(0,0,0,1)");
    grad.addColorStop(1, "rgba(0,0,0,1)");
    const tmp = document.createElement("canvas");
    tmp.width = outW; tmp.height = outH;
    const tc = tmp.getContext("2d");
    tc.drawImage(secondImg, outW / 2 + (outW / 2 - dw) / 2, (outH - dh) / 2, dw, dh);
    tc.globalCompositeOperation = "destination-in";
    tc.fillStyle = grad;
    tc.fillRect(0, 0, outW, outH);
    cx.drawImage(tmp, 0, 0);
    steps.push(`duo: ${(char1E ? "Character 1" : "Character 2")} composited right-half with feathered seam`);
    promptHints.push("two people, identities from the reference images");
    if (char1E?.blob && char2E?.blob) {
      promptHints.push("second person from Character 2 reference (prompt guidance — single canvas holds two)");
      steps.push("note: Character 2 rides as prompt guidance (one canvas, two identities described)");
    }
  }

  if (faceE?.blob) {
    const faceImg = await blobToImage(faceE.blob);
    const fw = faceImg.naturalWidth || faceImg.width, fh = faceImg.naturalHeight || faceImg.height;
    let fb = (await detectFaces(faceImg))[0] || null;
    if (!fb) fb = { x: fw * 0.15, y: fh * 0.1, w: fw * 0.7, h: fh * 0.7 };
    const pad = (await detectFaces(faceImg)).length ? 0.18 : 0.4;
    const sx = Math.max(0, fb.x - fb.w * pad), sy = Math.max(0, fb.y - fb.h * pad);
    const sw = Math.min(fw - sx, fb.w * (1 + pad * 2)), sh = Math.min(fh - sy, fb.h * (1 + pad * 2));
    const probe = document.createElement("canvas");
    probe.width = outW; probe.height = Math.round(outH * 0.5);
    const pc = probe.getContext("2d");
    pc.drawImage(cv, 0, 0, outW, probe.height, 0, 0, outW, probe.height);
    const hbFaces = await detectFaces(probe);
    const hb = hbFaces[0] || null;
    if (hb && hb.w > outW * 0.08) {
      const grow = 1.3;
      const dx = hb.x + hb.w / 2 - (hb.w * grow) / 2, dy = hb.y + hb.h / 2 - (hb.h * grow) / 2;
      ellipsePaste(cx, faceImg, sx, sy, sw, sh, dx, dy, hb.w * grow, hb.h * grow, 10);
      steps.push("face: transplanted onto detected head (identity lock)");
      promptHints.push("the face identity from the Face reference image");
    } else {
      const headH = Math.round(outH * 0.3);
      const bg = document.createElement("canvas");
      bg.width = outW; bg.height = outH;
      const bc = bg.getContext("2d");
      bc.save();
      bc.filter = "blur(24px)";
      coverDraw(bc, baseImg, outW, outH + headH);
      bc.restore();
      const sharp = document.createElement("canvas");
      sharp.width = outW; sharp.height = outH;
      const shc = sharp.getContext("2d");
      shc.drawImage(cv, 0, 0, outW, outH - headH, 0, headH, outW, outH - headH);
      const edge = shc.createLinearGradient(0, headH - 10, 0, headH + 70);
      edge.addColorStop(0, "rgba(0,0,0,0)");
      edge.addColorStop(1, "rgba(0,0,0,1)");
      shc.globalCompositeOperation = "destination-in";
      shc.fillStyle = edge;
      shc.fillRect(0, 0, outW, outH);
      bc.drawImage(sharp, 0, 0);
      const neckTone = avgSkin(bc, outW * 0.35, headH + 4, outW * 0.3, 24) || [170, 125, 100];
      const chinTone = avgSkin(faceImg, sx + sw * 0.3, sy + sh * 0.62, sw * 0.4, sh * 0.2) || neckTone;
      const mix = (a, b, t) => Math.round(a + (b - a) * t);
      const bridge = bc.createLinearGradient(0, headH - 40, 0, headH + 70);
      bridge.addColorStop(0, `rgb(${chinTone[0]},${chinTone[1]},${chinTone[2]})`);
      bridge.addColorStop(0.5, `rgb(${mix(chinTone[0], neckTone[0], 0.55)},${mix(chinTone[1], neckTone[1], 0.55)},${mix(chinTone[2], neckTone[2], 0.55)})`);
      bridge.addColorStop(1, `rgb(${neckTone[0]},${neckTone[1]},${neckTone[2]})`);
      bc.fillStyle = bridge;
      bc.save();
      bc.filter = "blur(8px)";
      bc.globalAlpha = 0.85;
      bc.beginPath();
      bc.ellipse(outW / 2, headH + 16, outW * 0.1, 44, 0, 0, Math.PI * 2);
      bc.fill();
      bc.restore();
      const hairW = outW * 0.09;
      bc.save();
      bc.filter = "blur(10px)";
      bc.globalAlpha = 0.55;
      bc.drawImage(faceImg, sx, sy, sw * 0.22, sh, outW * 0.24 - hairW / 2, headH - 110, hairW, 190);
      bc.drawImage(faceImg, sx + sw * 0.78, sy, sw * 0.22, sh, outW * 0.76 - hairW / 2, headH - 110, hairW, 190);
      bc.restore();
      cx.clearRect(0, 0, outW, outH);
      cx.drawImage(bg, 0, 0);
      const dw = outW * 0.68, dh = Math.round(outH * 0.29);
      const dx = (outW - dw) / 2, dy = Math.max(0, headH - dh + Math.round(outH * 0.06));
      const mask = document.createElement("canvas");
      mask.width = dw | 0; mask.height = dh | 0;
      const mc = mask.getContext("2d");
      const g = mc.createRadialGradient(dw / 2, dh / 2, Math.min(dw, dh) * 0.22, dw / 2, dh / 2, Math.max(dw, dh) * 0.52);
      g.addColorStop(0, "rgba(0,0,0,1)");
      g.addColorStop(0.55, "rgba(0,0,0,1)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      mc.fillStyle = g;
      mc.fillRect(0, 0, dw, dh);
      const faceCv = document.createElement("canvas");
      faceCv.width = dw | 0; faceCv.height = dh | 0;
      const fc = faceCv.getContext("2d");
      fc.save();
      fc.beginPath();
      fc.ellipse(dw / 2, dh / 2, dw * 0.44, dh * 0.48, 0, 0, Math.PI * 2);
      fc.clip();
      fc.drawImage(faceImg, sx, sy, sw, sh * 1.12, 0, 0, dw, dh * 1.12);
      fc.restore();
      const tmp2 = document.createElement("canvas");
      tmp2.width = dw | 0; tmp2.height = dh | 0;
      const t2 = tmp2.getContext("2d");
      t2.drawImage(faceCv, 0, 0);
      t2.globalCompositeOperation = "destination-in";
      t2.drawImage(mask, 0, 0);
      cx.drawImage(tmp2, dx, dy, dw, dh);
      steps.push("face: headless torso — blurred headroom fill, soft-mask face overlap, neck bridge + hair falls");
      promptHints.push("the face identity from the Face reference image, same woman as the Body reference");
    }
  } else if (bodyE?.blob) {
    promptHints.push("the body and outfit from the Body/outfit reference image");
  }

  if (styleE?.blob) {
    steps.push("style/pose: pixel-carry impossible single-image — rides as prompt guidance only");
    promptHints.push("art style and pose from the Style/pose reference");
  }

  const blob = await new Promise((res) => cv.toBlob(res, "image/png"));
  const hintText = promptHints.length ? `reference-guided: match ${promptHints.join(", ")}` : "";
  return { blob, steps, hintText, width: outW, height: outH };
}
