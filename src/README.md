# AI Multi Toolkit V4 — video · image · storyboard · voiceover studios

A single-page studio that turns a reference image (or a text prompt alone) into a short video.

There are **three places the render can happen**, and the app picks between them in this order:

1. **Your own GPU server** — `src/server/server.py`, a tiny JSON + SSE backend that runs open-source
   diffusers models on hardware *you* control. Start it on a **free Google Colab T4** (one-click
   notebook in `src/colab/`), on Kaggle / SageMaker Studio Lab / Lightning AI, or on your own laptop.
   No Hugging Face account, no API token, no quota owned by anyone else.
2. **The free public pool** — public Hugging Face Gradio Spaces (Wan 2.2/2.1, LTX Video, SVD, SCOPE).
   Always available; a free read token is *optional* and only raises the daily allowance. Runs on
   ZeroGPU, so the real limit is GPU-seconds per address (see § Reality check).
3. **This device** — `src/offline.js`, an honest 2.5D camera rig that turns a still into a moving clip with
   **no network, no server and no download**. It cannot invent new detail the way a diffusion model can.

A fourth route is available only if the visitor brings their own paid key: **Replicate, fal.ai, Runway** and
**MuAPI** (one key, 51 commercial models — Kling, Veo, Sora, Seedance, Wan, Hailuo, LTX, PixVerse and their
uncensored builds — grouped into six sections of the model list). Nothing there is ever charged silently:
MuAPI models are never added to Auto, and the app asks MuAPI for the exact price of the run you have set up
and prints it under the picker before you press Generate.

`Settings → Where the rendering happens` exposes a **compute mode** (`auto | server | pool | offline`)
plus toggles for "also let the free pool help" and "render on this device if everything else fails",
so a dead Colab session degrades gracefully instead of erroring. `auto` resolves to
*your server → the free pool → this device*.

`Settings → Privacy & IP rotation` decides **whether a model can see your address at all** (strict privacy,
on by default: every request is relayed) and **which address each generation leaves from** — see
§ Privacy below.

Read [`SPEC.md`](./SPEC.md) for the user-facing feature spec and the honest breakdown of what is free.

## Standing rules for future sessions

- Cross-chat memory lives in [`HANDOFF.md`](./HANDOFF.md) — read it first every
  session, log the plan there before starting, and update it when done. On
  "resume from last work" / "keep working" / "next", continue from its Now
  section immediately.

- After every shipped user-visible change, prepend one-line entries to Recently shipped in the Tutorial roadmap (`index.html` `#tutRoadmap`, the second `.roadmap-list`) and verify with `page_refresh` + `page_eval`. Never wait to be asked.
- Roadmap gate: never list anything that is bad from a developer's viewpoint — privacy regressions, new third-party egress, weakened vault/encryption, hidden owner bypasses or gate thresholds, undisclosed telemetry, or anything that advertises a hidden entry point. Such changes stay unlisted by design.


## File map

| File | Role |
| --- | --- |
| `main.pjs` | Perchance config: `$meta`, plugin imports (`superFetch`, `kv`, `uploadPlugin`, `text-to-image-plugin`, and `ai-text-plugin` — which powers the `✨ Auto-enhance` prompt button) and tunable knobs (`segmentLimits`, `cooldown`, prompt tails `motionTail`/`chainPrefix`, `undressStages`, `defaults`). The prompt tails and the **`cooldown` timings are read live by `src/engine.js`**; `segmentLimits`/`defaults` are documentation only (the engine reads `src/providers.js` and `src/store.js`). |
| `index.html` | The UI shell: topbar, quota banner, Studio panel, Stage panel (player transport bar, filmstrip, log), Settings dialog (compute + pool + keys + MuAPI + custom spaces + data), "How to start the server" help dialog, Library dialog. Ends with `<script type="module" src="src/app.js">`. |
| `src/app.js` | Wiring layer. Owns `state`, drives the engine, renders progress, history, sharing, settings, the server connect/test flow, and the **two generators** — two independent rows in the Studio panel, each a plain on/off switch plus an Auto / Pick-a-model control (`genCfg()`, `rebuildGenSelects()`, `syncGenNotes()`, `syncGenerators()`), whose models and whose `generators` filter live in `orderProviders()`. Each row's select is grouped by source (your server · free pool · this device · your spaces · one per paid vendor · six for MuAPI, each with its own glyph). It also owns the **frame-rate selector** (`nativeFps`/`syncFps` — the ladder snaps to what the chosen model can really render and says so), the **undress switch** (`syncUndress`), and `showResultNote()`, the result card's honesty line: the camera-move banner, the real length, the achieved fps, and the precision/adapters a GPU server actually used. It also owns the **prompt enhancer** (the `✨ Auto-enhance` button → `runEnhance()`, which streams a richer prompt from `ai-text-plugin`'s `generateText` straight into the prompt box, in whichever of the four `ENHANCE_MODES` — Cinematic / Faithful / Short / Technical — is selected in `#enhanceModeSel`), the **grouped style picker** (`fillSelect()` builds `<optgroup>`s from the 82 styles' `group` field), the **Lock seed** switch (`#lockSeedToggle`: `handleResult()` writes a render's real seed back into `#seedInput` so the next run reuses it), the **dark/light theme toggle** (`toggleTheme()`/`applyTheme()` via `html[data-theme]`, saved with the settings), and the **after-run trace wipe** (`wipeTraces()` in a `finally`, when the toggle is on). The NSFW controls and the repaint box are read from the DOM on every run, and `doSave()` mirrors the form back into `state.settings` so the in-memory copy can never drift from what a save wrote. Exposes `window.AIVideoGen`. Every run mints an autonomous run name (`slug-date-random`); each rendered segment is auto-saved to the Library sandbox as `name_take01.mp4` the moment it arrives, and the finished clip is saved and downloaded as `name_Final.mp4` (shown on the result card and on every library card, which has its own Download button). |
| `src/engine.js` | Orchestrator. `orderProviders()` applies the compute mode — and, on an **undress** run, leaves the on-device rig out of Auto (a camera move cannot undress anyone) while an explicit "Only this device" still uses it; composes prompts, plans segments, runs segments with failover + cooldowns, chains frames, stitches, emits UI events. `undressStages()`/`undressStageAt()`/`segmentPrompt()` carry the **undress timeline** (each segment of a chain gets the next rung of a rising prompt). **The segment loop accounts in real seconds** (each returned clip is probed and added to `madeSec`, and the loop fills the request rather than assuming it), **judges every clip before stitching it in** (`clipMetrics`, against the frame that segment was given — see § *Accuracy*), scores each attempt and keeps the best if the retries do not improve on it, and stitches to the exact requested length. A clip the browser **cannot decode** is a failed attempt and is re-rendered on the next route, never a silently-kept beat that takes the finished run down at `stitch()` time. **It also learns within a run:** `rankProviders()` re-sorts the routes at each beat boundary (never mid-beat) by what has actually worked this run — a provider that just delivered a beat is asked first, one that has refused for allowance last — and a halved ask **grows back** one rung (0.3 → 0.5 → 1) whenever a beat succeeds, so a single early refusal cannot shrink every later beat. A single clip returned at the wrong rate is re-timed (`retimeClip`) and, when it over-runs, trimmed; `res.meta` carries the server's `fps`/`interpolated`/`precision`/`lora` plus the honest `duration`/`short`. Owns the privacy machinery too: `privacyRelay()` (a relay or a `privacy` error, never a direct request), `providerRequest()` (paid vendors, status polls included), `downloadClip()`/`pollinationsKeyframe()`, and `privacy` as a retryable failure kind that never puts a model on cooldown. |
| `src/providers.js` | The model catalogue: aspects, qualities, **82 look-and-feel styles in 7 groups** (each with a `phrase` and its own `negative`, rendered as `<optgroup>`s), the per-style negative presets (`NEG_REALISM`/`NEG_ANIME`/`NEG_ART`/`NEG_3D`/`NEG_CINEMA`), the **`ENHANCE_MODES`** prompt-mode table that drives the enhancer, 18 camera moves, 13 angles, the default/NSFW negative blocks, per-provider Gradio adapters, the paid key providers (`KEY_PROVIDERS`), the MuAPI catalogue turned into providers (`MUAPI_PROVIDERS`, one per model, `kind:"muapi"`, carrying its group for the picker sections), and `OFFLINE_PROVIDER`. Adapters declare their inputs **by parameter name** (each Space's own `*_ui`/`safe_mode`/… names) rather than by position, so a Space that grows a slider cannot silently break one. **Seven uncensored routes** are listed here (all verified against each Space's live `/gradio_api/info`, and the routing `fps`/`maxSec` read out of each Space's own `app.py` where it could be read): the three members of the Wan 2.2 14B lightning-NSFW family (`wan22_nsfw` · `wan22_nsfw_mirror` "…NSFW II" · `wan22_nsfw_mirror2` "…NSFW III"), the LTX 2.3 likeness-anchored build (`ltx23_nsfw`, the most identity-faithful free route), the text→video LTX route (`ltx_nsfw_t2v`, used only when there is no reference picture), MiniMax H3 NSFW and Uncensored-video2 (whose `fps: 24` and `maxSec: 2` come from its own app.py — it writes 24 fps and its ZeroGPU window is capped at 45 s, which buys ~2 s at 480p). `wan22_nsfw_lora` was **removed** because its Space is on `cpu-basic` and can never start a GPU job — and note that several entries here are **private** repos, for which the Hub API answers `Invalid username or password` even though the Space is alive; verify those by their hf.space URL. A general-purpose Hunyuan build lives at the end of the free pool: **HunyuanVideo 1.5** (`hunyuan15`, Tencent's distilled 8.3B, 6 steps, landscape 480p). |
| `src/muapi-models.js` | The MuAPI catalogue: 51 i2v/t2v endpoints in six named sections (◆ flagship · ◇ balanced · ⚡ fast · ▾ budget · ✦ uncensored · ✎ text→video), each row carrying the request facts the payload builder needs (which field takes the start image, whether it takes a last frame, duration range/enum, aspect and resolution enums, quality enum, seed/negative support). Says at the top how to rebuild it from the live OpenAPI spec. |
| `src/muapi.js` | MuAPI wire protocol: `buildMuapiPayload()` maps this app's controls onto each endpoint's own field names, `muapiRun()` submits + polls + returns the clip URL, `muapiBalance()`/`muapiEstimate()` back the Settings buttons. Every call goes through Perchance's fetch proxy (the vendor sends no CORS headers), and the reference frame is published to a public URL first because the API rejects data URLs. |
| `src/server.js` | Client for your own GPU server: `normalizeServerUrl`, `serverHealth`, `providersFromHealth` (→ provider objects with `kind:"server"`, carrying `sizeGb`/`cached`/`cachedGb`/`lora`/`native`/`weightsSource`/`family`), `serverGenerate` (POST job → `EventSource` on `/api/status` → download `/api/result`), `serverWeights` / `serverDownloadWeights` / `serverRemoveWeights` (the weights cache: list, fetch with live progress, delete), `serverCancel`. The job POST carries the requested `fps` and, for a **Wan-family NSFW run**, `loras: ["nsfw", "motion"]` from the server's free adapter catalogue; the job's meta (`fps`, `interpolated`, `precision`, `lora`) is passed back into the result. The job stream's guard is an **inactivity** timeout (20 min, 6 h ceiling) rather than a wall-clock one, because a first run can spend an hour fetching 90 GB of weights. |
| `src/stillfilm.js` | **The clip that needs no GPU.** `renderStillFilm()` holds each drawn storyboard still, cross-dissolves it into the next over a slow push-in, and encodes the result at exactly the requested length and frame rate. It exists because on an undress run the clothing comes off in the *stills*, not in the motion — so a run whose every video route refused can still be delivered as the pictures it already paid for, instead of an error. The result card says plainly that no video model animated it. |
| `src/offline.js` | The on-device renderer — **a camera move over one still, not generated video.** Builds a depth map (`buildDepth`), a per-scanline depth profile (`buildRowProfile`, `WARP_LINES = 128`), a sharp cover-cropped texture and a blurred backdrop; uploads them to a **WebGL displaced mesh** (`buildGLRig` — one watertight mesh whose row vertices all share a boundary, so there are no compositing seams, with GPU bilinear resampling and grain/vignette post-passes) and animates it with the 18 camera moves. `renderMotionClip()` records with the **deterministic encoder** (`encodeCanvasClip` from `src/encode.js` — WebCodecs `VideoEncoder` + a WebM muxer at exact frame timestamps, so the file's length is right to the millisecond, with `MediaRecorder` only as the fallback) and also returns 6 poster frames + the true last frame, so nothing downstream needs to decode the video. If WebGL is unavailable it falls back to `build2DRig`, a clean 2-layer Ken-Burns move (no row strips, so no banding) and logs `console.warn("offline rig: WebGL unavailable…")`. |
| `src/gradio.js` | A tiny Gradio client: `spaceToHost`, `fetchInfo`, `spaceParams`, `uploadBlob`, `callEndpoint`, `classifyError`, `findMedia`, plus `autoAdapter()` which auto-detects any public video Space. `attemptPlan()` gives each request its address (or its relay, in strict-privacy mode), the SSE stream is read through a relay, and `alignData()` lays named inputs out against the Space's live signature. **The allowance has two identities and `callEndpoint()` now treats them as two:** a request with a token is billed to the *account* (5 min/day) and one without is billed to the *address it leaves from* (2 min/day), so a `quota` refusal with a token in play retries **the same address anonymously** before it walks to the next relay — the fallback that used to require a second relay to exist, and therefore never ran when strict privacy left only the built-in proxy in the plan. An instant empty refusal from ZeroGPU is recognised as the *allowance*, not the model, and is remembered **as the identity that actually failed** (`noteZeroGpuBlock`/`loadZeroGpuBlock`/`zeroGpuBlockInfo`/`clearZeroGpuBlock`, kv `avg_gpu/zeroGpu`) so `generate()` can skip the picture steps instead of paying for them twice. |
| `src/relay.js` | **The egress layer.** Relay registry (`PUBLIC_RELAYS`, `PERCHANCE_RELAY`, your own server, your own Workers), `relayFetch()` (buffered · **streaming** · direct · own-server · Worker · Perchance's proxy), `relayBlob()` (binary-safe downloads), `untraceInit()` (no referrer, no cookies, no cache), `privacyStrict()`/`requiredRelay()`/`relayCapable()` (the strict-privacy policy: a relay or an error, never a silent direct request), `uploadRelays()`/`streamRelays()`/`downloadRelays()`, `egressIp()`/`checkRelays()` for the "Check addresses" button, and `attemptPlan()`'s rotation policy. |
| `src/image.js` | Image plumbing for the privacy path: `shrinkToFit()` (re-encode a picture down until it fits through the relay that has to carry it, dropping quality before resolution), **`stripMetadata()`** (draw the picture to a canvas and re-encode it, so the file that leaves carries *pixels and nothing else* — no EXIF camera, timestamp, GPS or software tag; a browser that cannot decode it gets it back untouched rather than losing the picture), `blobToBase64()`, `blobToDataUrl()`, and **`imageStats()`** — the brightness, saturation and edge detail of a still on the same 128 px basis as `clipMetrics`, so a returned clip can be compared with the frame it was handed. |
| `src/anon.js` | **One anonymous name per run.** `newRunNonce()` mints a short random token at the top of `generate()`; `freshName("start.png")` renames every file the run uploads with it (`start-<token>.png`), so the same picture sent on five runs arrives under five different names and an endpoint cannot link the runs by filename. Pairs with `stripMetadata()` in `src/image.js`: the name is anonymised, and the picture carries no tag either. |
| `src/nsfw.js` | Making the starting frame explicit (see § NSFW): `prepareExplicitFrame()` (the `#nsfwFrameSel` modes), `undressImageInpaint()` (free AI Horde **inpainting** — builds the mask with `buildMaskBlob()`, polls `/generate/status/` with live queue-position/ETA stage messages for up to `INPAINT_WAIT_MS` = 20 min, then `compositeInpaint()` pastes the repaint back into the full-resolution original), `drawExplicitFrame()` (Pollinations text-to-image + `stripWatermark()`), `explicitPrompt()`/`NSFW_FRAME_SUFFIX`/`INPAINT_NEGATIVE`, `torsoMaskBox()` (native `FaceDetector` where available, else `TORSO_BOX_FALLBACK`), and the older `undressImage()` img2img path (kept, no longer reachable from the UI). `undressImageInpaint()` now takes `want` (`all`/`top`/`bottom`) and `useSegmentation`, and hands `compositeInpaint()` the detector's full-resolution alpha canvas when there is one. `runHorde()` answers a `401 InvalidAPIKey` by dropping to the anonymous key for the rest of the run instead of failing the step — `hordeRejectedKey()` reports which saved key Horde refused, so the UI can say so. |
| `src/segment.js` | **On-device clothes detector** — the thing that turns "undress my picture" from a fixed rectangle into a precise edit. `loadClothesTagger()` loads **SegFormer-B0 clothes** (`Xenova/segformer_b0_clothes`) quantised to 4.2 MB **from `src/models/`** (`allowRemoteModels = false`; only the ~1 MB transformers.js/onnxruntime glue comes from esm.sh, and the browser caches it). `buildClothesMask(image, {want, featherFrac, protect, growFrac})` returns `{canvas, box, coverage, found, grow, weights, size}` where `canvas` is a **full-resolution, feathered alpha mask** (white × garment probability, faded by the head classes), `coverage` is the share actually handed to the worker and `found` the share the detector alone caught (they differ because the garment region is **grown** by `nsfwMask.grow` before the head protection is re-applied — see `src/README.md` § *The mask is grown*). `maskBlobAt()` renders the black-and-white PNG AI Horde wants in `source_mask`, and `maskPreview()` makes the green-tinted overlay the repaint dialog shows. `preloadClothesTagger()` warms it when the NSFW toggle goes on. `maskTunables()` reads the `nsfwMask` list in main.pjs. |
| `src/models/Xenova/segformer_b0_clothes/` | The detector's weights and configs, shipped with the generator so runtime needs no Hub access: `onnx/model_quantized.onnx` (4,384,537 bytes), `config.json`, `preprocessor_config.json`. **Rebuild recipe:** fetched byte-exact from `https://hf-mirror.com/Xenova/segformer_b0_clothes/resolve/main/onnx/model_quantized.onnx` (plus `/raw/main/config.json` and `/raw/main/preprocessor_config.json`) because huggingface.co's LFS CDN is unreachable from this network — a plain `/resolve/` fetch there hangs while the mirror works. To refresh, re-fetch those three and write them to the same paths; nothing else references the model. |
| `src/video.js` | Video plumbing: object URLs, MIME sniffing, `loadVideo(blob, {knownDuration})`, `probe`, `extractFrame`, `filmstrip`, `seekVideo` (frame-exact), `stitch()`, `retimeClip()`, and **`clipMetrics()`** — one pass over a returned clip that measures everything the engine judges it by (motion, edge detail, brightness, saturation, how far its opening frame drifted from the still it was handed, how far its closing frame drifted from the beat's target). `loadVideo`/`probe` **repair a clip's broken duration at load time** (`currentTime = 1e101`, then read `duration`), which is what makes a file labelled 81 minutes show its real length. `stitch()`/`retimeClip()` both take a **`targetDuration`** so a finished run is the length that was asked for — an over-running chain is cut to it, an under-running one is reported (`short: true`) rather than padded with a frozen frame. `stitch()` also **skips** a clip that will not decode (it returns `skipped` and keeps the rest) instead of throwing the whole chain away over one corrupt download. `clipMotion()` still exists as the motion-and-detail-only shape. |
| `src/encode.js` | **Deterministic encoding and frame rate.** `FPS_LADDER` (`8/12/16/24/30/48/60`), `NATIVE_FPS` and `snapFps()` (the ladder snaps to what the chosen model can really render); `encodeCanvasFrames()` renders exactly `duration × fps` frames at exact timestamps and muxes them, `bitrateFor()`, `patchWebmDuration()` (writes a real EBML `Duration` into a blob that has none), `recordCanvasRealtime()` (the old real-time recorder, now the fallback), `hasVideoEncoder()`, `durationIsSuspect()`/`repairDuration()`. This is the fix for "the video is 1 hour long". |
| `src/friendly.js` | **The Simple run log's voice.** Local rotating studio-talk lines ("Warming up the studio…", "Filming part 2 of 5…") with per-stage busy labels — no network, no cost, no quota. `LOG_MODES` (Simple/Full) drives `#logModeRow`; Simple is the default so visitors and screenshots never see the wiring, Full keeps raw engine events for debugging. |
| `src/grade.js` | **Color grade before export.** 13 filter presets (None/Warm/Cool/Cinematic/Noir/Vintage/Vibrant/Sunset/Teal/Grain/Realistic Noise/Light Leak/ADD Glow) plus intensity, saturation, light, exposure, contrast, gamma, grain, light leak, sharpen and an overlay color + strength. `gradeActive()` decides whether an export must re-encode; `cssFilterFor()` (now with a real gamma SVG stage) + the tint veil + `paintLiveOverlays()` (animated grain + leak layers) drive the live player/canvas preview; `gradeCanvasInPlace()` grades stills and `drawGradedVideoFrame()` grades each exported video frame (filter → gamma LUT → tint/grain/leak → light sharpen). Intensity is implemented as falloff of every value toward neutral, so preview and export agree. |
| `src/stickers.js` | **Stickers + ready frames.** 20 emoji stickers and 6 frames (none/cinema/polaroid/neon/rounded/vignette). `addSticker()` drops a draggable/scroll-to-resize/double-click-to-remove sticker onto any stage layer; `listStickers()`/`getFrame()` are read at export time and `drawStickersOn()`/`drawFrameOn()` bake them into image and every video frame. |
| `src/diag.js` | **Private diagnostics ring.** `diag()` keeps the last 200 relay/proxy/VPN events with masked hosts; `window.__diag` exposes list/text/clear for this session only. The public run log only ever gets masked addresses. |
| `src/player.js` | The Stage's mini-player. `fitStage()` sizes the screen element in pixels to the **clip's own aspect ratio** (playing clip → poster → the aspect picked in the form) inside the column's content box and the available page height, so 9:16, 21:9, 1:1 and 4:3 all scale to whatever the page view is; it also decides the `p-narrow`/`p-tiny` classes, so the transport bar drops buttons rather than overflowing. `playerLoad`/`playerHint`/`playerReset`/`playerFallback` drive it; `togglePlay`/`setRate` back the play-pause button and the `− x1 +` speed stepper (a ladder from 0.25x to 8x, with the whole-number rungs adjacent so fast-forward is a few presses); fullscreen pins the screen to the viewport and asks the browser to lock the orientation to the clip's shape. |
| `src/store.js` | `kv-plugin`-backed persistence: settings (the compute/server/privacy fields — `strictPrivacy`, `freshRun` and `wipeTraces` all default to `true` — the render knobs `fps`, `undress` and `lockSeed`, and the API keys, `muapiKey` among them), the clip library (finals capped at 24, sandbox takes at 60, voice 24, reader 24, imports 60 — each pool only ever evicts its own oldest, so takes stay until deleted by hand), per-provider cooldowns, and `clearCooldowns()` (used by fresh-run and by "Reset allowance"). |
| `src/library-save.js` | Shared library writer + categorizer: `saveBlobToLibrary()` / `saveTextToLibrary()` (used by every tab except chat — video/image results, editor exports, voiceover videos, voice tracks, reader narrations, all imports), `libCategory()` / `LIB_CATS` (Video / Images / Editor / Voice / Reader / Imports / Takes) driving the Library dialog's category chips, badges and finder, plus `setVideoRefReuse()` / `setImgEditReuse()` tap-to-reuse loaders. |
| `src/edit-agent.js` | Agent edit for Image Studio: `planEditSteps()` splits one prompt into ordered single-change steps (AI planner via `generateText`, local comma/and/then splitter as fallback), `runEditAgent()` chains them through `generateImages()` edit mode, each step's output blob becoming the next step's input. |
| `src/facelock.js` | P1 browser face blend (native FaceDetector, feathered reference-face paste, face-region accuracy score) + S5 wardrobe/scene token tightening + board lazy-load. |
| `src/poses.js` | S5 pose variants (6 presets, on-device head-pose readout, face-locked img2img chain per pose) + `estimatePose` (blazeface landmarks: roll from eyes, yaw from nose offset). |
| `src/FACELOCK.md` | krumppy's face-locked img2img blueprint + build plan (P1 browser face blend → P2 server SD1.5 img2img → P3 per-person LoRA) + prompt-level scores. Resume here next chat. |
| `src/guide.js` + `src/guide.css` | Community + tutor layer: Feedback wall (`amt-feedback` comments channel), Tutorial page, AI Tutor page + floating `?` ask-anywhere panel + hover tips (all grounded in the built-in manual via `generateText`), first-run new/returning prompt, and the private owner insight box (PIN-gated, logo ×7 or `#owner` entry; novice-friendly live dashboard — Here-now / Opened / Generations cards, plain-word bars, latest-doit list, sample preview, CSV report — fed by anonymous beacons on the `amt-insight-k7q2x9m4` channel, only ever rendered after unlock; plus an emergency offline lock). |
| `src/traces.js` | The "leave no trace" module: `wipeTraces({cookies, storage, caches, timing, quota})` expires this origin's cookies (several paths + the Cookie Store API), empties `localStorage`/`sessionStorage`, every CacheStorage bucket and the resource-timing buffers, and drops the cooldown records; **`fullReset({traces, quota, history})`** is the one-click **Reset** — the same wipe plus the app's own records (the bench and the router's memory of which routes refused), and optionally the saved library; `describeWipe()`/`describeFullReset()` turn the report into the one-line log/summary the UI shows. Its doc comment states plainly what a page *cannot* delete (another origin's cookies — huggingface.co's own — and the server-side per-address GPU allowance, which only a different address can refresh). |
| `src/vault.js` | **The private-content engine.** Encryption at rest plus the leak audit. `ensureVault()`/`vaultState()`/`setPassphrase()`/`unlock()`/`lock()`/`removePassphrase()` manage an AES-GCM key generated on this device (a passphrase wraps it with PBKDF2-SHA256, 210k); `encryptBlob()`/`decryptBlob()`/`encryptString()`/`decryptString()` are what `src/store.js` seals library records with; `auditEgress()` is the Settings → Content safety panel (every route the current run's content can take, what travels, where it lands, how exposed); `leakBlocked()`/`frameStepBlocked()` are the leak guard — no publishing to a public URL (which is what blocks MuAPI), and a “nothing leaves this device” mode that refuses the free inpainting instead of handing the photo over; `destroyVault()` is the panic button. Its doc comment states the honest limits (a device key sits next to the ciphertext; a relay reads what it carries; a third party cannot be un-told). |
| `src/router.js` | **The uncensored routing engine.** `classifyRequest()` decides the content tier locally from the prompt, negatives and switches; `moderationOf()` says what each provider really does with explicit content (this device · your own server · a dedicated uncensored build · its own `safe_mode` switch turned off · a paid vendor · **runs a content check** · no path); `acceptsExplicit()`/`routeReadout()` are what `orderProviders()` filters an explicit run by; `recordOutcome()`/`loadRouteStats()`/`outcomeScore()` are the memory — a genuine content refusal is written to `avg_route` and that route is sent to the back, so a run stops rediscovering the same wall; `ROUTING_MODES` is the strict / widen choice. |
| `src/ROADMAP.md` | The **forward** plan: the things deliberately not built yet and the order to build them — video-to-video / a source-video input path (which gates Wan VACE and Animate), the remaining model expansion and the GPU verification the Hunyuan entries still need, local provenance metadata, and what is explicitly *not* planned (a centrally hosted backend, in-browser diffusion). The research and measurements behind the current build are in `src/SPEC.md`'s requirement → delivery table. |
| `src/REVIEW.md` | The review of the external "AI Video Studio — Perchance Master Roadmap" the user supplied: an area-by-area verdict (✅ built / ➕ added / 🔜 planned / ➖ not applicable), what was changed in the code because of it (grouped styles + per-style negatives, prompt modes, lock seed, 8× player, Hunyuan models), and why the roadmap's centrally hosted FastAPI + Redis + Postgres + S3 backend is deliberately **not** built — the app's per-user server + free pool + on-device rig is the equivalent without the cost or the privacy hit. Read it before re-litigating architecture. |
| `src/styles.css` | The two themes, switched by `html[data-theme]`: **dark** (the default cinematic look) and **light** (the topbar theme button flips it; the choice is saved with the rest of the settings). The Stage and the player stay dark in both — a video reads better against black. Layout, panels, chips, toasts, dialogs, banner, server-status block and the responsive breakpoints all live here, and every light-theme colour is an explicit override so nothing is left white-on-white. |
| `src/server/server.py` | **The backend.** argparse → weights layer → model registry → single-worker engine (lazy `from_pretrained`, `resolve_dtype` — auto/fp16/bf16/fp8/fp32, with fp8 degrading to bf16 below compute capability 8 — CPU-offload fallback, the **LoRA adapter layer** (`ensure_loras` → `_attach_half`/`detach_loras`: a Wan 2.2 LoRA is an H/L pair, so each file gets its own adapter on `transformer`/`transformer_2` and all of them are armed together), frame interpolation (`interpolate_video` + `fps_plan`, RIFE when installed and ffmpeg `minterpolate` otherwise, so a render can be raised to the requested rate after the fact), cancel + step progress) → FastAPI JSON/SSE API → optional cloudflared quick tunnel. The **weights layer** (`Weights`) fetches a model's files on first use and keeps them, trying **ModelScope first** (complete Wan family, reachable where huggingface.co is not), then Hugging Face, then `--hf-endpoint` (`https://hf-mirror.com`); both SDKs resume, a trimmed download that will not load is re-fetched in full once, and progress is reported over the same SSE stream as denoising. 18 models, 8 of them Wan (plus two HunyuanVideo entries whose argument contract is verified against the diffusers pipeline source — frames `4n+1`, embedded guidance 6.0, the LLaVA prompt template left at its default, H/W divisible by 16 — but which have never been rendered on a GPU from here); any of them can attach an adapter from the built-in **free catalogue** (`LORAS`: Lightning 4-step distillation, general NSFW, a motion enhancer, anatomical detail — each fetched on first use). CLI: `--download`, `--weights`, `--source`, `--hf-endpoint`, `--cache`/`--models-dir`, `--offline`, `--lora`/`--no-lora`, `--precision {auto,fp16,bf16,fp8,fp32}`, `--revision`. Also serves as a relay you own: `POST /api/relay` (allow-listed, accepts `{bodyB64, contentType}` for multipart) and `GET /api/relay/raw?url=…` (streams — binary and SSE safe, which is what carries the clip and the progress stream). |
| `src/server/requirements.txt` | Python dependencies, including `modelscope` and `huggingface_hub` (the two weight-download SDKs). |
| `src/server/README.md` | Local install, the **weights** section (the three sources in order, the `--download`/`--weights` commands, ModelScope's own CLI/SDK/git recipes, sizes and what runs where), the 18-model catalogue table, the free-GPU-host comparison table, the full API, security notes. |
| `src/colab/AIVideoGen_Colab.ipynb` | One-click Colab notebook: GPU check → pip install → fetch `server.py` → optional Drive weight cache → model choice (all 18 ids) + source + **`PRECISION` and `LORAS`** → optional *fetch the weights now* cell → start with tunnel → print the URL → health/log cell (which prints the precision and the live adapter table) → stop cell → troubleshooting. |

`window.AIVideoGen` exposes `{ state, run, handleResult, planSegments, pollinationsKeyframe, enhance,
applyTheme, genCfg, autoPool, vaultState, auditEgress, classifyRequest, tierLabel, moderationOf,
routeStats, resetRoutes }` for console debugging/automation (e.g. `AIVideoGen.handleResult(fakeRes,
{save:false})` to exercise the result UI without burning GPU time, or `AIVideoGen.auditEgress(...)` to see
where a given run's content would go).

## How a run works

1. **Reference frame.** Use the uploaded image; if none is given, draw one for free with Pollinations (flux)
   — except in `offline` mode, where a real picture is required. Chaining then feeds each clip's last frame
   into the next (for the offline rig that frame is handed over directly, no re-decoding).
   **If the NSFW toggle is on and the starting-frame mode is not "keep my image", this frame is made explicit
   first** (§ NSFW) — an i2v model animates what it is handed and never undresses anyone.
2. **Prompt composition.** `composePrompt()` joins: your prompt → camera angle phrase → camera movement phrase →
   style phrase → NSFW boost → a fixed motion tail. `buildNegative()` adds the artifact block plus either
   NSFW negatives or explicit-content negatives.
3. **Provider order.** `orderProviders(settings, opts, customProviders, serverProviders, cooldowns, outcomes)`:
   `offline` → just the rig; `server` → only your server's models; `pool` → only the free pool;
   `auto` → your server, then the free pool (if enabled), then the rig (if enabled).
   The free pool is always offered — without a token a request is anonymous (a much smaller allowance
   and a lower queue position), and your own added Spaces always count.
   A manual model choice is honoured; if it belongs to a different bucket the mode wins.
   **Two filters then apply, and both are about content rather than compute.** On an explicit run the
   *uncensored routing engine* (`src/router.js`) drops every provider that runs a content check, so an
   explicit request is never submitted to a service that would refuse it and record the attempt — unless
   Settings → Privacy sets routing to “try every enabled model”. And the *leak guard* (`src/vault.js`)
   drops anything that would publish the content to a public URL (MuAPI), plus everything outside your
   own server and this device when “nothing leaves this device” is on. Finally, a route that has
   actually refused content before (`outcomes`, from `avg_route`) goes to the back.
4. **Segment planning.** Each model has a native max duration (Wan ≈ 5 s, LTX ≈ 8.5 s, SVD ≈ 4 s, the rig 15 s).
   A 12 s request on Wan becomes 3 chained segments; `planSegments()` does the maths. On a storyboard run
   the beat length comes from the clip instead (see § *Accuracy*), and it is snapped to whole frames of the
   run's own rate so the beats add up to the length that was asked for.
5. **Failover.** A failed segment is classified. A **quota or busy** failure is not a dead end: the run
   hops to the **next address** and retries the *same* model from there (the free allowance is metered
   per address, so a fresh address usually still has room); and when there is no other address, it
   **halves the ask** and tries the same model again — the pool meters GPU-seconds, so a smaller job
   often goes through, and the clip still reaches its requested length because the run simply renders
   more, shorter beats (see § *When nothing will render*). Only then is the provider benched. Bench times
   come from `root.cooldown` in `main.pjs` (quota 60 s, busy 90 s, paused 60 min, error 2 min — never for
   your own server or the rig), and if *every* provider failed on a quota the run says so explicitly.
   Only if the whole list is exhausted does the run fail.
6. **A returned segment is judged before it is used.** `clipMetrics()` measures motion, edge detail,
   brightness, saturation and how far the clip's ends drifted from the stills it was given and aimed at;
   a segment that is frozen, melted, re-cast or that never arrived is re-rendered (up to two extra tries,
   with a fresh seed and the movement told louder), and if none of the tries is clean the **best** of them
   is kept and the beat is flagged. The clip's real length is what the loop counts, so the run fills the
   time it was asked for rather than the time it hoped for.
7. **Stitching.** Multi-clip runs are placed on one computed output timeline and encoded at the run's frame
   rate (`stitch()` in `src/video.js`). A storyboard chain is cut together with no crossfade — its beats
   are contiguous by construction — and the timeline is cut to the requested length, so the finished file
   is the length the result card says it is.
8. **If nothing can render it, the stills still can.** When every route that would animate a beat has
   refused, the drawn storyboard frames are turned into the clip themselves (`src/stillfilm.js`), and a
   run that has already rendered some beats hands them back with a **“Finish this clip”** button that
   continues from the frame the chain reached, re-using the drawn stills and keeping the original
   reference picture as the identity anchor. See § *When nothing will render*.

## NSFW: the starting frame has to be made explicit first

An image-to-video model animates the frame it is handed and never undresses anyone — Wan, LTX and SVD all
faithfully preserve the clothes in the reference picture. So an "undress …" prompt used to produce a
*clothed* video, and when the pool was out of allowance the run fell to the offline rig, which then moved a
clothed still very convincingly. That is the whole reason the feature appeared "not working". `src/nsfw.js`
fixes it by making a genuinely explicit first frame **before** the i2v stage runs.

`Settings → NSFW starting frame` (`#nsfwFrameSel`, shown when the NSFW toggle is on):

| Mode | What it does |
| --- | --- |
| **Auto — undress my photo (free inpaint)** (default) | `undressImageInpaint()` — free, uncensored AI Horde **inpainting** on *your* photo. First the app segments the picture **on your device** (`src/segment.js`, 4.2 MB model shipped in `src/models/` — no upload, no Hub) and repaints **only the clothing pixels**, then copies every pixel outside that mask back from the original at full resolution. That is the difference between "undress **my** picture" and "draw a naked stranger". `#repaintWantSel` in the `#repaintDlg` "Repaint area" dialog chooses what counts as clothing (all / top / waist down), and dragging the box switches the run to a manual rectangle instead. A stage line shows the live queue position and ETA while it waits, and a free registered Horde key (`hordeKey`) skips most of the wait. If Horde genuinely fails this mode **throws** — it never quietly substitutes a drawn person. |
| **Draw a brand-new explicit person** | `drawExplicitFrame()` — Pollinations (`image.pollinations.ai`, `safe=false`) draws from `explicitPrompt()` + the `NSFW_FRAME_SUFFIX` boost, ~3–8 s, free, no key; `root.generateImage` is the fallback. `stripWatermark()` crops the bottom 9 % where Pollinations burns its mark. Free and instant, but **a new person is drawn** — the source picture guides the prompt, not the pixels. |
| **Keep my image unchanged** | No first-frame step at all. |

`undressImage()` (the older Horde `img2img` path) is kept in `src/nsfw.js` but is no longer reachable from
the UI — see the rejected-routes table below for why.

**How *Auto* keeps your own person.** `compositeInpaint()` in `src/nsfw.js` pastes the worker's repaint back
into the full-resolution original through a feathered mask. Its first version had a bug that showed up as a
hard line across the chest: the patch canvas was *exactly* the box size, and a `blur()` + `destination-in`
mask on a canvas that size clips at the last column — the alpha is still 0.5 in that final column and drops
to 0 in one pixel, so the feather never tapered at all. The patch is now the box **plus a ring** of `pad`
width, the ring is filled with the worker's *own* pixels for that region (source rect and dest rect clamped
identically), and the mask is inset by `pad` with `sigma = pad / 2.5`. Measured seam energy (mean |Δlum| per
pixel across the boundary; the photo's own texture reads 1–3):

| variant | left edge | right edge | top edge |
| --- | --- | --- | --- |
| before the fix | 31.5 | 68.4 | 6.4 |
| after the fix | **4.1** | **10.8** | **2.1** |

Compositing the original onto itself is now a bit-exact no-op (max diff 1/255, zero pixels over 2), and on a
real run the pixels outside the box differ from the original by **0.7/255** on average. `INPAINT_MASK_FEATHER`
is `0.1`, raised from 0.06: an unfeathered mask left 135 of edge energy at the mask border against the
photo's own 54, and feathering drops that to 82.

**Finding the clothes, not a rectangle.** A box over the torso always repaints some background, some hair,
some bare skin and the neckline, and the quality of an inpaint is set by the mask long before a worker sees
it. So the mask is now **segmented, not boxed**: `buildClothesMask()` in `src/segment.js`
runs **SegFormer-B0 clothes** on the wasm backend, locally, on the user's own picture — the weights are
**4.2 MB and ship inside the generator** under `src/models/`, `allowRemoteModels` is `false`, and only the
transformers.js glue comes from esm.sh (cached by the browser). Measured on the real reference photo
(752×1392): **3.0 s to load the model from `src/`, 1.1 s per segmentation**, label map 128×128. The mask is
built from **softmax probabilities** rather than an argmax, in two channels — clothing `g` and head
`p` (face/hair/hat) — combined as `m = g · (1 − min(1, 1.15·p))`, upscaled bilinearly to full resolution and
blurred by 2 % of the short side. That gives a mask whose boundary is a ramp in both directions, so there is
no staircase at the collar and no hard edge anywhere. Measured on the reference photo:

| quantity | value |
| --- | --- |
| coverage | **22.5 %** of the frame (`want:"all"`) |
| mask weight on garment classes | 215,921 |
| mask weight on the protected head classes | **53 ≈ 0** |
| mask weight on everything else | 1,672 (0.8 %) |
| mean mask alpha in the 40–65 % band (where 22–51 % of pixels are exposed chest skin) | **0.005–0.048, and 0 % of pixels above 0.5** |
| masked pixels that are skin-coloured | 8.3 %, vs **19.6 %** skin in the frame overall |
| composite: mean abs-diff inside the mask, feeding an all-blue "repaint" | **98.0** |
| composite: mean abs-diff outside the mask / max abs-diff | **0.62** / 10.3 (JPEG 0.95 artefacts) |

So the detector's mask is *inside* the clothing: the head, hair, background and the exposed upper chest are
never handed to the worker, and the numeric composite test shows pixels outside the mask come back
essentially untouched. `compositeInpaint()` gained a `mask` branch for this — draw the worker's output over
the whole frame, `destination-in` the mask, composite over the original, JPEG 0.95; the old box patch with
its padding ring is still there as the fallback. `undressImageInpaint()` accepts the detector's result only
if `0.02 ≤ coverage ≤ 0.7`; otherwise it falls back to `box || torsoMaskBox(...)` so an implausible
segmentation can never become an empty or full-frame mask. If the detector cannot run at all (no
`OffscreenCanvas`, wasm blocked), the dialog says so and the box path is used.

**The mask is grown before it is handed over.** A later real run exposed the failure this fixes: on a
deep-V black top the repaint produced the bare chest, but the un-masked *edge* of the garment stayed over
it as a translucent dark shape — a dark, low-contrast edge is exactly where the detector's confidence
drops, and a missed edge is left behind as a film of the original fabric that the worker cannot see.
`buildClothesMask()` now grows the garment region (a separable maximum filter) by `nsfwMask.grow`
(**1.4 %** of the picture's short side — 13 px on a 960×1280 photo) *before* the head protection is
re-applied per pixel, so the face cannot creep into the mask. Measured on the user's photo: coverage
**13.8 % → 16.1 %**, grow radius 13 px, and the head classes' mask weight stays at **16 ≈ 0**; ~1.3 s per
segmentation. `nsfwMask.feather` and `nsfwMask.protect` are the other two knobs (main.pjs), and the log
now reports both figures (`16% of the frame repainted (14% detected, grown to catch the garment's edge)`).
`INPAINT_NEGATIVE` also names the film itself (`sheer fabric, see-through clothing, translucent fabric,
lace overlay…`) — that is the clause written for precisely this artifact.

Two bugs were fixed on the way: **`box` was not destructured in `prepareExplicitFrame()`**, so `engine.js`'s
`box: repaintBox` was being silently dropped and the repaint-area dialog had no effect on a run at all; and
`#repaintAutoBtn` no longer sets the box to a rectangle by default — "Detect clothes" does, and the box
buttons switch to a manual rectangle (`state.maskAuto = false`), which is what tells the engine to use
`useSegmentation: false`.

**The wait is the real cost.** The whole free Horde image pool has only about **five worker threads that
accept inpainting jobs** — naming three production models reports 5 eligible workers, naming all eight
inpainting models still reports 5, and naming none reports 3. So an anonymous job queues behind everyone
else: observed positions **137–223** with Horde's own estimates of **856–1200 s**, actually starting to paint
**4.5–8 minutes** in. `INPAINT_WAIT_MS` is therefore **20 minutes**, the stage line reports the live position
and ETA (`AI Horde queue position 196 · about 13 min of queue left (2 attempts in flight) · a free key from
aihorde.net/register skips this queue…`), Cancel stays live throughout, and the timeout message says what to
do about it. A free registered key removes most of the wait.

**Routes that were measured and rejected** (all on the user's own photo, not assumed):

| Route | Measured result |
| --- | --- |
| Crop the torso out, img2img it fast, paste it back | the model re-frames the crop, so the returned torso does not line up with the original: ring mismatch **45–72** mean \|Δlum\| against the original's border band |
| Full-frame img2img + the composite above (denoise 0.60 / 0.70 / 0.76 / 0.84) | outside-box drift **21.6 / 26.2 / 44.5 / 50.3**; core-region fabric **0.062 / 0.038 / 0.040 / 0.000** — a coin flip per job and per worker whether the clothes even come off, and the scene drifts |
| Horde `img2img` at denoise 0.55 / 0.65 / 0.75 / 0.8 | 0.55 and 0.65 keep the person but stay **clothed**; 0.75 and 0.8 undress but return a **different person/scene** |
| Pollinations `model=kontext` or `nanobanana` + `image=` | **HTTP 500** — `kontext model is only available on enter.pollinations.ai`; anonymous `/models` lists only `sana` |
| Pollinations `model=flux` + `image=` | 200, but `image` is **ignored** (a generic text-to-image nude, watermark and all) |

So *Auto* (inpainting) is the only free route that both keeps your person and removes the clothes, *Draw* is
the guaranteed instant answer at the cost of a new person, and the log line always states which happened
(`NSFW frame → AI Horde: repainted your own picture (default torso area), kept the original at full
resolution around it`).

## Motion, length and frame rate — the "same image for an hour" report

Three separate faults sat behind that one clip; `src/SPEC.md`'s requirement → delivery table has the measurements.

1. **It was the on-device rig, not a video model.** The log said `Motion (offline)` and the file was 480×832 —
   exactly what `renderMotionClip()` produces. That renderer is a camera move through one still: no diffusion
   model, so it cannot invent a person moving, let alone remove a garment. It is the last entry in Auto's
   order, and it caught that run because every free Space had refused first (ZeroGPU's allowance is metered
   per address). **Fixed by telling the truth about it:** the offline clip gets a banner on the result card
   and a log line saying it is a camera move and not generated video, and **Auto no longer hands an undress
   run to it at all** (see below).
2. **81 minutes for a 5 s clip.** `MediaRecorder` WebM carries no duration, so the browser guessed from the
   last cluster timestamp. **Fixed at both ends:** the rig now encodes deterministically (WebCodecs + muxer,
   exact timestamps, any fps) and the player repairs a broken duration on *any* provider's file at load time.
   Measured: 2 s @ 24 fps → 2000 ms; 5 s @ 30 → 5000 ms; 1.5 s @ 8 → 1500 ms.
3. **Nothing moved.** The rig (above), and the server's advertised LoRA that was never actually attached
   (§1.3 — `load_lora_weights` did not exist in the file). The server now loads what it advertises, and the
   catalogue includes a free **motion enhancer** written for exactly this complaint.

**Frame rate is a real choice, not a label.** `#fpsSel` offers `8 / 12 / 16 / 24 / 30 / 48 / 60`. `snapFps()`
maps the request onto what the chosen model can actually render (`NATIVE_FPS`), and the app says when it
snapped ("renders natively at 16 fps, so 60 means interpolating up"). The on-device encoder honours the rate
for real (30 fps means 30 distinct frames, never 30 duplicates of one), a single pooled clip at the wrong rate
is re-timed before it is used, and a GPU-server job reports back `fps`, `interpolated`, `precision` and `lora`,
which the result note prints. The server renders at the model's native rate and interpolates up afterwards
(RIFE, else ffmpeg), rather than asking a Wan for 60 fps and getting mush.

## Accuracy: the clip is the shot that was asked for

A real run — 5 s asked for, 9:16 / 480p / 16 fps, undress on — delivered a **3.25 s** file whose first
0.94 s was a melted, over-exposed render, and reported success. Decoding the clip frame by frame is what
found both faults, and neither was measurable anywhere in the app: the length on the result card was the
length that had been **asked for**, and "it produced a valid video file" was being treated as "it produced
the shot".

Both are now fixed, and both fixes are in the file itself rather than in the UI.

**The length is real.** The segment loop used to decrement its remaining time by the seconds that were
*requested* (1.3 s at a time). Two things were quietly eating the difference: a model renders whole
frames, so 1.3 s at 16 fps is 20 frames — 1.25 s — at every beat; and a 0.25 s crossfade at every join
takes another quarter second. Three beats × 1.25 s − two crossfades = **3.25 s**, exactly what the user
got. Now:

- beat lengths are **snapped to whole frames** (`Math.round(sec × fps) / fps`), so a beat asks for what a
  model can actually produce;
- the loop **probes every returned clip** and adds its real seconds to `madeSec`, then keeps rendering
  until the request is covered — a beat that comes back short is made up by the next one, not forgotten;
- a **storyboard chain stitches with `crossfade: 0`**, because beat N+1 is animated from the same
  keyframe beat N was animated *to* — there is nothing between them to blend, so the crossfade was only
  ever stealing time (0.75 s of a 5 s request across four beats) and forcing a whole extra beat to make
  it back up;
- `stitch()` and `retimeClip()` take a **`targetDuration`**: the request *is* the timeline, so an
  over-running chain is cut to it. Measured: five 1.25 s beats with 0.25 s crossfades (timeline 5.25 s)
  → a file that probes at exactly **5.000 s**; a 1.25 s clip re-timed to a 1.0 s target probes at exactly
  **1.000 s**.
- a chain that genuinely could not be filled (every route refused the last beats) is **reported short**,
  not padded with a frozen tail: three 1.25 s beats probe at 3.25 s, `short: true`, and the card says so.

**The clip is judged, not trusted.** `clipMetrics()` in `src/video.js` walks a returned segment once and
measures the things that were invisible before:

| Number | What it catches | Measured on the real failure |
| --- | --- | --- |
| `motion` | a frozen clip — a model that took the still and animated nothing | 0.0022 on a deliberately frozen clip (`STATIC_MOTION_FLOOR` is 0.004) |
| `startDrift` | a clip that threw its conditioning still away and invented its own shot | **100 %** of the opening frame changed, against ~6 % for a good segment (threshold 0.55) |
| `blown` | an over-exposed or melted render: far brighter *and* far more saturated than the still it was given | brightness 177–182 and saturation 120–130 against the reference's **82.2 / 54.0** (+95 / +76; thresholds +55 / +35) |
| `flat` | a blurred, smeared or detail-free render: far less edge detail than the still | detail 0.013–0.019 against the reference's **0.0366** (35–52 %; threshold 55 %) |
| `endDrift` | a beat that never arrived — the model ignored the target keyframe and held the still | measured against the beat's next drawn keyframe (threshold 0.7, kept loose because partial arrival is normal) |

The comparison is against **the frame that segment was given**, not the run's opening picture, so it stays
true as the ladder undresses her — a nude beat is judged against the nude still it started from. Every
attempt at a beat is scored, the best attempt is remembered, and if two retries do not improve on it the
**best** one is what gets kept rather than the last; a clean attempt always outranks a flagged one. A beat
no model could get right is counted (`imperfectBeats`) and the result card says so instead of reporting a
clean run.

Verified in the live page: `clipMetrics` flags a frozen clip (motion 0.0022), a melted one (brightness 185
vs the reference's 73, saturation 128 vs 18, detail 0.001 vs 0.068 — `blown`, `flat` and `startDrift` all
true) and a re-cast shot (`startDrift` 1.0), while a good clip (motion 0.858, detail 0.0651, drift 0.06) is
left untouched. `imageStats` returns detail 0.118 for a textured picture, 0 for a flat one and `null` for
an undecodable blob. The honest limit is unchanged: a beat is only as good as the worker that rendered it —
the engine can now tell a bad beat from a good one and go looking for a better worker, but if every route
that will take the job is a weak model, the clip is a weak clip, and the card says which beats came back
imperfect.

## When nothing will render: the cheaper ask, the stills, and finishing a stopped run

A 10-second undress run came back with **nothing at all**: the storyboard drew `0/4` frames and then
every video route refused for quota (`The free allowance is spent for this address`). Three of the four
things that stood between that run and a clip are now fixed, and the fourth is at least explained.

**1. The ask gets cheaper by itself.** The free pool does not meter requests, it meters **GPU-seconds per
address** — so a refusal for quota means *this job is bigger than what is left*, not that there is
nothing left. That is the pool's own message ("a shorter clip or a lighter model often still goes
through"), and it was advice the app printed and never acted on. It now acts: on a quota or busy refusal
the run halves the beat length and asks the same model again (`1 → 0.5 → 0.25`, floored so it stays a
real render), because **the clip's total length does not depend on how long one beat is**. A beat is
sliced off the request's remaining seconds, so halving the ask means the same 10 seconds arrive as eight
short beats instead of four long ones — each one cheaper for the pool to accept. The storyboard's ladder
is unaffected: which rung a beat covers comes from how far through the clip the chain has got, not from
how many seconds the beat happens to be. The ask also **grows back**: a beat that comes back proves the
pool will answer at that size, so the halved ask steps back up (`0.3 → 0.5 → 1`) on every successful beat —
leaving it pinned at the floor is what once turned a single early refusal into a run whose last six beats
were all 0.5 s. And the run now **re-ranks the routes at each beat boundary** (`rankProviders()` in
`src/engine.js`): the model that just delivered a beat is asked first next time, and one that has refused
for allowance goes last, instead of rediscovering the spent routes on every single beat.

**2. The drawn stills become the clip.** On an undress run the clothes come off in the *pictures* — that is
the whole design of the storyboard — so if every video route refuses after the stills have been drawn,
those stills are already the thing the user asked for. `src/stillfilm.js` turns them into a clip: each one
held, then cross-dissolved into the next over a slow push-in, encoded at exactly the requested length and
frame rate with the deterministic encoder. It costs no GPU and no allowance. **Measured: four 270×480
stills → a 10.0 s clip at 16 fps, 160 frames, WebCodecs mp4, in 0.44 s** — and the filmstrip was checked
by eye: the sequence dissolves from the dark garment to the bare torso exactly as the stills do. The
result card never lets this pass for generated video: *"No video model would take this run, so the clip is
the storyboard's own 4 drawn stills — cross-dissolved… What is missing is generated movement between the
steps."*

**3. A stopped run is not a lost run.** Any run that ends with beats already rendered — the free pool
running out, or the user pressing **Stop** — now hands those beats back instead of throwing them away, and
the result card grows a **“Finish this clip”** button. That button starts a *continuation*: the clips
already made are carried into the chain, the run begins from **the frame the chain actually reached**, and
only the missing seconds are rendered. Two things make it a continuation rather than a fresh start:

- **The drawn keyframes are carried with it**, so finishing never pays for a still twice — and cannot come
  back with a *different* still and put a seam in the middle of the clip.
- **The reference picture stays the identity anchor.** The continuation starts from the last generated
  frame, but `state.refImage` is still the picture the run began with, so every prompt keeps the same
  `FRAME_ANCHOR` clause (*"the exact same woman as the input picture, identical face, hair and body…"*)
  it had the first time. Continuing never means losing her.

**Measured end-to-end** (driven through `generate()` on the fast on-device renderer, so it is a real
chain and not a simulation): a previous run stopped holding one 1.25 s clip; a continuation asked for
3 s returned **3 clips, `madeSec` 3.32, and a file that probes at exactly 3.000 s, `short: false`** — the
carried-in clip, the new beats, and the trim to the requested length all working together. Stopping
mid-run is honoured the same way: the beats already rendered are delivered and the card offers to finish
them (verified: `#resumeBtn` appears with the resumable state attached, and the note names the button).

**4. A run that certainly cannot undress stops instead of pretending.** If not one keyframe could be
drawn, the run used to continue anyway — spending the free allowance on a clip that is guaranteed to stay
dressed, and leaving the *next* run (which might have worked) with nothing. It now stops before a single
video request goes out, with a message that separates the two cases: a queue/worker problem (try again, or
add a free Horde key) from the workers' own safety filters refusing the attempts (which no retry gets
past — your own GPU server and the paid vendors are the routes that will draw an explicit still).

**And the reason is finally visible.** `Storyboard: 0/4 frames drawn` used to be the only line — the
per-step failures went to the busy indicator and nowhere else, so the one number that explained the whole
run was the one thing that could not be read. Every failed keyframe now writes its reason into the log, and
a run with none drawn adds a line saying what that means. This is what the next run will answer: four
steps failing in 2.5 minutes is a *fast* refusal, which is not a queue wait — it is either the anonymous
rate limit (already retried with backoff in `submitOne`) or AI Horde's workers blocking the attempts.

## True undressing: a timeline, not a sentence

An i2v model animates the frame it is handed; it does not take clothes off. Making the starting frame
explicit (§ NSFW) yields a *naked still* — the state, not the act. So the engine now drives the **process**:

`root.undressStages` (`main.pjs`) is a five-rung ladder — *hands at the hem* → *hem lifted, midriff bare* →
*pulled over the chest* → *off one shoulder* → *bare, garment falling away*. `segmentPrompt()` in
`src/engine.js` gives each segment of a chain the **next rung**, with the previous clip's last frame handed
over as usual, and the final rung sticks if there are more segments left. So a five-segment chain depicts a
garment actually leaving the body stage by stage instead of describing one moment five times. The log line
names the stage (`Segment 3 · Wan … · 5s · undress stage 3/5`), and the result card prints the ladder.

**The rig is out of undress runs.** `orderProviders()` drops the on-device renderer when `undress` is on:
handing a motionless, fully-dressed camera move back for an undress request is precisely the failure that
made the feature look broken. The run says so in the log at the start, and if nothing else can take the job
it fails with an explanation instead of quietly returning the wrong thing. Picking **Only this device** is an
explicit choice, so it still uses the rig — and the card still says what that clip really is.

On the user's own GPU server a Wan-family NSFW run attaches the free **general NSFW** and **motion enhancer**
adapters. Motion *scoring* is now built (see § *Accuracy*): every returned segment is measured and scored,
and a beat that came back frozen, melted, re-cast or short of its target is re-rendered or flagged. The
pieces that are still *not* built — erasing the garment out of the frame before the stage that removes it
(the highest-quality version of this), LoRA picking in the UI — are listed with their phase in
`src/ROADMAP.md` (the forward plan), not implied here.

## Two generators, side by side

The model choice is two independent rows in the Studio panel, each one an
**on/off switch** plus an **Auto / Pick-a-model** control:

| | Standard generator | NSFW generator |
| --- | --- | --- |
| What it is | the general-purpose models | the uncensored ones **and** the whole NSFW pipeline |
| On | contributes its pool to the run | contributes its pool, and turns on uncensored prompting, the explicit starting frame, the hidden storyboard and the undress timeline |
| Auto | walks *your server → free pool → this device*, leaving out the models that exist only for explicit content | walks *your server → the models with a real uncensored path → the ✦ uncensored MuAPI endpoints → the rig* |
| Pick a model | pins one model from the standard list | pins one from the NSFW list |

Both may be on at once. The combinations are exactly what the two switches say:

- **standard only** — an ordinary clip. The dedicated uncensored builds are left
  out, so Auto can never wander onto one, and the NSFW pipeline stays off.
- **NSFW only** — only models with an uncensored path are used, with the whole
  NSFW pipeline. An ordinary clip is not routed through them.
- **both** — the union. An NSFW run tries the uncensored pool first and falls
  forward to the standard one if it refuses; an ordinary run just uses the
  standard pool.
- **both off** — the run refuses up front with a readable message, rather than
  searching an empty pool.

A row in **Pick a model** mode is tried *before* the rest of its pool. If both
rows pin one, the NSFW row's pick leads (an explicit run wants its uncensored
model), the standard row's pick is next, and the rest of the union follows — so
"Pick a model" on both rows still fails forward instead of dead-ending.

The split is a filter on the **pool**, never a second pipeline. `isNsfwCapable()`
/ `isNsfwOnly()` in `src/providers.js` draw the line and `orderProviders()`
applies it (`opts.generators`); the NSFW *pipeline* is gated separately by the
`nsfw` flag, which the app takes from the NSFW row's own switch. That is why
turning the NSFW generator off both removes the uncensored models and turns the
whole NSFW pipeline off — which is what "standard video" should mean.

Models that merely *have* an uncensored switch (Wan 2.2 Preview / Preview II),
your own GPU server (the one route that can attach the free NSFW LoRA) and the
on-device rig appear in **both** rows, because they render ordinary video just as
happily as explicit video. Only a dedicated uncensored build — `wan22_nsfw`,
`uncensored_video2`, `minimax_uncensored`, and MuAPI's `✦ uncensored` section
(the providers carrying `nsfwOnly: true`) — belongs to the NSFW row alone.

## Character and scene consistency (why the clip used to change person)

A real run came back as a mess, and the log made the cause obvious the moment the
delivered clip was decoded frame by frame: the first beats were the user's own
photo (a woman in a black top in a hotel room), and the last third was **a
different woman in a jungle**. Three things were responsible, and all three are
fixed:

1. **The hidden rung ladder named a place.** `nsfwStoryboard` (main.pjs) and
   `STORYBOARD_FALLBACK` (src/storyboard.js) described a specific wardrobe
   ("an open sheer shirt and short shorts") and a specific set ("she walks nude
   through the jungle"). A rung's picture is made by an *image* model — img2img
   or inpaint — so a place named in the prompt is a place the model builds,
   replacing the user's own room and, with it, the face standing in it. The
   ladder is now **scene-neutral and identity-neutral**: rungs describe only
   what the body does and what the face shows, and `pose` says "the same pose,
   framing and camera distance as the input picture". The rule is written at the
   top of the ladder in main.pjs.
2. **No model was told to keep her.** `FRAME_ANCHOR` (src/storyboard.js) now
   leads every keyframe prompt — *"the exact same woman as the input picture,
   identical face, hair and body, the same place, the same background, the same
   lighting and the same camera angle, unchanged identity"* — the user's own
   prompt follows it, and `FRAME_NEGATIVE` / `IDENTITY_NEGATIVE` name the drift
   in the negative. The video-side prompt and negative carry the same clause
   through `composePrompt({anchor})` / `buildNegative({anchor})` in
   `src/engine.js`, so a named-place-free keyframe cannot be thrown away on the
   way to the clip either. The negatives deliberately name *no* place (no
   "beach", no "forest") — they forbid inventing a location, which would
   otherwise fight a user whose reference really is outdoors.
3. **Whole-frame img2img is what re-casts a person.** `evolveFrame` at denoise
   0.55–0.85 repaints everything; measured on this very case, that is how the
   room became a jungle. Two changes: `storyboard.poseDenoise` defaults to
   **0.4** (it was 0.55), and the new `storyboard.lockIdentity` (default **on**)
   routes every rung that removes a garment through **inpainting** — the
   on-device clothes mask, where everything outside the mask is copied back from
   the previous frame at full resolution, the only method that provably cannot
   change her. Set `lockIdentity = 0` in main.pjs to let such a rung redraw the
   whole frame again (faster, and it will drift).

**Framing.** `FRAME_QUALITY` no longer asks for "full body visible". Asking a
model for a full-length shot of a chest-up portrait is how it is talked into
re-drawing the person to make room for the feet; it now asks for the *input's*
own framing and camera distance. The keyframe sizing follows the same principle.

**Motion transfer needs a whole figure.** `generate()` now runs `analyzeFigure`
on the reference once. When it is provably not a whole standing figure (a
chest-up portrait, the common case for this feature), motion transfer is
switched off with a log line: there is no full-body pose to copy movement onto,
the "draw it again, wider" retry was burning a minute and still coming back
cropped, and forcing the keyframes into the transfer's portrait 480×848
re-frames a picture that was never meant to move. The video model supplies the
motion instead, in the user's own aspect ratio. (A reference `analyzeFigure`
cannot judge — a busy background makes it pass the picture through unchecked —
keeps motion transfer on, as before.)

## Reality check on "free"

- There is no free *unlimited* hosted image-to-video API. Runway, Kling and MiniMax/Hailuo are paid and only
  work with your own key.
- The genuinely unlimited option is **your own GPU** run from the bundled server — free Colab gives you a T4,
  and the weights are cached so later sessions start fast. That is the recommended path, and it has no quota
  owned by anyone else.
- The second unlimited option is the **on-device rig**: no network, no GPU, no quota, no server. It is slower
  than real time and cannot invent detail, but it can never be rate-limited or switched off.
- The free public pool runs on ZeroGPU, which meters **GPU-seconds per address**, not requests. Per Hugging
  Face's own docs the daily allowance is **≈2 minutes anonymous, ≈5 minutes with a free account, 40 minutes
  on PRO**; it resets 24 h after first use, and a *heavier* model or a longer clip spends more of it — so a
  1 s LTX clip can succeed while a 14B Wan clip on the same allowance is refused. Every Space now receives
  the required `X-IP-Token` (fetched automatically), which is what makes the allowance actually apply.
- **When the allowance is gone, the run says so and stops — it does not spend ten minutes and then hand back
  a camera move.** Every free video Space in the app is a ZeroGPU Space (verified against the HF API: all
  are `zero-a10g`; the one exception runs on `cpu-basic` and cannot diffuse), so an exhausted identity is
  refused by all of them at once, instantly, with an empty error. That refusal is remembered
  (`noteZeroGpuBlock()` in `src/gradio.js` — in memory *and* in storage, because the editor reloads the page
  and a forgotten refusal is paid for twice) and `generate()` consults it **before** the expensive picture
  steps: if the only routes left are those free Spaces and there is no second address to ask, the run stops
  there with the reason and the ways out. The window is 20 minutes on purpose — an instant empty refusal can
  also mean *every shared GPU is busy*, and a transient busy period must not become a lockout. With a token
  the allowance belongs to the **account**, so no address change can bring it back; the message says that
  instead of the usual "add a relay", and the auto-reset toast no longer gives the wrong advice either.
- **NSFW:** the offline rig has no moderation filter at all (it is just your image plus a camera move), and the
  free pool's prompting/negatives change with the toggle. Neither of those *undresses* anything on its own —
  the explicit starting frame is made first (see § NSFW above), and in the default *Auto* mode that is a free
  AI Horde inpaint whose only cost is a queue wait. Two of the free Wan mirrors
  (`Wan 2.2 14B Preview` / `Preview II`) also expose the Space's own `safe_mode` /
  `enable_safety_checker` switches, which the app now turns **off** when the NSFW toggle is on — so those two
  are the first free models with any uncensored path at all. No other free diffusion Space offers one.
- **Blur the line honestly:** the offline rig produces real motion but not new content. The UI says so.

## Content safety: the routing engine, the vault, and the leak audit

Two independent things, and both are about your *content* rather than your address — the section below
hides *who* is asking; this one decides *what* is sent and what is kept.

### 1. There is no safety-check bypass. There is routing.

The request behind this asked for an engine that fakes its way past the models' NSFW checks and is never
caught. The honest half of that has to be said plainly: **a remote server sees the request.** The prompt,
the picture and the job arrive at whatever machine does the work, and if that machine runs a content
check it sees them — no client-side code can change that. What *can* be done, and is now what the app
does, is make sure an explicit request is only ever sent to a route that accepts it, so nothing is
submitted to a service that would log or report it. That is the difference between hiding from a checker
(impossible from a web page) and not walking into one (a routing decision).

| Route | What actually happens with explicit content |
| --- | --- |
| Your own GPU server | Nothing checks anything unless you make it. The one route with no third party in it. |
| This device (the rig) | A camera move over your still — no network, no filter. It cannot undress anyone. |
| A dedicated uncensored build (`Wan 2.2 14B NSFW`, `NSFW Uncensored Video`, `MiniMax H3 NSFW`, MuAPI's ✦ uncensored) | Trained without a safety filter. |
| `Wan 2.2 14B Preview` / `Preview II` | The Space exposes its own `safe_mode` / `enable_safety_checker`, and the app turns it off through the API. |
| A paid vendor (Replicate / fal) | Permits it, but the vendor's own terms decide what they keep. |
| **Everything else** — the ordinary Wan / LTX / SVD / SCOPE Spaces | **Runs a content check.** An explicit request is refused, and that refusal *is* the submission — a record on their side. |

`orderProviders()` therefore filters an explicit run to `acceptsExplicit(p)` when `nsfwRouting` is
`strict` (the default). Measured on this build: an explicit run with **both generators on** now returns
**6 routes, every one an acceptor** — where before it returned 14 and fell forward into the ordinary
Spaces. `src/router.js` also remembers: a provider that genuinely refused content goes to the back
(`avg_route`), so a run stops rediscovering the same wall. “Try every enabled model” in Settings restores
the old behaviour for anyone who would rather roll the dice, and the run log always prints the tier, the
routing mode and exactly which routes were asked —
`explicit run → only routes that accept it are asked: …`.

### 2. Nothing is published to a public URL, and the library is encrypted at rest

The footer used to say “Nothing leaves your device except the job you submit”, which was half true — that
job is a photo and a prompt. It now says what the app can actually promise, and **Settings → Content
safety** carries an audit (`auditEgress()`) of every route this run's content can take:

| Route | What travels | Where it lands |
| --- | --- | --- |
| The clothes detector | nothing — a 4.2 MB model shipped in `src/models/` | this browser |
| Making your photo explicit | your photo + a mask | AI Horde (third party) |
| Drawing the storyboard | each keyframe picture | AI Horde (third party) |
| Drawing a starting frame | the prompt only | Pollinations |
| The renderer | your picture + prompt | your server · a Space · a vendor — depends on the route |
| MuAPI | your picture on a **public upload URL** → muapi.ai | **readable by anyone with the link** |
| Storage at rest | the clip, its poster, the prompt | this device, encrypted |

The audit is drawn from the same function the engine consults, so the panel cannot drift from the
behaviour, and it is redrawn whenever the picture, the generator rows or the frame mode change.

Two switches enforce it. **`leakGuard`** (on by default) blocks the one genuinely public leak: MuAPI
rejects `data:` URLs, so the reference frame had to be uploaded to a public host first.
**`localOnly`** (off by default) allows only your own server and the rig, and refuses the free
inpainting outright rather than handing your photo to AI Horde — with an explanation and the two ways
out, not a silent send.

**The vault** (`src/vault.js`) is the at-rest half. A key is generated on this device (AES-GCM, WebCrypto)
and `src/store.js` seals every library record with it — the clip, its poster frame and the prompt / user
prompt / negative are encrypted in IndexedDB, while the technical facts (when, how long, which model)
stay readable so the library still lists and sorts. Set a passphrase and the key itself is wrapped with
PBKDF2-SHA256 (210k); from then on the library cannot be read without it, a locked vault **refuses to
save** rather than writing a clip in the clear, and “Destroy vault & library” removes the key and every
clip with it.

Honest limits, in the module and the UI rather than implied: without a passphrase the key sits next to
the ciphertext, so the vault defeats a casual look and nothing more; a passphrase cannot be recovered;
a relay reads what it carries; and once content has been sent to a third party, no client-side code can
recall it.

## Privacy: keeping models from tracing you

Two independent switches in `Settings → Privacy & IP rotation`.

### 1. "Keep models from seeing your address" — **strict privacy, on by default**

While this is on, **nothing about a run leaves from the visitor's connection**. Every request a model could
learn anything from is relayed:

| Request | How |
| --- | --- |
| the Space's parameter list (`/gradio_api/info`) | `spaceParams()` through a relay (`src/gradio.js`) |
| the `X-IP-Token` JWT (`huggingface.co/api/spaces/…/jwt`) | `fetchJwt()` through the same relay, so the token and the job agree on the address |
| the reference-frame upload (multipart) | `uploadBlob()` through a relay that can carry a multipart body; if it is too big for that relay the image is re-encoded down (`shrinkToFit()` in `src/image.js`) instead of being sent directly |
| the job POST | `callEndpoint()`'s `attemptPlan()` — which in this mode contains **no `null` entry at all** |
| the live progress stream (SSE) | `relayFetch(…, {stream:true})`; the body is pumped straight through and the `X-IP-Token` is deliberately **not** re-sent |
| the finished clip | `downloadClip()` via `relayBlob()` — binary-safe |
| the starting-frame image (Pollinations) | `pollinationsKeyframe()` via `relayBlob()` |
| the paid vendors (Replicate / fal / Runway) | `providerRequest()` — *including their status polls*, which are otherwise a request every 1.5 s from your address |

If no relay can carry one of those, the request is **refused** with an explanation (`kind:"privacy"`, which
fails over to the next model and, in `auto` mode, eventually to the on-device renderer, which contacts nobody)
— never quietly sent from your address. `attemptPlan()` returns an empty array in this state, and
`callEndpoint()` turns that into a refusal.

**Untracing** (also on by default) applies to all of the above: `credentials:"omit"`,
`referrerPolicy:"no-referrer"`, `cache:"no-store"`, and deliberately no `Cache-Control`/`Pragma` *request*
headers (a custom header forces a CORS preflight that some Spaces do not answer — `cache:"no-store"` does the
same job).

What this **cannot** do, stated plainly: the relay can read the request (that is what a relay is), so only use
ones you trust; a pasted Hugging Face token still names your **account** to the model owner (it travels in the
`Authorization` header, and for the paid vendors the vendor key travels through the relay too); the prompt and
the reference image are necessarily visible to whichever model does the work; and Perchance — the site serving
the page — sees that you pressed Generate. A web page cannot turn on a VPN.

### 2. Address rotation — spreading the free allowance

| Rotation mode | Behaviour |
| --- | --- |
| **Off** | the same relay (or, with strict privacy off, the same connection) every time |
| **After every generation** (default) | the address advances by a **random** step once per run — consecutive generations never share an address (with two addresses it is a strict alternation) |
| **On every request** | re-pick per request, including internal retries |

Addresses, in order of preference:

1. **Your own server / Workers** — anything you add in "My relays". The bundled `src/server/server.py`
   doubles as one (`POST /api/relay` + `GET /api/relay/raw`, both allow-listed), and the help dialog has a
   one-click Cloudflare Worker you can paste into the dashboard for free — those give you addresses that
   are *yours*.
2. **Perchance's built-in proxy** — on by default, zero setup, and the guaranteed last resort in strict mode.
   It really does egress from a different address than your browser (`2a06:98c0:3600::103`, a Cloudflare
   address) and a real clip has been generated through it with no `X-IP-Token`. Because it is shared, its
   anonymous allowance is shared too — think of it as extra attempts, not a private quota.
3. **Direct** — only reachable when strict privacy is **off**; then it is always last, so a run never fails
   just because every relay is down.

The bundled public GET-only relays (allorigins) are **off by default** — they can fetch a page but cannot
carry a job, and in testing they were slow or timed out, so they only add noise to the address list. The
checkbox re-enables them for anyone who wants an extra reader.

The one genuinely private, genuinely fresh allowance is an address that is yours alone — a Colab / Kaggle /
VPS session or your own machine. The help dialog lists free open-source VPNs (Cloudflare WARP, Proton VPN
Free, WireGuard, Tor Browser) for anyone who wants whole-browser anonymity; those are installed apps, not
something this page can turn on.

### What was measured, rather than assumed, about the built-in proxy

All four of these were probed live on this page (`page_eval` against the real proxy) before the code was
written, because each one decides whether strict privacy could be the **default**:

- **It carries multipart uploads.** 3 KB, 60 KB, 200 KB, 1.2 MB, 3 MB and 6 MB (5 s) uploads all returned
  real Gradio file paths. So the reference frame goes through it too.
- **It carries binary GETs** — a PNG came back with its magic bytes intact.
- **It streams `text/event-stream` live.** A Wikimedia SSE stream delivered 679 chunks / ~8 MB and was still
  open past 120 s. This is why the progress stream can be relayed at all.
- **It buffers everything else with a ~60 s cap.** A response that took 135 s to *start* failed at 60 561 ms
  with `TypeError: Failed to fetch`, while a 10 s drip resolved at 10 939 ms in one chunk. So every
  non-stream request must be short — which they all are (a job takes ~1 s to accept; a clip is a few MB).

Consequence: strict privacy needs **no setup whatsoever** — the built-in proxy is always in the pool.

## Every run keeps going, and leaves no trace

Two problems made the app appear to "work once, then stop":

1. **The free allowance is metered per *address*, and all ten free models share it.** ZeroGPU counts
   GPU-seconds against the address that asks — not the request, and not the Space. Spending it on one
   clip means the *next* clip is refused by every free model at once, which looks like "it stopped after
   one video". The site-wide cap is ≈2 min/day anonymous, ≈5 min with a free account.
2. **A refusal benched the model for 15 minutes**, and that bench was stored per provider — so the next
   run inherited it and gave up before trying.

The fix is three switches and an engine change, all on by default:

| Piece | What it does | Where |
| --- | --- | --- |
| **Start every run fresh** (`freshRun`, on by default) | Before each run: drop every benched provider and step to the next address. A spent allowance on one address is never inherited by the next run. | `src/app.js` `run()`; `clearCooldowns()` in `src/store.js` |
| **Hop address on a quota refusal** | Instead of benching the model, the engine retries the *same* model from the **next address** (it has its own untouched allowance), and only benches if there is no other address or that retry fails too. If every provider ends up refused on quota, the message says so and points at the address list. | `retryDecision()`/`attemptPlan()` in `src/engine.js`, `src/gradio.js` |
| **Short benches** | `quota` 60 s, `busy` 90 s, `paused` 60 min, `error` 2 min — read live from `root.cooldown` in `main.pjs`, so the tunable actually does something now. | `main.pjs` → `src/engine.js` `benchTable()` |
| **Rotate for real** | With exactly one relay of your own, the old plan only ever cycled the *primary* relays, so the index was ignored and every run used the same address. The plan is now a single cycle (your relays → the built-in proxy → direct when strict privacy is off) that the index walks, so one relay + the built-in proxy genuinely alternate. | `attemptPlan()` in `src/gradio.js` |
| **Wipe traces after every run** (`wipeTraces`, on by default) | After the run (in a `finally`, so it happens even if the run failed): expire this origin's cookies, empty localStorage/sessionStorage, every cache, the resource timings and the quota records. The log prints exactly what was removed. | `wipeTraces()` in `src/traces.js` |

**The allowance has two identities, and one of them was never being asked.** ZeroGPU bills a request
to the **account** when a Hugging Face token rides along (5 minutes a day) and to the **address the
request leaves from** when one does not (2 minutes a day) — two separate pots. `callEndpoint()` has
always known that and always *meant* to drop the token and retry anonymously after a refusal, but
that retry was written as "walk to the next relay and drop the token on the way". With strict privacy
on and only the built-in proxy configured, the plan is a **single entry**, so there was no next relay
and the retry never ran: every free Space was billed to a spent account forever, and the run ended on
the on-device camera rig. Measured on the reporter's own page, same Space, same picture, same payload:
**refused with the token, accepted without it**. The retry now re-asks the *same* address anonymously
before walking on, and the remembered refusal records the identity that actually failed, so a curable
refusal is no longer mistaken for an account-level one by `generate()`'s early-stop. The quota
banner's **Use my own address** button is the manual half of the same cure — it clears the token and
turns strict privacy off in one press, because that genuinely is a different pot and also genuinely
a privacy trade.

There are buttons to do each by hand, too. The one that matters is **Reset** (the button in the Studio
header, and `Reset…` in `Settings → Privacy & IP rotation`), which is the whole clean slate in one place:

| Reset does | Detail |
| --- | --- |
| **Studio controls** | the picture, the prompt, the camera/style/size choices, and both generator switches back to default |
| **Wipe the traces** | the `wipeTraces()` set above, plus the router's memory of which routes refused (`resetRouteStats()`) and the bench |
| **Step to a different address** | advances `relayIndex` — the half of a reset that actually buys a fresh allowance (the wipe cannot; see below) |
| **Delete the saved library** | *off by default* — it is the user's own work |

**It also happens by itself.** With `autoReset` on (default), a run that the pool **blocks** — the engine's
`quota` / `empty` "everything refused" errors, and the "storyboard could not draw a single frame" case —
calls the same reset before control returns (`autoResetAfterBlocked()` / `isBlockedError()` in
`src/app.js`), so pressing Generate again starts from a clean browser and the next address rather than from
the wall the last run hit. It never deletes the library: an automatic action must not destroy the user's
work.

**A key AI Horde refuses does not make the run produce nothing.** The free lane is anonymous, so a key is
never *required* — but a key that Horde does not recognise (a typo, or one copied from an old account)
comes back as a bare `401 InvalidAPIKey` on **every** submission. A storyboard run draws its keyframes
through Horde, so all four steps failed, nothing was drawn, and the run stopped before a single clip — the
exact "it is not generating anything" report. `runHorde()` (`src/nsfw.js`) now answers a `401` by dropping
to the anonymous key for this and every later rung and saying so once in the log, and the rejected string is
remembered (`hordeRejectedKey()`) so the next rung does not waste another submission on it; a submission
with a key that *works* clears that memory. Settings → *NSFW first frame* also shows an amber note under
the field (`#hordeKeyNote`, `renderHordeNote()` in `src/app.js`) whenever the saved key is the refused one.
The storyboard's per-keyframe wait was raised to `keyframeWaitMin = 15` in `main.pjs` for the same reason:
the anonymous inpainting lane is genuinely deep (measured 5–15 min a job at positions 130–220), and the old
6-minute cap gave up on every anonymous frame — so an anonymous run drew nothing either. It is a *cap*, not
a delay: a registered key draws a frame in seconds.

**The picture itself is anonymised too.** On the way in, `acceptFile()` runs the reference through
`stripMetadata()` (`src/image.js`), so the file that is uploaded carries no EXIF — no camera, no timestamp,
no GPS, no software tag — and every file a run uploads is renamed with a fresh random token
(`src/anon.js`), so two runs are not linkable by filename. Together those are the two things a *client* can
genuinely do; the address is the one it cannot fake, which is why Reset rotates rather than pretends.

**What this honestly cannot do.** A web page cannot delete a cookie belonging to another origin — so the
huggingface.co cookies a Space might set are not removable from here. It is the next best thing: every
request the app makes is sent with `credentials:"omit"` and no referrer, so no cookie is ever *sent* to
huggingface.co, and none is created. Nor can it change the address the pool counts against: clearing
cookies, caches and timings is the browser's record, not the network's, and the ZeroGPU allowance is
counted **server-side, per address/IP or per account**. That is why Reset both wipes *and* rotates, and why
the honest answer is: **a second address is the only true fix** — a relay (built-in, one click), a VPN or
proxy you switch yourself, your own server, a second Colab/Kaggle session. The genuinely unlimited paths —
your own GPU server and the on-device rig — have no allowance at all.

## Verification status (what was actually tested)

- **Accuracy and the delivered length (the fifteenth brief).** The failing clip was decoded frame by
  frame with `mp4box` + WebCodecs: 640×832, 16 fps, 52 frames, **3.25 s** for a 5 s request, with frames
  0–15 a melted over-exposed render (brightness 177–182 vs the reference's 82.2, saturation 120–130 vs
  54.0, edge detail 0.013–0.019 vs 0.0366). Root cause measured: three beats × 20 frames (1.25 s at
  16 fps, not the 1.3 s asked for) minus two 0.25 s crossfades = exactly 3.25 s. Fixed and verified in
  the live page: `clipMetrics()` flags a frozen clip (motion 0.0022), a melted one (**brightness 185 vs
  the reference's 73, saturation 128 vs 18, detail 0.001 vs 0.068 — `blown`, `flat` *and* `startDrift`
  all true**) and a re-cast shot (`startDrift` 1.0), while a good clip (motion 0.858, detail 0.0651,
  drift 0.06) is left untouched; `stitch()` with a 5 s target on five 1.25 s beats → a file that probes
  at **exactly 5.000 s**, on three beats → 3.25 s with `short: true`; `retimeClip()` with a 1.0 s target
  on a 1.25 s clip → **exactly 1.000 s**; `imageStats()` → detail 0.118 textured / 0 flat / `null` for an
  undecodable blob. The result card was driven with a simulated short result and printed
  `3.3s of 5s` plus the explanation.

Proven in the live preview:

- **Reset, and the reset that fires itself (the seventeenth brief).** Driven through the real UI: the Studio
  **Reset** button opens the dialog (its state line read `1 address configured · library encrypted · traces
  already wiped after every run`), and confirming it logged
  `RESET · 1 storage key, 33 timing entries, 3 route records · studio parameters reset · on the only address
  configured…` and emptied the prompt and the NSFW switch. The **automatic** path was exercised by making
  every external model call fail: the run walked the whole free pool, ended on the engine's `quota` error, and
  the app then logged `auto-reset after a quota block · 10 quota records · there is only one address
  configured — add a relay … or switch your VPN…` — i.e. `isBlockedError()` → `autoResetAfterBlocked()` fires
  and hands back a clean, un-benched app. `freshName()` was checked directly: `start.png` → `start-31c603xba5.png`
  twice inside one run, `start-klzwxrxba5.png` after a new nonce. `stripMetadata()` was checked against a JPEG
  built with a real `APP1` EXIF segment spliced in (containing `GPSLatitude`/`Make=TestPhone`): the input
  matched `/Exif|GPSLatitude|TestPhone/`, the output did not, and was still a valid JPEG (910 → 834 bytes).
  All **eight uncensored routes** appear in the live pool (`autoPool()`), each verified against its Space's
  live `/gradio_api/info` before being listed. Phone-width (390×844) layout checked with both dialogs open:
  no horizontal overflow, the auto-reset switch present and on by default, the dialog 343 px wide.

- **“It cannot generate, it only makes a fixed image with motion”: the free pool's allowance (the
  nineteenth brief).** Diagnosed from the app's own modules, live, not guessed. The saved settings pinned
  the NSFW row to `NSFW Uncensored Video` and had the Standard row off, so the run's only route was that
  Space. A direct call of the Space's own adapter (`providers.js` build → `spaceParams`/`alignData` →
  `callEndpoint`) came back instantly as `quota` — and so did `wan22_nsfw_mirror` (with token), the same
  Space **without** the token, `wan22_fast` (a standard Space, safe prompt) and a fully **direct**,
  token-free request with every relay switched off. So it is not the model, not the content, and not the
  address: every free video Space is ZeroGPU and the allowance is spent for both the account and the
  address. Hardware checked per Space against the HF API: 17 of 18 are `zero-a10g`, one is `cpu-basic`, one
  is `PAUSED`. AI Horde has no video models (`GET /api/v2/status/models?type=video` → `[]`) and HF's
  inference router has no video-output model at all, so there is no second free lane to add. The HF token
  itself is valid (`whoami-v2` → a free account), which is what proves the refusal is the allowance rather
  than a bad key. After the fix: a run with those settings stops in **under a second** —
  `every free model refused the last job instantly: your Hugging Face account's ZeroGPU allowance is spent…`
  then `Nothing free can render this run…` with the ways out — with **no** starting-frame step, **no**
  storyboard and **no** rig clip, and the auto-reset line now reads
  `the free GPU allowance is spent for your Hugging Face account, which no address change brings back…`
  instead of the old (wrong, for a token) "add a relay". The persistence was verified by reloading the page:
  the block written before the reload is still honoured after it (`loadZeroGpuBlock()` → `{withToken:true}`,
  age 24 s), and the anonymous wording was verified by flipping the record to `withToken:false`. Regression
  checked on the whole refactor: an `Only this device` run still renders end to end — a 500 KB 3 s MP4 in
  35 s, `No model took this run, so this clip is a camera move over your still — it is not generated video`.

- **“Not generating anything”: a rejected AI Horde key (the eighteenth brief).** Reproduced in the live page
  by calling `undressImageInpaint()` and `evolveFrame()` with the saved key: Horde answered
  `401 {"message":"No user matching sent API Key…","rc":"InvalidAPIKey"}` on **every** submission, so all four
  storyboard steps failed and the run stopped with nothing rendered. (The same key wrote a 404 on
  `GET /generate/check/<uuid>` — that endpoint answers 404 for a *valid* key too, which is why the failure had
  hidden until a job was actually submitted.) After the fix, the identical call logs
  `AI Horde did not recognise your API key — … Continuing anonymously (free, but a longer queue)…` and the job
  is **accepted anonymously** — `queue position 142 · about 6 min of queue left`, both direct and through
  Perchance's relay (`PERCHANCE_RELAY`). The rejected string is remembered (`hordeRejectedKey()`), so a second
  call in the same page load goes straight to the anonymous key with no repeat notice. `renderHordeNote()` was
  then driven by dispatching `change` on `#hordeKeyInput` and the amber note appeared under the field
  (`#hordeKeyNote` hidden=false, class `model-note warn`, text beginning `AI Horde refused this key (401 — …`),
  verified visually in a settings-dialog capture.

- **The whole app boots and was driven through the real UI.** A missing `src/video.js`/`src/encode.js` had
  broken the ES-module graph, so `window.AIVideoGen` was undefined and *everything* looked broken (no models,
  no camera/angle/style lists, no generation); both modules are in place now. Re-verified live: **the model
  picker fully populated** (the standard row lists **56** options and the NSFW row **22**, the latter now
  including the five uncensored routes added in the seventeenth brief), **18
  camera moves / 13 angles / 82 looks in 7 groups**, the six aspect chips scaling the stage exactly (16:9 1040×585 · 9:16
  367×594 · 1:1 572×594 · 4:3 782×594 · 3:4 461×594 · 21:9 983×461 — and at a 390 px phone width 16:9→321×187,
  9:16→321×566, no horizontal overflow), the player's speed ladder stepping **1→1.5→2→3→4→5→6→7→8 and back
  down to 0.25×**, a real
  offline clip rendering, playing and looping at the chosen rate, the `✨ Auto-enhance` button streaming a
  richer prompt into the box, and the trace wipe running after every run (`traces wiped → …` in the log).
  Contrast was measured numerically in **both themes**: every label ≥11:1 and every secondary/helper line
  ≥5.5:1 (dark) / ≥5.9:1 (light). Fixed on the way: toggling NSFW no longer snapped the Undress switch and
  the starting-frame mode back (they were being re-read from a stale `state.settings`), and `doSave()` now
  mirrors the form back into `state.settings` so the two cannot drift.

- **The roadmap-review additions were re-verified live** (see `src/REVIEW.md`): the look-and-feel picker
  resolves to **82 options in 7 `<optgroup>`s** (`Basic · Realistic · Cinematic · Animation · Art · Fantasy &
  Sci-fi · Film & camera`); the prompt-mode select offers all four `ENHANCE_MODES`; an offline render's result
  negative was measured to contain the selected style's own negative block (`style: "photoreal"` →
  `… anime, cartoon, illustration …` present); the **Lock seed** switch was exercised through `handleResult()`
  with a fake result (`save:false`) and wrote the render's seed (424242) back into `#seedInput`; and the speed
  stepper was clicked from x1 to its ceiling, landing on **x8** with the `+` button disabled and the video's
  real `playbackRate` at 8. `src/server/server.py` still needs its GPU path re-run on the user's machine
  before the two new Hunyuan entries (`hunyuan_t2v`, `hunyuan_i2v`) can be called "verified" — they are
  labelled experimental for that reason.

- **The on-device renderer was rebuilt and re-verified.** It now composites on a WebGL displaced mesh
  (`src/offline.js`) instead of stacking row strips on a 2D canvas. Why: the old row-strip compositor showed
  horizontal bands — painting the background magenta proved **25,573 background-showing pixels across 624
  rows** at strip height 1.0 (still 90 at height 1.6, and 75 with rotation off), i.e. neighbouring strips
  could not be made to line up; one watertight mesh with a shared vertex per row boundary removes the seam
  entirely. After the change the same measurement finds no gaps, and `vision` on both a poster and decoded
  mp4 frames reports "no evenly-spaced horizontal bands … sharp and clean … no duplicates/ghosting", with the
  background matching the source at ~0 px while the subject region moved ≥12 px (real differential parallax,
  not a global pan). A 5 s 480×832 clip renders in 5.42 s wall (**1.08× realtime**); the mp4 probes at
  5.04 s, 480×832, 3.0 MB, `video/mp4;codecs=avc1.42E01f`. Where WebGL is missing, `build2DRig` drops to a
  clean 2-layer Ken-Burns move (no row strips, so also no banding) and logs
  `console.warn("offline rig: WebGL unavailable…")`.
- **The two content engines were verified live, and a real NSFW run was made end-to-end with the user's
  own photo** (NSFW generator only, starting frame *Auto*). The log reads
  `content safety · library encrypted · leak guard on · explicit routing uncensored routes only`, then
  `NSFW frame → AI Horde: repainted your own picture (only the clothing it found on this device, …)`, then
  `content tier · explicit (…) · routing: uncensored routes only` and `explicit run → only routes that
  accept it are asked: Wan 2.2 14B NSFW → Wan 2.2 14B Preview → Preview II → NSFW Uncensored Video →
  MiniMax H3 NSFW → Motion (offline)`. All five uncensored Spaces refused (the shared Perchance-proxy
  address's ZeroGPU allowance: `The free GPU pool refused this job`), the run fell to `Motion (offline)` and
  finished (`done · Motion (offline) · 0.47 MB` → `traces wiped → …`), and the delivered frame is **the same
  woman, in the same hotel room, with the top opened over her chest** — her own pixels everywhere outside
  the region the clothes detector marked. Routing was then checked numerically for every shape: an explicit
  run with **both generators on → 6 providers, all acceptors** (it used to be 14, including the ordinary
  Spaces); `widen` → 14 including the checking ones; a standard run → 14 *including* them (correct —
  ordinary content may go anywhere); `localOnly` → the rig alone; and the leak guard blocked MuAPI while
  allowing everything else. The router's memory: two refusals on `wan22_nsfw` demoted it to the **back** of
  an explicit pool with an accepted route left in place, and `resetRoutes()` cleared it. The vault: the
  stored record came back with `video.type = application/x-aivg-vault`, poster `v1:…`, and **neither the
  prompt nor the file present in the raw record**; decrypt round-tripped byte-exact with the right MIME;
  `setPassphrase` re-wrapped the same key (clips made before it stayed readable), `lock()` made records
  unreadable and made saving **refuse** (`{ok:false,locked:true}`, nothing written in the clear), a wrong
  passphrase was rejected by the GCM tag and the right one opened it, and removing the passphrase restored
  the same key so the old clips still read. *Still needs a human:* a free AI Horde key to skip the
  ~15-minute anonymous inpainting queue, and a GPU server (or a working free-pool allowance) to get real
  motion instead of a camera move.
- **The NSFW feature was exercised end-to-end through the real UI, with the user's own photo and prompt**
  ("undress showing ultra huge nude boobs", NSFW on, starting frame Auto, 9:16, 480p, 5 s): the log shows
  `NSFW frame → AI Horde: repainted your own picture (default torso area), kept the original at full
  resolution around it` at 4.5 min (queued, position ~200, Horde's own ETA ~13 min) → three pool Spaces
  refused the job (allowance) → `Segment 1 · Motion (offline)` → `done · Motion (offline) · 3.27 MB`, no
  console errors and no `perchanceErrors`. Measured on the frame that came out of that run against the
  original photo, both at 480×832: the region the inpaint owns (x 0.25–0.60, y 0.70–0.95) goes from **0.464
  to 0.805** skin coverage with fabric at 0.001 → 0.002, the chest band (x 0.30–0.70, y 0.62–0.80) goes from
  0.667 to **0.950** skin, and the head region is untouched (0/0 both). `vision` on the head crop of the
  delivered frame finds the **same woman** — same black-and-white paisley bandana, same eyebrows, the same
  two moles on the cheek — with no horizontal seam across her face. In short: her own pixels everywhere
  outside the torso box, bare chest inside it. Where the whole wait lands is in § NSFW; *Draw* remains the
  instant fallback that instead draws a new person (previously verified the same way: bare chest, large
  breasts, no censorship or watermark, photorealistic, no banding — `NSFW frame → Pollinations: drew a new
  explicit frame` → `done · Motion (offline) · 2.71 MB` in ~3.5 min).
- The older row-strip renderer's output is still decode-able and its frames really moved (`vision`-checked on
  a clean reference: same scene, clearly different framing) — that is what the banding measurement above is
  compared against.
- The full `src/server.js` client path end-to-end against a mock server: `/api/health` → provider list in the
  model select → `POST /api/generate` (correct body: model, prompt, w/h, duration, base64 image, seed) →
  `EventSource` state stream → `GET /api/result` → result recorded with the server's seed and meta.
- Failure handling: an unreachable server produces a helpful status message and the run falls through to the
  next provider / the rig.
- `server.py` is syntax-verified (AST-parsed and **imported** under Pyodide) and its logic is machine-tested:
  the 18-model catalogue (ids unique, required fields, caps), the weights source ordering for
  `auto`/`ms`/`hf` and for Hugging-Face-only repos, the native-resolution upscale and frame alignment,
  first/last-frame handling, the `health()`/`weights_info()` payloads, `busy()` counting a download, the
  `human_error()` messages, and the `/` status page rendering with its weights column.
  **Its GPU path cannot be executed here** — that half depends on the user's own GPU, and the notebook/README are
  the instructions for it. The same goes for a real weight download: it needs `modelscope` and 90+ GB of disk,
  so the first genuine fetch will happen on the user's machine. The app half of that flow *is* verified live
  against a mocked server (model list → Download button → progress in the row).
- The Hugging Face-free default path: with no token and no server URL, `auto` resolves to the on-device rig and
  the offline run completes (mp4 + 6 real poster frames).
- **The free pool is no longer hidden.** A bug where the whole "Free — open models" group (Wan, LTX, SVD,
  SCOPE) vanished from the model list unless an HF token was set is fixed — the group is always present, and
  the dropdown now says the anonymous allowance is small rather than pretending the models don't exist. All
  ten free models were confirmed present in `#modelSel` after the fix.
- **Two models really were disconnected, and are now fixed.** `Wan 2.2 14B Preview` and `Wan 2.2 14B
  Preview II` had changed their API to **17 and 19 inputs** while the adapters still sent 10, so the Space
  answered `didn't receive enough input values (needed: 19, got: 10)`. Worse, that error text lists the
  Space's own `enable_safety_checker` parameter, which the old `/safety/i` classifier matched — so the app
  reported *"the model refused this content"* for what was really a broken URL of arguments. Both bugs are
  fixed: the classifier checks signature mismatches first and needs a real refusal phrase for safety; and
  **every adapter now names its inputs**, with the engine laying them out against the Space's live
  `/gradio_api/info`. All ten verified: live parameter count == values sent, for each one.
- **Two real clips were generated after the fix** (`Wan 2.2 14B Preview II`, 1 s @ 480p) with **no Hugging
  Face token** and the job POSTed through Perchance's built-in proxy — first 118,647 bytes, second 90,935
  bytes, both genuine MP4s (`ftyp/isom`), logged by the app as `done · Wan 2.2 14B Preview II`. The first run
  also showed the failover working: `Wan 2.2 14B Turbo` was quota-refused, and the run moved on to Preview II
  and succeeded.
- **A silent quota refusal was identified by reading the raw stream.** A refused job returns `event: error`
  with `data: null` and nothing else, ~2 s after the join is accepted (the Space's queue is empty and its
  page loads fine). That is ZeroGPU declining the GPU, not a broken connection — which is why the pool still
  *looks* alive while refusing every job once the day's allowance is gone.
- **Relays genuinely work, proven end-to-end.** The same proxy reports its egress as
  `2a06:98c0:3600::103` while this machine's own egress is `103.218.237.21` — genuinely different addresses,
  so the rotation is real and not cosmetic.
- **The built-in proxy can carry everything strict privacy needs** — measured, not assumed: multipart
  uploads up to 6 MB (5 s), binary GETs with the magic bytes intact, and a live `text/event-stream` that
  stayed open past 120 s. Its one limit is that a *non-stream* response is buffered with a ~60 s cap (a
  135 s response failed at 60 561 ms; a 10 s drip resolved at 10 939 ms) — and every non-stream request the
  app makes is short. This is what let strict privacy be the default with zero setup.
- What was *retested and rejected* so as not to ship something broken: the public CORS proxies (corsproxy.io
  needs a key, corsfix needs a registered domain, codetabs/thingproxy "Failed to fetch", whateverorigin
  returns HTML). Relays must be ones the user deploys — which is why the built-in proxy and your own server
  are the two that ship enabled.

- **Two clips in a row, no token, on the free pool.** Run 1: `LTX` was quota-refused, the run moved on, and
  `Wan 2.2 14B Preview` produced the clip; the log then printed `wipe → 1 storage key, 29 timing entries,
  1 quota record`. Run 2 (immediately after): **also produced a video** (0.08 MB, ~26 s). Both logged
  `fresh run → N bench records dropped · one address — all of the free models share its allowance`, which is
  the honest readout of the situation: with one address the app still gets through by trying the next model,
  and it is no longer benched into silence.
- **`retryDecision()` unit-checked** against every case: quota on one address → *bench, don't hop*; quota with
  two addresses → *hop*; a second quota failure → *don't hop again*, bench; three addresses → hops twice;
  busy → hop; timeout/empty → bench 120 s; paused → bench 3600 s.
- **`attemptPlan()` rotation checked** for every configuration: default (strict, Perchance only) →
  `["Perchance's own proxy"]`; one relay of your own at index 0 → relay then Perchance; index 1 → Perchance
  first; two relays → a real alternation; non-strict with no relays → `[DIRECT]`; strict with no relays →
  `[]`, i.e. a refusal rather than a silent direct request.
- **`wipeTraces()` on the live page** reported `{cookies:7, storage:3, caches:1, timing:19, quota:0}` and left
  `document.cookie === ""` with localStorage, sessionStorage and caches all empty. **"Reset allowance"**
  reported `quota → reset (asked): 3 bench records dropped · 1 address available` (benches 3 → 0);
  **"Wipe traces now"** reported `wipe → 1 cookie, 1 storage key (asked)`. Both toggles persisted across a
  reload.
- **`benchTable()` now reflects `main.pjs`** — `{quota: 60, busy: 90, paused: 3600, error: 120}` — where the
  file previously said `quota = 900` and nothing read it.
- **The privacy section's layout was checked numerically** (not by eye) at 390 × 844: the section has 21
  children, **zero vertical overlap**, all six `.switch-row`s 96–186 px tall, `#traceNote` 160 px, the button
  row 29 px, and no horizontal overflow at dialog, body, page or banner level. (Note: `vision` on an
  html2canvas clone produced *false* positives here — it claimed rows and buttons were missing. Trust
  `getBoundingClientRect` for this dialog; the live form controls do not survive the clone faithfully.)

- **The 1-hour duration bug is fixed, and measured.** `encodeCanvasFrames()` produced exactly `duration × fps`
   chunks with exact timestamps (5 s @ 30 fps → 150 chunks spanning 5.000000 s); `patchWebmDuration()` wrote a
   real EBML `Duration` (2 s @ 24 → 2000 ms, 5 s @ 30 → 5000 ms, 1.5 s @ 8 → 1500 ms — the muxer alone wrote
   1958 ms and ignored its own duration option); and the player's load-time repair makes even an existing
   81-minute-labelled WebM display its true length. A chosen rate that differs from the model's native one is
   applied by `retimeClip()` and logged (`re-timed 16 fps → 30 fps (… frames, …)`).
- **The fps ladder and the undress timeline were exercised in the live page.** `#fpsSel` offers
   `8/12/16/24/30/48/60`; `#undressRow` stays hidden until NSFW is on; `root.undressStages` returns the five
   rungs and `undressStageAt()` picks 0 / 2 / 4 at 0 % / 50 % / 99 % of a chain; a real (failing) run through
   `generate()` logged `On-device rig left out of this run…` followed by `Segment 1 · … · undress stage 1/5`.
- **An undress run no longer falls back to the camera rig.** `orderProviders()` was checked for every shape:
   with `poolEnabled` off and one server, Auto returns 15 providers with the rig and **14 without it** when
   `undress` is on; "Only this device" still returns the rig alone; and with the pool off and no server the
   undress run throws *"Nothing can render an undress run right now. The on-device rig was deliberately not
   used…"* instead of silently rendering a camera move. `serverGenerate` was checked for every branch too —
   NSFW + Wan → `{fps, loras:["nsfw","motion"]}`, NSFW off → no `loras`, a non-Wan family → no `loras`, a
   missing family → no `loras` — and the server's `fps`/`interpolated`/`precision`/`lora` meta arrives back in
   the result instead of being dropped.
- **The server's new LoRA / precision / interpolation code is machine-tested under Pyodide** (its GPU path
   still needs the user's own card): `split_experts`, `safetensors_files`, `interpolate_video`'s fallback,
   `resolve_dtype` (8 cases — fp8 degrades to bf16 below compute capability 8, fp32 is CPU-only), `fps_plan`
   (15 cases — render at the native rate, interpolate up, `interpolate:false` opts out), `lora_entries`
   (8 cases, including `--no-lora`, a CSV list, a custom repo and a manual id) and `ensure_loras` (4 cases with
   fake pipes). Those tests found and fixed **two real bugs**: the two-expert attach short-circuited on `or`,
   so Wan 2.2's low-noise `transformer_2` was *never* given its half of the LoRA; and the safetensors lookup
   built its dict name-keyed while looking up by path. `server.py` is pyflakes-clean (one pre-existing
   cosmetic f-string warning), and the updated notebook parses with all nine code cells compiling.
- **Not verified here, and worth re-checking first after any report:** anything that needs live `<video>`
   decoding (`loadVideo`, `probe`, `retimeClip`, `stitch`) — the editor preview is often a *hidden* document,
   where Chrome will not decode media at all (see the caveat below) — and no real generation ever ran on the
   user's own GPU from this session.

Browser caveat found while testing: in a *hidden* tab (which is how the editor preview is often evaluated) Chrome
does not decode `<video>` media elements at all, so `probe`/`extractFrame`/`filmstrip` return nothing there. The
offline renderer therefore hands its poster frames and last frame straight to the UI, and `handleResult` falls back
to a still poster if the clip cannot be played inline.

## Persistence & sharing

- Settings and up to 24 past clips live in `kv-plugin` (IndexedDB) under this generator's origin.
- "Share" uploads the clip with `upload-plugin` (30-day expiry), stores a small record under `avg_shared`, and
  copies a `https://perchance.org/<generatorName>#v=<key>` link that the app loads on arrival.
- The server URL/key are stored locally and only ever sent to the address you typed. Clips are never uploaded
  unless you press Share.

## Image studio: library, viewer, Puter routes

- **Library.** A lone image is auto-saved to Finals (`kind "image"`, `name_Final.jpg`); every
  variation of a multi-image batch goes to the Sandbox (`kind "image-take"`, `name_take01.jpg`…).
  Same split as clips, separate caps (`MAX_IMAGE_FINALS`/`MAX_IMAGE_TAKES` in `src/store.js`), same
  vault encryption (the still rides in the generic `video` Blob field). Clicking an image card
  loads it back into the Canvas (`state.imgResults`) instead of the video player.
- **Viewer.** `#imgScreen` opts out of the video stage's fixed 16/9 box (`#imgScreen` rules in
  `src/styles.css`): the selected variation shows big in `#imgHeroWrap` at its own ratio, the rest
  become a thumbnail strip (`renderGrid()` in `src/app.js`; grid hidden for a single result).
- **Puter.js** (`src/puter.js`, lazy-loaded from `js.puter.com/v2/`). Free, no key — the visitor
  signs into their own Puter account once (User-Pays) and the routes just answer after that.
  Image: `puter-nano` (Nano Banana Pro), `puter-flux` (FLUX.2 [pro]), `puter-gpt` (GPT Image 2.5
  Flare) — text-only, pick-only, failing over to the free chain. Video: `puter_video`
  (`kind "puter"`, `puter.ai.txt2vid`), pick-only in Auto until one Puter render succeeds
  (`settings.puterOk`, in-memory) so Auto never volunteers a login popup; excluded from explicit
  runs by `moderationOf()`, audited in `auditEgress()`. Not yet wired: `puter.ai.txt2speech`
  is the obvious next route when the voiceover studio grows studio voices.

## Gotchas worth remembering

- **`src/` preview & the service worker:** unsaved `src/` files preview fine in a normal browser; in-app browsers
  without a service worker (e.g. the Google app on iOS) can only preview `src/` after saving the generator.
- **Mixed content:** `http://127.0.0.1` / `localhost` is "potentially trustworthy" in Chrome/Edge/Firefox, so the
  https page may call it. Safari blocks it — use the cloudflared tunnel there.
- **Free tunnels and Colab sessions expire.** The address changes; the app is built to fall back, and the help
  dialog explains re-running the last notebook cell.
- **The offline rig no longer records in real time, so a clip's length is exact.** Frames are drawn as fast as
  the device can and encoded with WebCodecs at exact timestamps; `MediaRecorder` (which cannot render faster
  than real time, and whose WebM carries no duration — the 81-minute bug) is only the fallback when
  `VideoEncoder` is missing. In that fallback, a 15 s clip really does take ~15 s, and rAF throttling in a
  hidden tab makes it slower still. That is expected.
- **Gradio API shape:** newer Spaces expose `/gradio_api/*`, older ones `/info`, `/upload`, `/call/<fn>`;
  `src/gradio.js` tries both, and the SSE reply may arrive on `complete`, `error`, or a plain `data:` line.
- **Public Spaces are third-party code** and can be renamed, paused or rate-limited at any time.
- **Public Spaces are also edited underneath you.** `Wan 2.2 14B Preview` went from 10 to 17 inputs and
  `Preview II` to 19 without warning; a positional adapter silently dies when that happens (the Space answers
  `didn't receive enough input values`). That is why adapters return `{named: {...}}` — the engine fetches the
  Space's live `/gradio_api/info` once per session (`spaceParams`), lays the named values out in the order the
  Space reports today (`alignData`), and falls back to the adapter's own order if the info call fails. When a
  Space breaks, the honest fix is to re-check its info endpoint and rename keys, not to renumber positions.
  A quick way to audit every adapter at once: build each provider with a stub `uploadBlob` and compare
  `data.length` with `spaceParams(...).length`.
- `videoMime()` prefers mp4 (avc1) and falls back to webm; some browsers only advertise mp4 support that they
  cannot actually play back, which is why the UI has a still-poster fallback.
