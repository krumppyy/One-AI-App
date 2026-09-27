# Roadmap V3 — voiceover timeline (script -> scenes -> merged final)

Three outside minds consulted on a privacy-safe brief (no internals, no personal data). Unanimous:

1. Script first. TTS first, then cut visuals to the audio — never the reverse.
2. A director step must turn narration into shot prompts; casual creators can't prompt.
3. Voices must be a ladder: on-device (free, private) -> free public -> self-hosted.

## Free open-source voice ladder (from the TTS researcher)

- On-device now: browser voices (OS ships male/female Hindi, Bangla, English, Spanish + more). Zero cost, private, offline. Quality varies by device — that is the honest tradeoff.
- Draft-fast: Piper (CPU-fast, many languages, flatter prosody).
- Quality + cloning: Coqui XTTS v2 (needs GPU, best prosody, ES/FR/DE/IT/PT/TR/PL + EN).
- Coverage king: Meta MMS (1100+ languages incl. Hindi/Bangla, flat delivery).
- Expressive wild: Suno Bark (laughs/sighs, unpredictable, slow).
- Character voices: OpenVoice. Deployable runtime: Sherpa-ONNX. Legacy fallback: eSpeak.
- Rule: never one server. On-device preview -> public pool final -> own GPU (XTTS/Piper) for power users.

## Workflow (from the editor)

Script -> Director AI (shots JSON: spoken line + visual prompt + camera + seconds from word count ~150wpm) -> TTS + image/video in parallel -> auto-time visuals to audio (trim/loop, never re-render) -> client-side mux -> one file.

## Build order

Phase 1 — SHIPPED HERE (all on-device, free forever)
- Voice finder: language search + male/female filter over the device's own voices
- Voiceover track: mic record + audio import, with duration readout
- Director: one click turns the script into 3-6 shots (line + visual prompt + camera + seconds), each with "Use as video prompt"
- Merge: voiceover muxed onto the finished clip on-device (canvas + audio capture), preview + download
- Verified live: director plans real shots, filters/merge guards behave, media capture path works on synthetic clips; full merge awaits a real rendered clip.

Phase 2 — SHIPPED HERE (all on-device, free forever)
- Personas replace name-guessing: Feminine / Neutral / Masculine pitch presets (Hindi-tuned), ▶ Test line per language, sliders stay for fine-tune
- Timeline viewer: finished clip / video import / library pick, preview video, waveform, starts-at offset, volume, preview-together, merge with heard-voice verification + auto-download
- Track export: WAV lossless, MP3 64-192 kbps, OGG 32-128 kbps
- Overlap fixed: merge lives in the timeline card, not stacked on the Speak row
- Inbuilt voice recorder: ● Rec voice speaks the script with the chosen voice/persona while capturing it into the track (auto-stops at utterance end), then Export track or merge — no mic narration needed
- ✨ Generate voice (mic-free, verified live): script → free TTS through the relay (address hidden) → persona pitch rendered in-app → WAV track with waveform; Hindi auto-detected from script, masculine/feminine presets applied; export WAV/MP3/OGG, merge onto clip
- Preview together needs no track: speaks the script live over the clip (Rec voice keeps it); position slider + wave playhead move with playback and seek

Phase 2b — SHIPPED (after V3)
- App version is V3 (renamed from V2)
- Voice saves to the Library: voiceover → video renders (`src/photo-voice.js`) and track exports WAV/MP3/OGG (`src/voice-video.js` exportTrack) auto-save under Voice; tap-to-reuse loads audio back into the voice track (`window.__voiceLoadTrack`)
- Reader narrations auto-save under Reader (`src/reader.js` generateNarration → `saveTextToLibrary`); docs stay in localStorage, tap-to-reuse loads text into Voice/Reader

Phase 3 — next
- Free public TTS pool for finals (short clips, community endpoints)
- Own-GPU TTS endpoint (XTTS v2 / Piper) beside the existing video server
- Word-timestamp auto-cut (per-scene trim instead of one global mux)

Out of scope: paid per-character APIs, central storage, server-side user data.
