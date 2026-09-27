import { encodeSoma, decodeAnkanSoma } from "./ankan-soma.js";
export function paletteText(palette, n = 5) {
  return (palette || []).slice(0, n).join(", ");
}
export function somaToQwenJob(raw, basePrompt = "") {
  const d = raw?.magic ? decodeAnkanSoma(raw) : raw;
  const keys = d.keys || [];
  const first = keys[0];
  const tone = first?.analysis || {};
  const pal = paletteText(tone.palette);
  const mood = `warm cinematic light, exposure ${tone.exposureLevel ?? 50}, palette ${pal}`;
  return {
    image: first?.image || null,
    prompt: [basePrompt, mood].filter(Boolean).join(", "),
    negativePrompt: "worst quality, blurry, deformed body, extra limbs, watermark, text",
    params: d.params || {},
  };
}
export function qwenJobToFinetuneRows(job, out = []) {
  out.push({
    image: job.image,
    prompt: job.prompt,
    negative_prompt: job.negativePrompt,
  });
  return out;
}
export function buildSomaFromStills(stills, params = {}) {
  return encodeSoma(stills, params);
}
if (typeof window !== "undefined") window.QwenBridge = { somaToQwenJob, qwenJobToFinetuneRows, buildSomaFromStills };
