/**
 * The MuAPI catalogue this app offers: 51 image-to-video / text-to-video models,
 * grouped so the model picker reads as six distinct sections instead of one long
 * alphabetical list.
 *
 * MuAPI (https://muapi.ai) is a paid, bring-your-own-key gateway in front of the
 * commercial video models — Kling, Veo, Sora, Seedance, Wan, Hailuo, Vidu, LTX,
 * PixVerse, Hunyuan and their uncensored variants. There is no free tier: the
 * visitor adds their own key in Settings and is billed by MuAPI, not by us.
 * See src/muapi.js for the request/poll implementation.
 *
 * REBUILD RECIPE (the full live spec is ~2.2 MB and is deliberately NOT shipped):
 *   1. fetch  https://api.muapi.ai/openapi.json
 *   2. for every path whose summary is tagged (i2v) or (t2v), record the endpoint
 *      id, its summary, and every field of its request schema (name/type/default/
 *      enum/min/max) — that is scratch/oga/muapi_video_models.json
 *   3. hand-pick the models worth offering and label them with vendor + group +
 *      tier + a one-line note (scratch/oga/curated.json)
 *   4. this file is that pick, with the request-schema facts the payload builder
 *      in src/muapi.js needs folded in: which field carries the start image
 *      (media), the optional end frame (end), the duration range/enum, the
 *      aspect and resolution enums, the quality enum, and whether the model
 *      accepts a seed / a negative prompt.
 */

/** The API root. Every call is a POST/GET under /api/v1/ with an x-api-key header. */
export const MUAPI_BASE = "https://api.muapi.ai";

/**
 * The six sections of the picker, in display order. `hint` is shown under the
 * model note when a model from that section is selected.
 */
export const MUAPI_GROUPS = [
  { id: "flagship", label: "◆ MuAPI · flagship — best quality" },
  { id: "balanced", label: "◇ MuAPI · balanced — strong for less" },
  { id: "fast", label: "⚡ MuAPI · fast — quick drafts" },
  { id: "budget", label: "▾ MuAPI · budget — cheapest per clip" },
  { id: "uncensored", label: "✦ MuAPI · uncensored — no filters (spicy)" },
  { id: "text", label: "✎ MuAPI · text → video (no reference image needed)" },
];

/**
 * One entry per model. `media` is the request field that carries the start image
 * (`images_list` takes an array, `image_url` a single URL, `null` means the model
 * is text-only); `end` is the optional last-frame field, where the model has one.
 * `durEnum` wins over `dur` when present — the endpoint only accepts those values.
 */
export const MUAPI_MODELS = [
  {"id":"seedance-v2.0-i2v","label":"Seedance 2","vendor":"ByteDance","group":"flagship","tier":"best","tag":"i2v","media":"images_list","end":null,"dur":[5,15],"durEnum":[5,10,15],"aspect":["16:9","9:16","4:3","3:4"],"res":["480p","720p"],"q":["high","basic"],"defRes":"720p","seed":false,"neg":false,"note":"Animate images using Seedance 2 (Feb 2026, #1 I2V benchmark, multimodal 9-image+3-video input, 15s)."},
  {"id":"kling-v3.0-pro-image-to-video","label":"Kling v3.0 Pro","vendor":"Kuaishou","group":"flagship","tier":"best","tag":"i2v","media":"image_url","end":"last_image","dur":[3,12],"durEnum":[3,4,5,6,7,8,9,10,11,12],"aspect":null,"res":null,"q":null,"defRes":null,"seed":false,"neg":false,"note":"Animate images into best-quality video using Kling v3.0 Pro (15s, native audio, multi-shot storyboarding)."},
  {"id":"veo3.1-image-to-video","label":"Veo 3.1","vendor":"Google","group":"flagship","tier":"best","tag":"i2v","media":"image_url","end":"last_image","dur":[8,8],"durEnum":null,"aspect":["9:16","16:9"],"res":["720p","1080p","4k"],"q":null,"defRes":"1080p","seed":false,"neg":false,"note":"Animate images into high-quality video using Google Veo 3.1 (native audio, 35% better motion, up to 4K)."},
  {"id":"wan3.0-image-to-video","label":"Wan 3.0","vendor":"Alibaba","group":"flagship","tier":"best","tag":"i2v","media":"image_url","end":"last_image","dur":[2,30],"durEnum":null,"aspect":["adaptive","16:9","9:16","1:1","4:3","3:4"],"res":["480p","720p","1080p"],"q":null,"defRes":"720p","seed":true,"neg":false,"note":"Animate an image into video with synchronized audio using Wan 3.0 (thinking mode, optional end-frame, up to 1080p, 2-30s"},
  {"id":"minimax-h3-max-image-to-video","label":"MiniMax H3 Max","vendor":"MiniMax","group":"flagship","tier":"best","tag":"i2v","media":"image_url","end":"end_image_url","dur":[5,15],"durEnum":null,"aspect":null,"res":["480p","768p","1080p"],"q":null,"defRes":"768p","seed":true,"neg":false,"note":"Animate images into high-fidelity video using MiniMax H3 Max (480p/768p/1080p, 5-15s, optional end frame)."},
  {"id":"vidu-q3-pro-image-to-video","label":"Vidu Q3 Pro","vendor":"Shengshu","group":"flagship","tier":"best","tag":"i2v","media":"image_url","end":null,"dur":[1,10],"durEnum":[1,2,3,4,5,6,7,8,9,10],"aspect":["16:9","9:16","4:3","3:4","1:1"],"res":["720p","1080p"],"q":null,"defRes":"720p","seed":false,"neg":false,"note":"Animate a still image with Vidu Q3 Pro (Jan 2026 release, ranked #2 on Artificial Analysis Video Arena)."},
  {"id":"ltx-2.5-image-to-video","label":"LTX 2.5","vendor":"Lightricks","group":"flagship","tier":"best","tag":"i2v","media":"image_url","end":"last_image","dur":[5,20],"durEnum":null,"aspect":null,"res":["720p","1080p","2k","4k"],"q":null,"defRes":"720p","seed":true,"neg":false,"note":"Animate images into high-fidelity audio-video using LTX 2.5 with optional last-frame guidance (720p/1080p/2K/4K up to 20"},
  {"id":"pixverse-v6-i2v","label":"Pixverse v6","vendor":"PixVerse","group":"flagship","tier":"best","tag":"i2v","media":"images_list","end":null,"dur":[5,5],"durEnum":null,"aspect":null,"res":["720p","1080p"],"q":null,"defRes":"720p","seed":false,"neg":false,"note":"Animate images using Pixverse v6 (15s, 1080p, 20+ camera controls, multi-shot, native audio)."},
  {"id":"wan2.7-image-to-video","label":"Wan 2.7","vendor":"Alibaba","group":"flagship","tier":"best","tag":"i2v","media":"image_url","end":"last_image","dur":[2,15],"durEnum":null,"aspect":null,"res":["720p","1080p"],"q":null,"defRes":"720p","seed":false,"neg":true,"note":"Animate images using Wan 2.7 (March 2026, 60fps, thinking mode, 4K)."},
  {"id":"kling-o1-image-to-video","label":"Kling O1","vendor":"Kuaishou","group":"flagship","tier":"best","tag":"i2v","media":"image_url","end":"last_image","dur":[5,10],"durEnum":[5,10],"aspect":["16:9","9:16","1:1"],"res":null,"q":null,"defRes":null,"seed":false,"neg":false,"note":"Animate images into video using Kling O1 (unified gen+edit, native audio, video reference input)."},
  {"id":"seedance-2-image-to-video","label":"Seedance 2 Standard","vendor":"ByteDance","group":"balanced","tier":"balanced","tag":"i2v","media":"images_list","end":null,"dur":[4,15],"durEnum":null,"aspect":["21:9","16:9","4:3","1:1","3:4","9:16"],"res":["720p","1080p","4k"],"q":null,"defRes":"720p","seed":false,"neg":false,"note":"Animate a still image with Seedance 2 (balanced 480-720p)."},
  {"id":"kling-v2.6-pro-i2v","label":"Kling v2.6 Pro","vendor":"Kuaishou","group":"balanced","tier":"balanced","tag":"i2v","media":"image_url","end":null,"dur":[5,10],"durEnum":[5,10],"aspect":null,"res":null,"q":null,"defRes":null,"seed":false,"neg":false,"note":"Animate images into professional video using Kling v2.6 Pro."},
  {"id":"minimax-hailuo-02-pro-i2v","label":"Hailuo 02 Pro","vendor":"MiniMax","group":"balanced","tier":"balanced","tag":"i2v","media":"image_url","end":"end_image_url","dur":[6,6],"durEnum":null,"aspect":null,"res":null,"q":null,"defRes":"1080P","seed":false,"neg":false,"note":"Animate images using MiniMax Hailuo 0.2 Pro."},
  {"id":"wan2.6-image-to-video","label":"Wan 2.6","vendor":"Alibaba","group":"balanced","tier":"balanced","tag":"i2v","media":"image_url","end":null,"dur":[5,15],"durEnum":[5,10,15],"aspect":null,"res":["720p","1080p"],"q":null,"defRes":"720p","seed":false,"neg":false,"note":"Animate images using Wan 2.6 (24fps cinematic)."},
  {"id":"hunyuan-image-to-video","label":"Hunyuan Video","vendor":"Tencent","group":"balanced","tier":"balanced","tag":"i2v","media":"image_url","end":null,"dur":[2,10],"durEnum":null,"aspect":["1:1","16:9","9:16"],"res":null,"q":null,"defRes":null,"seed":false,"neg":false,"note":"Animate images into video using Hunyuan (Tencent)."},
  {"id":"seedance-v1.5-pro-i2v","label":"Seedance 1.5 Pro","vendor":"ByteDance","group":"balanced","tier":"balanced","tag":"i2v","media":"image_url","end":"last_image","dur":[4,12],"durEnum":[4,5,6,7,8,9,10,11,12],"aspect":["9:16","16:9","1:1","4:3","3:4","21:9"],"res":["480p","720p","1080p"],"q":null,"defRes":"480p","seed":false,"neg":false,"note":"Animate images using Seedance v1.5 Pro (Dec 2025, 4.5B, native audio+video sync, 1080p, multilingual)."},
  {"id":"vidu-q2-pro-image-to-video","label":"Vidu Q2 Pro","vendor":"Shengshu","group":"balanced","tier":"balanced","tag":"i2v","media":"image_url","end":null,"dur":[2,8],"durEnum":[2,3,4,5,6,7,8],"aspect":["16:9","9:16","1:1"],"res":["720p","1080p"],"q":null,"defRes":"720p","seed":false,"neg":false,"note":"Animate a still image with Vidu Q2 Pro (cinematic detail tier, 1080p, up to ~10s, multi-reference support)."},
  {"id":"kling-v3.0-standard-image-to-video","label":"Kling v3.0 Standard","vendor":"Kuaishou","group":"balanced","tier":"balanced","tag":"i2v","media":"image_url","end":"last_image","dur":[3,12],"durEnum":[3,4,5,6,7,8,9,10,11,12],"aspect":null,"res":null,"q":null,"defRes":null,"seed":false,"neg":false,"note":"Animate images into video using Kling v3.0 Standard (faster, native audio)."},
  {"id":"veo3.1-fast-image-to-video","label":"Veo 3.1 Fast","vendor":"Google","group":"fast","tier":"fast","tag":"i2v","media":"image_url","end":"last_image","dur":[8,8],"durEnum":null,"aspect":["9:16","16:9"],"res":["720p","1080p","4k"],"q":null,"defRes":"1080p","seed":false,"neg":false,"note":"Animate images quickly using Google Veo 3.1 Fast."},
  {"id":"kling-v3-turbo-pro-image-to-video","label":"Kling v3 Turbo Pro","vendor":"Kuaishou","group":"fast","tier":"balanced","tag":"i2v","media":"image_url","end":null,"dur":[3,12],"durEnum":[3,4,5,6,7,8,9,10,11,12],"aspect":null,"res":null,"q":null,"defRes":null,"seed":false,"neg":false,"note":"Animate a single image into a fast premium video using Kling v3 Turbo Pro (1080p, 3-15s)."},
  {"id":"seedance-2-image-to-video-fast","label":"Seedance 2 Fast","vendor":"ByteDance","group":"fast","tier":"fast","tag":"i2v","media":"images_list","end":null,"dur":[4,15],"durEnum":null,"aspect":["21:9","16:9","4:3","1:1","3:4","9:16"],"res":["720p","1080p","4k"],"q":null,"defRes":"720p","seed":false,"neg":false,"note":"Animate a still image with Seedance 2 Fast."},
  {"id":"seedance-pro-i2v-fast","label":"Seedance Pro Fast","vendor":"ByteDance","group":"fast","tier":"fast","tag":"i2v","media":"image_url","end":null,"dur":[2,11],"durEnum":[2,3,4,5,6,7,8,9,10,11],"aspect":null,"res":["480p","720p","1080p"],"q":null,"defRes":"480p","seed":false,"neg":false,"note":"Animate images quickly using Seedance Pro Fast."},
  {"id":"ltx-2-fast-image-to-video","label":"LTX 2 Fast","vendor":"Lightricks","group":"fast","tier":"fast","tag":"i2v","media":"image_url","end":null,"dur":[6,20],"durEnum":[6,8,10,12,14,16,18,20],"aspect":null,"res":null,"q":null,"defRes":null,"seed":false,"neg":false,"note":"Animate images quickly using LTX 2 Fast."},
  {"id":"wan2.5-image-to-video-fast","label":"Wan 2.5 Fast","vendor":"Alibaba","group":"fast","tier":"fast","tag":"i2v","media":"image_url","end":null,"dur":[5,10],"durEnum":[5,10],"aspect":null,"res":["720p","1080p"],"q":null,"defRes":"720p","seed":false,"neg":false,"note":"Animate images quickly using Wan 2.5 Fast."},
  {"id":"minimax-hailuo-2.3-fast","label":"Hailuo 2.3 Fast","vendor":"MiniMax","group":"fast","tier":"fast","tag":"i2v","media":"image_url","end":null,"dur":[6,10],"durEnum":[6,10],"aspect":null,"res":null,"q":null,"defRes":null,"seed":false,"neg":false,"note":"Animate images quickly using MiniMax Hailuo 2.3 Fast (cheaper)."},
  {"id":"kling-o1-standard-image-to-video","label":"Kling O1 Standard","vendor":"Kuaishou","group":"fast","tier":"fast","tag":"i2v","media":"image_url","end":"last_image","dur":[5,10],"durEnum":[5,10],"aspect":null,"res":null,"q":null,"defRes":null,"seed":false,"neg":false,"note":"Animate images using Kling O1 Standard."},
  {"id":"veo3-fast-image-to-video","label":"Veo 3 Fast","vendor":"Google","group":"fast","tier":"fast","tag":"i2v","media":"images_list","end":null,"dur":[2,10],"durEnum":null,"aspect":["9:16","16:9"],"res":null,"q":null,"defRes":null,"seed":false,"neg":false,"note":"Animate images into video quickly using Google Veo 3 Fast."},
  {"id":"wan2.2-image-to-video","label":"Wan 2.2","vendor":"Alibaba","group":"budget","tier":"budget","tag":"i2v","media":"image_url","end":"last_image","dur":[5,8],"durEnum":[5,8],"aspect":["9:16","16:9"],"res":["480p","720p"],"q":["medium","high"],"defRes":"480p","seed":false,"neg":false,"note":"Animate images into video using Wan 2.2."},
  {"id":"wan2.1-image-to-video","label":"Wan 2.1","vendor":"Alibaba","group":"budget","tier":"budget","tag":"i2v","media":"image_url","end":null,"dur":[5,10],"durEnum":[5,10],"aspect":["9:16","16:9"],"res":["480p","720p"],"q":["medium","high"],"defRes":"480p","seed":false,"neg":false,"note":"Animate images into video using Wan 2.1."},
  {"id":"ltx-2-pro-image-to-video","label":"LTX 2 Pro","vendor":"Lightricks","group":"budget","tier":"budget","tag":"i2v","media":"image_url","end":null,"dur":[6,10],"durEnum":[6,8,10],"aspect":null,"res":null,"q":null,"defRes":null,"seed":false,"neg":false,"note":"Animate images professionally using LTX 2 Pro."},
  {"id":"seedance-lite-i2v","label":"Seedance Lite","vendor":"ByteDance","group":"budget","tier":"budget","tag":"i2v","media":"image_url","end":"last_image","dur":[3,12],"durEnum":null,"aspect":null,"res":["480p","720p","1080p"],"q":null,"defRes":"480p","seed":false,"neg":false,"note":"Animate images using Seedance Lite (cost-effective)."},
  {"id":"seedance-2-mini-image-to-video","label":"Seedance 2 Mini","vendor":"ByteDance","group":"budget","tier":"budget","tag":"i2v","media":"images_list","end":null,"dur":[4,15],"durEnum":null,"aspect":["21:9","16:9","4:3","1:1","3:4","9:16"],"res":["480p","720p"],"q":null,"defRes":"720p","seed":false,"neg":false,"note":"Animate images to video using Seedance 2 Mini."},
  {"id":"pixverse-v4.5-i2v","label":"Pixverse 4.5","vendor":"PixVerse","group":"budget","tier":"budget","tag":"i2v","media":"images_list","end":null,"dur":[5,8],"durEnum":[5,8],"aspect":["9:16","16:9","1:1","4:3","3:4"],"res":["720p","1080p"],"q":null,"defRes":"720p","seed":false,"neg":false,"note":"Animate images using Pixverse v4.5."},
  {"id":"minimax-hailuo-02-standard-i2v","label":"Hailuo 02 Standard","vendor":"MiniMax","group":"budget","tier":"budget","tag":"i2v","media":"image_url","end":"end_image_url","dur":[6,10],"durEnum":[6,10],"aspect":null,"res":null,"q":null,"defRes":"512P","seed":false,"neg":false,"note":"Animate images using MiniMax Hailuo 0.2 Standard."},
  {"id":"seedance-2-spicy-image-to-video","label":"Seedance 2 Spicy","vendor":"ByteDance","group":"uncensored","tier":"best","tag":"i2v","media":"images_list","end":null,"dur":[4,15],"durEnum":null,"aspect":["21:9","16:9","4:3","1:1","3:4","9:16"],"res":["720p","1080p","4k"],"q":null,"defRes":"720p","seed":false,"neg":false,"note":"Animate a still image with Seedance 2 Spicy (VIP tier, reduced content-safety filtering)."},
  {"id":"seedance-2-spicy-image-to-video-fast","label":"Seedance 2 Spicy Fast","vendor":"ByteDance","group":"uncensored","tier":"fast","tag":"i2v","media":"images_list","end":null,"dur":[4,15],"durEnum":null,"aspect":["21:9","16:9","4:3","1:1","3:4","9:16"],"res":["720p","1080p","4k"],"q":null,"defRes":"720p","seed":false,"neg":false,"note":"Animate a still image with Seedance 2 Spicy Fast (VIP Fast tier, reduced content-safety filtering)."},
  {"id":"seedance-2-mini-spicy-image-to-video","label":"Seedance 2 Mini Spicy","vendor":"ByteDance","group":"uncensored","tier":"budget","tag":"i2v","media":"images_list","end":null,"dur":[4,15],"durEnum":null,"aspect":["21:9","16:9","4:3","1:1","3:4","9:16"],"res":["480p","720p"],"q":null,"defRes":"720p","seed":false,"neg":false,"note":"Animate images to video using Seedance 2 Mini Spicy (reduced content-safety filtering)."},
  {"id":"seedance-2.5-spicy-image-to-video","label":"Seedance 2.5 Spicy","vendor":"ByteDance","group":"uncensored","tier":"balanced","tag":"i2v","media":"image_url","end":null,"dur":[4,30],"durEnum":null,"aspect":["adaptive","16:9","9:16","1:1","4:3","3:4","21:9","9:21"],"res":["480p","720p","1080p","4k"],"q":null,"defRes":"720p","seed":true,"neg":false,"note":""},
  {"id":"wan3.0-spicy-image-to-video","label":"Wan 3.0 Spicy","vendor":"Alibaba","group":"uncensored","tier":"balanced","tag":"i2v","media":"image_url","end":"last_image","dur":[2,30],"durEnum":null,"aspect":["adaptive","16:9","9:16","1:1","4:3","3:4"],"res":["480p","720p","1080p"],"q":null,"defRes":"720p","seed":true,"neg":false,"note":"Animate an image into a bold, high-contrast, high-motion video with synchronized audio using Wan 3.0 Spicy (thinking mod"},
  {"id":"wan2.7-image-to-video-spicy","label":"Wan 2.7 Spicy","vendor":"Alibaba","group":"uncensored","tier":"balanced","tag":"i2v","media":"image_url","end":null,"dur":[5,15],"durEnum":[5,10,15],"aspect":null,"res":["720p","1080p"],"q":null,"defRes":"720p","seed":true,"neg":true,"note":"Animate images using Wan 2.7 Spicy — bold, high-contrast, high-motion video with optional audio-guided generation."},
  {"id":"wan2.6-image-to-video-spicy","label":"Wan 2.6 Spicy","vendor":"Alibaba","group":"uncensored","tier":"balanced","tag":"i2v","media":"image_url","end":null,"dur":[5,15],"durEnum":[5,10,15],"aspect":null,"res":["720p","1080p"],"q":null,"defRes":"720p","seed":true,"neg":true,"note":"Animate images using Wan 2.6 Spicy — bold, high-contrast, high-motion video with optional audio-guided generation."},
  {"id":"minimax-h3-image-to-video-spicy","label":"MiniMax H3 Spicy","vendor":"MiniMax","group":"uncensored","tier":"balanced","tag":"i2v","media":"image_url","end":"last_image","dur":[3,12],"durEnum":[3,4,5,6,7,8,9,10,11,12],"aspect":null,"res":["480p","768p"],"q":null,"defRes":"480p","seed":true,"neg":false,"note":"Animate images into bold, expressive video with native stereo audio using MiniMax H3 Spicy Image to Video (480p/768p, 3-"},
  {"id":"seedance-2-spicy-text-to-video","label":"Seedance 2 Spicy (text)","vendor":"ByteDance","group":"uncensored","tier":"best","tag":"t2v","media":null,"end":null,"dur":[4,15],"durEnum":null,"aspect":["21:9","16:9","4:3","1:1","3:4","9:16"],"res":["720p","1080p","4k"],"q":null,"defRes":"720p","seed":false,"neg":false,"note":"Generate videos from text using Seedance 2 Spicy (VIP tier, reduced content-safety filtering)."},
  {"id":"veo3.1-text-to-video","label":"Veo 3.1 (text)","vendor":"Google","group":"text","tier":"best","tag":"t2v","media":null,"end":null,"dur":[8,8],"durEnum":null,"aspect":["9:16","16:9"],"res":["720p","1080p","4k"],"q":null,"defRes":"1080p","seed":false,"neg":false,"note":"Generate videos from text using Google Veo 3.1 (best, native audio+lipsync, 35% better motion, up to 4K, 8s)."},
  {"id":"kling-v3.0-pro-text-to-video","label":"Kling v3.0 Pro (text)","vendor":"Kuaishou","group":"text","tier":"best","tag":"t2v","media":null,"end":null,"dur":[3,12],"durEnum":[3,4,5,6,7,8,9,10,11,12],"aspect":["9:16","16:9","1:1"],"res":null,"q":null,"defRes":null,"seed":false,"neg":false,"note":"Generate best-quality videos from text using Kling v3.0 Pro (15s, native audio, multi-shot storyboarding)."},
  {"id":"seedance-v2.0-t2v","label":"Seedance 2 (text)","vendor":"ByteDance","group":"text","tier":"best","tag":"t2v","media":null,"end":null,"dur":[5,15],"durEnum":[5,10,15],"aspect":["16:9","9:16","4:3","3:4"],"res":["480p","720p"],"q":["high","basic"],"defRes":"720p","seed":false,"neg":false,"note":"Generate videos from text using Seedance 2 (Feb 2026, #1 I2V benchmark, up to 15s, native audio)."},
  {"id":"wan3.0-text-to-video","label":"Wan 3.0 (text)","vendor":"Alibaba","group":"text","tier":"best","tag":"t2v","media":null,"end":null,"dur":[2,30],"durEnum":null,"aspect":["adaptive","16:9","9:16","1:1","4:3","3:4"],"res":["480p","720p","1080p"],"q":null,"defRes":"720p","seed":true,"neg":false,"note":"Generate video with synchronized audio from text using Wan 3.0 (thinking mode, up to 1080p, 2-30s)."},
  {"id":"minimax-h3-max-text-to-video","label":"MiniMax H3 Max (text)","vendor":"MiniMax","group":"text","tier":"best","tag":"t2v","media":null,"end":null,"dur":[5,15],"durEnum":null,"aspect":["21:9","16:9","4:3","1:1","3:4","9:16"],"res":["480p","768p","1080p"],"q":null,"defRes":"768p","seed":true,"neg":false,"note":"Generate high-fidelity videos from text using MiniMax H3 Max (480p/768p/1080p, 5-15s, aspect ratios, prompt expansion)."},
  {"id":"openai-sora-2-text-to-video","label":"Sora 2 (text)","vendor":"OpenAI","group":"text","tier":"balanced","tag":"t2v","media":null,"end":null,"dur":[4,20],"durEnum":[4,8,12,16,20],"aspect":["9:16","16:9"],"res":null,"q":null,"defRes":null,"seed":false,"neg":false,"note":"Generate videos from text using OpenAI Sora 2."},
  {"id":"vidu-q3-pro-text-to-video","label":"Vidu Q3 Pro (text)","vendor":"Shengshu","group":"text","tier":"best","tag":"t2v","media":null,"end":null,"dur":[1,10],"durEnum":[1,2,3,4,5,6,7,8,9,10],"aspect":["16:9","9:16","4:3","3:4","1:1"],"res":["720p","1080p"],"q":null,"defRes":"720p","seed":false,"neg":false,"note":"Generate videos from text using Vidu Q3 Pro (Jan 2026 release, ranked #2 globally on Artificial Analysis Video Arena)."},
  {"id":"wan2.7-text-to-video","label":"Wan 2.7 (text)","vendor":"Alibaba","group":"text","tier":"best","tag":"t2v","media":null,"end":null,"dur":[2,15],"durEnum":null,"aspect":["16:9","9:16","1:1","4:3","3:4"],"res":["720p","1080p"],"q":null,"defRes":"720p","seed":false,"neg":true,"note":"Generate videos from text using Wan 2.7 (March 2026, thinking mode, 60fps native, 4K Pro, audio sync)."},
];

/** Look a model up by its catalogue id. */
export function muapiModel(id) {
  return MUAPI_MODELS.find((m) => m.id === id) || null;
}

/** The models of one section, in catalogue order. */
export function muapiModelsFor(group) {
  return MUAPI_MODELS.filter((m) => m.group === group);
}

/** The section a model belongs to. */
export function muapiGroupLabel(group) {
  return MUAPI_GROUPS.find((g) => g.id === group)?.label || "MuAPI";
}
