# Review: "AI Video Studio — Perchance Master Roadmap" (ChatGPT)

A point-by-point review of the roadmap text the user supplied
(`AI_Video_Studio_Perchance_Master_Roadmap.txt`, 98 sections), against what this
generator already does, what was worth adding, and what cannot apply to a
Perchance app. The short version: the roadmap is **excellent research on models
and GPU hosting**, and its *backend* half (sections 13–21, 29–34) describes a
centrally hosted product — a FastAPI + Redis + Postgres + Docker + S3 service
with accounts, credits and an admin panel — which a Perchance generator cannot
be. This app already took the better path for its constraints: **the browser is
the whole front end and there is no backend to run**, every user brings their
own free GPU server (or uses the free public pool, or their own device), so
there is no central quota, no keys to leak, and nothing to pay for. What follows
maps each roadmap area to its disposition.

Legend: **✅ already built** · **➕ added from this review** · **🔜 planned** ·
**➖ not applicable here**

---

## 1. Model strategy (§1, §2, §36) — ✅ mostly, ➕ additions

The roadmap's core advice — *"don't hard-code one model; route by task"* — is
already how the app works: 69 models across 9 picker sections, each provider
declaring its own `caps` (`i2v`/`t2v`/`endFrame`/`resolution`/`nsfw`), and
`orderProviders()` choosing a route from the compute mode plus those caps.

Coverage of the named families:

| Roadmap model | Status here |
| --- | --- |
| Wan 2.2 TI2V-5B | ✅ `wan5b` on the GPU server (720p/24fps, one unified 5B) |
| Wan 2.2 I2V-A14B | ✅ `wan22a14b` (+ bundled Lightning 4-step LoRA) |
| Wan 2.2 T2V-A14B | ✅ `wan22_t2v_a14b` |
| Wan 2.1 I2V / FLF2V / T2V 14B / 1.3B | ✅ four more entries |
| LTX-Video | ✅ `ltx` (24fps, 2B, small-card friendly) |
| CogVideoX | ✅ four entries (5B, 5B-I2V, 1.5-5B-I2V, 2B) |
| HunyuanVideo | ➕ **added**: `hunyuan_t2v` + `hunyuan_i2v` (13B, flagged experimental — see below) |
| Wan S2V-14B / Wan Animate | 🔜 needs an audio / reference-video input path the UI does not have yet |
| Wan VACE (v2v) | 🔜 needs a **video** upload + conditioning path (the roadmap's §27); nothing in the app ingests a source video yet |

The two Hunyuan entries were added to `src/server/server.py`'s `MODELS`
registry with the correct diffusers pipeline names
(`HunyuanVideoPipeline` / `HunyuanVideoImageToVideoPipeline`). They are marked
**"experimental — untested on this server build"** in their `note`, because the
loader can only be exercised on a real GPU: if the installed diffusers lacks the
pipeline, `_load()` already fails with a message naming the missing class rather
than crashing. HunyuanVideo wants ~45 GB VRAM to run comfortably, so it is a
"bring a big card" route, not a free-tier one — which is exactly why it is not
in the app's default Auto order.

`src/server/README.md` and the Colab notebook still list the 16 original ids;
the two new ones are additive and can be downloaded/selected like any other by
id (`--download hunyuan_t2v`).

## 2. Style system (§7) — ➕ **expanded**

Was 10 flat styles; now **82 styles in 7 groups** (`Basic · Realistic ·
Cinematic · Animation · Art · Fantasy & Sci-fi · Film & camera`) rendered as
native `<optgroup>`s in the picker (`fillSelect()` in `src/app.js`). Each entry
carries a `phrase` (spliced into the prompt by `composePrompt()`) **and a
`negative`** (its own anti-style block). The ten original ids are preserved so
saved settings and the library keep resolving. New styles span the roadmap's
categories and more: portrait/beauty/fashion/product/wedding/travel/vlog/street
photography, golden-hour and low-key lighting, Hollywood/epic/documentary,
anime-family (anime, manga, chibi, Ghibli, 90s cel, comic), 3D families
(Pixar, claymation, low-poly, voxel), art-media (oil, watercolour, ink, comic,
pixel, ukiyo-e, art-nouveau, stained glass), and film looks (noir, found
footage, VHS, Super-8, black-and-white, infrared, time-lapse, slow-motion).

## 3. Negative prompts (§24) — ➕ **per-style negatives wired in**

The roadmap's "don't use one universal negative; keep per-style presets" is now
real: `buildNegative()` appends the selected style's own anti-style block
(`NEG_REALISM`, `NEG_ANIME`, `NEG_ART`, `NEG_3D`, `NEG_CINEMA`) between the
artifact block and the NSFW/anti-NSFW block. The user's own negative field stays
first and fully editable, so advanced users still override everything.

## 4. Prompt engine (§23) — ➕ **modes added**, structure ✅

The roadmap's four modes now exist as a small select beside the `✨ Auto-enhance`
button: **Cinematic** (35–60 words, the old behaviour, default), **Faithful /
exact** (20–40 words, invent nothing), **Short & punchy** (12–25 words) and
**Technical / camera spec** (45–80 words naming focal length, aperture, rig,
grade — the roadmap's "technical mode"). The enhancer streams from
`ai-text-plugin` and now describes the chosen camera move/angle/style in the
prompt, which is the roadmap's "prompt compiler" idea (a structured subject →
action → camera → light → style pass) folded into one call rather than a
separate UI stage.

The roadmap's literal `SUBJECT:/ACTION:/ENVIRONMENT:` block form is **not** used
verbatim: this app's models (Wan/LTX/CogVideoX/Hunyuan, and every MuAPI
endpoint) all take a single comma-separated phrase string, and `composePrompt()`
already assembles that string from the same conceptual fields. A labelled block
would be model-specific syntax with no model that reads it.

## 5. Seed system (§25) — ➕ **lock added**

Was: typed/blank seed + a re-roll button. Now there is also a **Lock seed**
switch in *Advanced*: when on, the seed a render actually used is written back
into the seed field and saved, so re-running a tweaked prompt explores the same
noise/composition (the roadmap's "reuse/lock seed"). Blank seed with the switch
off still means a fresh random roll.

## 6. Image input (§26) — ✅

`acceptFile()` already trusts the MIME type (not the extension), accepts
`image/*` (so JPG/JPEG/PNG/WEBP all work), warns above 12 MB, and downscales to
1280 px before anything is sent. Browser canvas draw applies EXIF orientation,
so rotation is handled. AVIF will work wherever the browser can decode it.

## 7. Video input / V2V (§27) — 🔜 **not built**

There is no video upload path, so V2V (and Wan VACE, and Animate) cannot run
yet. This is the single biggest genuinely-new capability the roadmap names.
Adding it means: a video dropzone, `probe()`-based normalisation (already in
`src/video.js`), frame extraction per segment, a server family that accepts the
conditioning video, and a client field for it. It is scoped as future work
rather than half-shipped, because a V2V path that cannot be GPU-tested would be
worse than an honest "not yet".

## 8. Duration architecture (§4) — ✅

Long clips already work by chaining: `planSegments()` splits a request across
each model's native max (Wan ≈ 5 s …), each clip's **last frame** feeds the
next, and `stitch()` lays the segments on one output timeline with a crossfade.
The roadmap's "extract last frame → temporal condition → generate next → blend"
is exactly this, and the app adds a hand-over fast path for its on-device rig.

## 9. FPS design (§3) — ✅

`FPS_LADDER` (8/12/16/24/30/48/60), `snapFps()` (the ladder snaps to what the
chosen model can really render and says so), the GPU server interpolates up to
the requested rate with RIFE/ffmpeg when the model cannot render it, and the
on-device encoder writes exactly `duration × fps` frames at exact timestamps.
So "24fps" is 24 real frames, not a mislabelled 16fps file.

## 10. Aspect ratios & resolution (§5, §6) — ✅

16:9, 9:16, 1:1, 4:3, 3:4 and 21:9 are all selectable; `fitStage()` sizes the
player box in pixels to the clip's own ratio. 21:9 is covered. Resolution
presets (480p/720p/1080p) exist per provider. The roadmap's "smart crop" was
not added: the app cover-crops and centres instead of subject-tracking, which is
simpler and cannot silently cut a face out.

## 11. Video player & download (§12) — ➕ **speed range widened**

The custom transport already had play/pause, scrub, frame-exact seeking, loop,
mute, fullscreen + orientation lock and a **download** button (the result bar
downloads the real blob). The speed stepper's ladder was `0.25 … 4`;
it is now **`0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 5, 6, 7, 8`**, covering the
roadmap's 1–7× (browsers support ≤16×). Whole-number rungs stay adjacent, so
fast-forward is a few presses, not a scroll.

## 12. NSFW on/off (§8) — ✅ (as a per-user content switch, by design)

The `NSFW` toggle is a real mode switch, not a keyword: it removes the safety
negatives, adds an explicit boost, and forces the **starting frame** to be made
explicit first (because an i2v model animates what it is handed and never
undresses anyone). The roadmap's server-side moderation *pipeline* is **➖ not
applicable**: there is no central backend in this app — nothing is uploaded
anywhere by default, and the GPU server is the user's own machine. Adding a
central classifier would mean building the exact hosted service this design
avoids, and shipping the user's prompts to it. The app does keep the roadmap's
"NSFW does not override the model's own licence or the host's policy" reality
honest: the NSFW note in the UI and `src/README.md` say so plainly.

## 13. Real-person / deepfake protection, provenance (§9) — ➖ / 🔜

The roadmap's checklist (ownership checkbox, report button, audit id, C2PA) all
assume a hosted service that receives and stores uploads. This app uploads
nothing to a central place by default, and its own GPU server is the user's.
The **only** optional public upload is the explicit *Share* action, which
already asks for confirmation on NSFW clips. Local provenance metadata is
cheap to add later and is listed under 🔜; a central abuse-report queue belongs
to the hosted product the roadmap also describes, not here.

## 14. Backend, job queue, database, security, keys, credits (§13–§21, §29–§34) — ➖ **superseded**

These sections (FastAPI gateway, Redis + RQ queue, GPU router across
HF ZeroGPU / Modal / RunPod, Postgres schema, S3 object storage, Docker
images, accounts, API-key vault, rate limiting, credit/priority system) all
describe **one centrally hosted service**. A Perchance generator *is* the
client, and has no server process; building that half would mean paying for and
operating infrastructure, and would put every user's prompts and media through
one operator (the very thing §35's "who owns the data" concern argues against).

The app's equivalent, already built, is a **per-user** stack:

- **"One-click free GPU"** (§20) → the Colab notebook (`src/colab/…`) that
  pip-installs, fetches `server.py`, optionally caches weights on Drive, and
  prints a tunnel URL; the Settings dialog then takes that URL. That *is* the
  one-click free-GPU option, with no account for this app to manage.
- **Free/low-cost hosting** (§19) → the free public HF Space pool (opt-in via a
  free HF token) is the always-on fallback; the user's own Colab/RunPod/PC is
  the fast path. `--hf-endpoint`/ModelScope mirrors handle restricted networks.
- **Durable state** (§29) → `kv-plugin` (IndexedDB): settings, a 24-clip
  library, cooldowns and the clip blobs themselves, all per user, no DB.
- **Keys** (§31) → keys live only in the user's own browser storage and are
  sent only to the vendor; there is no vault to breach.
- **Rate limiting / credits** (§32/§33) → unnecessary: each user runs their own
  server or spends their own free/quota allowance.

Building the backend half would be a **regression** in privacy, cost and
reliability for this app, so it is deliberately not done.

## 15. Front-end architecture (§10, §11) — ✅

The roadmap's "do build / do not build" list matches this app exactly: UI,
controls, prompt construction, upload, calls, polling, player, download, theme,
local settings and history are all in the browser; no large GPU inference, no
long Python process, no giant model downloads into the browser happen (the
server does those). The on-device renderer is a *camera move over one still*,
explicitly not a diffusion model, and says so in the result card. Only the ~4 MB
quantised clothes detector is fetched on-device, and it ships in `src/models/`.

## 16. Safeguards worth taking from the roadmap anyway — 🔜

- **§22 Browser GPU / WebGPU** — correctly rejected as a *diffusion* backend;
  the app already uses WebGL for the offline rig, which is the right amount.
- **§28 file limits + auto-cleanup** — the app's 12 MB image cap, 24-clip
  library cap, object-URL discipline and the optional after-run trace wipe
  cover the spirit of this locally.
- **§35 automatic model selection** — present as the compute modes
  (`auto`/`server`/`pool`/`offline`) plus `orderProviders()` and the per-model
  cooldown bench, which is model routing by availability and capability.

---

## What was changed in the code because of this review

1. `src/providers.js` — `STYLES` expanded to 82 grouped styles, each with a
   `negative`; added `NEG_REALISM/NEG_ANIME/NEG_ART/NEG_3D/NEG_CINEMA` presets
   and the `ENHANCE_MODES` prompt-mode table.
2. `src/app.js` — `fillSelect()` now renders `<optgroup>`s; a prompt-mode
   select (`#enhanceModeSel`) drives `runEnhance()`; a **Lock seed** switch
   (`#lockSeedToggle`) writes a render's seed back for reuse.
3. `src/engine.js` — `buildNegative()` appends the selected style's negative.
4. `src/player.js` — speed ladder extended to 8×.
5. `index.html` / `src/styles.css` — the mode select and lock-seed switch, with
   matching styling.
6. `src/store.js` — `lockSeed` setting (default `false`).
7. `src/server/server.py` — `hunyuan_t2v` + `hunyuan_i2v` model entries
   (experimental).

The remaining genuinely-new capability from the roadmap is **video-to-video**
(§27), which needs a source-video input path plus a VACE-style server family —
scoped as future work in `src/ROADMAP.md`.
