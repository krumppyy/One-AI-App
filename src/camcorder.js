const $ = (id) => document.getElementById(id);

function toast(m) {
  const h = document.querySelector(".toasts") || (() => { const d = document.createElement("div"); d.className = "toasts"; document.body.appendChild(d); return d; })();
  const t = document.createElement("div"); t.className = "toast"; t.textContent = m; h.appendChild(t);
  setTimeout(() => { t.style.opacity = "0"; setTimeout(() => t.remove(), 320); }, 3600);
}

const S = {
  stream: null, rec: null, chunks: [], facing: "user",
  srcBlob: null, srcUrl: "", srcName: "", srcW: 0, srcH: 0, srcDur: 0,
  outBlob: null, outUrl: "", outExt: "",
  voiceBlob: null, voiceUrl: "", voiceName: "", voiceDur: 0,
  takeTimer: 0, takeT0: 0,
};

const CROPS = [
  ["orig", "Original (no crop)"],
  ["16:9", "16:9 · YouTube / Facebook landscape"],
  ["9:16", "9:16 · TikTok / Reels / Shorts / Stories"],
  ["1:1", "1:1 · Instagram square"],
  ["4:5", "4:5 · Instagram portrait feed"],
  ["3:4", "3:4 · Classic portrait"],
  ["4:3", "4:3 · Classic landscape"],
  ["21:9", "21:9 · Cinematic wide"],
];

const FILTERS = [
  ["none", "No filter", "none"],
  ["warm", "Warm", "saturate(1.25) sepia(0.25) contrast(1.05)"],
  ["cool", "Cool", "saturate(1.15) brightness(1.05) contrast(1.05)"],
  ["vivid", "Vivid", "saturate(1.6) contrast(1.15)"],
  ["mono", "Mono", "grayscale(1) contrast(1.05)"],
  ["sepia", "Sepia", "sepia(0.8) contrast(1.05)"],
  ["soft", "Soft glow", "brightness(1.08) saturate(1.1) contrast(0.95)"],
];

function filterCss() {
  const f = $("vvCamFilterSel")?.value || "none";
  return (FILTERS.find((x) => x[0] === f) || FILTERS[0])[2];
}

function killStream() {
  try { S.stream?.getTracks().forEach((t) => t.stop()); } catch {}
  S.stream = null;
  const pv = $("vvCamPrev");
  if (pv) pv.srcObject = null;
}

async function listCams() {
  const sel = $("vvCamSel");
  if (!sel) return;
  sel.innerHTML = "";
  const auto = document.createElement("option");
  auto.value = "";
  auto.textContent = S.facing === "user" ? "Front camera (auto)" : "Back camera (auto)";
  sel.appendChild(auto);
  try {
    const devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput");
    devs.forEach((d, i) => {
      const o = document.createElement("option");
      o.value = d.deviceId;
      o.textContent = d.label || ("Camera " + (i + 1));
      sel.appendChild(o);
    });
  } catch {}
}

function pickRecMime() {
  try {
    if (typeof MediaRecorder?.isTypeSupported === "function") {
      for (const m of ["video/mp4;codecs=avc1.42E01f,mp4a.40.2", "video/mp4;codecs=avc1.42E01f", "video/mp4"]) {
        if (MediaRecorder.isTypeSupported(m)) return m;
      }
      for (const m of ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"]) {
        if (MediaRecorder.isTypeSupported(m)) return m;
      }
    }
  } catch {}
  return "";
}

function extForMime(mime, fb) {
  const m = String(mime || fb || "");
  if (m.includes("mp4")) return "mp4";
  if (m.includes("quicktime")) return "mov";
  if (m.includes("matroska")) return "mkv";
  return "webm";
}

async function startCam() {
  if (!navigator.mediaDevices?.getUserMedia) { toast("Camera needs HTTPS/localhost — not available here."); return; }
  killStream();
  const devId = $("vvCamSel")?.value || "";
  const want = devId ? { deviceId: { exact: devId } } : { facingMode: { ideal: S.facing } };
  try {
    S.stream = await navigator.mediaDevices.getUserMedia({ video: { ...want, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: true });
  } catch (e) {
    toast("Camera blocked: " + (e?.message || e));
    return;
  }
  const pv = $("vvCamPrev");
  if (pv) { pv.srcObject = S.stream; pv.play().catch(() => {}); }
  paintCam();
}

function voiceEl() { return $("vvCamAudio"); }

async function toggleTake() {
  if (S.rec) { try { S.rec.stop(); } catch {} return; }
  if (!S.srcBlob && !S.stream) await startCam();
  if (!S.stream) return;
  S.chunks = [];
  const mime = pickRecMime();
  try {
    S.rec = new MediaRecorder(S.stream, mime ? { mimeType: mime } : undefined);
  } catch (e) { toast("Recorder failed: " + (e?.message || e)); return; }
  S.rec.ondataavailable = (e) => { if (e.data?.size) S.chunks.push(e.data); };
  S.rec.onstop = () => {
    const b = new Blob(S.chunks, { type: S.rec.mimeType || mime || "video/webm" });
    const mm = S.rec.mimeType || mime || b.type;
    S.rec = null;
    stopTakeClock();
    try { voiceEl()?.pause(); } catch {}
    paintCam();
    if (b.size) {
      setSource(b, "take-" + new Date().toISOString().slice(11, 19).replace(/:/g, "") + "." + extForMime(mm));
      toast(S.voiceBlob ? "Take saved — merge it with the voiceover below." : "Take saved — import a voiceover above, or merge as-is.");
    }
    else toast("Nothing was captured — try again.");
  };
  S.rec.start(250);
  if (S.voiceBlob && voiceEl()) { try { voiceEl().currentTime = 0; await voiceEl().play(); } catch {} }
  S.takeT0 = performance.now();
  S.takeTimer = setInterval(() => {
    const st = $("vvCamStatus");
    if (st && S.rec) st.textContent = "Recording take… " + ((performance.now() - S.takeT0) / 1000).toFixed(0) + "s — match your lips to the voice.";
  }, 500);
  paintCam();
  toast(S.voiceBlob ? "Take rolling — the voiceover is playing, match it." : "Take rolling — front camera.");
}

function stopTakeClock() {
  if (S.takeTimer) { clearInterval(S.takeTimer); S.takeTimer = 0; }
}

function paintCam() {
  const b = $("vvCamTakeBtn");
  if (b) { b.textContent = S.rec ? "■ Stop take" : "● Record take"; b.classList.toggle("btn-danger", !!S.rec); }
  const r = $("vvCamRecBtn");
  if (r) r.hidden = true;
  const st = $("vvCamStatus");
  if (st && !st.dataset.busy) st.textContent = S.rec ? "Recording…" : S.stream ? "Camera ready." : "Camera off — press Record take to start the camera.";
}

function probe(blob) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(blob);
    const v = document.createElement("video");
    v.muted = true; v.preload = "auto"; v.src = url;
    v.onloadedmetadata = () => res({ url, w: v.videoWidth || 0, h: v.videoHeight || 0, dur: v.duration || 0 });
    v.onerror = () => { URL.revokeObjectURL(url); rej(new Error("could not read that video")); };
    setTimeout(() => rej(new Error("timed out reading that video")), 15000);
  });
}

async function scanOk(file, maxMb) {
  try {
    const guard = await import("./guard.js");
    const scan = await guard.scanFile(file, { maxMb });
    if (!scan.ok) { toast(scan.reason, "warn"); return false; }
  } catch {}
  return true;
}

async function setSource(blob, name) {
  if (S.srcUrl) try { URL.revokeObjectURL(S.srcUrl); } catch {}
  S.srcBlob = blob; S.srcName = name || "clip";
  S.srcUrl = ""; S.srcW = 0; S.srcH = 0; S.srcDur = 0;
  try {
    const info = await probe(blob);
    URL.revokeObjectURL(info.url);
    S.srcUrl = URL.createObjectURL(blob);
    S.srcW = info.w; S.srcH = info.h; S.srcDur = Number.isFinite(info.dur) ? info.dur : 0;
  } catch (e) { toast("Couldn't read that video: " + (e?.message || e)); S.srcBlob = null; }
  S.outBlob = null;
  paintSrc();
}

async function setVoice(blob, name) {
  if (!await scanOk(blob, 50)) return;
  if (S.voiceUrl) try { URL.revokeObjectURL(S.voiceUrl); } catch {}
  S.voiceBlob = blob; S.voiceName = name || "voiceover";
  S.voiceUrl = URL.createObjectURL(blob);
  S.voiceDur = 0;
  const el = voiceEl();
  if (el) {
    el.src = S.voiceUrl;
    try { S.voiceDur = await new Promise((res) => { el.onloadedmetadata = () => res(el.duration || 0); setTimeout(() => res(el.duration || 0), 4000); }); } catch {}
  }
  paintVoice();
  toast("Voiceover loaded — " + S.voiceName + ". Now record the take.");
}

function fmt(s) { s = Math.max(0, Number(s) || 0); return s.toFixed(1) + "s"; }
function mb(b) { return (b / 1048576).toFixed(2) + " MB"; }

function paintVoice() {
  const el = $("vvCamVoiceLine");
  if (el) el.textContent = !S.voiceBlob ? "No voiceover yet — import an mp3 or audio file first." : S.voiceName + " · " + fmt(S.voiceDur);
  const clr = $("vvCamVoiceClrBtn");
  if (clr) clr.disabled = !S.voiceBlob;
}

function paintSrc() {
  const el = $("vvCamSrcLine");
  if (el) {
    el.textContent = !S.srcBlob ? "No take yet — record below, import a video, or pull the finished clip."
      : S.srcName + " · " + S.srcW + "×" + S.srcH + " · " + fmt(S.srcDur) + " · " + mb(S.srcBlob.size);
  }
  const use = $("vvCamUseBtn"), save = $("vvCamSaveSrcBtn"), go = $("vvCamGoBtn");
  if (use) use.disabled = !S.srcBlob;
  if (save) save.disabled = !S.srcBlob;
  if (go) go.disabled = !S.srcBlob;
  paintOut();
}

function paintOut() {
  const el = $("vvCamOutLine");
  if (el) {
    el.textContent = !S.outBlob ? "No merged file yet."
      : "Ready: " + S.outW + "×" + S.outH + " · " + mb(S.outBlob.size) + " · " + String(S.outExt).toUpperCase();
  }
  const dl = $("vvCamDlBtn"), sv = $("vvCamSaveBtn");
  if (dl) dl.hidden = !S.outBlob;
  if (sv) sv.disabled = !S.outBlob;
}

const HEIGHTS = [["orig", "Original size"], ["720", "720p"], ["1080", "1080p"], ["1440", "1440p"], ["2160", "4K (2160p)"]];
const QUALITY = {
  max: { label: "Near-lossless (max bitrate)", bps: { 720: 8e6, 1080: 16e6, 1440: 28e6, 2160: 45e6 } },
  high: { label: "High", bps: { 720: 4e6, 1080: 8e6, 1440: 14e6, 2160: 24e6 } },
  balanced: { label: "Balanced", bps: { 720: 1.8e6, 1080: 3.5e6, 1440: 7e6, 2160: 12e6 } },
  small: { label: "Small file", bps: { 720: 0.8e6, 1080: 1.5e6, 1440: 3e6, 2160: 6e6 } },
};

function cropRect() {
  const sel = $("vvCamCropSel")?.value || "orig";
  const sw = S.srcW, sh = S.srcH;
  if (sel === "orig" || !sw || !sh) return { x: 0, y: 0, w: sw, h: sh };
  const [rw, rh] = sel.split(":").map(Number);
  const want = rw / rh, have = sw / sh;
  if (Math.abs(want - have) < 0.01) return { x: 0, y: 0, w: sw, h: sh };
  if (want > have) { const h = Math.round(sw / want); return { x: 0, y: Math.round((sh - h) / 2), w: sw, h }; }
  const w = Math.round(sh * want); return { x: Math.round((sw - w) / 2), y: 0, w, h: sh };
}

function targetWH() {
  const c = cropRect();
  const h = $("vvCamSizeSel")?.value || "orig";
  const even = (v) => Math.max(2, v - (v % 2));
  if (h === "orig" || !c.w || !c.h) return { w: even(c.w), h: even(c.h) };
  const th = Number(h);
  const k = Math.min(1.6, th / c.h);
  let w = Math.round((c.w * k) / 2) * 2;
  let hh = Math.round((c.h * k) / 2) * 2;
  if (w > 3840) { const kk = 3840 / w; w = 3840; hh = Math.round(hh * kk / 2) * 2; }
  return { w: even(w), h: even(hh) };
}

async function posterFor(blob) {
  try {
    const { extractFrame } = await import("./video.js");
    const shot = await extractFrame(blob, "first");
    return await new Promise((res) => { const r = new FileReader(); r.onload = () => res(String(r.result || "")); r.onerror = () => res(""); r.readAsDataURL(shot); });
  } catch { return ""; }
}

async function saveToLib(blob, filename, dur) {
  try {
    const { saveBlobToLibrary } = await import("./library-save.js");
    let poster = await posterFor(blob);
    if (!String(poster || "").startsWith("data:")) poster = null;
    const r = await saveBlobToLibrary({ kind: "final", tab: "voice", blob, filename, prompt: "camera clip: " + filename, extra: { provider: "voice-camera", providerLabel: "Voiceover camera", duration: dur || 0, actualDuration: dur || 0, poster } });
    toast(r?.locked ? "Library is locked — enter the vault passphrase first." : r?.ok ? "Saved to the Library (Voice)." : "Couldn't save to the Library.");
  } catch (e) { toast("Couldn't save: " + (e?.message || e)); }
}

async function process() {
  if (!S.srcBlob) return;
  if (S.srcDur > 600) { toast("That clip is long — processing is capped at 10 minutes."); return; }
  const btn = $("vvCamGoBtn");
  const st = $("vvCamStatus");
  btn.disabled = true;
  if (st) { st.dataset.busy = "1"; st.textContent = "Loading…"; }
  try {
    const { w, h } = targetWH();
    if (!w || !h) throw new Error("no video size");
    const crop = cropRect();
    const q = QUALITY[$("vvCamQSel")?.value || "high"] || QUALITY.high;
    const bucket = h >= 2000 ? 2160 : h >= 1300 ? 1440 : h >= 900 ? 1080 : 720;
    const bps = q.bps[bucket];
    const url = S.srcUrl;
    const v = document.createElement("video");
    v.muted = true; v.playsInline = true; v.preload = "auto"; v.src = url;
    await new Promise((res, rej) => { v.onloadedmetadata = res; v.onerror = () => rej(new Error("could not read video")); });
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
    try { ctx.filter = filterCss(); } catch {}
    ctx.fillStyle = "#000"; ctx.fillRect(0, 0, w, h);
    const stream = canvas.captureStream(30);
    const AC = window.AudioContext || window.webkitAudioContext;
    const ac = new AC();
    await ac.resume().catch(() => {});
    const ael = document.createElement("audio");
    ael.src = S.voiceBlob ? S.voiceUrl : url;
    const msrc = ac.createMediaElementSource(ael);
    const dest = ac.createMediaStreamDestination();
    msrc.connect(dest);
    const mixed = new MediaStream([...stream.getVideoTracks(), ...dest.stream.getAudioTracks()]);
    const mime = pickRecMime();
    const rec = new MediaRecorder(mixed, { ...(mime ? { mimeType: mime } : {}), videoBitsPerSecond: bps });
    const parts = [];
    rec.ondataavailable = (e) => { if (e.data?.size) parts.push(e.data); };
    const done = new Promise((res) => { rec.onstop = res; });
    let total = Number(v.duration);
    if (!Number.isFinite(total) || total <= 0) total = S.srcDur;
    if (!Number.isFinite(total) || total <= 0) total = 5;
    total = Math.min(total, 600);
    const t0 = performance.now();
    const tick = () => {
      try {
        const sx = crop.x || 0, sy = crop.y || 0, sw = crop.w || v.videoWidth, sh = crop.h || v.videoHeight;
        ctx.drawImage(v, sx, sy, sw, sh, 0, 0, w, h);
      } catch {}
      if (rec.state === "recording") {
        if (st) st.textContent = "Merging " + Math.min(total, (performance.now() - t0) / 1000).toFixed(1) + "s / " + total.toFixed(1) + "s…";
        requestAnimationFrame(tick);
      }
    };
    await v.play().catch(() => {});
    await ael.play().catch(() => {});
    tick();
    rec.start(250);
    await new Promise((res) => {
      const poll = () => (((performance.now() - t0) / 1000 >= total + 0.25) || v.ended && (performance.now() - t0) / 1000 >= total) ? res() : setTimeout(poll, 120);
      poll();
    });
    rec.stop();
    await done;
    try { v.pause(); ael.pause(); } catch {}
    ac.close().catch(() => {});
    const out = new Blob(parts, { type: rec.mimeType || mime || "video/webm" });
    if (!out.size) throw new Error("processing produced nothing");
    if (S.outUrl) try { URL.revokeObjectURL(S.outUrl); } catch {}
    S.outBlob = out;
    S.outUrl = URL.createObjectURL(out);
    S.outExt = extForMime(rec.mimeType || mime || out.type);
    S.outW = w; S.outH = h; S.outDur = total;
    paintOut();
    if (st) st.textContent = "Done — " + w + "×" + h + " · " + mb(out.size) + (S.voiceBlob ? " · with your voiceover." : ".");
    toast("Merged — download it or save it to the Library.");
  } catch (e) {
    if (st) st.textContent = "Failed: " + (e?.message || e);
    toast("Process failed: " + (e?.message || e));
  } finally {
    btn.disabled = !S.srcBlob;
    if (st) delete st.dataset.busy;
  }
}

function inject() {
  if ($("vvCamBox")) return;
  const home = $("vvCamHome");
  const anchor = home || $("vvClipLine")?.parentElement;
  const stage = document.querySelector("#pageVoice .panel.stage");
  if (!anchor && !stage) return;
  const box = document.createElement("div");
  box.id = "vvCamBox";
  box.className = "field";
  if (!home) box.style.marginTop = "10px";
  box.innerHTML =
    "<label class=\"lbl\">1 · Voiceover audio <span class=\"hint\">import first — you will lip-match to this</span></label>" +
    "<div id=\"vvCamVoiceLine\" class=\"model-note\">No voiceover yet — import an mp3 or audio file first.</div>" +
    "<div style=\"display:flex;gap:6px;flex-wrap:wrap;margin-top:6px;align-items:center\">" +
    "<button id=\"vvCamVoiceBtn\" type=\"button\" class=\"btn btn-tiny\">Import voiceover…</button>" +
    "<button id=\"vvCamVoiceClrBtn\" type=\"button\" class=\"btn btn-tiny\" disabled>Clear</button>" +
    "</div>" +
    "<input id=\"vvCamVoiceFile\" type=\"file\" accept=\"audio/*,.mp3,.wav,.ogg,.m4a,.flac\" hidden>" +
    "<audio id=\"vvCamAudio\" controls style=\"width:100%;margin-top:8px\" hidden></audio>" +
    "<label class=\"lbl\" style=\"margin-top:10px\">2 · Record the take <span class=\"hint\">front / back — the voiceover plays while you record</span></label>" +
    "<video id=\"vvCamPrev\" muted playsinline style=\"width:100%;border-radius:8px;background:#000;max-height:240px\"></video>" +
    "<div style=\"display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;align-items:center\">" +
    "<select id=\"vvCamSel\" class=\"tiny-select\" title=\"Camera\" style=\"flex:1;min-width:120px\"></select>" +
    "<button id=\"vvCamFlipBtn\" type=\"button\" class=\"btn btn-tiny\" title=\"Switch front / back camera\">⇄ Flip</button>" +
    "<button id=\"vvCamTakeBtn\" type=\"button\" class=\"btn btn-tiny btn-primary\">● Record take</button>" +
    "</div>" +
    "<div id=\"vvCamStatus\" class=\"model-note\" style=\"margin-top:6px\">Camera off — press Record take to start the camera.</div>" +
    "<div id=\"vvCamSrcLine\" class=\"model-note\" style=\"margin-top:6px\">No take yet — record above, import a video, or pull the finished clip.</div>" +
    "<div style=\"display:flex;gap:6px;flex-wrap:wrap;margin-top:6px\">" +
    "<button id=\"vvCamUseBtn\" type=\"button\" class=\"btn btn-tiny\" disabled>Use as timeline clip</button>" +
    "<button id=\"vvCamFinBtn\" type=\"button\" class=\"btn btn-tiny\">Use finished clip</button>" +
    "<button id=\"vvCamImpBtn\" type=\"button\" class=\"btn btn-tiny\">Import video…</button>" +
    "<button id=\"vvCamSaveSrcBtn\" type=\"button\" class=\"btn btn-tiny\" disabled>Save take to Library</button>" +
    "</div>" +
    "<input id=\"vvCamFile\" type=\"file\" accept=\"video/*\" hidden>" +
    "<label class=\"lbl\" style=\"margin-top:10px\">3 · Crop + look <span class=\"hint\">framing for each platform, filter of your choice</span></label>" +
    "<div style=\"display:flex;gap:6px;flex-wrap:wrap;align-items:center\">" +
    "<select id=\"vvCamCropSel\" class=\"tiny-select\" title=\"Crop ratio\"></select>" +
    "<select id=\"vvCamFilterSel\" class=\"tiny-select\" title=\"Filter\"></select>" +
    "</div>" +
    "<div class=\"hint-block\">Crop cuts the take to the platform frame before merging. The filter shows live on the preview above.</div>" +
    "<label class=\"lbl\" style=\"margin-top:10px\">4 · Merge + export <span class=\"hint\">one take + voiceover → video file</span></label>" +
    "<div style=\"display:flex;gap:6px;flex-wrap:wrap;align-items:center\">" +
    "<select id=\"vvCamSizeSel\" class=\"tiny-select\" title=\"Output size\"></select>" +
    "<select id=\"vvCamQSel\" class=\"tiny-select\" title=\"Quality\"></select>" +
    "<button id=\"vvCamGoBtn\" type=\"button\" class=\"btn btn-tiny btn-primary\" disabled>Merge</button>" +
    "</div>" +
    "<div class=\"hint-block\">Upscale here is a high-quality resample, not AI detail. Near-lossless = maximum bitrate (big file).</div>" +
    "<div id=\"vvCamOutLine\" class=\"model-note\" style=\"margin-top:6px\">No merged file yet.</div>" +
    "<div style=\"display:flex;gap:6px;flex-wrap:wrap;margin-top:6px\">" +
    "<button id=\"vvCamDlBtn\" type=\"button\" class=\"btn btn-tiny\" hidden>Download</button>" +
    "<button id=\"vvCamSaveBtn\" type=\"button\" class=\"btn btn-tiny\" disabled>Save to Library</button>" +
    "</div>";
  if (home) home.appendChild(box);
  else (anchor || stage).after(box);
  const sizeSel = $("vvCamSizeSel");
  for (const [id, label] of HEIGHTS) { const o = document.createElement("option"); o.value = id; o.textContent = label; sizeSel.appendChild(o); }
  sizeSel.value = "1080";
  const qSel = $("vvCamQSel");
  for (const [id, q] of Object.entries(QUALITY)) { const o = document.createElement("option"); o.value = id; o.textContent = q.label; qSel.appendChild(o); }
  qSel.value = "high";
  const cropSel = $("vvCamCropSel");
  for (const [id, label] of CROPS) { const o = document.createElement("option"); o.value = id; o.textContent = label; cropSel.appendChild(o); }
  const fSel = $("vvCamFilterSel");
  for (const [id, label] of FILTERS) { const o = document.createElement("option"); o.value = id; o.textContent = label; fSel.appendChild(o); }
  fSel.onchange = () => { const pv = $("vvCamPrev"); if (pv) pv.style.filter = filterCss(); };
  const oldRec = $("vvCamRecBtn");
  if (oldRec) oldRec.hidden = true;
  $("vvCamTakeBtn").onclick = toggleTake;
  $("vvCamFlipBtn").onclick = async () => {
    S.facing = S.facing === "user" ? "environment" : "user";
    await listCams();
    if (S.stream || S.rec) startCam();
    else paintCam();
  };
  $("vvCamSel").onchange = () => { if (S.stream) startCam(); };
  $("vvCamVoiceBtn").onclick = () => $("vvCamVoiceFile").click();
  $("vvCamVoiceFile").onchange = () => {
    const f = $("vvCamVoiceFile").files?.[0];
    $("vvCamVoiceFile").value = "";
    if (f) setVoice(f, f.name);
    const el = voiceEl();
    if (el) el.hidden = !S.voiceBlob && !el.src;
    if (el && S.voiceBlob) el.hidden = false;
  };
  $("vvCamVoiceClrBtn").onclick = () => {
    if (S.voiceUrl) try { URL.revokeObjectURL(S.voiceUrl); } catch {}
    S.voiceBlob = null; S.voiceUrl = ""; S.voiceName = ""; S.voiceDur = 0;
    const el = voiceEl();
    if (el) { el.removeAttribute("src"); el.hidden = true; }
    paintVoice();
  };
  $("vvCamUseBtn").onclick = () => {
    if (!S.srcBlob) return;
    if (window.__vvLoadClip) { window.__vvLoadClip(S.srcBlob, S.srcName); toast("Camera clip loaded as the timeline."); }
    else toast("Timeline is not ready — try again in a second.");
  };
  $("vvCamFinBtn").onclick = () => {
    const b = window.AIVideoGen?.state?.result?.blob;
    if (!b?.size) { toast("No finished clip yet — generate one first, or record."); return; }
    setSource(b, "finished-clip." + extForMime(b.type));
  };
  $("vvCamImpBtn").onclick = () => $("vvCamFile").click();
  $("vvCamFile").onchange = async () => {
    const f = $("vvCamFile").files?.[0];
    $("vvCamFile").value = "";
    if (!f) return;
    if (!await scanOk(f, 100)) return;
    setSource(f, f.name);
  };
  $("vvCamSaveSrcBtn").onclick = () => {
    if (S.srcBlob) saveToLib(S.srcBlob, S.srcName || ("camera-" + Date.now() + ".mp4"), S.srcDur);
  };
  $("vvCamGoBtn").onclick = process;
  $("vvCamDlBtn").onclick = () => {
    if (!S.outBlob) return;
    const a = document.createElement("a");
    a.href = S.outUrl;
    a.download = "camera-" + S.outW + "x" + S.outH + "-" + new Date().toISOString().slice(0, 10) + "." + S.outExt;
    document.body.appendChild(a); a.click(); setTimeout(() => a.remove(), 2000);
  };
  $("vvCamSaveBtn").onclick = () => {
    if (S.outBlob) saveToLib(S.outBlob, "camera-" + S.outW + "x" + S.outH + "-" + new Date().toISOString().slice(0, 10) + "." + S.outExt, S.outDur);
  };
  listCams();
  try { navigator.mediaDevices?.addEventListener?.("devicechange", listCams); } catch {}
  paintCam();
  paintSrc();
  paintVoice();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => setTimeout(inject, 700));
else setTimeout(inject, 700);
try {
  new MutationObserver(() => { if (!$("vvCamBox")) inject(); }).observe(document.documentElement, { childList: true, subtree: true });
} catch {}
