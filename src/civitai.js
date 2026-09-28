export const CIV_TYPES = [["Checkpoint", "Checkpoint"], ["LORA", "LoRA"], ["TextualInversion", "Embedding"], ["Controlnet", "ControlNet"], ["Upscaler", "Upscaler"], ["MotionModule", "Motion"], ["VAE", "VAE"]];
export const CIV_BASES = ["SD 1.5", "SDXL 1.0", "Pony", "Flux.1 D", "Illustrious", "SD 3.5", "CogVideoX"];
export const CIV_SORTS = [["Highest Rated", "Highest Rated"], ["Most Downloaded", "Most Downloaded"], ["Newest", "Newest"]];
export const CIV_IMG_SORTS = [["Most Reactions", "Most Reactions"], ["Most Comments", "Most Comments"], ["Newest", "Newest"]];

const $ = (id) => document.getElementById(id);

const cache = new Map();
async function civGet(path) {
  if (cache.has(path)) return cache.get(path);
  const sf = (typeof root !== "undefined" && root.superFetch) || (typeof window !== "undefined" && window.superFetch) || fetch;
  const r = await sf("https://civitai.com/api/v1" + path).then((x) => x.json());
  if (cache.size > 60) cache.clear();
  cache.set(path, r);
  return r;
}
export async function searchModels({ q = "", type = "", base = "", sort = "Highest Rated", nsfw = false } = {}) {
  const p = new URLSearchParams({ limit: "12", sort, nsfw: nsfw ? "true" : "false" });
  if (q) p.set("query", q);
  if (type) p.set("types", type);
  if (base) p.set("baseModel", base);
  return civGet("/models?" + p.toString());
}
export async function modelDetails(id) {
  return civGet("/models/" + id);
}
export async function searchImages({ q = "", sort = "Most Reactions", nsfw = false } = {}) {
  const p = new URLSearchParams({ limit: "24", sort, nsfw: nsfw ? "true" : "false" });
  if (q) p.set("query", q);
  return civGet("/images?" + p.toString());
}
export async function fetchStill(url) {
  try {
    const r = await fetch(url);
    if (r.ok) return await r.blob();
  } catch {}
  const sf = (typeof root !== "undefined" && root.superFetch) || (typeof window !== "undefined" && window.superFetch) || fetch;
  const r2 = await sf(url);
  return await r2.blob();
}
function nsfwOn(tab) {
  try {
    if (tab === "image") return $("imgNsfwToggle")?.checked;
    if (tab === "video") return $("nsfwToggle")?.checked;
  } catch {}
  return false;
}
function fillPrompt(tab, prompt, neg) {
  const set = (id, v) => { const el = $(id); if (el && v) { el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); } };
  if (tab === "image") { set("imgPromptInput", prompt); set("imgNegInput", neg); }
  else if (tab === "video") { set("promptInput", prompt); set("negInput", neg); }
  else { set("sbPromptInput", prompt); }
}
async function sendStill(tab, item, btn) {
  const old = btn.textContent; btn.textContent = "…"; btn.disabled = true;
  try {
    const blob = await fetchStill(item.url);
    const nm = "civitai-" + (item.id || Date.now());
    const lib = await import("./library-save.js").catch(() => ({}));
    if (tab === "image") { lib.setImgEditReuse?.(blob, nm); }
    else if (tab === "video") { lib.setVideoRefReuse?.(blob, nm); }
    else { await window.SBStudio?.addExternalFrames?.([{ blob, prompt: (item.meta?.prompt || "civitai still").slice(0, 300) }]); }
    btn.textContent = "Sent ✓";
  } catch { btn.textContent = "Failed"; }
  setTimeout(() => { btn.textContent = old; btn.disabled = false; }, 1800);
}
function imgCard(item, tab) {
  const m = item.meta || {};
  const d = document.createElement("div");
  d.className = "civ-card";
  const im = document.createElement("img");
  im.loading = "lazy"; im.referrerPolicy = "no-referrer"; im.src = item.url; im.alt = "";
  im.onclick = () => window.open("https://civitai.com/images/" + item.id, "_blank", "noopener");
  d.appendChild(im);
  const info = document.createElement("div");
  info.className = "civ-meta";
  const model = (item.model || m.Model || "").toString().slice(0, 34);
  const recipe = m.prompt || (model ? model + " style" : "");
  info.innerHTML = "";
  const t = document.createElement("div");
  t.className = "civ-t";
  t.textContent = (m.prompt || model || "no prompt shared — click image to view").slice(0, 90);
  info.appendChild(t);
  if (model) { const s = document.createElement("div"); s.className = "civ-s mono tiny"; s.textContent = "◈ " + model; info.appendChild(s); }
  const row = document.createElement("div");
  row.className = "civ-row";
  const b1 = document.createElement("button");
  b1.type = "button"; b1.className = "btn btn-tiny"; b1.textContent = recipe ? "Use prompt" : "Use look";
  b1.title = recipe ? "Copy prompt + negative into this tab" : "No prompt shared — use the look as a style starter";
  b1.onclick = () => { fillPrompt(tab, recipe, m.negativePrompt || ""); b1.textContent = recipe ? "Copied ✓" : "No prompt"; setTimeout(() => b1.textContent = recipe ? "Use prompt" : "Use look", 1500); };
  row.appendChild(b1);
  const b2 = document.createElement("button");
  b2.type = "button"; b2.className = "btn btn-tiny";
  b2.textContent = tab === "storyboard" ? "+ Frame" : tab === "video" ? "→ Video ref" : "→ Edit ref";
  b2.title = "Download still into this tab";
  b2.onclick = () => sendStill(tab, item, b2);
  row.appendChild(b2);
  if (tab !== "storyboard") {
    const b3 = document.createElement("button");
    b3.type = "button"; b3.className = "btn btn-tiny"; b3.textContent = "→ Board";
    b3.title = "Add as storyboard frame";
    b3.onclick = () => sendStill("storyboard", item, b3);
    row.appendChild(b3);
  }
  info.appendChild(row);
  if (m.sampler || m.cfgScale) {
    const s = document.createElement("div");
    s.className = "mono tiny civ-s";
    s.textContent = [m.sampler, m.steps ? m.steps + " steps" : "", m.cfgScale ? "cfg " + m.cfgScale : "", m.seed != null ? "seed " + m.seed : ""].filter(Boolean).join(" · ");
    info.appendChild(s);
  }
  d.appendChild(info);
  return d;
}
function modelCard(m, tab, ctx) {
  const d = document.createElement("div");
  d.className = "civ-card civ-model";
  const v = (m.modelVersions || [])[0] || {};
  const im = (v.images || [])[0];
  if (im?.url) {
    const e = document.createElement("img");
    e.loading = "lazy"; e.referrerPolicy = "no-referrer"; e.src = im.url; e.alt = "";
    e.onclick = () => window.open("https://civitai.com/models/" + m.id, "_blank", "noopener");
    d.appendChild(e);
  }
  const info = document.createElement("div");
  info.className = "civ-meta";
  const t = document.createElement("div");
  t.className = "civ-t";
  const a = document.createElement("a");
  a.href = "https://civitai.com/models/" + m.id; a.target = "_blank"; a.rel = "noopener"; a.textContent = m.name;
  t.appendChild(a);
  info.appendChild(t);
  const s = document.createElement("div");
  s.className = "civ-s mono tiny";
  const trig = (v.trainedWords || []).slice(0, 3).join(", ");
  s.textContent = [m.type, v.baseModel, trig ? "⚡ " + trig : "", (m.stats?.downloadCount > 999 ? (m.stats.downloadCount / 1000).toFixed(0) + "k" : m.stats?.downloadCount || "") + " ⬇"].filter(Boolean).join(" · ");
  info.appendChild(s);
  const row = document.createElement("div");
  row.className = "civ-row";
  if (trig) {
    const b = document.createElement("button");
    b.type = "button"; b.className = "btn btn-tiny"; b.textContent = "Copy trigger";
    b.onclick = async () => { try { await navigator.clipboard.writeText(v.trainedWords.join(", ")); b.textContent = "Copied ✓"; } catch { b.textContent = trig; } setTimeout(() => b.textContent = "Copy trigger", 1500); };
    row.appendChild(b);
  }
  const b2 = document.createElement("button");
  b2.type = "button"; b2.className = "btn btn-tiny"; b2.textContent = "Recipe";
  b2.title = "Trigger words + prompt starter, copied into this tab";
  b2.onclick = () => ctx.showRecipe(m);
  row.appendChild(b2);
  const b2b = document.createElement("button");
  b2b.type = "button"; b2b.className = "btn btn-tiny"; b2b.textContent = "Examples";
  b2b.title = "Show example stills — pipe any into this tab";
  b2b.onclick = () => ctx.showExamples(m);
  row.appendChild(b2b);
  if (v.downloadUrl) {
    const b3 = document.createElement("button");
    b3.type = "button"; b3.className = "btn btn-tiny"; b3.textContent = "Weights";
    b3.title = "Copy direct weight URL — paste into Colab / your GPU server";
    b3.onclick = async () => { try { await navigator.clipboard.writeText(v.downloadUrl); b3.textContent = "URL copied ✓"; } catch { window.open(v.downloadUrl, "_blank", "noopener"); } setTimeout(() => b3.textContent = "Weights", 1500); };
    row.appendChild(b3);
  }
  info.appendChild(row);
  d.appendChild(info);
  return d;
}
export function mountCivitaiBrowser(box, tab) {
  if (!box || box.dataset.civBound) return;
  box.dataset.civBound = "1";
  box.className = "civ-box";
  box.innerHTML = "";
  const bar = document.createElement("div");
  bar.className = "civ-bar";
  const q = document.createElement("input");
  q.className = "mono"; q.type = "search"; q.placeholder = tab === "video" ? "hunt — e.g. cinematic portrait, drone…" : "hunt — e.g. photoreal portrait, anime…";
  q.setAttribute("autocomplete", "off");
  bar.appendChild(q);
  const mode = document.createElement("select");
  mode.className = "tiny-select";
  mode.innerHTML = "<option value='images'>Images + prompts</option><option value='models'>Models + LoRAs</option>";
  bar.appendChild(mode);
  const type = document.createElement("select");
  type.className = "tiny-select"; type.title = "Model type";
  type.innerHTML = "<option value=''>any type</option>" + CIV_TYPES.map(([v, l]) => "<option value='" + v + "'>" + l + "</option>").join("");
  bar.appendChild(type);
  const base = document.createElement("select");
  base.className = "tiny-select"; base.title = "Base model";
  base.innerHTML = "<option value=''>any base</option>" + CIV_BASES.map((b) => "<option>" + b + "</option>").join("");
  bar.appendChild(base);
  const go = document.createElement("button");
  go.type = "button"; go.className = "btn btn-tiny btn-primary"; go.textContent = "Hunt";
  bar.appendChild(go);
  box.appendChild(bar);
  const msg = document.createElement("div");
  msg.className = "model-note civ-msg";
  msg.textContent = "Civitai's public library — top-rated community models, LoRAs and copyable prompts. Free, no key.";
  box.appendChild(msg);
  const grid = document.createElement("div");
  grid.className = "civ-grid";
  box.appendChild(grid);
  const showExamples = async (m) => {
    grid.innerHTML = "";
    msg.textContent = "Loading example stills for " + m.name + "…";
    try {
      const d = await modelDetails(m.id);
      const vids = (d.modelVersions || []).map((v) => v.id).slice(0, 3);
      let items = [];
      for (const vid of vids) {
        try {
          const r = await civGet("/images?modelVersionId=" + vid + "&limit=8&nsfw=" + (nsfwOn(tab) ? "true" : "false"));
          items = items.concat(r?.items || []);
        } catch {}
        if (items.length >= 16) break;
      }
      msg.textContent = items.length ? items.length + " example stills — pipe any into this tab as a reference." : "No public examples on this model.";
      for (const it of items.slice(0, 24)) grid.appendChild(imgCard(it, tab));
    } catch { msg.textContent = "Civitai is unreachable right now — retry in a bit."; }
  };
  const showRecipe = async (m) => {
    msg.textContent = "Reading recipe for " + m.name + "…";
    try {
      const d = await modelDetails(m.id);
      const v = (d.modelVersions || [])[0] || {};
      const trig = (v.trainedWords || []).join(", ");
      const base = (v.baseModel || "").toLowerCase();
      const starter = base.includes("pony") ? "score_9, score_8_up, score_7_up, " : "";
      const recipe = (starter + (trig ? trig : "")).replace(/,\s*$/, "").trim();
      const desc = (d.description || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 300);
      msg.textContent = (trig ? "⚡ " + trig + " — copied below. " : "No trigger words. ") + (desc || "No notes shared.");
      if (recipe) fillPrompt(tab, recipe, "");
    } catch { msg.textContent = "Couldn't read that model — retry in a bit."; }
  };
  const hunt = async () => {
    grid.innerHTML = "";
    msg.textContent = "Hunting Civitai…";
    go.disabled = true;
    try {
      const nsfw = nsfwOn(tab);
      if (mode.value === "models") {
        const r = await searchModels({ q: q.value.trim(), type: type.value, base: base.value, nsfw });
        const items = r?.items || [];
        msg.textContent = items.length ? items.length + " models — Copy trigger for LoRAs, Weights URL drops into your Colab/server." + (nsfw ? "" : " (SFW only — flip this tab's NSFW on for the rest)") : "Nothing found — try fewer words.";
        for (const m of items) grid.appendChild(modelCard(m, tab, { showExamples, showRecipe }));
      } else {
        const r = await searchImages({ q: q.value.trim(), nsfw });
        const items = r?.items || [];
        msg.textContent = items.length ? items.length + " stills — pipe the pixels (Video ref / Edit ref / Frame), or Use look for a style starter." + (nsfw ? "" : " (SFW only — flip this tab's NSFW on for the rest)") : "Nothing found — try fewer words.";
        for (const it of items) grid.appendChild(imgCard(it, tab));
      }
    } catch { msg.textContent = "Civitai is unreachable right now — retry in a bit."; }
    go.disabled = false;
  };
  go.onclick = hunt;
  q.onkeydown = (e) => { if (e.key === "Enter") hunt(); };
  hunt();
}
