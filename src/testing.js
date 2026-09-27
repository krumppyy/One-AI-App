export function testLog(msg) {
  const el = document.getElementById("testLogBox");
  if (!el) return;
  const d = document.createElement("div");
  d.textContent = msg;
  el.appendChild(d);
  el.scrollTop = el.scrollHeight;
}

export function testPass(name, detail) {
  testLog(`PASS ${name}${detail ? " · " + detail : ""}`);
}

export function testFail(name, err) {
  testLog(`FAIL ${name} · ${String(err && err.message || err)}`);
}

function synthDoc(soma, n = 2) {
  const mk = (bg, fg) => {
    const cv = document.createElement("canvas");
    cv.width = 640; cv.height = 360;
    const c = cv.getContext("2d");
    c.fillStyle = bg; c.fillRect(0, 0, 640, 360);
    c.fillStyle = fg;
    c.beginPath(); c.arc(320, 180, 80, 0, 7); c.fill();
    return cv;
  };
  const A = (seed) => ({
    palette: ["rgb(200,150,120)"],
    exposureLevel: 55, toneShadow: 12, toneHighlight: 88, averageLuma: 130,
    particles: Array.from({ length: 24 }, (_, i) => ({
      originX: (seed + i * 53) % 1280, originY: (i * 91) % 720,
      vx: 0.2, vy: 0.1, r: 200, g: 150, b: 120, radius: 2, alpha: 0.4, ci: i % 8,
    })),
  });
  const keys = [];
  for (let i = 0; i < n; i++) keys.push({ name: "k" + (i + 1), hold: 2, canvas: mk(i ? "#223328" : "#222832", i ? "#9cc66e" : "#c8966e"), analysis: A(300 + i * 40) });
  return soma.encodeSoma(keys, { flowVelocity: 1, transition: 0.8 });
}

export async function testCodecRoundtrip() {
  const soma = await import("./ankan-soma.js");
  const play = await import("./codec-play.js");
  const t0 = performance.now();
  const doc = synthDoc(soma);
  const json = JSON.stringify(doc);
  const back = soma.decodeAnkanSoma(JSON.parse(json));
  if (back.magic !== "SOMA" || back.keys.length !== 2) throw new Error("decode mismatch");
  const kind = await play.sniffCodec(new File([json], "t.soma", { type: "application/json" }));
  if (kind !== "soma") throw new Error("sniff=" + kind);
  const live = await play.decodeKeys(new Blob([json], { type: "application/json" }));
  if (live.keys.length !== 2) throw new Error("playKeys=" + live.keys.length);
  testPass("codec roundtrip", `${Math.round(json.length / 1024)}KB · ${Math.round(performance.now() - t0)}ms`);
}

export async function testBridges() {
  const soma = await import("./ankan-soma.js");
  const raw = JSON.parse(JSON.stringify(synthDoc(soma)));
  const wan = await import("./wan-bridge.js");
  const ltx = await import("./ltx-bridge.js");
  const hy = await import("./hunyuan-bridge.js");
  const qw = await import("./qwen-bridge.js");
  const w = wan.somaToWanJob(raw, "a person standing");
  const l = ltx.somaToLtxJob(raw, "a person standing");
  const h = hy.somaToHunyuanJob(raw, "a person standing");
  const q = qw.somaToQwenJob(raw, "same person");
  if (!w.startImage || !w.endImage) throw new Error("wan frames");
  if (!l.startImage || l.endImage !== null) throw new Error("ltx frames");
  if (h.numFrames !== 97 || h.guidance !== 6) throw new Error("hunyuan snap");
  if (!q.image || !q.prompt) throw new Error("qwen job");
  testPass("bridges", `wan+ltx+hunyuan+qwen · hFrames=${h.numFrames}`);
}

export async function testBenchmark() {
  const soma = await import("./ankan-soma.js");
  const play = await import("./codec-play.js");
  const { keys, params } = await play.decodeKeys(new Blob([JSON.stringify(synthDoc(soma, 1))], { type: "application/json" }));
  const cv = document.getElementById("testCanvas");
  const bench = (W, H, n) => {
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const ctx = c.getContext("2d");
    const t0 = performance.now();
    for (let i = 0; i < n; i++) play.renderCodecFrame(ctx, W, H, (i / n) * 2, keys, params, false);
    return (performance.now() - t0) / n;
  };
  const r = { p720: bench(1280, 720, 60), p1080: bench(1920, 1080, 30), p2k: bench(2560, 1440, 15), p4k: bench(3840, 2160, 8) };
  if (cv) {
    cv.width = 1280; cv.height = 720;
    play.renderCodecFrame(cv.getContext("2d"), 1280, 720, 1.0, keys, params, false);
  }
  testPass("benchmark", `720p ${r.p720.toFixed(2)}ms · 1080p ${r.p1080.toFixed(2)}ms · 2K ${r.p2k.toFixed(2)}ms · 4K ${r.p4k.toFixed(2)}ms`);
}

export async function testPickers() {
  const val = (g) => Array.from(g.children).map((o) => o.value);
  const std = document.querySelector("#stdModelSel");
  const img = document.querySelector("#imgModelSel");
  const sg = Array.from(std.querySelectorAll("optgroup")).find((g) => g.label.includes("Codec"));
  const ig = Array.from(img.querySelectorAll("optgroup")).find((g) => g.label.includes("Codec"));
  const sv = sg ? val(sg) : [];
  const iv = ig ? val(ig) : [];
  if (!sv.includes("wan-codec") || !sv.includes("ltx-codec") || !sv.includes("hunyuan-codec")) throw new Error("video=" + sv.join(","));
  if (!iv.includes("qwen-codec")) throw new Error("image=" + iv.join(","));
  testPass("pickers", "video 3 · image 1");
}

export async function testQwenCpu() {
  const { generateImages } = await import("./img-engine.js");
  const cv = document.createElement("canvas");
  cv.width = 256; cv.height = 256;
  const c = cv.getContext("2d");
  const g = c.createLinearGradient(0, 0, 256, 256);
  g.addColorStop(0, "#33415e"); g.addColorStop(1, "#5e3341");
  c.fillStyle = g; c.fillRect(0, 0, 256, 256);
  c.fillStyle = "#c8966e";
  c.beginPath(); c.arc(128, 128, 60, 0, 7); c.fill();
  const blob = await new Promise((r) => cv.toBlob(r, "image/png"));
  const out = await generateImages({ prompt: "warm cinematic light", mode: "edit", inputBlob: blob, aspect: "1:1", sizeId: "S", model: "qwen-codec", count: 1 });
  if (!out.items.length || !out.items[0].blob.size) throw new Error("empty result");
  testPass("qwen cpu", `${Math.round(out.items[0].blob.size / 1024)}KB · ${out.items[0].by}`);
}

export async function testVideoCpu() {
  const eng = await import("./engine.js");
  const order = eng.orderProviders({ computeMode: "auto" }, { hasImage: true, generators: { standard: { on: true, pick: "wan-codec" }, nsfw: { on: false } } }, [], [], {}, null);
  const cpu = order.find((p) => p.kind === "codec-cpu");
  if (!cpu) throw new Error("no codec-cpu in order");
  const cv = document.createElement("canvas");
  cv.width = 320; cv.height = 180;
  const c = cv.getContext("2d");
  c.fillStyle = "#222832"; c.fillRect(0, 0, 320, 180);
  c.fillStyle = "#c8966e";
  c.beginPath(); c.arc(160, 90, 40, 0, 7); c.fill();
  const blob = await new Promise((r) => cv.toBlob(r, "image/png"));
  const { codecVideoClip } = await import("./codec-generate.js");
  const clip = await codecVideoClip({ imageBlob: blob, prompt: "gentle idle motion", family: cpu.family, duration: 2, fps: 8 });
  if (!clip.blob.size) throw new Error("empty clip");
  testPass("video cpu", `${Math.round(clip.blob.size / 1024)}KB mp4 · codec=${clip.meta.codec} · doc=${clip.meta.docKB}KB`);
}

export async function testQualityScore() {
  const { detailCanvas, scoreEdit } = await import("./quality.js");
  const { codecImageEdit, blobToCanvas } = await import("./codec-generate.js");
  const ref = detailCanvas(768, 512, 7);
  const refBlob = await new Promise((r) => ref.toBlob(r, "image/png"));
  const out = await codecImageEdit({ prompt: "cinematic light, keep every detail", inputBlob: refBlob, w: 768, h: 512, seed: 7, strength: 0.5 });
  const outCv = await blobToCanvas(out.blob, 768, 512, true);
  const sc = scoreEdit(ref, outCv, out.blob);
  const fit = out.fit || {};
  const line = `score ${sc.score}/100 · edge ${sc.parts.edge}/40 (${sc.parts.edgeRatio}x) · res ${sc.parts.res}/25 · color ${sc.parts.color}/20 · comp ${sc.parts.comp}/15 · kb ${Math.round(out.blob.size / 1024)}`;
  if (sc.score < 90) throw new Error(line);
  testPass("quality score", line);
}

const TESTS = [
  ["codec roundtrip", testCodecRoundtrip],
  ["bridges", testBridges],
  ["benchmark", testBenchmark],
  ["pickers", testPickers],
  ["qwen cpu", testQwenCpu],
  ["video cpu", testVideoCpu],
  ["quality score", testQualityScore],
];

export async function runAllTests() {
  const log = document.getElementById("testLogBox");
  if (log) log.innerHTML = "";
  testLog("Running all tests…");
  let pass = 0;
  for (const [name, fn] of TESTS) {
    try { await fn(); pass++; }
    catch (e) { testFail(name, e); }
  }
  testLog(`Done: ${pass}/${TESTS.length} passed.`);
}

export function initTesting() {
  if (document.getElementById("testRunAllBtn")?.dataset.bound) return;
  const all = document.getElementById("testRunAllBtn");
  if (!all) return;
  all.dataset.bound = "1";
  all.onclick = () => runAllTests().catch((e) => testFail("run-all", e));
  for (const b of document.querySelectorAll("[data-test]")) {
    b.onclick = async () => {
      const t = TESTS.find((x) => x[0] === b.dataset.test);
      if (!t) return;
      try { await t[1](); } catch (e) { testFail(t[0], e); }
    };
  }
}

if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", () => {
    try { initTesting(); } catch (e) { console.error("Testing init failed:", e); }
  });
} else {
  try { initTesting(); } catch (e) { console.error("Testing init failed:", e); }
}
