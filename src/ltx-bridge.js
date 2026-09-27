import { encodeSoma, decodeAnkanSoma } from "./ankan-soma.js";
export function paletteText(palette, n = 5) {
  return (palette || []).slice(0, n).join(", ");
}
export function motionStats(keys) {
  let vx = 0, vy = 0, c = 0;
  for (const k of keys || []) {
    for (const p of (k.analysis?.particles || k.particles || [])) {
      const v = Array.isArray(p) ? { vx: p[2], vy: p[3] } : p;
      vx += Math.abs(v.vx || 0); vy += Math.abs(v.vy || 0); c++;
    }
  }
  if (!c) return { speed: 0, dir: "still" };
  const sx = vx / c, sy = vy / c;
  const speed = Math.hypot(sx, sy);
  const dir = Math.abs(sx) >= Math.abs(sy) ? (sx >= 0 ? "right" : "left") : (sy >= 0 ? "down" : "up");
  return { speed, dir };
}
export function snapFrames(n) {
  n = Math.max(25, Math.min(121, Math.round(n || 49)));
  return Math.round((n - 1) / 9) * 9 + 1;
}
export function somaToLtxJob(raw, basePrompt = "") {
  const d = raw?.magic ? decodeAnkanSoma(raw) : raw;
  const keys = d.keys || [];
  const first = keys[0];
  const tone = first?.analysis || {};
  const ms = motionStats(keys);
  const pal = paletteText(tone.palette);
  const total = keys.reduce((n, k) => n + (Number(k.hold) || 3), 0);
  const mood = `warm cinematic light, exposure ${tone.exposureLevel ?? 50}, palette ${pal}`;
  const motion = ms.speed < 0.05
    ? "gentle idle motion, breathing, blinking, hair swaying"
    : `natural human motion drifting ${ms.dir}, weight shifting, breathing, blinking`;
  return {
    startImage: first?.image || null,
    endImage: null,
    prompt: [basePrompt, mood, motion].filter(Boolean).join(", "),
    negativePrompt: "worst quality, inconsistent motion, blurry, deformed body, extra limbs, static",
    holds: keys.map(k => Number(k.hold) || 3),
    totalSec: total,
    numFrames: snapFrames(Math.round(total * 8)),
    motionScale: Math.min(1, 0.3 + ms.speed * 2),
    params: d.params || {},
  };
}
export function ltxJobToFinetuneRows(job, out = []) {
  out.push({
    image: job.startImage,
    prompt: job.prompt,
    negative_prompt: job.negativePrompt,
    duration: job.totalSec,
  });
  return out;
}
export function buildSomaFromStills(stills, params = {}) {
  return encodeSoma(stills, params);
}
if (typeof window !== "undefined") window.LtxBridge = { somaToLtxJob, ltxJobToFinetuneRows, buildSomaFromStills, motionStats, snapFrames };
