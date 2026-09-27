import { generateImages } from "./img-engine.js";
import { faceBlend, landmarksOf } from "./facelock.js";
import { aiEdit } from "./sdxl-ai.js";

const FAST_MODELS = new Set(["auto", "sdxl-fast", "sdxl-fast-nsfw", "horde-xl", "explicit-sdxl", "qwen-21"]);
const ACCURATE_MODELS = new Set(["sdxl-accurate", "sdxl-accurate-nsfw"]);

export const POSE_PRESETS = [
  { id: "left34", label: "¾ left", env: "same", prompt: "head turned to her left, three-quarter view of her face, same woman, same face, same hairstyle, same room and lighting", strength: 0.6 },
  { id: "right34", label: "¾ right", env: "same", prompt: "head turned to her right, three-quarter view of her face, same woman, same face, same hairstyle, same room and lighting", strength: 0.6 },
  { id: "profile", label: "Profile", env: "same", prompt: "side profile view, facing left, elegant profile, same woman, same hairstyle, same room and lighting", strength: 0.65 },
  { id: "smile", label: "Smile", env: "same", prompt: "genuine soft smile, lips parted with teeth slightly visible, warm eyes, same woman, same face, same room", strength: 0.5 },
  { id: "laugh", label: "Laugh", env: "same", prompt: "joyful candid laugh, eyes crinkling, natural expression, same woman, same room", strength: 0.55 },
  { id: "lookup", label: "Look up", env: "same", prompt: "chin lifted, gazing upward, hopeful expression, same woman, same face, same room", strength: 0.55 },
  { id: "lean", label: "Lean in", env: "same", prompt: "leaning slightly forward toward the camera, shoulders relaxed, same woman, same face, same room and lighting", strength: 0.6 },
  { id: "overshoulder", label: "Over-shoulder", env: "same", prompt: "looking back over her shoulder at the camera, hair over one shoulder, same woman, same face, same room", strength: 0.62 },
  { id: "seated", label: "Seated", env: "same", prompt: "seated pose, upper body portrait, relaxed posture, same woman, same face, same room and lighting", strength: 0.62 },
  { id: "handshair", label: "Hands in hair", env: "same", prompt: "hands raised running through her hair, elbows out, natural pose, same woman, same face, same room", strength: 0.62 },
  { id: "cafe", label: "Café", env: "new", prompt: "same woman, same face, same hairstyle, sitting in a bright modern cafe, daylight through windows, upper body portrait", strength: 0.72 },
  { id: "street", label: "Street", env: "new", prompt: "same woman, same face, same hairstyle, standing on a city street in soft daylight, blurred storefronts behind her, upper body portrait", strength: 0.72 },
  { id: "park", label: "Park", env: "new", prompt: "same woman, same face, same hairstyle, standing in a green park, trees softly blurred behind her, natural daylight portrait", strength: 0.72 },
  { id: "balcony", label: "Sunset balcony", env: "new", prompt: "same woman, same face, same hairstyle, on a balcony at golden sunset, warm light on her face, city softly blurred behind", strength: 0.75 },
  { id: "lamplight", label: "Evening room", env: "new", prompt: "same woman, same face, same hairstyle, in a different cozy room at evening, warm lamp light, upper body portrait", strength: 0.72 },
  { id: "highangle", label: "From above", env: "same", prompt: "camera slightly above eye level, she looks up into the lens, same woman, same face, same room", strength: 0.6 },
  { id: "sidebody", label: "Side body", env: "same", prompt: "body turned sideways, face turned toward the camera, same woman, same face, same room and lighting", strength: 0.62 },
  { id: "ponytail", label: "Ponytail", env: "same", hair: true, lock: 0.62, prompt: "new hairstyle, hair tied in a high ponytail, face fully visible, same woman, same face, same room", strength: 0.7 },
  { id: "bun", label: "Bun", env: "same", hair: true, lock: 0.62, prompt: "new hairstyle, hair styled in an elegant bun, same woman, same face, same room", strength: 0.7 },
  { id: "sleek", label: "Sleek hair", env: "same", hair: true, lock: 0.62, prompt: "new hairstyle, sleek straight hair with a side part, same woman, same face, same room", strength: 0.68 },
  { id: "reddress", label: "Red dress", env: "same", lock: 0.8, prompt: "wearing an elegant red evening dress with a flattering neckline instead of the black top, same woman, same face, same room", strength: 0.72 },
  { id: "whiteblouse", label: "White blouse", env: "same", lock: 0.8, prompt: "wearing a crisp white blouse instead of the black top, same woman, same face, same room", strength: 0.72 },
  { id: "jacket", label: "Leather jacket", env: "same", lock: 0.8, prompt: "wearing a black leather jacket over a dark top instead of the black top, same woman, same face, same room", strength: 0.72 },
  { id: "gown", label: "Summer dress", env: "same", lock: 0.8, prompt: "wearing a floral summer dress instead of the black top, same woman, same face, same room", strength: 0.72 },
];

export async function estimatePose(blob, { useModel = true } = {}) {
  try {
    const bmp = await createImageBitmap(blob);
    try {
      const lm = await landmarksOf(bmp, useModel);
      if (!lm) return null;
      const dx = lm.leftEye.x - lm.rightEye.x, dy = lm.leftEye.y - lm.rightEye.y;
      const d = Math.max(1, Math.hypot(dx, dy));
      const roll = Math.atan2(dy, dx) * 180 / Math.PI;
      const midX = (lm.leftEye.x + lm.rightEye.x) / 2;
      const yaw = Math.max(-90, Math.min(90, (((lm.nose?.x ?? midX) - midX) / d) * 120));
      return {
        roll: Math.round(roll * 10) / 10,
        yaw: Math.round(yaw * 10) / 10,
        yawNote: Math.abs(yaw) < 12 ? "frontal" : yaw > 0 ? "turned right" : "turned left",
      };
    } finally { bmp.close?.(); }
  } catch { return null; }
}

export async function runPoseVariants({
  refBlob, basePrompt = "", presetIds = ["left34", "right34", "smile"],
  aspect = "original", sizeId = "S", model = "auto", nsfw = false,
  seed = null, signal = null, onStage = null,
}) {
  const base = seed != null && Number.isFinite(Number(seed)) ? Math.floor(Number(seed)) : Math.floor(Math.random() * 2 ** 31);
  const presets = POSE_PRESETS.filter((p) => presetIds.includes(p.id));
  const items = [];
  const failures = [];
  for (let i = 0; i < presets.length; i++) {
    if (signal?.aborted) throw Object.assign(new Error("cancelled"), { kind: "cancelled" });
    const p = presets[i];
    try {
      if (FAST_MODELS.has(model) || ACCURATE_MODELS.has(model)) {
        const x = String(model).endsWith("-nsfw");
        const useNsfw = nsfw || x;
        const useModel = x ? model : (model === "auto" ? "auto" : model);
        const accurate = ACCURATE_MODELS.has(model);
        onStage?.(i, presets.length, p, accurate ? "sdxl accurate" : "sdxl fast");
        const run = accurate
          ? (await import("./sdxl-edit.js")).sdxlEdit
          : aiEdit;
        const r = await run({
          refBlob, basePrompt, preset: p, aspect, sizeId, model: useModel,
          nsfw: useNsfw, seed: (base + i * 7919) % 2 ** 31,
          signal, onStage: (route, attempt, msg) => onStage?.(i, presets.length, p, `${route} ${msg}`),
        });
        const pose = await estimatePose(r.blob).catch(() => null);
        items.push({
          preset: p.id, label: `${p.label}${p.env === "new" ? " · new place" : ""}`, blob: r.blob, url: r.url,
          seed: r.seed, w: r.w, h: r.h, model: r.model,
          by: `${r.by} · ${p.label} · ${p.env === "new" ? "new place" : "same room"}`,
          faceScore: r.faceScore ?? null, faceLocked: !!r.faceLocked, pose,
          index: i,
        });
        onStage?.(i, presets.length, p, `done · face ${r.faceScore ?? "?"}%`);
      } else {
        const lock = "photorealistic photograph, mature adult woman, natural skin texture with pores";
        const prompt = [basePrompt.trim(), lock, p.prompt].filter(Boolean).join(", ");
        onStage?.(i, presets.length, p, "working");
        const out = await generateImages({
          prompt, negative: "anime, cartoon, illustration, painting, cgi, 3d render, plastic skin, young teen, deformed face, asymmetric eyes", mode: "edit", inputBlob: refBlob,
          aspect, sizeId, model, count: 1, strength: p.strength,
          lora: "none", control: "none", seed: (base + i * 7919) % 2 ** 31,
          nsfw, signal,
        });
        const gen = out.items[0];
        onStage?.(i, presets.length, p, "face lock");
        const locked = await faceBlend(refBlob, gen.blob, { strength: p.lock ?? (p.env === "new" ? 0.9 : 0.88), feather: 15 });
        const blob = locked.applied && locked.blob ? locked.blob : gen.blob;
        const pose = await estimatePose(blob).catch(() => null);
        items.push({
          preset: p.id, label: `${p.label}${p.env === "new" ? " · new place" : ""}`, blob, url: URL.createObjectURL(blob),
          seed: gen.seed, w: gen.w, h: gen.h, model: gen.model,
          by: `${gen.by || gen.model || "edit"} · ${p.label} · ${p.env === "new" ? "new place" : "same room"} · face ${locked.score ?? "?"}%`,
          faceScore: locked.score ?? null, faceLocked: !!locked.applied, pose,
          index: i,
        });
        onStage?.(i, presets.length, p, `done · face ${locked.score ?? "?"}%`);
      }
    } catch (e) {
      if (e?.kind === "cancelled") throw e;
      failures.push(`${p.label}: ${e?.message || e}`);
      onStage?.(i, presets.length, p, `failed: ${e?.message || e}`);
    }
  }
  if (!items.length) throw new Error(failures[0] || "no pose delivered");
  return { items, failures };
}
