import { addHistory } from "./store.js";
import { extractFrame } from "./video.js";
const uid = () => "lib" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
export const LIB_CATS = [
  ["all", "All"],
  ["video", "Video"],
  ["image", "Images"],
  ["training-files", "Training Files"],
  ["training-outcomes", "Training Outcomes"],
  ["storyboard", "Storyboard"],
  ["editor", "Editor"],
  ["voice", "Voice"],
  ["reader", "Reader"],
  ["import", "Imports"],
  ["takes", "Takes"],
];
export const SAVABLE_CATS = ["video", "image", "training-files", "training-outcomes", "storyboard", "editor", "voice", "reader", "import"];
export function slugName(s, fb = "untitled") {
  const t = String(s || "").trim().slice(0, 60).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return t || fb;
}
export function libFileName(name, fallback, ext) {
  const base = slugName(name, slugName(fallback, "library")).slice(0, 50);
  return base + "-" + Date.now().toString(36) + "." + (ext || "bin");
}
export function libCategory(it = {}) {
  const uc = String(it.userCat || it.cat || "");
  if (uc && LIB_CATS.some(([id]) => id === uc) && uc !== "all" && uc !== "takes") return uc;
  const kind = it.kind || "";
  const tab = it.tab || "";
  const prov = String(it.provider || it.providerLabel || "");
  if (kind === "take" || kind === "image-take") return "takes";
  if (tab === "storyboard" || /^storyboard/i.test(prov)) return "storyboard";
  if (tab === "editor" || /^editor/i.test(prov)) return "editor";
  if (kind === "voice" || tab === "voice") return "voice";
  if (kind === "reader" || tab === "reader") return "reader";
  if (kind === "import" || tab === "import") return "import";
  if (kind === "image" || String(it.mime || "").startsWith("image/")) return "image";
  return "video";
}
export function extFor(blob, fb = "bin") {
  const m = String(blob?.type || "");
  const nm = String(fb || "");
  const dot0 = nm.toLowerCase().match(/\.([a-z0-9]+)$/);
  if (dot0 && (dot0[1] === "soma" || dot0[1] === "ankan")) return dot0[1];
  const map = [["jpeg", "jpg"], ["png", "png"], ["webp", "webp"], ["gif", "gif"], ["mp4", "mp4"], ["webm", "webm"], ["mpeg", "mp3"], ["wav", "wav"], ["ogg", "ogg"], ["plain", "txt"], ["json", "json"]];
  for (const [k, e] of map) if (m.includes(k)) return e;
  const dot = nm.toLowerCase().match(/\.([a-z0-9]+)$/);
  if (dot) return dot[1];
  return "bin";
}
export async function saveBlobToLibrary({ kind = "final", tab = "", blob, filename, prompt = "", extra = {} } = {}) {
  if (!blob || !blob.size) return { ok: false };
  const ext = extFor(blob, filename);
  let poster = extra.poster || null;
  if (!poster) {
    try { poster = await makePoster(blob); } catch { poster = null; }
  }
  const name = String(extra.name || "").trim().slice(0, 80);
  const userCat = SAVABLE_CATS.includes(extra.userCat) ? extra.userCat : "";
  const fname = filename || libFileName(name || extra.story, "library", ext);
  const runBase = name || extra.story || fname.replace(/\.[a-z0-9]+$/i, "");
  const rec = { id: uid(), ts: Date.now(), kind, tab: userCat === "storyboard" ? "storyboard" : tab, sandbox: kind.endsWith("take"), runName: runBase, filename: name ? slugName(name).slice(0, 50) + "-" + Date.now().toString(36) + "." + ext : fname, name, userCat, prompt, userPrompt: prompt, provider: extra.provider || "", providerLabel: extra.providerLabel || "", story: extra.story || "", cat: extra.cat || "", character: String(extra.character || "").slice(0, 80), scene: String(extra.scene || "").slice(0, 80), seed: extra.seed ?? null, duration: extra.duration || 0, actualDuration: extra.actualDuration || 0, aspect: extra.aspect || "", quality: extra.quality || "", ext, mime: blob.type || "", size: blob.size, width: extra.width || 0, height: extra.height || 0, poster, video: blob };
  try {
    const r = await addHistory(rec);
    return { ok: !!r?.ok, locked: !!r?.locked };
  } catch { return { ok: false }; }
}
export function blobToDataURL(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(blob);
  });
}

export async function makePoster(blob, maxSide = 384) {
  const type = String(blob?.type || "");
  try {
    const head = blob?.slice ? await blob.slice(0, 64).text().catch(() => "") : "";
    if (/"magic"\s*:\s*"(ANKAN|SOMA)"/.test(head)) {
      const play = await import("./codec-play.js");
      const { keys } = await play.decodeKeys(blob);
      if (keys[0]) {
        const img = keys[0].canvas;
        const s = Math.min(1, maxSide / Math.max(img.width, img.height));
        const c = document.createElement("canvas");
        c.width = Math.max(1, Math.round(img.width * s));
        c.height = Math.max(1, Math.round(img.height * s));
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        const out = c.toDataURL("image/jpeg", 0.72);
        if (out && out.startsWith("data:")) return out;
      }
    }
  } catch {}
  if (type.startsWith("image/")) {
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
      const out = c.toDataURL("image/jpeg", 0.72);
      return out && out.startsWith("data:") ? out : null;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  if (type.startsWith("video/")) {
    const frame = await extractFrame(blob, "first");
    if (!frame || !frame.size) return null;
    const url = await blobToDataURL(frame);
    return url && url.startsWith("data:") ? url : null;
  }
  return null;
}

export function setVideoRefReuse(blob, name) {
  try {
    const url = URL.createObjectURL(blob);
    const prev = document.querySelector("#refPreview");
    if (prev) prev.src = url;
    const nm = document.querySelector("#refName");
    if (nm) nm.textContent = (name || "image") + " loaded";
    if (window.AIVideoGen) window.AIVideoGen.state.refImage = blob;
  } catch (e) {}
}
export function setImgEditReuse(blob, name) {
  try {
    const url = URL.createObjectURL(blob);
    const prev = document.querySelector("#imgRefPreview");
    if (prev) prev.src = url;
    if (window.AIVideoGen) window.AIVideoGen.state.imgEditImage = blob;
  } catch (e) {}
}
export async function saveTextToLibrary(o) {
  const tab = (o && o.tab) || "reader";
  const clean = String((o && o.text) || "").trim();
  if (!clean) return { ok: false };
  return saveBlobToLibrary({ kind: tab === "voice" ? "voice" : "reader", tab, blob: new Blob([clean], { type: "text/plain" }), filename: (o && o.filename) || (tab + "-narration-" + new Date().toISOString().slice(0, 10) + ".txt"), prompt: (o && o.prompt) || clean.slice(0, 120), extra: { provider: tab + "-studio", providerLabel: tab === "voice" ? "Voiceover Studio" : "Text Reader" } });
}
