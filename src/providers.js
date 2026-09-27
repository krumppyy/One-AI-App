import { MUAPI_MODELS } from "./muapi-models.js";
import { freshName } from "./anon.js";

export const ASPECTS = {
  "16:9": { label: "16:9 Widescreen", ratio: 16 / 9, default: true },
  "9:16": { label: "9:16 Vertical", ratio: 9 / 16 },
  "1:1": { label: "1:1 Square", ratio: 1 },
  "4:3": { label: "4:3 Standard", ratio: 4 / 3 },
  "3:4": { label: "3:4 Portrait", ratio: 3 / 4 },
  "3:2": { label: "3:2 Classic landscape", ratio: 3 / 2 },
  "2:3": { label: "2:3 Classic portrait", ratio: 2 / 3 },
  "4:5": { label: "4:5 Portrait", ratio: 4 / 5 },
  "16:10": { label: "16:10 Widescreen", ratio: 16 / 10 },
  "2:1": { label: "2:1 Univisium", ratio: 2 / 1 },
  "21:9": { label: "21:9 Ultrawide", ratio: 21 / 9 },
};

export const QUALITIES = {
  "480p": { label: "480p Standard", target: 480 },
  "720p": { label: "720p HD", target: 720 },
  "1080p": { label: "1080p Full HD", target: 1080 },
  "2K": { label: "2K Quad HD", target: 1440 },
  "4K": { label: "4K Ultra HD", target: 2160 },
};

/* Per-style negative presets (external master roadmap §24; see src/REVIEW.md). A realistic style must forbid the
   cartoon look and vice-versa, or a "photoreal" run drifts into illustration
   and an "anime" run drifts into a photograph. Appended by buildNegative() in
   src/engine.js, on top of the user's own negative (when given) or the default. */
export const NEG_REALISM = "anime, cartoon, illustration, painting, drawing, cgi, 3d render, plastic skin";
export const NEG_ANIME = "photorealistic, photograph, live action, 3d render, realistic skin texture";
export const NEG_ART = "photograph, photorealistic, 3d render, live action, cgi";
export const NEG_3D = "flat 2d, sketch, drawing, photograph, grainy film";
export const NEG_CINEMA = "home video, amateur footage, flat lighting, soap opera look";

/* Grouped style catalogue (external master roadmap §7; see src/REVIEW.md). `group` becomes an <optgroup> in the
   Look & feel select; `phrase` is appended to the prompt; `negative` is the
   per-style negative preset above. Ids are stable — they are saved settings. */
export const STYLES = [
  { id: "none", label: "No style", group: "Basic", phrase: "" },

  // ------------------------------------------------------------- realistic
  { id: "photoreal", label: "Photorealistic", group: "Realistic", phrase: "photorealistic, ultra detailed, natural lighting, 8k photography", negative: NEG_REALISM },
  { id: "hyperreal", label: "Hyperreal detail", group: "Realistic", phrase: "hyperrealistic, razor-sharp micro detail, skin pores, true-to-life", negative: NEG_REALISM },
  { id: "natural", label: "Natural photography", group: "Realistic", phrase: "natural light photography, candid, unposed, true colour", negative: NEG_REALISM },
  { id: "studio", label: "Studio lighting", group: "Realistic", phrase: "professional studio lighting, softbox key, clean seamless backdrop", negative: NEG_REALISM },
  { id: "documentary", label: "Documentary", group: "Realistic", phrase: "documentary photography, available light, honest unstaged realism", negative: NEG_REALISM },
  { id: "portrait", label: "Portrait photography", group: "Realistic", phrase: "professional portrait, 85mm lens, shallow depth of field, soft key light, catchlights", negative: NEG_REALISM },
  { id: "beauty", label: "Beauty editorial", group: "Realistic", phrase: "beauty editorial, flawless skin, glossy highlight, magazine cover finish", negative: NEG_REALISM },
  { id: "fashion", label: "Fashion editorial", group: "Realistic", phrase: "high fashion editorial, styled, dramatic pose, vogue lighting", negative: NEG_REALISM },
  { id: "product", label: "Product commercial", group: "Realistic", phrase: "product cinematography, macro detail, controlled reflections, commercial grade", negative: NEG_REALISM },
  { id: "wedding", label: "Wedding cinematography", group: "Realistic", phrase: "wedding film, warm romantic light, bokeh, delicate colour grade", negative: NEG_REALISM },
  { id: "travel", label: "Travel film", group: "Realistic", phrase: "travel film, sweeping scenery, vivid but natural colour, golden light", negative: NEG_REALISM },
  { id: "vlog", label: "Vlog / handheld", group: "Realistic", phrase: "vlog camera, handheld, wide lens, casual natural framing", negative: NEG_REALISM },
  { id: "street", label: "Street photography", group: "Realistic", phrase: "street photography, candid moment, urban texture, natural grain", negative: NEG_REALISM },
  { id: "golden_hour", label: "Golden hour", group: "Realistic", phrase: "golden hour sunlight, warm rim light, long soft shadows", negative: NEG_REALISM },
  { id: "low_key", label: "Low-key dramatic", group: "Realistic", phrase: "low-key lighting, deep shadow, single hard key, chiaroscuro", negative: NEG_REALISM },

  // ------------------------------------------------------------- cinematic
  { id: "cinematic", label: "Cinematic", group: "Cinematic", phrase: "cinematic film still, dramatic lighting, shallow depth of field, 35mm", negative: NEG_CINEMA },
  { id: "hollywood", label: "Hollywood blockbuster", group: "Cinematic", phrase: "Hollywood blockbuster, anamorphic flare, teal and orange grade, epic scale", negative: NEG_CINEMA },
  { id: "epic", label: "Epic / sweeping", group: "Cinematic", phrase: "epic cinematic scale, vast landscape, awe-inspiring composition", negative: NEG_CINEMA },
  { id: "noir", label: "Neo-noir", group: "Cinematic", phrase: "neo-noir, rain-slick streets, hard shadows, moody neon pools of light", negative: NEG_CINEMA },
  { id: "film_noir", label: "Classic film noir", group: "Cinematic", phrase: "classic 1940s film noir, black and white, venetian blind shadows, cigarette smoke", negative: NEG_CINEMA },
  { id: "vintage", label: "Vintage film", group: "Cinematic", phrase: "vintage 16mm film, grain, halation, faded colors, 1970s", negative: NEG_CINEMA },
  { id: "scifi_cinema", label: "Sci-fi cinema", group: "Cinematic", phrase: "science fiction cinema, practical sets, volumetric light, cold palette", negative: NEG_CINEMA },
  { id: "fantasy_cinema", label: "Fantasy cinema", group: "Cinematic", phrase: "fantasy cinema, painterly light, ornate detail, mythic atmosphere", negative: NEG_CINEMA },
  { id: "period", label: "Period drama", group: "Cinematic", phrase: "period drama, authentic costume, soft window light, muted period grade", negative: NEG_CINEMA },
  { id: "romantic", label: "Romantic", group: "Cinematic", phrase: "romantic cinema, soft focus glow, warm bokeh, tender mood", negative: NEG_CINEMA },
  { id: "action", label: "Action", group: "Cinematic", phrase: "action cinema, dynamic motion blur, high contrast, kinetic energy", negative: NEG_CINEMA },
  { id: "thriller", label: "Thriller", group: "Cinematic", phrase: "thriller atmosphere, tense framing, cold desaturated grade, deep shadow", negative: NEG_CINEMA },
  { id: "western", label: "Western", group: "Cinematic", phrase: "western, dusty desert light, wide vistas, sun-bleached colour", negative: NEG_CINEMA },
  { id: "arthouse", label: "Arthouse", group: "Cinematic", phrase: "arthouse film, unconventional framing, natural light, restrained palette", negative: NEG_CINEMA },

  // ------------------------------------------------------------- animation
  { id: "anime", label: "Anime", group: "Animation", phrase: "anime style, cel shaded, vibrant colors, studio anime key frame", negative: NEG_ANIME },
  { id: "anime_modern", label: "Modern anime", group: "Animation", phrase: "modern anime, crisp line art, luminous shading, film-quality key frame", negative: NEG_ANIME },
  { id: "anime_classic", label: "Classic 90s anime", group: "Animation", phrase: "1990s anime, hand-painted cells, retro grain, nostalgic palette", negative: NEG_ANIME },
  { id: "manga", label: "Manga / ink", group: "Animation", phrase: "manga illustration, bold ink linework, screentone shading, monochrome", negative: NEG_ANIME },
  { id: "cel", label: "Cel animation", group: "Animation", phrase: "traditional cel animation, flat colour fills, hand-drawn line", negative: NEG_ANIME },
  { id: "cartoon", label: "2D cartoon", group: "Animation", phrase: "2d cartoon, exaggerated shapes, bold outlines, bright flat colour", negative: NEG_ANIME },
  { id: "chibi", label: "Chibi", group: "Animation", phrase: "chibi style, big head small body, cute expressive, clean line", negative: NEG_ANIME },
  { id: "comic", label: "Comic book", group: "Animation", phrase: "comic book art, bold ink outline, halftone dots, dynamic panel", negative: NEG_ANIME },
  { id: "graphic_novel", label: "Graphic novel", group: "Animation", phrase: "graphic novel illustration, muted palette, textured ink wash", negative: NEG_ANIME },
  { id: "stopmotion", label: "Stop motion", group: "Animation", phrase: "stop motion animation, handmade miniature set, tactile felt and clay", negative: NEG_ANIME },
  { id: "clay", label: "Claymation", group: "Animation", phrase: "claymation stop motion, handmade clay textures, tactile", negative: NEG_ANIME },
  { id: "3d", label: "3D render", group: "Animation", phrase: "3d render, octane, subsurface scattering, soft global illumination", negative: NEG_3D },
  { id: "stylized3d", label: "Stylized 3D", group: "Animation", phrase: "stylized 3d animation, appealing shapes, soft rim light, cinematic render", negative: NEG_3D },
  { id: "pixel", label: "Pixel art", group: "Animation", phrase: "pixel art, 16-bit retro game sprite, crisp pixels", negative: "blurry, smooth gradient, photorealistic, 3d" },

  // ------------------------------------------------------------------- art
  { id: "watercolor", label: "Watercolor", group: "Art", phrase: "watercolor painting, soft washes, paper texture, loose brushwork", negative: NEG_ART },
  { id: "oil", label: "Oil painting", group: "Art", phrase: "oil painting, thick impasto brushwork, rich glazing, canvas texture", negative: NEG_ART },
  { id: "acrylic", label: "Acrylic painting", group: "Art", phrase: "acrylic painting, bold flat strokes, vivid pigment, matte finish", negative: NEG_ART },
  { id: "gouache", label: "Gouache", group: "Art", phrase: "gouache illustration, opaque matte colour, soft edges, picture-book charm", negative: NEG_ART },
  { id: "ink", label: "Ink illustration", group: "Art", phrase: "ink illustration, confident pen strokes, crosshatching, high contrast", negative: NEG_ART },
  { id: "pencil", label: "Pencil sketch", group: "Art", phrase: "pencil sketch, graphite hatching, paper grain, hand-drawn study", negative: NEG_ART },
  { id: "charcoal", label: "Charcoal", group: "Art", phrase: "charcoal drawing, smudged darks, expressive strokes, textured paper", negative: NEG_ART },
  { id: "pastel", label: "Soft pastel", group: "Art", phrase: "soft pastel drawing, chalky texture, luminous colour, gentle edges", negative: NEG_ART },
  { id: "digital_paint", label: "Digital painting", group: "Art", phrase: "digital painting, painterly rendering, dramatic light, concept art quality", negative: NEG_ART },
  { id: "concept_art", label: "Concept art", group: "Art", phrase: "production concept art, bold shapes, atmospheric depth, design-forward", negative: NEG_ART },
  { id: "matte", label: "Matte painting", group: "Art", phrase: "matte painting, epic environment, painted realism, cinematic scale", negative: NEG_ART },
  { id: "art_nouveau", label: "Art nouveau", group: "Art", phrase: "art nouveau, flowing organic line, ornamental frame, decorative pattern", negative: NEG_ART },
  { id: "art_deco", label: "Art deco", group: "Art", phrase: "art deco, geometric symmetry, gilded accents, 1920s glamour", negative: NEG_ART },
  { id: "impressionist", label: "Impressionist", group: "Art", phrase: "impressionist painting, broken colour, visible brushstrokes, dappled light", negative: NEG_ART },
  { id: "surreal", label: "Surrealist", group: "Art", phrase: "surrealist painting, dreamlike impossible scene, symbolic imagery", negative: NEG_ART },
  { id: "minimalist", label: "Minimalist", group: "Art", phrase: "minimalist art, generous negative space, restrained palette, simple shapes", negative: NEG_ART },
  { id: "expressionist", label: "Expressionist", group: "Art", phrase: "expressionist painting, distorted form, emotional colour, raw energy", negative: NEG_ART },

  // -------------------------------------------------------- fantasy and scifi
  { id: "dark_fantasy", label: "Dark fantasy", group: "Fantasy & Sci-fi", phrase: "dark fantasy, gothic atmosphere, ominous light, weathered detail", negative: NEG_CINEMA },
  { id: "high_fantasy", label: "High fantasy", group: "Fantasy & Sci-fi", phrase: "high fantasy, luminous magic, sweeping vista, ornate armour", negative: NEG_CINEMA },
  { id: "mythic", label: "Mythological", group: "Fantasy & Sci-fi", phrase: "mythological scene, heroic scale, classical composition, divine light", negative: NEG_CINEMA },
  { id: "cyberpunk", label: "Cyberpunk", group: "Fantasy & Sci-fi", phrase: "cyberpunk, neon rim light, rain slicked, blade runner mood", negative: NEG_CINEMA },
  { id: "steampunk", label: "Steampunk", group: "Fantasy & Sci-fi", phrase: "steampunk, brass and leather, clockwork machinery, victorian industrial", negative: NEG_CINEMA },
  { id: "solarpunk", label: "Solarpunk", group: "Fantasy & Sci-fi", phrase: "solarpunk, lush greenery over clean technology, hopeful bright future", negative: NEG_CINEMA },
  { id: "space_opera", label: "Space opera", group: "Fantasy & Sci-fi", phrase: "space opera, vast nebula, sleek starships, operatic scale", negative: NEG_CINEMA },
  { id: "futuristic", label: "Futuristic", group: "Fantasy & Sci-fi", phrase: "sleek futuristic design, holographic interface, clean minimal tech", negative: NEG_CINEMA },
  { id: "post_apoc", label: "Post-apocalyptic", group: "Fantasy & Sci-fi", phrase: "post-apocalyptic, overgrown ruins, dust haze, survival grit", negative: NEG_CINEMA },
  { id: "dreamscape", label: "Dreamscape", group: "Fantasy & Sci-fi", phrase: "dreamlike dreamscape, soft impossible physics, ethereal glow", negative: NEG_CINEMA },
  { id: "alien_world", label: "Alien world", group: "Fantasy & Sci-fi", phrase: "alien planet, otherworldly flora, strange sky, bioluminescent detail", negative: NEG_CINEMA },

  // ----------------------------------------------------------- film & camera
  { id: "film35", label: "35mm film", group: "Film & camera", phrase: "shot on 35mm film, fine grain, natural halation, filmic highlight rolloff", negative: NEG_CINEMA },
  { id: "super8", label: "Super 8", group: "Film & camera", phrase: "super 8 film, heavy grain, warm colour shift, gate weave, home-movie charm", negative: NEG_CINEMA },
  { id: "technicolor", label: "Technicolor", group: "Film & camera", phrase: "technicolor, saturated primaries, studio-era glamour, rich contrast", negative: NEG_CINEMA },
  { id: "bw", label: "Black & white", group: "Film & camera", phrase: "black and white, fine tonal range, sculpted contrast, monochrome", negative: NEG_CINEMA },
  { id: "high_contrast", label: "High contrast", group: "Film & camera", phrase: "high contrast, crushed blacks, brilliant highlights, graphic punch", negative: NEG_CINEMA },
  { id: "polaroid", label: "Polaroid / instant", group: "Film & camera", phrase: "polaroid instant photo, soft focus, faded colour, white border feel", negative: NEG_CINEMA },
  { id: "neon", label: "Neon glow", group: "Film & camera", phrase: "saturated neon glow, magenta and cyan light spill, wet reflections", negative: NEG_CINEMA },
  { id: "infrared", label: "Infrared", group: "Film & camera", phrase: "infrared film look, glowing white foliage, surreal false colour", negative: NEG_CINEMA },
  { id: "time_lapse", label: "Time-lapse", group: "Film & camera", phrase: "time-lapse, fast drifting clouds and light, accelerated motion", negative: NEG_CINEMA },
  { id: "slowmo", label: "Slow motion", group: "Film & camera", phrase: "slow motion, ultra-smooth temporal detail, dramatic suspended moment", negative: NEG_CINEMA },
];

// How the ✨ Auto-enhance writer should treat the user's idea. Each mode is a
// sentence spliced into one shared system instruction, so the modes stay
// consistent in tone while differing in length and specificity.
export const ENHANCE_MODES = [
  { id: "cinematic", label: "Cinematic", directive:
    "Rewrite the user's idea into ONE vivid English prompt of 35-60 words, written as a single line of comma-separated phrases. " +
    "Cover, in this order: the subject and what it does, how the camera moves, the shot angle, the lighting and mood, and fine surface detail." },
  { id: "exact", label: "Faithful / exact", directive:
    "Rewrite the user's idea into ONE English prompt of 20-40 words, written as a single line of comma-separated phrases. " +
    "Stay strictly faithful to what the idea states; add only the lighting, camera and motion detail the idea already implies, and invent nothing new." },
  { id: "concise", label: "Short & punchy", directive:
    "Rewrite the user's idea into ONE terse English prompt of 12-25 words, written as a single line of comma-separated phrases. " +
    "Keep only the essential visual phrases — subject, action, camera, light — and drop everything else." },
  { id: "technical", label: "Technical / camera spec", directive:
    "Rewrite the user's idea into ONE English prompt of 45-80 words in professional film language. " +
    "Name the lens focal length and aperture, the shutter/shutter-speed feel, the exact camera movement or rig, the lighting setup and colour grade, and the material and texture detail — all as comma-separated phrases." },
];

export const CAMERA_MOVES = [
  { id: "auto", label: "Auto (model decides)", phrase: "", scope: null },
  { id: "static", label: "Static / Locked off", phrase: "static locked-off camera, no camera movement", scope: null },
  { id: "dolly_in", label: "Dolly in (push)", phrase: "camera slowly dollies in toward the subject", scope: "dolly_in" },
  { id: "dolly_out", label: "Dolly out (pull back)", phrase: "camera slowly pulls back away from the subject", scope: "dolly_out" },
  { id: "pan_left", label: "Pan left", phrase: "camera pans left", scope: "truck_left" },
  { id: "pan_right", label: "Pan right", phrase: "camera pans right", scope: "truck_right" },
  { id: "tilt_up", label: "Tilt up", phrase: "camera tilts upward", scope: "crane_up_fwd" },
  { id: "tilt_down", label: "Tilt down", phrase: "camera tilts downward", scope: null },
  { id: "orbit_left", label: "Orbit left", phrase: "camera orbits around the subject to the left", scope: "orbit_left" },
  { id: "orbit_right", label: "Orbit right", phrase: "camera orbits around the subject to the right", scope: "wide_orbit" },
  { id: "crane_up", label: "Crane up", phrase: "crane shot rising upward and forward", scope: "crane_up_fwd" },
  { id: "zoom_in", label: "Zoom in", phrase: "slow zoom in", scope: "dolly_in" },
  { id: "zoom_out", label: "Zoom out", phrase: "slow zoom out", scope: "dolly_out" },
  { id: "handheld", label: "Handheld", phrase: "handheld camera, subtle organic shake, documentary feel", scope: null },
  { id: "tracking", label: "Tracking / follow", phrase: "tracking shot following the subject", scope: "snake_fwd" },
  { id: "aerial", label: "Aerial / drone", phrase: "aerial drone shot, sweeping over the scene", scope: "flyover_left" },
  { id: "flythrough", label: "Fly through", phrase: "camera flies forward through the scene", scope: "flyover_left" },
  { id: "spiral", label: "Spiral / rise", phrase: "camera spirals upward around the subject", scope: "spiral_climb" },
];

export const CAMERA_ANGLES = [
  { id: "off", label: "Off — no angle forced", phrase: "" },
  { id: "auto", label: "Auto (model decides)", phrase: "" },
  { id: "eye", label: "Eye level", phrase: "eye-level shot" },
  { id: "low", label: "Low angle", phrase: "low angle shot looking up at the subject" },
  { id: "high", label: "High angle", phrase: "high angle shot looking down" },
  { id: "dutch", label: "Dutch tilt", phrase: "dutch angle, tilted horizon" },
  { id: "birds", label: "Bird's eye / top-down", phrase: "bird's eye view, top down" },
  { id: "worms", label: "Worm's eye", phrase: "worm's eye view from ground level" },
  { id: "close", label: "Close-up", phrase: "close-up shot" },
  { id: "macro", label: "Extreme macro", phrase: "extreme macro close-up, fine detail" },
  { id: "medium", label: "Medium shot", phrase: "medium shot" },
  { id: "wide", label: "Wide / establishing", phrase: "wide establishing shot" },
  { id: "ots", label: "Over the shoulder", phrase: "over-the-shoulder shot" },
  { id: "pov", label: "POV", phrase: "first person point of view shot" },
];

export const TRACKING_MODES = [
  { id: "off", label: "Off", phrase: "" },
  { id: "face", label: "Face lock — keep face centered", phrase: "camera tracks and keeps the subject's face centered in frame" },
  { id: "subject", label: "Subject follow — follow the body", phrase: "camera follows the subject, keeping them framed as they move" },
  { id: "orbit_track", label: "Orbit track — circle the subject", phrase: "camera orbits around the moving subject, keeping them centered" },
  { id: "push_track", label: "Push-in track — dolly with subject", phrase: "camera pushes in while tracking the moving subject" },
  { id: "stabilize", label: "Stabilize — lock horizon on subject", phrase: "locked stabilized shot, subject held steady in frame, smooth damped camera" },
];

export const DEFAULT_NEGATIVE =
  "worst quality, low quality, blurry, jittery, distorted, oversaturated, overexposed, " +
  "static frozen frame, duplicate limbs, extra fingers, deformed hands, malformed face, " +
  "watermark, text, subtitles, logo, signature, flicker, morphing artifacts, " +
  "inconsistent motion, ghosting, compression artifacts";

export const NSFW_NEGATIVE =
  "censorship, mosaic, pixelated, blurred, covered, clothes overlays";

export const NSFW_BOOST =
  "explicit adult content, uncensored, unfiltered, raw";

export function dimsFor(aspect, quality, provider) {
  let target = QUALITIES[quality]?.target ?? 480;
  if (provider?.tier === "free" && target > 720) target = 720;
  const table = {
    "16:9": [832, 480],
    "9:16": [480, 832],
    "1:1": [640, 640],
    "4:3": [704, 528],
    "3:4": [528, 704],
    "3:2": [768, 512],
    "2:3": [512, 768],
    "4:5": [576, 720],
    "16:10": [768, 480],
    "2:1": [864, 432],
    "21:9": [896, 384],
  };
  let [w, h] = table[aspect] || table["16:9"];
  if (target !== 480) {
    const scale = target / 480;
    w = Math.round((w * scale) / 32) * 32;
    h = Math.round((h * scale) / 32) * 32;
  }
  if (provider?.clamp) {
    const c = provider.clamp(w, h);
    w = c[0];
    h = c[1];
  }
  // A model with a native resolution above what was asked for is rendered at its
  // native size instead (a 14B 720p model fed 480p invents mush) — the server
  // does the same thing, so this keeps the two in step.
  if (provider?.native && Math.max(w, h) < provider.native) {
    const scale = provider.native / Math.max(w, h);
    w = Math.max(256, Math.floor((w * scale) / 16) * 16);
    h = Math.max(256, Math.floor((h * scale) / 16) * 16);
  }
  return [w, h];
}

function snap8n1(v) {
  return Math.max(9, Math.min(257, Math.round((v - 1) / 8) * 8 + 1));
}

async function blobToDataUrl(blob) {
  return await new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(blob);
  });
}

/**
 * Wrap a picture for a Space's file input.
 *
 * The filename is re-minted for every run (src/anon.js): the same picture sent
 * on five runs arrives as five different names, so an endpoint cannot link the
 * runs by name. The picture itself has already been through `stripMetadata`
 * (src/image.js) on the way in, so it carries no EXIF either.
 */
export async function fileArg(ctx, blob, name = "input.png") {
  if (!blob) return null;
  const nm = freshName(name);
  if (ctx.uploadBlob) {
    try {
      return await ctx.uploadBlob(blob, nm);
    } catch (e) {
      /* fall through to inline data url */
    }
  }
  const dataUrl = await blobToDataUrl(blob);
  return { path: dataUrl, url: dataUrl, meta: { _type: "gradio.FileData" }, orig_name: nm };
}

export const VIDEO_EXT = ["mp4", "webm", "mov", "mkv", "gif", "avi"];

export const HF_ENDPOINT_IDS = {
  wan22_14b: "Upsampler/wan-2-2-14b-image-to-video",
  wan22_fast: "zerogpu-aoti/wan2-2-fp8da-aoti-faster",
  wan22_preview: "r3gm/wan2-2-fp8da-aoti-preview",
  wan22_preview2: "r3gm/wan2-2-fp8da-aoti-preview2",
  wan22_rcm: "linoyts/wan2-2-i2v-rCM",
  wan_flf: "multimodalart/wan-2-2-first-last-frame",
  wan21_fast: "multimodalart/wan2-1-fast",
  ltx_fast: "Lightricks/ltx-video-distilled",
  svd: "mediasynthesismuseum/stable-video-diffusion",
  scope: "TencentARC/scope-camera-video-generation",
  wan22_nsfw: "tmtanu/wan2.2_14b_i2v_480p_lightning_nsfw_diffusers",
  uncensored_video2: "hf-Asdqqq/Uncensored-video2",
  minimax_uncensored: "Pepe104/MiniMax-H3-Turbo-Lora-UNCENSORED",
  hunyuan15: "multimodalart/Hunyuan-Video-1-5",
};

export const PROVIDERS = [
  {
    id: "wan22_14b",
    fps: 16,
    kind: "gradio",
    label: "Wan 2.2 14B",
    vendor: "Alibaba Wan (open source)",
    tier: "free",
    space: "https://upsampler-wan-2-2-14b-image-to-video.hf.space",
    endpoint: "generate_video",
    minSec: 0.5,
    maxSec: 5,
    estSecs: 75,
    quality: 5,
    caps: { i2v: true, t2v: false, endFrame: true, camera: false, nsfw: false, resolution: false, multiRef: false, singleImage: true },
    note: "Balanced quality. Reference image required.",
    async build(ctx) {
      const img = await fileArg(ctx, ctx.image, "start.png");
      const end = ctx.endImage ? await fileArg(ctx, ctx.endImage, "end.png") : null;
      return {
        named: {
          input_image: img,
          prompt: ctx.prompt,
          steps: ctx.steps ?? 6,
          negative_prompt: ctx.negative,
          duration_seconds: ctx.duration,
          guidance_scale: 1,
          guidance_scale_2: 1,
          seed: ctx.seed,
          randomize_seed: false,
          end_image: end,
        },
      };
    },
  },
  {
    id: "wan22_fast",
    fps: 16,
    kind: "gradio",
    label: "Wan 2.2 14B Turbo",
    vendor: "Alibaba Wan (open source)",
    tier: "free",
    space: "https://zerogpu-aoti-wan2-2-fp8da-aoti-faster.hf.space",
    endpoint: "generate_video",
    minSec: 0.5,
    maxSec: 5,
    estSecs: 45,
    quality: 5,
    caps: { i2v: true, t2v: false, endFrame: false, camera: false, nsfw: false, resolution: false, multiRef: false, singleImage: true },
    note: "Distilled AoTI build - roughly 2x faster than the base 14B.",
    async build(ctx) {
      const img = await fileArg(ctx, ctx.image, "start.png");
      return {
        named: {
          input_image: img,
          prompt: ctx.prompt,
          steps: ctx.steps ?? 6,
          negative_prompt: ctx.negative,
          duration_seconds: ctx.duration,
          guidance_scale: 1,
          guidance_scale_2: 1,
          seed: ctx.seed,
          randomize_seed: false,
        },
      };
    },
  },
  {
    id: "wan22_preview",
    fps: 16,
    kind: "gradio",
    label: "Wan 2.2 14B Preview",
    vendor: "Alibaba Wan (open source)",
    tier: "free",
    space: "https://r3gm-wan2-2-fp8da-aoti-preview.hf.space",
    endpoint: "generate_video",
    minSec: 0.5,
    maxSec: 5,
    estSecs: 60,
    quality: 4,
    caps: { i2v: true, t2v: false, endFrame: true, camera: false, nsfw: true, resolution: false, multiRef: false, singleImage: true },
    note: "Community mirror with an optional end frame. Its own safety checker can be switched off (the app does that when NSFW is on).",
    // The Space grew parameters (17 now), so the adapter names its values and
    // the engine lays them out to match whatever the Space reports today.
    async build(ctx) {
      const img = await fileArg(ctx, ctx.image, "start.png");
      const end = ctx.endImage ? await fileArg(ctx, ctx.endImage, "end.png") : null;
      const nsfw = !!ctx.nsfw;
      return {
        named: {
          input_image: img,
          last_image: end,
          prompt: ctx.prompt,
          steps: ctx.steps ?? 6,
          negative_prompt: ctx.negative,
          duration_seconds: ctx.duration,
          guidance_scale: 1,
          guidance_scale_2: 1,
          seed: ctx.seed,
          randomize_seed: false,
          quality: 6,
          scheduler: "UniPCMultistep",
          flow_shift: 3,
          frame_multiplier: 16,
          video_component: true,
          safe_mode: !nsfw,
          enable_safety_checker: !nsfw,
        },
      };
    },
  },
  {
    id: "wan22_preview2",
    fps: 16,
    kind: "gradio",
    label: "Wan 2.2 14B Preview II",
    vendor: "Alibaba Wan (open source)",
    tier: "free",
    space: "https://r3gm-wan2-2-fp8da-aoti-preview2.hf.space",
    endpoint: "generate_video",
    minSec: 0.5,
    maxSec: 5,
    estSecs: 60,
    quality: 4,
    caps: { i2v: true, t2v: false, endFrame: true, camera: false, nsfw: true, resolution: false, multiRef: false, singleImage: true },
    note: "Second mirror of the same build — verified live, and it can upscale the result. Its safety checker can be switched off too.",
    async build(ctx) {
      const img = await fileArg(ctx, ctx.image, "start.png");
      const end = ctx.endImage ? await fileArg(ctx, ctx.endImage, "end.png") : null;
      const nsfw = !!ctx.nsfw;
      return {
        named: {
          input_image: img,
          last_image: end,
          prompt: ctx.prompt,
          steps: ctx.steps ?? 6,
          negative_prompt: ctx.negative,
          duration_seconds: ctx.duration,
          guidance_scale: 1,
          guidance_scale_2: 1,
          seed: ctx.seed,
          randomize_seed: false,
          quality: 6,
          scheduler: "UniPCMultistep",
          flow_shift: 3,
          frame_multiplier: 16,
          upscale_model: "2xNomosUni_compact_otf_medium",
          upscale_factor: 1,
          video_component: true,
          safe_mode: !nsfw,
          enable_safety_checker: !nsfw,
        },
      };
    },
  },
  {
    id: "wan22_rcm",
    fps: 16,
    kind: "gradio",
    label: "Wan 2.2 rCM (fast)",
    vendor: "Linoy Tsaban / Alibaba Wan",
    tier: "free",
    space: "https://linoyts-wan2-2-i2v-rcm.hf.space",
    endpoint: "generate_video",
    minSec: 0.5,
    maxSec: 5,
    estSecs: 30,
    quality: 4,
    caps: { i2v: true, t2v: false, endFrame: false, camera: false, nsfw: false, resolution: false, multiRef: false, singleImage: true },
    note: "Consistency-model distill of Wan 2.2 — a handful of steps, so it is quick.",
    async build(ctx) {
      const img = await fileArg(ctx, ctx.image, "start.png");
      return {
        named: {
          input_image: img,
          prompt: ctx.prompt,
          steps: ctx.steps ?? 6,
          negative_prompt: ctx.negative,
          duration_seconds: ctx.duration,
          guidance_scale: 1,
          guidance_scale_2: 1,
          seed: ctx.seed,
          randomize_seed: false,
        },
      };
    },
  },
  {
    id: "wan_flf",
    fps: 16,
    kind: "gradio",
    label: "Wan 2.2 First/Last Frame",
    vendor: "Alibaba Wan (open source)",
    tier: "free",
    space: "https://multimodalart-wan-2-2-first-last-frame.hf.space",
    endpoint: "generate_video",
    minSec: 0.5,
    maxSec: 5,
    estSecs: 70,
    quality: 5,
    caps: { i2v: true, t2v: false, endFrame: true, camera: false, nsfw: false, resolution: false, multiRef: false, singleImage: true },
    note: "Can be given an END frame too - great for guided shots and smooth scene chaining.",
    async build(ctx) {
      const img = await fileArg(ctx, ctx.image, "start.png");
      const end = ctx.endImage ? await fileArg(ctx, ctx.endImage, "end.png") : null;
      return {
        named: {
          start_image_pil: img,
          end_image_pil: end,
          prompt: ctx.prompt,
          negative_prompt: ctx.negative,
          duration_seconds: ctx.duration,
          steps: ctx.steps ?? 8,
          guidance_scale: 1,
          guidance_scale_2: 1,
          seed: ctx.seed,
          randomize_seed: false,
        },
      };
    },
  },
  {
    id: "wan21_fast",
    fps: 16,
    kind: "gradio",
    label: "Wan 2.1 Fast",
    vendor: "Alibaba Wan (open source)",
    tier: "free",
    space: "https://multimodalart-wan2-1-fast.hf.space",
    endpoint: "generate_video",
    minSec: 0.3,
    maxSec: 3.4,
    estSecs: 35,
    quality: 4,
    caps: { i2v: true, t2v: false, endFrame: false, camera: false, nsfw: false, resolution: true, multiRef: false, singleImage: true },
    clamp: (w, h) => [Math.min(896, Math.max(128, w)), Math.min(896, Math.max(128, h))],
    note: "Older 2.1 model, but very fast and it lets you set exact output dimensions.",
    async build(ctx) {
      const img = await fileArg(ctx, ctx.image, "start.png");
      return {
        named: {
          input_image: img,
          prompt: ctx.prompt,
          height: ctx.size?.[1] ?? 480,
          width: ctx.size?.[0] ?? 832,
          negative_prompt: ctx.negative,
          duration_seconds: ctx.duration,
          guidance_scale: 1,
          steps: ctx.steps ?? 4,
          seed: ctx.seed,
          randomize_seed: false,
        },
      };
    },
  },
  {
    id: "ltx_fast",
    fps: 24,
    kind: "gradio",
    label: "LTX Video 13B Fast",
    vendor: "Lightricks LTX (open source)",
    tier: "free",
    space: "https://lightricks-ltx-video-distilled.hf.space",
    endpoint: "image_to_video",
    minSec: 0.5,
    maxSec: 8.5,
    estSecs: 40,
    quality: 4,
    caps: { i2v: true, t2v: true, endFrame: false, camera: false, nsfw: false, resolution: true, improve: true },
    clamp: (w, h) => [Math.min(1280, Math.max(256, w)), Math.min(1280, Math.max(256, h))],
    note: "Fastest model here, up to 8.5s in one shot. Slightly softer detail than Wan.",
    async build(ctx) {
      const img = await fileArg(ctx, ctx.image, "start.png");
      const frames = snap8n1(Math.round(ctx.duration * 24));
      return {
        named: {
          prompt: ctx.prompt,
          negative_prompt: ctx.negative,
          input_image_filepath: img,
          input_video_filepath: null,
          height_ui: ctx.size?.[1] ?? 480,
          width_ui: ctx.size?.[0] ?? 832,
          mode: "image-to-video",
          duration_ui: ctx.duration,
          ui_frames_to_use: frames,
          seed_ui: ctx.seed,
          randomize_seed: false,
          ui_guidance_scale: 1,
          improve_texture_flag: true,
        },
      };
    },
  },
  {
    id: "cogvideox_5b",
    fps: 16,
    kind: "gradio",
    label: "CogVideoX 5B (Zhipu AI)",
    vendor: "THUDM / Zai-Org (open source)",
    tier: "free",
    space: "https://zai-org-cogvideox-5b-space.hf.space",
    endpoint: "generate",
    minSec: 1,
    maxSec: 6,
    estSecs: 50,
    quality: 5,
    caps: { i2v: true, t2v: true, endFrame: false, camera: false, nsfw: false, resolution: true },
    clamp: (w, h) => [Math.min(1024, Math.max(256, w)), Math.min(1024, Math.max(256, h))],
    note: "3D causal VAE diffusion transformer. Produces rich, smooth temporal motion.",
    async build(ctx) {
      const img = ctx.image ? await fileArg(ctx, ctx.image, "start.png") : null;
      return {
        named: {
          prompt: ctx.prompt,
          image_input: img,
          num_inference_steps: ctx.steps ?? 30,
          guidance_scale: 6,
          seed: ctx.seed ?? -1,
        },
      };
    },
  },
  {
    id: "wan21_14b",
    fps: 16,
    kind: "gradio",
    label: "Wan 2.1 14B High-Res",
    vendor: "Alibaba Wan (open source)",
    tier: "free",
    space: "https://wan-ai-wan2-1.hf.space",
    endpoint: "generate",
    minSec: 1,
    maxSec: 5,
    estSecs: 65,
    quality: 5,
    caps: { i2v: true, t2v: true, endFrame: false, camera: false, nsfw: false, resolution: true },
    clamp: (w, h) => [Math.min(1280, Math.max(256, w)), Math.min(1280, Math.max(256, h))],
    note: "Official Wan 2.1 14B model space with high fidelity image-to-video & text-to-video.",
    async build(ctx) {
      const img = ctx.image ? await fileArg(ctx, ctx.image, "start.png") : null;
      return {
        named: {
          input_image: img,
          prompt: ctx.prompt,
          negative_prompt: ctx.negative || "",
          duration_seconds: ctx.duration || 4,
          seed: ctx.seed ?? -1,
        },
      };
    },
  },
  {
    id: "scope",
    fps: 16,
    kind: "gradio",
    label: "SCOPE Camera Control",
    vendor: "Tencent ARC + Wan 2.2",
    tier: "free",
    space: "https://tencentarc-scope-camera-video-generation.hf.space",
    endpoint: "generate",
    minSec: 2,
    maxSec: 5,
    estSecs: 70,
    quality: 4,
    caps: { i2v: true, t2v: false, endFrame: false, camera: true, nsfw: false, resolution: false, multiRef: false, singleImage: true },
    note: "Trajectory-conditioned camera motion - it physically moves the camera along a 3D path.",
    async build(ctx) {
      const img = await fileArg(ctx, ctx.image, "start.png");
      const traj = ctx.cameraScope || "dolly_in";
      return {
        named: {
          image: img,
          prompt: ctx.prompt,
          trajectory: traj,
          steps: ctx.steps ?? 4,
          motion_scale: ctx.motionScale ?? 1,
          fov_degrees: 80.7,
          seed: ctx.seed,
          randomize_seed: false,
        },
      };
    },
  },
  {
    id: "svd",
    fps: 7,
    kind: "gradio",
    label: "Stable Video Diffusion",
    vendor: "Stability AI (open source)",
    tier: "free",
    space: "https://mediasynthesismuseum-stable-video-diffusion.hf.space",
    endpoint: "video",
    minSec: 2,
    maxSec: 4,
    estSecs: 50,
    quality: 3,
    caps: { i2v: true, t2v: false, endFrame: false, camera: false, nsfw: false, resolution: false, noPrompt: true, multiRef: false, singleImage: true },
    note: "Classic image-to-video. Ignores your prompt - motion is controlled by the motion bucket.",
    async build(ctx) {
      const img = await fileArg(ctx, ctx.image, "start.png");
      const motion = Math.round(Math.max(20, Math.min(255, ctx.motionScale * 127)));
      return {
        named: {
          image: img,
          seed: ctx.seed,
          randomize_seed: false,
          motion_bucket_id: motion,
          fps_id: 6,
        },
      };
    },
  },
  // ---------------------------------------------------------------------------
  // Tencent HunyuanVideo 1.5 — the newest Hunyuan open video model, and the one
  // Hunyuan build that actually fits a free ZeroGPU slice: 8.3B, distilled to
  // 6 steps at guidance 1. This is the "480p_i2v_distilled" checkpoint from
  // `tencent/HunyuanVideo-1.5`, run by multimodalart's Space. Two facts are
  // worth stating because they change how it behaves here: the Space hard-codes
  // `height=480, width=854, aspect_ratio="16:9"`, so it renders landscape
  // whatever shape your reference is; and its `length` is a frame count at
  // 24 fps that must be 4n+1 (1, 5, … 129 — at most 5.375 s), which the adapter
  // snaps to. It also offers Hunyuan's own prompt rewriting (`do_rewrite`),
  // which calls an LLM through the Space's token; the app turns that OFF for an
  // explicit run, both because a rewriter is one more model the prompt would be
  // sent to and because a rewriter is exactly the kind of thing that quietly
  // sanitises what it is given.
  // ---------------------------------------------------------------------------
  {
    id: "hunyuan15",
    fps: 24,
    kind: "gradio",
    label: "HunyuanVideo 1.5 · single-image",
    vendor: "Tencent HunyuanVideo (open source)",
    tier: "free",
    space: "https://multimodalart-hunyuan-video-1-5.hf.space",
    endpoint: "generate",
    minSec: 1,
    maxSec: 5.3,
    estSecs: 60,
    quality: 6,
    clamp: (w, h) => [854, 480],
    caps: { i2v: true, t2v: false, endFrame: false, camera: false, nsfw: true, resolution: false, multiRef: false, fixedShape: true, singleImage: true },
    note:
      "Tencent's HunyuanVideo 1.5 (distilled 8.3B, 6 steps). Strong motion and prompt adherence, and it accepts a reference picture — but this demo renders 480p 16:9 whatever shape the picture is.",
    async build(ctx) {
      const img = await fileArg(ctx, ctx.image, "start.png");
      // `length` is a frame count at 24 fps and must be 4n+1, 1…129.
      const want = Math.max(1, Math.min(5.3, Number(ctx.duration) || 2.5));
      const snapped = Math.min(129, Math.max(1, 4 * Math.round((want * 24 - 1) / 4) + 1));
      return {
        named: {
          input_image: img,
          prompt: ctx.prompt,
          length: snapped,
          steps: ctx.steps ?? 6,
          shift: 5,
          seed: Number(ctx.seed) >= 0 ? ctx.seed : -1,
          guidance: 1,
          do_rewrite: !ctx.nsfw,
        },
      };
    },
  },
  // ---------------------------------------------------------------------------
  // Uncensored builds. Same Wan 2.2 shape as the mirrors above, but trained
  // without a safety filter (and, where the flag exists, the app switches the
  // Space's own checker off when NSFW is on). They are the only free models
  // that will attempt explicit content at all, so they are listed here rather
  // than being left for the user to add by hand. Verified live (own endpoint
  // list fetched) before being added; see src/SPEC.md § NSFW.
  // ---------------------------------------------------------------------------
  {
    id: "wan22_nsfw",
    nsfwOnly: true,
    fps: 16,
    kind: "gradio",
    label: "Wan 2.2 14B NSFW",
    vendor: "community uncensored Wan build",
    tier: "free",
    space: "https://tmtanu-wan2-2-14b-i2v-480p-lightning-nsfw-diffusers.hf.space",
    endpoint: "generate_video",
    minSec: 0.5,
    maxSec: 5,
    estSecs: 45,
    quality: 5,
    caps: { i2v: true, t2v: false, endFrame: true, camera: false, nsfw: true, resolution: false, multiRef: false, singleImage: true },
    note: "Uncensored Wan 2.2 14B (lightning). Its own safety switch is turned off when NSFW is on.",
    async build(ctx) {
      const img = await fileArg(ctx, ctx.image, "start.png");
      const end = ctx.endImage ? await fileArg(ctx, ctx.endImage, "end.png") : null;
      const nsfw = !!ctx.nsfw;
      return {
        named: {
          input_image: img,
          last_image: end,
          prompt: ctx.prompt,
          steps: ctx.steps ?? 6,
          negative_prompt: ctx.negative,
          duration_seconds: ctx.duration,
          guidance_scale: 1,
          guidance_scale_2: 1,
          seed: ctx.seed,
          randomize_seed: false,
          quality: 6,
          scheduler: "UniPCMultistep",
          flow_shift: 3,
          frame_multiplier: 16,
          safe_mode: !nsfw,
          video_component: true,
        },
      };
    },
  },
  {
    id: "uncensored_video2",
    nsfwOnly: true,
    fps: 24,
    kind: "gradio",
    label: "NSFW Uncensored Video",
    vendor: "community uncensored build",
    tier: "free",
    space: "https://hf-asdqqq-uncensored-video2.hf.space",
    endpoint: "generate_video",
    minSec: 0.5,
    // The Space writes 24 fps (`FIXED_FPS` in its app.py, not the 16 the Wan
    // 2.2 mirrors use) and — the part that actually matters — its ZeroGPU
    // window is hard-capped at 45 seconds (`MAX_DURATION_SECONDS`), with the
    // window it reserves growing as `steps · (frames · W · H)^1.5`. At the
    // 6 steps this app sends, a 480p portrait input buys about **2 seconds**
    // of video inside that window; ask it for 5 and the window expires before
    // the job returns, which is the "finished without returning a result"
    // that used to end a run on this route. 2 s it is, and a longer request
    // is stitched from more of this model's own beats rather than from one
    // job that cannot fit.
    maxSec: 2,
    estSecs: 60,
    quality: 4,
    caps: { i2v: true, t2v: false, endFrame: false, camera: false, nsfw: true, resolution: false, multiRef: false, singleImage: true },
    note:
      "Mirror of the popular uncensored video Space — no safety switch at all. Its 45-second ZeroGPU window buys about 2 seconds at 480p, so a longer clip is built from several of its own beats.",
    async build(ctx) {
      const img = await fileArg(ctx, ctx.image, "start.png");
      return {
        named: {
          input_image: img,
          prompt: ctx.prompt,
          steps: ctx.steps ?? 6,
          negative_prompt: ctx.negative,
          duration_seconds: ctx.duration,
          guidance_scale: 1,
          guidance_scale_2: 1,
          seed: ctx.seed,
          randomize_seed: false,
        },
      };
    },
  },
  {
    id: "minimax_uncensored",
    nsfwOnly: true,
    fps: 24,
    kind: "gradio",
    label: "MiniMax H3 NSFW",
    vendor: "community MiniMax LoRA build",
    tier: "free",
    space: "https://pepe104-minimax-h3-turbo-lora-uncensored.hf.space",
    endpoint: "generate",
    minSec: 1,
    maxSec: 5,
    estSecs: 70,
    quality: 4,
    caps: { i2v: true, t2v: true, endFrame: true, camera: false, nsfw: true, resolution: false },
    note: "MiniMax-style model with an uncensored LoRA enabled. Accepts a reference image.",
    async build(ctx) {
      const img = await fileArg(ctx, ctx.image, "start.png");
      const end = ctx.endImage ? await fileArg(ctx, ctx.endImage, "end.png") : null;
      return {
        named: {
          prompt: ctx.prompt,
          image_path: img,
          last_image_path: end,
          duration: ctx.duration,
          steps: ctx.steps ?? 6,
          seed: ctx.seed,
          upsample: false,
          use_lora: true,
        },
      };
    },
  },

  // ---------------------------------------------------------------------------
  // More uncensored builds (added on request — "find and add more free NSFW
  // models"). Every one of these was checked against its live
  // `/gradio_api/info` before being listed, so the endpoint and every parameter
  // name below is what the Space is *actually* serving, not a guess. The pool
  // meters a free allowance per address and per Space, so several uncensored
  // routes mean one Space being busy or out of allowance no longer ends the
  // run; the app simply walks to the next.
  //
  // A trap worth knowing before "cleaning up" this list: several of these
  // Spaces are **private**, and `https://huggingface.co/api/spaces/<id>`
  // answers `Invalid username or password` for a private repo — which reads
  // exactly like a deleted one. It is not. Their
  // `https://<sub>.hf.space/gradio_api/info` still serves the live signature
  // (`wan22_nsfw_mirror2` and `ltx23_nsfw` are both in that state, and both
  // answer real jobs), so verify a route by its own hf.space URL, never by the
  // Hub API alone.
  // ---------------------------------------------------------------------------
  {
    id: "wan22_nsfw_mirror",
    nsfwOnly: true,
    fps: 16,
    kind: "gradio",
    label: "Wan 2.2 14B NSFW II",
    vendor: "community uncensored Wan build (second Space)",
    tier: "free",
    space: "https://hamtst-wan2-2-free-uncensored.hf.space",
    endpoint: "generate_video",
    minSec: 0.5,
    maxSec: 5,
    estSecs: 45,
    quality: 5,
    caps: { i2v: true, t2v: false, endFrame: true, camera: false, nsfw: true, resolution: false, multiRef: false, singleImage: true },
    note: "A second copy of the uncensored Wan 2.2 14B lightning build — same shape, its own queue. Its safe mode and safety filter are switched off whenever NSFW is on.",
    async build(ctx) {
      const img = await fileArg(ctx, ctx.image, "start.png");
      const end = ctx.endImage ? await fileArg(ctx, ctx.endImage, "end.png") : null;
      const nsfw = !!ctx.nsfw;
      return {
        named: {
          input_image: img,
          last_image: end,
          prompt: ctx.prompt,
          steps: ctx.steps ?? 6,
          negative_prompt: ctx.negative,
          duration_seconds: ctx.duration,
          guidance_scale: 1,
          guidance_scale_2: 1,
          seed: ctx.seed,
          randomize_seed: false,
          quality: 6,
          scheduler: "UniPCMultistep",
          flow_shift: 3,
          frame_multiplier: 16,
          video_component: true,
          safe_mode: !nsfw,
          enable_safety_checker: !nsfw,
        },
      };
    },
  },
  {
    id: "wan22_nsfw_mirror2",
    nsfwOnly: true,
    fps: 16,
    kind: "gradio",
    label: "Wan 2.2 14B NSFW III",
    vendor: "community uncensored Wan build (third Space)",
    tier: "free",
    space: "https://kingkladze-wan2-2-14b-i2v-480p-lightning-nsfw-diffusers.hf.space",
    endpoint: "generate_video",
    minSec: 0.5,
    maxSec: 5,
    estSecs: 45,
    quality: 5,
    caps: { i2v: true, t2v: false, endFrame: true, camera: false, nsfw: true, resolution: false, multiRef: false, singleImage: true },
    note: "A third copy of the same uncensored Wan 2.2 14B lightning build. Its only content switch is safe mode, which is turned off when NSFW is on.",
    async build(ctx) {
      const img = await fileArg(ctx, ctx.image, "start.png");
      const end = ctx.endImage ? await fileArg(ctx, ctx.endImage, "end.png") : null;
      const nsfw = !!ctx.nsfw;
      return {
        named: {
          input_image: img,
          last_image: end ?? img,
          prompt: ctx.prompt,
          steps: ctx.steps ?? 6,
          negative_prompt: ctx.negative,
          duration_seconds: ctx.duration,
          guidance_scale: 1,
          guidance_scale_2: 1,
          seed: ctx.seed,
          randomize_seed: false,
          quality: 6,
          scheduler: "UniPCMultistep",
          flow_shift: 3,
          frame_multiplier: 16,
          video_component: true,
          safe_mode: !nsfw,
        },
      };
    },
  },
  // ---------------------------------------------------------------------------
  // `wan22_nsfw_lora` ("Wan 2.2 NSFW (LoRA)", samsammysammy's 5B build) was
  // removed here: the Space is configured on **cpu-basic**, not ZeroGPU, so its
  // `@spaces.GPU` endpoint can never start — every call answers the same
  // instant empty error a spent allowance does. Keeping it in the ladder was
  // worse than a wasted slot: the run uploads your reference frame to the Space
  // *before* it calls it, so a route that cannot render was still being handed
  // the picture. If that Space is ever moved onto ZeroGPU, reinstate this entry
  // from git history — the adapter was written against its live signature
  // (`prompt, image, width, height, num_frames, num_inference_steps,
  // guidance_scale, seed, enabled_loras, lora_strength_multiplier`).
  // ---------------------------------------------------------------------------
  {
    id: "ltx23_nsfw",
    nsfwOnly: true,
    fps: 25,
    kind: "gradio",
    label: "LTX 2.3 NSFW (identity)",
    vendor: "LTX 2.3 finetune — community Space",
    tier: "free",
    space: "https://oasefrucht-ltx-2-3-nsfw.hf.space",
    endpoint: "generate",
    minSec: 2,
    maxSec: 12,
    estSecs: 150,
    quality: 7,
    caps: { i2v: true, t2v: false, endFrame: false, camera: false, nsfw: true, resolution: true, multiRef: true, singleImage: false },
    note: "LTX 2.3 identity build with MSR multi-ref inputs: Face → ref2, Body/outfit → ref3, Character → ref4, Scene → background. No canvas surgery — the Space itself holds the identities.",
    async build(ctx) {
      const img = await fileArg(ctx, ctx.image, "reference.png");
      const end = ctx.endImage ? await fileArg(ctx, ctx.endImage, "end.png") : null;
      const refs = Array.isArray(ctx.refExtras) ? ctx.refExtras.filter((e) => e && e.blob) : [];
      const by = (s) => refs.find((e) => (e.slot || "").toLowerCase() === s);
      const faceE = by("face");
      const bodyE = by("body") || by("outfit");
      const charE = by("char1") || by("char2") || by("character 1") || by("character 2");
      const sceneE = by("scene");
      const ref2 = faceE?.blob ? await fileArg(ctx, faceE.blob, "face-ref.png") : null;
      const ref3 = bodyE?.blob ? await fileArg(ctx, bodyE.blob, "body-ref.png") : null;
      const ref4 = charE?.blob ? await fileArg(ctx, charE.blob, "char-ref.png") : null;
      const bg = sceneE?.blob ? await fileArg(ctx, sceneE.blob, "scene-ref.png") : null;
      return {
        named: {
          image_path: img,
          prompt: ctx.prompt,
          negative_prompt: ctx.negative,
          preset: "nsfw realistic",
          seconds: Math.max(2, Math.min(12, Number(ctx.duration) || 6)),
          max_width: Array.isArray(ctx.size) ? ctx.size[0] : 1120,
          max_height: Array.isArray(ctx.size) ? ctx.size[1] : 1344,
          mode: "anchor only",
          face_bbox: "",
          likeness_strength: 0.9,
          likeness_anchor_strength: 0.35,
          latent_anchor_strength: 0.12,
          first_frame_strength: 0.85,
          seed: Number(ctx.seed) >= 0 ? ctx.seed : -1,
          randomize_seed: false,
          gen_budget: 120,
          input_mode: "single image (i2v)",
          msr_ref2: ref2,
          msr_ref3: ref3,
          msr_ref4: ref4,
          msr_background: bg,
          msr_frame_count: 41,
          msr_guide_strength: 1,
          msr_lora_strength: 0.7,
          kf_last_image: end,
          prompt_segments: "",
          scene_chain_prompt: "",
          profile_name: "",
          hide_sensitive: false,
        },
      };
    },
  },
  {
    id: "ltx_nsfw_t2v",
    nsfwOnly: true,
    fps: 24,
    kind: "gradio",
    label: "LTX NSFW (text→video)",
    vendor: "LTX — community Space",
    tier: "free",
    space: "https://ugwutobychuks-nsfw-helper-ltx-demo.hf.space",
    endpoint: "generate",
    minSec: 5,
    maxSec: 20,
    estSecs: 90,
    quality: 5,
    caps: { i2v: false, t2v: true, endFrame: false, camera: false, nsfw: true, resolution: true },
    note: "A plain uncensored text-to-video route (5–20 s, up to 1080p) for a run that has a prompt and no reference picture. It cannot be given a still, so it never stands in for your own photo.",
    async build(ctx) {
      return {
        named: {
          prompt: ctx.prompt,
          duration: Math.max(5, Math.min(20, Number(ctx.duration) || 5)),
          aspect_ratio: ctx.aspect === "9:16" ? "9:16" : "16:9",
          resolution: ctx.quality === "480p" ? "480p" : "720p",
          seed: Number(ctx.seed) >= 0 ? ctx.seed : -1,
        },
      };
    },
  },
  {
    id: "puter_video",
    fps: 24,
    kind: "puter",
    label: "Puter video — free, login once",
    vendor: "Puter (user-pays, no key)",
    tier: "free",
    space: "",
    endpoint: "",
    minSec: 1,
    maxSec: 15,
    estSecs: 120,
    quality: 4,
    caps: { i2v: true, t2v: true, endFrame: false, camera: false, nsfw: false, resolution: false },
    note: "Free text-to-video through your own Puter account (sign in once in Puter's own window — no key to paste). The reference frame is offered when the route accepts it, otherwise the shot is rendered from the prompt alone.",
    async build(ctx) {
      return { named: { prompt: ctx.prompt, duration: ctx.duration } };
    },
  },
];

/**
 * Character animation — motion transfer. These are a different kind of model
 * from everything above: they are not asked to *invent* motion, they are handed
 * a driving clip of a real person moving and a reference picture, and they
 * re-render the reference person performing that movement. That is the only
 * family of free models that can answer "the body movement and the facial
 * expression are missing" with actual movement.
 *
 * They are kept out of PROVIDERS on purpose: they are unusable without a
 * driving clip, so the engine only queues them for a storyboard run whose
 * driver was actually made (see src/motion.js). Their `build` throws a
 * `kind:"empty"` error rather than an input error, so a missing driver makes
 * the engine walk on to the ordinary chain instead of failing the run.
 */
export const MOTION_PROVIDERS = [
  {
    id: "wananimate_fast",
    fps: 16,
    kind: "gradio",
    label: "Wan Animate (motion transfer)",
    vendor: "Alibaba Wan 2.2 Animate — community Space",
    tier: "free",
    space: "https://shamszeb-wan-animate2-fast-transfer.hf.space",
    endpoint: "predict",
    minSec: 0.5,
    maxSec: 5,
    estSecs: 90,
    quality: 7,
    caps: { i2v: true, t2v: false, endFrame: false, camera: false, nsfw: false, resolution: true, motion: true, multiRef: false, singleImage: true },
    note: "Copies a driving clip's whole-body movement and facial expression onto your picture. Directed motion — the body actually does what the driver does.",
    async build(ctx) {
      if (!ctx.drivingVideo) throw driverMissing();
      const img = await fileArg(ctx, ctx.image, "character.png");
      const vid = await fileArg(ctx, ctx.drivingVideo, "motion.mp4");
      return {
        named: {
          reference_image: img,
          pose_video: vid,
          character_prompt: ctx.prompt,
          pose_prompt: ctx.drivingPrompt || "the person moves naturally and expressively",
          negative_prompt: ctx.negative,
          steps: Math.max(4, Math.min(8, Number(ctx.steps) || 5)),
          seed: Number(ctx.seed) >= 0 ? ctx.seed : -1,
          resolution: "480p (Standard - 482x854)",
        },
      };
    },
  },
  {
    id: "wananimate_v2v",
    fps: 16,
    kind: "gradio",
    label: "Wan Animate V2V (motion transfer)",
    vendor: "Alibaba Wan 2.2 Animate — community Space",
    tier: "free",
    space: "https://brnawy2-wan-animate-2-motion-transfer-v2v.hf.space",
    endpoint: "process_video",
    minSec: 0.5,
    maxSec: 5,
    estSecs: 100,
    quality: 6,
    caps: { i2v: true, t2v: false, endFrame: false, camera: false, nsfw: false, resolution: true, motion: true, multiRef: false, singleImage: true },
    note: "Second motion-transfer Space, used when the first one is out of allowance. Same idea: the reference picture takes on the driving clip's movement.",
    async build(ctx) {
      if (!ctx.drivingVideo) throw driverMissing();
      const img = await fileArg(ctx, ctx.image, "character.png");
      const vid = await fileArg(ctx, ctx.drivingVideo, "motion.mp4");
      return {
        named: {
          image: img,
          video: vid,
          pos_prompt_val: ctx.prompt,
          pose_prompt_val: ctx.drivingPrompt || "same exact natural pose and smooth motion and movements",
          neg_prompt_val: ctx.negative,
          res_choice: "480p (Higher Quality)",
        },
      };
    },
  },
  {
    id: "wananimate_14b",
    fps: 16,
    kind: "gradio",
    label: "Wan Animate 2 14B (motion transfer)",
    vendor: "Alibaba Wan 2.2 Animate — official demo Space",
    tier: "free",
    space: "https://hugging-apps-wan2-2-animate-2-14b.hf.space",
    repo: "hugging-apps/wan2-2-animate-2-14b",
    endpoint: "animate",
    minSec: 1,
    maxSec: 5,
    estSecs: 170,
    quality: 7,
    caps: { i2v: true, t2v: false, endFrame: false, camera: false, nsfw: false, resolution: true, motion: true, multiRef: false, singleImage: true },
    note: "The reference Wan 2.2 Animate demo: copies the driving clip's whole-body movement and facial expression onto your picture, with a size and step count you can ask for. Heavier than the community Spaces (it reserves the big card), so it is tried after them.",
    async build(ctx) {
      if (!ctx.drivingVideo) throw driverMissing();
      const img = await fileArg(ctx, ctx.image, "character.png");
      const vid = await fileArg(ctx, ctx.drivingVideo, "motion.mp4");
      // The Space's sliders are 320–640 in steps of 16, and a whole standing
      // figure is tall, so the tallest portrait shape it offers is asked for.
      const clamp16 = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number(v) / 16) * 16 || lo));
      const [, refH] = Array.isArray(ctx.size) ? ctx.size : [0, 0];
      return {
        named: {
          image: img,
          driving_video: vid,
          prompt: ctx.prompt,
          max_seconds: Math.max(1, Math.min(5, Number(ctx.duration) || 2)),
          height: clamp16(refH || 640, 320, 640),
          width: 384,
          num_inference_steps: Math.max(4, Math.min(20, Math.round(Number(ctx.steps) || 6))),
          guidance_scale: 1,
          sample_shift: 5,
          negative_prompt: ctx.negative,
          seed: Number(ctx.seed) >= 0 ? ctx.seed : 0,
        },
      };
    },
  },
];

/** A retryable error, so a beat with no driver clip falls through to the chain. */
function driverMissing() {
  const e = new Error("No driving motion clip for this beat — using the normal chain instead.");
  e.kind = "empty";
  return e;
}

export const KEY_PROVIDERS = [
  {
    id: "replicate",
    fps: 24,
    kind: "replicate",
    label: "Replicate",
    vendor: "replicate.com",
    tier: "key",
    estSecs: 90,
    minSec: 3,
    maxSec: 10,
    requires: "replicateToken",
    caps: { i2v: true, t2v: true, camera: false, nsfw: true, resolution: true },
    note: "Unlocks Kling, MiniMax/Hailuo, Wan Pro, LTX Pro, Hunyuan, Seedance and more. Pay per run.",
    models: [
      { id: "wan-video/wan-2.2-i2v-fast", label: "Wan 2.2 i2v Fast", maxSec: 5 },
      { id: "kwaivgi/kling-v2.1", label: "Kling v2.1", maxSec: 10 },
      { id: "minimax/video-01", label: "MiniMax / Hailuo 01", maxSec: 6 },
      { id: "minimax/hailuo-02", label: "MiniMax Hailuo 02", maxSec: 10 },
      { id: "luma/ray-2-flash", label: "Luma Ray 2 Flash", maxSec: 9 },
      { id: "lightricks/ltx-video-13b-distilled", label: "LTX Video 13B", maxSec: 8 },
    ],
  },
  {
    id: "fal",
    fps: 24,
    kind: "fal",
    label: "fal.ai",
    vendor: "fal.ai",
    tier: "key",
    estSecs: 70,
    minSec: 3,
    maxSec: 10,
    requires: "falKey",
    caps: { i2v: true, t2v: true, camera: false, nsfw: true, resolution: true },
    note: "Fast GPU endpoints for Kling, MiniMax/Hailuo, Wan and LTX. Pay per run.",
    models: [
      { id: "fal-ai/wan-i2v", label: "Wan 2.2 i2v", maxSec: 5 },
      { id: "fal-ai/kling-video/v2/master/image-to-video", label: "Kling v2 Master", maxSec: 10 },
      { id: "fal-ai/minimax/hailuo-02/standard/image-to-video", label: "MiniMax Hailuo 02", maxSec: 10 },
      { id: "fal-ai/ltx-video-13b-distilled/image-to-video", label: "LTX Video 13B", maxSec: 8 },
    ],
  },
  {
    id: "runway",
    fps: 24,
    kind: "runway",
    label: "Runway",
    vendor: "runwayml.com",
    tier: "key",
    estSecs: 120,
    minSec: 5,
    maxSec: 10,
    requires: "runwayKey",
    caps: { i2v: true, t2v: true, camera: true, nsfw: false, resolution: true },
    note: "Runway's own API (Gen-4 Turbo image-to-video). Requires a Runway developer key.",
    models: [
      { id: "gen4_turbo", label: "Gen-4 Turbo", maxSec: 10 },
      { id: "gen3a_turbo", label: "Gen-3 Alpha Turbo", maxSec: 10 },
    ],
  },
];

/**
 * MuAPI — the paid, bring-your-own-key gateway. One entry per catalogue model
 * (src/muapi-models.js), because every one of them is called by its own
 * endpoint with its own payload shape; the wire protocol is in src/muapi.js.
 *
 * They are `tier: "key"` so they behave like Replicate/fal/Runway everywhere:
 * never tried unless chosen (or `allowPaidOnAuto` is on with a key present), and
 * never a silent charge. `group` is the section of the picker they appear in.
 */
const MUAPI_EST = { flagship: 120, balanced: 90, fast: 45, budget: 70, uncensored: 100, text: 110 };
const MUAPI_QUALITY = { flagship: 9, balanced: 7, fast: 5, budget: 4, uncensored: 8, text: 8 };

export const MUAPI_PROVIDERS = MUAPI_MODELS.map((m) => ({
  id: `muapi:${m.id}`,
  kind: "muapi",
  label: m.label,
  vendor: m.vendor,
  tier: "key",
  group: m.group,
  requires: "muapiKey",
  endpoint: m.id,
  model: m,
  fps: m.fps || 24,
  minSec: m.dur?.[0] ?? 1,
  maxSec: m.dur?.[1] ?? 10,
  estSecs: (MUAPI_EST[m.group] || 90) + Math.min(20, m.dur?.[1] ?? 8) * 3,
  quality: MUAPI_QUALITY[m.group] || 6,
  caps: {
    i2v: m.tag === "i2v",
    t2v: m.tag === "t2v",
    endFrame: !!m.end,
    camera: false,
    nsfw: m.group === "uncensored",
    resolution: !!m.res,
    multiRef: m.media === "images_list",
  },
  // A `✦ uncensored` endpoint exists only for explicit content, so it belongs to
  // the NSFW generator alone (see `isNsfwOnly`).
  nsfwOnly: m.group === "uncensored",
  note: m.note,
}));

export const CODEC_LOCAL = [
  { id: "wan-codec", label: "Wan Fun InP 1.3B + codec — local pack · Apache 2.0", kind: "codec-local", maxSec: 5, serverId: "", serverFamily: "wan", bridge: "wan-bridge.js", pack: "wan-local" },
  { id: "ltx-codec", label: "LTX Video 2B + codec — local pack · OpenRail-M", kind: "codec-local", maxSec: 5, serverId: "ltx", serverFamily: "ltx", bridge: "ltx-bridge.js", pack: "ltx-local" },
  { id: "hunyuan-codec", label: "HunyuanVideo I2V 13B + codec — local pack · Tencent community", kind: "codec-local", maxSec: 5, serverId: "hunyuan_i2v", serverFamily: "hunyuan", bridge: "hunyuan-bridge.js", pack: "hunyuan-local" },
];

/** Every provider that needs a paid account behind it. */
export const PAID_PROVIDERS = [...KEY_PROVIDERS, ...MUAPI_PROVIDERS];

export const ALL_PROVIDERS = [...PROVIDERS, ...KEY_PROVIDERS, ...MUAPI_PROVIDERS, ...CODEC_LOCAL];

/**
 * The on-device renderer. Needs no network, no GPU and no model download: it estimates a
 * depth map from your picture and moves near/mid/far plates at different rates under the
 * camera move you chose. It obeys duration, aspect, camera move and camera angle exactly,
 * but it is a 2.5D camera rig rather than a diffusion model, so it cannot invent new detail.
 */
export const OFFLINE_PROVIDER = {
  id: "offline_motion",
  fps: 30,
  kind: "offline",
  label: "Motion (offline)",
  vendor: "on-device 2.5D camera rig",
  tier: "offline",
  minSec: 1,
  maxSec: 15,
  estSecs: 7,
  quality: 2,
  caps: { i2v: true, t2v: false, endFrame: false, camera: true, nsfw: true, resolution: true, noPrompt: true, multiRef: false, singleImage: true },
  note:
    "Runs entirely on this device with no internet and no GPU: your still is split into depth plates that parallax under the camera move. Renders in real time — a 15s clip takes 15s. It cannot invent new content the way a diffusion model can.",
};

export function getProvider(id) {
  return ALL_PROVIDERS.find((p) => p.id === id) || null;
}

/**
 * Can this provider render explicit content?
 *
 * `caps.nsfw` is set on the models that expose an uncensored path — a Space's
 * own `safe_mode` / `enable_safety_checker` switch, an unfiltered MuAPI
 * endpoint, a bring-your-own-key vendor, and the on-device rig, which has no
 * filter at all. Your own GPU server counts as capable too: it is the one route
 * that can actually attach the free NSFW LoRA. This predicate is what splits
 * the two generator rows in the UI — see `rebuildGenSelects()` in src/app.js
 * and the `generators` filter in `orderProviders()`.
 */
export function isNsfwCapable(p) {
  return !!p && (p.kind === "server" || p.ownServer === true || !!p.caps?.nsfw);
}

/**
 * A model that exists *only* for explicit content (a dedicated uncensored
 * build, or one of MuAPI's `✦ uncensored` endpoints). These belong to the NSFW
 * generator alone: the standard generator's Auto ladder never reaches them, so
 * an ordinary clip is never routed through an uncensored endpoint by accident.
 * Everything else — including the models that merely *have* an uncensored
 * switch, like Wan 2.2 Preview — belongs to both rows.
 */
export function isNsfwOnly(p) {
  return !!p && p.nsfwOnly === true;
}

/**
 * Whether a route accepts several reference pictures as real image inputs.
 * Free-pool Gradio i2v Spaces take exactly ONE starter frame — extras only ride
 * in the prompt as words. Only routes with `caps.multiRef` (MuAPI
 * `images_list` endpoints, a server build that declares it) get every image.
 */
export function isMultiRef(p) {
  return !!p && (p.caps?.multiRef === true || p.model?.media === "images_list");
}

/** Free-pool single-image ids — kept explicit so a future multi-ref Space cannot silently join the wrong group. */
export const SINGLE_IMAGE_FREE_IDS = new Set([
  "wan22_14b", "wan22_fast", "wan22_preview", "wan22_preview2", "wan22_rcm",
  "wan_flf", "wan21_fast", "ltx_fast", "svd", "scope",
  "hunyuan15", "wan22_nsfw", "uncensored_video2", "minimax_uncensored",
  "wan22_nsfw_mirror", "wan22_nsfw_mirror2", "ltx23_nsfw",
]);

export function scopeTrajectories() {
  return [
    "dolly_in",
    "dolly_out",
    "truck_left",
    "truck_right",
    "orbit_left",
    "crane_up_fwd",
    "snake_fwd",
    "grand_tour",
    "push_sweep",
    "wide_orbit",
    "spiral_climb",
    "greek_spiral_rise",
    "crane_arc",
    "flyover_left",
    "s_curve_reveal",
    "pullback_rise",
  ];
}
