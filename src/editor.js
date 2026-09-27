import { GRADE_PRESETS } from "./grade.js";
import { addHistory, listHistory as ppListHistory, getHistory as ppGetHistory } from "./store.js";

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const uid = () => "c" + Math.random().toString(36).slice(2, 9);
const fmt = (s) => { s = Math.max(0, Number(s) || 0); const m = Math.floor(s / 60); return (m > 0 ? m + ":" : "") + (s % 60).toFixed(1).padStart(4, "0") + "s"; };

const RATIOS = {
  "16:9": [960, 540],
  "9:16": [540, 960],
  "1:1": [720, 720],
  "4:3": [800, 600],
  "21:9": [1008, 432],
};
const EXPORT_DIMS = {
  "16:9": [1280, 720],
  "9:16": [720, 1280],
  "1:1": [960, 960],
  "4:3": [960, 720],
  "21:9": [1280, 552],
};
const TRACKS = ["V2", "V1", "TXT", "A1", "A2"];
const FILTERS = [
  ["none", "None"],
  ["bw", "B&W"],
  ["noir", "Noir"],
  ["sepia", "Sepia"],
  ["vintage", "Vintage"],
  ["warm", "Warm"],
  ["cool", "Cool"],
  ["vivid", "Vivid"],
  ["soft", "Soft glow"],
];
const FILTER_CSS = {
  none: "",
  bw: "grayscale(1) contrast(1.12)",
  noir: "grayscale(1) contrast(1.45) brightness(1.05)",
  sepia: "sepia(0.9) contrast(1.05)",
  vintage: "sepia(0.5) contrast(0.9) brightness(1.06) saturate(0.8)",
  warm: "sepia(0.35) saturate(1.3) contrast(1.05)",
  cool: "saturate(1.1) hue-rotate(18deg) brightness(1.02)",
  vivid: "saturate(1.65) contrast(1.15)",
  soft: "brightness(1.08) contrast(0.92) saturate(0.9)",
};
const TRANSITIONS = [["none", "Cut"], ["fade", "Fade"], ["wipe", "Wipe"], ["zoom", "Zoom"]];
const FONTS = ["Inter", "Arial", "Anton", "Bebas Neue", "Playfair Display", "Caveat", "Space Grotesk", "IBM Plex Mono", "Georgia", "Impact"];

const S = {
  assets: [], clips: [], sel: null, binSel: null, t: 0, playing: false, loop: true,
  zoom: 60, ratio: "16:9", seq: 1, raf: 0, lastTs: 0, exporting: false, cancelExport: false,
  audioCtx: null, recDest: null, tool: "select", snap: true, muted: {}, locked: {}, ppInit: false,
};

function log(msg) {
  const el = $("edLog");
  if (!el) return;
  el.textContent = new Date().toLocaleTimeString() + "  " + msg + "\n" + el.textContent.slice(0, 4000);
}

function assetById(id) { return S.assets.find((a) => a.id === id); }
function clipById(id) { return S.clips.find((c) => c.id === id); }
function trackClips(tr) { return S.clips.filter((c) => c.track === tr).sort((a, b) => a.start - b.start); }
function projectEnd() { let e = 0; for (const c of S.clips) e = Math.max(e, c.start + c.dur); return e; }
function selClip() { return S.sel ? clipById(S.sel) : null; }

function loadFonts() {
  const l = document.createElement("link");
  l.rel = "stylesheet";
  l.href = "https://fonts.googleapis.com/css2?family=Anton&family=Bebas+Neue&family=Caveat:wght@600&family=IBM+Plex+Mono:wght@500&family=Playfair+Display:wght@600&family=Space+Grotesk:wght@500&display=swap";
  document.head.appendChild(l);
}

function probeAsset(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const base = { id: uid(), name: file.name || "clip", url, blob: file, dur: 0, w: 0, h: 0 };
    if (file.type.startsWith("video")) {
      const v = document.createElement("video");
      v.muted = true; v.preload = "auto"; v.src = url;
      v.onloadedmetadata = () => resolve({ ...base, kind: "video", dur: v.duration || 5, w: v.videoWidth, h: v.videoHeight });
      v.onerror = () => resolve({ ...base, kind: "video", dur: 5 });
      setTimeout(() => resolve({ ...base, kind: "video", dur: base.dur || 5 }), 8000);
    } else if (file.type.startsWith("image")) {
      const im = new Image();
      im.onload = () => resolve({ ...base, kind: "image", dur: 0, w: im.naturalWidth, h: im.naturalHeight, el: im });
      im.onerror = () => resolve({ ...base, kind: "image" });
      im.src = url;
    } else {
      const a = document.createElement("audio");
      a.preload = "auto"; a.src = url;
      a.onloadedmetadata = () => resolve({ ...base, kind: "audio", dur: a.duration || 10 });
      a.onerror = () => resolve({ ...base, kind: "audio", dur: 10 });
      setTimeout(() => resolve({ ...base, kind: "audio", dur: base.dur || 10 }), 8000);
    }
  });
}

async function addFiles(files) {
  const { saveBlobToLibrary } = await import("./library-save.js").catch(() => ({}));
  const play = await import("./codec-play.js").catch(() => null);
  const expanded = [];
  for (const f of files) {
    if (!f) continue;
    if (play) {
      const norm = await play.normalizeMediaInput(f, "auto").catch(() => null);
      if (norm?.converted && norm.files.length) {
        log("codec: " + (norm.label || "converted") + " → " + norm.files.map((x) => x.name).join(", "));
        expanded.push(...norm.files);
        continue;
      }
    }
    expanded.push(f);
  }
  for (const f of expanded) {
    const a = await probeAsset(f);
    S.assets.push(a);
    log("bin: " + a.name + " (" + a.kind + (a.dur ? ", " + a.dur.toFixed(1) + "s" : "") + ")");
    try { if (saveBlobToLibrary) saveBlobToLibrary({ kind: "import", tab: "import", blob: f, filename: f.name, prompt: "editor import: " + f.name, extra: { provider: "import", providerLabel: "Editor bin import" } }); } catch (e) {}
  }
  if (!S.binSel && S.assets.length) S.binSel = S.assets[0].id;
  renderBin();
}

function renderBin() {
  const bin = $("edBin");
  bin.innerHTML = "";
  const _q = (($("ppProjSearch") && $("ppProjSearch").value) || "").toLowerCase();
  for (const a of S.assets.filter((x) => !_q || (x.name || "").toLowerCase().includes(_q))) {
    const d = document.createElement("div");
    d.className = "ed-asset";
    d.style.borderColor = a.id === S.binSel ? "var(--cyan)" : "";
    let thumb;
    if (a.kind === "image") { thumb = document.createElement("img"); thumb.src = a.url; }
    else if (a.kind === "video") { thumb = document.createElement("video"); thumb.src = a.url; thumb.muted = true; thumb.preload = "metadata"; }
    else { thumb = document.createElement("div"); thumb.textContent = "♪"; thumb.style.cssText = "width:52px;height:30px;display:flex;align-items:center;justify-content:center;background:#123;border-radius:6px;flex:none"; }
    d.appendChild(thumb);
    const nm = document.createElement("span");
    nm.className = "ed-aname mono"; nm.textContent = a.name;
    d.appendChild(nm);
    const du = document.createElement("span");
    d.title = a.kind + " - " + a.name + " - double-click adds to V1";
    du.className = "ed-adur mono"; du.textContent = a.kind + (a.dur ? " " + a.dur.toFixed(1) + "s" : "");
    d.appendChild(du);
    const dm = document.createElement("span");
    dm.className = "pp-adims mono"; dm.textContent = (a.w && a.h) ? (a.w + "x" + a.h) : (a.kind || "");
    d.appendChild(dm);
    d.draggable = true;
    d.ondragstart = (ev) => { ev.dataTransfer.setData("text/x-pp-asset", a.id); };
    d.onclick = () => { S.binSel = a.id; renderBin(); ppDrawSource(); };
    d.ondblclick = () => { S.binSel = a.id; renderBin(); ppDrawSource(); addClipAt(a.kind === "audio" ? "A1" : "V1", a); };
    bin.appendChild(d);
  }
}

function defaultClip(track, asset) {
  const c = {
    id: uid(), track, asset: asset ? asset.id : null, name: asset ? asset.name : "Text",
    start: S.t, dur: 3, in: 0, speed: 1, vol: 1, pip: "full",
    filter: "none", grade: "none", gk: 1, trIn: "none", trOut: "none", trDur: 0.4,
    text: track === "TXT" ? "Your text" : "", font: "Anton", size: 64, color: "#ffffff", pos: "bottom", anim: "fade",
    _el: null, _src: null,
  };
  if (asset && (asset.kind === "video" || asset.kind === "audio")) c.dur = Math.max(0.5, asset.dur || 5);
  return c;
}

function addClip(track) {
  if (track === "TXT") {
    const c = defaultClip("TXT", null);
    S.clips.push(c); S.sel = c.id;
    afterEdit("text added on TXT");
    return;
  }
  const a = assetById(S.binSel);
  const want = track === "A1" ? "audio" : "video";
  if (!a) { note("Pick a file in the bin first."); return; }
  if (want === "audio" && a.kind !== "audio") { note("A1 needs an audio file — images and video go on V1/V2."); return; }
  if (want === "video" && a.kind === "audio") { note("V1/V2 need a video or image file."); return; }
  const c = defaultClip(track, a);
  S.clips.push(c); S.sel = c.id;
  afterEdit(a.name + " → " + track);
}

function note(m) { const el = $("edAddNote"); if (el) el.textContent = m; log(m); }
function afterEdit(m) { renderTimeline(); renderInspector(); updateTimeTag(); try { ppSyncSide(); } catch {} if (m) log(m); }

function tc(sec, fps) {
  fps = fps || 30;
  sec = Math.max(0, Number(sec) || 0);
  const f = Math.floor((sec % 1) * fps);
  const s = Math.floor(sec) % 60, m = Math.floor(sec / 60) % 60, h = Math.floor(sec / 3600);
  const p = (n) => String(n).padStart(2, "0");
  return p(h) + ":" + p(m) + ":" + p(s) + ":" + p(f);
}
function trackLabel(tr) { return tr; }
function laneH(tr) { return tr === "TXT" ? 40 : (/^[A]/.test(tr) ? 44 : 52); }
function ppScroll() { return $("edTlScroll"); }
function ppContent() { return $("ppContent"); }

function renderTimeline() {
  const ruler = $("edRuler"), lanes = $("edLanes"), tl = $("edTimeline");
  if (!ruler || !lanes || !tl) return;
  const scroll = ppScroll();
  const z = S.zoom;
  const total = Math.max(projectEnd() + 5, 10);
  const W = Math.ceil(total * z);
  ruler.innerHTML = "";
  ruler.style.width = W + "px";
  const step = z < 14 ? 10 : z < 25 ? 5 : z < 55 ? 2 : z < 110 ? 1 : 0.5;
  for (let s = 0; s <= total + 0.01; s += step) {
    const t = document.createElement("span");
    t.className = "ed-tick mono";
    t.style.left = (s * z) + "px";
    t.textContent = (s % 1) ? s.toFixed(1) : (s + "s");
    ruler.appendChild(t);
  }
  lanes.innerHTML = "";
  lanes.style.width = W + "px";
  lanes.style.position = "relative";
  for (const tr of TRACKS) {
    const lane = document.createElement("div");
    lane.className = "ed-lane";
    lane.dataset.track = tr;
    for (const c of trackClips(tr)) {
      if (S.muted && S.muted[tr]) continue;
      const d = document.createElement("div");
      d.className = "ed-clip" + (c.id === S.sel ? " sel" : "");
      d.style.left = (c.start * z) + "px";
      d.style.width = Math.max(8, c.dur * z) + "px";
      d.dataset.id = c.id;
      d.title = c.name + " · " + c.dur.toFixed(2) + "s · drag to move · edges to trim";
      const cn = document.createElement("span");
      cn.className = "ed-cn";
      cn.textContent = (c.track === "TXT" ? "T: " : "") + c.name + "  " + c.dur.toFixed(1) + "s";
      d.appendChild(cn);
      for (const side of ["l", "r"]) {
        const h = document.createElement("span");
        h.className = side === "l" ? "ed-cl" : "ed-cr";
        h.dataset.side = side;
        d.appendChild(h);
      }
      d.addEventListener("pointerdown", (e) => onClipPointer(e, c, d));
      lane.appendChild(d);
    }
    lane.addEventListener("pointerdown", (e) => {
      if (e.target !== lane) return;
      const r = lane.getBoundingClientRect();
      S.sel = null;
      S.t = clamp((e.clientX - r.left) / z, 0, 3600);
      afterEdit();
    });
    lane.addEventListener("dragover", (e) => { e.preventDefault(); lane.classList.add("drop-target"); });
    lane.addEventListener("dragleave", () => lane.classList.remove("drop-target"));
    lane.addEventListener("drop", (e) => {
      e.preventDefault();
      lane.classList.remove("drop-target");
      const aid = e.dataTransfer.getData("text/x-pp-asset");
      if (!aid) return;
      const r = lane.getBoundingClientRect();
      dropAssetOnTrack(aid, tr, clamp((e.clientX - r.left) / z, 0, 3600));
    });
    lanes.appendChild(lane);
  }
  renderHeads();
  let ph = tl.querySelector(".ed-playhead");
  if (!ph) {
    ph = document.createElement("div");
    ph.className = "ed-playhead";
    const grip = document.createElement("div");
    grip.className = "ed-phandle";
    grip.addEventListener("pointerdown", onPlayheadPointer);
    ph.appendChild(grip);
    ppContent().appendChild(ph);
  }
  positionPlayhead();
  syncZoomUI();
  updateTimeTag();
}
function renderHeads() {
  const heads = $("ppHeads");
  if (!heads) return;
  heads.innerHTML = "";
  const spacer = document.createElement("div");
  spacer.className = "pp-ruler-spacer";
  spacer.textContent = "TRACKS";
  heads.appendChild(spacer);
  for (const tr of TRACKS) {
    const h = document.createElement("div");
    h.className = "pp-head";
    h.dataset.track = tr;
    h.style.height = laneH(tr) + "px";
    const nm = document.createElement("b");
    nm.textContent = tr;
    nm.style.color = "var(--pp-txt)";
    h.appendChild(nm);
    const btns = document.createElement("span");
    btns.className = "pp-hbtns";
    if (/^V/.test(tr) || tr === "TXT") {
      const eye = document.createElement("button");
      eye.textContent = (S.muted && S.muted[tr]) ? "🚫" : "👁";
      eye.title = "Toggle track output";
      eye.onclick = () => { S.muted = S.muted || {}; S.muted[tr] = !S.muted[tr]; renderTimeline(); };
      btns.appendChild(eye);
    } else {
      const m = document.createElement("button");
      m.textContent = "M";
      m.title = "Mute track";
      m.className = (S.muted && S.muted[tr]) ? "on" : "";
      m.onclick = () => { S.muted = S.muted || {}; S.muted[tr] = !S.muted[tr]; renderTimeline(); };
      btns.appendChild(m);
    }
    const lk = document.createElement("button");
    lk.textContent = (S.locked && S.locked[tr]) ? "🔒" : "🔓";
    lk.title = "Lock track";
    lk.onclick = () => { S.locked = S.locked || {}; S.locked[tr] = !S.locked[tr]; renderTimeline(); };
    btns.appendChild(lk);
    h.appendChild(btns);
    heads.appendChild(h);
  }
}
function contentXToTime(clientX) {
  const lanes = $("edLanes");
  const r = lanes.getBoundingClientRect();
  return clamp((clientX - r.left) / S.zoom, 0, 3600);
}
function positionPlayhead() {
  const tl = $("edTimeline"), lanes = $("edLanes");
  const ph = tl ? tl.querySelector(".ed-playhead") : null;
  if (!ph || !lanes) return;
  const lr = lanes.getBoundingClientRect();
  const cr = ppContent().getBoundingClientRect();
  ph.style.left = (lr.left - cr.left + S.t * S.zoom) + "px";
  ph.style.top = "0px";
  ph.style.height = ppContent().offsetHeight + "px";
}
function syncZoomUI() {
  const zl = $("edZoomLbl");
  if (zl) zl.textContent = Math.round(S.zoom) + " px/s";
  const zr = $("ppZoomRange");
  if (zr && document.activeElement !== zr) zr.value = Math.round(S.zoom);
}
function setZoom(nz, anchorT) {
  const scroll = ppScroll();
  nz = clamp(nz, 8, 400);
  if (scroll && anchorT != null) {
    const left = anchorT * S.zoom - scroll.scrollLeft;
    S.zoom = nz;
    renderTimeline();
    scroll.scrollLeft = anchorT * nz - left;
  } else {
    S.zoom = nz;
    renderTimeline();
  }
}
function snapTime(t, ignoreId) {
  if (!S.snap) return t;
  const cands = [S.t, 0];
  for (const c of S.clips) {
    if (c.id === ignoreId) continue;
    cands.push(c.start, c.start + c.dur);
  }
  const px = 8 / S.zoom;
  let best = t, bd = px;
  for (const cd of cands) {
    const d = Math.abs(cd - t);
    if (d < bd) { bd = d; best = cd; }
  }
  return best;
}
function trackAt(clientY) {
  const lanes = [...document.querySelectorAll("#edLanes .ed-lane")];
  for (const l of lanes) {
    const r = l.getBoundingClientRect();
    if (clientY >= r.top && clientY <= r.bottom) return l.dataset.track;
  }
  return null;
}

let drag = null;
function onClipPointer(e, c, el) {
  e.stopPropagation();
  if (S.tool === "razor") {
    S.sel = c.id;
    splitAt(contentXToTime(e.clientX));
    return;
  }
  if (S.tool === "zoom") {
    setZoom(S.zoom * (e.altKey ? 0.75 : 1.33), contentXToTime(e.clientX));
    return;
  }
  if (S.tool === "hand") return;
  S.sel = c.id;
  renderTimeline(); renderInspector(); ppSyncSide();
  if (S.locked && S.locked[c.track]) return;
  const side = e.target.dataset.side;
  const x0 = e.clientX, y0 = e.clientY;
  drag = { id: c.id, mode: side ? (side === "l" ? "trimL" : "trimR") : "move", x0, y0, start: c.start, dur: c.dur, in: c.in, track: c.track, moved: false };
  try { el.setPointerCapture(e.pointerId); } catch {}
  const mv = (ev) => {
    if (!drag) return;
    const cc = clipById(drag.id);
    if (!cc) return;
    const dx = (ev.clientX - drag.x0) / S.zoom;
    if (Math.abs(ev.clientX - drag.x0) + Math.abs(ev.clientY - drag.y0) > 3) drag.moved = true;
    if (drag.mode === "move") {
      let ns = Math.max(0, drag.start + dx);
      ns = snapTime(ns, cc.id);
      const end = ns + cc.dur;
      const edge = snapTime(end, cc.id);
      if (edge !== end) ns = Math.max(0, edge - cc.dur);
      cc.start = ns;
      const nt = trackAt(ev.clientY);
      if (nt && nt !== cc.track) {
        const a = assetById(cc.asset);
        const ak = a ? a.kind : (cc.track === "TXT" ? "text" : "video");
        const ok = (nt === "TXT" && cc.track === "TXT") || (nt !== "TXT" && cc.track !== "TXT") ||
          (nt === "A1" || nt === "A2" ? ak === "audio" : ak !== "audio");
        if (ok && !(S.locked && S.locked[nt])) cc.track = nt;
      }
    }
    else if (drag.mode === "trimR") { const end = snapTime(drag.start + drag.dur + dx, cc.id); cc.dur = Math.max(0.2, end - cc.start); }
    else {
      const raw = Math.max(0, drag.start + dx);
      const ns = snapTime(raw, cc.id);
      const d = ns - drag.start;
      const maxD = drag.dur - 0.2;
      const applied = clamp(d, -drag.in / Math.max(0.25, cc.speed), maxD);
      cc.start = drag.start + applied;
      cc.in = Math.max(0, drag.in + applied * cc.speed);
      cc.dur = drag.dur - applied;
    }
    renderTimeline(); positionPlayhead();
  };
  const up = () => {
    drag = null;
    try { el.removeEventListener("pointermove", mv); } catch {}
    try { el.removeEventListener("pointerup", up); } catch {}
    renderInspector(); updateTimeTag(); ppSyncSide();
  };
  el.addEventListener("pointermove", mv);
  el.addEventListener("pointerup", up);
}
function onPlayheadPointer(e) {
  e.stopPropagation(); e.preventDefault();
  const mv = (ev) => {
    S.t = contentXToTime(ev.clientX);
    positionPlayhead(); updateTimeTag(); ppTickClocks();
    if (!S.playing) draw();
  };
  const up = () => {
    window.removeEventListener("pointermove", mv);
    window.removeEventListener("pointerup", up);
  };
  window.addEventListener("pointermove", mv);
  window.addEventListener("pointerup", up);
}
function bindRulerScrub() {
  const ruler = $("edRuler");
  if (!ruler || ruler.dataset.ppbound) return;
  ruler.dataset.ppbound = "1";
  ruler.addEventListener("pointerdown", (e) => {
    if (S.tool === "zoom") { setZoom(S.zoom * (e.altKey ? 0.75 : 1.33), contentXToTime(e.clientX)); return; }
    ruler.setPointerCapture(e.pointerId);
    S.t = contentXToTime(e.clientX);
    positionPlayhead(); updateTimeTag(); ppTickClocks();
    if (!S.playing) draw();
    const mv = (ev) => {
      S.t = contentXToTime(ev.clientX);
      positionPlayhead(); updateTimeTag(); ppTickClocks();
      if (!S.playing) draw();
    };
    const up = () => {
      ruler.removeEventListener("pointermove", mv);
      ruler.removeEventListener("pointerup", up);
    };
    ruler.addEventListener("pointermove", mv);
    ruler.addEventListener("pointerup", up);
  });
}
function bindWheelZoom() {
  const scroll = ppScroll();
  if (!scroll || scroll.dataset.ppbound) return;
  scroll.dataset.ppbound = "1";
  scroll.addEventListener("wheel", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) {
      e.preventDefault();
      const f = e.deltaY > 0 ? 0.85 : 1.18;
      setZoom(S.zoom * f, contentXToTime(e.clientX));
    }
  }, { passive: false });
}
function dropAssetOnTrack(aid, track, t) {
  const a = assetById(aid);
  if (!a) return;
  if (S.locked && S.locked[track]) { log("track " + track + " is locked"); return; }
  if (track === "TXT") return;
  if (track === "A1" || track === "A2") {
    if (a.kind !== "audio") { note("Audio tracks need an audio file."); return; }
  } else if (a.kind === "audio") { note("V1/V2 need a video or image file."); return; }
  const c = defaultClip(track, a);
  c.start = t;
  S.clips.push(c); S.sel = c.id; S.t = t;
  afterEdit(a.name + " → " + track);
}
function ppTickClocks() {
  const a = $("ppSeqTc");
  if (a) a.textContent = tc(S.t);
}
function updateTimeTag_pp() {
  const el = $("edTimeTag");
  if (el) el.textContent = S.t.toFixed(1) + " / " + projectEnd().toFixed(1) + "s";
  ppTickClocks();
  const d = $("ppProgDur");
  if (d) d.textContent = tc(projectEnd());
}

function splitAt(t) {
  const c = selClip() || [...S.clips].filter((x) => x.track !== "TXT" && t > x.start + 0.05 && t < x.start + x.dur - 0.05).sort((a, b) => (b.track === "V1") - (a.track === "V1"))[0];
  if (!c) { log("split: nothing under the playhead"); return; }
  if (t <= c.start + 0.05 || t >= c.start + c.dur - 0.05) { log("split: playhead is outside the selected clip"); return; }
  const cut = t - c.start;
  const right = { ...c, id: uid(), _el: null, _src: null, start: t, dur: c.dur - cut, in: c.in + cut * c.speed };
  c.dur = cut;
  S.clips.push(right);
  S.sel = right.id;
  afterEdit("split " + c.name);
}

function mergeSelected() {
  const c = selClip();
  if (!c) { log("merge: select a clip first"); return; }
  const group = S.clips.filter((x) => x.track === c.track).sort((a, b) => a.start - b.start);
  if (group.length < 2) { log("merge: need at least 2 clips on " + c.track); return; }
  const fusable = group.every((g) => g.track === "TXT" || (g.asset === group[0].asset && g.speed === group[0].speed && g.filter === group[0].filter && g.grade === group[0].grade));
  let contiguous = c.track === "TXT";
  if (!contiguous) {
    contiguous = true;
    for (let i = 1; i < group.length; i++) {
      if (Math.abs(group[i].in - (group[i - 1].in + group[i - 1].dur * group[i - 1].speed)) > 0.05) { contiguous = false; break; }
    }
  }
  if (fusable && contiguous) {
    const first = group[0];
    first.start = Math.min(...group.map((g) => g.start));
    first.dur = group.reduce((s, g) => s + g.dur, 0);
    if (c.track === "TXT") first.text = group.map((g) => g.text).join(" ");
    for (const g of group.slice(1)) { stopClipMedia(g); S.clips = S.clips.filter((x) => x.id !== g.id); }
    S.sel = first.id;
    S.t = first.start;
    afterEdit("merged " + group.length + " clips into one on " + c.track);
    return;
  }
  let cur = group[0].start;
  for (const g of group) { g.start = cur; cur += g.dur; }
  S.t = group[0].start;
  afterEdit("joined " + group.length + " clips end-to-end on " + c.track + " (different sources — kept as cuts)");
}

function trimSel(edge) {
  const c = selClip();
  if (!c) return;
  if (edge === "in") {
    if (S.t <= c.start || S.t >= c.start + c.dur) { log("trim: playhead outside clip"); return; }
    const d = S.t - c.start;
    c.in += d * c.speed; c.start = S.t; c.dur -= d;
  } else {
    if (S.t <= c.start || S.t >= c.start + c.dur) { log("trim: playhead outside clip"); return; }
    c.dur = S.t - c.start;
  }
  afterEdit("trimmed " + c.name);
}

function deleteSel() {
  if (!S.sel) return;
  const c = clipById(S.sel);
  stopClipMedia(c);
  S.clips = S.clips.filter((x) => x.id !== S.sel);
  S.sel = null;
  afterEdit("deleted");
}

function duplicateSel() {
  const c = selClip();
  if (!c) return;
  const n = { ...c, id: uid(), _el: null, _src: null, start: c.start + c.dur };
  S.clips.push(n);
  S.sel = n.id;
  afterEdit("duplicated");
}

function renderInspector() {
  const c = selClip();
  $("edInspector").hidden = !c;
  $("edNoSel").hidden = !!c;
  $("edSelName").textContent = c ? c.track + " · " + c.name : "nothing selected";
  if (!c) return;
  $("edName").value = c.name;
  $("edStart").value = c.start.toFixed(2);
  $("edDur").value = c.dur.toFixed(2);
  $("edIn").value = c.in.toFixed(2);
  $("edSpeed").value = c.speed;
  $("edVol").value = c.vol;
  $("edPipSel").value = c.pip;
  fillSel($("edFilterSel"), FILTERS, c.filter);
  fillSel($("edGradeSel"), GRADE_PRESETS.map((g) => [g.id, g.label[0].toUpperCase() + g.label.slice(1)]), c.grade);
  $("edGradeK").value = c.gk;
  $("edGradeKVal").textContent = Number(c.gk).toFixed(2);
  fillSel($("edTrInSel"), TRANSITIONS, c.trIn);
  fillSel($("edTrOutSel"), TRANSITIONS, c.trOut);
  $("edTrDur").value = c.trDur;
  const isT = c.track === "TXT";
  $("edTextBox").hidden = !isT;
  if (isT) {
    $("edText").value = c.text;
    fillSel($("edFontSel"), FONTS.map((f) => [f, f]), c.font);
    $("edFontSize").value = c.size;
    $("edFontColor").value = c.color;
    $("edTextPosSel").value = c.pos;
    $("edTextAnimSel").value = c.anim;
  }
}

function fillSel(sel, opts, cur) {
  sel.innerHTML = "";
  for (const [v, l] of opts) {
    const o = document.createElement("option");
    o.value = v; o.textContent = l;
    sel.appendChild(o);
  }
  sel.value = cur;
}

function bindInspector() {
  const c = () => selClip();
  const num = (id, fn) => $(id).addEventListener("change", () => { const x = c(); if (!x) return; fn(x, Number($(id).value)); afterEdit(); });
  $("edName").addEventListener("change", () => { const x = c(); if (x) { x.name = $("edName").value; afterEdit(); } });
  num("edStart", (x, v) => { x.start = Math.max(0, v); });
  num("edDur", (x, v) => { x.dur = Math.max(0.2, v); });
  num("edIn", (x, v) => { x.in = Math.max(0, v); });
  num("edSpeed", (x, v) => { x.speed = clamp(v || 1, 0.25, 4); });
  num("edVol", (x, v) => { x.vol = clamp(v, 0, 1); if (x._el) x._el.volume = x.vol; });
  $("edPipSel").addEventListener("change", () => { const x = c(); if (x) { x.pip = $("edPipSel").value === "pip" ? "pip" : "full"; afterEdit(); } });
  $("edFilterSel").addEventListener("change", () => { const x = c(); if (x) { x.filter = $("edFilterSel").value; } });
  $("edGradeSel").addEventListener("change", () => { const x = c(); if (x) { x.grade = $("edGradeSel").value; } });
  $("edGradeK").addEventListener("input", () => { const x = c(); if (x) { x.gk = Number($("edGradeK").value); $("edGradeKVal").textContent = x.gk.toFixed(2); } });
  $("edTrInSel").addEventListener("change", () => { const x = c(); if (x) x.trIn = $("edTrInSel").value; });
  $("edTrOutSel").addEventListener("change", () => { const x = c(); if (x) x.trOut = $("edTrOutSel").value; });
  num("edTrDur", (x, v) => { x.trDur = clamp(v, 0, 3); });
  $("edText").addEventListener("change", () => { const x = c(); if (x) x.text = $("edText").value; });
  $("edFontSel").addEventListener("change", () => { const x = c(); if (x) x.font = $("edFontSel").value; });
  num("edFontSize", (x, v) => { x.size = clamp(v, 12, 220); });
  $("edFontColor").addEventListener("change", () => { const x = c(); if (x) x.color = $("edFontColor").value; });
  $("edTextPosSel").addEventListener("change", () => { const x = c(); if (x) x.pos = $("edTextPosSel").value; });
  $("edTextAnimSel").addEventListener("change", () => { const x = c(); if (x) x.anim = $("edTextAnimSel").value; });
  $("edSplitBtn2").onclick = () => splitAt(S.t);
  $("edDupBtn").onclick = duplicateSel;
  $("edDelBtn").onclick = deleteSel;
}

function clipMedia(c) {
  if (c.track === "TXT") return null;
  const a = assetById(c.asset);
  if (!a) return null;
  if (a.kind === "image") return a.el || null;
  if (!c._el) {
    c._el = document.createElement(a.kind === "video" ? "video" : "audio");
    c._el.src = a.url;
    c._el.preload = "auto";
    c._el.playsInline = true;
    c._el.crossOrigin = "anonymous";
    c._el.className = "ed-hidden-media";
    c._el.volume = c.vol;
    ($("pageEditor") || document.body).appendChild(c._el);
  }
  return c._el;
}

function stopClipMedia(c) {
  if (c && c._el) { try { c._el.pause(); } catch {} c._el.remove(); c._el = null; }
}
function stopAllMedia() { for (const c of S.clips) if (c._el) { try { c._el.pause(); } catch {} } }

function activeAt(track, t) {
  return S.clips.filter((c) => c.track === track && t >= c.start && t < c.start + c.dur).sort((a, b) => a.start - b.start);
}

function gradeFilter(c) {
  if (!c.grade || c.grade === "none") return "";
  const p = GRADE_PRESETS.find((g) => g.id === c.grade);
  if (!p) return "";
  const k = clamp(Number(c.gk) || 0, 0, 1);
  const sat = 1 + (p.sat - 1) * k;
  const bri = 1 + (p.bright - 1) * k;
  const con = 1 + (p.contrast - 1) * k;
  return "saturate(" + sat.toFixed(3) + ") brightness(" + bri.toFixed(3) + ") contrast(" + con.toFixed(3) + ")";
}

function transAlpha(c, t) {
  const d = Math.min(c.trDur || 0, c.dur / 2);
  if (d <= 0) return { a: 1, wipe: 0, zoom: 1 };
  const eIn = t - c.start, eOut = c.start + c.dur - t;
  let a = 1, wipe = 0, zoom = 1;
  const apply = (kind, p) => {
    if (kind === "fade") a = Math.min(a, clamp(p / d, 0, 1));
    else if (kind === "wipe") { wipe = Math.max(wipe, 1 - clamp(p / d, 0, 1)); a = 1; }
    else if (kind === "zoom") { zoom = 1 + 0.25 * (1 - clamp(p / d, 0, 1)); a = Math.min(a, clamp(p / d + 0.15, 0, 1)); }
  };
  if (c.trIn !== "none" && eIn < d) apply(c.trIn, eIn);
  if (c.trOut !== "none" && eOut < d) apply(c.trOut, eOut);
  return { a, wipe, zoom };
}

function drawCover(ctx, src, W, H, zoomK) {
  const sw = src.videoWidth || src.naturalWidth || src.width;
  const sh = src.videoHeight || src.naturalHeight || src.height;
  if (!sw || !sh) return;
  const s = Math.max(W / sw, H / sh) * (zoomK || 1);
  const dw = sw * s, dh = sh * s;
  ctx.drawImage(src, (W - dw) / 2, (H - dh) / 2, dw, dh);
}

function syncAV(c, t, playing) {
  const el = clipMedia(c);
  if (!el || el.tagName === "IMG") return;
  const st = c.in + (t - c.start) * c.speed;
  const a = assetById(c.asset);
  const maxT = a && a.dur ? a.dur - 0.05 : 1e9;
  if (playing) {
    if (Math.abs((el.currentTime || 0) - Math.min(st, maxT)) > 0.3) { try { el.currentTime = Math.min(Math.max(0, st), maxT); } catch {} }
    el.playbackRate = c.speed;
    el.volume = c.vol;
    el.muted = false;
    if (el.paused) el.play().catch(() => {});
  } else if (!el.paused) el.pause();
}

function draw() {
  const cv = $("edCanvas");
  if (!cv) return;
  const ctx = cv.getContext("2d");
  const W = cv.width, H = cv.height;
  ctx.save();
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
  const t = S.t;
  const v1 = activeAt("V1", t);
  const v2 = activeAt("V2", t);
  const layers = [...v1, ...v2];
  for (const c of S.clips) {
    if ((c.track === "A1" || c.track === "A2") && t >= c.start && t < c.start + c.dur) syncAV(c, t, S.playing && !S.exporting ? true : S.playing);
    if (c.track === "V1" || c.track === "V2") {
      const on = t >= c.start && t < c.start + c.dur;
      if (!on) { if (c._el && !c._el.paused && !S.exporting) c._el.pause(); continue; }
      syncAV(c, t, S.playing);
    }
  }
  for (const c of layers) {
    const el = clipMedia(c);
    if (!el) continue;
    if (el.tagName === "VIDEO" && (el.readyState < 2 || el.videoWidth === 0)) continue;
    const { a, wipe, zoom } = transAlpha(c, t);
    ctx.save();
    ctx.globalAlpha = a;
    const css = [FILTER_CSS[c.filter] || "", gradeFilter(c)].filter(Boolean).join(" ");
    try { ctx.filter = css || "none"; } catch {}
    if (c.pip === "pip") {
      const pw = W * 0.36, ph2 = pw * 9 / 16;
      ctx.drawImage(el, W - pw - 16, H - ph2 - 16, pw, ph2);
    } else if (wipe > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, W * (1 - wipe), H);
      ctx.clip();
      drawCover(ctx, el, W, H, zoom);
      ctx.restore();
    } else {
      drawCover(ctx, el, W, H, zoom);
    }
    try { ctx.filter = "none"; } catch {}
    if (c.grade && c.grade !== "none") {
      const p = GRADE_PRESETS.find((g) => g.id === c.grade);
      if (p && p.tintAlpha > 0.001) {
        ctx.globalAlpha = a * p.tintAlpha * (c.gk || 1);
        ctx.fillStyle = p.tint;
        ctx.fillRect(0, 0, W, H);
        ctx.globalAlpha = a;
      }
    }
    ctx.restore();
  }
  for (const c of activeAt("TXT", t)) drawText(ctx, c, W, H, t);
  ctx.restore();
}

function drawText(ctx, c, W, H, t) {
  const d = Math.min(0.5, c.dur / 3);
  const eIn = t - c.start, eOut = c.start + c.dur - t;
  let a = 1, dy = 0;
  if (c.anim === "fade") a = clamp(Math.min(eIn, eOut) / d, 0, 1);
  else if (c.anim === "rise") { a = clamp(Math.min(eIn, eOut) / d, 0, 1); dy = (1 - clamp(eIn / d, 0, 1)) * 40; }
  ctx.save();
  ctx.globalAlpha = a;
  const px = Math.round(c.size * (W / 960));
  ctx.font = px + 'px "' + c.font + '", sans-serif';
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const x = W / 2;
  const y = c.pos === "top" ? H * 0.14 + dy : c.pos === "center" ? H / 2 + dy : H * 0.84 + dy;
  ctx.lineWidth = Math.max(2, px / 12);
  ctx.strokeStyle = "rgba(0,0,0,.85)";
  const lines = String(c.text || "").split("\n");
  const lh = px * 1.2;
  const y0 = y - (lines.length - 1) * lh / 2;
  lines.forEach((ln, i) => {
    ctx.strokeText(ln, x, y0 + i * lh);
    ctx.fillStyle = c.color || "#fff";
    ctx.fillText(ln, x, y0 + i * lh);
  });
  ctx.restore();
}

function tick(ts) {
  try { bindInspector(); } catch (e) { log("inspector: " + e.message); }
  if (!S.ppInit) { S.ppInit = true; try { ppInit(); } catch (e) { log("pp init: " + e.message); } }
  try { ppSyncSide(); ppDrawSource(); } catch {}
  S.raf = requestAnimationFrame(tick);
  const page = $("pageEditor");
  if (!page || page.hidden) return;
  const dt = Math.min(0.1, (ts - (S.lastTs || ts)) / 1000);
  S.lastTs = ts;
  if (S.playing) {
    const end = exportEnd();
    S.t += dt;
    if (S.t >= end) {
      if (S.exporting) { finishExport(); return; }
      if (S.loop) S.t = exportStart();
      else { S.t = end; setPlaying(false); }
    }
    positionPlayhead();
    updateTimeTag();
  }
  draw();
  try { if (!page.hidden) { ppDrawSource(); ppTickClocks(); } } catch {}
}

function exportStart() { return $("edFullToggle").checked ? 0 : Math.max(0, Number($("edRangeStart").value) || 0); }
function exportEnd() {
  if ($("edFullToggle").checked) return Math.max(0.5, projectEnd());
  const e = Number($("edRangeEnd").value) || 0;
  return Math.max(exportStart() + 0.5, e);
}

function updateTimeTag() {
  const el = $("edTimeTag");
  if (el) el.textContent = S.t.toFixed(1) + " / " + projectEnd().toFixed(1) + "s";
  try { ppTickClocks(); } catch {}
}

function setPlaying(on) {
  S.playing = on;
  $("edPlayBtn").textContent = on ? "Pause" : "Play";
  $("edPlayState").textContent = on ? "playing" : "paused";
  if (!on) stopAllMedia();
}

function encoderOptions() {
  const cands = [
    ["video/mp4;codecs=avc1.42E01f", "MP4 · H.264"],
    ["video/mp4", "MP4 · default"],
    ["video/webm;codecs=vp9", "WebM · VP9"],
    ["video/webm;codecs=vp8", "WebM · VP8"],
    ["video/webm", "WebM · default"],
  ];
  const out = [];
  try {
    for (const [m, l] of cands) if (window.MediaRecorder && MediaRecorder.isTypeSupported(m)) out.push([m, l]);
  } catch {}
  return out;
}

function refreshEncoders() {
  const sel = $("edEncoderSel");
  sel.innerHTML = "";
  for (const [m, l] of encoderOptions()) {
    const o = document.createElement("option");
    o.value = m; o.textContent = l;
    sel.appendChild(o);
  }
  const wantMp4 = $("edFormatSel").value === "mp4";
  const ix = [...sel.options].findIndex((o) => wantMp4 ? o.value.includes("mp4") : o.value.includes("webm"));
  sel.selectedIndex = Math.max(0, ix);
}

function mixAudio(stream) {
  try {
    if (!S.audioCtx) {
      S.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      S.recDest = S.audioCtx.createMediaStreamDestination();
    }
    if (S.audioCtx.state === "suspended") S.audioCtx.resume();
    for (const c of S.clips) {
      if (!c._el || c._el.tagName === "IMG") continue;
      if (!c._src) {
        const src = S.audioCtx.createMediaElementSource(c._el);
        const g = S.audioCtx.createGain();
        g.gain.value = c.vol;
        src.connect(g); g.connect(S.audioCtx.destination); g.connect(S.recDest);
        c._src = { src, g };
      } else c._src.g.gain.value = c.vol;
    }
    for (const tr of S.recDest.stream.getAudioTracks()) stream.addTrack(tr);
  } catch (e) { log("audio mix unavailable: " + e.message); }
}

async function startExport() {
  if (!S.clips.length) { log("export: timeline is empty"); return; }
  if ($("edComputeSel") && $("edComputeSel").value === "server") { sendToServer(); return; }
  if (S.exporting) return;
  const wantMp4 = ($("edFormatSel") && $("edFormatSel").value) !== "webm";
  const ordered = encoderOptions().sort((a, b) => {
    const am = wantMp4 ? a[0].includes("mp4") : a[0].includes("webm");
    const bm = wantMp4 ? b[0].includes("mp4") : b[0].includes("webm");
    return (bm ? 1 : 0) - (am ? 1 : 0);
  });
  if (!ordered.length) {
    const msg = "export: no supported encoder in this browser — try Chrome or Edge";
    log(msg);
    if ($("edExportNote")) $("edExportNote").textContent = msg;
    return;
  }
  let mime = ($("edEncoderSel") && $("edEncoderSel").value) || ordered[0][0];
  if (!ordered.some(([m]) => m === mime)) mime = ordered[0][0];
  if ($("edEncoderSel")) $("edEncoderSel").value = mime;
  const fps = Number($("edFpsSel").value) || 30;
  const q = Number($("edQuality").value) || 0.8;
  const [ew, eh] = EXPORT_DIMS[S.ratio] || EXPORT_DIMS["16:9"];
  const cv = $("edCanvas");
  const pw = cv.width, ph = cv.height;
  cv.width = ew; cv.height = eh;
  const stream = cv.captureStream(fps);
  mixAudio(stream);
  let rec = null;
  let recMime = "";
  let recErr = null;
  for (const [m] of ordered.sort((a, b) => (a[0] === mime ? -1 : b[0] === mime ? 1 : 0))) {
    try {
      rec = new MediaRecorder(stream, { mimeType: m, videoBitsPerSecond: Math.round(8e6 * q), audioBitsPerSecond: 128000 });
      recMime = m;
      break;
    } catch (e) { recErr = e; }
  }
  if (!rec) {
    const msg = "export: the media encoder refused every format (" + ((recErr && recErr.message) || "not supported") + ") — try Chrome or Edge";
    log(msg);
    if ($("edExportNote")) $("edExportNote").textContent = msg;
    cv.width = pw; cv.height = ph;
    return;
  }
  mime = recMime;
  if ($("edEncoderSel")) $("edEncoderSel").value = mime;
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  const done = new Promise((res) => { rec.onstop = res; });
  S.exporting = true;
  S.cancelExport = false;
  S.t = exportStart();
  setPlaying(true);
  try { rec.start(250); }
  catch (e) {
    setPlaying(false);
    S.exporting = false;
    const msg = "export: the media encoder would not start (" + ((e && e.message) || e) + ") — try the other format";
    log(msg);
    if ($("edExportNote")) $("edExportNote").textContent = msg;
    $ ("edExportBtn").hidden = false;
    $("edExportCancelBtn").hidden = true;
    $("edExportLbl").textContent = "Export video";
    cv.width = pw; cv.height = ph;
    return;
  }
  $("edExportBtn").hidden = true;
  $("edExportCancelBtn").hidden = false;
  $("edExportLbl").textContent = "Recording…";
  log("export: recording " + fmt(S.t) + " → " + fmt(exportEnd()) + " at " + fps + "fps, keep this tab visible");
  const stop = setInterval(() => {
    $("edExportNote").textContent = "Recording… " + S.t.toFixed(1) + "s / " + exportEnd().toFixed(1) + "s";
    if (S.cancelExport) { clearInterval(stop); setPlaying(false); try { rec.stop(); } catch {} }
  }, 300);
  S._expStop = () => { clearInterval(stop); };
  rec._chunks = chunks;
  S.recorder = rec;
  S._expDone = done;
  S._expMime = mime;
  S._expSize = [pw, ph];
}

async function finishExport() {
  if (!S.exporting) return;
  S.exporting = false;
  setPlaying(false);
  if (S._expStop) S._expStop();
  const rec = S.recorder;
  try { if (rec && rec.state !== "inactive") rec.stop(); } catch {}
  if (S._expDone) await S._expDone;
  const mime = S._expMime || "video/webm";
  let blob = new Blob(rec._chunks || [], { type: mime });
  const cv = $("edCanvas");
  cv.width = S._expSize[0]; cv.height = S._expSize[1];
  $("edExportBtn").hidden = false;
  $("edExportCancelBtn").hidden = true;
  $("edExportLbl").textContent = "Export video";
  if (S.cancelExport) { log("export cancelled"); S.recorder = null; return; }
  let ext = mime.includes("mp4") ? "mp4" : "webm";
  let finalMime = mime;
  const want = ($("edFormatSel") && $("edFormatSel").value) || ext;
  try {
    if (want === "mov" || want === "mkv" || want === "gif" || want === "apng") {
      const { exportVideo } = await import("./gallery-export.js");
      const conv = await exportVideo(blob, { container: want, quality: Number($("edQuality")?.value) || 0.8 });
      if (conv && conv.blob && conv.blob.size) { blob = conv.blob; ext = conv.ext || want; finalMime = blob.type || finalMime; }
    } else if (want === "mp4" || want === "webm") { ext = want; }
  } catch (e) { log("convert skipped: " + (e && e.message || e)); }
  const url = URL.createObjectURL(blob);
  const a = $("edDownloadLink");
  a.href = url;
  a.download = "edit-" + Date.now() + "." + ext;
  a.hidden = false;
  a.textContent = "";
  let libMsg = "";
  try {
    let edPoster = null;
    try {
      if (String(finalMime || blob.type || "").startsWith("video/")) {
        const { extractFrame } = await import("./video.js");
        const shot = await extractFrame(blob, "first");
        edPoster = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(String(r.result || "")); r.onerror = () => res(""); r.readAsDataURL(shot); });
        if (!String(edPoster || "").startsWith("data:")) edPoster = null;
      }
    } catch {}
    const stored = await addHistory({ id: uid() + Date.now().toString(36), ts: Date.now(), kind: "final", sandbox: false, runName: "editor-" + new Date().toISOString().slice(0, 10), filename: a.download, prompt: "editor timeline export", userPrompt: "editor timeline export", provider: "editor-inbuilt-encoder", providerLabel: "Editor inbuilt encoder", duration: exportEnd() - exportStart(), actualDuration: exportEnd() - exportStart(), aspect: S.ratio, quality: String(Number($("edFpsSel")?.value) || 30) + "fps", ext, mime: finalMime, size: blob.size, poster: edPoster, video: blob });
    libMsg = stored && stored.locked ? " (library locked)" : " Saved to Library.";
  } catch (e) { libMsg = ""; }
  log("export done: " + (blob.size / 1048576).toFixed(2) + " MB — downloading");
  a.click();
  $("edExportNote").textContent = "Done — " + (blob.size / 1048576).toFixed(2) + " MB " + ext.toUpperCase() + "." + libMsg + " Export again or keep editing.";
  S.recorder = null;
}

function edl() {
  return {
    app: "ai-multi-toolkit-editor",
    ratio: S.ratio,
    fps: Number($("edFpsSel").value) || 30,
    range: $("edFullToggle").checked ? "full" : [Number($("edRangeStart").value) || 0, Number($("edRangeEnd").value) || 0],
    assets: S.assets.map((a) => ({ id: a.id, name: a.name, kind: a.kind, dur: a.dur, w: a.w, h: a.h })),
    clips: S.clips.map((c) => ({ ...c, _el: undefined, _src: undefined })),
  };
}

function downloadEdl() {
  const blob = new Blob([JSON.stringify(edl(), null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "edit-decision-list.json";
  a.click();
  log("EDL downloaded — replay it on any machine with the same media files");
}

function serverUrl() {
  try {
    const st = window.AIVideoGen && window.AIVideoGen.state;
    return (st && st.settings && (st.settings.serverUrl || st.settings.serverURL)) || "";
  } catch { return ""; }
}

async function sendToServer() {
  const url = (serverUrl() || "").replace(/\/$/, "");
  if (!url) {
    log("cloud render: no GPU server set — Settings → My GPU server address first (free Colab). EDL downloaded instead.");
    downloadEdl();
    return;
  }
  log("cloud render: sending EDL to " + url + " …");
  try {
    const r = await fetch(url + "/api/editor/render", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(edl()),
    });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const j = await r.json();
    if (j && j.url) {
      log("cloud render ready: " + j.url);
      window.open(j.url, "_blank");
    } else log("cloud render accepted: " + JSON.stringify(j).slice(0, 300));
  } catch (e) {
    log("cloud render: server has no /api/editor/render yet (" + e.message + "). Render here instead, or add one ffmpeg endpoint — EDL downloaded.");
    downloadEdl();
  }
}

async function pullFromStudios() {
  let n = 0;
  try {
    const st = window.AIVideoGen && window.AIVideoGen.state;
    const res = st && st.result;
    if (res && res.blob instanceof Blob) {
      const a = await probeAsset(new File([res.blob], (st.runName || "studio-clip") + ".mp4", { type: res.blob.type || "video/mp4" }));
      S.assets.push(a); n++;
    }
    const imgs = (st && st.imgResults) || [];
    for (const it of imgs.slice(0, 4)) {
      const b = it instanceof Blob ? it : it && (it.blob instanceof Blob ? it.blob : null);
      if (!b) continue;
      const a = await probeAsset(new File([b], "studio-image.png", { type: b.type || "image/png" }));
      S.assets.push(a); n++;
    }
  } catch (e) { log("pull: " + e.message); }
  if (n) { if (!S.binSel) S.binSel = S.assets[0].id; renderBin(); log("pulled " + n + " item(s) from the studios"); }
  else log("pull: nothing rendered yet — make a video or image first");
}

function renderRatios() {
  const row = $("edRatioRow");
  row.innerHTML = "";
  for (const r of Object.keys(RATIOS)) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = r;
    b.className = r === S.ratio ? "on" : "";
    b.onclick = () => {
      S.ratio = r;
      const cv = $("edCanvas");
      cv.width = RATIOS[r][0]; cv.height = RATIOS[r][1];
      renderRatios();
      log("ratio: " + r);
    };
    row.appendChild(b);
  }
}

function ppBinAsset() { return S.binSel ? assetById(S.binSel) : null; }
function ppSyncSide() {
  const c = selClip();
  const look = $("ppLookSel"), fl = $("ppFilterSel");
  if (c && look) look.value = c.grade || "none";
  if (c && fl) fl.value = c.filter || "none";
  const sv = $("ppStrengthVal");
  if (sv && c) sv.textContent = Number(c.gk || 1).toFixed(2);
  const ps = $("ppStrength");
  if (ps && c) ps.value = c.gk || 1;
  const av = $("ppAudioVol");
  if (av && c) av.value = c.vol;
}
function ppDrawSource() {
  const cv = $("ppSourceCanvas");
  if (!cv) return;
  const ctx = cv.getContext("2d");
  const a = ppBinAsset();
  const nm = $("ppSrcName");
  if (nm) nm.textContent = a ? a.name : "no clip";
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, cv.width, cv.height);
  if (!a) {
    ctx.fillStyle = "#666"; ctx.font = "13px sans-serif"; ctx.textAlign = "center";
    ctx.fillText("Select a bin clip", cv.width / 2, cv.height / 2);
    return;
  }
  if (a.kind === "image" && a.el) {
    const s = Math.max(cv.width / a.el.naturalWidth, cv.height / a.el.naturalHeight);
    const dw = a.el.naturalWidth * s, dh = a.el.naturalHeight * s;
    try { ctx.drawImage(a.el, (cv.width - dw) / 2, (cv.height - dh) / 2, dw, dh); } catch {}
  } else if (a.kind === "video") {
    const v = ppSrcVideo();
    if (v && v.readyState >= 2 && v.videoWidth) {
      const s = Math.max(cv.width / v.videoWidth, cv.height / v.videoHeight);
      const dw = v.videoWidth * s, dh = v.videoHeight * s;
      try { ctx.drawImage(v, (cv.width - dw) / 2, (cv.height - dh) / 2, dw, dh); } catch {}
    }
  } else {
    ctx.fillStyle = "#7fd0ff"; ctx.font = "13px sans-serif"; ctx.textAlign = "center";
    ctx.fillText("♪ " + a.name, cv.width / 2, cv.height / 2);
  }
  const tcel = $("ppSrcTc");
  if (tcel) {
    const v = ppSrcVideo();
    tcel.textContent = tc(v && isFinite(v.duration) ? (v.currentTime || 0) : 0);
  }
}
let _ppSrcUrl = "";
function ppSrcVideo() {
  const a = ppBinAsset();
  if (!a || a.kind !== "video") return null;
  let v = $("ppSrcVideoEl");
  if (!v) {
    v = document.createElement("video");
    v.id = "ppSrcVideoEl";
    v.className = "ed-hidden-media";
    v.muted = true; v.playsInline = true; v.preload = "auto"; v.loop = true;
    (document.getElementById("pageEditor") || document.body).appendChild(v);
  }
  if (_ppSrcUrl !== a.url) { _ppSrcUrl = a.url; v.src = a.url; }
  return v;
}
function ppSrcToggle() {
  const v = ppSrcVideo();
  const btn = $("ppSourcePlayBtn");
  if (!v) { ppDrawSource(); return; }
  if (v.paused) { v.play().catch(() => {}); if (btn) btn.textContent = "⏸"; }
  else { v.pause(); if (btn) btn.textContent = "▶"; }
}
function ppInsertSource() {
  const a = ppBinAsset();
  if (!a) { note("Pick a bin item first."); return; }
  if (a.kind === "audio") addClipAt("A1", a);
  else addClipAt("V1", a);
}
function addClipAt(track, asset) {
  S.binSel = asset.id;
  const v = ppSrcVideo();
  let t = S.t;
  if (v && isFinite(v.duration) && v.duration > 0 && asset.kind === "video") {
    const c = defaultClip(track, asset);
    c.start = t;
    c.in = clamp(v.currentTime || 0, 0, Math.max(0, asset.dur - 0.1));
    S.clips.push(c); S.sel = c.id;
    afterEdit(asset.name + " → " + track);
    return;
  }
  const c = defaultClip(track, asset);
  c.start = t;
  S.clips.push(c); S.sel = c.id;
  afterEdit(asset.name + " → " + track);
}
async function ppImportLibRecord(r, mod, insert) {
  let full = null;
  try { full = await mod.getHistory(r.key); } catch (e) { log("library: could not read that record"); return null; }
  if (full && full.locked) { log("library: locked — enter the vault passphrase in Settings"); return null; }
  const blob = full && full.video instanceof Blob ? full.video : null;
  const base = String(r.filename || r.runName || r.prompt || "library-clip").slice(0, 60) || "library-clip";
  let file = null;
  if (blob) {
    const ext = String(full.ext || r.ext || "").replace(/[^a-z0-9]/gi, "") || (String(blob.type || "").includes("png") ? "png" : String(blob.type || "").startsWith("image/") ? "jpg" : "mp4");
    file = new File([blob], base + "." + ext, { type: full.mime || r.mime || blob.type || "video/mp4" });
  }
  else if (typeof r.poster === "string" && r.poster.startsWith("data:")) {
    try {
      const res = await fetch(r.poster);
      const b2 = await res.blob();
      file = new File([b2], base + ".jpg", { type: b2.type || "image/jpeg" });
    } catch { log("library: nothing to import on that record"); return null; }
  } else { log("library: nothing to import on that record"); return null; }
  const a = await probeAsset(file);
  S.assets.push(a);
  S.binSel = a.id;
  renderBin(); ppDrawSource();
  log("library -> bin: " + a.name);
  if (insert) addClipAt(a.kind === "audio" ? "A1" : "V1", a);
  return a;
}
function ppKindOf(r) {
  const k = (r.kind || "").toLowerCase();
  if (k === "image" || k === "image-take") return "image";
  if (k.includes("audio")) return "audio";
  return "video";
}
async function ppRenderLibInto(listId, q, kindFilter, withInsert) {
  const list = $(listId);
  if (!list) return;
  list.innerHTML = "";
  const note = (m) => { list.innerHTML = '<div class="pp-note" style="padding:10px">' + m + "</div>"; };
  let mod = null, rows = [];
  try {
    mod = await import("./store.js");
    rows = await mod.listHistory();
  } catch (e) { note("Library unavailable: " + String((e && e.message) || e)); return; }
  rows = rows.filter((r) => {
    if (kindFilter && ppKindOf(r) !== kindFilter) return false;
    if (q && !((r.filename || "") + " " + (r.runName || "") + " " + (r.prompt || "") + " " + (r.providerLabel || "")).toLowerCase().includes(q)) return false;
    return true;
  });
  if (!rows.length) { note(listId === "ppMediaList" ? "No media in the built-in library - render something in Video / Image first, or Browse local files above." : "Library is empty - render something in Video / Image first."); return; }
  for (const r of rows.slice(0, 80)) {
    const d = document.createElement("div");
    d.className = "pp-libitem";
    const posterUrl = typeof r.poster === "string" && r.poster.startsWith("data:") ? r.poster : "";
    if (posterUrl) {
      const im = document.createElement("img");
      im.src = posterUrl;
      im.alt = "";
      im.loading = "lazy";
      im.onerror = () => { im.replaceWith(Object.assign(document.createElement("div"), { className: "pp-ph", textContent: ppKindOf(r) === "image" ? "◫" : ppKindOf(r) === "audio" ? "♪" : "▶" })); };
      d.appendChild(im);
    } else {
      const ph = document.createElement("div");
      ph.className = "pp-ph";
      ph.textContent = ppKindOf(r) === "image" ? "◫" : ppKindOf(r) === "audio" ? "♪" : "▶";
      d.appendChild(ph);
    }
    const meta = document.createElement("div");
    meta.className = "pp-libmeta";
    const b = document.createElement("b");
    b.textContent = ((r.filename || r.runName || r.prompt || r.key || "clip") + "").slice(0, 60);
    meta.appendChild(b);
    const s = document.createElement("span");
    s.className = "mono";
    const rdur = Number(r.actualDuration) > 0 ? Number(r.actualDuration) : Number(r.duration) || 0;
    s.textContent = ppKindOf(r) + (rdur ? " - " + rdur.toFixed(1) + "s" : "");
    meta.appendChild(s);
    d.appendChild(meta);
    const btns = document.createElement("span");
    btns.className = "pp-libbtns";
    const mkBtn = (label, title, fn) => {
      const btn = document.createElement("button");
      btn.className = "pp-btn";
      btn.type = "button";
      btn.textContent = label;
      btn.title = title;
      btn.onclick = async (e) => { e.stopPropagation(); btn.disabled = true; try { await fn(); } catch (err) { log("library: " + String((err && err.message) || err)); } finally { btn.disabled = false; } };
      btns.appendChild(btn);
    };
    mkBtn("Import", "Copy into the project bin", () => ppImportLibRecord(r, mod, false));
    if (withInsert) mkBtn("Insert", "Import and add to the timeline at the playhead", () => ppImportLibRecord(r, mod, true));
    d.appendChild(btns);
    d.title = "Double-click to " + (withInsert ? "import + insert on the timeline" : "import into the bin");
    d.ondblclick = () => ppImportLibRecord(r, mod, withInsert);
    list.appendChild(d);
  }
}
async function ppRefreshLibrary() {
  const q = (($("ppLibSearch") && $("ppLibSearch").value) || "").toLowerCase();
  const list = $("ppLibList");
  if (list) list.innerHTML = '<div class="pp-note" style="padding:10px">Loading library...</div>';
  await ppRenderLibInto("ppLibList", q, "", false);
}
async function ppRefreshMedia() {
  const q = (($("ppMediaSearch") && $("ppMediaSearch").value) || "").toLowerCase();
  const k = ($("ppMediaKind") && $("ppMediaKind").value) || "";
  const list = $("ppMediaList");
  if (list && !list.querySelector(".pp-libitem")) list.innerHTML = '<div class="pp-note" style="padding:10px">Loading media...</div>';
  await ppRenderLibInto("ppMediaList", q, k, true);
}
function ppSetView(id, view) {
  const el = $(id);
  if (!el) return;
  el.dataset.view = view;
  const bar = document.querySelector('[data-viewfor="' + id + '"]');
  if (bar) for (const b of bar.querySelectorAll("button")) b.classList.toggle("on", b.dataset.view === view);
  let head = el.parentElement ? el.parentElement.querySelector(".pp-details-head") : null;
  if (view === "details" && !head && id === "edBin") {
    head = document.createElement("div");
    head.className = "pp-details-head";
    head.innerHTML = "<span>Thumb</span><span>Name</span><span>Info</span><span>Dims</span>";
    el.before(head);
  }
  if (head) head.style.display = view === "details" ? "" : "none";
}
function ppWireViews() {
  document.querySelectorAll("[data-viewfor]").forEach((bar) => {
    const id = bar.getAttribute("data-viewfor");
    bar.querySelectorAll("button").forEach((b) => {
      b.onclick = () => ppSetView(id, b.getAttribute("data-view"));
    });
    const cur = $(id) ? $(id).dataset.view : null;
    bar.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.getAttribute("data-view") === cur));
  });
  const pairs = [["ppBinSize", "edBin"], ["ppLibSize", "ppLibList"], ["ppMediaSize", "ppMediaList"]];
  for (const [sid, cid] of pairs) {
    const s = $(sid);
    if (!s || s.dataset.wired) continue;
    s.dataset.wired = "1";
    s.oninput = () => {
      const c = $(cid);
      if (!c) return;
      c.style.setProperty("--pp-thumb", s.value + "px");
      if (c.dataset.view !== "grid") ppSetView(cid, "grid");
    };
  }
}

function ppSwitchWs(ws) {
  const root = document.querySelector(".pp-root");
  if (root) root.dataset.ws = ws;
  for (const b of document.querySelectorAll("#ppWsTabs button")) b.classList.toggle("on", b.dataset.ws === ws);
  const map = { color: "color", effects: "effects", audio: "audio", export: "export" };
  ppSwitchEc(map[ws] || "controls");
}
function ppSwitchEc(ec) {
  for (const b of document.querySelectorAll("#ppEcTabs button")) b.classList.toggle("on", b.dataset.ec === ec);
  for (const p of document.querySelectorAll("[data-ecpane]")) p.hidden = p.dataset.ecpane !== ec;
}
function ppBuildFx() {
  const grid = $("ppFxGrid");
  if (!grid || grid.dataset.built) return;
  grid.dataset.built = "1";
  const fx = [...FILTERS.map((f) => ({ kind: "filter", id: f[0], label: f[1] })), ...TRANSITIONS.filter((t) => t[0] !== "none").map((t) => ({ kind: "tr", id: t[0], label: "✦ " + t[1] }))];
  for (const f of fx) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = f.label;
    b.onclick = () => {
      const c = selClip();
      if (!c) { log("effects: select a timeline clip first"); return; }
      if (f.kind === "filter") c.filter = f.id;
      else { c.trIn = f.id; c.trOut = f.id; }
      renderInspector(); ppSyncSide();
      log("fx: " + f.label + " → " + c.name);
    };
    grid.appendChild(b);
  }
}
function ppStep(d) {
  setPlaying(false);
  S.t = clamp(S.t + d / 30, 0, Math.max(projectEnd(), 0.5));
  positionPlayhead(); updateTimeTag(); ppTickClocks(); draw();
}
function ppCloseMenus() {
  document.querySelectorAll(".pp-menu-pop").forEach((p) => p.remove());
  document.querySelectorAll(".pp-menus button").forEach((b) => b.setAttribute("aria-expanded", "false"));
}

function ppMenuItems(menu) {
  const click = (id) => $(id)?.click();
  const go = (ws) => ppSwitchWs(ws);
  switch (menu) {
    case "file":
      return [
        ["Import media…", () => $("edFileInput").click()],
        ["Pull from Studios", () => $("edPullBtn")?.click()],
        ["Download EDL (JSON)", () => downloadEdl()],
        ["—"],
        ["Export video…", () => { go("export"); $("edExportBtn")?.focus(); }],
        ["—"],
        ["Clear bin", () => $("edClearBinBtn")?.click()],
      ];
    case "edit":
      return [
        ["Split at playhead  (S)", () => splitAt(S.t)],
        ["Duplicate clip", () => duplicateSel()],
        ["Delete clip  (Del)", () => deleteSel()],
        ["—"],
        ["Merge selected", () => mergeSelected()],
        ["—"],
        ["Play / pause  (Space)", () => $("edPlayBtn")?.click()],
      ];
    case "clip":
      return [
        ["Insert source at playhead", () => ppInsertSource()],
        ["Add to V1", () => $("edAddV1Btn")?.click()],
        ["Add to V2", () => $("edAddV2Btn")?.click()],
        ["Add text clip", () => $("edAddTxtBtn")?.click()],
        ["—"],
        ["Speed: 0.5×", () => ppSetSelSpeed(0.5)],
        ["Speed: 1×", () => ppSetSelSpeed(1)],
        ["Speed: 2×", () => ppSetSelSpeed(2)],
      ];
    case "seq":
      return [
        ["Go to start", () => { S.t = 0; positionPlayhead(); updateTimeTag(); draw(); }],
        ["Fit sequence in view", () => $("ppFitBtn")?.click()],
        ["—"],
        ["Assembly workspace", () => go("assembly")],
        ["Editing workspace", () => go("editing")],
        ["Color workspace", () => go("color")],
        ["Effects workspace", () => go("effects")],
        ["Audio workspace", () => go("audio")],
        ["Export workspace", () => go("export")],
      ];
    case "marker":
      return [
        ["Playhead to start", () => { S.t = 0; positionPlayhead(); updateTimeTag(); draw(); }],
        ["Playhead to end", () => { S.t = Math.max(0, projectEnd() - 0.01); positionPlayhead(); updateTimeTag(); draw(); }],
        ["—"],
        ["Trim selected start here", () => $("edMarkInBtn")?.click()],
        ["Trim selected end here", () => $("edMarkOutBtn")?.click()],
      ];
    case "graphics":
      return [
        ["Add text clip", () => $("edAddTxtBtn")?.click()],
        ["AI edit agent…", () => $("edAgentBtn")?.click()],
      ];
    case "view":
      return [
        ["Zoom in (+)", () => $("edZoomInBtn")?.click()],
        ["Zoom out (−)", () => $("edZoomOutBtn")?.click()],
        ["Fit sequence", () => $("ppFitBtn")?.click()],
        ["—"],
        ["Bin: small icons", () => ppSetBinView("small")],
        ["Bin: medium icons", () => ppSetBinView("medium")],
        ["Bin: details list", () => ppSetBinView("details")],
        ["—"],
        ["Toggle density", () => ppToggleDensity()],
      ];
    case "window":
      return [
        ["Toggle project panel", () => ppTogglePanel("project")],
        ["Toggle source monitor", () => ppTogglePanel("source")],
        ["Toggle inspector", () => ppTogglePanel("inspector")],
        ["—"],
        ["Assembly", () => go("assembly")],
        ["Editing", () => go("editing")],
        ["Color", () => go("color")],
        ["Effects", () => go("effects")],
        ["Audio", () => go("audio")],
        ["Export", () => go("export")],
      ];
    case "help":
      return [
        ["Keyboard shortcuts", () => log("Space play · S split · Del delete · V/C/H/Z tools · Ctrl/Alt+wheel zoom · drag clip move · edges trim · double-click bin adds to V1.")],
        ["Editor settings…", () => ppOpenSettings()],
        ["—"],
        ["Open tutorial", () => document.querySelector('[data-goto="pageEditor"]')?.click?.() ?? log("See the Tutorial tab → 7 · Editor.")],
      ];
    default:
      return [];
  }
}

function ppToggleMenu(menu, btn) {
  const open = btn.getAttribute("aria-expanded") === "true";
  ppCloseMenus();
  if (open) return;
  const items = ppMenuItems(menu);
  if (!items.length) return;
  const pop = document.createElement("div");
  pop.className = "pp-menu-pop";
  pop.setAttribute("role", "menu");
  for (const it of items) {
    if (it[0] === "—") {
      const hr = document.createElement("div");
      hr.className = "pp-menu-sep";
      pop.appendChild(hr);
      continue;
    }
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = it[0];
    b.setAttribute("role", "menuitem");
    b.onclick = (e) => {
      e.stopPropagation();
      ppCloseMenus();
      try {
        it[1]();
      } catch (err) {
        log("menu: " + (err?.message || err));
      }
    };
    pop.appendChild(b);
  }
  const bar = btn.closest(".pp-menubar") || document.querySelector("#pageEditor .pp-root");
  (bar || document.body).appendChild(pop);
  const r = btn.getBoundingClientRect();
  const host = (bar || document.body).getBoundingClientRect();
  pop.style.left = Math.max(4, r.left - host.left) + "px";
  pop.style.top = (r.bottom - host.top + 4) + "px";
  btn.setAttribute("aria-expanded", "true");
}

function ppSetSelSpeed(v) {
  const c = selClip();
  if (!c) {
    log("clip: select a timeline clip first");
    return;
  }
  c.speed = v;
  renderInspector();
  draw();
  log("clip speed → " + v + "× (" + c.name + ")");
}

function ppSetBinView(view) {
  for (const sel of ["#edBin", "#ppMediaList", "#ppLibList"]) {
    const el = document.querySelector(sel);
    if (el) el.dataset.view = view;
  }
  document.querySelectorAll('.pp-viewbtns [data-view="' + view + '"]').forEach((b) => {
    for (const x of b.parentElement.children) x.classList.toggle("on", x === b);
  });
  log("view: bin icons → " + view);
}

function ppToggleDensity() {
  const root = document.querySelector("#pageEditor .pp-root");
  if (!root) return;
  const cur = root.dataset.density === "compact" ? "" : "compact";
  root.dataset.density = cur;
  try {
    localStorage.setItem("ppDensity", cur);
  } catch {}
  log("view: density → " + (cur || "comfortable"));
}

function ppTogglePanel(which) {
  const map = { project: ".pp-project", source: ".pp-source", inspector: ".pp-ec" };
  const el = document.querySelector("#pageEditor " + (map[which] || ".pp-project"));
  if (!el) return;
  el.hidden = !el.hidden;
  log("window: " + which + " panel " + (el.hidden ? "hidden" : "shown"));
}

function ppOpenSettings() {
  const root = document.querySelector("#pageEditor .pp-root");
  const cur = root?.dataset.density === "compact" ? "compact" : "comfortable";
  const lane = Number(root?.style.getPropertyValue("--pp-lane")) || 0;
  const density = prompt("Editor density (compact / comfortable):", cur);
  if (density && root) {
    root.dataset.density = density.trim() === "compact" ? "compact" : "";
    try {
      localStorage.setItem("ppDensity", root.dataset.density);
    } catch {}
  }
  const h = prompt("Timeline lane height in px (44–88, empty = keep):", lane ? String(lane) : "52");
  if (h && root) {
    const n = Math.min(88, Math.max(44, Number(h) || 52));
    root.style.setProperty("--pp-lane", n + "px");
    try {
      localStorage.setItem("ppLane", String(n));
    } catch {}
  }
  log("settings saved (density + lane height).");
}

function ppInit() {
  try {
    const root = document.querySelector("#pageEditor .pp-root");
    const d = localStorage.getItem("ppDensity");
    if (d === "compact" && root) root.dataset.density = "compact";
    const lane = Number(localStorage.getItem("ppLane"));
    if (lane >= 44 && lane <= 88 && root) root.style.setProperty("--pp-lane", lane + "px");
  } catch {}
  for (const b of document.querySelectorAll("#ppWsTabs button")) b.onclick = () => ppSwitchWs(b.dataset.ws);
  for (const b of document.querySelectorAll("#ppEcTabs button")) b.onclick = () => ppSwitchEc(b.dataset.ec);
  for (const b of document.querySelectorAll(".pp-project [data-ptab]")) {
    b.onclick = () => {
      for (const x of document.querySelectorAll(".pp-project [data-ptab]")) x.classList.toggle("on", x === b);
      for (const p of document.querySelectorAll(".pp-project [data-ppane]")) p.hidden = p.dataset.ppane !== b.dataset.ptab;
      if (b.dataset.ptab === "library") ppRefreshLibrary();
      if (b.dataset.ptab === "media") ppRefreshMedia();
    };
  }
  for (const b of document.querySelectorAll("#ppToolRow button")) {
    b.onclick = () => {
      S.tool = b.dataset.tool;
      for (const x of document.querySelectorAll("#ppToolRow button")) x.classList.toggle("on", x === b);
      const sc = ppScroll();
      if (sc) sc.style.cursor = S.tool === "hand" ? "grab" : S.tool === "zoom" ? "zoom-in" : S.tool === "razor" ? "crosshair" : "default";
    };
  }
  const snap = $("ppSnapBtn");
  if (snap) snap.onclick = () => { S.snap = !S.snap; snap.classList.toggle("on", S.snap); };
  const zr = $("ppZoomRange");
  if (zr) zr.oninput = () => setZoom(Number(zr.value), S.t);
  const fit = $("ppFitBtn");
  if (fit) fit.onclick = () => {
    const sc = ppScroll();
    const total = Math.max(projectEnd(), 10);
    if (sc && total > 0) setZoom(clamp((sc.clientWidth - 20) / total, 8, 400));
  };
  const imp = $("ppImportBtn");
  if (imp) imp.onclick = () => $("edFileInput").click();
  const brw = $("ppBrowseBtn");
  if (brw) brw.onclick = () => $("edFileInput").click();
  const ps = $("ppProjSearch");
  if (ps) ps.oninput = () => renderBin();
  for (const b of document.querySelectorAll(".pp-menus button")) {
    b.setAttribute("aria-haspopup", "true");
    b.setAttribute("aria-expanded", "false");
    b.onclick = (e) => {
      e.stopPropagation();
      ppToggleMenu(b.dataset.menu, b);
    };
  }
  document.addEventListener("click", (e) => {
    if (!e.target?.closest?.(".pp-menu-pop") && !e.target?.closest?.(".pp-menus button")) ppCloseMenus();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") ppCloseMenus();
  });
  const il = $("ppImportLibBtn");
  if (il) il.onclick = () => { document.querySelector('.pp-project [data-ptab=library]').click(); };
  const mr = $("ppMediaRefreshBtn");
  if (mr) mr.onclick = () => ppRefreshMedia();
  const ms = $("ppMediaSearch");
  if (ms) ms.oninput = () => ppRefreshMedia();
  const mk = $("ppMediaKind");
  if (mk) mk.onchange = () => ppRefreshMedia();
  const lr = $("ppLibRefreshBtn");
  if (lr) lr.onclick = () => ppRefreshLibrary();
  const ls = $("ppLibSearch");
  if (ls) ls.oninput = () => ppRefreshLibrary();
  const sp = $("ppSourcePlayBtn");
  if (sp) sp.onclick = ppSrcToggle;
  const si = $("ppSrcInsertBtn");
  if (si) si.onclick = ppInsertSource;
  const sIn = $("ppSrcInBtn");
  if (sIn) sIn.onclick = () => { const v = ppSrcVideo(); if (v) v.currentTime = 0; };
  const sOut = $("ppSrcOutBtn");
  if (sOut) sOut.onclick = () => { const v = ppSrcVideo(); if (v && isFinite(v.duration)) v.currentTime = Math.max(0, v.duration - 0.1); };
  const pv = $("ppPrevBtn");
  if (pv) pv.onclick = () => ppStep(-1);
  const nx = $("ppNextBtn");
  if (nx) nx.onclick = () => ppStep(1);
  const look = $("ppLookSel");
  if (look) {
    look.innerHTML = "";
    for (const g of GRADE_PRESETS) {
      const o = document.createElement("option");
      o.value = g.id; o.textContent = g.label[0].toUpperCase() + g.label.slice(1);
      look.appendChild(o);
    }
    look.onchange = () => { const c = selClip(); if (c) { c.grade = look.value; renderInspector(); } };
  }
  const fl = $("ppFilterSel");
  if (fl) {
    fl.innerHTML = "";
    for (const [v2, l2] of FILTERS) {
      const o = document.createElement("option");
      o.value = v2; o.textContent = l2;
      fl.appendChild(o);
    }
    fl.onchange = () => { const c = selClip(); if (c) { c.filter = fl.value; renderInspector(); } };
  }
  const pstr = $("ppStrength");
  if (pstr) pstr.oninput = () => {
    const c = selClip();
    if (c) { c.gk = Number(pstr.value); $("ppStrengthVal").textContent = c.gk.toFixed(2); renderInspector(); }
  };
  const av = $("ppAudioApply");
  if (av) av.onclick = () => {
    const c = selClip();
    if (!c) { log("audio: select an A1/A2 clip first"); return; }
    c.vol = clamp(Number($("ppAudioVol").value || 1), 0, 1);
    const f = clamp(Number($("ppAudioFade").value || 0), 0, 3);
    c.trIn = f > 0 ? "fade" : "none"; c.trOut = f > 0 ? "fade" : "none"; c.trDur = f;
    renderInspector();
    log("audio: vol " + c.vol + ", fade " + f + "s → " + c.name);
  };
  ppBuildFx();
  ppWireViews();
  bindRulerScrub();
  bindWheelZoom();
  const sc = ppScroll();
  if (sc && !sc.dataset.handbound) {
    sc.dataset.handbound = "1";
    let hand = null;
    sc.addEventListener("pointerdown", (e) => {
      if (S.tool !== "hand") return;
      hand = { x: e.clientX, y: e.clientY, sl: sc.scrollLeft, st: sc.scrollTop };
      sc.setPointerCapture(e.pointerId);
      const mv = (ev) => { sc.scrollLeft = hand.sl - (ev.clientX - hand.x); sc.scrollTop = hand.st - (ev.clientY - hand.y); };
      const up = () => { hand = null; sc.removeEventListener("pointermove", mv); sc.removeEventListener("pointerup", up); };
      sc.addEventListener("pointermove", mv);
      sc.addEventListener("pointerup", up);
    });
    sc.addEventListener("scroll", () => positionPlayhead(), { passive: true });
  }
  document.addEventListener("keydown", (e) => {
    const p = $("pageEditor");
    if (!p || p.hidden) return;
    const tag = (e.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return;
    if (e.key === "v" || e.key === "V") document.querySelector('#ppToolRow [data-tool=select]').click();
    else if (e.key === "c" || e.key === "C") document.querySelector('#ppToolRow [data-tool=razor]').click();
    else if (e.key === "h" || e.key === "H") document.querySelector('#ppToolRow [data-tool=hand]').click();
    else if (e.key === "z" || e.key === "Z") document.querySelector('#ppToolRow [data-tool=zoom]').click();
    else if (e.key === "ArrowLeft") ppStep(e.shiftKey ? -10 : -1);
    else if (e.key === "ArrowRight") ppStep(e.shiftKey ? 10 : 1);
  });
  ppTickClocks();
}

function bind() {
  if ($("edPlayBtn").dataset.bound) return;
  $("edPlayBtn").dataset.bound = "1";
  loadFonts();
  renderRatios();
  refreshEncoders();
  renderTimeline();
  renderInspector();
  const dz = $("edDrop"), fi = $("edFileInput");
  dz.onclick = () => fi.click();
  dz.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") fi.click(); };
  fi.onchange = () => { addFiles([...fi.files]); fi.value = ""; };
  dz.ondragover = (e) => e.preventDefault();
  dz.ondrop = (e) => { e.preventDefault(); addFiles([...(e.dataTransfer.files || [])]); };
  $("edPullBtn").onclick = pullFromStudios;
  $("edClearBinBtn").onclick = () => {
    for (const c of S.clips) stopClipMedia(c);
    for (const a of S.assets) try { URL.revokeObjectURL(a.url); } catch {}
    S.assets = []; S.clips = []; S.sel = null; S.binSel = null; S.t = 0;
    renderBin(); afterEdit("bin cleared");
  };
  $("edAddV1Btn").onclick = () => addClip("V1");
  $("edAddV2Btn").onclick = () => addClip("V2");
  $("edAddTxtBtn").onclick = () => addClip("TXT");
  $("edAddA1Btn").onclick = () => addClip("A1");
  $("edPlayBtn").onclick = () => { if (!S.clips.length) { log("nothing to play"); return; } setPlaying(!S.playing); };
  $("edStopBtn").onclick = () => { setPlaying(false); S.t = exportStart(); positionPlayhead(); updateTimeTag(); draw(); };
  $("edLoopBtn").onclick = () => { S.loop = !S.loop; $("edLoopBtn").textContent = "Loop: " + (S.loop ? "on" : "off"); };
  $("edSplitBtn").onclick = () => splitAt(S.t);
  $("edMergeBtn").onclick = mergeSelected;
  $("edMarkInBtn").onclick = () => trimSel("in");
  $("edMarkOutBtn").onclick = () => trimSel("out");
  $("edZoomInBtn").onclick = () => { S.zoom = clamp(S.zoom + 20, 10, 240); renderTimeline(); };
  $("edZoomOutBtn").onclick = () => { S.zoom = clamp(S.zoom - 20, 10, 240); renderTimeline(); };
  bindRulerScrub();
  bindWheelZoom();
  $("edRangeStartHere").onclick = () => { $("edRangeStart").value = S.t.toFixed(1); $("edFullToggle").checked = false; };
  $("edRangeEndHere").onclick = () => { $("edRangeEnd").value = S.t.toFixed(1); $("edFullToggle").checked = false; };
  $("edFormatSel").onchange = refreshEncoders;
  $("edQuality").oninput = () => { $("edQualityVal").textContent = Number($("edQuality").value).toFixed(2); };
  $("edExportBtn").onclick = startExport;
  $("edExportCancelBtn").onclick = () => { S.cancelExport = true; };
  $("edEdlBtn").onclick = downloadEdl;
  document.addEventListener("keydown", (e) => {
    const p = $("pageEditor");
    if (!p || p.hidden) return;
    const tag = (e.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return;
    if (e.code === "Space") { e.preventDefault(); $("edPlayBtn").click(); }
    else if (e.key === "s" || e.key === "S") splitAt(S.t);
    else if (e.key === "Delete" || e.key === "Backspace") deleteSel();
  });
  try { bindInspector(); } catch (e) { log("inspector: " + e.message); }
  if (!S.ppInit) { S.ppInit = true; try { ppInit(); } catch (e) { log("pp init: " + e.message); } }
  try { ppSyncSide(); ppDrawSource(); } catch {}
  S.raf = requestAnimationFrame(tick);
  log("editor loaded — device render, server render, EDL");
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind, { once: true });
else bind();

export const editorAPI = { state: S, selClip, clipById, trackClips, defaultClip, addClip, splitAt, trimSel, mergeSelected, afterEdit, renderTimeline, renderInspector };
export { FILTERS, TRANSITIONS };
