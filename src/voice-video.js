const $ = (id) => document.getElementById(id);

let track = { blob: null, url: "", name: "", duration: 0 };
let src = { blob: null, url: "", name: "", duration: 0 };
let shots = [];
let merged = { blob: null, url: "", ext: "" };

function toast(msg) {
  const host = document.querySelector(".toasts") || (() => {
    const d = document.createElement("div");
    d.className = "toasts";
    document.body.appendChild(d);
    return d;
  })();
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;
  host.appendChild(t);
  setTimeout(() => { t.style.opacity = "0"; setTimeout(() => t.remove(), 320); }, 3400);
}

function fmt(s) {
  s = Math.max(0, Number(s) || 0);
  return s.toFixed(1) + "s";
}

function allVoices() {
  try { return speechSynthesis.getVoices() || []; } catch { return []; }
}

function voiceKey(v) { return v?.voiceURI || (v?.name + "|" + v?.lang) || ""; }
function selVoice() {
  const key = $("voiceSel")?.value || "";
  const vs = allVoices();
  if (!key) return null;
  let v = vs.find((x) => voiceKey(x) === key);
  if (!v) { const idx = Number(key); if (Number.isFinite(idx) && vs[idx]) v = vs[idx]; }
  return v || null;
}

function selLang() {
  const v = selVoice();
  return ((v?.lang || "") + " " + (v?.name || "")).toLowerCase();
}

function applyVoiceFilter() {
  const q = ($("vvLangInput")?.value || "").trim().toLowerCase();
  const sel = $("voiceSel");
  if (!sel) return;
  const vs = allVoices();
  const cur = sel.value;
  sel.innerHTML = '<option value="">Default voice</option>';
  for (let i = 0; i < vs.length; i++) {
    const hay = ((vs[i].name || "") + " " + (vs[i].lang || "")).toLowerCase();
    if (q && !hay.includes(q)) continue;
    const o = document.createElement("option");
    o.value = voiceKey(vs[i]) || String(i);
    o.textContent = (vs[i].name || "voice") + " · " + (vs[i].lang || "?");
    sel.appendChild(o);
  }
  if (cur) sel.value = cur;
  if ($("vvVoiceCount")) $("vvVoiceCount").textContent = (sel.options.length - 1) + " voices" + (q ? ' for "' + q + '"' : "");
}

function setSliders(pitch, rate) {
  const p = $("voicePitchRange"), r = $("voiceRateRange");
  if (p) { p.value = String(pitch); p.dispatchEvent(new Event("input", { bubbles: true })); }
  if (r) { r.value = String(rate); r.dispatchEvent(new Event("input", { bubbles: true })); }
  if ($("voicePitchVal")) $("voicePitchVal").textContent = Number(pitch).toFixed(2);
  if ($("voiceRateVal")) $("voiceRateVal").textContent = Number(rate).toFixed(2) + "×";
}

function applyPersona(kind) {
  const hi = selLang().includes("hi");
  if (kind === "masculine") setSliders(hi ? 0.7 : 0.78, hi ? 0.92 : 0.95);
  else if (kind === "feminine") setSliders(hi ? 1.3 : 1.25, hi ? 1.05 : 1.05);
  else setSliders(1, 1);
  for (const b of document.querySelectorAll("#vvPersonaRow button")) b.classList.toggle("on", b.dataset.p === kind);
}

function testPhrase() {
  const L = selLang();
  if (/\bhi\b|hindi|हिन्दी|हिनदी/.test(L)) return "नमस्ते, यह एक परीक्षण है";
  if (/\bbn\b|bangla|bengali|বাংলা/.test(L)) return "নমস্কার, এটি একটি পরীক্ষা";
  if (/^es|español|spanish/.test(L)) return "Hola, esta es una prueba";
  if (/^fr|français|french/.test(L)) return "Bonjour, ceci est un test";
  if (/^de|deutsch|german/.test(L)) return "Hallo, dies ist ein Test";
  return "Hello, this is a voice test";
}

function testVoice() {
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(testPhrase());
    const v = selVoice();
    if (v) u.voice = v;
    u.rate = Number($("voiceRateRange")?.value) || 1;
    u.pitch = Number($("voicePitchRange")?.value) || 1;
    speechSynthesis.speak(u);
  } catch (e) { toast("Couldn't test: " + (e?.message || e)); }
}

function injectVoiceFinder() {
  if (!$("voiceSel")) return;
  const q = $("vvLangInput"), t = $("vvTestBtn"), pr = $("vvPersonaRow");
  if (q && !q.dataset.bound) { q.dataset.bound = "1"; q.oninput = applyVoiceFilter; }
  if (t && !t.dataset.bound) { t.dataset.bound = "1"; t.onclick = testVoice; }
  if (pr && !pr.dataset.bound) {
    pr.dataset.bound = "1";
    for (const b of pr.querySelectorAll("button")) {
      b.title = b.dataset.p === "neutral" ? "Natural pitch" : b.dataset.p + " preset: retunes pitch + speed (try Test after)";
      b.onclick = () => applyPersona(b.dataset.p);
    }
  }
  try { speechSynthesis.onvoiceschanged = applyVoiceFilter; } catch {}
  applyVoiceFilter();
}

function setTrack(blob, name) {  if (track.url) try { URL.revokeObjectURL(track.url); } catch {}
  track = { blob, url: blob ? URL.createObjectURL(blob) : "", name: name || "", duration: 0 };
  if (blob) {
    const a = document.createElement("audio");
    a.preload = "metadata";
    a.src = track.url;
    a.onloadedmetadata = () => {
      track.duration = Number(a.duration) || 0;
      paintTrack();
      drawWave();
      syncOffsetUI();
    };
  }
  paintTrack();
  drawWave();
  try { syncMergeReady(); } catch {}
}
window.__voiceLoadTrack = setTrack;

function paintTrack() {
  const el = $("vvTrackLine");
  const prev = $("vvAudioPrev");
  if (prev) {
    if (track.blob) { prev.src = track.url; prev.hidden = false; }
    else { prev.removeAttribute("src"); prev.hidden = true; }
  }
  if (!el) return;
  if (!track.blob) { el.textContent = "No voiceover track (audio) yet — record or import one."; try { syncMergeReady(); } catch {} return; }
  el.textContent = track.name + " · " + fmt(track.duration) + " · " + (track.blob.size / 1024).toFixed(0) + " KB";
  try { syncMergeReady(); } catch {}
}

let voiceRec = null;
let genBusy = false;

function detectScriptLang(text) {
  if (/[\u0900-\u097F]/.test(text)) return "hi";
  if (/[\u0B80-\u0BFF]/.test(text)) return "ta";
  if (/[\u0C00-\u0C7F]/.test(text)) return "te";
  if (/[\u0D00-\u0D7F]/.test(text)) return "ml";
  if (/[\u0980-\u09FF]/.test(text)) return "bn";
  if (/[ñ¿¡áéíóú]/i.test(text)) return "es";
  return "";
}

function genLang() {
  const v = selVoice();
  if (v?.lang) {
    const m = String(v.lang).toLowerCase().match(/^[a-z]{2}/);
    const two = m ? m[0] : "en";
    const ok = ["hi", "bn", "en", "es", "fr", "de", "it", "pt", "ru", "ja", "ko", "id", "nl", "pl", "zh", "ar", "tr", "uk", "ta", "te", "mr", "gu", "kn", "ml", "pa", "ur", "la"];
    if (ok.includes(two)) return two;
  }
  const text = $("voiceTextInput")?.value || "";
  return detectScriptLang(text) || "en";
}

function genPersonaRate() {
  const on = document.querySelector('#vvPersonaRow button.on')?.dataset.p || "neutral";
  if (on === "masculine") return 0.85;
  if (on === "feminine") return 1.15;
  return Number($("voiceRateRange")?.value) || 1;
}

function chunkScript(text, max = 180) {
  const parts = String(text).split(/(?<=[.!?।\n])\s+/).map((s) => s.trim()).filter(Boolean);
  const out = [];
  for (const p of parts) {
    if (p.length <= max) { out.push(p); continue; }
    for (let i = 0; i < p.length; i += max) out.push(p.slice(i, i + max));
  }
  return out.slice(0, 40);
}

async function fetchChunkAudio(chunk, tl) {
  const url = "https://translate.google.com/translate_tts?ie=UTF-8&q=" + encodeURIComponent(chunk) + "&tl=" + tl + "&client=tw-ob";
  const r = await root.superFetch(url);
  if (!r.ok) throw new Error("tts " + r.status);
  const buf = await r.arrayBuffer();
  if (!buf?.byteLength) throw new Error("tts empty reply");
  return buf;
}

async function genVoice(btnArg) {
  if (genBusy) return;
  const text = $("voiceTextInput")?.value.trim() || "";
  if (!text) { toast("Type a script first."); return; }
  const tl = genLang();
  const rate = genPersonaRate();
  const chunks = chunkScript(text);
  if (!chunks.length) { toast("Type a script first."); return; }
  genBusy = true;
  const btn = btnArg || $("voiceGenBtn") || Array.from(document.querySelectorAll("#pageVoice button")).find((b) => b.textContent.includes("Generate voice"));
  const prev = btn?.textContent;
  if (btn) { btn.disabled = true; }
  paintTrackCustom("Generating voice… 0/" + chunks.length + " (no mic — rendered in-app)");
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    const ac = new AC();
    try {
      const bufs = [];
      for (let i = 0; i < chunks.length; i++) {
        if (btn) btn.textContent = "Voicing " + (i + 1) + "/" + chunks.length + "\u2026";
        paintTrackCustom("Generating voice… " + (i + 1) + "/" + chunks.length);
        const raw = await fetchChunkAudio(chunks[i], tl);
        const dec = await ac.decodeAudioData(raw.slice(0));
        bufs.push(dec);
      }
      const sr = bufs[0].sampleRate;
      const ch = Math.min(2, bufs[0].numberOfChannels);
      const parts = [];
      for (const b of bufs) {
        const len = Math.max(1, Math.round(b.length / rate));
        const off = new OfflineAudioContext(ch, len, sr);
        const srcN = off.createBufferSource();
        srcN.buffer = b;
        srcN.playbackRate.value = rate;
        srcN.connect(off.destination);
        srcN.start();
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
      const wav = encodeWAV(mix);
      setTrack(wav, "voiceover-" + tl + "-" + new Date().toISOString().slice(11, 19).replace(/:/g, "") + ".wav");
      toast("Voiceover generated in-app — export it or merge it onto a clip.");
    } finally {
      ac.close().catch(() => {});
    }
  } catch (e) {
    paintTrack();
    toast("Voice render failed: " + (e?.message || e));
  } finally {
    genBusy = false;
    if (btn) { btn.disabled = false; btn.textContent = prev || "✨ Generate voice"; }
  }
}

function paintTrackCustom(msg) {
  const el = $("vvTrackLine");
  if (el) el.textContent = msg;
}

async function recVoice() {
  if (voiceRec) {
    try { voiceRec.stop(); } catch {}
    return;
  }
  const text = $("voiceTextInput")?.value.trim() || "";
  if (!text) { toast("Type a script first."); return; }
  if (text.length > 2500) { toast("Script is long — first ~2500 chars will be recorded."); }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) { toast("Mic blocked: " + (e?.message || e)); return; }
  const btn = Array.from(document.querySelectorAll("#pageVoice .field button")).find((b) => b.textContent.includes("Rec voice"));
  const chunks = [];
  const mr = new MediaRecorder(stream);
  voiceRec = mr;
  mr.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
  let stopped = false;
  const finish = (why) => {
    if (stopped) return;
    stopped = true;
    voiceRec = null;
    try { speechSynthesis.cancel(); } catch {}
    try { mr.stop(); } catch {}
    stream.getTracks().forEach((t) => t.stop());
    if (btn) { btn.textContent = "● Rec voice"; btn.disabled = false; }
    if (why === "done") {
      setTimeout(() => {
        const b = new Blob(chunks, { type: mr.mimeType || "audio/webm" });
        if (b.size) {
          const v = selVoice();
          setTrack(b, "voice-" + (v?.lang || "tts") + "-" + new Date().toISOString().slice(11, 19).replace(/:/g, "") + ".webm");
          toast("Voice recorded — export it below or merge it onto a clip.");
        } else toast("Nothing was captured — turn the volume up and try again.", "warn");
      }, 450);
    }
  };
  mr.onstop = () => {};
  mr.start();
  if (btn) { btn.textContent = "■ Stop"; }
  toast("Recording the voice — speakers on, quiet room.");
  setTimeout(() => finish("timeout"), 150000);
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text.slice(0, 2500));
    const v = selVoice();
    if (v) u.voice = v;
    u.rate = Number($("voiceRateRange")?.value) || 1;
    u.pitch = Number($("voicePitchRange")?.value) || 1;
    u.onend = () => finish("done");
    u.onerror = () => finish("done");
    speechSynthesis.speak(u);
  } catch (e) {
    finish("stop");
    toast("Couldn't speak: " + (e?.message || e));
  }
}

function injectTrackBox() {
  if (!$("voiceGenBtn")) return;
  const gen = $("voiceGenBtn"), rec = $("voiceRecBtn"), recV = $("voiceRecVoiceBtn"),
    imp = $("voiceImpBtn"), clr = $("voiceClrBtn"), file = $("voiceAudioFile"),
    fs = $("vvFmtSel"), eb = $("vvExportBtn"), save = $("vvSaveBtn");
  if (gen && !gen.dataset.bound) { gen.dataset.bound = "1"; gen.onclick = () => genVoice($("voiceGenBtn")); }
  if (recV && !recV.dataset.bound) { recV.dataset.bound = "1"; recV.onclick = recVoice; }
  if (eb && !eb.dataset.bound) { eb.dataset.bound = "1"; eb.onclick = exportTrack; }
  if (fs && !fs.dataset.bound) { fs.dataset.bound = "1"; fs.onchange = syncRateOpts; }
  if (save && !save.dataset.bound) {
    save.dataset.bound = "1";
    save.onclick = async () => {
      if (!track.blob) { toast("Generate or import a track first."); return; }
      try {
        const { saveBlobToLibrary } = await import("./library-save.js");
        await saveBlobToLibrary({ kind: "voice", tab: "voice", blob: track.blob, filename: track.name || "voiceover.wav", prompt: ($("voiceTextInput")?.value || "").slice(0, 120) });
        toast("Saved in-app → Library · Voice.");
      } catch (e) { toast("Save failed: " + (e?.message || e)); }
    };
  }
  paintTrack();
  syncRateOpts();
  if (rec && !rec.dataset.bound) {
    rec.dataset.bound = "1";
    let recorder = null, chunks = [];
    rec.onclick = async () => {
      try {
        if (recorder) { recorder.stop(); return; }
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        chunks = [];
        recorder = new MediaRecorder(stream);
        recorder.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
        recorder.onstop = () => {
          stream.getTracks().forEach((t) => t.stop());
          const b = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
          recorder = null;
          rec.textContent = "● Narrate (mic)";
          if (b.size) { setTrack(b, "narration-" + new Date().toISOString().slice(11, 19).replace(/:/g, "") + ".webm"); toast("Narration kept as the voiceover track."); }
        };
        recorder.start();
        rec.textContent = "■ Stop";
        toast("Recording — speak now.");
      } catch (e) { toast("Mic blocked: " + (e?.message || e)); }
    };
  }
  if (imp && file && !imp.dataset.bound) {
    imp.dataset.bound = "1";
    imp.onclick = () => file.click();
    file.onchange = () => {
      const f = file.files?.[0];
      file.value = "";
      if (f) { setTrack(f, f.name); toast("Imported as the voiceover track."); }
    };
  }
  if (clr && !clr.dataset.bound) { clr.dataset.bound = "1"; clr.onclick = () => setTrack(null, ""); }
}

function syncRateOpts() {
  const f = $("vvFmtSel")?.value || "wav";
  const bs = $("vvRateSel");
  if (!bs) return;
  bs.innerHTML = "";
  const opts = f === "mp3" ? [["64", "64 kbps"], ["96", "96 kbps"], ["128", "128 kbps · standard"], ["192", "192 kbps"], ["256", "256 kbps"], ["320", "320 kbps · max"]] :
    f === "ogg" ? [["32", "32 kbps"], ["64", "64 kbps · standard"], ["96", "96 kbps"], ["128", "128 kbps"]] :
    [["16", "16-bit PCM"], ["32", "32-bit float PCM"]];
  for (const o of opts) {
    const e = document.createElement("option");
    e.value = o[0];
    e.textContent = o[1];
    bs.appendChild(e);
  }
  bs.value = f === "mp3" ? "128" : f === "ogg" ? "64" : "16";
}

async function decodeTrack() {
  if (!track.blob) throw new Error("no voiceover track");
  const buf = await track.blob.arrayBuffer();
  const AC = window.AudioContext || window.webkitAudioContext;
  const ac = new AC();
  try { return await ac.decodeAudioData(buf.slice(0)); }
  finally { ac.close().catch(() => {}); }
}

async function resampleBuffer(buf, targetSr) {
  targetSr = Number(targetSr) || 0;
  if (!targetSr || targetSr === buf.sampleRate) return buf;
  const ch = Math.min(2, buf.numberOfChannels);
  const len = Math.max(1, Math.ceil(buf.duration * targetSr));
  const off = new OfflineAudioContext(ch, len, targetSr);
  const srcN = off.createBufferSource();
  srcN.buffer = buf;
  srcN.connect(off.destination);
  srcN.start();
  return await off.startRendering();
}

function encodeWAV(audioBuffer, bits) {
  bits = Number(bits) === 32 ? 32 : 16;
  const ch = Math.min(2, audioBuffer.numberOfChannels);
  const sr = audioBuffer.sampleRate;
  const len = audioBuffer.length;
  const bpc = bits / 8;
  const bytes = 44 + len * ch * bpc;
  const ab = new ArrayBuffer(bytes);
  const dv = new DataView(ab);
  const wstr = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  wstr(0, "RIFF");
  dv.setUint32(4, bytes - 8, true);
  wstr(8, "WAVE");
  wstr(12, "fmt ");
  dv.setUint32(16, 16, true);
  dv.setUint16(20, bits === 32 ? 3 : 1, true);
  dv.setUint16(22, ch, true);
  dv.setUint32(24, sr, true);
  dv.setUint32(28, sr * ch * bpc, true);
  dv.setUint16(32, ch * bpc, true);
  dv.setUint16(34, bits, true);
  wstr(36, "data");
  dv.setUint32(40, len * ch * bpc, true);
  const chans = [];
  for (let c = 0; c < ch; c++) chans.push(audioBuffer.getChannelData(c));
  let off = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < ch; c++) {
      const v = Math.max(-1, Math.min(1, chans[c][i]));
      if (bits === 32) { dv.setFloat32(off, v, true); off += 4; }
      else { dv.setInt16(off, v < 0 ? v * 32768 : v * 32767, true); off += 2; }
    }
  }
  return new Blob([ab], { type: "audio/wav" });
}

async function encodeMP3(audioBuffer, kbps) {
  let lame;
  try { lame = await import("https://esm.sh/lamejs@1.2.1"); }
  catch { throw new Error("MP3 encoder couldn't load (needs network) — WAV works offline"); }
  const Mp3Encoder = lame.Mp3Encoder || lame.default?.Mp3Encoder;
  if (!Mp3Encoder) throw new Error("MP3 encoder unavailable — WAV works offline");
  const sr = audioBuffer.sampleRate;
  const ch = Math.min(2, audioBuffer.numberOfChannels);
  const enc = new Mp3Encoder(ch, sr, Number(kbps) || 128);
  const L = audioBuffer.getChannelData(0);
  const R = ch > 1 ? audioBuffer.getChannelData(1) : null;
  const B = 1152;
  const out = [];
  const f2i = (f) => {
    const a = new Int16Array(f.length);
    for (let i = 0; i < f.length; i++) {
      const v = Math.max(-1, Math.min(1, f[i]));
      a[i] = v < 0 ? v * 32768 : v * 32767;
    }
    return a;
  };
  for (let i = 0; i < L.length; i += B) {
    const l = f2i(L.slice(i, i + B));
    const d = R ? enc.encodeBuffer(l, f2i(R.slice(i, i + B))) : enc.encodeBuffer(l);
    if (d.length) out.push(new Uint8Array(d));
  }
  const end = enc.flush();
  if (end.length) out.push(new Uint8Array(end));
  return new Blob(out, { type: "audio/mpeg" });
}

async function encodeOGG(audioBuffer, kbps) {
  const AC = window.AudioContext || window.webkitAudioContext;
  const ac = new AC();
  try {
    const srcN = ac.createBufferSource();
    srcN.buffer = audioBuffer;
    const dest = ac.createMediaStreamDestination();
    srcN.connect(dest);
    const mime = ["audio/webm;codecs=opus", "audio/webm"].find((m) => { try { return MediaRecorder.isTypeSupported(m); } catch { return false; } }) || "";
    const rec = new MediaRecorder(dest.stream, { mimeType: mime || undefined, audioBitsPerSecond: (Number(kbps) || 64) * 1000 });
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
    const done = new Promise((res) => { rec.onstop = res; });
    await ac.resume().catch(() => {});
    srcN.start();
    rec.start();
    await new Promise((res) => setTimeout(res, Math.min(120000, audioBuffer.duration * 1000 + 300)));
    rec.stop();
    await done;
    return new Blob(chunks, { type: "audio/webm" });
  } finally { ac.close().catch(() => {}); }
}

async function exportTrack() {
  const note = $("vvExpNote");
  try {
    if (!track.blob) { toast("Record or import a voiceover track first."); return; }
    const f = $("vvFmtSel")?.value || "wav";
    const br = $("vvRateSel")?.value || "";
    if (note) note.textContent = "encoding…";
    const ab0 = await decodeTrack();
    let wantSr = Number($("vvSrSel")?.value) || 0;
    if (f === "mp3" && wantSr > 48000) wantSr = 48000;
    const ab = await resampleBuffer(ab0, wantSr);
    let out, ext, tag;
    if (f === "wav") { out = encodeWAV(ab, br); ext = "wav"; tag = (Number(br) === 32 ? "32bit" : "16bit") + "-" + Math.round(ab.sampleRate / 100) / 10 + "kHz"; }
    else if (f === "mp3") { out = await encodeMP3(ab, br); ext = "mp3"; tag = br + "kbps-" + Math.round(ab.sampleRate / 100) / 10 + "kHz"; }
    else { out = await encodeOGG(ab, br); ext = "ogg"; tag = br + "kbps-" + Math.round(ab.sampleRate / 100) / 10 + "kHz"; }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(out);
    a.download = "voiceover-" + tag + "-" + new Date().toISOString().slice(0, 10) + "." + ext;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 30000);
    if (note) note.textContent = (out.size / 1024).toFixed(0) + " KB · " + ext.toUpperCase() + " " + tag;
    toast("Voiceover exported.");
    try {
      const { saveBlobToLibrary } = await import("./library-save.js");
      saveBlobToLibrary({ kind: "voice", tab: "voice", blob: out, filename: a.download, prompt: "voiceover track", extra: { provider: "voiceover-track", providerLabel: "Voiceover track" } });
    } catch (e) {}
  } catch (e) {
    if (note) note.textContent = "";
    toast("Export failed: " + (e?.message || e));
  }
}

function estSecs(text) {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1.5, Math.min(8, words / 2.5));
}

function parseShots(raw, script) {
  const lines = String(raw || "").split("\n").map((s) => s.trim()).filter(Boolean);
  const out = [];
  let cur = null;
  const push = () => { if (cur?.visual) out.push(cur); cur = null; };
  for (const ln of lines) {
    const m = ln.match(/^(?:scene\s*)?(\d+)\s*[:.)-]\s*(.+)$/i);
    if (m) {
      push();
      cur = { line: m[2].slice(0, 220), visual: "", camera: "", secs: 0 };
    } else if (/^visual\s*:/i.test(ln) && cur) cur.visual = ln.replace(/^visual\s*:/i, "").trim().slice(0, 300);
    else if (/^camera\s*:/i.test(ln) && cur) cur.camera = ln.replace(/^camera\s*:/i, "").trim().slice(0, 120);
    else if (cur && !cur.visual && ln.length > 12) cur.visual = ln.slice(0, 300);
    else if (cur) cur.line = (cur.line + " " + ln).slice(0, 220);
  }
  push();
  let pool = out.filter((s) => s.visual);
  if (pool.length < 2) {
    const parts = String(script).split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 3);
    pool = parts.slice(0, 6).map((p) => ({ line: p.slice(0, 220), visual: "", camera: "", secs: 0 }));
    for (const p of pool) p.visual = "cinematic shot illustrating: " + p.line.slice(0, 140) + ", warm light, detailed";
  }
  for (const p of pool) p.secs = estSecs(p.line);
  return pool.slice(0, 6);
}

async function planScenes() {
  const script = $("voiceTextInput")?.value.trim() || "";
  if (!script) { toast("Type a script first."); return; }
  const gen = (typeof root !== "undefined" && root.generateText) || null;
  if (!gen) { toast("Director AI still loading — try again in a second."); return; }
  const btn = $("vvPlanBtn");
  const prev = btn ? btn.textContent : "";
  if (btn) { btn.disabled = true; btn.textContent = "✨ Directing…"; }
  try {
    let acc = "";
    await gen({
      instruction: "Act as a storyboard artist for short social videos. Break the script below into 3-6 numbered scenes. For each scene reply with exactly 3 lines: '1: <the exact spoken line>', 'visual: <a rich image-to-video prompt, subject + action + light + style, under 30 words>', 'camera: <one of: static, slow push-in, slow pull-back, orbit, pan left, pan right, tilt up, tilt down>'. No preamble, no extra commentary. Script: " + script.slice(0, 1200),
      stopSequences: [],
      onChunk: (d) => { acc += d.textChunk || ""; },
    });
    shots = parseShots(acc, script);
    renderShots();
    toast(shots.length + " shots planned — send each to video.");
  } catch (e) {
    shots = parseShots("", script);
    renderShots();
    toast("Director offline — timed from word count instead.");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = prev || "✨ Plan scenes"; }
  }
}

function renderShots() {
  const host = $("vvShots");
  if (!host) return;
  host.innerHTML = "";
  if (!shots.length) { host.textContent = "No shots yet."; return; }
  shots.forEach((s, i) => {
    const card = document.createElement("div");
    card.className = "model-note";
    card.style.marginTop = "6px";
    const head = document.createElement("div");
    head.innerHTML = "<strong>Shot " + (i + 1) + " · " + fmt(s.secs) + "</strong>";
    const line = document.createElement("div");
    line.textContent = "Says: " + s.line;
    const vis = document.createElement("div");
    vis.textContent = "Shows: " + s.visual + (s.camera ? " (" + s.camera + ")" : "");
    vis.className = "mono tiny";
    const go = document.createElement("button");
    go.type = "button";
    go.className = "btn btn-tiny";
    go.style.marginTop = "6px";
    go.textContent = "Use as video prompt";
    go.onclick = () => {
      const p = $("promptInput");
      if (p) { p.value = s.visual; p.dispatchEvent(new Event("input", { bubbles: true })); }
      const d = $("durRange");
      if (d) { d.value = String(Math.round(Math.min(15, Math.max(1, s.secs)))); d.dispatchEvent(new Event("input", { bubbles: true })); }
      document.querySelector('[data-page="pageVideo"]')?.click();
      toast("Shot " + (i + 1) + " loaded in the video studio.");
    };
    card.append(head, line, vis, go);
    host.appendChild(card);
  });
}

function injectPlanner() {
  const btn = $("vvPlanBtn");
  if (!btn || btn.dataset.bound) return;
  btn.dataset.bound = "1";
  btn.onclick = planScenes;
}

function currentClipBlob() {
  try {
    const b = window.AIVideoGen?.state?.result?.blob;
    if (b?.size) return b;
  } catch {}
  return null;
}

function loadClip(blob, name) {
  if (src.url) try { URL.revokeObjectURL(src.url); } catch {}
  src = { blob, url: blob ? URL.createObjectURL(blob) : "", name: name || "", duration: 0 };
  const v = $("vvPreview");
  if (v && blob) {
    v.src = src.url;
    v.onloadedmetadata = () => {
      src.duration = Number(v.duration) || 0;
      paintClip();
      syncOffsetUI();
    };
  }
  paintClip();
  syncOffsetUI();
  try { syncMergeReady(); } catch {}
}

function paintClip() {
  const el = $("vvClipLine");
  if (!el) return;
  if (!src.blob) { el.textContent = "No timeline clip (video) — use the finished clip, import a video, or pick from the library."; try { syncMergeReady(); } catch {} return; }
  el.textContent = src.name + " · " + fmt(src.duration);
  try { syncMergeReady(); } catch {}
}
function syncMergeReady() {
  const needClip = !src.blob?.size;
  const needTrack = !track.blob?.size;
  const ok = !needClip && !needTrack;
  for (const id of ["vvMergeBtnV", "vvMergeBtn2"]) {
    const b = $(id);
    if (!b) continue;
    b.disabled = !ok;
    b.title = ok ? "Mux the voiceover track onto the timeline clip, on-device" : "Needs BOTH: a timeline clip (video) + a voiceover track (audio)";
  }
  const ver = $("vvVerify");
  if (ver && !merged.blob?.size) {
    ver.textContent = needClip && needTrack ? "Merge needs BOTH: a timeline clip (video) above + a voiceover track (audio) from the left panel."
      : needClip ? "Need a timeline clip (video) above — merge stays off until one is loaded."
      : needTrack ? "Need a voiceover track (audio) from the left panel — merge stays off until one exists."
      : "Ready — hit Merge voiceover onto clip.";
    ver.className = "model-note" + (ok ? " ok" : "");
  }
}

function injectClipBox() {
  const use = $("vvUseClipBtn"), imp = $("vvImpClipBtn"), lib = $("vvLibClipBtn"), file = $("vvClipFile");
  if (!use) return;
  if (!use.dataset.bound) {
    use.dataset.bound = "1";
    use.onclick = () => {
      const b = currentClipBlob();
      if (!b) { toast("No finished clip yet \u2014 generate one first, or import."); return; }
      loadClip(b, "finished-clip." + extOf(b, ".mp4"));
      toast("Finished clip loaded as the timeline.");
    };
  }
  if (imp && file && !imp.dataset.bound) {
    imp.dataset.bound = "1";
    imp.onclick = () => file.click();
    file.onchange = () => {
      const f = file.files?.[0];
      file.value = "";
      if (f) { loadClip(f, f.name); toast("Video imported as the timeline."); }
    };
  }
  if (lib && !lib.dataset.bound) { lib.dataset.bound = "1"; lib.onclick = toggleLibrary; }
  paintClip();
}

async function toggleLibrary() {
  const grid = $("vvLibGrid");
  if (!grid) return;
  grid.hidden = !grid.hidden;
  if (grid.hidden || grid.dataset.loaded) return;
  grid.textContent = "Loading library…";
  try {
    const { listHistory, getHistory } = await import("./store.js");
    const rows = (await listHistory()).filter((r) => /video|webm|mp4/i.test(String(r.mime || r.ext || ""))).slice(0, 12);
    grid.innerHTML = "";
    if (!rows.length) { grid.textContent = "Library has no clips yet."; return; }
    for (const r of rows) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "btn btn-tiny";
      b.style.display = "flex";
      b.style.alignItems = "center";
      b.style.gap = "6px";
      if (r.poster) {
        const img = document.createElement("img");
        img.src = r.poster;
        img.style.width = "44px";
        img.style.height = "30px";
        img.style.objectFit = "cover";
        b.appendChild(img);
      }
      const s = document.createElement("span");
      s.textContent = (r.filename || "clip").slice(0, 22);
      b.appendChild(s);
      b.onclick = async () => {
        try {
          const full = await getHistory(r.key);
          if (!full?.video?.size) { toast("Couldn't open that clip."); return; }
          loadClip(full.video, full.filename || "library-clip");
          grid.hidden = true;
          toast("Library clip loaded as the timeline.");
        } catch { toast("Couldn't open that clip."); }
      };
      grid.appendChild(b);
    }
    grid.dataset.loaded = "1";
  } catch { grid.textContent = "Library unavailable right now."; }
}

function injectViewer() {
  const v = $("vvPreview");
  if (!v || v.dataset.bound) { try { syncMergeReady(); } catch {} return; }
  v.dataset.bound = "1";
  const pv = $("vvPreviewBtn"), mg = $("vvMergeBtnV"), dl = $("vvDlBtn"), fmtSel = $("vvContainerSel");
  if (pv) pv.onclick = previewTogether;
  if (mg) mg.onclick = mergeOntoClip;
  if (dl && !dl.dataset.bound) {
    dl.dataset.bound = "1";
    dl.onclick = () => {
      if (!merged.blob) return;
      const ext = merged.ext || mergeExtFor($("vvContainerSel")?.value || "mp4", merged.blob.type);
      const a = document.createElement("a");
      a.href = merged.url;
      a.download = "voiced-" + new Date().toISOString().slice(0, 10) + "." + ext;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { a.remove(); }, 2000);
    };
  }
  if (fmtSel && !fmtSel.dataset.bound) {
    fmtSel.dataset.bound = "1";
    fmtSel.innerHTML = "";
    for (const c of supportedMergeContainers()) {
      const o = document.createElement("option");
      o.value = c.id;
      o.textContent = c.label;
      fmtSel.appendChild(o);
    }
  }
  if ($("vvOffset")) $("vvOffset").oninput = syncOffsetUI;
  if ($("vvVol")) $("vvVol").oninput = syncOffsetUI;
  if ($("vvPos")) $("vvPos").oninput = () => {
    const vv = $("vvPreview");
    const tt = Number($("vvPos").value) || 0;
    try { vv.currentTime = tt; } catch {}
    paintPos();
  };
  v.addEventListener("loadedmetadata", () => {
    const p = $("vvPos");
    if (p) p.max = String((v.duration || 0).toFixed(1));
    paintPos();
  });
  v.addEventListener("play", startPosTicker);
  v.addEventListener("pause", paintPos);
  v.addEventListener("seeked", paintPos);
  syncOffsetUI();
}

function syncOffsetUI() {
  const off = $("vvOffset"), vol = $("vvVol");
  const vDur = src.duration || 0;
  if (off) {
    off.max = String(Math.max(0, vDur).toFixed(1));
    if (Number(off.value) > vDur) off.value = String(vDur.toFixed(1));
    if ($("vvOffsetLbl")) $("vvOffsetLbl").textContent = "Voice starts at " + fmt(Number(off.value) || 0) + " / " + fmt(vDur);
  }
  if (vol && $("vvVolLbl")) $("vvVolLbl").textContent = "Voice volume " + Math.round((Number(vol.value) || 0) * 100) + "%";
}

let wavePeaks = null;
let posTicking = false;

function paintPos() {
  const vv = $("vvPreview");
  const p = $("vvPos");
  if (!vv || !p) return;
  const t = Number(vv.currentTime) || 0;
  const d = Number(vv.duration) || 0;
  if (d > 0) p.max = String(d.toFixed(1));
  if (document.activeElement !== p) p.value = String(t.toFixed(1));
  if ($("vvPosLbl")) $("vvPosLbl").textContent = "Scrub " + fmt(t) + " / " + fmt(d);
  paintWave(t, d);
}

function startPosTicker() {
  if (posTicking) return;
  posTicking = true;
  const tick = () => {
    const vv = $("vvPreview");
    if (!vv || vv.paused || vv.ended) { posTicking = false; paintPos(); return; }
    paintPos();
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function paintWave(t, d) {
  const cv = $("vvWave");
  if (!cv) return;
  const ctx = cv.getContext("2d");
  ctx.clearRect(0, 0, cv.width, cv.height);
  if (wavePeaks?.length) {
    ctx.fillStyle = "#7dd3fc";
    const n = wavePeaks.length;
    const bw = cv.width / n;
    for (let x = 0; x < n; x++) {
      const h = Math.max(1, wavePeaks[x] * (cv.height || 64));
      ctx.fillRect(x * bw, (64 - h) / 2, Math.max(1, bw - 0.5), h);
    }
  }
  if (d > 0) {
    const fx = Math.max(0, Math.min(1, t / d)) * cv.width;
    const off = Number($("vvOffset")?.value) || 0;
    const ox = Math.max(0, Math.min(1, off / d)) * cv.width;
    ctx.fillStyle = "rgba(250,204,21,.35)";
    ctx.fillRect(ox, 0, 2, 64);
    ctx.fillStyle = "#facc15";
    ctx.fillRect(fx - 1, 0, 2, 64);
  }
}

async function drawWave() {
  const cv = $("vvWave");
  if (!cv) return;
  const w = cv.clientWidth || cv.parentElement?.clientWidth || 300;
  cv.width = w;
  cv.height = 64;
  wavePeaks = null;
  if (!track.blob) { paintWave(0, 0); return; }
  try {
    const ab = await decodeTrack();
    const d = ab.getChannelData(0);
    const n = Math.max(1, Math.min(cv.width, 400));
    const step = Math.max(1, Math.floor(d.length / n));
    wavePeaks = new Array(n).fill(0);
    for (let x = 0; x < n; x++) {
      let peak = 0;
      for (let i = x * step; i < (x + 1) * step && i < d.length; i += 4) peak = Math.max(peak, Math.abs(d[i]));
      wavePeaks[x] = peak;
    }
  } catch {}
  paintWave(0, 0);
}

function loadMedia(blob, kind) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(blob);
    const el = document.createElement(kind);
    el.preload = "auto";
    el.src = url;
    el.onloadedmetadata = () => res({ el, url });
    el.onerror = () => { URL.revokeObjectURL(url); rej(new Error("could not read " + kind)); };
  });
}

let previewEls = [];
let previewLiveSpeech = false;

function stopPreview() {
  for (const e of previewEls) { try { e.pause(); } catch {} }
  previewEls = [];
  if (previewLiveSpeech) { try { speechSynthesis.cancel(); } catch {} previewLiveSpeech = false; }
}

async function previewTogether() {
  try {
    stopPreview();
    const clip = src.blob?.size ? src.blob : currentClipBlob();
    if (!clip) { toast("Load a timeline clip first."); return; }
    const v = $("vvPreview");
    if (src.blob?.size) v.src = src.url;
    else loadClip(clip, "finished-clip." + extOf(clip, ".mp4"));
    const off = Number($("vvOffset")?.value) || 0;
    const vol = Number($("vvVol")?.value ?? 1);
    v.currentTime = Math.min(off, Math.max(0, (src.duration || v.duration || 0) - 0.05));
    await v.play().catch(() => {});
    if (track.blob?.size) {
      const a = document.createElement("audio");
      a.src = track.url;
      a.volume = Math.max(0, Math.min(1, Number(vol) || 0));
      previewEls = [v, a];
      const wait = Math.max(0, (Math.min(off, v.duration || off) - v.currentTime)) * 1000;
      setTimeout(() => a.play().catch(() => {}), wait);
    } else {
      const text = $("voiceTextInput")?.value.trim() || "";
      if (!text) { toast("Playing video only — add a script or a track for sound."); return; }
      try { speechSynthesis.cancel(); } catch {}
      const u = new SpeechSynthesisUtterance(text.slice(0, 2500));
      const sv = selVoice();
      if (sv) u.voice = sv;
      u.rate = Number($("voiceRateRange")?.value) || 1;
      u.pitch = Number($("voicePitchRange")?.value) || 1;
      u.volume = Math.max(0, Math.min(1, vol));
      previewLiveSpeech = true;
      previewEls = [v];
      const wait = Math.max(0, (Math.min(off, v.duration || off) - v.currentTime)) * 1000;
      setTimeout(() => { if (previewLiveSpeech) speechSynthesis.speak(u); }, wait);
      toast("Speaking the script live — Rec voice keeps it as a track.");
    }
  } catch (e) { toast("Preview failed: " + (e?.message || e)); }
}

function supportedMergeContainers() {
  const out = [];
  let canMp4 = false, canWebm = false;
  try {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported) {
      canMp4 = MediaRecorder.isTypeSupported("video/mp4;codecs=avc1.42E01f") || MediaRecorder.isTypeSupported("video/mp4");
      canWebm = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus") || MediaRecorder.isTypeSupported("video/webm;codecs=vp8,opus") || MediaRecorder.isTypeSupported("video/webm");
    }
  } catch {}
  if (canMp4) { out.push({ id: "mp4", label: "MP4 · H.264 (plays everywhere)" }); out.push({ id: "mov", label: "MOV · H.264" }); }
  if (canWebm || !out.length) out.push({ id: "webm", label: "WEBM · VP9 (smallest)" });
  if (canWebm) out.push({ id: "mkv", label: "MKV · VP9" });
  return out;
}
function mergeMimeFor(container) {
  const c = String(container || "mp4").toLowerCase();
  const cands = c === "mp4" || c === "mov"
    ? ["video/mp4;codecs=avc1.42E01f,mp4a.40.2", "video/mp4;codecs=avc1.42E01f", "video/mp4"]
    : ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
  try {
    for (const m of cands) if (MediaRecorder.isTypeSupported(m)) return m;
  } catch {}
  return "";
}
function mergeExtFor(container, mime) {
  const c = String(container || "").toLowerCase();
  if (c === "mov") return "mov";
  if (c === "mkv") return "mkv";
  if (c === "mp4" || c === "webm") return c;
  return (mime || "").includes("mp4") ? "mp4" : "webm";
}
function extOf(blob, fb) {
  const t = String(blob?.type || "");
  if (t.includes("mp4")) return "mp4";
  if (t.includes("webm")) return "webm";
  if (t.includes("matroska")) return "mkv";
  if (t.includes("quicktime")) return "mov";
  const m = String(fb || "").match(/\.(mp4|mov|mkv|webm)$/i);
  return m ? m[1].toLowerCase() : "mp4";
}
function timelineClip() {
  if (src.blob?.size) return src.blob;
  return currentClipBlob();
}

async function mergeOntoClip() {
  const clip = timelineClip();
  if (!clip?.size) { toast("Load a timeline clip first (finished, imported, or library)."); return; }
  if (!track.blob?.size) { toast("Record or import a voiceover track first."); return; }
  const btns = [$("vvMergeBtnV"), $("vvMergeBtn2")].filter(Boolean);
  const prev = btns.map((b) => b.textContent);
  btns.forEach((b) => { b.disabled = true; });
  if ($("vvMergeBtnV")) $("vvMergeBtnV").textContent = "Merging…";
  try {
    const [{ el: v, url: vUrl }, { el: a, url: aUrl }] = await Promise.all([loadMedia(clip, "video"), loadMedia(track.blob, "audio")]);
    try {
      const vDur = Number(v.duration) || 5;
      const aDur = Number(a.duration) || track.duration || vDur;
      const off = Math.max(0, Math.min(Number($("vvOffset")?.value) || 0, vDur));
      const vol = Math.max(0, Math.min(1.5, Number($("vvVol")?.value ?? 1)));
      const total = Math.max(vDur, off + aDur);
      const w = v.videoWidth || 640, h = v.videoHeight || 360;
      const canvas = document.createElement("canvas");
      canvas.width = w - (w % 2);
      canvas.height = h - (h % 2);
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const vStream = canvas.captureStream(30);
      const AC = window.AudioContext || window.webkitAudioContext;
      const ac = new AC();
      await ac.resume().catch(() => {});
      const srcN = ac.createMediaElementSource(a);
      const gain = ac.createGain();
      gain.gain.value = vol;
      const dest = ac.createMediaStreamDestination();
      srcN.connect(gain);
      gain.connect(dest);
      gain.connect(ac.destination);
      const mixed = new MediaStream([...vStream.getVideoTracks(), ...dest.stream.getAudioTracks()]);
      const hasAudioTrack = dest.stream.getAudioTracks().length > 0;
      const wantContainer = $("vvContainerSel")?.value || "mp4";
      const mime = mergeMimeFor(wantContainer);
      const rec = new MediaRecorder(mixed, mime ? { mimeType: mime, videoBitsPerSecond: 4_000_000 } : undefined);
      const chunks = [];
      rec.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
      const done = new Promise((res) => { rec.onstop = res; });
      v.muted = true;
      v.loop = vDur < total;
      a.volume = Math.min(1, vol);
      const t0 = performance.now();
      const draw = () => {
        if (v.ended && v.loop) { try { v.currentTime = 0; v.play().catch(() => {}); } catch {} }
        if (!v.ended || v.loop) { try { ctx.drawImage(v, 0, 0, canvas.width, canvas.height); } catch {} }
        if (rec.state === "recording") requestAnimationFrame(draw);
      };
      await v.play().catch(() => {});
      draw();
      rec.start(250);
      setTimeout(() => a.play().catch(() => {}), Math.round(off * 1000));
      await new Promise((res) => {
        const tick = () => {
          if ((performance.now() - t0) / 1000 >= total + 0.2) res();
          else setTimeout(tick, 120);
        };
        tick();
      });
      rec.stop();
      await done;
      try { v.pause(); a.pause(); } catch {}
      const ext = mergeExtFor($("vvContainerSel")?.value || "mp4", mime || rec.mimeType);
      const outType = mime || rec.mimeType || (ext === "mp4" ? "video/mp4" : "video/webm");
      const out = new Blob(chunks, { type: outType });
      ac.close().catch(() => {});
      URL.revokeObjectURL(vUrl);
      URL.revokeObjectURL(aUrl);
      if (!out.size) throw new Error("merge produced nothing");
      const heard = hasAudioTrack && a.currentTime > 0.2 && aDur > 0.2;
      if (merged.url) try { URL.revokeObjectURL(merged.url); } catch {}
      merged = { blob: out, url: URL.createObjectURL(out) };
      const pv = $("vvPreview");
      if (pv) { pv.src = merged.url; pv.play().catch(() => {}); }
      const ver = $("vvVerify");
      if (ver) {
        ver.textContent = heard
          ? "Voiceover verified in the final file — " + fmt(total) + " video, voice from " + fmt(off) + " at " + Math.round(vol * 100) + "%."
          : "Merged, but the voice wasn't heard during capture — replay it before sharing.";
        ver.className = "model-note" + (heard ? " ok" : " warn");
      }
      merged.ext = ext;
      const dl = $("vvDlBtn");
      if (dl) {
        dl.hidden = false;
        dl.textContent = "Download " + ext.toUpperCase();
      }
      const fn = $("vvFmtNote");
      if (fn) fn.textContent = fmt(total) + " · " + ext.toUpperCase() + " · " + (out.size / 1024).toFixed(0) + " KB";
      toast(heard ? "Merged " + fmt(total) + " with voiceover (" + ext.toUpperCase() + ") — playing. Hit Download." : "Merged (" + ext.toUpperCase() + ") — replay to confirm the voice.");
    } catch (e) {
      URL.revokeObjectURL(vUrl);
      URL.revokeObjectURL(aUrl);
      throw e;
    }
  } catch (e) {
    toast("Merge failed: " + (e?.message || e));
  } finally {
    btns.forEach((b, i) => { b.disabled = false; b.textContent = prev[i]; });
  }
}

function injectMerge() {
  const old = $("vvMergeBtn");
  if (old) old.remove();
  if (!$("vvMergeBtn2")) {
    const actions = document.querySelector("#resultBar .result-actions");
    if (actions) {
      const b = document.createElement("button");
      b.id = "vvMergeBtn2";
      b.type = "button";
      b.className = "btn btn-ghost";
      b.textContent = "Add voiceover";
      b.title = "Mux the voice studio track onto this clip";
      b.onclick = mergeOntoClip;
      actions.appendChild(b);
    }
  }
  try { syncMergeReady(); } catch {}
}

function boot() {
  try { window.__vvLoadClip = loadClip; window.__voiceGetTrack = () => track.blob; } catch {}
  injectVoiceFinder();
  injectTrackBox();
  injectPlanner();
  injectClipBox();
  injectViewer();
  injectMerge();
  try { syncMergeReady(); } catch {}
  const sel = $("voiceSel");
  if (sel && sel.options.length <= 1 && allVoices().length > 1) applyVoiceFilter();
  try { speechSynthesis.onvoiceschanged = applyVoiceFilter; } catch {}
}

let booted = false;
function bootOnce() {
  if (booted) { try { injectMerge(); } catch {} return; }
  booted = true;
  boot();
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => setTimeout(bootOnce, 500));
else setTimeout(bootOnce, 500);
try {
  if (typeof MutationObserver === "function") {
    const mo = new MutationObserver(() => {
      if (!$("vvMergeBtn2")) { try { injectMerge(); } catch {} }
      if (!$("vvPreview")) { booted = false; try { bootOnce(); } catch {} }
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
  }
} catch {}
