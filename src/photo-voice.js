const $ = (id) => document.getElementById(id);
const LETTER = "Oh no, what happened, why I am here. Importance of Education. Education plays a very important role in our life. It is the foundation of personal and social development. Education helps us gain knowledge, improve our understanding, and shape our character. A well-educated person is respected in society. Education teaches us good manners, discipline, and moral values. It helps us develop confidence and positive thinking. Through education, we learn how to behave properly with others and how to face challenges in life. An educated person can think clearly and take correct decisions. Education is also essential for building a successful career. It provides us with skills and abilities that help us get a good job and earn a decent living. Without education, it is very difficult to survive in today's competitive world. Education plays a vital role in the progress of a nation. Educated citizens contribute to economic growth and social development. They help in reducing poverty, unemployment, and social evils. Education creates awareness about health, environment, and civic responsibilities. In conclusion, education is the key to success and a better future. Every child should get proper education without discrimination. Education not only improves individual life but also makes society peaceful, progressive, and developed.";
let media = { kind: "", blob: null, url: "", name: "", W: 0, H: 0, bmp: null };
let voiceFile = { blob: null, name: "" };
let voiced = { blob: null, url: "", ext: "" };
function toast(m) {
  const h = document.querySelector(".toasts") || (() => { const d = document.createElement("div"); d.className = "toasts"; document.body.appendChild(d); return d; })();
  const t = document.createElement("div"); t.className = "toast"; t.textContent = m; h.appendChild(t);
  setTimeout(() => { t.style.opacity = "0"; setTimeout(() => t.remove(), 320); }, 3600);
}
function chunkScript(text, max = 180) {
  const parts = String(text).split(/(?<=[.!?\n])\s+/).map((s) => s.trim()).filter(Boolean);
  const out = [];
  for (const p of parts) {
    if (p.length <= max) { out.push(p); continue; }
    for (let i = 0; i < p.length; i += max) out.push(p.slice(i, i + max));
  }
  return out.slice(0, 60);
}
async function fetchChunk(chunk, tl) {
  const url = "https://translate.google.com/translate_tts?ie=UTF-8&q=" + encodeURIComponent(chunk) + "&tl=" + tl + "&client=tw-ob";
  const r = await root.superFetch(url);
  if (!r.ok) throw new Error("voice service answered " + r.status);
  const b = await r.arrayBuffer();
  if (!b?.byteLength) throw new Error("voice service sent nothing");
  return b;
}
async function buildVoiceAudio(text) {
  const tl = "en";
  const rate = Number($("voiceRateRange")?.value) || 1;
  const chunks = chunkScript(text);
  if (!chunks.length) throw new Error("empty script");
  const AC = window.AudioContext || window.webkitAudioContext;
  const ac = new AC();
  try {
    const bufs = [];
    for (let i = 0; i < chunks.length; i++) {
      setStatus("Voicing " + (i + 1) + "/" + chunks.length + "…");
      const raw = await fetchChunk(chunks[i], tl);
      bufs.push(await ac.decodeAudioData(raw.slice(0)));
    }
    const sr = bufs[0].sampleRate, ch = Math.min(2, bufs[0].numberOfChannels);
    const parts = [];
    for (const b of bufs) {
      const len = Math.max(1, Math.round(b.length / rate));
      const off = new OfflineAudioContext(ch, len, sr);
      const s = off.createBufferSource(); s.buffer = b; s.playbackRate.value = rate; s.connect(off.destination); s.start();
      parts.push(await off.startRendering());
    }
    const gap = Math.floor(sr * 0.18);
    const total = parts.reduce((a, p) => a + p.length, 0) + gap * (parts.length - 1);
    const mix = ac.createBuffer(ch, total, sr);
    let at = 0;
    for (const p of parts) {
      for (let c = 0; c < ch; c++) mix.getChannelData(c).set(p.getChannelData(Math.min(c, p.numberOfChannels - 1)), at);
      at += p.length + gap;
    }
    return mix;
  } finally { ac.close().catch(() => {}); }
}
async function decodeVoiceFile(blob) {
  const AC = window.AudioContext || window.webkitAudioContext;
  const ac = new AC();
  try {
    const raw = await blob.arrayBuffer();
    return await ac.decodeAudioData(raw);
  } finally { ac.close().catch(() => {}); }
}
function setStatus(m) { const el = $("pvStatus"); if (el) el.textContent = m; }
function paintMedia() {
  const line = $("pvPhotoLine"); if (!line) return;
  if (!media.blob) line.textContent = "No background yet — import a photo or a video (mp4, webm, mov…).";
  else line.textContent = (media.kind === "video" ? "Video" : "Photo") + ": " + media.name + " · " + (media.blob.size / 1024).toFixed(0) + " KB";
  const af = $("pvAudioLine");
  if (af) af.textContent = voiceFile.blob ? "Voiceover audio: " + voiceFile.name : "Voiceover: generated in-app (or import an mp3/wav).";
}
function probeVideo(url) {
  return new Promise((res, rej) => {
    const v = document.createElement("video");
    v.muted = true; v.preload = "auto"; v.src = url;
    v.onloadedmetadata = () => res({ W: v.videoWidth || 1280, H: v.videoHeight || 720, dur: v.duration || 0 });
    v.onerror = () => rej(new Error("couldn't read that video file"));
    setTimeout(() => rej(new Error("timed out reading that video file")), 15000);
  });
}
async function loadMedia(blob, name) {
  const type = blob.type || "";
  const low = (name || "").toLowerCase();
  const isVideo = type.startsWith("video/") || /\.(mp4|m4v|mov|webm|mkv|avi|ogv)$/.test(low);
  if (media.url) try { URL.revokeObjectURL(media.url); } catch {}
  const url = URL.createObjectURL(blob);
  media = { kind: isVideo ? "video" : "image", blob, url, name: name || "", W: 0, H: 0, bmp: null };
  const img = $("pvPreviewImg"), vid = $("pvPreviewVid");
  if (img) img.hidden = true;
  if (vid) { vid.hidden = true; vid.removeAttribute("src"); vid.load(); }
  if (isVideo) {
    const info = await probeVideo(url);
    media.W = info.W; media.H = info.H; media.dur = info.dur;
    if (vid) { vid.src = url; vid.hidden = false; }
  } else {
    media.bmp = await createImageBitmap(blob);
    media.W = media.bmp.width; media.H = media.bmp.height;
    if (img) { img.src = url; img.hidden = false; }
  }
  paintMedia();
}
async function loadScriptFile(file) {
  setStatus("Reading " + file.name + "…");
  try {
    if (window.ReaderBridge && window.ReaderBridge.extractFile) {
      const { text } = await window.ReaderBridge.extractFile(file);
      $("voiceTextInput").value = text;
    } else {
      const low = file.name.toLowerCase();
      if (/\.(docx|pdf|doc)$/.test(low)) {
        setStatus("Open the Reader tab once first (it unlocks Word/PDF script import), or drop a .txt here.");
        toast("Reader tab unlocks Word/PDF script import.");
        return;
      }
      $("voiceTextInput").value = (await file.text()).trim();
    }
    $("voiceTextInput").dispatchEvent(new Event("input", { bubbles: true }));
    setStatus("Script loaded from " + file.name + ".");
  } catch (e) { setStatus("Script import failed: " + (e?.message || e)); }
}
function pickMime() {
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
async function render() {
  const btn = $("pvRenderBtn");
  try {
    const useFile = $("pvVoiceSrcSel")?.value === "file";
    const text = $("voiceTextInput")?.value.trim() || "";
    if (!media.blob) { toast("Import a photo or video background first."); return; }
    if (!useFile && !text) { toast("Type a script first (or switch the voiceover source to an audio file)."); return; }
    if (useFile && !voiceFile.blob) { toast("Import a voiceover audio file first (mp3, wav, ogg…)."); return; }
    btn.disabled = true; btn.textContent = "Voicing…";
    const audioBuf = useFile ? await decodeVoiceFile(voiceFile.blob) : await buildVoiceAudio(text);
    const total = audioBuf.duration + 0.8;
    const talkOn = $("pvTalkToggle") ? $("pvTalkToggle").checked : true;
    let mouthEnv = null, mouthPos = { x: 0.5, y: 0.72, w: 60 };
    try {
      const lip = await import("./lipsync-lite.js");
      mouthEnv = lip.envelopeFor(audioBuf, 30, total);
      if (media.kind !== "video" && media.bmp) mouthPos = await lip.findMouth(media.bmp);
      var lipDraw = lip.drawTalking;
    } catch {}
    let W = 720, H = 1280;
    if (media.kind === "video") {
      const s = Math.min(1, 720 / media.W, 1280 / media.H);
      W = Math.max(2, Math.round(media.W * s)); H = Math.max(2, Math.round(media.H * s));
    } else {
      const iw = media.W || 720, ih = media.H || 960;
      const scale = Math.max(720 / iw, 1280 / ih, 1);
      W = Math.round(Math.min(iw * scale, 720)); H = Math.round(W * (ih / iw));
      if (H > 1280) { H = 1280; W = Math.round(H * (iw / ih)); }
    }
    W -= W % 2; H -= H % 2;
    const canvas = document.createElement("canvas");
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d");
    let bgVideo = null;
    const drawImage = (t) => {
      const g = Math.min(1, t / total);
      const z = 1 + 0.06 * g;
      if (talkOn && mouthEnv && typeof lipDraw === "function" && media.bmp) {
        const o = mouthEnv[Math.min(mouthEnv.length - 1, Math.floor(t * 30))] || 0;
        lipDraw(ctx, media.bmp, W, H, o, mouthPos, z);
      } else {
        const dw = W * z, dh = H * z;
        ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
        ctx.drawImage(media.bmp, (W - dw) / 2, (H - dh) / 2, dw, dh);
      }
    };
    const drawVideo = () => {
      if (!bgVideo) return;
      const iw = bgVideo.videoWidth || W, ih = bgVideo.videoHeight || H;
      const s = Math.max(W / iw, H / ih);
      const dw = iw * s, dh = ih * s;
      ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
      ctx.drawImage(bgVideo, (W - dw) / 2, (H - dh) / 2, dw, dh);
    };
    if (media.kind === "video") {
      bgVideo = document.createElement("video");
      bgVideo.muted = true; bgVideo.playsInline = true; bgVideo.src = media.url;
      bgVideo.loop = true;
      await bgVideo.play().catch(() => {});
      drawVideo();
    } else drawImage(0);
    btn.textContent = "Filming…";
    setStatus("Filming " + total.toFixed(1) + "s video…");
    const stream = canvas.captureStream(30);
    const AC = window.AudioContext || window.webkitAudioContext;
    const ac = new AC();
    await ac.resume().catch(() => {});
    const srcN = ac.createBufferSource(); srcN.buffer = audioBuf;
    const gain = ac.createGain(); gain.gain.value = 1;
    const dest = ac.createMediaStreamDestination();
    srcN.connect(gain); gain.connect(dest); gain.connect(ac.destination);
    const mixed = new MediaStream([...stream.getVideoTracks(), ...dest.stream.getAudioTracks()]);
    const mime = pickMime();
    const rec = new MediaRecorder(mixed, mime ? { mimeType: mime, videoBitsPerSecond: 4_000_000 } : undefined);
    const parts = [];
    rec.ondataavailable = (e) => { if (e.data?.size) parts.push(e.data); };
    const done = new Promise((res) => { rec.onstop = res; });
    const t0 = performance.now();
    let raf = 0;
    const tick = () => {
      const t = (performance.now() - t0) / 1000;
      if (media.kind === "video") drawVideo(); else drawImage(t);
      raf = requestAnimationFrame(tick);
    };
    tick();
    srcN.start();
    rec.start(250);
    await new Promise((res) => {
      const poll = () => { ((performance.now() - t0) / 1000 >= total + 0.25) ? res() : setTimeout(poll, 120); };
      poll();
    });
    cancelAnimationFrame(raf);
    rec.stop(); await done;
    try { srcN.stop(); } catch {}
    try { bgVideo && bgVideo.pause(); } catch {}
    ac.close().catch(() => {});
    const realExt = (mime || rec.mimeType || "").includes("mp4") ? "mp4" : "webm";
    const out = new Blob(parts, { type: mime || rec.mimeType || "video/mp4" });
    if (!out.size) throw new Error("render produced nothing");
    if (voiced.url) try { URL.revokeObjectURL(voiced.url); } catch {}
    voiced = { blob: out, url: URL.createObjectURL(out), ext: realExt };
    window.PV_LAST = voiced;
    const v = $("pvVideo");
    if (v) { v.src = voiced.url; v.play().catch(() => {}); }
    const dl = $("pvDlBtn");
    if (dl) { dl.hidden = false; dl.textContent = "Download " + realExt.toUpperCase(); }
    try {
      const { saveBlobToLibrary } = await import("./library-save.js");
      saveBlobToLibrary({ kind: "final", tab: "voice", blob: out, filename: "voiceover-" + new Date().toISOString().slice(0, 10) + "." + realExt, prompt: text.slice(0, 120), extra: { provider: "voiceover-studio", providerLabel: "Voiceover Studio", duration: total, actualDuration: total } });
    } catch (e) {}
    setStatus("Done — " + total.toFixed(1) + "s " + realExt.toUpperCase() + " · " + (out.size / 1024).toFixed(0) + " KB · background on screen, voiceover on track.");
    toast("Voiceover " + realExt.toUpperCase() + " ready — playing above. Hit Download.");
  } catch (e) { setStatus("Failed: " + (e?.message || e)); toast("Render failed: " + (e?.message || e)); }
  finally { btn.disabled = false; btn.textContent = "Render voiceover → video"; }
}
function pvLog(m) { const el = $("pvLog"); if (el) el.textContent = (el.textContent === "Ready." ? "" : el.textContent + "\n") + m; }
function inject() {
  if ($("pvPickBtn") && $("pvPickBtn").dataset.bound) { paintMedia(); return; }
  if (!$("pvPickBtn") || !$("voiceTextInput")) return;
  const grab = (id) => $(id);
  grab("pvPickBtn").dataset.bound = "1";
  grab("pvPickBtn").onclick = () => grab("pvFile").click();
  grab("pvFile").onchange = async () => { const f = grab("pvFile").files?.[0]; grab("pvFile").value = ""; if (!f) return; try { setStatus("Reading " + f.name + "\u2026"); pvLog("Background: " + f.name); await loadMedia(f, f.name); setStatus("Background ready."); } catch (e) { setStatus("Background failed: " + (e?.message || e)); } };
  if (grab("pvLibBtn")) grab("pvLibBtn").onclick = () => openPvLibrary();
  grab("pvSampleBtn").onclick = async () => {
    try {
      setStatus("Loading sample letter\u2026");
      const r = await fetch("src/assets/education.jpg");
      if (!r.ok) throw new Error("sample missing (HTTP " + r.status + ")");
      await loadMedia(await r.blob(), "education-letter.jpg");
      setStatus("Sample letter loaded.");
    } catch (e) { setStatus("Sample failed: " + (e?.message || e)); }
  };
  if (grab("pvScriptBtn")) grab("pvScriptBtn").onclick = () => { const s = $("voiceTextInput")?.value || ""; if (!s.trim()) { toast("Maker script is empty \u2014 type it in Voice Maker first."); return; } setStatus("Maker script linked (" + s.length + " chars). Render uses it."); toast("Maker script linked."); };
  if (grab("pvScriptFileBtn")) {
    grab("pvScriptFileBtn").onclick = () => grab("pvScriptFile").click();
    grab("pvScriptFile").onchange = () => { const f = grab("pvScriptFile").files?.[0]; grab("pvScriptFile").value = ""; if (f) loadScriptFile(f); };
  }
  grab("pvVoiceSrcSel").onchange = () => { grab("pvAudioBtn").hidden = grab("pvVoiceSrcSel").value !== "file"; paintMedia(); };
  grab("pvAudioBtn").onclick = () => grab("pvAudioFile").click();
  grab("pvAudioFile").onchange = () => { const f = grab("pvAudioFile").files?.[0]; grab("pvAudioFile").value = ""; if (f) { voiceFile = { blob: f, name: f.name }; paintMedia(); setStatus("Voiceover audio ready: " + f.name); } };
  grab("pvRenderBtn").onclick = render;
  grab("pvDlBtn").onclick = () => {
    if (!voiced.blob) return;
    const a = document.createElement("a"); a.href = voiced.url; a.download = "lipsync-" + new Date().toISOString().slice(0, 10) + "." + voiced.ext;
    document.body.appendChild(a); a.click(); setTimeout(() => a.remove(), 2000);
  };
  try { window.__pvLoadMedia = loadMedia; } catch {}
  paintMedia();
}
async function openPvLibrary() {
  try {
    const { listHistory, getHistory } = await import("./store.js");
    const rows = (await listHistory()).filter((r) => /image|video|png|jpg|jpeg|webp|mp4|webm/i.test(String(r.mime || r.ext || r.filename || ""))).slice(0, 12);
    if (!rows.length) { toast("Library has no faces yet."); return; }
    const pick = rows[0];
    const full = await getHistory(pick.key);
    const blob = full?.video || full?.image;
    if (!blob?.size) { toast("Couldn't open that file."); return; }
    await loadMedia(blob, full.filename || "library-face");
    toast("Library face loaded.");
  } catch (e) { toast("Library unavailable right now."); }
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => setTimeout(inject, 600));
else setTimeout(inject, 600);
try {
  new MutationObserver(() => { if (!$("pvPickBtn")) inject(); }).observe(document.documentElement, { childList: true, subtree: true });
} catch {}
