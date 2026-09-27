const $ = (id) => document.getElementById(id);

const TEMPLATES = [
  { id: "portrait", label: "Portrait", video: "close portrait, subject slowly turns head and smiles, hair moving in soft wind, warm cinematic light", image: "neon-lit street portrait, cinematic light, ultra detailed, shallow depth of field", voice: "Welcome back to the channel. Today's portrait took thirty seconds to make." },
  { id: "product", label: "Product", video: "slow orbit around the product on a clean table, soft studio light, subtle reflections", image: "studio product photo on seamless background, softbox lighting, ultra sharp", voice: "Three things that make this stand out: light, angle, and one slow move." },
  { id: "travel", label: "Travel", video: "slow aerial push over the landscape at golden hour, clouds drifting, warm haze", image: "epic mountain valley at golden hour, mist, tiny hiker, ultra wide", voice: "We arrived just as the light turned gold. Here's the valley in ten seconds." },
  { id: "food", label: "Food", video: "gentle overhead drift over the dish, steam rising slowly, warm kitchen light", image: "overhead food photo, rustic table, steam, appetizing, ultra detailed", voice: "Hot, simple, and ready in fifteen minutes. Save this one." },
  { id: "pet", label: "Pet", video: "the animal looks at the camera, head tilts, ears move, natural playful motion", image: "cute pet portrait, big expressive eyes, soft daylight, ultra detailed fur", voice: "Wait for the head tilt at the end. That's the whole video." },
  { id: "anime", label: "Anime", video: "anime style, hair and clothes flowing in wind, expressive eyes, dynamic light", image: "anime illustration, vibrant, clean lineart, detailed background", voice: "A new episode-style opening, drawn and animated from one picture." },
  { id: "horror", label: "Horror", video: "flickering dim light, slow creeping push-in, dust in the air, eerie stillness", image: "abandoned hallway, flickering light, fog, found-footage look", voice: "Nobody has walked this hallway in forty years. Listen." },
  { id: "ad", label: "Ad", video: "quick punchy push-in on the subject, bold rim light, confident energy", image: "bold commercial still, dramatic rim light, minimal background, premium feel", voice: "Stop scrolling. This is the one upgrade worth your money." },
];

const CATEGORY_BIBLE = {
  portrait: "Genre craft for portraits: flattering 85mm compression, catchlights in the eyes, natural skin texture, shallow depth of field, motivated key light.",
  product: "Genre craft for product shots: seamless background, softbox highlights with clean edges, subtle reflection, ultra-sharp hero detail, premium minimalism.",
  travel: "Genre craft for travel: epic wide composition, layered depth, golden-hour atmosphere, tiny human scale cue, rich but believable color.",
  food: "Genre craft for food: appetizing overhead or 45-degree angle, visible steam and texture, warm rustic styling, juicy highlights.",
  pet: "Genre craft for pets: eye-level angle, big expressive eyes with catchlights, detailed fur, soft daylight, playful personality.",
  anime: "Genre craft for anime: clean lineart, vibrant cel shading, detailed background art, dynamic composition, studio-quality finish.",
  horror: "Genre craft for horror: dim motivated light sources, deep shadows, fog and texture, unsettling negative space, found-footage grit.",
  ad: "Genre craft for advertising: bold rim light, confident hero pose, minimal premium background, high contrast, scroll-stopping punch.",
};
for (const t of TEMPLATES) t.directive = CATEGORY_BIBLE[t.id] || "";

const PLATFORMS = [
  { id: "tiktok", label: "TikTok 9:16", aspect: "9:16" },
  { id: "shorts", label: "Shorts 9:16", aspect: "9:16" },
  { id: "reels", label: "Reels 9:16", aspect: "9:16" },
  { id: "insta", label: "Insta 4:5", aspect: "3:4" },
  { id: "square", label: "Feed 1:1", aspect: "1:1" },
  { id: "yt", label: "YouTube 16:9", aspect: "16:9" },
  { id: "cinema", label: "Cinema 21:9", aspect: "21:9" },
];

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
  setTimeout(() => { t.style.opacity = "0"; setTimeout(() => t.remove(), 320); }, 2600);
}

function fillBox(id, text) {
  const el = $(id);
  if (!el) return false;
  const cur = el.value.trim();
  el.value = cur && !cur.includes(text) ? cur + ", " + text : (cur.includes(text) ? cur : text);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
}

function makeFold(title, buttons) {
  const d = document.createElement("details");
  d.className = "fold";
  const s = document.createElement("summary");
  s.textContent = title;
  d.appendChild(s);
  const wrap = document.createElement("div");
  wrap.className = "chips";
  wrap.style.display = "flex";
  wrap.style.flexWrap = "wrap";
  wrap.style.gap = "6px";
  for (const b of buttons) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-tiny";
    btn.textContent = b.label;
    btn.title = b.hint || b.label;
    btn.onclick = b.onClick;
    wrap.appendChild(btn);
  }
  d.appendChild(wrap);
  return d;
}

function injectTemplates() {
  const vPrompt = $("promptInput");
  if (vPrompt && !$("tmplVideoFold")) {
    const fold = makeFold("Template gallery", TEMPLATES.map((t) => ({
      label: t.label,
      hint: t.video,
      onClick: () => { fillBox("promptInput", t.video); toast(t.label + " template loaded."); },
    })));
    fold.id = "tmplVideoFold";
    vPrompt.closest(".field")?.after(fold);
  }
  const iPrompt = $("imgPromptInput");
  if (iPrompt && !$("tmplImgFold")) {
    const chips = TEMPLATES.map((t) => ({
      label: t.label,
      hint: t.image,
      onClick: () => {
        fillBox("imgPromptInput", t.image);
        window.__ppImgCat = t.directive || "";
        toast(t.label + " loaded — hit ✨ AI expand for the AI version.");
      },
    }));
    chips.push({
      label: "✨ AI expand",
      hint: "Expand the current prompt with AI, using the last-picked category",
      onClick: () => { $("imgEnhanceBtn")?.click(); },
    });
    const fold = makeFold("Template gallery", chips);
    fold.id = "tmplImgFold";
    iPrompt.closest(".field")?.after(fold);
  }
  const vText = $("voiceTextInput");
  if (vText && !$("tmplVoiceFold")) {
    const fold = makeFold("Script starters", TEMPLATES.map((t) => ({
      label: t.label,
      hint: t.voice,
      onClick: () => { fillBox("voiceTextInput", t.voice); toast(t.label + " script loaded."); },
    })));
    fold.id = "tmplVoiceFold";
    vText.closest(".field")?.after(fold);
  }
}

function injectPlatforms() {
  const row = $("aspectRow");
  if (!row || $("platformRow")) return;
  const wrap = document.createElement("div");
  wrap.id = "platformRow";
  wrap.className = "chips";
  wrap.style.display = "flex";
  wrap.style.flexWrap = "wrap";
  wrap.style.gap = "6px";
  wrap.style.marginTop = "8px";
  for (const p of PLATFORMS) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn btn-tiny";
    b.textContent = p.label;
    b.onclick = () => {
      const target = document.querySelector('#aspectRow [data-aspect="' + p.aspect + '"]');
      if (target) target.click();
      else toast(p.label + ": pick " + p.aspect + " below.");
    };
    wrap.appendChild(b);
  }
  row.after(wrap);
}

function injectVoiceHandoff() {
  const bar = $("voicePlayBtn")?.parentElement;
  if (!bar || $("voiceToVideoBtn")) return;
  const b = document.createElement("button");
  b.id = "voiceToVideoBtn";
  b.type = "button";
  b.className = "btn btn-ghost btn-lg";
  b.textContent = "Use as video prompt";
  b.title = "Copy this script into the video prompt and jump there";
  b.onclick = () => {
    const t = $("voiceTextInput")?.value.trim() || "";
    if (!t) { toast("Type a script first."); return; }
    fillBox("promptInput", t.slice(0, 500));
    document.querySelector('[data-page="pageVideo"]')?.click();
    toast("Script sent to the video studio.");
  };
  bar.appendChild(b);
}

function injectPackButton() {
  const grid = $("historyGrid");
  if (!grid || $("packBtn")) return;
  const b = document.createElement("button");
  b.id = "packBtn";
  b.type = "button";
  b.className = "btn btn-ghost";
  b.textContent = "Download project pack (.zip)";
  b.style.marginBottom = "10px";
  b.onclick = exportPack;
  grid.before(b);
}

async function exportPack() {
  const btn = $("packBtn");
  try {
    if (btn) { btn.disabled = true; btn.textContent = "Packing…"; }
    const { listHistory, getHistory } = await import("./store.js");
    let JSZip = window.JSZip;
    if (!JSZip) {
      try {
        const m = await import("/node_modules/jszip/dist/jszip.min.js");
        JSZip = m.default || window.JSZip;
      } catch {
        const m = await import("https://esm.sh/jszip@3.10.1");
        JSZip = m.default || window.JSZip;
      }
    }
    const rows = await listHistory();
    if (!rows.length) { toast("Library is empty."); return; }
    const zip = new JSZip();
    const meta = [];
    let n = 0;
    for (const r of rows.slice(0, 60)) {
      try {
        const full = await getHistory(r.key);
        const blob = full?.video;
        if (!blob?.size) continue;
        n += 1;
        const name = full.filename || ("asset-" + n);
        zip.file(name, blob);
        meta.push({ file: name, prompt: full.prompt || "", provider: full.providerLabel || "", ts: full.ts || 0 });
      } catch {}
    }
    if (!n) { toast("Nothing downloadable yet."); return; }
    zip.file("manifest.json", JSON.stringify(meta, null, 2));
    const out = await zip.generateAsync({ type: "blob" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(out);
    a.download = "project-pack-" + new Date().toISOString().slice(0, 10) + ".zip";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 30000);
    toast(n + " files packed.");
  } catch (e) {
    toast("Pack failed: " + (e?.message || e));
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Download project pack (.zip)"; }
  }
}

function boot() {
  injectTemplates();
  injectPlatforms();
  injectVoiceHandoff();
  injectPackButton();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => setTimeout(boot, 400));
else setTimeout(boot, 400);
setInterval(boot, 2500);
