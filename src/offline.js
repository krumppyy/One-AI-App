import { el, videoMime } from "./video.js";
import { encodeCanvasClip, hasVideoEncoder, snapFps } from "./encode.js";

/* ------------------------------------------------------------------ *
 *  Offline renderer — "Motion (offline)".
 *
 *  Turns a still image into a moving clip entirely on this device: no
 *  network, no GPU server, no model download.  A cheap depth field is
 *  estimated from the picture (centre-weighted, since this app animates
 *  people), the picture is warped by a dense row mesh, and the rows are
 *  driven at different rates so the shot has real parallax under the
 *  camera move you picked — near rows lead the camera, far rows lag it,
 *  so the subject swings more than the background, like a real camera
 *  moving through the scene.
 *
 *  The warp runs on the GPU as ONE displaced mesh.  Earlier versions
 *  composited the picture row-by-row on a 2D canvas; adjacent rows then
 *  had slightly different transforms, so their shared edges did not line
 *  up (measurable as the background showing through in ~40px slivers per
 *  row) which read as horizontal banding/combing.  A mesh has one shared
 *  vertex per row boundary, so the surface is watertight by construction,
 *  and the GPU's own bilinear filter does the vertical resampling — no
 *  duplicated or skipped rows, and no smoothing to hide anything.
 *
 *  A blurred copy of the picture sits behind the mesh so a frame edge can
 *  never go black, and grain + vignette give it a "footage" feel.
 *
 *  This is not a diffusion model — it is an honest 2.5D camera rig, and
 *  it is the only mode that works with the internet unplugged.
 * ------------------------------------------------------------------ */

export const MOVES = {
  auto: { dx: [0.018, -0.012], dy: [0.004, -0.006], scale: [1.0, 1.09], rot: [0, 0.4] },
  static: { dx: [0, 0], dy: [0, 0], scale: [1.01, 1.005], rot: [0, 0] },
  dolly_in: { dx: [0, 0], dy: [0, 0], scale: [1.0, 1.14], rot: [0, 0], zoom: true },
  dolly_out: { dx: [0, 0], dy: [0, 0], scale: [1.14, 1.0], rot: [0, 0], zoom: true },
  zoom_in: { dx: [0, 0], dy: [0, 0], scale: [1.0, 1.18], rot: [0, 0], zoom: true },
  zoom_out: { dx: [0, 0], dy: [0, 0], scale: [1.18, 1.0], rot: [0, 0], zoom: true },
  pan_left: { dx: [0.055, -0.055], dy: [0, 0], scale: [1.04, 1.04], rot: [0, 0] },
  pan_right: { dx: [-0.055, 0.055], dy: [0, 0], scale: [1.04, 1.04], rot: [0, 0] },
  tilt_up: { dx: [0, 0], dy: [0.045, -0.045], scale: [1.05, 1.05], rot: [0, 0] },
  tilt_down: { dx: [0, 0], dy: [-0.045, 0.045], scale: [1.05, 1.05], rot: [0, 0] },
  orbit_left: { dx: [0.05, -0.02], dy: [0, 0], scale: [1.06, 1.06], rot: [1.2, -1.2] },
  orbit_right: { dx: [-0.05, 0.02], dy: [0, 0], scale: [1.06, 1.06], rot: [-1.2, 1.2] },
  crane_up: { dx: [0, 0], dy: [0.06, -0.05], scale: [1.02, 1.1], rot: [0, 0], zoom: true },
  tracking: { dx: [0.07, -0.05], dy: [0.01, -0.01], scale: [1.05, 1.09], rot: [0, 0] },
  aerial: { dx: [0.02, -0.03], dy: [0.07, -0.03], scale: [1.05, 1.13], rot: [0, 0], zoom: true },
  flythrough: { dx: [0, 0], dy: [0.02, -0.02], scale: [1.0, 1.32], rot: [0, 0], zoom: true },
  spiral: { dx: [0.03, -0.03], dy: [0.03, -0.03], scale: [1.03, 1.18], rot: [-2, 2] },
  handheld: { dx: [0.012, -0.014], dy: [0.008, -0.01], scale: [1.03, 1.05], rot: [-0.6, 0.6], shake: 1 },
};

const ANGLES = {
  off: {},
  auto: {},
  eye: {},
  low: { scale: 1.04, dy: 0.02 },
  high: { scale: 1.05, dy: -0.02 },
  dutch: { rot: -5 },
  birds: { scale: 1.12, dy: -0.01 },
  worms: { scale: 1.14, dy: 0.03 },
  close: { scale: 1.34 },
  macro: { scale: 1.7 },
  medium: { scale: 1.14 },
  wide: { scale: 1.0 },
  ots: { scale: 1.22, dx: -0.05 },
  pov: { scale: 1.26 },
};

/* Parallax strengths: how much nearer-than-reference rows lead the camera
   (and further-than-reference rows lag behind it). */
const DREF = 0.5;
const PARALLAX = 1.0;
const ZOOMK = 0.12;
const SHIFTK = 0.85;
const DEPTH_BLUR_PASSES = 2;
const BACKDROP_DEPTH = 0.08;
/* Mesh resolution.  Each line also carries a depth, so this is the
   vertical resolution of the parallax field, not of the picture. */
const WARP_LINES = 128;
/* Extra picture kept around the frame so a hard camera move never drags
   a clamped edge into view. */
const EDGE = 24;
const GRAIN = 0.035;

const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => t * t * (3 - 2 * t);
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

function canvas(w, h) {
  return el("canvas", { width: w, height: h });
}

function ctxOf(c) {
  return c.getContext("2d", { willReadFrequently: false });
}

async function loadImage(blob) {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(blob);
    } catch {}
  }
  return await new Promise((res, rej) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      URL.revokeObjectURL(url);
      res(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      rej(new Error("Could not read that image."));
    };
    img.src = url;
  });
}

/**
 * Cheap depth field: "what is in the middle of the frame is closest", with a
 * small luminance term so the subject keeps some internal volume.  Estimated
 * on a 1/8-scale copy, then blurred so the parallax field is gradual.
 */
function buildDepth(src, w, h) {
  const small = canvas(Math.max(48, Math.round(w / 8)), Math.max(27, Math.round(h / 8)));
  const sc = ctxOf(small);
  sc.drawImage(src, 0, 0, small.width, small.height);
  const data = sc.getImageData(0, 0, small.width, small.height).data;
  const depth = new Float32Array(small.width * small.height);
  const cx = (small.width - 1) / 2;
  const cy = (small.height - 1) / 2;
  for (let i = 0, p = 0; i < depth.length; i++, p += 4) {
    const x = i % small.width;
    const y = (i / small.width) | 0;
    const r = Math.hypot((x - cx) / (cx || 1), (y - cy) / (cy || 1));
    const centre = clamp(1 - r * 0.95, 0, 1);
    const lum = (0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2]) / 255;
    depth[i] = clamp(0.18 + 0.85 * centre * centre - 0.22 * (lum - 0.5), 0, 1);
  }
  blurField(depth, small.width, small.height, DEPTH_BLUR_PASSES);
  return { depth, w: small.width, h: small.height };
}

/** Separable 5-tap box blur, repeated, over a float field (in place). */
function blurField(a, w, h, passes) {
  const b = new Float32Array(a.length);
  for (let pass = 0; pass < passes; pass++) {
    for (let y = 0; y < h; y++) {
      const row = y * w;
      let acc = 0;
      for (let x = -2; x <= 2; x++) acc += a[row + clamp(x, 0, w - 1)];
      for (let x = 0; x < w; x++) {
        b[row + x] = acc / 5;
        acc += a[row + clamp(x + 3, 0, w - 1)] - a[row + clamp(x - 2, 0, w - 1)];
      }
    }
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let y = -2; y <= 2; y++) acc += b[clamp(y, 0, h - 1) * w + x];
      for (let y = 0; y < h; y++) {
        a[y * w + x] = acc / 5;
        acc += b[clamp(y + 3, 0, h - 1) * w + x] - b[clamp(y - 2, 0, h - 1) * w + x];
      }
    }
  }
}

function sampleDepthLinear(d, u, v) {
  const fx = clamp(u, 0, 1) * (d.w - 1);
  const fy = clamp(v, 0, 1) * (d.h - 1);
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(d.w - 1, x0 + 1);
  const y1 = Math.min(d.h - 1, y0 + 1);
  const tx = fx - x0;
  const ty = fy - y0;
  const a = d.depth[y0 * d.w + x0];
  const b = d.depth[y0 * d.w + x1];
  const c = d.depth[y1 * d.w + x0];
  const e = d.depth[y1 * d.w + x1];
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + e * tx) * ty;
}

/**
 * One depth per mesh line: the nearest thing in that row.  Lines are spaced
 * ~6px apart, so the light smoothing pass only removes sampling noise — it
 * never flattens the parallax field itself.
 */
function buildRowProfile(depth, lines) {
  const raw = new Float32Array(lines + 1);
  const samples = 40;
  for (let j = 0; j <= lines; j++) {
    const v = j / lines;
    let m = 0;
    for (let i = 0; i < samples; i++) {
      const d = sampleDepthLinear(depth, (i + 0.5) / samples, v);
      if (d > m) m = d;
    }
    raw[j] = m;
  }
  const out = new Float32Array(lines + 1);
  for (let j = 0; j <= lines; j++) {
    let s = 0;
    let n = 0;
    for (let k = -2; k <= 2; k++) {
      const q = clamp(j + k, 0, lines);
      s += raw[q];
      n++;
    }
    out[j] = s / n;
  }
  return out;
}

/** Cover-scaled sharp copy of the picture, drawn into a rect of a canvas. */
function coverInto(ctx, src, x, y, w, h) {
  const sw = src.width || w;
  const sh = src.height || h;
  const scale = Math.max(w / sw, h / sh);
  const dw = sw * scale;
  const dh = sh * scale;
  ctx.drawImage(src, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

/**
 * The sharp picture the mesh samples, plus a margin of edge-extended
 * pixels on all four sides so a moving camera never samples outside the
 * picture (clamped texture reads would smear, this shows real colour).
 */
function buildMainTexture(src, w, h, margin) {
  const c = canvas(w + margin * 2, h + margin * 2);
  const cc = ctxOf(c);
  cc.imageSmoothingEnabled = true;
  cc.imageSmoothingQuality = "high";
  cc.fillStyle = "#000";
  cc.fillRect(0, 0, c.width, c.height);
  coverInto(cc, src, margin, margin, w, h);
  const m = margin;
  cc.drawImage(c, m, m, w, 1, m, 0, w, m);
  cc.drawImage(c, m, m + h - 1, w, 1, m, m + h, w, m);
  cc.drawImage(c, m, m, 1, h, 0, m, m, h);
  cc.drawImage(c, m + w - 1, m, 1, h, m + w, m, m, h);
  cc.drawImage(c, m, m, 1, 1, 0, 0, m, m);
  cc.drawImage(c, m + w - 1, m, 1, 1, m + w, 0, m, m);
  cc.drawImage(c, m, m + h - 1, 1, 1, 0, m + h, m, m);
  cc.drawImage(c, m + w - 1, m + h - 1, 1, 1, m + w, m + h, m, m);
  return c;
}

/** Blurred copy that sits behind the mesh so edge gaps never go black. */
function buildBackdrop(src, w, h) {
  const c = canvas(w, h);
  const dc = ctxOf(c);
  dc.filter = `blur(${Math.max(6, Math.round(Math.min(w, h) / 30))}px) brightness(0.72)`;
  const bs = 1.25;
  dc.drawImage(src, (w - w * bs) / 2, (h - h * bs) / 2, w * bs, h * bs);
  dc.filter = "none";
  return c;
}

/* Full-resolution grain plate + vignette — used by the 2D fallback rig. */
function buildGrain(w, h) {
  const m = 24;
  const c = canvas(w + 2 * m, h + 2 * m);
  const cc = ctxOf(c);
  const out = cc.createImageData(c.width, c.height);
  const d = out.data;
  for (let i = 0; i < d.length; i += 4) {
    const v = 118 + Math.random() * 74;
    d[i] = d[i + 1] = d[i + 2] = v;
    d[i + 3] = 255;
  }
  cc.putImageData(out, 0, 0);
  return { canvas: c, m };
}

function buildVignette(w, h) {
  const c = canvas(w, h);
  const cc = ctxOf(c);
  const g = cc.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.28, w / 2, h / 2, Math.max(w, h) * 0.72);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(0.62, "rgba(0,0,0,0.06)");
  g.addColorStop(1, "rgba(0,0,0,0.28)");
  cc.fillStyle = g;
  cc.fillRect(0, 0, w, h);
  return c;
}

const VERT_MAIN = `
attribute vec2 aPos;
attribute vec2 aUv;
uniform vec2 uSize;
varying vec2 vUv;
void main() {
  vUv = aUv;
  gl_Position = vec4(aPos.x / uSize.x * 2.0 - 1.0, 1.0 - aPos.y / uSize.y * 2.0, 0.0, 1.0);
}`;

const FRAG_TEXTURE = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform sampler2D uTex;
varying vec2 vUv;
void main() {
  gl_FragColor = texture2D(uTex, vUv);
}`;

const FRAG_POST = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform float uMode;
uniform float uSeed;
uniform float uAmount;
uniform float uInner;
uniform float uOuter;
uniform vec2 uSize;
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
void main() {
  if (uMode < 0.5) {
    float n = hash(gl_FragCoord.xy + vec2(uSeed, uSeed * 1.37)) - 0.5;
    gl_FragColor = vec4(n * uAmount, n * uAmount, n * uAmount, 0.0);
  } else {
    float r = length(gl_FragCoord.xy - uSize * 0.5);
    float t = clamp((r - uInner) / max(1.0, uOuter - uInner), 0.0, 1.0);
    gl_FragColor = vec4(0.0, 0.0, 0.0, 0.30 * pow(t, 1.3));
  }
}`;

const VERT_QUAD = `
attribute vec2 aPos;
uniform vec2 uSize;
void main() {
  gl_Position = vec4(aPos.x / uSize.x * 2.0 - 1.0, 1.0 - aPos.y / uSize.y * 2.0, 0.0, 1.0);
}`;

function compile(gl, type, source) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, source);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) return null;
  return sh;
}

function makeProgram(gl, vsSrc, fsSrc) {
  const vs = compile(gl, gl.VERTEX_SHADER, vsSrc);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fsSrc);
  if (!vs || !fs) return null;
  const p = gl.createProgram();
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) return null;
  return p;
}

/**
 * GPU rig: the picture is a texture, the frame is a mesh of horizontal
 * bands whose shared vertices carry a single interpolated transform, so
 * the warped surface cannot crack.  Returns null when WebGL is missing.
 */
function buildGLRig(w, h, mainTexCanvas, backdropCanvas, rowDepth) {
  const cv = canvas(w, h);
  const attrs = { alpha: false, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: true };
  const gl = cv.getContext("webgl", attrs) || cv.getContext("experimental-webgl", attrs);
  if (!gl) return null;

  const progTex = makeProgram(gl, VERT_MAIN, FRAG_TEXTURE);
  const progPost = makeProgram(gl, VERT_QUAD, FRAG_POST);
  if (!progTex || !progPost) return null;

  function texture(src) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return t;
  }

  const texMain = texture(mainTexCanvas);
  const texBack = texture(backdropCanvas);

  const texW = mainTexCanvas.width;
  const texH = mainTexCanvas.height;

  /* --- mesh buffers ------------------------------------------------ */
  const meshBuf = gl.createBuffer();
  const meshData = new Float32Array((WARP_LINES + 1) * 2 * 4);
  const indexBuf = gl.createBuffer();
  {
    const idx = new Uint16Array(WARP_LINES * 6);
    for (let j = 0; j < WARP_LINES; j++) {
      const a = j * 2;
      idx.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], j * 6);
    }
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuf);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
  }
  const quadBuf = gl.createBuffer();
  const quadData = new Float32Array(4 * 4);

  const pos = gl.getAttribLocation(progTex, "aPos");
  const uv = gl.getAttribLocation(progTex, "aUv");
  const uSize = gl.getUniformLocation(progTex, "uSize");
  const uTex = gl.getUniformLocation(progTex, "uTex");

  const qPos = gl.getAttribLocation(progPost, "aPos");
  const pSize = gl.getUniformLocation(progPost, "uSize");
  const pMode = gl.getUniformLocation(progPost, "uMode");
  const pSeed = gl.getUniformLocation(progPost, "uSeed");
  const pAmount = gl.getUniformLocation(progPost, "uAmount");
  const pInner = gl.getUniformLocation(progPost, "uInner");
  const pOuter = gl.getUniformLocation(progPost, "uOuter");

  const quadPositions = new Float32Array([0, 0, w, 0, 0, h, w, h]);
  const inner = Math.min(w, h) * 0.28;
  const outer = Math.max(w, h) * 0.72;

  gl.clearColor(0, 0, 0, 1);
  gl.disable(gl.CULL_FACE);
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.BLEND);

  function drawMesh(p, breathe) {
    const cos = Math.cos(p.rot);
    const sin = Math.sin(p.rot);
    const cx = w / 2;
    const cy = h / 2;
    const rotNeed = 1 + Math.abs(sin) * 1.6;
    const tx0 = p.dx * w;
    const ty0 = p.dy * h;
    let i = 0;
    for (let j = 0; j <= WARP_LINES; j++) {
      const v = (j / WARP_LINES) * h;
      const kd = (rowDepth[j] - DREF) * PARALLAX;
      const mult = 1 + kd * SHIFTK;
      const need = (1 + 2 * Math.max(Math.abs(p.dx) * mult, Math.abs(p.dy) * mult) + 0.012) * rotNeed;
      const s = p.scale * Math.max(need, 1 + kd * ZOOMK) * breathe;
      const tx = cx + tx0 * mult;
      const ty = cy + ty0 * mult;
      for (let c = 0; c < 2; c++) {
        const u = c * w;
        meshData[i++] = tx + s * (cos * (u - cx) - sin * (v - cy));
        meshData[i++] = ty + s * (sin * (u - cx) + cos * (v - cy));
        meshData[i++] = (u + EDGE) / texW;
        meshData[i++] = (v + EDGE) / texH;
      }
    }
    gl.useProgram(progTex);
    gl.uniform2f(uSize, w, h);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texMain);
    gl.uniform1i(uTex, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, meshBuf);
    gl.bufferData(gl.ARRAY_BUFFER, meshData, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(uv);
    gl.vertexAttribPointer(uv, 2, gl.FLOAT, false, 16, 8);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuf);
    gl.drawElements(gl.TRIANGLES, WARP_LINES * 6, gl.UNSIGNED_SHORT, 0);
  }

  function drawBackdrop(p, breathe, coverage) {
    const cos = Math.cos(p.rot * 0.3);
    const sin = Math.sin(p.rot * 0.3);
    const cx = w / 2;
    const cy = h / 2;
    const kd = (BACKDROP_DEPTH - DREF) * PARALLAX;
    const mult = 1 + kd * SHIFTK;
    const s = p.scale * Math.max(1.06, coverage * (1 + kd * ZOOMK)) * breathe;
    const tx = cx + p.dx * w * mult;
    const ty = cy + p.dy * h * mult;
    let i = 0;
    for (const [u, v, su, sv] of [
      [0, 0, 0, 0],
      [w, 0, 1, 0],
      [0, h, 0, 1],
      [w, h, 1, 1],
    ]) {
      quadData[i++] = tx + s * (cos * (u - cx) - sin * (v - cy));
      quadData[i++] = ty + s * (sin * (u - cx) + cos * (v - cy));
      quadData[i++] = su;
      quadData[i++] = sv;
    }
    gl.useProgram(progTex);
    gl.uniform2f(uSize, w, h);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texBack);
    gl.uniform1i(uTex, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.bufferData(gl.ARRAY_BUFFER, quadData, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(uv);
    gl.vertexAttribPointer(uv, 2, gl.FLOAT, false, 16, 8);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  function post(mode, seed, amount) {
    gl.useProgram(progPost);
    gl.uniform2f(pSize, w, h);
    gl.uniform1f(pMode, mode);
    gl.uniform1f(pSeed, seed);
    gl.uniform1f(pAmount, amount);
    gl.uniform1f(pInner, inner);
    gl.uniform1f(pOuter, outer);
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.bufferData(gl.ARRAY_BUFFER, quadPositions, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(qPos);
    gl.vertexAttribPointer(qPos, 2, gl.FLOAT, false, 8, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  function draw(p, breathe, coverage, grain) {
    gl.viewport(0, 0, w, h);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.disable(gl.BLEND);
    drawBackdrop(p, breathe, coverage);
    drawMesh(p, breathe);
    if (grain > 0) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      post(0, Math.random() * 1000, grain * 1.6);
    }
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    post(1, 0, 0);
    gl.disable(gl.BLEND);
  }

  return { canvas: cv, kind: "gl", draw };
}

/**
 * 2D rig: the fallback for devices without WebGL.  Same camera model, but
 * a CPU canvas cannot interpolate a dense mesh cheaply, so this rig moves
 * the subject and the background as two whole layers at different rates
 * (a clean Ken-Burns push with real depth separation) instead of warping
 * per row.  The GPU rig is used whenever it exists.
 */
function build2DRig(w, h, src, rowDepth) {
  const base = (() => {
    const c = canvas(w, h);
    const bc = ctxOf(c);
    bc.imageSmoothingEnabled = true;
    bc.imageSmoothingQuality = "high";
    bc.fillStyle = "#000";
    bc.fillRect(0, 0, w, h);
    coverInto(bc, src, 0, 0, w, h);
    return c;
  })();
  const backdrop = buildBackdrop(src, w, h);
  const grainPlate = buildGrain(w, h);
  const vignette = buildVignette(w, h);
  const out = canvas(w, h);
  const oc = ctxOf(out);
  let subject = 0;
  for (let i = 0; i < rowDepth.length; i++) subject += rowDepth[i];
  subject /= rowDepth.length;

  function layer(c, depthK, p, rot, breathe, coverage) {
    const kd = (depthK - DREF) * PARALLAX;
    const s = p.scale * Math.max(1.02, coverage * (1 + kd * ZOOMK)) * breathe;
    oc.save();
    oc.translate(w / 2 + p.dx * w * (1 + kd * SHIFTK), h / 2 + p.dy * h * (1 + kd * SHIFTK));
    oc.rotate(rot);
    oc.scale(s, s);
    oc.translate(-w / 2, -h / 2);
    oc.drawImage(c, 0, 0);
    oc.restore();
  }

  function draw(p, breathe, coverage, grain) {
    oc.setTransform(1, 0, 0, 1, 0, 0);
    oc.globalAlpha = 1;
    oc.globalCompositeOperation = "source-over";
    oc.fillStyle = "#000";
    oc.fillRect(0, 0, w, h);

    layer(backdrop, BACKDROP_DEPTH, p, p.rot * 0.3, breathe, coverage);
    layer(base, subject, p, p.rot, breathe, coverage);

    oc.setTransform(1, 0, 0, 1, 0, 0);
    if (grain > 0) {
      const gm = grainPlate.m;
      const span = gm * 2;
      oc.save();
      oc.globalAlpha = grain;
      oc.globalCompositeOperation = "overlay";
      oc.drawImage(grainPlate.canvas, -gm + Math.floor(Math.random() * span), -gm + Math.floor(Math.random() * span));
      oc.globalAlpha = grain * 0.5;
      oc.drawImage(grainPlate.canvas, -gm + Math.floor(Math.random() * span), -gm + Math.floor(Math.random() * span));
      oc.restore();
    }
    oc.drawImage(vignette, 0, 0);
  }

  return { canvas: out, kind: "2d", draw };
}

/** True if this browser can produce a clip from a canvas at all. */
export function offlineSupport() {
  return typeof MediaRecorder !== "undefined" && !!videoMime() && typeof document.createElement("canvas").captureStream === "function";
}

/** Keeps the canvas in the document so the recorder captures real frames. */
function mountCanvas(cv) {
  cv.style.cssText = "position:fixed;left:0;top:0;width:1px;height:1px;opacity:0.01;pointer-events:none;z-index:-1";
  document.body.appendChild(cv);
  return () => {
    try {
      cv.remove();
    } catch {}
  };
}

/**
 * Render a camera-move clip from one still.
 * @returns {Promise<{blob:Blob,width:number,height:number,duration:number,fps:number,lastFrame:Blob|null,frames:Blob[]}>}
 */
export async function renderMotionClip(opts) {
  const {
    image,
    duration = 5,
    width = 832,
    height = 480,
    fps = 30,
    cameraMove = "auto",
    cameraAngle = "off",
    tracking = "off",
    trackStrength = 0.6,
    motionScale = 1,
    grain = GRAIN,
    onProgress,
    signal,
  } = opts;

  if (!image) throw new Error("A reference image is needed for the offline renderer.");
  const mime = videoMime();
  const rate = snapFps(fps, 30);
  if (!hasVideoEncoder() && (typeof MediaRecorder === "undefined" || !mime)) {
    throw new Error("This browser cannot encode video from a canvas (neither WebCodecs nor MediaRecorder is available).");
  }

  const w = Math.max(160, Math.round(width));
  const h = Math.max(90, Math.round(height));
  const src = await loadImage(image);
  onProgress?.(0.02, "analysing depth");
  const depth = buildDepth(src, w, h);
  const rowDepth = buildRowProfile(depth, WARP_LINES);

  const rig =
    buildGLRig(w, h, buildMainTexture(src, w, h, EDGE), buildBackdrop(src, w, h), rowDepth) ||
    build2DRig(w, h, src, rowDepth);
  if (rig.kind === "2d") console.warn("offline rig: WebGL unavailable, falling back to the CPU camera rig");
  const out = rig.canvas;
  const unmount = mountCanvas(out);

  const move = MOVES[cameraMove] || MOVES.auto;
  const angle = ANGLES[cameraAngle] || {};
  const amp = clamp(motionScale, 0.15, 2);
  const total = Math.max(0.5, duration);

  const baseScale = angle.scale || 1;
  const baseRot = (angle.rot || 0) * (Math.PI / 180);
  const baseDx = angle.dx || 0;
  const baseDy = angle.dy || 0;
  const spanX = Math.max(Math.abs(move.dx[0]), Math.abs(move.dx[1])) * amp;
  const spanY = Math.max(Math.abs(move.dy[0]), Math.abs(move.dy[1])) * amp;
  const coverage = 1 + 2 * Math.max(spanX, spanY) * (1 + 0.5 * PARALLAX * SHIFTK) + 0.04;

  function draw(t) {
    const e = ease(clamp(t, 0, 1));
    const trackOn = tracking && tracking !== "off";
    const trackAmt = trackOn ? clamp(trackStrength ?? 0.6, 0, 1) : 0;
    const rawWob = move.shake ? Math.sin(t * 22) * 0.5 + Math.sin(t * 9.3) * 0.5 : 0;
    const wob = rawWob * (trackOn ? 1 - trackAmt * 0.85 : 1);
    const p = {
      dx: (lerp(move.dx[0], move.dx[1], e) * amp + baseDx) * (trackOn ? 1 - trackAmt * 0.35 : 1),
      dy: (lerp(move.dy[0], move.dy[1], e) * amp + baseDy) * (trackOn ? 1 - trackAmt * 0.35 : 1),
      scale: baseScale * (move.zoom ? lerp(move.scale[0], move.scale[1], e) : move.scale[0]) * (trackOn ? 1 + trackAmt * 0.03 * Math.sin(t * Math.PI) : 1),
      rot: baseRot + lerp(move.rot[0], move.rot[1], e) * (Math.PI / 180) * amp + wob * 0.004,
    };
    const breathe = 1 + Math.sin(t * Math.PI * 2) * 0.0018;
    rig.draw(p, breathe, coverage, grain);
  }

  async function grab(t, quality) {
    draw(t);
    return await new Promise((res) => out.toBlob(res, "image/jpeg", quality));
  }

  async function collectShots() {
    const frames = [];
    for (let i = 0; i < 6; i++) frames.push(await grab((i + 0.5) / 6, 0.68));
    const last = await grab(1, 0.94);
    return { frames, last };
  }

  draw(0);
  onProgress?.(0.06, "encoding");

  try {
    const encoded = await encodeCanvasClip({
      canvas: out,
      fps: rate,
      duration: total,
      draw: (t) => draw(t),
      mimeType: mime || undefined,
      onProgress: (f) => onProgress?.(0.06 + 0.86 * f, "encoding"),
      signal,
    });
    let shots = { frames: [], last: null };
    try {
      shots = await collectShots();
    } catch {}
    return {
      blob: encoded.blob,
      width: w,
      height: h,
      duration: encoded.duration,
      fps: encoded.fps,
      encoder: encoded.encoder,
      lastFrame: shots.last,
      frames: shots.frames,
    };
  } finally {
    unmount();
  }
}
