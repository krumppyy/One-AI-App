# AI Video Gen v1 — roadmap (what's next)

This is the **forward plan**: what is deliberately not built yet and the order to
build it in. The research and measurements that produced the current app (the
three motion/clip-length bugs, the five undress approaches, the free-stack
tables, the phased plan) are recorded in `src/SPEC.md`'s requirement → delivery
table and in the code comments; this file picks up from there.

## Next: community round (Feedback + Tutorial + AI Tutor)

Public testing comes first; the order of everything after it follows what visitors actually ask for:

1. **Opt-in community compute pool (Phase 1 SHIPPED, disclosed)** — strictly voluntary shared power: Settings → Where the rendering happens → Own pool. Image, video and storyboard runs log live local power (CPU cores, WebGL, share %); small tasks (upscale, encode, storyboard merge) run on this device. A larger-model ask with only this device fails openly: `own pool failed — not enough free devices online (1 online, need 5+ for larger models)`. True multi-device pooling waits on a coordinator server and stays listed here, never silent.
2. **Feedback wall (SHIPPED)** — a public `Feedback` tab beside AI Chat: category + suggestion form over a newest-first community wall, plus footer links. This is what decides the order below.
2. **Tutorial + AI Tutor (SHIPPED)** — a `Tutorial` tab with per-studio steps and the live in-app roadmap; a single full-page `AI Tutor` (topbar button beside Settings, plus a section at the bottom of Settings) answering how-to questions from the built-in manual via the free text model; first-run `new / returning` prompt; cursor hover tips on every control; a floating `?` ask-anywhere button on all pages.
3. **Navigation + appearance (SHIPPED)** — studio tabs in one small rectangular horizontal row; Tutorial + unique `💬 Feedback` button moved to the top-right, out of the tab row; logo tap returns home; Settings → Appearance scales the whole app (80–125%, saved per device); Video tab decluttered to essentials only; Image studio gained a Simple/Full studio-talk run log matching Video.
3. **Feedback-driven fixes** — top-voted wall items first.
4. **Video-to-video conditioning** — as scoped above.
5. **Server model verification** — as scoped above.
6. **Local provenance + saved tutor answers** — as scoped above.

## Next: video-to-video (V2V) and a source-video input

The one genuinely-new capability named by the external roadmap
(`src/REVIEW.md` §7). Nothing in the app ingests a source **video** today, so
V2V, Wan VACE and Wan Animate all wait on this. The pieces:

1. **Client input** — SHIPPED (Video tab starter). The starter dropzone
   accepts `image/*,video/*` (PNG · JPG · WEBP · GIF · MP4 · WEBM · MOV ·
   MKV, 100 MB cap): a dropped video is `probe()`d for dimensions/duration
   and its first frame (`extractFrame(file, "first")`, metadata-stripped,
   capped at 1280px) becomes the animated starter, with the clip facts in
   the run log. A **frame picker** under the dropzone scrubs the imported
   clip (`#frameVideo` + `#frameRange`) and `Use this frame` grabs whatever
   moment is showing as the starter instead. The starter — from image or
   video alike — can then be cropped in the Crop dialog (free manual
   drag/resize box plus well-known ratios: 1:1 · 2:3 · 3:2 · 3:4 · 4:3 ·
   4:5 · 5:4 · 9:16 · 16:9 · 9:21 · 21:9). One source clip at a time. Full
   V2V conditioning (passing the clip itself as `video=` to a Wan VACE
   pipeline) still waits on steps 3–4 below.
2. **Normalisation** — decode to frames at the model's rate, cover-crop to the
   chosen aspect, cap length to the model's window; re-use `extractFrame()`
   and the encoder's frame maths rather than new plumbing.
3. **Transport** — the reference is a multi-MB clip, not a small still. Send it
   to the user's own GPU server (base64 is fine there), not through the public
   free pool (whose Spaces take a single image).
4. **Server family** — a `family: "vace"` entry in `src/server/server.py`'s
   `MODELS` with `WanVACEPipeline`, plus a `call_kwargs()` branch that passes
   the conditioning video as `video=`; the generic kwargs filter already drops
   whatever the installed pipeline does not accept.
5. **Verification** — this cannot be validated here; it needs the user's GPU.
   Ship it behind the server-only compute mode first, with the same
   "experimental — untested" honesty the Hunyuan entries carry.

## Model expansion (server registry)

- **Wan 2.2 S2V-14B** (speech → video) — needs an audio input path; lower
  priority than V2V because the value is narrower.
- **Wan Animate** (character animation / replacement) — depends on the same
  source-video input as V2V, so it follows it.
- **Verify `hunyuan_t2v` / `hunyuan_i2v`** on a real GPU and confirm the two things
  source-level verification cannot: that the weights load on a free card, and that a render
  completes in the time the VRAM note implies. The **argument contract is now verified** against
  `pipeline_hunyuan_video_image2video.py` (frames `4n+1` — `align_frames(x, 4)` already produces
  `1+4k`; `guidance_scale` is the *embedded* guidance of a CFG-distilled model and 6.0 is the
  pipeline's own example value; the LLaVA `prompt_template` is the pipeline default so nothing is
  threaded through; H/W must be divisible by 16, which `call_kwargs()` enforces), and the notes say
  exactly that instead of "experimental". Watch for the HunyuanVideo frame-count constraint and its
  heavier VRAM ceiling.
- **HunyuanVideo 1.5** (Tencent's newer ~8B distilled release) is reachable **only** through a Space
  today: `tencent/HunyuanVideo-1.5` ships its own repo with `library_name: "HunyuanVideo-1.5"`, so
  diffusers has no pipeline for it and it cannot be a `server.py` entry. The free
  `hunyuan15` route in `src/providers.js` is that build, verified against its live Space signature.
  If diffusers ever ships `HunyuanVideo15Pipeline`, add it to `MODELS` — the Space route renders
  fixed 480p landscape, which a local pipeline would not have to.
- **HunyuanImage-3.0 and HunyuanOCR are deliberately not wired in.** An 80B MoE image model is not
  a candidate for a free T4 or a browser, and HunyuanOCR is a 1B OCR model with nothing in a video
  pipeline to consume its output. If a server-side *explicit keyframe* is ever built (the app's
  stated #1 NSFW limit — the free inpainting route is filtered), the model for it is an inpaint
  model that fits a free card, not either of these.
- **LTX-Video newer builds** — re-check the diffusers repo id/version and, if a
  drop-in `LTXPipeline` build reaches better quality at the same 12 GB, swap the
  repo id (the family/handling stays).

## Reset, anonymity, and keeping the free NSFW list alive

- **The free Spaces are not permanent.** `src/providers.js` now lists **seven** uncensored video
  routes, each verified against its Space's live `/gradio_api/info`. Spaces get paused, renamed or
  deleted, so this list needs periodic re-verification — and one trap worth repeating, because it
  cost time here: **`https://huggingface.co/api/spaces/<id>` answers `Invalid username or
  password` for a *private* Space, which is indistinguishable from a deleted one at a glance.**
  Two of the seven are in exactly that state and both still serve real jobs, so a route is verified
  by its own `GET https://<subdomain>.hf.space/gradio_api/info` (the live endpoint and parameter
  names), never by the Hub API alone. `runtime.stage` and `runtime.hardware.current` are still
  worth reading for the *hardware* part — `cpu-basic` means the route can never start a GPU job at
  all (that is why `wan22_nsfw_lora` was removed) — and the routing numbers (`fps`, `maxSec`) come
  from each Space's own `app.py`: a ZeroGPU Space's window is capped by the decorator
  (`@spaces.GPU(duration=…)`), and asking for a clip longer than that window returns *nothing at
  all* rather than a short clip. A "re-check the NSFW list" helper (or a startup probe) would still
  be worth having.
- **Reset is as complete as a browser page can make it**, but two things remain out of reach and
  should stay stated, not implied: another origin's cookies (huggingface.co's own), and the
  server-side per-address allowance. The only true refresh is a different address.
- **A reset cannot change the address for you** beyond the relay index. Detecting a VPN/proxy
  switch (the "Check addresses" button already reports the observed egress IP) and surfacing it as
  a one-glance "which address am I actually on" read-out in the Reset dialog would make the honest
  limit easier to act on.
- **Metadata is stripped on the way in, not on the way out.** The reference picture is cleaned
  before it is uploaded; the *downloaded* clip's filename still carries only the seed's last digits.
  If provenance metadata is ever written (see below), it must be written deliberately — not
  inherited from a camera.

## Provenance and safety metadata (local, not a central service)

The external roadmap's remote-moderation half is not applicable here (there is
no backend), but the **local** provenance ideas are cheap and worth having:

- Write an audit id + generation timestamp + model id + workflow id into the
  clip's filename/metadata on download (currently the filename carries only the
  last 6 digits of the seed).
- An optional "I have the rights to this image" acknowledgement before an NSFW
  run with an uploaded photo, kept in local storage only.
- C2PA/content provenance on export is a later, optional step.

## Prompt compiler, in full

The four `ENHANCE_MODES` cover the roadmap's concise/cinematic/technical/exact
modes. A full structured compiler (a labelled SUBJECT/ACTION/CAMERA/LIGHT block
the user can edit field-by-field before it is flattened into the model's
comma-string) is a bigger UI change with no model that consumes the block form,
so it stays a maybe.

## Accuracy: what is done, and what is still open

The fifteenth brief (`src/SPEC.md`) closed the accuracy work that a real run exposed — a 5 s request
delivered as a 3.25 s file whose first second was a melted render. The sixteenth closed the *other* half of
the same story: a run that came back with nothing at all. What is in place now: real-second accounting in
the segment loop, frame-aligned beats, a `targetDuration` on `stitch()`/`retimeClip()` so the request is the
timeline, no crossfade on a storyboard chain, an honest "short" report instead of a padded tail,
`clipMetrics()` judging every returned segment with a scored retry that keeps the best attempt, an
automatic **smaller ask** when the pool refuses for quota — which now **grows back** on every successful
beat — **in-run route ranking** so a beat is answered by the model that is actually working instead of
rediscovering the spent ones, a **rejection of any clip the browser cannot decode** (it is a failed
attempt, re-rendered on the next route), a `stitch()` that **skips** an unreadable clip rather than losing
the whole chain to it, a **stills film** so a dead video pool can still be delivered as the drawn pictures,
a **“Finish this clip”** continuation that keeps the beats already made and still anchors her identity to
the reference picture, and a stop-early rule when not one keyframe could be drawn.

What is still open on this front:

- **Tell a corrupt file from an unsupported codec.** A beat whose file will not decode is retried on the
  next route now, which is right when the download was truncated and wasteful when the *browser* simply
  cannot play that codec (a VP9 WebM on a platform without it). `src/enhance.js` already parses an MP4's
  container, so a codec check against the browser's own support before the beat is accepted would stop an
  entire run from being retried against every route for a file none of them could ever deliver.

- **Repair the head instead of re-rendering the beat.** When only the first few frames of a segment are
  melted (which is what the first real run produced — 0.94 s of it, then a clean picture), the right fix
  is to cut the bad head off and hold the beat one frame longer, not to spend a whole render retrying. It
  needs a per-frame version of `clipMetrics` and a `trimHead` option on the stitcher.
- **Steer with `endDrift`, don't just judge it.** The number already says how far a beat landed from its
  target keyframe. Feeding it back — a longer beat, a stronger motion clause, or a different keyframe for
  that beat — is the obvious next step.
- **Best-of across addresses, not just across providers.** `retryDecision()` already hops addresses on a
  quota refusal; the same hop could collect two attempts at one beat and keep the better one when the pool
  is quiet.
- **A per-beat quality line on the result card.** `imperfectBeats` is a count today; a filmstrip with the
  flagged beats marked would make it obvious *which* part of the clip came back weak.
- **An explicit-content inpaint that is not filtered.** The one thing that keeps the storyboard from being
  reliable for NSFW is that AI Horde's workers run their own safety check and flag an explicit result. No
  client-side trick gets past that; the honest options are the user's own GPU server (a `diffusers`
  inpaint endpoint already fits `server.py`'s model registry) and the paid vendors. Until then the app
  tries several workers per rung, names the refusal when it happens, and stops rather than spending the
  allowance on a clip that cannot undress.
- **Verify a keyframe's identity after a redraw.** `minFrameChange` catches a rung that changed *nothing*;
  a rung that changed *too much* (the worker re-cast her) is only caught on the video side today. The
  on-device face detector (`faceBox`) is already there for it.

## Color grade before export — SHIPPED

Roundtable (creator, editor, on-device engineer) verdict: build it. A grade is
the cheapest quality win in the app — fully on-device, no quota, no key — and
it answers "the clip looks flat" without re-rendering anything.

- Video result bar: `Color grade` fold (9 filters + intensity, saturation,
  light, exposure, contrast, gamma, grain, sharpen, overlay color + strength).
  Live preview on the player (CSS filter + overlay veil); baked in on
  Download — a graded export always re-encodes, even on "Match source".
- Image result bar: the same fold with only the necessary half (filter,
  intensity, saturation, light, contrast, sharpen). Baked in before
  upscale/format encoding, so it composes with 4x + AI upscale.
- Engine: `src/grade.js` (presets, effective-value maths with intensity
  falloff, canvas pipeline: ctx.filter → gamma LUT → tint/grain → sharpen).
  `src/gallery-export.js` threads it through `exportImage` and the video
  transcode/GIF/APNG paths.
- Deliberately out: grade inside the voiceover merge (that path captures the
  player, not the file — a future step is to grade-then-merge), saved grade
  presets, per-beat grades on multi-segment runs.

## Import / export formats + upscale (Video tab) — SHIPPED

- Import: the Video tab starter takes PNG · JPG · WEBP · GIF · MP4 · WEBM ·
  MOV · MKV. A video import is probed (`probe()`) and its first frame
  (`extractFrame(file, "first")`) becomes the starter frame that gets
  animated — the same primitives the engine already uses for chaining and
  the filmstrip, now wired to the dropzone (`acceptFile()` in `src/app.js`).
- Export: Match source · MP4 · WEBM · MOV · MKV · GIF · APNG
  (`VIDEO_FORMATS` in `src/gallery-export.js`, `#vidFormatSel`), with
  1x/2x/4x upscale in Fast · Quality · AI modes (`src/upscale.js`,
  `#vidScaleSel` / `#vidUpscaleModeSel`) and a quality/bitrate slider —
  the same row the Image studio already had, now labelled on the Video tab
  with a supported-formats hint under the starter dropzone.

## Studio-talk run log + viewer (Video tab) — SHIPPED

- The run log used to be a build diary: pool order, relay hops, model ids,
  storyboard rung labels, the composed prompt. That tells a visitor exactly
  how the app is wired. Now the log has two modes (`#logModeRow`,
  `state.logMode`, default **Simple**):
  - **Simple** reads like a studio call sheet — local rotating lines from
    `src/friendly.js` ("Warming up the studio…", "Filming part 2 of 5…",
    "That part looks good — keeping it…"). No network, no cost, no quota:
    it is a phrase engine, not a model call, so it is instant and offline.
  - **Full** keeps the raw engine events for the owner's own debugging.
- The Stage busy overlay matches: provider credit reads "AI studio",
  segments read "part i of n", stages read "dreaming / directing /
  blending". Result card, toasts and the quota banner are unchanged (they
  were already user-facing and generic).

## Security pass (this round) — SHIPPED

- Server key no longer travels in URLs (tunnel/server logs keep URLs):
  `X-API-Key` header on every fetch (`src/server.js`, `src/relay.js`),
  query key kept only for the EventSource status stream, which cannot set
  headers. Server compares with `hmac.compare_digest` (`src/server/server.py`).
- Fixed: own-server relay POST (`/api/relay`) never sent the key, so a
  `--key` server answered 401 there while everything else worked — it looked
  like a broken relay instead of a missing key.
- Voice picker builds `<option>`s as text nodes, not HTML: voice names come
  from the OS/browser (and any installed voice pack), so they are untrusted
  input by definition.
- Checked and left as-is: run/result/editor/chat logs all write
  `textContent` (no user-input HTML injection); share flow is explicit
  double-consent with a 30-day expiry; MuAPI key travels in a header through
  the fetch proxy; API keys live only in local kv storage; the server relay
  allow-list is unchanged (narrow host list, no open proxy).

## Next: monetization (tomorrow)

- Context (from the owner's WhatsApp export, 25 Sep 2026): audited taxpayer
  in India with a crypto tax engine; new to monetizing, not to building.
  Decided stack: **Adsterra/Monetag** ads for passive views, **Razorpay
  ₹499–999** unlock (HD / no-watermark / packs + GST invoice — CA-friendly),
  **feature locking** in three levels (1: Razorpay code → `localStorage`
  flag, no backend · 2: Supabase `licenses` table + webhook auto-keys · 3:
  own `/api/verify` → JWT), **affiliate** links under outputs (CapCut /
  InVideo / stock / ElevenLabs for multimedia traffic).
- Pending from the owner: which 2 features to lock + the Razorpay link.
- Do NOT start until asked: no ad snippets, no paywall, no locked features
  in the app yet — the app stays fully free until the monetization session.

## Content safety — what is deliberately *not* built

The two engines (`src/router.js` routing, `src/vault.js` vault/leak audit) close the
things that are actually closable. Three related ideas are deliberately not built,
because building them would either be a lie or a worse trade:

- **A real “safety-check bypass”.** There is no client-side way to stop the machine
  that renders a clip from seeing the prompt and the picture: they arrive there, and
  a content check runs on that side. Anything that claimed otherwise would be
  theatre. The router instead never submits an explicit request to a route that
  checks — which is the part of the original request that is genuinely achievable.
- **Evading a *user's own* accountability.** Nothing here helps hide what was asked
  for from the user themselves; the audit's whole purpose is the opposite — to state
  plainly where content goes before it goes.
- **A server-side vault / “encrypted at rest” for the free pool.** The vault protects
  this origin's storage. It cannot encrypt what a third-party Space or AI Horde keeps
  on their side after a job, and it does not pretend to.

Smaller follow-ups worth doing when the vault is next touched:

- **Encrypt the settings secrets too** (the API keys) under the same device key.
  Deferred because the settings load path must never be able to fail closed — a
  locked vault that cannot read `hfToken` would break every run, and content is the
  higher-value half.
- **A per-run “no third party” confirmation** for the inpainting step, so
  `localOnly` can be applied to one run rather than globally.
- **Rewrap the whole library** when the passphrase is *removed* while clips made under
  an older key exist — today the key itself is preserved, so this cannot happen, but a
  future key rotation would need it.

## Finetune + large upscale (pose portraits) — krumppy's active thread

- **2x upscale DONE** (pose 320x512 → 640x1024, sharpened bicubic, verified by screenshot — her face holds).
- **Still open:** 3x/4x sizes + the AI-upscale path; a real detail-refine pass (low-denoise img2img) through external free help — Horde refine, Qwen edit route, Puter FLUX edit — all three were unreachable this session, retry next; face-lock + score after every refine; keep the best-scoring version.
- **Seam concealer DONE** — concealRing runs inside every face blend and as standalone fixSeam for upscales; finals generate only after passing through it.
- **Rule:** deliverables are pictures + scores only; no addresses, keys, or security internals in logs, docs, or chat.

## Not planned (and why)

- **A centrally hosted backend** (FastAPI + Redis + Postgres + S3, accounts,
  credits, an admin panel) — `src/REVIEW.md` §14. The app is a Perchance
  generator: it is the client, and each user brings their own free GPU server.
  Building that half would add cost, a single operator seeing every prompt, and
  a dependency that does not exist today.
- **Diffusion models running in the browser** — the roadmap itself says not to;
  the on-device renderer is a camera move over a still, and `src/offline.js`
  says so. WebGL (not WebGPU) is the right amount of browser GPU here.
