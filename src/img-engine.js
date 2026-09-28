/**
 * Image Studio logic engine — free, standalone text-to-image + image-to-image.
 *
 * Routes (no key, no signup, works on CPU-only machines — the work happens on
 * free public services or on this device):
 *   pollinations-flux  text-to-image, Flux, free, no key, GPU remote
 *   pollinations-turbo text-to-image, Turbo, free, fastest
 *   horde-xl           text-to-image AND image-to-image (SDXL workers), free,
 *                      anonymous key works, own-GPU/CPU workers, LoRA + ControlNet
 *   perchance          built-in text-to-image-plugin (bundled, always available)
 *   device             on-device CPU remix: crop-to-ratio + grade + control
 *                      edge overlay. Never needs network, never fails.
 *   auto               picks the chain per mode and fails over through it.
 *
 * Edit (image-to-image) honesty note: Pollinations' anonymous image parameter
 * is ignored server-side (measured: returns generic text-to-image), so the edit
 * chain never claims Pollinations edits — it goes Horde img2img, then device.
 */

export const IMG_ASPECTS = [
  { id: "original", label: "Original", r: 0, desc: "Original — follow the imported image" },
  { id: "1:1", label: "1:1", r: 1, desc: "1:1 Square" },
  { id: "3:2", label: "3:2", r: 3 / 2, desc: "3:2 Classic landscape" },
  { id: "2:3", label: "2:3", r: 2 / 3, desc: "2:3 Classic portrait" },
  { id: "4:3", label: "4:3", r: 4 / 3, desc: "4:3 Standard" },
  { id: "3:4", label: "3:4", r: 3 / 4, desc: "3:4 Portrait" },
  { id: "16:9", label: "16:9", r: 16 / 9, desc: "16:9 Widescreen" },
  { id: "9:16", label: "9:16", r: 9 / 16, desc: "9:16 Vertical" },
  { id: "21:9", label: "21:9", r: 21 / 9, desc: "21:9 Ultrawide" },
];

export const IMG_SIZES = [
  { id: "S", label: "S · 512", long: 512 },
  { id: "M", label: "M · 768", long: 768 },
  { id: "L", label: "L · 1024", long: 1024 },
];

export const IMG_GROUPS = [
  { id: "perchance", label: "◆ Perchance built-in — always on" },
  { id: "free", label: "● Free — no key" },
  { id: "sdxl", label: "◆ SDXL studio — tuned fast & accurate" },
  { id: "puter", label: "○ Puter — free, login once" },
  { id: "uncensored", label: "✦ Uncensored — explicit" },
  { id: "codec", label: "◈ Codec local builds — your machine" },
  { id: "lab", label: "🧬 Lab — your CPU models (anki-human, iani-mage)" },
  { id: "device", label: "■ This device — offline" },
];

export const IMG_MODELS = [
  { id: "auto", label: "Auto — best free route first", kinds: ["t2i", "edit"] },
  { id: "perchance", label: "Perchance · Best — SFW, always on", kinds: ["t2i"], group: "perchance" },
  { id: "perchance-nsfw", label: "Perchance · Best NSFW — unfiltered", kinds: ["t2i"], group: "perchance" },
  { id: "flux-schnell", label: "FLUX.1 Schnell — ultra-fast, 4-step", kinds: ["t2i"], group: "free" },
  { id: "flux-dev", label: "FLUX.1 Dev — 12B transformer, photorealistic", kinds: ["t2i", "edit"], group: "free" },
  { id: "sd-35", label: "Stable Diffusion 3.5 Large — 8B multimodal", kinds: ["t2i"], group: "free" },
  { id: "sdxl-lightning", label: "SDXL Lightning — fast 4-step generation", kinds: ["t2i", "edit"], group: "sdxl" },
  { id: "pollinations-flux", label: "Flux (Pollinations) — free, sharp", kinds: ["t2i"], group: "free" },
  { id: "pollinations-turbo", label: "Turbo — free, fastest", kinds: ["t2i"], group: "free" },
  { id: "horde-xl", label: "SDXL pool — free, face-lock edits", kinds: ["t2i", "edit"], group: "sdxl" },
  { id: "qwen-21", label: "Qwen-Image-2.1 — free, sharp + edits", kinds: ["t2i", "edit"], group: "free" },
  { id: "qwen-codec", label: "Qwen-Image + codec — local pack · Apache 2.0", kinds: ["t2i", "edit"], group: "codec" },
  { id: "sdxl-fast", label: "SDXL Fast — quick, SFW", kinds: ["edit"], group: "sdxl" },
  { id: "sdxl-accurate", label: "SDXL Accurate — slow, precise, SFW", kinds: ["edit"], group: "sdxl" },
  { id: "sdxl-fast-nsfw", label: "SDXL Fast NSFW — quick, unfiltered", kinds: ["edit"], group: "sdxl" },
  { id: "sdxl-accurate-nsfw", label: "SDXL Accurate NSFW — slow, precise, unfiltered", kinds: ["edit"], group: "sdxl" },
  { id: "puter-nano", label: "Puter · Nano Banana Pro — free, login once", kinds: ["t2i"], group: "puter" },
  { id: "puter-flux", label: "Puter · FLUX.2 [pro] — free, login once", kinds: ["t2i"], group: "puter" },
  { id: "puter-gpt", label: "Puter · GPT Image — free, login once", kinds: ["t2i"], group: "puter" },
  { id: "puter-flux-dev", label: "Puter · FLUX.2 [dev] — free, edits uploads", kinds: ["t2i", "edit"], group: "puter" },
  { id: "puter-flux-schnell", label: "Puter · FLUX Schnell — free, fastest", kinds: ["t2i"], group: "puter" },
  { id: "puter-flux-klein", label: "Puter · FLUX.2 Klein — free", kinds: ["t2i"], group: "puter" },
  { id: "puter-grok", label: "Puter · Grok Imagine — free, login once", kinds: ["t2i"], group: "puter" },
  { id: "puter-sdxl", label: "Puter · SDXL — free, login once", kinds: ["t2i"], group: "puter" },
  { id: "explicit-flux", label: "NSFW Flux — free, unfiltered", kinds: ["t2i"], group: "uncensored" },
  { id: "explicit-sdxl", label: "NSFW SDXL pool — free, uncensored edits", kinds: ["t2i", "edit"], group: "uncensored" },
  { id: "device", label: "This device — offline, CPU", kinds: ["t2i", "edit"], group: "device" },
  { id: "anki-human-cpu", label: "Anki-Human CPU — photo + 3D character (lab-trained)", kinds: ["t2i"], group: "lab" },
  { id: "iani-mage-cpu", label: "Iani-Mage CPU — mage + 3D character (lab-trained)", kinds: ["t2i"], group: "lab" },
];

export const IMG_LORAS = [
  { id: "none", label: "No LoRA", suffix: "", horde: [] },
  { id: "detail", label: "Detail + sharpness", suffix: ", ultra detailed, sharp focus, 8k resolution", horde: [] },
  { id: "cinematic", label: "Cinematic Film", suffix: ", cinematic lighting, 35mm film still, depth of field", horde: [] },
  { id: "hyper-real", label: "Hyper-Realism Skin & Eyes", suffix: ", photorealistic skin texture, subsurface scattering, realistic eyes, masterwork", horde: [] },
  { id: "studio-portrait", label: "Studio Rim Lighting", suffix: ", professional studio lighting, soft rim light, rembrandt lighting, sharp portrait", horde: [] },
  { id: "lcm", label: "LCM Turbo Speed", suffix: ", (lcm lora:1.2), high speed rendering, sharp edges", horde: [] },
  { id: "anime", label: "Anime / Manga", suffix: ", anime aesthetic, makoto shinkai style, vibrant colors", horde: [] },
  { id: "cyber-neon", label: "Cyberpunk Neon", suffix: ", cyberpunk aesthetic, volumetric neon glow, futuristic night reflections", horde: [] },
  { id: "photo", label: "Analog 35mm Film", suffix: ", authentic 35mm photograph, kodak portra 400 grain, analog color", horde: [] },
];

export const IMG_CONTROLS = [
  { id: "none", label: "Off" },
  { id: "canny", label: "Canny Edge Detection" },
  { id: "depth", label: "Depth Map Lock" },
  { id: "pose", label: "OpenPose Human Pose" },
  { id: "structure", label: "Lineart & Structure Lock" },
  { id: "softedge", label: "SoftEdge HED Boundary" },
];

const HORDE_BASE = "https://aihorde.net/api/v2";
const HORDE_ANON = "0000000000";
const HORDE_AGENT = "AIMultiToolkit:1.0:perchance.org";

const ANATOMY_NEG = "deformed face, distorted face, asymmetric eyes, crossed eyes, uneven eyes, missing eye, blurry face, face morph, identity shift, cloned face, warped body, broken spine, dislocated shoulders, extra limbs, missing limbs, fused limbs, extra arms, extra legs, three legs, deformed hands, malformed hands, extra fingers, missing fingers, fused fingers, melted fingers, six fingers, broken wrist, deformed feet, extra feet, missing feet, extra toes, fused toes, deformed nails, warped nails, long claws, extra head, double head, animal extra legs, deformed beak, deformed wings, warped architecture, melted buildings, tilted horizon, watermark, text, logo, signature, username, blurry, low quality, worst quality, oversaturated, overexposed, jpeg artifacts";
const SFW_GUARD_NEG = "nude, naked, nudity, explicit nudity, nsfw, topless, sexual content, erotic, exposed breasts, exposed body";
const NSFW_GUARD_NEG = "censored, mosaic, pixelated, blurred body, black bar, covered body, censored bar, fully clothed, dress overlay, sheer fabric over body, translucent fabric, lace overlay";
const NSFW_IMG_BOOST = "uncensored, explicit nudity, natural skin texture";
const HUMAN_LOCK = "consistent adult character, same age, same face, symmetrical natural eyes, natural eyebrows, natural lips, natural skin texture with pores, anatomically correct body proportions, two arms, two legs, relaxed natural pose, realistic hands with five separate fingers each, short clean natural nails, realistic feet with five toes";
const SCENE_LOCK = "same location, same architecture, same furniture, same lighting, same time of day, coherent perspective, straight lines, landscape composition";
const EDIT_ANCHOR = "keep the same person, same face, same age, same hairstyle, same body, same room and lighting, change only what is asked, photorealistic seamless blend, no extra limbs, no extra fingers";

function kindOf(p) {
  const s = String(p || "").toLowerCase();
  const animal = /(dog|cat|fox|tortoise|turtle|crab|bird|parrot|eagle|owl|horse|lion|tiger|bear|wolf|elephant|monkey|rabbit|deer|fish|shark|whale|snake|lizard|dragon|animal|pet|puppy|kitten)/.test(s);
  const scene = /(landscape|street|alley|market|monastery|temple|courtyard|room|bedroom|kitchen|city|village|forest|mountain|beach|lake|river|desert|sky|interior|exterior|background|scene)/.test(s);
  const human = /(woman|man|girl|boy|female|male|person|portrait|face|hands|feet|body|nude|topless|couple|bride|mother|father|elderly|adult|character)/.test(s);
  if (human) return animal ? "both" : "human";
  if (animal) return "animal";
  if (scene) return "scene";
  return "human";
}

function lockFor(prompt, edit, scene = "same") {
  const k = kindOf(prompt);
  if (edit) {
    if (scene === "free") return "keep the same person, same face, same age, same hairstyle, same body, new background in a new location different from the reference photo, photorealistic seamless blend, no extra limbs, no extra fingers";
    if (scene === "new-hair") return EDIT_ANCHOR.replace(", same hairstyle", "");
    return EDIT_ANCHOR;
  }
  if (scene === "free") return HUMAN_LOCK;
  if (k === "animal") return "same animal, consistent species, consistent fur and feather pattern, anatomically correct legs, paws and tail, natural eyes, no extra limbs, no extra heads, " + SCENE_LOCK;
  if (k === "scene") return "same place, " + SCENE_LOCK;
  if (k === "both") return HUMAN_LOCK + ", same animal companion with consistent fur pattern and correct legs, " + SCENE_LOCK;
  return HUMAN_LOCK + ", " + SCENE_LOCK;
}

function effectiveNegative(userNegative, nsfw) {
  const base = nsfw ? `${ANATOMY_NEG}, ${NSFW_GUARD_NEG}` : `${ANATOMY_NEG}, ${SFW_GUARD_NEG}`;
  const user = String(userNegative || "").trim();
  return user ? `${user}, ${base}` : base;
}

function effectivePrompt(prompt, loraId, nsfw, edit = false, scene = "same") {
  const clean = String(prompt || "").trim();
  const locked = clean.length < 600 ? `${clean}, ${lockFor(clean, edit, scene)}` : clean;
  return `${withLora(locked, loraId)}${nsfw ? `, ${NSFW_IMG_BOOST}` : ""}`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loraOf(id) {
  return IMG_LORAS.find((l) => l.id === id) || IMG_LORAS[0];
}

function withLora(prompt, loraId) {
  return `${prompt}${loraOf(loraId).suffix || ""}`;
}

/** Width/height snapped to `grid`, long side = `long`. Input ratio when asked. */
export function imgDims(aspectId, sizeId, inputWH = null, grid = 8) {
  const long = (IMG_SIZES.find((s) => s.id === sizeId) || IMG_SIZES[1]).long;
  let r = (IMG_ASPECTS.find((a) => a.id === aspectId) || {}).r || 0;
  if (!r && inputWH && inputWH[0] > 0 && inputWH[1] > 0) r = inputWH[0] / inputWH[1];
  if (!r) r = 1;
  let w, h;
  if (r >= 1) {
    w = long;
    h = long / r;
  } else {
    h = long;
    w = long * r;
  }
  const snap = (v) => Math.max(grid, Math.round(v / grid) * grid);
  return [snap(w), snap(h)];
}

function decodeImg(blob) {
  return new Promise((res) => {
    try {
      const img = new Image();
      const url = URL.createObjectURL(blob);
      img.onload = () => {
        URL.revokeObjectURL(url);
        res(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        res(null);
      };
      img.src = url;
    } catch {
      res(null);
    }
  });
}

export async function naturalSize(blob) {
  if (!blob) return null;
  const img = await decodeImg(blob);
  if (!img || !img.naturalWidth) return null;
  return [img.naturalWidth, img.naturalHeight];
}

/** Cover-crop `blob` to exactly w×h (the manual-crop equivalent, automatic). */
export async function coverCrop(blob, w, h) {
  const img = await decodeImg(blob);
  if (!img) return blob;
  const sw = img.naturalWidth;
  const sh = img.naturalHeight;
  const s = Math.max(w / sw, h / sh);
  const dw = sw * s;
  const dh = sh * s;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
  const out = await new Promise((res) => {
    try {
      c.toBlob((b) => res(b), "image/jpeg", 0.92);
    } catch {
      res(null);
    }
  });
  return out || blob;
}

function blobToB64(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(",", 2)[1] || "");
    r.onerror = () => rej(new Error("could not read image"));
    r.readAsDataURL(blob);
  });
}

/* ------------------------------------------------ Pollinations (text→image) */

async function pollinationsText({ prompt, negative, w, h, seed, turbo, loraId, nsfw, explicit, signal }) {
  const q0 = effectivePrompt(prompt, loraId, nsfw || explicit, false, "same");
  const negText = String(negative || "").trim();
  // The image endpoint documents no negative-prompt field, so the avoidance
  // is folded into the prompt itself — where the model reads it.
  const q = negText ? `${q0} (avoiding: ${negText})` : q0;
  const neg = negText ? `&negative=${encodeURIComponent(negText)}` : "";
  const url =
    `https://image.pollinations.ai/prompt/${encodeURIComponent(q)}` +
    `?width=${w}&height=${h}&seed=${seed}&nologo=true&model=${turbo ? "turbo" : "flux"}` +
    `${nsfw === false ? "&safe=true" : "&safe=false"}${neg}`;
  let lastErr = null;
  for (let a = 0; a < 3; a++) {
    if (signal?.aborted) throw Object.assign(new Error("cancelled"), { kind: "cancelled" });
    try {
      const r = await fetch(url, { signal });
      if (!r.ok) throw new Error(`Pollinations answered ${r.status}`);
      const blob = await r.blob();
      if (blob && blob.size > 4096) return { blob, by: explicit ? "NSFW Flux · free" : turbo ? "Turbo · free" : "Flux · free" };
      lastErr = new Error("empty picture");
    } catch (e) {
      if (e?.kind === "cancelled" || signal?.aborted) throw Object.assign(new Error("cancelled"), { kind: "cancelled" });
      lastErr = e;
    }
    if (a < 2) await sleep(1800 + a * 2000);
  }
  throw lastErr || new Error("Pollinations did not answer");
}

/* ------------------------------------------------ AI Horde (text or edit) */

function hordeSnap(w, h, maxSide = 768) {
  const s = Math.min(1, maxSide / Math.max(w, h));
  const snap = (v) => Math.max(64, Math.round((v * s) / 64) * 64);
  return [snap(w), snap(h)];
}

async function hordeRun({ prompt, negative, w, h, seed, loraId, control, inputBlob, strength, key, nsfw, explicit, signal, onStage, sceneLock, maskBlob }) {
  const [hw, hh] = hordeSnap(w, h);
  const headers = {
    "Content-Type": "application/json",
    "Client-Agent": HORDE_AGENT,
    apikey: (key || "").trim() || HORDE_ANON,
  };
  const params = {
    sampler_name: "k_euler",
    steps: inputBlob ? 30 : 25,
    cfg_scale: 7,
    width: hw,
    height: hh,
    seed: String(seed),
    n: 1,
    karras: true,
  };
  if (loraOf(loraId).horde.length) params.loras = loraOf(loraId).horde;
  if (inputBlob && control && control !== "none") {
    params.control_type = control === "depth" ? "hed" : "canny";
  }
  const isX = nsfw || explicit;
  const body = {
    prompt: effectivePrompt(prompt, loraId, isX, !!inputBlob, sceneLock || "same"),
    params,
    nsfw: isX,
    censor_nsfw: !isX,
    trusted_workers: false,
    slow_workers: true,
    workers: [],
    models: isX ? ["AlbedoBase XL", "Juggernaut XL"] : ["AlbedoBase XL", "Juggernaut XL", "SDXL 1.0"],
  };
  body.params.negative_prompt = effectiveNegative(negative, isX);
  if (inputBlob) {
    const fitted = await coverCrop(inputBlob, hw, hh);
    body.source_image = await blobToB64(fitted);
    body.source_processing = maskBlob ? "inpainting" : "img2img";
    body.source_mask = undefined;
    if (maskBlob) {
      try {
        const fittedMask = await coverCrop(maskBlob, hw, hh);
        body.source_mask = await blobToB64(fittedMask);
      } catch {}
    }
    body.params.denoising_strength = Math.min(0.95, Math.max(0.15, strength ?? 0.6));
  }
  const post = async (path, init) => {
    const r = await fetch(HORDE_BASE + path, init);
    const t = await r.text();
    if (!r.ok) throw new Error(`AI Horde answered ${r.status}`);
    return JSON.parse(t);
  };
  let id = null;
  for (let a = 0; ; a++) {
    if (signal?.aborted) throw Object.assign(new Error("cancelled"), { kind: "cancelled" });
    try {
      const job = await post("/generate/async", { method: "POST", headers, body: JSON.stringify(body) });
      if (!job?.id) throw new Error("no job id");
      id = job.id;
      break;
    } catch (e) {
      if (/429|2 per 1 second/i.test(e.message) && a < 3) {
        await sleep(1300);
        continue;
      }
      throw e;
    }
  }
  const t0 = Date.now();
  const maxMs = 12 * 60 * 1000;
  for (;;) {
    if (signal?.aborted) throw Object.assign(new Error("cancelled"), { kind: "cancelled" });
    if (Date.now() - t0 > maxMs) throw new Error("AI Horde queue timed out — try Flux (instant) instead");
    await sleep(5000);
    let c = null;
    try {
      c = await post(`/generate/check/${id}`, { method: "GET", headers });
    } catch {
      continue;
    }
    if (c?.queue_position != null) onStage?.(`SDXL pool · queue ${c.queue_position}`);
    if (c?.faulted) throw new Error("AI Horde worker failed the job");
    if (!c?.done) continue;
    const st = await post(`/generate/status/${id}`, { method: "GET", headers });
    const gen = st?.generations?.[0];
    const raw = String(gen?.img || "");
    if (!raw || gen?.censored) throw new Error("AI Horde filtered this one — try again");
    const by = isX ? "NSFW SDXL pool · free" : "SDXL pool · free";
    if (/^https?:/i.test(raw)) {
      const r = await fetch(raw, { signal });
      const blob = await r.blob();
      if (blob.size) return { blob, by };
      throw new Error("empty picture");
    }
    let b64 = raw.replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    const bytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
    return { blob: new Blob([bytes], { type: "image/png" }), by };
  }
}

/* ------------------------------------------------ Qwen-Image-2.1 (official free demo Space) */

const QWEN_SPACE = "Qwen/Qwen-Image-2.1";
const QWEN_ENDPOINT = "generate_with_enhance";

function qwenFetch(url, init) {
  const f = (typeof root !== "undefined" && root.superFetch) || fetch;
  return f(url, init);
}

async function qwenUpload(base, blob, signal) {
  const fd = new FormData();
  fd.append("files", blob, "input.png");
  const r = await qwenFetch(`${base}/gradio_api/upload`, { method: "POST", body: fd, signal });
  const t = await r.text();
  if (!r.ok) throw new Error(`Qwen demo upload failed (${r.status})`);
  let j = null;
  try { j = JSON.parse(t); } catch {}
  const path = Array.isArray(j) ? j[0] : j?.files?.[0] || j?.path;
  if (!path) throw new Error("Qwen demo upload returned no file path");
  return { path, meta: { _type: "gradio.FileData" }, orig_name: "input.png" };
}

function qwenSnap(w, h, maxSide = 1344) {
  const s = Math.min(1, maxSide / Math.max(w, h));
  const snap = (v) => Math.min(2688, Math.max(256, Math.round((v * s) / 8) * 8));
  return [snap(w), snap(h)];
}

async function qwenSse(base, endpoint, data, { signal, onStage, timeoutMs = 600000 }) {
  const callUrl = `${base}/gradio_api/call/${endpoint}`;
  let post = null, pt = "", j = null;
  for (let a = 0; a < 4; a++) {
    if (signal?.aborted) throw Object.assign(new Error("cancelled"), { kind: "cancelled" });
    post = await qwenFetch(callUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data }),
      signal,
    });
    pt = await post.text();
    try { j = JSON.parse(pt); } catch { j = null; }
    if (post.ok && j?.event_id) break;
    const st = Number(post.status);
    if ((/queue is full|currently loading|waking|too many requests|sleep/i.test(pt) || st === 404 || st === 503) && a < 3) {
      onStage?.("Qwen 2.1 · demo waking, retrying…");
      await new Promise((r) => setTimeout(r, 15000));
      continue;
    }
    break;
  }
  if (!post.ok || !j?.event_id) {
    if (/queue is full/i.test(pt)) throw new Error("Qwen demo queue is full — try again, or leave Auto to use the next free route");
    throw new Error(`Qwen demo refused the job (${Number(post.status) || "no response"}) — the demo is overloaded or restarting; Auto moves to the next free route`);
  }
  const r = await qwenFetch(`${base}/gradio_api/call/${endpoint}/${j.event_id}`, { signal });
  if (!r.ok || !r.body) throw new Error("Qwen demo stream failed");
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buffer = "";
  const t0 = Date.now();
  for (;;) {
    if (signal?.aborted) throw Object.assign(new Error("cancelled"), { kind: "cancelled" });
    if (Date.now() - t0 > timeoutMs) throw new Error("Qwen demo took too long — try Flux (instant) instead");
    const { done, value } = await reader.read();
    if (done) break;
    buffer += dec.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const block = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const ev = (/^event:\s*(.*)$/m.exec(block) || [])[1] || "";
      const dm = (/^data:\s*([\s\S]*)$/m.exec(block) || [])[1] || "";
      if (ev === "complete") return dm;
      if (ev === "error") throw new Error(`Qwen demo failed${dm && dm !== "null" ? `: ${String(dm).slice(0, 200)}` : ""}`);
      if (ev === "estimation") {
        try {
          const q = JSON.parse(dm);
          if (q?.queue_rank != null) onStage?.(`Qwen 2.1 · queue ${q.queue_rank}`);
        } catch {}
      } else if (ev === "progress" || ev === "generating" || ev === "status") {
        onStage?.("Qwen 2.1 · painting…");
      }
    }
  }
  throw new Error("Qwen demo finished without a result");
}

export async function qwen21Run({ prompt, negative, w, h, seed, inputBlob, mode, signal, onStage, sceneLock }) {
  const { spaceToHost, spaceParams, alignData, findMedia } = await import("./gradio.js");
  const base = spaceToHost(QWEN_SPACE).toLowerCase();
  const [qw, qh] = qwenSnap(w, h);
  let inputImages = [];
  if (mode === "edit" && inputBlob) {
    onStage?.("Qwen 2.1 · uploading reference…");
    const up = await qwenUpload(base, inputBlob, signal);
    inputImages = [{ path: up.path, meta: up.meta || { _type: "gradio.FileData" }, orig_name: up.orig_name || "input.png" }];
  }
  const named = {
    input_images: inputImages,
    original_prompt: String(effectivePrompt(prompt, "none", false, mode === "edit" && !!inputBlob, sceneLock || "same")).slice(0, 1500),
    enable_extend: false,
    custom_size: true,
    log_dir: "./generation_logs_paper_case",
    seed: (Number(seed) >>> 0) || 0,
    randomize_seed: false,
    height: qh,
    width: qw,
    negative_prompt: String(effectiveNegative(negative, false)).trim() || " ",
  };
  let params = null;
  try { params = await spaceParams(base, QWEN_ENDPOINT, {}); } catch {}
  const data = params && params.length ? alignData(params, named) : [inputImages, named.original_prompt, false, true, named.log_dir, named.seed, false, qh, qw, named.negative_prompt];
  onStage?.("Qwen 2.1 · queued…");
  const raw = await qwenSse(base, QWEN_ENDPOINT, data, { signal, onStage });
  let parsed = null;
  try { parsed = JSON.parse(raw); } catch { parsed = raw; }
  const found = findMedia(parsed, ["png", "jpg", "jpeg", "webp"]);
  const pick = found.find((f) => f.url) || found[0];
  let url = pick?.url || pick?.path || "";
  if (url && !/^https?:/i.test(url)) url = url.startsWith("/") ? base + url : `${base}/gradio_api/file=${url}`;
  if (!url) throw new Error("Qwen demo returned no picture");
  const r = await qwenFetch(url, { signal });
  const blob = await r.blob();
  if (!r.ok || !blob || blob.size < 4096) throw new Error("Qwen demo returned an empty picture");
  return { blob, by: "Qwen-Image-2.1 · free" };
}

/* ------------------------------------------------ on-device CPU remix */

async function deviceRemix({ prompt, w, h, seed, inputBlob, strength, control, loraId }) {
  let rnd = seed >>> 0 || 1;
  const rand = () => ((rnd = (rnd * 1664525 + 1013904223) >>> 0) / 4294967296);
  let hue = 0;
  for (const ch of prompt) hue = (hue * 31 + ch.charCodeAt(0)) % 360;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (inputBlob) {
    const fitted = await coverCrop(inputBlob, Math.min(512, w), Math.min(512, h));
    const img = await decodeImg(fitted);
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, w, h);
    if (img) {
      const s = Math.max(w / img.naturalWidth, h / img.naturalHeight);
      const dw = img.naturalWidth * s;
      const dh = img.naturalHeight * s;
      ctx.globalAlpha = 1 - Math.min(0.85, Math.max(0.1, strength ?? 0.5)) * 0.85;
      ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
      ctx.globalAlpha = 1;
    }
  } else {
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, `hsl(${hue},45%,16%)`);
    g.addColorStop(0.5, `hsl(${(hue + 50) % 360},50%,28%)`);
    g.addColorStop(1, `hsl(${(hue + 110) % 360},45%,14%)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 260; i++) {
      ctx.fillStyle = `hsla(${(hue + rand() * 80) % 360},60%,${30 + rand() * 40}%,0.08)`;
      const r = 4 + rand() * Math.min(w, h) * 0.12;
      ctx.beginPath();
      ctx.arc(rand() * w, rand() * h, r, 0, 7);
      ctx.fill();
    }
  }
  ctx.fillStyle = `hsla(${hue},70%,60%,${inputBlob ? 0.22 * (strength ?? 0.5) : 0.16})`;
  ctx.fillRect(0, 0, w, h);
  if (control !== "none" && inputBlob) {
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = Math.max(1, w / 512);
    for (let y = 0; y < h; y += Math.max(6, h / 48)) {
      ctx.beginPath();
      for (let x = 0; x <= w; x += 8) {
        const yy = y + Math.sin(x / 40 + y / 25 + hue) * 3;
        x ? ctx.lineTo(x, yy) : ctx.moveTo(x, yy);
      }
      ctx.stroke();
    }
  }
  const blob = await new Promise((res) => {
    try {
      c.toBlob((b) => res(b), "image/jpeg", 0.9);
    } catch {
      res(null);
    }
  });
  if (!blob) throw new Error("device render failed");
  return { blob, by: inputBlob ? "This device · remix" : "This device · offline" };
}

/** One picture through one route. Throws when the route cannot do it. */
async function oneRoute(modelId, args) {
  const { mode } = args;
  const edit = mode === "edit";
  if (modelId === "sdxl-fast" || modelId === "sdxl-accurate") return oneRoute("horde-xl", args);
  if (modelId === "sdxl-fast-nsfw" || modelId === "sdxl-accurate-nsfw") return oneRoute("explicit-sdxl", args);
  if (String(modelId || "").startsWith("puter-")) {
    const { puterRouteToModel, puterImage, PUTER_IMAGE_MODELS } = await import("./puter.js");
    const entry = PUTER_IMAGE_MODELS.find((m) => m.route === modelId);
    if (edit && !entry?.edit) throw new Error("That Puter route is text-only — FLUX.2 [dev] or SDXL pool edits");
    let inputImage = null;
    if (edit && args.inputBlob) {
      const fitted = await coverCrop(args.inputBlob, Math.min(1024, args.w), Math.min(1024, args.h));
      inputImage = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result || ""));
        r.onerror = () => rej(new Error("could not read image"));
        r.readAsDataURL(fitted);
      });
    }
    const blob = await puterImage(effectivePrompt(args.prompt, args.loraId, args.nsfw, edit && !!args.inputBlob, args.sceneLock || "same"), {
      model: puterRouteToModel(modelId),
      signal: args.signal,
      onStage: (msg) => args.onStage?.(msg),
      width: args.w,
      height: args.h,
      seed: args.seed,
      inputImage,
    });
    if (!blob || !blob.size) throw new Error("Puter returned an empty picture");
    return { blob, by: `Puter · ${entry?.label || modelId} · free` };
  }
  if (modelId === "explicit-flux") {
    if (edit) throw new Error("NSFW Flux cannot edit uploads — NSFW SDXL pool can");
    return pollinationsText({ ...args, turbo: false, explicit: true, nsfw: true });
  }
  if (modelId === "pollinations-flux" || modelId === "pollinations-turbo") {
    if (edit) throw new Error("Flux/Turbo cannot edit uploads — SDXL pool can");
    return pollinationsText({ ...args, turbo: modelId.endsWith("turbo") });
  }
  if (modelId === "horde-xl" || modelId === "explicit-sdxl") return hordeRun({ ...args, explicit: modelId === "explicit-sdxl" });
  if (modelId === "qwen-21") return qwen21Run(args);
  if (modelId === "perchance" || modelId === "perchance-nsfw") {
    if (edit) throw new Error("built-in route is text-only — SDXL pool edits");
    const gen = typeof root !== "undefined" ? root.generateImage : null;
    if (!gen) throw new Error("built-in engine still loading");
    const wantX = modelId === "perchance-nsfw" || args.nsfw;
    const res = await gen({
      prompt: effectivePrompt(args.prompt, args.loraId, wantX),
      negativePrompt: effectiveNegative(args.negative, wantX),
      resolution: args.w >= args.h ? (args.w > 600 ? "768x512" : "512x512") : "512x768",
      ...(args.seed != null ? { seed: args.seed } : {}),
    });
    const url = res?.dataUrl || res?.url || "";
    if (!url) throw new Error("built-in engine returned nothing");
    const blob = await (await fetch(url)).blob();
    return { blob, by: modelId === "perchance-nsfw" ? "Perchance NSFW · free" : "Perchance · free" };
  }
  if (modelId === "device") return deviceRemix(args);
  if (modelId === "qwen-codec") {
    const { codecImageEdit } = await import("./codec-generate.js");
    return codecImageEdit({ prompt: args.prompt, inputBlob: args.inputBlob, w: args.w, h: args.h, seed: args.seed, strength: args.strength });
  }
  if (modelId === "anki-human-cpu" || modelId === "iani-mage-cpu") {
    const { renderLabImage } = await import("./anki-cpu.js");
    const r = await renderLabImage({ prompt: args.prompt, seed: args.seed, w: args.w, h: args.h, modelId, negative: args.negative });
    return { blob: r.blob, by: r.by };
  }
  throw new Error(`unknown route ${modelId}`);
}

function chainFor(modelId, mode, nsfw) {
  if (String(modelId || "").startsWith("sdxl-")) {
    const x = String(modelId).endsWith("-nsfw");
    if (mode === "edit") return x ? ["explicit-sdxl", "horde-xl", "device"] : ["horde-xl", "qwen-21", "device"];
    return x ? ["explicit-sdxl", "explicit-flux", "horde-xl"] : ["horde-xl", "qwen-21", "perchance"];
  }
  const t2i = nsfw
    ? ["perchance-nsfw", "explicit-sdxl", "explicit-flux", "horde-xl", "perchance"]
    : ["perchance", "pollinations-flux", "horde-xl", "qwen-21"];
  const edit = ["horde-xl", "qwen-21", "device"];
  const editX = ["explicit-sdxl", "horde-xl", "device"];
  if (modelId && modelId !== "auto") {
    const fb = mode === "edit" ? (nsfw ? editX : edit) : t2i;
    return [modelId, ...fb.filter((m) => m !== modelId)];
  }
  if (mode === "edit") return nsfw ? editX : edit;
  return t2i;
}

/**
 * Generate `count` variations. Each variation walks the failover chain until a
 * route delivers; failures of one variation never stop the others.
 */
export async function generateImages(o) {
  const {
    prompt,
    negative = "",
    mode = "t2i",
    inputBlob = null,
    aspect = "1:1",
    sizeId = "M",
    model = "auto",
    count = 1,
    strength = 0.6,
    lora = "none",
    control = "none",
    seed = null,
    nsfw = false,
    key = "",
    signal = null,
    onStage = null,
    sceneLock = "same",
    maskBlob = null,
  } = o;
  if (!prompt || !prompt.trim()) throw new Error("Describe the image first");
  if (mode === "edit" && !inputBlob) throw new Error("Import an image to edit first");
  const base = seed != null && Number.isFinite(Number(seed)) ? Math.floor(Number(seed)) : Math.floor(Math.random() * 2 ** 31);
  const inputWH = inputBlob ? await naturalSize(inputBlob) : null;
  const [w, h] = imgDims(aspect, sizeId, aspect === "original" && inputWH ? inputWH : null);
  const chain = chainFor(model, mode, nsfw);
  const jobs = Array.from({ length: Math.min(4, Math.max(1, count)) }, (_, i) => {
    const s = (base + i * 7919) % 2 ** 31;
    return (async () => {
      let lastErr = null;
      for (const m of chain) {
        if (signal?.aborted) throw Object.assign(new Error("cancelled"), { kind: "cancelled" });
        try {
          onStage?.(i, m, "working");
          const r = await oneRoute(m, {
            prompt: prompt.trim(),
            negative,
            w,
            h,
            seed: s,
            loraId: lora,
            control,
            inputBlob,
            strength,
            mode,
            key,
            nsfw,
            sceneLock,
            maskBlob,
            signal,
            onStage: (msg) => onStage?.(i, m, msg),
          });
          const url = URL.createObjectURL(r.blob);
          return { ...r, url, seed: s, w, h, model: m, index: i };
        } catch (e) {
          if (e?.kind === "cancelled") throw e;
          lastErr = e;
        }
      }
      throw lastErr || new Error("no route delivered");
    })();
  });
  const settled = await Promise.allSettled(jobs);
  const ok = [];
  const errs = [];
  for (const s of settled) {
    if (s.status === "fulfilled") ok.push(s.value);
    else errs.push(s.reason);
  }
  if (!ok.length) throw errs[0] || new Error("nothing was generated");
  ok.sort((a, b) => a.index - b.index);
  return { items: ok, w, h, baseSeed: base, failures: errs.map((e) => e?.message || String(e)) };
}
