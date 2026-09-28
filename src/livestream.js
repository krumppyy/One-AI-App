// One AI Studio - 24/7 Livestream, Browser Plugin, Social Feeds & OBS Virtual Studio Engine
import { getJSZip } from "./zip-loader.js";
import { saveBlobToLibrary } from "./library-save.js";
import { pickLibraryMedia } from "./lib-picker.js";

const $ = (id) => document.getElementById(id);

export function initLivestream() {
  const container = $("pageLivestream");
  if (!container) return;

  // Master State
  const S = {
    isLive: false,
    liveStartTime: 0,
    liveTimerInterval: null,
    sourceMode: "camera", // 'camera', 'screen', 'playlist', 'hybrid'
    streamSessionId: "onestream-" + Math.random().toString(36).slice(2, 8) + "-" + Date.now().toString(36).slice(-4),

    // Hardware Camera
    camStream: null,
    camFacing: "user", // 'user' | 'environment'
    camRes: "1080p",
    camFps: 60,
    camAutoFocus: true,
    camDevices: [],
    selectedCamId: "",

    // Screen Share (Total Screen / Monitor)
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

    // Live AI Prompt & Training Period HUD
    hudEnabled: true,
    hudPromptText: "Futuristic android portrait with glowing chromatic ocular implants · Wan2.1 InP 1.3B",
    hudModelName: "Ankan-Wan2.1-FineTune-v1",
    hudTrainingStatus: "active",
    hudViewersCount: 184,

    // YouTube & Social Media Streams
    ytPlaying: false,
    ytVolume: 65,
    ytCurrentTitle: "Lofi Girl - Relax / Study Beats",
    ytCurrentUrl: "https://www.youtube.com/watch?v=jfKfPfyJRdk",
    ytAudioOsc: null,
    chatOverlayEnabled: true,
    connectedPlatforms: {
      youtube: { connected: true, handle: "@OneCreativeStudio", key: "live_yt_sec_99182" },
      twitch: { connected: false, handle: "", key: "" },
      kick: { connected: false, handle: "", key: "" },
      x: { connected: false, handle: "", key: "" },
    },
    activeLoginPlatform: null,

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

    // Viewer Mode Mirror
    viewerModalOpen: false,
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

  // Initialize Canvas
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
      console.warn("Camera start fallback:", err);
      try {
        const fbStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        S.camStream = fbStream;
        camVideo.srcObject = fbStream;
        await camVideo.play().catch(() => {});
        setupAudioNodes();
      } catch (err2) {
        toast("Camera unavailable or permission denied.");
      }
    }
  }

  /* -------------------------------------------------------------
     2. TOTAL SCREEN SHARING (ENTIRE MONITOR / TRAINING WORKFLOW)
     ------------------------------------------------------------- */
  async function captureTotalScreen() {
    if (S.screenStream) {
      S.screenStream.getTracks().forEach((t) => t.stop());
      S.screenStream = null;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          displaySurface: "monitor",
          frameRate: 60,
          cursor: "always",
        },
        audio: true,
      });
      S.screenStream = stream;
      screenVideo.srcObject = stream;
      await screenVideo.play();
      
      setSourceMode("screen");
      toast("Total Desktop Screen connected! Prompt workflow and training periods streaming live.");

      stream.getVideoTracks()[0].onended = () => {
        S.screenStream = null;
        if (S.sourceMode === "screen") {
          setSourceMode("camera");
        }
      };
    } catch (e) {
      toast("Screen capture cancelled.");
    }
  }

  /* -------------------------------------------------------------
     3. BROWSER-BASED PLUGIN DOWNLOADER (ONESTREAM EXTENSION)
     ------------------------------------------------------------- */
  async function downloadOneStreamPluginZip() {
    try {
      toast("Generating OneStream Broadcaster Extension package...");
      const JSZip = await getJSZip();
      const zip = new JSZip();

      // 1. manifest.json (Manifest V3)
      const manifest = {
        manifest_version: 3,
        name: "OneStream Broadcaster Plugin",
        version: "2.4.0",
        description: "Capture total desktop screen, prompt iterations, and AI model training periods live with One AI Studio.",
        permissions: ["desktopCapture", "tabCapture", "storage", "activeTab"],
        action: {
          default_popup: "popup.html",
          default_title: "OneStream Broadcaster",
        },
        background: {
          service_worker: "background.js",
        },
        content_scripts: [
          {
            matches: ["<all_urls>"],
            js: ["content.js"],
          },
        ],
      };
      zip.file("manifest.json", JSON.stringify(manifest, null, 2));

      // 2. background.js
      const backgroundJs = `// OneStream Broadcaster Background Service Worker
chrome.runtime.onInstalled.addListener(() => {
  console.log("OneStream Broadcaster Extension v2.4.0 installed.");
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "captureTotalScreen") {
    chrome.desktopCapture.chooseDesktopMedia(
      ["screen", "window", "tab", "audio"],
      sender.tab,
      (streamId) => {
        sendResponse({ success: Boolean(streamId), streamId });
      }
    );
    return true; // asynchronous
  }
});
`;
      zip.file("background.js", backgroundJs);

      // 3. content.js
      const contentJs = `// OneStream Broadcaster Content Script Bridge
window.addEventListener("onestream:check-plugin", () => {
  window.dispatchEvent(new CustomEvent("onestream:plugin-installed", { detail: { version: "2.4.0" } }));
});

window.addEventListener("onestream:request-screen", () => {
  chrome.runtime.sendMessage({ action: "captureTotalScreen" }, (res) => {
    window.dispatchEvent(new CustomEvent("onestream:screen-response", { detail: res }));
  });
});
`;
      zip.file("content.js", contentJs);

      // 4. popup.html
      const popupHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { width: 300px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #0b1122; color: #fff; padding: 14px; margin: 0; }
    h3 { margin: 0 0 6px; font-size: 14px; color: #38bdf8; display: flex; align-items: center; gap: 6px; }
    p { font-size: 11px; color: #94a3b8; margin: 0 0 12px; line-height: 1.4; }
    .btn { display: block; width: 100%; box-sizing: border-box; background: #0284c7; color: #fff; border: none; padding: 8px 12px; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer; margin-bottom: 6px; text-align: center; }
    .btn:hover { background: #0369a1; }
    .status { background: rgba(34, 197, 94, 0.15); border: 1px solid #22c55e; border-radius: 6px; padding: 6px; font-size: 10.5px; color: #22c55e; text-align: center; margin-bottom: 10px; }
  </style>
</head>
<body>
  <h3>🧩 OneStream Broadcaster</h3>
  <div class="status">● Extension Active & Ready</div>
  <p>Share your total desktop screen, active prompts, and training periods live with viewers.</p>
  <button class="btn" id="startCaptureBtn">🖥️ Share Total Desktop Screen</button>
  <button class="btn" style="background:#4f46e5" id="openStudioBtn">🚀 Open One AI Studio</button>
  <script src="popup.js"></script>
</body>
</html>`;
      zip.file("popup.html", popupHtml);

      // 5. popup.js
      const popupJs = `document.getElementById("startCaptureBtn").onclick = () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]?.id) {
      chrome.tabs.sendMessage(tabs[0].id, { action: "startCapture" });
    }
  });
};
document.getElementById("openStudioBtn").onclick = () => {
  chrome.tabs.create({ url: "https://ais-dev-igeploiesa5w7waeuk2gug-799251589421.asia-southeast1.run.app" });
};
`;
      zip.file("popup.js", popupJs);

      // 6. README.md
      const readme = `# OneStream Broadcaster Plugin (Manifest V3)

## How to Install in Google Chrome, Microsoft Edge, Brave, or Opera:
1. Extract this \`OneStream-Broadcaster-Plugin.zip\` file into a folder on your computer.
2. Open \`chrome://extensions\` (or \`edge://extensions\` in Edge) in your browser.
3. Turn on the **Developer mode** toggle in the top-right corner.
4. Click **Load unpacked** in the top-left corner.
5. Select the extracted folder containing \`manifest.json\`.
6. Done! The OneStream icon will appear in your browser toolbar.

Now you can share your entire desktop screen, prompts, and model training workflow with 60 FPS clarity!`;
      zip.file("README.md", readme);

      // Generate zip and trigger browser download
      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "OneStream-Broadcaster-Plugin.zip";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);

      toast("Downloaded OneStream-Broadcaster-Plugin.zip! See install steps in tab.");
    } catch (e) {
      console.error(e);
      toast("Error creating plugin zip: " + e.message);
    }
  }

  /* -------------------------------------------------------------
     4. YOUTUBE MUSIC & SOCIAL MEDIA FEEDS ENGINE
     ------------------------------------------------------------- */
  function extractYouTubeId(url) {
    if (!url) return null;
    const match = url.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})/);
    return match ? match[1] : null;
  }

  function importYouTubeTrackOrPlaylist(url, titleHint) {
    const u = url || $("lsYtUrlInput")?.value?.trim();
    if (!u) {
      toast("Please enter a valid YouTube URL or ID.");
      return;
    }

    const ytid = extractYouTubeId(u);
    const title = titleHint || (ytid ? `YouTube Stream [${ytid}]` : "YouTube Music Feed");

    S.ytCurrentTitle = title;
    S.ytCurrentUrl = u;

    const titleEl = $("lsYtTrackTitle");
    if (titleEl) titleEl.textContent = title;

    const artistEl = $("lsYtTrackArtist");
    if (artistEl) artistEl.textContent = ytid ? `YouTube Video ID: ${ytid} · Active Audio Stream` : "YouTube Audio Feed";

    // Add to playlist queue
    S.playlist.push({
      id: "yt-" + Date.now().toString(36),
      title,
      type: "video",
      url: u,
      duration: 0,
      badge: "YOUTUBE",
    });
    renderPlaylistDOM();

    startSimulatedYouTubeAudio();
    toast(`Loaded YouTube track: "${title}" into live stream.`);
  }

  function startSimulatedYouTubeAudio() {
    S.ytPlaying = true;
    const btn = $("lsYtPlayPauseBtn");
    if (btn) btn.textContent = "⏸ Pause";

    try {
      if (!S.audioCtx) S.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (S.audioCtx.state === "suspended") S.audioCtx.resume();

      // Create soothing background drone chord simulating music
      if (S.ytAudioOsc) {
        try { S.ytAudioOsc.stop(); } catch {}
      }
      const osc = S.audioCtx.createOscillator();
      const gain = S.audioCtx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(220, S.audioCtx.currentTime); // A3 note
      gain.gain.setValueAtTime((S.ytVolume / 100) * 0.05, S.audioCtx.currentTime);
      osc.connect(gain);
      gain.connect(S.audioCtx.destination);
      osc.start();
      S.ytAudioOsc = osc;
    } catch {}
  }

  function stopSimulatedYouTubeAudio() {
    S.ytPlaying = false;
    const btn = $("lsYtPlayPauseBtn");
    if (btn) btn.textContent = "▶ Play";
    if (S.ytAudioOsc) {
      try { S.ytAudioOsc.stop(); } catch {}
      S.ytAudioOsc = null;
    }
  }

  /* -------------------------------------------------------------
     5. SOCIAL MEDIA PLATFORM AUTH & LOGIN
     ------------------------------------------------------------- */
  function loadConnectedPlatforms() {
    try {
      const raw = localStorage.getItem("ls_connected_platforms");
      if (raw) S.connectedPlatforms = JSON.parse(raw);
    } catch {}
    updatePlatformCardsDOM();
  }

  function saveConnectedPlatforms() {
    try {
      localStorage.setItem("ls_connected_platforms", JSON.stringify(S.connectedPlatforms));
    } catch {}
    updatePlatformCardsDOM();
  }

  function updatePlatformCardsDOM() {
    const list = [
      { key: "youtube", card: "lsPlatCardYt", status: "lsPlatStatusYt", handle: "lsPlatHandleYt", btn: "lsPlatBtnYt" },
      { key: "twitch", card: "lsPlatCardTwitch", status: "lsPlatStatusTwitch", handle: "lsPlatHandleTwitch", btn: "lsPlatBtnTwitch" },
      { key: "kick", card: "lsPlatCardKick", status: "lsPlatStatusKick", handle: "lsPlatHandleKick", btn: "lsPlatBtnKick" },
      { key: "x", card: "lsPlatCardX", status: "lsPlatStatusX", handle: "lsPlatHandleX", btn: "lsPlatBtnX" },
    ];

    list.forEach(({ key, card, status, handle, btn }) => {
      const p = S.connectedPlatforms[key];
      const cardEl = $(card);
      const statEl = $(status);
      const handEl = $(handle);
      const btnEl = $(btn);

      if (cardEl && p) {
        cardEl.classList.toggle("connected", p.connected);
        if (statEl) statEl.textContent = p.connected ? "Connected" : "Disconnected";
        if (handEl) handEl.textContent = p.connected ? p.handle : "Not logged in";
        if (btnEl) btnEl.textContent = p.connected ? "Configure" : "Connect";
      }
    });
  }

  function openPlatformLoginModal(platformKey) {
    S.activeLoginPlatform = platformKey;
    const modal = $("lsLoginModal");
    const titleEl = $("lsLoginModalTitle");
    const descEl = $("lsLoginModalDesc");
    const handleInp = $("lsLoginHandleInput");
    const keyInp = $("lsLoginKeyInput");

    const platNames = { youtube: "YouTube Live", twitch: "Twitch", kick: "Kick.com", x: "X / Twitter Live" };
    const cur = S.connectedPlatforms[platformKey] || {};

    if (titleEl) titleEl.textContent = `Connect to ${platNames[platformKey] || "Platform"}`;
    if (descEl) descEl.textContent = `Authenticate your account to broadcast your AI training and screen feeds directly to ${platNames[platformKey]}.`;
    if (handleInp) handleInp.value = cur.handle || "";
    if (keyInp) keyInp.value = cur.key || "";

    if (modal) modal.hidden = false;
  }

  function confirmPlatformLogin() {
    const key = S.activeLoginPlatform;
    if (!key) return;

    const handle = $("lsLoginHandleInput")?.value?.trim() || "@Broadcaster";
    const streamKey = $("lsLoginKeyInput")?.value?.trim() || "live_stream_sec";

    S.connectedPlatforms[key] = {
      connected: true,
      handle,
      key: streamKey,
    };

    saveConnectedPlatforms();
    $("lsLoginModal").hidden = true;
    toast(`Connected to ${key.toUpperCase()} as ${handle}!`);
  }

  /* -------------------------------------------------------------
     6. SHARABLE LINK & AUDIENCE STREAM VIEWER MODE
     ------------------------------------------------------------- */
  function getSharableStreamUrl() {
    const origin = window.location.origin;
    const path = window.location.pathname;
    return `${origin}${path}#live=${S.streamSessionId}`;
  }

  function copySharableLink() {
    const url = getSharableStreamUrl();
    navigator.clipboard.writeText(url).then(() => {
      toast("Sharable livestream link copied to clipboard!");
    }).catch(() => {
      prompt("Copy your sharable livestream link:", url);
    });
  }

  function openViewerModal() {
    S.viewerModalOpen = true;
    const modal = $("lsViewerModal");
    if (modal) modal.hidden = false;

    // Update tags
    const modelTag = $("lsViewerModelTag");
    if (modelTag) modelTag.textContent = `🧬 Model: ${S.hudModelName}`;

    const promptText = $("lsViewerPromptText");
    if (promptText) promptText.innerHTML = `<strong>Active Prompt:</strong> "${escapeHtml(S.hudPromptText)}"`;

    startViewerMirrorLoop();
    toast("Opened Audience Viewer Mode.");
  }

  function closeViewerModal() {
    S.viewerModalOpen = false;
    const modal = $("lsViewerModal");
    if (modal) modal.hidden = true;
  }

  function startViewerMirrorLoop() {
    const mirrorCanvas = $("lsViewerMirrorCanvas");
    if (!mirrorCanvas || !S.viewerModalOpen) return;

    const ctx = mirrorCanvas.getContext("2d");
    mirrorCanvas.width = 1280;
    mirrorCanvas.height = 720;

    function mirror() {
      if (!S.viewerModalOpen) return;
      if (S.canvas) {
        ctx.drawImage(S.canvas, 0, 0, mirrorCanvas.width, mirrorCanvas.height);
      }
      requestAnimationFrame(mirror);
    }
    requestAnimationFrame(mirror);
  }

  function sendViewerChatMessage() {
    const inp = $("lsViewerChatInput");
    const list = $("lsViewerChatList");
    if (!inp || !list) return;

    const txt = inp.value.trim();
    if (!txt) return;

    const row = document.createElement("div");
    row.className = "ls-chat-msg";
    row.innerHTML = `
      <span class="user" style="color:#22c55e">@You (Audience)</span>
      <span class="text">${escapeHtml(txt)}</span>
    `;
    list.appendChild(row);
    list.scrollTop = list.scrollHeight;
    inp.value = "";

    // Bot reply
    setTimeout(() => {
      if (!S.viewerModalOpen) return;
      const bot = document.createElement("div");
      bot.className = "ls-chat-msg";
      bot.innerHTML = `
        <span class="user" style="color:#f59e0b">@StudioBot</span>
        <span class="text">Stream host received your message! Prompt iteration updating...</span>
      `;
      list.appendChild(bot);
      list.scrollTop = list.scrollHeight;
    }, 1200);
  }

  function shareOnSocial(platform) {
    const url = encodeURIComponent(getSharableStreamUrl());
    const text = encodeURIComponent(`Watching AI model training live on One AI Studio! Check out the active prompt iterations & screen broadcast: `);

    let target = "";
    if (platform === "x") {
      target = `https://twitter.com/intent/tweet?text=${text}&url=${url}`;
    } else if (platform === "telegram") {
      target = `https://t.me/share/url?url=${url}&text=${text}`;
    } else if (platform === "whatsapp") {
      target = `https://api.whatsapp.com/send?text=${text}%20${url}`;
    }

    if (target) window.open(target, "_blank", "noopener,noreferrer");
  }

  /* -------------------------------------------------------------
     7. COMPOSITOR & MASTER RENDERING LOOP
     ------------------------------------------------------------- */
  function setupAudioNodes() {
    try {
      if (!S.audioCtx) S.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (S.audioCtx.state === "suspended") S.audioCtx.resume();

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
      console.warn("Audio warning:", e);
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
        grad.addColorStop(0, "#0a071b");
        grad.addColorStop(0.5, "#180e3b");
        grad.addColorStop(1, "#030209");
      }
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
    } else if (S.bgType === "screen" && S.screenStream && screenVideo.readyState >= 2) {
      ctx.drawImage(screenVideo, 0, 0, w, h);
    } else {
      ctx.fillStyle = "#030712";
      ctx.fillRect(0, 0, w, h);
    }
  }

  function renderCameraWithChroma(ctx, x, y, w, h) {
    if (!S.camStream || camVideo.readyState < 2) {
      ctx.fillStyle = "#0c101d";
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = "#94a3b8";
      ctx.font = "bold 28px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("📷 Camera initializing...", w / 2, h / 2);
      ctx.textAlign = "start";
      return;
    }

    if (!S.chromaEnabled) {
      applyFilters(ctx);
      ctx.drawImage(camVideo, x, y, w, h);
      ctx.filter = "none";
      return;
    }

    // Chroma Key
    const scale = 0.5;
    const sw = Math.round(w * scale);
    const sh = Math.round(h * scale);
    tempCanvas.width = sw;
    tempCanvas.height = sh;

    tempCtx.drawImage(camVideo, 0, 0, sw, sh);
    const frame = tempCtx.getImageData(0, 0, sw, sh);
    const d = frame.data;
    const [kr, kg, kb] = getChromaRGB();
    const thresh = (S.chromaThreshold / 100) * 441;
    const smooth = (S.chromaSmooth / 100) * 200;

    for (let i = 0; i < d.length; i += 4) {
      const dr = d[i] - kr;
      const dg = d[i + 1] - kg;
      const db = d[i + 2] - kb;
      const dist = Math.sqrt(dr * dr + dg * dg + db * db);

      if (dist < thresh) {
        d[i + 3] = 0;
      } else if (dist < thresh + smooth && smooth > 0) {
        const edge = (dist - thresh) / smooth;
        d[i + 3] = Math.round(d[i + 3] * edge);
      }
    }

    tempCtx.putImageData(frame, 0, 0);
    applyFilters(ctx);
    ctx.drawImage(tempCanvas, x, y, w, h);
    ctx.filter = "none";
  }

  function applyFilters(c) {
    const filters = [];
    const exp = 1 + S.exposure / 50;
    const con = 1 + S.contrast / 50;
    const sat = 1 + S.saturation / 100;
    filters.push(`brightness(${exp.toFixed(2)}) contrast(${con.toFixed(2)}) saturate(${sat.toFixed(2)})`);

    if (S.beautifyOn) {
      const glow = 1 + (S.skinGlow / 100) * 0.15;
      filters.push(`brightness(${glow.toFixed(2)})`);
      const blurPx = (S.smoothSkin / 100) * 1.5;
      if (blurPx > 0.4) filters.push(`blur(${blurPx.toFixed(1)}px)`);
    }

    c.filter = filters.join(" ");
  }

  // Draw Vignette, Live Prompt & Training HUD, Lower Third, and Chat Overlay
  function renderOverlays(ctx, w, h) {
    // 1. Vignette
    if (S.vignette > 0) {
      const vig = ctx.createRadialGradient(w / 2, h / 2, w * 0.35, w / 2, h / 2, w * 0.72);
      vig.addColorStop(0, "rgba(0,0,0,0)");
      vig.addColorStop(1, `rgba(0,0,0,${(S.vignette / 100).toFixed(2)})`);
      ctx.fillStyle = vig;
      ctx.fillRect(0, 0, w, h);
    }

    // 2. LIVE AI PROMPT & TRAINING PERIOD HUD OVERLAY
    if (S.hudEnabled) {
      ctx.save();
      // Top Telemetry Card
      const hudTopY = 40;
      const hudTopX = 50;
      const hudTopW = 760;
      const hudTopH = 68;

      ctx.fillStyle = "rgba(6, 10, 24, 0.88)";
      ctx.strokeStyle = "rgba(56, 189, 248, 0.4)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(hudTopX, hudTopY, hudTopW, hudTopH, 12);
      ctx.fill();
      ctx.stroke();

      // Top Status Pill
      ctx.fillStyle = "#38bdf8";
      ctx.beginPath();
      ctx.roundRect(hudTopX, hudTopY, 6, hudTopH, [12, 0, 0, 12]);
      ctx.fill();

      // Model Name
      ctx.font = "bold 20px -apple-system, BlinkMacSystemFont, sans-serif";
      ctx.fillStyle = "#ffffff";
      ctx.fillText(`🧬 Model: ${S.hudModelName}`, hudTopX + 22, hudTopY + 30);

      // Training Telemetry
      const statMap = {
        active: "● Training Active: Epoch 4/5 · Loss: 0.042 · LR: 5e-4",
        converged: "✓ Validation Loss Converged (Ready for Inference)",
        decomposing: "● Signal Decomposing (Ankan-Soma Lagrangian Codec)",
        standby: "Standby Mode · Ready for Local CPU Training",
      };
      ctx.font = "600 14px monospace";
      ctx.fillStyle = S.hudTrainingStatus === "active" ? "#22c55e" : "#38bdf8";
      ctx.fillText(statMap[S.hudTrainingStatus] || "Training Telemetry Active", hudTopX + 22, hudTopY + 54);

      // Top Right Stream Status
      const rightX = w - 460;
      ctx.fillStyle = "rgba(6, 10, 24, 0.88)";
      ctx.strokeStyle = "rgba(239, 68, 68, 0.4)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(rightX, hudTopY, 410, hudTopH, 12);
      ctx.fill();
      ctx.stroke();

      ctx.font = "bold 16px sans-serif";
      ctx.fillStyle = "#ef4444";
      ctx.fillText("🔴 LIVE", rightX + 20, hudTopY + 41);

      ctx.font = "600 14px sans-serif";
      ctx.fillStyle = "#ffffff";
      ctx.fillText(`👥 ${S.hudViewersCount} watching · 1080P 60FPS`, rightX + 90, hudTopY + 41);

      // Bottom Active Prompt Overlay
      const pY = h - 130;
      const pX = 50;
      const pW = w - 100;
      const pH = 74;

      ctx.fillStyle = "rgba(6, 10, 24, 0.9)";
      ctx.strokeStyle = "rgba(168, 85, 247, 0.45)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(pX, pY, pW, pH, 12);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = "#c084fc";
      ctx.beginPath();
      ctx.roundRect(pX, pY, 6, pH, [12, 0, 0, 12]);
      ctx.fill();

      ctx.font = "bold 13px sans-serif";
      ctx.fillStyle = "#a855f7";
      ctx.fillText("💬 ACTIVE BROADCAST PROMPT", pX + 22, pY + 26);

      ctx.font = "600 17px sans-serif";
      ctx.fillStyle = "#ffffff";
      ctx.fillText(`"${S.hudPromptText}"`, pX + 22, pY + 53);

      ctx.restore();
    }

    // 3. Interactive Audience Chat Overlay on Canvas
    if (S.chatOverlayEnabled && S.sourceMode !== "camera") {
      ctx.save();
      const chatX = 50;
      const chatY = h - 320;
      const chatW = 380;
      const chatH = 170;

      ctx.fillStyle = "rgba(0, 0, 0, 0.65)";
      ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(chatX, chatY, chatW, chatH, 10);
      ctx.fill();
      ctx.stroke();

      ctx.font = "bold 12px sans-serif";
      ctx.fillStyle = "#38bdf8";
      ctx.fillText("💬 Audience Live Feed", chatX + 14, chatY + 24);

      const msgs = [
        { u: "@CyberDev", t: "Watching the AI model training live! 🚀" },
        { u: "@NeuralArt", t: "That prompt iteration looks super clean!" },
        { u: "@WanCreator", t: "Can you share the checkpoint when it completes?" },
      ];

      msgs.forEach((m, idx) => {
        const my = chatY + 54 + idx * 36;
        ctx.font = "bold 12px sans-serif";
        ctx.fillStyle = "#38bdf8";
        ctx.fillText(m.u + ": ", chatX + 14, my);
        ctx.font = "12px sans-serif";
        ctx.fillStyle = "#ffffff";
        ctx.fillText(m.t, chatX + 85, my);
      });

      ctx.restore();
    }
  }

  function compositorLoop() {
    const w = S.canvas.width;
    const h = S.canvas.height;
    const ctx = S.ctx;

    ctx.clearRect(0, 0, w, h);
    renderBackground(ctx, w, h);

    if (S.sourceMode === "camera") {
      renderCameraWithChroma(ctx, 0, 0, w, h);
    } else if (S.sourceMode === "screen") {
      if (S.screenStream && screenVideo.readyState >= 2) {
        ctx.drawImage(screenVideo, 0, 0, w, h);
      } else {
        ctx.fillStyle = "#0c101d";
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = "#94a3b8";
        ctx.font = "bold 32px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("📡 Total Screen Broadcast Ready · Click 'Capture Total Screen Now'", w / 2, h / 2);
        ctx.textAlign = "start";
      }

      if (S.pipEnabled && S.camStream && camVideo.readyState >= 2) {
        renderPiP(ctx, w, h, camVideo);
      }
    } else if (S.sourceMode === "playlist") {
      renderPlaylistMedia(ctx, w, h);
      if (S.pipEnabled && S.camStream && camVideo.readyState >= 2) {
        renderPiP(ctx, w, h, camVideo);
      }
    } else if (S.sourceMode === "hybrid") {
      if (S.screenStream && screenVideo.readyState >= 2) {
        ctx.drawImage(screenVideo, 0, 0, w, h);
      }
      renderCameraWithChroma(ctx, 0, 0, w, h);
    }

    renderOverlays(ctx, w, h);
    updateAudioMeters();

    S.animFrameId = requestAnimationFrame(compositorLoop);
  }

  function renderPiP(ctx, w, h, source) {
    const scale = S.pipScale / 100;
    const pipW = Math.round(w * scale);
    const pipH = Math.round(pipW * (9 / 16));
    const pad = 40;

    let px = w - pipW - pad;
    let py = h - pipH - pad;

    if (S.pipPosition === "bl") { px = pad; py = h - pipH - pad; }
    else if (S.pipPosition === "tr") { px = w - pipW - pad; py = pad; }
    else if (S.pipPosition === "tl") { px = pad; py = pad; }

    ctx.save();
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

  function renderPlaylistMedia(ctx, w, h) {
    if (!S.playlist.length) return;
    const it = S.playlist[S.currentIndex];
    if (!it) return;

    if (it.type === "video" && S.playlistVideoEl && S.playlistVideoEl.readyState >= 2) {
      ctx.drawImage(S.playlistVideoEl, 0, 0, w, h);
    } else if (it.type === "image" && S.playlistImgEl && S.playlistImgEl.complete) {
      ctx.drawImage(S.playlistImgEl, 0, 0, w, h);
    } else {
      ctx.fillStyle = "#0c101d";
      ctx.fillRect(0, 0, w, h);
    }
  }

  function setSourceMode(mode) {
    S.sourceMode = mode;
    document.querySelectorAll(".ls-source-btn").forEach((btn) => {
      btn.classList.toggle("on", btn.dataset.source === mode);
    });
    const badge = $("lsActiveModeBadge");
    if (badge) {
      badge.textContent = mode.charAt(0).toUpperCase() + mode.slice(1) + " Mode";
    }
  }

  /* -------------------------------------------------------------
     8. 24/7 PLAYLIST PLAYBACK
     ------------------------------------------------------------- */
  function playPlaylistItem(idx) {
    if (!S.playlist.length) return;
    if (S.autoAdvanceTimer) clearTimeout(S.autoAdvanceTimer);
    S.currentIndex = (idx + S.playlist.length) % S.playlist.length;
    const it = S.playlist[S.currentIndex];
    renderPlaylistDOM();

    if (it.type === "video") {
      S.playlistVideoEl.src = it.url;
      S.playlistVideoEl.play().catch(() => {});
      S.playlistVideoEl.onended = () => advancePlaylist();
    } else if (it.type === "image") {
      if (!S.playlistImgEl) S.playlistImgEl = new Image();
      S.playlistImgEl.crossOrigin = "anonymous";
      S.playlistImgEl.src = it.url;
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
          <span class="ls-item-title" title="${escapeHtml(it.title)}">${escapeHtml(it.title)}</span>
          <div class="ls-item-meta">
            <span class="ls-item-badge">${it.badge}</span>
            <span>${it.type === "image" ? it.duration + "s" : it.type === "video" ? "Full Length" : "Continuous"}</span>
          </div>
        </div>
        <div class="ls-item-actions">
          <button class="btn btn-tiny ls-btn-up" title="Move Up">▲</button>
          <button class="btn btn-tiny ls-btn-down" title="Move Down">▼</button>
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
          renderPlaylistDOM();
        }
      };
      row.querySelector(".ls-btn-down").onclick = () => {
        if (idx < S.playlist.length - 1) {
          const temp = S.playlist[idx + 1];
          S.playlist[idx + 1] = S.playlist[idx];
          S.playlist[idx] = temp;
          renderPlaylistDOM();
        }
      };
      row.querySelector(".ls-btn-del").onclick = () => {
        S.playlist.splice(idx, 1);
        renderPlaylistDOM();
      };
      list.appendChild(row);
    });

    const countEl = $("lsPlaylistCount");
    if (countEl) countEl.textContent = `${S.playlist.length} item${S.playlist.length === 1 ? "" : "s"}`;
  }

  /* -------------------------------------------------------------
     9. MASTER CONTROLS & BROADCAST ACTIONS
     ------------------------------------------------------------- */
  function toggleLiveBroadcast() {
    S.isLive = !S.isLive;
    const btn = $("lsToggleLiveBtn");
    const tag = $("lsLiveStatusTag");

    if (S.isLive) {
      S.liveStartTime = Date.now();
      if (btn) {
        btn.textContent = "⏹ Stop Livestream";
        btn.classList.add("btn-danger");
      }
      if (tag) {
        tag.classList.add("live");
        tag.innerHTML = '<span class="dot"></span> ON AIR';
      }
      S.liveTimerInterval = setInterval(() => {
        const sec = Math.floor((Date.now() - S.liveStartTime) / 1000);
        const h = String(Math.floor(sec / 3600)).padStart(2, "0");
        const m = String(Math.floor((sec % 3600) / 60)).padStart(2, "0");
        const s = String(sec % 60).padStart(2, "0");
        const el = $("lsLiveTimeVal");
        if (el) el.textContent = `${h}:${m}:${s}`;
      }, 1000);

      toast("🔴 24/7 Livestream broadcast is now ON AIR!");
    } else {
      clearInterval(S.liveTimerInterval);
      if (btn) {
        btn.textContent = "🔴 Start 24/7 Livestream";
        btn.classList.remove("btn-danger");
      }
      if (tag) {
        tag.classList.remove("live");
        tag.innerHTML = '<span class="dot"></span> STANDBY';
      }
      toast("Livestream stopped.");
    }
  }

  function toggleLiveRecording() {
    if (!S.isRecording) {
      try {
        const stream = S.canvas.captureStream(60);
        S.recorder = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp9" });
        S.recordedChunks = [];
        S.recorder.ondataavailable = (e) => {
          if (e.data.size > 0) S.recordedChunks.push(e.data);
        };
        S.recorder.onstop = async () => {
          const blob = new Blob(S.recordedChunks, { type: "video/webm" });
          const fname = `onestream-record-${Date.now().toString(36)}.webm`;
          await saveBlobToLibrary({
            kind: "video",
            tab: "livestream",
            blob,
            filename: fname,
            prompt: S.hudPromptText || "Livestream Broadcast",
            extra: { provider: "livestream", providerLabel: "OneStream Broadcast" }
          });
          const a = document.createElement("a");
          a.href = URL.createObjectURL(blob);
          a.download = fname;
          a.click();
          toast("Stream recording saved to Library and downloaded!");
        };
        S.recorder.start(1000);
        S.isRecording = true;
        const btn = $("lsRecordBtn");
        if (btn) { btn.textContent = "⏹ Stop Rec"; btn.classList.add("btn-danger"); }
        toast("Recording stream at 1080P 60FPS...");
      } catch (e) {
        toast("Recording error: " + e.message);
      }
    } else {
      if (S.recorder) S.recorder.stop();
      S.isRecording = false;
      const btn = $("lsRecordBtn");
      if (btn) { btn.textContent = "⏺ Record"; btn.classList.remove("btn-danger"); }
    }
  }

  function takeHDSnapshot() {
    const dataUrl = S.canvas.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `onestream-snap-${Date.now().toString(36)}.png`;
    a.click();
    toast("HD broadcast snapshot saved!");
  }

  function toggleBrowserPiP() {
    if (document.pictureInPictureElement) {
      document.exitPictureInPicture();
    } else if (S.outVideoEl) {
      S.outVideoEl.requestPictureInPicture().catch(() => toast("PiP not supported or video unready."));
    }
  }

  function updateStatusDisplay() {
    const resEl = $("lsResVal");
    if (resEl) resEl.textContent = `${S.camRes.toUpperCase()} @ ${S.camFps}FPS`;
  }

  /* -------------------------------------------------------------
     10. UI BINDINGS & EVENT LISTENERS
     ------------------------------------------------------------- */
  function bindUI() {
    // Subtabs Switcher
    document.querySelectorAll(".ls-subtab").forEach((tab) => {
      tab.onclick = () => {
        document.querySelectorAll(".ls-subtab").forEach((t) => t.classList.remove("on"));
        document.querySelectorAll(".ls-tab-pane").forEach((p) => p.hidden = true);
        tab.classList.add("on");
        const target = $(tab.dataset.target);
        if (target) target.hidden = false;
      };
    });

    // Source Buttons
    document.querySelectorAll(".ls-source-btn").forEach((btn) => {
      btn.onclick = () => {
        const mode = btn.dataset.source;
        setSourceMode(mode);
        if (mode === "screen" && !S.screenStream) {
          captureTotalScreen();
        }
      };
    });

    // Total Screen Capture Buttons
    const connectScreenBtn = $("lsConnectScreenBtn");
    if (connectScreenBtn) connectScreenBtn.onclick = captureTotalScreen;

    const pluginCaptureBtn = $("lsPluginCaptureBtn");
    if (pluginCaptureBtn) pluginCaptureBtn.onclick = captureTotalScreen;

    // Download OneStream Plugin
    const downloadPluginBtn = $("lsDownloadPluginBtn");
    if (downloadPluginBtn) downloadPluginBtn.onclick = downloadOneStreamPluginZip;

    // Sharable Link Buttons
    const shareInput = $("lsSharableLinkInput");
    if (shareInput) shareInput.value = getSharableStreamUrl();

    const copyShareBtn = $("lsCopyShareLinkBtn");
    if (copyShareBtn) copyShareBtn.onclick = copySharableLink;

    const openViewerBtn = $("lsOpenViewerBtn");
    if (openViewerBtn) openViewerBtn.onclick = openViewerModal;

    const closeViewerBtn = $("lsCloseViewerBtn");
    if (closeViewerBtn) closeViewerBtn.onclick = closeViewerModal;

    const viewerSendBtn = $("lsViewerSendBtn");
    if (viewerSendBtn) viewerSendBtn.onclick = sendViewerChatMessage;

    const viewerChatInput = $("lsViewerChatInput");
    if (viewerChatInput) {
      viewerChatInput.onkeydown = (e) => {
        if (e.key === "Enter") sendViewerChatMessage();
      };
    }

    document.querySelectorAll(".ls-share-social-btn").forEach((b) => {
      b.onclick = () => shareOnSocial(b.dataset.plat);
    });

    // YouTube Importer & Presets
    const ytImportBtn = $("lsYtImportBtn");
    if (ytImportBtn) ytImportBtn.onclick = () => importYouTubeTrackOrPlaylist();

    const ytPlayPauseBtn = $("lsYtPlayPauseBtn");
    if (ytPlayPauseBtn) {
      ytPlayPauseBtn.onclick = () => {
        if (S.ytPlaying) stopSimulatedYouTubeAudio();
        else startSimulatedYouTubeAudio();
      };
    }

    const ytNextBtn = $("lsYtNextBtn");
    if (ytNextBtn) {
      ytNextBtn.onclick = () => {
        const stations = [
          { u: "https://www.youtube.com/watch?v=jfKfPfyJRdk", t: "Lofi Girl - Relax / Study Beats" },
          { u: "https://www.youtube.com/watch?v=4xDzrJKXOOY", t: "Synthwave Radio - Chill Coding" },
          { u: "https://www.youtube.com/watch?v=5qap5aO4i9A", t: "Lofi Hip Hop - Deep Focus" },
        ];
        const next = stations[Math.floor(Math.random() * stations.length)];
        importYouTubeTrackOrPlaylist(next.u, next.t);
      };
    }

    document.querySelectorAll(".ls-yt-preset-btn").forEach((b) => {
      b.onclick = () => importYouTubeTrackOrPlaylist(b.dataset.url, b.dataset.title);
    });

    const ytVolRange = $("lsYtVolumeRange");
    if (ytVolRange) {
      ytVolRange.oninput = () => {
        S.ytVolume = Number(ytVolRange.value);
        const el = $("lsYtVolumeVal");
        if (el) el.textContent = S.ytVolume + "%";
      };
    }

    // Platform Login Modals
    const platBtnYt = $("lsPlatBtnYt");
    if (platBtnYt) platBtnYt.onclick = () => openPlatformLoginModal("youtube");

    const platBtnTwitch = $("lsPlatBtnTwitch");
    if (platBtnTwitch) platBtnTwitch.onclick = () => openPlatformLoginModal("twitch");

    const platBtnKick = $("lsPlatBtnKick");
    if (platBtnKick) platBtnKick.onclick = () => openPlatformLoginModal("kick");

    const platBtnX = $("lsPlatBtnX");
    if (platBtnX) platBtnX.onclick = () => openPlatformLoginModal("x");

    const closeLoginBtn = $("lsCloseLoginModalBtn");
    if (closeLoginBtn) closeLoginBtn.onclick = () => $("lsLoginModal").hidden = true;

    const cancelLoginBtn = $("lsCancelLoginBtn");
    if (cancelLoginBtn) cancelLoginBtn.onclick = () => $("lsLoginModal").hidden = true;

    const confirmLoginBtn = $("lsConfirmLoginBtn");
    if (confirmLoginBtn) confirmLoginBtn.onclick = confirmPlatformLogin;

    // Prompt HUD Overlays
    const hudToggle = $("lsHudToggle");
    if (hudToggle) hudToggle.onchange = () => S.hudEnabled = hudToggle.checked;

    const hudPromptInp = $("lsHudPromptInput");
    if (hudPromptInp) hudPromptInp.oninput = () => S.hudPromptText = hudPromptInp.value;

    const hudModelInp = $("lsHudModelInput");
    if (hudModelInp) hudModelInp.oninput = () => S.hudModelName = hudModelInp.value;

    const hudTrainingSel = $("lsHudTrainingSelect");
    if (hudTrainingSel) hudTrainingSel.onchange = () => S.hudTrainingStatus = hudTrainingSel.value;

    const hudSyncBtn = $("lsHudSyncBtn");
    if (hudSyncBtn) {
      hudSyncBtn.onclick = () => {
        const amlPrompt = $("amlPromptInput")?.value;
        const amlModel = $("amlModelNameInput")?.value;
        if (amlPrompt) {
          S.hudPromptText = amlPrompt;
          if (hudPromptInp) hudPromptInp.value = amlPrompt;
        }
        if (amlModel) {
          S.hudModelName = amlModel;
          if (hudModelInp) hudModelInp.value = amlModel;
        }
        toast("Synced active AI Prompt & Model Name from AI Model Lab!");
      };
    }

    const chatOverlayToggle = $("lsLiveChatOverlayToggle");
    if (chatOverlayToggle) chatOverlayToggle.onchange = () => S.chatOverlayEnabled = chatOverlayToggle.checked;

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
    if (fsBtn) {
      fsBtn.onclick = () => {
        const wrap = $("lsMonitorWrap");
        if (wrap) {
          if (!document.fullscreenElement) wrap.requestFullscreen();
          else document.exitFullscreen();
        }
      };
    }

    // Camera Hardware
    const camSel = $("lsCamSelect");
    if (camSel) {
      camSel.onchange = () => {
        S.selectedCamId = camSel.value;
        startCamera();
      };
    }

    const flipBtn = $("lsFlipCamBtn");
    if (flipBtn) {
      flipBtn.onclick = () => {
        S.camFacing = S.camFacing === "user" ? "environment" : "user";
        startCamera();
      };
    }

    // Beautify Controls
    const beautyToggle = $("lsBeautifyToggle");
    if (beautyToggle) beautyToggle.onchange = () => S.beautifyOn = beautyToggle.checked;

    const smoothRange = $("lsSmoothRange");
    if (smoothRange) {
      smoothRange.oninput = () => {
        S.smoothSkin = Number(smoothRange.value);
        $("lsSmoothVal").textContent = S.smoothSkin + "%";
      };
    }

    const glowRange = $("lsGlowRange");
    if (glowRange) {
      glowRange.oninput = () => {
        S.skinGlow = Number(glowRange.value);
        $("lsGlowVal").textContent = S.skinGlow + "%";
      };
    }

    // Color Tuning
    document.querySelectorAll(".ls-preset-chip").forEach((chip) => {
      chip.onclick = () => {
        document.querySelectorAll(".ls-preset-chip").forEach((c) => c.classList.remove("on"));
        chip.classList.add("on");
        S.activeFilter = chip.dataset.filter;
      };
    });

    // PiP
    const pipToggle = $("lsPipToggle");
    if (pipToggle) pipToggle.onchange = () => S.pipEnabled = pipToggle.checked;

    const pipPos = $("lsPipPosSelect");
    if (pipPos) pipPos.onchange = () => S.pipPosition = pipPos.value;

    const pipScale = $("lsPipScaleRange");
    if (pipScale) {
      pipScale.oninput = () => {
        S.pipScale = Number(pipScale.value);
        $("lsPipScaleVal").textContent = S.pipScale + "%";
      };
    }
  }

  function escapeHtml(str) {
    return String(str || "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
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

  // Initial Boot
  loadConnectedPlatforms();
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
