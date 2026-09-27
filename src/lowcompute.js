export const HARDWARE_TIERS = [
  { id: "cpu", label: "CPU only — no GPU", vramGB: 0 },
  { id: "igpu-2gb", label: "iGPU / 2GB", vramGB: 2 },
  { id: "g4gb", label: "4GB GPU", vramGB: 4 },
  { id: "g6gb", label: "6GB GPU", vramGB: 6 },
  { id: "g8gb", label: "8GB+ GPU", vramGB: 8 },
];

const FAMILY_BASE = {
  wan: { checkpoint: "Wan Fun InP 1.3B", arch: "fun_inp_1.3B", license: "Apache 2.0" },
  ltx: { checkpoint: "LTX-Video 2B", arch: "ltx_2b", license: "OpenRail-M" },
  hunyuan: { checkpoint: "HunyuanVideo I2V 13B", arch: "hunyuan_i2v_13B", license: "Tencent community" },
  qwen: { checkpoint: "Qwen-Image-Edit", arch: "qwen_image_edit", license: "Apache 2.0" },
};

export function planFor(family, tierId, totalSec = 4) {
  const fam = FAMILY_BASE[family];
  if (!fam) throw new Error("unknown family " + family);
  const tier = HARDWARE_TIERS.find((t) => t.id === tierId) || HARDWARE_TIERS[0];
  const v = tier.vramGB;
  const weak = v < 6;
  const cpuOnly = v <= 0;
  const steps = cpuOnly ? 4 : v <= 2 ? 4 : v <= 4 ? 6 : 8;
  const height = family === "qwen" ? 768 : cpuOnly || v <= 2 ? 360 : v <= 4 ? 480 : 512;
  const frames = family === "qwen" ? 1 : Math.max(9, Math.round(Number(totalSec || 4) * 8));
  const compile = weak;
  const offload = weak ? "sequential" : "model";
  const quant = family === "hunyuan" && v < 12 ? "int8" : v <= 4 ? "fp8" : "bf16";
  const precision = cpuOnly ? "fp32" : "bf16";
  return {
    family, tier: tier.id, totalSec,
    checkpoint: fam.checkpoint, arch: fam.arch, license: fam.license,
    steps, height, frames, precision, offload, compile, quant,
    note: cpuOnly ? "CPU run: expect minutes per second of video; codec delivers the 4K." : weak ? "Weak GPU: few-step distilled run at low res; codec upscales/delivers." : "Capable GPU: standard short run; codec still owns delivery.",
  };
}

export function localCommand(plan) {
  const script = { wan: "run_wan.py", ltx: "run_ltx.py", hunyuan: "run_hunyuan.py", qwen: "run_qwen.py" }[plan.family] || "run_wan.py";
  const args = [`python ${script}`, `--steps ${plan.steps}`, `--height ${plan.height}`];
  if (plan.family !== "qwen") args.push(`--frames ${plan.frames}`);
  args.push(`--precision ${plan.precision}`);
  if (plan.offload === "sequential") args.push("--cpu");
  if (plan.compile) args.push("--compile");
  if (plan.quant === "int8" || plan.quant === "fp8") args.push(`--quant ${plan.quant}`);
  else args.push("--lowvram");
  return args.join(" ");
}

export function estimateVramGB(plan) {
  const base = { wan: 3.2, ltx: 3.8, hunyuan: 11.5, qwen: 4.5 }[plan.family] ?? 4;
  const q = plan.quant === "int8" ? 0.45 : plan.quant === "fp8" ? 0.6 : 1;
  const off = plan.offload === "sequential" ? 0.35 : 1;
  return Math.round(base * q * off * 10) / 10;
}

if (typeof window !== "undefined") window.LowCompute = { HARDWARE_TIERS, planFor, localCommand, estimateVramGB };
