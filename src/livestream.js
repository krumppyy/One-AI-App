// One AI Studio - 24/7 Livestream & OBS Virtual Studio Engine
import { saveBlobToLibrary } from "./library-save.js";
import { pickLibraryMedia } from "./lib-picker.js";

const $ = (id) => document.getElementById(id);

export function initLivestream() {
  const container = $("pageLivestream");
  if (!container) return;

  // State
  const S = {
    isLive: false,
    liveStartTime: 0,
    liveTimerInterval: null,
    sourceMode: "camera", // 'camera', 'screen', 'playlist', 'hybrid'
    
    // Hardware Camera
    camStream: null,
    camFacing: "user", // 'user' | 'environment'
    camRes: "1080p",
    camFps: 60,
    camAutoFocus: true,
    camDevices: [],
    selectedCamId: "",

    // Screen Share
    screenStream: null,
    screenAudioTrack: null,

    // Face Beautification
    beautifyOn: true,
    smoothSkin: 45, // 0 - 100
    skinGlow: 30, // 0 - 100
    skinWarmth: 20, // 0 - 100
    eyeRadiance: 35, // 0 - 100

    // Color Grading & Filters
    activeFilter: "natural", // 'natural', 'teal-orange', 'golden', 'cyberpunk', 'noir', 'vhs', 'pastel', 'emerald'
    filterIntensity: 100,
    exposure: 0, // -50 to 50
    contrast: 0, // -50 to 50
    saturation: 0, // -50 to 50
    warmth: 0, // -50 to 50
    vignette: 15, // 0 to 100
    grain: 0, // 0 to 100

    // OBS Chroma Key / Background Replacement
    chromaEnabled: false,
    chromaColor: "green", // 'green', 'blue', 'red', 'white', 'black', 'custom'
    customChromaHex: "#00ff00",
    chromaThreshold: 45, // 0 - 100
    chromaSmooth: 20, // 0 - 100
    bgType: "gradient", // 'gradient', 'image', 'video', 'screen', 'blur'
    bgGradient: "cosmic",
    bgMediaUrl: "",
    bgMediaBlob: null,
    bgVideoEl: null,
    bgImgEl: null,

    // Picture-in-Picture (PiP)
    pipEnabled: true,
    pipPosition: "br", // 'br', 'bl', 'tr', 'tl', 'split'
    pipScale: 28, // 15 - 50 %

    // 24/7 Looping Playlist
    playlist: [
      {
        id: "demo-1",
        title: "One AI Studio Stream Welcome",
        type: "gradient",
        url: "",
        duration: 10,
        badge: "INTRO",
      }
    ],
    currentIndex: 0,
    isPlaying: false,
    loop247: true,
    shuffle: false,
    autoAdvanceTimer: null,
    playlistVideoEl: null,
    playlistImgEl: null,

    // Audio Mixer
    audioCtx: null,
    micGain: null,
    micAnalyser: null,
    playlistGain: null,
    masterGain: null,
    micVolume: 85,
    playlistVolume: 75,
    micMuted: false,
    playlistMuted: false,

    // Recording & Output
    recorder: null,
    recordedChunks: [],
    isRecording: false,
    recordStartTime: 0,
    recordInterval: null,

    // Compositor
    canvas: null,
    ctx: null,
    outVideoEl: null,
    animFrameId: null,
    lowerThirdText: "One AI Studio 24/7 Live Broadcast",
    lowerThirdSub: "Multi-Source · OBS Virtual Engine · Beautification On",
  };

  // Hidden video elements for processing
  const camVideo = document.createElement("video");
  camVideo.autoplay = true;
  camVideo.playsInline = true;
  camVideo.muted = true;

  const screenVideo = document.createElement("video");
  screenVideo.autoplay = true;
  screenVideo.playsInline = true;
  screenVideo.muted = true;

  const playVideo = document.createElement("video");
  playVideo.autoplay = true;
  playVideo.playsInline = true;
  playVideo.crossOrigin = "anonymous";
  S.playlistVideoEl = playVideo;

  const bgVideo = document.createElement("video");
  bgVideo.autoplay = true;
  bgVideo.loop = true;
  bgVideo.playsInline = true;
  bgVideo.muted = true;
  bgVideo.crossOrigin = "anonymous";
  S.bgVideoEl = bgVideo;

  const tempCanvas = document.createElement("canvas");
  const tempCtx = tempCanvas.getContext("2d", { willReadFrequently: true });

  // Initialize UI References
  S.canvas = $("lsCompositorCanvas");
  if (!S.canvas) return;
  S.ctx = S.canvas.getContext("2d", { alpha: false });
  S.canvas.width = 1920;
  S.canvas.height = 1080;

  // Setup Hidden Monitor Video for Picture-in-Picture
  S.outVideoEl = document.createElement("video");
  S.outVideoEl.autoplay = true;
  S.outVideoEl.muted = true;
  S.outVideoEl.playsInline = true;
  S.outVideoEl.style.display = "none";
  document.body.appendChild(S.outVideoEl);

  try {
    const stream = S.canvas.captureStream(60);
    S.outVideoEl.srcObject = stream;
  } catch {}

  /* -------------------------------------------------------------
     1. CAMERA HARDWARE & FOCUS
     ------------------------------------------------------------- */
  async function enumerateCameras() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      S.camDevices = devices.filter((d) => d.kind === "videoinput");
      const sel = $("lsCamSelect");
      if (sel) {
        sel.innerHTML = "";
        if (!S.camDevices.length) {
          sel.innerHTML = '<option value="">Default Camera</option>';
        } else {
          S.camDevices.forEach((d, idx) => {
            const opt = document.createElement("option");
            opt.value = d.deviceId;
            opt.textContent = d.label || `Camera ${idx + 1} (${d.deviceId.slice(0, 5)}…)`;
            sel.appendChild(opt);
          });
        }
      }
    } catch {}
  }

  async function startCamera() {
    if (S.camStream) {
      S.camStream.getTracks().forEach((t) => t.stop());
      S.camStream = null;
    }
    const width = S.camRes === "4k" ? 3840 : S.camRes === "720p" ? 1280 : 1920;
    const height = S.camRes === "4k" ? 2160 : S.camRes === "720p" ? 720 : 1080;
    
    const constraints = {
      video: {
        deviceId: S.selectedCamId ? { exact: S.selectedCamId } : undefined,
        facingMode: S.selectedCamId ? undefined : S.camFacing,
        width: { ideal: width },
        height: { ideal: height },
        frameRate: { ideal: S.camFps },
      },
      audio: true,
    };

    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      S.camStream = stream;
      camVideo.srcObject = stream;
      await camVideo.play().catch(() => {});
      
      // Auto-Focus constraint application
      const track = stream.getVideoTracks()[0];
      if (track && S.camAutoFocus) {
        try {
          const caps = track.getCapabilities?.();
          if (caps?.focusMode?.includes("continuous")) {
            await track.applyConstraints({ advanced: [{ focusMode: "continuous" }] });
          }
        } catch {}
      }

      setupAudioNodes();
      updateStatusDisplay();
      await enumerateCameras();
    } catch (err) {
      console.warn("Camera start failed, falling back to basic stream:", err);
      try {
        const fbStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        S.camStream = fbStream;
        camVideo.srcObject = fbStream;
        await camVideo.play().catch(() => {});
        setupAudioNodes();
      } catch (err2) {
        toast("Camera permission denied or camera unavailable.");
      }
    }
  }

  /* -------------------------------------------------------------
     2. SCREEN SHARING (OBS MODE)
     ------------------------------------------------------------- */
  async function startScreenShare() {
    if (S.screenStream) {
      S.screenStream.getTracks().forEach((t) => t.stop());
      S.screenStream = null;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: "monitor", frameRate: 60 },
        audio: true,
      });
      S.screenStream = stream;
      screenVideo.srcObject = stream;
      await screenVideo.play();
      
      stream.getVideoTracks()[0].onended = () => {
        S.screenStream = null;
        if (S.sourceMode === "screen") {
          setSourceMode("camera");
        }
      };

      toast("Screen sharing connected.");
    } catch (e) {
      toast("Screen share cancelled.");
    }
  }

  /* -------------------------------------------------------------
     3. AUDIO MIXING & REAL-TIME LED PEAK METER
     ------------------------------------------------------------- */
  function setupAudioNodes() {
    try {
      if (!S.audioCtx) {
        S.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (S.audioCtx.state === "suspended") {
        S.audioCtx.resume();
      }

      // Mic node
      if (S.camStream && S.camStream.getAudioTracks().length) {
        const micSource = S.audioCtx.createMediaStreamSource(S.camStream);
        S.micGain = S.audioCtx.createGain();
        S.micAnalyser = S.audioCtx.createAnalyser();
        S.micAnalyser.fftSize = 64;
        
        micSource.connect(S.micGain);
        S.micGain.connect(S.micAnalyser);

        S.micGain.gain.value = S.micMuted ? 0 : S.micVolume / 100;
      }
    } catch (e) {
      console.warn("Audio init warning:", e);
    }
  }

  function updateAudioMeters() {
    if (!S.micAnalyser || S.micMuted) {
      const bar = $("lsMicMeter");
      if (bar) bar.style.width = "0%";
      return;
    }
    const data = new Uint8Array(S.micAnalyser.frequencyBinCount);
    S.micAnalyser.getByteFrequencyData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i];
    const avg = sum / data.length;
    const pct = Math.min(100, Math.round((avg / 128) * 100));
    const bar = $("lsMicMeter");
    if (bar) bar.style.width = pct + "%";
  }

  /* -------------------------------------------------------------
     4. COMPOSITOR & OBS PIP RENDERING LOOP
     ------------------------------------------------------------- */
  function getChromaRGB() {
    switch (S.chromaColor) {
      case "blue": return [0, 100, 255];
      case "red": return [230, 20, 20];
      case "white": return [240, 240, 240];
      case "black": return [15, 15, 15];
      case "custom": {
        const hex = S.customChromaHex.replace("#", "");
        return [
          parseInt(hex.slice(0, 2), 16) || 0,
          parseInt(hex.slice(2, 4), 16) || 255,
          parseInt(hex.slice(4, 6), 16) || 0,
        ];
      }
      case "green":
      default: return [0, 255, 0];
    }
  }

  // Draw background layer (Gradient, Image, Video, or Screen Share)
  function renderBackground(ctx, w, h) {
    if (S.bgType === "gradient") {
      const grad = ctx.createLinearGradient(0, 0, w, h);
      if (S.bgGradient === "emerald") {
        grad.addColorStop(0, "#022c22");
        grad.addColorStop(1, "#064e3b");
      } else if (S.bgGradient === "sunset") {
        grad.addColorStop(0, "#451a03");
        grad.addColorStop(1, "#7c2d12");
      } else if (S.bgGradient === "slate") {
        grad.addColorStop(0, "#0f172a");
        grad.addColorStop(1, "#1e293b");
      } else {
        // cosmic violet
        grad.addColorStop(0, "#0a071b");
        grad.addColorStop(0.5, "#180e3b");
        grad.addColorStop(1, "#030209");
      }
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
    } else if (S.bgType === "video" && bgVideo.readyState >= 2) {
      ctx.drawImage(bgVideo, 0, 0, w, h);
    } else if (S.bgType === "image" && S.bgImgEl && S.bgImgEl.complete) {
      ctx.drawImage(S.bgImgEl, 0, 0, w, h);
    } else if (S.bgType === "screen" && S.screenStream && screenVideo.readyState >= 2) {
      ctx.drawImage(screenVideo, 0, 0, w, h);
    } else {
      ctx.fillStyle = "#090a10";
      ctx.fillRect(0, 0, w, h);
    }
  }

  // Draw Chroma Keyed Camera Frame with Beautification & Color Grading
  function renderCameraWithChroma(ctx, x, y, w, h) {
    if (camVideo.readyState < 2) return;

    if (!S.chromaEnabled) {
      ctx.save();
      // Apply CSS-like filter parameters on canvas context
      applyCanvasFilters(ctx);
      ctx.drawImage(camVideo, x, y, w, h);
      ctx.restore();
      return;
    }

    // Chroma Key Processing via offscreen canvas
    tempCanvas.width = w;
    tempCanvas.height = h;
    tempCtx.save();
    applyCanvasFilters(tempCtx);
    tempCtx.drawImage(camVideo, 0, 0, w, h);
    tempCtx.restore();

    const imgData = tempCtx.getImageData(0, 0, w, h);
    const d = imgData.data;
    const [kr, kg, kb] = getChromaRGB();
    const thresh = (S.chromaThreshold / 100) * 255;
    const smooth = (S.chromaSmooth / 100) * 128;

    const isWhite = S.chromaColor === "white";
    const isBlack = S.chromaColor === "black";

    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      
      let diff = 0;
      if (isWhite) {
        diff = 255 - ((r + g + b) / 3);
      } else if (isBlack) {
        diff = (r + g + b) / 3;
      } else {
        const dr = r - kr;
        const dg = g - kg;
        const db = b - kb;
        diff = Math.sqrt(dr * dr + dg * dg + db * db);
      }

      if (diff < thresh) {
        d[i + 3] = 0; // Transparent
      } else if (diff < thresh + smooth && smooth > 0) {
        d[i + 3] = Math.round(((diff - thresh) / smooth) * 255);
      }
    }

    tempCtx.putImageData(imgData, 0, 0);
    ctx.drawImage(tempCanvas, x, y, w, h);
  }

  // Canvas filter pipeline: Beautification + Cinematic Presets + Tuning
  function applyCanvasFilters(c) {
    const filters = [];

    // 1. Exposure / Brightness
    const b = 100 + (S.exposure * 1.2) + (S.beautifyOn ? S.skinGlow * 0.25 : 0);
    filters.push(`brightness(${Math.max(20, Math.round(b))}%)`);

    // 2. Contrast
    const ct = 100 + S.contrast + (S.beautifyOn ? S.eyeRadiance * 0.15 : 0);
    filters.push(`contrast(${Math.max(30, Math.round(ct))}%)`);

    // 3. Saturation
    let sat = 100 + S.saturation;
    if (S.activeFilter === "noir") sat = 0;
    if (S.activeFilter === "cyberpunk") sat += 45;
    if (S.activeFilter === "golden") sat += 20;
    filters.push(`saturate(${Math.max(0, Math.round(sat))}%)`);

    // 4. Color Warmth / Hue
    if (S.warmth !== 0 || S.activeFilter === "golden") {
      const w = S.warmth + (S.activeFilter === "golden" ? 25 : 0);
      filters.push(`sepia(${Math.min(60, Math.max(0, Math.round(w)))}%)`);
    }

    // 5. Inbuilt Face Beautification: Soft smoothing blur
    if (S.beautifyOn && S.smoothSkin > 0) {
      // Soft focus glow blur
      const blurPx = (S.smoothSkin / 100) * 1.5;
      if (blurPx > 0.4) {
        filters.push(`blur(${blurPx.toFixed(1)}px)`);
      }
    }

    c.filter = filters.join(" ");
  }

  // Draw Vignette and Grain
  function renderOverlays(ctx, w, h) {
    // Vignette
    if (S.vignette > 0) {
      const vig = ctx.createRadialGradient(w / 2, h / 2, w * 0.35, w / 2, h / 2, w * 0.72);
      vig.addColorStop(0, "rgba(0,0,0,0)");
      vig.addColorStop(1, `rgba(0,0,0,${(S.vignette / 100).toFixed(2)})`);
      ctx.fillStyle = vig;
      ctx.fillRect(0, 0, w, h);
    }

    // Film Grain simulation
    if (S.grain > 0) {
      ctx.fillStyle = `rgba(255,255,255,${((S.grain / 100) * 0.06).toFixed(3)})`;
      for (let i = 0; i < 40; i++) {
        const gx = Math.random() * w;
        const gy = Math.random() * h;
        const gw = Math.random() * 8 + 4;
        const gh = Math.random() * 8 + 4;
        ctx.fillRect(gx, gy, gw, gh);
      }
    }

    // Lower Third Graphic
    if (S.lowerThirdText) {
      ctx.save();
      const ltX = 50;
      const ltY = h - 140;
      const ltW = Math.min(750, w - 100);
      const ltH = 80;

      // Glow & glass backing
      ctx.fillStyle = "rgba(10, 14, 28, 0.85)";
      ctx.strokeStyle = "rgba(59, 130, 246, 0.5)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(ltX, ltY, ltW, ltH, 12);
      ctx.fill();
      ctx.stroke();

      // Brand accent bar
      ctx.fillStyle = "#3b82f6";
      ctx.beginPath();
      ctx.roundRect(ltX, ltY, 8, ltH, [12, 0, 0, 12]);
      ctx.fill();

      // Text
      ctx.font = "bold 26px sans-serif";
      ctx.fillStyle = "#ffffff";
      ctx.fillText(S.lowerThirdText, ltX + 28, ltY + 38);

      ctx.font = "500 17px sans-serif";
      ctx.fillStyle = "#94a3b8";
      ctx.fillText(S.lowerThirdSub, ltX + 28, ltY + 65);
      ctx.restore();
    }
  }

  // Master Compositor animation frame
  function compositorLoop() {
    const w = S.canvas.width;
    const h = S.canvas.height;
    const ctx = S.ctx;

    ctx.clearRect(0, 0, w, h);

    // Step 1: Render Background
    renderBackground(ctx, w, h);

    // Step 2: Render Main Sources according to selected mode
    if (S.sourceMode === "camera") {
      renderCameraWithChroma(ctx, 0, 0, w, h);
    } else if (S.sourceMode === "screen") {
      if (S.screenStream && screenVideo.readyState >= 2) {
        ctx.drawImage(screenVideo, 0, 0, w, h);
      } else {
        // Fallback display
        ctx.fillStyle = "#0c101d";
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = "#94a3b8";
        ctx.font = "bold 32px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("📡 Click 'Connect Screen Share' to start OBS screen streaming", w / 2, h / 2);
        ctx.textAlign = "start";
      }

      // If PiP is enabled, render Webcam in corner!
      if (S.pipEnabled && S.camStream && camVideo.readyState >= 2) {
        renderPiP(ctx, w, h, camVideo);
      }
    } else if (S.sourceMode === "playlist") {
      renderPlaylistMedia(ctx, w, h);

      // If PiP is enabled, render Webcam over Playlist!
      if (S.pipEnabled && S.camStream && camVideo.readyState >= 2) {
        renderPiP(ctx, w, h, camVideo);
      }
    } else if (S.sourceMode === "hybrid") {
      // Background + Screen Share + Chroma Camera
      if (S.screenStream && screenVideo.readyState >= 2) {
        ctx.drawImage(screenVideo, 0, 0, w, h);
      }
      renderCameraWithChroma(ctx, 0, 0, w, h);
    }

    // Step 3: Vignette, Grain, Lower-Third Overlays
    renderOverlays(ctx, w, h);

    // Audio Meter update
    updateAudioMeters();

    S.animFrameId = requestAnimationFrame(compositorLoop);
  }

  // Render PiP Window
  function renderPiP(ctx, w, h, source) {
    const scale = S.pipScale / 100;
    const pipW = Math.round(w * scale);
    const pipH = Math.round(pipW * (9 / 16));
    const pad = 40;

    let px = w - pipW - pad;
    let py = h - pipH - pad;

    if (S.pipPosition === "bl") {
      px = pad; py = h - pipH - pad;
    } else if (S.pipPosition === "tr") {
      px = w - pipW - pad; py = pad;
    } else if (S.pipPosition === "tl") {
      px = pad; py = pad;
    }

    ctx.save();
    // PiP frame shadow & border
    ctx.shadowColor = "rgba(0,0,0,0.85)";
    ctx.shadowBlur = 24;
    ctx.strokeStyle = "rgba(255,255,255,0.3)";
    ctx.lineWidth = 3;

    ctx.beginPath();
    ctx.roundRect(px, py, pipW, pipH, 16);
    ctx.stroke();
    ctx.clip();

    ctx.drawImage(source, px, py, pipW, pipH);
    ctx.restore();
  }

  /* -------------------------------------------------------------
     5. 24/7 LOOPING MULTI-MEDIA PLAYLIST ENGINE
     ------------------------------------------------------------- */
  function renderPlaylistMedia(ctx, w, h) {
    const item = S.playlist[S.currentIndex];
    if (!item) {
      ctx.fillStyle = "#0c101d";
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#94a3b8";
      ctx.font = "bold 32px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Playlist is empty. Add videos, images, or social streams below.", w / 2, h / 2);
      ctx.textAlign = "start";
      return;
    }

    if (item.type === "video" && S.playlistVideoEl.readyState >= 2) {
      ctx.drawImage(S.playlistVideoEl, 0, 0, w, h);
    } else if (item.type === "image" && S.playlistImgEl && S.playlistImgEl.complete) {
      ctx.drawImage(S.playlistImgEl, 0, 0, w, h);
    } else if (item.type === "gradient") {
      const grad = ctx.createLinearGradient(0, 0, w, h);
      grad.addColorStop(0, "#1e1b4b");
      grad.addColorStop(1, "#312e81");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#e0e7ff";
      ctx.font = "bold 44px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(item.title, w / 2, h / 2 - 20);
      ctx.font = "24px sans-serif";
      ctx.fillStyle = "#a5b4fc";
      ctx.fillText("24/7/365 Continuous Looping Livestream Active", w / 2, h / 2 + 35);
      ctx.textAlign = "start";
    }
  }

  function playPlaylistItem(idx) {
    clearTimeout(S.autoAdvanceTimer);
    if (!S.playlist.length) return;

    S.currentIndex = (idx + S.playlist.length) % S.playlist.length;
    const it = S.playlist[S.currentIndex];
    renderPlaylistDOM();

    if (it.type === "video") {
      S.playlistVideoEl.src = it.url;
      S.playlistVideoEl.play().catch(() => {});
      S.playlistVideoEl.onended = () => {
        advancePlaylist();
      };
    } else if (it.type === "image") {
      if (!S.playlistImgEl) S.playlistImgEl = new Image();
      S.playlistImgEl.crossOrigin = "anonymous";
      S.playlistImgEl.src = it.url;
      // Auto-advance image based on duration (default 10s)
      const dur = (it.duration || 10) * 1000;
      S.autoAdvanceTimer = setTimeout(advancePlaylist, dur);
    } else {
      const dur = (it.duration || 10) * 1000;
      S.autoAdvanceTimer = setTimeout(advancePlaylist, dur);
    }
  }

  function advancePlaylist() {
    if (!S.playlist.length) return;
    if (S.shuffle) {
      const next = Math.floor(Math.random() * S.playlist.length);
      playPlaylistItem(next);
      return;
    }
    if (S.currentIndex === S.playlist.length - 1 && !S.loop247) {
      toast("Playlist finished.");
      return;
    }
    playPlaylistItem(S.currentIndex + 1);
  }

  function addMediaToPlaylist(file) {
    const isVid = file.type.startsWith("video/");
    const isImg = file.type.startsWith("image/");
    if (!isVid && !isImg) return;

    const url = URL.createObjectURL(file);
    const item = {
      id: "media-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      title: file.name.replace(/\.[a-z0-9]+$/i, ""),
      type: isVid ? "video" : "image",
      url,
      duration: isVid ? 0 : 10,
      badge: isVid ? "VIDEO" : "IMAGE",
    };
    S.playlist.push(item);
    renderPlaylistDOM();
    toast(`Added "${item.title}" to 24/7 playlist.`);
    if (S.playlist.length === 1 || S.sourceMode === "playlist") {
      playPlaylistItem(S.playlist.length - 1);
    }
  }

  function renderPlaylistDOM() {
    const list = $("lsPlaylistContainer");
    if (!list) return;
    list.innerHTML = "";

    S.playlist.forEach((it, idx) => {
      const row = document.createElement("div");
      row.className = `ls-playlist-item ${idx === S.currentIndex ? "active" : ""}`;
      
      const thumb = it.type === "image" ? `<img class="ls-item-thumb" src="${it.url}">` :
                    it.type === "video" ? `<div class="ls-item-thumb" style="display:flex;align-items:center;justify-content:center;background:#1e293b;color:#38bdf8">🎬</div>` :
                    `<div class="ls-item-thumb" style="display:flex;align-items:center;justify-content:center;background:#312e81;color:#a5b4fc">✨</div>`;

      row.innerHTML = `
        ${thumb}
        <div class="ls-item-info">
          <span class="ls-item-title" title="${it.title}">${it.title}</span>
          <div class="ls-item-meta">
            <span class="ls-item-badge">${it.badge}</span>
            <span>${it.type === "image" ? it.duration + "s" : it.type === "video" ? "Full Length" : "Continuous"}</span>
          </div>
        </div>
        <div class="ls-item-actions">
          <button class="btn btn-tiny ls-btn-up" title="Move Up">▲</button>
          <button class="btn btn-tiny ls-btn-down" title="Move Down">▼</button>
          <button class="btn btn-tiny ls-btn-rename" title="Rename">✏️</button>
          <button class="btn btn-tiny ls-btn-del" title="Remove">✕</button>
        </div>
      `;

      row.onclick = (e) => {
        if (e.target.closest("button")) return;
        playPlaylistItem(idx);
      };

      row.querySelector(".ls-btn-up").onclick = () => {
        if (idx > 0) {
          const temp = S.playlist[idx - 1];
          S.playlist[idx - 1] = S.playlist[idx];
          S.playlist[idx] = temp;
          if (S.currentIndex === idx) S.currentIndex = idx - 1;
          renderPlaylistDOM();
        }
      };

      row.querySelector(".ls-btn-down").onclick = () => {
        if (idx < S.playlist.length - 1) {
          const temp = S.playlist[idx + 1];
          S.playlist[idx + 1] = S.playlist[idx];
          S.playlist[idx] = temp;
          if (S.currentIndex === idx) S.currentIndex = idx + 1;
          renderPlaylistDOM();
        }
      };

      row.querySelector(".ls-btn-rename").onclick = () => {
        const name = prompt("Rename playlist item:", it.title);
        if (name && name.trim()) {
          it.title = name.trim();
          renderPlaylistDOM();
        }
      };

      row.querySelector(".ls-btn-del").onclick = () => {
        S.playlist.splice(idx, 1);
        if (S.currentIndex >= S.playlist.length) S.currentIndex = 0;
        renderPlaylistDOM();
        if (S.playlist.length) playPlaylistItem(S.currentIndex);
      };

      list.appendChild(row);
    });

    const count = $("lsPlaylistCount");
    if (count) count.textContent = `${S.playlist.length} item${S.playlist.length === 1 ? "" : "s"}`;
  }

  /* -------------------------------------------------------------
     6. LIVE BROADCAST TIMER (24/7/365 ENGINE)
     ------------------------------------------------------------- */
  function toggleLiveBroadcast() {
    S.isLive = !S.isLive;
    const btn = $("lsToggleLiveBtn");
    const tag = $("lsLiveStatusTag");
    
    if (S.isLive) {
      S.liveStartTime = Date.now();
      if (btn) {
        btn.textContent = "⏹ Stop Broadcast";
        btn.classList.add("btn-danger");
      }
      if (tag) {
        tag.classList.add("is-live");
        tag.innerHTML = '<span class="dot"></span> LIVE 24/7';
      }
      toast("🔴 24/7 Livestream is now LIVE!");

      clearInterval(S.liveTimerInterval);
      S.liveTimerInterval = setInterval(updateLiveTimer, 1000);
    } else {
      clearInterval(S.liveTimerInterval);
      if (btn) {
        btn.textContent = "🔴 Start 24/7 Livestream";
        btn.classList.remove("btn-danger");
      }
      if (tag) {
        tag.classList.remove("is-live");
        tag.innerHTML = '<span class="dot"></span> STANDBY';
      }
      toast("Livestream stopped.");
    }
  }

  function updateLiveTimer() {
    if (!S.isLive) return;
    const diff = Math.floor((Date.now() - S.liveStartTime) / 1000);
    const days = Math.floor(diff / 86400);
    const hrs = Math.floor((diff % 86400) / 3600);
    const mins = Math.floor((diff % 3600) / 60);
    const secs = diff % 60;

    const pad = (n) => String(n).padStart(2, "0");
    const text = days > 0 ? `${days}d ${pad(hrs)}:${pad(mins)}:${pad(secs)}` : `${pad(hrs)}:${pad(mins)}:${pad(secs)}`;
    const timer = $("lsLiveTimeVal");
    if (timer) timer.textContent = text;
  }

  /* -------------------------------------------------------------
     7. LIVE STREAM RECORDING & SNAPSHOT
     ------------------------------------------------------------- */
  function toggleLiveRecording() {
    if (S.isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  }

  function startRecording() {
    try {
      const stream = S.canvas.captureStream(60);
      
      // Combine with audio track if available
      if (S.camStream && S.camStream.getAudioTracks().length) {
        stream.addTrack(S.camStream.getAudioTracks()[0]);
      }

      let mimeType = "video/webm;codecs=vp9,opus";
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = "video/webm";
      }

      S.recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 6000000 });
      S.recordedChunks = [];

      S.recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) S.recordedChunks.push(e.data);
      };

      S.recorder.onstop = async () => {
        const blob = new Blob(S.recordedChunks, { type: mimeType });
        const url = URL.createObjectURL(blob);
        const fname = `one-ai-livestream-${new Date().toISOString().slice(0, 10)}-${Date.now().toString(36)}.webm`;

        // Direct Download
        const a = document.createElement("a");
        a.href = url;
        a.download = fname;
        a.click();

        // Auto Save to One AI Studio Library
        await saveBlobToLibrary({
          kind: "final",
          tab: "livestream",
          blob,
          filename: fname,
          prompt: "24/7 Livestream recording",
          extra: {
            provider: "one-ai-livestream",
            providerLabel: "One AI Studio Livestream",
            name: "Livestream Record " + new Date().toLocaleTimeString(),
            userCat: "video",
          },
        });

        toast("Live recording finished & saved to Library!");
      };

      S.recorder.start(1000);
      S.isRecording = true;
      S.recordStartTime = Date.now();
      const btn = $("lsRecordBtn");
      if (btn) {
        btn.textContent = "⏹ Stop Record";
        btn.classList.add("btn-danger");
      }
      toast("⏺ Recording livestream...");
    } catch (e) {
      toast("Recording failed: " + (e.message || e));
    }
  }

  function stopRecording() {
    if (S.recorder && S.isRecording) {
      S.recorder.stop();
      S.isRecording = false;
      const btn = $("lsRecordBtn");
      if (btn) {
        btn.textContent = "⏺ Record";
        btn.classList.remove("btn-danger");
      }
    }
  }

  async function takeHDSnapshot() {
    try {
      const dataUrl = S.canvas.toDataURL("image/png");
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      const fname = `one-ai-snapshot-${Date.now().toString(36)}.png`;

      // Download
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = fname;
      a.click();

      // Auto-save to Library
      await saveBlobToLibrary({
        kind: "final",
        tab: "livestream",
        blob,
        filename: fname,
        prompt: "Livestream HD Snapshot",
        extra: {
          provider: "one-ai-livestream",
          providerLabel: "One AI Studio Livestream",
          name: "HD Snapshot " + new Date().toLocaleTimeString(),
          userCat: "image",
        },
      });

      toast("HD Snapshot saved & downloaded!");
    } catch (e) {
      toast("Snapshot failed.");
    }
  }

  async function toggleBrowserPiP() {
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
        toast("Browser PiP closed.");
      } else if (S.outVideoEl) {
        await S.outVideoEl.requestPictureInPicture();
        toast("Floating 24/7 stream opened in browser Picture-in-Picture!");
      }
    } catch (e) {
      toast("Picture-in-Picture not supported or blocked: " + (e.message || e));
    }
  }

  function updateStatusDisplay() {
    const res = $("lsResVal");
    if (res) res.textContent = `${S.camRes.toUpperCase()} @ ${S.camFps}fps`;
  }

  function setSourceMode(mode) {
    S.sourceMode = mode;
    document.querySelectorAll(".ls-source-btn").forEach((b) => {
      b.classList.toggle("on", b.dataset.source === mode);
    });

    if (mode === "camera" && !S.camStream) {
      startCamera();
    } else if (mode === "screen" && !S.screenStream) {
      startScreenShare();
    } else if (mode === "playlist" && S.playlist.length) {
      playPlaylistItem(S.currentIndex);
    }
  }

  /* -------------------------------------------------------------
     8. BIND EVENT LISTENERS & CONTROLS
     ------------------------------------------------------------- */
  function bindUI() {
    // Mode Switcher
    document.querySelectorAll(".ls-source-btn").forEach((btn) => {
      btn.onclick = () => setSourceMode(btn.dataset.source);
    });

    // Subtabs (Camera, Beautification, Chroma, Playlist, Audio)
    document.querySelectorAll(".ls-subtab").forEach((tab) => {
      tab.onclick = () => {
        document.querySelectorAll(".ls-subtab").forEach((t) => t.classList.remove("on"));
        document.querySelectorAll(".ls-tab-pane").forEach((p) => p.hidden = true);
        tab.classList.add("on");
        const target = $(tab.dataset.target);
        if (target) target.hidden = false;
      };
    });

    // Camera Selector & Facing
    const camSel = $("lsCamSelect");
    if (camSel) camSel.onchange = () => {
      S.selectedCamId = camSel.value;
      startCamera();
    };

    const flipBtn = $("lsFlipCamBtn");
    if (flipBtn) flipBtn.onclick = () => {
      S.camFacing = S.camFacing === "user" ? "environment" : "user";
      S.selectedCamId = "";
      startCamera();
      toast(`Switched to ${S.camFacing === "user" ? "Front" : "Back / Environment"} Camera.`);
    };

    const resSel = $("lsResSelect");
    if (resSel) resSel.onchange = () => {
      S.camRes = resSel.value;
      startCamera();
    };

    const fpsSel = $("lsFpsSelect");
    if (fpsSel) fpsSel.onchange = () => {
      S.camFps = Number(fpsSel.value) || 60;
      startCamera();
    };

    const afToggle = $("lsAutoFocusToggle");
    if (afToggle) afToggle.onchange = () => {
      S.camAutoFocus = afToggle.checked;
      toast(`Auto-focus ${S.camAutoFocus ? "Enabled (Continuous)" : "Locked"}`);
    };

    // Screen Share Connect
    const scBtn = $("lsConnectScreenBtn");
    if (scBtn) scBtn.onclick = startScreenShare;

    // Beautification Sliders
    const bToggle = $("lsBeautifyToggle");
    if (bToggle) bToggle.onchange = () => { S.beautifyOn = bToggle.checked; };

    const bindRange = (id, key, valId, suffix = "%") => {
      const el = $(id);
      const valEl = $(valId);
      if (!el) return;
      el.oninput = () => {
        S[key] = Number(el.value);
        if (valEl) valEl.textContent = S[key] + suffix;
      };
    };

    bindRange("lsSmoothRange", "smoothSkin", "lsSmoothVal");
    bindRange("lsGlowRange", "skinGlow", "lsGlowVal");
    bindRange("lsWarmthRange", "skinWarmth", "lsWarmthVal");
    bindRange("lsEyeRange", "eyeRadiance", "lsEyeVal");

    const resetBeauty = $("lsResetBeautyBtn");
    if (resetBeauty) resetBeauty.onclick = () => {
      S.smoothSkin = 45; S.skinGlow = 30; S.skinWarmth = 20; S.eyeRadiance = 35;
      if ($("lsSmoothRange")) $("lsSmoothRange").value = 45;
      if ($("lsSmoothVal")) $("lsSmoothVal").textContent = "45%";
      if ($("lsGlowRange")) $("lsGlowRange").value = 30;
      if ($("lsGlowVal")) $("lsGlowVal").textContent = "30%";
      if ($("lsWarmthRange")) $("lsWarmthRange").value = 20;
      if ($("lsWarmthVal")) $("lsWarmthVal").textContent = "20%";
      if ($("lsEyeRange")) $("lsEyeRange").value = 35;
      if ($("lsEyeVal")) $("lsEyeVal").textContent = "35%";
    };

    // Color Filters & Tuning
    document.querySelectorAll(".ls-preset-chip").forEach((chip) => {
      chip.onclick = () => {
        document.querySelectorAll(".ls-preset-chip").forEach((c) => c.classList.remove("on"));
        chip.classList.add("on");
        S.activeFilter = chip.dataset.filter;
      };
    });

    bindRange("lsExposureRange", "exposure", "lsExposureVal");
    bindRange("lsContrastRange", "contrast", "lsContrastVal");
    bindRange("lsSatRange", "saturation", "lsSatVal");
    bindRange("lsTempRange", "warmth", "lsTempVal");
    bindRange("lsVignetteRange", "vignette", "lsVignetteVal");
    bindRange("lsGrainRange", "grain", "lsGrainVal");

    const resetColors = $("lsResetColorBtn");
    if (resetColors) resetColors.onclick = () => {
      S.exposure = 0; S.contrast = 0; S.saturation = 0; S.warmth = 0; S.vignette = 15; S.grain = 0;
      S.activeFilter = "natural";
      document.querySelectorAll(".ls-preset-chip").forEach((c) => c.classList.toggle("on", c.dataset.filter === "natural"));
    };

    // Chroma Key Controls
    const chromaToggle = $("lsChromaToggle");
    if (chromaToggle) chromaToggle.onchange = () => { S.chromaEnabled = chromaToggle.checked; };

    document.querySelectorAll(".ls-chroma-btn").forEach((btn) => {
      btn.onclick = () => {
        document.querySelectorAll(".ls-chroma-btn").forEach((b) => b.classList.remove("on"));
        btn.classList.add("on");
        S.chromaColor = btn.dataset.color;
      };
    });

    const customColor = $("lsCustomColorInput");
    if (customColor) customColor.oninput = () => {
      S.customChromaHex = customColor.value;
      S.chromaColor = "custom";
      document.querySelectorAll(".ls-chroma-btn").forEach((b) => b.classList.toggle("on", b.dataset.color === "custom"));
    };

    bindRange("lsChromaThreshRange", "chromaThreshold", "lsChromaThreshVal");
    bindRange("lsChromaSmoothRange", "chromaSmooth", "lsChromaSmoothVal");

    // Background replacement choice
    const bgSel = $("lsBgTypeSelect");
    if (bgSel) bgSel.onchange = () => {
      S.bgType = bgSel.value;
      $("lsBgGradRow").hidden = S.bgType !== "gradient";
      $("lsBgUploadRow").hidden = S.bgType !== "image" && S.bgType !== "video";
    };

    const bgGradSel = $("lsBgGradSelect");
    if (bgGradSel) bgGradSel.onchange = () => { S.bgGradient = bgGradSel.value; };

    // Upload Background
    const bgFileInput = $("lsBgFileInput");
    if (bgFileInput) bgFileInput.onchange = (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const url = URL.createObjectURL(file);
      if (file.type.startsWith("video/")) {
        S.bgType = "video";
        bgVideo.src = url;
        bgVideo.play();
      } else {
        S.bgType = "image";
        if (!S.bgImgEl) S.bgImgEl = new Image();
        S.bgImgEl.src = url;
      }
      toast(`Custom background "${file.name}" applied.`);
    };

    // Pick Background from One AI Studio Library
    const bgLibBtn = $("lsBgLibPickBtn");
    if (bgLibBtn) bgLibBtn.onclick = async () => {
      const res = await pickLibraryMedia({ accept: "all", title: "Select Background from Library" });
      if (!res) return;
      const it = res.item || res;
      if (it.video || String(it.mime || "").startsWith("video/")) {
        S.bgType = "video";
        bgVideo.src = res.url || (it.video ? URL.createObjectURL(it.video) : "");
        bgVideo.play();
      } else {
        S.bgType = "image";
        if (!S.bgImgEl) S.bgImgEl = new Image();
        S.bgImgEl.src = res.url || it.poster || "";
      }
      toast("Library media set as background!");
    };

    // PiP Controls
    const pipToggle = $("lsPipToggle");
    if (pipToggle) pipToggle.onchange = () => { S.pipEnabled = pipToggle.checked; };

    const pipPosSel = $("lsPipPosSelect");
    if (pipPosSel) pipPosSel.onchange = () => { S.pipPosition = pipPosSel.value; };

    bindRange("lsPipScaleRange", "pipScale", "lsPipScaleVal");

    // 24/7 Looping Playlist Controls
    const addMediaBtn = $("lsAddMediaBtn");
    const mediaInput = $("lsMediaFileInput");
    if (addMediaBtn && mediaInput) {
      addMediaBtn.onclick = () => mediaInput.click();
      mediaInput.onchange = (e) => {
        const files = Array.from(e.target.files || []);
        files.forEach(addMediaToPlaylist);
      };
    }

    const importLibBtn = $("lsImportLibBtn");
    if (importLibBtn) {
      importLibBtn.onclick = async () => {
        const res = await pickLibraryMedia({ accept: "all", multi: true, title: "Import Clips to 24/7 Playlist" });
        if (!res) return;
        const items = Array.isArray(res) ? res : [res];
        items.forEach((entry) => {
          const it = entry.item || entry;
          const isVid = String(it.mime || "").startsWith("video/") || it.video;
          const url = entry.url || (it.video ? URL.createObjectURL(it.video) : it.poster || "");
          S.playlist.push({
            id: "lib-" + (it.id || Date.now()),
            title: it.name || it.filename || "Library Clip",
            type: isVid ? "video" : "image",
            url,
            duration: isVid ? 0 : 10,
            badge: "LIBRARY",
          });
        });
        renderPlaylistDOM();
        toast(`Imported ${items.length} item(s) to 24/7 playlist.`);
      };
    }

    // Add Social Stream (YouTube / Twitch / HLS)
    const addStreamBtn = $("lsAddStreamBtn");
    if (addStreamBtn) {
      addStreamBtn.onclick = () => {
        const url = prompt("Enter video stream URL, YouTube, Twitch, or direct MP4/HLS link:");
        if (!url || !url.trim()) return;
        const u = url.trim();
        let title = "Stream " + (S.playlist.length + 1);
        let badge = "STREAM";

        if (u.includes("youtube.com") || u.includes("youtu.be")) {
          title = "YouTube Video Stream";
          badge = "YOUTUBE";
        } else if (u.includes("twitch.tv")) {
          title = "Twitch Live Stream";
          badge = "TWITCH";
        }

        S.playlist.push({
          id: "stream-" + Date.now().toString(36),
          title,
          type: "video",
          url: u,
          duration: 0,
          badge,
        });
        renderPlaylistDOM();
        toast("Stream added to playlist.");
      };
    }

    const loopToggle = $("lsLoop247Toggle");
    if (loopToggle) loopToggle.onchange = () => {
      S.loop247 = loopToggle.checked;
      toast(`24/7 Looping ${S.loop247 ? "Enabled (Infinite Repeat)" : "Disabled"}`);
    };

    const shuffleToggle = $("lsShuffleToggle");
    if (shuffleToggle) shuffleToggle.onchange = () => {
      S.shuffle = shuffleToggle.checked;
    };

    const clearPlBtn = $("lsClearPlaylistBtn");
    if (clearPlBtn) clearPlBtn.onclick = () => {
      if (confirm("Clear entire 24/7 playlist?")) {
        S.playlist = [];
        renderPlaylistDOM();
      }
    };

    // Lower Third Controls
    const ltInput = $("lsLowerThirdInput");
    if (ltInput) ltInput.oninput = () => { S.lowerThirdText = ltInput.value; };
    const ltSubInput = $("lsLowerThirdSubInput");
    if (ltSubInput) ltSubInput.oninput = () => { S.lowerThirdSub = ltSubInput.value; };

    // Audio Mixer
    const micVol = $("lsMicVolume");
    if (micVol) micVol.oninput = () => {
      S.micVolume = Number(micVol.value);
      if (S.micGain && !S.micMuted) S.micGain.gain.value = S.micVolume / 100;
    };

    const micMute = $("lsMicMuteBtn");
    if (micMute) micMute.onclick = () => {
      S.micMuted = !S.micMuted;
      micMute.classList.toggle("btn-danger", S.micMuted);
      micMute.textContent = S.micMuted ? "Unmute Mic" : "Mute";
      if (S.micGain) S.micGain.gain.value = S.micMuted ? 0 : S.micVolume / 100;
    };

    // Master Broadcast Actions
    const liveBtn = $("lsToggleLiveBtn");
    if (liveBtn) liveBtn.onclick = toggleLiveBroadcast;

    const recBtn = $("lsRecordBtn");
    if (recBtn) recBtn.onclick = toggleLiveRecording;

    const snapBtn = $("lsSnapshotBtn");
    if (snapBtn) snapBtn.onclick = takeHDSnapshot;

    const pipBtn = $("lsBrowserPipBtn");
    if (pipBtn) pipBtn.onclick = toggleBrowserPiP;

    const fsBtn = $("lsFullscreenBtn");
    if (fsBtn) fsBtn.onclick = () => {
      const wrap = $("lsMonitorWrap");
      if (wrap) {
        if (!document.fullscreenElement) wrap.requestFullscreen();
        else document.exitFullscreen();
      }
    };
  }

  // Toast Helper
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

  // Initial Boot
  bindUI();
  renderPlaylistDOM();
  compositorLoop();
  startCamera();
}

window.addEventListener("DOMContentLoaded", () => {
  try {
    initLivestream();
  } catch (e) {
    console.error("Livestream init failed:", e);
  }
});
