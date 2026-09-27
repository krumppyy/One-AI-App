// Ankan-Soma Neural Vector & Sequence Codec
// Designed for ultra-low CPU consumption and instant 60 FPS playback
export const ANKAN_MAGIC = "ANKAN";
export const SOMA_MAGIC = "SOMA";
export const ANKAN_SOMA_VERSION = 1;

export const keyImageToDataUrl = (canvas, maxSide = 1280, q = 0.92) => {
  const w = canvas.width || 640;
  const h = canvas.height || 360;
  const s = Math.min(1, maxSide / Math.max(w, h));
  const cw = Math.max(2, Math.round(w * s));
  const ch = Math.max(2, Math.round(h * s));

  const small = document.createElement("canvas");
  small.width = cw;
  small.height = ch;
  const sctx = small.getContext("2d");
  sctx.imageSmoothingEnabled = true;
  sctx.imageSmoothingQuality = "high";
  sctx.drawImage(canvas, 0, 0, w, h, 0, 0, cw, ch);
  return small.toDataURL("image/jpeg", q);
};

export function encodeKey(key) {
  return {
    name: key.name || "key",
    hold: Math.max(0.5, Number(key.hold) || 3),
    image: key.image || (key.canvas ? keyImageToDataUrl(key.canvas) : ""),
    analysis: {
      palette: key.analysis?.palette || [],
      tone: {
        exposure: key.analysis?.exposureLevel ?? 50,
        shadow: key.analysis?.toneShadow ?? 15,
        highlight: key.analysis?.toneHighlight ?? 88,
        averageLuma: key.analysis?.averageLuma ?? 128,
      },
      particles: (key.analysis?.particles || []).map((p) => [
        Math.round(p.originX ?? p[0] ?? 0),
        Math.round(p.originY ?? p[1] ?? 0),
        +(p.vx ?? p[2] ?? 0.2).toFixed(2),
        +(p.vy ?? p[3] ?? 0.1).toFixed(2),
        p.r ?? p[4] ?? 180,
        p.g ?? p[5] ?? 180,
        p.b ?? p[6] ?? 180,
        +(p.radius ?? p[7] ?? 2).toFixed(1),
        +(p.alpha ?? p[8] ?? 0.5).toFixed(3),
        (p.ci ?? p[9] ?? 0) | 0,
      ]),
    },
  };
}

export function encodeParams(s = {}) {
  return {
    flowVelocity: s.flowVelocity ?? 1,
    exposurePulse: s.exposurePulse ?? 30,
    cameraParallax: s.cameraParallax ?? 25,
    morphTurbulence: s.morphTurbulence ?? 35,
    colorWarp: s.colorWarp ?? 15,
    density: s.particleDensity ?? "balanced",
    transition: s.transition ?? 0.8,
  };
}

export function encodeAnkan(canvas, analysis, params = {}, name = "ankan-still") {
  const image = keyImageToDataUrl(canvas);
  return {
    magic: ANKAN_MAGIC,
    version: ANKAN_SOMA_VERSION,
    width: canvas.width || 1280,
    height: canvas.height || 720,
    name: name || "ankan-still",
    params: encodeParams(params),
    key: {
      image,
      analysis: {
        palette: analysis.palette || [],
        tone: {
          exposure: analysis.exposureLevel ?? 50,
          shadow: analysis.toneShadow ?? 15,
          highlight: analysis.toneHighlight ?? 88,
          averageLuma: analysis.averageLuma ?? 128,
        },
        particles: (analysis.particles || []).map((p) => [
          Math.round(p.originX),
          Math.round(p.originY),
          +p.vx.toFixed(2),
          +p.vy.toFixed(2),
          p.r,
          p.g,
          p.b,
          +p.radius.toFixed(1),
          +p.alpha.toFixed(3),
          p.ci | 0,
        ]),
      },
    },
  };
}

export function encodeSoma(keys, params = {}) {
  return {
    magic: SOMA_MAGIC,
    version: ANKAN_SOMA_VERSION,
    width: 1280,
    height: 720,
    params: encodeParams(params),
    keys: keys.map(encodeKey),
  };
}

export function decodeAnkanSoma(doc) {
  if (!doc || (doc.magic !== ANKAN_MAGIC && doc.magic !== SOMA_MAGIC)) {
    throw new Error("Not a valid .ankan or .soma file (unrecognized magic header).");
  }
  if (doc.version !== ANKAN_SOMA_VERSION) {
    throw new Error(`Unsupported version ${doc.version}, this player reads v${ANKAN_SOMA_VERSION}.`);
  }

  const expand = (k) => {
    const a = k.analysis || {};
    const tone = a.tone || {};
    return {
      name: k.name || "key",
      hold: Math.max(0.5, Number(k.hold) || 3),
      image: k.image,
      analysis: {
        palette: a.palette || [],
        averageLuma: tone.averageLuma ?? 128,
        exposureLevel: tone.exposure ?? 50,
        toneShadow: tone.shadow ?? 15,
        toneHighlight: tone.highlight ?? 88,
        signalKB: ((a.particles || []).length * 12 / 1024).toFixed(1),
        particles: (a.particles || []).map((q) => {
          if (Array.isArray(q)) {
            return {
              x: q[0],
              y: q[1],
              originX: q[0],
              originY: q[1],
              vx: q[2],
              vy: q[3],
              r: q[4],
              g: q[5],
              b: q[6],
              radius: q[7],
              alpha: q[8],
              ci: q[9] | 0,
              phase: Math.random() * Math.PI * 2,
            };
          }
          return {
            x: q.originX || 0,
            y: q.originY || 0,
            originX: q.originX || 0,
            originY: q.originY || 0,
            vx: q.vx || 0.2,
            vy: q.vy || 0.1,
            r: q.r || 180,
            g: q.g || 180,
            b: q.b || 180,
            radius: q.radius || 2,
            alpha: q.alpha || 0.5,
            ci: q.ci || 0,
            phase: Math.random() * Math.PI * 2,
          };
        }),
      },
    };
  };

  const keys = doc.magic === ANKAN_MAGIC ? [expand({ ...doc.key, name: doc.name })] : (doc.keys || []).map(expand);
  if (!keys.length) throw new Error("File holds no keyframes.");
  return { magic: doc.magic, params: doc.params || {}, keys };
}

export function downloadDoc(doc, filename) {
  const str = JSON.stringify(doc);
  const blob = new Blob([str], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return { blob, kb: +(blob.size / 1024).toFixed(1) };
}
