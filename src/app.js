import {
  ASPECTS,
  CAMERA_ANGLES,
  CAMERA_MOVES,
  TRACKING_MODES,
  ENHANCE_MODES,
  KEY_PROVIDERS,
  MUAPI_PROVIDERS,
  OFFLINE_PROVIDER,
  PAID_PROVIDERS,
  PROVIDERS,
  QUALITIES,
  STYLES,
  dimsFor,
  getProvider,
  isMultiRef,
  isNsfwCapable,
  isNsfwOnly,
} from "./providers.js";
import { SpaceError, autoAdapter, clearZeroGpuBlock, spaceToHost, zeroGpuBlockInfo } from "./gradio.js";
import { generate, planSegments, pollinationsKeyframe } from "./engine.js";
import { downloadBlob, extractFrame, filmstrip, fmtTime } from "./video.js";
import { initPlayer, playerFallback, playerHint, playerLoad, playerRate, playerReset } from "./player.js";
import { FPS_LADDER, nativeFpsFor, snapFps } from "./encode.js";
import {
  RELAY_MODES,
  checkRelays,
  customRelay,
  fallbackRelays,
  primaryRelays,
  relayPool,
  rotatableCount,
} from "./relay.js";
import { stripMetadata } from "./image.js";
import { describeFullReset, describeWipe, fullReset, wipeTraces } from "./traces.js";
import {
  normalizeServerUrl,
  providersFromHealth,
  serverDownloadWeights,
  serverHealth,
  serverWeights,
} from "./server.js";
import { muapiBalance, muapiEstimate } from "./muapi.js";
import { MUAPI_GROUPS } from "./muapi-models.js";
import {
  MIN_PASSPHRASE,
  auditEgress,
  destroyVault,
  ensureVault,
  lock as lockVault,
  recoveryPhrase,
  restoreRecovery,
  setPassphrase,
  unlock,
  vaultState,
} from "./vault.js";
import { ROUTING_MODES, classifyRequest, loadRouteStats, moderationOf, resetRouteStats, routeStatsSync, tierLabel } from "./router.js";
import { buildClothesMask, maskPreview } from "./segment.js";
import { IMG_ASPECTS, IMG_CONTROLS, IMG_GROUPS, IMG_LORAS, IMG_MODELS, IMG_SIZES, generateImages, imgDims, naturalSize } from "./img-engine.js";
import { planEditSteps, runEditAgent } from "./edit-agent.js";
import { faceBlend } from "./facelock.js";
import { POSE_PRESETS, estimatePose, runPoseVariants } from "./poses.js";
import "./diag.js";
  import { GALLERY_VIEWS, LIBRARY_VIEWS, IMAGE_FORMATS, VIDEO_FORMATS, applyGalleryView, exportImage, exportVideo, imageFormatOf } from "./gallery-export.js";
  import { LOG_MODES, friendlyStage, friendlyRunStart, friendlyPlan, friendlyBeats, friendlyBeat, friendlySegment, friendlyClip, friendlyDone, friendlyCancel } from "./friendly.js";
import { GRADE_PRESETS, applyPreset, cssFilterFor, defaultGrade, gradeActive, paintLiveOverlays, tintAlphaFor, tintCssFor } from "./grade.js";
import { hordeRejectedKey, torsoMaskBox } from "./nsfw.js";
import {
  addHistory,
  clearCooldowns,
  clearHistory,
  deleteHistory,
  getHistory,
  getCooldowns,
  listHistory,
  loadSettings,
  poolDecide,
  poolStatus,
  saveSettings,
  sealLegacyHistory,
  uid,
  updateHistory,
} from "./store.js";
import { LIB_CATS, SAVABLE_CATS, libCategory, libFileName, makePoster, saveBlobToLibrary, slugName } from "./library-save.js";

function fillSaveCatSel(sel, def) {
  if (!sel || sel.dataset.filled) return;
  sel.dataset.filled = "1";
  sel.innerHTML = "";
  for (const [id, label] of LIB_CATS) {
    if (!SAVABLE_CATS.includes(id)) continue;
    const o = document.createElement("option");
    o.value = id; o.textContent = label;
    sel.appendChild(o);
  }
  sel.value = SAVABLE_CATS.includes(def) ? def : "video";
}
function readSaveMeta(prefix, fallbackCat) {
  const val = (id) => document.getElementById(id)?.value?.trim() || "";
  const name = val(prefix + "NameInput");
  const userCat = document.getElementById(prefix + "LibCatSel")?.value || fallbackCat;
  const character = val(prefix + "CharInput");
  const scene = val(prefix + "SceneInput");
  const label = (LIB_CATS.find(([id]) => id === userCat) || [])[1] || userCat;
  const tab = userCat === "storyboard" ? "storyboard" : (prefix === "img" ? "image" : prefix === "vid" ? "video" : fallbackCat);
  return { name, userCat, character, scene, label, tab, filename: name ? libFileName(name, "library", prefix === "img" ? "jpg" : "mp4") : "" };
}


const $ = (id) => document.getElementById(id);

const DUR_UNITS = {
  s: { short: "s", label: "seconds", toSec: 1 },
  ms: { short: "ms", label: "milliseconds", toSec: 0.001 },
  us: { short: "µs", label: "microseconds", toSec: 0.000001 },
  ns: { short: "ns", label: "nanoseconds", toSec: 0.000000001 },
};

function fmtDur(sec) {
  const s = Number(sec) || 0;
  if (s >= 1) return `${Math.round(s * 100) / 100}s`;
  if (s >= 0.001) return `${Math.round(s * 1e6) / 1000}ms`;
  if (s >= 0.000001) return `${Math.round(s * 1e9) / 1000}µs`;
  return `${Math.round(s * 1e12) / 1000}ns`;
}

const state = {
  settings: null,
  refImage: null,
  refVideo: null,
  refName: "",
  refMode: "single",
  refExtras: {},
  aspect: "16:9",
  quality: "480p",
  duration: 5,
  durUnit: "s",
  controller: null,
  busy: false,
  result: null,
  runName: null,
  takeCount: 0,
  customProviders: [],
  serverProviders: [],
  repaint: null,
  lastFrame: null,
  /** A run that stopped mid-way, kept so it can be finished from where it got to. */
  partial: null,
  progress: { base: 0, span: 0, segEstMs: 60000, segStart: 0 },
  cooldowns: {},
  theme: "minimal-dark",
  /** Set once the content-safety panel is wired, so change handlers can redraw the audit. */
  safetyReady: false,
  imgMode: "t2i",
  imgAspect: "1:1",
  imgSize: "M",
  imgCount: 1,
  imgEditImage: null,
  imgEditName: "",
  imgEditWH: null,
  imgResults: [],
  imgSelected: 0,
  imgBusy: false,
  imgNsfw: false,
  imgView: "medium",
  imgFormat: "jpeg",
  imgScale: "1",
  imgUpscaleMode: "fast",
  vidScale: "1",
  vidUpscaleMode: "fast",
  imgQuality: 0.92,
  vidFormat: "match",
  vidQuality: 0.8,
  vidGrade: null,
  imgGrade: null,
  libView: "medium",
  stripView: "medium",
  /** Run-log detail: "simple" reads like a studio, "full" shows the wiring. */
  logMode: "simple",
};

const REF_SLOTS = [
  { id: "face", label: "Face", hint: "face identity" },
  { id: "body", label: "Body / outfit", hint: "body and outfit" },
  { id: "char1", label: "Character 1", hint: "character 1 identity" },
  { id: "char2", label: "Character 2", hint: "character 2 identity" },
  { id: "scene", label: "Scene", hint: "background and setting" },
  { id: "style", label: "Style / pose", hint: "art style and pose" },
];

function refExtrasList() {
  return REF_SLOTS.filter((s) => state.refExtras[s.id]?.blob).map((s) => ({
    slot: s.id,
    label: s.label,
    hint: s.hint,
    blob: state.refExtras[s.id].blob,
    name: state.refExtras[s.id].name || s.id,
  }));
}

function setRefMode(mode) {
  state.refMode = mode === "multi" ? "multi" : "single";
  for (const b of document.querySelectorAll("#refModeRow button")) {
    b.classList.toggle("on", b.dataset.mode === state.refMode);
  }
  const wrap = $("refBoardWrap");
  if (wrap) wrap.hidden = state.refMode !== "multi";
}

function renderRefBoard() {
  const host = $("refBoard");
  if (!host) return;
  host.innerHTML = "";
  for (const s of REF_SLOTS) {
    const cur = state.refExtras[s.id];
    const card = document.createElement("div");
    card.className = "ref-slot" + (cur ? " filled" : "");
    if (cur?.blob) {
      const tag = document.createElement("div");
      tag.className = "ref-tag";
      tag.textContent = s.label;
      const img = document.createElement("img");
      img.alt = s.label + " reference";
      img.src = cur.url;
      const foot = document.createElement("div");
      foot.className = "ref-foot";
      const nm = document.createElement("span");
      nm.className = "mono tiny";
      nm.textContent = `${Math.round(cur.blob.size / 1024)} KB`;
      const x = document.createElement("button");
      x.type = "button";
      x.className = "btn btn-tiny ref-x";
      x.textContent = "Remove";
      x.onclick = (e) => {
        e.stopPropagation();
        try { URL.revokeObjectURL(cur.url); } catch {}
        delete state.refExtras[s.id];
        renderRefBoard();
        if (state.safetyReady) renderEgress();
      };
      foot.append(nm, x);
      card.append(tag, img, foot);
    } else {
      const add = document.createElement("div");
      add.className = "ref-add";
      add.innerHTML = `<span>+</span><small></small>`;
      add.querySelector("small").textContent = s.label;
      add.title = `Add ${s.label} reference`;
      card.append(add);
      card.onclick = (e) => pickExtraFile(s.id, e.currentTarget);
    }
    host.append(card);
  }
}

let extraPickSlot = null;
async function pickExtraFile(slot, anchor) {
  const { chooseImportSource, pickLibraryMedia } = await import("./lib-picker.js");
  const src = await chooseImportSource(anchor || null);
  if (src === "library") {
    const items = await pickLibraryMedia({ accept: "image", title: "Reference from Library" });
    if (items && items[0]) await acceptExtraFile(slot, new File([items[0].blob], items[0].name, { type: items[0].blob.type }));
    return;
  }
  if (src !== "computer") return;
  extraPickSlot = slot;
  let inp = $("refExtraInput");
  if (!inp) {
    inp = document.createElement("input");
    inp.id = "refExtraInput";
    inp.type = "file";
    inp.accept = "image/*";
    inp.hidden = true;
    document.body.appendChild(inp);
    inp.onchange = async () => {
      const f = inp.files?.[0];
      inp.value = "";
      if (f && extraPickSlot) await acceptExtraFile(extraPickSlot, f);
      extraPickSlot = null;
    };
  }
  inp.click();
}

async function acceptExtraFile(slot, file) {
  if (!file || !file.type.startsWith("image/")) {
    toast("That file isn't an image.", "warn");
    return;
  }
  try {
    const guard = await import("./guard.js");
    const scan = await guard.scanFile(file, { maxMb: 12 });
    if (!scan.ok) { toast(scan.reason, "warn"); return; }
  } catch {}
  const clean = await stripMetadata(file, { maxDim: 1280 });
  const blob = clean && clean.size ? clean : file;
  const old = state.refExtras[slot];
  if (old) try { URL.revokeObjectURL(old.url); } catch {}
  state.refExtras[slot] = { blob, name: file.name || slot, url: URL.createObjectURL(blob) };
  renderRefBoard();
  if (state.safetyReady) renderEgress();
  logLine(`reference added → ${slot} (${Math.round(blob.size / 1024)} KB)`);
}

function clearRefExtras() {
  for (const k of Object.keys(state.refExtras)) {
    try { URL.revokeObjectURL(state.refExtras[k].url); } catch {}
  }
  state.refExtras = {};
  renderRefBoard();
  if (state.safetyReady) renderEgress();
}

/* ------------------------------------------------------------------ icons */

const ICON_SUN =
  '<svg viewBox="0 0 24 24" width="16" height="16"><circle cx="12" cy="12" r="4.2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 2.6v2.4M12 19v2.4M2.6 12H5M19 12h2.4M5.2 5.2l1.7 1.7M17.1 17.1l1.7 1.7M18.8 5.2l-1.7 1.7M6.9 17.1l-1.7 1.7" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';
const ICON_MOON =
  '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M20 13.2A8.2 8.2 0 0 1 10.8 4a8.4 8.4 0 1 0 9.2 9.2Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>';

/* ------------------------------------------------------------------ utils */

function toast(msg, kind = "", ms = 4200) {
  let host = document.querySelector(".toasts");
  if (!host) {
    host = document.createElement("div");
    host.className = "toasts";
    document.body.appendChild(host);
  }
  const t = document.createElement("div");
  t.className = "toast " + kind;
  t.textContent = msg;
  host.appendChild(t);
  setTimeout(() => {
    t.style.opacity = "0";
    t.style.transition = "opacity .3s";
    setTimeout(() => t.remove(), 320);
  }, ms);
}

function logLine(text, level = "") {
  const box = $("logBox");
  if (!box) return;
  const now = new Date();
  const stamp = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
  const line = document.createElement("div");
  line.className = "ln " + level;
  const t = document.createElement("span");
  t.className = "t";
  t.textContent = stamp;
  const m = document.createElement("span");
  m.className = "m";
  m.textContent = text;
  line.append(t, m);
  box.appendChild(line);
  box.scrollTop = box.scrollHeight;
  while (box.children.length > 240) box.firstChild.remove();
}

async function copyText(s) {
  try {
    await navigator.clipboard.writeText(s);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = s;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

function setChip(kind, text) {
  const c = $("gpuChip");
  if (!c) return;
  c.className = "chip chip-" + kind;
  $("gpuText").textContent = text;
}

function note(id, text, kind = "") {
  const el = $(id);
  if (!el) return;
  el.textContent = text;
  el.className = "model-note" + (kind ? " " + kind : "");
}

function showQuotaBanner(message) {
  const b = $("quotaBanner");
  if (!b) return;
  if (message) $("bannerText").textContent = message;
  b.hidden = false;
}

function hideQuotaBanner() {
  const b = $("quotaBanner");
  if (b) b.hidden = true;
}

function resultNote(html, kind = "") {
  const el = $("resultNote");
  if (!el) return;
  if (!html) {
    el.hidden = true;
    return;
  }
  el.innerHTML = html;
  el.hidden = false;
  el.className = "banner" + (kind ? " " + kind : "");
}

function setSwitch(id, on) {
  const el = $(id);
  if (el) el.checked = !!on;
}

/** Fill a `.seg` with gallery view buttons (defaults to S/M/L/XL/Grid). */
function buildViewSeg(el, cur, onPick, views) {
  if (!el || el.dataset.bound) return;
  el.dataset.bound = "1";
  el.innerHTML = "";
  for (const v of views || GALLERY_VIEWS) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = v.label;
    b.title = v.id === "grid" ? "Grid — uniform tiles" : v.id === "tiles" ? "Tiles — thumbnail + info rows" : v.id === "icon" ? "Icons — compact thumbnails" : v.id === "details" ? "Details — full rows" : `${v.id} view`;
    b.dataset.view = v.id;
    if (v.id === cur) b.classList.add("on");
    b.onclick = () => {
      for (const x of el.children) x.classList.toggle("on", x === b);
      onPick(v.id);
    };
    el.appendChild(b);
  }
}

/* --------------------------------------------------------------- theming */

const THEMES = ["minimal-dark", "cyber-emerald", "nordic-frost", "paper-light"];
const THEME_LABELS = {
  "minimal-dark": "Minimal Obsidian (Dark)",
  "cyber-emerald": "Cyber Emerald (Dark)",
  "nordic-frost": "Nordic Slate (Dark)",
  "paper-light": "Studio Paper (Light)",
};
const THEME_DOTS = {
  "minimal-dark": "#94a3b8",
  "cyber-emerald": "#10b981",
  "nordic-frost": "#3b82f6",
  "paper-light": "#f1f5f9",
};
const THEME_MIGRATE = {
  "green-black": "cyber-emerald",
  "blue-black": "nordic-frost",
  "cherry-black": "minimal-dark",
  "orange-black": "minimal-dark",
  "yellow-black": "cyber-emerald",
  "total-dark": "minimal-dark",
  "mono-red": "minimal-dark",
  "blue-white": "paper-light",
  "cherry-white": "paper-light",
  "teal-white": "paper-light",
  "purple-white": "paper-light",
  dark: "minimal-dark",
  forest: "cyber-emerald",
  light: "paper-light",
  violet: "nordic-frost",
  ocean: "nordic-frost",
  sunset: "minimal-dark",
};
function applyTheme(theme) {
  state.theme = THEMES.includes(theme) ? theme : "minimal-dark";
  document.documentElement.dataset.theme = state.theme;
  document.documentElement.dataset.mode = state.theme === "paper-light" ? "white" : "black";
  const btn = $("themeBtn");
  if (btn) {
    btn.innerHTML = state.theme === "paper-light" ? ICON_MOON : ICON_SUN;
    btn.title = "Theme: " + (THEME_LABELS[state.theme] || state.theme) + " (click to change)";
    btn.setAttribute("aria-label", btn.title);
    btn.setAttribute("aria-haspopup", "menu");
    btn.setAttribute("aria-expanded", $("themeMenu") && !$("themeMenu").hidden ? "true" : "false");
  }
}

function closeThemeMenu() {
  const m = $("themeMenu");
  if (m) m.hidden = true;
  document.removeEventListener("mousedown", themeOutside);
  const btn = $("themeBtn");
  if (btn) btn.setAttribute("aria-expanded", "false");
}
function themeOutside(e) {
  const m = $("themeMenu");
  const btn = $("themeBtn");
  if (m && !m.hidden && !m.contains(e.target) && btn && !btn.contains(e.target)) closeThemeMenu();
}
function openThemeMenu() {
  let m = $("themeMenu");
  if (!m) {
    m = document.createElement("div");
    m.id = "themeMenu";
    m.className = "theme-menu";
    m.hidden = true;
    m.setAttribute("role", "menu");
    m.setAttribute("aria-label", "Theme");
    const host = $("themeBtn")?.parentElement;
    if (!host) return;
    host.appendChild(m);
  }
  m.innerHTML = "";
  for (const t of THEMES) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "theme-opt" + (t === state.theme ? " on" : "");
    b.setAttribute("role", "menuitemradio");
    b.setAttribute("aria-checked", t === state.theme ? "true" : "false");
    const d = document.createElement("span");
    d.className = "theme-dot";
    d.style.background = THEME_DOTS[t] || "#888";
    const s = document.createElement("span");
    s.textContent = THEME_LABELS[t] || t;
    const k = document.createElement("span");
    k.className = "tick";
    k.textContent = "✓";
    b.append(d, s, k);
    b.onclick = () => { applyTheme(t); saveSettings({ theme: t }); closeThemeMenu(); };
    m.appendChild(b);
  }
  m.hidden = false;
  $("themeBtn")?.setAttribute("aria-expanded", "true");
  document.addEventListener("mousedown", themeOutside);
}
function toggleThemeMenu(e) {
  if (e) e.stopPropagation();
  const m = $("themeMenu");
  if (m && !m.hidden) closeThemeMenu();
  else openThemeMenu();
}

/* ------------------------------------------------------------ populate UI */

function fillSelect(sel, items) {
  if (!sel) return;
  sel.innerHTML = "";
  let group = null;
  let groupName = null;
  for (const it of items) {
    const o = document.createElement("option");
    o.value = it.id;
    o.textContent = it.label;
    if (it.group) {
      if (it.group !== groupName) {
        groupName = it.group;
        group = document.createElement("optgroup");
        group.label = it.group;
        sel.appendChild(group);
      }
    } else {
      group = null;
      groupName = null;
    }
    (group || sel).appendChild(o);
  }
}

function populate() {
  fillSelect($("moveSel"), CAMERA_MOVES);
  fillSelect($("angleSel"), CAMERA_ANGLES);
  // No camera move unless the user picks one: zoom/pan words in the prompt
  // fight the subject, so the default is a locked-off shot and the words
  // toggle below stays off with it.
  $("moveSel").value = "static";
  $("angleSel").value = "off";
  fillSelect($("trackSel"), TRACKING_MODES);
  if ($("trackSel")) $("trackSel").value = "off";
  syncTrackNote();
  fillSelect($("styleSel"), STYLES);
  fillSelect($("enhanceModeSel"), ENHANCE_MODES);
  fillSelect($("relayModeSel"), RELAY_MODES);

  const aspectRow = $("aspectRow");
  aspectRow.innerHTML = "";
  for (const [k, v] of Object.entries(ASPECTS)) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip-btn";
    b.dataset.aspect = k;
    b.textContent = k;
    b.title = v.label;
    b.onclick = () => {
      state.aspect = k;
      syncAspect();
      playerHint(k);
      scheduleSave();
    };
    aspectRow.appendChild(b);
  }

  const qRow = $("qualityRow");
  qRow.innerHTML = "";
  for (const [k, v] of Object.entries(QUALITIES)) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = k;
    b.dataset.quality = k;
    b.title = v.label;
    b.onclick = () => {
      state.quality = k;
      syncAspect();
      scheduleSave();
    };
    qRow.appendChild(b);
  }

  rebuildGenSelects();
}

function providerOption(p) {
  const o = document.createElement("option");
  o.value = p.id;
  const limit = p.maxSec ? ` · up to ${p.maxSec}s` : "";
  const missing = p.requires && !state.settings?.[p.requires] ? " — add key in Settings" : "";
  o.textContent = `${p.label}${limit}${missing}`;
  return o;
}

function addGroup(sel, label, list) {
  if (!list?.length) return;
  const g = document.createElement("optgroup");
  g.label = label;
  for (const p of list) g.appendChild(providerOption(p));
  sel.appendChild(g);
}

/** Every provider this session knows about, in one list. */
function allProviders() {
  return [
    ...state.serverProviders,
    ...state.customProviders,
    ...PROVIDERS,
    OFFLINE_PROVIDER,
    ...KEY_PROVIDERS,
    ...MUAPI_PROVIDERS,
  ];
}

function findAny(id) {
  return allProviders().find((p) => p.id === id) || null;
}

/**
 * The models each generator row owns.
 *   standard  everything that is not a dedicated uncensored build
 *   nsfw      everything with an uncensored path
 * The models in between — Wan 2.2 Preview, your own GPU server, the on-device
 * rig — appear in BOTH lists, because they render ordinary video just as
 * happily as explicit video. What actually separates the two generators is the
 * *pipeline* behind them, which the row's own on/off switch turns on (see
 * `genCfg()`, and the `generators` filter in engine's `orderProviders()`).
 */
function genList(which) {
  const all = allProviders();
  return which === "nsfw" ? all.filter(isNsfwCapable) : all.filter((p) => !isNsfwOnly(p));
}

function buildGenSelect(sel, list) {
  const prev = sel.value;
  sel.innerHTML = "";
  const pick = (label, arr) => addGroup(sel, label, arr.filter((p) => list.includes(p)));
  pick("▲ Your GPU server — free & unlimited", state.serverProviders);
  const multiFree = PROVIDERS.filter((p) => isMultiRef(p));
  const singleFree = PROVIDERS.filter((p) => !isMultiRef(p));
  if (multiFree.length) pick("◆ Multi-reference — takes every image", multiFree);
  pick("● Free single-image — animates ONE fused starter", singleFree);
  pick("■ This device — no internet, no GPU", [OFFLINE_PROVIDER]);
  pick("＋ Your spaces", state.customProviders);
  for (const g of MUAPI_GROUPS) {
    const arr = MUAPI_PROVIDERS.filter((p) => p.group === g.id);
    const mm = arr.filter((p) => isMultiRef(p));
    const ss = arr.filter((p) => !isMultiRef(p));
    if (mm.length) pick(`${g.label} ◆ multi-ref`, mm);
    if (ss.length) pick(`${g.label} ● single-image`, ss);
  }
  pick("○ Bring your own key — Replicate / fal.ai / Runway", KEY_PROVIDERS);
  if ([...sel.options].some((o) => o.value === prev)) sel.value = prev;
}

function rebuildGenSelects() {
  buildGenSelect($("stdModelSel"), genList("standard"));
  buildGenSelect($("nsfwModelSel"), genList("nsfw"));
  syncGenNotes();
  syncFps();
  syncDuration();
  syncAspect();
}

/**
 * Read both generator rows straight out of the DOM — the single source of truth
 * for a run. Each row carries its own on/off switch and its own Auto /
 * Pick-a-model mode, so "only NSFW", "only standard" and "both" are all just
 * what the two switches say. `pick` is only read in "Pick a model" mode.
 */
function genCfg() {
  const stdMode = genMode("stdModeRow");
  const nsfwMode = genMode("nsfwModeRow");
  return {
    standard: {
      on: $("stdGenToggle").checked,
      mode: stdMode,
      pick: stdMode === "selected" ? $("stdModelSel").value : "",
    },
    nsfw: {
      on: $("nsfwToggle").checked,
      mode: nsfwMode,
      pick: nsfwMode === "selected" ? $("nsfwModelSel").value : "",
    },
  };
}

/** Which mode a generator row is in — "auto" or "selected". */
function genMode(rowId) {
  return $(rowId)?.querySelector("button.on")?.dataset.mode || "auto";
}

/** Flip a generator row's Auto / Pick-a-model segmented control. */
function setGenMode(rowId, mode) {
  const row = $(rowId);
  if (!row) return;
  for (const b of row.querySelectorAll("button")) b.classList.toggle("on", b.dataset.mode === mode);
}

/** The provider a row's "Pick a model" mode pinned, or null when both are Auto. */
function pinnedProvider(cfg) {
  if (cfg.nsfw.on && cfg.nsfw.pick) return findAny(cfg.nsfw.pick);
  if (cfg.standard.on && cfg.standard.pick) return findAny(cfg.standard.pick);
  return null;
}

/** The providers the current switches actually allow — what "Auto" walks. */
function autoPool(cfg) {
  const all = allProviders();
  if (cfg.standard.on && cfg.nsfw.on) return all;
  if (cfg.nsfw.on) return all.filter(isNsfwCapable);
  return all.filter((p) => !isNsfwOnly(p));
}

function currentProvider() {
  return pinnedProvider(genCfg());
}

function currentMax() {
  const p = currentProvider();
  if (p) return p.maxSec || 15;
  // Only providers that can actually run are counted, so a keyed vendor with no
  // key in Settings does not inflate the "in one shot" hint.
  const pool = autoPool(genCfg()).filter((x) => !x.requires || state.settings?.[x.requires]);
  return Math.max(...pool.map((x) => x.maxSec || 0), 5);
}

function isPaid(provider) {
  return !!provider && (provider.tier === "key" || provider.requires);
}

function syncGenNotes() {
  const cfg = genCfg();
  // Grey out (never hide) whichever row is off, so the pair always reads as a
  // pair and the off state is visible at a glance.
  $("genStdRow").classList.toggle("off", !cfg.standard.on);
  $("genNsfwRow").classList.toggle("off", !cfg.nsfw.on);

  const std = cfg.standard;
  const ns = cfg.nsfw;

  const autoNote = (which, on) => {
    if (!on) return "Off.";
    if (which === "standard") {
      return "Auto: own GPU → free models → on-device.";
    }
    return "Auto: uncensored models.";
  };
  const pickNote = (pick) => {
    const p = pick ? findAny(pick) : null;
    if (!p) return "Pick a model.";
    const bits = [`Runs ${p.label} first.`];
    if (p.note) bits.push(p.note);
    if (isPaid(p)) bits.push("Paid by you.");
    bits.push("Falls forward on refusal.");
    return bits.join(" ");
  };
  note("stdNote", std.mode === "selected" ? pickNote(std.pick) : autoNote("standard", std.on));
  note("nsfwNote", ns.mode === "selected" ? pickNote(ns.pick) : autoNote("nsfw", ns.on));
  $("stdModelSel").hidden = std.mode !== "selected";
  $("nsfwModelSel").hidden = ns.mode !== "selected";

  const combo = $("genComboNote");
  if (!std.on && !ns.on) {
    combo.className = "model-note warn";
    combo.textContent = "Both off — turn one on.";
  } else if (std.on && ns.on) {
    combo.className = "model-note";
    combo.textContent =
      "Both on: SFW uses standard, NSFW tries uncensored first.";
  } else if (ns.on) {
    combo.className = "model-note";
    combo.textContent =
      "NSFW only: uncensored pool + explicit first frame.";
  } else {
    combo.className = "model-note";
    combo.textContent =
      "Standard only.";
  }
}

function syncModelNote() {
  syncGenNotes();
}

function syncAspect() {
  for (const b of $("aspectRow").children) b.classList.toggle("on", b.dataset.aspect === state.aspect);
  for (const b of $("qualityRow").children) b.classList.toggle("on", b.dataset.quality === state.quality);
  const p = currentProvider();
  const [w, h] = dimsFor(state.aspect, state.quality, p);
  $("dimsOut").textContent = `${w}×${h}`;
  playerHint(state.aspect);
  const q = QUALITIES[state.quality];
  if (!q || q.target <= 720) note("qualityNote", "");
  else if (p?.tier === "free") note("qualityNote", `Capped to 720p on ${p.label}.`);
  else if (p) note("qualityNote", `Full ${state.quality} on ${p.label}.`);
  else note("qualityNote", "Free pool max 720p.");
}

function syncDuration() {
  const unit = state.durUnit || "s";
  const info = DUR_UNITS[unit] || DUR_UNITS.s;
  const raw = Number($("durRange").value) || 1;
  $("durVal").textContent = raw;
  $("durUnit").textContent = info.short;
  $("durUnitSel").value = unit;
  $("durTicks").innerHTML = "";
  for (const t of [1, 20, 40, 60]) {
    const s = document.createElement("span");
    s.textContent = `${t}${info.short}`;
    $("durTicks").appendChild(s);
  }
  state.duration = raw * info.toSec;
  const p = currentProvider();
  const effective = p || [...state.serverProviders, ...PROVIDERS].sort((a, b) => (b.quality || 0) - (a.quality || 0))[0] || PROVIDERS[0];
  const hint = $("durHint");
  const max = effective?.maxSec || 5;
  const min = effective?.minSec || 0.5;
  const shown = fmtDur(state.duration);
  if (state.duration < min) {
    hint.className = "hint-block warn";
    hint.textContent = `${shown} is below ${effective.label}'s minimum (${min}s) — the run renders one ${min}s beat and trims it.`;
  } else if (state.duration <= max) {
    hint.className = "hint-block";
    hint.textContent = `${shown} · 1 shot (${effective.label}).`;
  } else {
    const segs = planSegments(state.duration, max, min);
    hint.className = "hint-block warn";
    hint.textContent = `Extended: ${segs.length} × ~${segs[0]}s segments on ${effective.label}, chained so each starts from the previous final frame. Roughly ${fmtTime(
      segs.length * ((effective.estSecs || 60) + 15)
    )} of rendering.`;
  }
  const pct = ((raw - 1) / 59) * 100;
  $("durRange").style.setProperty("--pct", `${pct}%`);
}

function syncFps() {
  const sel = $("fpsSel");
  if (!sel) return;
  const req = Number(sel.value) || 0;
  const p = currentProvider();
  const nat = p ? nativeFpsFor(p) : 24;
  const eff = snapFps(req, nat);
  if (!req) {
    note("fpsNote", `Auto${p ? ` (${nat} fps)` : ""}.`);
    return;
  }
  let txt = `${eff} fps.`;
  if (eff !== req) txt += ` Snapped from ${req} to the nearest supported rate.`;
  if (eff > nat && p && p.kind !== "offline" && p.kind !== "server") txt += ` Native ${nat}, re-timed.`;
  note("fpsNote", txt);
}

function syncNSFW() {
  const on = $("nsfwToggle").checked;
  const undress = on && $("undressToggle").checked;
  $("nsfwFrameRow").hidden = !on;
  $("undressRow").hidden = !on;
  const mode = $("nsfwFrameSel").value;
  const notes = undress
    ? {
        auto: "Undress: photo is frame 1.",
        draw: "Unused with Undress on.",
        image: "Photo is frame 1.",
        given: "Imported is frame 1.",
      }
    : {
        auto: "Repaints clothing only. Face stays yours.",
        draw: "New person. Instant.",
        image: "Keep as-is.",
        given: "Animate as-is.",
      };
  note("nsfwFrameNote", notes[mode] || "");
  // The two generator rows and the combo line depend on this switch too.
  syncGenNotes();
  // …and so does the leak audit: which route the content would take depends on
  // the mode the NSFW row is in.
  if (state.safetyReady) renderEgress();
}

/**
 * Refresh everything that depends on the two generator rows: the NSFW pipeline
 * rows, the row notes and the combo line, and the size / duration / fps hints,
 * because a pinned model has its own limits (a pinned SVD is capped at 4s, a
 * pinned rig at 15).
 */
function syncGenerators() {
  syncNSFW();
  syncAspect();
  syncDuration();
  syncFps();
}

/* --------------------------------------------------------------- reference */

function setRefImage(blob, name) {
  state.refImage = blob;
  state.refImageName = name || "image";
  try { saveBlobToLibrary({ kind: "import", tab: "import", blob: blob, filename: name, prompt: name }); } catch (e) {}
  const url = URL.createObjectURL(blob);
  $("refPreview").src = url;
  $("refName").textContent = `${name || "image"} · ${(blob.size / 1024).toFixed(0)} KB`;
  updateRefDims();
  $("dzEmpty").hidden = true;
  $("dzFilled").hidden = false;
  $("repaintBtn").hidden = false;
  if (state.repaint) {
    state.repaint = null;
    $("repaintBtn").classList.remove("on");
    $("repaintBtn").textContent = "Repaint area";
  }
  // A reference picture changes the audit completely: with one, an NSFW run has
  // a photo to send somewhere.
  if (state.safetyReady) renderEgress();
}

function clearRefImage() {
  if ($("refPreview").src) URL.revokeObjectURL($("refPreview").src);
  state.refImage = null;
  state.repaint = null;
  clearFramePicker();
  syncImportBar(false);
  if (state.result?.imported) {
    state.result = null;
    if ($("resultBar")) $("resultBar").hidden = true;
  }
  $("refPreview").removeAttribute("src");
  $("refDims").textContent = "";
  $("dzEmpty").hidden = false;
  $("dzFilled").hidden = true;
  $("repaintBtn").hidden = true;
  playerReset();
  if (state.safetyReady) renderEgress();
}

function setImgEditImage(blob, name) {
  state.imgEditImage = blob;
  state.imgEditName = name || "image";
  try { saveBlobToLibrary({ kind: "import", tab: "import", blob, filename: name, prompt: name }); } catch (e) {}
  state.imgEditWH = null;
  const url = URL.createObjectURL(blob);
  $("imgRefPreview").src = url;
  $("imgRefName").textContent = `${name || "image"} · ${(blob.size / 1024).toFixed(0)} KB`;
  $("imgRefDims").textContent = "";
  $("imgDzEmpty").hidden = true;
  $("imgDzFilled").hidden = false;
  naturalSize(blob).then((wh) => {
    if (!wh || state.imgEditImage !== blob) return;
    state.imgEditWH = wh;
    $("imgRefDims").textContent = `${wh[0]}×${wh[1]}`;
    syncImgDims();
  });
  try {
    for (const old of state.imgResults || []) { try { if (String(old.by || "") === "import" && old.url) URL.revokeObjectURL(old.url); } catch {} }
  } catch {}
  state.imgResults = [{ blob, url, w: 0, h: 0, seed: "import", by: "import" }];
  state.imgSelected = 0;
  naturalSize(blob).then((wh) => {
    const r = state.imgResults?.[0];
    if (!r || r.blob !== blob) return;
    if (wh) { r.w = wh[0]; r.h = wh[1]; }
    try { window.__imgGridSync?.(); } catch {}
  });
  try { window.__imgGridSync?.(); } catch {}
  toast("Imported image is live on the canvas — upscale + encode below, or Save keeps a Library copy.");
}

function clearImgEditImage() {
  try {
    if ($("imgRefPreview").src) URL.revokeObjectURL($("imgRefPreview").src);
  } catch {}
  state.imgEditImage = null;
  state.imgEditWH = null;
  $("imgRefPreview").removeAttribute("src");
  $("imgRefDims").textContent = "";
  $("imgDzEmpty").hidden = false;
  $("imgDzFilled").hidden = true;
  syncImgDims();
}

function syncImgDims() {
  const el = $("imgDimsOut");
  if (!el) return;
  try {
    const [w, h] = imgDims(state.imgAspect, state.imgSize, state.imgAspect === "original" ? state.imgEditWH : null);
    el.textContent = `${w}×${h}`;
  } catch {
    el.textContent = "";
  }
}

const CROP_RATIOS = [
  { id: "original", label: "Original — free", r: 0 },
  { id: "1:1", label: "1:1 square", r: 1 },
  { id: "2:3", label: "2:3 portrait", r: 2 / 3 },
  { id: "3:2", label: "3:2 landscape", r: 3 / 2 },
  { id: "3:4", label: "3:4 portrait", r: 3 / 4 },
  { id: "4:3", label: "4:3 landscape", r: 4 / 3 },
  { id: "4:5", label: "4:5 portrait", r: 4 / 5 },
  { id: "5:4", label: "5:4 landscape", r: 5 / 4 },
  { id: "9:16", label: "9:16 vertical", r: 9 / 16 },
  { id: "16:9", label: "16:9 widescreen", r: 16 / 9 },
  { id: "9:21", label: "9:21 tall", r: 9 / 21 },
  { id: "21:9", label: "21:9 cinematic", r: 21 / 9 },
];

let cropBox = { x: 0, y: 0, w: 1, h: 1 };
let cropDrag = null;
let cropUrl = "";
let cropTarget = "ref";

function cropRatio() {
  return CROP_RATIOS.find((c) => c.id === $("cropRatioSel")?.value) || CROP_RATIOS[0];
}

function loadRefEl(blob, timeoutMs = 15000) {
  return new Promise((res) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    let done = false;
    const finish = (out) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      res(out);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    img.onload = () => finish(img);
    img.onerror = () => finish(null);
    img.src = url;
  });
}

async function updateRefDims() {
  const el = $("refDims");
  if (!el) return;
  const blob = state.refImage;
  if (!blob) {
    el.textContent = "";
    return;
  }
  const img = await loadRefEl(blob);
  if (!img || state.refImage !== blob) return;
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (!w || !h) return;
  const ratio = w / h;
  const near = CROP_RATIOS.find((c) => c.r && Math.abs(c.r - ratio) / c.r < 0.02);
  el.textContent = `${w}×${h} · ${near ? near.label : ratio.toFixed(2) + ":1"}`;
}

function fitCropBox() {
  const r = cropRatio().r;
  if (!r) {
    cropBox = { x: 0, y: 0, w: 1, h: 1 };
    return;
  }
  const img = $("cropImg");
  const dw = img.clientWidth || 1;
  const dh = img.clientHeight || 1;
  const disp = dw / dh;
  let w = 1;
  let h = 1;
  if (disp > r) {
    h = 1;
    w = (r * dh) / dw;
  } else {
    w = 1;
    h = (dw / r) / dh;
  }
  cropBox = { x: (1 - w) / 2, y: (1 - h) / 2, w, h };
}

function paintCrop() {
  const img = $("cropImg");
  const box = $("cropBox");
  if (!img || !box) return;
  const dw = img.clientWidth || 0;
  const dh = img.clientHeight || 0;
  box.style.left = `${cropBox.x * dw}px`;
  box.style.top = `${cropBox.y * dh}px`;
  box.style.width = `${cropBox.w * dw}px`;
  box.style.height = `${cropBox.h * dh}px`;
  const info = $("cropInfo");
  if (info) {
    const nw = img.naturalWidth || 0;
    const nh = img.naturalHeight || 0;
    info.textContent =
      nw && nh
        ? `${Math.round(cropBox.w * nw)}×${Math.round(cropBox.h * nh)} px · ${cropRatio().label}`
        : cropRatio().label;
  }
}

function cropFrac(e) {
  const r = $("cropImg").getBoundingClientRect();
  return {
    x: Math.min(1, Math.max(0, (e.clientX - r.left) / (r.width || 1))),
    y: Math.min(1, Math.max(0, (e.clientY - r.top) / (r.height || 1))),
  };
}

function cropSourceBlob() {
  return cropTarget === "imgEdit" ? state.imgEditImage : state.refImage;
}

function openCrop() {
  const src = cropSourceBlob();
  if (!src) {
    toast("Import an image first.", "warn");
    return;
  }
  if (cropUrl) URL.revokeObjectURL(cropUrl);
  cropUrl = URL.createObjectURL(src);
  const img = $("cropImg");
  img.onload = () => {
    fitCropBox();
    paintCrop();
    requestAnimationFrame(() => {
      if ($("cropDlg")?.open) {
        fitCropBox();
        paintCrop();
      }
    });
  };
  img.onerror = () => {
    toast("Couldn't read the image.", "err");
    closeCrop();
  };
  img.src = cropUrl;
  const dlg = $("cropDlg");
  if (dlg.open) return;
  if (typeof dlg.showModal === "function") dlg.showModal();
  else dlg.setAttribute("open", "");
}

function closeCrop() {
  const dlg = $("cropDlg");
  if (dlg.open) dlg.close();
  else dlg.removeAttribute("open");
  if (cropUrl) {
    URL.revokeObjectURL(cropUrl);
    cropUrl = "";
  }
}

async function applyCrop() {
  const blob = cropSourceBlob();
  if (!blob) {
    closeCrop();
    return;
  }
  const btn = $("cropApplyBtn");
  if (btn?.disabled) return;
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Cropping…";
  }
  try {
    const img = await loadRefEl(blob);
    if (!img) {
      toast("Couldn't read the image.", "err");
      return;
    }
    const sx = Math.round(cropBox.x * img.naturalWidth);
    const sy = Math.round(cropBox.y * img.naturalHeight);
    const sw = Math.max(1, Math.round(cropBox.w * img.naturalWidth));
    const sh = Math.max(1, Math.round(cropBox.h * img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = sw;
    c.height = sh;
    c.getContext("2d").drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    const out = await new Promise((res) => {
      try {
        c.toBlob((b) => res(b), "image/jpeg", 0.92);
      } catch {
        res(null);
      }
    });
    if (!out) {
      toast("Couldn't crop the image.", "err");
      return;
    }
    const old = cropTarget === "imgEdit" ? state.imgEditName || "image" : state.refImageName || "image";
    const nm = String(old).replace(/\.[a-z]+$/i, "") + "-crop.jpg";
    closeCrop();
    if (cropTarget === "imgEdit") {
      cropTarget = "ref";
      setImgEditImage(out, nm);
    } else {
      setRefImage(out, state.refImageName = nm);
    }
    logLine(`reference cropped → ${sw}×${sh}`);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Apply crop";
    }
  }
}

function bindCropBox() {
  const box = $("cropBox");
  if (!box || box.dataset.bound) return;
  box.dataset.bound = "1";
  box.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    const grip = e.target.closest("[data-grip]")?.dataset.grip || "";
    try {
      box.setPointerCapture?.(e.pointerId);
    } catch {}
    cropDrag = { grip, sx: e.clientX, sy: e.clientY, start: { ...cropBox } };
  });
  box.addEventListener("pointermove", (e) => {
    if (!cropDrag) return;
    const img = $("cropImg");
    const dw = img.clientWidth || 1;
    const dh = img.clientHeight || 1;
    const dx = (e.clientX - cropDrag.sx) / dw;
    const dy = (e.clientY - cropDrag.sy) / dh;
    const r = cropRatio().r;
    if (!cropDrag.grip) {
      const s = cropDrag.start;
      cropBox.x = Math.min(1 - s.w, Math.max(0, s.x + dx));
      cropBox.y = Math.min(1 - s.h, Math.max(0, s.y + dy));
      paintCrop();
      return;
    }
    const g = cropDrag.grip;
    const ax = g.includes("e") ? cropDrag.start.x : cropDrag.start.x + cropDrag.start.w;
    const ay = g.includes("s") ? cropDrag.start.y : cropDrag.start.y + cropDrag.start.h;
    let px = cropFrac(e).x;
    let py = cropFrac(e).y;
    let w = Math.abs(px - ax);
    let h = Math.abs(py - ay);
    if (r) {
      if (w / Math.max(h, 1e-6) > r) w = h * r;
      else h = w / r;
      px = ax + Math.sign(cropFrac(e).x - ax || (g.includes("w") ? -1 : 1)) * w;
      py = ay + Math.sign(cropFrac(e).y - ay || (g.includes("n") ? -1 : 1)) * h;
      px = Math.min(1, Math.max(0, px));
      py = Math.min(1, Math.max(0, py));
      w = Math.abs(px - ax);
      h = Math.abs(py - ay);
      if (w / Math.max(h, 1e-6) > r) {
        w = h * r;
        px = ax + Math.sign(py - ay || 1) * 0 + (px >= ax ? w : -w);
      } else {
        h = w / r;
        py = ay + (py >= ay ? h : -h);
      }
    }
    w = Math.max(0.05, Math.abs(px - ax));
    h = Math.max(0.05, Math.abs(py - ay));
    cropBox = { x: Math.min(ax, px), y: Math.min(ay, py), w, h };
    if (cropBox.x + cropBox.w > 1) {
      cropBox.w = 1 - cropBox.x;
      if (r) cropBox.h = cropBox.w / r;
    }
    if (cropBox.y + cropBox.h > 1) {
      cropBox.h = 1 - cropBox.y;
      if (r) cropBox.w = cropBox.h * r;
    }
    paintCrop();
  });
  const end = () => {
    cropDrag = null;
  };
  box.addEventListener("pointerup", end);
  box.addEventListener("pointercancel", end);
}

async function acceptFile(file) {
  if (!file) return;
  try {
    const guard = await import("./guard.js");
    const cap = /video|\.mp4|\.webm|\.mov|\.mkv|\.gif/i.test((file.type || "") + " " + (file.name || "")) ? 100 : 12;
    const scan = await guard.scanFile(file, { maxMb: cap });
    if (!scan.ok) { toast(scan.reason, "warn"); return; }
  } catch {}
  const isVideo = file.type.startsWith("video/") || /\.(mp4|webm|mov|mkv|gif)$/i.test(file.name || "");
  if (isVideo) {
    if (file.size > 100 * 1024 * 1024) {
      toast("That video is over 100 MB - try a shorter clip.", "warn");
      return;
    }
    $("dzEmpty").hidden = true;
    $("dzFilled").hidden = false;
    $("refName").textContent = `${file.name || "video"} · reading…`;
    $("refDims").textContent = "";
    try {
      const vid = await import("./video.js");
      const info = await vid.probe(file);
      const frame = await vid.extractFrame(file, "first");
      const clean = await stripMetadata(frame, { maxDim: 1280 });
      setRefImage(clean && clean.size ? clean : frame, (file.name || "video") + " · first frame");
      state.refVideo = { blob: file, name: file.name || "video", duration: info.duration, width: info.width, height: info.height };
      showFramePicker();
      const dur = Number(info.duration);
      logLine(`reference video · ${file.name || "video"} · ${info.width}x${info.height}${Number.isFinite(dur) && dur > 0 ? ` · ${dur.toFixed(1)}s` : ""} → starter is its first frame`);
      try { await saveBlobToLibrary({ kind: "import", tab: "import", blob: file, filename: file.name || "video", prompt: file.name || "imported video" }); } catch {}
      playImportedVideo();
      syncImportBar(true, file.name || "video");
    } catch (e) {
      $("dzEmpty").hidden = false;
      $("dzFilled").hidden = true;
      $("refName").textContent = "";
      $("refDims").textContent = "";
      clearFramePicker();
      toast("Couldn't read that video: " + (e?.message || e), "err");
    }
    return;
  }
  if (!file.type.startsWith("image/")) {
    toast("That file isn't an image or video.", "warn");
    return;
  }
  if (file.size > 12 * 1024 * 1024) toast("Image is over 12 MB — it'll be downscaled.", "warn");
  $("dzEmpty").hidden = true;
  $("dzFilled").hidden = false;
  $("refName").textContent = `${file.name || "image"} · reading…`;
  $("refDims").textContent = "";
  // Re-encode through a canvas before the picture is stored or sent anywhere.
  // One pass does both jobs: it fits the picture to 1280px, and it drops every
  // tag the file arrived with — the camera, the exact timestamp, the GPS fix,
  // the software that wrote it. What is left is pixels. (`stripMetadata` in
  // src/image.js; a browser that cannot decode the file gets it back as-is,
  // because losing the picture would be worse than carrying its tag.)
  const clean = await stripMetadata(file, { maxDim: 1280 });
  const blob = clean && clean.size ? clean : file;
  setRefImage(blob, file.name);
  state.refVideo = null;
  clearFramePicker();
  if (blob !== file) {
    logLine(
      `reference picture cleaned · ${(file.size / 1024).toFixed(0)} KB → ${(blob.size / 1024).toFixed(0)} KB · metadata stripped`
    );
  }
}

/* ------------------------------------------------------------------- stage */

/* ------------------------------------------------- video frame picker */

let frameVideoUrl = "";

/** Show the scrubber for the imported video so any frame can be the starter. */
function showFramePicker() {
  const src = state.refVideo;
  const wrap = $("framePickWrap");
  const video = $("frameVideo");
  if (!src || !wrap || !video) return;
  if (frameVideoUrl) URL.revokeObjectURL(frameVideoUrl);
  frameVideoUrl = URL.createObjectURL(src.blob);
  video.src = frameVideoUrl;
  video.currentTime = 0;
  $("frameRange").value = "0";
  syncFrameTime();
  wrap.hidden = false;
}

function clearFramePicker() {
  state.refVideo = null;
  if (frameVideoUrl) {
    URL.revokeObjectURL(frameVideoUrl);
    frameVideoUrl = "";
  }
  const video = $("frameVideo");
  if (video) video.removeAttribute("src");
  if ($("framePickWrap")) $("framePickWrap").hidden = true;
}

function syncFrameTime() {
  const out = $("frameTimeOut");
  const video = $("frameVideo");
  if (!out || !video) return;
  const dur = Number(state.refVideo?.duration) || Number(video.duration) || 0;
  const t = Number(video.currentTime) || 0;
  out.textContent = dur > 0 ? `t=${t.toFixed(2)}s / ${dur.toFixed(2)}s` : `t=${t.toFixed(2)}s`;
}

function seekFrameVideo(frac) {
  const video = $("frameVideo");
  const src = state.refVideo;
  if (!video || !src) return;
  const dur = Number(src.duration) || Number(video.duration) || 0;
  if (!(dur > 0)) return;
  const t = Math.min(Math.max(0, Number(frac) || 0), 1) * dur;
  try {
    video.currentTime = t;
  } catch {}
}

/** Grab whatever frame the picker is showing and make it the starter image. */
async function useCurrentFrame() {
  const video = $("frameVideo");
  const src = state.refVideo;
  if (!video || !src) return;
  const btn = $("frameUseBtn");
  if (btn?.disabled) return;
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Reading frame…";
  }
  try {
    const w = video.videoWidth || src.width || 640;
    const h = video.videoHeight || src.height || 360;
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    c.getContext("2d").drawImage(video, 0, 0, w, h);
    const shot = await new Promise((res) => {
      try {
        c.toBlob((b) => res(b), "image/jpeg", 0.93);
      } catch {
        res(null);
      }
    });
    if (!shot) {
      toast("Couldn't read that frame.", "err");
      return;
    }
    const clean = await stripMetadata(shot, { maxDim: 1280 });
    const t = Number(video.currentTime) || 0;
    setRefImage(clean && clean.size ? clean : shot, `${src.name} · t=${t.toFixed(2)}s`);
    logLine(`starter frame ← ${src.name} · t=${t.toFixed(2)}s · ${w}×${h}`);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Use this frame";
    }
  }
}

function showBusy(on) {
  $("screenBusy").hidden = !on;
  $("generateBtn").hidden = on;
  $("cancelBtn").hidden = !on;
}

/** Load the just-imported video into the Stage player so it plays live and
 *  can be upscaled / encoded straight from the result bar. Works whether or
 *  not it was saved to the Library. */
function playImportedVideo() {
  const src = state.refVideo;
  if (!src || !(src.blob instanceof Blob)) {
    toast("Import a video first.", "warn");
    return;
  }
  try {
    const url = URL.createObjectURL(src.blob);
    const dur = Number(src.duration) || 0;
    playerLoad(url, { duration: dur > 0 ? dur : undefined });
    state.result = {
      blob: src.blob,
      filename: src.name || "imported-video",
      clips: 1,
      provider: null,
      providerLabel: "imported video",
      prompt: src.name || "imported video",
      negative: "",
      seed: "import",
      duration: dur,
      aspect: state.aspect,
      quality: state.quality,
      imported: true,
      meta: { width: src.width || 0, height: src.height || 0, duration: dur },
      elapsed: 0,
    };
    state.partial = null;
    if ($("resumeBtn")) $("resumeBtn").hidden = true;
    if ($("resultBar")) $("resultBar").hidden = false;
    const dims = `${src.width || "?"}×${src.height || "?"}`;
    if ($("resultInfo")) {
      $("resultInfo").innerHTML =
        `<strong style="color:#cfd4e6">imported video</strong> · ${dims}` +
        (dur > 0 ? ` · ${dur.toFixed(1)}s` : "") +
        ` · pick Export + Upscale below, then Download.<br><span class="mono tiny" style="color:#8f96b3">${src.name || ""}</span>`;
    }
    setTags([{ text: "imported" }, { text: dims }, ...(dur > 0 ? [{ text: `${dur.toFixed(1)}s` }] : [])]);
    logLine(`imported video ready in the player · ${src.name || "video"} · upscale + encode from the result bar`);
  } catch (e) {
    toast("Couldn't play that video: " + (e?.message || e), "err");
  }
}

async function saveImportedVideo() {
  const src = state.refVideo;
  if (!src || !(src.blob instanceof Blob)) {
    toast("Import a video first.", "warn");
    return;
  }
  const btn = $("saveImportBtn");
  const prev = btn ? btn.textContent : "";
  if (btn) { btn.disabled = true; btn.textContent = "Saving…"; }
  try {
    const out = await saveBlobToLibrary({ kind: "import", tab: "import", blob: src.blob, filename: src.name || "video", prompt: src.name || "imported video" });
    const note = $("importSaveNote");
    if (out?.locked) {
      toast("The vault is locked — enter your passphrase in Settings → Content safety.", "warn");
      if (note) { note.hidden = false; note.textContent = "Library is locked — video stays in the player only."; }
    } else if (out?.ok) {
      toast("Imported video saved to the Library (Imports).");
      if (note) { note.hidden = false; note.textContent = "Saved to Library → Imports. The player copy works with or without it."; }
      syncImportBar(true, src.name);
    } else {
      toast("Couldn't save that video.", "err");
    }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = prev || "💾 Save to Library"; }
  }
}

function syncImportBar(hasVideo, name) {
  if ($("playImportBtn")) $("playImportBtn").hidden = !hasVideo;
  if ($("saveImportBtn")) $("saveImportBtn").hidden = !hasVideo;
  const note = $("importSaveNote");
  if (note && hasVideo && note.hidden) {
    note.hidden = false;
    note.textContent = `“${name || "video"}” is live in the player — upscale + encode below, Save keeps a Library copy.`;
  }
  if (note && !hasVideo) note.hidden = true;
}

function setProgressUI(p, label) {
  $("busyBar").style.width = `${Math.round(Math.max(0, Math.min(1, p)) * 100)}%`;
  if (label) $("busyStage").textContent = label;
}

function renderSegDots(total, done, now) {
  const host = $("segDots");
  host.innerHTML = "";
  if (total <= 1) return;
  for (let i = 0; i < total; i++) {
    const d = document.createElement("i");
    if (i < done) d.className = "done";
    else if (i === now) d.className = "now";
    host.appendChild(d);
  }
}

function setTags(tags) {
  const host = $("stageTags");
  host.innerHTML = "";
  for (const t of tags) {
    const s = document.createElement("span");
    s.className = "tag" + (t.hot ? " hot" : "");
    s.textContent = t.text;
    host.appendChild(s);
  }
}

function slugPrompt(s, max = 28) {
  const slug = String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
  return slug || "clip";
}

function makeRunName(prompt) {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${String(d.getFullYear()).slice(2)}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  const rand = Math.random().toString(36).slice(2, 6);
  return `${slugPrompt(prompt)}-${stamp}-${rand}`;
}

function extFor(blob) {
  return blob?.type?.includes("mp4") ? "mp4" : "webm";
}

function blobToDataURL(blob) {
  return new Promise((res, rej) => {
    try {
      const r = new FileReader();
      r.onload = () => res(String(r.result || ""));
      r.onerror = () => rej(new Error("unreadable"));
      r.readAsDataURL(blob);
    } catch (e) { rej(e); }
  });
}

async function videoPoster(blob) {
  try {
    const shot = await extractFrame(blob, "first");
    const url = await blobToDataURL(shot);
    return url && url.startsWith("data:") ? url : null;
  } catch { return null; }
}

async function repairPoster(it, isImg) {
  const rec = await getHistory(it.key);
  const blob = rec?.video;
  if (!(blob instanceof Blob) || !blob.size) return "";
  if (isImg || String(blob.type || rec?.mime || it.mime || "").startsWith("image/")) return URL.createObjectURL(blob);
  const url = await makePoster(blob).catch(() => null);
  if (url) updateHistory(it.key, { poster: url }).catch(() => {});
  return url || "";
}

async function saveTake(blob, ev) {
  if (!blob || !blob.size) return;
  if (!state.runName) {
    state.runName = makeRunName($("promptInput").value.trim());
    state.takeCount = 0;
  }
  state.takeCount += 1;
  const n = state.takeCount;
  const filename = `${state.runName}_take${String(n).padStart(2, "0")}.${extFor(blob)}`;
  const id = uid();
  logLine(`take ${n} → sandbox · ${filename} (${(blob.size / 1e6).toFixed(2)} MB)`);
  try {
    const poster = await videoPoster(blob);
    const stored = await addHistory({
      id,
      ts: Date.now(),
      kind: "take",
      sandbox: true,
      runName: state.runName,
      takeIndex: n,
      filename,
      prompt: $("promptInput").value.trim(),
      userPrompt: $("promptInput").value.trim(),
      negative: "",
      provider: ev.provider?.id,
      providerLabel: ev.provider?.label || $("busyProvider").textContent || "take",
      seed: state.result?.seed ?? null,
      duration: ev.duration || 0,
      actualDuration: ev.duration || 0,
      aspect: state.aspect,
      quality: state.quality,
      cameraMove: $("moveSel").value,
      cameraAngle: $("angleSel").value,
      tracking: $("trackSel")?.value || "off",
      trackStrength: Number($("trackStrengthRange")?.value ?? 0.6),
      style: $("styleSel").value,
      nsfw: $("nsfwToggle").checked,
      clips: 1,
      ext: extFor(blob),
      mime: blob.type,
      size: blob.size,
      poster,
      video: blob,
    });
    if (stored?.locked) {
      logLine(`take ${n} not saved — the vault is locked`, "warn");
      return;
    }
  } catch {}
}

function imgExtFor(blob) {
  const t = String(blob?.type || "");
  if (t.includes("png")) return "png";
  if (t.includes("webp")) return "webp";
  return "jpg";
}

/** A small poster frame for a library card, so the list never decrypts megabytes per thumbnail. */
async function imageThumb(blob, maxSide = 384) {
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise((res, rej) => {
      const el = new Image();
      el.onload = () => res(el);
      el.onerror = () => rej(new Error("unreadable"));
      el.src = url;
    });
    const s = Math.min(1, maxSide / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round((img.naturalWidth || 1) * s));
    c.height = Math.max(1, Math.round((img.naturalHeight || 1) * s));
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.72);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Auto-save generated stills to the library — the image twin of the video
 * studio's takes/finals split. One image lands in Finals; every variation of
 * a multi-image batch lands in the Sandbox. Returns the sentence the result
 * note should end with, or "" when the vault is locked.
 */
async function saveImagesToLibrary(out, meta) {
  const items = (out?.items || []).filter((it) => it?.blob?.size);
  if (!items.length) return "";
  const multi = items.length > 1;
  const named = document.getElementById("imgNameInput")?.value?.trim() || "";
  const runName = named ? slugName(named).slice(0, 50) + "-" + Date.now().toString(36) : makeRunName(meta.prompt);
  const saveMeta = readSaveMeta("img", "image");
  let n = 0;
  for (const item of items) {
    n += 1;
    const blob = item.blob;
    const kind = multi ? "image-take" : "image";
    const ext = imgExtFor(blob);
    const filename = multi
      ? `${runName}_take${String(n).padStart(2, "0")}.${ext}`
      : `${runName}_Final.${ext}`;
    const id = uid();
    let poster = "";
    try {
      poster = await imageThumb(blob);
    } catch {}
    const stored = await addHistory({
      id,
      ts: Date.now(),
      kind,
      sandbox: multi,
      name: named.slice(0, 80),
      userCat: multi ? "" : saveMeta.userCat,
      runName,
      takeIndex: multi ? n : 0,
      filename,
      prompt: meta.prompt,
      userPrompt: meta.prompt,
      negative: meta.negative || "",
      provider: item.model,
      providerLabel: item.by,
      seed: item.seed ?? null,
      duration: 0,
      actualDuration: 0,
      aspect: state.imgAspect,
      quality: state.imgSize,
      cameraMove: "",
      cameraAngle: "",
      tracking: "",
      style: "",
      nsfw: state.imgNsfw,
      character: saveMeta.character,
      scene: saveMeta.scene,
      clips: 1,
      ext,
      mime: blob.type || "image/jpeg",
      size: blob.size,
      width: item.w || 0,
      height: item.h || 0,
      poster,
      video: blob,
    });
    if (stored?.locked) return "";
  }
  return multi ? `All ${items.length} variations auto-saved to the Sandbox.` : "Saved to the Library finals.";
}

async function handleResult(res, opts = {}) {
  state.result = res;
  const url = URL.createObjectURL(res.blob);
  playerLoad(url, { duration: res.meta?.duration || res.duration });

  // What the file really is, rather than what was asked for. The two are only
  // the same when the models cooperated, and saying "5s" over a 3.25s file is
  // the one thing a run must never do — the request is a promise the engine now
  // works to keep (see `stitch`/`retimeClip`), but a run whose routes all
  // refused is reported at its real length.
  const realDur = Number(res.meta?.duration) || res.duration;
  const shortBy = Math.max(0, res.duration - realDur);
  const isShort = !!res.meta?.short || shortBy > 0.15;

  // What "finish this clip" needs, kept in memory until the next run: the beats
  // already rendered, the frame the chain reached, and the storyboard's drawn
  // stills — so continuing never pays for a still that already exists, and the
  // reference picture stays attached as the identity anchor (see `run`).
  const partial =
    (isShort || res.meta?.short) && res.clipBlobs?.length
      ? {
          clips: res.clipBlobs,
          runName: state.runName,
          takeCount: state.takeCount,
          lastFrame: res.lastFrame || null,
          madeSec: Number(res.madeSec) || 0,
          storyFrames: res.storyFrames || null,
          storySegments: Number(res.storySegments) || 0,
          reachedBoundary: Number(res.reachedBoundary) || 0,
          askScale: Number(res.askScale) || 1,
        }
      : null;
  state.partial = partial;
  $("resumeBtn").hidden = !partial;

  if (!res.filename && opts.save !== false) {
    if (!state.runName) state.runName = makeRunName($("promptInput").value.trim());
    res.filename = `${state.runName}_Final.${extFor(res.blob)}`;
  }

  $("resultBar").hidden = false;
  paintVidGrade();
  const dims = `${res.meta?.width || "?"}×${res.meta?.height || "?"}`;
  const fps = res.meta?.fps ? ` · ${res.meta.fps} fps` : "";
  $("resultInfo").innerHTML =
    `<strong style="color:#cfd4e6">${res.providerLabel}</strong> · ${res.clips} segment${res.clips > 1 ? "s" : ""} · ` +
    `${dims}${fps} · ${res.aspect} · rendered in ${fmtTime(res.elapsed / 1000)} · seed ${res.seed}` +
    (res.meta?.encoder ? ` · ${res.meta.encoder}` : "") +
    (res.nsfw ? ' · <span style="color:#ffb3c0">NSFW</span>' : "") +
    (res.filename ? `<br><span class="mono tiny" style="color:#8f96b3">${res.filename}</span>` : "");

  setTags([
    { text: res.providerLabel },
    { text: res.clips > 1 ? "chained" : "single shot" },
    { text: res.aspect },
    { text: isShort ? `${realDur.toFixed(1)}s of ${res.duration}s` : `${realDur.toFixed(1)}s`, hot: isShort },
    ...(res.meta?.fps ? [{ text: `${res.meta.fps}fps` }] : []),
    ...(res.motion?.beats ? [{ text: "real motion" }] : []),
    ...(res.nsfw ? [{ text: "NSFW", hot: true }] : []),
  ]);

  if (res.offline) {
    resultNote(
      "<strong>This clip came from the on-device renderer.</strong> It is a camera move over your still, not generated video — no new detail was invented. Connect your free GPU server or add a free Hugging Face token to get real motion.",
      "warn"
    );
  } else if (res.stills) {
    resultNote(
      `<strong>No video model would take this run, so the clip is the storyboard's own ${res.stills} drawn stills</strong> — ` +
        `cross-dissolved into a clip over the length you asked for. That is not a consolation prize: on an undress run the ` +
        `clothes come off in those pictures, not in the motion, so the change you asked for is really there. What is missing is ` +
        `generated movement between the steps. Connect your GPU server or add a free Hugging Face token and re-run to have a ` +
        `video model animate the same stills.`,
      "warn"
    );
  } else if (isShort) {
    resultNote(
      `<strong>The clip is ${realDur.toFixed(2)}s, not the ${res.duration}s asked for.</strong> ` +
        `${res.clips} beat${res.clips > 1 ? "s" : ""} were rendered; the routes that could have made the rest refused the job. ` +
        `Press <strong>Finish this clip</strong> below: it keeps these beats, starts from the frame the run reached, keeps your ` +
        `reference picture as the identity anchor, and renders only the ${shortBy.toFixed(1)}s that are missing.`,
      "warn"
    );
  } else if (res.imperfectBeats) {
    resultNote(
      `<strong>${res.imperfectBeats} beat${res.imperfectBeats > 1 ? "s" : ""} could not be rendered cleanly.</strong> ` +
        `${res.rerenders ? `${res.rerenders} re-render${res.rerenders > 1 ? "s" : ""} were tried first. ` : ""}` +
        `Every model tried came back with the same problem (a frozen, melted or re-cast shot), so the best of them was kept ` +
        `rather than leaving a hole in the clip. Press Generate again — a different run reaches different workers.`,
      "warn"
    );
  } else if (res.motion?.beats) {
    resultNote(
      `<strong>Real movement.</strong> Her pose, her expression and the way she moves were taken from a real ` +
        `performance, frame for frame, rather than invented by the model.`,
      "ok"
    );
  } else {
    resultNote("");
  }

  const id = opts.save === false ? null : await saveToLibraryWithNote(res);

  withTimeoutP(filmstrip(res.blob, 8), 30000)
    .then((shots) => {
      const strip = $("filmstrip");
      strip.innerHTML = "";
      for (const s of shots) {
        const i = new Image();
        i.src = s;
        strip.appendChild(i);
      }
      $("stripWrap").hidden = false;
      if (id && shots[0]) updateHistory(id, { poster: shots[0] }).catch(() => {});
    })
    .catch(() => {});

  logLine(
    state.logMode !== "full"
      ? friendlyDone((res.blob.size / 1e6).toFixed(2), realDur.toFixed(1))
      : `done · ${res.providerLabel} · ${(res.blob.size / 1e6).toFixed(2)} MB · ${realDur.toFixed(2)}s` +
          (isShort ? ` of ${res.duration}s asked` : "") +
          (res.imperfectBeats ? ` · ${res.imperfectBeats} beat${res.imperfectBeats > 1 ? "s" : ""} imperfect` : ""),
    isShort || res.imperfectBeats ? "warn" : "ok"
  );
  setChip("ok", "ready");

  // With "Lock seed" on, the seed a render actually used becomes the seed for
  // the next one — so tweaking the prompt explores the same noise instead of a
  // brand-new roll each time.
  if (state.settings.lockSeed && res.seed != null) {
    $("seedInput").value = String(res.seed);
    saveSettings({ seed: String(res.seed) });
  }
}

/**
 * Save a finished clip to the library, and say so when the vault is locked and
 * therefore refused to write it. Saving a clip in the clear because the vault
 * happened to be shut would be exactly the leak this is meant to prevent, so it
 * is better to keep nothing and explain.
 */
async function saveToLibraryWithNote(res) {
  const out = await saveToLibrary(res);
  if (out?.locked) {
    toast(
      "Clip not saved — the vault is locked. Enter your passphrase in Settings → Content safety, then run again to keep it.",
      "warn",
      9000
    );
    return null;
  }
  return out?.id || null;
}

async function saveToLibrary(res) {
  const id = uid();
  const ext = extFor(res.blob);
  let poster = null;
  try { poster = await videoPoster(res.blob); } catch {}
  const meta = readSaveMeta("vid", "video");
  if (meta.name && !res.filename) res.filename = meta.filename;
  const stored = await addHistory({
    id,
    ts: Date.now(),
    kind: "final",
    sandbox: false,
    name: meta.name.slice(0, 80),
    userCat: meta.userCat,
    character: meta.character,
    scene: meta.scene,
    runName: meta.name || state.runName,
    filename: res.filename || meta.filename || `${state.runName || makeRunName($("promptInput").value.trim())}_Final.${ext}`,
    prompt: res.prompt,
    userPrompt: $("promptInput").value.trim(),
    negative: res.negative,
    provider: res.provider?.id,
    providerLabel: res.providerLabel,
    seed: res.seed,
    duration: res.duration,
    actualDuration: res.meta?.duration,
    aspect: res.aspect,
    quality: res.quality,
    cameraMove: res.cameraMove,
    cameraAngle: res.cameraAngle,
    tracking: res.tracking || "off",
    trackStrength: res.trackStrength ?? 0.6,
    style: res.style,
    nsfw: res.nsfw,
    clips: res.clips,
    ext: res.blob.type.includes("mp4") ? "mp4" : "webm",
    mime: res.blob.type,
    size: res.blob.size,
    poster,
    video: res.blob,
  });
  if (stored?.locked) return { id: null, locked: true };
  return { id, encrypted: !!stored?.encrypted };
}

function withTimeoutP(p, ms) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);
}

/* -------------------------------------------------------------- generation */

async function publicUpload(blob) {
  const up = await root.uploadPlugin(blob, { expires: Date.now() + 1000 * 60 * 60 * 6 });
  if (up?.error) throw new Error(up.error);
  if (!up?.url) throw new Error("upload failed");
  return up.url;
}

/**
 * Was this run *blocked* — stopped by the pool rather than by the request?
 *
 * The distinction matters because the two want different things. A bad input
 * (no prompt, an unreadable picture) wants the user to change something. A
 * block is the opposite: it is the environment the run happened in, and the
 * useful answer is to clean that environment and move. These are the kinds the
 * engine raises only once everything it could reach has refused.
 */
function isBlockedError(e) {
  const kind = e?.kind;
  if (kind === "quota" || kind === "empty") return true;
  const msg = String(e?.message || "");
  return (
    (kind === "input" || kind === "safety") &&
    /storyboard could not draw|allowance|every model|every route|refused the job|No video was produced/i.test(msg)
  );
}

/**
 * The automatic half of **Reset**.
 *
 * A blocked run has already changed the app's own state in a way that makes the
 * *next* run more likely to fail too: the bench is full of the models that just
 * refused, the router has written down that this address got nothing, and the
 * run's traces are sitting in the browser. So when a run is blocked, the app
 * now resets itself before handing back control — wipes the traces and the
 * route records, clears the bench, and steps to the next address — so pressing
 * Generate again starts from somewhere new instead of inheriting the refusal.
 *
 * It deliberately does **not** touch the saved library: an automatic action must
 * never delete the user's work. The Reset button, run by hand, can.
 */
async function autoResetAfterBlocked(kind) {
  const s = state.settings;
  if (!s.autoReset) return;
  let report = null;
  try {
    report = await fullReset({ traces: true, quota: true, history: false, forgetGpuBlock: false });
  } catch (err) {
    logLine(`auto-reset could not wipe the traces: ${err.message}`, "warn");
  }
  state.cooldowns = {};
  const addresses = Math.max(1, rotatableCount(s));
  if (addresses > 1) {
    s.relayIndex = (Math.abs(Number(s.relayIndex) || 0) + 1) % addresses;
    await saveSettings({ relayIndex: s.relayIndex });
  }
  // What to do next depends on *whose* allowance ran out. A token bills the
  // whole daily ZeroGPU allowance to the Hugging Face account, so "add a relay"
  // — the advice that is right for an anonymous run — is simply wrong here:
  // the next address is charged to the same account and refuses just as fast.
  const accountAllowance = !!zeroGpuBlockInfo()?.withToken;
  const where = accountAllowance
    ? "the free GPU allowance is spent for your Hugging Face account, which no address change brings back before the daily reset — run the free GPU server (Settings → Where the rendering happens) to keep generating today, or clear the token to fall back on your address's own anonymous share"
    : addresses > 1
    ? `stepped to address ${(Math.abs(Number(s.relayIndex) || 0) % addresses) + 1} of ${addresses}`
    : "there is only one address configured — add a relay (Settings → Privacy & IP rotation) or switch your VPN to get a fresh per-address allowance";
  logLine(`auto-reset after a ${kind === "empty" ? "spent pool" : kind} block · ${report ? describeFullReset(report) : "bench cleared"} · ${where}`, "ok");
  toast(
    `Blocked — the app reset itself: ${report ? describeFullReset(report) : "bench cleared"}, and it ${where}. Press Generate again.`,
    "ok",
    10000
  );
}

/* --------------------------------------------------------------- reset */

/**
 * The **Reset** dialog. Reset is the one button that puts the app back to a
 * state where a run can succeed again, and it is deliberately explicit about
 * what it removes, because one of the things it *can* remove is the user's own
 * saved clips.
 */
function openResetDlg() {
  const s = state.settings;
  const addresses = Math.max(1, rotatableCount(s));
  const host = $("resetDlgState");
  if (host) {
    host.textContent =
      `${addresses} address${addresses === 1 ? "" : "es"} configured · ` +
      `${s.vault !== false ? "library encrypted" : "library stored plainly"} · ` +
      `${s.wipeTraces ? "traces already wiped after every run" : "traces kept after a run"}. ` +
      "Your API keys and settings are never touched — only the records of what has already happened.";
  }
  $("resetParamsChk").checked = true;
  $("resetTracesChk").checked = true;
  $("resetRotateChk").checked = true;
  $("resetLibraryChk").checked = false;
  $("resetDlg").showModal();
}

/** The old "studio reset": the picture, the prompt and the controls back to default. */
function resetStudioParams() {
  clearRefImage();
  $("promptInput").value = "";
  $("negInput").value = "";
  $("moveSel").value = "static";
  $("angleSel").value = "off";
  if ($("trackSel")) { $("trackSel").value = "off"; syncTrackNote(); }
  $("styleSel").value = "cinematic";
  $("stdGenToggle").checked = true;
  setGenMode("stdModeRow", "auto");
  setGenMode("nsfwModeRow", "auto");
  $("seedInput").value = "";
  $("stepsInput").value = "";
  $("nsfwToggle").checked = false;
  state.aspect = "16:9";
  state.quality = "480p";
  state.duration = 5;
  state.durUnit = "s";
  if ($("durRange")) $("durRange").value = 5;
  state.partial = null;
  $("resumeBtn").hidden = true;
  syncGenerators();
  $("promptCount").textContent = "0 chars";
}

/**
 * Do the reset the dialog asked for.
 *
 * `traces` is the browser half (cookies this origin can see, web storage,
 * caches, resource timings) plus the app's own records (the bench and the
 * router's memory of refusals). `history` is the library — off by default,
 * because it is the user's own work and an automatic action must never delete
 * it. `rotate` steps to the next address, which is the half of a reset that
 * actually buys a fresh per-address allowance; the wipe cannot, because the
 * pool counts the *network*, not the browser.
 */
async function doFullReset({ params = true, traces = true, history = false, rotate = true } = {}) {
  const s = state.settings;
  if (params) resetStudioParams();
  let report = null;
  try {
    report = await fullReset({ traces, quota: true, history });
  } catch (err) {
    logLine(`reset could not finish: ${err.message}`, "warn");
  }
  state.cooldowns = {};
  const addresses = Math.max(1, rotatableCount(s));
  if (rotate && addresses > 1) {
    s.relayIndex = (Math.abs(Number(s.relayIndex) || 0) + 1) % addresses;
    await saveSettings({ relayIndex: s.relayIndex });
  }
  const where =
    addresses > 1
      ? rotate
        ? `now on address ${(Math.abs(Number(s.relayIndex) || 0) % addresses) + 1} of ${addresses}`
        : `${addresses} addresses available`
      : "on the only address configured — add a relay or switch your VPN for a fresh allowance";
  const what = report ? describeFullReset(report) : "nothing to clear";
  await doSave();
  logLine(`RESET · ${what}${params ? " · studio parameters reset" : ""} · ${where}`, "ok");
  toast(`Reset — ${what}. You are ${where}.`, "ok", 9000);
}

async function run(opts = {}) {
  if (state.busy) return;
  const s = state.settings;
  // "Finish this clip": continue the run that stopped instead of starting over.
  // The beats it already rendered are carried in, the chain picks up from the
  // frame it reached, and the storyboard's drawn stills come back with it — but
  // the reference image is still `state.refImage`, so every prompt keeps the
  // same identity anchor it had the first time.
  const resume = opts.resume && state.partial ? state.partial : null;
  const prompt = $("promptInput").value.trim();
  if (!state.refImage && !prompt) {
    toast("Add a reference image, or type a prompt so a starting frame can be drawn.", "warn");
    $("promptInput").focus();
    return;
  }
  const gens = genCfg();
  if (!gens.standard.on && !gens.nsfw.on) {
    toast("Both generators are off — turn the Standard generator or the NSFW generator on.", "warn");
    return;
  }
  const chosen = pinnedProvider(gens);
  if (isPaid(chosen) && chosen.requires && !s[chosen.requires]) {
    toast(`${chosen.label} needs an API key — open Settings.`, "warn");
    return;
  }

  state.runName = resume?.runName || makeRunName(prompt);
  state.takeCount = resume?.takeCount || 0;
  state.busy = true;
  state.controller = new AbortController();
  showBusy(true);
  setTags([]);
  $("resultBar").hidden = true;
  $("stripWrap").hidden = true;
  resultNote("");
  // A fresh run starts a fresh clip: the resumable state belongs to the run that
  // produced it, and is only carried when the button asks for it.
  if (!resume) {
    state.partial = null;
    $("resumeBtn").hidden = true;
  }
  setChip("busy", "working");
  try { if (s.communityOptIn === true) logLine(poolStatus(s).text); } catch {}
  try { const pd = poolDecide(s, "large"); if (s.communityOptIn === true && !pd.ok) logLine(pd.reason, "warn"); } catch {}
  setProgressUI(0, "starting");
  $("busyMsg").textContent = "Warming up…";
  $("busyProvider").textContent = chosen
    ? chosen.label
    : gens.standard.on && gens.nsfw.on
    ? "auto · standard + NSFW"
    : gens.nsfw.on
    ? "auto · NSFW pool"
    : "auto · standard pool";
  if (state.logMode !== "full") $("busyProvider").textContent = "AI studio";
  $("busySeg").textContent = "";
  $("busyTime").textContent = "";
  hideQuotaBanner();

  // Start every run fresh: drop the app's own bench record and step to the next
  // address before a single request goes out. The free allowance is metered per
  // address and shared by every free model, so this is what makes a second run
  // possible at all.
  if (s.freshRun) {
    const cleared = await clearCooldowns();
    state.cooldowns = {};
    const addresses = Math.max(1, rotatableCount(s));
    if (addresses > 1) s.relayIndex = (Math.abs(Number(s.relayIndex) || 0) + 1) % addresses;
    if (state.logMode === "full") logLine(`fresh run · ${addresses} address${addresses === 1 ? "" : "es"} · bench cleared (${cleared}) · starting from address ${(Math.abs(Number(s.relayIndex) || 0) % addresses) + 1}`);
  }

  await loadRouteStats();
  // Simple mode reads like a studio call sheet; the wiring (addresses, pool
  // order, routing) only goes in the log on Full.
  if (state.logMode !== "full") {
    logLine(friendlyRunStart(`${fmtDur(state.duration)} · ${state.aspect}`));
  } else {
    logLine(`— new run · ${fmtDur(state.duration)} · ${state.aspect} · ${state.quality}${$("fpsSel").value !== "0" ? ` · ${$("fpsSel").value}fps` : ""} —`);
    {
      const ex = state.refMode === "multi" ? refExtrasList() : [];
      if (ex.length) logLine(`references · starter + ${ex.length} (${ex.map((e) => e.label).join(", ")})`);
    }
    logLine(`privacy · ${s.strictPrivacy ? "relayed" : "direct"} · rotation: ${s.relayMode} · pooled addresses: ${rotatableCount(s)}`);
    logLine(
      `content safety · library ${s.vault !== false ? "encrypted" : "plain"} · leak guard ${s.leakGuard !== false ? "on" : "off"} · ` +
        `explicit routing ${(s.nsfwRouting || "strict") === "widen" ? "every model" : "uncensored routes only"}`
    );
    logLine(
      `generators · standard: ${
        gens.standard.on ? (gens.standard.mode === "selected" ? findAny(gens.standard.pick)?.label || gens.standard.pick : "auto") : "off"
      } · NSFW: ${gens.nsfw.on ? (gens.nsfw.mode === "selected" ? findAny(gens.nsfw.pick)?.label || gens.nsfw.pick : "auto") : "off"}`
    );
  }

  const t0 = performance.now();
  const timer = setInterval(() => {
    $("busyTime").textContent = fmtTime((performance.now() - t0) / 1000);
  }, 500);

  // An empty negative box means the AI decides: it writes one from the prompt
  // before anything renders, so every run carries a negative tuned to the shot
  // instead of one static block. Anything typed stays untouched, and if the AI
  // writer fails the engine's own default still applies.
  let negative = $("negInput").value.trim();
  if (!negative && prompt) {
    $("busyMsg").textContent = "AI is writing the negative prompt…";
    try {
      const decided = await aiPickNegative(prompt);
      negative = (decided && decided.trim()) || $("negInput").value.trim();
      if (negative && state.logMode === "full") logLine(`negative → ${negative.slice(0, 140)}${negative.length > 140 ? "…" : ""}`);
    } catch {
      negative = $("negInput").value.trim();
    }
  }
  try {
    const res = await generate({
      settings: s,
      image: state.refImage,
      extras: state.refMode === "multi" ? refExtrasList() : [],
      prompt,
      negative,
      cameraMove: $("moveSel").value,
      cameraAngle: $("angleSel").value,
      tracking: $("trackSel")?.value || "off",
      trackStrength: Number($("trackStrengthRange")?.value ?? 0.6),
      cameraWords: $("camWordsToggle").checked === true,
      style: $("styleSel").value,
      nsfw: gens.nsfw.on,
      generators: gens,
      aspect: state.aspect,
      quality: state.quality,
      duration: state.duration,
      seed: $("seedInput").value.trim(),
      motionScale: Number($("motionRange").value),
      keyModel: chosen?.tier === "key" ? s.keyModels?.[chosen.id] : undefined,
      customProviders: state.customProviders,
      serverProviders: state.serverProviders,
      cooldowns: state.cooldowns,
      outcomes: routeStatsSync(),
      fps: Number($("fpsSel").value) || null,
      undress: gens.nsfw.on && $("undressToggle").checked,
      repaintBox: state.repaint?.box || null,
      repaintWant: state.repaint?.want || "all",
      repaintAuto: state.repaint ? state.repaint.auto !== false : true,
      publicUpload,
      controller: state.controller,
      onEvent: onEngineEvent,
      resume,
    });
    handleResult(res);
  } catch (e) {
    const msg = e?.message || String(e);
    const hint = e?.hint ? ` ${e.hint}` : "";
    // Simple mode keeps failure lines studio-generic (the actionable part —
    // quota banner, retry toast — is already user-facing). Full keeps the
    // raw error for debugging.
    if (state.logMode !== "full" && e?.kind !== "cancelled" && e?.kind !== "quota") {
      logLine("That take didn't land — press Generate to roll again (Full log has the details).", "err");
    } else {
      logLine(msg + hint, e?.kind === "cancelled" ? "warn" : "err");
    }
    if (e?.kind === "cancelled") {
      setChip("idle", "stopped");
      toast("Run stopped.");
    } else if (e?.kind === "quota") {
      setChip("bad", "quota");
      showQuotaBanner(hint.trim() || undefined);
      toast(msg, "err", 9000);
    } else {
      setChip("bad", "failed");
      toast(msg + hint, "err", 8000);
    }
    // A blocked run resets the app itself before control comes back, so the
    // next Generate starts from a clean slate instead of the wall this one hit.
    if (isBlockedError(e)) await autoResetAfterBlocked(e?.kind);
  } finally {
    clearInterval(timer);
    state.busy = false;
    state.controller = null;
    showBusy(false);
    state.cooldowns = await getCooldowns();
    if (s.wipeTraces) {
      try {
        const report = await wipeTraces();
        logLine(`traces wiped → ${describeWipe(report)}`, "ok");
      } catch (err) {
        logLine(`could not wipe traces: ${err.message}`, "warn");
      }
    }
    // Last, so nothing that runs above can leave the note stale: a key Horde
    // refused is only discovered mid-run, and this is where that shows up.
    renderHordeNote();
  }
}

function onEngineEvent(ev) {
  // Simple log mode reads like a studio call sheet: friendly rotating lines,
  // generic "AI studio" credits, no pool order, relays, model ids or rung
  // labels. Full mode keeps the raw build diary for debugging.
  const simple = state.logMode !== "full";
  switch (ev.type) {
    case "plan":
      $("busyProvider").textContent = simple ? "AI studio" : ev.providers?.[0]?.label || "auto";
      logLine(simple ? friendlyPlan() : `pool → ${(ev.providers || []).map((p) => p.label).join(" → ")}`);
      break;
    case "stage":
      if (simple) {
        const f = friendlyStage(ev.stage);
        $("busyMsg").textContent = f.msg;
        $("busyStage").textContent = f.label;
      } else {
        $("busyMsg").textContent = ev.message || "";
      }
      setProgressUI(state.progress.base, ev.stage);
      if (ev.notice && ev.message && !simple) logLine(ev.message, "warn");
      break;
    case "beats":
      logLine(
        simple
          ? friendlyBeats()
          : `storyboard · drawing ${ev.total} keyframe${ev.total === 1 ? "" : "s"} for ${ev.segments} beat${ev.segments === 1 ? "" : "s"}` +
              (ev.labels?.length ? ` → ${ev.labels.join(" → ")}` : "")
      );
      $("busyStage").textContent = simple ? friendlyStage("storyboard").label : "storyboard";
      break;
    case "beat":
      $("busyMsg").textContent = simple ? friendlyBeat() : ev.message || "Drawing the storyboard…";
      $("busyStage").textContent = simple ? friendlyStage("storyboard").label : "storyboard";
      // A keyframe that could not be drawn is the difference between an undress
      // clip and a dressed one, so it is never left as a silent `0/4` — the
      // reason goes in the log where it can be read (Full mode only — rung
      // labels stay out of the Simple log).
      if (!simple) {
        if (ev.notice && ev.message) logLine(ev.message, "warn");
        else if (ev.failed) logLine(ev.message || `${ev.label || "a keyframe"} could not be drawn`, "warn");
        else if (ev.done && ev.label) logLine(`${ev.label} drawn`, "");
      }
      break;
    case "segment": {
      state.progress.base = (ev.index - 1) / Math.max(1, ev.total);
      state.progress.span = 1 / Math.max(1, ev.total);
      state.progress.segEstMs = (ev.provider?.estSecs || 60) * 1000;
      state.progress.segStart = performance.now();
      $("busyProvider").textContent = simple ? "AI studio" : ev.provider?.label || "";
      $("busySeg").textContent = simple
        ? `part ${ev.index} of ${ev.total}`
        : `seg ${ev.index}/${ev.total} · ${Math.round(Number(ev.duration) * 100) / 100}s`;
      if (simple) $("busyMsg").textContent = friendlySegment(ev.index, ev.total);
      renderSegDots(ev.total, ev.index - 1, ev.index - 1);
      break;
    }
    case "relay":
      if (!simple) {
        logLine(
          `relay → ${ev.used?.label || ev.relay?.label || "relay"}${ev.provider ? ` (${ev.provider})` : ""}` +
            (ev.anonymous ? " · token dropped for this attempt (an anonymous request is metered to the address, not the account)" : ""),
          "warn"
        );
      }
      break;
    case "tick": {
      if (typeof ev.progress === "number") {
        setProgressUI(state.progress.base + state.progress.span * ev.progress);
      } else {
        const frac = Math.min(0.96, ev.elapsed / state.progress.segEstMs);
        setProgressUI(state.progress.base + state.progress.span * frac);
      }
      $("busyTime").textContent = fmtTime(ev.elapsed / 1000);
      break;
    }
    case "progress":
      setProgressUI(ev.value);
      if (ev.label === "stitching") {
        $("busyMsg").textContent = simple ? friendlyStage("stitching").msg : "Blending segments into one clip…";
        $("busyStage").textContent = simple ? friendlyStage("stitching").label : "stitching";
      }
      break;
    case "log":
      // Engine internals (prompt echo, route wiring, storyboard notes) only
      // reach the visible log on Full. Actionable failures still surface
      // through the banner/toast path in the run() catch block.
      if (!simple) logLine(ev.text, ev.level || "");
      break;
    case "clip":
      logLine(
        simple
          ? friendlyClip()
          : `segment ${ev.index} received (${(ev.blob.size / 1e6).toFixed(2)} MB)`,
        "ok"
      );
      saveTake(ev.blob, ev);
      break;
  }
}

/* ---------------------------------------------------------------- enhance */

async function aiGenFallback(opts) {
  const gen = typeof root !== "undefined" ? root.generateText : null;
  if (gen) {
    try { return await gen(opts); }
    catch (e) {
      if (/stop|cancel|abort/i.test(e?.message || "")) throw e;
      return await aiGenPool(opts, e);
    }
  }
  return await aiGenPool(opts, null);
}
async function aiGenPool(opts, firstErr) {
  const instruction = Array.isArray(opts?.instruction) ? opts.instruction.join("\n") : String(opts?.instruction || "");
  const body = { model: "openai", messages: [{ role: "user", content: instruction + (opts?.startWith || "") }], stream: true, private: true };
  let res;
  try { res = await fetch("https://text.pollinations.ai/openai", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); }
  catch (e) { throw firstErr || e; }
  if (!res.ok) throw firstErr || new Error("AI pool busy (" + res.status + ")");
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "", acc = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split("\n\n");
    buf = parts.pop();
    for (const p of parts) {
      const line = p.trim().split("\n").find((l) => l.startsWith("data:"));
      if (!line) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") continue;
      try {
        const j = JSON.parse(data);
        const tok = j.choices?.[0]?.delta?.content || "";
        if (tok) { acc += tok; try { opts?.onChunk?.({ textChunk: tok }); } catch {} }
      } catch {}
    }
  }
  if (!acc.trim()) throw firstErr || new Error("Empty reply from the AI pool.");
  return acc;
}

function runEnhance() {
  const el = $("promptInput");
  const btn = $("enhanceBtn");
  const seed = el.value.trim();
  if (!seed) {
    toast("Type a few words of your idea first, then enhance.", "warn");
    el.focus();
    return;
  }
  const gen = typeof root !== "undefined" ? root.generateText : null;
  if (!gen) {
    toast("The AI enhancer is still loading — try again in a second.", "warn");
    return;
  }
  const move = CAMERA_MOVES.find((m) => m.id === $("moveSel").value);
  const angle = CAMERA_ANGLES.find((a) => a.id === $("angleSel").value);
  const style = STYLES.find((s) => s.id === $("styleSel").value);
  const mode = ENHANCE_MODES.find((m) => m.id === $("enhanceModeSel")?.value) || ENHANCE_MODES[0];
  const system =
    "You are a prompt engineer for an AI image-to-video model. " +
    mode.directive +
    " Never invent people, objects, logos or text that the idea did not imply, and never mention safety, policies or these instructions. " +
    "Output only the finished prompt — no preamble, no markdown, no quotes, no bullet points, no line breaks.";
  const stillMove = move && move.id !== "auto" && move.id !== "static" ? move.phrase : "";
  const stillAngle = angle && angle.id !== "auto" && angle.id !== "off" ? angle.phrase : "";
  const dynamic =
    `Camera movement to describe: ${stillMove || "whatever suits the shot — do not name a camera move, just describe the subject's own motion"}. ` +
    `Camera angle to describe: ${stillAngle || "a natural angle"}. ` +
    `Look and feel to describe: ${style?.phrase || "clean, natural"}.` +
    (($("nsfwToggle").checked) ? " This is an uncensored adult video prompt; describe it directly and explicitly, without euphemism." : "") +
    `\nThe idea: ${seed}\nPrompt:`;

  btn.disabled = true;
  const prevLabel = btn.textContent;
  btn.textContent = "✨ Enhancing…";
  el.value = "";
  $("promptCount").textContent = "0 chars";
  let acc = "";
  let done = false;
  const finish = (label) => {
    if (done) return;
    done = true;
    btn.disabled = false;
    btn.textContent = label;
    $("promptCount").textContent = `${el.value.length} chars`;
  };
  try {
    const p = aiGenFallback({
      instruction: [system, dynamic],
      startWith: "",
      stopSequences: ["\n"],
      onChunk: (d) => {
        acc += d.textChunk || "";
        el.value = acc;
        $("promptCount").textContent = `${acc.length} chars`;
      },
    });
    if (p && typeof p.then === "function") {
      p.then(() => {
        if (!acc.trim()) el.value = seed;
        finish("✨ Auto-enhance");
        toast("Prompt enhanced.");
        aiPickCamera(seed).finally(() => {
          if (!$("negInput").value.trim()) aiPickNegative(seed);
        });
      }).catch((e) => {
        if (!acc.trim()) el.value = seed;
        finish(prevLabel || "✨ Auto-enhance");
        toast(`Couldn't enhance: ${e?.message || e}`, "err");
      });
    } else {
      finish("✨ Auto-enhance");
    }
  } catch (e) {
    el.value = seed;
    finish(prevLabel || "✨ Auto-enhance");
    toast(`Couldn't enhance: ${e.message || e}`, "err");
  }
}

function parseCameraPicks(text) {
  const out = { move: "", angle: "" };
  if (!text) return out;
  const mm = String(text).match(/move\s*=\s*([a-z0-9_]+)/i);
  const am = String(text).match(/angle\s*=\s*([a-z0-9_]+)/i);
  const findId = (list, raw) => {
    if (!raw) return "";
    const low = raw.toLowerCase();
    if (list.some((m) => m.id === low)) return low;
    const hit = list.find((m) => low.includes(m.id) || m.label.toLowerCase().includes(low));
    return hit ? hit.id : "";
  };
  out.move = findId(CAMERA_MOVES, (mm && mm[1]) || "");
  out.angle = findId(CAMERA_ANGLES, (am && am[1]) || "");
  return out;
}

function syncCameraWords() {
  const move = CAMERA_MOVES.find((m) => m.id === $("moveSel").value);
  const angle = CAMERA_ANGLES.find((a) => a.id === $("angleSel").value);
  const bits = [angle?.phrase, move?.phrase].filter(Boolean);
  note(
    "camWordsOut",
    $("camWordsToggle")?.checked === false
      ? "Off — nothing added to the prompt."
      : bits.length
      ? `Added to prompt: ${bits.join(" · ")}`
      : "Auto — the model decides, nothing added."
  );
}

function syncTrackNote() {
  const t = (TRACKING_MODES || []).find((x) => x.id === $("trackSel")?.value);
  const v = Number($("trackStrengthRange")?.value ?? 0.6);
  if ($("trackStrengthVal")) $("trackStrengthVal").textContent = v.toFixed(2);
  note(
    "trackNote",
    !t || t.id === "off" || !t.phrase
      ? "Off."
      : `On — ${t.phrase} (strength ${v.toFixed(2)}).`
  );
}

function switchPage(id) {
  for (const p of ["pageChat", "pageFeedback", "pageVideo", "pageImage", "pageReader", "pageStoryboard", "pageVoice", "pageLivestream", "pageEditor", "pageCodecLab", "pageAIModelLab", "pageDevInsight", "pageTutorial", "pageTutor"]) {
    const el = $(p);
    if (el) el.hidden = p !== id;
  }
  for (const b of document.querySelectorAll(".studio-tab")) {
    const on = b.dataset.page === id;
    b.classList.toggle("on", on);
    b.setAttribute("aria-selected", on ? "true" : "false");
  }
}

function bindStudios() {
  for (const b of document.querySelectorAll(".studio-tab")) {
    b.onclick = () => switchPage(b.dataset.page);
  }
  switchPage("pageChat");
}

function bindImageStudio() {
  if ($("imgGenerateBtn")?.dataset.bound) return;
  if ($("imgGenerateBtn")) $("imgGenerateBtn").dataset.bound = "1";
  state.imgController = null;
  const modelSel = $("imgModelSel");
  const renderImgModelOptions = (avail, keep) => {
    modelSel.innerHTML = "";
    const auto = avail.find((m) => m.id === "auto");
    if (auto) {
      const o = document.createElement("option");
      o.value = "auto";
      o.textContent = auto.label;
      modelSel.appendChild(o);
    }
    for (const g of IMG_GROUPS) {
      const list = avail.filter((m) => m.group === g.id);
      if (!list.length) continue;
      const gr = document.createElement("optgroup");
      gr.label = g.label;
      for (const m of list) {
        const o = document.createElement("option");
        o.value = m.id;
        o.textContent = m.label;
        gr.appendChild(o);
      }
      modelSel.appendChild(gr);
    }
    modelSel.value = avail.some((m) => m.id === keep) ? keep : "auto";
  };
  renderImgModelOptions(IMG_MODELS.filter((m) => m.id === "auto" || m.kinds.includes("t2i")).filter((m) => state.imgNsfw || (!m.id.startsWith("explicit-") && m.id !== "perchance-nsfw")), "auto");
  const loraSel = $("imgLoraSel");
  loraSel.innerHTML = "";
  for (const l of IMG_LORAS) {
    const o = document.createElement("option");
    o.value = l.id;
    o.textContent = l.label;
    loraSel.appendChild(o);
  }
  const ctlSel = $("imgControlSel");
  ctlSel.innerHTML = "";
  for (const c of IMG_CONTROLS) {
    const o = document.createElement("option");
    o.value = c.id;
    o.textContent = c.label;
    ctlSel.appendChild(o);
  }
  const aspectRow = $("imgAspectRow");
  aspectRow.innerHTML = "";
  for (const a of IMG_ASPECTS) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip-btn" + (a.id === state.imgAspect ? " on" : "");
    b.dataset.aspect = a.id;
    b.textContent = a.label;
    b.title = a.desc || (a.id === "original" ? "Follow the imported image" : `Aspect ${a.label}`);
    b.onclick = () => {
      state.imgAspect = a.id;
      for (const x of aspectRow.children) x.classList.toggle("on", x.dataset.aspect === a.id);
      syncImgDims();
    };
    aspectRow.appendChild(b);
  }
  const sizeRow = $("imgSizeRow");
  sizeRow.innerHTML = "";
  for (const s of IMG_SIZES) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = s.label;
    b.dataset.size = s.id;
    if (s.id === state.imgSize) b.classList.add("on");
    b.onclick = () => {
      state.imgSize = s.id;
      for (const x of sizeRow.children) x.classList.toggle("on", x.dataset.size === s.id);
      syncImgDims();
    };
    sizeRow.appendChild(b);
  }
  const countRow = $("imgCountRow");
  countRow.innerHTML = "";
  countRow.classList.remove("seg");
  countRow.classList.add("stepper");
  const syncImgCount = (n) => {
    state.imgCount = Math.min(4, Math.max(1, Math.round(Number(n) || 1)));
    const inp = $("imgCountInput");
    if (inp && document.activeElement !== inp) inp.value = String(state.imgCount);
  };
  const minusBtn = document.createElement("button");
  minusBtn.type = "button";
  minusBtn.id = "imgCountMinus";
  minusBtn.textContent = "−";
  minusBtn.title = "One fewer variation";
  minusBtn.setAttribute("aria-label", "Fewer variations");
  minusBtn.onclick = () => syncImgCount(state.imgCount - 1);
  const countInput = document.createElement("input");
  countInput.id = "imgCountInput";
  countInput.className = "mono";
  countInput.type = "number";
  countInput.min = "1";
  countInput.max = "4";
  countInput.step = "1";
  countInput.value = String(state.imgCount);
  countInput.title = "Variations (1–4) — type a number";
  countInput.onchange = () => syncImgCount(countInput.value);
  countInput.oninput = () => { const n = Math.round(Number(countInput.value) || 1); if (n >= 1 && n <= 4) state.imgCount = n; };
  const plusBtn = document.createElement("button");
  plusBtn.type = "button";
  plusBtn.id = "imgCountPlus";
  plusBtn.textContent = "+";
  plusBtn.title = "One more variation (max 4)";
  plusBtn.setAttribute("aria-label", "More variations");
  plusBtn.onclick = () => syncImgCount(state.imgCount + 1);
  countRow.append(minusBtn, countInput, plusBtn);
  syncImgCount(state.imgCount);
  buildViewSeg($("imgViewRow"), state.imgView, (v) => {
    state.imgView = v;
    applyGalleryView($("imgScreen"), v);
    applyGalleryView($("imgGrid"), v);
    if (window.__imgGridSync) window.__imgGridSync();
  });
  applyGalleryView($("imgScreen"), state.imgView);
  applyGalleryView($("imgGrid"), state.imgView);
  if ($("imgPickAllBtn") && !$("imgPickAllBtn").dataset.bound) {
    $("imgPickAllBtn").dataset.bound = "1";
    $("imgPickAllBtn").onclick = () => {
      const all = state.imgResults.map((_, i) => i);
      const every = all.length && all.every((i) => (state.imgPick || []).includes(i));
      state.imgPick = every ? [] : all;
      $("imgPickAllBtn").textContent = every ? "Select all" : "Clear";
      renderGrid();
      syncImgResultBar();
    };
  }
  const imgFmtSel = $("imgFormatSel");
  if (imgFmtSel && !imgFmtSel.dataset.bound) {
    imgFmtSel.dataset.bound = "1";
    imgFmtSel.innerHTML = "";
    for (const f of IMAGE_FORMATS) {
      const o = document.createElement("option");
      o.value = f.id;
      o.textContent = f.label;
      imgFmtSel.appendChild(o);
    }
    imgFmtSel.value = state.imgFormat;
    imgFmtSel.onchange = () => {
      state.imgFormat = imgFmtSel.value;
      const png = ["png", "bmp", "gif"].includes(imgFmtSel.value);
      if ($("imgQualityRange")) $("imgQualityRange").disabled = png;
      note("imgNote", png ? imgFmtSel.value.toUpperCase() + " is lossless — the quality slider does not apply." : "");
    };
  }
  if ($("imgQualityRange") && !$("imgQualityRange").dataset.bound) {
    $("imgQualityRange").dataset.bound = "1";
    $("imgQualityRange").value = String(state.imgQuality);
    $("imgQualityRange").oninput = () => {
      state.imgQuality = Number($("imgQualityRange").value);
      if ($("imgQualityVal")) $("imgQualityVal").textContent = state.imgQuality.toFixed(2);
    };
  }
  bindGradeUI("ig", "img", [
    { suf: "Intensity", key: "intensity", dec: 2 },
    { suf: "Sat", key: "sat", dec: 2 },
    { suf: "Light", key: "bright", dec: 2 },
    { suf: "Contrast", key: "contrast", dec: 2 },
    { suf: "Gamma", key: "gamma", dec: 2 },
    { suf: "Grain", key: "grain", dec: 2 },
    { suf: "Leak", key: "leak", dec: 2 },
    { suf: "Sharp", key: "sharpen", dec: 2 },
  ], paintImgGrade);
  if ($("imgScaleSel") && !$("imgScaleSel").dataset.bound) {
    $("imgScaleSel").dataset.bound = "1";
    $("imgScaleSel").value = state.imgScale || "1";
    $("imgScaleSel").onchange = () => { state.imgScale = $("imgScaleSel").value; scheduleSave(); };
  }
  if ($("importImgBtn") && !$("importImgBtn").dataset.bound) {
    $("importImgBtn").dataset.bound = "1";
    $("importImgBtn").onclick = async () => {
      state.imgMode = "edit";
      for (const x of $("imgModeRow").children) x.classList.toggle("on", x.dataset.mode === "edit");
      document.querySelector("#imgImportRow").hidden = false;
      const { chooseImportSource, pickLibraryMedia } = await import("./lib-picker.js");
      const src = await chooseImportSource($("importImgBtn"));
      if (src === "library") {
        const items = await pickLibraryMedia({ accept: "image", title: "Preview image from Library" });
        if (items && items[0]) pickFile(new File([items[0].blob], items[0].name, { type: items[0].blob.type }));
      } else if (src === "computer") $("imgFileInput").click();
    };
  }
  fillSaveCatSel($("imgLibCatSel"), "image");
  if ($("imgSaveBtn") && !$("imgSaveBtn").dataset.bound) {
    $("imgSaveBtn").dataset.bound = "1";
    $("imgSaveBtn").onclick = async () => {
      const r = state.imgResults?.[state.imgSelected];
      if (!r?.url && !state.imgEditImage) { toast("Import or generate an image first.", "warn"); return; }
      const btn = $("imgSaveBtn");
      const prev = btn.textContent;
      btn.disabled = true;
      btn.textContent = "Saving…";
      try {
        const blob = r?.blob || state.imgEditImage || await (await fetch(r.url)).blob();
        const meta = readSaveMeta("img", "image");
        const out = await saveBlobToLibrary({ kind: "image", tab: meta.tab, blob, filename: meta.filename || undefined, prompt: $("imgPromptInput")?.value?.trim() || r?.by || "imported image", extra: { provider: "image-studio", providerLabel: "Image Studio", aspect: state.imgAspect, name: meta.name, userCat: meta.userCat, character: meta.character, scene: meta.scene } });
        toast(out?.locked ? "The vault is locked — enter your passphrase in Settings → Content safety." : out?.ok ? `Image saved to the Library (${meta.label}).` : "Couldn't save.", out?.ok ? "" : "warn");
      } catch {
        toast("Couldn't save.", "err");
      } finally {
        btn.disabled = false;
        btn.textContent = prev;
      }
    };
  }
  if ($("imgUpscaleModeSel") && !$("imgUpscaleModeSel").dataset.bound) {
    $("imgUpscaleModeSel").dataset.bound = "1";
    $("imgUpscaleModeSel").value = state.imgUpscaleMode || "fast";
    $("imgUpscaleModeSel").onchange = () => { state.imgUpscaleMode = $("imgUpscaleModeSel").value; scheduleSave(); };
  }
  syncImgDims();
  const syncMode = () => {
    const edit = state.imgMode === "edit";
    $("imgImportRow").hidden = !edit;
    $("imgStrengthField").hidden = !edit;
    if ($("imgPoseField")) $("imgPoseField").hidden = !edit;
    $("imgPromptHint").textContent = edit ? "how should the imported image change?" : "what should the image show?";
    const kind = edit ? "edit" : "t2i";
    const avail = IMG_MODELS.filter((m) => m.id === "auto" || m.kinds.includes(kind))
      .filter((m) => state.imgNsfw || (!m.id.startsWith("explicit-") && m.id !== "perchance-nsfw"));
    const cur = modelSel.value;
    renderImgModelOptions(avail, cur);
    syncImgModelNote();
  };
  const nsfwTgl = $("imgNsfwToggle");
  if (nsfwTgl) nsfwTgl.onchange = () => {
    state.imgNsfw = nsfwTgl.checked === true;
    syncMode();
  };
  for (const b of $("imgModeRow").children) {
    b.onclick = () => {
      state.imgMode = b.dataset.mode;
      for (const x of $("imgModeRow").children) x.classList.toggle("on", x === b);
      syncMode();
    };
  }
  modelSel.onchange = syncImgModelNote;
  ctlSel.onchange = syncImgModelNote;
  loraSel.onchange = syncImgModelNote;
  const strength = $("imgStrengthRange");
  if (strength) strength.oninput = () => {
    $("imgStrengthVal").textContent = Number(strength.value).toFixed(2);
  };
  const dz = $("imgDropzone");
  const fileInput = $("imgFileInput");
  const pickFile = (f) => {
    if (!f || !String(f.type || "").startsWith("image/")) {
      toast("That is not an image file.", "warn");
      return;
    }
    setImgEditImage(f, f.name || "image");
  };
  dz.onclick = async (e) => {
    if (e.target.closest("button")) return;
    const { chooseImportSource, pickLibraryMedia } = await import("./lib-picker.js");
    const src = await chooseImportSource(dz);
    if (src === "library") {
      const items = await pickLibraryMedia({ accept: "image", title: "Edit image from Library" });
      if (items && items[0]) pickFile(new File([items[0].blob], items[0].name, { type: items[0].blob.type }));
    } else if (src === "computer") fileInput.click();
  };
  dz.onkeydown = (e) => {
    if (e.key === "Enter" || e.key === " ") fileInput.click();
  };
  fileInput.onchange = () => {
    if (fileInput.files?.[0]) pickFile(fileInput.files[0]);
    fileInput.value = "";
  };
  dz.ondragover = (e) => {
    e.preventDefault();
    dz.classList.add("drag");
  };
  dz.ondragleave = () => dz.classList.remove("drag");
  dz.ondrop = (e) => {
    e.preventDefault();
    dz.classList.remove("drag");
    if (e.dataTransfer?.files?.[0]) pickFile(e.dataTransfer.files[0]);
  };
  document.addEventListener("paste", (e) => {
    if ($("pageImage").hidden || state.imgMode !== "edit") return;
    const f = [...(e.clipboardData?.files || [])].find((x) => String(x.type || "").startsWith("image/"));
    if (f) pickFile(f);
  });
  $("imgClearBtn").onclick = (e) => {
    e.stopPropagation();
    clearImgEditImage();
  };
  $("imgRemoveBtn").onclick = (e) => {
    e.stopPropagation();
    clearImgEditImage();
    toast("Image removed.");
  };
  $("imgCropBtn").onclick = (e) => {
    e.stopPropagation();
    if (!state.imgEditImage) {
      toast("Import an image first.", "warn");
      return;
    }
    cropTarget = "imgEdit";
    openCrop();
  };
  const pickedImgItems = () => {
    const picks = (Array.isArray(state.imgPick) ? state.imgPick : [])
      .map((i) => state.imgResults[i])
      .filter(Boolean);
    return picks.length ? picks : state.imgResults[state.imgSelected] ? [state.imgResults[state.imgSelected]] : [];
  };
  const syncImgSendLabels = () => {
    const n = pickedImgItems().length;
    const vb = $("imgVideoBtn");
    if (vb) vb.textContent = n > 1 ? `→ Video (${n})` : "→ Video";
    const bb = $("imgBoardBtn");
    if (bb) bb.textContent = n > 1 ? `→ Storyboard (${n})` : "→ Storyboard";
  };
  const renderGrid = () => {
    const grid = $("imgGrid");
    grid.innerHTML = "";
    state.imgResults = [...state.imgResults].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    if (!Array.isArray(state.imgPick)) state.imgPick = [];
    state.imgPick = state.imgPick.filter((i) => state.imgResults[i]);
    state.imgSelected = Math.min(state.imgSelected, Math.max(0, state.imgResults.length - 1));
    const heroWrap = $("imgHeroWrap");
    const hero = $("imgHero");
    const sel = state.imgResults[state.imgSelected] || null;
    if (sel && heroWrap && hero) {
      heroWrap.hidden = state.imgView === "grid";
      if (hero.getAttribute("src") !== sel.url) hero.src = sel.url;
      hero.alt = `generated image ${state.imgSelected + 1} of ${state.imgResults.length}`;
      hero.title = `#${state.imgSelected + 1} of ${state.imgResults.length} — double-click to open full size`;
      hero.ondblclick = () => window.open(sel.url, "_blank");
      grid.classList.toggle("thumbs", state.imgResults.length > 1);
    } else if (heroWrap) {
      heroWrap.hidden = true;
    }
    state.imgResults.forEach((r, i) => {
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "img-cell" + (i === state.imgSelected ? " on" : "");
      const img = document.createElement("img");
      img.src = r.url;
      img.alt = `variation ${i + 1} of ${state.imgResults.length}`;
      img.loading = "lazy";
      cell.appendChild(img);
      const pick = document.createElement("input");
      pick.type = "checkbox";
      pick.className = "img-pickbox";
      pick.title = `Select #${i + 1} for sending to Video / Storyboard`;
      pick.setAttribute("aria-label", `Select variation ${i + 1}`);
      pick.checked = state.imgPick.includes(i);
      pick.onclick = (e) => {
        e.stopPropagation();
        state.imgPick = pick.checked
          ? [...new Set([...state.imgPick, i])]
          : state.imgPick.filter((x) => x !== i);
        syncImgSendLabels();
      };
      pick.ondblclick = (e) => e.stopPropagation();
      cell.appendChild(pick);
      const tag = document.createElement("span");
      tag.className = "img-tag mono";
      tag.textContent = `#${i + 1}/${state.imgResults.length} · ${r.by}`;
      cell.appendChild(tag);
      cell.onclick = () => {
        state.imgSelected = i;
        renderGrid();
        syncImgResultBar();
      };
      cell.ondblclick = () => window.open(r.url, "_blank");
      grid.appendChild(cell);
    });
    grid.hidden = state.imgView === "grid" ? !state.imgResults.length : state.imgResults.length <= 1;
    $("imgPlaceholder")?.toggleAttribute("hidden", !!state.imgResults.length);
  };
  const syncImgResultBar = () => {
    const r = state.imgResults[state.imgSelected];
    $("imgResultBar").hidden = !r;
    if (!r) return;
    paintImgGrade();
    $("imgResultInfo").textContent = `#${state.imgSelected + 1}/${state.imgResults.length} · ${r.w}×${r.h} · seed ${r.seed} · ${r.by}`;
    $("imgDownloadBtn").onclick = async () => {
      const btn = $("imgDownloadBtn");
      const stopBtn = $("imgExportStopBtn");
      if (state.imgExporting) return;
      const prev = btn.textContent;
      state.imgExporting = true;
      state.imgExportController = new AbortController();
      btn.disabled = true;
      btn.textContent = "Exporting…";
      if (stopBtn) {
        stopBtn.hidden = false;
        stopBtn.onclick = () => { try { state.imgExportController.abort(); } catch {} };
      }
      try {
        const blob = await (await fetch(r.url)).blob();
        const fmt = imageFormatOf(state.imgFormat);
        const out = await exportImage(blob, { format: fmt.id, quality: state.imgQuality, scale: state.imgScale || "1", upscaleMode: state.imgUpscaleMode || "fast", grade: gradeActive(state.imgGrade) ? state.imgGrade : null, ...stickerPayload("imgHeroWrap"), signal: state.imgExportController.signal, onProgress: (p) => { btn.textContent = "Exporting… " + Math.round((p || 0) * 100) + "%"; } });
        downloadBlob(out.blob, "ai-toolkit-" + r.seed + (state.imgScale !== "1" ? "-" + (/p$/i.test(String(state.imgScale)) ? String(state.imgScale).toLowerCase() : String(state.imgScale) + "x") : "") + (out.graded ? "-graded" : "") + "." + out.ext);
        toast("Exported " + fmt.label + (out.w ? " · " + out.w + "x" + out.h : "") + (out.upMethod && out.upMethod !== "1x" ? " · " + out.upMethod : "") + (out.fallback ? " (no " + out.fallback + " encoder here, kept PNG)" : out.quality ? " · q" + out.quality.toFixed(2) : " · lossless") + " · " + (out.blob.size / 1024).toFixed(0) + " KB.");
      } catch (e) {
        if (e && (e.name === "AbortError" || e.message === "Stopped.")) toast("Export stopped.", "warn");
        else toast(`Export failed: ${e?.message || e}`, "err");
      } finally {
        state.imgExporting = false;
        state.imgExportController = null;
        btn.disabled = false;
        btn.textContent = prev;
        if (stopBtn) stopBtn.hidden = true;
      }
    };
    $("imgUseBtn").onclick = async () => {
      try {
        const blob = await (await fetch(r.url)).blob();
        state.imgMode = "edit";
        for (const x of $("imgModeRow").children) x.classList.toggle("on", x.dataset.mode === "edit");
        syncMode();
        setImgEditImage(blob, `variation-${r.seed}.jpg`);
        toast("Loaded into the editor — describe the change.");
      } catch {
        toast("Couldn't load that variation.", "err");
      }
    };
    $("imgVideoBtn").onclick = async () => {
      try {
        const items = pickedImgItems();
        if (!items.length) { toast("Generate an image first.", "warn"); return; }
        const blobs = [];
        for (const it of items) blobs.push({ blob: await (await fetch(it.url)).blob(), seed: it.seed });
        setRefImage(blobs[0].blob, `variation-${blobs[0].seed}.jpg`);
        let extra = 0;
        if (blobs.length > 1) {
          setRefMode("multi");
          for (const b of blobs.slice(1)) {
            const slot = REF_SLOTS.map((s) => s.id).find((id) => !state.refExtras[id]?.blob);
            if (!slot) break;
            await acceptExtraFile(slot, new File([b.blob], `variation-${b.seed}.jpg`, { type: b.blob.type || "image/jpeg" }));
            extra += 1;
          }
        }
        document.querySelector('[data-page="pageVideo"]')?.click();
        toast(extra ? `Sent ${1 + extra} images to the video studio (1 starter + ${extra} reference).` : "Sent to the video studio.");
      } catch {
        toast("Couldn't send it to video.", "err");
      }
    };
    if ($("imgBoardBtn")) $("imgBoardBtn").onclick = async () => {
      try {
        const items = pickedImgItems();
        if (!items.length) { toast("Generate an image first.", "warn"); return; }
        if (!window.SBStudio?.addExternalFrames) { toast("Storyboard isn't ready — open it once first.", "err"); return; }
        const prompt = $("imgPromptInput")?.value?.trim() || "image studio variation";
        const frames = [];
        for (const it of items) frames.push({ blob: await (await fetch(it.url)).blob(), prompt: `${prompt} (variation seed ${it.seed})` });
        const total = await window.SBStudio.addExternalFrames(frames);
        document.querySelector('[data-page="pageStoryboard"]')?.click();
        toast(`Sent ${frames.length} frame${frames.length === 1 ? "" : "s"} to the storyboard (${total} total).`);
      } catch {
        toast("Couldn't send to the storyboard.", "err");
      }
    };
  };
  window.__imgGridSync = () => {
    renderGrid();
    syncImgResultBar();
  };
  syncMode();
  if ($("imgPromptInput") && !$("imgPromptInput").dataset.bound) {
    $("imgPromptInput").dataset.bound = "1";
    $("imgPromptInput").oninput = () => {
      if ($("imgPromptCount")) $("imgPromptCount").textContent = `${$("imgPromptInput").value.length} chars`;
    };
    if ($("imgPromptCount")) $("imgPromptCount").textContent = `${$("imgPromptInput").value.length} chars`;
  }
  if ($("imgEnhanceBtn")) $("imgEnhanceBtn").onclick = runImgEnhance;
  if ($("imgNegAiBtn")) $("imgNegAiBtn").onclick = () => aiPickImgNegative();
  $("imgCancelBtn").onclick = () => {
    try {
      state.imgController?.abort();
    } catch {}
  };
  $("imgGenerateBtn").onclick = async () => {
    if (state.imgBusy) return;
    const prompt = $("imgPromptInput").value.trim();
    if (!prompt) {
      toast("Describe the image first.", "warn");
      return;
    }
    if (state.imgMode === "edit" && !state.imgEditImage) {
      toast("Import an image to edit first.", "warn");
      return;
    }
    const btn = $("imgGenerateBtn");
    state.imgBusy = true;
    state.imgController = new AbortController();
    btn.disabled = true;
    $("imgGenLabel").textContent = "Painting…";
    $("imgCancelBtn").hidden = false;
    $("imgBusy").hidden = false;
    $("imgPlaceholder")?.setAttribute("hidden", "");
    note("imgNote", "");
    try { if (state.settings.communityOptIn === true) note("imgNote", poolDecide(state.settings, "small").reason); } catch {}
    note("imgModelNote", imgModelNoteText(modelSel.value, ctlSel.value, loraSel.value));
    const onStage = (i, m, msg) => {
      $("imgBusyMsg").textContent = `Variation ${i + 1}/${state.imgCount} · ${IMG_MODELS.find((x) => x.id === m)?.label || m} · ${msg}`;
    };
    try {
      const seedRaw = $("imgSeedInput").value.trim();
      const seed = seedRaw && Number.isFinite(Number(seedRaw)) ? Math.floor(Number(seedRaw)) : null;
      const agentOn = $("imgAgentToggle")?.checked && state.imgMode === "edit" && state.imgEditImage;
      const base = {
        negative: $("imgNegInput").value.trim(),
        mode: state.imgMode,
        inputBlob: state.imgMode === "edit" ? state.imgEditImage : null,
        aspect: state.imgAspect,
        sizeId: state.imgSize,
        model: modelSel.value,
        count: state.imgCount,
        strength: Number($("imgStrengthRange")?.value ?? 0.6),
        lora: loraSel.value,
        control: ctlSel.value,
        seed,
        nsfw: state.imgNsfw,
        signal: state.imgController.signal,
      };
      let out;
      if (agentOn) {
        const box = $("imgAgentSteps");
        if (box) { box.hidden = false; box.textContent = "Agent: planning steps…"; }
        out = await runEditAgent({ prompt, ...base, count: 1, onStep: (i, n, st) => {
          $("imgBusyMsg").textContent = `Agent step ${i + 1}/${n} · ${st.edit}`;
          if (box) box.textContent = `Agent step ${i + 1}/${n}: ${st.edit} (strength ${st.strength})`;
        } });
        if (box) box.textContent = `Agent done: ${out.steps.map((s) => s.edit).join(" → ")}`;
      } else {
        out = await generateImages({ prompt, ...base, onStage });
      }
      for (const old of state.imgResults) {
        try {
          URL.revokeObjectURL(old.url);
        } catch {}
      }
      if (state.imgMode === "edit" && state.imgEditImage) {
        try {
          $("imgBusyMsg").textContent = "Face lock: blending the reference face back…";
        } catch {}
        for (const it of out.items) {
          try {
            const r = await faceBlend(state.imgEditImage, it.blob, { strength: 0.85, feather: 15 });
            if (r?.score != null) {
              it.faceScore = r.score;
              it.faceBefore = r.before ?? null;
              it.faceLocked = !!r.applied;
            }
            if (r?.applied && r.blob && r.blob !== it.blob) {
              try { URL.revokeObjectURL(it.url); } catch {}
              it.blob = r.blob;
              it.url = URL.createObjectURL(r.blob);
              it.by = `${it.by || it.model || "edit"} · face-lock ${r.score}%`;
            } else if (r?.score != null) {
              it.by = `${it.by || it.model || "edit"} · face ${r.score}%`;
            }
          } catch {}
        }
        try {
          const box = $("imgLogBox");
          if (box) {
            const lines = out.items.map((it, i) => `Face ${i + 1}: ${it.faceScore != null ? `${it.faceScore}%${it.faceLocked ? " (blended)" : " (no face found — kept as-is)"}` : "n/a"}`);
            if (box.textContent === "Ready." || !box.textContent) box.textContent = "";
            box.textContent += (box.textContent ? "\n" : "") + `Face lock · ref→out ${lines.join(" · ")}`;
            box.scrollTop = box.scrollHeight;
          }
        } catch {}
      }
      state.imgResults = [...out.items].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
      state.imgSelected = 0;
      state.imgPick = [];
      renderGrid();
      syncImgResultBar();
      $("imgStageTags").innerHTML = "";
      for (const t of [`${out.w}×${out.h}`, `${out.items.length} variation${out.items.length === 1 ? "" : "s"}`, out.items[0]?.by || ""]) {
        const s = document.createElement("span");
        s.className = "tag mono";
        s.textContent = t;
        $("imgStageTags").appendChild(s);
      }
      const savedWhere = await saveImagesToLibrary(out, {
        prompt,
        negative: $("imgNegInput").value.trim(),
      }).catch(() => "");
      const tail = savedWhere
        ? ` ${savedWhere}`
        : " (the library is locked — kept on screen only)";
      note("imgNote", out.failures.length ? `Done with fallback — ${out.failures[0]}. Showing what delivered.${tail}` : `Done — click a thumbnail to pick it, double-click the big view for full size.${tail}`);
    } catch (e) {
      if (e?.kind === "cancelled" || e?.message === "cancelled") note("imgNote", "Stopped.");
      else note("imgNote", `Couldn't generate: ${e?.message || e}`);
      $("imgPlaceholder")?.removeAttribute("hidden");
    } finally {
      state.imgBusy = false;
      btn.disabled = false;
      $("imgGenLabel").textContent = "Generate image";
      $("imgCancelBtn").hidden = true;
      $("imgBusy").hidden = true;
    }
  };
  if ($("imgPoseBtn") && !$("imgPoseBtn").dataset.bound) {
    $("imgPoseBtn").dataset.bound = "1";
    if (!state.imgPoseSel) state.imgPoseSel = ["left34", "right34", "smile"];
    const showPoses = () => {
      const row = $("imgPoseRow");
      if (!row) return;
      row.innerHTML = "";
      for (const p of POSE_PRESETS) {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = p.label;
        if ((state.imgPoseSel || []).includes(p.id)) b.classList.add("on");
        b.onclick = () => {
          const cur = new Set(state.imgPoseSel || []);
          cur.has(p.id) ? cur.delete(p.id) : cur.add(p.id);
          state.imgPoseSel = [...cur];
          showPoses();
        };
        row.appendChild(b);
      }
    };
    showPoses();
    $("imgPoseBtn").onclick = async () => {
      if (state.imgBusy) return;
      if (state.imgMode !== "edit" || !state.imgEditImage) {
        toast("Import a photo first (Edit mode), then run the pose set.", "warn");
        return;
      }
      const ids = (state.imgPoseSel || []).length ? state.imgPoseSel : ["left34", "right34", "smile"];
      const btn = $("imgPoseBtn");
      state.imgBusy = true;
      state.imgController = new AbortController();
      btn.disabled = true;
      $("imgBusy").hidden = false;
      $("imgPlaceholder")?.setAttribute("hidden", "");
      const pnote = $("imgPoseNote");
      if (pnote) pnote.textContent = "";
      try {
        const refPose = await estimatePose(state.imgEditImage).catch(() => null);
        if (pnote && refPose) pnote.textContent = "Reference head: roll " + refPose.roll + "°, yaw " + refPose.yaw + "° (" + refPose.yawNote + "). ";
        const seedRaw = $("imgSeedInput").value.trim();
        const seed = seedRaw && Number.isFinite(Number(seedRaw)) ? Math.floor(Number(seedRaw)) : null;
        const out = await runPoseVariants({
          refBlob: state.imgEditImage,
          basePrompt: $("imgPromptInput").value.trim(),
          presetIds: ids,
          aspect: state.imgAspect,
          sizeId: state.imgSize,
          model: modelSel.value,
          nsfw: state.imgNsfw,
          seed,
          signal: state.imgController.signal,
          onStage: (i, n, p, msg) => { $("imgBusyMsg").textContent = "Pose " + (i + 1) + "/" + n + " · " + p.label + " · " + msg; },
        });
        for (const old of state.imgResults) {
          try { URL.revokeObjectURL(old.url); } catch {}
        }
        state.imgResults = out.items;
        state.imgSelected = 0;
        state.imgPick = [];
        renderGrid();
        syncImgResultBar();
        $("imgStageTags").innerHTML = "";
        for (const tag of [out.items.length + " poses", out.items[0]?.by || ""]) {
          const s = document.createElement("span");
          s.className = "tag mono";
          s.textContent = tag;
          $("imgStageTags").appendChild(s);
        }
        try {
          const box = $("imgLogBox");
          if (box) {
            if (box.textContent === "Ready." || !box.textContent) box.textContent = "";
            for (const it of out.items) {
              const pr = it.pose ? " · head yaw " + it.pose.yaw + "° roll " + it.pose.roll + "°" : "";
              box.textContent += (box.textContent ? "\n" : "") + "Pose " + it.label + ": face " + (it.faceScore != null ? it.faceScore + "%" + (it.faceLocked ? " (blended)" : "") : "n/a") + pr;
            }
            box.scrollTop = box.scrollHeight;
          }
        } catch {}
        const savedWhere = await saveImagesToLibrary(out, {
          prompt: $("imgPromptInput").value.trim(),
          negative: $("imgNegInput").value.trim(),
        }).catch(() => "");
        note("imgNote", "Pose set done — " + out.items.map((x) => x.label + " " + (x.faceScore != null ? x.faceScore + "%" : "")).join(" · ") + (out.failures.length ? " · failed: " + out.failures.join("; ") : "") + (savedWhere ? " " + savedWhere : ""));
      } catch (e) {
        if (e?.kind === "cancelled" || e?.message === "cancelled") note("imgNote", "Stopped.");
        else note("imgNote", "Pose set failed: " + (e?.message || e));
        $("imgPlaceholder")?.removeAttribute("hidden");
      } finally {
        state.imgBusy = false;
        btn.disabled = false;
        $("imgBusy").hidden = true;
      }
    };
  }
}

function imgModelNoteText(model, control, lora) {
  const l = (IMG_LORAS.find((x) => x.id === lora) || {}).label || "";
  const c = (IMG_CONTROLS.find((x) => x.id === control) || {}).label || "";
  const x = state.imgNsfw ? " · NSFW on (explicit boost, unfiltered routing)" : "";
  if (String(model || "").startsWith("puter-")) {
    const name = (IMG_MODELS.find((m) => m.id === model) || {}).label || model;
    return `${name} · free · first run signs you into your own Puter account once (their window, no key to paste), then instant · text-only — edits still go through the SDXL pool.${x}`;
  }
  if (model === "explicit-sdxl") return `NSFW SDXL pool · free · anonymous OK · needs NSFW on · LoRA ${l} · Control ${c} · GPU+CPU workers, queued a few minutes at worst.${x}`;
  if (model === "explicit-flux") return `NSFW Flux · free · instant text-to-image, filter off${lora !== "none" ? ` · LoRA applied as style words (${l})` : ""}. Cannot edit uploads — NSFW SDXL pool edits.${x}`;
  if (model === "horde-xl") return `SDXL pool · free · anonymous OK · LoRA ${l} · Control ${c} · GPU+CPU workers, queued a few minutes at worst.${x}`;
  if (model === "pollinations-turbo") return `Turbo · free · instant text-to-image${lora !== "none" ? ` · LoRA applied as style words (${l})` : ""}. Cannot edit uploads — switch to Image→image + SDXL pool for that.${x}`;
  if (model === "pollinations-flux") return `Flux · free · sharp text-to-image${lora !== "none" ? ` · LoRA applied as style words (${l})` : ""}. Cannot edit uploads — switch to Image→image + SDXL pool for that.${x}`;
  if (model === "perchance") return `Perchance built-in · best SFW · free · always on · text-only · negative prompt supported. SFW lock: filtered routes only, nudity suppressed while NSFW is off. No native image-to-video — send the frame to the Video tab to animate it.${x}`;
  if (model === "perchance-nsfw") return `Perchance built-in · best NSFW · free · always on · text-only · filter off. No native image-to-video — send the frame to the Video tab to animate it.${x}`;
  if (model === "device") return "This device · offline CPU · instant · never leaves the browser.";
  return `Auto · ${state.imgNsfw ? "Perchance NSFW best first (unfiltered), NSFW SDXL pool next" : "SFW lock — Perchance best first (always on), Flux next (instant), unfiltered models excluded, nudity suppressed"}, SDXL pool for edits and LoRA/Control, on-device as fallback. Puter's models are pick-only (they need that one sign-in). Perchance has no native image-to-video — animate frames in the Video tab. Negative prompt rides every route.`;
}

function syncImgModelNote() {
  note("imgModelNote", imgModelNoteText($("imgModelSel")?.value || "auto", $("imgControlSel")?.value || "none", $("imgLoraSel")?.value || "none"));
}

function bindVoiceStudio() {
  if ($("voicePlayBtn")?.dataset.bound) return;
  if ($("voicePlayBtn")) $("voicePlayBtn").dataset.bound = "1";
  const pickVoices = () => {
    try {
      const vs = speechSynthesis.getVoices() || [];
      const sel = $("voiceSel");
      if (!sel || !vs.length) return;
      const cur = sel.value;
      sel.textContent = "";
      const def = document.createElement("option");
      def.value = "";
      def.textContent = "Default voice";
      sel.appendChild(def);
      // Voice names come from the OS/browser (and any installed voice pack),
      // so they are added as text, never HTML.
      vs.forEach((v, i) => {
        const o = document.createElement("option");
        o.value = String(i);
        o.textContent = `${v.name} · ${v.lang}`;
        sel.appendChild(o);
      });
      if (cur) sel.value = cur;
    } catch {}
  };
  try {
    pickVoices();
    if (typeof speechSynthesis !== "undefined") speechSynthesis.onvoiceschanged = pickVoices;
  } catch {}
  const count = () => { if ($("voiceCount")) $("voiceCount").textContent = `${$("voiceTextInput").value.length} chars`; };
  if ($("voiceTextInput")) $("voiceTextInput").oninput = count;
  count();
  const rateEl = $("voiceRateRange"), pitchEl = $("voicePitchRange");
  if (rateEl) rateEl.oninput = () => { if ($("voiceRateVal")) $("voiceRateVal").textContent = `${Number(rateEl.value).toFixed(2)}×`; };
  if (pitchEl) pitchEl.oninput = () => { if ($("voicePitchVal")) $("voicePitchVal").textContent = Number(pitchEl.value).toFixed(2); };
  if ($("voicePlayBtn")) $("voicePlayBtn").onclick = () => {
    const text = $("voiceTextInput").value.trim();
    if (!text) { toast("Type a script first.", "warn"); return; }
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      const vs = speechSynthesis.getVoices() || [];
      const idx = Number($("voiceSel")?.value);
      if (Number.isFinite(idx) && vs[idx]) u.voice = vs[idx];
      u.rate = Number(rateEl?.value) || 1;
      u.pitch = Number(pitchEl?.value) || 1;
      speechSynthesis.speak(u);
      if ($("voicePreviewText")) $("voicePreviewText").textContent = text.slice(0, 280) + (text.length > 280 ? "…" : "");
      if ($("voiceQueue")) $("voiceQueue").textContent = `Queued ${text.length} chars · ${vs[idx]?.name || "default voice"} · ${u.rate.toFixed(2)}× · pitch ${u.pitch.toFixed(2)}`;
      note("voiceNote", "Playing on this device. Studio voices + downloadable MP3 come next.");
    } catch (e) {
      note("voiceNote", `Couldn't speak: ${e?.message || e}`);
    }
  };
  if ($("voiceStopBtn")) $("voiceStopBtn").onclick = () => { try { speechSynthesis.cancel(); } catch {} };
  try { bindVoiceMakerExtras(); } catch {}
}

function bindVoiceMakerExtras() {
  if ($("voiceSubRow")?.dataset.bound) return;
  if ($("voiceSubRow")) $("voiceSubRow").dataset.bound = "1";
  const sub = $("voiceSubRow");
  if (sub) sub.onclick = (e) => {
    const b = e.target.closest("button[data-vsub]");
    if (!b) return;
    for (const x of sub.querySelectorAll("button")) { x.classList.toggle("on", x === b); x.setAttribute("aria-selected", x === b ? "true" : "false"); }
    const which = b.dataset.vsub;
    for (const id of ["vsubMaker", "vsubCamera", "vsubLipsync"]) {
      const el = $(id);
      if (el) el.hidden = (id !== "vsub" + which.charAt(0).toUpperCase() + which.slice(1));
    }
  };
  const setScript = (txt) => {
    if (!$("voiceTextInput")) return;
    $("voiceTextInput").value = txt;
    $("voiceTextInput").dispatchEvent(new Event("input", { bubbles: true }));
  };
  if ($("voiceImportBtn") && !$("voiceImportBtn").dataset.bound) {
    $("voiceImportBtn").dataset.bound = "1";
    $("voiceImportBtn").onclick = () => $("voiceScriptFile").click();
    $("voiceScriptFile").onchange = async () => {
      const f = $("voiceScriptFile").files?.[0];
      $("voiceScriptFile").value = "";
      if (!f) return;
      try {
        if (window.ReaderBridge?.extractFile) {
          const { text } = await window.ReaderBridge.extractFile(f);
          setScript(text);
        } else setScript((await f.text()).trim());
        toast("Script loaded from " + f.name + ".");
      } catch (e) { toast("Script import failed: " + (e?.message || e), "warn"); }
    };
  }
  if ($("voiceSampleBtn") && !$("voiceSampleBtn").dataset.bound) {
    $("voiceSampleBtn").dataset.bound = "1";
    $("voiceSampleBtn").onclick = () => {
      setScript("Oh no, what happened, why I am here. Importance of Education. Education plays a very important role in our life. It is the foundation of personal and social development. Education helps us gain knowledge, improve our understanding, and shape our character.");
      toast("Sample script loaded.");
    };
  }
  if ($("voiceReaderBtn") && !$("voiceReaderBtn").dataset.bound) {
    $("voiceReaderBtn").dataset.bound = "1";
    $("voiceReaderBtn").onclick = () => {
      const txt = ($("readerNarrOut")?.value || $("readerTextInput")?.value || "").trim();
      if (!txt) { toast("Reader is empty — extract a document there first.", "warn"); return; }
      setScript(txt);
      toast("Reader text copied into the script.");
    };
  }
  if ($("voiceLibBtn") && !$("voiceLibBtn").dataset.bound) {
    $("voiceLibBtn").dataset.bound = "1";
    $("voiceLibBtn").onclick = () => { try { openHistory("voice"); } catch { document.querySelector("#historyBtn")?.click(); } };
  }
  if ($("voicePolishBtn") && !$("voicePolishBtn").dataset.bound) {
    $("voicePolishBtn").dataset.bound = "1";
    $("voicePolishBtn").onclick = async () => {
      const cur = $("voiceTextInput")?.value.trim() || "";
      if (!cur) { toast("Type a script first.", "warn"); return; }
      const neg = $("voiceNegInput")?.value.trim() || "";
      const btn = $("voicePolishBtn");
      const prev = btn.textContent;
      btn.disabled = true; btn.textContent = "\u2728 Polishing\u2026";
      try {
        const gen = typeof root !== "undefined" ? root.generateText : null;
        if (!gen) throw new Error("AI unavailable right now");
        const out = await gen("Rewrite this narration script for natural spoken delivery: short sentences, speakable words, no formatting." + (neg ? " Avoid these words and qualities: " + neg + "." : "") + "\n\nSCRIPT:\n" + cur.slice(0, 3000));
        const txt = String(out?.text || out || "").trim();
        if (txt) { setScript(txt); toast("Script polished for speaking."); }
        else throw new Error("empty reply");
      } catch (e) { toast("Polish failed: " + (e?.message || e), "warn"); }
      finally { btn.disabled = false; btn.textContent = prev; }
    };
  }
}

async function aiPickCamera(idea) {
  const btn = $("camPickBtn");
  const text = (idea ?? $("camIdeaInput")?.value ?? "").trim() || $("promptInput").value.trim();
  if (!text) {
    toast("Type a camera idea or a main prompt first.", "warn");
    $("camIdeaInput")?.focus();
    return null;
  }
  const gen = typeof root !== "undefined" ? root.generateText : null;
  if (!gen) {
    toast("The AI picker is still loading — try again in a second.", "warn");
    return null;
  }
  const moveOpts = CAMERA_MOVES.map((m) => `${m.id}: ${m.label}`).join("\n");
  const angleOpts = CAMERA_ANGLES.map((a) => `${a.id}: ${a.label}`).join("\n");
  const prev = btn ? btn.textContent : "";
  if (btn) {
    btn.disabled = true;
    btn.textContent = "✨ Picking…";
  }
  try {
    let acc = "";
    await aiGenFallback({
      instruction: [
        "You are a cinematographer choosing a camera setup for an AI video. Reply with exactly one line like move=<id> angle=<id> using only ids from the option lists — no preamble, no quotes, no explanation.",
        `Movement options:\n${moveOpts}\nAngle options:\n${angleOpts}\nIdea: ${text}\nReply:`,
      ],
      startWith: "",
      stopSequences: ["\n"],
      onChunk: (d) => {
        acc += d.textChunk || "";
      },
    });
    const picks = parseCameraPicks(acc);
    const applied = [];
    if (picks.move && $("moveSel")) {
      $("moveSel").value = picks.move;
      $("moveSel").dispatchEvent(new Event("change", { bubbles: true }));
      applied.push("movement");
    }
    if (picks.angle && $("angleSel")) {
      $("angleSel").value = picks.angle;
      $("angleSel").dispatchEvent(new Event("change", { bubbles: true }));
      applied.push("angle");
    }
    if (applied.length) toast(`Camera ${applied.join(" + ")} picked.`);
    else toast("Couldn't pick a camera from that — try different words.", "warn");
    return picks;
  } catch (e) {
    toast(`Couldn't pick: ${e?.message || e}`, "err");
    return null;
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = prev || "✨ AI pick";
    }
  }
}

async function aiPickNegative(idea) {
  const btn = $("negAiBtn");
  const text = (idea ?? "").trim() || $("promptInput").value.trim();
  if (!text) {
    toast("Type the main prompt first, then decide the negative.", "warn");
    $("promptInput")?.focus();
    return null;
  }
  const gen = typeof root !== "undefined" ? root.generateText : null;
  if (!gen) {
    toast("The AI writer is still loading — try again in a second.", "warn");
    return null;
  }
  const prev = btn ? btn.textContent : "";
  if (btn) {
    btn.disabled = true;
    btn.textContent = "✨ Writing…";
  }
  try {
    let acc = "";
    await aiGenFallback({
      instruction: [
        "You are a prompt engineer for an AI video model. Reply with ONLY a comma-separated list of 10-20 things to avoid for this exact video idea — artifacts, deformities, bad photography and anything that would fight the subject. No preamble, no quotes, no explanation.",
        `Prompt: ${text}\nNegative:`,
      ],
      startWith: "",
      stopSequences: ["\n"],
      onChunk: (d) => {
        acc += d.textChunk || "";
      },
    });
    const neg = acc.trim().replace(/^["'\s]+|["'\s]+$/g, "");
    if (neg) {
      $("negInput").value = neg;
      toast("Negative prompt written.");
      return neg;
    }
    toast("Couldn't write a negative from that — try different words.", "warn");
    return null;
  } catch (e) {
    toast(`Couldn't write it: ${e?.message || e}`, "err");
    return null;
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = prev || "✨ AI negative";
    }
  }
}

function imgEnhanceFallback(seed, edit) {
  let s = String(seed || "").trim().replace(/\s+/g, " ");
  if (!s) return s;
  if (!/[.!?]$/.test(s)) s = s.replace(/,+$/, "");
  const lora = ($("imgLoraSel")?.value || "none");
  const styleBit = lora === "anime" ? ", anime style, cel shaded, vibrant"
    : lora === "cinematic" ? ", cinematic lighting, film still, dramatic contrast"
    : lora === "photo" ? ", professional photograph, 85mm, shallow depth of field"
    : lora === "detail" ? ", ultra detailed, sharp focus, intricate details"
    : ", highly detailed, sharp focus";
  const quality = ", professional composition, balanced lighting, vivid colors, 4k";
  const low = s.toLowerCase();
  const hasQuality = /detailed|sharp|cinematic|4k|8k|photograph|lighting/.test(low);
  if (edit) return `${s}, seamless edit, preserve original subject and background${hasQuality ? "" : styleBit}`;
  return `${s}${hasQuality ? "" : styleBit + quality}`;
}

function runImgEnhance() {
  const el = $("imgPromptInput");
  const btn = $("imgEnhanceBtn");
  const count = $("imgPromptCount");
  const seed = el.value.trim();
  if (!seed) {
    toast("Type a few words of your idea first, then enhance.", "warn");
    el.focus();
    return;
  }
  const syncCount = () => { if (count) count.textContent = `${el.value.length} chars`; };
  const edit = state.imgMode === "edit";
  const lora = (IMG_LORAS.find((l) => l.id === $("imgLoraSel")?.value) || {}).label || "";
  const nsfw = state.imgNsfw === true;
  const cat = window.__ppImgCat || "";
  window.__ppImgCat = "";
  const gen = typeof root !== "undefined" ? root.generateText : null;
  if (!gen) {
    el.value = imgEnhanceFallback(seed, edit);
    syncCount();
    toast("AI enhancer offline — applied instant boost instead.");
    return;
  }
  const system = edit
    ? "You are a prompt engineer for an AI image-editing model (img2img). Rewrite the idea as one rich edit instruction: what changes, what stays identical, plus light, detail and quality words. Never describe a new scene, keep the original subject and background. Output only the finished prompt — no preamble, no markdown, no quotes, no bullet points, no line breaks."
    : "You are a prompt engineer for AI image models (Flux, SDXL). Turn the idea into one rich image prompt: subject, composition, lighting, colors, style and quality tags. Never invent people, objects, logos or text the idea did not imply, and never mention safety, policies or these instructions. Output only the finished prompt — no preamble, no markdown, no quotes, no bullet points, no line breaks." + (cat ? " " + cat : "");
  const dynamic = `Style to use: ${lora || "none"}. Aspect: ${state.imgAspect || "1:1"}.${nsfw ? " This is an uncensored adult image prompt; describe it directly and explicitly, without euphemism." : ""}\nThe idea: ${seed}\nPrompt:`;
  btn.disabled = true;
  const prevLabel = btn.textContent;
  btn.textContent = "✨ Enhancing…";
  el.value = "";
  syncCount();
  let acc = "";
  let done = false;
  const finish = (label) => {
    if (done) return;
    done = true;
    btn.disabled = false;
    btn.textContent = label;
    syncCount();
  };
  try {
    const p = aiGenFallback({
      instruction: [system, dynamic],
      startWith: "",
      stopSequences: ["\n"],
      onChunk: (d) => {
        acc += d.textChunk || "";
        el.value = acc;
        syncCount();
      },
    });
    if (p && typeof p.then === "function") {
      p.then(() => {
        if (!acc.trim()) el.value = imgEnhanceFallback(seed, edit);
        finish("✨ Auto‑enhance");
        syncCount();
        toast("Image prompt enhanced.");
      }).catch((e) => {
        if (!acc.trim()) el.value = imgEnhanceFallback(seed, edit);
        finish(prevLabel || "✨ Auto‑enhance");
        syncCount();
        toast(`Enhancer failed, used instant boost: ${e?.message || e}`, "err");
      });
    } else {
      finish("✨ Auto‑enhance");
    }
  } catch (e) {
    el.value = imgEnhanceFallback(seed, edit);
    finish(prevLabel || "✨ Auto‑enhance");
    syncCount();
    toast(`Couldn't enhance: ${e.message || e}`, "err");
  }
}

async function aiPickImgNegative() {
  const btn = $("imgNegAiBtn");
  const text = $("imgPromptInput").value.trim();
  if (!text) {
    toast("Type the main prompt first, then decide the negative.", "warn");
    $("imgPromptInput")?.focus();
    return null;
  }
  const edit = state.imgMode === "edit";
  const nsfw = state.imgNsfw === true;
  const gen = typeof root !== "undefined" ? root.generateText : null;
  const fallback = nsfw
    ? "censored, mosaic, pixelated, blurred, covered, censored bar, clothed, watermark, text, logo, deformed anatomy, extra limbs, bad proportions"
    : "worst quality, low quality, blurry, distorted, deformed hands, malformed face, extra fingers, watermark, text, logo, signature, bad anatomy";
  if (!gen) {
    $("imgNegInput").value = fallback;
    toast("AI writer offline — applied default avoid-list.");
    return fallback;
  }
  const prev = btn ? btn.textContent : "";
  if (btn) {
    btn.disabled = true;
    btn.textContent = "✨ Writing…";
  }
  try {
    let acc = "";
    await aiGenFallback({
      instruction: [
        `You are a prompt engineer for an AI image model${edit ? " doing image-to-image edits" : ""}. Reply with ONLY a comma-separated list of 10-20 things to avoid for this exact image idea — artifacts, deformities, bad photography and anything that would fight the subject${nsfw ? ", but never list nudity, explicit content or skin itself as things to avoid" : ""}. Derive it ONLY from the main prompt below — ignore any existing negative prompt. No preamble, no quotes, no explanation.`,
        `Prompt: ${text}\nNegative:`,
      ],
      startWith: "",
      stopSequences: ["\n"],
      onChunk: (d) => {
        acc += d.textChunk || "";
      },
    });
    const neg = acc.trim().replace(/^["'\s]+|["'\s]+$/g, "");
    if (neg) {
      $("imgNegInput").value = neg;
      toast("Image negative prompt written.");
      return neg;
    }
    $("imgNegInput").value = fallback;
    toast("Couldn't write a negative — used default avoid-list.", "warn");
    return fallback;
  } catch (e) {
    $("imgNegInput").value = fallback;
    toast(`Couldn't write it, used default: ${e?.message || e}`, "err");
    return fallback;
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = prev || "✨ AI negative";
    }
  }
}

/* --------------------------------------------------------- server compute */

function renderServerStatus() {
  const status = $("serverStatus");
  const s = state.settings;
  const url = s.serverUrl;
  if (!url) {
    status.className = "srv-status idle";
    status.textContent = s.computeMode === "offline" ? "Rendering on this device." : "No server set — the free public pool is used.";
    return;
  }
  if (state.serverProviders.length) {
    const names = state.serverProviders.map((p) => p.label).join(", ");
    status.className = "srv-status ok";
    status.textContent = `Connected — ${state.serverProviders.length} model${state.serverProviders.length === 1 ? "" : "s"}: ${names}.`;
  } else {
    status.className = "srv-status idle";
    status.textContent = `Saved address: ${url} — press Test to connect.`;
  }
}

function renderServerModels(weights = null) {
  const host = $("serverModelList");
  host.innerHTML = "";
  if (!state.serverProviders.length) {
    host.hidden = true;
    return;
  }
  host.hidden = false;
  for (const p of state.serverProviders) {
    const row = document.createElement("div");
    row.className = "space-item";
    const label = document.createElement("span");
    label.className = "mono";
    const w = weights?.models?.find((m) => m.id === p.serverModel);
    label.textContent = `${p.label}${p.sizeGb ? ` · ${p.sizeGb}GB` : ""}${w ? (w.cached ? " · weights cached" : " · not downloaded") : p.cached ? " · cached" : ""}`;
    const right = document.createElement("div");
    right.style.display = "flex";
    right.style.gap = "7px";
    right.style.alignItems = "center";
    const dl = document.createElement("button");
    dl.type = "button";
    dl.className = "btn btn-tiny";
    dl.textContent = "Download";
    dl.onclick = async () => {
      dl.disabled = true;
      dl.textContent = "Downloading…";
      try {
        await serverDownloadWeights(state.settings.serverUrl, p.serverModel, state.settings.serverToken, (e) => {
          if (e?.progress != null) dl.textContent = `${Math.round(e.progress * 100)}%`;
          else if (e?.message) dl.textContent = e.message.slice(0, 22);
        });
        dl.textContent = "Ready";
        logLine(`${p.label} weights ready on your server`, "ok");
      } catch (e) {
        dl.disabled = false;
        dl.textContent = "Download";
        toast(`Download failed: ${e.message}`, "err");
      }
    };
    right.appendChild(dl);
    row.append(label, right);
    host.appendChild(row);
  }
}

async function refreshServer({ silent = false, save = false } = {}) {
  const s = state.settings;
  const raw = $("serverUrlInput").value.trim();
  const base = normalizeServerUrl(raw);
  if (save) {
    s.serverUrl = base;
    await saveSettings({ serverUrl: base });
  }
  if (!base) {
    state.serverProviders = [];
    renderServerStatus();
    renderServerModels();
    rebuildGenSelects();
    return;
  }
  if (!silent) {
    $("serverStatus").className = "srv-status idle";
    $("serverStatus").textContent = "Connecting…";
  }
  try {
    const health = await serverHealth(base, s.serverToken);
    state.serverProviders = providersFromHealth(base, health);
    renderServerStatus();
    renderServerModels();
    rebuildGenSelects();
    if (!silent) {
      toast(`Connected to your GPU server — ${state.serverProviders.length} models.`, "ok");
      logLine(`server ${base} · ${health.device || "?"} · ${state.serverProviders.length} models`, "ok");
      serverWeights(base, s.serverToken)
        .then((w) => renderServerModels(w))
        .catch(() => {});
    }
  } catch (e) {
    state.serverProviders = [];
    $("serverStatus").className = "srv-status bad";
    $("serverStatus").textContent = e.message + (e.hint ? ` ${e.hint}` : "");
    if (!silent) toast(`Server: ${e.message}`, "err", 7000);
    renderServerModels();
    rebuildGenSelects();
  }
}

/* -------------------------------------------------------------- relay/privacy */

function renderRelayModeNote() {
  const mode = $("relayModeSel").value;
  const addresses = rotatableCount(state.settings);
  const bits = {
    off: "One address for the whole run — requests still go through a relay under “Keep models from seeing your address”, but the address never changes.",
    generation: `Stepping to the next address before every run — a fresh free allowance each time. ${addresses} address${addresses === 1 ? "" : "es"} available${addresses === 1 ? " (add a relay or your own server for more)" : ""}.`,
    request: "A new address on every single request — each segment and retry. Strongest for spreading allowance; slowest because every hop is another relay.",
  };
  note("relayNote", bits[mode] || "");
}

function renderRelays() {
  const host = $("relayList");
  host.innerHTML = "";
  const relays = state.settings.relays || [];
  $("relayEmpty").hidden = relays.length > 0;
  relays.forEach((r, i) => {
    const row = document.createElement("div");
    row.className = "space-item";
    const label = document.createElement("span");
    label.className = "mono";
    label.textContent = r.label || r.url;
    const del = document.createElement("button");
    del.type = "button";
    del.className = "btn btn-tiny";
    del.textContent = "Remove";
    del.onclick = async () => {
      state.settings.relays.splice(i, 1);
      await saveSettings({ relays: state.settings.relays });
      renderRelays();
      renderRelayModeNote();
      syncPrivacyNotes();
    };
    row.append(label, del);
    host.appendChild(row);
  });
}

function syncPrivacyNotes() {
  const s = state.settings;
  const primary = primaryRelays(s);
  const fallback = fallbackRelays(s);
  const total = primary.length + fallback.length;
  note(
    "strictNote",
    s.strictPrivacy
      ? `On — every request leaves through a relay. ${primary.length} you control, ${fallback.length} shared fallback${fallback.length === 1 ? "" : "s"}. If none can carry a request it is refused rather than sent from your address.`
      : `Off — requests leave from this connection unless rotation is on. ${total} relay${total === 1 ? "" : "s"} configured.`
  );
  const relays = relayPool(s);
  const direct = !s.strictPrivacy && (s.relayMode || "off") === "off";
  note(
    "relayNote",
    direct
      ? "Privacy is off and rotation is off, so requests go straight out from your connection."
      : `${relays.length} address${relays.length === 1 ? "" : "es"} in the pool · rotation: ${s.relayMode}.`
  );
  note("traceNote", s.wipeTraces ? "On — cookies, web storage, caches, resource timings and quota records are wiped after every run. Your library and settings are kept." : "Off — nothing is cleaned up after a run.");}

/* ------------------------------------------------------------------- repaint */

const DEFAULT_TORSO_BOX = { x0: 0.18, y0: 0.34, x1: 0.82, y1: 0.98 };
const repaintDlg = { box: { ...DEFAULT_TORSO_BOX }, dragging: null, detected: false, overlayUrl: null };

function placeRepaintBox() {
  const b = repaintDlg.box;
  const el = $("repaintBox");
  el.style.left = `${b.x0 * 100}%`;
  el.style.top = `${b.y0 * 100}%`;
  el.style.width = `${(b.x1 - b.x0) * 100}%`;
  el.style.height = `${(b.y1 - b.y0) * 100}%`;
}

function openRepaint() {
  if (!state.refImage) return;
  if (repaintDlg.overlayUrl) {
    URL.revokeObjectURL(repaintDlg.overlayUrl);
    repaintDlg.overlayUrl = null;
  }
  $("repaintOverlay").hidden = true;
  $("repaintImg").src = $("refPreview").src;
  $("repaintWantSel").value = state.repaint?.want || "all";
  repaintDlg.box = state.repaint?.box ? { ...state.repaint.box } : { ...DEFAULT_TORSO_BOX };
  repaintDlg.detected = !!state.repaint && state.repaint.auto === false;
  placeRepaintBox();
  $("repaintInfo").textContent = state.repaint
    ? "Current region shown. Press “Detect clothes” to shrink it to the garments, or drag the box."
    : "Press “Detect clothes” to find the garments on your device, or drag the box yourself.";
  const rdlg = $("repaintDlg");
  if (!rdlg.open) rdlg.showModal();
}

function bindRepaint() {
  const wrap = $("repaintWrap");
  const box = $("repaintBox");
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const frac = (e) => {
    const r = $("repaintImg").getBoundingClientRect();
    return { x: clamp01((e.clientX - r.left) / r.width), y: clamp01((e.clientY - r.top) / r.height) };
  };
  const startDrag = (mode) => (e) => {
    e.preventDefault();
    e.stopPropagation();
    const b = repaintDlg.box;
    repaintDlg.dragging = {
      mode,
      ox: e.clientX,
      oy: e.clientY,
      start: { ...b },
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", endDrag, { once: true });
  };
  const onMove = (e) => {
    const d = repaintDlg.dragging;
    if (!d) return;
    const r = $("repaintImg").getBoundingClientRect();
    const dx = (e.clientX - d.ox) / r.width;
    const dy = (e.clientY - d.oy) / r.height;
    const s = d.start;
    let b = repaintDlg.box;
    const min = 0.06;
    if (d.mode === "move") {
      const w = s.x1 - s.x0;
      const h = s.y1 - s.y0;
      b.x0 = Math.max(0, Math.min(1 - w, s.x0 + dx));
      b.y0 = Math.max(0, Math.min(1 - h, s.y0 + dy));
      b.x1 = b.x0 + w;
      b.y1 = b.y0 + h;
    } else {
      if (d.mode.includes("w")) b.x0 = Math.min(s.x1 - min, Math.max(0, s.x0 + dx));
      if (d.mode.includes("e")) b.x1 = Math.max(s.x0 + min, Math.min(1, s.x1 + dx));
      if (d.mode.includes("n")) b.y0 = Math.min(s.y1 - min, Math.max(0, s.y0 + dy));
      if (d.mode.includes("s")) b.y1 = Math.max(s.y0 + min, Math.min(1, s.y1 + dy));
    }
    repaintDlg.detected = false;
    placeRepaintBox();
  };
  const endDrag = () => {
    repaintDlg.dragging = null;
    window.removeEventListener("pointermove", onMove);
  };
  box.addEventListener("pointerdown", startDrag("move"));
  for (const g of box.querySelectorAll("[data-grip]")) g.addEventListener("pointerdown", startDrag(g.dataset.grip));
  wrap.addEventListener("pointerdown", (e) => {
    if (e.target !== $("repaintImg")) return;
    const f = frac(e);
    repaintDlg.box = { x0: f.x, y0: f.y, x1: Math.min(1, f.x + 0.4), y1: Math.min(1, f.y + 0.4) };
    repaintDlg.detected = false;
    placeRepaintBox();
    e.preventDefault();
  });

  $("repaintDoneBtn").onclick = () => {
    state.repaint = {
      box: { ...repaintDlg.box },
      want: $("repaintWantSel").value,
      auto: !repaintDlg.detected,
    };
    const b = state.repaint.box;
    $("repaintBtn").classList.add("on");
    $("repaintBtn").textContent = `Repaint ${Math.round((b.x1 - b.x0) * 100)}×${Math.round((b.y1 - b.y0) * 100)}%`;
    saveSettings({ repaint: state.repaint });
    $("repaintDlg").close();
    toast("Repaint region saved — the NSFW starting frame will only change that area.");
  };
  $("repaintResetBtn").onclick = () => {
    repaintDlg.box = { ...DEFAULT_TORSO_BOX };
    repaintDlg.detected = false;
    $("repaintOverlay").hidden = true;
    placeRepaintBox();
    $("repaintInfo").textContent = "Default torso box.";
  };
  $("repaintAutoBtn").onclick = async () => {
    if (!state.refImage) return;
    $("repaintInfo").textContent = "Finding the face…";
    try {
      const b = await torsoMaskBox(state.refImage, { useModel: !state.settings.strictPrivacy });
      repaintDlg.box = { x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1 };
      repaintDlg.detected = b.source === "face";
      $("repaintOverlay").hidden = true;
      placeRepaintBox();
      $("repaintInfo").textContent = b.source === "face" ? "Face found — everything below the chin is in the box." : "No face detected — using the measured default box.";
    } catch {
      $("repaintInfo").textContent = "Could not detect a face — using the default box.";
    }
  };
  $("repaintClothesBtn").onclick = async () => {
    if (!state.refImage) return;
    const btn = $("repaintClothesBtn");
    btn.disabled = true;
    const label = btn.textContent;
    btn.textContent = "Reading the photo…";
    $("repaintInfo").textContent = "Segmenting the clothing on this device (a 4 MB model that ships inside the app)…";
    try {
      const res = await buildClothesMask(state.refImage, { want: $("repaintWantSel").value });
      if (repaintDlg.overlayUrl) URL.revokeObjectURL(repaintDlg.overlayUrl);
      const png = await maskPreview(state.refImage, res.canvas, { width: 520 });
      repaintDlg.overlayUrl = URL.createObjectURL(png);
      const ov = $("repaintOverlay");
      ov.src = repaintDlg.overlayUrl;
      ov.hidden = false;
      repaintDlg.box = { ...res.box };
      repaintDlg.detected = true;
      placeRepaintBox();
      $("repaintInfo").textContent = `${Math.round((res.coverage || 0) * 100)}% of the frame is clothing — only that is repainted. Green shows exactly what will change.`;
    } catch (e) {
      $("repaintInfo").textContent = `Detector unavailable (${e.message}) — drag the box yourself.`;
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  };
}

/* ----------------------------------------------------------------- library */

async function openLibrary() {
  const grid = $("historyGrid");
  grid.innerHTML = "";
  if (!LIBRARY_VIEWS.some((v) => v.id === state.libView)) state.libView = "medium";
  // Multi-select: the set of checked item keys. Rebuilt every time the dialog opens.
  const selected = new Set();
  const syncLibToolbar = () => {
    const cards = [...grid.querySelectorAll(".hist-card")];
    const n = selected.size;
    $("libSelCount").textContent = `${n} selected`;
    $("libDeleteSelBtn").disabled = n === 0;
    $("libDeleteSelBtn").textContent = `Delete selected (${n})`;
    $("libSelectAllBtn").textContent = n > 0 && n === cards.length ? "Select none" : "Select all";
  };
  const pruneLibSections = () => {
    for (const h of grid.querySelectorAll(".hist-sec")) {
      let n = h.nextElementSibling;
      let hasCard = false;
      while (n && !n.classList.contains("hist-sec")) {
        if (n.classList.contains("hist-card")) { hasCard = true; break; }
        n = n.nextElementSibling;
      }
      if (!hasCard) h.remove();
    }
    $("historyEmpty").hidden = grid.querySelector(".hist-card") != null;
  };
  $("libSelectAllBtn").onclick = () => {
    const cards = [...grid.querySelectorAll(".hist-card")];
    const all = cards.length > 0 && cards.every((c) => selected.has(c.dataset.key));
    selected.clear();
    if (!all) for (const c of cards) selected.add(c.dataset.key);
    for (const c of cards) {
      c.classList.toggle("selected", selected.has(c.dataset.key));
      const box = c.querySelector(".hc-select");
      if (box) box.checked = selected.has(c.dataset.key);
    }
    syncLibToolbar();
  };
  $("libDeleteSelBtn").onclick = async () => {
    if (!selected.size) return;
    if (!confirm(`Delete ${selected.size} selected item${selected.size === 1 ? "" : "s"}? This cannot be undone.`)) return;
    const keys = [...selected];
    selected.clear();
    for (const k of keys) {
      try { await deleteHistory(k); } catch {}
      grid.querySelector(`.hist-card[data-key="${CSS.escape(k)}"]`)?.remove();
    }
    pruneLibSections();
    syncLibToolbar();
    toast("Selected items deleted.");
  };
  $("libDeleteAllBtn").onclick = async () => {
    if (!grid.querySelector(".hist-card")) return;
    if (!confirm("Delete EVERYTHING in the library? This cannot be undone.")) return;
    await clearHistory();
    selected.clear();
    grid.innerHTML = "";
    pruneLibSections();
    syncLibToolbar();
    toast("Library cleared.");
  };
  buildViewSeg($("libViewRow"), state.libView, (v) => {
    state.libView = v;
    applyGalleryView(grid, v);
  }, LIBRARY_VIEWS);
  applyGalleryView(grid, state.libView);
  const allItems = await listHistory();
  let libCat = "all";
  let libQuery = "";
  const catOf = (it) => libCategory(it);
  const inCat = (filter, it) => {
    const c = catOf(it);
    if (filter === "all") return true;
    if (filter === "takes") return c === "takes";
    if (filter === "image") return c === "image";
    if (filter === "video") return c === "video";
    return c === filter;
  };
  const matches = (it) => {
    if (!inCat(libCat, it)) return false;
    if (libQuery) {
      const hay = ((it.name || "") + " " + (it.filename || "") + " " + (it.userPrompt || it.prompt || "") + " " + (it.providerLabel || it.provider || "") + " " + (it.character || "") + " " + (it.scene || "") + " " + (it.story || "")).toLowerCase();
      if (!hay.includes(libQuery)) return false;
    }
    return true;
  };
  const renderCats = () => {
    const row = $("libCatRow");
    if (!row) return;
    row.innerHTML = "";
    for (const [id, label] of LIB_CATS) {
      const n = id === "all" ? allItems.length : allItems.filter((it) => inCat(id, it)).length;
      const b = document.createElement("button");
      b.type = "button";
      b.dataset.cat = id;
      b.className = id === libCat ? "on" : "";
      b.textContent = label + " (" + n + ")";
      b.onclick = () => { libCat = id; renderCats(); drawItems(); };
      row.appendChild(b);
    }
  };
  const drawItems = () => {
    grid.innerHTML = "";
    selected.clear();
    const items = allItems.filter(matches);
    $("historyEmpty").hidden = items.length > 0;
    const groups = libCat === "image" ? [["image", "Images"]] : libCat === "video" ? [["video", "Video"]] : libCat === "storyboard" ? [["storyboard", "Storyboard"]] : [["video", "Video"], ["image", "Images"], ["storyboard", "Storyboard"], ["editor", "Editor"], ["voice", "Voice"], ["reader", "Reader"], ["import", "Imports"], ["takes", "Takes · sandbox"]];
    let any = false;
    for (const [cid, title] of groups) {
      if (libCat !== "all" && libCat !== cid) continue;
      const rows = libCat === "all" ? items.filter((it) => catOf(it) === cid) : items;
      if (!rows.length) continue;
      any = true;
      addSection(title, cid === "takes" ? "every take + image batch, auto-saved — stays until you delete it" : cid === "import" ? "files you imported — tap to reuse" : "");
      rows.forEach(addCard);
    }
    if (!any && items.length) items.forEach(addCard);
    pruneLibSections();
    syncLibToolbar();
  };
  const items = allItems;
  $("historyEmpty").hidden = items.length > 0;
  const finals = items.filter((it) => catOf(it) !== "takes");
  const takes = items.filter((it) => catOf(it) === "takes");
  const addSection = (title, note) => {
    const h = document.createElement("h4");
    h.className = "hist-sec";
    h.textContent = title;
    if (note) {
      const s = document.createElement("span");
      s.className = "hist-sec-note";
      s.textContent = note;
      h.appendChild(s);
    }
    grid.appendChild(h);
  };
  const addCard = (it) => {
    const cat = catOf(it);
    const card = document.createElement("div");
    card.className = "hist-card";
    card.dataset.key = it.key;
    const box = document.createElement("input");
    box.type = "checkbox";
    box.className = "hc-select";
    box.title = "Select this item";
    box.setAttribute("aria-label", "Select this item");
    box.checked = selected.has(it.key);
    if (box.checked) card.classList.add("selected");
    box.onclick = (e) => e.stopPropagation();
    box.onchange = () => {
      if (box.checked) selected.add(it.key);
      else selected.delete(it.key);
      card.classList.toggle("selected", box.checked);
      syncLibToolbar();
    };
    card.appendChild(box);
    const img = it.kind === "image" || it.kind === "image-take" || String(it.mime || "").startsWith("image/");
    const posterUrl = typeof it.poster === "string" && it.poster.startsWith("data:") ? it.poster : "";
    const media = document.createElement(posterUrl ? "img" : "div");
    if (posterUrl) {
      media.src = posterUrl; media.alt = it.locked ? "locked" : ""; media.loading = "lazy";
      media.onerror = () => {
        const ph = document.createElement("div");
        ph.className = "hc-ph";
        ph.textContent = cat === "voice" ? "♪" : cat === "reader" ? "✎" : cat === "import" ? "⤓" : cat === "editor" ? "✂" : img ? "◫" : "▶";
        media.replaceWith(ph);
      };
    }
    else {
      media.className = "hc-ph";
      media.textContent = cat === "voice" ? "♪" : cat === "reader" ? "✎" : cat === "import" ? "⤓" : cat === "editor" ? "✂" : cat === "image" ? "◫" : "▶";
      media.title = cat;
      if (!it.locked) {
        const ph = media;
        repairPoster(it, img).then((url) => {
          if (!url || !ph.isConnected) return;
          const el = document.createElement("img");
          el.src = url; el.alt = ""; el.loading = "lazy";
          el.onerror = () => { el.replaceWith(ph); };
          ph.replaceWith(el);
        }).catch(() => {});
      }
    }
    const body = document.createElement("div");
    body.className = "hc-body";
    const badge = document.createElement("span");
    badge.className = "hc-badge " + (cat === "takes" ? "hc-take" : "hc-final");
    badge.textContent =
      it.kind === "take"
        ? `take ${it.takeIndex || ""}`.trim()
        : it.kind === "image-take"
          ? `img take ${it.takeIndex || ""}`.trim()
          : cat === "takes" ? "take" : cat;
    const meta = document.createElement("span");
    meta.className = "mono";
    if (img) {
      const dims = it.width > 0 && it.height > 0 ? `${it.width}×${it.height}` : "";
      meta.textContent = `${new Date(it.ts).toLocaleDateString()} · ${dims} · ${it.aspect || ""}`.replace(/ · $/, "");
    } else {
      const shownDur = Number(it.actualDuration) > 0 ? Number(it.actualDuration) : Number(it.duration) || 0;
      meta.textContent = `${new Date(it.ts).toLocaleDateString()} · ${shownDur.toFixed(2)}s · ${it.aspect || ""}`;
    }
    const name = document.createElement("span");
    name.className = "mono hc-name";
    name.textContent = (it.name ? it.name + " · " : "") + (it.filename || "");
    name.title = [it.name, it.character ? "character: " + it.character : "", it.scene ? "scene: " + it.scene : "", it.story ? "story: " + it.story : ""].filter(Boolean).join(" · ");
    const p = document.createElement("p");
    p.textContent = it.locked
      ? "locked — enter the vault passphrase in Settings → Content safety"
      : (it.userPrompt || it.prompt || "").slice(0, 90) || "(no prompt)";
    body.append(badge, meta, name, p);
    const actions = document.createElement("div");
    actions.className = "hc-actions";
    const dl = document.createElement("button");
    dl.type = "button";
    dl.className = "btn btn-tiny";
    dl.textContent = "Download";
    dl.onclick = async (e) => {
      e.stopPropagation();
      const rec = await getHistory(it.key);
      if (!rec?.video) {
        return toast(
          rec?.locked
            ? "The vault is locked — enter your passphrase in Settings → Content safety."
            : "This item's file is no longer stored.",
          "warn"
        );
      }
      downloadBlob(rec.video, rec.filename || it.filename || `aivideogen-${it.key}.${rec.ext || (img ? "jpg" : "mp4")}`);
    };
    const ren = document.createElement("button");
    ren.type = "button";
    ren.className = "btn btn-tiny";
    ren.textContent = "Rename";
    ren.title = "Rename this item (name · character · scene)";
    ren.onclick = async (e) => {
      e.stopPropagation();
      const nm = prompt("Name:", it.name || "");
      if (nm == null) return;
      const ch = prompt("Character (optional):", it.character || "");
      if (ch == null) return;
      const sc = prompt("Scene (optional):", it.scene || "");
      if (sc == null) return;
      await updateHistory(it.key, { name: nm.trim().slice(0, 80), character: ch.trim().slice(0, 80), scene: sc.trim().slice(0, 80) });
      it.name = nm.trim().slice(0, 80); it.character = ch.trim().slice(0, 80); it.scene = sc.trim().slice(0, 80);
      name.textContent = (it.name ? it.name + " · " : "") + (it.filename || "");
      toast("Renamed.");
    };
    const del = document.createElement("button");
    del.type = "button";
    del.className = "btn btn-tiny";
    del.textContent = "Delete";
    del.onclick = async (e) => {
      e.stopPropagation();
      await deleteHistory(it.key);
      selected.delete(it.key);
      card.remove();
      pruneLibSections();
      syncLibToolbar();
    };
    actions.append(dl, ren, del);
    card.append(media, body, actions);
    card.onclick = async () => {
      const rec = await getHistory(it.key);
      try {
        const fetched = rec?.video;
        const mime = String(rec?.mime || it.mime || "");
        const nm = rec?.filename || it.filename || "library-file";
        if (rec && !rec.locked && fetched && fetched.size && (it.kind === "import" || it.kind === "voice" || it.kind === "reader")) {
          if (mime.startsWith("image/")) {
            $("historyDlg").close();
            const { setImgEditReuse, setVideoRefReuse } = await import("./library-save.js").catch(() => ({}));
            if (setImgEditReuse) setImgEditReuse(fetched, nm);
            if (setVideoRefReuse) setVideoRefReuse(fetched, nm);
            toast("Loaded into Image edit + Video starter.");
            return;
          }
          if (mime.startsWith("video/")) { $("historyDlg").close(); (await import("./library-save.js").catch(() => ({}))).setVideoRefReuse?.(fetched, nm); toast("Loaded into the Video starter."); return; }
          if (mime.startsWith("audio/")) { $("historyDlg").close(); window.__voiceLoadTrack?.(fetched, nm); toast("Loaded into the Voice track."); return; }
          if (mime.startsWith("text/") || /\.txt$/i.test(nm)) {
            $("historyDlg").close();
            if (it.kind === "reader" || /narrat|reader/i.test(nm)) { if ($("readerNarrOut")) $("readerNarrOut").value = await fetched.text(); }
            else if ($("voiceTextInput")) { $("voiceTextInput").value = await fetched.text(); document.querySelector('[data-page="pageVoice"]')?.click(); }
            toast("Text loaded.");
            return;
          }
        }
      } catch {}
      
      if (!rec?.video) {
        return toast(
          rec?.locked
            ? "The vault is locked — enter your passphrase in Settings → Content safety."
            : "This item's file is no longer stored.",
          "warn"
        );
      }
      if (img) {
        $("historyDlg").close();
        const url = URL.createObjectURL(rec.video);
        for (const old of state.imgResults) {
          try {
            URL.revokeObjectURL(old.url);
          } catch {}
        }
        state.imgResults = [
          {
            blob: rec.video,
            url,
            seed: rec.seed ?? 0,
            w: rec.width || 0,
            h: rec.height || 0,
            by: rec.providerLabel || "library",
            model: rec.provider || "",
            index: 0,
          },
        ];
        state.imgSelected = 0;
        if ((rec.userPrompt || rec.prompt) && !$("imgPromptInput").value.trim()) {
          $("imgPromptInput").value = rec.userPrompt || rec.prompt || "";
        }
        document.querySelector('[data-page="pageImage"]')?.click();
        if (window.__imgGridSync) window.__imgGridSync();
        toast("Loaded from the library.");
        return;
      }
      $("historyDlg").close();
      handleResult(
        {
          blob: rec.video,
          clips: rec.clips || 1,
          provider: getProvider(rec.provider),
          providerLabel: rec.providerLabel || "library",
          prompt: rec.prompt,
          negative: rec.negative,
          seed: rec.seed,
          duration: rec.duration,
          aspect: rec.aspect,
          quality: rec.quality,
          cameraMove: rec.cameraMove,
          cameraAngle: rec.cameraAngle,
          style: rec.style,
          nsfw: rec.nsfw,
          filename: rec.filename || it.filename || null,
          meta: { width: 0, height: 0, duration: rec.actualDuration },
          elapsed: 0,
        },
        { save: false }
      );
    };
    grid.appendChild(card);
  };
  renderCats();
  drawItems();
  const search = $("libSearchInput");
  if (search && !search.dataset.bound) {
    search.dataset.bound = "1";
    search.oninput = () => { libQuery = search.value.trim().toLowerCase(); drawItems(); };
  } else if (search) { search.value = ""; libQuery = ""; }
  syncLibToolbar();
  $("historyDlg").showModal();
}

/* ---------------------------------------------------------------- settings */

let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(doSave, 350);
}

async function doSave() {
  const gens = genCfg();
  const patch = {
    // The two generators own the model choice now; `provider` (the old single
    // pick) is kept only so an old saved setting still loads, and is ignored by
    // the engine whenever a run supplies `generators`.
    provider: "auto",
    genStandard: gens.standard,
    genNsfw: gens.nsfw,
    aspect: state.aspect,
    quality: state.quality,
    style: $("styleSel").value,
    seed: $("seedInput").value.trim(),
    steps: Number($("stepsInput").value) || 0,
    nsfw: $("nsfwToggle").checked,
    nsfwFrame: $("nsfwFrameSel").value,
    undress: $("undressToggle").checked,
    fps: Number($("fpsSel").value) || 0,
    duration: state.duration,
    durUnit: state.durUnit || "s",
    crossfade: Number($("xfadeRange").value),
    allowPaidOnAuto: $("paidToggle").checked,
    theme: state.theme,
    imgFormat: state.imgFormat,
    imgScale: state.imgScale,
    imgUpscaleMode: state.imgUpscaleMode,
    vidFormat: state.vidFormat,
    vidScale: state.vidScale,
    vidUpscaleMode: state.vidUpscaleMode,
  };
  Object.assign(state.settings, patch);
  await saveSettings(patch);
}

function bindTokenFields() {
  const map = [
    ["hfTokenInput", "hfToken"],
    ["hordeKeyInput", "hordeKey"],
    ["repInput", "replicateToken"],
    ["falInput", "falKey"],
    ["runwayInput", "runwayKey"],
    ["muapiKeyInput", "muapiKey"],
  ];
  for (const [id, key] of map) {
    const el = $(id);
    if (!el) continue;
    el.value = state.settings[key] || "";
    el.onchange = async () => {
      state.settings[key] = el.value.trim();
      await saveSettings({ [key]: state.settings[key] });
      if (key === "muapiKey") renderMuapiNote();
      if (key === "hordeKey") renderHordeNote();
    };
  }

  const modelSels = { replicate: "repModelSel", fal: "falModelSel", runway: "runwayModelSel" };
  for (const kp of KEY_PROVIDERS) {
    const sel = $(modelSels[kp.id]);
    if (!sel) continue;
    sel.innerHTML = "";
    for (const m of kp.models) {
      const o = document.createElement("option");
      o.value = m.id;
      o.textContent = `${m.label} · up to ${m.maxSec}s`;
      sel.appendChild(o);
    }
    sel.value = state.settings.keyModels?.[kp.id] || kp.models[0].id;
    sel.onchange = () => saveSettings({ keyModels: { ...(state.settings.keyModels || {}), [kp.id]: sel.value } });
  }
}

function bindComputeFields() {
  const s = state.settings;
  $("computeSel").value = s.computeMode || "auto";
  $("serverUrlInput").value = s.serverUrl || "";
  $("serverTokenInput").value = s.serverToken || "";
  setSwitch("poolToggle", s.poolEnabled !== false);
  setSwitch("offlineFallbackToggle", s.offlineFallback !== false);

  $("computeSel").onchange = async () => {
    s.computeMode = $("computeSel").value;
    await saveSettings({ computeMode: s.computeMode });
    renderServerStatus();
    rebuildGenSelects();
  };
  $("serverUrlInput").onchange = () => refreshServer({ save: true });
  $("serverTokenInput").onchange = async () => {
    s.serverToken = $("serverTokenInput").value.trim();
    await saveSettings({ serverToken: s.serverToken });
  };
  $("testServerBtn").onclick = () => refreshServer({ save: true });
  $("serverHelpBtn").onclick = () => $("serverHelpDlg").showModal();
  $("poolToggle").onchange = async () => {
    s.poolEnabled = $("poolToggle").checked;
    await saveSettings({ poolEnabled: s.poolEnabled });
  };
  $("offlineFallbackToggle").onchange = async () => {
    s.offlineFallback = $("offlineFallbackToggle").checked;
    await saveSettings({ offlineFallback: s.offlineFallback });
  };
  setSwitch("communityOptInToggle", s.communityOptIn === true);
  const syncPoolNote = () => { const el = $("communityPoolNote"); if (el) el.textContent = poolStatus(state.settings).text; };
  syncPoolNote();
  $("communityOptInToggle").onchange = async () => {
    s.communityOptIn = $("communityOptInToggle").checked;
    await saveSettings({ communityOptIn: s.communityOptIn });
    syncPoolNote();
  };
}

function bindPrivacyFields() {
  const s = state.settings;
  setSwitch("strictPrivacyToggle", s.strictPrivacy !== false);
  setSwitch("freshRunToggle", s.freshRun !== false);
  setSwitch("wipeTracesToggle", s.wipeTraces !== false);
  setSwitch("autoResetToggle", s.autoReset !== false);
  setSwitch("untraceToggle", s.untrace !== false);
  setSwitch("perchanceRelayToggle", s.usePerchanceRelay !== false);
  setSwitch("publicRelayToggle", s.usePublicRelays === true);
  $("relayModeSel").value = s.relayMode || "generation";

  const save = (patch) => saveSettings(patch).then(() => {
    syncPrivacyNotes();
    renderRelayModeNote();
  });
  $("strictPrivacyToggle").onchange = () => save({ strictPrivacy: $("strictPrivacyToggle").checked });
  $("freshRunToggle").onchange = () => save({ freshRun: $("freshRunToggle").checked });
  $("wipeTracesToggle").onchange = () => save({ wipeTraces: $("wipeTracesToggle").checked });
  $("autoResetToggle").onchange = () => save({ autoReset: $("autoResetToggle").checked });
  $("untraceToggle").onchange = () => save({ untrace: $("untraceToggle").checked });
  $("perchanceRelayToggle").onchange = () => save({ usePerchanceRelay: $("perchanceRelayToggle").checked });
  $("publicRelayToggle").onchange = () => save({ usePublicRelays: $("publicRelayToggle").checked });
  $("relayModeSel").onchange = () => save({ relayMode: $("relayModeSel").value });

  $("addRelayBtn").onclick = async () => {
    const raw = $("relayInput").value.trim();
    if (!raw) return;
    const relay = customRelay(raw);
    if (!relay) {
      toast("That doesn't look like a URL.", "warn");
      return;
    }
    const list = state.settings.relays || [];
    if (list.some((r) => customRelay(r.url || r)?.id === relay.id)) {
      toast("Already added.");
      return;
    }
    list.push({ url: relay.base || normalRelayUrl(raw), label: relay.label });
    state.settings.relays = list;
    await saveSettings({ relays: list });
    $("relayInput").value = "";
    renderRelays();
    syncPrivacyNotes();
    renderRelayModeNote();
    toast(`Relay added — ${rotatableCount(state.settings)} address${rotatableCount(state.settings) === 1 ? "" : "es"} now available.`, "ok");
  };
  $("relayInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      $("addRelayBtn").click();
    }
  });

  $("resetAllowanceBtn").onclick = () => openResetDlg();
  $("wipeTracesBtn").onclick = async () => {
    const report = await wipeTraces();
    logLine(`traces wiped → ${describeWipe(report)}`, "ok");
    toast(`Wiped: ${describeWipe(report)}.`, "ok", 6000);
  };
  $("checkIpBtn").onclick = async () => {
    const host = $("ipList");
    host.innerHTML = "";
    const btn = $("checkIpBtn");
    btn.disabled = true;
    btn.textContent = "Checking…";
    const row = (rec) => {
      const el = document.createElement("div");
      el.className = "space-item";
      const l = document.createElement("span");
      l.className = "mono";
      l.textContent = rec.label;
      const r = document.createElement("span");
      r.className = "mono tiny";
      const shown = rec.ip ? maskIpUi(rec.ip) : "";
      r.textContent = rec.ip ? `${shown}${rec.ms ? ` · ${rec.ms}ms` : ""}` : rec.error || "…";
      r.title = rec.ip ? "masked — full address stays in this device's private diagnostics" : "";
      el.append(l, r);
      return el;
    };
    try {
      const results = await checkRelays(state.settings, {
        untrace: state.settings.untrace !== false,
        onEach: (rec) => {
          if (![...host.children].some((c) => c.dataset.id === rec.id)) {
            const el = row(rec);
            el.dataset.id = rec.id;
            host.appendChild(el);
          } else {
            const el = [...host.children].find((c) => c.dataset.id === rec.id);
            el.replaceWith(Object.assign(row(rec), { dataset: { id: rec.id } }));
          }
        },
      });
      const yours = results.find((r) => r.id === "direct");
      const others = results.filter((r) => r.id !== "direct" && r.ip);
      const distinct = new Set(results.filter((r) => r.ip).map((r) => r.ip));
      logLine(`address check · yours ${maskIpUi(yours?.ip || "?")} · ${others.length} relay${others.length === 1 ? "" : "s"} · ${distinct.size} distinct address${distinct.size === 1 ? "" : "es"}`, "ok");
      toast(`${distinct.size} distinct address${distinct.size === 1 ? "" : "es"} available${others.length ? "" : " — add a relay to change address per generation"}.`, others.length ? "ok" : "warn", 7000);
    } catch (e) {
      toast(`Address check failed: ${e.message}`, "err");
    } finally {
      btn.disabled = false;
      btn.textContent = "Check addresses";
    }
  };
function maskIpUi(ip) {
  const s = String(ip || "");
  const m = s.match(/^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/);
  if (m) return `${m[1]}.${m[2]}.x.x`;
  if (s.includes(":")) return s.split(":").slice(0, 2).join(":") + ":xxxx::xxxx";
  return s || "?";
}

function renderDiagBox() {
  const box = $("diagBox");
  if (!box) return;
  let lines = [];
  try {
    lines = (window.__diag?.list?.() || []).slice(-40);
  } catch {}
  if (!lines.length) {
    box.textContent = "Diagnostics idle — press Check addresses or Probe Perchance hooks.";
    return;
  }
  box.innerHTML = "";
  for (const r of lines) {
    const div = document.createElement("div");
    div.className = "ln" + (r.kind.includes("fail") ? " err" : r.kind.includes("ok") ? " ok" : "");
    const t = document.createElement("span");
    t.className = "t";
    t.textContent = String(r.t || "").slice(11, 19);
    const msg = document.createElement("span");
    msg.className = "m";
    msg.textContent = `[${r.kind}] ${maskIpUi(String(r.msg || "").replace(/\b(\d{1,3}\.\d{1,3})\.\d{1,3}\.\d{1,3}\b/g, "$1.x.x"))}`;
    div.append(t, msg);
    box.appendChild(div);
  }
  box.scrollTop = box.scrollHeight;
}

function wireDiagPanel() {
  if ($("probeHooksBtn")?.dataset.bound) return;
  const rt = $("relayTimeoutInput");
  if (rt) {
    rt.value = String(Math.round(Number(state.settings.relayTimeoutMs || 45000) / 1000));
    rt.onchange = () => {
      const s = Math.min(300, Math.max(5, Number(rt.value) || 45));
      state.settings.relayTimeoutMs = s * 1000;
      scheduleSave();
      toast(`Relay timeout: ${s}s per path.`, "ok");
    };
  }
  const vn = $("vpnNoteInput");
  if (vn) {
    vn.value = state.settings.vpnNote || "";
    vn.onchange = () => {
      state.settings.vpnNote = String(vn.value || "").slice(0, 120);
      scheduleSave();
    };
  }
  const mark = (id) => { const b = $(id); if (b) b.dataset.bound = "1"; };
  mark("probeHooksBtn"); mark("copyDiagBtn"); mark("clearDiagBtn");
  if ($("probeHooksBtn")) $("probeHooksBtn").onclick = async () => {
    const btn = $("probeHooksBtn");
    btn.disabled = true;
    btn.textContent = "Probing…";
    try {
      const { diag } = await import("./diag.js");
      const { relayFetch, egressIp, PERCHANCE_RELAY } = await import("./relay.js");
      const hasSf = !!(typeof root !== "undefined" && root.superFetch);
      diag("diag", `Perchance hook: superFetch ${hasSf ? "present" : "MISSING"}`);
      if (hasSf) {
        try {
          const r = await relayFetch(PERCHANCE_RELAY, "https://api.ipify.org?format=json", { method: "GET" }, { timeoutMs: Number(state.settings.relayTimeoutMs) || 45000 });
          diag("diag-ok", `Perchance proxy answered ${r.status} — egress path works`);
        } catch (e) {
          diag("diag-fail", `Perchance proxy probe: ${String(e?.message || e).slice(0, 120)}`);
        }
        try {
          const ip = await egressIp(PERCHANCE_RELAY);
          diag("diag-ok", `Perchance egress verified (${maskIpUi(ip)})`);
        } catch (e) {
          diag("diag-fail", `Perchance egress check: ${String(e?.message || e).slice(0, 120)}`);
        }
      }
      const vpn = state.settings.vpnNote ? ` · vpn note: ${state.settings.vpnNote}` : "";
      diag("diag", `pool: ${rotatableCount(state.settings)} path(s) · strict ${state.settings.strictPrivacy !== false ? "on" : "off"} · rotation ${state.settings.relayMode || "off"}${vpn}`);
    } finally {
      btn.disabled = false;
      btn.textContent = "Probe Perchance hooks";
      renderDiagBox();
    }
  };
  if ($("copyDiagBtn")) $("copyDiagBtn").onclick = async () => {
    let txt = "";
    try {
      txt = window.__diag?.text?.() || "";
    } catch {}
    const ok = await copyText(txt || "no diagnostics yet");
    toast(ok ? "Diagnostics copied (masked paths)." : "Couldn't copy automatically.", ok ? "ok" : "warn");
  };
  if ($("clearDiagBtn")) $("clearDiagBtn").onclick = () => {
    try {
      window.__diag?.clear?.();
    } catch {}
    renderDiagBox();
  };
  try {
    window.removeEventListener("app-diag", renderDiagBox);
  } catch {}
  try {
    window.addEventListener("app-diag", () => renderDiagBox());
  } catch {}
  renderDiagBox();
}

function wireRelayHelp() {
  if ($("relayHelpBtn")?.dataset.bound) return;
  $("relayHelpBtn").dataset.bound = "1";
  $("relayHelpBtn").onclick = () => {
    const pre = $("relayWorkerPre");
    const src = document.getElementById("relayWorkerSrc");
    if (pre && src && !pre.textContent.trim()) pre.textContent = src.textContent.trim();
    $("relayHelpDlg").showModal();
  };
  $("copyWorkerBtn").onclick = async () => {
    const pre = $("relayWorkerPre");
    const src = document.getElementById("relayWorkerSrc");
    const text = (pre?.textContent || "").trim() || (src?.textContent || "").trim();
    const ok = await copyText(text);
    toast(ok ? "Worker code copied — paste it into Cloudflare." : "Couldn't copy automatically.", ok ? "ok" : "warn");
  };
  wireDiagPanel();
  wireRelayHelp();
}
}

function normalRelayUrl(raw) {
  const s = String(raw || "").trim();
  return /^https?:\/\//i.test(s) ? s : "https://" + s;
}

function renderMuapiNote() {
  const p = currentProvider();
  const has = !!state.settings.muapiKey;
  const bits = [];
  if (p?.kind === "muapi") {
    bits.push(`${p.label} — ${p.vendor}.`);
    if (p.model?.note) bits.push(p.model.note);
    bits.push("Every MuAPI request is relayed through Perchance's proxy (the API sends no CORS headers), and the reference frame is published to a public URL first because the API rejects data URLs.");
  } else {
    bits.push("Pick a MuAPI model in the model list to use it — they are grouped into six sections. One key unlocks all 51.");
  }
  bits.push(has ? "Key present." : "No key yet — MuAPI has no free tier; generations are paid with that account's credits.");
  note("muapiNote", bits.join(" "));
}

/**
 * A key AI Horde has refused says nothing on its own — it just quietly makes
 * every step fail. Whenever one is rejected, the run drops to the anonymous
 * key (so it still produces a clip) and this note says so next to the field,
 * because a log line scrolled away is not where a mistyped key gets fixed.
 */
function renderHordeNote() {
  const el = $("hordeKeyNote");
  if (!el) return;
  const stored = String(state?.settings?.hordeKey || "").trim();
  const bad = hordeRejectedKey();
  if (stored && bad && stored === bad) {
    el.hidden = false;
    el.className = "model-note warn";
    el.textContent =
      "AI Horde refused this key (401 — “no user matching sent API key”), so runs fall back to the anonymous lane: " +
      "they still work, but a keyframe can queue 5–15 minutes. Copy a fresh key from aihorde.net/register, or clear the field.";
  } else {
    el.hidden = true;
    el.textContent = "";
  }
}

function bindMuapiFields() {
  $("muapiHelpBtn").onclick = () => window.open("https://muapi.ai", "_blank", "noopener");
  $("muapiBalanceBtn").onclick = async () => {
    const out = $("muapiBalanceOut");
    if (!state.settings.muapiKey) {
      out.textContent = "Add a MuAPI key first.";
      return;
    }
    out.textContent = "Checking…";
    try {
      const bal = await muapiBalance({ settings: state.settings });
      out.textContent = bal.credits == null ? "Connected, but the balance shape was unexpected — see the log." : `Credits: ${bal.credits}${bal.currency ? ` ${bal.currency}` : ""}.`;
      if (bal.credits == null) logLine(`muapi balance raw: ${JSON.stringify(bal.raw).slice(0, 300)}`);
    } catch (e) {
      out.textContent = e.message;
    }
  };
  $("muapiQuoteBtn").onclick = async () => {
    const out = $("muapiQuoteOut");
    const p = currentProvider();
    if (!p || p.kind !== "muapi") {
      out.textContent = "Select a MuAPI model in the model list first.";
      return;
    }
    out.textContent = "Asking MuAPI for the exact price…";
    try {
      const q = await muapiEstimate(p.model, {
        settings: state.settings,
        prompt: $("promptInput").value.trim() || "a cat",
        negative: $("negInput").value.trim(),
        duration: state.duration,
        aspect: state.aspect,
        quality: state.quality,
        seed: Number($("seedInput").value) || Math.floor(Math.random() * 1e9),
      });
      out.textContent = q.usd != null ? `${p.label}: about $${q.usd.toFixed(3)} for ${state.duration}s at ${state.aspect}.` : `Quote returned, but no price field — see the log.`;
      if (q.usd == null) logLine(`muapi quote raw: ${JSON.stringify(q.raw).slice(0, 300)}`);
    } catch (e) {
      out.textContent = `Quote failed: ${e.message}`;
    }
  };
}

/* ------------------------------------------------------------ color grade */

function gradeOf(kind) {
  const k = kind === "img" ? "imgGrade" : "vidGrade";
  if (!state[k]) state[k] = defaultGrade();
  return state[k];
}

function paintVidGrade() {
  const g = gradeOf("vid");
  const on = gradeActive(g);
  const f = cssFilterFor(g);
  for (const id of ["outVideo", "outPoster"]) {
    const n = $(id);
    if (n) n.style.filter = on ? f : "";
  }
  const veil = $("vidGradeVeil");
  const a = tintAlphaFor(g);
  if (veil) {
    veil.hidden = !(on && a > 0.003);
    veil.style.background = tintCssFor(g) || "transparent";
    veil.style.opacity = String(Math.min(1, a));
  }
  const scr = $("screen");
  if (scr) paintLiveOverlays(scr, g);
  const st = $("vidGradeState");
  if (st) st.textContent = on ? "on" : "off";
}

function paintImgGrade() {
  const g = gradeOf("img");
  const on = gradeActive(g);
  const hero = $("imgHero");
  if (hero) hero.style.filter = on ? cssFilterFor(g) : "";
  const veil = $("imgGradeVeil");
  const a = tintAlphaFor(g);
  if (veil) {
    veil.hidden = !(on && a > 0.003);
    veil.style.background = tintCssFor(g) || "transparent";
    veil.style.opacity = String(Math.min(1, a));
  }
  const wrap = $("imgHeroWrap");
  if (wrap) paintLiveOverlays(wrap, g);
  const st = $("imgGradeState");
  if (st) st.textContent = on ? "on" : "off";
}

async function initStickerBars() {
  let mod;
  try {
    mod = await import("./stickers.js");
  } catch {
    return;
  }
  const pairs = [
    { bar: "imgStickerBar", host: "imgHeroWrap", frame: "imgFrameSel" },
    { bar: "vidStickerBar", host: "screen", frame: "vidFrameSel" },
    { bar: "sbStickerBar", host: null, frame: null },
  ];
  for (const { bar, host, frame } of pairs) {
    const barEl = $(bar);
    if (!barEl || barEl.dataset.bound) continue;
    barEl.dataset.bound = "1";
    for (const e of mod.STICKERS.slice(0, 12)) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "stk-pick";
      b.textContent = e;
      b.title = "Add " + e;
      b.onclick = () => {
        const h = host ? $(host) : document.querySelector(".sb-viewer-wrap");
        if (h) mod.addSticker(h, e);
      };
      barEl.appendChild(b);
    }
    const clear = document.createElement("button");
    clear.type = "button";
    clear.className = "btn btn-tiny";
    clear.textContent = "Clear";
    clear.title = "Remove all stickers";
    clear.onclick = () => {
      const h = host ? $(host) : document.querySelector(".sb-viewer-wrap");
      if (h) mod.clearStickers(h);
    };
    barEl.appendChild(clear);
    if (frame) {
      const sel = $(frame);
      if (sel && !sel.dataset.bound) {
        sel.dataset.bound = "1";
        sel.innerHTML = "";
        for (const f of mod.FRAMES) {
          const o = document.createElement("option");
          o.value = f.id;
          o.textContent = f.label;
          sel.appendChild(o);
        }
        sel.onchange = () => {
          const h = host ? $(host) : null;
          if (h) mod.setFrame(h, sel.value);
        };
      }
    }
  }
}

function stickerPayload(hostId) {
  const h = typeof hostId === "string" ? $(hostId) || document.querySelector(hostId) : hostId;
  if (!h) return { stickers: [], frame: "none" };
  const layer = h.querySelector(":scope > .sticker-layer");
  const stickers = layer ? [...layer.querySelectorAll(".stk")].map((s) => ({
    emoji: s.textContent,
    x: parseFloat(s.style.left) / 100 || 0,
    y: parseFloat(s.style.top) / 100 || 0,
    size: parseFloat(s.style.fontSize) || 34,
  })) : [];
  const frame = h.querySelector(":scope > .frame-layer")?.dataset.frame || "none";
  return { stickers, frame };
}

function syncGradeInputs(p, g, fields) {  for (const { suf, key, dec } of fields) {
    const inp = $(p + suf);
    const lab = $(p + suf + "Val");
    if (inp) inp.value = String(g[key]);
    if (lab) lab.textContent = Number(g[key]).toFixed(dec);
  }
  const tint = $(p + "Tint");
  if (tint && g.tint) tint.value = g.tint;
  const row = $(p === "vg" ? "vgPresetRow" : "igPresetRow");
  if (row) {
    for (const b of row.children) b.classList.toggle("on", b.dataset.preset === g.preset);
  }
}

function bindGradeUI(p, kind, fields, paint) {
  const g = gradeOf(kind);
  const rowId = p === "vg" ? "vgPresetRow" : "igPresetRow";
  const row = $(rowId);
  if (row && !row.dataset.bound) {
    row.dataset.bound = "1";
    for (const pr of GRADE_PRESETS) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "chip-btn";
      b.dataset.preset = pr.id;
      b.textContent = pr.label;
      b.title = pr.label;
      b.onclick = () => {
        applyPreset(gradeOf(kind), pr.id);
        syncGradeInputs(p, gradeOf(kind), fields);
        paint();
      };
      row.appendChild(b);
    }
  }
  for (const { suf, key, dec } of fields) {
    const inp = $(p + suf);
    if (inp && !inp.dataset.bound) {
      inp.dataset.bound = "1";
      inp.oninput = () => {
        const gg = gradeOf(kind);
        gg[key] = Number(inp.value);
        gg.preset = "custom";
        const lab = $(p + suf + "Val");
        if (lab) lab.textContent = Number(inp.value).toFixed(dec);
        const r = $(rowId);
        if (r) for (const b of r.children) b.classList.remove("on");
        paint();
      };
    }
  }
  const tint = $(p + "Tint");
  if (tint && !tint.dataset.bound) {
    tint.dataset.bound = "1";
    tint.oninput = () => {
      const gg = gradeOf(kind);
      gg.tint = tint.value;
      if (Number(gg.tintAlpha) <= 0) {
        gg.tintAlpha = 0.2;
        const ta = $(p + "TintAlpha");
        if (ta) {
          ta.value = "0.2";
          const lab = $(p + "TintAlphaVal");
          if (lab) lab.textContent = Number(0.2).toFixed(2);
        }
      }
      gg.preset = "custom";
      paint();
    };
  }
  const reset = $(p === "vg" ? "vgReset" : "igReset");
  if (reset && !reset.dataset.bound) {
    reset.dataset.bound = "1";
    reset.onclick = () => {
      state[kind === "img" ? "imgGrade" : "vidGrade"] = defaultGrade();
      syncGradeInputs(p, gradeOf(kind), fields);
      paint();
    };
  }
  syncGradeInputs(p, g, fields);
  paint();
}

/* ------------------------------------------------------------------- verbs */

async function download() {
  if (!state.result) return;
  const btn = $("downloadBtn");
  const prev = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Exporting…";
  try {
    const needsScale = String(state.vidScale || "1") !== "1";
    if ((state.vidUpscaleMode === "ai" || state.vidUpscaleMode === "quality") && needsScale) {
      toast((state.vidUpscaleMode === "ai" ? "AI" : "Quality") + " upscale runs on every frame — slower, sharper.");
    }
    const out = await exportVideo(state.result.blob, {
      container: state.vidFormat,
      quality: state.vidQuality,
      scale: state.vidScale || "1",
      upscaleMode: state.vidUpscaleMode || "fast",
      grade: gradeActive(state.vidGrade) ? state.vidGrade : null,
      ...stickerPayload("screen"),
      onProgress: (p) => {
        btn.textContent = `Exporting ${Math.round(p * 100)}%`;
      },
    });
    const base = String(state.result.filename || `aivideogen-v1-${String(state.result.seed || Date.now()).slice(-6)}`).replace(/\.(mp4|webm)$/i, "");
    downloadBlob(out.blob, `${base}.${out.ext}`);
    if (out.graded) toast("Grade applied on export.");
    if (out.upscaled) toast(`Upscaled ${String(state.vidScale || "1").toLowerCase()} to ${out.w}x${out.h} · ${out.ext.toUpperCase()}` + (out.method ? ` · ${out.method}` : "") + ".");
    else if (!out.passthrough) toast(`Re-muxed to ${out.ext.toUpperCase()} · ${(out.blob.size / 1e6).toFixed(2)} MB.`);
  } catch (e) {
    toast(`Export failed: ${e?.message || e}`, "err");
  } finally {
    btn.disabled = false;
    btn.textContent = prev;
  }
}

async function reroll() {
  if (state.busy) return;
  $("seedInput").value = String(Math.floor(Math.random() * 1e9));
  await saveSettings({ seed: $("seedInput").value });
  run();
}

async function continueFromLastFrame() {
  if (!state.result) return;
  toast("Extracting the final frame…");
  try {
    const frame = await extractFrame(state.result.blob, "last");
    const f = new File([frame], "last-frame.jpg", { type: "image/jpeg" });
    await acceptFile(f);
    toast("Final frame is now the reference image — describe what happens next.");
  } catch {
    toast("Couldn't read the last frame.", "err");
  }
}

async function share() {
  if (!state.result) return;
  // Sharing is the one route the leak guard cannot decide for you — it is your
  // own deliberate action — so it asks, and it says exactly what the upload
  // means before it happens.
  const lines = ["Sharing uploads this clip to a public file host: anyone with the link can read it for 30 days."];
  if (state.result.nsfw) lines.push("This clip is flagged NSFW.");
  if (state.settings.leakGuard !== false) lines.push("Your leak guard is on, but a share is you asking for a public URL — it cannot block this.");
  if (!confirm(lines.join(" "))) return;
  toast("Uploading for sharing…");
  try {
    const up = await root.uploadPlugin(state.result.blob, { expires: Date.now() + 1000 * 60 * 60 * 24 * 30 });
    if (up.error) throw new Error(up.error);
    const key = uid();
    await root.kv.avg_shared.set(key, {
      url: up.url,
      ts: Date.now(),
      prompt: state.result.prompt,
      duration: state.result.duration,
      aspect: state.result.aspect,
      nsfw: state.result.nsfw,
    });
    const link = `https://perchance.org/${window.generatorName || ""}#v=${key}`;
    await copyText(link);
    toast("Share link copied — it works for 30 days.", "", 6000);
    logLine(`shared → ${link}`);
  } catch (e) {
    toast(`Share failed: ${e.message || e}`, "err", 7000);
  }
}

async function loadShared(key) {
  try {
    const k = String(key || "").slice(0, 64);
    if (!/^[A-Za-z0-9_-]+$/.test(k)) return;
    const rec = await root.kv.avg_shared.get(k);
    if (!rec?.url) return;
    let u = null;
    try { u = new URL(rec.url); } catch { return; }
    if (u.protocol !== "https:") return;
    const r = await fetch(rec.url);
    if (!r.ok) return;
    const len = Number(r.headers.get("content-length") || 0);
    if (len && len > 50000000) return;
    const blob = await r.blob();
    if (!blob || blob.size > 50000000 || (blob.type && !/^(video|image)\//.test(blob.type))) return;
    logLine("loaded a shared clip from the link");
    handleResult(
      {
        blob,
        clips: 1,
        provider: null,
        providerLabel: "shared",
        prompt: String(rec.prompt || "").slice(0, 2000),
        negative: "",
        seed: String(rec.seed ?? "").slice(0, 32),
        duration: Math.min(60, Math.max(1, Number(rec.duration) || 5)),
        aspect: ["16:9", "9:16", "1:1"].includes(rec.aspect) ? rec.aspect : "16:9",
        quality: "480p",
        nsfw: !!rec.nsfw,
        meta: { width: 0, height: 0, duration: rec.duration },
        elapsed: 0,
      },
      { save: false }
    );
  } catch {}
}

/* ---------------------------------------------------------- content safety */

/**
 * The vault's state, said plainly. This is the honest version on purpose: with
 * no passphrase the key sits on the same device as the ciphertext, which
 * defeats a casual look and nothing more.
 */
async function renderVaultNote() {
  const el = $("vaultNote");
  if (!el) return;
  const st = await vaultState();
  const wanted = state.settings.vault !== false;
  const bits = [];
  if (!st.supported) {
    bits.push("This browser has no WebCrypto, so the library cannot be encrypted here.");
  } else if (!st.enabled) {
    bits.push(
      wanted
        ? "On — the key is generated the first time a clip is saved, so there is nothing to encrypt yet. Everything stored from then on is encrypted."
        : "Off — clips are stored as ordinary files. Turn this on and everything saved from now on is encrypted."
    );
  } else if (st.locked) {
    bits.push("Locked — the key is wrapped by your passphrase, so the library cannot be read until you type it above. Nothing already saved is lost; it is simply unreadable without it.");
  } else if (st.hasPassphrase) {
    bits.push("Encrypted, and unlocked for this session. The key is wrapped by your passphrase and is not stored on its own.");
  } else {
    bits.push("Encrypted under a device key. That defeats a casual look at this origin's storage; it does not stop someone with the machine or the browser profile. A passphrase makes it a real lock.");
  }
  bits.push("A passphrase cannot be recovered — losing it loses the library, by design.");
  el.textContent = bits.join(" ");

  const btn = $("vaultPassBtn");
  if (btn) btn.textContent = st.locked ? "Unlock" : st.hasPassphrase ? "Change" : "Set";
  const lockBtn = $("vaultLockBtn");
  if (lockBtn) lockBtn.hidden = !st.hasPassphrase || st.locked;
}

function renderRoutingNote() {
  const sel = $("nsfwRoutingSel");
  if (!sel) return;
  const m = ROUTING_MODES.find((x) => x.id === sel.value);
  note("nsfwRoutingNote", m ? m.note : "");
}

/**
 * The leak audit, drawn from the same function the engine consults, so the panel
 * cannot drift from the behaviour: every route this run's content can take, what
 * travels, where it lands, and how exposed it is — before anything is sent.
 */
async function renderEgress() {
  const host = $("egressList");
  if (!host) return;
  const gens = genCfg();
  const cfg = gens.nsfw.on ? gens.nsfw : gens.standard;
  const provider = cfg.mode === "selected" ? findAny(cfg.pick) : null;
  const nsfw = gens.nsfw.on;
  const undress = nsfw && $("undressToggle").checked;
  const frameMode = $("nsfwFrameSel").value;
  const audit = auditEgress(state.settings, { nsfw, undress, frameMode, hasImage: !!state.refImage || refExtrasList().length > 0, provider });

  host.innerHTML = "";
  const RISK_TEXT = { none: "stays here", device: "your machine", low: "prompt only", vendor: "vendor", third: "third party", public: "PUBLIC" };
  for (const r of audit.rows) {
    const row = document.createElement("div");
    row.className = "egress-row risk-" + r.risk;
    const top = document.createElement("div");
    top.className = "eg-top";
    const label = document.createElement("strong");
    label.textContent = r.label;
    const risk = document.createElement("span");
    risk.className = "eg-risk";
    risk.textContent = RISK_TEXT[r.risk] || r.risk;
    top.append(label, risk);
    const what = document.createElement("div");
    what.className = "eg-what";
    what.textContent = `${r.what} → ${r.where}`;
    const detail = document.createElement("div");
    detail.className = "eg-detail";
    detail.textContent = r.detail;
    row.append(top, what, detail);
    host.appendChild(row);
  }

  const sum = $("localNote");
  if (sum) {
    if (!provider && cfg.mode !== "selected") {
      sum.className = "model-note";
      sum.textContent =
        "This audit is for the models this generator's pool can reach — the specific model is picked when a run starts. " +
        `Overall: ${audit.local ? "nothing here leaves the device." : audit.publicUrl ? "a public upload is involved." : "content reaches " + (audit.thirdParty ? "a third party." : "a vendor you chose.")}`;
    } else if (audit.local) {
      sum.className = "model-note";
      sum.textContent = "Nothing in this run leaves the device.";
    } else if (audit.publicUrl) {
      sum.className = "model-note warn";
      sum.textContent = "This run would publish your picture to a public URL. The leak guard blocks it unless you switch the guard off.";
    } else {
      sum.className = "model-note";
      sum.textContent = `This run sends your content to ${audit.thirdParty ? "a third party" : "a vendor you chose"}. ${
        state.settings.strictPrivacy !== false
          ? "It leaves through a relay, so the address is hidden — but a relay reads what it carries."
          : "It leaves from your own connection."
      }`;
    }
  }
}

function bindSafetyFields() {
  const s = state.settings;
  setSwitch("vaultToggle", s.vault !== false);
  setSwitch("leakGuardToggle", s.leakGuard !== false);
  setSwitch("localOnlyToggle", !!s.localOnly);

  const sel = $("nsfwRoutingSel");
  sel.innerHTML = "";
  for (const m of ROUTING_MODES) {
    const o = document.createElement("option");
    o.value = m.id;
    o.textContent = m.label;
    sel.appendChild(o);
  }
  sel.value = s.nsfwRouting || "strict";
  renderRoutingNote();
  state.safetyReady = true;
  renderVaultNote();
  renderEgress();

  $("vaultToggle").onchange = async () => {
    s.vault = $("vaultToggle").checked;
    if (s.vault) await ensureVault();
    await saveSettings({ vault: s.vault });
    renderVaultNote();
    toast(s.vault ? "The library is encrypted at rest from now on." : "Encryption off — new saves are stored as plain files.");
  };
  $("leakGuardToggle").onchange = async () => {
    s.leakGuard = $("leakGuardToggle").checked;
    await saveSettings({ leakGuard: s.leakGuard });
    renderEgress();
  };
  $("localOnlyToggle").onchange = async () => {
    s.localOnly = $("localOnlyToggle").checked;
    await saveSettings({ localOnly: s.localOnly });
    renderEgress();
    logLine(
      s.localOnly
        ? "nothing-leaves-device mode on — only your own server and the on-device rig will be used, and the free inpainting is refused rather than sent."
        : "nothing-leaves-device mode off — the free pool is reachable again."
    );
  };
  $("nsfwRoutingSel").onchange = async () => {
    s.nsfwRouting = sel.value;
    await saveSettings({ nsfwRouting: s.nsfwRouting });
    renderRoutingNote();
    renderEgress();
  };
  $("refreshEgressBtn").onclick = () => {
    renderEgress();
    renderVaultNote();
  };

  $("vaultPassBtn").onclick = async () => {
    const input = $("vaultPassInput");
    const pass = input.value;
    const st = await vaultState();
    const out = $("vaultPassOut");
    if (!st.supported) return toast("This browser cannot encrypt — there is no WebCrypto here.", "warn");
    if (st.locked) {
      const r = await unlock(pass);
      input.value = "";
      if (!r.ok) return toast(r.error === "too_short" ? `At least ${MIN_PASSPHRASE} characters.` : "That passphrase did not open the vault.", "warn");
      out.textContent = "Unlocked for this session.";
      toast("Vault unlocked.", "ok");
    } else {
      const r = await setPassphrase(pass);
      input.value = "";
      if (!r.ok) return toast(r.error === "too_short" ? `At least ${MIN_PASSPHRASE} characters.` : "Could not set the passphrase.", "warn");
      out.textContent = "Passphrase set — it now wraps the key, and it cannot be recovered.";
      toast("Passphrase set. The library now opens with it and nothing else.", "ok", 8000);
    }
    await renderVaultNote();
  };
  $("vaultLockBtn").onclick = async () => {
    const r = await lockVault();
    toast(r.ok ? "Vault locked." : "There is no passphrase to lock with.", r.ok ? "ok" : "warn");
    await renderVaultNote();
  };
  $("vaultShowBtn").onclick = async () => {
    const r = await recoveryPhrase();
    $("vaultPhraseOut").textContent = r.ok ? r.phrase : "Unlock the vault first.";
    if (r.ok) toast("Write it down — it opens everything.", "warn", 8000);
  };
  $("vaultCopyBtn").onclick = async () => {
    const r = await recoveryPhrase();
    if (!r.ok) return toast("Unlock the vault first.", "warn");
    await copyText(r.phrase);
    toast("Phrase copied. Store it offline.", "ok", 8000);
  };
  $("vaultRestoreBtn").onclick = async () => {
    const r = await restoreRecovery($("vaultRestoreInput").value);
    $("vaultRestoreOut").textContent = r.ok
      ? "Restored — the vault opens with this key now."
      : "That did not open anything (" + (r.error || "?") + ").";
    if (r.ok) {
      $("vaultRestoreInput").value = "";
      await renderVaultNote();
      toast("Vault restored.", "ok");
    }
  };
  $("panicBtn").onclick = async () => {
    if (!confirm("Destroy the vault key and delete every saved clip? This cannot be undone.")) return;
    if (!confirm("Really destroy it? The passphrase will not bring it back.")) return;
    const r = await destroyVault();
    try {
      await wipeTraces();
    } catch {}
    logLine(`vault destroyed → key removed, ${r.items} clip${r.items === 1 ? "" : "s"} deleted`, "warn");
    toast("Vault and library destroyed.", "ok");
    setTimeout(() => location.reload(), 900);
  };
}

/* -------------------------------------------------------------------- init */

function bindControls() {
  $("dropzone").onclick = async (e) => {
    if (e.target.closest("button")) return;
    const { chooseImportSource, pickLibraryMedia } = await import("./lib-picker.js");
    const src = await chooseImportSource($("dropzone"));
    if (src === "library") {
      const items = await pickLibraryMedia({ accept: "both", title: "Starter from Library" });
      if (items && items[0]) acceptFile(new File([items[0].blob], items[0].name, { type: items[0].blob.type }));
    } else if (src === "computer") $("fileInput").click();
  };
  $("fileInput").onchange = (e) => {
    acceptFile(e.target.files?.[0]);
    e.target.value = "";
  };
  if ($("importVideoBtn") && !$("importVideoBtn").dataset.bound) {
    $("importVideoBtn").dataset.bound = "1";
    $("importVideoBtn").onclick = async (e) => {
      e.stopPropagation();
      const { chooseImportSource, pickLibraryMedia } = await import("./lib-picker.js");
      const src = await chooseImportSource($("importVideoBtn"));
      if (src === "library") {
        const items = await pickLibraryMedia({ accept: "both", title: "Video starter from Library" });
        if (items && items[0]) acceptFile(new File([items[0].blob], items[0].name, { type: items[0].blob.type }));
      } else if (src === "computer") $("fileInput").click();
    };
  }
  if ($("importVidBtn") && !$("importVidBtn").dataset.bound) {
    $("importVidBtn").dataset.bound = "1";
    $("importVidBtn").onclick = async () => {
      const { chooseImportSource, pickLibraryMedia } = await import("./lib-picker.js");
      const src = await chooseImportSource($("importVidBtn"));
      if (src === "library") {
        const items = await pickLibraryMedia({ accept: "both", title: "Video starter from Library" });
        if (items && items[0]) acceptFile(new File([items[0].blob], items[0].name, { type: items[0].blob.type }));
      } else if (src === "computer") $("fileInput").click();
    };
  }
  if ($("playImportBtn") && !$("playImportBtn").dataset.bound) {
    $("playImportBtn").dataset.bound = "1";
    $("playImportBtn").onclick = (e) => { e.stopPropagation(); playImportedVideo(); };
  }
  if ($("saveImportBtn") && !$("saveImportBtn").dataset.bound) {
    $("saveImportBtn").dataset.bound = "1";
    $("saveImportBtn").onclick = (e) => { e.stopPropagation(); saveImportedVideo(); };
  }
  $("clearImgBtn").onclick = (e) => {
    e.stopPropagation();
    clearRefImage();
  };
  if ($("frameRange") && !$("frameRange").dataset.bound) {
    $("frameRange").dataset.bound = "1";
    $("frameRange").oninput = (e) => seekFrameVideo(Number(e.target.value) / 1000);
    const fv = $("frameVideo");
    if (fv && !fv.dataset.bound) {
      fv.dataset.bound = "1";
      fv.addEventListener("seeked", syncFrameTime);
      fv.addEventListener("loadedmetadata", syncFrameTime);
    }
    $("frameUseBtn").onclick = (e) => {
      e.stopPropagation();
      useCurrentFrame();
    };
  }
  for (const b of document.querySelectorAll("#refModeRow button")) {
    b.onclick = () => {
      setRefMode(b.dataset.mode);
      scheduleSave();
      const n = refExtrasList().length;
      logLine(b.dataset.mode === "multi" ? `reference mode → multiple${n ? ` (${n} attached)` : ""}` : "reference mode → single (starter only)");
    };
  }
  renderRefBoard();
  const clearAll = $("refClearAllBtn");
  if (clearAll) clearAll.onclick = () => clearRefExtras();
  const cropSel = $("cropRatioSel");
  if (cropSel && !cropSel.options.length) {
    for (const c of CROP_RATIOS) {
      const o = document.createElement("option");
      o.value = c.id;
      o.textContent = c.label;
      cropSel.appendChild(o);
    }
  }
  if (cropSel) {
    cropSel.onclick = (e) => e.stopPropagation();
    cropSel.onchange = () => {
      if ($("cropDlg")?.open) {
        fitCropBox();
        paintCrop();
      }
    };
  }
  $("cropBtn").onclick = (e) => {
    e.stopPropagation();
    cropTarget = "ref";
    openCrop();
  };
  $("cropApplyBtn").onclick = applyCrop;
  $("cropCancelBtn").onclick = closeCrop;
  bindCropBox();
  window.addEventListener("resize", () => {
    if ($("cropDlg")?.open) paintCrop();
  });
  $("keyframeBtn").onclick = async (e) => {
    e.stopPropagation();
    const p = $("promptInput").value.trim();
    if (!p) {
      toast("Type a prompt first.", "warn");
      return;
    }
    toast("Drawing a starting frame…");
    try {
      const [w, h] = dimsFor(state.aspect, state.quality, null);
      const style = STYLES.find((s) => s.id === $("styleSel").value);
      const blob = await pollinationsKeyframe(
        `${p}${style && style.id !== "none" ? ", " + style.phrase : ""}`,
        [w, h],
        Math.floor(Math.random() * 1e9),
        $("nsfwToggle").checked,
        state.settings
      );
      setRefImage(blob, "generated-keyframe.jpg");
    } catch (err) {
      toast("Couldn't draw a frame: " + err.message, "err");
    }
  };
  $("repaintBtn").onclick = (e) => {
    e.stopPropagation();
    openRepaint();
  };
  const dz = $("dropzone");
  dz.addEventListener("dragover", (e) => {
    e.preventDefault();
    dz.classList.add("drag");
  });
  dz.addEventListener("dragleave", () => dz.classList.remove("drag"));
  dz.addEventListener("drop", (e) => {
    e.preventDefault();
    dz.classList.remove("drag");
    acceptFile(e.dataTransfer?.files?.[0]);
  });
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", (e) => {
    if (e.target.closest?.("#repaintDlg")) return;
    e.preventDefault();
    if (e.dataTransfer?.files?.[0]) acceptFile(e.dataTransfer.files[0]);
  });
  window.addEventListener("paste", (e) => {
    const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith("image/"));
    if (item) acceptFile(item.getAsFile());
  });

  $("promptInput").oninput = () => {
    $("promptCount").textContent = `${$("promptInput").value.length} chars`;
  };
  $("enhanceBtn").onclick = runEnhance;
  $("camPickBtn").onclick = () => aiPickCamera();
  $("negAiBtn").onclick = () => aiPickNegative();
  $("camWordsToggle").onchange = syncCameraWords;

  $("moveSel").onchange = () => {
    scheduleSave();
    syncCameraWords();
    const m = CAMERA_MOVES.find((x) => x.id === $("moveSel").value);
    if (m?.phrase) logLine(`camera → ${m.phrase}`);
  };
  $("angleSel").onchange = () => {
    scheduleSave();
    syncCameraWords();
  };
  if ($("trackSel")) $("trackSel").onchange = () => {
    scheduleSave();
    syncTrackNote();
    const t = (TRACKING_MODES || []).find((x) => x.id === $("trackSel").value);
    if (t?.phrase) logLine(`tracking → ${t.phrase}`);
  };
  if ($("trackStrengthRange")) $("trackStrengthRange").oninput = syncTrackNote;
  if ($("trackStrengthRange")) $("trackStrengthRange").onchange = scheduleSave;
  // ---- The two generators: each row is an on/off switch plus an Auto /
  // Pick-a-model control, and the pair decides the whole provider pool. ----
  const genChanged = () => {
    syncGenerators();
    renderMuapiNote();
    scheduleSave();
  };
  $("stdGenToggle").onchange = () => {
    genChanged();
    const label = $("stdGenToggle").checked ? "Standard generator on" : "Standard generator off";
    logLine(`generator → ${label}`);
    if (!$("stdGenToggle").checked && !$("nsfwToggle").checked) {
      toast("Both generators are off — turn one back on before generating.", "warn", 8000);
    }
  };
  for (const [rowId, selId, which] of [
    ["stdModeRow", "stdModelSel", "Standard"],
    ["nsfwModeRow", "nsfwModelSel", "NSFW"],
  ]) {
    for (const b of $(rowId).querySelectorAll("button")) {
      b.onclick = () => {
        setGenMode(rowId, b.dataset.mode);
        genChanged();
        const p = b.dataset.mode === "selected" ? findAny($(selId).value) : null;
        logLine(`generator → ${which}: ${p ? `${p.label} (pinned)` : "auto"}`);
      };
    }
    $(selId).onchange = () => {
      const p = findAny($(selId).value);
      logLine(`generator → ${which}: ${p ? `${p.label} (pinned)` : "auto"}`);
      genChanged();
    };
  }
  $("styleSel").onchange = scheduleSave;
  $("seedInput").onchange = scheduleSave;
  $("stepsInput").onchange = scheduleSave;
  $("paidToggle").onchange = scheduleSave;
  $("lockSeedToggle").onchange = async () => {
    state.settings.lockSeed = $("lockSeedToggle").checked;
    await saveSettings({ lockSeed: state.settings.lockSeed });
    if (state.settings.lockSeed && !$("seedInput").value.trim()) {
      toast("Seed locked — the next render's seed will be reused from then on.", "", 6000);
    }
  };
  $("fpsSel").onchange = () => {
    syncFps();
    scheduleSave();
  };
  $("nsfwToggle").onchange = () => {
    syncGenerators();
    renderMuapiNote();
    scheduleSave();
    if ($("nsfwToggle").checked) {
      toast(
        "NSFW generator on: uncensored models, uncensored prompting, safety negatives removed, and the first frame is made explicit before any video model sees it.",
        "",
        9000
      );
    }
  };
  $("nsfwFrameSel").onchange = () => {
    syncNSFW();
    scheduleSave();
  };
  $("undressToggle").onchange = () => {
    syncNSFW();
    scheduleSave();
    if ($("nsfwToggle").checked && $("undressToggle").checked) {
      toast(
        "Undress: the clip is built from drawn keyframes — she starts dressed, and each beat of the sequence is a real picture the video model animates up to. Slow at first (the frames are real repaints), and it needs a real video model or your own GPU server.",
        "",
        11000
      );
    }
  };
  $("xfadeRange").oninput = () => {
    $("xfadeVal").textContent = `${Number($("xfadeRange").value).toFixed(2)}s`;
    scheduleSave();
  };
  $("motionRange").oninput = () => {
    $("motionVal").textContent = Number($("motionRange").value).toFixed(1);
  };
  $("durRange").oninput = () => {
    syncDuration();
    scheduleSave();
  };
  $("durUnitSel").onchange = () => {
    state.durUnit = $("durUnitSel").value || "s";
    syncDuration();
    scheduleSave();
  };

  // Explicitly call `run()` with no options: the handler would otherwise receive
  // the click event as its options object.
  $("generateBtn").onclick = () => run();
  $("cancelBtn").onclick = () => {
    state.controller?.abort();
    logLine("cancel requested", "warn");
  };
  $("downloadBtn").onclick = download;
  fillSaveCatSel($("vidLibCatSel"), "video");
  if ($("saveVidBtn") && !$("saveVidBtn").dataset.bound) {
    $("saveVidBtn").dataset.bound = "1";
    $("saveVidBtn").onclick = async (e) => {
      e.stopPropagation();
      if (state.result?.imported) { saveImportedVideo(); return; }
      if (!state.result?.blob) { toast("Nothing to save yet.", "warn"); return; }
      const btn = $("saveVidBtn");
      const prev = btn.textContent;
      btn.disabled = true;
      btn.textContent = "Saving…";
      try {
        const r = state.result;
        const meta = readSaveMeta("vid", "video");
        const out = await saveBlobToLibrary({ kind: "final", tab: meta.tab, blob: r.blob, filename: meta.filename || r.filename || "clip", prompt: r.prompt || "", extra: { provider: "video-studio", providerLabel: r.providerLabel || "Video", aspect: r.aspect || "", duration: r.duration || 0, name: meta.name, userCat: meta.userCat, character: meta.character, scene: meta.scene } });
        toast(out?.locked ? "The vault is locked — enter your passphrase in Settings → Content safety." : out?.ok ? `Saved to the Library (${meta.label}).` : "Couldn't save.", out?.ok ? "" : "warn");
      } finally {
        btn.disabled = false;
        btn.textContent = prev;
      }
    };
  }
  buildViewSeg($("stripViewRow"), state.stripView, (v) => {
    state.stripView = v;
    applyGalleryView($("filmstrip"), v);
  });
  applyGalleryView($("filmstrip"), state.stripView);
  if (!LOG_MODES.some((v) => v.id === state.logMode)) state.logMode = "simple";
  // The owner debugs on Full; visitors only ever see the Simple studio talk.
  buildViewSeg($("logModeRow"), state.logMode, (v) => {
    state.logMode = v;
  }, LOG_MODES);
  const vidFmtSel = $("vidFormatSel");
  if (vidFmtSel && !vidFmtSel.dataset.bound) {
    vidFmtSel.dataset.bound = "1";
    vidFmtSel.innerHTML = "";
    for (const f of VIDEO_FORMATS) {
      const o = document.createElement("option");
      o.value = f.id;
      o.textContent = f.label;
      vidFmtSel.appendChild(o);
    }
    vidFmtSel.value = state.vidFormat;
    vidFmtSel.onchange = () => {
      state.vidFormat = vidFmtSel.value;
    };
  }
  if ($("vidScaleSel") && !$("vidScaleSel").dataset.bound) {
    $("vidScaleSel").dataset.bound = "1";
    $("vidScaleSel").value = state.vidScale || "1";
    $("vidScaleSel").onchange = () => { state.vidScale = $("vidScaleSel").value; scheduleSave(); };
  }
  if ($("vidUpscaleModeSel") && !$("vidUpscaleModeSel").dataset.bound) {
    $("vidUpscaleModeSel").dataset.bound = "1";
    $("vidUpscaleModeSel").value = state.vidUpscaleMode || "fast";
    $("vidUpscaleModeSel").onchange = () => { state.vidUpscaleMode = $("vidUpscaleModeSel").value; scheduleSave(); };
  }
  if ($("vidQualityRange") && !$("vidQualityRange").dataset.bound) {
    $("vidQualityRange").dataset.bound = "1";
    $("vidQualityRange").value = String(state.vidQuality);
    $("vidQualityRange").oninput = () => {
      state.vidQuality = Number($("vidQualityRange").value);
      if ($("vidQualityVal")) $("vidQualityVal").textContent = state.vidQuality.toFixed(2);
    };
  }
  bindGradeUI("vg", "vid", [
    { suf: "Intensity", key: "intensity", dec: 2 },
    { suf: "Sat", key: "sat", dec: 2 },
    { suf: "Light", key: "bright", dec: 2 },
    { suf: "Exposure", key: "exposure", dec: 2 },
    { suf: "Contrast", key: "contrast", dec: 2 },
    { suf: "Gamma", key: "gamma", dec: 2 },
    { suf: "Grain", key: "grain", dec: 2 },
    { suf: "Leak", key: "leak", dec: 2 },
    { suf: "Sharp", key: "sharpen", dec: 2 },
    { suf: "TintAlpha", key: "tintAlpha", dec: 2 },
  ], paintVidGrade);
  initStickerBars();
  $("againBtn").onclick = reroll;
  $("reuseBtn").onclick = continueFromLastFrame;
  $("resumeBtn").onclick = () => {
    if (state.busy || !state.partial) return;
    run({ resume: true });
  };
  $("shareBtn").onclick = share;
  $("historyBtn").onclick = openLibrary;
  $("settingsBtn").onclick = () => {
    $("settingsDlg").showModal();
    // The audit is drawn from the live form, so it is refreshed whenever the
    // settings are opened rather than only when a control changes.
    renderVaultNote();
    renderEgress();
  };
  $("themeBtn").onclick = toggleThemeMenu;
  $("resetBtn").onclick = () => openResetDlg();
  $("resetDlgCancelBtn").onclick = () => $("resetDlg").close();
  $("resetDlgCloseBtn").onclick = () => $("resetDlg").close();
  $("resetDlgGoBtn").onclick = async () => {
    $("resetDlg").close();
    await doFullReset({
      params: $("resetParamsChk").checked,
      traces: $("resetTracesChk").checked,
      history: $("resetLibraryChk").checked,
      rotate: $("resetRotateChk").checked,
    });
  };

  $("bannerResetBtn").onclick = async () => {
    hideQuotaBanner();
    await doFullReset({ params: false, traces: true, history: false, rotate: true });
  };
  // The one cure that no amount of resetting produces, offered as a button.
  //
  // The free pool meters its daily allowance per *identity*: against the
  // account a token belongs to (5 minutes a day), or against the address the
  // request leaves from (2 minutes a day) when no token rides along. Two
  // consequences the banner's prose was describing but nothing could perform:
  // a spent account refuses every free Space at once from every address, and —
  // while strict privacy is on — anonymous calls leave from *the relay's*
  // shared address, which is routinely spent by everyone else. Asking from
  // your own address with no token is therefore a genuinely separate pot, and
  // for most people it is the one with something left in it. It is also a real
  // trade: the Space then sees your address instead of the relay's, which is
  // the whole reason the switch is off by default. Hence a button, not a
  // silent fallback.
  $("bannerOwnAddressBtn").onclick = async () => {
    const hadToken = !!(state.settings.hfToken || "").trim();
    const inp = $("hfTokenInput");
    if (inp) inp.value = "";
    setSwitch("strictPrivacyToggle", false);
    state.settings.hfToken = "";
    state.settings.strictPrivacy = false;
    await saveSettings({ hfToken: "", strictPrivacy: false });
    clearZeroGpuBlock();
    syncPrivacyNotes();
    renderRelayModeNote();
    hideQuotaBanner();
    logLine(
      "switch · \"use my own address\": " +
        (hadToken ? "Hugging Face token cleared and " : "") +
        "strict privacy turned off, so the next run is metered to this address's own free share instead of " +
        (hadToken ? "a spent account's" : "the relay address's") +
        ". The model now sees your address rather than the relay's — that is the trade.",
      "warn"
    );
    toast("Requests will now leave from your own address.");
  };
  $("bannerTokenBtn").onclick = () => {
    $("settingsDlg").showModal();
    setTimeout(() => $("hfTokenInput").focus(), 60);
  };
  $("bannerCloseBtn").onclick = hideQuotaBanner;

  $("hfHelpBtn").onclick = () => window.open("https://huggingface.co/settings/tokens/new?tokenType=read", "_blank", "noopener");
  $("hordeHelpBtn").onclick = () => window.open("https://aihorde.net/register", "_blank", "noopener");
  $("hfTokenInput").addEventListener("input", () => {
    if ($("hfTokenInput").value.trim()) hideQuotaBanner();
  });

  $("clearHistoryBtn").onclick = async () => {
    await clearHistory();
    toast("Library cleared.");
  };
  $("clearAllBtn").onclick = async () => {
    if (!confirm("Delete all saved settings and clips from this browser?")) return;
    await clearHistory();
    for (const f of ["avg_settings", "avg_cooldowns", "avg_shared", "avg_vault", "avg_route"]) {
      try {
        const keys = await root.kv[f].keys();
        await root.kv[f].deleteMany(keys);
      } catch {}
    }
    toast("Local data wiped.");
    setTimeout(() => location.reload(), 700);
  };

  $("addSpaceBtn").onclick = addCustomSpace;
  $("customSpaceInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addCustomSpace();
    }
  });

  $("outVideo").addEventListener("error", () => {
    const still = $("filmstrip").querySelector("img")?.src || null;
    playerFallback(still);
    toast("This browser can't play that clip's format — showing a still instead.", "warn", 7000);
  });

  window.addEventListener("keydown", (e) => {
    const tag = (e.target?.tagName || "").toLowerCase();
    if (["input", "textarea", "select"].includes(tag)) return;
    const meta = e.ctrlKey || e.metaKey;
    if (meta && e.key === "Enter") {
      e.preventDefault();
      run();
    }
    if (e.key === "Escape" && state.busy) state.controller?.abort();
  });
}

async function addCustomSpace() {
  const raw = $("customSpaceInput").value.trim();
  if (!raw) return;
  const base = spaceToHost(raw);
  if (state.settings.customSpaces.some((c) => spaceToHost(c.space) === base)) {
    toast("Already added.");
    return;
  }
  toast("Probing the space for video endpoints…");
  try {
    const provider = await autoAdapter(base, state.settings.hfToken);
    state.customProviders.push(provider);
    await saveSettings({
      customSpaces: [...state.settings.customSpaces, { space: base, label: provider.label, nsfw: false }],
    });
    rebuildGenSelects();
    renderCustomSpaces();
    $("customSpaceInput").value = "";
    toast(`Added ${provider.label} — endpoint ${provider.detected.endpoint}, up to ${provider.maxSec}s.`);
    logLine(`custom space ready: ${base} (${provider.detected.endpoint})`, "ok");
  } catch (e) {
    toast(`Could not use that space: ${e.message}`, "err", 7000);
  }
}

function renderCustomSpaces() {
  const host = $("customSpaceList");
  host.innerHTML = "";
  state.settings.customSpaces.forEach((c, i) => {
    const row = document.createElement("div");
    row.className = "space-item";
    const label = document.createElement("span");
    label.className = "mono";
    label.textContent = c.label || c.space;
    const right = document.createElement("div");
    right.style.display = "flex";
    right.style.gap = "7px";
    right.style.alignItems = "center";
    const nsfw = document.createElement("button");
    nsfw.className = "chip-btn" + (c.nsfw ? " on" : "");
    nsfw.textContent = "NSFW-capable";
    nsfw.onclick = async () => {
      c.nsfw = !c.nsfw;
      const p = state.customProviders.find((x) => spaceToHost(x.space) === spaceToHost(c.space));
      if (p) p.caps.nsfw = c.nsfw;
      await saveSettings({ customSpaces: state.settings.customSpaces });
      renderCustomSpaces();
    };
    const del = document.createElement("button");
    del.className = "btn btn-tiny";
    del.textContent = "Remove";
    del.onclick = async () => {
      state.settings.customSpaces.splice(i, 1);
      state.customProviders = state.customProviders.filter((x) => spaceToHost(x.space) !== spaceToHost(c.space));
      await saveSettings({ customSpaces: state.settings.customSpaces });
      rebuildGenSelects();
      renderCustomSpaces();
    };
    right.append(nsfw, del);
    row.append(label, right);
    host.appendChild(row);
  });
}

async function init() {
  state.settings = await loadSettings();
  const s = state.settings;

  let startTheme = s.theme || "minimal-dark";
  if (THEME_MIGRATE[startTheme]) { startTheme = THEME_MIGRATE[startTheme]; saveSettings({ theme: startTheme }); }
  applyTheme(startTheme);
  state.aspect = s.aspect || "16:9";
  state.quality = s.quality || "480p";
  state.imgFormat = s.imgFormat || "jpeg";
  state.imgScale = s.imgScale || "1";
  state.imgUpscaleMode = s.imgUpscaleMode || "fast";
  state.vidFormat = s.vidFormat || "match";
  state.vidScale = s.vidScale || "1";
  state.vidUpscaleMode = s.vidUpscaleMode || "fast";
  state.durUnit = s.durUnit || "s";
  state.duration = (Number($("durRange").value) || 5) * ((DUR_UNITS[state.durUnit] || DUR_UNITS.s).toSec);

  populate();
  initPlayer();
  bindControls();
  bindStudios();
  bindImageStudio();
  for (const [fold, box, tab] of [["imgCivitaiFold", "civitaiImgBox", "image"], ["vidCivitaiFold", "civitaiVidBox", "video"]]) {
    $(fold)?.addEventListener("toggle", async () => {
      if (!$(fold).open || $(box)?.dataset.civBound) return;
      try { (await import("./civitai.js")).mountCivitaiBrowser($(box), tab); } catch (e) { console.warn("civitai mount failed", e); }
    }, { once: false });
  }
  bindVoiceStudio();
  bindTokenFields();
  bindComputeFields();
  bindPrivacyFields();
  bindMuapiFields();
  bindRepaint();

  $("promptInput").value = "";
  $("negInput").value = "";
  $("moveSel").value = "static";
  $("angleSel").value = "off";
  if ($("trackSel")) { $("trackSel").value = "off"; syncTrackNote(); }
  $("styleSel").value = s.style || "cinematic";
  $("seedInput").value = s.seed || "";
  $("stepsInput").value = s.steps || "";
  $("xfadeRange").value = s.crossfade ?? 0.35;
  $("xfadeVal").textContent = `${Number($("xfadeRange").value).toFixed(2)}s`;
  $("fpsSel").value = String(s.fps || 0);
  $("paidToggle").checked = !!s.allowPaidOnAuto;
  $("lockSeedToggle").checked = !!s.lockSeed;
  $("nsfwToggle").checked = s.genNsfw?.on ?? !!s.nsfw;
  $("stdGenToggle").checked = s.genStandard?.on !== false;
  setGenMode("stdModeRow", s.genStandard?.mode || "auto");
  setGenMode("nsfwModeRow", s.genNsfw?.mode || "auto");
  if (s.genStandard?.pick) $("stdModelSel").value = s.genStandard.pick;
  if (s.genNsfw?.pick) $("nsfwModelSel").value = s.genNsfw.pick;
  $("nsfwFrameSel").value = s.nsfwFrame || "auto";
  $("undressToggle").checked = !!s.undress;

  if (!PROVIDERS.length) logLine("warning: no free providers are configured", "warn");

  state.cooldowns = await getCooldowns();
  renderCustomSpaces();
  renderRelays();
  syncPrivacyNotes();
  renderRelayModeNote();
  renderMuapiNote();
  renderHordeNote();
  renderServerStatus();
  syncGenerators();
  syncCameraWords();
  syncTrackNote();
  bindSafetyFields();

  // A clip saved before the vault existed is still a plain file in IndexedDB.
  // Seal those in place, once, so "the library is encrypted" is true of the
  // whole library rather than only of what came after the switch was added.
  sealLegacyHistory().then((r) => {
    if (r?.sealed) logLine(`vault → encrypted ${r.sealed} clip${r.sealed === 1 ? "" : "s"} saved before the vault existed`, "ok");
  });

  for (const c of s.customSpaces || []) {
    try {
      const p = await autoAdapter(c.space, s.hfToken);
      p.caps.nsfw = !!c.nsfw;
      state.customProviders.push(p);
    } catch (e) {
      logLine(`custom space unavailable: ${c.space} (${e.message})`, "warn");
    }
  }
  if (state.customProviders.length) rebuildGenSelects();

  if (s.serverUrl && (s.computeMode === "auto" || s.computeMode === "server")) {
    refreshServer({ silent: true });
  }

  const hash = new URLSearchParams(location.hash.replace(/^#/, ""));
  if (hash.get("v")) loadShared(hash.get("v"));

  logLine(`ready · ${rotatableCount(s)} address${rotatableCount(s) === 1 ? "" : "es"} · compute: ${s.computeMode} · privacy: ${s.strictPrivacy ? "relayed" : "direct"}`, "ok");
  setChip("", "idle");
  document.querySelectorAll("dialog").forEach((d) => {
    d.addEventListener("click", (e) => {
      if (e.target === d) d.close();
    });
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

window.AIVideoGen = {
  state,
  run,
  handleResult,
  saveTake,
  makeRunName,
  planSegments,
  pollinationsKeyframe,
  enhance: runEnhance,
  enhanceImage: runImgEnhance,
  imgNegative: aiPickImgNegative,
  applyTheme,
  // The two generators, for console debugging: what the two rows currently say,
  // and the provider pool they resolve to.
  genCfg,
  autoPool: () => autoPool(genCfg()),
  // The content-safety engines, for console debugging: the vault's state, the
  // audit of where this run's content would go, the local content classifier,
  // and the router's memory of which routes accepted or refused.
  vaultState,
  auditEgress,
  classifyRequest,
  tierLabel,
  moderationOf,
  routeStats: routeStatsSync,
  resetRoutes: resetRouteStats,
};
