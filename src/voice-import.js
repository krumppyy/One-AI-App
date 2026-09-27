const $ = (id) => document.getElementById(id);

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

function ensureStyle() {
  if ($("viToolsCss")) return;
  const st = document.createElement("style");
  st.id = "viToolsCss";
  st.textContent = ".vi-strip{display:flex;gap:6px;overflow-x:auto;margin-top:8px;padding:2px}.vi-strip img{height:54px;border-radius:6px;cursor:pointer;border:2px solid transparent;object-fit:cover;background:#000}.vi-strip img.on{border-color:#3ec6ff}.vi-strip img:hover{border-color:#a78bff}.vi-track{position:relative;height:38px;border-radius:8px;background:rgba(255,255,255,.06);cursor:crosshair;touch-action:none;user-select:none}.vi-region{position:absolute;top:0;bottom:0;background:rgba(62,198,255,.28);border-top:1px solid #3ec6ff;border-bottom:1px solid #3ec6ff}.vi-handle{position:absolute;top:0;bottom:0;width:12px;margin-left:-6px;background:#3ec6ff;border-radius:4px;cursor:ew-resize;touch-action:none}.vi-playhead{position:absolute;top:0;bottom:0;width:2px;background:#facc15;pointer-events:none}.vi-row{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:8px}";
  document.head.appendChild(st);
}

function elLoaded(ev) {
  return new Promise((res, rej) => {
    ev.onloadedmetadata = () => res();
    ev.onerror = () => rej(new Error("could not read media"));
    setTimeout(() => rej(new Error("timed out reading media")), 20000);
  });
}

function elSeeked(ev, t) {
  return new Promise((res) => {
    let done = false;
    const fin = () => { if (!done) { done = true; ev.removeEventListener("seeked", fin); res(); } };
    ev.addEventListener("seeked", fin);
    try { ev.currentTime = Math.min(Math.max(0, t), Math.max(0, (ev.duration || 1) - 0.05)); } catch { fin(); }
    setTimeout(fin, 2500);
  });
}

async function probeDuration(v, fallback) {
  let d = Number(v.duration);
  if (Number.isFinite(d) && d > 0 && d < 1e6) return d;
  try {
    await new Promise((res) => {
      const to = setTimeout(res, 3500);
      const h = () => {
        const x = Number(v.duration);
        if (Number.isFinite(x) && x > 0 && x < 1e6) { clearTimeout(to); v.removeEventListener("durationchange", h); res(); }
      };
      v.addEventListener("durationchange", h);
      try { v.currentTime = 1e7; } catch { res(); }
    });
  } catch {}
  d = Number(v.duration);
  if (Number.isFinite(d) && d > 0 && d < 1e6) {
    try { await elSeeked(v, 0); } catch {}
    return d;
  }
  d = Number(fallback);
  if (Number.isFinite(d) && d > 0 && d < 1e6) return d;
  return 0;
}

async function buildThumbs(srcUrl, strip, player, n, onDur) {
  strip.innerHTML = "";
  delete strip.dataset.dur;
  if (!srcUrl) return;
  const off = document.createElement("video");
  off.muted = true;
  off.preload = "auto";
  off.src = srcUrl;
  try { await elLoaded(off); } catch { return; }
  const dur = await probeDuration(off, player ? player.duration : 0);
  if (!(dur > 0)) return;
  strip.dataset.dur = String(dur);
  try { onDur && onDur(dur); } catch {}
  const vw = off.videoWidth || 640, vh = off.videoHeight || 360;
  const h = 54, w = Math.max(40, Math.round(h * vw / vh));
  const cv = document.createElement("canvas");
  cv.width = w - (w % 2);
  cv.height = h;
  const ctx = cv.getContext("2d");
  n = Math.max(4, Math.min(10, n || 8));
  for (let i = 0; i < n; i++) {
    const t = dur * (i + 0.5) / n;
    try {
      await elSeeked(off, t);
      await new Promise((r) => setTimeout(r, 120));
      if (off.readyState < 2) await new Promise((r) => setTimeout(r, 300));
      const draw = () => {
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, cv.width, cv.height);
        const s = Math.max(cv.width / vw, cv.height / vh);
        const dw = vw * s, dh = vh * s;
        ctx.drawImage(off, (cv.width - dw) / 2, (cv.height - dh) / 2, dw, dh);
      };
      draw();
      try {
        const px = ctx.getImageData(0, 0, cv.width, cv.height).data;
        let lit = false;
        for (let p = 0; p < px.length; p += 64) {
          if (px[p] > 14 || px[p + 1] > 14 || px[p + 2] > 14) { lit = true; break; }
        }
        if (!lit) {
          await new Promise((r) => setTimeout(r, 350));
          await elSeeked(off, t);
          await new Promise((r) => setTimeout(r, 120));
          draw();
        }
      } catch {}
      const img = document.createElement("img");
      img.src = cv.toDataURL("image/jpeg", 0.7);
      img.title = fmt(t) + " — click to preview from here";
      img.onclick = () => {
        try {
          player.currentTime = Math.min(t, Math.max(0, (player.duration || t + 0.1) - 0.05));
          player.play().catch(() => {});
        } catch {}
        for (const o of strip.querySelectorAll("img")) o.classList.remove("on");
        img.classList.add("on");
      };
      strip.appendChild(img);
    } catch {}
  }
  try { off.removeAttribute("src"); off.load(); } catch {}
}

function makeRange(getDur) {
  const state = { a: 0, b: 0 };
  let known = 0;
  function dur() {
    const d = Number(getDur());
    if (Number.isFinite(d) && d > 0) { known = d; return d; }
    return known;
  }
  const wrap = document.createElement("div");
  const lbl = document.createElement("span");
  lbl.className = "mono tiny";
  const track = document.createElement("div");
  track.className = "vi-track";
  track.title = "Drag the handles — or click — to pick the part for voiceover";
  const region = document.createElement("div");
  region.className = "vi-region";
  const ha = document.createElement("div");
  ha.className = "vi-handle";
  ha.title = "Part start";
  const hb = document.createElement("div");
  hb.className = "vi-handle";
  hb.title = "Part end";
  const ph = document.createElement("div");
  ph.className = "vi-playhead";
  track.append(region, ha, hb, ph);
  wrap.append(lbl, track);
  lbl.style.display = "block";
  lbl.style.margin = "6px 0 4px";

  function paint() {
    const d = Math.max(0.01, dur());
    const a = Math.max(0, Math.min(state.a, d));
    const b = Math.max(0, Math.min(state.b || d, d));
    ha.style.left = (a / d * 100) + "%";
    hb.style.left = (b / d * 100) + "%";
    region.style.left = (Math.min(a, b) / d * 100) + "%";
    region.style.width = (Math.abs(b - a) / d * 100) + "%";
    const lo = Math.min(a, b), hi = Math.max(a, b);
    const full = hi - lo >= d - 0.05;
    lbl.textContent = full ? "Part: whole clip (" + fmt(d) + ") — drag to select a part" : "Part: " + fmt(lo) + " → " + fmt(hi) + " (" + fmt(hi - lo) + " of " + fmt(d) + ")";
  }
  function setFull() {
    const d = dur() || 0;
    state.a = 0;
    state.b = d;
    paint();
  }
  function get() {
    const d = dur() || 0;
    const lo = Math.max(0, Math.min(state.a, state.b));
    const hi = Math.min(d, Math.max(state.a, state.b));
    return { a: lo, b: hi, dur: d, active: (hi - lo) < d - 0.05 && hi - lo > 0.05 };
  }
  function xToT(clientX) {
    const r = track.getBoundingClientRect();
    const f = Math.max(0, Math.min(1, (clientX - r.left) / Math.max(1, r.width)));
    return f * dur();
  }
  let drag = null;
  function down(which, e) {
    e.preventDefault();
    e.stopPropagation();
    drag = which;
    try { (which === "a" ? ha : hb).setPointerCapture(e.pointerId); } catch {}
  }
  ha.addEventListener("pointerdown", (e) => down("a", e));
  hb.addEventListener("pointerdown", (e) => down("b", e));
  track.addEventListener("pointerdown", (e) => {
    if (e.target === ha || e.target === hb) return;
    const t = xToT(e.clientX);
    drag = Math.abs(t - state.a) <= Math.abs(t - state.b) ? "a" : "b";
    if (drag === "a") state.a = t; else state.b = t;
    paint();
    const mv = (ev) => {
      const tt = xToT(ev.clientX);
      if (drag === "a") state.a = tt; else state.b = tt;
      paint();
    };
    const up = () => {
      track.removeEventListener("pointermove", mv);
      track.removeEventListener("pointerup", up);
      track.removeEventListener("pointercancel", up);
      drag = null;
    };
    track.addEventListener("pointermove", mv);
    track.addEventListener("pointerup", up);
    track.addEventListener("pointercancel", up);
  });
  const gmv = (e) => {
    if (!drag) return;
    const t = xToT(e.clientX);
    if (drag === "a") state.a = t; else state.b = t;
    paint();
  };
  const gup = () => { drag = null; };
  ha.addEventListener("pointermove", gmv);
  hb.addEventListener("pointermove", gmv);
  ha.addEventListener("pointerup", gup);
  hb.addEventListener("pointerup", gup);
  ha.addEventListener("pointercancel", gup);
  hb.addEventListener("pointercancel", gup);
  return { el: wrap, paint, setFull, get, forget() { known = 0; state.a = 0; state.b = 0; paint(); }, noteDur(d) { if (Number.isFinite(d) && d > 0) { known = d; paint(); } }, setPlayhead(t, d) {
    if (!(d > 0)) { ph.style.display = "none"; return; }
    ph.style.display = "";
    ph.style.left = (Math.max(0, Math.min(1, t / d)) * 100) + "%";
  } };
}

function pickOutMime() {
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

async function trimVideoBlob(blob, a, b, onTick) {
  const len = b - a;
  if (!(len > 0.15)) throw new Error("pick a longer part first");
  const url = URL.createObjectURL(blob);
  const v = document.createElement("video");
  v.muted = true;
  v.preload = "auto";
  v.playsInline = true;
  v.src = url;
  await elLoaded(v);
  const vw = v.videoWidth || 640, vh = v.videoHeight || 360;
  const s = Math.min(1, 720 / vw, 1280 / vh);
  const W = Math.max(2, Math.round(vw * s)) - (Math.max(2, Math.round(vw * s)) % 2);
  const H = Math.max(2, Math.round(vh * s)) - (Math.max(2, Math.round(vh * s)) % 2);
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext("2d");
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
  await elSeeked(v, a + 0.01);
  await v.play().catch(() => {});
  const stream = cv.captureStream(30);
  const AC = window.AudioContext || window.webkitAudioContext;
  let ac = null, mixed = stream;
  try {
    ac = new AC();
    await ac.resume().catch(() => {});
    const srcN = ac.createMediaElementSource(v);
    const gain = ac.createGain();
    gain.gain.value = 1;
    const dest = ac.createMediaStreamDestination();
    srcN.connect(gain);
    gain.connect(dest);
    mixed = new MediaStream([...stream.getVideoTracks(), ...dest.stream.getAudioTracks()]);
  } catch { mixed = stream; }
  const mime = pickOutMime();
  const rec = new MediaRecorder(mixed, mime ? { mimeType: mime, videoBitsPerSecond: 4_000_000 } : undefined);
  const parts = [];
  rec.ondataavailable = (e) => { if (e.data?.size) parts.push(e.data); };
  const done = new Promise((res) => { rec.onstop = res; });
  const t0 = performance.now();
  let raf = 0;
  const draw = () => {
    try { ctx.drawImage(v, 0, 0, W, H); } catch {}
    if (onTick) {
      try { onTick(Math.min(len, (performance.now() - t0) / 1000), len); } catch {}
    }
    if (rec.state === "recording") raf = requestAnimationFrame(draw);
  };
  draw();
  rec.start(250);
  await new Promise((res) => {
    const poll = () => { ((performance.now() - t0) / 1000 >= len + 0.2) ? res() : setTimeout(poll, 100); };
    poll();
  });
  cancelAnimationFrame(raf);
  rec.stop();
  await done;
  try { v.pause(); } catch {}
  try { ac && ac.close().catch(() => {}); } catch {}
  URL.revokeObjectURL(url);
  const out = new Blob(parts, { type: mime || rec.mimeType || "video/webm" });
  if (!out.size) throw new Error("trim produced nothing");
  return out;
}

async function frameToPng(video, vw, vh) {
  const w = vw || video.videoWidth || 640;
  const h = vh || video.videoHeight || 360;
  const cv = document.createElement("canvas");
  cv.width = w - (w % 2);
  cv.height = h - (h % 2);
  const ctx = cv.getContext("2d");
  ctx.drawImage(video, 0, 0, cv.width, cv.height);
  return await new Promise((res) => cv.toBlob((b) => res(b), "image/png"));
}

async function saveFrameLibrary(blob, filename) {
  try {
    const { saveBlobToLibrary } = await import("./library-save.js");
    await saveBlobToLibrary({ kind: "image", tab: "voice", blob, filename, prompt: "voiceover frame grab" });
  } catch {}
}

function downloadBlob(blob, filename) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 30000);
}

function setupMaker() {
  const player = $("vvPreview");
  if (!player || player.dataset.viBound) return;
  player.dataset.viBound = "1";
  ensureStyle();
  const box = document.createElement("div");
  box.id = "vvClipTools";
  const strip = document.createElement("div");
  strip.id = "vvThumbStrip";
  strip.className = "vi-strip";
  strip.title = "Imported clip thumbnails — click one to preview from there";
  const range = makeRange(() => Number(player.duration) || 0);
  range.el.id = "vvTrimWrap";
  const row = document.createElement("div");
  row.className = "vi-row";
  const useBtn = document.createElement("button");
  useBtn.type = "button";
  useBtn.id = "vvUsePartBtn";
  useBtn.className = "btn btn-tiny btn-primary";
  useBtn.textContent = "Use part as clip";
  useBtn.title = "Cut the timeline to the selected part — voiceover then runs on that part only";
  const resetBtn = document.createElement("button");
  resetBtn.type = "button";
  resetBtn.className = "btn btn-tiny";
  resetBtn.textContent = "Full clip";
  resetBtn.title = "Select the whole clip again";
  resetBtn.onclick = () => range.setFull();
  const frameBtn = document.createElement("button");
  frameBtn.type = "button";
  frameBtn.id = "vvFrameBtn";
  frameBtn.className = "btn btn-tiny";
  frameBtn.textContent = "Frame → image";
  frameBtn.title = "Save the current player frame as a PNG image";
  const note = document.createElement("span");
  note.className = "mono tiny";
  row.append(useBtn, resetBtn, frameBtn, note);
  box.append(strip, range.el, row);
  player.after(box);
  box.style.display = (player.currentSrc || player.src) ? "" : "none";

  async function rebuild() {
    const url = player.currentSrc || player.src;
    range.forget();
    if (!url) { strip.innerHTML = ""; box.style.display = "none"; return; }
    box.style.display = "";
    note.textContent = "reading frames…";
    await buildThumbs(url, strip, player, 8, (d) => range.noteDur(d));
    range.setFull();
    note.textContent = strip.children.length ? strip.children.length + " frames — click to preview · drag the bar to pick a part" : "";
    range.paint();
    try {
      const d = range.get().dur;
      const cl = $("vvClipLine");
      if (cl && d > 0 && /Infinity|NaN/.test(cl.textContent)) {
        cl.textContent = cl.textContent.replace(/·.*/, "· " + fmt(d));
      }
    } catch {}
    showFirstFrame();
  }
  function showFirstFrame() {
    try {
      if (player.paused && Number(player.currentTime) === 0 && Number(player.duration) > 0.2) {
        player.currentTime = 0.06;
      }
    } catch {}
  }
  player.addEventListener("loadedmetadata", () => {
    rebuild();
  });
  player.addEventListener("timeupdate", () => {
    try { range.setPlayhead(Number(player.currentTime) || 0, Number(player.duration) || 0); } catch {}
  });
  useBtn.onclick = async () => {
    const g = range.get();
    if (!g.active) { toast("Drag the bar above to select a part first — or merge the full clip as-is."); return; }
    let blob = null;
    try {
      const r = await fetch(player.currentSrc);
      blob = await r.blob();
    } catch {}
    if (!blob?.size) { toast("Couldn't read that clip — re-import the video file."); return; }
    const prev = useBtn.textContent;
    useBtn.disabled = true;
    try {
      const out = await trimVideoBlob(blob, g.a, g.b, (t, l) => { useBtn.textContent = "Cutting " + fmt(t) + " / " + fmt(l) + "…"; });
      const ext = (out.type || "").includes("mp4") ? "mp4" : "webm";
      const name = "part-" + g.a.toFixed(1) + "s-" + g.b.toFixed(1) + "s." + ext;
      if (window.__vvLoadClip) window.__vvLoadClip(out, name);
      else { player.src = URL.createObjectURL(out); }
      toast("Timeline is now just the part (" + fmt(g.b - g.a) + ") — voiceover runs on it.");
    } catch (e) {
      toast("Cut failed: " + (e?.message || e));
    } finally {
      useBtn.disabled = false;
      useBtn.textContent = prev;
    }
  };
  frameBtn.onclick = async () => {
    try {
      if (!(Number(player.videoWidth) > 0)) { toast("Load a clip and play to a frame first."); return; }
      const png = await frameToPng(player);
      if (!png?.size) { toast("That frame isn't readable — play the video a moment and retry."); return; }
      const t = Number(player.currentTime) || 0;
      const name = "frame-" + t.toFixed(1) + "s.png";
      downloadBlob(png, name);
      saveFrameLibrary(png, name);
      toast("Frame saved as an image (" + fmt(t) + ").");
    } catch (e) { toast("Frame grab failed: " + (e?.message || e)); }
  };
  window.__vvClipRange = range;
  if (player.currentSrc || player.src) rebuild();
}

function setupLipsync() {
  const vid = $("pvPreviewVid");
  const img = $("pvPreviewImg");
  if (!vid || vid.dataset.viBound) return;
  vid.dataset.viBound = "1";
  ensureStyle();
  try { vid.muted = false; } catch {}
  const box = document.createElement("div");
  box.id = "pvClipTools";
  const strip = document.createElement("div");
  strip.className = "vi-strip";
  strip.title = "Imported video thumbnails — click one to preview from there";
  const range = makeRange(() => Number(vid.duration) || 0);
  const row = document.createElement("div");
  row.className = "vi-row";
  const useBtn = document.createElement("button");
  useBtn.type = "button";
  useBtn.className = "btn btn-tiny btn-primary";
  useBtn.textContent = "Use part as background";
  useBtn.title = "Cut the imported video to the selected part — voiceover then runs on that part only";
  const resetBtn = document.createElement("button");
  resetBtn.type = "button";
  resetBtn.className = "btn btn-tiny";
  resetBtn.textContent = "Full video";
  resetBtn.title = "Select the whole video again";
  resetBtn.onclick = () => range.setFull();
  const frameBtn = document.createElement("button");
  frameBtn.type = "button";
  frameBtn.className = "btn btn-tiny";
  frameBtn.textContent = "Frame → image";
  frameBtn.title = "Save the current frame as a PNG image";
  const note = document.createElement("span");
  note.className = "mono tiny";
  row.append(useBtn, resetBtn, frameBtn, note);
  box.append(strip, range.el, row);
  vid.after(box);

  function syncVis() {
    const isVid = !vid.hidden;
    strip.style.display = isVid ? "" : "none";
    range.el.style.display = isVid ? "" : "none";
    useBtn.style.display = isVid ? "" : "none";
    resetBtn.style.display = isVid ? "" : "none";
  }
  async function rebuild() {
    syncVis();
    if (vid.hidden) { note.textContent = ""; return; }
    const url = vid.currentSrc || vid.src;
    range.forget();
    if (!url) return;
    note.textContent = "reading frames…";
    await buildThumbs(url, strip, vid, 8, (d) => range.noteDur(d));
    range.setFull();
    note.textContent = strip.children.length ? strip.children.length + " frames — click to preview · drag the bar to pick a part" : "";
    range.paint();
    try {
      if (vid.paused && Number(vid.currentTime) === 0 && Number(vid.duration) > 0.2) vid.currentTime = 0.06;
    } catch {}
  }
  vid.addEventListener("loadedmetadata", rebuild);
  vid.addEventListener("timeupdate", () => {
    try { range.setPlayhead(Number(vid.currentTime) || 0, Number(vid.duration) || 0); } catch {}
  });
  new MutationObserver(syncVis).observe(vid, { attributes: true, attributeFilter: ["hidden", "src"] });
  useBtn.onclick = async () => {
    const g = range.get();
    if (!g.active) { toast("Drag the bar above to select a part first."); return; }
    let blob = null;
    try {
      const r = await fetch(vid.currentSrc || vid.src);
      blob = await r.blob();
    } catch {}
    if (!blob?.size) { toast("Couldn't read that video — re-import the file."); return; }
    const prev = useBtn.textContent;
    useBtn.disabled = true;
    try {
      const out = await trimVideoBlob(blob, g.a, g.b, (t, l) => { useBtn.textContent = "Cutting " + fmt(t) + " / " + fmt(l) + "…"; });
      if (window.__pvLoadMedia) await window.__pvLoadMedia(out, "part-" + g.a.toFixed(1) + "s-" + g.b.toFixed(1) + "s");
      else { vid.src = URL.createObjectURL(out); }
      toast("Background is now just the part (" + fmt(g.b - g.a) + ") — voiceover runs on it.");
    } catch (e) {
      toast("Cut failed: " + (e?.message || e));
    } finally {
      useBtn.disabled = false;
      useBtn.textContent = prev;
    }
  };
  frameBtn.onclick = async () => {
    try {
      let png = null, tag = "";
      if (!vid.hidden && Number(vid.videoWidth) > 0) {
        png = await frameToPng(vid);
        tag = fmt(Number(vid.currentTime) || 0);
      } else if (img && !img.hidden && img.naturalWidth > 0) {
        const cv = document.createElement("canvas");
        cv.width = img.naturalWidth;
        cv.height = img.naturalHeight;
        cv.getContext("2d").drawImage(img, 0, 0);
        png = await new Promise((res) => cv.toBlob((b) => res(b), "image/png"));
        tag = "photo";
      } else { toast("Import a photo or video first."); return; }
      if (!png?.size) { toast("That frame isn't readable right now."); return; }
      const name = "frame-" + String(tag).replace(/[^0-9a-z.]+/gi, "") + ".png";
      downloadBlob(png, name);
      saveFrameLibrary(png, name);
      toast("Frame saved as an image.");
    } catch (e) { toast("Frame grab failed: " + (e?.message || e)); }
  };
  window.__pvClipRange = range;
  syncVis();
}

function boot() {
  setupMaker();
  setupLipsync();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => setTimeout(boot, 900));
else setTimeout(boot, 900);
try {
  new MutationObserver(() => {
    if ($("vvPreview") && !$("vvPreview").dataset.viBound) setupMaker();
    if ($("pvPreviewVid") && !$("pvPreviewVid").dataset.viBound) setupLipsync();
  }).observe(document.documentElement, { childList: true, subtree: true });
} catch {}
