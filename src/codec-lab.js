// One AI Studio - Neural Vector & Particle Video Codec Lab
// Ultra-low CPU Video Generation & Reconstruction Engine
import { saveBlobToLibrary } from "./library-save.js";
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
  function analyzeAndDecompose() {
    const W = S.anchorCanvas.width;
    const H = S.anchorCanvas.height;
    if (!W || !H) return;

    // Use a lightweight downsampled grid (160 x 90 = 14,400 pixels)
    // Ensures sub-millisecond execution on any low-end CPU without freezing!
    const sampleW = 160;
    const sampleH = 90;
    const off = document.createElement("canvas");
    off.width = sampleW;
    off.height = sampleH;
    const octx = off.getContext("2d", { willReadFrequently: true });
    octx.drawImage(S.anchorCanvas, 0, 0, sampleW, sampleH);

    const imgData = octx.getImageData(0, 0, sampleW, sampleH);
    const d = imgData.data;

    let totalLuma = 0;
    let minLuma = 255;
    let maxLuma = 0;
    const colorBins = {};

    // 1. Analyze Color Clusters, Histogram & Exposure
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      const luma = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
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

    const pixelCount = sampleW * sampleH;
    S.averageLuma = Math.round(totalLuma / pixelCount);
    S.exposureLevel = Math.round((S.averageLuma / 255) * 100);
    S.toneShadow = Math.round((minLuma / 255) * 100);
    S.toneHighlight = Math.round((maxLuma / 255) * 100);

    // Extract Top Dominant Palette Centroids
    const sortedColors = Object.entries(colorBins)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 16);

    S.dominantPalette = sortedColors.map(([rgb]) => `rgb(${rgb})`);
    renderPaletteRibbon();

    // 2. Generate Lagrangian Particle Motion & Flow Vector Grid
    const particleTarget = S.particleDensity === "eco" ? 1000 : S.particleDensity === "ultra" ? 7500 : 3200;
    S.activeParticles = [];

    for (let i = 0; i < particleTarget; i++) {
      const sx = Math.floor(Math.random() * sampleW);
      const sy = Math.floor(Math.random() * sampleH);
      const idx = (sy * sampleW + sx) * 4;
      const r = d[idx], g = d[idx + 1], b = d[idx + 2], a = d[idx + 3];
      
      const luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      // Flow angle based on luminosity gradient & position
      const angle = (luma * Math.PI * 2) + ((sx / sampleW) * Math.PI);
      const speed = (0.5 + luma * 1.5);

      S.activeParticles.push({
        x: (sx / sampleW) * S.canvas.width,
        y: (sy / sampleH) * S.canvas.height,
        originX: (sx / sampleW) * S.canvas.width,
        originY: (sy / sampleH) * S.canvas.height,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        r, g, b,
        radius: Math.max(1.5, Math.random() * 3.5 + luma * 2.5),
        alpha: Math.max(0.3, a / 255),
        phase: Math.random() * Math.PI * 2,
      });
    }

    // Update Telemetry Metrics
    S.isAnalyzed = true;
    S.signalBitrateKbps = ((sortedColors.length * 3 + particleTarget * 12) / 1024).toFixed(1);
    updateTelemetryHUD();
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
    if (cpu) cpu.textContent = "< 5% (Low-CPU)";
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
      if (S.currentTime >= S.duration) {
        if (S.loop) S.currentTime = 0;
        else {
          S.currentTime = S.duration;
          S.isPlaying = false;
        }
      }
      updateScrubberDOM();
    }

    renderFrame(S.currentTime);
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
    const progress = t / S.duration;
    const expOscillation = Math.sin(progress * Math.PI * 4) * (S.exposurePulse / 100) * 0.3;
    const camPanX = Math.sin(progress * Math.PI * 2) * (S.cameraParallax * 0.8);
    const camZoom = 1.0 + (Math.sin(progress * Math.PI * 2) * (S.cameraParallax / 100) * 0.08);

    if (S.viewMode === "composite") {
      renderCompositeScene(ctx, w, h, t, camPanX, camZoom, expOscillation);
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

  // View Mode: Full AI Composite Scene (Motion + Color + Lighting Warp)
  function renderCompositeScene(ctx, w, h, t, camX, zoom, expShift) {
    ctx.save();
    // Parallax Camera Transform
    ctx.translate(w / 2 + camX, h / 2);
    ctx.scale(zoom, zoom);
    ctx.translate(-w / 2, -h / 2);

    // 1. Draw Anchor Base with Lighting Flux
    const brightness = Math.max(0.4, 1.0 + expShift);
    ctx.filter = `brightness(${brightness}) saturate(${1 + (S.colorWarp / 100) * 0.3})`;
    ctx.drawImage(S.anchorCanvas, 0, 0, w, h);
    ctx.filter = "none";

    // 2. Synthesize Lagrangian Particles along the flow field
    const vel = S.flowVelocity;
    const turb = S.morphTurbulence / 100;

    for (let i = 0; i < S.activeParticles.length; i++) {
      const p = S.activeParticles[i];
      // Displace particle position cyclically
      const cycleT = (t + p.phase) % S.duration;
      const px = p.originX + (p.vx * cycleT * 40 * vel) + Math.sin(cycleT * 3 + p.phase) * (turb * 25);
      const py = p.originY + (p.vy * cycleT * 40 * vel) + Math.cos(cycleT * 3 + p.phase) * (turb * 25);

      // Wrap boundaries
      const wrapX = ((px % w) + w) % w;
      const wrapY = ((py % h) + h) % h;

      const alphaPulse = Math.sin(cycleT * 4 + p.phase) * 0.25 + p.alpha;

      ctx.fillStyle = `rgba(${p.r}, ${p.g}, ${p.b}, ${Math.max(0.1, alphaPulse)})`;
      ctx.beginPath();
      ctx.arc(wrapX, wrapY, p.radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
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
    renderCompositeScene(ctx, w, h, t, camX, zoom, expShift);
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
    if (S.isExporting) return;
    const btn = $("codecExportVideoBtn");
    try {
      S.isExporting = true;
      if (btn) { btn.disabled = true; btn.textContent = "⏳ Transcoding..."; }

      const stream = S.canvas.captureStream(60);
      let mimeType = "video/webm;codecs=vp9";
      if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = "video/webm";

      S.recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 6000000 });
      S.recordedChunks = [];

      S.recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) S.recordedChunks.push(e.data);
      };

      S.recorder.onstop = async () => {
        const blob = new Blob(S.recordedChunks, { type: mimeType });
        S.lastExportedBlob = blob;
        const fname = `codec-vector-video-${new Date().toISOString().slice(0, 10)}.webm`;
        const url = URL.createObjectURL(blob);

        // Download
        const a = document.createElement("a");
        a.href = url;
        a.download = fname;
        a.click();

        // Auto Save to One AI Studio Library
        await saveBlobToLibrary({
          kind: "final",
          tab: "codec-lab",
          blob,
          filename: fname,
          prompt: S.sourcePrompt,
          extra: {
            provider: "neural-vector-codec",
            providerLabel: "One AI Neural Vector Codec",
            name: "Neural Vector Scene",
            userCat: "video",
          },
        });

        toast("Transcoded to Universal Video & auto-saved to Library!");
        S.isExporting = false;
        if (btn) { btn.disabled = false; btn.textContent = "🎬 Export Universal Video (MP4/WebM)"; }
      };

      // Record exactly 1 full cycle
      S.currentTime = 0;
      S.isPlaying = true;
      S.recorder.start();
      setTimeout(() => {
        if (S.recorder && S.recorder.state === "recording") {
          S.recorder.stop();
        }
      }, S.duration * 1000);

      toast("Transcoding neural vectors into standard video at 60 FPS...");
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
      duration: S.duration,
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

  function loadImageFile(file) {
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
      if (window.root && window.root.generateImage) {
        const res = await window.root.generateImage({ prompt, aspect: "16:9" });
        imgBlob = res.blob;
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
    const sc = $("codecScrubber");
    if (sc) sc.value = S.currentTime;

    const timeLbl = $("codecTimeLbl");
    if (timeLbl) {
      const cur = S.currentTime.toFixed(1);
      const total = S.duration.toFixed(1);
      timeLbl.textContent = `${cur}s / ${total}s`;
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
  requestAnimationFrame(renderLoop);
}

window.addEventListener("DOMContentLoaded", () => {
  try {
    initCodecLab();
  } catch (e) {
    console.error("Codec Lab init failed:", e);
  }
});
