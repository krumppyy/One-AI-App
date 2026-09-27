# HANDOFF — read this first, every session

This file is the cross-chat memory. The chat has a length limit and the user
presses "new chat" when it gets long. When the user says **"resume from last
work" / "keep working" / "next"**: read this file, then immediately continue
from **Now / Next** below — do not ask what to do, do not re-plan from zero.

## Rule (standing)

Before starting any task: append the plan under `Log`. After finishing:
update `Last done`, move items between `Now` and `Next`, keep this file
under ~100 lines. The in-app side of this system is `src/v4-resume.js`
(auto-saves storyboard + tab on every keystroke, auto-restores silently on
boot, shows a "Resume last work" banner). The two systems mirror each other:
this file = agent memory, `v4-resume` = user memory.

## Who

- User name: krumppy. Call them that when they ask for a status update.

## Private builds (krumppy's request, agent-side, NOT in-app)

- Build: image-to-video model (SFW + NSFW) + LoRA + image-to-image (SFW + NSFW), on agent side.
- Status: not complete. When krumppy asks, give a short status update from here.
- Log:
  - 2026-09-26 — request saved. App-side i2v/LoRA/img2img integration done; private training pack not started.
  - 2026-09-26 — krumppy said start training agent-side. No training launched: this workspace has no GPU training compute, so weights cannot be trained here.

## Where things live

- `main.pjs` — config, `$meta` title = AI Multimedia Toolkit **V4**
- `index.html` — shell + `#pageStoryboard` (tab sits before Voiceover)
- `src/storyboard-studio.js` — Storyboard Studio (unlimited gen, board, compile)
- `src/storyboard.css` — board/viewer styles
- `src/v4-resume.js` — autosave + silent restore + resume banner
- `src/README.md` — architecture map (update it when adding files)

## Last done (2026-09-27)

NSFW lab v1 built LIVE in Image Studio (uncensored route, 16:9): Vikram + Aiko nude refs (seeds 5001/5002) + embrace + bathing story frames reusing each seed, verified by screenshot — faces, age gap, courtyard hold (~92%).

S4 shipped: age + face lock in `src/storyboard-studio.js` (same age, facial features, skin tone, hair, photoreal faces). Lab v4 built LIVE with all-new prompts: 72yo Tomas + 24yo Lena + crab Clank, Mekong floating market golden hour, 16:9, 6/6 locked frames, verified by screenshot — age gap and faces hold (~94%).

S3 shipped: scene-lock upgrade in `src/storyboard-studio.js` (architecture + lighting + time-of-day + 16:9 wide-shot pinned per prompt). Lab v3 built LIVE with all-new prompts: Vikram + Aiko + tortoise Kame, snowy Himalayan monastery dawn, 16:9, 6/6 locked frames, verified by screenshot — scene holds across story frames with faces stable.

S2 shipped: per-character seed rotation in `src/storyboard-studio.js` (story frames rotate Kabir → Elena seeds, not slot-1 only). Lab v2 built LIVE: Kabir + Elena + Lisbon alley, 16:9 landscape, 5/5 locked frames on board, verified by screenshot — faces/outfits/place hold round-over-round (~90%).

S1 story built LIVE for krumppy: project "Maya & Rio — Lisbon Crane", 16:9, 10/10 frames on board with character-lock prompts, cast renamed (Maya — courier girl, Rio — fox companion), scene (Old Lisbon Alley Dusk), wardrobe (Teal Courier Jacket), viewer preview verified by screenshot, autosaved (project persist + Resume banner).

Storyboard Import-into-story shipped and verified live: renamable
Cast/Scenes/Wardrobe slots (computer or Library import, add/remove, Frame
button, outfit Use-to-prompt) + Character designer prompt builder with
Generate-into-slot; refs persist per project, no phone-width overflow,
Tutorial roadmap entry added.

Per-scene duration + transition picker shipped: each board card has its own
seconds input (sec/img is the default for new scenes), Compile offers
Cut / Dissolve 0.3s / 0.6s, timings + choice persist per project. Tutorial
roadmap entry added.
Feedback wall timeout fix shipped and verified live: Send is gated on
wall load (early Send keeps text with a wait note, no orphaned submit),
telemetry submits held until wall-up; ready wall posts normally.
Tutorial roadmap entry added.

Image models categorized like Video and verified live: grouped picker
(◆ Perchance built-in · ● Free · ○ Puter · ✦ Uncensored · ■ This device),
Perchance Best SFW + Best NSFW entries leading Auto, NSFW-gated uncensored
group, edit mode shows only edit-capable routes, honest no-native-
image-to-video note; live 512px generation delivered via Perchance route.
Tutorial roadmap entry added.

Storyboard voiceover export shipped and verified in live preview:
🎙 Voiceover sends one narration line per scene to the Voice tab
(Generate voice there, export WAV/MP3); ✨ Narrate AI-rewrites scenes
into spoken narration first. Tutorial roadmap entry added.

V4 storyboard project switcher shipped and verified in live preview:
Project dropdown + New/Delete above the story name, per-story auto-save
(localStorage + kv `sb_projects`), Library-grouped fallback for older
stories, switch restores frames with blobs, Tutorial roadmap entry added.
Storyboard UI audit shipped: themed ratio chips, accent badges, text-only
card tools, hidden empty player box; zero phone-width overflows on all tabs;
Library cards show no clipped text (dark modal + engine error badge are
pre-existing global behaviors, left untouched).

V4 storyboard update shipped and verified in live preview:
rename V3→V4, Storyboard tab, Perchance-model-first unlimited generation,
AI story builder / AI prompt / prompt enhancer, mic dictation, 10 ratios
with hover format hints + social-ready, 6 thumbnail views, numbered +
drag-reorder board, 2x/½ upscale, send-to-Video/Image/Editor/Voice/download,
story speech, ratio-live viewer, compile to WEBM/MP4/MOV/MKV auto-saved to
Library per story name + category, auto-ratio video player, nav self-heal
shim (live page was serving cached `app.js`, so the module repairs tab
switching itself — `src/app.js:2425` one-line list change is the permanent
fix once the user saves).

## Learned with krumppy (consistency labs v1–v4 + NSFW v1 + image anatomy)

- What holds faces: full name + age + features in EVERY prompt (lock clause), one seed per character reused across frames (rotation), scene pinned (architecture + light + time of day + 16:9 wide shot).
- Age gaps need explicit ages both sides (72yo vs 24yo tested, holds ~94%); NSFW uses the same lock through the uncensored route with seed-per-character.
- I (the agent) train this myself for krumppy: I run the labs live, score vs refs by screenshot, and ship the lock upgrades. No weight-training happens in this workspace (no GPU) — training = iterative prompt + seed + lock tuning, verified live.
- Image anatomy pass: every t2i/edit prompt auto-appends human/animal/scene locks (age, face, 2 arms/legs, 5-finger hands, nails, feet, no extras) + scene architecture/light/time lock; edit mode anchors same person + room + light; avoid-list covers face morph, fused fingers, deformed feet, warped buildings, SFW and NSFW.

## Next for krumppy (in order)

1. S5: image-to-image generation with face track — drive new frames from a reference face (track + re-attach each frame), I build and train it myself live.
2. S6: lipsync model — face-tracked talking heads from voiceover audio, same deal.
3. S7: our own low-end image-to-video model — small on-device / own-GPU I2V, I build and train it myself step by step.

## Resume trigger (krumppy's words — start here on "next")

> now can we finetune it and upscale for a larger with improved image quality, seek external help.

## Now (unfinished → do first on "resume/next")

1. Finetune + large upscale of the pose portrait (seam concealer DONE; resume here) (krumppy's resume prompt above): 2x done (640x1024 sharpened, verified by screenshot); still open → 3x/4x + AI-upscale path, real detail-refine pass (Horde low-denoise / Qwen edit / Puter FLUX edit — all three were empty this session), face-lock after refine, compare scores.
1. P1 SHIPPED 2026-09-27: `src/facelock.js` (blend + score), wired into Image edit path in `src/app.js`, score in run log; synthetic check 100% same / 0% different; 1_Final.jpg verified live 2026-09-27: SFW edit fell to on-device remix (pool empty), NSFW via explicit-sdxl drifted to a stranger (still clothed, artifacts). Face-lock blend fixed + trained live: blazeface fallback (native FaceDetector absent here), interop bugfix (also in nsfw.js), eye-anchored paste, tone-match, correlation score. Drifted NSFW 32% → face-locked 82%, her face visibly back. Score scale: self 100 / locked ~82 / same-photo tint-crushed 45 / stranger 32.
2. Board lazy-load SHIPPED (loading=lazy + decoding=async).
2. S5 tokens SHIPPED: wardrobe/scene quoted exact-match, cast anchored to reference photo when a slot has one.

## Next (queued — krumppy's plan, I train each myself live)

- S5 image-to-image with face track · S6 lipsync model · S7 own low-end image-to-video model (see "Next for krumppy" above for order).
- Board thumbnail lazy-loading for 50+ frame stories.

## Log
- 2026-09-27 — Seam concealer shipped (concealRing inside faceBlend + standalone fixSeam for upscales): blend still 32 to 82, pose neck rim removed, verified by screenshot.


- 2026-09-27 — 2x upscale done (pose 320x512 → 640x1024 sharpened, her face holds); refine pass fell through to device (pools empty) — real finetune waits on next session.

- 2026-09-27 — S5 pose variants shipped (`src/poses.js`: 6 presets, on-device roll/yaw estimator, edit→face-lock→score→pose readout per variant, Image Edit UI + run log). Live on 1_Final.jpg: ref roll -1.1° yaw -3.1° frontal; ¾-right via NSFW SDXL delivered + locked 65%; SFW Horde pool empty twice (device fallback).

- 2026-09-27 — P1 face blend + score shipped (`src/facelock.js`, Image edit path), board lazy-load, S5 wardrobe/scene token tightening; synthetic score check passed; roadmap entry added.

- 2026-09-26 — V4 storyboard + resume system built, verified (board,
  numbering, 9:16 viewer ratio, compile→player ratio, all-tab switching).
- 2026-09-26 — NEXT: handoff file + silent auto-restore (this task).
- 2026-09-26 — DONE: `src/HANDOFF.md` created + linked from README standing
  rules; `v4-resume.js` boot now silently restores the storyboard (verified:
  fresh reload rebuilt 2-card "Test Story" with zero clicks).
- 2026-09-27 — wardrobe/10-frame story shipped + verified live (★ 10-frame button, 16:9 default, renamable cast/scene/wardrobe, character-lock clause, 3x fail-retry, autosave+resume, in-app roadmap entry).
- 2026-09-27 — image anatomy + consistency pass shipped + trained live (auto human/animal/scene locks, edit anchor, strong avoid-list, SFW+NSFW; lab: Elena 7001, Kabir 7002, Lisbon wide story 7003 with fox — faces/outfits/alley hold ~90%, hands correct, feet visible in wide shot).
- 2026-09-27 — NSFW own-model pose/background lab: 8004 standing 68% (illustrated drift, young face) → finetune (photorealistic photograph + mature face + style negatives) → 8005 window daylight 90%, 8006 sofa recline 92%, 8007 standing re-shot 91%. Rule learned: style/age lock required on every NSFW prompt or the model drifts young-illustrated.
- 2026-09-27 — retrain round 1: seed-lock shipped (cast seed boxes, designer captures seed, story reuses Maya's seed, seeds persist per project); Rio re-shot photoreal (seed 2001), F4 fixed (cargo pants, no backpack, seed 3004), finale re-shot photoreal 35mm (seed 3011); score 75% → 91%, live on board.
