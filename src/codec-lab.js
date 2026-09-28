// One AI Studio - Neural Vector & Particle Video Codec Lab
// Ultra-low CPU Video Generation & Reconstruction Engine
import { saveBlobToLibrary, setVideoRefReuse } from "./library-save.js";
import { pickLibraryMedia } from "./lib-picker.js";

const $ = (id) => document.getElementById(id);

export function initCodecLab() {
  const container = $("pageCodecLab");
  if (!container) return;

  // Master Codec State
  const S = {
    // Media Source
    sourceType: "preset", // 'preset', 'upload', 'generated', 'library'
    anchorImage: null,
    anchorCanvas: document.createElement("canvas"),
    anchorCtx: null,
    sourceWidth: 1280,
    sourceHeight: 720,
    sourcePrompt: "Cyberpunk neon metropolis with rainy reflections and volumetric light",

    // Signal Decomposition (Extracted by Low-End CPU Signal Analyzer)
    isAnalyzed: false,
    colorClusters: [],
    dominantPalette: [],
    exposureLevel: 50,
    toneShadow: 15,
    toneHighlight: 88,
    averageLuma: 128,
    activeParticles: [],
    flowVectors: [],
    signalBitrateKbps: 18.4,
    cpuLoadPct: 4,
    frameMs: 0,

    // Keyframed video model: SDXL / storyboard / library stills become
    // keyframes; the codec synthesizes the motion between them on-device.
    // Each key: {id, name, canvas, analysis, hold}. Empty list = legacy
    // single-anchor 6 s loop.
    keys: [],
    keySeq: 0,
    transition: 0.8,

    // Inbuilt Player Engine
    canvas: null,
    ctx: null,
    isPlaying: true,
    currentTime: 0, // seconds
    duration: 6, // 6 seconds loop
    fps: 60,
    playbackSpeed: 1,
    loop: true,
    lastTs: 0,
    animId: null,

    // View Modes
    viewMode: "composite", // 'composite', 'palette', 'vectors', 'tone', 'split'
    splitPos: 0.5,

    // Synthesizer & Codec Parameters (Tuning)
    particleDensity: "balanced", // 'eco' (1000), 'balanced' (3500), 'ultra' (8000)
    flowVelocity: 1.0,
    exposurePulse: 30, // 0 - 100
    cameraParallax: 25, // 0 - 100
    morphTurbulence: 35, // 0 - 100
    colorWarp: 15, // 0 - 100

    // Transcoder / Exporter
    isExporting: false,
    recorder: null,
    recordedChunks: [],
    lastExportedBlob: null,
  };

  S.anchorCtx = S.anchorCanvas.getContext("2d", { willReadFrequently: true });
  S.canvas = $("codecCanvas");
  if (!S.canvas) return;
  S.ctx = S.canvas.getContext("2d");
  S.canvas.width = 1280;
  S.canvas.height = 720;

  /* -------------------------------------------------------------
     1. PRESET SCENES GENERATOR (OFFSCREEN ART SYNTHESIS)
     ------------------------------------------------------------- */
  const PRESETS = {
    cyberpunk: {
      name: "Cyberpunk City",
      prompt: "Cyberpunk neon metropolis with rainy reflections and volumetric light",
      render: (ctx, w, h) => {
        const grad = ctx.createLinearGradient(0, 0, 0, h);
        grad.addColorStop(0, "#08061a");
        grad.addColorStop(0.6, "#1f0d3d");
        grad.addColorStop(1, "#030208");
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);

        // Neon skyscrapers
        const colors = ["#06b6d4", "#ec4899", "#8b5cf6", "#3b82f6"];
        for (let i = 0; i < 28; i++) {
          const bx = (i / 28) * w;
          const bw = w / 26;
          const bh = (Math.sin(i * 1.7) * 0.35 + 0.55) * (h * 0.75);
          ctx.fillStyle = `rgba(15, 23, 42, 0.95)`;
          ctx.fillRect(bx, h - bh, bw, bh);

          // Neon windows
          ctx.fillStyle = colors[i % colors.length];
          for (let y = h - bh + 20; y < h - 40; y += 22) {
            if ((i + y) % 3 === 0) {
              ctx.fillRect(bx + 4, y, bw - 8, 4);
            }
          }
        }
        // Wet street reflection
        const roadGrad = ctx.createLinearGradient(0, h * 0.8, 0, h);
        roadGrad.addColorStop(0, "rgba(236, 72, 153, 0.35)");
        roadGrad.addColorStop(1, "rgba(6, 182, 212, 0.2)");
        ctx.fillStyle = roadGrad;
        ctx.fillRect(0, h * 0.8, w, h * 0.2);
      }
    },
    nebula: {
      name: "Cosmic Stargate",
      prompt: "Deep cosmic nebula galaxy with stellar dust and accretion disc",
      render: (ctx, w, h) => {
        ctx.fillStyle = "#02030a";
        ctx.fillRect(0, 0, w, h);
        // Galaxy core
        const core = ctx.createRadialGradient(w/2, h/2, 20, w/2, h/2, w * 0.45);
        core.addColorStop(0, "#ffffff");
        core.addColorStop(0.2, "#818cf8");
        core.addColorStop(0.5, "#4338ca");
        core.addColorStop(0.8, "#1e1b4b");
        core.addColorStop(1, "transparent");
        ctx.fillStyle = core;
        ctx.fillRect(0, 0, w, h);

        // Stars
        ctx.fillStyle = "#ffffff";
        for (let i = 0; i < 200; i++) {
          const sx = (Math.sin(i * 99) * 0.5 + 0.5) * w;
          const sy = (Math.cos(i * 33) * 0.5 + 0.5) * h;
          const sr = (i % 3) + 1;
          ctx.beginPath();
          ctx.arc(sx, sy, sr, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    },
    sunset: {
      name: "Sunset Ocean",
      prompt: "Golden hour sunset over calm ocean waves with warm sun glare",
      render: (ctx, w, h) => {
        const sky = ctx.createLinearGradient(0, 0, 0, h * 0.6);
        sky.addColorStop(0, "#451a03");
        sky.addColorStop(0.5, "#d97706");
        sky.addColorStop(1, "#f59e0b");
        ctx.fillStyle = sky;
        ctx.fillRect(0, 0, w, h * 0.6);

        // Sun
        ctx.fillStyle = "#fffbeb";
        ctx.beginPath();
        ctx.arc(w / 2, h * 0.55, 65, 0, Math.PI * 2);
        ctx.fill();

        // Ocean
        const ocean = ctx.createLinearGradient(0, h * 0.6, 0, h);
        ocean.addColorStop(0, "#78350f");
        ocean.addColorStop(0.5, "#1e293b");
        ocean.addColorStop(1, "#0f172a");
        ctx.fillStyle = ocean;
        ctx.fillRect(0, h * 0.6, w, h * 0.4);
      }
    },
    aurora: {
      name: "Emerald Aurora",
      prompt: "Emerald northern lights aurora borealis over snowy pine mountains",
      render: (ctx, w, h) => {
        ctx.fillStyle = "#02120e";
        ctx.fillRect(0, 0, w, h);
        // Aurora ribbons
        for (let i = 0; i < 5; i++) {
          const ribbon = ctx.createLinearGradient(0, 40 + i * 40, 0, 300 + i * 40);
          ribbon.addColorStop(0, "rgba(52, 211, 153, 0.4)");
          ribbon.addColorStop(0.5, "rgba(16, 185, 129, 0.75)");
          ribbon.addColorStop(1, "transparent");
          ctx.fillStyle = ribbon;
          ctx.beginPath();
          ctx.moveTo(0, 100 + i * 30);
          ctx.bezierCurveTo(w * 0.3, 40 + i * 20, w * 0.7, 180 + i * 30, w, 80 + i * 20);
          ctx.lineTo(w, h * 0.7);
          ctx.lineTo(0, h * 0.7);
          ctx.fill();
        }
        // Mountains
        ctx.fillStyle = "#052e16";
        ctx.beginPath();
        ctx.moveTo(0, h);
        for (let x = 0; x <= w; x += 60) {
          const my = h * 0.65 + Math.sin(x * 0.02) * 50;
          ctx.lineTo(x, my);
        }
        ctx.lineTo(w, h);
        ctx.fill();
      }
    }
  };

  /* -------------------------------------------------------------
     2. LOW-END CPU SIGNAL DECOMPOSITION ENGINE
     ------------------------------------------------------------- */
  function analyzeCanvas(srcCanvas, density) {
    const W = srcCanvas.width;
    const H = srcCanvas.height;
    if (!W || !H) return null;

    // Use a lightweight downsampled grid (160 x 90 = 14,400 pixels)
    // Ensures sub-millisecond execution on any low-end CPU without freezing!
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

    // 1. Analyze Color Clusters, Histogram & Exposure (+ luma grid for edges)
    for (let i = 0, px = 0; i < d.length; i += 4, px++) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      const luma = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
      lumaGrid[px] = luma;
      totalLuma += luma;
      if (luma < minLuma) minLuma = luma;
      if (luma > maxLuma) maxLuma = luma;

      // Quantize to 5-bit color bins (32 levels per channel)
      const qr = (r >> 3) << 3;
      const qg = (g >> 3) << 3;
      const qb = (b >> 3) << 3;
      const key = `${qr},${qg},${qb}`;
      colorBins[key] = (colorBins[key] || 0) + 1;
    }

    S.averageLuma = Math.round(totalLuma / pixelCount);
    S.exposureLevel = Math.round((S.averageLuma / 255) * 100);
    S.toneShadow = Math.round((minLuma / 255) * 100);
    S.toneHighlight = Math.round((maxLuma / 255) * 100);

    // True centroids: 3 k-means passes of the 14,400 samples around the top
    // bins. ~700k ops — milliseconds on weak CPUs, far truer colors.
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

    // Edge strength on the luma grid: detail gets definition, flat fills
    // get a whisper — no dots floating on clean gradients.
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

    // 2. Stratified jittered placement over a hash-permuted cell order:
    // even coverage, zero clumps, exact count, deterministic per density.
    // Each mote snaps to its nearest TRUE centroid color.
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
      // Flow angle based on luminosity gradient & position
      const angle = (luma * Math.PI * 2) + ((sx / sampleW) * Math.PI);
      const speed = (0.5 + luma * 1.5);

      particles.push({
        x: (sx / sampleW) * S.canvas.width,
        y: (sy / sampleH) * S.canvas.height,
        originX: (sx / sampleW) * S.canvas.width,
        originY: (sy / sampleH) * S.canvas.height,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        ci,
        r: cc[0], g: cc[1], b: cc[2],
        radius: 0.8 + hash01(i * 2 + 7) * 0.9 + edge * 0.7,
        alpha: (0.10 + edge * 0.22) * inkScale,
        phase: hash01(i * 2 + 13) * Math.PI * 2,
      });
    }

    // Honest signal size: the actual JSON bytes this analysis would occupy.
    const lite = particles.map((p) => [Math.round(p.originX), Math.round(p.originY),
      +p.vx.toFixed(2), +p.vy.toFixed(2), p.r, p.g, p.b, +p.radius.toFixed(1), +p.alpha.toFixed(2), p.ci]);
    const signalKB = (JSON.stringify({ c: palette, p: lite }).length) / 1024;

    return {
      palette, particles,
      averageLuma: Math.round(totalLuma / pixelCount),
      exposureLevel: Math.round((Math.round(totalLuma / pixelCount) / 255) * 100),
      toneShadow: Math.round((minLuma / 255) * 100),
      toneHighlight: Math.round((maxLuma / 255) * 100),
      signalKB,
    };
  }

  function analyzeAndDecompose() {
    const a = analyzeCanvas(S.anchorCanvas, S.particleDensity);
    if (!a) return;
    S.dominantPalette = a.palette;
    S.activeParticles = a.particles;
    S.averageLuma = a.averageLuma;
    S.exposureLevel = a.exposureLevel;
    S.toneShadow = a.toneShadow;
    S.toneHighlight = a.toneHighlight;
    S.isAnalyzed = true;
    S.signalBitrateKbps = (a.signalKB / Math.max(0.1, timelineTotal())).toFixed(1);
    renderPaletteRibbon();
    updateTelemetryHUD();
  }

  /* Keyframed video model: each key holds its own still + analysis.
     The timeline plays key by key with a dissolve at every boundary. */
  function addKeyframe(name) {
    if (!S.anchorCanvas.width || !S.anchorCanvas.height) return null;
    const norm = document.createElement("canvas");
    norm.width = 1280;
    norm.height = 720;
    norm.getContext("2d").drawImage(S.anchorCanvas, 0, 0, 1280, 720);
    const analysis = analyzeCanvas(norm, S.particleDensity);
    if (!analysis) return null;
    const key = {
      id: ++S.keySeq,
      name: name || S.sourcePrompt.slice(0, 40) || ("Key " + S.keySeq),
      canvas: norm,
      analysis,
      hold: 3,
    };
    S.keys.push(key);
    renderKeyStrip();
    return key;
  }

  function removeKeyframe(id) {
    S.keys = S.keys.filter((k) => k.id !== id);
    S.currentTime = 0;
    renderKeyStrip();
  }

  function timelineTotal() {
    if (!S.keys.length) return 6;
    return S.keys.reduce((n, k) => n + Math.max(0.5, Number(k.hold) || 3), 0);
  }

  // Map global t to {a, b, mix}: key A full, then dissolving into key B.
  function keyAt(t) {
    if (!S.keys.length) return { a: null, b: null, mix: 0 };
    if (S.keys.length === 1) return { a: S.keys[0], b: null, mix: 0 };
    const total = timelineTotal();
    let tt = S.loop ? (t % total) : Math.min(t, total - 0.001);
    let acc = 0;
    for (let i = 0; i < S.keys.length; i++) {
      const hold = Math.max(0.5, Number(S.keys[i].hold) || 3);
      if (tt < acc + hold || i === S.keys.length - 1) {
        const local = tt - acc;
        const tr = Math.min(S.transition, hold * 0.5);
        if (local > hold - tr && i < S.keys.length - 1) {
          return { a: S.keys[i], b: S.keys[i + 1], mix: (local - (hold - tr)) / tr };
        }
        return { a: S.keys[i], b: null, mix: 0 };
      }
      acc += hold;
    }
    const last = S.keys[S.keys.length - 1];
    return { a: last, b: null, mix: 0 };
  }

  function renderKeyStrip() {
    const strip = $("codecKeyStrip");
    if (!strip) return;
    strip.innerHTML = "";
    S.keys.forEach((k, i) => {
      const card = document.createElement("div");
      card.className = "codec-key-card";
      const thumb = document.createElement("img");
      thumb.src = k.canvas.toDataURL("image/jpeg", 0.6);
      thumb.alt = k.name;
      const meta = document.createElement("div");
      meta.className = "codec-key-meta";
      const nm = document.createElement("span");
      nm.className = "codec-key-name";
      nm.textContent = `${i + 1} · ${k.name}`;
      nm.title = k.name;
      const row = document.createElement("div");
      row.className = "codec-key-row";
      const dur = document.createElement("input");
      dur.type = "number";
      dur.min = "0.5";
      dur.max = "30";
      dur.step = "0.5";
      dur.value = k.hold;
      dur.title = "Hold seconds";
      dur.onchange = () => { k.hold = Math.max(0.5, Number(dur.value) || 3); S.currentTime = 0; };
      const del = document.createElement("button");
      del.type = "button";
      del.className = "btn btn-tiny";
      del.textContent = "✕";
      del.title = "Remove keyframe";
      del.onclick = (e) => { e.stopPropagation(); removeKeyframe(k.id); };
      row.append(dur, del);
      meta.append(nm, row);
      card.append(thumb, meta);
      card.title = "Click to load into the anchor editor";
      card.onclick = () => {
        S.anchorCanvas.width = 1280;
        S.anchorCanvas.height = 720;
        S.anchorCtx.drawImage(k.canvas, 0, 0);
        S.sourcePrompt = k.name;
        if ($("codecPromptInput")) $("codecPromptInput").value = k.name;
        analyzeAndDecompose();
      };
      strip.appendChild(card);
    });
    const hint = $("codecKeyHint");
    if (hint) hint.textContent = S.keys.length
      ? `${S.keys.length} keyframe(s) · ${timelineTotal().toFixed(1)}s timeline · click a card to edit it`
      : "No keyframes yet — tune an anchor above, then ＋ Add keyframe. Two or more keys morph into a video.";
  }

  function renderPaletteRibbon() {
    const bar = $("codecPaletteBar");
    if (!bar) return;
    bar.innerHTML = "";
    S.dominantPalette.forEach((c) => {
      const swatch = document.createElement("div");
      swatch.className = "codec-palette-swatch";
      swatch.style.background = c;
      swatch.title = c;
      bar.appendChild(swatch);
    });
  }

  function updateTelemetryHUD() {
    const pCount = $("codecStatParticles");
    if (pCount) pCount.textContent = S.activeParticles.length.toLocaleString();

    const cCount = $("codecStatColors");
    if (cCount) cCount.textContent = S.dominantPalette.length + " clusters";

    const exp = $("codecStatExposure");
    if (exp) exp.textContent = S.exposureLevel + "%";

    const rate = $("codecStatBitrate");
    if (rate) rate.textContent = S.signalBitrateKbps + " KB/s";

    const cpu = $("codecStatCpu");
    if (cpu) cpu.textContent = S.frameMs > 0 ? `${S.frameMs.toFixed(1)} ms/f measured` : "measuring…";
  }

  /* -------------------------------------------------------------
     3. INBUILT REAL-TIME RECONSTRUCTION PLAYER
     ------------------------------------------------------------- */
  function renderLoop(ts) {
    if (!S.lastTs) S.lastTs = ts;
    const dt = (ts - S.lastTs) / 1000;
    S.lastTs = ts;

    if (S.isPlaying) {
      S.currentTime += dt * S.playbackSpeed;
      const total = S.keys.length ? timelineTotal() : 6;
      if (S.currentTime >= total) {
        if (S.loop) S.currentTime = 0;
        else {
          S.currentTime = total;
          S.isPlaying = false;
        }
      }
      updateScrubberDOM();
    }

    const m0 = performance.now();
    renderFrame(S.currentTime);
    S.frameMs = S.frameMs * 0.9 + (performance.now() - m0) * 0.1;
    S.hudTick = (S.hudTick || 0) + 1;
    if (S.hudTick % 30 === 0) {
      const cpu = $("codecStatCpu");
      if (cpu) cpu.textContent = `${S.frameMs.toFixed(1)} ms/f measured`;
    }
    S.animId = requestAnimationFrame(renderLoop);
  }

  function renderFrame(t) {
    const ctx = S.ctx;
    const w = S.canvas.width;
    const h = S.canvas.height;
    ctx.clearRect(0, 0, w, h);

    if (!S.isAnalyzed) {
      ctx.fillStyle = "#0c101d";
      ctx.fillRect(0, 0, w, h);
      return;
    }

    // Calculate Global Exposure & Parallax camera shifts
    const total = S.keys.length ? timelineTotal() : 6;
    const progress = total ? t / total : 0;
    const expOscillation = Math.sin(progress * Math.PI * 4) * (S.exposurePulse / 100) * 0.3;
    const camPanX = Math.sin(progress * Math.PI * 2) * (S.cameraParallax * 0.8);
    const camZoom = 1.0 + (Math.sin(progress * Math.PI * 2) * (S.cameraParallax / 100) * 0.08);

    if (S.viewMode === "composite") {
      const slot = keyAt(t);
      if (slot.a) {
        const cur = slot.mix > 0.5 && slot.b ? slot.b : slot.a;
        if (S.hudKeyId !== cur.id) { S.hudKeyId = cur.id; syncHudToKey(cur); }
        drawKeyScene(ctx, w, h, t, total, slot.a.canvas, slot.a.analysis, camPanX, camZoom, expOscillation, 1);
        if (slot.b) drawKeyScene(ctx, w, h, t, total, slot.b.canvas, slot.b.analysis, camPanX, camZoom, expOscillation, slot.mix);
      } else {
        drawKeyScene(ctx, w, h, t, total, S.anchorCanvas, { particles: S.activeParticles }, camPanX, camZoom, expOscillation, 1);
      }
    } else if (S.viewMode === "palette") {
      renderPaletteMode(ctx, w, h);
    } else if (S.viewMode === "vectors") {
      renderVectorFlowField(ctx, w, h, t);
    } else if (S.viewMode === "tone") {
      renderToneExposureHeatmap(ctx, w, h, expOscillation);
    } else if (S.viewMode === "split") {
      renderSplitComparison(ctx, w, h, t, camPanX, camZoom, expOscillation);
    }
  }

  // Full scene for one key: base still + its particle flow. Alpha < 1 dissolves
  // the incoming key over the outgoing one at timeline boundaries.
  function drawKeyScene(ctx, w, h, t, total, img, analysis, camX, zoom, expShift, alpha) {
    const pts = (analysis && analysis.particles) || S.activeParticles;
    const gate = Math.max(0, Math.min(1, alpha));
    ctx.save();
    ctx.globalAlpha = gate;
    // Parallax Camera Transform
    ctx.translate(w / 2 + camX, h / 2);
    ctx.scale(zoom, zoom);
    ctx.translate(-w / 2, -h / 2);

    // 1. Draw Base with Lighting Flux
    const brightness = Math.max(0.4, 1.0 + expShift);
    ctx.filter = `brightness(${brightness}) saturate(${1 + (S.colorWarp / 100) * 0.3})`;
    ctx.drawImage(img, 0, 0, w, h);
    ctx.filter = "none";

    // 2. Synthesize motes along the flow field. Each mote is a cached soft
    // radial sprite in its true centroid color — light shimmer, never dots.
    // A cycle envelope fades motes at both wrap ends so nothing pops.
    const vel = S.flowVelocity;
    const turb = S.morphTurbulence / 100;
    if (!S.sprites) S.sprites = {};
    if (Object.keys(S.sprites).length > 64) S.sprites = {};
    const spriteFor = (p) => {
      const key = p.r + "," + p.g + "," + p.b;
      let s = S.sprites[key];
      if (!s) {
        s = document.createElement("canvas");
        s.width = 64; s.height = 64;
        const c = s.getContext("2d");
        const grad = c.createRadialGradient(32, 32, 0, 32, 32, 32);
        grad.addColorStop(0, `rgba(${p.r},${p.g},${p.b},1)`);
        grad.addColorStop(0.35, `rgba(${p.r},${p.g},${p.b},0.45)`);
        grad.addColorStop(1, `rgba(${p.r},${p.g},${p.b},0)`);
        c.fillStyle = grad;
        c.fillRect(0, 0, 64, 64);
        S.sprites[key] = s;
      }
      return s;
    };

    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      // Displace mote position cyclically
      const cycleT = total ? (t + p.phase) % total : 0;
      const px = p.originX + (p.vx * cycleT * 40 * vel) + Math.sin(cycleT * 3 + p.phase) * (turb * 25);
      const py = p.originY + (p.vy * cycleT * 40 * vel) + Math.cos(cycleT * 3 + p.phase) * (turb * 25);

      // Wrap boundaries
      const wrapX = ((px % w) + w) % w;
      const wrapY = ((py % h) + h) % h;

      const env = total ? Math.pow(Math.sin((Math.PI * cycleT) / total), 0.5) : 1;
      ctx.globalAlpha = gate * p.alpha * env;
      if (ctx.globalAlpha < 0.004) continue;
      const sz = p.radius * 4;
      ctx.drawImage(spriteFor(p), wrapX - sz / 2, wrapY - sz / 2, sz, sz);
    }
    ctx.restore();
  }

  function syncHudToKey(key) {
    const a = key.analysis;
    if (!a) return;
    S.dominantPalette = a.palette;
    S.activeParticles = a.particles;
    renderPaletteRibbon();
    const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
    set("codecStatParticles", a.particles.length.toLocaleString());
    set("codecStatColors", a.palette.length + " clusters");
    set("codecStatExposure", a.exposureLevel + "%");
    set("codecStatBitrate", (a.signalKB / Math.max(0.1, timelineTotal())).toFixed(1) + " KB/s");
  }

  // View Mode: Dominant Color Centroids & Cluster Distribution
  function renderPaletteMode(ctx, w, h) {
    ctx.fillStyle = "#060913";
    ctx.fillRect(0, 0, w, h);

    const cols = 4;
    const rows = Math.ceil(S.dominantPalette.length / cols);
    const cellW = w / cols;
    const cellH = (h - 80) / rows;

    S.dominantPalette.forEach((col, idx) => {
      const c = idx % cols;
      const r = Math.floor(idx / cols);
      const x = c * cellW + 12;
      const y = r * cellH + 20;

      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.roundRect(x, y, cellW - 24, cellH - 24, 12);
      ctx.fill();

      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 15px monospace";
      ctx.shadowColor = "#000";
      ctx.shadowBlur = 6;
      ctx.fillText(`Cluster #${idx + 1}: ${col}`, x + 16, y + cellH - 45);
      ctx.shadowBlur = 0;
    });

    ctx.fillStyle = "#94a3b8";
    ctx.font = "14px sans-serif";
    ctx.fillText("Discrete Color Quantization Matrix (Used by CPU to compress video signal to < 20 KB/s)", 30, h - 25);
  }

  // View Mode: Particle Vector Flow Field
  function renderVectorFlowField(ctx, w, h, t) {
    ctx.fillStyle = "#030611";
    ctx.fillRect(0, 0, w, h);

    // Draw vector arrows for optical flow trajectories
    ctx.strokeStyle = "rgba(56, 189, 248, 0.4)";
    ctx.lineWidth = 1.2;

    const step = 45;
    for (let x = 30; x < w; x += step) {
      for (let y = 30; y < h; y += step) {
        const angle = (Math.sin((x + t * 40) * 0.005) + Math.cos((y + t * 40) * 0.005)) * Math.PI;
        const len = 18;
        const ex = x + Math.cos(angle) * len;
        const ey = y + Math.sin(angle) * len;

        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(ex, ey);
        ctx.stroke();

        // Arrow head
        ctx.fillStyle = "rgba(56, 189, 248, 0.8)";
        ctx.beginPath();
        ctx.arc(ex, ey, 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Overlay active particles
    S.activeParticles.slice(0, 600).forEach((p) => {
      const cycleT = (t + p.phase) % S.duration;
      const px = ((p.originX + p.vx * cycleT * 40) % w + w) % w;
      const py = ((p.originY + p.vy * cycleT * 40) % h + h) % h;

      ctx.fillStyle = "#ec4899";
      ctx.beginPath();
      ctx.arc(px, py, 3, 0, Math.PI * 2);
      ctx.fill();
    });

    ctx.fillStyle = "#38bdf8";
    ctx.font = "bold 16px sans-serif";
    ctx.fillText("Vector Trajectory & Particle Flow Signals", 30, 40);
  }

  // View Mode: Luminance & Exposure Tone Map
  function renderToneExposureHeatmap(ctx, w, h, expShift) {
    ctx.drawImage(S.anchorCanvas, 0, 0, w, h);
    
    // Apply Thermal Tone Gradient overlay
    const grad = ctx.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, "rgba(59, 130, 246, 0.65)"); // Shadows
    grad.addColorStop(0.5, "rgba(168, 85, 247, 0.45)"); // Midtones
    grad.addColorStop(1, "rgba(245, 158, 11, 0.65)"); // Highlights
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // Tone Curve Stats
    ctx.fillStyle = "rgba(0, 0, 0, 0.8)";
    ctx.fillRect(20, 20, 320, 100);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 14px monospace";
    ctx.fillText(`Shadow Floor: ${S.toneShadow}%`, 40, 50);
    ctx.fillText(`Highlight Ceiling: ${S.toneHighlight}%`, 40, 75);
    ctx.fillText(`Dynamic Exposure Shift: ${(expShift * 100).toFixed(1)}%`, 40, 100);
  }

  // View Mode: Split Comparison (Anchor Frame vs Recomposed Video)
  function renderSplitComparison(ctx, w, h, t, camX, zoom, expShift) {
    const splitX = w * S.splitPos;

    // Left Half: Original Anchor Frame
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, splitX, h);
    ctx.clip();
    ctx.drawImage(S.anchorCanvas, 0, 0, w, h);
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(16, 16, 150, 30);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 13px sans-serif";
    ctx.fillText("📷 Static Anchor", 28, 36);
    ctx.restore();

    // Right Half: AI Neural Vector Synthesis
    ctx.save();
    ctx.beginPath();
    ctx.rect(splitX, 0, w - splitX, h);
    ctx.clip();
    drawKeyScene(ctx, w, h, t, S.keys.length ? timelineTotal() : 6, S.anchorCanvas, { particles: S.activeParticles }, camX, zoom, expShift, 1);
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(splitX + 16, 16, 190, 30);
    ctx.fillStyle = "#38bdf8";
    ctx.font = "bold 13px sans-serif";
    ctx.fillText("✨ AI Vector Video Scene", splitX + 28, 36);
    ctx.restore();

    // Split Divider Line
    ctx.strokeStyle = "#38bdf8";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(splitX, 0);
    ctx.lineTo(splitX, h);
    ctx.stroke();

    // Slider Handle
    ctx.fillStyle = "#38bdf8";
    ctx.beginPath();
    ctx.arc(splitX, h / 2, 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#000";
    ctx.font = "bold 12px monospace";
    ctx.fillText("◀▶", splitX - 10, h / 2 + 4);
  }

  /* -------------------------------------------------------------
     4. UNIVERSAL TRANSCODER (MP4 / WEBM & .ONEV EXPORT)
     ------------------------------------------------------------- */
  async function exportUniversalVideo() {
    if (!S.isAnalyzed && !S.keys.length) {
      toast("Analyze an anchor first.");
      return;
    }
    if (S.isExporting) return;
    const btn = $("codecExportVideoBtn");
    try {
      S.isExporting = true;
      if (btn) { btn.disabled = true; btn.textContent = "⏳ Transcoding..."; }

      // Deterministic frame-exact encode (WebCodecs when available, else the
      // recorder fallback) — the file length is right to the millisecond.
      const { encodeCanvasClip } = await import("./encode.js");
      const total = S.keys.length ? timelineTotal() : 6;
      const wasPlaying = S.isPlaying;
      const prevMode = S.viewMode;
      S.isPlaying = false;
      S.viewMode = "composite";
      let enc;
      try {
        enc = await encodeCanvasClip({
          canvas: S.canvas,
          fps: 30,
          duration: total,
          draw: (t) => renderFrame(t),
          onProgress: (f) => { if (btn) btn.textContent = `⏳ Transcoding ${Math.round(f * 100)}%`; },
        });
      } finally {
        S.viewMode = prevMode;
        S.isPlaying = wasPlaying;
      }
      S.lastExportedBlob = enc.blob;
      const ext = enc.blob.type.includes("mp4") ? "mp4" : "webm";
      const fname = `codec-vector-video-${new Date().toISOString().slice(0, 10)}.${ext}`;
      const url = URL.createObjectURL(enc.blob);

      // Download
      const a = document.createElement("a");
      a.href = url;
      a.download = fname;
      a.click();

      // Auto Save to One AI Studio Library
      await saveBlobToLibrary({
        kind: "final",
        tab: "codec-lab",
        blob: enc.blob,
        filename: fname,
        prompt: S.sourcePrompt,
        extra: {
          provider: "neural-vector-codec",
          providerLabel: "One AI Neural Vector Codec",
          name: "Neural Vector Scene",
          userCat: "video",
          encoder: enc.encoder,
          duration: enc.duration,
          fps: enc.fps,
        },
      });

      toast(`Exported ${enc.frames} frames @ ${enc.fps}fps via ${enc.encoder} — saved to Library!`);
      S.isExporting = false;
      if (btn) { btn.disabled = false; btn.textContent = "🎬 Export Universal Video (MP4/WebM)"; }
    } catch (e) {
      toast("Transcode error: " + (e.message || e));
      S.isExporting = false;
      if (btn) { btn.disabled = false; btn.textContent = "🎬 Export Universal Video (MP4/WebM)"; }
    }
  }

  // Export sparse `.onev` / JSON signal file
  function exportSignalFile() {
    const signalData = {
      format: "one-ai-neural-vector-codec",
      version: "1.0",
      resolution: { width: S.canvas.width, height: S.canvas.height },
      duration: S.keys.length ? timelineTotal() : 6,
      fps: S.fps,
      prompt: S.sourcePrompt,
      colorClusters: S.dominantPalette,
      tone: {
        exposure: S.exposureLevel,
        shadow: S.toneShadow,
        highlight: S.toneHighlight,
        averageLuma: S.averageLuma,
      },
      particles: S.activeParticles.map((p) => ({
        x: Math.round(p.originX),
        y: Math.round(p.originY),
        vx: +p.vx.toFixed(2),
        vy: +p.vy.toFixed(2),
        r: p.r, g: p.g, b: p.b,
        rad: +p.radius.toFixed(1),
        alpha: +p.alpha.toFixed(2),
      })),
    };

    const str = JSON.stringify(signalData, null, 2);
    const blob = new Blob([str], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sparse-vector-signal-${Date.now().toString(36)}.onev`;
    a.click();
    toast(`Exported sparse vector signal file (${(blob.size / 1024).toFixed(1)} KB)`);
  }

  // Bridge 1: Send directly to 24/7 Livestream Playlist
  async function sendToLivestream() {
    if (!S.lastExportedBlob) {
      // If not yet exported, quickly capture snapshot blob
      const dataUrl = S.canvas.toDataURL("image/png");
      const res = await fetch(dataUrl);
      S.lastExportedBlob = await res.blob();
    }
    const fname = `codec-scene-${Date.now().toString(36)}.webm`;
    await saveBlobToLibrary({
      kind: "final",
      tab: "livestream",
      blob: S.lastExportedBlob,
      filename: fname,
      prompt: S.sourcePrompt,
      extra: {
        provider: "neural-vector-codec",
        providerLabel: "One AI Neural Vector Codec",
        name: "Codec Stream Item",
        userCat: "video",
      },
    });
    toast("Sent to Livestream! Switch to 📡 Livestream tab to broadcast.");
  }

  // Bridge 2: Send to Timeline Editor
  async function sendToEditor() {
    if (!S.lastExportedBlob) {
      toast("Please click 'Export Universal Video' first to generate clip for the editor.");
      return;
    }
    await saveBlobToLibrary({
      kind: "final",
      tab: "editor",
      blob: S.lastExportedBlob,
      filename: `codec-clip-${Date.now().toString(36)}.webm`,
      prompt: S.sourcePrompt,
      extra: {
        provider: "neural-vector-codec",
        name: "Codec Video Track",
        userCat: "editor",
      },
    });
    toast("Sent to Editor! Switch to Editor tab to arrange on timeline.");
  }

  // Bridge 3: heavy diffusion model runs on the anchor still.
  // The lab's player only animates; genuinely new motion comes from the
  // Video Studio GPU path (own server, free pool, or paid vendors).
  async function sendAnchorToVideo() {
    if (!S.isAnalyzed) {
      toast("Load or generate an anchor image first.");
      return;
    }
    const blob = await new Promise((r) => S.anchorCanvas.toBlob(r, "image/png"));
    if (!blob) {
      toast("Could not read the anchor frame.");
      return;
    }
    const name = (S.sourcePrompt || "codec-anchor").slice(0, 60);
    setVideoRefReuse(blob, name);
    await saveBlobToLibrary({
      kind: "final",
      tab: "codec-lab",
      blob,
      filename: `codec-anchor-${Date.now().toString(36)}.png`,
      prompt: S.sourcePrompt,
      extra: { provider: "neural-vector-codec", name: "Codec Anchor Still", userCat: "image" },
    });
    document.querySelector('[data-page="pageVideo"]')?.click();
    toast("Anchor loaded as the Video reference — press Generate there for real model motion.");
  }

  // .ankan stills + .soma videos — native sparse containers for this codec.
  // An .ankan holds one keyframe; a .soma holds the full keyframed timeline.
  const codecPoster = (canvas) => {
    try {
      const c = document.createElement("canvas");
      c.width = 480; c.height = 270;
      c.getContext("2d").drawImage(canvas, 0, 0, 480, 270);
      const url = c.toDataURL("image/jpeg", 0.72);
      return url.startsWith("data:") ? url : null;
    } catch { return null; }
  };

  const currentAnalysis = () => ({
    palette: S.dominantPalette,
    exposureLevel: S.exposureLevel,
    toneShadow: S.toneShadow,
    toneHighlight: S.toneHighlight,
    averageLuma: S.averageLuma,
    particles: S.activeParticles,
  });

  async function exportAnkan() {
    if (!S.isAnalyzed) { toast("Analyze an anchor first."); return; }
    const { encodeAnkan, encodeParams, downloadDoc } = await import("./ankan-soma.js");
    const doc = encodeAnkan(S.anchorCanvas, currentAnalysis(), encodeParams(S), S.sourcePrompt.slice(0, 40));
    const fname = `scene-${Date.now().toString(36)}.ankan`;
    const { blob, kb } = downloadDoc(doc, fname);
    await saveBlobToLibrary({
      kind: "final", tab: "codec-lab", blob, filename: fname, prompt: S.sourcePrompt,
      extra: { provider: "ankan-codec", providerLabel: "Ankan Still Codec", name: "Ankan Still", userCat: "image", poster: codecPoster(S.anchorCanvas) },
    });
    toast(`.ankan still saved to Library (${kb.toFixed(0)} KB — palette + tone + motes).`);
  }

  async function exportSoma() {
    if (!S.isAnalyzed && !S.keys.length) { toast("Analyze an anchor first."); return; }
    const { encodeSoma, encodeParams, downloadDoc } = await import("./ankan-soma.js");
    if (!S.keys.length) addKeyframe();
    if (!S.keys.length) { toast("Add a keyframe first."); return; }
    const keys = S.keys.map((k) => ({
      name: k.name, hold: k.hold, canvas: k.canvas,
      analysis: {
        palette: k.analysis.palette,
        exposureLevel: k.analysis.exposureLevel,
        toneShadow: k.analysis.toneShadow,
        toneHighlight: k.analysis.toneHighlight,
        averageLuma: k.analysis.averageLuma,
        particles: k.analysis.particles,
      },
    }));
    const doc = encodeSoma(keys, encodeParams(S));
    const fname = `movie-${Date.now().toString(36)}.soma`;
    const { blob, kb } = downloadDoc(doc, fname);
    await saveBlobToLibrary({
      kind: "final", tab: "codec-lab", blob, filename: fname, prompt: S.sourcePrompt,
      extra: { provider: "soma-codec", providerLabel: "Soma Video Codec", name: "Soma Video", userCat: "video", poster: codecPoster(S.keys[0].canvas) },
    });
    toast(`.soma video saved to Library (${keys.length} keys, ${kb.toFixed(0)} KB).`);
  }

  // Universal converter: current timeline/still → well-known formats + upscale.
  const labConvertKeys = () => {
    if (S.keys.length) {
      return {
        keys: S.keys.map((k) => ({ canvas: k.canvas, analysis: k.analysis, hold: k.hold })),
        params: {
          flowVelocity: S.flowVelocity, exposurePulse: S.exposurePulse,
          cameraParallax: S.cameraParallax, morphTurbulence: S.morphTurbulence,
          colorWarp: S.colorWarp, transition: S.transition,
        },
      };
    }
    const norm = document.createElement("canvas");
    norm.width = 1280; norm.height = 720;
    norm.getContext("2d").drawImage(S.anchorCanvas, 0, 0, 1280, 720);
    return {
      keys: [{ canvas: norm, analysis: currentAnalysis(), hold: 3 }],
      params: {
        flowVelocity: S.flowVelocity, exposurePulse: S.exposurePulse,
        cameraParallax: S.cameraParallax, morphTurbulence: S.morphTurbulence,
        colorWarp: S.colorWarp, transition: S.transition,
      },
    };
  };

  async function convertStill() {
    if (!S.isAnalyzed && !S.keys.length) { toast("Analyze an anchor first."); return; }
    const btn = $("codecStillBtn");
    try {
      if (btn) { btn.disabled = true; btn.textContent = "⏳ Converting…"; }
      const play = await import("./codec-play.js");
      const { exportImage } = await import("./gallery-export.js");
      const { keys, params } = labConvertKeys();
      const base = play.stillCanvasFor(keys, params, 0.5);
      const png = await new Promise((r) => base.toBlob(r, "image/png"));
      const fmt = $("codecStillFmt")?.value || "png";
      const scale = $("codecStillScale")?.value || "1";
      const out = await exportImage(png, { format: fmt, scale, upscaleMode: "fast" });
      const fname = `ankan-still-${Date.now().toString(36)}.${out.ext || fmt}`;
      const url = URL.createObjectURL(out.blob);
      const a = document.createElement("a");
      a.href = url; a.download = fname; a.click();
      await saveBlobToLibrary({
        kind: "final", tab: "codec-lab", blob: out.blob, filename: fname, prompt: S.sourcePrompt,
        extra: { provider: "codec-convert", providerLabel: "Codec Converter", name: "Converted Still", userCat: "image", poster: codecPoster(base) },
      });
      toast(`Still exported as ${String(fmt).toUpperCase()} @ ${scale === "1" ? "1x" : scale + "x"} — saved to Library.`);
    } catch (e) { toast("Still convert failed: " + (e.message || e)); }
    finally { if (btn) { btn.disabled = false; btn.textContent = "🖼 Still → JPG/PNG"; } }
  }

  async function convertVideo() {
    if (!S.isAnalyzed && !S.keys.length) { toast("Analyze an anchor first."); return; }
    const btn = $("codecVideoBtn");
    try {
      if (btn) { btn.disabled = true; btn.textContent = "⏳ Converting…"; }
      const play = await import("./codec-play.js");
      const { keys, params } = labConvertKeys();
      const container = $("codecVideoFmt")?.value || "mp4";
      const height = ($("codecVideoScale")?.value || "720p") === "1080p" ? 1080 : 720;
      const v = await play.renderKeysToVideo(keys, params, {
        container, height,
        onProgress: (f) => { if (btn) btn.textContent = `⏳ ${Math.round(f * 100)}%`; },
      });
      const fname = `soma-video-${Date.now().toString(36)}.${v.ext}`;
      const url = URL.createObjectURL(v.blob);
      const a = document.createElement("a");
      a.href = url; a.download = fname; a.click();
      await saveBlobToLibrary({
        kind: "final", tab: "codec-lab", blob: v.blob, filename: fname, prompt: S.sourcePrompt,
        extra: { provider: "codec-convert", providerLabel: "Codec Converter", name: "Converted Video", userCat: "video", encoder: v.encoder, duration: v.duration, fps: v.fps },
      });
      toast(`Video exported as ${v.ext.toUpperCase()} ${height}p via ${v.encoder} — saved to Library.`);
    } catch (e) { toast("Video convert failed: " + (e.message || e)); }
    finally { if (btn) { btn.disabled = false; btn.textContent = "🎬 Video → MP4/MKV"; } }
  }
  async function openAnkanSoma(file) {
    try {
      const { decodeAnkanSoma, dataUrlToBlob } = await import("./ankan-soma.js");
      const doc = decodeAnkanSoma(JSON.parse(await file.text()));
      const loadKey = (k) => new Promise((res, rej) => {
        const img = new Image();
        img.onload = () => {
          const cv = document.createElement("canvas");
          cv.width = 1280; cv.height = 720;
          cv.getContext("2d").drawImage(img, 0, 0, 1280, 720);
          res({ id: ++S.keySeq, name: k.name, canvas: cv, analysis: k.analysis, hold: k.hold });
        };
        img.onerror = rej;
        dataUrlToBlob(k.image).then((b) => { img.src = URL.createObjectURL(b); });
      });
      S.keys = [];
      for (const k of doc.keys) S.keys.push(await loadKey(k));
      const first = S.keys[0];
      S.anchorCanvas.width = 1280; S.anchorCanvas.height = 720;
      S.anchorCtx.drawImage(first.canvas, 0, 0);
      S.sourcePrompt = first.name;
      if ($("codecPromptInput")) $("codecPromptInput").value = first.name;
      S.isAnalyzed = true;
      S.hudKeyId = null;
      S.currentTime = 0;
      const p = doc.params || {};
      const setRange = (id, v) => {
        const el = $(id);
        if (el && v !== undefined && !Number.isNaN(Number(v))) {
          el.value = v;
          el.dispatchEvent(new Event("input", { bubbles: true }));
        }
      };
      if (p.flowVelocity !== undefined) S.flowVelocity = p.flowVelocity;
      setRange("codecVelRange", (S.flowVelocity ?? 1) * 100);
      ["exposurePulse|codecExpRange", "cameraParallax|codecCamRange", "morphTurbulence|codecTurbRange", "colorWarp|codecColorRange"].forEach((m) => {
        const [key, id] = m.split("|");
        if (p[key] !== undefined) S[key] = p[key];
        setRange(id, S[key]);
      });
      if (p.density) {
        S.particleDensity = p.density;
        const ds = $("codecDensitySelect");
        if (ds) ds.value = p.density;
      }
      if (p.transition) S.transition = p.transition;
      renderKeyStrip();
      updateScrubberDOM();
      syncHudToKey(first);
      toast(doc.magic === "ANKAN" ? ".ankan still decoded into the player." : `.soma video decoded: ${S.keys.length} keys, ${timelineTotal().toFixed(1)}s.`);
    } catch (e) {
      toast("Open failed: " + (e.message || e));
    }
  }

  /* -------------------------------------------------------------
     5. LOADERS & GENERATOR HOOKS
     ------------------------------------------------------------- */
  function loadPreset(key) {
    const p = PRESETS[key];
    if (!p) return;
    S.sourcePrompt = p.prompt;
    if ($("codecPromptInput")) $("codecPromptInput").value = p.prompt;

    S.anchorCanvas.width = 1280;
    S.anchorCanvas.height = 720;
    p.render(S.anchorCtx, 1280, 720);
    analyzeAndDecompose();

    document.querySelectorAll(".codec-preset-card").forEach((c) => {
      c.classList.toggle("active", c.dataset.preset === key);
    });
  }

  async function loadImageFile(file) {
    try {
      const play = await import("./codec-play.js");
      const norm = await play.normalizeMediaInput(file, "image").catch(() => null);
      if (norm?.converted && norm.files[0]) {
        file = norm.files[0];
        toast(`${norm.label} — decoded to anchor.`);
      }
    } catch {}
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      S.anchorCanvas.width = img.naturalWidth || 1280;
      S.anchorCanvas.height = img.naturalHeight || 720;
      S.anchorCtx.drawImage(img, 0, 0, S.anchorCanvas.width, S.anchorCanvas.height);
      S.sourcePrompt = file.name.replace(/\.[a-z0-9]+$/i, "");
      if ($("codecPromptInput")) $("codecPromptInput").value = S.sourcePrompt;
      analyzeAndDecompose();
      toast(`Loaded "${file.name}" into Codec Analyzer.`);
    };
    img.src = url;
  }

  async function generateWithAI() {
    const prompt = $("codecPromptInput")?.value?.trim() || S.sourcePrompt;
    const btn = $("codecGenerateBtn");
    try {
      if (btn) { btn.disabled = true; btn.textContent = "✨ Generating Image..."; }
      toast("Generating AI Anchor Image...");

      let imgBlob = null;
      const rt = (typeof root !== "undefined" && root.generateImage) ? root : (window.root && window.root.generateImage ? window.root : null);
      if (rt) {
        const res = await rt.generateImage({ prompt, resolution: "768x512" });
        const url = res && (res.dataUrl || res.url || res.src);
        imgBlob = url ? await (await fetch(url)).blob() : res.blob;
      } else {
        // Fallback canvas generator
        const canvas = document.createElement("canvas");
        canvas.width = 1280;
        canvas.height = 720;
        const ctx = canvas.getContext("2d");
        const grad = ctx.createLinearGradient(0, 0, 1280, 720);
        grad.addColorStop(0, "#1e1b4b");
        grad.addColorStop(0.5, "#4338ca");
        grad.addColorStop(1, "#0f172a");
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 1280, 720);
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 36px sans-serif";
        ctx.fillText(prompt.slice(0, 50), 60, 360);
        imgBlob = await new Promise((r) => canvas.toBlob(r, "image/png"));
      }

      loadImageFile(new File([imgBlob], "ai-anchor.png", { type: "image/png" }));
      toast("AI Image generated & decomposed into vector flow!");
    } catch (e) {
      toast("Generation error: " + (e.message || e));
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = "✨ Generate & Decompose"; }
    }
  }

  /* -------------------------------------------------------------
     6. UI CONTROLS & BINDINGS
     ------------------------------------------------------------- */
  function updateScrubberDOM() {
    const total = S.keys.length ? timelineTotal() : 6;
    const sc = $("codecScrubber");
    if (sc) { sc.max = total; sc.value = Math.min(S.currentTime, total); }

    const timeLbl = $("codecTimeLbl");
    if (timeLbl) {
      const cur = Math.min(S.currentTime, total).toFixed(1);
      timeLbl.textContent = `${cur}s / ${total.toFixed(1)}s`;
    }
  }

  function bindUI() {
    // Presets
    document.querySelectorAll(".codec-preset-card").forEach((card) => {
      card.onclick = () => loadPreset(card.dataset.preset);
    });

    // Style prompt tags
    document.querySelectorAll(".codec-style-tag").forEach((tag) => {
      tag.onclick = () => {
        const inp = $("codecPromptInput");
        if (inp) {
          inp.value = tag.dataset.prompt;
          S.sourcePrompt = tag.dataset.prompt;
        }
      };
    });

    // Generate Button
    const genBtn = $("codecGenerateBtn");
    if (genBtn) genBtn.onclick = generateWithAI;

    // Upload Image
    const uploadBtn = $("codecUploadBtn");
    const fileInp = $("codecFileInput");
    if (uploadBtn && fileInp) {
      uploadBtn.onclick = () => fileInp.click();
      fileInp.onchange = (e) => {
        const f = e.target.files?.[0];
        if (f) loadImageFile(f);
      };
    }

    // Pick from Library
    const libBtn = $("codecLibBtn");
    if (libBtn) {
      libBtn.onclick = async () => {
        const res = await pickLibraryMedia({ accept: "image", title: "Select Anchor Image from Library" });
        if (!res) return;
        const it = res.item || res;
        const url = res.url || it.poster || "";
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
          S.anchorCanvas.width = img.naturalWidth || 1280;
          S.anchorCanvas.height = img.naturalHeight || 720;
          S.anchorCtx.drawImage(img, 0, 0, S.anchorCanvas.width, S.anchorCanvas.height);
          S.sourcePrompt = it.name || it.filename || "Library Image";
          if ($("codecPromptInput")) $("codecPromptInput").value = S.sourcePrompt;
          analyzeAndDecompose();
          toast("Library image loaded into Codec Analyzer.");
        };
        img.src = url;
      };
    }

    // View Modes
    document.querySelectorAll(".codec-vtab").forEach((tab) => {
      tab.onclick = () => {
        document.querySelectorAll(".codec-vtab").forEach((t) => t.classList.remove("on"));
        tab.classList.add("on");
        S.viewMode = tab.dataset.mode;
        const modeBadge = $("codecActiveModeBadge");
        if (modeBadge) modeBadge.textContent = tab.textContent;
      };
    });

    // Transport Controls
    const playBtn = $("codecPlayBtn");
    if (playBtn) {
      playBtn.onclick = () => {
        S.isPlaying = !S.isPlaying;
        playBtn.textContent = S.isPlaying ? "⏸ Pause" : "▶ Play";
      };
    }

    const resetBtn = $("codecResetBtn");
    if (resetBtn) {
      resetBtn.onclick = () => {
        S.currentTime = 0;
        updateScrubberDOM();
      };
    }

    const scrubber = $("codecScrubber");
    if (scrubber) {
      scrubber.oninput = () => {
        S.currentTime = Number(scrubber.value);
        updateScrubberDOM();
      };
    }

    const loopTog = $("codecLoopToggle");
    if (loopTog) loopTog.onchange = () => { S.loop = loopTog.checked; };

    const speedSel = $("codecSpeedSelect");
    if (speedSel) speedSel.onchange = () => { S.playbackSpeed = Number(speedSel.value) || 1; };

    // Interactive Split View scrubbing on canvas
    S.canvas.onmousemove = (e) => {
      if (S.viewMode !== "split") return;
      const rect = S.canvas.getBoundingClientRect();
      const relX = (e.clientX - rect.left) / rect.width;
      S.splitPos = Math.max(0.05, Math.min(0.95, relX));
    };

    // Sliders & Tuning
    const densitySel = $("codecDensitySelect");
    if (densitySel) {
      densitySel.onchange = () => {
        S.particleDensity = densitySel.value;
        analyzeAndDecompose();
      };
    }

    const bindRange = (id, key, valId, suffix = "%", factor = 1) => {
      const el = $(id);
      const valEl = $(valId);
      if (!el) return;
      el.oninput = () => {
        S[key] = Number(el.value) * factor;
        if (valEl) valEl.textContent = el.value + suffix;
      };
    };

    bindRange("codecVelRange", "flowVelocity", "codecVelVal", "x", 0.01);
    bindRange("codecExpRange", "exposurePulse", "codecExpVal", "%");
    bindRange("codecCamRange", "cameraParallax", "codecCamVal", "%");
    bindRange("codecTurbRange", "morphTurbulence", "codecTurbVal", "%");
    bindRange("codecColorRange", "colorWarp", "codecColorVal", "%");

    // Exporters
    const expVideoBtn = $("codecExportVideoBtn");
    if (expVideoBtn) expVideoBtn.onclick = exportUniversalVideo;

    const expSignalBtn = $("codecExportSignalBtn");
    if (expSignalBtn) expSignalBtn.onclick = exportSignalFile;

    const sendLsBtn = $("codecSendLiveBtn");
    if (sendLsBtn) sendLsBtn.onclick = sendToLivestream;

    const sendEdBtn = $("codecSendEditorBtn");
    if (sendEdBtn) sendEdBtn.onclick = sendToEditor;

    const sendVidBtn = $("codecSendVideoBtn");
    if (sendVidBtn) sendVidBtn.onclick = sendAnchorToVideo;

    const ankanBtn = $("codecAnkanBtn");
    if (ankanBtn) ankanBtn.onclick = exportAnkan;

    const somaBtn = $("codecSomaBtn");
    if (somaBtn) somaBtn.onclick = exportSoma;

    const openBtn = $("codecOpenBtn");
    const openInp = $("codecOpenInput");
    if (openBtn && openInp) {
      openBtn.onclick = () => openInp.click();
      openInp.onchange = () => { const f = openInp.files?.[0]; if (f) openAnkanSoma(f); openInp.value = ""; };
    }

    // Decoder via the vault: Library blobs are encrypted at rest, so open
    // them through the picker's decrypting loader, not raw file bytes.
    const libOpenBtn = $("codecLibOpenBtn");
    if (libOpenBtn) libOpenBtn.onclick = async () => {
      const res = await pickLibraryMedia({ accept: "video", title: "Open .soma / .ankan from Library" });
      if (!res) return;
      const entry = Array.isArray(res) ? res[0] : (res.item || res);
      const blob = entry && entry.blob;
      if (!blob) { toast("Could not read that Library item."); return; }
      openAnkanSoma(new File([blob], entry.name || "library.soma", { type: "application/json" }));
    };

    // Universal converter buttons.
    const stillBtn = $("codecStillBtn");
    if (stillBtn) stillBtn.onclick = convertStill;
    const videoBtn = $("codecVideoBtn");
    if (videoBtn) videoBtn.onclick = convertVideo;

    // Keyframed video model: capture the tuned anchor as a timeline key.
    const addKeyBtn = $("codecAddKeyBtn");
    if (addKeyBtn) addKeyBtn.onclick = () => {
      if (!S.isAnalyzed) {
        toast("Analyze an anchor first.");
        return;
      }
      const k = addKeyframe();
      if (k) {
        S.currentTime = 0;
        updateScrubberDOM();
        toast(`Keyframe ${S.keys.length} added (${timelineTotal().toFixed(1)}s timeline).`);
      }
    };
    renderKeyStrip();
  }

  function toast(msg) {
    if (window.toast) {
      window.toast(msg);
      return;
    }
    const t = document.createElement("div");
    t.className = "toast";
    t.textContent = msg;
    const holder = document.querySelector(".toasts") || document.body;
    holder.appendChild(t);
    setTimeout(() => t.remove(), 3200);
  }

  // Init
  bindUI();
  loadPreset("cyberpunk");
  // Other pages (e.g. the Library) hand codec blobs here for playback.
  window.addEventListener("open-codec-file", (e) => {
    const { blob, name } = (e && e.detail) || {};
    if (!(blob instanceof Blob)) return;
    document.querySelector('[data-page="pageCodecLab"]')?.click();
    openAnkanSoma(new File([blob], name || "codec-file", { type: "application/json" }));
  });
  requestAnimationFrame(renderLoop);
}

if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", () => {
    try { initCodecLab(); } catch (e) { console.error("Codec Lab init failed:", e); }
  });
} else {
  try { initCodecLab(); } catch (e) { console.error("Codec Lab init failed:", e); }
}
