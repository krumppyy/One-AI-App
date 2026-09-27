import { LIB_CATS, SAVABLE_CATS, saveBlobToLibrary, slugName } from "./library-save.js";
import { poolStatus } from "./store.js";
const $ = (id) => document.getElementById(id);
const RATIOS = [
  { id: "1:1", r: 1, hint: "1:1 Square · feed post", social: "Instagram post" },
  { id: "4:5", r: 4 / 5, hint: "4:5 Portrait · Instagram portrait post", social: "Instagram" },
  { id: "9:16", r: 9 / 16, hint: "9:16 Vertical · Reels / TikTok / Shorts / Story", social: "Reels · TikTok · Shorts" },
  { id: "16:9", r: 16 / 9, hint: "16:9 Widescreen · YouTube landscape", social: "YouTube" },
  { id: "21:9", r: 21 / 9, hint: "21:9 Ultrawide · cinematic banner", social: "Cinematic" },
  { id: "4:3", r: 4 / 3, hint: "4:3 Standard · presentations", social: "Slides" },
  { id: "3:4", r: 3 / 4, hint: "3:4 Portrait · Pinterest pin", social: "Pinterest" },
  { id: "3:2", r: 3 / 2, hint: "3:2 Classic photo landscape", social: "Photo" },
  { id: "2:3", r: 2 / 3, hint: "2:3 Classic photo portrait", social: "Photo" },
  { id: "9:21", r: 9 / 21, hint: "9:21 Tall cover · phone wallpaper", social: "Wallpaper" },
];
const VIEWS = [["small", "S"], ["medium", "M"], ["large", "L"], ["xl", "XL"], ["grid", "Grid"], ["list", "List"]];
const CATS = ["Story", "Anime", "Cinematic", "Kids", "Ads", "Music", "Horror", "Comedy", "Education", "Other"];
const VID_FMTS = [["webm", "WEBM"], ["mp4", "MP4"], ["mov", "MOV"], ["mkv", "MKV"], ["gif", "GIF"]];
let S = { name: "My Story", cat: "Story", libCat: "storyboard", ratio: "16:9", view: "medium", trans: "cut", frames: [], sel: new Set(), compiling: false, cast: [], scenes: [], ward: [] };
let n = 0;
const ratioOf = () => RATIOS.find((x) => x.id === S.ratio) || RATIOS[3];
function toast(m) { const t = $("sbToast"); if (!t) return; t.textContent = m; t.hidden = false; clearTimeout(t._h); t._h = setTimeout(() => t.hidden = true, 2600); }
function dataUrlToBlob(u) { const [h, d] = u.split(","); const m = (h.match(/data:(.*?);/) || [])[1] || "image/png"; const b = atob(d); const a = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return new Blob([a], { type: m }); }
async function blobToDataUrl(b) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(b); }); }
async function blobToImg(b) { const u = URL.createObjectURL(b); const im = new Image(); await new Promise((res, rej) => { im.onload = res; im.onerror = rej; im.src = u; }); return { im, u }; }
function micInto(el) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { toast("Mic not supported here — typed prompt works."); return; }
  try {
    const r = new SR(); r.lang = navigator.language || "en-US"; r.interimResults = false;
    toast("Listening… speak now");
    r.onresult = (e) => { const t = e.results[0][0].transcript; el.value = (el.value ? el.value + " " : "") + t; el.dispatchEvent(new Event("input", { bubbles: true })); };
    r.onerror = () => toast("Mic blocked or silent.");
    r.start();
  } catch { toast("Mic failed."); }
}
async function aiImage(prompt, ratio, opts = {}) {
  const full = prompt + ", " + ratio.id + " aspect, high detail, cinematic";
  const res = ratio.r > 1.05 ? "768x512" : ratio.r < 0.95 ? "512x768" : "512x512";
  const neg = opts.negativePrompt || "deformed face, distorted face, asymmetric eyes, blurry face, face morph, warped body, extra limbs, missing limbs, fused limbs, deformed hands, malformed hands, extra fingers, fused fingers, deformed feet, extra toes, deform nails, extra head, warped architecture, watermark, text, logo, blurry, low quality";
  try {
    const out = await root.generateImage({ prompt: full, resolution: res, seed: opts.seed ?? -1, negativePrompt: neg });
    const url = out?.dataUrl || out?.url || out?.src || String(out || "");
    if (out?.blob) {
      return { blob: out.blob, url: url || URL.createObjectURL(out.blob), seed: out.seed ?? out?.inputs?.seed };
    }
    if (url?.startsWith?.("data:") || url?.startsWith?.("http") || url?.startsWith?.("blob:")) {
      const blob = url.startsWith("data:") ? dataUrlToBlob(url) : await (await fetch(url)).blob();
      return { blob, url, seed: out?.seed ?? out?.inputs?.seed };
    }
  } catch (e) { console.warn("perchance gen failed", e); }
  const q = encodeURIComponent(full.slice(0, 400));
  const w = ratio.id === "9:16" ? 576 : 768, h = ratio.id === "9:16" ? 1024 : 432;
  const fb = `https://image.pollinations.ai/prompt/${q}?width=${w}&height=${h}&nologo=true`;
  return { blob: await (await fetch(fb)).blob(), url: fb };
}
async function enhance(p) {
  try {
    let out = "";
    await root.generateText({ instruction: "Rewrite as one rich image prompt (subject, action, camera, light, style, detail). Keep under 60 words:\n" + p, onChunk: (d) => out += d.textChunk || "" });
    return out.trim() || p;
  } catch { return p; }
}
async function storyBeats(idea, count) {
  try {
    let out = "";
    await root.generateText({ instruction: "Split this story idea into " + count + " numbered visual scenes. One vivid sentence each, no preamble:\n" + idea, onChunk: (d) => out += d.textChunk || "" });
    const lines = out.split(/\n+/).map((s) => s.replace(/^\d+[\).:\-]\s*/, "").trim()).filter(Boolean);
    if (lines.length) return lines.slice(0, count);
  } catch {}
  return Array.from({ length: count }, (_, i) => idea + " — scene " + (i + 1) + ", cinematic light, expressive");
}
function speak(t) { try { speechSynthesis.cancel(); speechSynthesis.speak(new Object.assign(new SpeechSynthesisUtterance(t), { rate: 1 })); } catch {} }
function sceneLines() {
  const lines = S.frames.map((f) => String(f.prompt || "").trim()).filter(Boolean);
  if (lines.length) return lines;
  const idea = $("sbIdeaInput")?.value.trim();
  return [idea || S.name || "My story"];
}
function deliverScript(lines) {
  const script = lines.map((l, i) => lines.length > 1 ? "Scene " + (i + 1) + ". " + l : l).join("\n\n");
  const box = document.getElementById("voiceTextInput");
  if (!box) { toast("Voice tab is not ready."); return false; }
  box.value = script;
  box.dispatchEvent(new Event("input", { bubbles: true }));
  document.querySelector('[data-page="pageVoice"]')?.click();
  toast("Sent " + lines.length + " scene" + (lines.length > 1 ? "s" : "") + " to Voice — Generate voice, export WAV/MP3.");
  return true;
}
function sendToVoice() {
  if (!S.frames.length) { toast("Generate frames first."); return; }
  deliverScript(sceneLines());
}
async function narrateToVoice() {
  if (!S.frames.length) { toast("Generate frames first."); return; }
  const lines = sceneLines();
  const btn = $("sbNarrateBtn");
  const prev = btn ? btn.textContent : "";
  if (btn) { btn.disabled = true; btn.textContent = "✨ Writing…"; }
  try {
    let out = "";
    await root.generateText({ instruction: "Rewrite each line below as one spoken narration sentence for a voiceover (present tense, no camera jargon, no preamble, keep the same order and count):\n" + lines.map((l, i) => (i + 1) + ". " + l).join("\n"), onChunk: (d) => out += d.textChunk || "" });
    const made = out.split(/\n+/).map((s) => s.replace(/^\d+[\).:\-]\s*/, "").trim()).filter(Boolean);
    deliverScript(made.length ? made.slice(0, lines.length) : lines);
  } catch { deliverScript(lines); }
  finally { if (btn) { btn.disabled = false; btn.textContent = prev || "✨ Narrate"; } }
}
function frameCard(f, i) {
  const d = document.createElement("div");
  d.className = "sb-card" + (S.sel.has(f.id) ? " sel" : "");
  d.draggable = true; d.dataset.id = f.id;
  d.innerHTML = '<span class="sb-num">#' + (i + 1) + '</span><img alt=""><div class="sb-cap"></div><div class="sb-time"><span class="mono tiny">sec</span></div><div class="sb-tools"></div>';
  const _im = d.querySelector("img"); _im.src = f.url; _im.loading = "lazy"; _im.decoding = "async";
  d.querySelector(".sb-cap").textContent = ((f.name ? f.name + " — " : "") + (f.prompt || "")).slice(0, 110);
  const tw = d.querySelector(".sb-time");
  const dur = document.createElement("input");
  dur.type = "number"; dur.className = "mono"; dur.min = "0.3"; dur.max = "5"; dur.step = "0.1";
  dur.value = (+f.dur || 0).toFixed ? String(+f.dur > 0 ? +f.dur : (+$("sbSecsInput")?.value || 1.5)) : "1.5";
  dur.title = "Seconds this scene stays on screen";
  dur.style.width = "56px";
  dur.onclick = (e) => e.stopPropagation();
  dur.onchange = () => { f.dur = Math.max(0.3, Math.min(5, +dur.value || 1.5)); f.saved = false; queuePersist(); autoSaveLibrary(); };
  tw.appendChild(dur);
  const t = d.querySelector(".sb-tools");
  const mk = (label, title, fn) => { const b = document.createElement("button"); b.type = "button"; b.className = "btn btn-tiny"; b.textContent = label; b.title = title; b.onclick = (e) => { e.stopPropagation(); fn(); }; t.appendChild(b); };
  mk("2×", "Upscale 2x", () => scaleFrame(f.id, 2));
  mk("½", "Downscale half", () => scaleFrame(f.id, 0.5));
  mk("Name", "Rename this frame (name · character · scene)", () => renameFrame(f.id));
  mk("Send", "Send image anywhere in the app", () => sendMenu(f));
  mk("Speak", "Speak this scene", () => speak(f.prompt || S.name));
  mk("×", "Remove (also deletes its Library copy)", async () => {
    const id = f.id, name = S.name;
    S.frames = S.frames.filter((x) => x.id !== id);
    render();
    try {
      const { listHistory, deleteHistory } = await import("./store.js");
      const rows = await listHistory().catch(() => []);
      for (const r of rows) {
        if (r?.tab !== "storyboard" || storyOf(r) !== name) continue;
        if (!String(r.filename || "").includes(id)) continue;
        try { await deleteHistory(r.key); } catch {}
      }
    } catch {}
  });
  d.onclick = () => { S.sel.has(f.id) ? S.sel.delete(f.id) : S.sel.add(f.id); render(); preview(); };
  d.ondragstart = (e) => e.dataTransfer.setData("text/sbid", f.id);
  d.ondragover = (e) => e.preventDefault();
  d.ondrop = (e) => {
    e.preventDefault();
    const id = e.dataTransfer.getData("text/sbid");
    if (!id || id === f.id) return;
    const a = S.frames.findIndex((x) => x.id === id), b = S.frames.findIndex((x) => x.id === f.id);
    const [m] = S.frames.splice(a, 1); S.frames.splice(b, 0, m); render();
  };
  return d;
}
function render() {
  const b = $("sbBoard"); if (!b) return;
  b.dataset.view = S.view; b.innerHTML = "";
  S.frames.forEach((f, i) => b.appendChild(frameCard(f, i)));
  $("sbCount").textContent = S.frames.length + " frames";
  $("sbNameInput").value = S.name;
  renderRefs();
  preview();
  queuePersist();
  window.V4Resume?.save?.({ tab: "pageStoryboard", story: S.name, sb: snapshot() });
}
function preview() {
  const v = $("sbViewer"); if (!v) return;
  const r = ratioOf();
  v.style.aspectRatio = String(r.r).slice(0, 8);
  v.innerHTML = "";
  const show = S.frames.filter((f) => S.sel.has(f.id));
  (show.length ? show : S.frames.slice(0, 1)).forEach((f) => {
    const im = document.createElement("img"); im.src = f.url; im.title = f.prompt || ""; v.appendChild(im);
  });
  if (!S.frames.length) v.innerHTML = '<div class="screen-ph"><div class="reel" aria-hidden="true"><span></span><span></span><span></span><span></span><span></span></div><strong>Story viewer</strong><p>Live preview — honors the ratio above.</p></div>';
}
function refSnap(list) { return (list || []).filter((r) => r && r.url).map((r) => ({ name: r.name || "", url: r.url, seed: r.seed || "" })); }
function snapshot() { return { name: S.name, cat: S.cat, libCat: libCatOf(), ratio: S.ratio, view: S.view, trans: S.trans, cast: refSnap(S.cast), scenes: refSnap(S.scenes), ward: refSnap(S.ward), frames: S.frames.map((f) => ({ id: f.id, prompt: f.prompt, url: f.url, dur: +f.dur || 0, name: f.name || "", character: f.character || "", scene: f.scene || "" })) }; }
function libCatOf() { return SAVABLE_CATS.includes(S.libCat) ? S.libCat : "storyboard"; }
async function renameFrame(id) {
  const f = S.frames.find((x) => x.id === id);
  if (!f) return;
  const nm = prompt("Frame name:", f.name || "");
  if (nm == null) return;
  const ch = prompt("Character (optional):", f.character || "");
  if (ch == null) return;
  const sc = prompt("Scene (optional):", f.scene || "");
  if (sc == null) return;
  f.name = nm.trim().slice(0, 80); f.character = ch.trim().slice(0, 80); f.scene = sc.trim().slice(0, 80);
  f.saved = false;
  render();
  autoSaveLibrary();
  toast(f.name ? `“${f.name}” saved` : "Frame renamed");
}
async function refRestore(list) {
  const out = [];
  for (const r of list || []) {
    if (!r || !r.url) continue;
    try {
      const blob = String(r.url).startsWith("data:") ? dataUrlToBlob(r.url) : await (await fetch(r.url)).blob();
      if (!blob.size) continue;
      out.push({ id: "r" + (++n) + Date.now().toString(36), name: String(r.name || "").slice(0, 40), seed: String(r.seed || "").slice(0, 12), blob, url: r.url });
    } catch {}
  }
  return out;
}
const REF_KINDS = ["cast", "scene", "ward"];
function refArr(kind) { return kind === "cast" ? S.cast : kind === "scene" ? S.scenes : S.ward; }
function refDefault(kind, i) { return (kind === "cast" ? "Character " : kind === "scene" ? "Scene " : "Outfit ") + (i + 1); }
function refListId(kind) { return kind === "cast" ? "sbCastList" : kind === "scene" ? "sbSceneList" : "sbWardList"; }
function refLbId(kind) { return kind === "cast" ? "sbCastLb" : kind === "scene" ? "sbSceneLb" : "sbWardLb"; }
async function fileToRef(file) {
  try {
    const bit = await createImageBitmap(file);
    const k = Math.min(1, 640 / Math.max(bit.width, bit.height));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(bit.width * k)); c.height = Math.max(1, Math.round(bit.height * k));
    c.getContext("2d").drawImage(bit, 0, 0, c.width, c.height);
    if (bit.close) bit.close();
    const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.88)) || file;
    return { blob, url: await blobToDataUrl(blob) };
  } catch { return { blob: file, url: await blobToDataUrl(file) }; }
}
function addRefFrame(item, kind) {
  if (!item || !item.blob) { toast("Import a picture for this slot first."); return; }
  const label = item.name || "reference";
  const prompt = kind === "ward" ? label + " outfit reference, garment flat detail, high detail"
    : kind === "scene" ? label + " — establishing shot, cinematic light, high detail"
    : label + " — character portrait, cinematic light, high detail";
  S.frames.push({ id: "f" + (++n) + Date.now().toString(36), prompt, blob: item.blob, dur: Math.max(0.3, +$("sbSecsInput")?.value || 1.5), url: item.url });
  render(); autoSaveLibrary();
  toast("“" + label + "” joined the board");
}
async function importRef(item, kind, anchor) {
  const { chooseImportSource, pickLibraryMedia } = await import("./lib-picker.js");
  const src = await chooseImportSource(anchor);
  if (src === "library") {
    const items = await pickLibraryMedia({ accept: "image", multi: false, title: "Pick a " + (kind === "ward" ? "outfit" : kind) });
    if (items && items[0] && items[0].blob instanceof Blob && items[0].blob.size) {
      const conv = await fileToRef(new File([items[0].blob], items[0].name || "library.jpg", { type: items[0].blob.type || "image/jpeg" }));
      item.blob = conv.blob; item.url = conv.url;
      renderRefs(); queuePersist();
      toast("Imported into “" + (item.name || "slot") + "”");
    }
  } else if (src === "computer") {
    const pick = document.createElement("input");
    pick.type = "file"; pick.accept = "image/*"; pick.hidden = true;
    document.body.appendChild(pick);
    pick.onchange = async () => {
      const f = (pick.files || [])[0];
      pick.remove();
      if (!f) return;
      const conv = await fileToRef(f);
      item.blob = conv.blob; item.url = conv.url;
      renderRefs(); queuePersist();
      toast("Imported into “" + (item.name || "slot") + "”");
    };
    pick.click();
  }
}
function refRow(kind, item, i) {
  const d = document.createElement("div");
  d.className = "sb-ref";
  const th = document.createElement("button");
  th.type = "button"; th.className = "sb-thumb";
  th.title = item.url ? "Replace picture" : "Import picture";
  if (item.url) { const im = document.createElement("img"); im.src = item.url; im.alt = item.name || refDefault(kind, i); th.appendChild(im); }
  else th.textContent = "+";
  th.onclick = () => importRef(item, kind, th);
  const nm = document.createElement("input");
  nm.className = "sb-refname"; nm.value = item.name || "";
  nm.placeholder = refDefault(kind, i); nm.maxLength = 40;
  nm.setAttribute("aria-label", "Rename " + refDefault(kind, i));
  nm.oninput = () => { item.name = nm.value.trim().slice(0, 40); queuePersist(); syncSaveSel(); };
  let sd = null;
  if (kind === "cast") {
    sd = document.createElement("input");
    sd.className = "mono tiny"; sd.value = item.seed ?? "";
    sd.placeholder = "seed"; sd.maxLength = 12; sd.style.width = "76px";
    sd.title = "Seed lock — same seed + same words ≈ same face. Copied from the designer generate, or typed by hand.";
    sd.setAttribute("aria-label", "Seed lock for " + (item.name || refDefault(kind, i)));
    sd.oninput = () => { const v = sd.value.trim().slice(0, 12); item.seed = /^-?\d+$/.test(v) ? v : ""; queuePersist(); };
  }
  const mk = (label, title, fn) => { const b = document.createElement("button"); b.type = "button"; b.className = "btn btn-tiny"; b.textContent = label; b.title = title; b.onclick = fn; d.appendChild(b); return b; };
  d.append(th, nm);
  if (sd) d.append(sd);
  if (kind === "ward") mk("Use", "Write this outfit into the image prompt", () => {
    const box = $("sbPromptInput");
    const tag = "wearing " + (item.name || "this outfit");
    box.value = (box.value ? box.value.replace(/\s+$/, "") + ", " : "") + tag;
    box.dispatchEvent(new Event("input", { bubbles: true }));
    toast("Outfit written into the prompt");
  });
  mk("Frame", "Add this as a storyboard frame", () => addRefFrame(item, kind));
  const x = document.createElement("button");
  x.type = "button"; x.className = "btn btn-tiny"; x.textContent = "×"; x.title = "Remove this slot";
  x.onclick = () => { refArr(kind).splice(i, 1); renderRefs(); queuePersist(); };
  d.appendChild(x);
  return d;
}
function renderRefs() {
  for (const kind of REF_KINDS) {
    const host = $(refListId(kind));
    if (host) {
      host.innerHTML = "";
      refArr(kind).forEach((item, i) => host.appendChild(refRow(kind, item, i)));
    }
    const lb = $(refLbId(kind));
    if (lb) { const c = refArr(kind).length; lb.textContent = c ? "· " + c : ""; }
  }
  syncSaveSel();
}
const DESIGNER = {
  gender: ["woman", "man", "androgynous adult"],
  age: ["young adult", "adult", "middle-aged", "elderly"],
  build: ["slim", "athletic", "curvy", "muscular", "plus-size", "petite"],
  hair: ["long black hair", "short brown hair", "blonde bob", "red curls", "grey bun", "braided dark hair", "messy auburn hair", "shaved head"],
  outfit: ["casual jeans and tee", "summer dress", "business suit", "hoodie and sneakers", "leather jacket", "lab coat", "sportswear", "evening gown", "fantasy armor"],
  style: ["cinematic photoreal", "anime", "3D render", "oil painting", "comic book", "watercolor"],
  expr: ["neutral", "smiling", "determined", "laughing", "surprised", "pensive"]
};
function designPrompt() {
  const v = (id) => $(id)?.value || "";
  return "full-body character portrait of a " + v("sbDAge") + " " + v("sbDGender") + " with a " + v("sbDBuild") + " build, " + v("sbDHair") + ", wearing " + v("sbDOutfit") + ", " + v("sbDExpr") + " expression, " + v("sbDStyle") + " style, high detail";
}
function syncDesignerOut() { const o = $("sbDOut"); if (o) o.textContent = designPrompt(); }
function syncSaveSel() {
  const sel = $("sbDSaveSel");
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = "";
  const o0 = document.createElement("option");
  o0.value = ""; o0.textContent = "Board only";
  sel.appendChild(o0);
  S.cast.forEach((c, i) => {
    const o = document.createElement("option");
    o.value = String(i); o.textContent = c.name || ("Character " + (i + 1));
    sel.appendChild(o);
  });
  sel.value = [...sel.options].some((o) => o.value === cur) ? cur : "";
}
const PKEY = "sb_projects_v1";
let persistT = null, projBooted = false;
function pkv() { try { return root.kv.sb_projects; } catch { return null; } }
function lsProjects() { try { return JSON.parse(localStorage.getItem(PKEY) || "{}"); } catch { return {}; } }
function lsSaveAll(m) { try { localStorage.setItem(PKEY, JSON.stringify(m)); } catch {} }
function storyOf(r) {
  if (!r) return "";
  if (r.story) return String(r.story);
  const p = String(r.prompt || "");
  if (/compiled video$/.test(p)) return p.replace(/ compiled video$/, "");
  const fn = String(r.filename || r.runName || "");
  const base = fn.replace(/\.[a-z0-9]+$/i, "").replace(/-f\d+[a-z0-9]*$/i, "");
  return base.replace(/-/g, " ").trim() || "(untitled)";
}
async function loadProjects() {
  const map = lsProjects();
  try {
    const k = pkv();
    if (k) for (const [name, proj] of await k.entries()) if (proj?.name) map[proj.name] = proj;
  } catch {}
  return map;
}
async function persistCurrent() {
  if (!S.frames.length && !projBooted) return;
  const snap = Object.assign(snapshot(), { ts: Date.now() });
  const map = lsProjects(); map[S.name] = snap; lsSaveAll(map);
  try { await pkv()?.set("p_" + snap.ts.toString(36), snap); } catch {}
  try { await pkv()?.set("byname_" + S.name.toLowerCase().replace(/[^\w\-]+/g, "-").slice(0, 60), snap); } catch {}
  try { await purgeKvSnapshots(S.name, snap.ts); } catch {}
}

/** Delete every timestamped kv snapshot of a story except the just-written one,
 *  so stale snapshots can never resurrect a deleted project via loadProjects. */
async function purgeKvSnapshots(name, keepTs = 0) {
  const k = pkv();
  if (!k || !k.entries) return;
  for (const [key, proj] of await k.entries()) {
    if (!key.startsWith("p_") || proj?.name !== name) continue;
    if (keepTs && proj?.ts === keepTs) continue;
    try { await k.delete(key); } catch {}
  }
}

/** Delete a story's Library frame rows (compiled videos are kept unless asked).
 *  Returns how many rows were removed. */
async function deleteLibraryStory(name, { keepCompiled = true } = {}) {
  const { listHistory, deleteHistory } = await import("./store.js");
  const rows = await listHistory().catch(() => []);
  let n = 0;
  for (const r of rows) {
    if (r?.tab !== "storyboard") continue;
    if (storyOf(r) !== name) continue;
    if (keepCompiled && /compiled video$/.test(String(r.prompt || ""))) continue;
    try { await deleteHistory(r.key); n++; } catch {}
  }
  return n;
}
function queuePersist() {
  refreshProjectSel();
  clearTimeout(persistT);
  persistT = setTimeout(persistCurrent, 1200);
}
function refreshProjectSel() {
  const sel = $("sbProjectSel");
  if (!sel) return;
  const map = lsProjects();
  const names = [...new Set([S.name, ...Object.keys(map)])].filter(Boolean).sort((a, b) => a.localeCompare(b));
  const cur = sel.value;
  sel.innerHTML = "";
  for (const name of names) {
    const o = document.createElement("option");
    const cnt = name === S.name ? S.frames.length : (map[name]?.frames?.length ?? 0);
    o.value = name; o.textContent = name + " (" + cnt + ")";
    sel.appendChild(o);
  }
  sel.value = names.includes(S.name) ? S.name : (names[0] || "");
  if (cur && ![...sel.options].some((o) => o.value === cur) && cur !== S.name) queueImportRefresh();
}
let importT = null;
function queueImportRefresh() { clearTimeout(importT); importT = setTimeout(mergeLibraryStories, 800); }
async function mergeLibraryStories() {
  let rows = [];
  try { rows = await (await import("./store.js")).listHistory(); } catch { return; }
  const sb = rows.filter((r) => r?.tab === "storyboard" && /^storyboard/i.test(String(r.provider || "")));
  if (!sb.length) return;
  const groups = {};
  for (const r of sb) { const s = storyOf(r); (groups[s] = groups[s] || []).push(r); }
  const map = lsProjects();
  let changed = false;
  for (const [name, items] of Object.entries(groups)) {
    if (map[name]?.frames?.length) continue;
    const frames = items.filter((r) => !/compiled video$/.test(String(r.prompt || ""))).slice(0, 60);
    if (!frames.length) continue;
    map[name] = { name, cat: frames[0].cat || "Story", ratio: frames[0].aspect || S.ratio, view: S.view, ts: Date.now(), libraryOnly: true, frames: frames.map((r) => ({ id: r.id, prompt: r.prompt || "", url: r.poster || "" })) };
    changed = true;
  }
  if (changed) { lsSaveAll(map); refreshProjectSel(); }
}
async function switchProject(name) {
  if (!name) return;
  if (name === S.name && S.frames.length) { refreshProjectSel(); return; }
  if (S.frames.length) await persistCurrent().catch(() => {});
  const map = await loadProjects();
  let proj = map[name];
  if (!proj?.frames?.length || proj.libraryOnly) {
    try {
      const { listHistory, getHistory } = await import("./store.js");
      const rows = await listHistory();
      const items = rows.filter((r) => r?.tab === "storyboard" && storyOf(r) === name && !/compiled video$/.test(String(r.prompt || "")));
      if (items.length) {
        const frames = [];
        for (const r of items.slice(0, 60)) {
          try {
            const full = await getHistory(r.key);
            const blob = full?.video;
            if (!blob?.size) continue;
            frames.push({ id: r.key, prompt: full.prompt || r.prompt || "", blob, url: full.poster?.startsWith?.("data:") ? full.poster : await blobToDataUrl(blob), name: full.name || r.name || "", character: full.character || r.character || "", scene: full.scene || r.scene || "" });
          } catch {}
        }
        if (frames.length) {
          proj = { name, cat: proj?.cat || items[0].cat || "Story", libCat: proj?.libCat || items[0].userCat || "storyboard", ratio: proj?.ratio || items[0].aspect || S.ratio, view: S.view, ts: Date.now(), frames: frames.map((f) => ({ id: f.id, prompt: f.prompt, url: f.url })) };
          const keep = frames;
          S.name = name; S.cat = proj.cat; S.libCat = proj.libCat || S.libCat; S.ratio = proj.ratio; S.frames = keep; S.sel.clear();
          S.cast = []; S.scenes = []; S.ward = [];
          syncControls(); render(); await persistCurrent();
          toast("“" + name + "” restored (" + keep.length + " frames)");
          return;
        }
      }
    } catch (e) { console.warn("switch from library failed", e); }
  }
  if (proj) {
    S.name = proj.name || name; S.cat = proj.cat || S.cat; S.libCat = proj.libCat || S.libCat; S.ratio = proj.ratio || S.ratio; S.view = proj.view || S.view; S.trans = proj.trans || S.trans || "cut";
    S.cast = await refRestore(proj.cast); S.scenes = await refRestore(proj.scenes); S.ward = await refRestore(proj.ward);
    S.frames = []; S.sel.clear();
    for (const f of proj.frames || []) {
      try {
        const blob = f.url?.startsWith?.("data:") ? dataUrlToBlob(f.url) : await (await fetch(f.url)).blob();
        S.frames.push({ id: f.id || ("f" + (++n)), prompt: f.prompt || "", blob, url: f.url, dur: +f.dur || 0, name: f.name || "", character: f.character || "", scene: f.scene || "" });
      } catch {}
    }
    syncControls(); render(); await persistCurrent();
    toast(proj.frames?.length ? "“" + S.name + "” restored" : "Switched to “" + S.name + "”");
  } else refreshProjectSel();
}
async function restore(sb) {
  if (!sb) return;
  S.name = sb.name || S.name; S.cat = sb.cat || S.cat; S.libCat = sb.libCat || S.libCat; S.ratio = sb.ratio || S.ratio; S.view = sb.view || S.view; S.trans = sb.trans || S.trans || "cut";
  S.cast = await refRestore(sb.cast); S.scenes = await refRestore(sb.scenes); S.ward = await refRestore(sb.ward);
  S.frames = [];
  for (const f of sb.frames || []) {
    try {
      const blob = f.url.startsWith("data:") ? dataUrlToBlob(f.url) : await (await fetch(f.url)).blob();
      S.frames.push({ id: f.id || ("f" + (++n)), prompt: f.prompt || "", blob, url: f.url, dur: +f.dur || 0, name: f.name || "", character: f.character || "", scene: f.scene || "" });
    } catch {}
  }
  syncControls(); render();
}
function syncControls() {
  $("sbNameInput").value = S.name; $("sbCatSel").value = S.cat;
  const lc = $("sbLibCatSel");
  if (lc) lc.value = libCatOf();
  const ts = $("sbTransSel");
  if (ts) ts.value = S.trans || "cut";
  document.querySelectorAll("#sbRatioRow button").forEach((b) => b.classList.toggle("on", b.dataset.r === S.ratio));
  document.querySelectorAll("#sbViewRow button").forEach((b) => b.classList.toggle("on", b.dataset.v === S.view));
}
async function autoSaveLibrary() {
  for (const f of S.frames) {
    if (f.saved) continue;
    try {
      const fname = (slugName(f.name || S.name, "story").slice(0, 40) || "story") + "-" + String(f.id).replace(/[^\w\-]+/g, "").slice(0, 20) + ".jpg";
      await saveBlobToLibrary({ kind: "final", tab: "storyboard", blob: f.blob, filename: fname, prompt: f.prompt, extra: { provider: "storyboard-studio", providerLabel: "Storyboard", aspect: S.ratio, story: S.name, cat: S.cat, name: f.name || S.name, userCat: libCatOf(), character: f.character || "", scene: f.scene || "" } });
      f.saved = true;
    } catch {}
  }
}
async function scaleFrame(id, k) {
  const f = S.frames.find((x) => x.id === id); if (!f) return;
  const { im, u } = await blobToImg(f.blob);
  const c = document.createElement("canvas");
  c.width = Math.max(2, Math.round(im.naturalWidth * k)); c.height = Math.max(2, Math.round(im.naturalHeight * k));
  c.getContext("2d").drawImage(im, 0, 0, c.width, c.height);
  URL.revokeObjectURL(u);
  f.blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.92));
  f.url = await blobToDataUrl(f.blob); f.saved = false;
  render(); autoSaveLibrary(); toast(k > 1 ? "Upscaled 2x" : "Downscaled ½");
}
function sendMenu(f) {
  const dest = prompt("Send image to: video = Video studio · image = Image edit · editor = Editor bin · voice = Voiceover cover · download = file", "video");
  if (!dest) return;
  const d = dest.toLowerCase();
  if (d.startsWith("vid")) {
    if (window.AIVideoGen) window.AIVideoGen.state.refImage = f.blob;
    const p = document.querySelector("#refPreview"); if (p) p.src = f.url;
    document.querySelector('[data-page="pageVideo"]')?.click(); toast("Sent to Video studio");
  } else if (d.startsWith("ima")) {
    if (window.AIVideoGen) window.AIVideoGen.state.imgEditImage = f.blob;
    const p = document.querySelector("#imgRefPreview"); if (p) p.src = f.url;
    document.querySelector('[data-page="pageImage"]')?.click(); toast("Sent to Image edit");
  } else if (d.startsWith("ed")) {
    document.querySelector('[data-page="pageEditor"]')?.click();
    window._sbToEditor = f; toast("Opened Editor — use Import, or re-drop");
  } else if (d.startsWith("voi")) {
    document.querySelector('[data-page="pageVoice"]')?.click(); toast("Opened Voiceover");
  } else {
    const a = document.createElement("a"); a.href = f.url; a.download = S.name + "-" + f.id + ".jpg"; a.click();
  }
}
function castLock() {
  const bits = [];
  S.cast.filter(c => c && (c.name || c.url)).forEach(c => { const n = (c.name || "").trim(); if (n && c.url) bits.push(`same character ${n} as their reference photo, identical face`); else if (n) bits.push("same character " + n); });
  S.ward.filter(c => c && c.name).forEach(c => bits.push(`wearing \"${c.name.trim()}\" exactly, same garment, same fabric, same color, same fit in every frame`));
  S.scenes.filter(c => c && c.name).forEach(c => bits.push(`in \"${c.name.trim()}\" as the reference place, same architecture, same lighting, same time of day`));
  if (!bits.length) return "";
  return "consistent characters, " + bits.join(", ") + ", same faces, same age, same facial features, same skin tone, same hair, same outfits, anatomically correct bodies with two arms and two legs, realistic hands with five fingers and natural nails, realistic feet with five toes, no extra limbs, no extra fingers, same place, same camera style, 16:9 landscape wide shot, photoreal faces, "; 
}
async function paintOne(prompt, ratio, label, opts = {}) {
  let last = null;
  for (let a = 1; a <= 3; a++) {
    try {
      if (label) $("sbBusyMsg").textContent = label + (a > 1 ? " (retry " + a + "/3)" : "");
      const { blob, url, seed } = await aiImage(prompt, ratio, opts.seed != null ? { seed: opts.seed, negativePrompt: opts.negativePrompt } : { negativePrompt: opts.negativePrompt });
      if (blob && blob.size > 2000) return { blob, url, seed };
      last = new Error("empty image");
    } catch (e) { last = e; console.warn("paint retry", a, e); }
    await new Promise(r => setTimeout(r, 800 * a));
  }
  throw last || new Error("generate failed");
}
function storySeed() {
  const seeds = (S.cast || []).map((c) => parseInt(c?.seed, 10)).filter((s) => Number.isFinite(s));
  return seeds.length ? seeds : null;
}
async function generateAll(mode) {
  if (!S.ratio) S.ratio = "16:9";
  const idea = $("sbIdeaInput").value.trim() || "a brave fox crossing a glowing forest";
  const count = mode === "ten" ? 10 : Math.max(1, Math.min(24, +$("sbSceneCount").value || 4));
  const genBtn = $("sbGenBtn"); genBtn.disabled = true;
  const tenBtn = $("sbTenBtn"); if (tenBtn) tenBtn.disabled = true;
  try {
    const beats = mode === "one" ? [$("sbPromptInput").value.trim() || idea] : await storyBeats(idea, count);
    const lock = castLock();
    const seeds = mode === "one" ? null : storySeed();
    $("sbBusy").hidden = false;
    let made = 0, failed = 0;
    for (let bi = 0; bi < beats.length; bi++) {
      const p = beats[bi];
      const base = $("sbEnhToggle").checked ? await enhance(p) : p;
      const rich = lock ? lock + base : base;
      const seed = Array.isArray(seeds) ? seeds[bi % seeds.length] : seeds;
      try {
        const { blob, url } = await paintOne(rich, ratioOf(), "Painting " + (S.frames.length + 1) + "/" + (S.frames.length + beats.length - made - failed) + "… unlimited queue", seed != null ? { seed } : {});
        S.frames.push({ id: "f" + (++n) + Date.now().toString(36), prompt: rich, blob, dur: Math.max(0.3, +$("sbSecsInput")?.value || 1.5), url: blob.size ? await blobToDataUrl(blob) : url });
        made++;
      } catch (e) { failed++; console.warn(e); }
      render();
    }
    autoSaveLibrary();
    queuePersist();
    window.V4Resume?.save?.({ tab: "pageStoryboard", story: S.name, sb: snapshot() });
    toast(made + " frames in “" + S.name + "”" + (failed ? ", " + failed + " failed after 3 retries" : "") + " — auto-saved to Library");
  } finally { $("sbBusy").hidden = true; genBtn.disabled = false; if (tenBtn) tenBtn.disabled = false; render(); }
}
async function compileVideo() {
  if (!S.frames.length || S.compiling) return;
  S.compiling = true; $("sbCompileBtn").disabled = true;
  $("sbBusy").hidden = false; $("sbBusyMsg").textContent = "Merging frames into video…";
  try {
    const optIn = window.AIVideoGen?.state?.settings?.communityOptIn === true;
    if (optIn) $("sbBusyMsg").textContent = "Own pool: merging " + S.frames.length + " frames on this device (" + poolStatus(window.AIVideoGen.state.settings).text + ")…";
    const r = ratioOf();
    const W = r.r >= 1 ? 960 : Math.round(960 * r.r), H = r.r >= 1 ? Math.round(960 / r.r) : 960;
    const canvas = document.createElement("canvas"); canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d");
    const per = Math.max(0.3, +$("sbSecsInput").value || 1.5);
    const fmt = $("sbVidFmtSel").value || "webm";
    const trans = $("sbTransSel")?.value || S.trans || "cut";
    S.trans = trans;
    const xf = trans === "x06" ? 0.6 : trans === "x03" ? 0.3 : 0;
    const durs = S.frames.map((f) => Math.max(0.3, Math.min(5, +f.dur || per)));
    const drawCover = (im) => {
      const cw = W, ch = W / (im.naturalWidth / im.naturalHeight);
      ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
      ctx.drawImage(im, 0, (H - ch) / 2, cw, ch);
    };
    const imgs = [];
    for (const f of S.frames) imgs.push(await blobToImg(f.blob));
    const stream = canvas.captureStream(30);
    const mime = fmt === "gif" ? "video/webm" : ("video/" + fmt + ";codecs=vp9,opus");
    const rec = new MediaRecorder(stream, MediaRecorder.isTypeSupported(mime) ? { mimeType: mime, videoBitsPerSecond: 6e6 } : undefined);
    const chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const done = new Promise((res) => rec.onstop = res);
    rec.start(200);
    for (let idx = 0; idx < imgs.length; idx++) {
      const { im } = imgs[idx];
      $("sbBusyMsg").textContent = "Merging scene " + (idx + 1) + "/" + imgs.length + " (" + durs[idx].toFixed(1) + "s" + (xf ? ", dissolve" : "") + ")…";
      const t0 = performance.now();
      while (performance.now() - t0 < durs[idx] * 1000) {
        drawCover(im);
        await new Promise((x) => setTimeout(x, 66));
      }
      if (xf && idx < imgs.length - 1) {
        const nxt = imgs[idx + 1].im, steps = Math.max(2, Math.round(xf * 30));
        for (let s2 = 1; s2 <= steps; s2++) {
          drawCover(im);
          ctx.globalAlpha = s2 / steps;
          drawCover(nxt);
          ctx.globalAlpha = 1;
          await new Promise((x) => setTimeout(x, 33));
        }
      }
    }
    for (const { u } of imgs) URL.revokeObjectURL(u);
    rec.stop(); await done;
    const type = fmt === "gif" ? "video/webm" : "video/" + (fmt === "mov" ? "mp4" : fmt);
    const blob = new Blob(chunks, { type });
    const url = URL.createObjectURL(blob);
    const pv = $("sbVideoOut"); pv.src = url; pv.hidden = false;
    pv.parentElement.hidden = false;
    pv.parentElement.style.aspectRatio = W + " / " + H;
    pv.onloadedmetadata = () => { try { pv.parentElement.style.aspectRatio = pv.videoWidth + " / " + pv.videoHeight; } catch {} };
    const dl = $("sbVideoDlBtn");
    const outFname = (slugName(S.name, "story").slice(0, 40) || "story") + "." + (fmt === "gif" ? "webm" : fmt);
    if (dl) { dl.href = url; dl.download = outFname; }
    await saveBlobToLibrary({ kind: "final", tab: "storyboard", blob, filename: outFname, prompt: S.name + " compiled video", extra: { provider: "storyboard-video", providerLabel: "Storyboard video", aspect: S.ratio, story: S.name, cat: S.cat, name: S.name, userCat: libCatOf() } });
    toast("Video compiled + auto-saved to Library");
  } catch (e) { toast("Compile failed: " + (e.message || e)); }
  finally { S.compiling = false; $("sbCompileBtn").disabled = false; $("sbBusy").hidden = true; }
}
function buildUI() {
  if ($("sbGenBtn")?.dataset?.bound) return;
  $("sbGenBtn").dataset.bound = "1";
  const rr = $("sbRatioRow");
  RATIOS.forEach((x) => { const b = document.createElement("button"); b.type = "button"; b.className = "chip-btn"; b.dataset.r = x.id; b.textContent = x.id; b.title = x.hint + (x.social ? " · " + x.social : ""); if (x.id === S.ratio) b.classList.add("on"); b.onclick = () => { S.ratio = x.id; syncControls(); preview(); }; rr.appendChild(b); });
  const vr = $("sbViewRow");
  VIEWS.forEach(([id, l]) => { const b = document.createElement("button"); b.type = "button"; b.dataset.v = id; b.textContent = l; b.title = id + " thumbnails"; if (id === S.view) b.classList.add("on"); b.onclick = () => { S.view = id; syncControls(); render(); }; vr.appendChild(b); });
  const cs = $("sbCatSel"); CATS.forEach((c) => { const o = document.createElement("option"); o.value = c; o.textContent = c; cs.appendChild(o); });
  const lc = $("sbLibCatSel");
  if (lc && !lc.dataset.filled) {
    lc.dataset.filled = "1";
    for (const [id, label] of LIB_CATS) {
      if (!SAVABLE_CATS.includes(id)) continue;
      const o = document.createElement("option");
      o.value = id; o.textContent = label;
      lc.appendChild(o);
    }
    lc.value = libCatOf();
    lc.onchange = (e) => { S.libCat = e.target.value; queuePersist(); toast("Frames will save to " + (e.target.selectedOptions[0]?.textContent || e.target.value)); };
  }
  const vf = $("sbVidFmtSel"); VID_FMTS.forEach(([id, l]) => { const o = document.createElement("option"); o.value = id; o.textContent = l; vf.appendChild(o); });
  const ts = $("sbTransSel");
  if (ts && !ts.dataset.bound) { ts.dataset.bound = "1"; ts.value = S.trans || "cut"; ts.onchange = (e) => { S.trans = e.target.value; queuePersist(); }; }
  $("sbCatSel").onchange = (e) => S.cat = e.target.value;
  $("sbNameInput").oninput = (e) => S.name = e.target.value || "My Story";
  $("sbGenBtn").onclick = () => generateAll("story");
  if ($("sbTenBtn") && !$("sbTenBtn").dataset.bound) { $("sbTenBtn").dataset.bound = "1"; $("sbTenBtn").onclick = () => { $("sbSceneCount").value = 10; if (!S.ratio) S.ratio = "16:9"; syncControls(); generateAll("ten"); }; }
  $("sbOneBtn").onclick = () => generateAll("one");
  $("sbBuildBtn").onclick = async () => {
    const idea = $("sbIdeaInput").value.trim(); if (!idea) { toast("Type a story idea first"); return; }
    $("sbBuildBtn").disabled = true;
    try { $("sbPromptInput").value = (await storyBeats(idea, Math.max(1, Math.min(12, +$("sbSceneCount").value || 4)))).join("\n"); toast("Story built from prompt"); }
    finally { $("sbBuildBtn").disabled = false; }
  };
  $("sbEnhOneBtn").onclick = async () => { $("sbPromptInput").value = await enhance($("sbPromptInput").value || $("sbIdeaInput").value); };
  $("sbAiPromptBtn").onclick = async () => {
    try { let out = ""; await root.generateText({ instruction: "Write one vivid image prompt for: " + ($("sbIdeaInput").value || "a fantasy castle"), onChunk: (d) => { out += d.textChunk || ""; $("sbPromptInput").value = out; } }); } catch { toast("AI prompt failed"); }
  };
  $("sbMicBtn").onclick = () => micInto($("sbPromptInput"));
  $("sbMicIdeaBtn").onclick = () => micInto($("sbIdeaInput"));
  $("sbSpeakBtn").onclick = () => speak(S.frames.map((f) => f.prompt).join(". ") || $("sbIdeaInput").value || S.name);
  $("sbVoiceBtn").onclick = sendToVoice;
  $("sbNarrateBtn").onclick = narrateToVoice;
  $("sbClearBtn").onclick = async () => {
    if (!S.frames.length) return;
    if (!confirm(`Clear all ${S.frames.length} frames of “${S.name}”? Their Library copies go too (compiled videos are kept).`)) return;
    const name = S.name;
    S.frames = []; S.sel.clear(); render();
    const n = await deleteLibraryStory(name).catch(() => 0);
    toast(`Cleared — ${n} Library ${n === 1 ? "copy" : "copies"} removed too.`);
  };
  $("sbCompileBtn").onclick = compileVideo;
  const addWired = (btnId, kind) => {
    const b = $(btnId);
    if (b && !b.dataset.bound) {
      b.dataset.bound = "1";
      b.onclick = () => { refArr(kind).push({ id: "r" + (++n) + Date.now().toString(36), name: "", blob: null, url: "" }); renderRefs(); queuePersist(); };
    }
  };
  addWired("sbCastAdd", "cast"); addWired("sbSceneAdd", "scene"); addWired("sbWardAdd", "ward");
  if ($("sbDGender") && !$("sbDGender").dataset.bound) {
    $("sbDGender").dataset.bound = "1";
    const fill = (id, list) => { const s = $(id); s.innerHTML = ""; for (const v of list) { const o = document.createElement("option"); o.value = v; o.textContent = v[0].toUpperCase() + v.slice(1); s.appendChild(o); } s.onchange = syncDesignerOut; };
    fill("sbDGender", DESIGNER.gender); fill("sbDAge", DESIGNER.age); fill("sbDBuild", DESIGNER.build);
    fill("sbDHair", DESIGNER.hair); fill("sbDOutfit", DESIGNER.outfit); fill("sbDStyle", DESIGNER.style); fill("sbDExpr", DESIGNER.expr);
    syncDesignerOut(); syncSaveSel();
    $("sbDUseBtn").onclick = () => { $("sbPromptInput").value = designPrompt(); toast("Designer prompt is in the image prompt box"); };
    $("sbDGenBtn").onclick = async () => {
      const btn = $("sbDGenBtn");
      const prev = btn.textContent;
      btn.disabled = true; btn.textContent = "Painting…";
      try {
        const p = designPrompt();
        const { blob, url, seed } = await aiImage(p, ratioOf());
        if (!blob || !blob.size) { toast("Generate failed — try again."); return; }
        const durl = await blobToDataUrl(blob);
        const si = $("sbDSaveSel") ? $("sbDSaveSel").value : "";
        if (si !== "" && S.cast[+si]) {
          const conv = await fileToRef(new File([blob], "designer.jpg", { type: blob.type || "image/jpeg" }));
          S.cast[+si].blob = conv.blob; S.cast[+si].url = conv.url;
          if (seed != null) S.cast[+si].seed = String(seed);
          if (!S.cast[+si].name) S.cast[+si].name = p.split(",")[0].replace("full-body character portrait of ", "").slice(0, 40);
        }
        S.frames.push({ id: "f" + (++n) + Date.now().toString(36), prompt: p, blob, dur: Math.max(0.3, +$("sbSecsInput")?.value || 1.5), url: durl });
        render(); autoSaveLibrary();
        toast(si !== "" && S.cast[+si] ? "Character generated — frame added, cast slot filled" : "Character generated — frame added");
      } catch (e) { toast("Generate failed: " + (e.message || e)); }
      finally { btn.disabled = false; btn.textContent = prev; }
    };
  }
  if ($("sbImportBtn") && !$("sbImportBtn").dataset.bound) {
    $("sbImportBtn").dataset.bound = "1";
    const pick = document.createElement("input");
    pick.type = "file";
    pick.accept = "image/*";
    pick.multiple = true;
    pick.hidden = true;
    document.body.appendChild(pick);
    const importBlobs = async (files) => {
      if (!files.length) { toast("No images picked."); return; }
      let n2 = 0;
      for (const f of files.slice(0, 24)) {
        try {
          const url = await blobToDataUrl(f);
          S.frames.push({ id: "f" + (++n) + Date.now().toString(36), prompt: f.name || "imported frame", blob: f, dur: Math.max(0.3, +$("sbSecsInput")?.value || 1.5), url });
          n2++;
        } catch (e) { console.warn("import failed", e); }
      }
      render();
      autoSaveLibrary();
      toast(n2 + " frame" + (n2 === 1 ? "" : "s") + " imported — preview below, Compile turns them into video (saved to Library).");
    };
    $("sbImportBtn").onclick = async () => {
      const { chooseImportSource, pickLibraryMedia } = await import("./lib-picker.js");
      const src = await chooseImportSource($("sbImportBtn"));
      if (src === "library") {
        const items = await pickLibraryMedia({ accept: "image", multi: true, title: "Storyboard frames from Library" });
        if (items) await importBlobs(items.map((it) => new File([it.blob], it.name, { type: it.blob.type || "image/jpeg" })));
      } else if (src === "computer") pick.click();
    };
    pick.onchange = async () => {
      const files = [...(pick.files || [])].filter((f) => String(f.type || "").startsWith("image/"));
      pick.value = "";
      await importBlobs(files);
    };
  }
  $("sbProjectSel").onchange = (e) => switchProject(e.target.value);
  $("sbNewBtn").onclick = async () => {
    const name = (prompt("Story name:", "Story " + (Object.keys(lsProjects()).length + 1)) || "").trim();
    if (!name) return;
    await persistCurrent().catch(() => {});
    S.name = name; S.frames = []; S.sel.clear();
    S.cast = []; S.scenes = []; S.ward = [];
    syncControls(); render(); await persistCurrent();
    toast("New project “" + name + "”");
  };
  $("sbDelBtn").onclick = async () => {
    const name = S.name;
    if (!confirm(`Delete project “${name}”? Its frames and their Library copies go too (compiled videos are kept).`)) return;
    const map = lsProjects(); delete map[name]; lsSaveAll(map);
    try {
      const k = pkv();
      if (k?.entries) for (const [key, proj] of await k.entries()) {
        if (proj?.name !== name) continue;
        try { await k.delete(key); } catch {}
      }
    } catch {}
    const n = await deleteLibraryStory(name).catch(() => 0);
    const rest = Object.keys(lsProjects()).sort()[0];
    toast(`Deleted “${name}” + ${n} Library ${n === 1 ? "copy" : "copies"}.`);
    if (rest) switchProject(rest);
    else { S.name = "My Story"; S.frames = []; S.sel.clear(); S.cast = []; S.scenes = []; S.ward = []; syncControls(); render(); }
  };
  const bd = $("sbBoard");
  bd.ondragover = (e) => e.preventDefault();
  bd.ondrop = (e) => {
    const id = e.dataTransfer.getData("text/sbid");
    if (id && !e.target.closest?.(".sb-card")) { const i = S.frames.findIndex((x) => x.id === id); const [m] = S.frames.splice(i, 1); S.frames.push(m); render(); }
  };
  syncControls(); render();
  projBooted = true;
  bootProjects();
}
async function bootProjects() {
  try { refreshProjectSel(); } catch {}
}
async function addExternalFrames(items) {
  let added = 0;  for (const it of items || []) {
    if (!it || !(it.blob instanceof Blob) || !it.blob.size) continue;
    S.frames.push({
      id: "f" + (++n) + Date.now().toString(36),
      prompt: String(it.prompt || "image studio variation").slice(0, 300),
      blob: it.blob,
      dur: Math.max(0.3, +$("sbSecsInput")?.value || 1.5),
      url: await blobToDataUrl(it.blob),
    });
    added += 1;
  }
  if (added) { render(); autoSaveLibrary(); }
  return S.frames.length;
}
window.SBStudio = { snapshot, restore, switchProject, projects: loadProjects, sendToVoice, narrateToVoice, addExternalFrames };
if (document.readyState !== "loading") buildUI();
else document.addEventListener("DOMContentLoaded", buildUI, { once: true });
