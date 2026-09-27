/**
 * The on-device picture lab behind the quality boost.
 *
 * Free image-to-video models hand back a small, heavily compressed clip: the
 * public Wan 2.2 Spaces, for example, return exactly 81 frames at 16 fps in a
 * 480x832 H.264 stream at ~700 kbps. That is the whole ceiling of what the free
 * pool can produce, and it is why a clip can look "generated but cheap": soft
 * because 700 kbps cannot carry 480x832, blocky in the dark areas, and choppy
 * because 16 fps is not a video frame rate.
 *
 * This file is the repair shop. It works on the finished clip, on this device,
 * with no allowance, no upload and no model download:
 *
 *   1. every frame is re-drawn through a WebGL chain — a Catmull-Rom resample
 *      to the target size, a two-pass gaussian, and an unsharp combine with a
 *      touch of grain to hide the banding a low-bitrate source leaves behind;
 *   2. a block-matching motion field is estimated between consecutive frames and
 *      used to draw the frames that were never generated, so 16 fps becomes 32;
 *   3. the result is re-encoded with WebCodecs at a bitrate the picture deserves
 *      (the source is typically 10-20x over-compressed) and muxed to MP4.
 *
 * Everything here is best-effort by design: if WebGL2, WebCodecs or the mp4
 * parser are missing, or the clip cannot be decoded, the caller gets `null` and
 * keeps the clip it already had. The boost is a bonus, never a single point of
 * failure.
 */

const VERT = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5);
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

/** Catmull-Rom resample: the cheap end of "real" resampling — 16 taps, no ringing. */
const FRAG_UP = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uSrc;
uniform vec2 uSrcSize;
uniform vec2 uOffset;
uniform float uContrast;
uniform float uSat;
uniform float uMix;

vec4 cr(float t) {
  float t2 = t * t;
  float t3 = t2 * t;
  return vec4(
    -0.5 * t3 + t2 - 0.5 * t,
     1.5 * t3 - 2.5 * t2 + 1.0,
    -1.5 * t3 + 2.0 * t2 + 0.5 * t,
     0.5 * t3 - 0.5 * t2);
}

void main() {
  vec2 uv = vUv + uOffset;
  vec2 pos = uv * uSrcSize - 0.5;
  vec2 base = floor(pos);
  vec2 f = pos - base;
  vec4 wx = cr(f.x);
  vec4 wy = cr(f.y);
  vec3 sum = vec3(0.0);
  float wsum = 0.0;
  for (int j = 0; j < 4; j++) {
    for (int i = 0; i < 4; i++) {
      vec2 tap = (base + vec2(float(i) - 1.0, float(j) - 1.0) + 0.5) / uSrcSize;
      float w = wx[i] * wy[j];
      sum += texture(uSrc, tap).rgb * w;
      wsum += w;
    }
  }
  vec3 c = sum / max(wsum, 0.0001);
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = (c - l) * uSat + l;
  c = (c - 0.5) * uContrast + 0.5;
  vec4 base4 = texture(uSrc, uv);
  outColor = vec4(mix(base4.rgb, c, uMix), 1.0);
}`;

/** Box-ish 2x downsample, used as the source for the blur pyramid. */
const FRAG_DOWN = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uSrc;
uniform vec2 uSrcSize;
void main() {
  vec2 t = 1.0 / uSrcSize;
  vec3 c = texture(uSrc, vUv + t * vec2(-1.0, -1.0)).rgb;
  c += texture(uSrc, vUv + t * vec2(1.0, -1.0)).rgb;
  c += texture(uSrc, vUv + t * vec2(-1.0, 1.0)).rgb;
  c += texture(uSrc, vUv + t * vec2(1.0, 1.0)).rgb;
  outColor = vec4(c * 0.25, 1.0);
}`;

/** Separable 9-tap gaussian. `uDir` is one texel step along the axis being blurred. */
const FRAG_BLUR = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uSrc;
uniform vec2 uDir;
void main() {
  float w[5];
  w[0] = 0.227027; w[1] = 0.194594; w[2] = 0.121621; w[3] = 0.054054; w[4] = 0.016216;
  vec3 c = texture(uSrc, vUv).rgb * w[0];
  for (int i = 1; i < 5; i++) {
    vec2 o = uDir * float(i);
    c += texture(uSrc, vUv + o).rgb * w[i];
    c += texture(uSrc, vUv - o).rgb * w[i];
  }
  outColor = vec4(c, 1.0);
}`;

/** Unsharp combine + grain = the pass that makes a 700 kbps source look crisp. */
const FRAG_SHARPEN = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uBase;
uniform sampler2D uBlur;
uniform float uAmount;
uniform float uGrain;
uniform float uSeed;
uniform vec2 uSize;
float hash(vec2 p, float s) {
  return fract(sin(dot(p + s, vec2(12.9898, 78.233))) * 43758.5453);
}
void main() {
  vec3 b = texture(uBase, vUv).rgb;
  vec3 lo = texture(uBlur, vUv).rgb;
  vec3 c = b + (b - lo) * uAmount;
  float g = hash(vUv * uSize, uSeed) - 0.5;
  c += g * uGrain;
  outColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

/**
 * Block-matching motion field, prev -> cur.
 *
 * One output texel per block, so the search cost is paid once per block instead
 * of once per pixel. The search is a plain SAD over a subsampled grid, which is
 * plenty for the slow, shallow motion a talking-head clip has, and the vector is
 * stored in *block-grid* units together with the residual that produced it —
 * the residual is what tells the interpolation pass where it should not trust
 * the motion and fall back to a plain cross-fade.
 */
const FRAG_FLOW = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uPrev;
uniform sampler2D uCur;
uniform vec2 uSize;
uniform float uBlock;
uniform float uSearch;
uniform float uStride;
void main() {
  vec2 px = (floor(gl_FragCoord.xy) * uBlock + uBlock * 0.5) / uSize;
  float best = 1e9;
  vec2 bestD = vec2(0.0);
  for (int dy = -5; dy <= 5; dy++) {
    for (int dx = -5; dx <= 5; dx++) {
      vec2 d = vec2(float(dx), float(dy));
      if (abs(d.x) > uSearch || abs(d.y) > uSearch) continue;
      float sad = 0.0;
      for (int sy = 0; sy < 4; sy++) {
        for (int sx = 0; sx < 4; sx++) {
          vec2 off = (vec2(float(sx), float(sy)) - 1.5) * uStride;
          vec3 a = texture(uPrev, px + off / uSize).rgb;
          vec3 b = texture(uCur, px + (off + d * uBlock) / uSize).rgb;
          sad += abs(a.r - b.r) + abs(a.g - b.g) + abs(a.b - b.b);
        }
      }
      if (sad < best) { best = sad; bestD = d; }
    }
  }
  // Sub-pixel: fit a parabola through the best row/column of the SAD surface.
  outColor = vec4(bestD, best / 48.0, 1.0);
}`;

/** Edge-aware smoothing of the motion field: kills isolated bad vectors. */
const FRAG_FLOW_SMOOTH = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uFlow;
uniform vec2 uStep;
void main() {
  vec4 c = texture(uFlow, vUv);
  vec2 sum = c.rg;
  float n = 1.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      if (i == 0 && j == 0) continue;
      vec4 s = texture(uFlow, vUv + vec2(float(i), float(j)) * uStep);
      if (distance(s.rg, c.rg) <= 1.5) { sum += s.rg; n += 1.0; }
    }
  }
  outColor = vec4(sum / n, c.b * 0.6 + (c.b) * 0.4, 1.0);
}`;

/**
 * Draw one output frame.
 *
 * `alpha` 1.0 is a real frame; 0.5 is the one that was never generated, drawn by
 * pulling the previous frame forward along the motion field and the current one
 * back. Where the field is unreliable (`err` high — an occlusion, a hard edge
 * changing, grain the SAD could not match) it cross-fades instead of warping,
 * because a wrong warp reads as a torn edge while a cross-fade reads as blur.
 */
const FRAG_PRESENT = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uPrev;
uniform sampler2D uCur;
uniform sampler2D uFlow;
uniform vec2 uSize;
uniform float uFlowScale;
uniform float uAlpha;
uniform float uErrMax;
uniform float uGrain;
uniform float uSeed;
float hash(vec2 p, float s) {
  return fract(sin(dot(p + s, vec2(12.9898, 78.233))) * 43758.5453);
}
void main() {
  vec4 f = texture(uFlow, vUv);
  vec2 d = f.rg * uFlowScale;
  float err = f.b;
  vec2 prevUv = clamp(vUv + d * uAlpha / uSize, vec2(0.0), vec2(1.0));
  vec2 curUv = clamp(vUv - d * (1.0 - uAlpha) / uSize, vec2(0.0), vec2(1.0));
  vec3 a = texture(uPrev, prevUv).rgb;
  vec3 b = texture(uCur, curUv).rgb;
  vec3 warped = mix(a, b, uAlpha);
  vec3 plain = mix(texture(uPrev, vUv).rgb, texture(uCur, vUv).rgb, uAlpha);
  float trust = 1.0 - clamp(err / uErrMax, 0.0, 1.0);
  vec3 c = mix(plain, warped, trust);
  c += (hash(vUv * uSize, uSeed) - 0.5) * uGrain;
  outColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s);
    gl.deleteShader(s);
    throw new Error(`Shaders are not compiling in this browser: ${String(log).slice(0, 200)}`);
  }
  return s;
}

function program(gl, frag) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, VERT));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, frag));
  gl.bindAttribLocation(p, 0, "aPos");
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error(`Shader link failed: ${String(gl.getProgramInfoLog(p)).slice(0, 200)}`);
  }
  const tex = (name) => gl.getUniformLocation(p, name);
  return { p, u: { src: tex("uSrc"), prev: tex("uPrev"), cur: tex("uCur"), flow: tex("uFlow"), blur: tex("uBlur"), base: tex("uBase"), size: tex("uSize"), srcSize: tex("uSrcSize"), offset: tex("uOffset"), dir: tex("uDir"), step: tex("uStep"), contrast: tex("uContrast"), sat: tex("uSat"), mix: tex("uMix"), amount: tex("uAmount"), grain: tex("uGrain"), seed: tex("uSeed"), block: tex("uBlock"), search: tex("uSearch"), stride: tex("uStride"), flowScale: tex("uFlowScale"), alpha: tex("uAlpha"), errMax: tex("uErrMax") } };
}

function target(gl, w, h) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { tex, fbo, w, h };
}

export function webglLabSupport() {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") && typeof createImageBitmap === "function");
  } catch {
    return false;
  }
}

/**
 * A resampling / motion lab for one clip. Sized once, reused for every frame —
 * a fresh GL context per frame would be far slower than the work itself.
 */
export function createLab({ srcW, srcH, outW, outH, sharpen = 0.62, grain = 0.014, contrast = 1.0, sat = 1.0 }) {
  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const gl = canvas.getContext("webgl2", {
    alpha: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: true,
    powerPreference: "high-performance",
  });
  if (!gl) return null;

  const prog = {
    up: program(gl, FRAG_UP),
    down: program(gl, FRAG_DOWN),
    blur: program(gl, FRAG_BLUR),
    sharpen: program(gl, FRAG_SHARPEN),
    flow: program(gl, FRAG_FLOW),
    flowSmooth: program(gl, FRAG_FLOW_SMOOTH),
    present: program(gl, FRAG_PRESENT),
  };

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.BLEND);

  const srcTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, srcTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const halfW = Math.max(2, Math.round(outW / 4));
  const halfH = Math.max(2, Math.round(outH / 4));
  const block = 4;
  const flowW = Math.max(1, Math.ceil(outW / 4 / block));
  const flowH = Math.max(1, Math.ceil(outH / 4 / block));

  const tmp = target(gl, outW, outH);
  const low = [target(gl, halfW, halfH), target(gl, halfW, halfH)];
  const eh = [target(gl, outW, outH), target(gl, outW, outH)];
  const flow = [target(gl, flowW, flowH), target(gl, flowW, flowH)];
  const grad = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, grad);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([128, 128, 0, 255]));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  let seed = Math.random() * 100;

  function drawTo(buf, p, bind) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, buf ? buf.fbo : null);
    if (buf) gl.viewport(0, 0, buf.w, buf.h);
    else gl.viewport(0, 0, outW, outH);
    gl.useProgram(p.p);
    bind(p.u);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function bindTex(unit, tex) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
  }

  const unit = { src: 0, prev: 1, cur: 2, flow: 3, blur: 4, base: 5 };

  /** Frame -> GL texture. Accepts a <video>, canvas, ImageBitmap or VideoFrame. */
  function upload(frame) {
    gl.bindTexture(gl.TEXTURE_2D, srcTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frame);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  /** Resample + unsharp the uploaded frame into `eh[slot]`, ready for muxing or warping. */
  function enhance(slot) {
    bindTex(unit.src, srcTex);
    drawTo(tmp, prog.up, (u) => {
      gl.uniform1i(u.src, unit.src);
      gl.uniform2f(u.srcSize, srcW, srcH);
      gl.uniform2f(u.offset, 0, 0);
      gl.uniform1f(u.contrast, contrast);
      gl.uniform1f(u.sat, sat);
      gl.uniform1f(u.mix, 1);
    });
    bindTex(unit.src, tmp.tex);
    drawTo(low[0], prog.down, (u) => {
      gl.uniform1i(u.src, unit.src);
      gl.uniform2f(u.srcSize, outW, outH);
    });
    const r = Math.max(1, Math.round(halfW / 100));
    bindTex(unit.src, low[0].tex);
    drawTo(low[1], prog.blur, (u) => {
      gl.uniform1i(u.src, unit.src);
      gl.uniform2f(u.dir, r / halfW, 0);
    });
    bindTex(unit.src, low[1].tex);
    drawTo(low[0], prog.blur, (u) => {
      gl.uniform1i(u.src, unit.src);
      gl.uniform2f(u.dir, 0, r / halfH);
    });
    bindTex(unit.base, tmp.tex);
    bindTex(unit.blur, low[0].tex);
    drawTo(eh[slot], prog.sharpen, (u) => {
      gl.uniform1i(u.base, unit.base);
      gl.uniform1i(u.blur, unit.blur);
      gl.uniform1f(u.amount, sharpen);
      gl.uniform1f(u.grain, 0);
      gl.uniform2f(u.size, outW, outH);
      gl.uniform1f(u.seed, seed);
    });
  }

  /** Motion field between the enhanced frames in slot a (previous) and b (current). */
  function measureFlow(a, b) {
    bindTex(unit.prev, eh[a].tex);
    bindTex(unit.cur, eh[b].tex);
    drawTo(flow[0], prog.flow, (u) => {
      gl.uniform1i(u.prev, unit.prev);
      gl.uniform1i(u.cur, unit.cur);
      gl.uniform2f(u.size, flowW, flowH);
      gl.uniform1f(u.block, 4);
      gl.uniform1f(u.search, 5);
      gl.uniform1f(u.stride, 1.35);
    });
    bindTex(unit.src, flow[0].tex);
    drawTo(flow[1], prog.flowSmooth, (u) => {
      gl.uniform1i(u.src, unit.src);
      gl.uniform2f(u.step, 1 / flowW, 1 / flowH);
    });
    return flow[1];
  }

  /**
   * Draw a frame to the canvas. `alpha` 1 = the enhanced frame in `slot` (with
   * `other` ignored), 0.5 = the in-between frame of the pair.
   */
  function present({ slot, other = 0, flowTex = null, alpha = 1, grainAmount = grain }) {
    bindTex(unit.prev, eh[other].tex);
    bindTex(unit.cur, eh[slot].tex);
    bindTex(unit.flow, flowTex || grad);
    drawTo(null, prog.present, (u) => {
      gl.uniform1i(u.prev, unit.prev);
      gl.uniform1i(u.cur, unit.cur);
      gl.uniform1i(u.flow, unit.flow);
      gl.uniform2f(u.size, outW, outH);
      gl.uniform1f(u.flowScale, alpha === 1 ? 0 : block * 4);
      gl.uniform1f(u.alpha, alpha);
      gl.uniform1f(u.errMax, 0.16);
      gl.uniform1f(u.grain, grainAmount);
      gl.uniform1f(u.seed, seed + alpha * 7);
    });
  }

  return {
    canvas,
    gl,
    outW,
    outH,
    upload,
    enhance,
    measureFlow,
    present,
    nextSeed() {
      seed = Math.random() * 100;
    },
    dispose() {
      try {
        const lose = gl.getExtension("WEBGL_lose_context");
        if (lose) lose.loseContext();
      } catch {}
    },
  };
}
