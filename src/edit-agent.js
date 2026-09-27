import { generateImages } from "./img-engine.js";

export function splitPromptFallback(prompt) {
  const parts = String(prompt || "").split(/[,;]+|\s+and\s+|\s+then\s+/i).map((s) => s.trim()).filter(Boolean);
  const steps = parts.slice(0, 4).map((p) => ({ edit: p, strength: 0.6 }));
  return steps.length ? steps : [{ edit: String(prompt || "").trim(), strength: 0.6 }];
}

export async function planEditSteps(prompt, maxSteps = 4) {
  const clean = String(prompt || "").trim();
  if (!clean) return [];
  try {
    const gen = root.generateText;
    if (typeof gen !== "function") return splitPromptFallback(clean);
    const raw = await gen(`Split this image edit request into at most ${maxSteps} ordered single-change steps. Reply ONLY as JSON array like [{"edit":"...","strength":0.6}]. Strength 0.3-0.8, low for color/light, high for add/remove/replace. Request: ${clean}`);
    const text = String(raw && raw.text ? raw.text : raw || "");
    const m = text.match(/\[[\s\S]*\]/);
    if (!m) return splitPromptFallback(clean);
    const arr = JSON.parse(m[0]);
    if (!Array.isArray(arr) || !arr.length) return splitPromptFallback(clean);
    return arr.slice(0, maxSteps).map((s) => ({
      edit: String(s.edit || s.prompt || s.step || "").trim() || clean,
      strength: Math.min(0.85, Math.max(0.3, Number(s.strength) || 0.6)),
    })).filter((s) => s.edit);
  } catch {
    return splitPromptFallback(clean);
  }
}

async function blobOf(item) {
  if (!item) return null;
  if (item instanceof Blob) return item;
  if (item.url) {
    try {
      return await (await fetch(item.url)).blob();
    } catch { return null; }
  }
  return null;
}

export async function runEditAgent(o) {
  const { prompt, inputBlob, negative, aspect, sizeId, model, count, lora, control, seed, nsfw, signal, onStep } = o;
  const steps = await planEditSteps(prompt);
  let cur = inputBlob;
  const trail = [];
  for (let i = 0; i < steps.length; i++) {
    if (signal?.aborted) throw Object.assign(new Error("cancelled"), { kind: "cancelled" });
    const st = steps[i];
    onStep?.(i, steps.length, st);
    const out = await generateImages({
      prompt: `${st.edit}, keep the same person, same face, same age, same hairstyle, same body and same room and lighting, change only what is asked, photorealistic seamless blend, anatomically correct hands with five fingers, natural nails, realistic feet, no extra limbs, no extra fingers, no extra toes`,
      negative, mode: "edit", inputBlob: cur, aspect, sizeId, model,
      count: 1, strength: st.strength, lora, control, seed, nsfw, signal,
    });
    const blob = await blobOf(out.items[0]);
    if (!blob) throw new Error(out.failures[0] || `step ${i + 1} failed`);
    cur = blob;
    trail.push({ step: st, item: out.items[0], w: out.w, h: out.h });
  }
  const last = trail[trail.length - 1];
  return { items: [{ ...last.item, by: `${last.item.by || ""} · agent ${trail.length} steps`.trim() }], w: last.w, h: last.h, steps: trail.map((t) => t.step), failures: [] };
}
