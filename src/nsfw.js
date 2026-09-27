/**
 * The NSFW starting frame.
 *
 * An image-to-video model animates the frame it is handed — it does not
 * undress anyone. Asking "undress her" of Wan/LTX/SVD on a picture of a
 * dressed person therefore produces a *dressed* person moving, which is the
 * single biggest reason an NSFW run looks like it "didn't work". The frame
 * itself has to be explicit *before* the renderer sees it.
 *
 * Two free services can make that frame, both outside Hugging Face — which
 * matters, because every free video Space runs on ZeroGPU and ZeroGPU meters
 * the daily allowance per address across all of them, so once it is spent
 * nothing on huggingface.co will render at all. Inpainting is the default,
 * because it is the only one that keeps the photo's own person:
 *
 *   undressImageInpaint() AI Horde (aihorde.net) *inpainting*. This is the one
 *                        that keeps the person in the photo. An on-device
 *                        clothes detector (SegFormer-B0 clothes, 4.2 MB, shipped
 *                        in src/models — see src/segment.js) segments the
 *                        picture into 18 garment classes and builds a
 *                        full-resolution feathered mask over *only* the
 *                        clothing, with the head classes (face, hair, hat)
 *                        multiplied down to zero so they can never be
 *                        repainted; the worker repaints exactly that region
 *                        from the explicit prompt. When the detector is
 *                        unavailable the app falls back to a white box over
 *                        the torso, from the chin (the browser's own
 *                        `FaceDetector`, else blazeface) or from a measured
 *                        default. Verified against a real reference photo:
 *                        face, hairstyle, headband, pose and background came
 *                        back pixel-identical outside the box (mean channel
 *                        difference 5/255 — i.e. JPEG re-encode noise), and
 *                        outside-the-box pixels were *proven* untouched by
 *                        diffing against the downscaled original. The result
 *                        is then composited back onto the full-resolution
 *                        original through a feathered alpha, so only the
 *                        torso is at the worker's (<=576 px) resolution and
 *                        the boundary is a gradient rather than a seam.
 *   undressImage()       AI Horde img2img — the older, cheaper path. It
 *                        repaints the whole picture at denoising_strength 0.8,
 *                        so pose and background usually survive but the face
 *                        drifts and a quarter of jobs come back `censored`.
 *                        Kept as a programmatic fallback; the app no longer
 *                        routes through it.
 *   drawExplicitFrame()  image.pollinations.ai — text-to-image, no key, no
 *                        quota, answers in 5-10 s, and returns explicit content
 *                        for an explicit prompt (verified). It draws a *new*
 *                        subject from the prompt rather than editing the
 *                        reference picture, so it is the fallback, and the
 *                        whole path when there is no reference image at all.
 *
 * Timing, measured anonymously (AI Horde's free queue is shared, so this is
 * congestion-dependent, not a fixed cost): img2img came back in 11-40 s when
 * the pool was quiet; named inpainting jobs sat at queue position ~240 with a
 * ~15 min wait when it was busy. `onStage` therefore reports the live queue
 * position and the run can be cancelled; a registered AI Horde key (kudos)
 * skips almost all of the wait.
 *
 * Both requests are relayed like every other request when strict privacy is
 * on, so neither service learns the visitor's address.
 */

import { SpaceError } from "./gradio.js";
import { relayFetch, relayBlob } from "./relay.js";
import { buildClothesMask, maskBlobAt } from "./segment.js";

export const HORDE_BASE = "https://aihorde.net/api/v2";
export const HORDE_ANON_KEY = "0000000000";
export const HORDE_AGENT = "AIVideoGen:1.0:perchance.org";

/**
 * Anonymous callers (kudos -50) are refused anything above 576x576 or above an
 * equivalent sampler work budget. Sticking under this keeps every request in
 * the lane that actually answers.
 */
export const HORDE_MAX_SIDE = 576;

/** Parallel img2img attempts — workers' own filters block some of them. */
export const HORDE_JOBS = 3;

/** How long to wait for AI Horde before falling back to drawing a frame. */
export const HORDE_WAIT_MS = 150000;

/**
 * How far to let the model move away from the reference picture. Measured:
 * 0.40 keeps the person and the clothes, 0.55-0.70 is a coin flip (sheer top or
 * bare), 0.80+ is reliably nude — every extra step is also likeness lost, and
 * anonymous img2img lands on a random worker with a random checkpoint, so the
 * result is never the same picture with the clothes taken off.
 */
export const HORDE_DENOISE = 0.8;

/**
 * Inpainting regenerates the masked area from scratch, so it runs at full
 * denoising strength — the mask is what protects everything else, not the
 * denoise setting.
 */
export const INPAINT_DENOISE = 1.0;

/** Checkpoints that both support inpainting and tolerate explicit prompts. */
export const INPAINT_MODELS = ["Realistic Vision Inpainting", "Deliberate Inpainting", "DreamShaper Inpainting"];

/** How softly the mask handed to the worker fades out, as a fraction of the
 * box's short side. Measured: hardening this edge (a plain white rectangle)
 * left 135 of edge energy along the mask border against the photo's own 54,
 * where a softened one left 82 — the worker blends its own output into the
 * photo through it. The composite continues that fade afterwards. */
export const INPAINT_MASK_FEATHER = 0.1;

/** Attempts submitted in parallel for an inpaint — workers' filters block some. */
export const INPAINT_JOBS = 2;

/** Inpainting jobs are queued like everything else; give them more room.
 *
 * Measured anonymously (2026-09-17): AI Horde's whole image pool advertises
 * only **5** worker threads that will take an inpainting job — naming the
 * checkpoints is what gets even that many (asking for no particular model
 * drops it to 3, naming a wider list does not raise it). So the queue is
 * genuinely deep at busy times: an anonymous job sat at position 222 with a
 * 857 s estimate and started painting ~8 minutes later. The budget has to
 * cover that, or the run gives up on the one thing it was asked to do. The
 * live queue position *and* AI Horde's own estimate are shown throughout, and
 * the run can be cancelled at any time. */
export const INPAINT_WAIT_MS = 1200000;

/**
 * The identity clause. Every image-model call that is meant to keep the
 * person in the reference picture says this in the POSITIVE prompt, because a
 * diffusion model has no notion of "the same woman" unless it is told — and
 * the failure mode is not subtle: a whole-frame img2img pass at 0.55-0.85
 * happily re-casts the scene entirely (a hotel-room portrait came back as a
 * different woman in a jungle), which is exactly what "the character should
 * not change" is about.
 */
export const IDENTITY_ANCHOR =
  "the exact same woman as the reference picture, identical face, identical hair and body, " +
  "the same room and background, the same lighting and camera framing, unchanged identity";

/**
 * The other half of the identity clause: the things a drift *is*. Measured
 * failure mode this exists for — a rung whose action named a location ("she
 * walks nude through the jungle") dragged the whole picture there through
 * whole-frame img2img, so the clip's last third was a different scene and a
 * different person. Naming the drift as a negative is what pins the picture
 * to the reference's own room. The scene words are deliberately generic: they
 * forbid *inventing* a place, not any particular one.
 */
export const IDENTITY_NEGATIVE =
  "different person, different woman, different face, changed identity, different hair, " +
  "different background, changed background, different room, different location, " +
  "different setting, new scene, changed environment, extra people, second woman, man, " +
  "cartoon, anime, illustration, 3d render, cgi, plastic skin, deformed anatomy, distorted face";

/** Naming clothing was measured to *help* inpainting (less sheer fabric, a
 * weaker boundary): mean edge energy across the mask border fell from 135 to
 * 85 (original photo: 54) and skin coverage inside the mask rose from 0.768
 * to 0.792. Same negative prompt as the good img2img runs, plus the words —
 * and plus `IDENTITY_NEGATIVE`, so a garment repaint cannot move the person
 * into another room. */
export const INPAINT_NEGATIVE =
  "clothing, clothes, shirt, bra, fabric, top, dress, censored bar, mosaic censorship, " +
  // The measured failure this clause exists for: on a deep-V black top, the
  // repaint produced the bare chest and left the un-masked edge of the garment
  // over it as a translucent dark shape. Naming the film is what removes it.
  "sheer fabric, see-through clothing, translucent fabric, semi-transparent garment, " +
  "lace overlay, fabric covering the breasts, cloth over the chest, " +
  "lowres, bad anatomy, bad hands, watermark, text, logo, " +
  IDENTITY_NEGATIVE;

/** Fallback torso box as a fraction of the picture, used when no face is found.
 * Measured against a real portrait (752x1392): this exact box came back with
 * the face untouched and the chest bare. */
export const TORSO_BOX_FALLBACK = { x0: 0.1, y0: 0.6, x1: 0.9, y1: 1 };

/** Appended to the user's text to describe an explicit frame. */
export const NSFW_FRAME_SUFFIX =
  "completely nude, bare breasts, topless, no clothing, explicit adult content, " +
  "uncensored, photorealistic, natural lighting, same person";

/**
 * Turn whatever the user typed into something an image model understands.
 * "undress showing ultra huge nude boobs" is an instruction; models want a
 * description, so the instruction is kept (it still steers the result) and a
 * concrete description is appended.
 *
 * `anchor` (default on) prepends `IDENTITY_ANCHOR`, which is what keeps an
 * edit of a real photo the same person in the same room. Pass
 * `{ anchor: false }` only for a call that is deliberately drawing a brand new
 * subject from text.
 */
export function explicitPrompt(prompt, { anchor = true } = {}) {
  const p = String(prompt || "").trim();
  const base = p ? p.replace(/\.\s*$/, "") : "beautiful woman";
  const lead = anchor ? `${IDENTITY_ANCHOR}, ` : "";
  if (/nude|naked|topless|breasts|boobs/i.test(base)) return `${lead}${base}, ${NSFW_FRAME_SUFFIX}`;
  return `${lead}${base}, undressed, ${NSFW_FRAME_SUFFIX}`;
}

async function blobToBase64(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < buf.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, buf.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * A size an anonymous caller is allowed to ask for: the picture's own aspect
 * ratio, longest side <= 576, both sides multiples of 64.
 */
function hordeDims(size) {
  const [w, h] = size;
  const scale = Math.min(1, HORDE_MAX_SIDE / Math.max(w, h));
  const snap = (v) => Math.max(64, Math.round((v * scale) / 64) * 64);
  return [snap(w), snap(h)];
}

function hordeHeaders(key) {
  return {
    "Content-Type": "application/json",
    "Client-Agent": HORDE_AGENT,
    apikey: (key || "").trim() || HORDE_ANON_KEY,
  };
}

async function hordeFetch(relay, path, init, untrace, timeoutMs = 45000) {
  const url = HORDE_BASE + path;
  if (relay) {
    const r = await relayFetch(relay, url, init, { untrace, timeoutMs });
    if (r.status < 200 || r.status >= 300) {
      throw new SpaceError(`AI Horde answered ${r.status}.`, "error", String(r.text || "").slice(0, 300));
    }
    return JSON.parse(r.text);
  }
  const r = await fetch(url, init);
  const text = await r.text();
  if (!r.ok) throw new SpaceError(`AI Horde answered ${r.status}.`, "error", text.slice(0, 300));
  return JSON.parse(text);
}

/** Pull a finished generation out, whether it is a URL (current) or base64 (older). */
async function generationBlob(gen, relay, untrace, signal) {
  const raw = String(gen?.img || "");
  if (!raw) throw new SpaceError("AI Horde finished without returning a picture.", "empty");
  if (/^https?:/i.test(raw)) {
    if (relay) return relayBlob(relay, raw, { untrace, timeoutMs: 60000, signal });
    const r = await fetch(raw, { signal });
    if (!r.ok) throw new SpaceError(`AI Horde's picture answered ${r.status}.`, "empty");
    const blob = await r.blob();
    if (!blob.size) throw new SpaceError("AI Horde's picture came back empty.", "empty");
    return blob;
  }
  let b64 = raw.trim();
  if (b64.startsWith("data:")) b64 = b64.slice(b64.indexOf(",") + 1);
  b64 = b64.replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4) b64 += "=";
  let bytes;
  try {
    bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  } catch {
    throw new SpaceError("AI Horde returned an unreadable picture.", "empty");
  }
  return new Blob([bytes], { type: gen?.censored ? "image/webp" : "image/png" });
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * The API key Horde said it does not recognise.
 *
 * A key copied with a typo, or carried over from an older account, comes back
 * as a `401 InvalidAPIKey` — *every* submission, so on a storyboard run all
 * four steps fail and the run produces nothing at all. That is a terrible way
 * to learn about a bad key: anonymous access is always allowed (just queued),
 * so the app should never be *blocked* by it. The first refusal therefore
 * switches the whole run to the anonymous key, says so once, and remembers the
 * bad string so the next rung does not waste another submission on it. A run
 * with a key that *works* clears the memory again.
 */
let rejectedKey = "";

/** The key Horde has refused this session (`""` if none). */
export function hordeRejectedKey() {
  return rejectedKey;
}

/** Was this failure Horde refusing the credential rather than the content? */
function isKeyRefusal(err) {
  const s = `${err?.message || ""} ${err?.detail || ""}`;
  return /answered 401\b/.test(s) || /InvalidAPIKey|No user matching sent API Key/i.test(s);
}

/**
 * Submit one job, retrying the anonymous rate limit (two posts a second) and
 * translating AI Horde's kudos complaints into a readable error. A reply that
 * the key is unknown is raised as kind `key`, so `runHorde` can answer it by
 * going anonymous instead of failing the step.
 */
async function submitOne({ body, dims, key, relay, untrace }) {
  const init = { method: "POST", headers: hordeHeaders(key), body: JSON.stringify(body) };
  for (let attempt = 0; ; attempt++) {
    try {
      const job = await hordeFetch(relay, "/generate/async", init, untrace);
      if (!job?.id) throw new SpaceError("AI Horde returned no job id.", "error", JSON.stringify(job).slice(0, 200));
      if (key) rejectedKey = "";
      return job.id;
    } catch (err) {
      const detail = String(err.detail || err.message || "");
      if (err?.kind === "cancelled") throw err;
      if (key && isKeyRefusal(err)) {
        throw new SpaceError(
          "AI Horde did not recognise the API key in Settings → Free GPU boost",
          "key",
          detail,
          "Copy it again from aihorde.net/register (a fresh, correctly-copied key), or clear the field — an anonymous run is always accepted, it just waits in a longer queue."
        );
      }
      if (/kudos/i.test(detail)) {
        throw new SpaceError(
          `AI Horde wants kudos for a ${dims?.[0] || "?"}x${dims?.[1] || "?"} request right now (${detail
            .replace(/^.*?requires /i, "it requires ")
            .slice(0, 90)})`,
          "busy",
          detail
        );
      }
      if (attempt >= 3 || !/429|2 per 1 second|too many/i.test(`${err.message} ${detail}`)) throw err;
      await sleep(1200 + attempt * 900);
    }
  }
}

/**
 * Submit `bodies` (staggered) and poll them until one comes back uncensored.
 * Workers run their own safety filters, so several attempts are in flight at
 * once and the first clean one wins. `onStage` reports the queue position.
 *
 * A key Horde refuses is not a dead end: the run drops to the anonymous key
 * for this and every later rung (the shared address is always served), and
 * says what happened so the key can be fixed.
 */
async function runHorde({ bodies, dims, key, relay, untrace, signal, maxWaitMs, onStage, label }) {
  const ids = [];
  let useKey = key || "";
  if (useKey && useKey === rejectedKey) useKey = "";
  for (let i = 0; i < bodies.length; i++) {
    if (signal?.aborted) throw new SpaceError("cancelled", "cancelled");
    if (i) await sleep(1100);
    try {
      ids.push(await submitOne({ body: bodies[i], dims, key: useKey, relay, untrace }));
    } catch (e) {
      if (e?.kind === "cancelled") throw e;
      if (e?.kind === "key" && useKey) {
        rejectedKey = useKey;
        useKey = "";
        onStage?.({
          stage: "nsfw",
          notice: true,
          message:
            "AI Horde did not recognise your API key — it looks invalid or was copied wrong. " +
            "Continuing anonymously (free, but a longer queue). Re-copy a fresh key from aihorde.net/register " +
            "into Settings → Free GPU boost, or clear the field to stay anonymous.",
        });
        try {
          ids.push(await submitOne({ body: bodies[i], dims, key: "", relay, untrace }));
        } catch (e2) {
          if (e2?.kind === "cancelled") throw e2;
          if (!ids.length) throw e2;
          break;
        }
        continue;
      }
      if (!ids.length) throw e;
      break;
    }
  }
  if (!ids.length) throw new SpaceError("AI Horde accepted nothing.", "error");

  const t0 = Date.now();
  const done = new Set();
  let blocked = 0;
  let lastPos = null;
  let lastWait = null;
  let processing = 0;
  let hinted = false;
  for (;;) {
    if (signal?.aborted) throw new SpaceError("cancelled", "cancelled");
    if (Date.now() - t0 > maxWaitMs) {
      throw new SpaceError(
        `AI Horde was still queueing after ${Math.round(maxWaitMs / 60000)} min` +
          (lastPos != null
            ? ` (position ${lastPos}${lastWait > 90 ? `, its own estimate ${Math.ceil(lastWait / 60)} min` : ""})`
            : "") +
          " — a free registered AI Horde key removes the wait",
        "busy"
      );
    }
    await sleep(5000);
    for (const id of ids) {
      if (done.has(id)) continue;
      let c = null;
      try {
        c = await hordeFetch(relay, `/generate/check/${id}`, { method: "GET", headers: hordeHeaders(key) }, untrace, 30000);
      } catch {
        continue;
      }
      if (c?.faulted) {
        done.add(id);
        blocked++;
        continue;
      }
      if (c?.queue_position != null) lastPos = c.queue_position;
      if (c?.wait_time != null) lastWait = c.wait_time;
      if (c?.processing != null) processing = Math.max(processing, c.processing);
      if (!c?.done) continue;
      done.add(id);
      const st = await hordeFetch(relay, `/generate/status/${id}`, { method: "GET", headers: hordeHeaders(key) }, untrace, 45000);
      const gen = st?.generations?.[0];
      if (gen?.censored || !gen?.img) {
        blocked++;
        continue;
      }
      return await generationBlob(gen, relay, untrace, signal);
    }
    if (done.size >= ids.length) {
      throw new SpaceError(`AI Horde blocked every attempt (${blocked} of them) with its workers' own safety filters`, "censored");
    }
    const left = ids.length - done.size;
    const flights = `${left} attempt${left === 1 ? "" : "s"} in flight`;
    if (processing) {
      onStage({ stage: "nsfw", message: `${label} — AI Horde is repainting it now (${flights})…` });
      continue;
    }
    const eta =
      lastWait > 90 ? ` · about ${Math.ceil(lastWait / 60)} min of queue left` : "";
    // The first readout carries the "why is this slow" line once; repeating it
    // five times a minute would bury the position, which is the useful part.
    const hint = hinted ? "" : " · a free key from aihorde.net/register skips this queue";
    hinted = true;
    onStage({
      stage: "nsfw",
      message: `${label} — AI Horde queue position ${lastPos ?? "?"}${eta} (${flights})${hint}…`,
    });
  }
}

// ---- Where the clothes are ------------------------------------------------

let nativeDetector = null;
let nativeChecked = false;
let modelPromise = null;

/** The browser's own detector: native, instant, and no network at all. */
function getNativeDetector() {
  if (!nativeChecked) {
    nativeChecked = true;
    try {
      if (typeof window !== "undefined" && "FaceDetector" in window) {
        nativeDetector = new window.FaceDetector({ fastMode: true, maxDetectedFaces: 4 });
      }
    } catch {
      nativeDetector = null;
    }
  }
  return nativeDetector;
}

/** blazeface (TensorFlow.js). ~1.5 MB, and its weights come from Google. */
export function loadFaceModel() {
  if (!modelPromise) {
    modelPromise = (async () => {
      const [bzmod, tfmod] = await Promise.all([
        import("https://esm.sh/@tensorflow-models/blazeface@0.0.7"),
        import("https://esm.sh/@tensorflow/tfjs@4.22.0"),
      ]);
      const blazeface = bzmod.default || bzmod;
      const tf = tfmod.default || tfmod;
      await tf?.ready?.();
      return (await blazeface.load()) || null;
    })().catch(() => null);
  }
  return modelPromise;
}

/**
 * Start loading the face detector without blocking anything — the model is
 * ~28 s cold on a mid-range machine, so the app calls this the moment a
 * reference picture is dropped in, and by the time the run starts it is warm.
 *
 * `allowModel: false` (used when strict privacy is on, so that no request
 * would leave for Google) still uses the browser's own detector when present,
 * and otherwise resolves to null.
 */
export function preloadFaceDetector({ allowModel = true } = {}) {
  if (getNativeDetector()) return Promise.resolve({ native: nativeDetector });
  if (!allowModel) return Promise.resolve(null);
  return loadFaceModel().then((model) => (model ? { model } : null));
}

/** The face as fractions of the picture, or null. Never throws, never hangs. */
async function faceBox(image, { timeoutMs = 20000, useModel = true } = {}) {  try {
    const native = getNativeDetector();
    const model = native ? null : useModel ? await Promise.race([loadFaceModel(), sleep(timeoutMs).then(() => null)]) : null;
    if (!native && !model) return null;
    const bmp = await createImageBitmap(image);
    let box = null;
    if (native) {
      const faces = await native.detect(bmp);
      const b = faces?.[0]?.boundingBox;
      if (b) box = [b.x, b.y, b.x + b.width, b.y + b.height];
    } else if (model) {
      const faces = await model.estimateFaces(bmp, false);
      const f = (faces || []).slice().sort((a, b) => (b?.probability ?? 0) - (a?.probability ?? 0))[0];
      if (f && (f.probability ?? 1) > 0.85) {
        box = [Number(f.topLeft?.[0]), Number(f.topLeft?.[1]), Number(f.bottomRight?.[0]), Number(f.bottomRight?.[1])];
      }
    }
    const W = bmp.width;
    const H = bmp.height;
    bmp.close?.();
    if (!box || !W || !H || box.some((v) => !Number.isFinite(v))) return null;
    return { x0: box[0] / W, y0: box[1] / H, x1: box[2] / W, y1: box[3] / H };
  } catch {
    return null;
  }
}

/**
 * The face as fractions of the picture — exported for the expression pass in
 * src/storyboard.js, which re-draws only the face so a rung's expression can
 * change while everything else in the still stays her own pixels.
 */
export async function faceRegionBox(image, opts = {}) {
  return await faceBox(image, opts);
}

/**
 * The area to repaint, as fractions of the picture. The chin is the anchor:
 * everything below it (torso, legs) gets repainted, the face never does. The
 * horizontal span is centred on the face and widened, so shoulders and sides
 * are included even when the head is turned.
 */
export async function torsoMaskBox(image, { timeoutMs = 20000, useModel = true } = {}) {
  const f = await faceBox(image, { timeoutMs, useModel });
  if (f) {
    const faceW = f.x1 - f.x0;
    const cx = (f.x0 + f.x1) / 2;
    const half = clamp(faceW * 1.4, 0.28, 0.42);
    const x0 = clamp(cx - half, 0.02, 0.97);
    const x1 = clamp(cx + half, x0 + 0.12, 0.98);
    return { x0, y0: clamp(f.y1, 0.15, 0.95), x1, y1: 1, source: "face" };
  }
  return { ...TORSO_BOX_FALLBACK, source: "default" };
}

/**
 * The black-and-white PNG the worker expects in `source_mask`, at the size the
 * worker will see.
 *
 * Hand it `{ canvas }` (a mask from `buildClothesMask`) and it renders that —
 * a garment-shaped, already-feathered region. Hand it a box and it draws the
 * white rounded box on black, edges softened, which is what the app falls back
 * to when the on-device detector is unavailable. Soft edges are what stop
 * inpainting from leaving a hard boundary across the chest.
 */
export async function buildMaskBlob(image, [w, h], boxOrMask, { feather = INPAINT_MASK_FEATHER } = {}) {
  if (boxOrMask?.canvas) return await maskBlobAt(boxOrMask.canvas, [w, h]);
  const box = boxOrMask;
  const bmp = await createImageBitmap(image);
  const cv = new OffscreenCanvas(w, h);
  const ctx = cv.getContext("2d");
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, w, h);
  const x = box.x0 * w;
  const y = box.y0 * h;
  const bw = Math.max(8, (box.x1 - box.x0) * w);
  const bh = Math.max(8, (box.y1 - box.y0) * h);
  const r = Math.min(bw, bh) * feather;
  ctx.save();
  ctx.filter = `blur(${r.toFixed(1)}px)`;
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, bw, bh, Math.min(bw, bh) * 0.1);
  else ctx.rect(x, y, bw, bh);
  ctx.fill();
  ctx.restore();
  bmp.close?.();
  return await cv.convertToBlob({ type: "image/png" });
}

/**
 * Paint the worker's (small) inpainted box back into the user's
 * full-resolution original through a feathered alpha. The result keeps the
 * original's face, background and grain at full resolution; only the torso
 * carries the worker's detail level, and the join is a gradient, not a seam.
 *
 * The patch is the box *plus a ring of `feather` width*, and that ring is
 * filled with the worker's own pixels for the same region — not left
 * transparent. That detail is the whole trick: a blurred alpha can only taper
 * where there is content to taper, so an unpadded patch keeps alpha 0.5 right
 * up to its last column and then drops to nothing. Measured on a real portrait
 * (7.4 5 x 1392, box 0.12-0.72 x 0.62-1.0): with the ring, the vertical seam
 * energy at the box edges falls from 31.5/68.4 (left/right, against a
 * background of 3/1) to 4.1/10.8 — i.e. from "a visible line across the chest"
 * to "indistinguishable from the photo's own texture". `feather` is the ring
 * width as a fraction of the box's short side; the blur is 0.4 of that.
 */
export async function compositeInpaint({ original, edited, box, feather = 0.12, mask = null }) {
  // With `mask` (the clothes detector's alpha canvas) the box path is skipped
  // entirely: the mask is already full-resolution and already feathered, so the
  // worker's output is drawn over the whole frame and then cut back to the
  // mask's alpha. No patch, no ring, no rectangle — only the garment is at the
  // worker's resolution, and the join follows the collar and the hem.
  if (mask) {
    const ob = await createImageBitmap(original);
    const eb = await createImageBitmap(edited);
    const W = ob.width;
    const H = ob.height;
    const layer = new OffscreenCanvas(W, H);
    const lctx = layer.getContext("2d");
    lctx.drawImage(eb, 0, 0, W, H);
    lctx.globalCompositeOperation = "destination-in";
    lctx.drawImage(mask, 0, 0, W, H);
    lctx.globalCompositeOperation = "source-over";
    const cv = new OffscreenCanvas(W, H);
    const ctx = cv.getContext("2d");
    ctx.drawImage(ob, 0, 0);
    ctx.drawImage(layer, 0, 0);
    ob.close?.();
    eb.close?.();
    return await cv.convertToBlob({ type: "image/jpeg", quality: 0.95 });
  }
  const ob = await createImageBitmap(original);
  const eb = await createImageBitmap(edited);
  const W = ob.width;
  const H = ob.height;
  const bx = Math.round(box.x0 * W);
  const by = Math.round(box.y0 * H);
  const bw = Math.max(2, Math.round((box.x1 - box.x0) * W));
  const bh = Math.max(2, Math.round((box.y1 - box.y0) * H));
  const pad = Math.max(4, Math.round(Math.min(bw, bh) * feather));

  // The patch's own origin in the original's coordinates, and the part of it
  // that is actually inside the picture (the rest is clipped, which is what we
  // want at the image's own borders — there the alpha should stay at 1).
  const ox = bx - pad;
  const oy = by - pad;
  const sx0 = Math.max(0, ox);
  const sy0 = Math.max(0, oy);
  const sx1 = Math.min(W, bx + bw + pad);
  const sy1 = Math.min(H, by + bh + pad);
  const dw = Math.max(1, sx1 - sx0);
  const dh = Math.max(1, sy1 - sy0);

  const patch = new OffscreenCanvas(bw + pad * 2, bh + pad * 2);
  const p = patch.getContext("2d");
  p.drawImage(
    eb,
    (sx0 / W) * eb.width,
    (sy0 / H) * eb.height,
    (dw / W) * eb.width,
    (dh / H) * eb.height,
    sx0 - ox,
    sy0 - oy,
    dw,
    dh
  );
  p.globalCompositeOperation = "destination-in";
  p.save();
  p.filter = `blur(${(pad / 2.5).toFixed(1)}px)`;
  p.fillStyle = "#fff";
  p.beginPath();
  if (p.roundRect) p.roundRect(pad, pad, bw, bh, Math.min(bw, bh) * 0.1);
  else p.rect(pad, pad, bw, bh);
  p.fill();
  p.restore();

  const cv = new OffscreenCanvas(W, H);
  const ctx = cv.getContext("2d");
  ctx.drawImage(ob, 0, 0);
  ctx.drawImage(patch, ox, oy);
  ob.close?.();
  eb.close?.();
  return await cv.convertToBlob({ type: "image/jpeg", quality: 0.95 });
}

/**
 * Repaint the user's *own* picture with AI Horde inpainting, keeping the person.
 * Returns `{ blob, box, dims }` — `blob` is already composited back onto the
 * full-resolution original when that is possible.
 */
export async function undressImageInpaint({
  image,
  prompt,
  seed = 0,
  key = "",
  relay = null,
  untrace = true,
  signal = null,
  onStage = () => {},
  maxWaitMs = INPAINT_WAIT_MS,
  jobs = INPAINT_JOBS,
  box = null,
  useFaceModel = true,
  composite = true,
  want = "all",
  useSegmentation = true,
  negative = "",
}) {
  if (!image) throw new SpaceError("no reference image to repaint", "input");

  const bmp = await createImageBitmap(image);
  const dims = hordeDims([bmp.width, bmp.height]);
  bmp.close?.();
  const [w, h] = dims;

  // The mask decides the quality of everything downstream, so it is found by
  // the on-device clothes detector first (see src/segment.js) and only falls
  // back to the face-detector box if that produces something implausible.
  let clothes = null;
  if (useSegmentation) {
    onStage({
      stage: "nsfw",
      message: "Finding the clothes on this device (the picture never leaves your machine for this step)…",
    });
    try {
      const m = await buildClothesMask(image, { want });
      if (m.coverage >= 0.02 && m.coverage <= 0.7) clothes = m;
    } catch {
      clothes = null;
    }
  }
  const maskBox = clothes?.box || box || (await torsoMaskBox(image, { useModel: useFaceModel }));
  onStage({
    stage: "nsfw",
    message: clothes
      ? `Repainting only the clothes it found — ${Math.round((clothes.found ?? clothes.coverage) * 100)}% of the picture, ` +
        `grown by ${clothes.grow || 0}px to ${Math.round(clothes.coverage * 100)}% so a garment edge the detector missed ` +
        `cannot be left behind as a film of the original fabric — building a ${w}x${h} mask…`
      : "Working out what to repaint (face found by the browser, chin down)" + ` — building a ${w}x${h} mask…`,
  });
  const mask = await buildMaskBlob(image, dims, clothes || maskBox);

  onStage({ stage: "nsfw", message: `Sending your picture to AI Horde to be repainted (${w}x${h})…` });
  const source = await blobToBase64(image);
  const sourceMask = await blobToBase64(mask);

  const promptText = explicitPrompt(prompt);
  const bodies = [];
  for (let i = 0; i < Math.max(1, jobs); i++) {
    bodies.push({
      prompt: promptText,
      params: {
        width: w,
        height: h,
        steps: 26,
        n: 1,
        cfg_scale: 6.5,
        sampler_name: "k_euler_a",
        denoising_strength: INPAINT_DENOISE,
        negative_prompt: negative || INPAINT_NEGATIVE,
        seed: String((seed + i * 977) % 2147483647),
      },
      nsfw: true,
      censor_nsfw: false,
      trusted_workers: false,
      slow_workers: true,
      source_image: source,
      source_processing: "inpainting",
      source_mask: sourceMask,
      models: INPAINT_MODELS,
    });
  }

  const blob = await runHorde({
    bodies,
    dims,
    key,
    relay,
    untrace,
    signal,
    maxWaitMs,
    onStage,
    label: "Repainting your picture (keeping your person)",
  });

  const via = clothes ? "clothes" : "box";
  const coverage = clothes?.coverage ?? null;
  const found = clothes?.found ?? null;
  const grow = clothes?.grow ?? 0;
  if (!composite) return { blob, box: maskBox, dims, full: false, via, coverage, found, grow };
  try {
    const full = await compositeInpaint({
      original: image,
      edited: blob,
      box: maskBox,
      mask: clothes?.canvas || null,
    });
    return { blob: full, box: maskBox, dims, full: true, via, coverage, found, grow };
  } catch {
    return { blob, box: maskBox, dims, full: false, via, coverage, found, grow };
  }
}

/**
 * Move one picture a step with AI Horde img2img. Free and uncensored, but it
 * repaints the whole frame, so likeness drifts — which is why the storyboard
 * only uses it for the rungs where nothing is coming off and merely the pose
 * and the face have to change (see src/storyboard.js). Queued: `onStage` is
 * called with the queue position while it waits, and the whole thing is
 * abandoned after `maxWaitMs`.
 *
 * `denoise` is the whole dial: 0.4 keeps the picture and nudges it, 0.8 is
 * reliably nude (measured — see HORDE_DENOISE) and loses the likeness.
 */
export async function evolveFrame({
  image,
  prompt,
  size = null,
  seed = 0,
  key = "",
  relay = null,
  untrace = true,
  signal = null,
  onStage = () => {},
  maxWaitMs = HORDE_WAIT_MS,
  jobs = HORDE_JOBS,
  denoise = HORDE_DENOISE,
  steps = 22,
  cfg = 6,
  negative = null,
  anchor = true,
  label = "Moving the frame on",
}) {
  if (!image) throw new SpaceError("no reference image to move on from", "input");

  let dims = size;
  try {
    const bmp = await createImageBitmap(image);
    dims = hordeDims([bmp.width, bmp.height]);
    bmp.close?.();
  } catch {
    dims = hordeDims(dims || [512, 512]);
  }
  const [w, h] = dims;

  onStage({ stage: "nsfw", message: `${label} — uploading it to AI Horde (${w}x${h})…` });
  const source = await blobToBase64(image);
  // Deliberately does not name clothing by default: "no bra, no shirt" as a
  // negative made the workers render a sheer top instead of removing it
  // (measured). Unlike inpainting, this repaints the whole frame, so the
  // negative prompt is the only thing standing between the result and a sheer
  // top — a caller that is *removing* clothing passes its own.
  const negPrompt =
    negative ||
    "censored bar, mosaic censorship, lowres, bad anatomy, bad hands, watermark, text, logo, " +
      IDENTITY_NEGATIVE;

  const bodies = [];
  for (let i = 0; i < Math.max(1, jobs); i++) {
    bodies.push({
      prompt: explicitPrompt(prompt, { anchor }),
      params: {
        width: w,
        height: h,
        steps,
        n: 1,
        cfg_scale: cfg,
        sampler_name: "k_euler_a",
        denoising_strength: denoise,
        negative_prompt: negPrompt,
        seed: String((seed + i * 977) % 2147483647),
      },
      nsfw: true,
      censor_nsfw: false,
      trusted_workers: false,
      slow_workers: true,
      source_image: source,
      source_processing: "img2img",
    });
  }

  return await runHorde({
    bodies,
    dims,
    key,
    relay,
    untrace,
    signal,
    maxWaitMs,
    onStage,
    label,
  });
}

/** The old whole-frame undress: `evolveFrame` at the measured nudity strength. */
export function undressImage(opts) {
  return evolveFrame({ label: "Undressing the reference image", ...opts });
}

/**
 * Change only the expression, and only in the face.
 *
 * The clothing inpainting protects the head on purpose (face/hair classes are
 * masked out) — which is what keeps her *her* from rung to rung, and also means
 * a storyboard's `expression` field would never reach the picture. Repainting
 * the face with the inpainting path would fix that by inventing a face, i.e. a
 * different person, so this does it the other way round: crop the face out with
 * a generous margin, send *the crop* through img2img at a moderate strength
 * (so the features stay but the mouth and eyes move), and paste the result back
 * through a feathered ellipse. Only the face pixels change, the rest of the
 * frame is the previous rung's own pixels, and the subject stays the same.
 *
 * Returns the new picture, or null when no face can be found (in which case the
 * caller keeps the picture it has — this is a refinement, never a hard step).
 */
export async function changeExpression({
  image,
  expression,
  prompt = "",
  seed = 0,
  key = "",
  relay = null,
  untrace = true,
  signal = null,
  onStage = () => {},
  maxWaitMs = HORDE_WAIT_MS,
  jobs = HORDE_JOBS,
  denoise = 0.45,
  margin = 0.6,
  useModel = true,
  label = "Changing her expression",
}) {
  if (!image) return null;
  const f = await faceBox(image, { useModel });
  if (!f) return null;
  try {
    onStage({ stage: "nsfw", message: `${label} — finding her face (on this device)…` });
    const bmp = await createImageBitmap(image);
    const W = bmp.width;
    const H = bmp.height;
    const fw = f.x1 - f.x0;
    const fh = f.y1 - f.y0;
    // Generous crop: the whole head plus a little of the neck and shoulders,
    // so the worker sees a face in context rather than a floating mask. Square,
    // because a face swap on a squashed crop comes back squashed.
    const cx = (f.x0 + f.x1) / 2;
    const cy = (f.y0 + f.y1) / 2;
    const half = Math.max(fw, fh) * (0.5 + margin);
    const box = {
      x0: clamp(cx - half, 0, 1),
      y0: clamp(cy - half, 0, 1),
      x1: clamp(cx + half, 0, 1),
      y1: clamp(cy + half, 0, 1),
    };
    const cw = Math.max(64, Math.round((box.x1 - box.x0) * W));
    const ch = Math.max(64, Math.round((box.y1 - box.y0) * H));
    const crop = new OffscreenCanvas(cw, ch);
    const cctx = crop.getContext("2d");
    cctx.drawImage(bmp, box.x0 * W, box.y0 * H, (box.x1 - box.x0) * W, (box.y1 - box.y0) * H, 0, 0, cw, ch);
    const cropBlob = await crop.convertToBlob({ type: "image/png" });
    bmp.close?.();

    const text = [
      "close-up portrait of the same woman, same person, same face, same hair, same lighting",
      expression || "",
      "only her facial expression changes, natural skin, sharp focus, coherent face",
    ]
      .filter(Boolean)
      .join(", ");

    onStage({ stage: "nsfw", message: `${label} — repainting her face…` });
    const source = await blobToBase64(cropBlob);
    const bodies = [];
    for (let i = 0; i < Math.max(1, jobs); i++) {
      bodies.push({
        // Deliberately NOT run through `explicitPrompt`: that appends "bare
        // breasts, completely nude" to the prompt, which on a face crop would
        // ask the worker to put a body in her face. The expression is the only
        // thing this pass is allowed to change.
        prompt: text,
        params: {
          width: cw,
          height: ch,
          steps: 22,
          n: 1,
          cfg_scale: 6,
          sampler_name: "k_euler_a",
          denoising_strength: denoise,
          negative_prompt: "different person, different face, lowres, bad anatomy, bad hands, watermark, text, logo",
          seed: String((seed + i * 977) % 2147483647),
        },
        nsfw: true,
        censor_nsfw: false,
        trusted_workers: false,
        slow_workers: true,
        source_image: source,
        source_processing: "img2img",
      });
    }
    const edited = await runHorde({
      bodies,
      dims: [cw, ch],
      key,
      relay,
      untrace,
      signal,
      maxWaitMs,
      onStage,
      label,
    });
    if (!edited) return null;

    // Paste it back through a feathered ellipse: solid over the face, gone
    // before the crop's own edge, so there is no visible seam.
    const base = await createImageBitmap(image);
    const faceBmp = await createImageBitmap(edited);
    const out = new OffscreenCanvas(W, H);
    const octx = out.getContext("2d");
    octx.drawImage(base, 0, 0, W, H);
    base.close?.();
    const x = box.x0 * W;
    const y = box.y0 * H;
    const bw = (box.x1 - box.x0) * W;
    const bh = (box.y1 - box.y0) * H;

    const maskCv = new OffscreenCanvas(W, H);
    const mctx = maskCv.getContext("2d");
    const cxm = x + bw / 2;
    const cym = y + bh / 2;
    const rxm = bw / 2;
    const rym = bh / 2;
    const grad = mctx.createRadialGradient(cxm, cym, Math.min(rxm, rym) * 0.55, cxm, cym, Math.max(rxm, rym));
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.75, "rgba(255,255,255,0.9)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    mctx.fillStyle = grad;
    mctx.beginPath();
    mctx.ellipse(cxm, cym, rxm, rym, 0, 0, Math.PI * 2);
    mctx.fill();
    // Keep the composite to the face ellipse: `destination-in` on the edited
    // crop, drawn at the crop's place in the frame.
    const faceCv = new OffscreenCanvas(W, H);
    const fctx2 = faceCv.getContext("2d");
    fctx2.drawImage(faceBmp, x, y, bw, bh);
    faceBmp.close?.();
    fctx2.globalCompositeOperation = "destination-in";
    fctx2.drawImage(maskCv, 0, 0);
    fctx2.globalCompositeOperation = "source-over";
    octx.drawImage(faceCv, 0, 0);
    const blob = await out.convertToBlob({ type: "image/jpeg", quality: 0.95 });
    return blob.size > 2048 ? blob : null;
  } catch (e) {
    if (e?.kind === "cancelled") throw e;
    return null;
  }
}

/**
 * Pollinations burns a "pollinations.ai" mark into the bottom-right corner of
 * every anonymous picture — `nologo=true` no longer suppresses it (verified).
 * The renderer only cares about the subject, so the bottom band is trimmed
 * before the frame is used, keeping the original aspect ratio (the width is
 * trimmed to match, so the person is not stretched).
 */
export async function stripWatermark(blob, { frac = 0.09 } = {}) {
  try {
    const bmp = await createImageBitmap(blob);
    const height = Math.round(bmp.height * (1 - frac));
    let width = Math.round(height * (bmp.width / bmp.height));
    if (width > bmp.width) width = bmp.width;
    const cv = new OffscreenCanvas(width, height);
    const ctx = cv.getContext("2d");
    ctx.drawImage(bmp, Math.round((bmp.width - width) / 2), 0, width, height, 0, 0, width, height);
    bmp.close?.();
    const out = await cv.convertToBlob({ type: "image/jpeg", quality: 0.95 });
    return out.size > 1024 ? out : blob;
  } catch {
    return blob;
  }
}

/** The plugin only offers these four. */
function pluginResolution(size) {
  const [w, h] = size;
  const r = w / h;
  if (r >= 1.2) return "768x512";
  if (r <= 0.83) return "512x768";
  return "768x768";
}

/**
 * Perchance's own text-to-image plugin (root.generateImage). It runs on
 * Perchance's quota rather than on Hugging Face's, so it keeps working when
 * everything else has been spent, and nothing it returns carries a watermark.
 * Its pictures are more stylised than Pollinations' though, so it is the second
 * choice rather than the first.
 */
async function perchanceDraw({ prompt, size, seed, anchor = true }) {
  const gi = typeof root !== "undefined" ? root.generateImage : null;
  if (typeof gi !== "function") throw new SpaceError("Perchance's image generator is not available.", "empty");
  const res = await gi({
    prompt: explicitPrompt(prompt, { anchor }),
    negativePrompt:
      "censored bar, mosaic censorship, lowres, bad anatomy, bad hands, watermark, text, logo, " +
      IDENTITY_NEGATIVE,
    resolution: pluginResolution(size),
    seed: seed % 2147483647,
  });
  const dataUrl = typeof res === "string" ? res : res?.dataUrl;
  if (!dataUrl) throw new SpaceError("Perchance's image generator returned nothing.", "empty");
  const blob = await (await fetch(dataUrl)).blob();
  if (!blob.size) throw new SpaceError("Perchance's image generator returned an empty picture.", "empty");
  return blob;
}

/**
 * Draw a brand-new explicit frame. Free, no key, no quota, ~5-10 s.
 * Pollinations answers first (photoreal); Perchance's own image generator is
 * tried if it refuses, so a run still gets a frame when Pollinations throttles.
 */
export async function drawExplicitFrame({
  prompt,
  size,
  seed = 0,
  relay = null,
  untrace = true,
  signal = null,
  anchor = true,
  negative = "",
}) {
  const [w, h] = size;
  const negText = String(negative || "").trim();
  // Pollinations' image endpoint documents no negative-prompt field, so the
  // avoidance is folded into the prompt itself — where the model reads it —
  // and the parameter is still sent for forward compatibility.
  const q = explicitPrompt(prompt, { anchor }) + (negText ? ` (avoiding: ${negText})` : "");
  const neg = negText ? `&negative=${encodeURIComponent(negText)}` : "";
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (signal?.aborted) throw new SpaceError("cancelled", "cancelled");
    const url =
      `https://image.pollinations.ai/prompt/${encodeURIComponent(q)}` +
      `?width=${w}&height=${h}&seed=${seed + attempt * 13}&nologo=true&model=flux&safe=false${neg}`;
    try {
      let blob;
      if (relay) blob = await relayBlob(relay, url, { untrace, timeoutMs: 120000, signal });
      else {
        const r = await fetch(url, { signal });
        if (!r.ok) throw new SpaceError(`Pollinations answered ${r.status}.`, "error");
        blob = await r.blob();
      }
      if (blob?.size > 4096) return await stripWatermark(blob);
      lastErr = new SpaceError("the image service answered with an empty picture", "empty");
    } catch (e) {
      if (e?.kind === "cancelled") throw e;
      lastErr = e;
    }
    if (attempt < 2) await sleep(2500 + attempt * 3500);
  }
  try {
    return await perchanceDraw({ prompt, size, seed, anchor });
  } catch (e) {
    if (e?.kind === "cancelled") throw e;
    throw new SpaceError(`Could not draw an explicit frame — ${lastErr?.message || "the image services did not answer"}.`, lastErr?.kind || "empty");
  }
}

/**
 * Produce the frame the video renderer should start from.
 *
 *   mode "auto"     there is a reference picture → repaint it with AI Horde
 *                   inpainting, so the person in the clip is the photo's own.
 *                   If AI Horde cannot, the run stops with the reason. Nothing
 *                   to repaint (no reference picture) → draw one.
 *   mode "undress"  kept for old saved settings — the same as "auto" now.
 *   mode "draw"     always draw a brand new explicit person (Pollinations,
 *                   ~5-10 s — the opt-in for "I don't care whose body it is").
 *   mode "image"    keep the reference picture untouched.
 *
 * Repainting is AI Horde *inpainting* (undressImageInpaint): the box handed
 * over by the user (chin-down by default) is regenerated and composited back
 * onto the full-resolution original, so the face, hair, background and grain
 * are the photo's own. That is the difference between "undress my picture" and
 * "draw a naked stranger". Older img2img runs (undressImage) could not promise
 * either — anonymous img2img lands on a random worker with a random
 * checkpoint, and the same request came back clothed twice, sheer once, and
 * nude-but-a-stranger other times — which is why inpainting replaced it.
 *
 * Returns `{ blob, by, note }`, or `null` when the reference should be kept.
 */
export async function prepareExplicitFrame({
  image,
  prompt,
  size,
  seed,
  mode = "auto",
  key = "",
  relayFor,
  signal,
  onStage,
  strictPrivacy = false,
  box = null,
  want = "all",
  useSegmentation = true,
  negative = "",
}) {
  const m = mode || "auto";
  if (m === "image" || m === "given") return null;
  const userNeg = String(negative || "").trim();
  const inpaintNeg = [userNeg, INPAINT_NEGATIVE].filter(Boolean).join(", ");
  const wantRepaint = !!image && (m === "auto" || m === "undress");
  if (wantRepaint) {
    try {
      const { blob, box: usedBox, full, via, coverage, found, grow } = await undressImageInpaint({
        image,
        prompt,
        seed,
        key,
        relay: relayFor?.("post"),
        untrace: true,
        signal,
        onStage,
        // Under strict privacy the face-model weights would be fetched
        // straight from Google, so the measured default box is used instead.
        useFaceModel: !strictPrivacy,
        // The clothes detector is fully local (the model ships in src/), so it
        // stays on even under strict privacy — nothing about it leaves the
        // device except the one-time transformers.js runtime from esm.sh.
        useSegmentation,
        want,
        box,
        negative: inpaintNeg,
      });
      const where =
        via === "clothes"
          ? `only the clothing it found on this device, ${Math.round((coverage || 0) * 100)}% of the frame repainted` +
            (grow ? ` (${Math.round((found || 0) * 100)}% detected, grown to catch the garment's edge)` : "")
          : usedBox?.source === "face"
          ? "face found by the browser, chin down"
          : "the torso box";
      return {
        blob,
        by: "AI Horde",
        note:
          `repainted your own picture (${where})` +
          (full ? ", kept the original at full resolution around it" : ""),
        via,
        coverage,
        box: usedBox,
      };
    } catch (e) {
      if (e?.kind === "cancelled") throw e;
      // Both modes that are asked to keep the photo's own person refuse to
      // quietly deliver someone else's. "Draw" is the explicit opt-in for that.
      throw Object.assign(
        new SpaceError(
          `${e.message} — the run stopped rather than animating a different person. ` +
            `To skip AI Horde's queue, paste a free key from aihorde.net/register into Advanced; ` +
            `to get a clip right now anyway, set “NSFW starting frame” to “Draw a brand-new explicit person”.`,
          "busy",
          e.detail
        ),
        { fatal: true }
      );
    }
  }
  const blob = await drawExplicitFrame({ prompt, size, seed, relay: relayFor?.("get"), signal, negative: userNeg });
  return {
    blob,
    by: "Pollinations",
    note: "drew a new explicit frame (no reference picture to repaint)",
  };
}
