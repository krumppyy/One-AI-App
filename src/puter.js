/**
 * Puter.js routes — free, no API key, no server of your own.
 *
 * Puter runs a User-Pays model: each visitor covers their own AI usage through
 * their own Puter account, so the developer (and this generator) pays nothing
 * and ships no keys. The trade-off is a one-time sign-in: the first Puter call
 * pops Puter's own auth window, and after that the routes just answer.
 *
 * What is used here, and why:
 *   puter.ai.txt2img(prompt, {model})  image studio routes (Nano Banana Pro,
 *                                       FLUX.2, GPT Image). Returns an <img>
 *                                       whose src is fetched back into a Blob
 *                                       so the library can keep it.
 *   puter.ai.txt2vid(prompt, {seconds}) video studio route (text-to-video).
 *                                       Returns a <video> the same way.
 *   puter.ai.txt2speech                 NOT wired yet — the voiceover studio
 *                                       still uses the on-device engine. It is
 *                                       the obvious next route when that
 *                                       studio grows studio voices.
 *
 * Puter models move fast, so model ids live here (not in the engine) and the
 * engine only knows the route ids `puter-*`.
 */

const PUTER_SCRIPT = "https://js.puter.com/v2/";

let loadPromise = null;

export const PUTER_IMAGE_MODELS = [
  { route: "puter-nano", model: "google/gemini-3-pro-image", label: "Nano Banana Pro", license: "proprietary" },
  { route: "puter-flux", model: "black-forest-labs/flux-2-pro", label: "FLUX.2 [pro]", license: "commercial" },
  { route: "puter-gpt", model: "openai/gpt-image-2.5-flare", label: "GPT Image 2.5 Flare", license: "proprietary" },
  { route: "puter-flux-dev", model: "black-forest-labs/flux-2-dev", label: "FLUX.2 [dev]", edit: true, license: "non-commercial" },
  { route: "puter-flux-schnell", model: "black-forest-labs/flux-schnell", label: "FLUX.1 Schnell", license: "apache" },
  { route: "puter-flux-klein", model: "black-forest-labs/flux-2-klein-9b-base", label: "FLUX.2 Klein", license: "non-commercial" },
  { route: "puter-gpt-sunburst", model: "openai/gpt-image-2.5-sunburst", label: "GPT Image 2.5 Sunburst", license: "proprietary" },
  { route: "puter-grok", model: "x-ai/grok-imagine-image", label: "Grok Imagine", license: "proprietary" },
  { route: "puter-sdxl", model: "stabilityai/stable-diffusion-xl-base-1.0", label: "SDXL", license: "community" },
];

export function puterRouteToModel(route) {
  return (PUTER_IMAGE_MODELS.find((m) => m.route === route) || {}).model || null;
}

function loadScriptOnce() {
  if (typeof window !== "undefined" && window.puter?.ai) return Promise.resolve(window.puter);
  if (loadPromise) return loadPromise;
  loadPromise = new Promise((res, rej) => {
    try {
      const s = document.createElement("script");
      s.src = PUTER_SCRIPT;
      s.async = true;
      s.onload = () => (window.puter?.ai ? res(window.puter) : rej(new Error("Puter.js loaded but puter.ai is missing")));
      s.onerror = () => rej(new Error("Puter.js did not load — check the connection and try again"));
      document.head.appendChild(s);
      setTimeout(() => rej(new Error("Puter.js timed out while loading")), 30000);
    } catch (e) {
      rej(e);
    }
  }).catch((e) => {
    loadPromise = null;
    throw e;
  });
  return loadPromise;
}

export async function ensurePuter() {
  const puter = await loadScriptOnce();
  if (!puter?.ai?.txt2img) throw new Error("Puter.js has no image route in this browser");
  return puter;
}

async function srcToBlob(src) {
  const r = await fetch(src);
  if (!r.ok) throw new Error("Puter answered, but the file could not be read back");
  const blob = await r.blob();
  if (!blob || !blob.size) throw new Error("Puter returned an empty file");
  return blob;
}

/**
 * One picture through Puter. Throws when the route cannot do it — the engine
 * treats that like any other route failure and fails over.
 */
export async function puterImage(prompt, { model = null, signal = null, onStage = null, width = 0, height = 0, seed = null, inputImage = null } = {}) {
  if (signal?.aborted) throw Object.assign(new Error("cancelled"), { kind: "cancelled" });
  const puter = await ensurePuter();
  onStage?.("sign-in once, then painting");
  const args = { prompt: String(prompt || "").trim() };
  if (model) args.model = model;
  const opts = {};
  if (model) opts.model = model;
  if (width > 0) opts.width = width;
  if (height > 0) opts.height = height;
  if (Number.isFinite(Number(seed))) opts.seed = Math.floor(Number(seed));
  if (inputImage) opts.input_image = inputImage;
  const el = await puter.ai.txt2img(args.prompt, Object.keys(opts).length ? opts : undefined);
  if (signal?.aborted) throw Object.assign(new Error("cancelled"), { kind: "cancelled" });
  const src = el?.src || el?.toString?.() || "";
  if (!src) throw new Error("Puter returned no image");
  return srcToBlob(String(src));
}

/**
 * One clip through Puter's text-to-video route. `imageBlob` is handed over
 * only when the loaded Puter build accepts it — otherwise the run is an
 * honest text-to-video render and says so in the result card.
 */
export async function puterVideo({ prompt, seconds = 5, imageBlob = null, signal = null, onStage = null } = {}) {
  if (signal?.aborted) throw Object.assign(new Error("cancelled"), { kind: "cancelled" });
  const puter = await ensurePuter();
  if (!puter?.ai?.txt2vid) throw new Error("This Puter.js build has no video route yet");
  onStage?.("sign-in once, then filming");
  const opts = { prompt: String(prompt || "").trim(), seconds: Math.min(15, Math.max(1, Math.round(seconds || 5))) };
  let usedImage = false;
  if (imageBlob && imageBlob.size) {
    try {
      const dataUrl = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result || ""));
        r.onerror = () => rej(new Error("could not read the reference frame"));
        r.readAsDataURL(imageBlob);
      });
      if (dataUrl) {
        opts.image = dataUrl;
        usedImage = true;
      }
    } catch {
      usedImage = false;
    }
  }
  let el = null;
  try {
    el = await puter.ai.txt2vid(opts.prompt, opts);
  } catch (e) {
    if (usedImage && /image|input|param/i.test(e?.message || "")) {
      const { image, ...textOnly } = opts;
      el = await puter.ai.txt2vid(textOnly.prompt, textOnly);
      usedImage = false;
    } else throw e;
  }
  if (signal?.aborted) throw Object.assign(new Error("cancelled"), { kind: "cancelled" });
  const src = el?.src || el?.getAttribute?.("data-source") || el?.toString?.() || "";
  if (!src) throw new Error("Puter returned no video");
  const blob = await srcToBlob(String(src));
  return { blob, usedImage };
}
