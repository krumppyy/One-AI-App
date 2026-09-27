# Roadmap V2 — making the toolkit genuinely useful

Consulted 3 outside minds (product manager, daily short-form creator, offline-first engineer) with a privacy-safe brief: no internals, no personal data, just "3 studios, free, no signup, casual creators". All three converged on the same gap: generation works, assembly doesn't.

## Verdict: studios are isolated. Creators live in the timeline.

1. PM: project canvas, cross-studio reference lock, one-click social presets, prompt-to-script, beat sync.
2. Creator: shared asset bucket, timeline sequencer, voice-matched auto-trim, character seed lock, batch pipeline.
3. Engineer: local library, multi-track arranger, client-side background remover, template gallery, batch zip export.

## Plan

Phase 1 — SHIPPED HERE
- Prompt template gallery in Image + Video + Voice (one click fills the box)
- Platform presets: TikTok / Shorts / Reels 9:16, Instagram 1:1 + 4:5, YouTube 16:9, Cinema 21:9 (one click sets aspect)
- Voice script -> Video prompt handoff (one click copies script, jumps to Video)
- Project pack: whole library as one .zip from the Library dialog (JSZip via CDN, on-device)

Phase 1b — SHIPPED (after V2)
- App version renamed V2 → V3 (generator title + header badge)
- Agent edit in Image Studio (`src/edit-agent.js` + "Agent edit" toggle): a prompt like "sunset sky, remove the car, add birds" is split into ordered single-change steps (AI planner via generateText, local fallback) and applied one by one through the edit model, each step's output feeding the next, with per-step progress
- Editor export formats: MP4 / WebM (inbuilt MediaRecorder encoder) + MOV / MKV / GIF-animated / APNG via the built-in converter (`src/gallery-export.js`); every editor export auto-saves to the Library finals
- Library upgrade (`src/library-save.js`): every tab except chat auto-saves — video + image results, editor exports, voiceover videos, voice tracks (WAV/MP3/OGG), reader narrations, and all imported files (video starter, edit image, editor bin); categories Video / Images / Editor / Voice / Reader / Imports / Takes with counts, badges, live finder search, and tap-to-reuse (imports reload into their studios)

Phase 2 — next
- Real timeline: video clip + voiceover muxed on-device into one file, auto-trim to voice length
- Video last-frame -> Image edit handoff (needs an app.js hook; deliberately not hacked in Phase 1)
- Character lock: named seed/profile reused across Image generations
- Batch storyboard: N images + 1 script -> N clips queued

Phase 3 — later
- Client-side background remover (TensorFlow.js, on-device)
- Beat sync (snap cuts to voiceover cadence)
- C2PA/provenance line on export

Explicitly out of scope: central backend, accounts, server-side moderation, paid-only features. Same reasons as before.
