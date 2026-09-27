import { generateImages } from "./img-engine.js";
import { faceBlend, faceScore } from "./facelock.js";
import { imageChange } from "./image.js";
import { eyeMetrics, detailPass, buildFaceProtectMask, surfacePass } from "./detail.js";

export const INTENTS = {
  keep: { strength: 0.42, label: "keep" },
  evolve: { strength: 0.55, label: "evolve" },
  relocate: { strength: 0.72, label: "relocate" },
};

const ANGLE_TURNS = new Set(["profile", "left34", "right34", "overshoulder"]);

export function protectOf(preset) {
  if (preset?.env === "new") return "hard";
  if (ANGLE_TURNS.has(preset?.id)) return "free";
  if (preset?.hair || preset?.lock >= 0.8) return "free";
  return "hard";
}

const EYE_TOKENS = "sharp detailed symmetrical eyes, matching gaze direction, crisp eyelashes, clear catchlights";
const EYE_NEG = "crossed eyes, uneven eyes, missing eye, blurry face";

export function intentOf(preset) {
  if (preset?.env === "new") return "relocate";
  if (preset?.env === "same") {
    const s = preset?.strength ?? 0.6;
    return s < 0.5 ? "keep" : "evolve";
  }
  const s = preset?.strength ?? 0.6;
  if (s < 0.5) return "keep";
  if (s > 0.66) return "relocate";
  return "evolve";
}

const IDENTITY_ANCHOR = "same woman, same face, same facial structure, same eyes, same eyebrows, same lips, same hairstyle";
const IDENTITY_ANCHOR_HAIR = "same woman, same face, same facial structure, same eyes, same eyebrows, same lips";
const PHOTO_LOCK = "photorealistic photograph, mature adult woman, natural skin texture with pores";
const DRIFT_NEG = "anime, cartoon, illustration, painting, cgi, 3d render, plastic skin, young teen, deformed face, asymmetric eyes, crossed eyes, uneven eyes, blurry face, identity shift, cloned face, warped body";

export function compileEditPrompt(basePrompt, preset) {
  const intent = intentOf(preset);
  const newHair = !!preset?.hair && preset?.env !== "new";
  const place = preset?.env === "new"
    ? "new location, different background from the reference photo"
    : "same room and lighting as the reference photo";
  const prompt = [String(basePrompt || "").trim(), PHOTO_LOCK, newHair ? IDENTITY_ANCHOR_HAIR : IDENTITY_ANCHOR, preset?.prompt || "", place, EYE_TOKENS]
    .filter(Boolean).join(", ");
  const negative = [String(preset?.negative || "").trim(), DRIFT_NEG].filter(Boolean).join(", ");
  const sceneLock = intent === "relocate" ? "free" : newHair ? "new-hair" : "same";
  return { prompt, negative, intent, sceneLock };
}

function sdxlChain(nsfw) {
  return nsfw ? ["explicit-sdxl", "horde-xl", "qwen-21"] : ["horde-xl", "qwen-21"];
}

export async function sdxlEdit({
  refBlob, basePrompt = "", preset,
  aspect = "original", sizeId = "S", model = "auto", nsfw = false,
  seed = null, key = "", signal = null, onStage = null, eyeBoost = false,
}) {
  const compiled = compileEditPrompt(basePrompt, preset);
  const prompt = eyeBoost ? `${compiled.prompt}, ${EYE_TOKENS}` : compiled.prompt;
  const negative = eyeBoost ? `${compiled.negative}, ${EYE_NEG}` : compiled.negative;
  const { intent, sceneLock } = compiled;
  const protect = protectOf(preset);
  const base = seed != null && Number.isFinite(Number(seed)) ? Math.floor(Number(seed)) : Math.floor(Math.random() * 2 ** 31);
  const want = INTENTS[intent] || INTENTS.evolve;
  const routes = model && model !== "auto" ? [model] : sdxlChain(nsfw);
  const tried = [];
  let best = null;
  const finish = async (cand, intent, triedNotes) => {
    const r = await lockCandidate(refBlob, cand, preset, intent, triedNotes);
    const isDevice = /device|remix|offline/i.test(cand.route || "") || /device|remix|offline/i.test(cand.gen?.by || "");
    if (!eyeBoost && !isDevice && r.eyes && r.eyes.sharp < 8) {
      try {
        onStage?.("eyes", 0, `soft eyes (${r.eyes.sharp}) — one sharp retry`);
        const retry = await sdxlEdit({
          refBlob, basePrompt, preset, aspect, sizeId, model, nsfw,
          seed: (Number(seed) || 0) + 501, key, signal, onStage, eyeBoost: true,
        });
        retry.tried = [...(triedNotes || []), ...(retry.tried || []), `eye retry: ${retry.eyes ? `sharp ${retry.eyes.sharp}` : "?"}`];
        return retry;
      } catch { return r; }
    }
    return r;
  };
  let maskBlob = null;
  if (protect === "hard") {
    try {
      onStage?.("mask", 0, "protecting face");
      maskBlob = await buildFaceProtectMask(refBlob);
    } catch { maskBlob = null; }
  }
  for (const route of routes) {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (signal?.aborted) throw Object.assign(new Error("cancelled"), { kind: "cancelled" });
      const baseStrength = preset?.strength ?? (protect === "hard" ? Math.min(0.68, want.strength + 0.08) : want.strength);
      const strength = eyeBoost
        ? Math.max(0.3, baseStrength - 0.05)
        : attempt === 0 ? baseStrength
        : intent === "relocate" ? Math.min(0.85, baseStrength + 0.06) : baseStrength;
      const s = (base + routes.indexOf(route) * 104729 + attempt * 7919) % 2 ** 31;
      try {
        onStage?.(route, attempt, `strength ${strength.toFixed(2)}`);
        const out = await generateImages({
          prompt, negative, mode: "edit", inputBlob: refBlob,
          aspect, sizeId, model: route, count: 1, strength,
          lora: "none", control: "none", seed: s, nsfw, key, signal, sceneLock,
          maskBlob: route === "qwen-21" ? null : maskBlob,
        });
        const gen = out.items[0];
        const [fs, ch] = await Promise.all([
          faceScore(refBlob, gen.blob).catch(() => null),
          imageChange(refBlob, gen.blob).catch(() => null),
        ]);
        const score = fs?.score ?? 0;
        const changed = ch?.changed ?? 1;
        tried.push(`${route}@${strength.toFixed(2)}${maskBlob && route !== "qwen-21" ? "+inpaint" : ""}: face ${score}%`);
        const cand = { gen, score, changed, strength, route, seed: s };
        if (!best || score > best.score) best = cand;
        const faceOk = score >= 55;
        const changeOk = intent !== "relocate" || changed >= 0.02;
        if (faceOk && changeOk) return await finish(cand, intent, null);
      } catch (e) {
        if (e?.kind === "cancelled") throw e;
        tried.push(`${route}@${attempt}: ${e?.message || e}`);
      }
    }
  }
  if (!best) throw new Error(tried[0] || "no SDXL route delivered");
  return await finish(best, intent, tried);
}

export async function lockCandidate(refBlob, cand, preset, intent, tried = null) {
  const locked = await faceBlend(refBlob, cand.gen.blob, {
    strength: preset?.lock ?? (intent === "relocate" ? 0.9 : 0.88), feather: 15,
  });
  const blob = locked.applied && locked.blob ? locked.blob : cand.gen.blob;
  const after = locked.applied ? (await faceScore(refBlob, blob).catch(() => null)) : null;
  const score = after?.score ?? locked.score ?? cand.score;
  let finalBlob = blob, detailed = false, surfaced = false;
  try {
    const det = await detailPass(blob);
    if (det.applied && det.blob) { finalBlob = det.blob; detailed = true; }
  } catch {}
  try {
    const sur = await surfacePass(finalBlob);
    if (sur.applied && sur.blob) { finalBlob = sur.blob; surfaced = true; }
  } catch {}
  const eyes = await eyeMetrics(finalBlob).catch(() => null);
  return {
    blob: finalBlob, url: URL.createObjectURL(finalBlob),
    seed: cand.seed, w: cand.gen.w, h: cand.gen.h, model: cand.gen.model,
    intent, strength: cand.strength, route: cand.route,
    faceScore: score,
    faceLocked: !!locked.applied,
    detailed, eyes, surfaced,
    changed: cand.changed,
    by: `${cand.gen.by || cand.gen.model || "sdxl"} · ${intent} ${cand.strength.toFixed(2)} · face ${score}%${eyes ? ` · eyes ${eyes.sharp}` : ""}${detailed ? " · detailed" : ""}${surfaced ? " · surfaced" : ""}`,
    ...(tried ? { tried } : {}),
  };
}
